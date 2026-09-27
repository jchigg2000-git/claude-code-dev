// The page, as a pure function: render(state, ctx) → {html, ...}. `state` is normalize()'s
// view of the state file; everything else the page shows (git, liveness, the clock) arrives in
// ctx, gathered by page.mjs. No fs, no git, no process state in here — so the CLI, the daemon and
// (later) a hub can all render the same page, and a repo-specific layer can add tabs through
// ctx.extraTabs without touching this file.
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
    return { id: `finding-${idx}`, summary: String(f ?? ""), detail: null, date: null, kind: null, importance: null };
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
  };
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
  const data = `data-kind="${esc(f.kind || "")}" data-imp="${f.importance || 0}"${order == null ? "" : ` data-order="${order}"`}${hidden ? " hidden" : ""}`;
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

// live: whether a server is actually reachable for this repo right now (so Save/Ratify work).
// reason: one-line explanation when live is false, shown as a hint instead of failing silently.

export function render(state, ctx = {}) {
  const { title = "build status", live = false, port = null, reason = "", build = "", now = new Date() } = ctx;
  const { isGitRepo = false, branch = "", dirty = 0, commits = [] } = ctx.git || {};
  // Extra tabs from a repo-specific layer (e.g. a training view). Labels are escaped here; the
  // panel html is the caller's, trusted as-is.
  const extraTabs = (ctx.extraTabs || [])
    .map((t) => ({ ...t, id: String(t.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "") }))
    .filter((t) => t.id && !["overview", "findings", "questions", "steps", "gate"].includes(t.id));
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
  // toolchain varies per repo (npm script vs cargo vs go vet). Classify by keyword so any tool's
  // own wording ("clean", "3 problems", "112 passed") still renders the right pill color.
  const gatePill = (g) => {
    const t = String(g.status || "").toLowerCase();
    const cls = /fail|error|\bwarn|problem|issue/.test(t) ? "warn" : /clean|pass|ok/.test(t) ? "ok" : "";
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

  const metaBits = [];
  if (isGitRepo) {
    metaBits.push(`branch <code>${esc(branch)}</code>`);
    metaBits.push(dirty === 0 ? "working tree clean" : `${dirty} uncommitted file${dirty === 1 ? "" : "s"}`);
  } else {
    metaBits.push("not a git repository");
  }
  if (state.updated) metaBits.push(`state updated ${esc(state.updated)}`);
  metaBits.push(`generated ${now.toLocaleTimeString()}`);
  metaBits.push("refreshes every 20s");
  metaBits.push(live ? `serving on <code>127.0.0.1:${port}</code>` : `read-only${reason ? ` (${esc(reason)})` : ""}`);

  // --- Open questions ---------------------------------------------------------------------
  const questions = state.questions ?? [];
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

  const ratifyControl = (q) => {
    const label = q.ratified ? "Un-ratify" : "Ratify";
    const title = q.ratified
      ? "Reopen this — treat the decision as unsettled again."
      : "Mark this decision settled — it stops being flagged as needing a look.";
    return `<div class="qratify-row"><button class="qratify-btn ${q.ratified ? "ratified" : ""}" data-id="${esc(q.id)}" data-ratified="${q.ratified ? "true" : "false"}" title="${esc(title)}" ${live ? "" : "disabled"}>${label}</button></div>`;
  };

  const openQuestionCard = (q) => `
    <div class="qcard ${esc(q.severity)}" data-id="${esc(q.id)}" data-sev="${esc(q.severity ?? "")}">
      ${sevPill(q.severity)}
      <p class="qtext">${esc(q.question)}</p>
      ${q.context ? `<p class="qctx">${esc(q.context)}</p>` : ""}
      ${answerControls(q)}
    </div>`;

  // How the answer got into the file: the page writes answeredVia "page", the CLI's chat
  // recorder writes "chat" plus the owner's words verbatim; no answeredVia means a hand edit.
  const answeredHow = (q) => (q.answeredVia === "page" ? "on the page" : q.answeredVia === "chat" ? "in chat" : "edited into the file");
  const answeredCard = (q) => `
    <div class="qcard qanswered ${esc(q.severity)}" data-id="${esc(q.id)}" data-sev="${esc(q.severity ?? "")}">
      ${sevPill(q.severity)}
      <span class="qtag ${q.ratified ? "ratified" : "needs"}">${q.ratified ? "ratified" : "not yet confirmed"}</span>
      <p class="qtext">${esc(q.question)}</p>
      ${q.context ? `<p class="qctx">${esc(q.context)}</p>` : ""}
      <p class="qanswer-text">${esc(q.answer)}</p>
      ${q.answerQuote && q.answerQuote !== q.answer ? `<blockquote class="qquote">${esc(q.answerQuote)}</blockquote>` : ""}
      <div class="qmeta">answered ${answeredHow(q)} ${esc(q.answeredAt ? new Date(q.answeredAt).toLocaleString() : "")}${q.ratified ? ` &middot; ratified ${esc(q.ratifiedAt ? new Date(q.ratifiedAt).toLocaleString() : "")}` : ""}</div>
      ${ratifyControl(q)}
    </div>`;

  // Unanswered first (worst severity first), then answered but not yet ratified with the answer
  // shown, then the ratified ones folded away with a count. The severity pills filter all three.
  const awaiting = answered.filter((q) => !q.ratified);
  const ratified = answered.filter((q) => q.ratified);
  const sevCounts = countBy(questions, (q) => String(q.severity ?? ""));
  const sevOrder = [...sevCounts.keys()].sort((a, b) => (SEVERITY_RANK[b] ?? 0) - (SEVERITY_RANK[a] ?? 0) || a.localeCompare(b));
  const sevPillsHtml = sevOrder
    .map((k) => `<button type="button" class="fpill" data-group="sev" data-value="${esc(k)}" aria-pressed="false"><span class="sev-dot ${esc(k)}" aria-hidden="true"></span>${k ? esc(k) : "no severity"} <span class="fcount">${sevCounts.get(k)}</span></button>`)
    .join("");
  const secCount = (n) => `<span class="qsec-count" data-total="${n}">${n}</span>`;
  const questionsTabHtml = questions.length
    ? `
    <div class="qfilter-bar">
      <div class="fpills" role="group" aria-label="Filter questions by severity"><span class="fpills-label" aria-hidden="true">Severity</span>${sevPillsHtml}</div>
      <div class="fstatus-row"><span id="q-status" class="fstatus" role="status" aria-live="polite">All ${questions.length} questions</span><button type="button" id="q-clear" class="linkbtn" hidden>Clear filter</button></div>
    </div>
    <div class="card qsection">
      <h2>Open &middot; ${secCount(unanswered.length)}</h2>
      ${unanswered.length ? unanswered.map(openQuestionCard).join("") : `<div class="qempty">Nothing open &mdash; all caught up.</div>`}
    </div>
    <div class="card qsection">
      <h2>Answered, not yet ratified &middot; ${secCount(awaiting.length)}</h2>
      ${awaiting.length ? `<p class="qexplain">Answered means you replied. Ratified means you've confirmed it's settled and it should stop coming back. Nothing breaks if you leave something unratified.</p>${awaiting.map(answeredCard).join("")}` : `<div class="qempty">Nothing waiting to be ratified.</div>`}
    </div>
    <details class="card qsection" id="q-ratified">
      <summary><h2>Ratified &middot; ${secCount(ratified.length)}</h2><span class="summary-hint">show</span></summary>
      ${ratified.length ? ratified.map(answeredCard).join("") : `<div class="qempty">Nothing ratified yet.</div>`}
    </details>`
    : `<div class="card"><div class="qempty">No open questions right now.</div></div>`;

  const overviewQuestionsHtml = `
      <div class="qstats">
        <div class="qstat"><strong>${unanswered.length}</strong> open</div>
        <div class="qstat"><strong>${awaiting.length}</strong> answered, not yet ratified</div>
        <div class="qstat"><strong>${ratified.length}</strong> ratified</div>
      </div>
      ${
        unanswered.length
          ? `<ul class="qlist">${unanswered
              .slice(0, 5)
              .map((q) => `<li>${sevPill(q.severity)} <span>${esc(q.question)}</span></li>`)
              .join("")}</ul>${unanswered.length > 5 ? `<p class="qmore">and ${unanswered.length - 5} more</p>` : ""}`
          : `<p class="qempty">Nothing open &mdash; all caught up.</p>`
      }
      <button type="button" class="linkbtn goto" data-goto="questions">${unanswered.length ? "Answer them" : awaiting.length ? "Review and ratify" : "Open questions"} &rsaquo;</button>`;

  // The tabs, in order; the first is the default. The URL hash (#findings, #questions, …) opens
  // another, and the old #board lands on the Overview.
  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "findings", label: "Findings", badge: findingsToday ? `<span class="badge info" title="${findingsToday} dated today">${findingsToday} today</span>` : "" },
    { id: "questions", label: "Questions", badge: badgeHtml },
    { id: "steps", label: "Steps" },
    { id: "gate", label: measureRows ? "Measures &amp; gate" : "Gate" },
    ...extraTabs.map((t) => ({ id: t.id, label: esc(t.label || t.id), badge: t.badge ? `<span class="badge info">${esc(t.badge)}</span>` : "" })),
  ];
  // localStorage keys carry the repo name: file:// pages (the read-only fallback) share one origin.
  const storeKey = JSON.stringify(`build-status:${title}`).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — build status</title>
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
  .meta{color:var(--mut);font-size:12.5px;margin:6px 0 18px}
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
  .fpills-label{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);font-weight:700;width:84px;flex:none}
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
  .qsev{display:inline-block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;
        padding:1px 8px;border-radius:99px;border:1px solid var(--line);background:#f2f5f8;color:#3b4b5e;vertical-align:middle}
  .qsev.red{background:#fde9db;border-color:#f7c9a3;color:#8a3c06}
  .qsev.amber{background:#fff4e2;border-color:#ffd79a;color:#6b4708}
  .qsev.green{background:#eaf7ee;border-color:#c9e8d3;color:#1d6b38}
  .sev-dot{display:inline-block;width:8px;height:8px;border-radius:99px;background:var(--line)}
  .sev-dot.red{background:var(--ember)} .sev-dot.amber{background:var(--sun)} .sev-dot.green{background:var(--green)}
  .qtag{display:inline-block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
        padding:2px 8px;border-radius:99px;margin-left:8px;vertical-align:middle}
  .qtag.ratified{background:#eaf7ee;border:1px solid #c9e8d3;color:#1d6b38}
  .qtag.needs{background:#fff4e2;border:1px solid #ffd79a;color:#8a4b06}
  .qanswer-row{display:flex;gap:8px;margin-top:8px}
  .qanswer-row input[type=text]{flex:1;padding:7px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13.5px}
  .qanswer-row button{padding:7px 14px;border:none;border-radius:6px;background:var(--blue-text);color:#fff;font-weight:600;font-size:13.5px;cursor:pointer}
  .qanswer-row button:disabled,.qanswer-row input:disabled{opacity:.55;cursor:not-allowed}
  .qratify-row{margin-top:10px}
  .qratify-row button{padding:5px 12px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--navy);font-weight:600;font-size:12.5px;cursor:pointer}
  .qratify-row button.ratified{background:#eaf7ee;border-color:#c9e8d3;color:#1d6b38}
  .qratify-row button:disabled{opacity:.55;cursor:not-allowed}
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
</style></head><body><div class="wrap">
<header><h1>${esc(title)}</h1>${state.phase ? `<span class="phase">${esc(state.phase)}</span>` : ""}</header>
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
<footer>Local build view &middot; generated by build-status${build ? ` ${esc(build)}` : ""} &middot; not committed</footer>
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

  document.querySelectorAll(".qratify-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      if (btn.disabled) return;
      var id = btn.getAttribute("data-id");
      var wasRatified = btn.getAttribute("data-ratified") === "true";
      btn.disabled = true;
      var prevLabel = btn.textContent;
      btn.textContent = wasRatified ? "Un-ratifying…" : "Ratifying…";
      postPatch({ id: id, ratified: !wasRatified }, btn, prevLabel);
    });
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
  var fview = { sort: "newest", kind: [], imp: [], shown: FPAGE };
  (function loadFview(){
    var saved = readJson("localStorage", FKEY);
    if (!saved || typeof saved !== "object") return;
    if (saved.sort === "importance" && document.querySelector('#tab-findings .seg-btn[data-sort="importance"]')) fview.sort = "importance";
    if (Array.isArray(saved.kind)) fview.kind = saved.kind.map(String);
    if (Array.isArray(saved.imp)) fview.imp = saved.imp.map(String);
    // A saved filter for a pill no longer on the page would hide everything with no way to undo it.
    fview.kind = fview.kind.filter(function(v){ return !!document.querySelector('#tab-findings .fpill[data-group="kind"][data-value="' + v + '"]'); });
    fview.imp = fview.imp.filter(function(v){ return !!document.querySelector('#tab-findings .fpill[data-group="imp"][data-value="' + v + '"]'); });
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
               (!fview.imp.length || fview.imp.indexOf(li.getAttribute("data-imp")) !== -1);
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
    var filtered = fview.kind.length > 0 || fview.imp.length > 0;
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
  if (fClear) fClear.addEventListener("click", function(){ setFview(function(){ fview.kind = []; fview.imp = []; fview.shown = FPAGE; }); });
  applyFindings(null);

  // --- Questions: severity pills filter the three sections; each heading then says "n of N".
  var QKEY = STORE + ":questions";
  var qview = { sev: [] };
  (function loadQview(){
    var saved = readJson("localStorage", QKEY);
    if (saved && Array.isArray(saved.sev)) qview.sev = saved.sev.map(String).filter(function(v){ return !!document.querySelector('#tab-questions .fpill[data-value="' + v + '"]'); });
  })();
  function applyQuestions(){
    var cards = document.querySelectorAll("#tab-questions .qcard");
    var total = cards.length, shown = 0;
    cards.forEach(function(c){
      var ok = !qview.sev.length || qview.sev.indexOf(c.getAttribute("data-sev")) !== -1;
      c.hidden = !ok;
      if (ok) shown++;
    });
    document.querySelectorAll("#tab-questions .qsection").forEach(function(sec){
      var n = sec.querySelectorAll(".qcard:not([hidden])").length;
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
  // Held off only while there's something to lose right now: a save/ratify POST in flight, or a
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
      if (input && !input.disabled) input.value = drafts[id]; else delete drafts[id];
    });
    writeJson("sessionStorage", DKEY, drafts);
  })();
  function refreshSuspended(){
    if (anySavePending()) return true;
    if (Date.now() - lastActivityAt > IDLE_MS) return false;
    return anyFieldFocused() || anyFieldDirty() || modalOpen;
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

  const gate = !gates.length ? "none" : gates.some((g) => g.ok === false) ? "warn" : "ok";
  return { html, done, total: steps.length, openQuestions: unanswered.length, gate, findings: findings.length };
}
