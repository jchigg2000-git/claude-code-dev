// The Roadmap tab: a pure render of `state._roadmap` and `state.roadmapRequests`. The page only
// records requests (POST /roadmap/request, /roadmap/withdraw); it never edits ROADMAP.md. Without
// `_roadmap` the page must be exactly what it was before the tab existed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { normalize } from "../scripts/lib/normalize.mjs";
import { render } from "../scripts/lib/render.mjs";

const NOW = new Date("2026-10-24T12:00:00Z");

const fixtureRoadmap = () => ({
  source: "ROADMAP.md",
  readAt: "2026-10-24T10:00:00Z",
  sections: [
    {
      id: "s-now", title: "0. Now", backlog: false,
      items: [
        { id: "T16", title: "Fix 36: the image check accepts a replaced banner", marker: "[ ]", status: "in progress", backlog: false, line: 42, summary: "Deployed; verify on the next loop.", pending: [] },
        { id: "SR-1", title: "Release-review helper", marker: "[~]", status: "blocked", backlog: false, line: 57, summary: "Design decided, in build.", pending: [{ id: "rq-1", kind: "reorder", status: "new" }], movedByRequest: true },
        { id: "A-3", title: "Weekly digest question", marker: "[ ]", status: "open", backlog: false, line: 71, summary: "Owner question.", pending: [{ id: "rq-2", kind: "dispatch", status: "sent" }] },
        { id: "A-4", title: "Old thing to drop", marker: "[ ]", status: "open", backlog: false, line: 80, summary: "", pending: [{ id: "rq-3", kind: "remove", status: "new" }], removed: true },
        { id: "A-5", title: "Removal already sent", marker: "[ ]", status: "open", backlog: false, line: 85, summary: "", pending: [{ id: "rq-4", kind: "remove", status: "sent" }], removed: true },
      ],
    },
    {
      id: "s-next", title: "1. Next up", backlog: false,
      items: [
        { id: "N-1", title: "First next item", marker: "[ ]", status: "open", backlog: false, line: 101, summary: "Short.", pending: [] },
        { id: "N-2", title: "Second next item", marker: "[ ]", status: "done", backlog: false, line: 110, summary: "Short.", pending: [] },
      ],
    },
    {
      id: "s-back", title: "14. Parked", backlog: true,
      items: [
        { id: "P-1", title: "Parked idea one", marker: "[ ]", status: "parked", backlog: true, line: 200, summary: "Non-blocking.", pending: [] },
        { id: "P-2", title: "Parked idea two", marker: "[ ]", status: "parked", backlog: true, line: 210, summary: "Non-blocking.", pending: [{ id: "rq-5", kind: "restore", status: "held" }] },
        { id: "P-3", title: "Parked idea three", marker: "[ ]", status: "parked", backlog: true, line: 220, summary: "", pending: [] },
      ],
    },
  ],
});

const fixtureRequests = () => [
  { id: "rq-1", at: "2026-10-24T10:05:00Z", kind: "reorder", itemId: "SR-1", itemTitle: "Release-review helper", to: { after: null, before: "T16" }, status: "new", note: "" },
  { id: "rq-2", at: "2026-10-24T10:04:00Z", kind: "dispatch", itemId: "A-3", itemTitle: "Weekly digest question", dispatch: { opus: 1, sonnet: 0, brief: "Work on A-3 Weekly digest question: draft the answer." }, status: "sent", note: "" },
  { id: "rq-3", at: "2026-10-24T10:03:00Z", kind: "remove", itemId: "A-4", itemTitle: "Old thing to drop", status: "new", note: "" },
  { id: "rq-9", at: "2026-10-24T09:00:00Z", kind: "reorder", itemId: "N-2", itemTitle: "Second next item", to: { after: "N-1", before: null }, status: "done", note: "Moved in the closing edit." },
  { id: "rq-8", at: "2026-10-24T08:00:00Z", kind: "dispatch", itemId: "P-1", itemTitle: "Parked idea one", dispatch: { opus: 0, sonnet: 1, brief: "Look at it" }, status: "declined", note: "Parked: not now." },
];

