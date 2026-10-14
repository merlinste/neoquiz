// Serverseitiger Fragenbestand für /api/evaluate und /api/oral.
// Die Fragetexte und Musterantworten kommen ausschließlich von hier, nie vom Client:
// so lässt sich über die API kein frei gewählter Prompt an Claude schicken.
// Die JSON-Dateien werden von esbuild mit in das Function-Bundle gepackt.
import areasDoc from "../../data/areas.json" with { type: "json" };
import q_perinatalmedizin from "../../data/questions/perinatalmedizin.json" with { type: "json" };
import q_erstversorgung from "../../data/questions/erstversorgung.json" with { type: "json" };
import q_adaptation from "../../data/questions/adaptation.json" with { type: "json" };
import q_atemstoerungen from "../../data/questions/atemstoerungen.json" with { type: "json" };
import q_beatmung from "../../data/questions/beatmung.json" with { type: "json" };
import q_lungenerkrankungen from "../../data/questions/lungenerkrankungen.json" with { type: "json" };
import q_kreislauf from "../../data/questions/kreislauf.json" with { type: "json" };
import q_herzfehler from "../../data/questions/herzfehler.json" with { type: "json" };
import q_infektionen from "../../data/questions/infektionen.json" with { type: "json" };
import q_hygiene from "../../data/questions/hygiene.json" with { type: "json" };
import q_ikterus from "../../data/questions/ikterus.json" with { type: "json" };
import q_haematologie from "../../data/questions/haematologie.json" with { type: "json" };
import q_stoffwechsel from "../../data/questions/stoffwechsel.json" with { type: "json" };
import q_endokrinologie from "../../data/questions/endokrinologie.json" with { type: "json" };
import q_fluessigkeit from "../../data/questions/fluessigkeit.json" with { type: "json" };
import q_ernaehrung from "../../data/questions/ernaehrung.json" with { type: "json" };
import q_neurologie from "../../data/questions/neurologie.json" with { type: "json" };
import q_fruehgeborenenhirn from "../../data/questions/fruehgeborenenhirn.json" with { type: "json" };
import q_gastroenterologie from "../../data/questions/gastroenterologie.json" with { type: "json" };
import q_niere from "../../data/questions/niere.json" with { type: "json" };
import q_sinnesorgane from "../../data/questions/sinnesorgane.json" with { type: "json" };
import q_genetik from "../../data/questions/genetik.json" with { type: "json" };
import q_pharmakologie from "../../data/questions/pharmakologie.json" with { type: "json" };
import q_techniken from "../../data/questions/techniken.json" with { type: "json" };
import q_nachsorge from "../../data/questions/nachsorge.json" with { type: "json" };
import q_ethik from "../../data/questions/ethik.json" with { type: "json" };
import q_faelle from "../../data/questions/faelle.json" with { type: "json" };

const DOCS = [q_perinatalmedizin, q_erstversorgung, q_adaptation, q_atemstoerungen, q_beatmung, q_lungenerkrankungen, q_kreislauf, q_herzfehler, q_infektionen, q_hygiene, q_ikterus, q_haematologie, q_stoffwechsel, q_endokrinologie, q_fluessigkeit, q_ernaehrung, q_neurologie, q_fruehgeborenenhirn, q_gastroenterologie, q_niere, q_sinnesorgane, q_genetik, q_pharmakologie, q_techniken, q_nachsorge, q_ethik, q_faelle] as const;

export type QuestionOption = { text: string; correct?: boolean };
export type QuestionSolution = { value: number; unit: string; tolerance: number };
export type Question = {
  id: string;
  type: "open" | "mc" | "calc" | "case";
  difficulty: 1 | 2 | 3;
  question: string;
  hints: string[];
  answer: string;
  keyPoints: string[];
  options?: QuestionOption[];
  solution?: QuestionSolution;
  tags: string[];
  exam: string[];
  source?: string;
  /** Fundstelle in der Lernliteratur (data/literature.json). */
  lookup?: { work: string; where?: string; terms: string[]; note?: string }[];
  /** Teilaufgaben einer Fallbesprechung (Typ case). */
  parts?: { id: string; type: "open" | "calc"; points: number; question: string; answer: string; keyPoints: string[]; solution?: QuestionSolution }[];
  /** Gebiets-ID, aus der Datei ergänzt. */
  area: string;
  /** Klartextname des Gebiets, aus areas.json ergänzt. */
  areaTitle: string;
};

const AREA_TITLES = new Map<string, string>(
  (areasDoc as { areas: { id: string; title: string }[] }).areas.map((a) => [a.id, a.title]),
);

/** id → Frage. Einmal beim Laden des Moduls gebaut. */
export const QUESTIONS: ReadonlyMap<string, Question> = (() => {
  const map = new Map<string, Question>();
  for (const doc of DOCS as readonly { area: string; questions: unknown[] }[]) {
    for (const raw of doc.questions) {
      const q = raw as Question;
      map.set(q.id, { ...q, area: doc.area, areaTitle: AREA_TITLES.get(doc.area) ?? doc.area });
    }
  }
  return map;
})();

export const getQuestion = (id: string): Question | undefined => QUESTIONS.get(id);

/** Alle Fragen zu einem Kompetenzbereich (KM, HK). */
export const questionsForExam = (exam: string): Question[] =>
  [...QUESTIONS.values()].filter((q) => q.exam.includes(exam));

export const EXAM_TITLES = (areasDoc as { exam: Record<string, string> }).exam;
