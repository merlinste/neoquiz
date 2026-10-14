# Fragenformat (Quiz Schwerpunkt Neonatologie, Landesärztekammer Hessen)

Jedes Themengebiet liegt als eigene Datei unter `data/questions/<area-id>.json`.
Die `area-id`, das ID-Präfix (`prefix`) und die Zielanzahl (`target`) stehen in `data/areas.json`.

## Dateistruktur

```json
{
  "area": "ikterus",
  "questions": [ { ...Frage... }, { ...Frage... } ]
}
```

## Frage-Objekt

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `id` | ja | `<prefix>-<3-stellige Nummer>`, z. B. `ikt-001`. Das Präfix steht in `data/areas.json` am Gebiet, nur Kleinbuchstaben. |
| `type` | ja | `open` (Freitext, wie im Fachgespräch), `mc` (Multiple Choice, genau eine richtige Option), `calc` (Rechenaufgabe mit Zahlenergebnis), `case` (Fallvignette mit Teilaufgaben). |
| `difficulty` | ja | `1` = Facharztwissen Kinder- und Jugendmedizin / Grundlagen, `2` = Schwerpunktniveau Standard, `3` = anspruchsvoll / Transfer / komplexe Fallsituation. |
| `question` | ja | Fragetext. Markdown erlaubt (Fett, Listen). Formeln als Klartext, z. B. `GIR = Glukose (mg/kg/min)`, `OI = MAP · FiO2 · 100 / paO2`. Keine LaTeX. Bei Fallbeispielen: Situation kurz schildern (Gestationsalter, Gewicht, Lebensalter, Befunde), dann konkrete Frage. |
| `hints` | ja | 1–3 Hinweise, gestaffelt: erster Hinweis nur ein Stupser, letzter fast die halbe Antwort. Verrät nie die vollständige Antwort. |
| `answer` | ja | Musterantwort, 2–8 Sätze, Markdown. Bei `calc`: vollständiger Rechenweg mit Formel, Einsetzen, Ergebnis mit Einheit. |
| `keyPoints` | ja | 2–6 Stichpunkte, die eine richtige Antwort enthalten muss (Bewertungsraster für die KI-Auswertung). Bei `mc` die Begründung der richtigen Option. |
| `options` | nur `mc` | 3–5 Objekte `{ "text": "...", "correct": true/false }`, genau eines `correct: true`. Distraktoren plausibel. |
| `solution` | nur `calc` | `{ "value": <Zahl>, "unit": "<Einheit>", "tolerance": <relative Toleranz, z. B. 0.03> }`. |
| `parts` | nur `case` | 4–8 Teilaufgaben `{ "id": "a", "type": "open"/"calc", "points": 1–30, "question", "answer", "keyPoints", "solution" (nur calc) }`. |
| `tags` | ja | 1–4 Schlagworte (Unterthema), z. B. `["Phototherapie", "Frühgeborene"]`. |
| `exam` | ja | Kompetenzbereich nach WBO: `KM` (Kognitive und Methodenkompetenz – Kenntnisse) und/oder `HK` (Handlungskompetenz – Erfahrungen und Fertigkeiten, also Vorgehen, Durchführung, Management). |
| `source` | nein | Kurzer Hinweis auf Leitlinie/Empfehlung, auf der die Antwort beruht, z. B. `"ERC-Leitlinien 2025, Newborn Life Support"`, `"AWMF S2k-Leitlinie Hyperbilirubinämie des Neugeborenen"`, `"KRINKO-Empfehlung Frühgeborene"`. Nur Titel, die es sicher gibt; Registernummern nur, wenn sicher bekannt. |
| `lookup` | nein | Fundstelle (Werk, Kapitel, Suchbegriffe) – wird über `npm run lookups` aus `data/literature.json` gesetzt, nicht von Hand. |

## Beispiele