const base = () => normalize({ steps: [], phase: "demo" });
const pageOf = (over = {}, ctx = {}) =>
  render({ ...base(), _roadmap: fixtureRoadmap(), roadmapRequests: fixtureRequests(), ...over }, { title: "t", live: true, port: 1, now: NOW, ...ctx }).html;
const panelOf = (html) => {
  const a = html.indexOf('<div id="tab-roadmap"');
  assert.ok(a >= 0, "the Roadmap panel is on the page");
  return html.slice(a, html.indexOf("<footer>"));
};
const rowOf = (html, id) => {
  const m = new RegExp(`<li class="rm-item[^"]*" data-item-id="${id}"[\\s\\S]*?</li>`).exec(html);
  assert.ok(m, `row ${id} renders`);
  return m[0];
};
const buttons = (html) => [...html.matchAll(/<button [^>]*data-roadmap-action="([a-z]+)"[^>]*>/g)].map((m) => ({ action: m[1], tag: m[0] }));
const actionsOf = (html) => buttons(html).map((b) => b.action);
const disabled = (tag) => /\sdisabled(\s|>)/.test(tag);

test("a Roadmap tab sits beside the others, badged with the open requests, and says requests only", () => {
  const html = pageOf();
  assert.match(html, /<button type="button" class="tab-btn" role="tab" id="tabbtn-roadmap" aria-controls="tab-roadmap" aria-selected="false" tabindex="-1" data-tab="roadmap">Roadmap<span class="badge info" title="3 open roadmap requests">3<span class="sr-only"> open<\/span><\/span><\/button>/);
  assert.ok(html.indexOf('data-tab="steps"') < html.indexOf('data-tab="roadmap"') && html.indexOf('data-tab="roadmap"') < html.indexOf('data-tab="gate"'));
  const panel = panelOf(html);
  assert.match(panel, /<div class="note rm-note">Requests only\. ROADMAP\.md is not edited from this page; the main session carries each request out\.<\/div>/);
  assert.match(panel, /Read from <code>ROADMAP\.md<\/code> <time datetime="2026-10-24T10:00:00Z">/);
  assert.ok(panel.indexOf("rm-note") < panel.indexOf("rm-sec"), "the note leads the tab");
});

