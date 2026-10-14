import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { checkAccess, JOB_ID, PROTOCOL_STORE, readOralBody, runOral } from "../shared/oral.mts";

/**
 * POST /.netlify/functions/oral-protocol-background
 * Erstellt das Protokoll eines Fachgesprächs im Hintergrund (bis 15 Minuten).
 *
 * Netlify antwortet sofort mit 202. Das Ergebnis – Protokoll oder Fehler, mit
 * dem HTTP-Status, den eine synchrone Antwort gehabt hätte – landet unter der
 * vom Client erzeugten Job-ID im Blob-Speicher und wird über GET /api/oral?job=
 * abgeholt.
 */
export default async (req: Request, _context: Context) => {
  let raw: { jobId?: unknown } & Record<string, unknown>;
  try {
    raw = (await readOralBody(req)) as typeof raw;
  } catch {
    return;
  }
  const jobId = typeof raw?.jobId === "string" ? raw.jobId : "";
  if (!JOB_ID.test(jobId)) return;

  const store = getStore(PROTOCOL_STORE);
  const denied = checkAccess(req);
  const res = denied ?? (await runOral(req, { ...raw, action: "finish" }));
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  await store.setJSON(jobId, { httpStatus: res.status, ...body, finishedAt: new Date().toISOString() });
};
