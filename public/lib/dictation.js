/**
 * Diktat über /api/stt (ElevenLabs Scribe): Der Browser nimmt auf, nach dem
 * Stopp geht die Aufnahme an den Server, der erkannte Text wird an das
 * Antwortfeld angehängt.
 */

/** Opus in WebM (Chrome, Firefox, Edge) oder AAC in MP4 (Safari, iOS). */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
export const MAX_RECORD_MS = 5 * 60000;
/** Kürzere Aufnahmen enthalten nur ein Klicken – nicht hochladen. */
const MIN_BYTES = 2000;

export const canRecord = () => typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

export function pickMimeType(isSupported = (t) => MediaRecorder.isTypeSupported(t)) {
  return MIME_TYPES.find((t) => { try { return isSupported(t); } catch { return false; } }) || "";
}

/** Hängt erkannten Text an vorhandenen an, mit genau einem Leerzeichen dazwischen. */
export const appendText = (before, add) => [before.trimEnd(), add.trim()].filter(Boolean).join(" ");

export const fmtDuration = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/**
 * Eine Aufnahme mit Upload. `onState(state, info)` meldet "recording" (info =
 * Millisekunden), "processing", "idle" und "error" (info = Meldung).
 * `alive()` wird während der Aufnahme geprüft; liefert es false (Feld weg oder
 * gesperrt), wird die Aufnahme verworfen.
 */
export function createRecorder({ endpoint, headers, onText, onState, alive = () => true }) {
  let rec = null, stream = null, chunks = [], timer = null, startedAt = 0, starting = false, processing = false;

  const release = () => {
    clearInterval(timer); timer = null;
    stream?.getTracks().forEach((t) => t.stop()); stream = null;
    rec = null;
  };

  async function start() {
    if (rec || starting || processing) return;
    starting = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      starting = false;
      onState("error", e?.name === "NotAllowedError" ? "Mikrofon nicht freigegeben – bitte im Browser erlauben." : "Kein Mikrofon verfügbar.");
      return;
    }
    starting = false;
    const mimeType = pickMimeType();
    rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start(1000);
    startedAt = Date.now();
    onState("recording", 0);
    timer = setInterval(() => {
      if (!alive()) { stop(true); return; }
      const ms = Date.now() - startedAt;
      onState("recording", ms);
      if (ms >= MAX_RECORD_MS) stop();
    }, 500);
  }

  /** Beendet die Aufnahme; ohne `discard` wird sie erkannt. */
  function stop(discard = false) {
    if (!rec) return;
    const r = rec, got = chunks;
    r.onstop = discard ? null : () => upload(new Blob(got, { type: r.mimeType || got[0]?.type || "audio/webm" }));
    try { r.stop(); } catch { /* schon gestoppt */ }
    release();
    if (discard) onState("idle");
  }

  async function upload(blob) {
    if (blob.size < MIN_BYTES) { onState("idle"); return; }
    processing = true;
    onState("processing");
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers(), "Content-Type": blob.type.split(";")[0] },
        body: blob,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      processing = false;
      onState("idle");
      if (data.text && alive()) onText(data.text);
    } catch (e) {
      processing = false;
      onState("error", `Diktat nicht erkannt: ${e.message}`);
    }
  }

  return {
    start, stop,
    toggle: () => (rec ? stop() : start()),
    /** true, solange aufgenommen oder erkannt wird. */
    get busy() { return Boolean(rec) || starting || processing; },
  };
}

/**
 * Setzt hinter ein Textfeld einen Knopf „🎤 Diktieren“. Der erkannte Text wird
 * angehängt und als `input`-Ereignis gemeldet, damit Entwürfe gespeichert werden.
 */
export function attachDictation(textarea, { endpoint, headers }) {
  const bar = document.createElement("div");
  bar.className = "dictate-bar";
  bar.innerHTML = `<button type="button" class="btn sm dictate" title="Antwort einsprechen – der Text erscheint nach „Fertig“ im Feld">🎤 Diktieren</button><span class="small muted dictate-state"></span>`;
  textarea.insertAdjacentElement("afterend", bar);
  const $btn = bar.querySelector("button"), $state = bar.querySelector(".dictate-state");

  const ctl = createRecorder({
    endpoint, headers,
    alive: () => document.body.contains(textarea) && !textarea.disabled,
    onText: (text) => {
      textarea.value = appendText(textarea.value, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
    },
    onState: (state, info) => {
      $btn.classList.toggle("active", state === "recording");
      $btn.disabled = state === "processing";
      $btn.textContent = state === "recording" ? `⏹ Fertig ${fmtDuration(info)}` : state === "processing" ? "⏳ Erkenne …" : "🎤 Diktieren";
      $state.textContent = state === "error" ? info : state === "recording" ? "Sprich jetzt – tippe auf „Fertig“, wenn du fertig bist." : "";
    },
  });
  $btn.addEventListener("click", () => ctl.toggle());
  window.addEventListener("hashchange", () => ctl.stop(true), { once: true });
  return ctl;
}
