// Wiedervorlage nach Lernstand: Notenabbildung, Intervalle, Fälligkeit, Prognose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Rating, State, ratingFor, review, previewIntervals, emptyCard, deserialize,
  isDue, isNew, isMature, isWeak, isShaky, forecast, newPerDay, daysUntil, interleave, MIN_DAYS,
} from '../public/lib/cards.js';

const NOW = new Date('2026-09-10T08:00:00Z');
const EXAM = '2027-04-01';

test('Bewertung auf FSRS-Note abbilden', () => {
  // Selbsteinschätzung 0–3
  assert.equal(ratingFor({ selfScore: 0 }).rating, Rating.Again);
  assert.equal(ratingFor({ selfScore: 1 }).rating, Rating.Hard);
  assert.equal(ratingFor({ selfScore: 2 }).rating, Rating.Good);
  assert.equal(ratingFor({ selfScore: 3 }).rating, Rating.Easy);

  // mc und calc mit Endergebnis werden automatisch bewertet
  assert.equal(ratingFor({ auto: 'correct' }).rating, Rating.Good);
  assert.equal(ratingFor({ auto: 'wrong' }).rating, Rating.Again);

  // Starke Abweichung der KI stuft herab und meldet das
  const low = ratingFor({ selfScore: 2, aiScore: 40 });
  assert.equal(low.rating, Rating.Hard);
  assert.equal(low.downgraded, true);
  assert.equal(ratingFor({ selfScore: 3, aiScore: 30 }).rating, Rating.Hard);
  // Eine passende KI-Wertung ändert nichts
  assert.equal(ratingFor({ selfScore: 2, aiScore: 85 }).rating, Rating.Good);
  assert.equal(ratingFor({ selfScore: 2, aiScore: 85 }).downgraded, false);

  // Eine schlechtere eigene Einschätzung schlägt das automatische Ergebnis
  assert.equal(ratingFor({ auto: 'correct', selfScore: 0, selfByUser: true }).rating, Rating.Again);
  // Ohne eigene Wahl bleibt es beim automatischen Ergebnis
  assert.equal(ratingFor({ auto: 'correct', selfScore: 0, selfByUser: false }).rating, Rating.Good);
});

test('eine als gewusst markierte Frage kommt nach dem berechneten Intervall wieder', () => {
  let card = emptyCard(NOW);
  assert.equal(isNew(card), true);

  // Erste Runde: gewusst
  const r1 = review(card, Rating.Good, { now: NOW, examDate: EXAM });
  card = r1.card;
  assert.equal(isNew(card), false);
  assert.equal(card.reps, 1);
  assert.ok(new Date(card.due) > NOW, 'die Karte ist nach der Antwort nicht mehr sofort fällig');

  // Genau am Fälligkeitstag ist sie wieder dran, vorher nicht.
  const due = new Date(card.due);
  assert.equal(isDue(card, new Date(due.getTime() - 60_000)), false);
  assert.equal(isDue(card, due), true);

  // Zweite und dritte Runde verlängern das Intervall deutlich.
  const r2 = review(card, Rating.Good, { now: due, examDate: EXAM });
  const r3 = review(r2.card, Rating.Good, { now: new Date(r2.card.due), examDate: EXAM });
  assert.ok(r3.intervalDays > r2.intervalDays, `Intervall wächst: ${r2.intervalDays} → ${r3.intervalDays}`);
  assert.ok(r3.card.stability > r2.card.stability);
});

test('Again setzt zurück und zählt einen Lapse', () => {
  let card = review(emptyCard(NOW), Rating.Good, { now: NOW, examDate: EXAM }).card;
  card = review(card, Rating.Good, { now: new Date(card.due), examDate: EXAM }).card;
  const before = card.stability;
  const after = review(card, Rating.Again, { now: new Date(card.due), examDate: EXAM }).card;
  assert.equal(after.lapses, 1);
  assert.ok(after.stability < before);
  // Ohne Lernschritte bleibt die Karte im Wiederholungszustand, statt in eine
  // Minuten-Schleife (Relearning) zu fallen.
  assert.equal(after.state, State.Review);
});

