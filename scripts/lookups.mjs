#!/usr/bin/env node
/**
 * Setzt das Feld `lookup` an den Fragen – wo man das Thema nachliest
 * (Checkliste Neonatologie, Leitlinien).
 *
 * Quelle der Zuordnung ist `data/literature.json` → `register`: je Thema die
 * Suchmuster (`match`) und die Fundstellen (`lookup`). Dieses Skript wendet sie
 * mechanisch an; gepflegt wird das Register, nicht die einzelne Frage.
 *
 *   node scripts/lookups.mjs            Fundstellen neu setzen
 *   node scripts/lookups.mjs --dry      nur zeigen, was sich ändern würde
 *
 * Es überschreibt alle generierten `lookup`-Felder. Eine Frage, die eine eigene
 * Fundstelle braucht, bekommt einen passenden Registereintrag – so bleibt die
 * Zuordnung an einer Stelle nachvollziehbar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from './jsonfmt.mjs';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const dry = process.argv.includes('--dry');
const lit = JSON.parse(fs.readFileSync(path.join(root, 'data/literature.json'), 'utf8'));
const areasDoc = JSON.parse(fs.readFileSync(path.join(root, 'data/areas.json'), 'utf8'));
const areaLookups = new Map(areasDoc.areas.map(a => [a.id, a.lookup ?? []]));

/** Fragetypen, die meist mehrere Themen berühren und deshalb zwei Fundstellen bekommen. */
const NUMERIC = new Set(['calc', 'case']);
/**
 * Ab diesem Gewicht gilt ein Registereintrag als Treffer: entweder ein Schlagwort
 * oder drei verschiedene Suchmuster im Text. Ein einzelnes Wort im Fließtext
 * genügt nicht – sonst landet die Fundstelle „Transfusion" an jeder Frage, in
 * der eine Anämie nur nebenbei vorkommt.
 */
const THRESHOLD = 3;

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Suchmuster als Regex mit Wortanfang. Deutsche Komposita sollen treffen
 * („Surfactant" findet „Surfactantgabe"), zufällige Wortmitten nicht
 * („NEC" darf nicht in „Konnektor" anschlagen).
 */
const rxCache = new Map();
function pattern(m) {
  const k = norm(m);
  if (!rxCache.has(k)) rxCache.set(k, new RegExp(`(?<![a-zäöüß0-9])${escape(k)}`, 'u'));
  return rxCache.get(k);
}

/** Text der Frage, in dem gesucht wird – Schlagworte zählen doppelt. */
function haystack(q) {
  const parts = [q.question, q.answer, ...(q.keyPoints ?? []), q.source ?? '', ...(q.parts ?? []).map(p => `${p.question} ${p.answer}`)];
  return { text: norm(parts.join(' ')), tags: norm((q.tags ?? []).join(' ')) };
}

/**
 * Gewicht eines Registereintrags für eine Frage: ein Treffer im Schlagwort wiegt
 * schwerer als einer im Fließtext, weil die Schlagworte das Thema benennen.
 */
function score(entry, hay) {
  let s = 0;
  for (const m of entry.match) {
    const rx = pattern(m);
    if (rx.test(hay.tags)) s += 3;
    else if (rx.test(hay.text)) s += 1;
  }
  return s;
}

/** Zwei Fundstellenlisten sind gleich, wenn Werk, Ort und Begriffe übereinstimmen. */
const key = (list) => JSON.stringify((list ?? []).map(l => [l.work, l.where ?? '', l.terms.join('|'), l.note ?? '']));

let changed = 0, set = 0, cleared = 0;
const perArea = [];

for (const area of areasDoc.areas) {
  const file = path.join(root, 'data/questions', `${area.id}.json`);
  if (!fs.existsSync(file)) continue;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const q of doc.questions) {
    const hay = haystack(q);
    const ranked = lit.register
      .map(e => ({ e, s: score(e, hay) }))
      .filter(x => x.s >= THRESHOLD)
      .sort((a, b) => b.s - a.s || a.e.id.localeCompare(b.e.id));
    // Rechenaufgaben und Fälle berühren meist zwei Themen und bekommen zwei
    // Fundstellen; bei Freitextfragen soll die eine Fundstelle wirklich passen.
    const hits = ranked.slice(0, NUMERIC.has(q.type) ? 2 : 1);
    const lookup = [];
    const notes = [];
    for (const { e } of hits) {
      for (const l of e.lookup) {
        if (lookup.length >= 3) break;
        if (lookup.some(x => x.work === l.work && x.where === l.where)) continue;
        lookup.push({ ...l, terms: [...l.terms] });
      }
      if (e.note) notes.push(e.note);
    }
    // Eine Fundstelle, die nur das wiederholt, was ohnehin am Gebiet hängt,
    // ist kein Gewinn – sie bleibt weg, die App zeigt dann die des Gebiets.
    if (notes.length && lookup.length) lookup[0] = { ...lookup[0], note: notes[0] };
    const same = key(lookup) === key(areaLookups.get(area.id));
    const next = lookup.length && !same ? lookup : undefined;
    if (key(q.lookup) !== key(next)) {
      if (q.lookup && !next) cleared++; else changed++;
    }
    if (next) { n++; set++; }
    // Feldreihenfolge halten: lookup kommt vor source.
    const rebuilt = {};
    for (const [k, v] of Object.entries(q)) {
      if (k === 'lookup') continue;
      if (k === 'source' && next) rebuilt.lookup = next;
      rebuilt[k] = v;
    }
    if (next && !('lookup' in rebuilt)) rebuilt.lookup = next;
    for (const k of Object.keys(q)) delete q[k];
    Object.assign(q, rebuilt);
  }
  perArea.push([area.id, n, doc.questions.length]);
  if (!dry) fs.writeFileSync(file, stringify(doc) + '\n');
}

for (const [id, n, total] of perArea) console.log(`${id.padEnd(22)} ${String(n).padStart(4)}/${total} Fragen mit eigener Fundstelle`);
console.log(`\n${set} Fundstellen gesetzt (${changed} neu oder geändert, ${cleared} entfernt)${dry ? ' – Probelauf, nichts geschrieben' : ''}.`);
