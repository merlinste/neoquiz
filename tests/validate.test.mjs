import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const run = (files) => spawnSync(process.execPath, [path.join(root, 'scripts/validate.mjs'), ...files], { encoding: 'utf8' });

const good = {
  area: 'ikterus',
  questions: [
    { id: 'ikt-901', type: 'open', difficulty: 1, question: 'Warum ist ein Ikterus in den ersten 24 Lebensstunden pathologisch?', hints: ['Hämolyse'], answer: 'Ein Ikterus in den ersten 24 Lebensstunden ist bis zum Beweis des Gegenteils hämolytisch bedingt.', keyPoints: ['Hämolyse', 'Blutgruppeninkompatibilität'], tags: ['Ikterus praecox'], exam: ['KM'] },
    { id: 'ikt-902', type: 'mc', difficulty: 2, question: 'Welcher Test weist eine Antikörperbeladung der kindlichen Erythrozyten nach?', hints: ['Coombs'], answer: 'Der direkte Coombs-Test weist an Erythrozyten gebundene Antikörper nach.', keyPoints: ['direkter Coombs-Test', 'gebundene Antikörper'], options: [{ text: 'Direkter Coombs-Test', correct: true }, { text: 'Indirekter Coombs-Test', correct: false }, { text: 'Retikulozytenzahl', correct: false }], tags: ['Hämolyse'], exam: ['KM'] },
    { id: 'ikt-903', type: 'calc', difficulty: 2, question: 'Wie groß ist das Volumen einer doppelten Austauschtransfusion bei 3 kg und 85 ml/kg Blutvolumen?', hints: ['2 × Blutvolumen'], answer: '2 · 85 ml/kg · 3 kg = 510 ml.', keyPoints: ['2 × Blutvolumen', '510 ml'], solution: { value: 510, unit: 'ml', tolerance: 0.02 }, tags: ['Austauschtransfusion'], exam: ['HK'] },
  ],
};

test('gültige Datei wird akzeptiert', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nq-')), 'ok.json');
  fs.writeFileSync(f, JSON.stringify(good));
  const r = run([f]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test('Fehler werden erkannt (mc ohne richtige Option, calc ohne solution, doppelte id)', () => {
  const bad = structuredClone(good);
  bad.questions[1].options.forEach((o) => (o.correct = false));
  delete bad.questions[2].solution;
  bad.questions[0].id = 'ikt-902';
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nq-')), 'bad.json');
  fs.writeFileSync(f, JSON.stringify(bad));
  const r = run([f]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /genau eine richtige Option/);
  assert.match(r.stderr, /solution\.value/);
  assert.match(r.stderr, /doppelte id/);
});

test('alle Fragen-Dateien im Repo sind gültig', () => {
  const r = run([]);
  assert.equal(r.status, 0, r.stderr);
});

test('ID-Präfix muss zum Gebiet passen, Altfelder werden abgelehnt', () => {
  const bad = structuredClone(good);
  bad.questions[0].id = 'phys-901';
  bad.questions[1].calcTip = { text: 'Ein ausreichend langer Hinweistext.' };
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nq-')), 'prefix.json');
  fs.writeFileSync(f, JSON.stringify(bad));
  const r = run([f]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /id muss mit "ikt-" beginnen/);
  assert.match(r.stderr, /unbekanntes Feld "calcTip"/);
});

test('case: Teilaufgaben werden geprüft', () => {
  const doc = structuredClone(good);
  doc.questions.push({ id: 'ikt-904', type: 'case', difficulty: 3, question: 'Fall: Reifgeborenes mit Ikterus am ersten Lebenstag.', hints: ['Hämolyse'], answer: 'Hämolyse abklären und Phototherapie nach Grenzwert.', keyPoints: ['Hämolyse', 'Phototherapie'], tags: ['Fall'], exam: ['HK'],
    parts: [{ id: 'a', type: 'open', points: 5, question: 'Was ist Ihre Verdachtsdiagnose?', answer: 'Hämolytischer Ikterus bei Blutgruppeninkompatibilität.', keyPoints: ['Hämolyse'] }] });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nq-')), 'case.json');
  fs.writeFileSync(f, JSON.stringify(doc));
  const r = run([f]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /case: 4–8 Teilaufgaben/);
});

test('lookup wird geprüft: unbekanntes Werk und fehlende Suchbegriffe', () => {
  const bad = structuredClone(good);
  bad.questions[0].lookup = [{ work: 'gibtsnicht', where: 'Kap. 13', terms: ['Ikterus'] }];
  bad.questions[1].lookup = [{ work: 'checkliste', terms: [] }];
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nq-')), 'lookup.json');
  fs.writeFileSync(f, JSON.stringify(bad));
  const r = run([f]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lookup\.work "gibtsnicht"/);
  assert.match(r.stderr, /lookup\.terms/);
});

test('gültiges lookup wird akzeptiert', () => {
  const ok = structuredClone(good);
  ok.questions[0].lookup = [{ work: 'checkliste', where: 'Kap. 13.1 – Icterus neonatorum', terms: ['Ikterus'] }];
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nq-')), 'lookup-ok.json');
  fs.writeFileSync(f, JSON.stringify(ok));
  const r = run([f]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

// Die Netlify-Functions bündeln die Fragendateien über feste Importe. Wird ein
// Gebiet ergänzt und der Import vergessen, findet /api/evaluate seine Fragen
// nicht mehr – deshalb wird der Abgleich hier geprüft.
test('jedes Gebiet mit Fragen ist im Function-Bundle registriert', () => {
  const areas = JSON.parse(fs.readFileSync(path.join(root, 'data/areas.json'), 'utf8'));
  const src = fs.readFileSync(path.join(root, 'netlify/shared/questions.mts'), 'utf8');
  const missing = areas.areas
    .filter((a) => fs.existsSync(path.join(root, 'data/questions', `${a.id}.json`)))
    .filter((a) => !src.includes(`data/questions/${a.id}.json`));
  assert.deepEqual(missing.map((a) => a.id), [], 'Import in netlify/shared/questions.mts fehlt');
});

// Ohne Fundstelle am Gebiet hätte eine Frage ohne eigenes lookup keinen Hinweis,
// wo man das Thema nachliest.
test('jedes Gebiet hat eine Fundstelle in der Lernliteratur', () => {
  const areas = JSON.parse(fs.readFileSync(path.join(root, 'data/areas.json'), 'utf8'));
  const lit = JSON.parse(fs.readFileSync(path.join(root, 'data/literature.json'), 'utf8'));
  const works = new Set(lit.works.map((w) => w.id));
  for (const a of areas.areas) {
    assert.ok(Array.isArray(a.lookup) && a.lookup.length, `${a.id}: lookup fehlt`);
    for (const l of a.lookup) assert.ok(works.has(l.work), `${a.id}: unbekanntes Werk ${l.work}`);
  }
});