test('ohne Lernschritte wird schon die erste Antwort in Tagen geplant', () => {
  // Sonst käme jede neue Frage nach zehn Minuten zurück und stünde am
  // Folgetag als fällige Wiederholung im Stapel.
  for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    const { card, intervalDays } = review(emptyCard(NOW), rating, { now: NOW, examDate: EXAM });
    assert.ok(intervalDays >= 1, `Note ${rating}: ${intervalDays} Tage`);
    assert.equal(card.state, State.Review);
  }
});

test('die erste Antwort bestimmt den Mindestabstand', () => {
  for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    const { card, intervalDays } = review(emptyCard(NOW), rating, { now: NOW, examDate: EXAM });
    assert.equal(intervalDays, MIN_DAYS[rating], `Note ${rating}`);
    // Die Stabilität zieht mit, sonst gälte die Karte trotz des langen
    // Abstands weiter als wackelig.
    assert.ok(card.stability >= MIN_DAYS[rating], `Stabilität ${card.stability} < ${MIN_DAYS[rating]}`);
  }
  // Die Reihenfolge stimmt: schlechter beantwortet heißt früher wieder dran.
  assert.ok(MIN_DAYS[Rating.Again] < MIN_DAYS[Rating.Hard]);
  assert.ok(MIN_DAYS[Rating.Hard] < MIN_DAYS[Rating.Good]);
  assert.ok(MIN_DAYS[Rating.Good] < MIN_DAYS[Rating.Easy]);
});

test('der Mindestabstand ist eine Untergrenze, keine Obergrenze', () => {
  // Was schon zweimal saß, plant FSRS von sich aus weiter als 45 Tage –
  // daran ändert die Untergrenze nichts.
  let card = review(emptyCard(NOW), Rating.Good, { now: NOW, examDate: EXAM }).card;
  const second = review(card, Rating.Good, { now: new Date(card.due), examDate: EXAM });
  assert.ok(second.intervalDays > MIN_DAYS[Rating.Good], `${second.intervalDays} Tage`);
});

test('der Mindestabstand endet am Prüfungstermin', () => {
  // Zehn Tage vor der Prüfung bringt ein Abstand von 45 Tagen nichts mehr.
  const soon = '2026-09-20';
  const { intervalDays } = review(emptyCard(NOW), Rating.Good, { now: NOW, examDate: soon });
  assert.ok(intervalDays <= daysUntil(soon, NOW), `${intervalDays} Tage bis ${soon}`);
});

test('Vorschau zeigt dieselben Abstände wie die Bewertung', () => {
  const p = previewIntervals(emptyCard(NOW), { now: NOW, examDate: EXAM });
  for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    assert.equal(p[rating], MIN_DAYS[rating], `Note ${rating}`);
  }
});

test('Wiederholungen werden gleichmäßig unter die neuen Fragen gestreut', () => {
  const fresh = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'];
  const reviews = ['w1', 'w2', 'w3'];
  const mixed = interleave(fresh, reviews);
  assert.equal(mixed.length, 9);
  assert.deepEqual(mixed.filter((x) => x.startsWith('n')), fresh, 'Reihenfolge der neuen Fragen bleibt');
  assert.deepEqual(mixed.filter((x) => x.startsWith('w')), reviews, 'Reihenfolge der Wiederholungen bleibt');
  assert.deepEqual(mixed, ['n1', 'n2', 'w1', 'n3', 'n4', 'w2', 'n5', 'n6', 'w3']);

  // Fehlt eine der beiden Listen, bleibt die andere unverändert.
  assert.deepEqual(interleave(fresh, []), fresh);
  assert.deepEqual(interleave([], reviews), reviews);
  // Mehr Wiederholungen als neue Fragen gehen trotzdem alle mit.
  assert.equal(interleave(['n1'], reviews).length, 4);
});

