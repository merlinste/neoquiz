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

test('Browserstimme: neuronal vor einfach, Deutschland vor Österreich, nur Deutsch', async () => {
  const { pickGermanVoice } = await import('../public/lib/speech.js');
  const v = (name, lang) => ({ name, lang });
  assert.equal(pickGermanVoice([v('Anna', 'de-DE'), v('Microsoft Katja Online (Natural) - German (Germany)', 'de-DE'), v('Samantha', 'en-US')]).name,
    'Microsoft Katja Online (Natural) - German (Germany)');
  assert.equal(pickGermanVoice([v('Anna', 'de-DE'), v('Google Deutsch', 'de-DE')]).name, 'Google Deutsch');
  assert.equal(pickGermanVoice([v('Michael', 'de-AT'), v('Anna', 'de-DE')]).name, 'Anna');
  assert.equal(pickGermanVoice([v('Samantha', 'en-US')]), null);
});
