/**
 * Wiedervorlage nach Lernstand (Spaced Repetition) auf Basis von FSRS.
 *
 * Kapselt ts-fsrs so, dass der Rest der App nur mit einfachen, serialisierbaren
 * Karten arbeitet (Datumsangaben als ISO-String), wie sie in localStorage und in
 * der Tabelle mq_cards liegen.
 */
import { fsrs, generatorParameters, createEmptyCard, Rating, State } from "../vendor/ts-fsrs.mjs";

export { Rating, State };

/** Selbsteinschätzung 0–3 → FSRS-Bewertung. */
export const RATING_BY_SELF = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
export const RATING_LABEL = { [Rating.Again]: "nicht gewusst", [Rating.Hard]: "teilweise", [Rating.Good]: "gewusst", [Rating.Easy]: "sicher" };

/**
 * Mindestabstand je Note, in Tagen.
 *
 * FSRS plant beim ersten Mal in wenigen Tagen: Eine gewusste Frage käme nach
 * rund drei Tagen wieder, und jede dieser Wiederholungen erzeugt die nächste –
 * der Tagesstapel wächst schneller, als er abgearbeitet werden kann. Diese
 * Untergrenzen dehnen den Rhythmus: Was FSRS enger plant, wird auf den hier
 * genannten Abstand gestreckt; plant FSRS ohnehin weiter (bei einer Frage, die
 * schon mehrfach saß), bleibt es dabei.
 *
 * Begrenzt wird der Abstand durch den Prüfungstermin – was danach fällig würde,
 * hilft für die Prüfung nicht mehr.
 */
export const MIN_DAYS = {
  [Rating.Again]: 5,   // nicht gewusst
  [Rating.Hard]: 14,   // teilweise
  [Rating.Good]: 45,   // gewusst
  [Rating.Easy]: 90,   // sicher
};

export const DEFAULT_EXAM_DATE = "2027-04-01";
export const DEFAULT_NEW_PER_DAY = 15;
/** Wiederholungen, die pro Tagessitzung unter die neuen Fragen gemischt werden. */
export const DEFAULT_REVIEWS_PER_DAY = 5;

const DAY = 86400000;

/** Kalendertage zwischen zwei Zeitpunkten, auf Mitternacht bezogen. */
export function daysUntil(dateish, from = new Date()) {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(dateish); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / DAY);
}

/**
 * FSRS-Instanz. Das maximale Intervall wird auf die verbleibende Zeit bis zur
 * Prüfung begrenzt: Was danach fällig würde, hilft für die Prüfung nicht mehr.
 */
export function scheduler({ examDate = DEFAULT_EXAM_DATE, requestRetention = 0.9 } = {}) {
  const remaining = Math.max(1, daysUntil(examDate));
  return fsrs(generatorParameters({
    request_retention: requestRetention,
    maximum_interval: Math.min(365, remaining),
    enable_fuzz: true,
    // Ohne Lernschritte: FSRS wuerde eine frisch beantwortete Frage sonst nach
    // einer bzw. zehn Minuten erneut vorlegen. In einer App, die einmal am Tag
    // benutzt wird, landen diese Karten nur am naechsten Tag als "faellig" im
    // Stapel und blaehen ihn auf. Die erste Antwort plant deshalb gleich in
    // Tagen.
    enable_short_term: false,
    learning_steps: [],
    relearning_steps: [],
  }));
}

const toISO = (d) => (d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : null);

/**
 * Eine Karte auf den Mindestabstand ihrer Note dehnen.
 *
 * Mitgezogen wird die Stabilität, sonst widersprächen sich Fälligkeit und
 * Lernstand: Die Karte wäre erst in 45 Tagen dran, würde in der Statistik aber
 * weiter als wackelig geführt. `intervalModifier` ist der Faktor, mit dem FSRS
 * aus der Stabilität ein Intervall macht (bei 90 % Wunsch-Retention genau 1).
 */
