import type { Config } from "@netlify/functions";

/**
 * GET /api/health – zeigt, ob KI-Bewertung und Zugangscode konfiguriert sind
 * (ohne Geheimnisse preiszugeben). Die KI-Endpunkte sind nur nutzbar, wenn
 * sowohl ein API-Schlüssel als auch ein Zugangscode hinterlegt sind.
 */
export default async () => {
  const hasKey = Boolean(Netlify.env.get("ANTHROPIC_API_KEY"));
  const hasPassword = Boolean(Netlify.env.get("APP_PASSWORD"));
  return new Response(
    JSON.stringify({
      ok: true,
      ai: hasKey && hasPassword,
      apiKeyConfigured: hasKey,
      passwordRequired: true,
      passwordConfigured: hasPassword,
      model: Netlify.env.get("CLAUDE_MODEL") || "claude-opus-5-5",
      rateLimitPerHour: Number(Netlify.env.get("AI_RATE_LIMIT") ?? "") || 60,
    }),
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
  );
};

export const config: Config = { path: "/api/health" };
