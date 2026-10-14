// Zugangsschutz und Rate-Limit der KI-Endpunkte.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const canLoadTs = process.features?.typescript ?? false;
const skip = canLoadTs ? false : 'Node ohne Type-Stripping';

const req = (headers = {}) => new Request('https://example.test/api/evaluate', { method: 'POST', headers });

test('ohne Zugangscode antwortet der Server mit 401', { skip }, async () => {
  const { checkAppKey } = await import('../netlify/shared/guard.mts');

  const missing = checkAppKey(req(), 'geheim');
  assert.equal(missing?.status, 401);
  assert.equal((await missing.json()).code, 'unauthorized');

  const wrong = checkAppKey(req({ 'x-app-key': 'falsch' }), 'geheim');
  assert.equal(wrong?.status, 401);

  assert.equal(checkAppKey(req({ 'x-app-key': 'geheim' }), 'geheim'), null);
});

test('ohne konfiguriertes APP_PASSWORD bleibt der Endpunkt geschlossen', { skip }, async () => {
  const { checkAppKey } = await import('../netlify/shared/guard.mts');

  const r = checkAppKey(req({ 'x-app-key': 'irgendwas' }), undefined);
  assert.equal(r?.status, 503);
  assert.equal((await r.json()).code, 'no_app_password');
});

test('constantTimeEqual vergleicht korrekt', { skip }, async () => {
  const { constantTimeEqual } = await import('../netlify/shared/guard.mts');
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual('', ''), true);
  assert.equal(constantTimeEqual('Straße', 'Straße'), true);
});

test('Rate-Limit greift und öffnet nach Ablauf des Fensters wieder', { skip }, async () => {
  const { RateLimiter } = await import('../netlify/shared/guard.mts');

  let now = 1_000_000;
  const rl = new RateLimiter(3, 3600_000, () => now);

  assert.equal(rl.check('a').allowed, true);
  assert.equal(rl.check('a').allowed, true);
  assert.equal(rl.check('a').remaining, 0);

  const blocked = rl.check('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 3600);

  // Ein anderer Schlüssel hat sein eigenes Kontingent.
  assert.equal(rl.check('b').allowed, true);

  // Nach dem Fenster ist wieder frei.
  now += 3600_001;
  assert.equal(rl.check('a').allowed, true);
});

test('Rate-Limit-Schlüssel bevorzugt den Lerner-Code', { skip }, async () => {
  const { rateLimitKey } = await import('../netlify/shared/guard.mts');

  const withIp = req({ 'x-nf-client-connection-ip': '203.0.113.7' });
  assert.equal(rateLimitKey(withIp, 'AbCdEfGhIjKlMnOpQr'), 'learner:AbCdEfGhIjKlMnOpQr');
  // Ungültiges Format fällt auf die IP zurück, damit niemand das Limit umgeht.
  assert.equal(rateLimitKey(withIp, 'kurz'), 'ip:203.0.113.7');
  assert.equal(rateLimitKey(withIp, undefined), 'ip:203.0.113.7');
  assert.equal(rateLimitKey(req({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }), undefined), 'ip:198.51.100.4');
  assert.equal(rateLimitKey(req(), undefined), 'ip:unknown');
});

test('zu große Anfragen werden abgewiesen', { skip }, async () => {
  const { readJsonBody } = await import('../netlify/shared/guard.mts');

  const small = new Request('https://example.test/', { method: 'POST', body: JSON.stringify({ a: 1 }) });
  assert.deepEqual(await readJsonBody(small, 1024), { a: 1 });

  const big = new Request('https://example.test/', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(2048) }) });
  await assert.rejects(() => readJsonBody(big, 1024), /zu groß/);
});
