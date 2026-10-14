// Spracheingabe: Zusammensetzen der Erkennungsergebnisse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSpeech } from '../public/lib/speech.js';

const res = (...items) => items.map(([t, isFinal = true]) => Object.assign([{ transcript: t }], { isFinal }));

test('abgeschlossene Sätze bleiben erhalten', () => {
  // Desktop-Chrome: resultIndex zeigt nur auf den neuen Satz, die Liste enthält aber alle.
  assert.equal(collectSpeech(res(['Der Verdichter saugt an.'], [' Dann wird verdichtet', false])),
    'Der Verdichter saugt an. Dann wird verdichtet');
});

test('kumulative Ergebnisse (Android) werden nicht verdoppelt', () => {
  assert.equal(collectSpeech(res(['der Verdichter'], ['der Verdichter saugt an'], ['der Verdichter saugt an und', false])),
    'der Verdichter saugt an und');
});

test('leere Ergebnisse werden übersprungen', () => {
  assert.equal(collectSpeech(res([' '], ['Atemnotsyndrom Surfactant'])), 'Atemnotsyndrom Surfactant');
  assert.equal(collectSpeech([]), '');
});
