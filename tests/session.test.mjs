// Laufende Sitzung sichern und nach einem Neuladen wieder aufbauen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeSession, reviveSession, sessionQuestionIds, canResume } from '../public/lib/session.js';

const Q = Object.fromEntries(['beat-001', 'beat-002', 'inf-003', 'ikt-004'].map((id) => [id, { id, area: id.split('-')[0], question: `Frage ${id}` }]));

const session = () => ({
  source: '_heute', title: 'Tagessitzung',
  questions: [Q['beat-001'], Q['beat-002'], Q['inf-003'], Q['ikt-004']],
  i: 2,
  results: [{ q: Q['beat-001'], selfScore: 2, aiScore: 85 }, { q: Q['beat-002'], selfScore: 0, aiScore: null }],
  startedAt: 1700000000000,
  draft: { qId: 'inf-003', values: { ans: 'Ampicillin + Gentamicin' }, hintsShown: 1, mode: 'submit', aiRounds: [] },
});

test('Sitzung wird ohne Fragentexte gespeichert', () => {
  const raw = serializeSession(session());
  assert.deepEqual(raw.ids, ['beat-001', 'beat-002', 'inf-003', 'ikt-004']);
  assert.deepEqual(raw.results.map((r) => r.id), ['beat-001', 'beat-002']);
  assert.ok(!JSON.stringify(raw).includes('Frage beat-001'));
  assert.equal(serializeSession(null), null);
});

test('Sitzung übersteht JSON und wird vollständig wieder aufgebaut', () => {
  const raw = JSON.parse(JSON.stringify(serializeSession(session())));
  assert.deepEqual(sessionQuestionIds(raw), ['beat-001', 'beat-002', 'inf-003', 'ikt-004']);
  const s = reviveSession(raw, Q);
  assert.equal(s.i, 2);
  assert.equal(s.questions[s.i], Q['inf-003']);
  assert.equal(s.results[0].q, Q['beat-001']);
  assert.equal(s.results[1].selfScore, 0);
  assert.equal(s.draft.values.ans, 'Ampicillin + Gentamicin');
  assert.equal(s.startedAt, 1700000000000);
  assert.ok(canResume(s));
});

test('Entfernte Fragen fallen heraus, die Position rückt nach', () => {
  const raw = serializeSession(session());
  const { 'beat-002': _gone, ...rest } = Q;
  const s = reviveSession(raw, new Map(Object.entries(rest)));
  assert.deepEqual(s.questions.map((q) => q.id), ['beat-001', 'inf-003', 'ikt-004']);
  assert.equal(s.questions[s.i].id, 'inf-003');
  assert.equal(s.results.length, 1);
  assert.ok(s.draft, 'Entwurf gehört weiter zur aktuellen Frage');
});

test('Entwurf zu einer anderen Frage wird verworfen', () => {
  const raw = serializeSession({ ...session(), draft: { qId: 'beat-002', values: {} } });
  assert.equal(reviveSession(raw, Q).draft, null);
});

test('Beendete oder abgearbeitete Sitzungen werden nicht zum Fortsetzen angeboten', () => {
  assert.equal(canResume(reviveSession(serializeSession({ ...session(), ended: true }), Q)), false);
  assert.equal(canResume(reviveSession(serializeSession({ ...session(), i: 4, draft: null }), Q)), false);
  assert.equal(canResume(null), false);
  assert.equal(reviveSession(null, Q), null);
  assert.equal(reviveSession({ v: 1, ids: ['xx-999'], i: 0 }, Q), null);
  assert.equal(reviveSession({ v: 2, ids: ['beat-001'] }, Q), null);
});
