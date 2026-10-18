/**
 * Diktat über ElevenLabs Scribe.
 *
 * Der Client nimmt im Browser auf und schickt die Aufnahme als Rohdaten
 * (Content-Type audio/webm, audio/mp4 …). Der Server reicht sie an die
 * Speech-to-Text-API weiter und gibt nur den erkannten Text zurück.
 */

/**
 * Netlify nimmt höchstens 6 MB je Anfrage an, Binärdaten zählen dabei
 * base64-kodiert. 4 MB reichen mit Opus für weit über zehn Minuten Sprache.
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const DEFAULT_STT_MODEL = "scribe_v2";

/**
 * Fachbegriffe, auf die die Erkennung achten soll (Keyterm-Prompting, +20 %
 * auf den ohnehin geringen Preis). Höchstens fünf Wörter und 50 Zeichen je Begriff.
 * Vor allem Abkürzungen und Medikamentennamen, die ohne Hinweis falsch geschrieben würden.
 */
export const STT_KEYTERMS = [
  "Frühgeborenes", "Gestationsalter", "SSW", "SGA", "Perinatalzentrum", "QFR-RL", "Erstversorgung", "Reanimation", "Apgar", "Nabelschnur-pH", "Base Excess", "Laktat", "Pulsoxymetrie", "FiO2",
  "Atemnotsyndrom", "Surfactant", "LISA", "INSURE", "CPAP", "NIPPV", "HFOV", "PEEP", "Tidalvolumen", "Pneumothorax", "Mekoniumaspiration", "PPHN", "Lungenhypoplasie", "Zwerchfellhernie", "ECMO", "Stickstoffmonoxid",
  "bronchopulmonale Dysplasie", "BPD", "nekrotisierende Enterokolitis", "NEC", "Frühgeborenenretinopathie", "ROP", "intraventrikuläre Hämorrhagie", "IVH", "periventrikuläre Leukomalazie", "PVL",
  "hypoxisch-ischämische Enzephalopathie", "HIE", "therapeutische Hypothermie", "aEEG",
  "persistierender Ductus arteriosus", "PDA", "Fallot-Tetralogie", "Transposition der großen Arterien", "Prostaglandin E1", "Alprostadil", "Adrenalin",
  "Hypoglykämie", "Hyperbilirubinämie", "Bilirubin", "Fototherapie", "Austauschtransfusion", "Kernikterus", "Hydrops fetalis", "Hämatokrit", "Erythropoetin", "Vitamin K",
  "Neugeborenensepsis", "B-Streptokokken", "CRP", "Interleukin-6", "Ampicillin", "Gentamicin", "Cefotaxim", "CMV", "Toxoplasmose", "Listerien",
  "Koffeincitrat", "Indometacin", "Ibuprofen", "Morphin", "Fentanyl", "Midazolam", "Phenobarbital", "Dexamethason", "Hydrocortison",
  "Muttermilch", "Fortifier", "parenterale Ernährung", "Känguru-Pflege", "Gastroschisis", "Omphalozele", "Ösophagusatresie",
  "Neugeborenenscreening", "AGS", "Hypothyreose", "Galaktosämie", "Trisomie 21", "Mukoviszidose", "Kreatinin", "Kalium",
];

/** Liefert den Medientyp ohne Parameter, wenn er nach Audio oder Video aussieht, sonst null. */
export function audioMediaType(contentType: string | null): string | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return /^(audio|video)\/[a-z0-9.+-]+$/.test(type) ? type : null;
}

/** Liest die Aufnahme mit harter Obergrenze. */
export async function readAudioBody(req: Request, maxBytes: number): Promise<ArrayBuffer> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Aufnahme zu groß");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error("Aufnahme zu groß");
  if (!buf.byteLength) throw new Error("Aufnahme ist leer");
  return buf;
}

export type SttOptions = { apiKey: string; model?: string; keyterms?: boolean };

/** Baut den Aufruf an die ElevenLabs-API (POST /v1/speech-to-text, multipart). */
export function scribeRequest(audio: Blob, opts: SttOptions): { url: string; init: RequestInit } {
  const form = new FormData();
  form.append("model_id", opts.model || DEFAULT_STT_MODEL);
  form.append("language_code", "de");
  form.append("tag_audio_events", "false");
  if (opts.keyterms !== false) for (const term of STT_KEYTERMS) form.append("keyterms", term);
  const ext = audio.type.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "webm";
  form.append("file", audio, `antwort.${ext}`);
  return {
    url: "https://api.elevenlabs.io/v1/speech-to-text",
    init: { method: "POST", headers: { "xi-api-key": opts.apiKey }, body: form },
  };
}
