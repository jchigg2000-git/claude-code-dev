// The page, as a pure function: render(state, ctx) → {html, ...}. `state` is normalize()'s
// view of the state file; everything else the page shows (git, liveness, the clock) arrives in
// ctx, gathered by page.mjs. No fs, no git, no process state in here — so the CLI, the daemon and
// (later) a hub can all render the same page, and a repo-specific layer can add tabs through
// ctx.extraTabs without touching this file.
import { gateSummary, isOwnerTopic, isSettled, REWRITE_STALE_MS, threadOf } from "./normalize.mjs";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const SEVERITY_RANK = { red: 3, amber: 2, green: 1 };
// Kinds with a tag colour of their own. Any other kind a state file uses ("finding", "note", …)
// still gets a tag, in a neutral colour, rather than rendering with no tag at all.
const FINDING_KINDS = new Set(["research", "bug", "decision", "correction", "measure", "milestone", "blocker"]);
const findingKindClass = (kind) => (FINDING_KINDS.has(kind) ? kind : "other");
// The Findings tab shows FINDINGS_PAGE at a time, newest first, with "Show more" and a
// "Showing N of M" line, so nothing leaves the view without saying so.
const FINDINGS_PAGE = 15;
// `importance` is optional on a finding, 1–3. It renders only where a finding has one; the
// importance filter and the "most important" sort appear once any finding has one.
const IMPORTANCE = {
  3: { label: "High", title: "Importance 3 of 3: changes a headline result, finds or closes a path to a wrong result or a security or privacy exposure, or records an owner decision or a change of direction" },
  2: { label: "Medium", title: "Importance 2 of 3: a fix merged, a review's findings, a measured experiment" },
  1: { label: "Low", title: "Importance 1 of 3: notes and housekeeping" },
  0: { label: "Unscored", title: "No importance recorded" },
};