test('Vorschau liefert für alle vier Noten ein Intervall in aufsteigender Reihenfolge', () => {
  const card = review(emptyCard(NOW), Rating.Good, { now: NOW, examDate: EXAM }).card;
  const p = previewIntervals(card, { now: new Date(card.due), examDate: EXAM });
  assert.ok(p[Rating.Again] <= p[Rating.Hard]);
  assert.ok(p[Rating.Hard] <= p[Rating.Good]);
  assert.ok(p[Rating.Good] <= p[Rating.Easy]);
});

test('Intervalle werden nicht über den Prüfungstermin hinaus geplant', () => {
  let card = emptyCard(NOW);
  for (let i = 0; i < 8; i++) {
    const at = i === 0 ? NOW : new Date(card.due);
    card = review(card, Rating.Easy, { now: at, examDate: EXAM }).card;
  }
  assert.ok(card.scheduled_days <= daysUntil(EXAM, NOW) + 1, `Intervall ${card.scheduled_days} Tage`);
});

test('Reife und Prognose', () => {
  // Einmal gewusst ist noch nicht reif, auch wenn der Abstand schon 45 Tage
  // beträgt – erst die gehaltene Wiederholung zählt.
  const fresh = review(emptyCard(NOW), Rating.Good, { now: NOW, examDate: EXAM }).card;
  assert.equal(isMature(fresh), false);
  assert.equal(isWeak(fresh), false, 'gewusst heißt nicht wackelig');
  const held = review(fresh, Rating.Good, { now: new Date(fresh.due), examDate: EXAM }).card;
  assert.equal(isMature(held), true);

  // Teilweise gewusst wackelt, nicht gewusst gilt als unsicher.
  const partly = review(emptyCard(NOW), Rating.Hard, { now: NOW, examDate: EXAM }).card;
  assert.equal(isWeak(partly), true);
  assert.equal(isShaky(partly), false);
  const missed = review(emptyCard(NOW), Rating.Again, { now: NOW, examDate: EXAM }).card;
  assert.equal(isShaky(missed), true);
  // Eine noch nie beantwortete Frage ist weder das eine noch das andere.
  assert.equal(isWeak(emptyCard(NOW)), false);
  assert.equal(isShaky(emptyCard(NOW)), false);

  const cards = {
    a: { ...fresh, due: new Date(NOW.getTime() - 86400000).toISOString(), reps: 1 },   // überfällig
    b: { ...fresh, due: new Date(NOW.getTime() + 2 * 86400000).toISOString(), reps: 1 },
    c: { ...fresh, due: new Date(NOW.getTime() + 40 * 86400000).toISOString(), reps: 1 },
    d: emptyCard(NOW), // neu, zählt nicht als Wiederholung
  };
  const f = forecast(cards, 14, NOW);
  assert.equal(f.length, 14);
  assert.equal(f[0].count, 1, 'überfällige Karten zählen zu heute');
  assert.equal(f[2].count, 1);
  assert.equal(f.reduce((s, x) => s + x.count, 0), 2, 'die Karte in 40 Tagen liegt außerhalb des Fensters');
});

test('Tagesquote rechnet rückwärts auf den Prüfungstermin', () => {
  // Viel Zeit: die eingestellte Quote bleibt.
  assert.equal(newPerDay({ remainingNew: 1000, examDate: EXAM, configured: 15, now: NOW }), 15);
  // Wenig Zeit: die Quote steigt, damit der Bestand durchkommt.
  assert.equal(newPerDay({ remainingNew: 200, examDate: '2026-09-20', configured: 15, now: NOW }), 20);
  // Termin erreicht: alles offene auf einmal.
  assert.equal(newPerDay({ remainingNew: 7, examDate: '2026-09-10', configured: 15, now: NOW }), 7);
});

test('Serialisierung überlebt localStorage', () => {
  const card = review(emptyCard(NOW), Rating.Hard, { now: NOW, examDate: EXAM }).card;
  const back = deserialize(JSON.parse(JSON.stringify(card)));
  assert.ok(back.due instanceof Date);
  assert.equal(back.reps, card.reps);
  assert.equal(back.stability, card.stability);
});
