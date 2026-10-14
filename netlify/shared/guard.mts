/**
 * Zugangsschutz und Rate-Limit für die KI-Endpunkte (/api/evaluate, /api/oral).
 *
 * Beides ist nötig, weil die Endpunkte Anfragen auf einem privaten
 * Anthropic-Konto auslösen. Ohne Zugangscode antwortet der Server mit 401,
 * und auch mit gültigem Code gilt ein Kontingent je Lerner-Code bzw. IP.
 */

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

/** Vergleicht zwei Strings ohne früh abzubrechen, damit die Laufzeit nichts verrät. */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Prüft den Header `x-app-key` gegen APP_PASSWORD.
 * Gibt `null` zurück, wenn alles in Ordnung ist, sonst die fertige Fehlerantwort.
 *
 * Ist APP_PASSWORD auf dem Server nicht gesetzt, bleibt der Endpunkt geschlossen.
 * Ein offener KI-Endpunkt ist teurer als ein kurzzeitig nicht nutzbarer.
 */
export function checkAppKey(req: Request, appPassword: string | undefined): Response | null {
  if (!appPassword) {
    return json(
      {
        error: "Der Zugangsschutz ist auf dem Server nicht konfiguriert (APP_PASSWORD). Die KI-Bewertung ist deshalb deaktiviert.",
        code: "no_app_password",
      },
      503,
    );
  }
  const provided = req.headers.get("x-app-key") ?? "";
  if (!provided || !constantTimeEqual(provided, appPassword)) {
    return json({ error: "Zugangscode fehlt oder ist falsch.", code: "unauthorized" }, 401);
  }
  return null;
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

/**
 * Gleitendes Fenster im Arbeitsspeicher.
 *
 * Netlify-Functions laufen in kurzlebigen Instanzen, das Limit greift also je
 * Instanz und nicht global. Als zweite Verteidigungslinie hinter dem
 * Zugangscode reicht das; es hält vor allem ein durchgesickertes Passwort davon
 * ab, in einem Rutsch tausende Anfragen auszulösen.
 */
export class RateLimiter {
  #hits = new Map<string, number[]>();
  #now: () => number;
  #maxKeys: number;
  limit: number;
  windowMs: number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = 5000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.#now = now;
    this.#maxKeys = maxKeys;
  }

  check(key: string): RateLimitResult {
    const t = this.#now();
    const cutoff = t - this.windowMs;
    const times = (this.#hits.get(key) ?? []).filter((x) => x > cutoff);
    if (times.length >= this.limit) {
      const retryAfterSec = Math.max(1, Math.ceil((times[0] + this.windowMs - t) / 1000));
      this.#hits.set(key, times);
      return { allowed: false, remaining: 0, retryAfterSec };
    }
    times.push(t);
    this.#hits.set(key, times);
    if (this.#hits.size > this.#maxKeys) this.#evict(cutoff);
    return { allowed: true, remaining: this.limit - times.length, retryAfterSec: 0 };
  }

  #evict(cutoff: number) {
    for (const [k, v] of this.#hits) {
      const kept = v.filter((x) => x > cutoff);
      if (kept.length) this.#hits.set(k, kept);
      else this.#hits.delete(k);
    }
    // Falls immer noch zu viele Schlüssel: die ältesten zuerst entfernen.
    if (this.#hits.size > this.#maxKeys) {
      const order = [...this.#hits].sort((a, b) => (a[1].at(-1) ?? 0) - (b[1].at(-1) ?? 0));
      for (const [k] of order.slice(0, this.#hits.size - this.#maxKeys)) this.#hits.delete(k);
    }
  }
}

const LEARNER_CODE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Schlüssel für das Rate-Limit: bevorzugt der Lerner-Code (ein Lernender kann so
 * über mehrere Geräte hinweg begrenzt werden), sonst die aufrufende IP.
 */
export function rateLimitKey(req: Request, learnerCode: string | undefined): string {
  if (learnerCode && LEARNER_CODE.test(learnerCode)) return "learner:" + learnerCode;
  const ip =
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";
  return "ip:" + ip;
}

export function rateLimitResponse(r: RateLimitResult, limit: number): Response {
  return json(
    {
      error: `Kontingent erschöpft: höchstens ${limit} KI-Anfragen pro Stunde. Bitte in ${Math.ceil(r.retryAfterSec / 60)} Minute(n) erneut versuchen.`,
      code: "rate_limited",
    },
    429,
    { "retry-after": String(r.retryAfterSec) },
  );
}

/** Liest den Request-Body mit harter Obergrenze, damit kein Riesen-Payload durchläuft. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Anfrage zu groß");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new Error("Anfrage zu groß");
  return JSON.parse(text);
}