// A small, deliberately non-extensible markdown subset for finding bodies: paragraphs (blank-line
// separated), simple "- "/"* " bullet lists, and ```fenced``` blocks rendered as <pre> (for tables
// of numbers that would otherwise fight the paragraph wrapping). Every text run goes through esc()
// — the only tags this ever emits are the ones written here, so raw HTML in a state file can never
// reach the page.
function renderMiniMarkdown(md) {
  const lines = String(md ?? "").split("\n");
  let html = "";
  let para = [];
  let list = [];
  const flushPara = () => {
    if (para.length) html += `<p>${esc(para.join(" "))}</p>`;
    para = [];
  };
  const flushList = () => {
    if (list.length) html += `<ul>${list.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
    list = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      flushPara();
      flushList();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      html += `<pre>${esc(code.join("\n"))}</pre>`;
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      i++;
      continue;
    }
    if (line.trim() === "") {
      flushPara();
      flushList();
      i++;
      continue;
    }
    flushList();
    para.push(line.trim());
    i++;
  }
  flushPara();
  flushList();
  return html || `<p>${esc(md)}</p>`;
}

// Findings accept plain strings (summary-only, no modal) or objects with a full body, so an older
// state file with the one-line-string shape still renders unchanged.
function normalizeFinding(f, idx) {
  if (typeof f === "string" || f == null) {
    const summary = String(f ?? "");
    return { id: `finding-${idx}`, summary, detail: null, date: null, kind: null, importance: null, flagged: isFlagged(null, summary) };
  }
  const imp = Number(f.importance);
  return {
    id: f.id || `finding-${idx}`,
    summary: f.summary ?? "",
    detail: f.detail || null,
    date: f.date || null,
    kind: typeof f.kind === "string" && f.kind.trim() ? f.kind.trim().toLowerCase() : null,
    // Anything but 1, 2 or 3 (or nothing) is unscored, never an error.
    importance: imp === 1 || imp === 2 || imp === 3 ? imp : null,
    flagged: isFlagged(f.tags, f.summary),
  };
}

// A finding flagged for the owner: `tags` holds "interesting" or "flagged" (any case), or the
// summary opens with "★" (how keepers marked them before this pill existed).
function isFlagged(tags, summary) {
  const t = Array.isArray(tags) ? tags.map((x) => String(x).trim().toLowerCase()) : [];
  return t.includes("interesting") || t.includes("flagged") || String(summary ?? "").trimStart().startsWith("★");
}

const impMeter = (n) =>
  `<span class="imp-meter" aria-hidden="true">${[1, 2, 3].map((i) => `<i${i <= n ? ' class="on"' : ""}></i>`).join("")}</span>`;
// A labelled pill with a meter, so the level never rests on colour alone. Nothing when unscored.
const impPill = (n) =>
  n ? `<span class="imp imp-${n}" title="${esc(IMPORTANCE[n].title)}">${impMeter(n)}<span class="sr-only">importance </span>${IMPORTANCE[n].label}</span>` : "";

// One finding as a list item: date, importance (when it has one) and kind, then the summary.
// `order` is its place newest first, which the page's own sort returns to.
function findingItemHtml(f, order, hidden = false) {
  const tag = f.kind ? `<span class="ftag ${findingKindClass(f.kind)}">${esc(f.kind)}</span>` : "";
  const meta = `<span class="fmeta"><span class="fdate">${f.date ? esc(f.date) : "undated"}</span>${impPill(f.importance)}${tag}</span>`;
  const data = `data-kind="${esc(f.kind || "")}" data-imp="${f.importance || 0}" data-flag="${f.flagged ? 1 : 0}"${order == null ? "" : ` data-order="${order}"`}${hidden ? " hidden" : ""}`;
  if (f.detail) {
    return `<li class="find-item clickable" tabindex="0" role="button" aria-haspopup="dialog" data-finding-id="${esc(f.id)}" ${data}>${meta}<span class="ftext">${esc(f.summary)} <span class="fmore">Read more&nbsp;&rsaquo;</span></span></li>`;
  }
  return `<li class="find-item" ${data}>${meta}<span class="ftext">${esc(f.summary)}</span></li>`;
}

const localIsoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Newest first, whatever order the state file holds them in. Rendering in array order put the
// oldest at the top: entries are appended as they happen, so on a long-lived repo the latest days
// sat at the bottom of a long card and looked like they were never recorded. `date` is compared
// as an ISO string (YYYY-MM-DD, optionally with a time). Within one date the entry later in the
// file comes first; an undated entry (a plain string, say) sorts after every dated one.
function sortFindingsNewestFirst(findings) {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const da = String(a.f.date || "");
      const db = String(b.f.date || "");
      if (da !== db) return da < db ? 1 : -1;
      return b.i - a.i;
    })
    .map((x) => x.f);
}

// How long ago the state last changed, in words. Written in ES5 because the page's script
// embeds this same function to tick the time between reloads.
const STALE_MS = 3 * 3600e3;
function relTime(ms) {
  var m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  var h = Math.floor(m / 60);
  if (h < 48) return h + " h ago";
  return Math.floor(h / 24) + " days ago";
}

// When a topic last moved: its newest message, else when it was asked.
const lastAt = (q) => (Array.isArray(q.thread) && q.thread.length ? q.thread.at(-1)?.at : q.askedAt) ?? "";

// The browser tab: the repo's initials on a colour of its own, so one build's tab is easy to pick
// out from another's, and a dot in the top severity's colour while a question waits.
const TAB_COLOURS = ["#08284D", "#0A6FB3", "#5B3FA0", "#0F6E74", "#3D4F63", "#8A2D6B"];
const DOT_COLOURS = { red: "#E5372B", amber: "#FFC335", green: "#2F9E55" };
function faviconHref(title, severity) {
  const parts = String(title).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "?").slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of String(title)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const dot = severity ? `<circle cx="49" cy="15" r="14" fill="${DOT_COLOURS[severity] || DOT_COLOURS.amber}" stroke="#fff" stroke-width="4"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${TAB_COLOURS[h % TAB_COLOURS.length]}"/><text x="32" y="50" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="28" font-weight="700" fill="#fff">${initials}</text>${dot}</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// What each comment priority means for the owner; the composer shows the chosen one's line.
const COMMENT_PRIORITIES = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];
const COMMENT_HINTS = {
  low: "Whenever it fits: the keeper holds it and passes it on with others at a step's end. It may go straight to the backlog.",
  normal: "At the build's next break (a step done, a merge), within the hour. The build does it, files it, or declines with a reason.",
  high: "At the keeper's next pass (about 10 minutes while it runs on a timer), before the build starts its next piece of work. It must weigh it and say what it will do.",
  urgent: "As soon as the build sees it: within seconds while its keeper is watching, otherwise at the next pass. It stops at the next safe point and deals with it. If it disagrees, it asks you rather than carry on.",
};

// --- Roadmap tab ------------------------------------------------------------------------------
// The page never writes ROADMAP.md. Every control only records a request (POST /roadmap/request,
// /roadmap/withdraw); the main session carries it out and the page shows where each one stands.
// All of this is emitted only when the state carries `_roadmap`, so a page without one is
// byte-for-byte what it was before the tab existed.
const RM_NOTE = "Requests only. ROADMAP.md is not edited from this page; the main session carries each request out.";
const RM_OPEN = new Set(["new", "held", "sent"]);
const RM_REQ_STATUS = { new: "waiting for the main session", held: "held", sent: "with the main session", filed: "filed to the backlog", done: "done", declined: "declined", withdrawn: "withdrawn" };
const RM_KIND = { reorder: "Reorder", remove: "Remove", dispatch: "Dispatch", restore: "Restore" };
const RM_PENDING = { reorder: "reorder requested", remove: "removal requested", dispatch: "dispatch requested", restore: "restore requested" };
const RM_NOUN = { reorder: "reorder request", remove: "removal request", dispatch: "dispatch request", restore: "restore request" };
const rmSlug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const rmText = (v) => esc(v ?? "");
const rmReqStatus = (r) => (RM_REQ_STATUS[r?.status] ? r.status : "new");

function roadmapItemHtml(it, idx, ctx) {
  const { live, last } = ctx;
  const id = String(it?.id ?? `item-${idx}`);
  const title = String(it?.title ?? "");
  const removed = !!it?.removed;
  const pending = Array.isArray(it?.pending) ? it.pending.filter((p) => p && typeof p === "object") : [];
  const off = live ? "" : " disabled";
  const dAttr = `data-item-id="${esc(id)}"`;
  const removeReq = pending.find((p) => p.kind === "remove");
  // An undo while the removal is still "new" just withdraws it; once it has been picked up, the
  // way back is a "restore" request.
  const undoByWithdraw = removed && removeReq && (removeReq.status ?? "new") === "new" && removeReq.id;
  const chips = pending
    .map((p) => {
      const st = String(p.status ?? "new");
      const label = `${RM_PENDING[p.kind] || `${String(p.kind ?? "change")} requested`}${st === "new" ? "" : ` - ${st}`}`;
      // The row's own Undo stands in for the Withdraw on a "new" removal.
      const withdraw =
        st === "new" && p.id && !(undoByWithdraw && p === removeReq)
          ? `<button type="button" class="rm-btn mini" data-roadmap-action="withdraw" data-request-id="${esc(p.id)}" data-item-id="${esc(id)}" aria-label="Withdraw the ${esc(RM_NOUN[p.kind] || "change request")} for ${esc(id)}"${off}>Withdraw</button>`
          : "";
      return `<span class="rm-pend"><span class="rm-chip pending s-${esc(rmSlug(st))}" data-request-kind="${esc(p.kind ?? "")}" data-request-status="${esc(st)}">${esc(label)}</span>${withdraw}</span>`;
    })
    .join("");
  const moved = !!it?.movedByRequest && !pending.some((p) => p.kind === "reorder");
  const status = it?.status ? `<span class="rm-chip st rm-st-${esc(rmSlug(it.status))}">${esc(it.status)}</span>` : "";
  const backlog = it?.backlog ? `<span class="rm-chip backlog">backlog</span>` : "";
  const line = it?.line != null && it.line !== "" ? `<span class="rm-line">line ${esc(it.line)}</span>` : "";
  const movedChip = moved ? `<span class="rm-chip pending">moved by request</span>` : "";
  const prefill = `Work on ${id} ${title}: `;
  const actions = removed
    ? `<button type="button" class="rm-btn" data-roadmap-action="undo" data-undo-mode="${undoByWithdraw ? "withdraw" : "restore"}"${undoByWithdraw ? ` data-request-id="${esc(removeReq.id)}"` : ""} ${dAttr} aria-label="Undo the removal of ${esc(id)}"${off}>Undo</button>`
    : `<button type="button" class="rm-btn" data-roadmap-action="up" ${dAttr} aria-label="Move ${esc(id)} up"${live && !ctx.first ? "" : " disabled"}>Up</button>` +
      `<button type="button" class="rm-btn" data-roadmap-action="down" ${dAttr} aria-label="Move ${esc(id)} down"${live && !last ? "" : " disabled"}>Down</button>` +
      `<button type="button" class="rm-btn" data-roadmap-action="dispatch" ${dAttr} aria-expanded="false" aria-label="Dispatch agents for ${esc(id)}"${off}>Dispatch</button>` +
      `<button type="button" class="rm-btn danger" data-roadmap-action="remove" ${dAttr} aria-label="Remove ${esc(id)}"${off}>Remove</button>`;
  const handle = removed
    ? `<span class="rm-handle-gap" aria-hidden="true"></span>`
    : `<button type="button" class="rm-handle" data-roadmap-action="drag" ${dAttr} aria-label="Reorder ${esc(id)}: drag, or use the arrow keys" title="Drag to move; the up and down arrow keys also work"${off}>&equiv;</button>`;
  const panel = removed
    ? ""
    : `<div class="rm-dispatch" ${dAttr} hidden>
        <div class="rm-agents" role="group" aria-label="Agents to dispatch, at most one of each">
          <label class="rm-check"><input type="checkbox" class="rm-opus"> Opus agent</label>
          <label class="rm-check"><input type="checkbox" class="rm-sonnet"> Sonnet agent</label>
        </div>
        <label class="rm-brieflabel">Brief<textarea class="rm-brief" rows="3" data-prefill="${esc(prefill)}"${off}>${esc(prefill)}</textarea></label>
        <p class="rm-err" role="alert" hidden></p>
        <div class="rm-dispatch-row"><button type="button" class="rm-btn" data-roadmap-action="cancel" ${dAttr}>Cancel</button><button type="button" class="rm-btn primary" data-roadmap-action="send" ${dAttr}${off}>Send</button></div>
      </div>`;
  const cls = `rm-item${removed ? " removed" : ""}${it?.movedByRequest ? " moved" : ""}${pending.length ? " has-pending" : ""}`;
  return `<li class="${cls}" ${dAttr} data-removed="${removed ? 1 : 0}">
    <div class="rm-row">
      ${handle}
      <div class="rm-main">
        <p class="rm-head">${it?.marker ? `<span class="rm-marker">${esc(it.marker)}</span> ` : ""}<span class="rm-id">${esc(id)}</span> <span class="rm-title">${esc(title)}</span></p>
        <div class="rm-meta">${status}${backlog}${line}${movedChip}${chips}</div>
        ${it?.summary ? `<p class="rm-summary">${esc(it.summary)}</p>` : ""}
      </div>
      <div class="rm-actions">${actions}</div>
    </div>
    ${panel}
  </li>`;
}

function roadmapSectionHtml(sec, si, live) {
  const items = Array.isArray(sec?.items) ? sec.items.filter((x) => x && typeof x === "object") : [];
  const liveItems = items.filter((x) => !x.removed);
  const firstLive = liveItems[0];
  const lastLive = liveItems[liveItems.length - 1];
  const removedN = items.length - liveItems.length;
  const pendingN = items.filter((x) => Array.isArray(x.pending) && x.pending.length).length;
  const sid = String(sec?.id ?? `section-${si}`);
  const n = liveItems.length;
  return `<details class="card rm-sec${sec?.backlog ? " is-backlog" : ""}" data-section-id="${esc(sid)}"${sec?.backlog ? "" : " open"}>
      <summary><h2>${esc(sec?.title ?? sid)}</h2><span class="rm-count">${n} item${n === 1 ? "" : "s"}${removedN ? ` &middot; ${removedN} to remove` : ""}</span>${sec?.backlog ? `<span class="rm-chip backlog">backlog</span>` : ""}${pendingN ? `<span class="rm-chip pending">${pendingN} requested</span>` : ""}</summary>
      ${items.length ? `<ul class="rm-list" data-section-id="${esc(sid)}">${items.map((it, i) => roadmapItemHtml(it, i, { live, first: it === firstLive, last: it === lastLive })).join("\n")}</ul>` : `<p class="qempty">Nothing in this section.</p>`}
    </details>`;
}

function roadmapRequestHtml(r, live) {
  const st = rmReqStatus(r);
  const open = RM_OPEN.has(st);
  const kind = RM_KIND[r?.kind] || String(r?.kind ?? "Request");
  const to = r?.to && typeof r.to === "object" ? r.to : {};
  let detail = "";
  if (r?.kind === "reorder") {
    detail = to.after && to.before ? `Place it between ${to.after} and ${to.before}.` : to.after ? `Move it to the end, after ${to.after}.` : to.before ? `Move it to the top, before ${to.before}.` : "";
  } else if (r?.kind === "remove") detail = "Remove it from the roadmap.";
  else if (r?.kind === "restore") detail = "Put it back.";
  else if (r?.kind === "dispatch" && r.dispatch) {
    const who = [r.dispatch.opus ? "Opus agent" : "", r.dispatch.sonnet ? "Sonnet agent" : ""].filter(Boolean).join(" and ");
    detail = `${who || "No agent chosen"}: ${r.dispatch.brief ?? ""}`;
  }
  return `<li class="citem normal rm-req" data-request-id="${rmText(r?.id)}" data-request-kind="${rmText(r?.kind)}" data-request-status="${st}">
      <div class="chead"><span class="rm-kind">${esc(kind)}</span><span class="cstatus ${st}">${RM_REQ_STATUS[st]}</span><span class="cwhen">${esc(r?.at ? new Date(r.at).toLocaleString() : "")}</span></div>
      <p class="rm-req-item"><span class="rm-id">${rmText(r?.itemId)}</span> ${rmText(r?.itemTitle)}</p>
      ${detail ? `<p class="ctext">${esc(detail)}</p>` : ""}
      ${r?.note ? `<p class="cnote"><span class="qrec-label">Note:</span> ${esc(r.note)}</p>` : ""}
      ${st === "new" && r?.id ? `<div class="rm-req-actions"><button type="button" class="rm-btn mini" data-roadmap-action="withdraw" data-request-id="${esc(r.id)}" data-item-id="${rmText(r?.itemId)}" aria-label="Withdraw this ${esc(kind.toLowerCase())} request"${live ? "" : " disabled"}>Withdraw</button></div>` : ""}
    </li>`;
}

// Everything the Roadmap tab adds to the page, or null when the state has no `_roadmap`.
function roadmapView(state, { live, reason }) {
  const rm = state._roadmap;
  if (!rm || typeof rm !== "object") return null;
  const requests = (Array.isArray(state.roadmapRequests) ? state.roadmapRequests : []).filter((r) => r && typeof r === "object");
  const byNewest = (a, b) => String(b.at ?? "").localeCompare(String(a.at ?? ""));
  const openReqs = requests.filter((r) => RM_OPEN.has(rmReqStatus(r))).sort(byNewest);
  const doneReqs = requests.filter((r) => !RM_OPEN.has(rmReqStatus(r))).sort(byNewest);
  const sections = Array.isArray(rm.sections) ? rm.sections : [];
  const readAtMs = rm.readAt ? Date.parse(rm.readAt) : NaN;
  const src =
    rm.source || Number.isFinite(readAtMs)
      ? `<p class="rm-src">${rm.source ? `Read from <code>${esc(rm.source)}</code>` : "Read"}${Number.isFinite(readAtMs) ? ` <time datetime="${esc(rm.readAt)}">${esc(new Date(readAtMs).toLocaleString())}</time>` : ""}</p>`
      : "";
  const body = [
    rm.error ? `<div class="card rm-error" role="alert"><strong>Could not read the roadmap.</strong> <span class="rm-error-text">${esc(rm.error)}</span></div>` : "",
    sections.length
      ? sections.map((s, i) => roadmapSectionHtml(s, i, live)).join("\n")
      : rm.error
        ? ""
        : `<div class="card"><div class="qempty rm-empty">No roadmap items found${rm.source ? ` in ${esc(rm.source)}` : ""}.</div></div>`,
  ].join("\n");
  const panelHtml = `<div id="tab-roadmap" class="tabpanel" role="tabpanel" aria-labelledby="tabbtn-roadmap" tabindex="0">
<div class="note rm-note">${esc(RM_NOTE)}</div>
${!live && reason ? `<div class="qhint">Read-only right now &mdash; ${esc(reason)}.</div>` : ""}
${src}
<p id="rm-msg" class="rm-msg" role="status" aria-live="polite"></p>
${body}
<div class="card" id="roadmap-requests-card">
  <h2>Requests${openReqs.length ? ` &middot; ${openReqs.length} open` : ""}</h2>
  ${openReqs.length ? `<ul class="clist rm-reqs">${openReqs.map((r) => roadmapRequestHtml(r, live)).join("")}</ul>` : `<p class="qempty">${requests.length ? "Nothing open." : "No requests yet."}</p>`}
  ${doneReqs.length ? `<details class="cclosed"><summary>Handled &middot; ${doneReqs.length}</summary><ul class="clist rm-reqs">${doneReqs.map((r) => roadmapRequestHtml(r, live)).join("")}</ul></details>` : ""}
</div>
</div>
`;
  return {
    badge: openReqs.length ? `<span class="badge info" title="${openReqs.length} open roadmap request${openReqs.length === 1 ? "" : "s"}">${openReqs.length}<span class="sr-only"> open</span></span>` : "",
    panelHtml,
  };
}

const ROADMAP_CSS = `
  /* The tab badges carry an absolutely positioned .sr-only; without a positioned scroll container its
     static position, past the last tab, widens the whole page on a phone. */
  .tabs{position:relative}
  .rm-note{margin-bottom:12px}
  .rm-src{font-size:12.5px;color:var(--mut);margin:0 0 12px;overflow-wrap:anywhere}
  .rm-src code{background:#eaf1f7;padding:1px 6px;border-radius:4px;color:var(--navy)}
  .rm-msg{font-size:13px;font-weight:600;color:var(--ember-text);margin:0 0 10px}
  .rm-msg:empty{display:none}
  .rm-error{border-left:4px solid var(--ember);background:#fff7f0;color:#8a3c06;font-size:13.5px;overflow-wrap:anywhere}
  .rm-sec>summary{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;min-height:40px}
  .rm-sec>summary::before{content:"";flex:none;width:0;height:0;border-style:solid;border-width:5px 0 5px 7px;border-color:transparent transparent transparent var(--mut);transition:transform .15s}
  .rm-sec[open]>summary::before{transform:rotate(90deg)}
  .rm-sec>summary h2{overflow-wrap:anywhere}
  .rm-count{font-size:12.5px;color:var(--mut);font-variant-numeric:tabular-nums}
  .rm-sec.is-backlog{background:#fafcfd}
  .rm-list{list-style:none;margin:0;padding:0}
  .rm-item{position:relative;border-top:1px solid #eef3f7;padding:10px 0}
  .rm-item:first-child{border-top:0}
  .rm-item.moved::before{content:"";position:absolute;left:-9px;top:10px;bottom:10px;width:3px;border-radius:2px;background:var(--blue)}
  .rm-item.dragging{opacity:.55;background:#eef6fc}
  .rm-item.drop-before{box-shadow:0 -2px 0 0 var(--blue-text)}
  .rm-item.drop-end{box-shadow:0 2px 0 0 var(--blue-text)}
  .rm-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 10px;align-items:start}
  .rm-main{min-width:0}
  .rm-handle,.rm-handle-gap{width:32px;height:32px;flex:none}
  .rm-handle{appearance:none;padding:0;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--mut);font:inherit;font-size:18px;line-height:1;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
  .rm-handle:hover:not(:disabled){border-color:var(--blue-text);color:var(--navy)}
  .rm-handle:active{cursor:grabbing}
  .rm-handle:disabled{opacity:.4;cursor:not-allowed}
  .rm-head{margin:0;font-size:14.5px;overflow-wrap:anywhere}
  .rm-marker{font-size:14px}
  .rm-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;font-weight:600;color:var(--blue-text);overflow-wrap:anywhere}
  .rm-title{font-weight:600;color:var(--ink);overflow-wrap:anywhere}
  .rm-item.removed .rm-head{text-decoration:line-through;color:var(--mut)}
  .rm-item.removed .rm-title{color:var(--mut)}
  .rm-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin-top:4px;min-width:0}
  .rm-pend{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px;max-width:100%}
  .rm-chip{display:inline-flex;align-items:center;font-size:12px;font-weight:600;line-height:1.3;padding:2px 9px;border-radius:99px;border:1px solid var(--line);background:#f2f5f8;color:#3b4b5e;max-width:100%;overflow-wrap:anywhere}
  .rm-chip.backlog{background:#f6f8fa;border-style:dashed;color:var(--mut)}
  .rm-chip.pending{background:#e8f3fb;border-color:#c4e0f3;color:#0A5A92}
  .rm-chip.pending.s-sent{background:#eaf7ee;border-color:#c9e8d3;color:#1d6b38}
  .rm-chip.pending.s-held{background:#fff4e2;border-color:#ffd79a;color:#6b4708}
  .rm-chip.st.rm-st-blocked{background:#fde9db;border-color:#f7c9a3;color:#8a3c06}
  .rm-chip.st.rm-st-done,.rm-chip.st.rm-st-shipped{background:#eaf7ee;border-color:#c9e8d3;color:#1d6b38}
  .rm-chip.st.rm-st-in-progress,.rm-chip.st.rm-st-in-build,.rm-chip.st.rm-st-active{background:#e8f3fb;border-color:#c4e0f3;color:#0A5A92}
  .rm-line{font-size:12px;color:var(--mut);font-variant-numeric:tabular-nums}
  .rm-summary{margin:4px 0 0;font-size:13px;color:#4a5d70;overflow-wrap:anywhere}
  .rm-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
  .rm-btn{appearance:none;font:inherit;font-size:13px;font-weight:600;min-height:32px;min-width:32px;padding:4px 12px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--navy);cursor:pointer}
  .rm-btn:hover:not(:disabled){border-color:var(--blue-text)}
  .rm-btn:disabled{opacity:.5;cursor:not-allowed}
  .rm-btn.mini{min-height:24px;min-width:24px;padding:1px 9px;font-size:12px}
  .rm-btn.primary{background:var(--blue-text);border-color:var(--blue-text);color:#fff}
  .rm-btn.danger{background:#fff7f0;border-color:#f7c9a3;color:#8a3c06}
  .rm-handle:focus-visible,.rm-btn:focus-visible,.rm-brief:focus-visible,.rm-check input:focus-visible{outline:2px solid var(--blue-text);outline-offset:2px}
  .rm-dispatch{margin:8px 0 2px 42px;padding:10px 12px;border:1px solid var(--line);border-left:3px solid var(--blue-text);border-radius:8px;background:#f6f9fc}
  .rm-agents{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 6px}
  .rm-check{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:2px 8px 2px 2px;font-size:13.5px;color:var(--ink);cursor:pointer}
  .rm-check input{width:24px;height:24px;margin:0;accent-color:var(--blue-text)}
  .rm-brieflabel{display:block;font-size:12.5px;font-weight:600;color:var(--mut)}
  .rm-brief{display:block;width:100%;max-width:100%;min-height:72px;margin-top:4px;resize:vertical;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13.5px;font-weight:400;color:var(--ink)}
  .rm-brief:disabled{opacity:.55;cursor:not-allowed}
  .rm-err{margin:6px 0 0;font-size:12.5px;font-weight:600;color:var(--ember-text)}
  .rm-dispatch-row{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:8px}
  .rm-kind{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:99px;border:1px solid #c4e0f3;background:#e8f3fb;color:#0A5A92}
  .rm-req-item{margin:5px 0 2px;font-size:13.5px;overflow-wrap:anywhere}
  .rm-req-actions{margin-top:6px}
  .rm-req .chead{font-size:12px}
  #roadmap-requests-card .cclosed>summary{display:flex;align-items:center;min-height:32px}
  @media(max-width:640px){
    .rm-sec.card,#roadmap-requests-card{padding:12px}
    .rm-row{grid-template-columns:auto minmax(0,1fr)}
    .rm-actions{grid-column:1 / -1;justify-content:flex-start}
    .rm-btn,.rm-btn.mini{min-height:40px;min-width:40px;padding:6px 11px}
    .rm-handle,.rm-handle-gap{width:40px;height:40px}
    .rm-check,#roadmap-requests-card .cclosed>summary{min-height:40px}
    .rm-dispatch{margin-left:0}
    .rm-brief{font-size:16px}
    .rm-dispatch-row .rm-btn{flex:1 1 40%}
  }
  @media(prefers-reduced-motion:reduce){.rm-sec>summary::before{transition:none}}`;

const ROADMAP_SCRIPT = `

  // --- Roadmap: every control records a request (POST /roadmap/request or /roadmap/withdraw) and
  // the page reloads to show it. Nothing here edits ROADMAP.md. An open dispatch panel holds the
  // 20s refresh (rmPanelOpen) and rides out a reload in sessionStorage; so does a drag (it counts
  // as a save in flight). Which sections are open is kept in localStorage.
  var rmTab = document.getElementById("tab-roadmap");
  var rmMsg = document.getElementById("rm-msg");
  var RSKEY = STORE + ":roadmap-sections";
  var RPKEY = STORE + ":roadmap-panels";
  var rmBusy = false;
  function rmSay(text){ if (rmMsg) rmMsg.textContent = text || ""; }
  function rmArr(list){ return Array.prototype.slice.call(list || []); }
  function rmButtons(){ return rmTab ? rmArr(rmTab.querySelectorAll("button[data-roadmap-action]")) : []; }
  function rmRows(){ return rmTab ? rmArr(rmTab.querySelectorAll(".rm-item")) : []; }
  function rmIdOf(el){ return el ? el.getAttribute("data-item-id") : null; }
  function rmRow(id){ var rows = rmRows(); for (var i = 0; i < rows.length; i++) { if (rmIdOf(rows[i]) === id) return rows[i]; } return null; }
  function rmPanel(row){ return row ? row.querySelector(".rm-dispatch") : null; }
  function rmLive(row){ return rmArr(row.parentNode.children).filter(function(el){ return el.classList.contains("rm-item") && !el.classList.contains("removed"); }); }
  function rmLock(on){
    rmBusy = on;
    rmButtons().forEach(function(b){
      if (on) { b.setAttribute("data-was-disabled", b.disabled ? "1" : "0"); b.disabled = true; }
      else { b.disabled = b.getAttribute("data-was-disabled") === "1"; }
    });
  }
  function rmPost(path, body, onOk, onFail){
    if (rmBusy) return;
    rmSay("");
    rmLock(true);
    savesInFlight++;
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return {}; }).then(function(j){
        var e = new Error(j.error || ("request failed (" + r.status + ")"));
        e.status = r.status;
        throw e;
      });
      if (onOk) onOk();
      saveScroll();
      location.reload();
    }).catch(function(err){
      savesInFlight--;
      rmLock(false);
      if (err.status === 409) {
        rmSay("That request was already picked up, so it can no longer be changed here. Reloading to show where it stands.");
        setTimeout(function(){ saveScroll(); location.reload(); }, 2500);
        return;
      }
      rmSay("Could not record the request: " + err.message);
      if (onFail) onFail(err);
    });
  }
  function rmMove(row, dir){
    var live = rmLive(row), i = live.indexOf(row), j = i + dir;
    if (i < 0 || j < 0 || j >= live.length) return;
    var to = dir < 0 ? { after: rmIdOf(live[j - 1]), before: rmIdOf(live[j]) } : { after: rmIdOf(live[j]), before: rmIdOf(live[j + 1]) };
    rmPost("/roadmap/request", { kind: "reorder", itemId: rmIdOf(row), to: to });
  }

  // Dispatch panel: Opus and Sonnet checkboxes (one of each at most) and a brief.
  function rmPanelOpen(){
    var rows = rmRows();
    for (var i = 0; i < rows.length; i++) { var p = rmPanel(rows[i]); if (p && !p.hidden) return true; }
    return false;
  }
  function rmSavePanels(){
    var out = {};
    rmRows().forEach(function(row){
      var p = rmPanel(row);
      if (!p || p.hidden) return;
      out[rmIdOf(row)] = { opus: p.querySelector(".rm-opus").checked, sonnet: p.querySelector(".rm-sonnet").checked, brief: p.querySelector(".rm-brief").value };
    });
    writeJson("sessionStorage", RPKEY, out);
  }
  function rmShowPanel(row, show){
    var p = rmPanel(row);
    if (!p) return;
    p.hidden = !show;
    var b = row.querySelector('button[data-roadmap-action="dispatch"]');
    if (b) b.setAttribute("aria-expanded", show ? "true" : "false");
  }
  function rmOpenPanel(row){
    var p = rmPanel(row);
    if (!p) return;
    if (!p.hidden) { rmClosePanel(row); return; }
    rmShowPanel(row, true);
    noteActivity();
    var brief = p.querySelector(".rm-brief");
    if (brief && !brief.disabled) { brief.focus(); brief.setSelectionRange(brief.value.length, brief.value.length); }
    rmSavePanels();
  }
  function rmClosePanel(row){
    var p = rmPanel(row);
    if (!p) return;
    p.querySelector(".rm-opus").checked = false;
    p.querySelector(".rm-sonnet").checked = false;
    var brief = p.querySelector(".rm-brief");
    brief.value = brief.getAttribute("data-prefill") || "";
    p.querySelector(".rm-err").hidden = true;
    rmShowPanel(row, false);
    rmSavePanels();
  }
  function rmSend(row){
    var p = rmPanel(row);
    if (!p) return;
    var opus = p.querySelector(".rm-opus").checked, sonnet = p.querySelector(".rm-sonnet").checked;
    var brief = (p.querySelector(".rm-brief").value || "").trim();
    var err = p.querySelector(".rm-err");
    if (!opus && !sonnet) { err.textContent = "Pick an Opus agent, a Sonnet agent, or both."; err.hidden = false; return; }
    if (!brief) { err.textContent = "Write a brief for the agent."; err.hidden = false; p.querySelector(".rm-brief").focus(); return; }
    err.hidden = true;
    rmPost("/roadmap/request", { kind: "dispatch", itemId: rmIdOf(row), dispatch: { opus: opus ? 1 : 0, sonnet: sonnet ? 1 : 0, brief: brief } }, function(){
      p.hidden = true;
      rmSavePanels();
    });
  }
  (function rmRestorePanels(){
    var saved = readJson("sessionStorage", RPKEY) || {};
    Object.keys(saved).forEach(function(id){
      var row = rmRow(id), p = rmPanel(row), s = saved[id] || {};
      if (!p) return;
      p.querySelector(".rm-opus").checked = !!s.opus;
      p.querySelector(".rm-sonnet").checked = !!s.sonnet;
      if (typeof s.brief === "string" && s.brief) p.querySelector(".rm-brief").value = s.brief;
      rmShowPanel(row, true);
    });
    rmSavePanels();
  })();

  if (rmTab) {
    rmTab.addEventListener("click", function(e){
      var btn = e.target && e.target.closest ? e.target.closest("button[data-roadmap-action]") : null;
      if (!btn || btn.disabled) return;
      var act = btn.getAttribute("data-roadmap-action"), id = btn.getAttribute("data-item-id"), row = id ? rmRow(id) : null;
      if (act === "up" && row) rmMove(row, -1);
      else if (act === "down" && row) rmMove(row, 1);
      else if (act === "remove") rmPost("/roadmap/request", { kind: "remove", itemId: id });
      else if (act === "undo" && btn.getAttribute("data-undo-mode") === "withdraw") rmPost("/roadmap/withdraw", { id: btn.getAttribute("data-request-id") });
      else if (act === "undo") rmPost("/roadmap/request", { kind: "restore", itemId: id });
      else if (act === "withdraw") rmPost("/roadmap/withdraw", { id: btn.getAttribute("data-request-id") });
      else if (act === "dispatch" && row) rmOpenPanel(row);
      else if (act === "cancel" && row) rmClosePanel(row);
      else if (act === "send" && row) rmSend(row);
    });
    var rmDraft = function(){ noteActivity(); rmSavePanels(); };
    rmTab.addEventListener("input", function(e){ if (e.target && e.target.classList && e.target.classList.contains("rm-brief")) rmDraft(); });
    rmTab.addEventListener("change", function(e){ if (e.target && e.target.classList && (e.target.classList.contains("rm-opus") || e.target.classList.contains("rm-sonnet"))) rmDraft(); });
    rmTab.addEventListener("keydown", function(e){
      var h = e.target && e.target.classList && e.target.classList.contains("rm-handle") ? e.target : null;
      if (!h || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      var row = rmRow(h.getAttribute("data-item-id"));
      if (row && !rmBusy && !h.disabled) rmMove(row, e.key === "ArrowUp" ? -1 : 1);
    });
  }

  // Drag by the handle only (touch-action: none there, so the rest of the row still scrolls the page).
  // Pointer events cover mouse, pen and touch. Dropping records the same reorder request as Up and
  // Down, within the item's own section.
  var rmDrag = null;
  function rmClearDrop(list){ rmArr(list.children).forEach(function(el){ el.classList.remove("drop-before", "drop-end"); }); }
  function rmAim(d){
    var others = rmLive(d.row).filter(function(el){ return el !== d.row; });
    var target = null;
    for (var i = 0; i < others.length; i++) {
      var r = others[i].getBoundingClientRect();
      if (d.y < r.top + r.height / 2) { target = others[i]; break; }
    }
    var at = target ? others.indexOf(target) : others.length;
    var origAt = rmLive(d.row).indexOf(d.row);
    d.before = rmIdOf(target);
    d.after = at > 0 ? rmIdOf(others[at - 1]) : null;
    d.noop = at === origAt;
    rmClearDrop(d.list);
    if (!d.noop) {
      if (target) target.classList.add("drop-before");
      else if (others.length) others[others.length - 1].classList.add("drop-end");
    }
  }
  function rmDragEnd(commit){
    var d = rmDrag;
    if (!d) return;
    rmDrag = null;
    clearInterval(d.timer);
    savesInFlight--;
    d.row.classList.remove("dragging");
    rmClearDrop(d.list);
    document.body.style.userSelect = d.prevSelect;
    try { d.handle.releasePointerCapture(d.pid); } catch (err) {}
    if (commit && !d.noop) rmPost("/roadmap/request", { kind: "reorder", itemId: rmIdOf(d.row), to: { after: d.after, before: d.before } });
  }
  rmArr(rmTab ? rmTab.querySelectorAll(".rm-handle") : []).forEach(function(handle){
    handle.addEventListener("pointerdown", function(e){
      if (rmDrag || rmBusy || handle.disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
      var row = handle.closest(".rm-item");
      if (!row || rmLive(row).length < 2) return;
      e.preventDefault();
      noteActivity();
      rmDrag = { row: row, list: row.parentNode, handle: handle, pid: e.pointerId, y: e.clientY, before: null, after: null, noop: true, prevSelect: document.body.style.userSelect, timer: 0 };
      savesInFlight++;
      document.body.style.userSelect = "none";
      row.classList.add("dragging");
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      // Near the top or bottom edge the page scrolls itself, since a touch drag cannot.
      rmDrag.timer = setInterval(function(){
        var d = rmDrag;
        if (!d) return;
        var step = d.y < 70 ? -12 : d.y > window.innerHeight - 70 ? 12 : 0;
        if (step) { window.scrollBy(0, step); rmAim(d); }
      }, 30);
    });
    handle.addEventListener("pointermove", function(e){
      if (!rmDrag || rmDrag.handle !== handle) return;
      rmDrag.y = e.clientY;
      noteActivity();
      rmAim(rmDrag);
    });
    handle.addEventListener("pointerup", function(e){ if (rmDrag && rmDrag.handle === handle) { rmDrag.y = e.clientY; rmAim(rmDrag); rmDragEnd(true); } });
    handle.addEventListener("pointercancel", function(){ if (rmDrag && rmDrag.handle === handle) rmDragEnd(false); });
  });

  (function rmRestoreSections(){
    var open = readJson("localStorage", RSKEY) || {};
    if (!rmTab) return;
    rmArr(rmTab.querySelectorAll("details.rm-sec")).forEach(function(d){
      var id = d.getAttribute("data-section-id");
      if (typeof open[id] === "boolean") d.open = open[id];
      var dflt = !d.classList.contains("is-backlog");
      d.addEventListener("toggle", function(){ if (d.open === dflt) delete open[id]; else open[id] = d.open; writeJson("localStorage", RSKEY, open); });
    });
  })();`;


// live: whether a server is actually reachable for this repo right now (so Save/Confirm work).
// reason: one-line explanation when live is false, shown as a hint instead of failing silently.

export function render(state, ctx = {}) {
  const { title = "build status", live = false, port = null, reason = "", build = "", now = new Date() } = ctx;
  const { isGitRepo = false, branch = "", dirty = 0, commits = [] } = ctx.git || {};
  // Extra tabs from a repo-specific layer (e.g. a training view). Labels are escaped here; the
  // panel html is the caller's, trusted as-is.
  const extraTabs = (ctx.extraTabs || [])
    .map((t) => ({ ...t, id: String(t.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "") }))
    .filter((t) => t.id && !["overview", "findings", "questions", "steps", "gate", ...(state._roadmap ? ["roadmap"] : [])].includes(t.id));
  const steps = state.steps || [];
  const done = steps.filter((s) => s.state === "done").length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  // Finished phases collapse to one pill each, above the current board.
  const history = state.history ?? [];
  const historyHtml = history.length
    ? `<div class="card"><h2>Shipped</h2><div class="pills">${history
        .map((h) => `<span class="pill ok">${esc(h.phase)} &middot; ${esc(String(h.steps))} steps &middot; ${esc(h.completedAt)}</span>`)
        .join("")}</div></div>`
    : "";

  const isActiveStep = (s) => s.state === "active" || s.state === "doing";
  const stepRow = (s) => {
    const st = isActiveStep(s) ? "active" : s.state === "done" ? "done" : "todo";
    const mark = st === "done" ? "&#10003;" : st === "active" ? "&#9679;" : "&#9675;";
    const srState = st === "done" ? "done" : st === "active" ? "in progress" : "to do";
    return `<li class="step ${st}"><span class="mark" aria-hidden="true">${mark}</span><span class="sr-only">${srState}: </span><span class="num">${esc(s.id)}</span><span class="name">${esc(s.name)}</span></li>`;
  };
  const activeSteps = steps.filter(isActiveStep);
  const stepsHtml = steps.length
    ? steps.map(stepRow).join("")
    : `<li class="step todo"><span class="mark">&#9675;</span><span class="num"> </span><span class="name">no steps yet — run /build-status --init, or edit .claude/build-status.json</span></li>`;

  const measureRows = (state.measures ?? [])
    .map(
      (m) =>
        `<tr><td class="mid">${esc(m.id)}</td><td class="num-cell">${esc(m.value)}</td><td class="prov ${m.provenance === "verified" ? "canon" : "ours"}">${esc(m.provenance || "estimated")}</td></tr>`,
    )
    .join("");

  // Gate status is free-text (see command doc) rather than a fixed enum, because the detected
  // toolchain varies per repo (npm script vs cargo vs go vet). normalize's gateOk classifies it by
  // keyword, so any tool's own wording ("clean", "3 problems", "112 passed") colours the pill.
  const gatePill = (g) => {
    const cls = g.ok === false ? "warn" : g.ok === true ? "ok" : "";
    return `<span class="pill ${cls}">${esc(g.name)} ${esc(g.status)}</span>`;
  };
  const gates = state.gates || [];
  const gatesHtml = gates.length
    ? gates.map(gatePill).join("")
    : `<span class="pill">no gates detected</span>`;

  const commitsHtml = !isGitRepo
    ? `<li class="commit"><span class="subject">not a git repository</span></li>`
    : commits.length
      ? commits
          .map(
            (c) =>
              `<li class="commit"><span class="sha">${esc(c.sha)}</span><span class="subject">${esc(c.subject)}</span><span class="when">${esc(c.when)}</span></li>`,
          )
          .join("")
      : `<li class="commit"><span class="subject">no commits yet</span></li>`;

  // Rendered newest first and whole; the page's script re-sorts, filters and pages the same list
  // in place. The server renders the default view (the first page, the rest `hidden`, the
  // "Showing N of M" line), so nothing is hidden without the line saying so.
  const findings = sortFindingsNewestFirst((state.findings ?? []).map(normalizeFinding));
  const todayIso = localIsoDate(now);
  const findingsToday = findings.filter((f) => f.date && String(f.date).slice(0, 10) === todayIso).length;
  const anyImportance = findings.some((f) => f.importance);
  const findingsHtml = findings.map((f, i) => findingItemHtml(f, i, i >= FINDINGS_PAGE)).join("");
  const countBy = (list, keyOf) => {
    const m = new Map();
    for (const x of list) m.set(keyOf(x), (m.get(keyOf(x)) || 0) + 1);
    return m;
  };
  const kindCounts = [...countBy(findings, (f) => f.kind || "")].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const impCounts = countBy(findings, (f) => f.importance || 0);
  const pillBtn = (group, value, inner, n) =>
    `<button type="button" class="fpill" data-group="${group}" data-value="${esc(value)}" aria-pressed="false">${inner} <span class="fcount">${n}</span></button>`;
  const impPillsHtml = anyImportance
    ? [3, 2, 1, 0]
        .filter((k) => k !== 0 || impCounts.get(0))
        .map((k) => pillBtn("imp", String(k), `${k ? impMeter(k) : ""}${IMPORTANCE[k].label}`, impCounts.get(k) || 0))
        .join("")
    : "";
  const flaggedCount = findings.filter((f) => f.flagged).length;
  const flagPillsHtml = flaggedCount
    ? `<div class="fpills" role="group" aria-label="Filter to flagged findings"><span class="fpills-label" aria-hidden="true">Flagged</span>${pillBtn("flag", "1", "&#9733; Flagged", flaggedCount)}</div>`
    : "";
  const kindPillsHtml = kindCounts.map(([k, n]) => pillBtn("kind", k, k ? esc(k) : "no kind", n)).join("");
  const firstPage = Math.min(FINDINGS_PAGE, findings.length);
  const moreLeft = findings.length - firstPage;
  const findingsTabHtml = findings.length
    ? `
    <div class="card">
      <div class="fhead">
        <h2 id="findings-title">Findings worth keeping &middot; ${findings.length}</h2>
        ${anyImportance ? `<div class="seg" role="group" aria-label="Sort findings">
          <button type="button" class="seg-btn" data-sort="newest" aria-pressed="true">Newest first</button>
          <button type="button" class="seg-btn" data-sort="importance" aria-pressed="false">Most important</button>
        </div>` : ""}
      </div>
      ${flagPillsHtml}
      ${anyImportance ? `<div class="fpills" role="group" aria-label="Filter findings by importance"><span class="fpills-label" aria-hidden="true">Importance</span>${impPillsHtml}</div>` : ""}
      <div class="fpills" role="group" aria-label="Filter findings by kind"><span class="fpills-label" aria-hidden="true">Kind</span>${kindPillsHtml}</div>
      ${anyImportance ? `<p class="rubric"><strong>High</strong>: changes a headline result, finds or closes a path to a wrong result, or records your decision or a change of direction. <strong>Medium</strong>: a fix merged, a review, a measured experiment. <strong>Low</strong>: notes and housekeeping.</p>` : ""}
      <div class="fstatus-row"><span id="findings-status" class="fstatus" role="status" aria-live="polite">Showing ${firstPage} of ${findings.length} &middot; newest first</span><button type="button" id="findings-clear" class="linkbtn" hidden>Clear filters</button></div>
      <ul class="find find-full" id="findings-list" aria-labelledby="findings-title">${findingsHtml}</ul>
      <p id="findings-empty" class="qempty" hidden>No finding matches these filters.</p>
      <div class="fmore-row">
        <button type="button" id="findings-more" class="more-btn"${moreLeft > 0 ? "" : " hidden"}>Show ${Math.min(FINDINGS_PAGE, moreLeft)} more</button>
        <button type="button" id="findings-all" class="linkbtn"${moreLeft > FINDINGS_PAGE ? "" : " hidden"}>Show all ${findings.length}</button>
      </div>
    </div>`
    : `<div class="card"><h2>Findings worth keeping</h2><p class="qempty">No findings recorded yet &mdash; see "Findings &mdash; record each one when it happens" in /build-status.</p></div>`;
  const latestFindingsHtml = findings.length
    ? `<ul class="find">${findings.slice(0, 6).map((f) => findingItemHtml(f, null)).join("")}</ul>
       <button type="button" class="linkbtn goto" data-goto="findings">All ${findings.length} findings, to filter and sort &rsaquo;</button>`
    : `<p class="qempty">No findings recorded yet.</p>`;
  const findingBodiesHtml = findings
    .filter((f) => f.detail)
    .map(
      (f) =>
        `<div class="finding-body" data-finding-id="${esc(f.id)}" data-kind="${esc(f.kind || "")}" data-kind-class="${f.kind ? findingKindClass(f.kind) : ""}" data-date="${esc(f.date || "")}">${renderMiniMarkdown(f.detail)}</div>`,
    )
    .join("");

  // --- Freshness: when the state last changed is the first thing the owner looks for, so it
  // leads the page, above the title. Older than 3 hours reads as stale.
  const updatedMs = state.updated ? Date.parse(state.updated) : NaN;
  let freshnessHtml = "";
  if (Number.isFinite(updatedMs)) {
    const age = now.getTime() - updatedMs;
    const stale = age > STALE_MS;
    freshnessHtml = `<div class="freshness-top"><time class="updated${stale ? " stale" : ""}" datetime="${esc(state.updated)}" data-updated-at="${updatedMs}" title="State last changed ${esc(state.updated)}. Older than 3 hours reads as stale.">Updated <span class="upd-rel">${relTime(age)}</span> &middot; <span class="upd-abs">${esc(new Date(updatedMs).toLocaleString())}</span><span class="upd-flag"${stale ? "" : " hidden"}>Stale</span></time></div>\n`;
  }

  const metaBits = [];
  if (isGitRepo) {
    metaBits.push(`branch <code>${esc(branch)}</code>`);
    metaBits.push(dirty === 0 ? "working tree clean" : `${dirty} uncommitted file${dirty === 1 ? "" : "s"}`);
  } else {
    metaBits.push("not a git repository");
  }
  if (state.updated && !freshnessHtml) metaBits.push(`state updated ${esc(state.updated)}`);
  metaBits.push(`generated ${now.toLocaleTimeString()}`);
  metaBits.push("refreshes every 20s");
  // --- The app itself. Running: one solid "Open" button for the primary (web-first) link, quieter
  // chips for anything else answering. Registered-but-down ports are reference info: grouped by
  // service name so web/api pairs sit together ("landing  web :5228  :8155"), and folded behind a
  // <details> once there are more than a handful. Nothing registered: one muted line.
  const appRows = ctx.app?.ports ?? [];
  const appLinkable = appRows.filter((r) => r.up && r.url);
  const appPrimary = appLinkable[0];
  const appOtherUp = appRows.filter((r) => r.up && r !== appPrimary);
  const appDown = appRows.filter((r) => !r.up);
  const appName = (r) => r.short || r.label;
  const appNewTab = `<span class="sr-only"> (opens in a new tab)</span>`;
  const appUpChip = (r) =>
    r.url
      ? `<a class="app-link${r.web ? " web" : ""}" href="${esc(r.url)}" target="_blank" rel="noopener" title="${esc(r.label)}"><span class="app-dot" aria-hidden="true"></span><span class="app-label">${esc(appName(r))}</span> <span class="app-port">:${r.port}</span>${appNewTab}</a>`
      : `<span class="app-port-chip up" title="${esc(r.label)} (answering)"><span class="app-dot" aria-hidden="true"></span><span class="app-label">${esc(appName(r))}</span> <span class="app-port">:${r.port}</span><span class="sr-only"> (answering)</span></span>`;
  // "landing web" + "landing" -> one group "landing" with roles "web" and "".
  const APP_ROLE = /[\s_-]+(web|api|ui|frontend|backend|server|client|dev|db|worker)$/i;
  const appGroups = [];
  for (const r of appDown) {
    const name = appName(r);
    const base = name.replace(APP_ROLE, "").trim() || name;
    const role = name.slice(base.length).replace(/^[\s_-]+/, "");
    let g = appGroups.find((x) => x.base.toLowerCase() === base.toLowerCase());
    if (!g) appGroups.push((g = { base, ports: [] }));
    g.ports.push({ ...r, role });
  }
  appGroups.sort((a, b) => a.base.localeCompare(b.base));
  for (const g of appGroups) g.ports.sort((a, b) => b.web - a.web || a.port - b.port);
  const appGroupChip = (g) =>
    `<span class="app-grp"><span class="app-label">${esc(g.base)}</span>${g.ports
      .map((p) => `<span class="app-pp" title="${esc(p.label)} (not running)">${p.role ? `${esc(p.role)} ` : ""}<span class="app-port">:${p.port}</span></span>`)
      .join("")}</span>`;
  const appDownHtml = (lead) => {
    if (!appDown.length) return "";
    const chips = `<span class="app-grps">${appGroups.map(appGroupChip).join("")}</span>`;
    const n = appDown.length;
    if (n <= 4) return `<span class="app-hint${lead === "not running" ? " app-sep" : ""}">${lead === "not running" ? "Not running" : lead}</span>${chips}`;
    return `<details class="app-more${lead === "not running" ? " app-sep" : ""}"><summary>${lead === "registered ports" ? `${n} registered ports` : `${n} more registered, not running`}</summary>${chips}</details>`;
  };
  const appStateUp = `<span class="app-state up"><span class="app-dot" aria-hidden="true"></span>Running</span>`;
  const appStateDown = `<span class="app-state"><span class="app-ring" aria-hidden="true"></span>Not running</span>`;
  const appHtml = appRows.some((r) => r.up)
    ? `<section class="app is-up" aria-label="The app">${appStateUp}${
        appPrimary
          ? `<a class="app-link web app-primary" href="${esc(appPrimary.url)}" target="_blank" rel="noopener" title="${esc(appPrimary.label)}">Open ${esc(appName(appPrimary))} <span class="app-port">:${appPrimary.port}</span>${appNewTab}</a>`
          : ""
      }${appOtherUp.map(appUpChip).join("")}${appDownHtml("not running")}</section>`
    : `<section class="app${appRows.length ? "" : " is-empty"}" aria-label="The app">${appStateDown}${
        appRows.length ? appDownHtml("registered ports") : `<span class="app-hint">no ports registered for this repo</span>`
      }</section>`;

  metaBits.push(live ? `serving on <code>127.0.0.1:${port}</code>` : `read-only${reason ? ` (${esc(reason)})` : ""}`);

  // --- Open questions ---------------------------------------------------------------------
  // Owner topics (origin "owner") are conversations the owner started; they wait on the build, so
  // they never count as open questions, badge the tab or go through the severity filter.
  const allQuestions = state.questions ?? [];
  const questions = allQuestions.filter((q) => !isOwnerTopic(q));
  const topics = allQuestions.filter(isOwnerTopic);
  const openTopics = topics.filter((q) => !isSettled(q)).sort((a, b) => String(lastAt(b)).localeCompare(String(lastAt(a))));
  const settledTopics = topics.filter(isSettled);
  const unanswered = questions
    .filter((q) => !q.answer)
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
  const answered = questions
    .filter((q) => q.answer)
    .sort((a, b) => new Date(b.answeredAt || 0) - new Date(a.answeredAt || 0));

  const topSeverity = unanswered.length
    ? unanswered.reduce(
        (worst, q) => (SEVERITY_RANK[q.severity] > SEVERITY_RANK[worst] ? q.severity : worst),
        unanswered[0].severity,
      )
    : null;
  const badgeHtml = unanswered.length
    ? `<span class="badge ${esc(topSeverity ?? "")}">${unanswered.length}<span class="sr-only"> open</span></span>`
    : "";

  // Severity as a pill: the word, a colour and a border, so it never rests on colour alone.
  const sevPill = (sev) => `<span class="qsev ${esc(sev ?? "")}">${esc(sev ?? "")}</span>`;

  const answerControls = (q) => {
    if (!live) {
      return `<div class="qanswer-row"><input type="text" class="qanswer-input" data-id="${esc(q.id)}" placeholder="Answer&hellip;" disabled><button class="qsave-btn" data-id="${esc(q.id)}" disabled>Save</button></div>
      ${reason ? `<div class="qhint">Read-only right now &mdash; ${esc(reason)}.</div>` : ""}`;
    }
    return `<div class="qanswer-row"><input type="text" class="qanswer-input" data-id="${esc(q.id)}" placeholder="Answer&hellip;"><button class="qsave-btn" data-id="${esc(q.id)}">Save</button></div>`;
  };

  // Answered and not yet settled: Edit reopens the answer in place (the build hears the new one,
  // labelled updated) and Confirm hides the question for good. Neither is needed before the build
  // acts: an answer is worked as soon as it's given, and the question hides itself once the build
  // records that it acted on it (`acted`).
  const answeredControls = (q) => `
      <div class="qdone-row"><button type="button" class="qedit-btn" data-id="${esc(q.id)}" data-answer="${esc(q.answer)}" ${live ? "" : "disabled"}>Edit</button><button type="button" class="qconfirm-btn" data-id="${esc(q.id)}" title="Done with this question: hide it for good." ${live ? "" : "disabled"}>Confirm</button></div>
      ${live ? `<div class="qanswer-row qedit-row" data-id="${esc(q.id)}" hidden><input type="text" class="qanswer-input" data-id="${esc(q.id)}" aria-label="Edit your answer"><button class="qsave-btn" data-id="${esc(q.id)}">Save</button><button type="button" class="qcancel-btn" data-id="${esc(q.id)}">Cancel</button></div>` : ""}`;

  // The asker's recommended answer and why, one click to accept. Accepting saves the
  // recommendation (not the rationale) as the owner's answer from the page, the same as typing it
  // and pressing Save; confirming stays a separate click. A question missing one says so.
  const recommendControl = (q) => {
    const rec = typeof q.recommendation === "string" ? q.recommendation.trim() : "";
    if (!rec) return `<p class="qrec-missing">No recommendation yet.</p>`;
    const why = typeof q.rationale === "string" ? q.rationale.trim() : "";
    return `<div class="qrec-row"><div class="qrec-text"><p class="qrec"><span class="qrec-label">Recommended:</span> ${esc(rec)}</p>${why ? `<p class="qwhy"><span class="qrec-label">Why:</span> ${esc(why)}</p>` : ""}</div><button class="qaccept-btn" data-id="${esc(q.id)}" data-rec="${esc(rec)}" ${live ? "" : "disabled"}>Accept recommendation</button></div>`;
  };

  // The conversation around a question, oldest first, and a box to reply in. The owner's reply
  // posts to /reply; the build's come from `build-status reply`. The box is a .qanswer-input, so a
  // half-typed reply holds the refresh and survives it like an answer does.
  const whenOf = (at) => (at ? new Date(at).toLocaleString() : "");
  const threadHtml = (q) => {
    const msgs = threadOf(q);
    if (!msgs.length) return "";
    return `<ol class="qthread" aria-label="Conversation">${msgs
      .map(
        (m) => `<li class="tmsg ${m.from}"><div class="tmeta"><span class="twho">${m.from === "owner" ? "You" : "The build"}</span>${m.via === "chat" ? " &middot; in chat" : ""}<span class="twhen">${esc(whenOf(m.at))}</span></div><p class="ttext">${esc(m.text)}</p></li>`,
      )
      .join("")}</ol>`;
  };
  const replyControls = (q, label = "Reply") => `
      <div class="qreply-row"><textarea class="qanswer-input treply" data-id="__reply__:${esc(q.id)}" rows="2" aria-label="Reply to the build about this question" placeholder="Reply to the build&hellip;"${live ? "" : " disabled"}></textarea><button type="button" class="qreply-btn" data-id="${esc(q.id)}"${live ? "" : " disabled"}>${label}</button></div>`;
  // On an agent's question the conversation folds under "Discuss", open once it has messages.
  const discuss = (q) => {
    const n = threadOf(q).length;
    return `<details class="qdiscuss" data-id="${esc(q.id)}"${n ? " open" : ""}><summary>Discuss${n ? ` &middot; ${n} message${n === 1 ? "" : "s"}` : ""}</summary>${threadHtml(q)}${replyControls(q)}</details>`;
  };

  const openQuestionCard = (q) => `
    <div class="qcard ${esc(q.severity)}" data-id="${esc(q.id)}" data-sev="${esc(q.severity ?? "")}">
      ${sevPill(q.severity)}
      <p class="qtext">${esc(q.question)}</p>
      ${q.context ? `<p class="qctx">${esc(q.context)}</p>` : ""}
      ${recommendControl(q)}
      ${answerControls(q)}
      ${discuss(q)}
    </div>`;

  // A topic the owner started: the whole thing is the conversation, plus Close (the owner is done
  // with it; the same confirm as an answered question's). Acted on by the build also settles it.
  const topicCard = (q) => {
    const last = threadOf(q).at(-1);
    const waiting = last?.from === "owner" ? "waiting for the build" : "the build replied";
    return `
    <div class="qcard qtopic" data-id="${esc(q.id)}">
      <span class="qsev topic">your topic</span> <span class="tstate">${waiting}</span>
      ${threadHtml(q)}
      ${replyControls(q)}
      <div class="qdone-row"><button type="button" class="qconfirm-btn" data-id="${esc(q.id)}" title="Done with this topic: hide it for good." ${live ? "" : "disabled"}>Close topic</button></div>
    </div>`;
  };
  const askBoxHtml = `
    <div class="card qask" id="ask-card">
      <h2>Ask the build</h2>
      <p class="qexplain qask-hint">Start a conversation about anything: a question, a worry, an idea. The build sees it the next time it checks for answers, and replies here.</p>
      <textarea class="qanswer-input tbox" data-id="__topic__" rows="3" aria-label="Ask the build" placeholder="What would you like to ask or tell the build?"${live ? "" : " disabled"}></textarea>
      <div class="qask-row"><button type="button" id="topic-send" class="csend-btn"${live ? "" : " disabled"}>Ask</button></div>
      ${!live && reason ? `<div class="qhint">Read-only right now &mdash; ${esc(reason)}.</div>` : ""}
    </div>`;

  // How the answer got into the file: the page writes answeredVia "page", the CLI's chat
  // recorder writes "chat" plus the owner's words verbatim; no answeredVia means a hand edit.
  const answeredHow = (q) =>
    q.answeredVia === "page"
      ? q.recommendation && q.answer === String(q.recommendation).trim() ? "on the page (accepted the recommendation)" : "on the page"
      : q.answeredVia === "chat" ? "in chat" : "edited into the file";
  const answeredCard = (q) => `
    <div class="qcard qanswered ${esc(q.severity)}" data-id="${esc(q.id)}" data-sev="${esc(q.severity ?? "")}">
      ${sevPill(q.severity)}
      <p class="qtext">${esc(q.question)}</p>
      ${q.context ? `<p class="qctx">${esc(q.context)}</p>` : ""}
      <p class="qanswer-text">${esc(q.answer)}</p>
      ${q.answerQuote && q.answerQuote !== q.answer ? `<blockquote class="qquote">${esc(q.answerQuote)}</blockquote>` : ""}
      <div class="qmeta">answered ${answeredHow(q)} ${esc(q.answeredAt ? new Date(q.answeredAt).toLocaleString() : "")}${q.editedAt ? " &middot; edited" : ""}</div>
      ${answeredControls(q)}
      ${discuss(q)}
    </div>`;

  // Open first (worst severity first), then answered and still being worked, newest first. Settled
  // ones (confirmed, acted on, or ratified before Ratify was retired) are hidden, and a line says how
  // many. The severity pills filter what's shown.
  const settled = answered.filter(isSettled);
  const working = answered.filter((q) => !isSettled(q));
  const shownQuestions = [...unanswered, ...working];
  const sevCounts = countBy(shownQuestions, (q) => String(q.severity ?? ""));
  const sevOrder = [...sevCounts.keys()].sort((a, b) => (SEVERITY_RANK[b] ?? 0) - (SEVERITY_RANK[a] ?? 0) || a.localeCompare(b));
  const sevPillsHtml = sevOrder
    .map((k) => `<button type="button" class="fpill" data-group="sev" data-value="${esc(k)}" aria-pressed="false"><span class="sev-dot ${esc(k)}" aria-hidden="true"></span>${k ? esc(k) : "no severity"} <span class="fcount">${sevCounts.get(k)}</span></button>`)
    .join("");
  const secCount = (n) => `<span class="qsec-count" data-total="${n}">${n}</span>`;
  const settledCount = settled.length + settledTopics.length;
  const settledNote = settledCount
    ? `<p class="qsettled">${settledCount} settled question${settledCount === 1 ? "" : "s"} hidden: confirmed${settledTopics.length ? " or closed" : ""} by you, or acted on by the build.</p>`
    : "";
  const topicsHtml = openTopics.length
    ? `
    <div class="card qsection qtopics">
      <h2>Your topics &middot; ${openTopics.length}</h2>
      ${openTopics.map(topicCard).join("")}
    </div>`
    : "";
  const questionsTabHtml = askBoxHtml + topicsHtml + (shownQuestions.length
    ? `
    <div class="qfilter-bar">
      <div class="fpills" role="group" aria-label="Filter questions by severity"><span class="fpills-label" aria-hidden="true">Severity</span>${sevPillsHtml}</div>
      <div class="fstatus-row"><span id="q-status" class="fstatus" role="status" aria-live="polite">All ${shownQuestions.length} questions</span><button type="button" id="q-clear" class="linkbtn" hidden>Clear filter</button></div>
    </div>
    <div class="card qsection">
      <h2>Open &middot; ${secCount(unanswered.length)}</h2>
      ${unanswered.length ? unanswered.map(openQuestionCard).join("") : `<div class="qempty">Nothing open &mdash; all caught up.</div>`}
    </div>
    <div class="card qsection">
      <h2>Answered &middot; ${secCount(working.length)}</h2>
      ${working.length ? `<p class="qexplain">The build acts on an answer as soon as you give it; nothing waits for you to confirm. Edit changes your answer, and the build hears the new one. Confirm hides a question for good, and it hides by itself once the build has acted on it.</p>${working.map(answeredCard).join("")}` : `<div class="qempty">No answer is still being worked.</div>`}
    </div>
    ${settledNote}`
    : `<div class="card"><div class="qempty">No open questions right now.</div>${settledNote}</div>`);

  const overviewQuestionsHtml = `
      <div class="qstats">
        <div class="qstat"><strong>${unanswered.length}</strong> open</div>
        <div class="qstat"><strong>${working.length}</strong> answered, being worked</div>
        <div class="qstat"><strong>${settled.length}</strong> settled</div>
        ${openTopics.length ? `<div class="qstat"><strong>${openTopics.length}</strong> topic${openTopics.length === 1 ? "" : "s"} you started</div>` : ""}
      </div>
      ${
        unanswered.length
          ? `<ul class="qlist">${unanswered
              .slice(0, 5)
              .map((q) => `<li>${sevPill(q.severity)} <span>${esc(q.question)}</span></li>`)
              .join("")}</ul>${unanswered.length > 5 ? `<p class="qmore">and ${unanswered.length - 5} more</p>` : ""}`
          : `<p class="qempty">Nothing open &mdash; all caught up.</p>`
      }
      <button type="button" class="linkbtn goto" data-goto="questions">${unanswered.length ? "Answer them" : working.length ? "Review answers" : "Open questions"} &rsaquo;</button>`;

  // --- Comments: the owner's notes to the build. The keeper passes each to the main session when
  // its priority says (SKILL.md §5) and records what became of it; the card shows where each
  // stands. The box is a .qanswer-input, so a half-typed comment holds the refresh and survives it.
  const PRIORITY_RANK = { urgent: 4, high: 3, normal: 2, low: 1 };
  const OPEN_COMMENT = new Set(["new", "held", "sent"]);
  const COMMENT_STATUS = { new: "waiting for the keeper", held: "held for the right moment", sent: "with the build", filed: "filed to the backlog", done: "done", declined: "declined" };
  const comments = state.comments ?? [];
  const cStatus = (c) => (COMMENT_STATUS[c.status] ? c.status : "new");
  const cPrio = (c) => (PRIORITY_RANK[c.priority] ? c.priority : "normal");
  const commentsOpen = comments
    .filter((c) => OPEN_COMMENT.has(cStatus(c)))
    .sort((a, b) => PRIORITY_RANK[cPrio(b)] - PRIORITY_RANK[cPrio(a)] || String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const commentsClosed = comments
    .filter((c) => !OPEN_COMMENT.has(cStatus(c)))
    .sort((a, b) => String(b.statusAt ?? "").localeCompare(String(a.statusAt ?? "")));
  const prioOptions = (sel) => COMMENT_PRIORITIES.map(([v, label]) => `<option value="${v}"${v === sel ? " selected" : ""}>${label}</option>`).join("");
  const commentItem = (c) => {
    const st = cStatus(c);
    const p = cPrio(c);
    const open = OPEN_COMMENT.has(st);
    return `<li class="citem ${p}" data-id="${esc(c.id)}">
      <div class="chead"><span class="cprio ${p}">${p}</span><span class="cstatus ${st}">${COMMENT_STATUS[st]}</span><span class="cwhen">${esc(c.at ? new Date(c.at).toLocaleString() : "")}</span></div>
      <p class="ctext">${esc(c.text)}</p>
      ${c.note ? `<p class="cnote"><span class="qrec-label">Note:</span> ${esc(c.note)}</p>` : ""}
      ${open && live ? `<label class="cprio-change">Priority <select class="cprio-select" data-id="${esc(c.id)}" data-was="${p}">${prioOptions(p)}</select></label>` : ""}
    </li>`;
  };
  // The box's Improve and Enrich queue the draft for the keeper, which rewrites it on its own model
  // (prompt-improver's modes) and records the result; the latest open request shows under the box.
  const REWRITE_LABEL = { improve: ["Improving", "Improved"], enrich: ["Enriching", "Enriched"] };
  const rewriteOpen = (state.rewrites ?? []).filter((r) => r.status !== "closed" && REWRITE_LABEL[r.mode]).at(-1);
  const rewriteHtml = (() => {
    const r = rewriteOpen;
    if (!r) return "";
    const [ing, ed] = REWRITE_LABEL[r.mode];
    const stale = r.status === "pending" && now - Date.parse(r.at ?? "") > REWRITE_STALE_MS;
    const dismiss = live ? `<button type="button" class="linkbtn crw-close" data-id="${esc(r.id)}">Dismiss</button>` : "";
    const head = (txt) => `<div class="crw-head">${txt}</div>`;
    let body;
    if (r.status === "done") {
      body = `${head(`${ed} by the keeper`)}<p class="crw-text">${esc(r.result ?? "")}</p>
        <div class="crw-actions">${live ? `<button type="button" class="crw-use" data-id="${esc(r.id)}" data-result="${esc(r.result ?? "")}">Use this</button>` : ""}${dismiss}</div>`;
    } else if (r.status === "failed") {
      body = `${head(`The keeper couldn't ${r.mode} it`)}<p class="crw-note">${esc(r.note ?? "")}</p><div class="crw-actions">${dismiss}</div>`;
    } else if (stale) {
      body = `${head(`${ing} &mdash; not picked up`)}<p class="crw-note">The keeper hasn't taken this up in 30 minutes; its watcher may not be running. Your draft is still in the box.</p><div class="crw-actions">${dismiss}</div>`;
    } else {
      body = `${head(`${ing} your draft&hellip;`)}<p class="crw-note">The keeper rewrites it on its own model: seconds while its watcher runs, otherwise at its next pass. Your draft stays in the box; the rewrite appears here.</p><div class="crw-actions">${dismiss}</div>`;
    }
    return `<div class="crw ${esc(r.status)}${stale ? " stale" : ""}" data-rid="${esc(r.id)}" data-status="${stale ? "stale" : esc(r.status)}">${body}</div>`;
  })();
  const commentsCardHtml = `
    <div class="card" id="comments-card">
      <h2>Comments for the build${commentsOpen.length ? ` &middot; ${commentsOpen.length} open` : ""}</h2>
      <textarea class="qanswer-input cbox" data-id="__comment__" rows="3" aria-label="Comment for the build" placeholder="A change, an idea, something you noticed&hellip;"${live ? "" : " disabled"}></textarea>
      <div class="ccompose-row"><label>Priority <select id="comment-priority"${live ? "" : " disabled"}>${prioOptions("normal")}</select></label><span class="cbtns"><button type="button" class="crw-btn" data-mode="improve" title="The keeper tightens your draft: clearer, same scope"${live ? "" : " disabled"}>Improve</button><button type="button" class="crw-btn" data-mode="enrich" title="The keeper fills in context, constraints and what done looks like"${live ? "" : " disabled"}>Enrich</button><button type="button" id="comment-send" class="csend-btn"${live ? "" : " disabled"}>Send</button></span></div>
      <p class="chint" id="comment-prio-hint">${esc(COMMENT_HINTS.normal)}</p>
      ${rewriteHtml}
      ${!live && reason ? `<div class="qhint">Read-only right now &mdash; ${esc(reason)}.</div>` : ""}
      ${commentsOpen.length ? `<ul class="clist">${commentsOpen.map(commentItem).join("")}</ul>` : ""}
      ${commentsClosed.length ? `<details class="cclosed"><summary>Handled &middot; ${commentsClosed.length}</summary><ul class="clist">${commentsClosed.map(commentItem).join("")}</ul></details>` : ""}
    </div>`;

  // The Roadmap tab exists only when the state carries `_roadmap`; without it nothing below changes.
  const roadmap = roadmapView(state, { live, reason });

  // The tabs, in order; the first is the default. The URL hash (#findings, #questions, …) opens
  // another, and the old #board lands on the Overview.
  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "findings", label: "Findings", badge: findingsToday ? `<span class="badge info" title="${findingsToday} dated today">${findingsToday} today</span>` : "" },
    { id: "questions", label: "Q&amp;A", badge: badgeHtml },
    { id: "steps", label: "Steps" },
    ...(roadmap ? [{ id: "roadmap", label: "Roadmap", badge: roadmap.badge }] : []),
    { id: "gate", label: measureRows ? "Measures &amp; gate" : "Gate" },
    ...extraTabs.map((t) => ({ id: t.id, label: esc(t.label || t.id), badge: t.badge ? `<span class="badge info">${esc(t.badge)}</span>` : "" })),
  ];
  // localStorage keys carry the repo name: file:// pages (the read-only fallback) share one origin.
  const storeKey = JSON.stringify(`build-status:${title}`).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${unanswered.length ? `(${unanswered.length}) ` : ""}${esc(title)} — build status</title>
<link rel="icon" type="image/svg+xml" href="${faviconHref(title, unanswered.length ? topSeverity || "amber" : null)}">
<style>
  :root{--navy:#08284D;--blue:#0B90DA;--sky:#7AC8F3;--green:#65BC7B;--sun:#FFC335;--ember:#E96900;
        --ink:#12212f;--mut:#5b6b7c;--line:#dde5ec;--bg:#f6f9fc;--card:#fff;
        /* --blue and --ember are under 4.5:1 on white: kept for bars, borders and dots; text uses these. */
        --blue-text:#0A6FB3;--ember-text:#A8520A}
  *{box-sizing:border-box}
  [hidden]{display:none !important}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  button:focus-visible,summary:focus-visible,[role="tabpanel"]:focus-visible{outline:2px solid var(--blue-text);outline-offset:2px}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:1080px;margin:0 auto;padding:28px 24px 64px}
  header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:4px}
  h1{font-size:23px;margin:0;letter-spacing:-.2px;color:var(--navy)}
  .phase{color:var(--mut);font-size:14px}
  .freshness-top{margin:0 0 10px;font-size:14px}
  .updated{font-weight:600;color:var(--ink)}
  .updated .upd-abs{font-weight:400;color:var(--mut)}
  .updated.stale{display:inline-block;background:#fff4e5;color:var(--ember-text);border:1px solid #f5c89a;border-radius:999px;padding:2px 10px}
  .upd-flag{margin-left:8px;font-size:11.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;background:var(--ember-text);color:#fff;border-radius:999px;padding:1px 7px}
  .meta{color:var(--mut);font-size:12.5px;margin:6px 0 18px}
  .app{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:10px 0 0;font-size:13px;color:var(--mut)}
  .app.is-up{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:7px 10px 7px 12px;margin-top:12px}
  .app.is-empty{font-size:12.5px}
  .app-state{display:inline-flex;align-items:center;gap:6px;min-height:28px;align-self:flex-start;font-weight:600;color:var(--mut);margin-right:2px}
  .app.is-up .app-state{min-height:32px}
  .app.is-empty .app-state{min-height:0;align-self:center}
  .app-state.up{color:#1d6b38}
  .app-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#2F9E55}
  .app-state .app-dot{box-shadow:0 0 0 3px #d9f0e0}
  .app-ring{flex:none;width:8px;height:8px;border-radius:50%;border:1.5px solid #9fb0c2}
  .app-port{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
  .app-link,.app-port-chip{display:inline-flex;align-items:center;gap:5px;min-height:28px;padding:2px 10px;border-radius:999px;border:1px solid #9cc3e0;background:#eef6fc;color:var(--navy);text-decoration:none;max-width:100%}
  .app-port-chip{border-color:var(--line);background:#f2f7fb}
  .app-link:hover{border-color:var(--blue-text)}
  .app-link:focus-visible,.app-more>summary:focus-visible{outline:2px solid var(--blue-text);outline-offset:2px}
  a.app-primary{min-height:32px;padding:4px 14px;border-radius:8px;border:0;background:var(--navy);color:#fff;font-weight:600;font-size:14px;overflow-wrap:anywhere}
  a.app-primary .app-port{font-weight:400;opacity:.78}
  a.app-primary:hover{background:var(--blue-text)}
  .app-hint{color:var(--mut)}
  .app-sep{border-left:1px solid var(--line);padding-left:10px;margin-left:2px}
  .app-grps{display:inline-flex;flex-wrap:wrap;gap:6px;min-width:0}
  .app-grp{display:inline-flex;align-items:center;flex-wrap:wrap;gap:2px 8px;min-height:26px;padding:1px 10px;border:1px dashed #c9d6e2;border-radius:999px;font-size:12.5px;color:var(--mut);max-width:100%}
  .app-grp .app-label{color:#3d4f63}
  .app-pp{white-space:nowrap}
  .app-more{flex:1 1 220px;min-width:0;align-self:flex-start}
  .app-more>summary{display:inline-flex;align-items:center;min-height:28px;cursor:pointer;color:var(--mut);font-size:12.5px;list-style:none;padding:0 4px;border-radius:6px}
  .app-more>summary::-webkit-details-marker{display:none}
  .app-more>summary::before{content:"";width:0;height:0;margin-right:7px;border-style:solid;border-width:4px 0 4px 6px;border-color:transparent transparent transparent currentColor;transition:transform .15s}
  .app-more[open]>summary::before{transform:rotate(90deg)}
  .app-more>summary:hover{color:var(--navy)}
  .app-more .app-grps{display:flex;margin:4px 0 2px}
  @media(prefers-reduced-motion:reduce){.app-more>summary::before{transition:none}}
  .meta code{background:#eaf1f7;padding:1px 6px;border-radius:4px;color:var(--navy)}
  .tabs{display:flex;gap:2px;margin-bottom:18px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:thin}
  .tab-btn{appearance:none;border:none;background:none;font:inherit;font-size:14px;font-weight:600;
           color:var(--mut);padding:9px 15px;cursor:pointer;border-bottom:3px solid transparent;
           display:flex;align-items:center;gap:7px;white-space:nowrap;flex:none}
  .tab-btn.active,.tab-btn[aria-selected="true"]{color:var(--navy);border-bottom-color:var(--blue)}
  .tab-btn:hover{color:var(--navy)}
  .tab-btn:focus-visible{outline-offset:-2px;border-radius:6px 6px 0 0}
  .tabpanel:focus-visible{outline-offset:4px;border-radius:10px}
  .badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;
         padding:0 5px;border-radius:99px;font-size:11px;font-weight:700;color:#fff;line-height:1}
  .badge.red{background:var(--ember-text)} .badge.amber{background:var(--sun);color:#5c3d00} .badge.green{background:#2F7A45}
  .badge.info{background:var(--blue-text)}
  .tabpanel{display:none} .tabpanel.active{display:block}
  .grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.95fr);gap:18px;align-items:start}
  .grid.even{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .grid>div{min-width:0}
  @media(max-width:880px){.grid,.grid.even{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:18px}
  .card h2{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);margin:0 0 12px}
  .card > summary{cursor:pointer;list-style:none}
  .card > summary::-webkit-details-marker{display:none}
  .card > summary h2{display:inline-block;margin:0}
  details.card[open] > summary{margin-bottom:12px}
  .bar{height:7px;background:#e7eef4;border-radius:99px;overflow:hidden;margin:2px 0 14px}
  .bar i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--green));width:${pct}%}
  ul.steps{list-style:none;margin:0;padding:0}
  .step{display:flex;align-items:flex-start;gap:9px;padding:5px 0;font-size:14px}
  .step .mark{width:15px;flex:none;text-align:center;font-size:13px}
  .step .num{width:16px;flex:none;color:var(--mut);font-variant-numeric:tabular-nums;font-size:12.5px}
  .step.done{color:var(--mut)} .step.done .mark{color:var(--green)}
  .step.done .name{text-decoration:line-through;text-decoration-color:#c3d2df}
  .step.active{font-weight:600;color:var(--navy)} .step.active .mark{color:var(--ember-text)}
  .step.todo .mark{color:#c3d2df}
  .pills{display:flex;gap:8px;flex-wrap:wrap}
  .pill{font-size:12.5px;padding:3px 10px;border-radius:99px;border:1px solid var(--line);background:#f2f7fb;color:var(--navy)}
  .pill.ok{background:#eaf7ee;border-color:#c9e8d3;color:#1d6b38}
  .pill.warn{background:#fff4e2;border-color:#ffd79a;color:#8a4b06}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  td{padding:4px 0;border-bottom:1px solid #eef3f7;vertical-align:top}
  .mid{color:var(--mut);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
  .num-cell{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;padding-right:10px}
  .prov{font-size:11.5px;text-align:right;white-space:nowrap}
  .prov.canon{color:#1d6b38} .prov.ours{color:var(--mut)}
  ol.commits{list-style:none;margin:0;padding:0}
  .commit{display:flex;gap:9px;padding:6px 0;border-bottom:1px solid #eef3f7;font-size:13.5px}
  .commit:last-child{border-bottom:0}
  .sha{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--blue-text);flex:none;font-size:12.5px}
  .when{color:var(--mut);flex:none;font-size:12px;width:78px;text-align:right}
  .subject{flex:1}
  ul.find{margin:0;padding:0;list-style:none}
  .find li{padding:8px 6px 8px 16px;border-bottom:1px solid #eef3f7;position:relative;font-size:13.5px;color:#243546}
  .find li:last-child{border-bottom:0}
  .find li:before{content:"";position:absolute;left:4px;top:15px;width:5px;height:5px;border-radius:99px;background:var(--sun)}
  .find-item{display:grid;grid-template-columns:minmax(0,1fr);row-gap:4px}
  .fmeta{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
  .find-full .find-item{grid-template-columns:250px minmax(0,1fr);column-gap:12px;align-items:baseline}
  @media(max-width:720px){.find-full .find-item{grid-template-columns:minmax(0,1fr)}}
  .find-item.clickable{cursor:pointer;border-radius:6px}
  .find-item.clickable:hover,.find-item.clickable:focus{background:#f6f9fc;outline:none}
  .find-item.clickable:focus-visible{box-shadow:0 0 0 2px var(--blue) inset}
  .ftext{min-width:0}
  .ftag{display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
        padding:2px 7px;border-radius:99px;vertical-align:middle;white-space:nowrap}
  .imp{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;line-height:1.3;
       padding:1px 8px 1px 6px;border-radius:99px;border:1px solid;white-space:nowrap}
  .imp-3{background:var(--navy);border-color:var(--navy);color:#fff}
  .imp-2{background:#fff;border-color:#9fb3c8;color:var(--navy)}
  .imp-1{background:#f2f5f8;border-color:#dde4ee;color:#44546a}
  .imp-meter{display:inline-flex;align-items:flex-end;gap:1px;height:9px}
  .imp-meter i{display:block;width:3px;border-radius:1px;background:currentColor;opacity:.28}
  .imp-meter i:nth-child(1){height:4px} .imp-meter i:nth-child(2){height:6.5px} .imp-meter i:nth-child(3){height:9px}
  .imp-meter i.on{opacity:1}
  .fhead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
  .fhead h2{margin:0}
  .seg{display:inline-flex;border:1px solid #c9d6e2;border-radius:8px;overflow:hidden}
  .seg-btn{appearance:none;border:0;background:#fff;color:var(--navy);font:inherit;font-size:12.5px;font-weight:600;padding:5px 12px;cursor:pointer}
  .seg-btn + .seg-btn{border-left:1px solid #c9d6e2}
  .seg-btn[aria-pressed="true"]{background:var(--navy);color:#fff}
  .seg-btn:focus-visible{outline-offset:-3px}
  .fpills{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:0 0 8px}
  .fpills-label{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);font-weight:700;width:84px;flex:none}
  .fpill{appearance:none;font:inherit;font-size:12.5px;line-height:1.3;padding:3px 10px;border-radius:99px;border:1px solid #c9d6e2;
         background:#fff;color:var(--navy);cursor:pointer;display:inline-flex;align-items:center;gap:5px}
  .fpill:hover{border-color:var(--blue-text)}
  .fpill[aria-pressed="true"]{background:var(--navy);border-color:var(--navy);color:#fff}
  .fpill[aria-pressed="true"]::before{content:"✓";font-weight:700}
  .fcount{color:var(--mut);font-variant-numeric:tabular-nums;font-weight:600}
  .fpill[aria-pressed="true"] .fcount{color:#d6e3f0}
  .rubric{font-size:12px;color:var(--mut);margin:10px 0 12px;padding-top:10px;border-top:1px solid #eef3f7}
  .rubric strong{color:#243546}
  .fstatus-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 6px}
  .fstatus{font-size:12.5px;color:#243546;font-weight:600}
  .linkbtn{appearance:none;border:0;background:none;padding:2px 0;font:inherit;font-size:12.5px;font-weight:600;color:var(--blue-text);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .linkbtn.goto{display:inline-block;margin-top:10px;text-decoration:none}
  .linkbtn.goto:hover{text-decoration:underline}
  .fmore-row{display:flex;align-items:center;gap:16px;margin-top:10px}
  .more-btn{appearance:none;border:1px solid #c9d6e2;background:#fff;color:var(--navy);font:inherit;font-size:13px;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer}
  .more-btn:hover{border-color:var(--blue-text)}
  .ftag.research{background:#e6f4fc;border:1px solid #bfe4f7;color:#0B6FAD}
  .ftag.bug{background:#fde9db;border:1px solid #f7c9a3;color:#8a3c06}
  .ftag.correction{background:#fff4e2;border:1px solid #ffd79a;color:#8a4b06}
  .ftag.decision{background:#eaf7ee;border:1px solid #c9e8d3;color:#1d6b38}
  .ftag.measure{background:#eef1fb;border:1px solid #cfd8f2;color:#2a3f8f}
  .ftag.milestone{background:#e8f6f5;border:1px solid #bfe6e2;color:#0f6b63}
  .ftag.blocker{background:#fbe4e4;border:1px solid #f2bcbc;color:#8f1d1d}
  .ftag.other{background:#eef1f6;border:1px solid #dde4ee;color:#3b4b5e}
  .fdate{color:var(--mut);font-size:11.5px;margin-left:8px;white-space:nowrap;font-variant-numeric:tabular-nums}
  .find-item .fdate{margin:0 2px 0 0;flex:none;font-weight:600}
  .fmore{color:var(--blue-text);font-size:12px;font-weight:600;white-space:nowrap}
  .modal-backdrop{position:fixed;inset:0;background:rgba(8,40,77,.45);display:flex;align-items:center;
                   justify-content:center;padding:24px;z-index:50}
  .modal-backdrop[hidden]{display:none}
  .modal{background:#fff;border-radius:12px;max-width:680px;width:100%;max-height:80vh;overflow:auto;
         padding:20px 24px 24px;box-shadow:0 20px 60px rgba(8,40,77,.28)}
  .modal-head{display:flex;align-items:center;gap:8px;margin-bottom:14px;position:sticky;top:0;background:#fff;padding-top:2px}
  .modal-close{margin-left:auto;border:none;background:none;font-size:22px;line-height:1;cursor:pointer;
               color:var(--mut);padding:2px 8px;border-radius:6px}
  .modal-close:hover,.modal-close:focus-visible{background:#f2f7fb;color:var(--navy);outline:none}
  .modal-body{font-size:14px;line-height:1.6;color:#243546}
  .modal-body p{margin:0 0 12px}
  .modal-body ul{margin:0 0 12px;padding-left:20px}
  .modal-body li{margin-bottom:4px}
  .modal-body pre{background:#f6f9fc;border:1px solid var(--line);border-radius:8px;padding:10px 12px;
                   overflow-x:auto;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}
  .note{background:#fff8e8;border:1px solid #ffe2ad;border-radius:8px;padding:11px 14px;font-size:13.5px;color:#6b4708;margin-bottom:18px}
  .now-card .note{margin:12px 0 0}
  .now-progress{display:flex;align-items:center;gap:12px}
  .now-progress .bar{flex:1;margin:0}
  .now-count{font-size:12.5px;color:var(--mut);white-space:nowrap;font-variant-numeric:tabular-nums}
  .now-step{font-size:14px;color:var(--navy);font-weight:600;margin:10px 0 0}
  .now-label{display:inline-block;font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--ember-text);font-weight:700;margin-right:6px}
  .now-gate{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
  .now-gate .pill{font-size:11.5px;padding:2px 9px}
  .qstats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px}
  .qstat{background:#f6f9fc;border:1px solid #eef3f7;border-radius:8px;padding:8px 10px;font-size:12px;color:var(--mut);line-height:1.3}
  .qstat strong{display:block;font-size:20px;color:var(--navy);font-variant-numeric:tabular-nums}
  ul.qlist{list-style:none;margin:0;padding:0}
  .qlist li{padding:7px 0;border-bottom:1px solid #eef3f7;font-size:13.5px;color:#243546}
  .qlist li:last-child{border-bottom:0}
  .qmore{font-size:12.5px;color:var(--mut);margin:6px 0 0}
  .qfilter-bar{margin:0 0 14px}
  .summary-hint{font-size:12px;color:var(--blue-text);font-weight:600;margin-left:10px}
  details[open] > summary .summary-hint{display:none}
  #tab-gate .num-cell{text-align:left;white-space:normal;font-weight:500;padding-left:14px}
  .qcard{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
  .qcard.red{border-left-color:var(--ember)} .qcard.amber{border-left-color:var(--sun)} .qcard.green{border-left-color:var(--green)}
  .qcard .qtext{font-size:14.5px;font-weight:600;color:var(--ink);margin:6px 0}
  .qcard .qctx{font-size:13px;color:var(--mut);margin:0 0 10px}
  .qsev{display:inline-block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;
        padding:1px 8px;border-radius:99px;border:1px solid var(--line);background:#f2f5f8;color:#3b4b5e;vertical-align:middle}
  .qsev.red{background:#fde9db;border-color:#f7c9a3;color:#8a3c06}
  .qsev.amber{background:#fff4e2;border-color:#ffd79a;color:#6b4708}
  .qsev.green{background:#eaf7ee;border-color:#c9e8d3;color:#1d6b38}
  .sev-dot{display:inline-block;width:8px;height:8px;border-radius:99px;background:var(--line)}
  .sev-dot.red{background:var(--ember)} .sev-dot.amber{background:var(--sun)} .sev-dot.green{background:var(--green)}
  .qanswer-row{display:flex;gap:8px;margin-top:8px}
  .qanswer-row input[type=text]{flex:1;padding:7px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13.5px}
  .qanswer-row button{padding:7px 14px;border:none;border-radius:6px;background:var(--blue-text);color:#fff;font-weight:600;font-size:13.5px;cursor:pointer}
  .qanswer-row button:disabled,.qanswer-row input:disabled{opacity:.55;cursor:not-allowed}
  .qrec-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 4px;padding:8px 10px;background:#f2f7fb;border:1px solid #dbe7f1;border-radius:6px}
  .qrec-text{flex:1;min-width:200px}
  .qrec,.qwhy{margin:0;font-size:13.5px;color:#243546}
  .qwhy{margin-top:3px;font-size:13px;color:#4a5d70}
  .qrec-missing{margin:6px 0 4px;font-size:13px;font-style:italic;color:#8a6d1a}
  .qrec-label{font-weight:700;color:var(--navy)}
  .qrec-row button{padding:6px 12px;border:1px solid var(--blue-text);border-radius:6px;background:#fff;color:var(--blue-text);font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap}
  .qrec-row button:disabled{opacity:.55;cursor:not-allowed}
  .qdone-row{display:flex;gap:8px;margin-top:10px}
  .qdone-row button{padding:5px 12px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--navy);font-weight:600;font-size:12.5px;cursor:pointer}
  .qdone-row button.qconfirm-btn{border-color:#c9e8d3;background:#eaf7ee;color:#1d6b38}
  .qdone-row button:disabled{opacity:.55;cursor:not-allowed}
  .qanswer-row button.qcancel-btn{background:#fff;color:var(--navy);border:1px solid var(--line)}
  .qsettled{color:var(--mut);font-size:12.5px;margin:-6px 2px 18px}
  .qhint{font-size:12px;color:var(--mut);margin-top:6px;font-style:italic}
  .qhint code{background:#eaf1f7;padding:1px 5px;border-radius:4px;color:var(--navy)}
  .qanswered{background:#f8fafc}
  .qanswer-text{font-size:13.5px;color:#243546;margin:4px 0}
  .qmeta{font-size:12px;color:var(--mut);margin-top:4px}
  .qempty{color:var(--mut);font-size:13.5px;padding:8px 0}
  .qexplain{color:var(--mut);font-size:12.5px;margin:0 0 14px;padding-bottom:12px;border-bottom:1px solid #eef3f7}
  footer{color:var(--mut);font-size:12px;margin-top:26px;text-align:center}
  .draft-banner{border-left:4px solid var(--sun);background:#fffaf0;font-size:13.5px}
  .qquote{margin:4px 0;padding:4px 10px;border-left:3px solid var(--line);color:#243546;font-size:13px}
  .cbox{display:block;width:100%;resize:vertical;min-height:64px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13.5px}
  .ccompose-row{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:8px;font-size:13px;color:var(--mut)}
  .ccompose-row select,.cprio-change select{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);margin-left:4px}
  .csend-btn{padding:7px 16px;border:none;border-radius:6px;background:var(--blue-text);color:#fff;font-weight:600;font-size:13.5px;cursor:pointer}
  .cbox:disabled,.ccompose-row select:disabled,.csend-btn:disabled{opacity:.55;cursor:not-allowed}
  .chint{font-size:12px;color:var(--mut);margin:6px 0 0}
  .ccompose-row{flex-wrap:wrap}
  .cbtns{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .crw-btn,.crw-use{padding:6px 12px;min-height:30px;border:1px solid var(--blue-text);border-radius:6px;background:#fff;color:var(--blue-text);font-weight:600;font-size:13px;cursor:pointer}
  .crw-use{background:var(--blue-text);color:#fff}
  .crw-btn:disabled{opacity:.55;cursor:not-allowed}
  .crw{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-left:3px solid var(--blue-text);border-radius:6px;background:#f6f9fc;font-size:13px}
  .crw.failed,.crw.stale{border-left-color:var(--ember-text)}
  .crw-head{font-weight:700;color:var(--navy);margin-bottom:4px}
  .crw-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 8px;font-size:13.5px;color:var(--ink)}
  .crw-note{margin:2px 0 6px;color:var(--mut);font-size:12.5px}
  .crw-actions{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  .crw-actions .linkbtn{min-height:24px}
  .clist{list-style:none;margin:12px 0 0;padding:0}
  .citem{border:1px solid var(--line);border-left:4px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px}
  .citem.urgent{border-left-color:var(--ember)} .citem.high{border-left-color:var(--sun)} .citem.normal{border-left-color:var(--blue)}
  .chead{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px}
  .cprio{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:99px;border:1px solid var(--line);background:#f2f5f8;color:#3d4f63}
  .cprio.urgent{background:#fde9db;border-color:#f7c9a3;color:#8a3c06} .cprio.high{background:#fff4e2;border-color:#ffd79a;color:#6b4708} .cprio.normal{background:#e8f3fb;border-color:#c4e0f3;color:#0A5A92}
  .cstatus{font-weight:600;color:var(--navy)} .cstatus.declined{color:var(--ember-text)} .cstatus.done,.cstatus.filed{color:#1d6b38}
  .cwhen{color:var(--mut);margin-left:auto}
  .ctext{margin:5px 0 2px;font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere}
  .cnote{margin:3px 0 0;font-size:12.5px;color:#4a5d70}
  .cprio-change{display:inline-block;margin-top:4px;font-size:12px;color:var(--mut)}
  .qdiscuss{margin-top:10px;border-top:1px solid #eef3f7;padding-top:6px}
  .qdiscuss>summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--blue-text);padding:5px 0;line-height:1.4}
  .qthread{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
  .tmsg{max-width:92%;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:#fff;overflow-wrap:anywhere}
  .tmsg.owner{align-self:flex-end;background:#e8f3fb;border-color:#c4e0f3}
  .tmsg.agent{align-self:flex-start;background:#f6f8fa}
  .tmeta{display:flex;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--mut)}
  .twho{font-weight:700;color:var(--navy)} .twhen{margin-left:auto}
  .ttext{margin:3px 0 0;font-size:13.5px;color:#243546;white-space:pre-wrap}
  .qreply-row{display:flex;gap:8px;margin-top:8px;align-items:flex-end}
  .qreply-row textarea{flex:1;min-width:0;resize:vertical;padding:7px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13.5px}
  .qreply-row button{padding:7px 14px;min-height:32px;border:none;border-radius:6px;background:var(--blue-text);color:#fff;font-weight:600;font-size:13.5px;cursor:pointer}
  .qreply-row button:disabled,.qreply-row textarea:disabled,.tbox:disabled{opacity:.55;cursor:not-allowed}
  .qtopic{border-left-color:var(--blue)}
  .qsev.topic{background:#e8f3fb;border-color:#c4e0f3;color:#0A5A92}
  .tstate{font-size:12px;color:var(--mut);margin-left:6px}
  .tbox{display:block;width:100%;resize:vertical;min-height:64px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13.5px}
  .qask-row{display:flex;justify-content:flex-end;margin-top:8px}
  .qask-hint{border-bottom:none;padding-bottom:0;margin-bottom:8px}
  .qanswer-row input[type=text]{min-width:0}
  @media(max-width:480px){.qanswer-row,.qrec-row{flex-wrap:wrap}.qanswer-row button{min-height:32px}.tmsg{max-width:100%}}
  .cclosed{margin-top:10px} .cclosed summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--navy)}${roadmap ? ROADMAP_CSS : ""}
</style></head><body><div class="wrap">
${freshnessHtml}<header><h1>${esc(title)}</h1>${state.phase ? `<span class="phase">${esc(state.phase)}</span>` : ""}</header>
${appHtml}
<div class="meta">${metaBits.join(" &middot; ")}</div>
<div class="tabs" role="tablist" aria-label="Build status">
  ${TABS.map((t, i) => `<button type="button" class="tab-btn${i === 0 ? " active" : ""}" role="tab" id="tabbtn-${t.id}" aria-controls="tab-${t.id}" aria-selected="${i === 0 ? "true" : "false"}" tabindex="${i === 0 ? "0" : "-1"}" data-tab="${t.id}">${t.label}${t.badge || ""}</button>`).join("\n  ")}
</div>
<div id="tab-overview" class="tabpanel active" role="tabpanel" aria-labelledby="tabbtn-overview" tabindex="0">
${state.extra && state.extra.draft ? `<div class="card draft-banner"><strong>Unconfirmed step list.</strong> It was derived with nobody attending the session${state.extra.draft.at ? ` (${esc(state.extra.draft.at)})` : ""}; confirm or replace it by running /build-status.</div>` : ""}
<div class="grid even">
  <div>
    <div class="card now-card">
      <h2>Now</h2>
      <div class="now-progress"><div class="bar" role="img" aria-label="${done} of ${steps.length} steps done"><i></i></div><span class="now-count">${done} of ${steps.length} steps done</span></div>
      ${activeSteps.length ? `<p class="now-step"><span class="now-label">In progress</span> ${activeSteps.map((x) => esc(x.name)).join(" &middot; ")}</p>` : ""}
      ${state.note ? `<div class="note">${esc(state.note)}</div>` : ""}
      <div class="now-gate">${gatesHtml}</div>
    </div>
    <div class="card">
      <h2>Questions for you</h2>
      ${overviewQuestionsHtml}
    </div>
  </div>
  <div>
    ${commentsCardHtml}
    <div class="card">
      <h2>Latest findings, newest first${findingsToday ? ` &middot; ${findingsToday} today` : ""}</h2>
      ${latestFindingsHtml}
    </div>
  </div>
</div>
</div>
<div id="tab-findings" class="tabpanel" role="tabpanel" aria-labelledby="tabbtn-findings" tabindex="0">
${findingsTabHtml}
</div>
<div id="tab-questions" class="tabpanel" role="tabpanel" aria-labelledby="tabbtn-questions" tabindex="0">
${questionsTabHtml}
</div>
<div id="tab-steps" class="tabpanel" role="tabpanel" aria-labelledby="tabbtn-steps" tabindex="0">
${historyHtml}
<div class="grid">
  <div>
    <div class="card">
      <h2>Build sequence &middot; ${done} of ${steps.length}</h2>
      <div class="bar"><i></i></div>
      <ul class="steps">${stepsHtml}</ul>
    </div>
  </div>
  <div>
    <div class="card">
      <h2>Commits</h2>
      <ol class="commits">${commitsHtml}</ol>
    </div>
  </div>
</div>
</div>
<div id="tab-gate" class="tabpanel" role="tabpanel" aria-labelledby="tabbtn-gate" tabindex="0">
    <div class="card">
      <h2>Gate</h2>
      <div class="pills">${gatesHtml}</div>
    </div>
    ${measureRows ? `<div class="card"><h2>Measures</h2><table>${measureRows}</table></div>` : ""}
</div>
${extraTabs.map((t) => `<div id="tab-${t.id}" class="tabpanel" role="tabpanel" aria-labelledby="tabbtn-${t.id}" tabindex="0">${t.html || ""}</div>`).join("\n")}
${roadmap ? roadmap.panelHtml : ""}<footer>Local build view &middot; generated by build-status${build ? ` ${esc(build)}` : ""} &middot; not committed</footer>
</div>
<div id="finding-bodies" hidden>${findingBodiesHtml}</div>
<div id="finding-modal-backdrop" class="modal-backdrop" hidden>
  <div id="finding-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="finding-modal-date finding-modal-tag">
    <div class="modal-head">
      <span id="finding-modal-date" class="fdate" style="margin-left:0;font-weight:600"></span>
      <span id="finding-modal-imp"></span>
      <span id="finding-modal-tag" class="ftag"></span>
      <button id="finding-modal-close" class="modal-close" aria-label="Close">&times;</button>
    </div>
    <div id="finding-modal-body" class="modal-body"></div>
  </div>
</div>
<script>
(function(){
  var STORE = ${storeKey};
  var tablist = document.querySelector('[role="tablist"]');
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll(".tab-btn"));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".tabpanel"));
  var TAB_NAMES = tabButtons.map(function(b){ return b.getAttribute("data-tab"); });
  var activeTab = TAB_NAMES[0];
  function store(kind){ try { return window[kind]; } catch (e) { return null; } }
  function readJson(kind, key){ var st = store(kind); if (!st) return null; try { return JSON.parse(st.getItem(key) || "null"); } catch (e) { return null; } }
  function writeJson(kind, key, val){ var st = store(kind); if (!st) return; try { st.setItem(key, JSON.stringify(val)); } catch (e) {} }
  var DKEY = STORE + ":drafts";

  var savesInFlight = 0;
  function postPatch(patch, btn, prevLabel){
    savesInFlight++;
    fetch("/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    }).then(function(r){
      if (!r.ok) throw new Error("save failed (" + r.status + ")");
      var drafts = readJson("sessionStorage", DKEY) || {};
      delete drafts[patch.id];
      writeJson("sessionStorage", DKEY, drafts);
      location.reload();
    }).catch(function(err){
      savesInFlight--;
      btn.disabled = false;
      btn.textContent = prevLabel;
      alert("Could not save: " + err.message);
    });
  }

  document.querySelectorAll(".qsave-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      if (btn.disabled) return;
      var id = btn.getAttribute("data-id");
      var input = null;
      document.querySelectorAll(".qanswer-input").forEach(function(el){ if (el.getAttribute("data-id") === id) input = el; });
      var val = (input.value || "").trim();
      if (!val) { input.focus(); return; }
      btn.disabled = true;
      var prevLabel = btn.textContent;
      btn.textContent = "Saving…";
      postPatch({ id: id, answer: val }, btn, prevLabel);
    });
  });

  document.querySelectorAll(".qaccept-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      if (btn.disabled) return;
      var rec = (btn.getAttribute("data-rec") || "").trim();
      if (!rec) return;
      btn.disabled = true;
      var prevLabel = btn.textContent;
      btn.textContent = "Accepting…";
      postPatch({ id: btn.getAttribute("data-id"), answer: rec }, btn, prevLabel);
    });
  });

  // Confirm hides an answered question for good. Edit opens its answer in place; Save posts it
  // like any answer, and Cancel closes it and drops the draft.
  document.querySelectorAll(".qconfirm-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      if (btn.disabled) return;
      btn.disabled = true;
      var prevLabel = btn.textContent;
      btn.textContent = "Confirming…";
      postPatch({ id: btn.getAttribute("data-id"), confirmed: true }, btn, prevLabel);
    });
  });
  function editRow(id){
    var row = null;
    document.querySelectorAll(".qedit-row").forEach(function(el){ if (el.getAttribute("data-id") === id) row = el; });
    return row;
  }
  document.querySelectorAll(".qedit-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var row = btn.disabled ? null : editRow(btn.getAttribute("data-id"));
      if (!row) return;
      var input = row.querySelector(".qanswer-input");
      row.hidden = false;
      if (!input.value) input.value = btn.getAttribute("data-answer") || "";
      input.focus();
      input.select();
    });
  });
  document.querySelectorAll(".qcancel-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var id = btn.getAttribute("data-id");
      var row = editRow(id);
      if (!row) return;
      row.querySelector(".qanswer-input").value = "";
      row.hidden = true;
      var drafts = readJson("sessionStorage", DKEY) || {};
      delete drafts[id];
      writeJson("sessionStorage", DKEY, drafts);
    });
  });

  // --- Comments: Send posts the box and its priority; changing an open comment's priority posts at
  // once. The chosen priority rides out a refresh with the draft (sessionStorage).
  var CPRIO_HINTS = ${JSON.stringify(COMMENT_HINTS).replace(/</g, "\\u003c")};
  var PKEY = STORE + ":comment-priority";
  var cbox = document.querySelector(".cbox");
  var cprio = document.getElementById("comment-priority");
  var csend = document.getElementById("comment-send");
  var chint = document.getElementById("comment-prio-hint");
  function postComment(body, onFail, onOk){
    savesInFlight++;
    fetch("/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return {}; }).then(function(j){ throw new Error(j.error || ("send failed (" + r.status + ")")); });
      if (onOk) onOk();
      location.reload();
    }).catch(function(err){
      savesInFlight--;
      if (onFail) onFail();
      alert("Could not send: " + err.message);
    });
  }
  if (cprio) {
    var savedPrio = readJson("sessionStorage", PKEY);
    if (typeof savedPrio === "string" && CPRIO_HINTS[savedPrio] && !cprio.disabled) cprio.value = savedPrio;
    var showPrioHint = function(){ if (chint) chint.textContent = CPRIO_HINTS[cprio.value] || ""; };
    showPrioHint();
    cprio.addEventListener("change", function(){ writeJson("sessionStorage", PKEY, cprio.value); showPrioHint(); });
  }
  function sendComment(){
    if (!csend || csend.disabled || !cbox) return;
    var text = (cbox.value || "").trim();
    if (!text) { cbox.focus(); return; }
    csend.disabled = true;
    var prevLabel = csend.textContent;
    csend.textContent = "Sending…";
    postComment({ text: text, priority: cprio ? cprio.value : "normal" }, function(){
      csend.disabled = false;
      csend.textContent = prevLabel;
    }, function(){
      var drafts = readJson("sessionStorage", DKEY) || {};
      delete drafts["__comment__"];
      writeJson("sessionStorage", DKEY, drafts);
      writeJson("sessionStorage", PKEY, "normal");
    });
  }
  if (csend) csend.addEventListener("click", sendComment);
  if (cbox) cbox.addEventListener("keydown", function(e){
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendComment(); }
  });
  document.querySelectorAll(".cprio-select").forEach(function(sel){
    sel.addEventListener("change", function(){
      sel.disabled = true;
      postComment({ id: sel.getAttribute("data-id"), priority: sel.value }, function(){
        sel.disabled = false;
        sel.value = sel.getAttribute("data-was");
      });
    });
  });

  // --- Improve / Enrich: queue the box's draft for the keeper's rewrite; the draft stays where it
  // is. Use this puts the rewrite in the box (for the owner to edit and Send); Dismiss drops it.
  // While a request is pending, a light poll reloads as soon as the keeper's result lands.
  function postRewrite(body, onFail, beforeReload){
    savesInFlight++;
    fetch("/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return {}; }).then(function(j){ throw new Error(j.error || ("request failed (" + r.status + ")")); });
      if (beforeReload) beforeReload();
      saveScroll();
      location.reload();
    }).catch(function(err){
      savesInFlight--;
      if (onFail) onFail();
      alert("Could not ask the keeper: " + err.message);
    });
  }
  document.querySelectorAll(".crw-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      if (btn.disabled || !cbox) return;
      var text = (cbox.value || "").trim();
      if (!text) { cbox.focus(); return; }
      var drafts = readJson("sessionStorage", DKEY) || {};
      drafts["__comment__"] = cbox.value;
      writeJson("sessionStorage", DKEY, drafts);
      btn.disabled = true;
      var prevLabel = btn.textContent;
      btn.textContent = "Asking…";
      postRewrite({ text: text, mode: btn.getAttribute("data-mode") }, function(){ btn.disabled = false; btn.textContent = prevLabel; });
    });
  });
  document.querySelectorAll(".crw-use").forEach(function(btn){
    btn.addEventListener("click", function(){
      if (btn.disabled) return;
      btn.disabled = true;
      var result = btn.getAttribute("data-result") || "";
      postRewrite({ id: btn.getAttribute("data-id"), close: true }, function(){ btn.disabled = false; }, function(){
        var drafts = readJson("sessionStorage", DKEY) || {};
        drafts["__comment__"] = result;
        writeJson("sessionStorage", DKEY, drafts);
      });
    });
  });
  document.querySelectorAll(".crw-close").forEach(function(btn){
    btn.addEventListener("click", function(){
      if (btn.disabled) return;
      btn.disabled = true;
      postRewrite({ id: btn.getAttribute("data-id"), close: true }, function(){ btn.disabled = false; });
    });
  });
  (function watchRewrite(){
    var box = document.querySelector('.crw[data-status="pending"]');
    if (!box || !window.fetch) return;
    var marker = 'data-rid="' + box.getAttribute("data-rid") + '" data-status="pending"';
    var timer = setInterval(function(){
      if (savesInFlight > 0) return;
      fetch(location.pathname, { cache: "no-store" }).then(function(r){ return r.ok ? r.text() : null; }).then(function(html){
        if (html == null || html.indexOf(marker) >= 0) return;
        clearInterval(timer);
        if (cbox) {
          var drafts = readJson("sessionStorage", DKEY) || {};
          if (cbox.value) drafts["__comment__"] = cbox.value;
          writeJson("sessionStorage", DKEY, drafts);
        }
        saveScroll();
        location.reload();
      }).catch(function(){});
    }, 4000);
  })();

  // --- Q&A threads: Reply posts the box under a question to /reply; Ask posts the "Ask the build"
  // box to /topic as a new owner topic. Both clear their draft only once the save lands.
  function postThread(path, body, draftKey, btn, prevLabel){
    savesInFlight++;
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return {}; }).then(function(j){ throw new Error(j.error || ("send failed (" + r.status + ")")); });
      var drafts = readJson("sessionStorage", DKEY) || {};
      delete drafts[draftKey];
      writeJson("sessionStorage", DKEY, drafts);
      location.reload();
    }).catch(function(err){
      savesInFlight--;
      btn.disabled = false;
      btn.textContent = prevLabel;
      alert("Could not send: " + err.message);
    });
  }
  function sendReply(btn){
    if (!btn || btn.disabled) return;
    var id = btn.getAttribute("data-id");
    var key = "__reply__:" + id, input = null;
    document.querySelectorAll(".treply").forEach(function(el){ if (el.getAttribute("data-id") === key) input = el; });
    if (!input) return;
    var text = (input.value || "").trim();
    if (!text) { input.focus(); return; }
    btn.disabled = true;
    var prevLabel = btn.textContent;
    btn.textContent = "Sending…";
    postThread("/reply", { id: id, text: text }, key, btn, prevLabel);
  }
  document.querySelectorAll(".qreply-btn").forEach(function(btn){
    btn.addEventListener("click", function(){ sendReply(btn); });
  });
  document.querySelectorAll(".treply").forEach(function(input){
    input.addEventListener("keydown", function(e){
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      var row = input.parentNode;
      sendReply(row ? row.querySelector(".qreply-btn") : null);
    });
  });
  var tbox = document.querySelector(".tbox");
  var tsend = document.getElementById("topic-send");
  function sendTopic(){
    if (!tsend || tsend.disabled || !tbox) return;
    var text = (tbox.value || "").trim();
    if (!text) { tbox.focus(); return; }
    tsend.disabled = true;
    var prevLabel = tsend.textContent;
    tsend.textContent = "Sending…";
    postThread("/topic", { text: text }, "__topic__", tsend, prevLabel);
  }
  if (tsend) tsend.addEventListener("click", sendTopic);
  if (tbox) tbox.addEventListener("keydown", function(e){
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendTopic(); }
  });

  // Finding detail modal — bodies are pre-rendered server-side (escaped) into hidden
  // .finding-body elements; opening a card just moves that markup into the shared modal.
  var modalBackdrop = document.getElementById("finding-modal-backdrop");
  var modalBody = document.getElementById("finding-modal-body");
  var modalTag = document.getElementById("finding-modal-tag");
  var modalDate = document.getElementById("finding-modal-date");
  var modalClose = document.getElementById("finding-modal-close");
  var modalOpen = false;
  var modalTrigger = null;

  function openFindingModal(trigger){
    var id = trigger.getAttribute("data-finding-id");
    var body = document.querySelector('.finding-body[data-finding-id="' + id + '"]');
    if (!body || !modalBackdrop) return;
    modalBody.innerHTML = body.innerHTML;
    var kind = body.getAttribute("data-kind") || "";
    modalTag.textContent = kind;
    modalTag.className = "ftag" + (kind ? " " + (body.getAttribute("data-kind-class") || "other") : "");
    modalTag.style.display = kind ? "" : "none";
    modalDate.textContent = body.getAttribute("data-date") || "";
    var impEl = document.getElementById("finding-modal-imp");
    var pill = trigger.querySelector(".imp");
    if (impEl) impEl.innerHTML = pill ? pill.outerHTML : "";
    modalTrigger = trigger;
    modalBackdrop.hidden = false;
    modalOpen = true;
    if (typeof noteActivity === "function") noteActivity();
    modalClose.focus();
    document.addEventListener("keydown", onModalKeydown, true);
  }
  function closeFindingModal(){
    if (!modalBackdrop) return;
    modalBackdrop.hidden = true;
    modalOpen = false;
    document.removeEventListener("keydown", onModalKeydown, true);
    if (modalTrigger) modalTrigger.focus();
  }
  function onModalKeydown(e){
    if (e.key === "Escape") { e.preventDefault(); closeFindingModal(); return; }
    if (e.key === "Tab") {
      var focusables = modalBackdrop.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.querySelectorAll(".find-item.clickable").forEach(function(item){
    item.addEventListener("click", function(){ openFindingModal(item); });
    item.addEventListener("keydown", function(e){
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFindingModal(item); }
    });
  });
  if (modalClose) modalClose.addEventListener("click", closeFindingModal);
  if (modalBackdrop) modalBackdrop.addEventListener("click", function(e){
    if (e.target === modalBackdrop) closeFindingModal();
  });
  // --- Tabs: a real tablist. Arrow keys, Home and End move between tabs (and select them); the URL
  // hash (#overview, #findings, #questions, #steps, #gate) carries the tab, so the 20s reload lands
  // back on it. The old #board lands on the Overview.
  var LEGACY_TABS = { board: "overview" };
  function activateTabByName(name, focus){
    if (TAB_NAMES.indexOf(name) === -1) name = TAB_NAMES[0];
    activeTab = name;
    tabButtons.forEach(function(b){
      var on = b.getAttribute("data-tab") === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    panels.forEach(function(p){ p.classList.toggle("active", p.id === "tab-" + name); });
  }
  function selectTab(name, focus){
    activateTabByName(name, focus);
    history.replaceState(null, "", "#" + activeTab);
  }
  tabButtons.forEach(function(btn){
    btn.addEventListener("click", function(){ selectTab(btn.getAttribute("data-tab"), false); });
  });
  if (tablist) tablist.addEventListener("keydown", function(e){
    var i = tabButtons.indexOf(document.activeElement);
    if (i === -1) i = TAB_NAMES.indexOf(activeTab);
    var n = TAB_NAMES.length, next = null;
    if (e.key === "ArrowRight") next = (i + 1) % n;
    else if (e.key === "ArrowLeft") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    selectTab(TAB_NAMES[next], true);
  });
  document.querySelectorAll("[data-goto]").forEach(function(btn){
    btn.addEventListener("click", function(){
      selectTab(btn.getAttribute("data-goto"), true);
      if (tablist && tablist.getBoundingClientRect().top < 0) tablist.scrollIntoView({ block: "start" });
    });
  });
  function tabFromHash(){
    var tab = (location.hash || "").replace(/^#/, "").split("/")[0];
    return LEGACY_TABS[tab] || tab;
  }
  window.addEventListener("hashchange", function(){
    var tab = tabFromHash();
    if (TAB_NAMES.indexOf(tab) !== -1 && tab !== activeTab) activateTabByName(tab, false);
  });
  activateTabByName(tabFromHash(), false);

  // --- Findings: sort, filter pills, "Show more". The whole list is in the page, newest first
  // (data-order); this only reorders and hides items, and the status line always says how many
  // are shown of how many match, so nothing is hidden silently. Kept in localStorage per repo.
  var FKEY = STORE + ":findings";
  var FPAGE = ${FINDINGS_PAGE};
  var flist = document.getElementById("findings-list");
  var fview = { sort: "newest", kind: [], imp: [], flag: [], shown: FPAGE };
  (function loadFview(){
    var saved = readJson("localStorage", FKEY);
    if (!saved || typeof saved !== "object") return;
    if (saved.sort === "importance" && document.querySelector('#tab-findings .seg-btn[data-sort="importance"]')) fview.sort = "importance";
    if (Array.isArray(saved.kind)) fview.kind = saved.kind.map(String);
    if (Array.isArray(saved.imp)) fview.imp = saved.imp.map(String);
    if (Array.isArray(saved.flag)) fview.flag = saved.flag.map(String);
    // A saved filter for a pill no longer on the page would hide everything with no way to undo it.
    fview.kind = fview.kind.filter(function(v){ return !!document.querySelector('#tab-findings .fpill[data-group="kind"][data-value="' + v + '"]'); });
    fview.imp = fview.imp.filter(function(v){ return !!document.querySelector('#tab-findings .fpill[data-group="imp"][data-value="' + v + '"]'); });
    fview.flag = fview.flag.filter(function(v){ return !!document.querySelector('#tab-findings .fpill[data-group="flag"][data-value="' + v + '"]'); });
    if (typeof saved.shown === "number" && saved.shown > FPAGE) fview.shown = saved.shown;
  })();
  function applyFindings(focusFrom){
    if (!flist) return;
    var items = Array.prototype.slice.call(flist.children);
    items.sort(function(a, b){
      if (fview.sort === "importance") {
        var d = Number(b.getAttribute("data-imp")) - Number(a.getAttribute("data-imp"));
        if (d) return d;
      }
      return Number(a.getAttribute("data-order")) - Number(b.getAttribute("data-order"));
    });
    var total = items.length, matched = 0, shown = 0, firstNew = null;
    items.forEach(function(li){
      flist.appendChild(li);
      var ok = (!fview.kind.length || fview.kind.indexOf(li.getAttribute("data-kind")) !== -1) &&
               (!fview.imp.length || fview.imp.indexOf(li.getAttribute("data-imp")) !== -1) &&
               (!fview.flag.length || fview.flag.indexOf(li.getAttribute("data-flag")) !== -1);
      if (ok) matched++;
      var vis = ok && matched <= fview.shown;
      if (vis) { shown++; if (focusFrom != null && shown === focusFrom + 1) firstNew = li; }
      li.hidden = !vis;
    });
    document.querySelectorAll("#tab-findings .fpill").forEach(function(p){
      var list = fview[p.getAttribute("data-group")] || [];
      p.setAttribute("aria-pressed", list.indexOf(p.getAttribute("data-value")) !== -1 ? "true" : "false");
    });
    document.querySelectorAll("#tab-findings .seg-btn").forEach(function(b){
      b.setAttribute("aria-pressed", b.getAttribute("data-sort") === fview.sort ? "true" : "false");
    });
    var filtered = fview.kind.length > 0 || fview.imp.length > 0 || fview.flag.length > 0;
    var text = "Showing " + shown + " of " + matched + (filtered ? " matching (" + total + " in all)" : "") +
      " · " + (fview.sort === "importance" ? "most important first, newest first within each" : "newest first");
    var status = document.getElementById("findings-status");
    if (status && status.textContent !== text) status.textContent = text;
    var clear = document.getElementById("findings-clear");
    if (clear) clear.hidden = !filtered;
    var empty = document.getElementById("findings-empty");
    if (empty) empty.hidden = matched !== 0;
    var left = matched - shown;
    var more = document.getElementById("findings-more");
    if (more) { more.hidden = left <= 0; more.textContent = "Show " + Math.min(FPAGE, left) + " more"; }
    var all = document.getElementById("findings-all");
    if (all) { all.hidden = left <= FPAGE; all.textContent = "Show all " + matched; }
    if (firstNew) firstNew.focus();
  }
  function setFview(change, focusFrom){
    change();
    writeJson("localStorage", FKEY, fview);
    applyFindings(focusFrom);
  }
  document.querySelectorAll("#tab-findings .fpill").forEach(function(p){
    p.addEventListener("click", function(){
      var g = p.getAttribute("data-group"), v = p.getAttribute("data-value");
      setFview(function(){
        var i = fview[g].indexOf(v);
        if (i === -1) fview[g].push(v); else fview[g].splice(i, 1);
        fview.shown = FPAGE;
      });
    });
  });
  document.querySelectorAll("#tab-findings .seg-btn").forEach(function(b){
    b.addEventListener("click", function(){ setFview(function(){ fview.sort = b.getAttribute("data-sort"); }); });
  });
  function visibleFindings(){ return flist ? flist.querySelectorAll(".find-item:not([hidden])").length : 0; }
  var fMore = document.getElementById("findings-more");
  if (fMore) fMore.addEventListener("click", function(){ var before = visibleFindings(); setFview(function(){ fview.shown = before + FPAGE; }, before); });
  var fAll = document.getElementById("findings-all");
  if (fAll) fAll.addEventListener("click", function(){ var before = visibleFindings(); setFview(function(){ fview.shown = 100000; }, before); });
  var fClear = document.getElementById("findings-clear");
  if (fClear) fClear.addEventListener("click", function(){ setFview(function(){ fview.kind = []; fview.imp = []; fview.flag = []; fview.shown = FPAGE; }); });
  applyFindings(null);

  // --- Questions: severity pills filter the three sections; each heading then says "n of N".
  var QKEY = STORE + ":questions";
  var qview = { sev: [] };
  (function loadQview(){
    var saved = readJson("localStorage", QKEY);
    if (saved && Array.isArray(saved.sev)) qview.sev = saved.sev.map(String).filter(function(v){ return !!document.querySelector('#tab-questions .fpill[data-value="' + v + '"]'); });
  })();
  function applyQuestions(){
    var cards = document.querySelectorAll("#tab-questions .qcard:not(.qtopic)");
    var total = cards.length, shown = 0;
    cards.forEach(function(c){
      var ok = !qview.sev.length || qview.sev.indexOf(c.getAttribute("data-sev")) !== -1;
      c.hidden = !ok;
      if (ok) shown++;
    });
    document.querySelectorAll("#tab-questions .qsection").forEach(function(sec){
      var n = sec.querySelectorAll(".qcard:not(.qtopic):not([hidden])").length;
      var countEl = sec.querySelector(".qsec-count");
      if (!countEl) return;
      var tot = countEl.getAttribute("data-total");
      countEl.textContent = qview.sev.length ? n + " of " + tot : tot;
    });
    document.querySelectorAll("#tab-questions .fpill").forEach(function(p){
      p.setAttribute("aria-pressed", qview.sev.indexOf(p.getAttribute("data-value")) !== -1 ? "true" : "false");
    });
    var status = document.getElementById("q-status");
    var text = qview.sev.length ? "Showing " + shown + " of " + total + " questions" : "All " + total + " questions";
    if (status && status.textContent !== text) status.textContent = text;
    var clear = document.getElementById("q-clear");
    if (clear) clear.hidden = !qview.sev.length;
  }
  document.querySelectorAll("#tab-questions .fpill").forEach(function(p){
    p.addEventListener("click", function(){
      var v = p.getAttribute("data-value"), i = qview.sev.indexOf(v);
      if (i === -1) qview.sev.push(v); else qview.sev.splice(i, 1);
      writeJson("localStorage", QKEY, qview);
      applyQuestions();
    });
  });
  var qClear = document.getElementById("q-clear");
  if (qClear) qClear.addEventListener("click", function(){ qview.sev = []; writeJson("localStorage", QKEY, qview); applyQuestions(); });
  applyQuestions();

  // --- Freshness: tick the relative time and the stale flag between reloads (a suspended
  // refresh can hold the page for minutes).
  var STALE_MS = ${STALE_MS};
  ${relTime.toString()}
  var upd = document.querySelector("time.updated");
  function tickUpdated(){
    if (!upd) return;
    var age = Date.now() - Number(upd.getAttribute("data-updated-at"));
    var rel = upd.querySelector(".upd-rel");
    if (rel) rel.textContent = relTime(age);
    upd.classList.toggle("stale", age > STALE_MS);
    var flag = upd.querySelector(".upd-flag");
    if (flag) flag.hidden = !(age > STALE_MS);
  }
  tickUpdated();
  setInterval(tickUpdated, 30000);

  // --- App strip: the folded port list stays open (or shut) across the 20s reload.
  (function(){
    var more = document.querySelector("details.app-more");
    if (!more) return;
    var AKEY = STORE + ":app-more";
    if (readJson("sessionStorage", AKEY)) more.open = true;
    more.addEventListener("toggle", function(){ writeJson("sessionStorage", AKEY, more.open); });
  })();

  // --- Scroll: kept across a reload (the 20s refresh, or the reload after saving an answer) on
  // the same tab. A fresh visit starts at the top.
  var SKEY = STORE + ":scroll";
  try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) {}
  function saveScroll(){ writeJson("sessionStorage", SKEY, { tab: activeTab, y: window.scrollY || window.pageYOffset || 0 }); }
  window.addEventListener("pagehide", saveScroll);
  window.addEventListener("beforeunload", saveScroll);
  (function restoreScroll(){
    var nav = performance && performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
    if (!nav || nav.type !== "reload") return;
    var saved = readJson("sessionStorage", SKEY);
    if (!saved || saved.tab !== activeTab || typeof saved.y !== "number") return;
    window.scrollTo(0, saved.y);
    window.addEventListener("load", function(){ window.scrollTo(0, saved.y); });
  })();

  // Auto-refresh, suppressible: a bare meta-refresh would blow away a half-typed answer, so
  // the countdown lives here and checks conditions every second before ever reloading. Being
  // suspended just delays the check to the next tick — once conditions clear, the normal
  // 20s cadence resumes on its own. This matters more with a live server, not less: a reload
  // mid-typing now has a real answer to lose — and a reload with the finding modal open would
  // yank it shut on the reader mid-read. The tab (hash), the findings view and severity filter
  // (localStorage) and the scroll position (sessionStorage) all survive the reload.
  var REFRESH_MS = 20000;
  var lastCheck = Date.now();
  function anyFieldFocused(){
    var a = document.activeElement;
    return !!(a && a.classList && a.classList.contains("qanswer-input"));
  }
  function anyFieldDirty(){
    var inputs = document.querySelectorAll(".qanswer-input");
    for (var i = 0; i < inputs.length; i++) { if (inputs[i].value && inputs[i].value.length) return true; }
    return false;
  }
  // Held off only while there's something to lose right now: a save/confirm POST in flight, or a
  // focused or dirty answer or an open dialog touched in the last minute. Never by which tab is
  // open — the tab rides in the hash, so the reload lands back on Questions like any other tab.
  // Unsaved drafts are mirrored to sessionStorage and restored after the
  // reload, so an abandoned one no longer freezes the page for good.
  var IDLE_MS = 60000;
  var lastActivityAt = 0;
  function noteActivity(){ lastActivityAt = Date.now(); }
  function anySavePending(){ return savesInFlight > 0; }
  // Reading counts as activity too, so an open finding stays open while someone is on it.
  ["keydown", "pointerdown", "wheel"].forEach(function(ev){ document.addEventListener(ev, noteActivity, true); });
  document.querySelectorAll(".qanswer-input").forEach(function(input){
    input.addEventListener("focus", noteActivity);
    input.addEventListener("input", function(){
      noteActivity();
      var drafts = readJson("sessionStorage", DKEY) || {};
      if (input.value) drafts[input.getAttribute("data-id")] = input.value; else delete drafts[input.getAttribute("data-id")];
      writeJson("sessionStorage", DKEY, drafts);
    });
  });
  (function restoreDrafts(){
    var drafts = readJson("sessionStorage", DKEY) || {};
    Object.keys(drafts).forEach(function(id){
      var input = null;
      document.querySelectorAll(".qanswer-input").forEach(function(el){ if (el.getAttribute("data-id") === id) input = el; });
      if (input && !input.disabled) {
        input.value = drafts[id];
        var row = input.closest ? input.closest(".qedit-row") : null;
        if (row) row.hidden = false;
        var fold = input.closest ? input.closest("details.qdiscuss") : null;
        if (fold) fold.open = true;
      } else delete drafts[id];
    });
    writeJson("sessionStorage", DKEY, drafts);
  })();${roadmap ? ROADMAP_SCRIPT : ""}
  function refreshSuspended(){
    if (anySavePending()) return true;
    if (Date.now() - lastActivityAt > IDLE_MS) return false;
    return anyFieldFocused() || anyFieldDirty() || modalOpen${roadmap ? " || rmPanelOpen()" : ""};
  }
  setInterval(function(){
    var now = Date.now();
    if (now - lastCheck < REFRESH_MS) return;
    if (refreshSuspended()) { lastCheck = now; return; }
    saveScroll();
    location.reload();
  }, 1000);
})();
</script>
</body></html>`;

  return { html, done, total: steps.length, openQuestions: unanswered.length, gate: gateSummary(gates), findings: findings.length };
}
