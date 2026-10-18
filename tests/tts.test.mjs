// Prüferstimme: Aufruf an ElevenLabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const canLoadTs = process.features?.typescript ?? false;
const skip = canLoadTs ? false : 'Node ohne Type-Stripping';

test('Standardaufruf: Echtzeitmodell, deutsche Aussprache, Schlüssel im Header', { skip }, async () => {
  const { elevenLabsRequest, DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE } = await import('../netlify/shared/tts.mts');
  const { url, init } = elevenLabsRequest('Wie gehen Sie beim Atemnotsyndrom des Frühgeborenen vor?', { apiKey: 'xi-geheim' });
  assert.match(url, new RegExp(`^https://api\\.elevenlabs\\.io/v1/text-to-speech/${DEFAULT_TTS_VOICE}\\?output_format=mp3_`));
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['xi-api-key'], 'xi-geheim');
  assert.deepEqual(JSON.parse(init.body), { text: 'Wie gehen Sie beim Atemnotsyndrom des Frühgeborenen vor?', model_id: DEFAULT_TTS_MODEL, language_code: 'de' });
});

test('Multilingual v2 bekommt keinen language_code, Stimme wird URL-kodiert', { skip }, async () => {
  const { elevenLabsRequest } = await import('../netlify/shared/tts.mts');
  const { url, init } = elevenLabsRequest('Guten Tag.', { apiKey: 'k', voiceId: 'a/b', model: 'eleven_multilingual_v2' });
  assert.match(url, /text-to-speech\/a%2Fb\?/);
  assert.equal(JSON.parse(init.body).language_code, undefined);
});

test('Text ist Pflicht und begrenzt', { skip }, async () => {
  const { TtsRequestSchema, MAX_TTS_CHARS } = await import('../netlify/shared/tts.mts');
  assert.equal(TtsRequestSchema.safeParse({ text: '   ' }).success, false);
  assert.equal(TtsRequestSchema.safeParse({ text: 'x'.repeat(MAX_TTS_CHARS + 1) }).success, false);
  assert.equal(TtsRequestSchema.parse({ text: ' Frage ' }).text, 'Frage');
});
