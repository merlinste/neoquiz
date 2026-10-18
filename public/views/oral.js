/**
 * Mündliche Prüfung Schwerpunkt Neonatologie (Landesärztekammer Hessen).
 *
 * Claude tritt über /api/oral als Prüfungsausschuss auf: Fall oder Frage, zwei
 * bis drei Nachfragen, Themenwechsel. Am Ende gibt es ein Protokoll; die dort
 * genannten Fragen werden in der Wiedervorlage auf fällig gesetzt.
 */
import * as SR from "../lib/cards.js";
import { collectSpeech, pickGermanVoice } from "../lib/speech.js";

export const ORAL_MODES = {
  PG: {
    minutes: 30, title: "Prüfungsgespräch (Simulation der Schwerpunktprüfung)",
    hint: "Mindestens 30 Minuten wie in § 14 WBO Hessen. Drei Prüfer, Themen quer durch die Weiterbildungsinhalte – meist ausgehend von Fällen aus Kreißsaal und Intensivstation.",
  },
  FALL: {
    minutes: 15, title: "Kurzes Fallgespräch",
    hint: "Etwa 15 Minuten, ein bis zwei Fälle, dafür in die Tiefe: Erstmaßnahmen, Diagnostik, Differenzialdiagnosen, Therapie, Komplikationen, Elterngespräch.",
  },
};

/** mm:ss beziehungsweise h:mm:ss. */
export function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

const LS_KEY = "oral";
const MAX_ANCHORS = 12;

