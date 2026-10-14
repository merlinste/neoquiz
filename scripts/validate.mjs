#!/usr/bin/env node
// Validiert data/questions/*.json gegen docs/FRAGENFORMAT.md sowie Gebiete, Literatur und Prüfungsordnung.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const areas = JSON.parse(fs.readFileSync(path.join(root, 'data/areas.json'), 'utf8'));
const areaIds = new Set(areas.areas.map(a => a.id));
const examIds = new Set(Object.keys(areas.exam));
// Nachschlagewerke – lookup.work muss auf eines davon zeigen.
const litDoc = JSON.parse(fs.readFileSync(path.join(root, 'data/literature.json'), 'utf8'));
const works = new Map((litDoc.works ?? []).map(w => [w.id, new Set((w.sections ?? []).map(s => s.key))]));

/**
 * Prüft ein `lookup` (Fundstellen in den zugelassenen Nachschlagewerken).
 * Gleiche Form an der Frage und am Themengebiet, deshalb eine gemeinsame Funktion.
 */
function checkLookup(list, report) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 3) { report('lookup: 1–3 Einträge erwartet'); return; }
  for (const l of list) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) { report('lookup: Eintrag muss ein Objekt sein'); continue; }
    for (const k of Object.keys(l)) if (!['work', 'where', 'terms', 'note'].includes(k)) report(`lookup: unbekanntes Feld "${k}"`);
    if (!works.has(l.work)) report(`lookup.work "${l.work}" gibt es in data/literature.json nicht`);
    if (l.where !== undefined && (typeof l.where !== 'string' || l.where.trim().length < 4)) report('lookup.where: zu kurz');
    if (!Array.isArray(l.terms) || l.terms.length < 1 || l.terms.length > 4 || l.terms.some(t => typeof t !== 'string' || t.trim().length < 2)) report('lookup.terms: 1–4 Suchbegriffe erwartet');
    if (l.note !== undefined && (typeof l.note !== 'string' || l.note.trim().length < 20)) report('lookup.note: mindestens 20 Zeichen');
  }
}
// Ohne Argumente wird der ganze Bestand geprüft; mit Argumenten nur die genannten
// Dateien. Querverweise über Dateigrenzen hinweg sind deshalb nur im vollen Lauf prüfbar.
const partial = process.argv.slice(2).length > 0;
const files = partial
  ? process.argv.slice(2)
  : fs.readdirSync(path.join(root, 'data/questions')).filter(f => f.endsWith('.json')).map(f => path.join(root, 'data/questions', f));

/** Aufgabentypen. calc wird über ein Endergebnis geprüft, case hat Teilaufgaben. */
const TYPES = ['open', 'mc', 'calc', 'case'];
const NEEDS_SOLUTION = new Set(['calc']);

let errors = 0, total = 0;
const globalIds = new Set();
const prefixes = new Map(areas.areas.map(a => [a.id, a.prefix]));
const err = (f, id, msg) => { errors++; console.error(`✗ ${path.basename(f)}${id ? ' [' + id + ']' : ''}: ${msg}`); };

