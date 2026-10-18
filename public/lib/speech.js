/**
 * Hilfen für Spracheingabe und -ausgabe (Web Speech API).
 */

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Setzt den bisher erkannten Text aus `event.results` zusammen.
 *
 * Es wird immer die ganze Ergebnisliste gelesen, nicht nur ab `resultIndex`:
 * Sonst fallen bei `continuous` die schon abgeschlossenen Sätze heraus, sobald
 * ein neuer beginnt. Chrome auf Android liefert Ergebnisse teils kumulativ
 * (das neue enthält das vorige) – dann wird ersetzt statt angehängt.
 */
export function collectSpeech(results) {
  const parts = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const t = (r[0]?.transcript || "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const prev = parts[parts.length - 1];
    if (prev && norm(t).startsWith(norm(prev))) parts[parts.length - 1] = t;
    else if (prev && norm(prev).startsWith(norm(t))) { /* Wiederholung eines Teils – ignorieren */ }
    else parts.push(t);
  }
  return parts.join(" ");
}

/**
 * Wählt die beste deutsche Stimme des Browsers: neuronale Stimmen („Natural“,
 * „Online“, „Premium“ …) vor einfachen, Google vor anderen, Deutschland vor
 * Österreich und der Schweiz. Ohne deutsche Stimme `null`.
 */
export function pickGermanVoice(voices) {
  const rank = (v) =>
    (/natural|online|premium|enhanced|neural/i.test(v.name) ? 4 : 0) +
    (/google/i.test(v.name) ? 2 : 0) +
    (/^de[-_]DE/i.test(v.lang) ? 1 : 0);
  return [...voices].filter((v) => /^de\b/i.test(v.lang)).sort((a, b) => rank(b) - rank(a))[0] || null;
}
