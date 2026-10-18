import type { Config } from "@netlify/functions";
import { checkAppKey, json, RateLimiter, rateLimitKey, rateLimitResponse } from "../shared/guard.mts";
import { audioMediaType, MAX_AUDIO_BYTES, readAudioBody, scribeRequest } from "../shared/stt.mts";

/**
 * POST /api/stt – erkennt eine diktierte Antwort mit ElevenLabs Scribe.
 *
 * Body: die Aufnahme als Rohdaten, Content-Type audio/*. Der Lerner-Code fürs
 * Kontingent kommt im Header x-learner-code. Antwort: { text }.
 */
const RATE_LIMIT_PER_HOUR = Number(Netlify.env.get("STT_RATE_LIMIT") ?? "") || 120;
const limiter = new RateLimiter(RATE_LIMIT_PER_HOUR, 3600_000);

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);
  const denied = checkAppKey(req, Netlify.env.get("APP_PASSWORD"));
  if (denied) return denied;
  const apiKey = Netlify.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return json({ error: "ELEVENLABS_API_KEY ist auf dem Server nicht gesetzt.", code: "no_stt" }, 503);

  const type = audioMediaType(req.headers.get("content-type"));
  if (!type) return json({ error: "Erwartet wird eine Audioaufnahme.", code: "bad_type" }, 415);

  const rl = limiter.check(rateLimitKey(req, req.headers.get("x-learner-code") ?? undefined));
  if (!rl.allowed) return rateLimitResponse(rl, RATE_LIMIT_PER_HOUR);

  let audio: Blob;
  try {
    audio = new Blob([await readAudioBody(req, MAX_AUDIO_BYTES)], { type });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), code: "bad_audio" }, 413);
  }

  const model = Netlify.env.get("ELEVENLABS_STT_MODEL");
  const call = (keyterms: boolean) => {
    const { url, init } = scribeRequest(audio, { apiKey, model, keyterms });
    return fetch(url, init);
  };
  let upstream: Response;
  try {
    upstream = await call(true);
    // Lehnt die API die Fachbegriffe ab, lieber ohne sie erkennen als gar nicht.
    if (upstream.status === 400 || upstream.status === 422) {
      console.error("[stt] mit Fachbegriffen abgelehnt", upstream.status, (await upstream.text().catch(() => "")).slice(0, 500));
      upstream = await call(false);
    }
  } catch (e) {
    console.error("[stt] Verbindung fehlgeschlagen", e);
    return json({ error: "Verbindung zu ElevenLabs fehlgeschlagen.", code: "connection" }, 502);
  }
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("[stt] ElevenLabs", upstream.status, detail.slice(0, 500));
    if (upstream.status === 401) return json({ error: "ElevenLabs-Schlüssel ungültig.", code: "auth" }, 502);
    if (upstream.status === 429) return json({ error: "ElevenLabs-Kontingent erreicht.", code: "rate_limit" }, 429);
    return json({ error: `ElevenLabs-Fehler (${upstream.status})`, code: "api" }, 502);
  }
  const data = (await upstream.json().catch(() => ({}))) as { text?: unknown };
  return json({ text: typeof data.text === "string" ? data.text.trim() : "", remaining: rl.remaining });
};

export const config: Config = { path: "/api/stt" };
