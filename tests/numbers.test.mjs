// Zahlen-Parser für Rechenaufgaben: deutsches Zahlenformat, typografische
// Minuszeichen, Endergebnis aus dem Rechenweg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, findNumbers, extractFinalNumber, checkSolution } from '../public/lib/numbers.js';

test('deutsches Zahlenformat', () => {
  assert.equal(parseNumber('2.810,50 €'), 2810.5);
  assert.equal(parseNumber('1.000 kg'), 1000);
  assert.equal(parseNumber('0,25'), 0.25);
  assert.equal(parseNumber('26,1 l'), 26.1);
  assert.equal(parseNumber('12.345.678,9'), 12345678.9);
  // Punkt vor genau drei Ziffern ohne Komma dahinter ist ein Tausendertrenner …
  assert.equal(parseNumber('1.000'), 1000);
  // … sonst ein Dezimalpunkt (englische Eingabe).
  assert.equal(parseNumber('1.5'), 1.5);
  assert.equal(parseNumber('0.25'), 0.25);
});

test('Leerzeichen als Tausendertrenner', () => {
  assert.equal(parseNumber('2 810,5'), 2810.5);
  assert.equal(parseNumber('2 810,5'), 2810.5); // geschütztes Leerzeichen
  assert.equal(parseNumber('2 810,5'), 2810.5); // schmales geschütztes Leerzeichen
  // Ein Leerzeichen vor weniger als drei Ziffern trennt zwei Zahlen.
  assert.deepEqual(findNumbers('3 40'), [3, 40]);
});

test('typografische Minuszeichen', () => {
  assert.equal(parseNumber('−10 °C'), -10); // U+2212 Minus
  assert.equal(parseNumber('–10'), -10);    // U+2013 Gedankenstrich
  assert.equal(parseNumber('-10'), -10);
});

test('Exponentialschreibweise', () => {
  assert.equal(parseNumber('1,5e3'), 1500);
  assert.equal(parseNumber('1.5E-3'), 0.0015);
});

test('Endergebnis aus Rechenweg', () => {
  assert.equal(extractFinalNumber('COP = 3,2'), 3.2);
  assert.equal(extractFinalNumber('3 x 400 V → 6,9 kW'), 6.9);
  assert.equal(extractFinalNumber('Q0 = m · c · dT\n= 500 · 4,18 · 12\n= 25 080 kJ'), 25080);
  assert.equal(extractFinalNumber('Erst 12, dann 40.\nErgebnis: 2.810,50 €'), 2810.5);
  assert.equal(extractFinalNumber('kein Zahlenwert hier'), null);
  assert.equal(extractFinalNumber(''), null);
});

test('checkSolution wertet nur das Endergebnis, nicht jede Zahl im Rechenweg', () => {
  const solution = { value: 2810.5, unit: '€', tolerance: 0.03 };

  assert.equal(checkSolution(solution, { finalValue: '2.810,50 €' }), 'correct');
  assert.equal(checkSolution(solution, { finalValue: '2810,50' }), 'correct');
  assert.equal(checkSolution(solution, { finalValue: '2.500' }), 'wrong');
  assert.equal(checkSolution(solution, { finalValue: 'weiß nicht' }), 'unparsed');

  // Der Rechenweg enthält den richtigen Wert nur als Zwischenschritt – das
  // Endergebnis ist falsch und muss auch als falsch gewertet werden.
  assert.equal(
    checkSolution(solution, { finalValue: '', workings: 'Zwischenwert 2.810,50\nErgebnis = 1.900,00' }),
    'wrong',
  );
  // Ohne eigenes Feld greift der Fallback auf die Zahl nach dem letzten "=".
  assert.equal(checkSolution(solution, { finalValue: '', workings: 'Summe = 2.810,50 €' }), 'correct');

  assert.equal(checkSolution(null, { finalValue: '5' }), null);
});

test('Toleranz und Null als Lösung', () => {
  assert.equal(checkSolution({ value: 100, unit: 'kW', tolerance: 0.03 }, { finalValue: '102' }), 'correct');
  assert.equal(checkSolution({ value: 100, unit: 'kW', tolerance: 0.03 }, { finalValue: '104' }), 'wrong');
  // Eine Toleranz von 0 wird auf 0,5 % angehoben, damit Rundung nicht bestraft wird.
  assert.equal(checkSolution({ value: 100, unit: 'kW', tolerance: 0 }, { finalValue: '100,4' }), 'correct');
  assert.equal(checkSolution({ value: 0, unit: 'K', tolerance: 0.03 }, { finalValue: '0' }), 'correct');
  assert.equal(checkSolution({ value: 0, unit: 'K', tolerance: 0.03 }, { finalValue: '0,5' }), 'wrong');
});
