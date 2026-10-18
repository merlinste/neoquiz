// Diktat im Browser: Hilfsfunktionen ohne Mikrofon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendText, fmtDuration, pickMimeType } from '../public/lib/dictation.js';

test('erkannter Text wird mit genau einem Leerzeichen angehängt', () => {
  assert.equal(appendText('', ' Der Verdichter saugt an. '), 'Der Verdichter saugt an.');
  assert.equal(appendText('Erster Satz.  ', 'Zweiter Satz.'), 'Erster Satz. Zweiter Satz.');
  assert.equal(appendText('Nur Text', '   '), 'Nur Text');
});

test('Aufnahmeformat: Opus bevorzugt, sonst MP4 (Safari)', () => {
  assert.equal(pickMimeType(() => true), 'audio/webm;codecs=opus');
  assert.equal(pickMimeType((t) => t === 'audio/mp4'), 'audio/mp4');
  assert.equal(pickMimeType(() => false), '');
  assert.equal(pickMimeType(() => { throw new Error('alt'); }), '');
});

test('Dauer als Minuten:Sekunden', () => {
  assert.equal(fmtDuration(0), '0:00');
  assert.equal(fmtDuration(65_400), '1:05');
});