function stretch(raw, rating, sched, now, examDate) {
  const floor = Math.min(MIN_DAYS[rating] || 0, Math.max(1, daysUntil(examDate, now)));
  if (!floor) return raw;
  const planned = (new Date(raw.due) - now) / DAY;
  if (planned >= floor) return raw;
  return {
    ...raw,
    due: new Date(now.getTime() + floor * DAY).toISOString(),
    scheduled_days: floor,
    stability: Math.max(Number(raw.stability) || 0, floor / sched.intervalModifier),
  };
}

/** Karte → einfaches Objekt für localStorage und Supabase. */
export function serialize(card) {
  return {
    due: toISO(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps ?? 0,
    state: card.state,
    last_review: toISO(card.last_review),
  };
}

/** Gespeichertes Objekt → Karte mit echten Date-Objekten. */
export function deserialize(raw) {
  if (!raw) return null;
  return {
    due: new Date(raw.due),
    stability: Number(raw.stability) || 0,
    difficulty: Number(raw.difficulty) || 0,
    elapsed_days: Number(raw.elapsed_days) || 0,
    scheduled_days: Number(raw.scheduled_days) || 0,
    reps: Number(raw.reps) || 0,
    lapses: Number(raw.lapses) || 0,
    learning_steps: Number(raw.learning_steps) || 0,
    state: Number(raw.state) || 0,
    last_review: raw.last_review ? new Date(raw.last_review) : undefined,
  };
}

export const emptyCard = (now = new Date()) => serialize(createEmptyCard(now));

/**
 * Bewertung einer Antwort auf eine FSRS-Note abbilden.
 *
 * - `mc` und `calc` mit Endergebnis-Feld werden automatisch bewertet:
 *   falsch → Again, richtig → Good.
 * - Bei `open` und `calc` ohne maschinelles Ergebnis zählt die
 *   Selbsteinschätzung.
 * - Weicht die KI stark nach unten ab (unter 50 Punkte bei "gewusst" oder
 *   "sicher"), wird auf Hard herabgestuft.
 * - Hat der Lernende selbst bewertet, gilt zusätzlich die schlechtere der
 *   beiden Noten: eine ehrliche Selbsteinschätzung soll nie durch das
 *   automatische Ergebnis geschönt werden.
 *
 * @returns {{rating: number, downgraded: boolean}}
 */
export function ratingFor({ auto = null, selfScore = null, aiScore = null, selfByUser = false } = {}) {
  const autoRating = auto === "correct" ? Rating.Good : auto === "wrong" ? Rating.Again : null;
  const selfRating = selfScore == null ? null : RATING_BY_SELF[Math.max(0, Math.min(3, selfScore))];

  let rating = autoRating ?? selfRating ?? Rating.Again;
  if (autoRating !== null && selfByUser && selfRating !== null) rating = Math.min(autoRating, selfRating);

  let downgraded = false;
  if (autoRating === null && aiScore != null && aiScore < 50 && rating > Rating.Hard) {
    rating = Rating.Hard;
    downgraded = true;
  }
  return { rating, downgraded };
}

/**
 * Karte nach einer Antwort fortschreiben.
 * @returns {{card: object, intervalDays: number}}
 */
export function review(rawCard, rating, { now = new Date(), examDate = DEFAULT_EXAM_DATE } = {}) {
  const card = deserialize(rawCard) ?? createEmptyCard(now);
  const sched = scheduler({ examDate });
  const next = sched.next(card, now, rating);
  const out = stretch(serialize(next.card), rating, sched, now, examDate);
  return { card: out, intervalDays: Math.max(0, Math.round((new Date(out.due) - now) / DAY)) };
}

/** Vorschau: Wann wäre die Karte bei welcher Note wieder fällig? */
export function previewIntervals(rawCard, { now = new Date(), examDate = DEFAULT_EXAM_DATE } = {}) {
  const card = deserialize(rawCard) ?? createEmptyCard(now);
  const sched = scheduler({ examDate });
  const all = sched.repeat(card, now);
  const out = {};
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    const next = stretch(serialize(all[r].card), r, sched, now, examDate);
    out[r] = Math.max(0, Math.round((new Date(next.due) - now) / DAY));
  }
  return out;
}

