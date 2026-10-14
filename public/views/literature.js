/**
 * Lernliteratur (#/literatur).
 *
 * Die Schwerpunktprüfung ist mündlich – nachgeschlagen wird also beim Lernen,
 * nicht in der Prüfung. Die Ansicht zeigt die Lernbasis (Checkliste
 * Neonatologie, 8. Auflage) mit ihrer Gliederung, die maßgeblichen Leitlinien
 * und einen Registerplan „Thema → wo nachlesen“. Die Fundstellen stehen in
 * `data/literature.json`; dieselben Daten hängen über `lookup` an den Fragen
 * und erscheinen nach dem Antworten unter „📖 Nachlesen“.
 */

export function createLiteratureView(ctx) {
  const { $app, esc, md } = ctx;
  let doc = null;

  async function load() {
    if (doc) return doc;
    const r = await fetch("data/literature.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("Literaturliste nicht gefunden – wurde `npm run build` ausgeführt?");
    doc = await r.json();
    return doc;
  }

  /** Ein Werk als aufklappbare Karte mit seiner Gliederung. */
  const workCard = (w, open) => `
    <details class="card lit-work" id="werk-${esc(w.id)}" ${open ? "open" : ""}>
      <summary>
        <span class="lit-title">${esc(w.title)}</span>
        <span class="small muted lit-sub">${esc(w.role)}</span>
      </summary>
      <div class="lit-body">
        <p class="small muted">${esc(w.authors || "")}${w.publisher ? ` · ${esc(w.publisher)}` : ""}${w.isbn ? ` · ISBN ${esc(w.isbn)}` : ""}</p>
        ${md(w.howTo)}
        <table class="lit-sections">
          <tbody>${w.sections.map((s) => `<tr>
            <th scope="row"><span class="badge">${esc(s.key)}</span> ${esc(s.title)}</th>
            <td class="small">${esc(s.about)}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </details>`;

  /** Registerplan: Thema → Fundstellen, nach Werk gruppiert dargestellt. */
  const registerRow = (r, shortOf) => `
    <tr>
      <th scope="row">${esc(r.title)}</th>
      <td>${r.lookup.map((l) => `<div class="small"><span class="badge primary">${esc(shortOf(l.work))}</span> ${l.where ? `${esc(l.where)} · ` : ""}Stichwort: ${l.terms.map((t) => `<em>${esc(t)}</em>`).join(", ")}</div>`).join("")}
        ${r.note ? `<div class="small muted" style="margin-top:4px">${esc(r.note)}</div>` : ""}</td>
    </tr>`;

  async function renderLiterature(rest = []) {
    const d = await load();
    const shortOf = (id) => d.works.find((w) => w.id === id)?.short || id;
    const want = rest[0];
    $app.innerHTML = `
      <h1>Literatur</h1>
      <div class="card">
        ${md(d.intro)}
      </div>
      <h3>Lernbasis und Leitlinien</h3>
      <p class="small muted">${esc(d.note)}</p>
      ${d.works.map((w) => workCard(w, want === w.id || (!want && w.id === d.works[0].id))).join("")}

      <h3>Registerplan</h3>
      <p class="small muted">Welches Thema wo steht. Dieselben Fundstellen zeigt jede Aufgabe nach dem Antworten unter „📖 Nachlesen“.</p>
      <div class="card" style="padding:0">
        <table class="lit-register"><tbody>${(d.register || []).map((r) => registerRow(r, shortOf)).join("")}</tbody></table>
      </div>`;
    if (want) document.getElementById(`werk-${want}`)?.scrollIntoView({ block: "start" });
  }

  return { renderLiterature };
}

/**
 * Fundstelle einer Aufgabe als HTML-Kasten.
 *
 * `fallback` ist die Fundstelle des Themengebiets – sie greift, wenn die Frage
 * keine eigene hat. `note` erklärt, was man mit dem Gefundenen anfängt.
 */
export function lookupHtml(lookup, { esc, md, works, note, compact = false, source = "" } = {}) {
  if (!lookup?.length) return "";
  const shortOf = (id) => works?.find((w) => w.id === id)?.short || id;
  return `<div class="lookup-tip ${compact ? "small" : ""}">
    <strong>📖 Nachlesen</strong> <a href="#/literatur" class="small">→ Literatur und Registerplan</a>
    <ul class="lookup-list">${lookup.map((l) => `<li>
      <a href="#/literatur/${esc(l.work)}"><strong>${esc(shortOf(l.work))}</strong></a>${l.where ? ` · ${esc(l.where)}` : ""}
      <div class="small muted">Stichwort: ${l.terms.map((t) => `<em>${esc(t)}</em>`).join(", ")}</div>
      ${l.note ? `<div class="small">${md(l.note)}</div>` : ""}
    </li>`).join("")}</ul>
    ${note ? `<div class="small">${md(note)}</div>` : ""}
    ${source ? `<div class="small muted">Rechtsgrundlage der Frage: ${esc(source)} – der Verordnungstext selbst bleibt die genaueste Quelle.</div>` : ""}
  </div>`;
}
