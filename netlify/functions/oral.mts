import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { json } from "../shared/guard.mts";
import { checkAccess, JOB_ID, PROTOCOL_STORE, readOralBody, runOral } from "../shared/oral.mts";

/**
 * POST /api/oral – ein Gesprächszug (Eröffnung oder Reaktion auf eine Antwort).
 * GET  /api/oral?job=<id> – Stand eines Protokolls aus oral-protocol-background.
 *
 * Das Protokoll am Gesprächsende braucht länger, als eine synchrone Function
 * laufen darf (sonst 504). Es wird deshalb im Hintergrund erstellt und hier
 * abgeholt.
 */
export default async (req: Request, _context: Context) => {
  const denied = checkAccess(req);
  if (denied) return denied;

  if (req.method === "GET") {
    const job = new URL(req.url).searchParams.get("job") ?? "";
    if (!JOB_ID.test(job)) return json({ error: "Ungültige Job-ID" }, 400);
    const result = await getStore(PROTOCOL_STORE).get(job, { type: "json", consistency: "strong" });
    return result ? json({ status: "done", ...result }) : json({ status: "pending" });
  }
  if (req.method !== "POST") return json({ error: "Nur GET oder POST" }, 405);

  let raw: unknown;
  try {
    raw = await readOralBody(req);
  } catch (e) {
    return json({ error: "Ungültige Anfrage", details: String(e) }, 400);
  }
  return runOral(req, raw);
};

export const config: Config = { path: "/api/oral" };
