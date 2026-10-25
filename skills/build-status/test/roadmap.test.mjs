// The Roadmap tab's core: the read-only ROADMAP.md parser, the overlay of the owner's open requests,
// the `roadmapRequests` field, the daemon's /roadmap endpoints, the CLI verbs and the hooks. ROADMAP.md
// is the repo's source of truth: no request ever changes its bytes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { normalize } from "../scripts/lib/normalize.mjs";
import { applyRequests, parseRoadmap, roadmapView } from "../scripts/lib/roadmap.mjs";
import * as W from "../scripts/lib/write.mjs";
import { http, portOf, sandbox, urlFrom } from "./helpers.mjs";

// A real roadmap to parse: the ROADMAP.md of the git repo the tests run from (its top level).
// Nothing is preseeded; outside a repo, or in one with no ROADMAP.md, the real-roadmap test is skipped.
function repoRoadmap() {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0) return null;
  const path = join(top.stdout.trim(), "ROADMAP.md");
  try { return statSync(path).isFile() ? path : null; } catch { return null; }
}
const REAL = repoRoadmap();

const FIXTURE = [
  "# Demo — ROADMAP",
  "",
  "Intro prose, not an item.",
  "",
  "## §0 Now",
  "",
  "### ⬜ T16 Queue tuning (owner note, 2026-10-23)",
  "- Analysis (4 h, 12 items): review is the only waiting stage.",
  "- ⏳ **INT-11 — nested under T16, not an item.**",
  "",
  "### ⏳ SR-1 Release review",
  "",
  "First prose line of SR-1, with **bold** and `code`.",
  "",
  "```",
  "### ⬜ FAKE-1 inside a fence is not an item",
  "```",
  "",
  "### 🔶 P5 Marketplace publish via API",
  "### 🔬 P0 Shipping",
  "### ✅ P3b Done thing",
  "### ⛔ LAB-3 Blocked thing",
  "### Preserve (still-live facts)",
  "### ⬜ T16 A second T16 heading",
  "",
  "## §2b Connectors",
  "",
  "Prose.",
  "- ⬜ **CONN-2** Build the importers the survey found.",
  "  continuation line",
  "- ⬜ **INT-9 — Theme capability.** The theme stage gets a check.",
  "- plain bullet, not an item",
  "",
  "## §12 Parked",
  "",
  "### ⬜ LAB-1 Someday ideas — BACKLOG 2026-10-21 (owner note). Nothing built.",
  "Owner: drop rough ideas here.",
  "### ⬜ Mobile UI polish — PARKED ON THE BACKLOG 2026-10-16.",
  "",
].join("\n");

const ids = (view) => view.sections.flatMap((s) => s.items.map((i) => i.id));
const item = (view, id) => view.sections.flatMap((s) => s.items).find((i) => i.id === id);

test("parser: sections, ids, markers, statuses, backlog, lines and summaries from a fixture", () => {
  const sections = parseRoadmap(FIXTURE);
  const view = { sections };
  assert.deepEqual(sections.map((s) => [s.id, s.backlog]), [["§0", false], ["§2b", false], ["§12", true]]);
  assert.deepEqual(ids(view), ["T16", "SR-1", "P5", "P0", "P3b", "LAB-3", "preserve-still-live-facts", "T16~2", "CONN-2", "INT-9", "LAB-1", "mobile-ui-polish-parked-on-the"]);
  const t16 = item(view, "T16");
  assert.deepEqual([t16.marker, t16.status, t16.line, t16.backlog], ["⬜", "todo", 7, false]);
  assert.equal(t16.title, "Queue tuning (owner note, 2026-10-23)");
  assert.equal(t16.summary, "Analysis (4 h, 12 items): review is the only waiting stage.");
  assert.deepEqual(t16.pending, []);
  assert.equal(item(view, "SR-1").summary, "First prose line of SR-1, with bold and code.");
  assert.deepEqual(["SR-1", "P5", "P0", "P3b", "LAB-3"].map((id) => item(view, id).status), ["doing", "unverified", "verifying", "done", "blocked"]);
  assert.deepEqual([item(view, "preserve-still-live-facts").marker, item(view, "preserve-still-live-facts").title], ["", "Preserve (still-live facts)"]);
  assert.deepEqual([item(view, "CONN-2").title, item(view, "CONN-2").summary], ["Build the importers the survey found.", "continuation line"]);
  assert.deepEqual([item(view, "INT-9").title, item(view, "INT-9").summary], ["Theme capability", "The theme stage gets a check."]);
  assert.ok(item(view, "LAB-1").backlog && item(view, "mobile-ui-polish-parked-on-the").backlog);
  assert.ok(!ids(view).includes("FAKE-1") && !ids(view).includes("INT-11"));
  // CRLF reads the same
  assert.deepEqual(parseRoadmap(FIXTURE.replace(/\n/g, "\r\n")), sections);
});