export const isDue = (raw, now = new Date()) => Boolean(raw) && new Date(raw.due) <= now;
export const isNew = (raw) => !raw || Number(raw.reps) === 0;
/**
 * "Reif": mindestens zweimal beantwortet und zuletzt mindestens gewusst.
 *
 * Die Stabilität allein reicht als Maßstab nicht mehr: Seit die Mindestabstände
 * gelten, steht sie nach einer einzigen gewussten Antwort schon bei 45 Tagen.
 * Sicher sitzt eine Frage aber erst, wenn sie das über eine Wiederholung hinweg
 * gehalten hat.
 */
export const isMature = (raw) => Boolean(raw) && Number(raw.reps) >= 2 && Number(raw.stability) >= MIN_DAYS[Rating.Good];
/** "Wackelig": schon einmal vergessen oder noch nicht sicher gewusst. */
export const isWeak = (raw) => Boolean(raw) && !isNew(raw) && (Number(raw.lapses) > 0 || Number(raw.stability) < MIN_DAYS[Rating.Good]);
/** "Unsicher": zuletzt nicht gewusst. */
export const isShaky = (raw) => Boolean(raw) && !isNew(raw) && (Number(raw.lapses) > 0 || Number(raw.stability) < MIN_DAYS[Rating.Hard]);

/**
 * Wiederholungslast der nächsten Tage.
 * @returns {{date: string, count: number}[]} – Index 0 ist heute (inkl. überfälliger Karten).
 */
export function forecast(cards, days = 14, now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const out = Array.from({ length: days }, (_, i) => ({ date: new Date(start.getTime() + i * DAY).toISOString().slice(0, 10), count: 0 }));
  for (const raw of Object.values(cards || {})) {
    if (!raw || isNew(raw)) continue;
    const idx = Math.max(0, daysUntil(new Date(raw.due), start));
    if (idx < days) out[idx].count++;
  }
  return out;
}

/**
 * Tagessitzung zusammenstellen: Die neuen Fragen bilden das Geruest, die
 * Wiederholungen werden gleichmaessig dazwischen gestreut. So bleibt die
 * Sitzung gemischt, ohne dass am Anfang ein Block Wiederholungen steht.
 *
 * @template T
 * @param {T[]} fresh – neue Fragen
 * @param {T[]} reviews – Wiederholungen
 * @returns {T[]}
 */
export function interleave(fresh, reviews) {
  if (!reviews?.length) return [...(fresh || [])];
  if (!fresh?.length) return [...reviews];
  const out = [];
  const step = fresh.length / reviews.length; // neue Fragen je Wiederholung
  let next = 0;
  for (let i = 0; i < fresh.length; i++) {
    out.push(fresh[i]);
    while (next < reviews.length && i + 1 >= step * (next + 1)) out.push(reviews[next++]);
  }
  while (next < reviews.length) out.push(reviews[next++]);
  return out;
}

/**
 * Tagesquote neuer Fragen, rückwärts auf den Prüfungstermin gerechnet.
 * Ist noch reichlich Zeit, bleibt es bei der eingestellten Quote; wird es eng,
 * steigt sie so weit, dass der Bestand bis zur Prüfung durch ist.
 */
export function newPerDay({ remainingNew, examDate = DEFAULT_EXAM_DATE, configured = DEFAULT_NEW_PER_DAY, now = new Date() } = {}) {
  const days = daysUntil(examDate, now);
  if (days <= 0) return remainingNew;
  return Math.max(configured, Math.ceil(remainingNew / days));
}
