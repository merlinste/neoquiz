/**
 * Laufende Lernsitzung im Browser sichern.
 *
 * iOS verwirft Safari-Tabs, sobald man kurz die App wechselt; beim Zurückkehren
 * lädt die Seite neu. Damit Sitzung, Position und die gerade bearbeitete Frage
 * (Antwortentwurf, Hinweise, KI-Bewertung, Selbsteinschätzung) das überstehen,
 * wird die Sitzung ohne Fragentexte gespeichert – nur mit Frage-IDs – und beim
 * Laden gegen den aktuellen Fragenbestand wieder aufgebaut.
 */

/** Sitzung → speicherbares Objekt (Fragen nur als ID). */
export function serializeSession(s) {
  if (!s) return null;
  return {
    v: 1,
    source: s.source,
    title: s.title,
    ids: s.questions.map((q) => q.id),
    i: s.i,
    results: s.results.map(({ q, ...r }) => ({ ...r, id: q.id })),
    startedAt: s.startedAt,
    ended: Boolean(s.ended),
    draft: s.draft || null,
  };
}

/** Frage-IDs der gespeicherten Sitzung, die für den Wiederaufbau geladen werden müssen. */
export const sessionQuestionIds = (raw) => [...new Set([...(raw?.ids || []), ...(raw?.results || []).map((r) => r.id)])];

/**
 * Gespeichertes Objekt → Sitzung. `byId` liefert die vollständigen Fragen.
 * Fragen, die es nicht mehr gibt, fallen heraus; die Position verschiebt sich
 * entsprechend, und ein Entwurf zu einer anderen Frage wird verworfen.
 */
export function reviveSession(raw, byId) {
  if (!raw || raw.v !== 1 || !Array.isArray(raw.ids)) return null;
  const get = (id) => (byId instanceof Map ? byId.get(id) : byId[id]);
  const questions = raw.ids.map(get).filter(Boolean);
  if (!questions.length) return null;
  const i = Math.min(questions.length, raw.ids.slice(0, raw.i).filter((id) => get(id)).length);
  const results = (raw.results || []).map(({ id, ...r }) => ({ ...r, q: get(id) })).filter((r) => r.q);
  const draft = raw.draft && questions[i]?.id === raw.draft.qId ? raw.draft : null;
  return { source: raw.source, title: raw.title, questions, i, results, startedAt: raw.startedAt, ended: Boolean(raw.ended), draft };
}

/** Lässt sich die Sitzung fortsetzen (nicht beendet, noch Fragen offen)? */
export const canResume = (s) => Boolean(s && !s.ended && s.i < s.questions.length);