export function createOralView(ctx) {
  const { $app, esc, md, LS, settings } = ctx;

  const load = () => LS.get(LS_KEY, null);
  const save = (s) => LS.set(LS_KEY, s);
  const clear = () => LS.set(LS_KEY, null);

  /** Spracherkennung, falls der Browser sie anbietet. */
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  /** true, solange der Nutzer die Aufnahme eingeschaltet hat (auch über automatische Neustarts hinweg). */
  let micWanted = false;

  /** Aufnahme beenden. Mit `discard` werden noch ausstehende Ergebnisse verworfen (z. B. nach dem Absenden). */
  function stopMic(discard = false) {
    micWanted = false;
    if (recognition) {
      const r = recognition;
      recognition = null;
      if (discard) { r.onresult = null; r.abort(); } else r.stop();
    }
    document.getElementById("oral-mic")?.classList.remove("active");
  }

  /*
   * Sprachausgabe: bevorzugt ElevenLabs über /api/tts, sonst die beste deutsche
   * Stimme des Browsers. Ein einziges Audio-Element für alle Züge, weil iOS nur
   * Elemente abspielt, die einmal in einer Nutzeraktion gestartet wurden.
   */
  const audio = new Audio();
  /** Text → Blob-URL, damit „nochmal anhören“ nicht erneut bezahlt wird. */
  const voiceCache = new Map();
  const VOICE_CACHE_MAX = 30;
  /** 20 ms Stille, damit sich das Element in einer Nutzeraktion freischalten lässt. */
  const SILENCE = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
  let ttsAvailable = false;
  let audioUnlocked = false;
  /** Zählt jede neue Ausgabe hoch; eine verspätete Antwort von /api/tts spielt dann nicht mehr los. */
  let speakSeq = 0;

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    if (!audio.paused) return; // spielt schon – nicht den laufenden Prüfer abschneiden
    audio.src = SILENCE;
    audio.play().catch(() => {});
  }

  function stopSpeaking() {
    speakSeq++;
    audio.pause();
    window.speechSynthesis?.cancel();
  }

  /**
   * Themenanker: bevorzugt wackelige und fällige Fragen, damit das Gespräch
   * dort hingeht, wo es noch klemmt. Das Fallgespräch nimmt nur Fragen ab
   * Schwierigkeit 2, damit genug Stoff für Nachfragen da ist.
   */
  async function pickAnchors(mode) {
    const catalog = await ctx.loadCatalog();
    const cards = ctx.getCards();
    const pool = mode === "FALL" ? catalog.filter((q) => q.difficulty >= 2 || q.type === "case") : catalog;
    const score = (q) => {
      const c = cards[q.id];
      if (!c || SR.isNew(c)) return 1.5;
      if (SR.isDue(c)) return 2.5;
      return SR.isMature(c) ? 0.4 : 1.2;
    };
    return ctx.shuffle(pool).sort((a, b) => score(b) * Math.random() - score(a) * Math.random()).slice(0, MAX_ANCHORS).map((q) => q.id);
  }

  const headers = () => ({ "Content-Type": "application/json", ...(settings.appKey ? { "x-app-key": settings.appKey } : {}) });
  const apiError = (data, status) => { const err = new Error(data.error || `HTTP ${status}`); err.code = data.code; return err; };

  async function callOral(body) {
    const r = await fetch(ctx.oralEndpoint, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...body, learnerCode: settings.learnerCode }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw apiError(data, r.status);
    return data;
  }

  /**
   * Protokoll im Hintergrund erstellen lassen. Es dauert länger, als eine normale
   * Server-Funktion laufen darf; deshalb startet der Client einen Hintergrundjob
   * und fragt das Ergebnis über /api/oral?job= ab.
   */
  async function startProtocolJob(jobId, body) {
    const r = await fetch(ctx.oralProtocolEndpoint, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...body, jobId, learnerCode: settings.learnerCode }),
    });
    if (r.status !== 202 && !r.ok) throw apiError(await r.json().catch(() => ({})), r.status);
  }

  const POLL_MS = 4000;
  const POLL_LIMIT_MS = 10 * 60000;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  async function waitForProtocol(jobId, isCurrent) {
    const until = Date.now() + POLL_LIMIT_MS;
    while (Date.now() < until) {
      await sleep(POLL_MS);
      if (!isCurrent()) return null;
      let r;
      try { r = await fetch(`${ctx.oralEndpoint}?job=${encodeURIComponent(jobId)}`, { headers: headers(), cache: "no-store" }); }
      catch { continue; } // kurzer Netzaussetzer – weiter warten
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status >= 500) continue;
        throw apiError(data, r.status);
      }
      if (data.status !== "done") continue;
      if (data.httpStatus >= 400) throw apiError(data, data.httpStatus);
      return data;
    }
    throw new Error("Das Protokoll ist nach zehn Minuten noch nicht fertig. Bitte später noch einmal auf „Gespräch beenden“ klicken.");
  }

  let tick = null;
  const stopTick = () => { if (tick) { clearInterval(tick); tick = null; } };

  /* ------------------------------------------------------------------ Ansicht */
  /** Auswahl: Prüfungsgespräch oder kurzes Fallgespräch. */
  async function renderPicker(health) {
    const running = load();
    $app.innerHTML = `
      <h1>Mündliche Prüfung üben</h1>
      <p class="muted">Die Schwerpunktprüfung Neonatologie ist bei der Landesärztekammer Hessen eine mündliche Prüfung vor einem Ausschuss aus drei Ärztinnen und Ärzten (Vorsitz und zwei Fachprüfer), mindestens 30 Minuten, nicht öffentlich. Hier übernimmt Claude den Ausschuss. Sprechen ist erlaubt und erwünscht: Mit 🎤 diktierst du deine Antworten.</p>
      ${health.ai ? "" : `<div class="notice warn">Die Prüfungssimulation braucht die KI. ${esc(ctx.aiStatusText(health))} <a href="#/einstellungen">Einstellungen öffnen</a></div>`}
      ${running?.mode && ORAL_MODES[running.mode] && !running.protocol ? `<div class="notice small">Ein ${esc(ORAL_MODES[running.mode].title)} läuft noch. <a href="#/pruefung/${running.mode}">Fortsetzen</a></div>` : ""}
      <div class="grid">${Object.entries(ORAL_MODES).map(([k, m]) => `
        <div class="card area-card ${health.ai ? "" : "disabled"}" ${health.ai ? `data-go="#/pruefung/${k}" role="button" tabindex="0"` : ""}>
          <div class="row between"><span class="title">${esc(m.title)}</span><span class="badge">${m.minutes} min</span></div>
          <div class="desc">${esc(m.hint)}</div>
        </div>`).join("")}</div>
      <p class="small muted"><a href="#/pruefungsordnung">Was die Prüfungsordnung sagt →</a></p>`;
    $app.querySelectorAll("[data-go]").forEach((el) => {
      const go = () => (location.hash = el.dataset.go);
      el.addEventListener("click", go); el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  async function renderOral([modeArg]) {
    const health = await ctx.loadHealth();
    if (!ORAL_MODES[modeArg] || !health.ai) return renderPicker(health);
    const mode = modeArg;
    const cfg = ORAL_MODES[mode];
    let session = load();
    if (session && session.mode !== mode) session = null;
    ttsAvailable = Boolean(health.tts);

    $app.innerHTML = `
      <div class="exam-head">
        <div>
          <div class="small muted">${esc(cfg.title)}</div>
          <div class="clock" id="oral-clock">${fmtClock(cfg.minutes * 60000)}</div>
        </div>
        <div class="row">
          <button class="btn ghost sm" id="oral-restart">Neu beginnen</button>
          <button class="btn danger sm" id="oral-finish" ${session ? "" : "disabled"}>Gespräch beenden</button>
        </div>
      </div>
      <p class="small muted">${esc(cfg.hint)} Der Ausschuss stellt einen Fall oder eine Frage, hakt zwei- bis dreimal nach und wechselt dann das Thema. Bewertet wird erst im Protokoll am Ende.</p>
      <div id="oral-topics" class="task-bar"></div>
      <div class="card"><div id="oral-log" class="oral-log"></div></div>
      <div class="card" id="oral-input">
        <textarea id="oral-answer" rows="4" placeholder="Deine Antwort – so, wie du sie im Gespräch sagen würdest …"></textarea>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" id="oral-send">Antworten</button>
          ${SpeechRec ? '<button class="btn" id="oral-mic" title="Spracheingabe (de-DE)">🎤 Sprechen</button>' : '<span class="small muted">Spracheingabe wird von diesem Browser nicht unterstützt – bitte tippen.</span>'}
          <span class="small muted" id="oral-state"></span>
        </div>
      </div>
      <div id="oral-protocol"></div>`;

    const $log = document.getElementById("oral-log");
    const $topics = document.getElementById("oral-topics");
    const $answer = document.getElementById("oral-answer");
    const $state = document.getElementById("oral-state");

    const renderLog = () => {
      $log.innerHTML = (session?.transcript || []).map((t, i) => `
        <div class="turn ${t.role}">
          <div class="who">${t.role === "pruefer" ? `Prüfer <button class="say-again" data-i="${i}" title="Nochmal anhören" aria-label="Nochmal anhören">🔊</button>` : "Du"}</div>
          <div class="what">${md(t.text)}</div>
        </div>`).join("") || '<p class="muted">Das Gespräch beginnt gleich …</p>';
      $topics.innerHTML = (session?.topics || []).map((t) => `<span class="badge">${esc(t)}</span>`).join("");
      $log.scrollTop = $log.scrollHeight;
      document.getElementById("oral-finish").disabled = !session || !session.transcript.length;
    };

    const busy = (on, text = "") => {
      document.getElementById("oral-send").disabled = on;
      $answer.disabled = on;
    document.getElementById("oral-mic")?.toggleAttribute("disabled", on);
      $state.innerHTML = on ? `<span class="spinner"></span> ${esc(text)}` : esc(text);
    };

    /* ------------------------------------------------------------- Gesprächszüge */
    async function startConversation() {
      const anchorIds = await pickAnchors(mode);
      session = { mode, startedAt: new Date().toISOString(), anchorIds, transcript: [], topics: [], scores: [] };
      save(session);
      renderLog();
      busy(true, "Der Prüfer eröffnet das Gespräch …");
      try {
        const { turn } = await callOral({ mode, action: "start", anchorIds, transcript: [] });
        applyTurn(turn);
      } catch (e) { showError(e); return; }
      busy(false);
      $answer.focus();
    }

    // Der Server nimmt höchstens 120 Minuten an; ein über Nacht offenes Gespräch soll trotzdem ein Protokoll bekommen.
    const elapsedMin = () => Math.min(120, Math.round((Date.now() - new Date(session.startedAt)) / 60000));

    function applyTurn(turn) {
      session.transcript.push({ role: "pruefer", text: turn.say });
      session.topics = turn.coveredTopics?.length ? turn.coveredTopics : session.topics;
      if (turn.lastAnswerScore != null) session.scores.push(turn.lastAnswerScore);
      save(session);
      renderLog();
      speak(turn.say);
    }

    async function sendAnswer() {
      const text = $answer.value.trim();
      if (!text) { alert("Bitte zuerst antworten – tippen oder sprechen."); return; }
      // Aufnahme beenden, sonst schreibt die Erkennung die alte Antwort wieder ins Feld.
      stopMic(true);
      stopSpeaking();
      unlockAudio();
      session.transcript.push({ role: "kandidat", text });
      session.draft = "";
      save(session);
      $answer.value = "";
      renderLog();
      busy(true, "Der Prüfer hört zu …");
      try {
        const { turn } = await callOral({ mode, action: "answer", anchorIds: session.anchorIds, transcript: session.transcript, elapsedMinutes: elapsedMin() });
        applyTurn(turn);
      } catch (e) { showError(e); return; }
      busy(false);
      $answer.focus();
    }

    async function finishConversation() {
      if (!session?.transcript.length) return;
      if (!confirm("Gespräch beenden und Protokoll erstellen?")) return;
      stopTick();
      stopMic(true);
      busy(true, "Der Prüfer schreibt das Protokoll …");
      try {
        const jobId = crypto.randomUUID();
        session.endedMinutes = elapsedMin();
        await startProtocolJob(jobId, { mode, action: "finish", anchorIds: session.anchorIds, transcript: session.transcript, elapsedMinutes: session.endedMinutes });
        session.protocolJob = jobId;
        save(session);
        await collectProtocol();
      } catch (e) { showError(e); }
    }

    /** Wartet auf das Protokoll des laufenden Hintergrundjobs – auch nach einem Neuladen der Seite. */
    async function collectProtocol() {
      const s = session;
      busy(true, "Der Prüfer schreibt das Protokoll … das dauert meist ein bis zwei Minuten.");
      document.getElementById("oral-finish").disabled = true;
      document.getElementById("oral-protocol").innerHTML = "";
      try {
        const data = await waitForProtocol(s.protocolJob, () => session === s && document.body.contains($answer));
        if (!data) return;
        const { protocol, model } = data;
        session.protocol = protocol; session.model = model; session.finishedAt = new Date().toISOString();
        delete session.protocolJob;
        save(session);
        // Genannte Fragen auf fällig setzen, damit sie in der Wiedervorlage wieder auftauchen.
        for (const id of protocol.reviewQuestionIds || []) ctx.markDue(id);
        renderProtocol(protocol, model);
      } catch (e) {
        if (session === s) { delete session.protocolJob; save(session); }
        showError(e);
        return;
      }
      busy(false);
    }

    function renderProtocol(p, model) {
      document.getElementById("oral-input").style.display = "none";
      document.getElementById("oral-protocol").innerHTML = `
        <h2>Protokoll</h2>
        <div class="card">
          <div class="kpis">
            <div class="kpi"><div class="v" style="color:${p.passed ? "var(--ok)" : "var(--danger)"}">${p.passed ? "bestanden" : "nicht bestanden"}</div><div class="l">Einschätzung · ${Number(p.overallScore) || 0} / 100</div></div>
            <div class="kpi"><div class="v">${p.topics.length}</div><div class="l">Themen besprochen</div></div>
            <div class="kpi"><div class="v">${session.endedMinutes ?? elapsedMin()}</div><div class="l">von ${ORAL_MODES[mode].minutes} min</div></div>
            <div class="kpi"><div class="v">${(p.reviewQuestionIds || []).length}</div><div class="l">Fragen zum Nachlernen</div></div>
          </div>
          <div class="notice small" style="margin-top:10px">Die Prüfung kennt keine Noten, nur „bestanden“ oder „nicht bestanden“ (§§ 14, 15 WBO Hessen). Die Einschätzung hier ist eine Simulation, keine Vorhersage.</div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Gesamteindruck</h3>
          ${md(p.summary || "")}
          ${p.strengths?.length ? `<div class="small"><strong>Stärken:</strong><ul>${p.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
          ${p.gaps?.length ? `<div class="small"><strong>Lücken:</strong><ul>${p.gaps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
          <div class="small muted">${esc(model || "")}</div>
        </div>
        <h3>Themen</h3>
        <div class="card"><table class="simple">${p.topics.map((t) => `<tr><td>${esc(t.topic)}</td><td class="small">${esc(t.assessment)}</td><td><span class="badge ${t.score >= 80 ? "ok" : t.score >= 50 ? "mid" : "bad"}">${t.score}</span></td></tr>`).join("")}</table></div>
        ${(p.reviewQuestionIds || []).length ? `<h3>Zum Nachlernen</h3>
        <div class="card"><p class="small muted">Diese Fragen sind jetzt in der Wiedervorlage fällig:</p>
          <div class="grid-inline">${p.reviewQuestionIds.map((id) => `<span class="badge">${esc(id)}</span>`).join("")}</div>
          <div class="row" style="margin-top:10px"><a class="btn primary" href="#/gebiet/_due">Fällige Fragen üben</a></div>
        </div>` : ""}
        <div class="row" style="margin-top:14px">
          <button class="btn" id="oral-again">Noch ein Gespräch</button>
          <a class="btn ghost" href="#/pruefung/">Zur Auswahl</a>
        </div>
        <details style="margin-top:14px"><summary class="small muted">Transkript</summary>
          <div class="card">${session.transcript.map((t) => `<p class="small"><strong>${t.role === "pruefer" ? "Prüfer" : "Du"}:</strong> ${esc(t.text)}</p>`).join("")}</div>
        </details>`;
      document.getElementById("oral-again").addEventListener("click", () => { clear(); renderOral([mode]); });
    }

    function showError(e) {
      busy(false);
      document.getElementById("oral-finish").disabled = !session?.transcript.length;
      $state.innerHTML = "";
      document.getElementById("oral-protocol").innerHTML =
        `<div class="notice err small">Prüfungsgespräch nicht möglich: ${esc(e.message)}${e.code === "unauthorized" ? ' – Zugangscode in den <a href="#/einstellungen">Einstellungen</a> eintragen.' : ""}</div>`;
    }

    /* --------------------------------------------------------------- Sprachaus- und -eingabe */
    async function fetchVoice(text) {
      if (voiceCache.has(text)) return voiceCache.get(text);
      const r = await fetch(ctx.ttsEndpoint, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ text, learnerCode: settings.learnerCode }),
      });
      if (!r.ok) throw apiError(await r.json().catch(() => ({})), r.status);
      const url = URL.createObjectURL(await r.blob());
      voiceCache.set(text, url);
      if (voiceCache.size > VOICE_CACHE_MAX) {
        const [oldest, oldUrl] = voiceCache.entries().next().value;
        voiceCache.delete(oldest);
        URL.revokeObjectURL(oldUrl);
      }
      return url;
    }

    /** `force` liest auch vor, wenn das Vorlesen in den Einstellungen aus ist (Klick auf 🔊). */
    async function speak(text, force = false) {
      if (!text || (!settings.oralSpeak && !force)) return;
      stopSpeaking();
      const seq = speakSeq;
      if (ttsAvailable) {
        try {
          const url = await fetchVoice(text);
          if (seq !== speakSeq) return;
          audio.src = url;
          await audio.play();
          return;
        } catch (e) {
          if (seq !== speakSeq) return;
          // Ohne Schlüssel oder Zugang bringt ein neuer Versuch nichts; bis zum nächsten Aufruf der Ansicht nur noch die Browserstimme.
          if (e.code === "no_tts" || e.code === "unauthorized") ttsAvailable = false;
          console.warn("[tts]", e.message);
        }
      }
      browserSpeak(text);
    }

    function browserSpeak(text) {
      if (!window.speechSynthesis) return;
      try {
        const u = new SpeechSynthesisUtterance(text);
        const voice = pickGermanVoice(window.speechSynthesis.getVoices());
        u.lang = voice?.lang || "de-DE";
        if (voice) u.voice = voice;
        window.speechSynthesis.speak(u);
      } catch { /* Sprachausgabe ist Beiwerk */ }
    }

    $log.addEventListener("click", (e) => {
      const btn = e.target.closest(".say-again");
      if (!btn) return;
      unlockAudio();
      speak(session?.transcript[Number(btn.dataset.i)]?.text, true);
    });
    document.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });

    /**
     * Chrome beendet die Erkennung nach Sprechpausen von selbst (auf Android nach
     * jedem Satz). Solange die Aufnahme gewollt ist, wird sie neu gestartet; der
     * bereits erkannte Text steht dann schon im Feld und bleibt erhalten.
     */
    function startRecognition() {
      const rec = new SpeechRec();
      rec.lang = "de-DE";
      rec.continuous = true;
      rec.interimResults = true;
      const before = $answer.value.trim();
      rec.onresult = (ev) => {
        const txt = collectSpeech(ev.results);
        $answer.value = [before, txt].filter(Boolean).join(" ");
        saveDraft();
      };
      rec.onerror = (ev) => {
        if (ev.error === "no-speech" || ev.error === "aborted") return;
        micWanted = false;
        $state.textContent = ev.error === "not-allowed" || ev.error === "service-not-allowed"
          ? "Mikrofon nicht freigegeben – bitte im Browser erlauben oder tippen."
          : "Spracheingabe nicht möglich – bitte tippen.";
      };
      rec.onend = () => {
        if (recognition !== rec) return;
        recognition = null;
        if (micWanted && document.body.contains($answer) && !$answer.disabled) {
          try { startRecognition(); return; } catch { /* fällt unten auf aus */ }
        }
        stopMic();
      };
      recognition = rec;
      rec.start();
    }

    document.getElementById("oral-mic")?.addEventListener("click", () => {
      if (micWanted) { stopMic(); $state.textContent = ""; return; }
      stopSpeaking();
      micWanted = true;
      try { startRecognition(); } catch { stopMic(); $state.textContent = "Spracheingabe nicht möglich – bitte tippen."; return; }
      document.getElementById("oral-mic").classList.add("active");
      $state.textContent = "Höre zu … nochmal tippen beendet die Aufnahme.";
    });

    /* Entwurf sichern, damit eine Antwort beim Neuladen oder Seitenwechsel nicht verloren geht. */
    function saveDraft() {
      if (!session || session.protocol) return;
      session.draft = $answer.value;
      save(session);
    }
    $answer.addEventListener("input", saveDraft);

    document.getElementById("oral-send").addEventListener("click", sendAnswer);
    $answer.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendAnswer(); } });
    document.getElementById("oral-finish").addEventListener("click", finishConversation);
    document.getElementById("oral-restart").addEventListener("click", () => { if (confirm("Gespräch verwerfen und neu beginnen?")) { clear(); renderOral([mode]); } });

    /* ------------------------------------------------------------------- Uhr */
    stopTick();
    stopMic(true);
    const update = () => {
      const $c = document.getElementById("oral-clock");
      if (!$c || !session) { stopTick(); return; }
      const left = new Date(session.startedAt).getTime() + ORAL_MODES[mode].minutes * 60000 - Date.now();
      $c.textContent = fmtClock(left);
      $c.className = "clock" + (left <= 3 * 60000 ? " danger" : left <= 8 * 60000 ? " warn" : "");
      if (left <= 0 && !session.protocol) { stopTick(); $state.textContent = "Die Zeit ist um – beende das Gespräch für das Protokoll."; }
    };

    if (session?.protocol) {
      renderLog();
      renderProtocol(session.protocol, session.model);
    } else if (session?.protocolJob) {
      renderLog();
      collectProtocol();
    } else if (session?.transcript.length) {
      renderLog();
      $answer.value = session.draft || "";
      update(); tick = setInterval(update, 1000);
      $answer.focus();
    } else {
      await startConversation();
      update(); tick = setInterval(update, 1000);
    }
    window.addEventListener("hashchange", () => { stopTick(); stopMic(true); stopSpeaking(); }, { once: true });
  }

  return { renderOral };
}
