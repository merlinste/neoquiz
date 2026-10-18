// Diktat: Aufruf an ElevenLabs Scribe.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const canLoadTs = process.features?.typescript ?? false;
const skip = canLoadTs ? false : 'Node ohne Type-Stripping';

test('nur Audio- und Videotypen werden angenommen, Parameter fallen weg', { skip }, async () => {
  const { audioMediaType } = await import('../netlify/shared/stt.mts');
  assert.equal(audioMediaType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(audioMediaType('Audio/MP4'), 'audio/mp4');
  assert.equal(audioMediaType('application/json'), null);
  assert.equal(audioMediaType(null), null);
});

test('Scribe-Aufruf: Modell, Deutsch, Fachbegriffe und Datei als Multipart', { skip }, async () => {
  const { scribeRequest, DEFAULT_STT_MODEL, STT_KEYTERMS } = await import('../netlify/shared/stt.mts');
  const audio = new Blob([new Uint8Array(10)], { type: 'audio/mp4' });
  const { url, init } = scribeRequest(audio, { apiKey: 'xi-geheim' });
  assert.equal(url, 'https://api.elevenlabs.io/v1/speech-to-text');
  assert.equal(init.headers['xi-api-key'], 'xi-geheim');
  const form = init.body;
  assert.equal(form.get('model_id'), DEFAULT_STT_MODEL);
  assert.equal(form.get('language_code'), 'de');
  assert.deepEqual(form.getAll('keyterms'), STT_KEYTERMS);
  assert.equal(form.get('file').name, 'antwort.mp4');

  const plain = scribeRequest(audio, { apiKey: 'k', keyterms: false, model: 'scribe_v1' }).init.body;
  assert.equal(plain.getAll('keyterms').length, 0);
  assert.equal(plain.get('model_id'), 'scribe_v1');
});

test('Fachbegriffe halten die API-Grenzen ein', { skip }, async () => {
  const { STT_KEYTERMS } = await import('../netlify/shared/stt.mts');
  assert.ok(STT_KEYTERMS.length <= 1000);
  assert.equal(new Set(STT_KEYTERMS).size, STT_KEYTERMS.length);
  for (const t of STT_KEYTERMS) {
    assert.ok(t.length < 50, t);
    assert.ok(t.split(/\s+/).length <= 5, t);
  }
});

test('Aufnahme: leer und zu groß werden abgelehnt', { skip }, async () => {
  const { readAudioBody } = await import('../netlify/shared/stt.mts');
  const req = (body, headers = {}) => new Request('https://example.test/api/stt', { method: 'POST', body, headers });
  await assert.rejects(readAudioBody(req(new Uint8Array(0)), 100), /leer/);
  await assert.rejects(readAudioBody(req(new Uint8Array(101)), 100), /zu groß/);
  await assert.rejects(readAudioBody(req(new Uint8Array(5), { 'content-length': '999' }), 100), /zu groß/);
  assert.equal((await readAudioBody(req(new Uint8Array(50)), 100)).byteLength, 50);
});
