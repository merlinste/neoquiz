import { z } from "zod";

/**
 * Sprachausgabe des Prüfers über ElevenLabs.
 *
 * Der Client schickt den Text eines Prüferzugs, der Server holt das Audio bei
 * ElevenLabs und reicht es als MP3 durch. Der API-Schlüssel bleibt so auf dem
 * Server. Ohne ELEVENLABS_API_KEY fällt der Client auf die Browserstimme zurück.
 */

/** Ein Prüferzug hat höchstens vier Sätze; das Limit lässt Luft, verhindert aber Hörbücher. */
export const MAX_TTS_CHARS = 1500;
export const MAX_TTS_BODY_BYTES = 8 * 1024;

/** Echtzeitmodell mit deutscher Aussprache, rund 100 ms Latenz. */
export const DEFAULT_TTS_MODEL = "eleven_v4_turbo";
/** Fertige ElevenLabs-Stimme „George“ als Startwert; besser eine deutschsprachige Stimme aus der Voice Library setzen. */
export const DEFAULT_TTS_VOICE = "JBFqnCBsd6RMkjVDRZzb";
/** MP3 mit 64 kbit/s reicht für Sprache und hält die Antwort klein. */
export const TTS_OUTPUT_FORMAT = "mp3_44100_64";

export const TtsRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TTS_CHARS),
  learnerCode: z.string().max(64).optional(),
});

export type TtsOptions = { apiKey: string; voiceId?: string; model?: string };

/** Baut den Aufruf an die ElevenLabs-API (POST /v1/text-to-speech/{voice_id}). */
export function elevenLabsRequest(text: string, opts: TtsOptions): { url: string; init: RequestInit } {
  const voiceId = opts.voiceId || DEFAULT_TTS_VOICE;
  const model = opts.model || DEFAULT_TTS_MODEL;
  const body: Record<string, unknown> = { text, model_id: model };
  // Multilingual v2 kennt language_code nicht; bei den anderen Modellen erzwingt es deutsche Aussprache.
  if (!model.startsWith("eleven_multilingual")) body.language_code = "de";
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${TTS_OUTPUT_FORMAT}`,
    init: {
      method: "POST",
      headers: { "xi-api-key": opts.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify(body),
    },
  };
}