test("sections are collapsible groups: open work expanded, backlog collapsed with a count", () => {
  const panel = panelOf(pageOf());
  const secs = [...panel.matchAll(/<details class="card rm-sec([^"]*)" data-section-id="([^"]+)"( open)?>([\s\S]*?)<\/summary>/g)];
  assert.deepEqual(secs.map((m) => m[2]), ["s-now", "s-next", "s-back"]);
  assert.deepEqual(secs.map((m) => Boolean(m[3])), [true, true, false], "only the backlog section starts collapsed");
  assert.match(secs[2][1], /is-backlog/);
  assert.match(secs[0][4], /<h2>0\. Now<\/h2><span class="rm-count">3 items &middot; 2 to remove<\/span>/, "removed items are not counted as items");
  assert.match(secs[0][4], /<span class="rm-chip pending">4 requested<\/span>/);
  assert.match(secs[1][4], /<span class="rm-count">2 items<\/span>/);
  assert.match(secs[2][4], /<span class="rm-count">3 items<\/span><span class="rm-chip backlog">backlog<\/span><span class="rm-chip pending">1 requested<\/span>/);
  assert.equal((panel.match(/<li class="rm-item/g) || []).length, 10, "every item renders, removed ones too");
});

test("an item row shows marker, id, title, status, backlog chip, line, summary and its pending chips", () => {
  const panel = panelOf(pageOf());
  const sr = rowOf(panel, "SR-1");
  assert.match(sr, /<span class="rm-marker">\[~\]<\/span> <span class="rm-id">SR-1<\/span> <span class="rm-title">Release-review helper<\/span>/);
  assert.match(sr, /<span class="rm-chip st rm-st-blocked">blocked<\/span>/);
  assert.match(sr, /<span class="rm-line">line 57<\/span>/);
  assert.match(sr, /<p class="rm-summary">Design decided, in build\.<\/p>/);
  assert.match(sr, /<span class="rm-chip pending s-new"[^>]*>reorder requested<\/span>/);
  assert.match(sr, /class="rm-item moved has-pending"/);
  assert.doesNotMatch(sr, /moved by request/, "the reorder chip already says it");
  assert.match(rowOf(panel, "A-3"), /<span class="rm-chip pending s-sent"[^>]*>dispatch requested - sent<\/span>/);
  assert.match(rowOf(panel, "P-2"), /<span class="rm-chip pending s-held"[^>]*>restore requested - held<\/span>/);
  assert.match(rowOf(panel, "P-1"), /<span class="rm-chip backlog">backlog<\/span>/);
  assert.doesNotMatch(rowOf(panel, "T16"), /rm-chip backlog/);
  assert.doesNotMatch(rowOf(panel, "P-3"), /rm-summary/, "no summary, no empty paragraph");
});

test("row buttons carry data-roadmap-action and data-item-id; the ends of a section can't move past it", () => {
  const panel = panelOf(pageOf());
  const t16 = buttons(rowOf(panel, "T16"));
  assert.deepEqual(t16.map((b) => b.action), ["drag", "up", "down", "dispatch", "remove", "cancel", "send"], "the last two belong to the Dispatch panel");
  for (const b of t16) assert.match(b.tag, /data-item-id="T16"/);
  const by = (list, a) => list.find((b) => b.action === a).tag;
  assert.ok(disabled(by(t16, "up")), "the first item has no Up");
  assert.ok(!disabled(by(t16, "down")));
  const a3 = buttons(rowOf(panel, "A-3"));
  assert.ok(disabled(by(a3, "down")), "A-3 is the last live item: the removed rows below it don't count");
  assert.ok(!disabled(by(a3, "up")));
  assert.match(by(a3, "dispatch"), /aria-expanded="false"/);
  const sr = buttons(rowOf(panel, "SR-1"));
  assert.ok(!disabled(by(sr, "up")) && !disabled(by(sr, "down")));
  assert.match(by(sr, "up"), /aria-label="Move SR-1 up"/);
  assert.match(by(sr, "drag"), /class="rm-handle"/);
});

test("Dispatch opens an inline panel: Opus and Sonnet checkboxes, a prefilled brief, Cancel and Send", () => {
  const row = rowOf(panelOf(pageOf()), "N-1");
  assert.match(row, /<div class="rm-dispatch" data-item-id="N-1" hidden>/);
  assert.match(row, /<input type="checkbox" class="rm-opus"> Opus agent/);
  assert.match(row, /<input type="checkbox" class="rm-sonnet"> Sonnet agent/);
  assert.equal((row.match(/type="checkbox"/g) || []).length, 2, "one of each agent at most");
  assert.doesNotMatch(row, /type="checkbox"[^>]*checked/, "no agent is chosen by default");
  assert.match(row, /<textarea class="rm-brief" rows="3" data-prefill="Work on N-1 First next item: ">Work on N-1 First next item: <\/textarea>/);
  assert.match(row, /data-roadmap-action="cancel"/);
  assert.match(row, /class="rm-btn primary" data-roadmap-action="send" data-item-id="N-1">Send<\/button>/);
  // The brief is not a .qanswer-input: its prefill would otherwise always count as an unsent draft
  // and hold the page's 20s refresh.
  assert.doesNotMatch(row, /qanswer-input/);
});

test("a removed item is struck through with an Undo: withdraw while the request is new, restore once it is picked up", () => {
  const panel = panelOf(pageOf());
  const a4 = rowOf(panel, "A-4");
  assert.match(a4, /class="rm-item removed has-pending"/);
  assert.deepEqual(actionsOf(a4), ["undo"], "no move, dispatch or remove on a removed row");
  assert.match(a4, /data-roadmap-action="undo" data-undo-mode="withdraw" data-request-id="rq-3" data-item-id="A-4"/);
  assert.match(a4, /removal requested<\/span>/);
  assert.doesNotMatch(a4, /data-roadmap-action="withdraw"/, "the Undo stands in for the chip's Withdraw");
  const a5 = rowOf(panel, "A-5");
  assert.match(a5, /data-roadmap-action="undo" data-undo-mode="restore" data-item-id="A-5"/);
  assert.doesNotMatch(a5, /data-request-id/);
  assert.match(a5, /removal requested - sent<\/span>/);
  assert.match(pageOf(), /\.rm-item\.removed \.rm-head\{text-decoration:line-through/);
});

test("Withdraw appears only for a request that is still new", () => {
  const panel = panelOf(pageOf());
  const withdraws = [...panel.matchAll(/data-roadmap-action="withdraw" data-request-id="([^"]+)"/g)].map((m) => m[1]);
  // SR-1's chip and the Requests list each offer rq-1; rq-3's list entry does too (its row has Undo).
  assert.deepEqual(withdraws.sort(), ["rq-1", "rq-1", "rq-3"]);
  assert.match(rowOf(panel, "SR-1"), /data-roadmap-action="withdraw" data-request-id="rq-1"/);
  assert.doesNotMatch(rowOf(panel, "A-3"), /data-roadmap-action="withdraw"/, "sent: nothing to withdraw");
  assert.doesNotMatch(rowOf(panel, "P-2"), /data-roadmap-action="withdraw"/, "held: nothing to withdraw");
  for (const id of ["rq-2", "rq-8", "rq-9"]) assert.ok(!withdraws.includes(id));
});

test("the Requests list shows open requests and, folded, the handled ones, with status and note", () => {
  const panel = panelOf(pageOf());
  const card = panel.slice(panel.indexOf('id="roadmap-requests-card"'));
  assert.match(card, /<h2>Requests &middot; 3 open<\/h2>/);
  const open = card.slice(0, card.indexOf('<details class="cclosed">'));
  assert.deepEqual([...open.matchAll(/data-request-id="(rq-\d)" data-request-kind/g)].map((m) => m[1]), ["rq-1", "rq-2", "rq-3"], "newest first");
  assert.match(open, /<span class="cstatus new">waiting for the main session<\/span>/);
  assert.match(open, /<span class="cstatus sent">with the main session<\/span>/);
  assert.match(open, /Move it to the top, before T16\./);
  assert.match(open, /Opus agent: Work on A-3 Weekly digest question: draft the answer\./);
  assert.match(open, /Remove it from the roadmap\./);
  const closed = card.slice(card.indexOf('<details class="cclosed">'));
  assert.match(closed, /<summary>Handled &middot; 2<\/summary>/);
  assert.match(closed, /<span class="cstatus done">done<\/span>/);
  assert.match(closed, /<span class="cstatus declined">declined<\/span>/);
  assert.match(closed, /<span class="qrec-label">Note:<\/span> Moved in the closing edit\./);
  assert.match(closed, /Sonnet agent: Look at it/);
  assert.match(closed, /Move it to the end, after N-1\./);
});

test("a read-only page renders the tab with every action disabled and says why", () => {
  const panel = panelOf(pageOf({}, { live: false, reason: "no server" }));
  assert.match(panel, /Read-only right now &mdash; no server\./);
  for (const b of buttons(panel).filter((x) => x.action !== "cancel")) assert.ok(disabled(b.tag), `${b.action} is disabled`);
  assert.match(panel, /<textarea class="rm-brief"[^>]* disabled>/);
});

test("empty and error states: nothing found says so; an error is shown plainly, escaped", () => {
  const empty = panelOf(pageOf({ _roadmap: { source: "ROADMAP.md", readAt: "2026-10-24T10:00:00Z", sections: [] }, roadmapRequests: [] }));
  assert.match(empty, /<div class="qempty rm-empty">No roadmap items found in ROADMAP\.md\.<\/div>/);
  assert.match(empty, /<p class="qempty">No requests yet\.<\/p>/);
  assert.doesNotMatch(empty, /<details class="card rm-sec/);
  const bad = panelOf(pageOf({ _roadmap: { source: "ROADMAP.md", error: "ENOENT: no such file <ROADMAP.md> & friends" }, roadmapRequests: [] }));
  assert.match(bad, /<div class="card rm-error" role="alert"><strong>Could not read the roadmap\.<\/strong> <span class="rm-error-text">ENOENT: no such file &lt;ROADMAP\.md&gt; &amp; friends<\/span><\/div>/);
  assert.doesNotMatch(bad, /No roadmap items found/, "an error is not also an empty roadmap");
  assert.match(bad, /Requests only\./, "the note still leads");
  const noReqs = panelOf(pageOf({ roadmapRequests: [] }));
  assert.match(noReqs, /No requests yet\./);
  assert.doesNotMatch(noReqs, /badge info/, "no open requests, no badge");
  assert.doesNotMatch(pageOf({ roadmapRequests: [] }), /title="\d+ open roadmap/);
});

test("titles, ids, notes and briefs with < & and quotes are escaped everywhere they land", () => {
  const evil = `Fix <b>"x"</b> & 'y' <script>alert(1)</script>`;
  const rm = fixtureRoadmap();
  rm.sections[0].items[0] = { ...rm.sections[0].items[0], id: 'E"1', title: evil, summary: "<i>sum</i>", marker: "<m>" };
  const reqs = [{ id: 'r"q', at: "2026-10-24T10:00:00Z", kind: "dispatch", itemId: 'E"1', itemTitle: evil, dispatch: { opus: 1, sonnet: 1, brief: "<img src=x onerror=1>" }, status: "new", note: "<u>note</u>" }];
  const html = pageOf({ _roadmap: rm, roadmapRequests: reqs });
  const panel = panelOf(html);
  assert.doesNotMatch(panel, /<script>alert|<b>|<i>sum|<m>|<img|<u>note/, "no raw markup from data reaches the panel");
  assert.match(panel, /Fix &lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp; 'y' &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(panel, /data-item-id="E&quot;1"/);
  assert.match(panel, /aria-label="Move E&quot;1 up"/);
  assert.match(panel, /data-prefill="Work on E&quot;1 Fix &lt;b&gt;&quot;x&quot;&lt;\/b&gt;/);
  assert.match(panel, /Opus agent and Sonnet agent: &lt;img src=x onerror=1&gt;/);
  assert.match(panel, /data-request-id="r&quot;q"/);
  assert.equal((html.match(/<script>/g) || []).length, 1, "the page's own script is the only one");
});

test("the narrow-screen rules exist: 40px targets, wrapping, a handle that leaves scrolling alone, no text under 12px", () => {
  const html = pageOf();
  const css = html.slice(html.indexOf(".tabs{position:relative}"), html.indexOf("</style>"));
  const media = /@media\(max-width:640px\)\{([\s\S]*?)\n  \}/.exec(css);
  assert.ok(media, "a max-width:640px block");
  assert.match(media[1], /\.rm-btn,\.rm-btn\.mini\{min-height:40px;min-width:40px/);
  assert.match(media[1], /\.rm-handle,\.rm-handle-gap\{width:40px;height:40px\}/);
  assert.match(media[1], /\.rm-actions\{grid-column:1 \/ -1/, "the buttons drop under the title");
  assert.match(media[1], /\.rm-check[^{]*\{min-height:40px\}/);
  assert.match(media[1], /\.rm-brief\{font-size:16px\}/, "no iOS zoom on focus");
  assert.match(css, /\.rm-title\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.rm-head\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.rm-main\{min-width:0\}/);
  assert.match(css, /\.rm-row\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(css, /\.rm-handle\{[^}]*touch-action:none/, "touch-action none on the handle only");
  assert.doesNotMatch(css.replace(/\.rm-handle\{[^}]*\}/, ""), /touch-action:none/);
  assert.match(css, /\.rm-btn\{[^}]*min-height:32px/, "desktop buttons are at least 24px too");
  assert.match(css, /\.rm-btn\.mini\{min-height:24px;min-width:24px/);
  assert.match(css, /\.rm-brief\{[^}]*width:100%;max-width:100%/);
  for (const m of css.matchAll(/font-size:([\d.]+)px/g)) assert.ok(Number(m[1]) >= 12, `font-size ${m[1]}px is under 12px`);
  // Tab badges carry an absolutely positioned .sr-only; a positioned scroll container keeps it from
  // widening the page past the last tab (measured: 437px of scroll at a 375px viewport without it).
  assert.match(css, /\.tabs\{position:relative\}/);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
});

test("the script posts requests to the agreed endpoints and an open dispatch panel holds the refresh", () => {
  const html = pageOf();
  assert.match(html, /"\/roadmap\/request"/);
  assert.match(html, /"\/roadmap\/withdraw"/);
  assert.match(html, /kind: "reorder", itemId: rmIdOf\(row\), to: to/);
  assert.match(html, /kind: "remove", itemId: id/);
  assert.match(html, /kind: "restore", itemId: id/);
  assert.match(html, /kind: "dispatch", itemId: rmIdOf\(row\), dispatch: \{ opus: opus \? 1 : 0, sonnet: sonnet \? 1 : 0, brief: brief \}/);
  assert.match(html, /err\.status === 409/, "a withdraw that lost the race to the main session says so");
  assert.match(html, /addEventListener\("pointerdown"/, "the handle drags with pointer events");
  const body = /function refreshSuspended\(\)\{([\s\S]*?)\n  \}/.exec(html)[1];
  assert.match(body, /rmPanelOpen\(\)/);
  assert.doesNotMatch(body, /activeTab/);
});

// ---- Without `_roadmap` the page is what it was. -------------------------------------------------

const mask = (h) => h.replace(/generated [^<]*? &middot; refreshes/, "generated T &middot; refreshes");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const plain = {
  phase: "build",
  note: "a note",
  steps: [{ id: "1", name: "first", state: "done" }, { id: "2", name: "second", state: "active" }],
  gates: [{ name: "test", status: "12 passed" }],
  measures: [{ id: "m1", value: "3", provenance: "verified" }],
  questions: [{ id: "q1", question: "Q?", severity: "amber", answer: null, recommendation: "yes" }],
  findings: [{ id: "f1", summary: "s", detail: "- a\n- b", kind: "bug", importance: 2 }, { id: "f2", summary: "plain" }],
};
const git = { isGitRepo: true, branch: "main", dirty: 2, commits: [{ sha: "abc1234", subject: "a commit", when: "2 h ago" }] };
const plainPage = (state, ctx = {}) => mask(render(state, { title: "t", now: NOW, git, ...ctx }).html);

test("without _roadmap the page is byte-identical to the page before the Roadmap tab existed", () => {
  // Golden hashes of the pre-Roadmap renderer on these inputs. Change one only when the base page
  // is changed on purpose.
  const GOLDEN = {
    live: "3256431fd8df66ab0b20b4e2ae25c744e1436cbd0de5a1ee836e786ab3ab44e0",
    readonly: "c8b38369d6114a02e759eab2def7f3f53b575494202f4ec1faa35a5e16dc53ac",
    empty: "b8fc43d1111d5ee4ebebec9621358688e0c6aa080e4351dfe46ea30ad33e1d38",
    extra: "1f1cfc5f8a00277c710d439f484eb242e1e915e896eac1993af0c2f8c8640e78",
  };
  const live = plainPage(normalize(plain), { live: true, port: 1 });
  assert.equal(sha(live), GOLDEN.live);
  assert.equal(sha(plainPage(normalize(plain), { reason: "no server" })), GOLDEN.readonly);
  assert.equal(sha(plainPage(normalize({}))), GOLDEN.empty);
  assert.equal(sha(plainPage(normalize(plain), { live: true, port: 1, extraTabs: [{ id: "roadmap", label: "Road", html: "<p>x</p>" }, { id: "train", label: "Train" }] })), GOLDEN.extra, "a repo layer's own 'roadmap' tab still works");
  // Requests with no _roadmap, or a null one, show nothing and change nothing.
  assert.equal(plainPage({ ...normalize(plain), _roadmap: null, roadmapRequests: [{ id: "r1", kind: "remove", itemId: "x", status: "new" }] }, { live: true, port: 1 }), live);
  assert.equal(plainPage({ ...normalize(plain), roadmapRequests: [{ id: "r1" }] }, { live: true, port: 1 }), live);
  assert.doesNotMatch(live, /tab-roadmap|\brm-|\/roadmap\/|[Rr]oadmap/, "no Roadmap tab, styles, script or endpoint on the page");
});

test("with _roadmap a repo layer's own 'roadmap' tab yields to the built-in one", () => {
  const html = pageOf({}, { extraTabs: [{ id: "roadmap", label: "Mine", html: "<p>mine</p>" }] });
  assert.equal((html.match(/id="tab-roadmap"/g) || []).length, 1);
  assert.doesNotMatch(html, /<p>mine<\/p>/);
});
