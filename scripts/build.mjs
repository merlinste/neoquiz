#!/usr/bin/env node
// Kopiert data/ nach public/data/ und erzeugt public/data/index.json mit Zählern je Gebiet.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const src = path.join(root, 'data');
const dst = path.join(root, 'public', 'data');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.join(dst, 'questions'), { recursive: true });

// Bilder, falls einmal welche dazukommen, mit ausliefern.
const imgSrc = path.join(src, 'img');
if (fs.existsSync(imgSrc)) fs.cpSync(imgSrc, path.join(dst, 'img'), { recursive: true });

// Literaturregister und Prüfungsordnung unverändert mit ausliefern.
fs.copyFileSync(path.join(src, 'literature.json'), path.join(dst, 'literature.json'));
fs.copyFileSync(path.join(src, 'pruefungsordnung.json'), path.join(dst, 'pruefungsordnung.json'));

const areasDoc = JSON.parse(fs.readFileSync(path.join(src, 'areas.json'), 'utf8'));
const index = { generatedAt: new Date().toISOString(), exam: areasDoc.exam, blocks: areasDoc.blocks ?? {}, areas: [] };
// Schlanker Gesamtkatalog: reicht der Startseite für "Heute fällig" und der
// Sitzungsplanung, ohne alle Fragendateien zu laden.
const catalog = { generatedAt: index.generatedAt, questions: [] };
let total = 0;
for (const area of [...areasDoc.areas].sort((a, b) => a.order - b.order)) {
  const file = path.join(src, 'questions', `${area.id}.json`);
  let count = 0, types = { open: 0, mc: 0, calc: 0, case: 0 }, difficulty = { 1: 0, 2: 0, 3: 0 };
  if (fs.existsSync(file)) {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    count = doc.questions.length;
    for (const q of doc.questions) {
      types[q.type]++; difficulty[q.difficulty]++;
      catalog.questions.push({ id: q.id, a: area.id, t: q.type, d: q.difficulty, e: q.exam, b: area.block ?? null, ...(q.image ? { img: 1 } : {}), ...(q.parts ? { pts: q.parts.reduce((s, x) => s + x.points, 0) } : {}) });
    }
    fs.copyFileSync(file, path.join(dst, 'questions', `${area.id}.json`));
  }
  total += count;
  index.areas.push({ ...area, count, types, difficulty, available: count > 0 });
}
index.total = total;
catalog.total = total;
fs.writeFileSync(path.join(dst, 'index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(dst, 'catalog.json'), JSON.stringify(catalog));
console.log(`build: ${index.areas.filter(a => a.available).length}/${index.areas.length} Gebiete, ${total} Fragen → public/data/ (catalog.json ${Math.round(fs.statSync(path.join(dst, 'catalog.json')).size / 1024)} kB)`);