```json
{
  "id": "ikt-001",
  "type": "open",
  "difficulty": 1,
  "question": "Nennen Sie die wichtigsten Ursachen eines **Ikterus in den ersten 24 Lebensstunden** und erklären Sie, warum er immer als pathologisch gilt.",
  "hints": ["Denken Sie an Hämolyse.", "Blutgruppenkonstellation von Mutter und Kind."],
  "answer": "Ein Ikterus innerhalb der ersten 24 Lebensstunden ist bis zum Beweis des Gegenteils hämolytisch bedingt und daher pathologisch. Häufigste Ursachen sind die Rhesus- und AB0-Inkompatibilität, seltener Erythrozytenmembrandefekte (Sphärozytose) oder Enzymdefekte (G6PD-Mangel), daneben Infektionen und ausgedehnte Hämatome. Diagnostik: Bilirubin, Blutgruppen von Mutter und Kind, direkter Coombs-Test, Blutbild mit Retikulozyten.",
  "keyPoints": ["Ikterus < 24 h immer pathologisch", "Hämolyse als Leitursache (Rh-, AB0-Inkompatibilität)", "Membran-/Enzymdefekte, Infektion", "Diagnostik: Bilirubin, Blutgruppen, Coombs-Test, Blutbild"],
  "tags": ["Ikterus praecox", "Hämolyse"],
  "exam": ["KM"]
}
```

```json
{
  "id": "flu-005",
  "type": "calc",
  "difficulty": 2,
  "question": "Ein Frühgeborenes mit 1200 g erhält 100 ml/kg/d Glukose 10 %. Wie hoch ist die Glukosezufuhrrate in mg/kg/min?",
  "hints": ["GIR = Glukose (mg/kg/d) / 1440", "10 % = 100 mg/ml"],
  "answer": "100 ml/kg/d · 100 mg/ml = 10 000 mg/kg/d. 10 000 / 1440 min ≈ **6,9 mg/kg/min**.",
  "keyPoints": ["Glukosemenge 10 000 mg/kg/d", "Division durch 1440 min/d", "Ergebnis ≈ 6,9 mg/kg/min"],
  "solution": { "value": 6.94, "unit": "mg/kg/min", "tolerance": 0.03 },
  "tags": ["Glukosezufuhr", "Berechnung"],
  "exam": ["HK"]
}
```

## Inhaltliche Leitlinien

- Zielgruppe: Kinder- und Jugendärztinnen und -ärzte vor der **Prüfung zum Schwerpunkt Neonatologie** bei der Landesärztekammer Hessen (Weiterbildungsordnung Hessen, Gebiet Kinder- und Jugendmedizin, Schwerpunkt Neonatologie). Die Prüfung ist ein **mündliches Fachgespräch** – deshalb überwiegen Freitextfragen, die man so auch im Gespräch beantworten würde.
- Bezugsrahmen Deutschland: AWMF-Leitlinien (GNPI, DGPM, DGKJ u. a.), ERC/GRC-Leitlinien zur Versorgung und Reanimation des Neugeborenen, KRINKO-Empfehlungen, G-BA-Richtlinien (QFR-RL, Kinder-Richtlinie), STIKO, Hämotherapie-Richtlinie. Lernbasis ist die *Checkliste Neonatologie* (Thieme, 8. Auflage).
- Sprache: Deutsch, ärztliche Fachsprache, Sie-Form in den Fragen.
- Mischung pro Gebiet: ca. 60–70 % `open`, 15–25 % `mc`, 5–15 % `calc` (Dosierungen, Infusionsregime, Glukosezufuhr, Tubusgröße und Einführtiefe, Katheterlage, Oxygenierungsindex, Austauschvolumen). Das Gebiet `faelle` besteht aus `case`-Aufgaben.
- Schwierigkeitsverteilung grob: 25 % Stufe 1, 50 % Stufe 2, 25 % Stufe 3.
- Fallbeispiele („Sie werden in den Kreißsaal gerufen …“, „Ein Frühgeborenes der 26+3 SSW zeigt am 9. Lebenstag …“) sind erwünscht.
- **Fachliche Richtigkeit hat Vorrang vor Anzahl.** Lieber eine Frage weglassen als eine unsichere Antwort behaupten. Keine erfundenen Grenzwerte, Dosierungen oder Leitlinienzitate. Bei Dosierungen nur etablierte Standarddosen; die App weist darauf hin, dass Dosierungen vor Anwendung gegen aktuelle Fachinformation und lokale Standards zu prüfen sind.
- Wo Leitlinien sich jüngst geändert haben oder Zentren unterschiedlich vorgehen, das in der Antwort benennen („je nach Zentrum“, „laut aktueller Leitlinie“).
- Keine doppelten Fragen; Fragen sollen das Gebiet systematisch abdecken (vom Grundbegriff bis zur Anwendung).
- Zahlen im deutschen Format im Text (Komma als Dezimaltrennzeichen), im Feld `solution.value` jedoch als JSON-Zahl mit Punkt.