for (const f of files) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { err(f, null, 'ungültiges JSON: ' + e.message); continue; }
  if (!areaIds.has(doc.area)) err(f, null, `unbekannte area "${doc.area}"`);
  if (!Array.isArray(doc.questions)) { err(f, null, '"questions" fehlt'); continue; }
  const localIds = new Set();
  const stats = {};
  for (const q of doc.questions) {
    total++;
    const id = q.id || '(ohne id)';
    if (!q.id || !/^[a-z]+-\d{3}$/.test(q.id)) err(f, id, 'id fehlt oder Format falsch (z. B. phys-001)');
    else if (prefixes.get(doc.area) && !q.id.startsWith(prefixes.get(doc.area) + '-')) err(f, id, `id muss mit "${prefixes.get(doc.area)}-" beginnen`);
    if (localIds.has(q.id)) err(f, id, 'doppelte id in Datei');
    if (globalIds.has(q.id)) err(f, id, 'id kollidiert mit anderer Datei');
    localIds.add(q.id); globalIds.add(q.id);
    if (!TYPES.includes(q.type)) err(f, id, `type ungültig (erlaubt: ${TYPES.join(', ')})`); else stats[q.type] = (stats[q.type] || 0) + 1;
    if (![1, 2, 3].includes(q.difficulty)) err(f, id, 'difficulty muss 1, 2 oder 3 sein');
    if (typeof q.question !== 'string' || q.question.trim().length < 15) err(f, id, 'question fehlt/zu kurz');
    if (!Array.isArray(q.hints) || q.hints.length < 1 || q.hints.length > 3 || q.hints.some(h => typeof h !== 'string' || !h.trim())) err(f, id, 'hints: 1–3 nicht-leere Strings');
    if (typeof q.answer !== 'string' || q.answer.trim().length < 20) err(f, id, 'answer fehlt/zu kurz');
    if (!Array.isArray(q.keyPoints) || q.keyPoints.length < 2 || q.keyPoints.length > 6) err(f, id, 'keyPoints: 2–6 Einträge');
    if (!Array.isArray(q.tags) || q.tags.length < 1 || q.tags.length > 4) err(f, id, 'tags: 1–4 Einträge');
    if (!Array.isArray(q.exam) || q.exam.length < 1 || q.exam.some(e => !examIds.has(e))) err(f, id, 'exam: nicht-leere Teilmenge der bekannten Prüfungsteile');
    if (q.type === 'mc') {
      if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 5) err(f, id, 'mc: 3–5 options');
      else {
        const correct = q.options.filter(o => o && o.correct === true).length;
        if (correct !== 1) err(f, id, `mc: genau eine richtige Option erwartet, gefunden ${correct}`);
        if (q.options.some(o => typeof o.text !== 'string' || !o.text.trim())) err(f, id, 'mc: option.text fehlt');
      }
    } else if (q.options) err(f, id, 'options nur bei mc');
    if (NEEDS_SOLUTION.has(q.type)) {
      const s = q.solution;
      if (!s || typeof s.value !== 'number' || !Number.isFinite(s.value)) err(f, id, `${q.type}: solution.value (Zahl) fehlt`);
      if (!s || typeof s.unit !== 'string') err(f, id, `${q.type}: solution.unit fehlt`);
      if (!s || typeof s.tolerance !== 'number' || s.tolerance < 0 || s.tolerance > 0.5) err(f, id, `${q.type}: solution.tolerance (0–0.5) fehlt`);
    } else if (q.solution) err(f, id, 'solution nur bei calc');

    // Großaufgabe mit Teilaufgaben
    if (q.type === 'case') {
      if (!Array.isArray(q.parts) || q.parts.length < 4 || q.parts.length > 8) err(f, id, 'case: 4–8 Teilaufgaben');
      else {
        const pids = new Set();
        for (const part of q.parts) {
          if (!part || typeof part.id !== 'string' || !/^[a-z]$/.test(part.id)) err(f, id, 'case: part.id ist ein Kleinbuchstabe a–z');
          else if (pids.has(part.id)) err(f, id, `case: doppelte part.id "${part.id}"`); else pids.add(part.id);
          if (!['open', 'calc'].includes(part.type)) err(f, id, `case ${part?.id}: type muss open oder calc sein`);
          if (typeof part.question !== 'string' || part.question.trim().length < 15) err(f, id, `case ${part?.id}: question fehlt/zu kurz`);
          if (typeof part.answer !== 'string' || part.answer.trim().length < 20) err(f, id, `case ${part?.id}: answer fehlt/zu kurz`);
          if (!Array.isArray(part.keyPoints) || part.keyPoints.length < 1) err(f, id, `case ${part?.id}: keyPoints fehlen`);
          if (typeof part.points !== 'number' || part.points < 1 || part.points > 30) err(f, id, `case ${part?.id}: points 1–30 erwartet`);
          if (part.type === 'calc') {
            const s = part.solution;
            if (!s || typeof s.value !== 'number' || typeof s.unit !== 'string' || typeof s.tolerance !== 'number') err(f, id, `case ${part?.id}: solution unvollständig`);
          } else if (part.solution) err(f, id, `case ${part?.id}: solution nur bei calc`);
        }
      }
    } else if (q.parts) err(f, id, 'parts nur bei case');
    // Fundstelle in der Lernliteratur (Checkliste, Leitlinien) – „wo lese ich das nach?".
    if (q.lookup !== undefined) checkLookup(q.lookup, (m) => err(f, id, m));
    if (q.source !== undefined && typeof q.source !== 'string') err(f, id, 'source muss String sein');
    const allowed = new Set(['id', 'type', 'difficulty', 'question', 'hints', 'answer', 'keyPoints', 'options', 'solution', 'tags', 'exam', 'source', 'parts', 'lookup']);
    for (const k of Object.keys(q)) if (!allowed.has(k)) err(f, id, `unbekanntes Feld "${k}"`);
  }
  const area = areas.areas.find(a => a.id === doc.area);
  const typeInfo = Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`${path.basename(f)}: ${doc.questions.length} Fragen (${typeInfo})${area ? `, Ziel ${area.target}` : ''}`);
}
/* ---------- Nachschlagewerke ---------- */
const lerr = (id, msg) => { errors++; console.error(`✗ literature.json${id ? ' [' + id + ']' : ''}: ${msg}`); };
if (!Array.isArray(litDoc.works) || !litDoc.works.length) lerr(null, 'works fehlt');
for (const w of litDoc.works ?? []) {
  const id = w.id || '(ohne id)';
  if (!w.id || !/^[a-z][a-z0-9-]*$/.test(w.id)) lerr(id, 'id fehlt oder Format falsch');
  for (const k of ['short', 'title', 'role', 'howTo']) if (typeof w[k] !== 'string' || w[k].trim().length < 5) lerr(id, `${k} fehlt/zu kurz`);
  if (!Array.isArray(w.sections) || !w.sections.length) lerr(id, 'sections fehlen');
  const keys = new Set();
  for (const sec of w.sections ?? []) {
    if (!sec?.key || !sec?.title || !sec?.about) lerr(id, 'section braucht key, title und about');
    else if (keys.has(sec.key)) lerr(id, `doppelter section-key "${sec.key}"`); else keys.add(sec.key);
  }
}
const regIds = new Set();
for (const r of litDoc.register ?? []) {
  const id = r.id || '(ohne id)';
  if (!r.id || !/^[a-z][a-z0-9-]*$/.test(r.id)) lerr(id, 'id fehlt oder Format falsch');
  if (regIds.has(r.id)) lerr(id, 'doppelte id'); else regIds.add(r.id);
  if (typeof r.title !== 'string' || r.title.trim().length < 5) lerr(id, 'title fehlt/zu kurz');
  if (!Array.isArray(r.match) || !r.match.length || r.match.some(m => typeof m !== 'string' || !m.trim())) lerr(id, 'match: nicht-leere Suchmuster erwartet');
  checkLookup(r.lookup, (m) => lerr(id, m));
  if (r.note !== undefined && (typeof r.note !== 'string' || r.note.trim().length < 20)) lerr(id, 'note zu kurz');
}
console.log(`literature.json: ${litDoc.works.length} Werke, ${(litDoc.register ?? []).length} Registereinträge`);

