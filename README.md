# Neoquiz – Schwerpunkt Neonatologie (Landesärztekammer Hessen)

Lern-Quiz zur Vorbereitung auf die **Prüfung zum Schwerpunkt Neonatologie** (Facharzt/Fachärztin für Kinder- und Jugendmedizin mit Schwerpunkt Neonatologie) nach der **Weiterbildungsordnung für Ärztinnen und Ärzte in Hessen 2020** (WBO 2020, aktuelle Fassung gültig seit 1.1.2025). Aufgebaut nach dem Vorbild des Meisterquiz (`merlinste/meister`).

- **Prüfung:** mündlich, mindestens 30 Minuten, Ausschuss aus drei Ärztinnen/Ärzten, Ergebnis bestanden/nicht bestanden (§§ 12–16 WBO Hessen). Die Ansicht „Ordnung“ fasst Zulassung, Ablauf und die wörtlichen Weiterbildungsinhalte samt Richtzahlen zusammen (`data/pruefungsordnung.json`).
- **Fragen** in `data/questions/<gebiet>.json`, gegliedert in 27 Gebiete (`data/areas.json`) entlang der Weiterbildungsinhalte und der Kapitel der *Checkliste Neonatologie* (Genzel-Boroviczény/Nußbaum, Thieme, 8. Aufl. 2025, ISBN 978-3-13-245798-0). Jedes Gebiet ist den Kompetenzbereichen der WBO zugeordnet: **KM** (Kognitive und Methodenkompetenz) und **HK** (Handlungskompetenz).
- **Ablauf:** Frage → (Hinweise) → eigene Antwort → Musterantwort + Kernpunkte → KI-Bewertung durch Claude als Prüfer, mit Nachfrage → Selbsteinschätzung → Wiedervorlage nach Lernstand.
- **Aufgabentypen:** Freitext, Multiple Choice, Rechenaufgaben mit Endergebnis-Feld (Dosierungen, Perfusoren, Glukosezufuhr, parenterale und enterale Ernährung, Katheterlage) und Fallbesprechungen mit Teilaufgaben.
- **Prüfungssimulation:** „Prüfung“ startet ein mündliches Prüfungsgespräch (30 min) oder ein kurzes Fallgespräch (15 min) mit Claude als Prüfungsausschuss, mit Spracheingabe (de-DE) und Protokoll am Ende; die Lücken landen als fällige Fragen in der Wiedervorlage.
- **Diktat und Prüferstimme:** An jedem Antwortfeld lässt sich die Antwort einsprechen (🎤 Diktieren, ElevenLabs Scribe mit neonatologischen Fachbegriffen und Abkürzungen); im Prüfungsgespräch liest eine ElevenLabs-Stimme die Fragen vor. Ohne `ELEVENLABS_API_KEY` bleibt es bei Browser-Spracheingabe und -stimme.
- **Literatur:** Nach jeder Antwort zeigt „📖 Nachlesen“ das passende Kapitel der Checkliste und die einschlägige Leitlinie (`data/literature.json`, Register über `npm run lookups`).
- **Wiedervorlage:** FSRS (`ts-fsrs`) mit Karte je Frage, Tagesplan „Heute lernen“, Tagesquote auf den Prüfungstermin zurückgerechnet, gedeckelte Wiederholungen je Tagessitzung.
- **Fortschritt:** lokal im Browser und in Supabase (über einen Lerner-Code, siehe Einstellungen in der App).
- **Laufende Sitzung:** wird bei jedem Schritt im Browser gesichert (`public/lib/session.js`) – samt Antwortentwurf, Hinweisen, KI-Bewertung und Selbsteinschätzung der offenen Frage. Lädt die Seite neu (iOS verwirft Safari-Tabs im Hintergrund), geht es an derselben Stelle weiter; die Startseite bietet „Fortsetzen“ an.
- **Geräte verknüpfen:** Einstellungen → „Link teilen“ erzeugt `#/code/<Lerner-Code>`; auf dem anderen Gerät geöffnet, übernimmt es denselben Lerner-Code und Fortschritt.

> **Hinweis:** Lernhilfe, kein Nachschlagewerk für die Klinik. Dosierungen, Grenzwerte und Vorgehen vor jeder Anwendung gegen Fachinformation, aktuelle Leitlinien und lokale Standards prüfen.

## Struktur