test("parser: checkbox bullets when there are no ### items; no headings; empty; missing file", () => {
  const sections = parseRoadmap("Some intro\n- [ ] Write the docs\n- [x] Ship v1\n  - [ ] nested, not an item\n\n## Later\n- [ ] Dark mode\n");
  assert.deepEqual(sections.map((s) => [s.id, s.title, s.items.map((i) => [i.id, i.title, i.status, i.marker])]), [
    ["top", "", [["write-the-docs", "Write the docs", "todo", ""], ["ship-v1", "Ship v1", "done", ""]]],
    ["later", "Later", [["dark-mode", "Dark mode", "todo", ""]]],
  ]);
  assert.deepEqual(parseRoadmap("just prose\n\nmore prose\n"), []);
  assert.deepEqual(parseRoadmap(""), []);
  const dir = mkdtempSync(join(tmpdir(), "bs-rm-"));
  try {
    const v = roadmapView(dir);
    assert.ok(v.error && v.sections.length === 0 && v.readAt);
    writeFileSync(join(dir, "ROADMAP"), "## A\n### ⬜ X-1 thing\n");
    assert.deepEqual([roadmapView(dir).source, ids(roadmapView(dir))], ["ROADMAP", ["X-1"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parser: the repo's own ROADMAP.md", { skip: !REAL && "no ROADMAP.md at this repo's top level" }, () => {
  const text = readFileSync(REAL, "utf8");
  const t0 = performance.now();
  const sections = parseRoadmap(text);
  assert.ok(performance.now() - t0 < 500, "parses well under half a second");
  const view = { sections };
  const all = ids(view);
  assert.ok(all.length > 0, "at least one item parsed");
  assert.equal(new Set(all).size, all.length, "ids are unique");
  const lines = text.split(/\r?\n/);
  for (const i of sections.flatMap((s) => s.items)) {
    assert.match(lines[i.line - 1], /^(###\s|[-*+]\s)/, `${i.id} line points at its heading or bullet`);
    assert.ok(i.summary.length <= 200 && i.title.length <= 200);
    assert.ok(["todo", "doing", "unverified", "verifying", "done", "blocked"].includes(i.status));
  }
});

const VIEW = () => ({ source: "ROADMAP.md", readAt: "x", sections: parseRoadmap(FIXTURE) });

test("applyRequests: reorder, remove, restore, withdrawn ignored, pending listed, input untouched", () => {
  const view = VIEW();
  const snapshot = JSON.stringify(view);
  const reqs = [
    { id: "rq1", kind: "reorder", itemId: "LAB-3", to: { after: null, before: "T16" }, status: "new" },
    { id: "rq2", kind: "remove", itemId: "P5", status: "sent" },
    { id: "rq3", kind: "remove", itemId: "P0", status: "held" },
    { id: "rq4", kind: "restore", itemId: "P0", status: "new" },
    { id: "rq5", kind: "reorder", itemId: "SR-1", to: { after: "P3b", before: null }, status: "withdrawn" },
    { id: "rq6", kind: "dispatch", itemId: "T16", dispatch: { opus: 1, sonnet: 1, brief: "go" }, status: "filed" },
    { id: "rq7", kind: "reorder", itemId: "LAB-1", to: { after: "CONN-2" }, status: "new" },
    { id: "rq8", kind: "remove", itemId: "GONE-1", status: "new" },
    { id: "rq9", kind: "remove", itemId: "SR-1", status: "done" },
  ];
  const out = applyRequests(view, reqs);
  assert.equal(JSON.stringify(view), snapshot, "the input view is not modified");
  const s0 = out.sections[0].items.map((i) => i.id);
  assert.deepEqual(s0.slice(0, 3), ["LAB-3", "T16", "SR-1"], "LAB-3 moved before T16; the withdrawn reorder of SR-1 is ignored");
  assert.ok(item(out, "LAB-3").movedByRequest && !item(out, "T16").movedByRequest);
  assert.deepEqual([item(out, "P5").removed, item(out, "P0").removed, item(out, "SR-1").removed], [true, false, false], "a later restore clears a remove; a done remove isn't open");
  assert.deepEqual(item(out, "P0").pending, [{ id: "rq3", kind: "remove", status: "held" }, { id: "rq4", kind: "restore", status: "new" }]);
  assert.deepEqual(item(out, "T16").pending, [{ id: "rq6", kind: "dispatch", status: "filed" }]);
  assert.deepEqual(out.sections[1].items.map((i) => i.id), ["CONN-2", "LAB-1", "INT-9"], "a move across sections lands after its anchor");
  assert.equal(item(out, "LAB-1").backlog, true, "its own title still says BACKLOG");
  const lab3 = applyRequests(view, [{ id: "rq1", kind: "reorder", itemId: "LAB-3", to: { after: "LAB-1" }, status: "new" }]);
  assert.equal(item(lab3, "LAB-3").backlog, true, "moved into the parked section");
  assert.deepEqual(lab3.sections[2].items.map((i) => i.id), ["LAB-1", "LAB-3", "mobile-ui-polish-parked-on-the"]);
  assert.deepEqual(out.unmatched, ["rq8"]);
  assert.deepEqual(applyRequests({ error: "none", sections: [] }, reqs).sections, []);
});

test("normalize round-trip and the request patches' validation", () => {
  const view = VIEW();
  const raw = { roadmapRequests: [{ id: "rq1", kind: "remove", itemId: "P5", status: "new", someFutureField: { a: 1 } }] };
  const d = W.addRoadmapRequest(raw, { kind: "dispatch", itemId: "T16", dispatch: { opus: 1, sonnet: 0, brief: " fix it " } }, view);
  assert.deepEqual([d.id, d.request.dispatch, d.request.itemTitle, d.request.section, d.request.via, d.request.status], ["rq2", { opus: 1, sonnet: 0, brief: "fix it" }, "Queue tuning (owner note, 2026-10-23)", "§0", "page", "new"]);
  assert.equal(W.addRoadmapRequest(raw, { kind: "dispatch", itemId: "T16", dispatch: { opus: 1, brief: "fix it" } }, view).changed, false, "a double click records once");
  assert.throws(() => W.addRoadmapRequest(raw, { kind: "dispatch", itemId: "T16", dispatch: { opus: 2 } }, view), /opus is 0 or 1/);
  assert.throws(() => W.addRoadmapRequest(raw, { kind: "dispatch", itemId: "T16", dispatch: { brief: "x".repeat(2001) } }, view), /at most 2000/);
  assert.throws(() => W.addRoadmapRequest(raw, { kind: "promote", itemId: "T16" }, view), /kind is/);
  assert.throws(() => W.addRoadmapRequest(raw, { kind: "remove", itemId: "NOPE-1" }, view), /no roadmap item/);
  assert.throws(() => W.addRoadmapRequest(raw, { kind: "reorder", itemId: "T16", to: { after: "NOPE-1" } }, view), /no roadmap item "NOPE-1"/);
  assert.throws(() => W.addRoadmapRequest(raw, { kind: "restore", itemId: "SR-1" }, view), /no remove request/);
  const r = W.addRoadmapRequest(raw, { kind: "reorder", itemId: "SR-1", to: { before: "T16" } }, view);
  assert.deepEqual(r.request.to, { after: null, before: "T16" });
  // a remove the main session carried out took the item out of the file; restore still names it
  raw.roadmapRequests.push({ id: "rq9", kind: "remove", itemId: "OLD-1", itemTitle: "Old", section: "§0", status: "done" });
  assert.equal(W.addRoadmapRequest(raw, { kind: "restore", itemId: "OLD-1" }, view).request.itemTitle, "Old");
  assert.throws(() => W.setRoadmapRequestStatus(raw, "rq2", "declined"), /needs a note/);
  W.setRoadmapRequestStatus(raw, "rq2", "sent", "with the main session");
  assert.throws(() => W.withdrawRoadmapRequest(raw, "rq2"), /already sent/);
  assert.equal(W.withdrawRoadmapRequest(raw, "rq3").request.status, "withdrawn");
  const back = normalize(JSON.parse(W.serialize(raw)));
  assert.deepEqual(back.roadmapRequests, JSON.parse(W.serialize(raw)).roadmapRequests);
  assert.deepEqual(back.roadmapRequests[0].someFutureField, { a: 1 }, "unknown fields round-trip");
  assert.deepEqual(back.roadmapRequests.find((x) => x.id === "rq2").trail.map((t) => t.status), ["new", "sent"]);
  assert.ok(!("roadmapRequests" in back.extra));
  assert.deepEqual(normalize({}).roadmapRequests, []);
});

// ---- the live daemon, CLI and hooks, against a sandbox repo with its own ROADMAP.md --------------
let sb;
let port;
let origin;
let roadmapFile;
let roadmapBytes;
let roadmapMtime;
before(() => {
  sb = sandbox();
  roadmapFile = join(sb.repo, "ROADMAP.md");
  writeFileSync(roadmapFile, FIXTURE);
  roadmapBytes = readFileSync(roadmapFile);
  roadmapMtime = statSync(roadmapFile).mtimeMs;
  sb.cli(["init", "--steps-json", '["a"]']);
  port = portOf(urlFrom(sb.cli(["render"])));
  origin = `http://127.0.0.1:${port}`;
});
after(() => sb.cleanup());

const post = (path, body, headers = { "content-type": "application/json", origin }) =>
  http(port, { method: "POST", path, headers: { host: `127.0.0.1:${port}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const getJson = async (path) => JSON.parse((await http(port, { path, headers: { host: `127.0.0.1:${port}` } })).body);
const state = () => JSON.parse(readFileSync(join(sb.repo, ".claude", "build-status.json"), "utf8"));
const untouched = () => {
  assert.ok(readFileSync(roadmapFile).equals(roadmapBytes), "ROADMAP.md bytes unchanged");
  assert.equal(statSync(roadmapFile).mtimeMs, roadmapMtime, "ROADMAP.md never rewritten");
};

test("daemon: request → state file → roadmap.json → withdraw; 409 on a sent one; ROADMAP.md untouched throughout", async () => {
  assert.equal((await post("/roadmap/request", { kind: "remove", itemId: "P5" }, { "content-type": "text/plain", origin: "http://evil.example" })).status, 403);
  assert.equal((await post("/roadmap/request", { kind: "remove", itemId: "P5" }, { "content-type": "application/json" })).status, 403, "origin-less");
  assert.equal((await post("/roadmap/request", "a".repeat(65 * 1024))).status, 413);
  assert.equal((await http(port, { path: "/roadmap/request", headers: { host: `127.0.0.1:${port}` } })).status, 405);
  assert.equal((await post("/roadmap/request", { kind: "promote", itemId: "P5" })).status, 400);
  assert.equal((await post("/roadmap/request", { kind: "remove", itemId: "NOPE-1" })).status, 400);
  assert.equal((await post("/roadmap/request", { kind: "dispatch", itemId: "T16", dispatch: { opus: 2 } })).status, 400);
  assert.equal((await post("/roadmap/request", { kind: "dispatch", itemId: "T16", dispatch: { brief: "x".repeat(2001) } })).status, 400);
  untouched();

  const d = await post("/roadmap/request", { kind: "dispatch", itemId: "T16", dispatch: { opus: 1, sonnet: 1, brief: "Tune the <b>caps</b>" } });
  assert.equal(d.status, 200);
  const dreq = JSON.parse(d.body).request;
  assert.deepEqual([dreq.id, dreq.kind, dreq.status, dreq.via, dreq.dispatch], ["rq1", "dispatch", "new", "page", { opus: 1, sonnet: 1, brief: "Tune the <b>caps</b>" }]);
  assert.deepEqual(state().roadmapRequests.map((r) => r.id), ["rq1"]);
  untouched();
  const mv = JSON.parse((await post("/roadmap/request", { kind: "reorder", itemId: "LAB-3", to: { before: "T16" } })).body).request;
  const rm = JSON.parse((await post("/roadmap/request", { kind: "remove", itemId: "P5" })).body).request;
  untouched();

  let rj = await getJson("/roadmap.json");
  assert.equal(rj.requests.length, 3);
  assert.equal(rj.view.sections[0].items[0].id, "LAB-3");
  assert.ok(rj.view.sections[0].items[0].movedByRequest);
  assert.ok(item(rj.view, "P5").removed);
  assert.deepEqual(item(rj.view, "T16").pending, [{ id: "rq1", kind: "dispatch", status: "new" }]);

  assert.equal((await post("/roadmap/withdraw", { id: mv.id })).status, 200);
  assert.equal(state().roadmapRequests.find((r) => r.id === mv.id).status, "withdrawn");
  rj = await getJson("/roadmap.json");
  assert.equal(rj.view.sections[0].items[0].id, "T16", "a withdrawn reorder no longer applies");
  sb.cli(["roadmap-status", rm.id, "sent", "--note", "with the main session"]);
  const conflict = await post("/roadmap/withdraw", { id: rm.id });
  assert.equal(conflict.status, 409);
  assert.match(JSON.parse(conflict.body).error, /already sent/);
  assert.equal((await post("/roadmap/withdraw", { id: "rq99" })).status, 404);
  assert.equal((await http(port, { headers: { host: `127.0.0.1:${port}` } })).status, 200, "the page still renders");
  untouched();
});

test("CLI: roadmap-request from chat, roadmap, roadmap-requests (--open, --json, --wait), roadmap-status", async () => {
  const out = sb.cli(["roadmap-request", "dispatch", "SR-1", "--opus", "1", "--brief", "Start the store review"]);
  assert.match(out, /roadmap request "rq\d+" \(dispatch SR-1\)/);
  assert.equal(sb.cliStatus(["roadmap-request", "dispatch", "SR-1", "--opus", "3"]).code, 3);
  assert.equal(sb.cliStatus(["roadmap-request", "remove", "NOPE-9"]).code, 3);
  assert.equal(sb.cliStatus(["roadmap-request", "reorder", "SR-1", "--after", "SR-1"]).code, 3);
  const rid = state().roadmapRequests.at(-1).id;
  assert.equal(state().roadmapRequests.at(-1).via, "chat");

  const text = sb.cli(["roadmap"]);
  assert.match(text, /ROADMAP\.md: 12 items in 3 sections/);
  assert.match(text, /⬜ T16 {2}Queue tuning.*\{rq1 dispatch new\}/);
  assert.match(text, /P5 .*REMOVE requested/);
  assert.match(text, /§12 Parked {2}\[backlog\]/);
  const json = JSON.parse(sb.cli(["roadmap", "--json"]));
  assert.ok(json.view.sections.length === 3 && json.requests.every((r) => W.ROADMAP_REQ_OPEN.has(r.status)));

  const wait = sb.cli(["roadmap-requests", "--wait", "--timeout", "1s"]);
  assert.match(wait, new RegExp(`${rid} {2}new .*dispatch SR-1 .*opus 1, sonnet 0; brief: "Start the store review" \\(via chat\\)`));
  assert.match(wait, /rq1 {2}new/);
  assert.equal(sb.cliStatus(["roadmap-status", rid, "declined"]).code, 3, "declining needs a note");
  sb.cli(["roadmap-status", rid, "done", "--note", "review started in abc123"]);
  sb.cli(["roadmap-status", "rq1", "sent"]);
  assert.equal(sb.cliStatus(["roadmap-requests", "--wait", "--timeout", "1s"]).code, 2, "nothing new: times out");
  const open = JSON.parse(sb.cli(["roadmap-requests", "--open", "--json"]));
  assert.ok(open.every((r) => ["new", "held", "sent", "filed"].includes(r.status)) && !open.some((r) => r.id === rid));
  assert.match(sb.cli(["roadmap-requests"]), /note: review started in abc123/);
  // a background waiter wakes when the page records one
  const waiter = sb.cliAsync(["roadmap-requests", "--wait", "--timeout", "20s"]);
  await new Promise((r) => setTimeout(r, 300));
  await post("/roadmap/request", { kind: "remove", itemId: "LAB-1" });
  const woke = await waiter;
  assert.equal(woke.code, 0);
  assert.match(woke.out, /remove LAB-1/);
  untouched();
});

test("hooks: session-start and user-prompt surface new roadmap requests once, one line each", async () => {
  const ctx = (r) => r?.hookSpecificOutput?.additionalContext ?? "";
  const first = ctx(sb.hook("session-start", { session_id: "rm1" }));
  assert.match(first, /new roadmap requests? in /);
  assert.match(first, /- rq\d+ remove LAB-1 "Someday ideas/);
  assert.match(first, /ROADMAP\.md is unchanged/);
  assert.ok(!/rq1 dispatch/.test(first), "a request already sent isn't new");
  assert.ok(first.length < 2000, "the hook output stays small");
  assert.equal(sb.hook("session-start", { session_id: "rm2" }), null, "delivered once");
  assert.equal(sb.hook("user-prompt", { session_id: "rm2" }), null);
  await new Promise((r) => setTimeout(r, 1100));
  await post("/roadmap/request", { kind: "dispatch", itemId: "P0", dispatch: { sonnet: 1, brief: "line one\nline two" } });
  const next = ctx(sb.hook("user-prompt", { session_id: "rm2" }));
  assert.match(next, /- rq\d+ dispatch P0 "Shipping" — opus 0, sonnet 1; brief: "line one line two"/);
  assert.equal(sb.hook("user-prompt", { session_id: "rm2" }), null, "seen by this session");
  untouched();
});
