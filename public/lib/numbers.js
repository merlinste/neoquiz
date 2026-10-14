/**
 * Zahlen-Parser für Rechenaufgaben (deutsches Format).
 *
 * Wird sowohl im Browser (public/app.js) als auch von den Unit-Tests geladen,
 * deshalb reines ES-Modul ohne Abhängigkeiten und ohne Build-Schritt.
 *
 * Deutsche Schreibweise: Punkt als Tausender-, Komma als Dezimaltrenner
 * ("2.810,50 €" = 2810,5). Als Tausendertrenner gelten auch normale und
 * geschützte Leerzeichen ("2 810,5"). Typografische Minuszeichen (−, –) und
 * Exponentialschreibweise ("1,5e3") werden erkannt.
 */

/** Vereinheitlicht Minuszeichen und Leerzeichenarten. */
function normalize(text) {
  return String(text ?? "")
    .replace(/[−–—‐‑]/g, "-") // −, –, —, ‐, ‑
    .replace(/[    ]/g, " "); // geschütztes, schmales, dünnes Leerzeichen
}

// Eine Zahl: optionales Vorzeichen, Ziffern mit Trennzeichen, optionaler Exponent.
const NUMBER_RE = /[-+]?\d(?:[\d.,]|[ ](?=\d{3}(?!\d)))*(?:[eE][-+]?\d+)?/g;

/**
 * Wandelt einen einzelnen Zahlen-Token in eine Zahl um.
 * Gibt `null` zurück, wenn der Token keine sinnvolle Zahl ergibt.
 */
function tokenToNumber(token) {
  let t = token.trim();
  let exp = "";
  const m = /([eE][-+]?\d+)$/.exec(t);
  if (m) { exp = m[1]; t = t.slice(0, -m[1].length); }

  let sign = "";
  if (t[0] === "-" || t[0] === "+") { sign = t[0] === "-" ? "-" : ""; t = t.slice(1); }

  // Leerzeichen sind hier immer Tausendertrenner (der Regex lässt sie nur so zu).
  t = t.replace(/ /g, "");

  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    // Beide vorhanden: das hintere Zeichen ist der Dezimaltrenner.
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    t = t.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    // Nur Kommas: im Deutschen der Dezimaltrenner. Mehrere Kommas → Tausendertrenner.
    t = (t.match(/,/g) || []).length > 1 ? t.split(",").join("") : t.replace(",", ".");
  } else if (lastDot >= 0) {
    // Nur Punkte: Tausendertrenner, wenn das Muster exakt passt (1.000, 12.345.678).
    t = /^\d{1,3}(\.\d{3})+$/.test(t) ? t.split(".").join("") : t;
  }

  const value = Number(sign + t + exp);
  return Number.isFinite(value) ? value : null;
}

/** Alle Zahlen in einem Text, in Reihenfolge des Auftretens. */
export function findNumbers(text) {
  const out = [];
  for (const m of normalize(text).matchAll(NUMBER_RE)) {
    const n = tokenToNumber(m[0]);
    if (n !== null) out.push(n);
  }
  return out;
}

/**
 * Genau eine Zahl aus einer kurzen Eingabe, z. B. dem Feld „Endergebnis“.
 * Nimmt die erste Zahl im Text, damit "2.810,50 €" und "≈ 26,1 l" funktionieren.
 */
export function parseNumber(text) {
  const nums = findNumbers(text);
  return nums.length ? nums[0] : null;
}

/**
 * Endergebnis aus einem Freitext-Rechenweg – der Fallback für Antworten, die
 * ohne das Endergebnis-Feld entstanden sind: die Zahl nach dem letzten
 * Gleichheits- oder Ergebniszeichen, sonst die letzte Zahl der letzten Zeile.
 */
export function extractFinalNumber(text) {
  const t = normalize(text);
  if (!t.trim()) return null;

  const sep = /[=→⇒➔]/g;
  let lastSep = -1;
  for (const m of t.matchAll(sep)) lastSep = m.index;
  if (lastSep >= 0) {
    const tail = t.slice(lastSep + 1);
    const n = findNumbers(tail);
    if (n.length) return n[0];
  }

  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const n = findNumbers(lines[i]);
    if (n.length) return n[n.length - 1];
  }
  return null;
}

/**
 * Prüft das Endergebnis einer Rechenaufgabe gegen die hinterlegte Lösung.
 *
 * `finalValue` ist das eigene Eingabefeld; ist es leer, wird als Fallback das
 * Endergebnis aus dem Rechenweg gelesen. Der Rechenweg selbst wird bewusst
 * nicht mehr nach irgendeiner passenden Zahl durchsucht.
 *
 * @returns {"correct"|"wrong"|"unparsed"} oder null, wenn keine Lösung hinterlegt ist
 */
export function checkSolution(solution, { finalValue = "", workings = "" } = {}) {
  if (!solution || typeof solution.value !== "number") return null;
  const value = String(finalValue).trim() ? parseNumber(finalValue) : extractFinalNumber(workings);
  if (value === null) return "unparsed";

  const target = solution.value;
  const tol = Math.max(solution.tolerance ?? 0.03, 0.005);
  const ok = target === 0 ? Math.abs(value) < 1e-9 : Math.abs(value - target) / Math.abs(target) <= tol;
  return ok ? "correct" : "wrong";
}
