import type { Config } from "@netlify/functions";
import { checkAppKey, json, RateLimiter, rateLimitKey, rateLimitResponse, readJsonBody } from "../shared/guard.mts";
import { elevenLabsRequest, MAX_TTS_BODY_BYTES, TtsRequestSchema } from "../shared/tts.mts";

/**
 * POST /api/tts – liest einen Prüferzug mit einer ElevenLabs-Stimme vor.
 *
 * Gleicher Zugangsschutz wie die KI-Endpunkte; ein eigenes Kontingent pro
 * Stunde verhindert, dass ein durchgesickerter Zugangscode das
 * ElevenLabs-Guthaben leert.
 */
const RATE_LIMIT_PER_HOUR = Number(Netlify.env.get("TTS_RATE_LIMIT") ?? "") || 120;
const limiter = new RateLimiter(RATE_LIMIT_PER_HOUR, 3600_000);

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);
  const denied = checkAppKey(req, Netlify.env.get("APP_PASSWORD"));
  if (denied) return denied;
  const apiKey = Netlify.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return json({ error: "ELEVENLABS_API_KEY ist auf dem Server nicht gesetzt.", code: "no_tts" }, 503);

  let payload;
  try {
    payload = TtsRequestSchema.parse(await readJsonBody(req, MAX_TTS_BODY_BYTES));
  } catch (e) {
    return json({ error: "Ungültige Anfrage", details: String(e) }, 400);
  }

  const rl = limiter.check(rateLimitKey(req, payload.learnerCode));
  if (!rl.allowed) return rateLimitResponse(rl, RATE_LIMIT_PER_HOUR);

  const { url, init } = elevenLabsRequest(payload.text, {
    apiKey,
    voiceId: Netlify.env.get("ELEVENLABS_VOICE_ID"),
    model: Netlify.env.get("ELEVENLABS_MODEL"),
  });
  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (e) {
    console.error("[tts] Verbindung fehlgeschlagen", e);
    return json({ error: "Verbindung zu ElevenLabs fehlgeschlagen.", code: "connection" }, 502);
  }
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("[tts] ElevenLabs", upstream.status, detail.slice(0, 500));
    if (upstream.status === 401) return json({ error: "ElevenLabs-Schlüssel ungültig.", code: "auth" }, 502);
    if (upstream.status === 429) return json({ error: "ElevenLabs-Kontingent erreicht.", code: "rate_limit" }, 429);
    return json({ error: `ElevenLabs-Fehler (${upstream.status})`, code: "api" }, 502);
  }
  return new Response(upstream.body, {
    headers: { "content-type": upstream.headers.get("content-type") || "audio/mpeg", "cache-control": "no-store" },
  });
};

export const config: Config = { path: "/api/tts" };