/* ---------- Themengebiete ---------- */
const aerr = (id, msg) => { errors++; console.error(`✗ areas.json [${id}]: ${msg}`); };
for (const a of areas.areas) {
  if (a.lookup !== undefined) checkLookup(a.lookup, (m) => aerr(a.id, m));
  else if (!partial) aerr(a.id, 'lookup fehlt – jedes Gebiet braucht eine Fundstelle');
  if (a.lookupNote !== undefined && (typeof a.lookupNote !== 'string' || a.lookupNote.trim().length < 20)) aerr(a.id, 'lookupNote zu kurz');
}

/* ---------- Prüfungsordnung ---------- */
const po = JSON.parse(fs.readFileSync(path.join(root, 'data/pruefungsordnung.json'), 'utf8'));
for (const g of po.contents ?? []) for (const it of g.items ?? []) {
  if (!['K', 'H'].includes(it.kind)) { errors++; console.error(`✗ pruefungsordnung.json: kind muss K oder H sein (${it.text})`); }
  for (const a of it.areas ?? []) if (!areaIds.has(a)) { errors++; console.error(`✗ pruefungsordnung.json: unbekanntes Gebiet "${a}"`); }
}

console.log(`\n${total} Fragen geprüft, ${errors} Fehler.`);
process.exit(errors ? 1 : 0);
