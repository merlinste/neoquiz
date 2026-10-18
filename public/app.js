/* Neoquiz – Schwerpunkt Neonatologie (LÄK Hessen) – Frontend (ES-Module, ohne Build-Schritt) */
import { checkSolution, parseNumber, extractFinalNumber } from "./lib/numbers.js";
import * as SR from "./lib/cards.js";
import { createOralView } from "./views/oral.js";
import { createLiteratureView, lookupHtml } from "./views/literature.js";

const CFG = window.NQ_CONFIG || {};
const $app = document.getElementById("app");
const $status = document.getElementById("status");

/* ---------- Hilfsfunktionen ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–");
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const randomCode = () => { const b = new Uint8Array(20); crypto.getRandomValues(b); return Array.from(b, (x) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[x % 57]).join(""); };

/** Tage → kurze Intervallangabe für die Bewertungsknöpfe. */
const fmtInterval = (days) => {
  if (days == null) return "";
  if (days < 1) return "< 1 Tag";
  if (days === 1) return "1 Tag";
  if (days < 30) return `${days} Tage`;
  if (days < 365) return `${Math.round(days / 30)} Mon.`;
  return `${(days / 365).toFixed(1)} Jahre`;
};

/** Sehr kleiner Markdown-Renderer: **fett**, *kursiv*, `code`, Listen (- / 1.), Absätze. */
function md(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let html = "", list = null, para = [];
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
  const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    const ul = /^[-•*]\s+(.*)/.exec(line), ol = /^\d+[.)]\s+(.*)/.exec(line);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (list !== type) { flushList(); list = type; html += `<${type}>`; }
      html += `<li>${inline((ul || ol)[1])}</li>`;
    } else if (!line) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return `<div class="md">${html}</div>`;
}

/* ---------- Lokaler Zustand ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem("nq:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("nq:" + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const settings = Object.assign({
  learnerCode: null, name: "", ai: true, appKey: "", showHintsFirst: false,
  examDate: SR.DEFAULT_EXAM_DATE, newPerDay: SR.DEFAULT_NEW_PER_DAY,
  reviewsPerDay: SR.DEFAULT_REVIEWS_PER_DAY,
  modules: [], // Kompetenzbereiche KM/HK nach WBO, leer = alle
  blocks: [],  // Lernplan-Blöcke A … F, leer = alle
}, LS.get("settings", {}));
if (!settings.learnerCode) { settings.learnerCode = randomCode(); LS.set("settings", settings); }
const saveSettings = () => LS.set("settings", settings);

let progress = LS.get("progress", {}); // question_id -> {attempts,lastSelf,lastAi,bestSelf,bestAi,lastAt,area}
const saveProgress = () => LS.set("progress", progress);

/** FSRS-Karten: question_id -> serialisierte Karte plus updatedAt. */
let cards = LS.get("cards", {});
const saveCards = () => LS.set("cards", cards);

const state = { index: null, catalog: null, questions: {}, health: null, session: null };

/* ---------- Supabase (nur RPC) ---------- */
const sb = {
  ok: Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey),
  async rpc(fn, args) {
    if (!this.ok) throw new Error("Supabase nicht konfiguriert");
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: CFG.supabaseAnonKey, Authorization: `Bearer ${CFG.supabaseAnonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`Supabase ${fn}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  },
};
function setStatus(cls, title) { $status.className = "status " + cls; $status.title = title; }

async function syncFromCloud() {
  if (!sb.ok) { setStatus("", "Kein Cloud-Sync konfiguriert"); return; }
  setStatus("busy", "Synchronisiere …");
  try {
    await sb.rpc("nq_touch_learner", { p_code: settings.learnerCode, p_name: settings.name || null });
    const rows = await sb.rpc("nq_get_progress", { p_code: settings.learnerCode });
    for (const r of rows || []) {
      const local = progress[r.question_id];
      const cloud = { attempts: Number(r.attempts), lastSelf: r.last_self_score, lastAi: r.last_ai_score, bestSelf: r.best_self_score, bestAi: r.best_ai_score, lastAt: r.last_at, area: r.area_id };
      if (!local || new Date(cloud.lastAt) >= new Date(local.lastAt || 0)) progress[r.question_id] = { ...local, ...cloud, attempts: Math.max(cloud.attempts, local?.attempts || 0) };
    }
    saveProgress();

    const cardRows = await sb.rpc("nq_get_cards", { p_code: settings.learnerCode }).catch((e) => { console.warn("nq_get_cards", e); return null; });
    for (const r of cardRows || []) {
      const cloud = {
        due: r.due, stability: r.stability, difficulty: r.difficulty,
        elapsed_days: r.elapsed_days, scheduled_days: r.scheduled_days,
        reps: r.reps, lapses: r.lapses, learning_steps: r.learning_steps, state: r.state,
        last_review: r.last_review, updatedAt: r.updated_at,
      };
      const local = cards[r.question_id];
      if (!local || new Date(cloud.updatedAt || 0) >= new Date(local.updatedAt || 0)) cards[r.question_id] = cloud;
    }
    saveCards();
    setStatus("ok", "Fortschritt mit Supabase synchronisiert");
  } catch (e) {
    console.warn(e); setStatus("err", "Cloud-Sync fehlgeschlagen: " + e.message);
  }
}

async function recordAttempt(q, areaId, { userAnswer, selfScore, aiScore, aiFeedback, hintsUsed, durationMs, card }) {
  const p = progress[q.id] || { attempts: 0, bestSelf: null, bestAi: null, area: areaId };
  p.attempts += 1; p.lastSelf = selfScore; p.lastAi = aiScore ?? p.lastAi ?? null;
  p.bestSelf = Math.max(p.bestSelf ?? -1, selfScore); if (aiScore != null) p.bestAi = Math.max(p.bestAi ?? -1, aiScore);
  p.lastAt = new Date().toISOString(); p.area = areaId;
  progress[q.id] = p; saveProgress();
  if (sb.ok) {
    setStatus("busy", "Speichere …");
    const { updatedAt, ...cardForCloud } = card || {};
    sb.rpc("nq_save_attempt", {
      p_code: settings.learnerCode, p_question_id: q.id, p_area_id: areaId, p_question_type: q.type,
      p_user_answer: userAnswer ?? null, p_self_score: selfScore, p_ai_score: aiScore ?? null, p_ai_feedback: aiFeedback ?? null,
      p_hints_used: hintsUsed || 0, p_duration_ms: durationMs ?? null, p_card: card ? cardForCloud : null,
    }).then(() => setStatus("ok", "Gespeichert")).catch((e) => { console.warn(e); setStatus("err", "Speichern fehlgeschlagen: " + e.message); });
  }
}