```
data/areas.json              Gebiete, ID-Präfixe, Lernplan-Blöcke, Kapitel der Checkliste, Fundstellen
data/questions/*.json        Fragen je Gebiet (Format: docs/FRAGENFORMAT.md)
data/literature.json         Lernliteratur (Checkliste-Kapitel, Leitlinien) und Register Thema → Fundstelle
data/pruefungsordnung.json   WBO Hessen: Eckdaten, Prüfungsablauf, Weiterbildungsinhalte, Quellen
docs/FRAGENFORMAT.md         Spezifikation für neue Fragen
scripts/validate.mjs         prüft Fragen, Gebiete, Literatur und Prüfungsordnung
scripts/lookups.mjs          setzt die Fundstellen (lookup) aus data/literature.json an die Fragen
scripts/build.mjs            kopiert data/ nach public/data/, erzeugt index.json und catalog.json
public/                      Frontend ohne Build-Schritt (app.js, lib/, views/, vendor/ts-fsrs)
netlify/functions/           evaluate.mts, oral.mts, oral-protocol-background.mts, tts.mts (Prüferstimme), stt.mts (Diktat), health.mts
netlify/shared/              questions.mts (Fragenbestand im Function-Bundle), guard.mts, oral.mts, tts.mts und stt.mts (ElevenLabs-Aufrufe)
supabase/migrations/         Schema nq_* (Lerner, Versuche, FSRS-Karten)
```

## Entwicklung

```bash
npm install
npm run validate        # Fragen prüfen
npm run lookups         # Fundstellen aus data/literature.json neu setzen (--dry für einen Probelauf)
npm run build           # public/data/ erzeugen
npm test                # Unit-Tests
npx serve public        # statische Vorschau (ohne KI-Functions)
# mit Functions: netlify dev
```

Neues Gebiet: in `data/areas.json` eintragen (mit `prefix`), Datei `data/questions/<id>.json` anlegen und den Import in `netlify/shared/questions.mts` ergänzen (ein Test prüft das).

## Deployment (Netlify)

Eigene Netlify-Site, verbunden mit diesem Repository (Build: `npm run build`, Publish: `public`, Functions: `netlify/functions`).

| Variable | Zweck |
|---|---|
| `ANTHROPIC_API_KEY` | Pflicht für KI-Bewertung und Prüfungssimulation |
| `APP_PASSWORD` | **Pflicht.** Ohne gesetzten Zugangscode antworten `/api/evaluate` und `/api/oral` mit 503, ohne mitgeschickten Code mit 401. In der App unter Einstellungen eintragen. |
| `CLAUDE_MODEL` | optional, Standard `claude-opus-5-5` |
| `AI_RATE_LIMIT` | optional, KI-Bewertungen pro Stunde je Lerner-Code bzw. IP (Standard 60) |
| `ORAL_RATE_LIMIT` | optional, Gesprächszüge pro Stunde (Standard 90) |
| `ELEVENLABS_API_KEY` | optional, Prüferstimme im Prüfungsgespräch über ElevenLabs. Ohne Schlüssel liest der Browser mit seiner besten deutschen Stimme vor. |
| `ELEVENLABS_VOICE_ID` | optional, Stimme aus der ElevenLabs-Voice-Library (vorher zu „My Voices“ hinzufügen). Standard ist die fertige Stimme „George“; eine deutschsprachige Stimme klingt deutlich echter. |
| `ELEVENLABS_MODEL` | optional, Standard `eleven_v4_turbo` (Echtzeit, ca. 0,04 $ je 1000 Zeichen, ein 30-Minuten-Gespräch ≈ 6000 Zeichen) |
| `TTS_RATE_LIMIT` | optional, vorgelesene Prüferzüge pro Stunde (Standard 120) |
| `ELEVENLABS_STT_MODEL` | optional, Diktat-Modell, Standard `scribe_v2` (ca. 0,27 $ je Stunde Audio inklusive Fachbegriff-Liste). Das Diktat nutzt denselben `ELEVENLABS_API_KEY`. |
| `STT_RATE_LIMIT` | optional, Diktate pro Stunde (Standard 120) |

## Supabase

Projekt `picjzrcacaxlkojwaxol`, geteilt mit anderen Anwendungen (u. a. dem Meisterquiz mit `mq_*`). Dieses Quiz nutzt ausschließlich Tabellen und Funktionen mit dem Präfix `nq_`: `nq_learners`, `nq_attempts`, `nq_cards`. Die Tabellen haben RLS ohne Policies; der Zugriff läuft ausschließlich über SECURITY-DEFINER-Funktionen (`nq_touch_learner`, `nq_save_attempt`, `nq_save_card`, `nq_get_progress`, `nq_get_cards`, `nq_get_history`) mit dem Lerner-Code als Zugangsschlüssel. Migration `001_neoquiz_schema.sql` ist eingespielt (Oktober 2026).

## Quellen

- Landesärztekammer Hessen: Weiterbildungsordnung für Ärztinnen und Ärzte in Hessen 2020, aktuelle Fassung (Abschnitt A §§ 2–16, 20; Abschnitt B, Schwerpunkt Neonatologie), Seiten „Zulassung zur Prüfung“ und „eLogbuch“, Merkblatt zum Prüfungstag
- O. Genzel-Boroviczény, C. Nußbaum (Hrsg.): Checkliste Neonatologie, 8. Auflage, Thieme 2025 (Inhaltsverzeichnis als Gliederungsgrundlage)
- AWMF-Leitlinien der GNPI/DGPM/DGKJ, ERC/GRC-Leitlinien 2025, KRINKO- und STIKO-Empfehlungen, G-BA QFR-RL

Keine Gewähr für Vollständigkeit und Richtigkeit.