/* ---------- Daten ---------- */
async function loadIndex() {
  if (state.index) return state.index;
  const r = await fetch("data/index.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("Fragenindex nicht gefunden – wurde `npm run build` ausgeführt?");
  state.index = await r.json();
  return state.index;
}
/**
 * Schlanker Gesamtkatalog aller Fragen (ID, Gebiet, Typ, Schwierigkeit,
 * Kompetenzbereiche, Lernplan-Block). Reicht für "Heute fällig" und die
 * Sitzungsplanung, ohne alle Fragendateien zu laden.
 */
async function loadCatalog() {
  if (state.catalog) return state.catalog;
  const r = await fetch("data/catalog.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("Fragenkatalog nicht gefunden – wurde `npm run build` ausgeführt?");
  const doc = await r.json();
  state.catalog = doc.questions.map((q) => ({ id: q.id, area: q.a, type: q.t, difficulty: q.d, exam: q.e || [], block: q.b }));
  return state.catalog;
}

/** Vollständige Fragen zu einer Liste von IDs, gruppiert nach Gebiet nachgeladen. */
async function loadQuestionsByIds(ids) {
  const wanted = new Set(ids);
  const catalog = await loadCatalog();
  const areas = [...new Set(catalog.filter((q) => wanted.has(q.id)).map((q) => q.area))];
  const byId = new Map();
  for (const a of areas) for (const q of await loadArea(a)) if (wanted.has(q.id)) byId.set(q.id, q);
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

async function loadArea(areaId) {
  if (state.questions[areaId]) return state.questions[areaId];
  const r = await fetch(`data/questions/${areaId}.json`);
  if (!r.ok) throw new Error(`Fragen für ${areaId} nicht gefunden`);
  const doc = await r.json();
  state.questions[areaId] = doc.questions.map((q) => ({ ...q, area: areaId }));
  return state.questions[areaId];
}
/** Eingabebereich je Aufgabentyp. */
function answerAreaHtml(q, mcOptions) {
  const finalRow = (id, unit) => `<div class="row final-row">
    <label class="field" style="flex:2"><span>Endergebnis (nur diese Zahl wird geprüft)</span>
      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="z. B. 6,94"></label>
    <label class="field" style="flex:1"><span>Einheit</span>
      <input id="${id}-unit" type="text" autocomplete="off" placeholder="${esc(unit || "")}"></label>
  </div>`;
  const hint = (t) => `<div class="small muted" style="margin-top:4px">${t} <kbd>Strg</kbd>+<kbd>Enter</kbd> zum Abgeben</div>`;

  if (q.type === "mc") {
    return `<div class="options">${(mcOptions || []).map((o) => `<label class="option" data-i="${o.i}"><input type="radio" name="opt" value="${o.i}"><span>${md(o.text)}</span></label>`).join("")}</div>`;
  }
  if (q.type === "case") {
    return q.parts.map((part) => `<div class="case-part" data-part="${esc(part.id)}">
      <div class="row between"><strong>Teilaufgabe ${esc(part.id)})</strong><span class="badge">${part.points} Punkte</span></div>
      <div class="q-text small">${md(part.question)}</div>
      ${part.type === "calc" ? finalRow(`final-${esc(part.id)}`, part.solution?.unit) : ""}
      <textarea id="ans-${esc(part.id)}" rows="5" placeholder="${part.type === "calc" ? "Rechenweg …" : "Antwort …"}"></textarea>
    </div>`).join("") + hint("Alle Teilaufgaben werden gemeinsam bewertet.");
  }
  // open, calc
  const withFinal = HAS_FINAL.has(q.type);
  return `${withFinal ? finalRow("final", q.solution?.unit) : ""}
    <textarea id="ans" placeholder="${withFinal ? "Rechenweg: Formel, Einsetzen, Zwischenschritte …" : "Deine Antwort – so, wie du sie in der Prüfung formulieren würdest …"}"></textarea>
    ${hint(withFinal ? "Deutsches Zahlenformat ist erlaubt (6,94)." : "")}`;
}

/** Klartext für den KI-Status inklusive fehlendem Zugangscode. */
function aiStatusText(health) {
  if (!health.apiKeyConfigured) return "KI-Bewertung nicht verfügbar – kein API-Schlüssel auf dem Server. Selbsteinschätzung anhand der Musterantwort.";
  if (!health.passwordConfigured) return "KI-Bewertung gesperrt – auf dem Server ist kein Zugangscode (APP_PASSWORD) gesetzt.";
  if (!settings.appKey) return "KI-Bewertung braucht den Zugangscode – bitte in den Einstellungen eintragen.";
  if (!settings.ai) return "KI-Bewertung in den Einstellungen deaktiviert.";
  return `KI-Bewertung aktiv (${esc(health.model)}), höchstens ${health.rateLimitPerHour || 60} Anfragen pro Stunde.`;
}

async function loadHealth() {
  if (state.health) return state.health;
  try { const r = await fetch(CFG.healthEndpoint || "/api/health", { cache: "no-store" }); state.health = r.ok ? await r.json() : { ok: false, ai: false }; }
  catch { state.health = { ok: false, ai: false }; }
  return state.health;
}

/* ---------- Lernstand ---------- */
/**
 * Zustand einer Frage für die Anzeige. Grundlage ist die FSRS-Karte; für
 * Antworten aus der Zeit vor der Wiedervorlage greift die Selbsteinschätzung.
 */
const qState = (id) => {
  const c = cards[id];
  if (c && !SR.isNew(c)) {
    if (SR.isMature(c)) return "ok";
    return SR.isShaky(c) ? "bad" : "mid";
  }
  const p = progress[id];
  if (!p || !p.attempts) return "new";
  if (p.lastSelf >= 2) return "ok";
  if (p.lastSelf === 1) return "mid";
  return "bad";
};

/** Erfüllt eine Katalogfrage die eingestellten Filter (Kompetenzbereich, Block)? */
function matchesFilters(q) {
  if (settings.modules?.length && !q.exam.some((e) => settings.modules.includes(e))) return false;
  if (settings.blocks?.length && !settings.blocks.includes(q.block)) return false;
  return true;
}

/** Alle fälligen Wiederholungen, die längst überfälligen zuerst. */
function dueQuestions(pool, now = new Date()) {
  return pool
    .filter((q) => cards[q.id] && !SR.isNew(cards[q.id]) && SR.isDue(cards[q.id], now))
    .sort((a, b) => new Date(cards[a.id].due) - new Date(cards[b.id].due));
}

/**
 * Tagesplan: die Tagesquote neuer Fragen, rückwärts auf den Prüfungstermin
 * gerechnet, plus eine feste, kleine Zahl Wiederholungen.
 *
 * Die Wiederholungen sind bewusst gedeckelt: Sonst wächst der Tagesstapel mit
 * jedem Lerntag, bis er nicht mehr zu schaffen ist. Was über den Deckel
 * hinausgeht, bleibt als Rückstand liegen und lässt sich in einer eigenen
 * Wiederholungssitzung abarbeiten (#/gebiet/_due).
 */
function planToday(catalog, now = new Date()) {
  const pool = catalog.filter(matchesFilters);
  const due = dueQuestions(pool, now);
  const fresh = pool.filter((q) => SR.isNew(cards[q.id]));
  const quota = Math.min(
    fresh.length,
    SR.newPerDay({ remainingNew: fresh.length, examDate: settings.examDate, configured: Number(settings.newPerDay) || SR.DEFAULT_NEW_PER_DAY, now }),
  );
  const n = Number(settings.reviewsPerDay);
  const cap = Number.isFinite(n) ? Math.max(0, n) : SR.DEFAULT_REVIEWS_PER_DAY;
  const reviews = due.slice(0, cap);
  return { due, reviews, backlog: due.length - reviews.length, fresh, quota, total: pool.length };
}

/** Fragen, die erfahrungsgemäß wackeln: Rückfälle oder noch nicht sicher gewusst. */
const isWeakCard = (id) => SR.isWeak(cards[id]);
function areaStats(areaId, count) {
  const s = { total: count, ok: 0, mid: 0, bad: 0, new: 0 };
  const ids = state.questions[areaId]?.map((q) => q.id);
  if (ids) for (const id of ids) s[qState(id)]++;
  else if (state.catalog) { for (const q of state.catalog) if (q.area === areaId) s[qState(q.id)]++; }
  else { for (const [id, p] of Object.entries(progress)) if (p.area === areaId) s[qState(id)]++; s.new = Math.max(0, count - s.ok - s.mid - s.bad); }
  return s;
}
const progressBar = (s) => `<div class="progress" title="${s.ok} sicher · ${s.mid} teilweise · ${s.bad} unsicher · ${s.new} offen">
  <span class="p-ok" style="width:${(100 * s.ok) / (s.total || 1)}%"></span><span class="p-mid" style="width:${(100 * s.mid) / (s.total || 1)}%"></span><span class="p-bad" style="width:${(100 * s.bad) / (s.total || 1)}%"></span></div>`;

/* ---------- Prüfungsgespräch ---------- */
/** Eine Frage sofort zur Wiederholung fällig setzen (Nachlernliste aus dem Prüfungsgespräch). */
function markDue(questionId) {
  const c = cards[questionId] || SR.emptyCard();
  cards[questionId] = { ...c, due: new Date().toISOString(), updatedAt: new Date().toISOString() };
  saveCards();
  if (sb.ok) {
    const { updatedAt, ...forCloud } = cards[questionId];
    sb.rpc("nq_save_card", { p_code: settings.learnerCode, p_question_id: questionId, p_area_id: state.catalog?.find((q) => q.id === questionId)?.area ?? null, p_card: forCloud })
      .catch((e) => console.warn("nq_save_card", e));
  }
}

const oralView = createOralView({
  $app, esc, md, LS, settings, shuffle, aiStatusText,
  oralEndpoint: CFG.oralEndpoint || "/api/oral",
  oralProtocolEndpoint: CFG.oralProtocolEndpoint || "/.netlify/functions/oral-protocol-background",
  ttsEndpoint: CFG.ttsEndpoint || "/api/tts",
  getCards: () => cards,
  loadCatalog, loadHealth, markDue,
});

const litView = createLiteratureView({ $app, esc, md });

/**
 * Lernliteratur, einmal geladen. Die Fundstellen an den Fragen nennen nur die
 * Werk-ID; der Kurzname und die Gliederung stehen in data/literature.json.
 */
let literature = null;
async function loadLiterature() {
  if (literature) return literature;
  try {
    const r = await fetch("data/literature.json", { cache: "no-cache" });
    literature = r.ok ? await r.json() : { works: [] };
  } catch { literature = { works: [] }; }
  return literature;
}

/* ---------- Router ---------- */
const routes = {
  "": renderHome,
  "pruefung": (rest) => oralView.renderOral(rest),
  "pruefungsordnung": renderExamInfo,
  "literatur": (rest) => litView.renderLiterature(rest),
  "statistik": renderStats,
  "einstellungen": renderSettings,
  "fachgespraech": (rest) => oralView.renderOral(rest),
  "gebiet": renderAreaSetup,
  "quiz": renderQuiz,
  "ergebnis": renderResult,
};

async function router() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = hash.split("/");
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === (name || "home")));
  const fn = routes[name] || renderHome;
  try { await fn(rest); window.scrollTo({ top: 0 }); }
  catch (e) { console.error(e); $app.innerHTML = `<div class="notice err">Fehler: ${esc(e.message)}</div>`; }
}
window.addEventListener("hashchange", router);

/* ---------- Ansichten ---------- */
async function renderHome() {
  const idx = await loadIndex();
  const catalog = await loadCatalog();
  const plan = planToday(catalog);
  const daysLeft = SR.daysUntil(settings.examDate);
  const totals = { total: 0, ok: 0, mid: 0, bad: 0, new: 0 };
  const areaCards = idx.areas.map((a) => {
    const s = areaStats(a.id, a.count);
    for (const k of Object.keys(totals)) totals[k] += s[k] || 0;
    const done = s.ok + s.mid + s.bad;
    return `<div class="card area-card ${a.available ? "" : "disabled"}" ${a.available ? `data-go="#/gebiet/${a.id}" role="button" tabindex="0"` : ""}>
      <div class="row between"><span class="title">${a.order}. ${esc(a.title)}</span><span class="badge">${a.available ? a.count + " Fragen" : "folgt"}</span></div>
      <div class="desc">${esc(a.description)}</div>
      ${progressBar(s)}
      <div class="meta"><span>${esc(a.chapter)} · Block ${esc(a.block || "–")}</span><span>${done}/${a.count} bearbeitet${s.ok ? ` · ${s.ok} sicher` : ""}</span></div>
    </div>`;
  }).join("");
  const weak = catalog.filter((q) => isWeakCard(q.id)).length;
  const filtered = settings.modules?.length || settings.blocks?.length;
  const sessionSize = plan.quota + plan.reviews.length;

  $app.innerHTML = `
    <h1>Heute lernen</h1>
    <div class="card today">
      <div class="kpis">
        <div class="kpi"><div class="v">${plan.quota}</div><div class="l">neue Fragen heute</div></div>
        <div class="kpi"><div class="v">${plan.reviews.length}</div><div class="l">Wiederholungen dazwischen</div></div>
        <div class="kpi"><div class="v" style="color:${plan.backlog ? "var(--warn)" : "var(--ok)"}">${plan.backlog}</div><div class="l">Wiederholungen im Rückstand</div></div>
        <div class="kpi"><div class="v">${daysLeft > 0 ? daysLeft : 0}</div><div class="l">Tage bis ${new Date(settings.examDate).toLocaleDateString("de-DE")}</div></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="start-today" ${sessionSize ? "" : "disabled"}>▶︎ Tagessitzung starten (${sessionSize} Fragen)</button>
        <a class="btn ${plan.due.length ? "" : "ghost"}" href="#/gebiet/_due">🔁 Nur Wiederholungsfragen${plan.due.length ? ` (${plan.due.length} fällig)` : ""}</a>
        <a class="btn ghost" href="#/gebiet/_new">🆕 Nur neue Fragen</a>
      </div>
      <p class="small muted" style="margin-top:10px">
        Die Tagessitzung besteht aus neuen Fragen, unter die ${plan.reviews.length === 1 ? "eine Wiederholung" : `${plan.reviews.length} Wiederholungen`} gestreut ${plan.reviews.length === 1 ? "wird" : "werden"} – die am längsten überfälligen zuerst.
        Die Quote neuer Fragen ist auf den Prüfungstermin zurückgerechnet: ${plan.fresh.length} offene Fragen auf ${daysLeft > 0 ? daysLeft : 1} verbleibende Lerntage.
        ${plan.backlog ? `${plan.backlog} weitere Wiederholungen sind fällig; sie warten unter <a href="#/gebiet/_due">Nur Wiederholungsfragen</a>, bis du Zeit dafür hast.` : ""}
        ${filtered ? `Aktiver Filter: ${[...(settings.modules || []), ...(settings.blocks || []).map((b) => "Block " + b)].map(esc).join(", ")} – ${plan.total} von ${catalog.length} Fragen.` : ""}
        <a href="#/einstellungen">Einstellungen ändern</a>
      </p>
      ${plan.backlog > 4 * Math.max(1, plan.reviews.length) ? `<div class="notice warn small">Der Rückstand wächst schneller, als ${plan.reviews.length} Wiederholungen pro Tag ihn abbauen. Entweder du hängst regelmäßig eine reine Wiederholungssitzung an, erhöhst die Wiederholungen je Tagessitzung oder nimmst weniger neue Fragen pro Tag – jede neue Frage erzeugt in den Tagen danach weitere Wiederholungen.</div>` : ""}
    </div>

    <h2>Themengebiete</h2>
    <p class="muted">${idx.total} Fragen in ${idx.areas.filter((a) => a.available).length} Gebieten, gegliedert nach den Weiterbildungsinhalten der WBO Hessen 2020 (Schwerpunkt Neonatologie) und den Kapiteln der <em>Checkliste Neonatologie</em>.</p>
    <div class="card">
      <div class="kpis">
        <div class="kpi"><div class="v">${totals.ok + totals.mid + totals.bad}</div><div class="l">bearbeitet von ${totals.total}</div></div>
        <div class="kpi"><div class="v">${totals.ok}</div><div class="l">sitzt sicher</div></div>
        <div class="kpi"><div class="v">${weak}</div><div class="l">wackelt noch</div></div>
      </div>
      <div class="row" style="margin-top:12px">
        <a class="btn" href="#/gebiet/_mix">🎲 Gemischte Sitzung (alle Gebiete)</a>
        <a class="btn ${weak ? "" : "ghost"}" href="#/gebiet/_weak" ${weak ? "" : 'aria-disabled="true"'}>🔁 Schwache Fragen wiederholen</a>
        <a class="btn" href="#/gebiet/_rechnen" title="Nur Aufgaben mit Zahlenergebnis: Dosierungen, Infusionen, Ernährung">🧮 Rechentraining</a>
        <a class="btn" href="#/pruefung" title="Mündliche Prüfung mit Claude als Prüfer">🗣️ Prüfungsgespräch üben</a>
      </div>
    </div>
    <div class="grid">${areaCards}</div>`;

  document.getElementById("start-today")?.addEventListener("click", () => startDailySession(plan));
  $app.querySelectorAll("[data-go]").forEach((el) => {
    const go = () => (location.hash = el.dataset.go);
    el.addEventListener("click", go); el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}

/** Tagessitzung: neue Fragen mit den Wiederholungen des Tages durchmischt. */
async function startDailySession(plan) {
  const fresh = shuffle(plan.fresh).slice(0, plan.quota).map((q) => q.id);
  const ids = SR.interleave(fresh, plan.reviews.map((q) => q.id));
  if (!ids.length) { alert("Für heute ist nichts fällig – gönn dir eine Pause oder starte eine gemischte Sitzung."); return; }
  const list = await loadQuestionsByIds(ids);
  state.session = { source: "_heute", title: "Tagessitzung", questions: list, i: 0, results: [], startedAt: Date.now() };
  location.hash = "#/quiz";
}

async function renderAreaSetup([areaId]) {
  const idx = await loadIndex();
  const SPECIAL = {
    _mix: { title: "Gemischte Sitzung" },
    _weak: { title: "Schwache Fragen wiederholen" },
    _new: { title: "Nur neue Fragen" },
    _due: {
      title: "Nur Wiederholungsfragen",
      desc: "Ausschließlich Fragen, die zur Wiederholung fällig sind – unabhängig von der Tagessitzung. Hier arbeitest du den Rückstand ab, die am längsten überfälligen Fragen zuerst.",
    },
    _heute: { title: "Tagessitzung" },
    _rechnen: {
      title: "Rechentraining",
      desc: "Nur Aufgaben mit Zahlenergebnis – quer über alle Gebiete: Medikamentendosierungen, Perfusoren, Glukosezufuhr, parenterale und enterale Ernährung, Katheter- und Tubuslage. Die WBO verlangt ausdrücklich die Berechnung enteraler und parenteraler Ernährung.",
    },
  }[areaId];
  const special = SPECIAL?.title;
  const area = idx.areas.find((a) => a.id === areaId);
  if (!special && !area) throw new Error("Unbekanntes Gebiet");
  const dueCount = areaId === "_due" ? dueQuestions((await loadCatalog()).filter(matchesFilters)).length : 0;
  const ALL_TYPES = ["open", "mc", "calc", "case"];
  const sessCfg = Object.assign({ count: 15, difficulty: "all", types: ALL_TYPES, order: "random", areas: idx.areas.filter((a) => a.available).map((a) => a.id) }, LS.get("sessCfg", {}));
  // Das Rechentraining ist über den Aufgabentyp definiert – die gespeicherte
  // Typenauswahl der letzten Sitzung würde das aushebeln.
  if (areaId === "_rechnen") sessCfg.types = ["calc", "case"];
  const stats = area ? areaStats(area.id, area.count) : null;
  const health = await loadHealth();
  $app.innerHTML = `
    <a href="#/" class="muted small">← Themen</a>
    <h1>${esc(special || area.title)}</h1>
    ${SPECIAL?.desc ? `<p class="muted">${esc(SPECIAL.desc)}</p>` : ""}
    ${areaId === "_due" ? `<p class="small ${dueCount ? "muted" : ""}">${dueCount ? `${dueCount} Fragen sind derzeit fällig.` : "Gerade ist nichts fällig – alle Wiederholungen sind abgearbeitet."}</p>` : ""}
    ${area ? `<p class="muted">${esc(area.description)}</p><p class="small muted">${esc(area.chapter)} · Kompetenzbereich: ${area.exam.map((e) => `<span class="badge primary" title="${esc(idx.exam[e])}">${e}</span>`).join(" ")}</p>${progressBar(stats)}` : ""}
    <div class="card" style="margin-top:14px">
      <form id="setup" class="stack">
        <div class="row">
          <label class="field" style="flex:1"><span>Anzahl Fragen</span>
            <select name="count">${[5, 10, 15, 20, 30, 50, 999].map((n) => `<option value="${n}" ${sessCfg.count == n ? "selected" : ""}>${n === 999 ? "alle" : n}</option>`).join("")}</select></label>
          <label class="field" style="flex:1"><span>Schwierigkeit</span>
            <select name="difficulty">${[["all", "alle"], ["1", "1 · Grundlagen"], ["2", "2 · Schwerpunktniveau"], ["3", "3 · anspruchsvoll"], ["23", "2 und 3"]].map(([v, l]) => `<option value="${v}" ${sessCfg.difficulty == v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field" style="flex:1"><span>Reihenfolge</span>
            <select name="order"><option value="random" ${sessCfg.order === "random" ? "selected" : ""}>zufällig</option><option value="seq" ${sessCfg.order === "seq" ? "selected" : ""}>nach Nummer</option><option value="weak" ${sessCfg.order === "weak" ? "selected" : ""}>schwache zuerst</option></select></label>
        </div>
        <div class="row">
          <span class="small muted">Fragetypen:</span>
          ${ALL_TYPES.map((v) => `<label class="toggle small"><input type="checkbox" name="types" value="${v}" ${sessCfg.types.includes(v) ? "checked" : ""}> ${TYPE_LABEL[v]}</label>`).join("")}
        </div>
        ${special ? `<details><summary class="small muted">Gebiete auswählen (${sessCfg.areas.length})</summary><div class="grid" style="margin-top:8px">${idx.areas.filter((a) => a.available).map((a) => `<label class="toggle small"><input type="checkbox" name="areas" value="${a.id}" ${sessCfg.areas.includes(a.id) ? "checked" : ""}> ${esc(a.title)}</label>`).join("")}</div></details>` : ""}
        <div class="row between">
          <span class="small muted">${aiStatusText(health)}</span>
          <button class="btn primary" type="submit">Sitzung starten →</button>
        </div>
      </form>
    </div>
    ${area ? `<div class="card"><h3 style="margin-top:0">Fragen in diesem Gebiet</h3><div id="qlist" class="small muted">Lade …</div></div>` : ""}`;
  document.getElementById("setup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const cfg = { count: Number(fd.get("count")), difficulty: fd.get("difficulty"), order: fd.get("order"), types: fd.getAll("types"), areas: special ? fd.getAll("areas") : [area.id] };
    if (!cfg.types.length) { alert("Bitte mindestens einen Fragetyp wählen."); return; }
    if (!cfg.areas.length) { alert("Bitte mindestens ein Gebiet wählen."); return; }
    LS.set("sessCfg", { ...sessCfg, ...cfg, areas: special ? cfg.areas : sessCfg.areas });
    await startSession(cfg, areaId);
  });
  if (area) {
    const qs = await loadArea(area.id);
    document.getElementById("qlist").innerHTML = `<table class="simple">${qs.map((q) => { const st = qState(q.id); const p = progress[q.id]; return `<tr><td class="muted">${q.id}</td><td>${esc(q.question.replace(/\*\*/g, "").slice(0, 90))}${q.question.length > 90 ? "…" : ""}</td><td><span class="dots">${"●".repeat(q.difficulty)}</span></td><td><span class="badge ${st === "new" ? "" : st}">${{ new: "offen", ok: "sicher", mid: "teilweise", bad: "unsicher" }[st]}${p?.lastAi != null ? ` · KI ${p.lastAi}` : ""}</span></td></tr>`; }).join("")}</table>`;
  }
}

async function startSession(cfg, source) {
  const now = new Date();
  let pool = [];
  for (const id of cfg.areas) pool.push(...(await loadArea(id)));
  pool = pool.filter((q) => cfg.types.includes(q.type));
  if (cfg.difficulty === "23") pool = pool.filter((q) => q.difficulty >= 2);
  else if (cfg.difficulty !== "all") pool = pool.filter((q) => q.difficulty === Number(cfg.difficulty));
  // Die Sonderlisten arbeiten jetzt mit den Kartendaten statt mit der letzten Selbsteinschätzung.
  if (source === "_weak") pool = pool.filter((q) => isWeakCard(q.id));
  if (source === "_new") pool = pool.filter((q) => SR.isNew(cards[q.id]));
  if (source === "_due") {
    // Reine Wiederholungssitzung: Hier zählt der Rückstand. In die Sitzung
    // kommen die am längsten überfälligen Fragen; über ihre Abfolge
    // untereinander entscheidet danach die gewählte Reihenfolge.
    pool = dueQuestions(pool, now).slice(0, cfg.count);
  }
  if (!pool.length) { alert("Keine passenden Fragen gefunden."); return; }

  /**
   * Auswahlgewicht: überfällige Karten zuerst, dann wackelige, dann neue,
   * zuletzt das, was ohnehin sitzt.
   */
  const weight = (q) => {
    const c = cards[q.id];
    if (SR.isNew(c)) return 2;
    const overdueDays = Math.max(0, (now - new Date(c.due)) / 86400e3);
    if (SR.isDue(c, now)) return 3 + Math.min(3, overdueDays / 7);
    return SR.isMature(c) ? 0.25 : 0.75;
  };
  if (cfg.order === "seq") pool.sort((a, b) => a.id.localeCompare(b.id));
  else if (cfg.order === "weak") pool = shuffle(pool).sort((a, b) => weight(b) - weight(a));
  else pool = shuffle(pool).sort((a, b) => weight(b) * Math.random() - weight(a) * Math.random());
  const list = pool.slice(0, cfg.count);
  state.session = { source, questions: list, i: 0, results: [], startedAt: Date.now() };
  location.hash = "#/quiz";
}

/* ---------- Quiz ---------- */
const TYPE_LABEL = {
  open: "Freitext", mc: "Multiple Choice", calc: "Rechenaufgabe", case: "Fallbesprechung",
};
/** Aufgaben, die über ein Endergebnis-Feld geprüft werden. */
const HAS_FINAL = new Set(["calc"]);
/**
 * Zahlenprüfung einer Rechenaufgabe. Gewertet wird ausschließlich das Feld
 * „Endergebnis“; fehlt es (alte Einträge), gilt die Zahl nach dem letzten
 * Gleichheitszeichen bzw. in der letzten Zeile des Rechenwegs.
 */
function numericCheck(q, { finalValue, workings }) {
  if (!HAS_FINAL.has(q.type)) return null;
  return checkSolution(q.solution, { finalValue, workings });
}

/**
 * Ruft die KI-Bewertung auf. Es geht nur die Frage-ID hinaus – Fragetext,
 * Musterantwort und Kernpunkte holt der Server aus seinem eigenen Bestand.
 * `followUp` startet die zweite Runde mit der Antwort auf die Prüfer-Nachfrage.
 */
async function evaluateWithAI(q, { userAnswer, hintsUsed, numericCheck, finalValue, followUp }) {
  const body = {
    questionId: q.id,
    userAnswer,
    hintsUsed: hintsUsed || 0,
    numericCheck: numericCheck || undefined,
    finalValue: finalValue || undefined,
    learnerCode: settings.learnerCode,
    followUp: followUp || undefined,
  };
  const r = await fetch(CFG.evaluateEndpoint || "/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(settings.appKey ? { "x-app-key": settings.appKey } : {}) },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(data.error || `HTTP ${r.status}`); err.code = data.code; throw err; }
  return data;
}

async function renderQuiz() {
  const s = state.session;
  if (!s) { location.hash = "#/"; return; }
  if (s.i >= s.questions.length) { location.hash = "#/ergebnis"; return; }
  const idx = await loadIndex();
  const q = s.questions[s.i];
  const area = idx.areas.find((a) => a.id === q.area);
  const health = await loadHealth();
  // Wo man das Thema nachliest. Hat die Frage keine eigene Fundstelle,
  // greift die des Themengebiets.
  const lit = await loadLiterature();
  const lookup = q.lookup?.length ? q.lookup : area?.lookup;
  const lookupNote = q.lookup?.length ? "" : area?.lookupNote || "";
  const useAI = health.ai && settings.ai && Boolean(settings.appKey) && q.type !== "mc";
  const startedAt = Date.now();
  // `aiResult` bleibt die Bewertung der Ursprungsfrage (Runde 1) – Nachfragen werden
  // getrennt bewertet und nur in `aiRounds` gesammelt, damit die Punkte auf die Frage
  // durch eine Nachfrage weder steigen noch fallen.
  let hintsShown = 0, submitted = false, selfScore = null, selfByUser = false, aiResult = null, aiRounds = [], userAnswer = "", finalValue = "", nc = null, autoResult = null, caseResults = null;
  const mcOptions = q.type === "mc" ? shuffle(q.options.map((o, i) => ({ ...o, i }))) : null;

  $app.innerHTML = `
    <div class="quiz-head">
      <div class="quiz-progress"><div class="small muted">Frage ${s.i + 1} von ${s.questions.length}${s.source && !s.source.startsWith("_") ? "" : ` · ${esc(area?.short || q.area)}`}</div>
        <div class="progress"><span class="p-ok" style="width:${(100 * s.i) / s.questions.length}%"></span></div></div>
      <button class="btn sm ghost" id="abort">Sitzung beenden</button>
    </div>
    <div class="card">
      <div class="q-meta">
        <span class="badge primary">${esc(area?.title || q.area)}</span>
        <span class="badge">${TYPE_LABEL[q.type] || q.type}</span>
        <span class="badge" title="Schwierigkeit ${q.difficulty}/3"><span class="dots">${"●".repeat(q.difficulty)}<span style="opacity:.25">${"●".repeat(3 - q.difficulty)}</span></span></span>
        ${(q.exam || []).map((e) => `<span class="badge" title="${esc(idx.exam[e] || e)}">${e}</span>`).join("")}
        <span class="muted small" style="margin-left:auto">${q.id}</span>
      </div>
      <div class="q-text">${md(q.question)}</div>
      <div id="hints"></div>
      <div id="answer-area" style="margin-top:14px">${answerAreaHtml(q, mcOptions)}</div>
      <div class="row" style="margin-top:12px" id="actions">
        <button class="btn primary" id="submit">Antwort abgeben</button>
        <button class="btn ghost" id="hint" ${q.hints?.length ? "" : "disabled"}>💡 Hinweis (0/${q.hints?.length || 0})</button>
        <button class="btn ghost" id="dontknow">Weiß ich nicht → Lösung zeigen</button>
      </div>
      <div id="reveal" class="stack hidden" style="margin-top:16px"></div>
    </div>`;

  const $hint = document.getElementById("hint"), $hints = document.getElementById("hints"), $reveal = document.getElementById("reveal");
  $hint.addEventListener("click", () => {
    if (hintsShown >= q.hints.length) return;
    $hints.insertAdjacentHTML("beforeend", `<div class="hint-box small"><strong>Hinweis ${hintsShown + 1}:</strong> ${md(q.hints[hintsShown])}</div>`);
    hintsShown++; $hint.textContent = `💡 Hinweis (${hintsShown}/${q.hints.length})`; if (hintsShown >= q.hints.length) $hint.disabled = true;
  });
  document.getElementById("abort").addEventListener("click", () => { if (confirm("Sitzung beenden? Bearbeitete Fragen bleiben gespeichert.")) location.hash = "#/ergebnis"; });
  const $ans = document.getElementById("ans");
  const $final = document.getElementById("final"), $unit = document.getElementById("final-unit");
  const submitOnCtrlEnter = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); document.getElementById("submit").click(); } };
  document.querySelectorAll("#answer-area textarea").forEach((t) => t.addEventListener("keydown", submitOnCtrlEnter));
  $final?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $ans?.focus(); } else submitOnCtrlEnter(e); });
  ($final || $ans || document.querySelector("#answer-area textarea"))?.focus();

  /** Endergebnis-Feld inklusive Einheit, so wie eingegeben. */
  const getFinal = (id = "final") => {
    const v = document.getElementById(id)?.value.trim();
    const u = document.getElementById(id + "-unit")?.value.trim();
    return [v, u].filter(Boolean).join(" ");
  };

  /** Antworttext, wie er gespeichert und an die KI geschickt wird. */
  const getAnswer = () => {
    if (q.type === "mc") return document.querySelector("input[name=opt]:checked")?.value ?? null;
    if (q.type === "case") {
      return q.parts.map((part) => {
        const fin = getFinal(`final-${part.id}`);
        const txt = document.getElementById(`ans-${part.id}`)?.value.trim() ?? "";
        return `### Teilaufgabe ${part.id})\n${fin ? `Endergebnis: ${fin}\n` : ""}${txt}`;
      }).join("\n\n").trim();
    }
    return $ans?.value.trim() ?? "";
  };

  /** Die Zahl, die tatsächlich gewertet wurde – für die Rückmeldung bei Abweichung. */
  const readFinal = () => (finalValue ? parseNumber(finalValue) : extractFinalNumber(userAnswer));

  async function reveal(mode) {
    if (submitted) return; submitted = true;
    const raw = getAnswer();
    document.getElementById("submit").disabled = true; document.getElementById("dontknow").disabled = true; $hint.disabled = true;
    let local = null; // lokale Bewertung
    if (q.type === "mc") {
      const chosen = raw == null ? null : Number(raw);
      const correctIdx = q.options.findIndex((o) => o.correct);
      document.querySelectorAll(".option").forEach((el) => { const i = Number(el.dataset.i); el.querySelector("input").disabled = true; if (i === correctIdx) el.classList.add("correct"); else if (i === chosen) el.classList.add("wrong"); });
      userAnswer = chosen == null ? "" : q.options[chosen].text;
      local = mode === "dontknow" || chosen == null ? 0 : chosen === correctIdx ? 2 : 0;
      autoResult = mode === "dontknow" || chosen == null ? "wrong" : chosen === correctIdx ? "correct" : "wrong";
    } else {
      document.querySelectorAll("#answer-area textarea, #answer-area input").forEach((el) => { el.disabled = true; });
      userAnswer = mode === "dontknow" ? "" : raw;
      finalValue = mode === "dontknow" ? "" : getFinal();
      if (HAS_FINAL.has(q.type) && mode !== "dontknow" && (finalValue || userAnswer)) {
        nc = numericCheck(q, { finalValue, workings: userAnswer });
        local = nc === "correct" ? 2 : nc === "wrong" ? 0 : null;
      }
      if (q.type === "case" && mode !== "dontknow") {
        // Rechen-Teilaufgaben automatisch prüfen, der Rest geht an die KI.
        caseResults = q.parts.map((part) => part.type !== "calc" ? null
          : checkSolution(part.solution, { finalValue: getFinal(`final-${part.id}`), workings: document.getElementById(`ans-${part.id}`)?.value ?? "" }));
      }
      if (mode === "dontknow") local = 0;
    }
    const preview = SR.previewIntervals(cards[q.id], { examDate: settings.examDate });
    $reveal.classList.remove("hidden");
    $reveal.innerHTML = `
      ${HAS_FINAL.has(q.type) && nc ? `<div class="notice ${nc === "correct" ? "" : nc === "wrong" ? "err" : "warn"} small">${nc === "correct" ? `✅ Endergebnis liegt innerhalb der Toleranz (${esc(finalValue || "aus dem Rechenweg gelesen")}).` : nc === "wrong" ? `❌ Endergebnis weicht ab: gelesen <strong>${esc(String(readFinal()))}</strong>, erwartet <strong>${q.solution.value} ${esc(q.solution.unit)}</strong> (±${Math.round((q.solution.tolerance ?? 0.03) * 100)} %).` : "Im Feld „Endergebnis“ und im Rechenweg wurde keine Zahl erkannt."}</div>` : ""}
      ${q.type === "mc" ? `<div class="notice ${local === 2 ? "" : "err"} small">${local === 2 ? "✅ Richtig." : `❌ ${mode === "dontknow" || raw == null ? "Keine Auswahl." : "Leider falsch."} Die richtige Antwort ist markiert.`}</div>` : ""}
      ${caseResults?.some(Boolean) ? `<div class="notice small">Rechen-Teilaufgaben: ${q.parts.map((part, i) => caseResults[i] == null ? null : `${part.id}) ${caseResults[i] === "correct" ? "✅" : caseResults[i] === "wrong" ? "❌" : "?"}`).filter(Boolean).join(" · ")}</div>` : ""}
      <div class="answer-box">
        <strong>Musterantwort</strong>
        ${md(q.answer)}
        ${q.keyPoints?.length ? `<div class="small" style="margin-top:8px"><strong>Kernpunkte, die genannt werden sollten:</strong><ul class="keypoints">${q.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul></div>` : ""}
        ${q.source ? `<div class="small muted" style="margin-top:6px">Quelle: ${esc(q.source)}</div>` : ""}
      </div>
      ${lookup?.length ? lookupHtml(lookup, { esc, md, works: lit.works, note: lookupNote, compact: true, source: q.source }) : ""}
      <div id="ai"></div>
      <div class="card" style="box-shadow:none">
        <div class="small muted" style="margin-bottom:6px">Wie gut hast du es gewusst? Deine Einschätzung zählt für die Wiedervorlage${useAI ? " – die KI-Punkte werden getrennt gespeichert und überschreiben sie nicht" : ""}.</div>
        <div class="self-rate">
          <button class="btn sel-0" data-s="0">✗ Nicht gewusst<small>${fmtInterval(preview[SR.Rating.Again])}</small></button>
          <button class="btn sel-1" data-s="1">≈ Teilweise<small>${fmtInterval(preview[SR.Rating.Hard])}</small></button>
          <button class="btn sel-2" data-s="2">✓ Gewusst<small>${fmtInterval(preview[SR.Rating.Good])}</small></button>
          <button class="btn sel-3" data-s="3">★ Sicher, leicht<small>${fmtInterval(preview[SR.Rating.Easy])}</small></button>
          <button class="btn primary" id="next" style="margin-left:auto" disabled>Weiter →</button>
        </div>
        <div id="self-note"></div>
      </div>`;
    const setSelf = (v, byUser = true) => {
      selfScore = v;
      if (byUser) selfByUser = true;
      $reveal.querySelectorAll(".self-rate .btn[data-s]").forEach((b) => b.classList.toggle("active", Number(b.dataset.s) === v));
      document.getElementById("next").disabled = false;
      showSelfNote();
    };
    /** Hinweis, wenn die KI die Selbsteinschätzung deutlich anders sieht. */
    function showSelfNote() {
      const $n = document.getElementById("self-note");
      if (!$n) return;
      if (aiResult == null || selfScore == null) { $n.innerHTML = ""; return; }
      const aiGrade = aiResult.score >= 80 ? 2 : aiResult.score >= 45 ? 1 : 0;
      $n.innerHTML = aiGrade < selfScore
        ? `<div class="notice warn small" style="margin-top:8px">Claude vergibt nur ${aiResult.score} von 100 Punkten. Deine Einschätzung bleibt stehen, die Frage wird für die Wiedervorlage aber vorsichtiger eingestuft.</div>`
        : aiGrade > selfScore
          ? `<div class="notice small" style="margin-top:8px">Claude bewertet die Antwort mit ${aiResult.score} von 100 Punkten – strenger als nötig warst du also nicht umsonst.</div>`
          : "";
    }
    $reveal.querySelectorAll(".self-rate .btn[data-s]").forEach((b) => b.addEventListener("click", () => setSelf(Number(b.dataset.s))));
    if (local != null) setSelf(local, q.type !== "open");
    document.getElementById("next").addEventListener("click", finish);
    $reveal.scrollIntoView({ behavior: "smooth", block: "start" });

    const $ai = document.getElementById("ai");

    /**
     * Eine Bewertungsrunde als HTML. Runde 1 bewertet die Ursprungsfrage, jede weitere
     * Runde ausschließlich die Antwort auf die Nachfrage davor – mit eigenen Punkten,
     * die die Wertung der Ursprungsfrage unberührt lassen.
     */
    const aiBox = (ev, round, model) => {
      const cls = ev.score >= 80 ? "ok" : ev.score >= 50 ? "mid" : "bad";
      const fu = round > 1;
      return `<div class="ai-box">
        <div class="row between"><h3>${fu ? `Bewertung der Nachfrage${round > 2 ? ` (${round - 1}.)` : ""}` : "Bewertung durch Claude"}</h3><span class="score ${cls}">${ev.score} / 100 <span class="badge ${cls}">${esc(ev.verdict)}</span></span></div>
        ${fu ? `<div class="small muted">Punkte nur für die Nachfrage${aiResult ? ` – die ${aiResult.score} / 100 auf die Ursprungsfrage bleiben stehen` : ""}.</div>` : ""}
        ${md(ev.feedback)}
        ${ev.strengths?.length ? `<div class="small"><strong>Gut:</strong><ul>${ev.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        ${ev.missing?.length ? `<div class="small"><strong>Fehlt / falsch:</strong><ul>${ev.missing.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        ${ev.tips?.length ? `<div class="small"><strong>Tipps:</strong><ul>${ev.tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        <div class="small muted" style="margin-top:6px">${esc(model || "")}</div>
      </div>`;
    };

    const aiError = (e) => `<div class="notice ${e.code === "unauthorized" || e.code === "rate_limited" ? "warn" : "err"} small">KI-Bewertung nicht möglich: ${esc(e.message)}${e.code === "unauthorized" ? ' – Zugangscode in den <a href="#/einstellungen">Einstellungen</a> eintragen.' : ""} Bitte selbst anhand der Musterantwort einschätzen.</div>`;

    /**
     * Prüfer-Nachfrage beantwortbar machen: Antwortfeld anhängen und mit der Antwort
     * eine eigene Bewertungsrunde starten. Bewertet wird nur die Nachfrage – die
     * Wertung der Ursprungsfrage (und damit Selbsteinschätzung, Wiedervorlage und
     * Auswertung) bleibt unverändert (Vorarbeit für den mündlichen Prüfungsmodus).
     */
    function attachFollowUp(question) {
      const $wrap = document.createElement("div");
      $wrap.className = "followup";
      $wrap.innerHTML = `
        <div class="small notice" style="margin-top:8px"><strong>Nachfrage des Prüfers:</strong> ${esc(question)}</div>
        <textarea id="fu-answer" rows="3" placeholder="Deine Antwort auf die Nachfrage – wie in der Prüfung …"></textarea>
        <div class="row" style="margin-top:6px">
          <button class="btn sm primary" id="fu-send">Antwort abschicken</button>
          <span class="small muted">Claude bewertet nur die Nachfrage – die Punkte auf die Ursprungsfrage bleiben stehen.</span>
        </div>`;
      $ai.appendChild($wrap);
      const $ta = $wrap.querySelector("#fu-answer");
      const send = async () => {
        const answer = $ta.value.trim();
        if (!answer) { alert("Bitte zuerst auf die Nachfrage antworten."); return; }
        $wrap.querySelector("#fu-send").disabled = true; $ta.disabled = true;
        const $busy = document.createElement("div");
        $busy.className = "ai-box"; $busy.innerHTML = `<span class="spinner"></span> Claude bewertet die Nachfrage …`;
        $ai.appendChild($busy);
        try {
          const res = await evaluateWithAI(q, { userAnswer, hintsUsed: hintsShown, numericCheck: nc, finalValue, followUp: { question, answer } });
          // Bewusst kein `aiResult = ...`: die Nachfrage wird getrennt gewertet und
          // verändert weder die Punkte der Ursprungsfrage noch die Wiedervorlage.
          const round = aiRounds.length + 1;
          aiRounds.push({ round, scope: "followUp", question, answer, evaluation: res.evaluation });
          $busy.outerHTML = aiBox(res.evaluation, round, res.model);
          if (res.evaluation.followUp) attachFollowUp(res.evaluation.followUp);
        } catch (e) {
          $busy.outerHTML = aiError(e);
        }
      };
      $wrap.querySelector("#fu-send").addEventListener("click", send);
      $ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    }

    if (useAI && mode !== "dontknow" && (userAnswer || finalValue)) {
      $ai.innerHTML = `<div class="ai-box"><span class="spinner"></span> Claude bewertet deine Antwort wie ein Prüfer …</div>`;
      try {
        const res = await evaluateWithAI(q, { userAnswer, hintsUsed: hintsShown, numericCheck: nc, finalValue });
        aiResult = res.evaluation;
        aiRounds.push({ round: 1, scope: "question", evaluation: res.evaluation });
        $ai.innerHTML = aiBox(res.evaluation, 1, res.model);
        // Die KI schlägt nur vor, wenn noch nichts gewählt ist – sie überschreibt nie.
        if (!selfByUser && selfScore == null) setSelf(res.evaluation.score >= 80 ? 2 : res.evaluation.score >= 45 ? 1 : 0, false);
        showSelfNote();
        if (res.evaluation.followUp) attachFollowUp(res.evaluation.followUp);
      } catch (e) {
        $ai.innerHTML = aiError(e);
      }
    } else if (mode === "dontknow") {
      $ai.innerHTML = `<div class="notice small">Kein Problem – lies die Musterantwort in Ruhe und versuche, die Kernpunkte in eigenen Worten zu wiederholen. Die Frage kommt in der Wiederholung erneut.</div>`;
    }
  }
  async function finish() {
    if (selfScore == null) return;
    document.getElementById("next").disabled = true;

    // Automatische Wertung: Multiple Choice und Rechenaufgaben mit Endergebnis.
    const auto = q.type === "mc" ? (autoResult ?? null) : HAS_FINAL.has(q.type) ? nc : null;
    const { rating, downgraded } = SR.ratingFor({ auto: auto === "unparsed" ? null : auto, selfScore, aiScore: aiResult?.score ?? null, selfByUser });
    const { card, intervalDays } = SR.review(cards[q.id], rating, { examDate: settings.examDate });
    cards[q.id] = { ...card, updatedAt: new Date().toISOString() };
    saveCards();

    const stored = finalValue ? `Endergebnis: ${finalValue}\n${userAnswer}` : userAnswer;
    await recordAttempt(q, q.area, { userAnswer: stored, selfScore, aiScore: aiResult?.score ?? null, aiFeedback: aiRounds.length ? { rounds: aiRounds } : null, hintsUsed: hintsShown, durationMs: Date.now() - startedAt, card: cards[q.id] });
    s.results.push({ q, selfScore, aiScore: aiResult?.score ?? null, hintsUsed: hintsShown, rating, intervalDays, downgraded });
    s.i++; renderQuiz();
  }
  document.getElementById("submit").addEventListener("click", () => {
    const a = getAnswer();
    const empty = HAS_FINAL.has(q.type) ? !getFinal() && !a : a == null || a === "";
    if (empty) {
      alert(q.type === "mc" ? "Bitte eine Option wählen."
        : HAS_FINAL.has(q.type) ? "Bitte das Endergebnis eintragen (und möglichst den Rechenweg) – oder „Weiß ich nicht“ wählen."
        : "Bitte zuerst eine Antwort eingeben – oder „Weiß ich nicht“ wählen.");
      return;
    }
    reveal("submit");
  });
  document.getElementById("dontknow").addEventListener("click", () => reveal("dontknow"));
}

async function renderResult() {
  const s = state.session;
  if (!s) { location.hash = "#/"; return; }
  const idx = await loadIndex();
  const n = s.results.length, ok = s.results.filter((r) => r.selfScore >= 2).length, mid = s.results.filter((r) => r.selfScore === 1).length, bad = n - ok - mid;
  const aiScores = s.results.filter((r) => r.aiScore != null).map((r) => r.aiScore);
  const avgAi = aiScores.length ? Math.round(aiScores.reduce((a, b) => a + b, 0) / aiScores.length) : null;
  const weak = s.results.filter((r) => r.selfScore < 2).map((r) => r.q);
  const CLS = ["bad", "mid", "ok", "ok"], SYM = ["✗", "≈", "✓", "★"];
  $app.innerHTML = `
    <h1>Sitzung beendet</h1>
    <div class="card">
      <div class="kpis">
        <div class="kpi"><div class="v">${n}</div><div class="l">Fragen bearbeitet</div></div>
        <div class="kpi"><div class="v" style="color:var(--ok)">${ok}</div><div class="l">gewusst</div></div>
        <div class="kpi"><div class="v" style="color:var(--warn)">${mid}</div><div class="l">teilweise</div></div>
        <div class="kpi"><div class="v" style="color:var(--danger)">${bad}</div><div class="l">nicht gewusst</div></div>
        ${avgAi != null ? `<div class="kpi"><div class="v">${avgAi}</div><div class="l">Ø KI-Punkte</div></div>` : ""}
      </div>
      <div class="row" style="margin-top:12px">
        ${weak.length ? `<button class="btn primary" id="retry">🔁 ${weak.length} schwache Fragen wiederholen</button>` : ""}
        <a class="btn" href="${s.source === "_heute" ? "#/" : `#/gebiet/${esc(s.source)}`}">Neue Sitzung</a>
        <a class="btn ghost" href="#/">Zur Übersicht</a>
      </div>
    </div>
    <h2>Fragen dieser Sitzung</h2>
    <div class="card"><ul class="result-list" style="list-style:none;padding:0;margin:0">${s.results.map((r) => `<li><span class="badge ${CLS[r.selfScore]}">${SYM[r.selfScore]}</span> <span class="muted small">${r.q.id}</span> ${esc(r.q.question.replace(/\*\*/g, "").slice(0, 120))}${r.aiScore != null ? ` <span class="badge">KI ${r.aiScore}</span>` : ""}${r.hintsUsed ? ` <span class="badge">💡 ${r.hintsUsed}</span>` : ""}${r.intervalDays != null ? ` <span class="badge" title="nächste Wiedervorlage">↻ ${esc(fmtInterval(r.intervalDays))}</span>` : ""}${r.downgraded ? ` <span class="badge mid" title="KI deutlich strenger als die Selbsteinschätzung">KI strenger</span>` : ""}</li>`).join("") || "<li class='muted'>Keine Fragen bearbeitet.</li>"}</ul></div>`;
  document.getElementById("retry")?.addEventListener("click", () => { state.session = { source: s.source, questions: shuffle(weak), i: 0, results: [], startedAt: Date.now() }; location.hash = "#/quiz"; });
  void idx;
}

async function renderStats() {
  const idx = await loadIndex();
  const catalog = await loadCatalog();
  await syncFromCloud();

  const areaRows = idx.areas.filter((a) => a.available).map((a) => { const s = areaStats(a.id, a.count); const done = s.ok + s.mid + s.bad; return `<tr><td><a href="#/gebiet/${a.id}">${esc(a.title)}</a></td><td>${done}/${a.count}</td><td style="min-width:140px">${progressBar(s)}</td><td class="small muted">${s.ok} sitzt · ${s.mid} wackelt · ${s.bad} unsicher</td></tr>`; }).join("");

  // Auswertung je Kompetenzbereich der WBO (eine Frage kann zu beiden gehören).
  const moduleRows = Object.keys(idx.exam).map((mod) => {
    const qs = catalog.filter((q) => q.exam.includes(mod));
    if (!qs.length) return "";
    const seen = qs.filter((q) => !SR.isNew(cards[q.id]));
    const mature = qs.filter((q) => SR.isMature(cards[q.id]));
    const due = qs.filter((q) => cards[q.id] && !SR.isNew(cards[q.id]) && SR.isDue(cards[q.id]));
    const pctMature = Math.round((100 * mature.length) / qs.length);
    return `<tr>
      <td><span class="badge primary" title="${esc(idx.exam[mod])}">${mod}</span></td>
      <td class="small">${esc(idx.exam[mod])}</td>
      <td>${seen.length}/${qs.length}</td>
      <td style="min-width:120px"><div class="progress" title="${pctMature} % reif (Stabilität über 21 Tage)"><span class="p-ok" style="width:${pctMature}%"></span></div></td>
      <td class="small muted">${pctMature} % reif${due.length ? ` · ${due.length} fällig` : ""}</td>
    </tr>`;
  }).join("");

  // Wiederholungslast der nächsten 14 Tage.
  const fc = SR.forecast(cards, 14);
  const maxFc = Math.max(1, ...fc.map((d) => d.count));
  const fcBars = fc.map((d, i) => {
    const day = new Date(d.date);
    return `<div class="fc-col" title="${day.toLocaleDateString("de-DE")}: ${d.count} Wiederholungen">
      <div class="fc-bar" style="height:${Math.max(2, Math.round((100 * d.count) / maxFc))}%"></div>
      <div class="fc-n">${d.count || ""}</div>
      <div class="fc-d">${i === 0 ? "heute" : day.toLocaleDateString("de-DE", { weekday: "short" })}</div>
    </div>`;
  }).join("");

  const attempts = Object.values(progress).reduce((a, p) => a + (p.attempts || 0), 0);
  const ai = Object.values(progress).filter((p) => p.lastAi != null).map((p) => p.lastAi);
  const seenAll = catalog.filter((q) => !SR.isNew(cards[q.id])).length;
  const matureAll = catalog.filter((q) => SR.isMature(cards[q.id])).length;

  // Die wackeligsten Karten zuerst: geringste Stabilität, dann längste Überfälligkeit.
  const worst = catalog.filter((q) => isWeakCard(q.id))
    .sort((a, b) => (cards[a.id].stability - cards[b.id].stability) || (new Date(cards[a.id].due) - new Date(cards[b.id].due)))
    .slice(0, 25);

  $app.innerHTML = `
    <h1>Statistik</h1>
    <div class="card"><div class="kpis">
      <div class="kpi"><div class="v">${attempts}</div><div class="l">Antworten gesamt</div></div>
      <div class="kpi"><div class="v">${seenAll}</div><div class="l">von ${catalog.length} Fragen begonnen</div></div>
      <div class="kpi"><div class="v">${matureAll}</div><div class="l">reif (hält über 21 Tage)</div></div>
      <div class="kpi"><div class="v">${ai.length ? Math.round(ai.reduce((a, b) => a + b, 0) / ai.length) : "–"}</div><div class="l">Ø letzte KI-Punkte</div></div>
    </div></div>

    <h2>Nach Kompetenzbereich (WBO)</h2>
    <div class="card"><table class="simple">${moduleRows}</table>
      <p class="small muted" style="margin-top:8px">„Reif“ heißt: Die Frage wurde mindestens zweimal beantwortet und zuletzt mindestens gewusst. Eine Frage kann zu beiden Bereichen gehören.</p>
    </div>

    <h2>Wiederholungslast der nächsten 14 Tage</h2>
    <div class="card">
      <div class="forecast">${fcBars}</div>
      <p class="small muted" style="margin-top:8px">Überfällige Karten sind bei „heute“ mitgezählt. Insgesamt ${fc.reduce((a, b) => a + b.count, 0)} Wiederholungen in zwei Wochen.</p>
    </div>

    <h2>Nach Gebiet</h2>
    <div class="card"><table class="simple">${areaRows}</table></div>

    <h2>Wackelt noch (schwächste zuerst)</h2>
    <div class="card">${worst.length ? `<table class="simple">${worst.map((q) => { const c = cards[q.id]; return `<tr><td class="muted">${q.id}</td><td>${esc(idx.areas.find((a) => a.id === q.area)?.short || q.area)}</td><td class="small">hält ${fmtInterval(Math.round(c.stability))}${c.lapses ? ` · ${c.lapses}× vergessen` : ""}</td><td class="small muted">fällig ${fmtDate(c.due)}</td></tr>`; }).join("")}</table><div style="margin-top:10px"><a class="btn primary" href="#/gebiet/_weak">Schwache Fragen üben</a></div>` : '<p class="muted">Nichts Wackeliges – entweder sitzt alles oder es ist noch nichts beantwortet.</p>'}</div>`;
}

async function renderSettings() {
  const health = await loadHealth();
  const idx = await loadIndex();
  await loadCatalog();
  const reviewsPerDay = Number.isFinite(Number(settings.reviewsPerDay)) ? Number(settings.reviewsPerDay) : SR.DEFAULT_REVIEWS_PER_DAY;
  $app.innerHTML = `
    <h1>Einstellungen</h1>
    <div class="card">
      <h3 style="margin-top:0">Lernprofil (Cloud-Sync)</h3>
      <p class="small muted">Dein Fortschritt wird lokal und – über diesen Lerner-Code – in Supabase gespeichert. Trage denselben Code auf einem anderen Gerät ein, um dort weiterzulernen. Behandle den Code wie ein Passwort.</p>
      <label class="field"><span>Lerner-Code</span><div class="row"><input type="text" id="code" value="${esc(settings.learnerCode)}" style="flex:1;font-family:monospace"><button class="btn sm" id="copy">Kopieren</button><button class="btn sm" id="newcode">Neu erzeugen</button></div></label>
      <label class="field"><span>Name (optional)</span><input type="text" id="name" value="${esc(settings.name)}" placeholder="z. B. Dr. Muster"></label>
      <div class="small muted">Sync-Status: ${sb.ok ? "Supabase konfiguriert" : "nicht konfiguriert"}</div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">KI-Bewertung</h3>
      <p class="small muted">Freitext-, Fall- und Rechenantworten werden von Claude wie von einem Mitglied des Prüfungsausschusses bewertet (Punkte, Feedback, fehlende Punkte, Tipps, Nachfrage). Server-Status: ${health.apiKeyConfigured ? `API-Schlüssel hinterlegt, Modell ${esc(health.model)}` : "kein API-Schlüssel hinterlegt (Netlify-Umgebungsvariable ANTHROPIC_API_KEY)"} · ${health.passwordConfigured ? "Zugangscode auf dem Server gesetzt" : "kein Zugangscode gesetzt – die KI-Endpunkte sind deshalb gesperrt"}${health.rateLimitPerHour ? ` · höchstens ${health.rateLimitPerHour} Anfragen pro Stunde` : ""}.</p>
      <label class="toggle"><input type="checkbox" id="ai" ${settings.ai ? "checked" : ""}> KI-Bewertung verwenden</label>
      <label class="field" style="margin-top:10px"><span>Zugangscode (Pflicht – entspricht der Netlify-Variable APP_PASSWORD)</span><input type="password" id="appkey" value="${esc(settings.appKey)}" autocomplete="off"></label>
      <label class="toggle" style="margin-top:8px"><input type="checkbox" id="oralspeak" ${settings.oralSpeak ? "checked" : ""}> Im Prüfungsgespräch die Fragen des Prüfers vorlesen lassen</label>
      <div class="small muted">Stimme: ${health.tts ? "ElevenLabs (auf dem Server eingerichtet)" : "die beste deutsche Stimme dieses Browsers – für eine natürlichere Stimme ELEVENLABS_API_KEY auf dem Server setzen"}.</div>
      ${health.apiKeyConfigured && health.passwordConfigured && !settings.appKey ? '<div class="notice warn small">Ohne Zugangscode antwortet der Server mit 401 und es gibt keine KI-Bewertung.</div>' : ""}
    </div>
    <div class="card">
      <h3 style="margin-top:0">Lernplan und Wiedervorlage</h3>
      <p class="small muted">Die Wiedervorlage rechnet mit FSRS. Das größtmögliche Intervall wird auf die verbleibende Zeit bis zur Prüfung begrenzt – was danach fällig würde, hilft für die Prüfung nicht mehr.</p>
      <p class="small muted">Mindestabstand bis zur nächsten Vorlage, je nachdem wie die Frage gelaufen ist: ${[SR.Rating.Good, SR.Rating.Easy, SR.Rating.Hard, SR.Rating.Again].map((r) => `${SR.RATING_LABEL[r]} ${SR.MIN_DAYS[r]} Tage`).join(" · ")}. Was länger sitzt, bekommt von FSRS längere Abstände; kürzer wird es nicht.</p>
      <div class="row">
        <label class="field" style="flex:1"><span>Prüfungstermin</span><input type="date" id="examdate" value="${esc(settings.examDate)}"></label>
        <label class="field" style="flex:1"><span>Neue Fragen pro Tag</span><input type="number" id="newperday" min="1" max="200" value="${Number(settings.newPerDay) || SR.DEFAULT_NEW_PER_DAY}"></label>
        <label class="field" style="flex:1"><span>Wiederholungen je Tagessitzung</span><input type="number" id="reviewsperday" min="0" max="200" value="${reviewsPerDay}"></label>
      </div>
      <p class="small muted">Nur so viele Wiederholungen werden unter die neuen Fragen gestreut. Alles darüber bleibt liegen und wartet unter <a href="#/gebiet/_due">Nur Wiederholungsfragen</a> – so wächst die Tagessitzung nicht über den Kopf.</p>
      <div class="small muted" id="quota-hint"></div>
      <div class="field" style="margin-top:12px"><span>Nur diese Kompetenzbereiche üben (nichts angehakt = alle)</span>
        <div class="grid-inline">${Object.entries(idx.exam).map(([k, v]) => `<label class="toggle small" title="${esc(v)}"><input type="checkbox" name="module" value="${k}" ${settings.modules?.includes(k) ? "checked" : ""}> ${k} – ${esc(v)}</label>`).join("")}</div>
      </div>
      <div class="field" style="margin-top:10px"><span>Nur diese Lernplan-Blöcke üben (nichts angehakt = alle)</span>
        <div class="stack">${Object.entries(idx.blocks || {}).map(([k, v]) => `<label class="toggle small"><input type="checkbox" name="block" value="${k}" ${settings.blocks?.includes(k) ? "checked" : ""}> ${esc(v)}</label>`).join("")}</div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Daten</h3>
      <div class="row">
        <button class="btn" id="sync">Jetzt aus der Cloud laden</button>
        <button class="btn danger" id="reset">Lokalen Fortschritt löschen</button>
      </div>
      <p class="small muted" style="margin-top:8px">Gespeichert sind ${Object.keys(cards).length} Karten und ${Object.keys(progress).length} Fragen mit Fortschritt.</p>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn primary" id="save">Speichern</button></div>`;

  /** Zeigt live, wie viele neue Fragen pro Tag der Termin verlangt. */
  const updateQuotaHint = () => {
    const examDate = document.getElementById("examdate").value || SR.DEFAULT_EXAM_DATE;
    const configured = Number(document.getElementById("newperday").value) || SR.DEFAULT_NEW_PER_DAY;
    const reviews = Math.max(0, Number(document.getElementById("reviewsperday").value) || 0);
    const days = SR.daysUntil(examDate);
    const fresh = (state.catalog || []).filter((q) => SR.isNew(cards[q.id])).length;
    const need = SR.newPerDay({ remainingNew: fresh, examDate, configured });
    document.getElementById("quota-hint").textContent = days > 0
      ? `${days} Lerntage bis zur Prüfung, ${fresh} Fragen noch nie beantwortet – nötig sind mindestens ${need} neue Fragen pro Tag. Eine Tagessitzung umfasst damit rund ${need + reviews} Fragen.`
      : "Der eingetragene Termin liegt in der Vergangenheit.";
  };
  document.getElementById("examdate").addEventListener("change", updateQuotaHint);
  document.getElementById("reviewsperday").addEventListener("input", updateQuotaHint);
  document.getElementById("newperday").addEventListener("input", updateQuotaHint);
  updateQuotaHint();
  document.getElementById("copy").addEventListener("click", () => navigator.clipboard?.writeText(document.getElementById("code").value));
  document.getElementById("newcode").addEventListener("click", () => { if (confirm("Neuen Code erzeugen? Der bisherige Cloud-Fortschritt ist dann nur noch über den alten Code erreichbar.")) document.getElementById("code").value = randomCode(); });
  document.getElementById("save").addEventListener("click", async () => {
    const code = document.getElementById("code").value.trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) { alert("Lerner-Code: 16–64 Zeichen (Buchstaben, Ziffern, - _)."); return; }
    const changed = code !== settings.learnerCode;
    settings.learnerCode = code; settings.name = document.getElementById("name").value.trim(); settings.ai = document.getElementById("ai").checked; settings.appKey = document.getElementById("appkey").value;
    settings.oralSpeak = document.getElementById("oralspeak").checked;
    settings.examDate = document.getElementById("examdate").value || SR.DEFAULT_EXAM_DATE;
    settings.newPerDay = Math.max(1, Number(document.getElementById("newperday").value) || SR.DEFAULT_NEW_PER_DAY);
    const reviews = Number(document.getElementById("reviewsperday").value);
    settings.reviewsPerDay = Number.isFinite(reviews) ? Math.max(0, Math.min(200, reviews)) : SR.DEFAULT_REVIEWS_PER_DAY;
    settings.modules = [...document.querySelectorAll('input[name="module"]:checked')].map((el) => el.value);
    settings.blocks = [...document.querySelectorAll('input[name="block"]:checked')].map((el) => el.value);
    saveSettings();
    if (changed) { progress = {}; saveProgress(); cards = {}; saveCards(); }
    await syncFromCloud();
    location.hash = "#/";
  });
  document.getElementById("sync").addEventListener("click", async () => { await syncFromCloud(); alert("Fortschritt aktualisiert."); });
  document.getElementById("reset").addEventListener("click", () => { if (confirm("Lokalen Fortschritt und alle Karten wirklich löschen? (Cloud-Daten bleiben erhalten.)")) { progress = {}; saveProgress(); cards = {}; saveCards(); alert("Gelöscht."); } });
}

async function renderExamInfo() {
  const idx = await loadIndex();
  const r = await fetch("data/pruefungsordnung.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("Prüfungsordnung nicht gefunden – wurde `npm run build` ausgeführt?");
  const po = await r.json();
  const list = (items) => `<ul>${items.map((x) => `<li>${md(x).replace(/^<div class="md"><p>|<\/p><\/div>$/g, "")}</li>`).join("")}</ul>`;
  const contents = po.contents.map((g) => `<h3>${esc(g.group)}</h3>
    <table class="simple wbo">${g.items.map((it) => `<tr><td><span class="badge ${it.kind === "K" ? "" : "primary"}" title="${esc(idx.exam[it.kind === "K" ? "KM" : "HK"] || "")}">${it.kind === "K" ? "KM" : "HK"}</span></td><td>${esc(it.text)}</td><td class="small muted">${it.rz ? `Richtzahl ${esc(it.rz)}` : ""}</td><td class="small">${(it.areas || []).map((id) => { const a = idx.areas.find((x) => x.id === id); return a ? `<a href="#/gebiet/${a.id}">${esc(a.short)}</a>` : ""; }).join(" · ")}</td></tr>`).join("")}</table>`).join("");
  $app.innerHTML = `
    <h1>${esc(po.title)}</h1>
    <p class="muted">${esc(po.subtitle)}</p>
    <div class="card">
      <h3 style="margin-top:0">Eckdaten</h3>
      <table class="simple">${po.facts.map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td>${md(v)}</td></tr>`).join("")}</table>
    </div>
    <h2>Ablauf der Prüfung</h2>
    <div class="card">
      <table class="simple">${po.procedure.map((p) => `<tr><td class="small muted" style="white-space:nowrap">${esc(p.ref)}</td><td>${md(p.text)}</td></tr>`).join("")}</table>
    </div>
    <h2>Am Prüfungstag</h2>
    <div class="card">${list(po.examDay)}</div>
    <h2>Weiterbildungsinhalte Schwerpunkt Neonatologie</h2>
    <div class="card">
      <p class="small muted">${esc(po.contentsNote)}</p>
      ${contents}
    </div>
    <h2>Tipps für das Prüfungsgespräch</h2>
    <div class="card">${list(po.tips)}</div>
    <h2>Zuordnung der Quiz-Gebiete</h2>
    <div class="card"><table class="simple">${idx.areas.map((a) => `<tr><td>${a.order}. <a href="#/gebiet/${a.id}">${esc(a.title)}</a></td><td class="muted small">${esc(a.chapter)}</td><td>${a.count} Fragen</td></tr>`).join("")}</table></div>
    <p class="small muted">Quellen: ${po.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(" · ")}. Stand: ${esc(po.asOf)}.</p>`;
}

/* ---------- Start ---------- */
(async () => {
  await syncFromCloud();
  await router();
})();
