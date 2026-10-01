// The pure renderer: a repo's gate{} shape renders; the refresh gate never depends on the tab;
// answers say how they were recorded.
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize } from "../scripts/lib/normalize.mjs";
import { render } from "../scripts/lib/render.mjs";

const page = (raw) => render(normalize(raw), { title: "t", live: true, port: 1 }).html;

test("a gate{} object renders its gates", () => {
  const html = page({ gate: { typecheck: "clean", tests: "12 passed" }, steps: [] });
  assert.match(html, /typecheck clean/);
  assert.match(html, /tests 12 passed/);
  assert.doesNotMatch(html, /no gates detected/);
});

test("refreshSuspended never looks at the active tab", () => {
  const html = page({ steps: [] });
  const body = /function refreshSuspended\(\)\{([\s\S]*?)\n  \}/.exec(html)[1];
  assert.doesNotMatch(body, /activeTab/);
});

test("a chat answer is labelled as answered in chat; a hand edit says so", () => {
  const html = page({
    questions: [
      { id: "a", question: "Q1?", severity: "amber", answer: "yes", answeredAt: "2026-09-26T10:00:00Z", answeredVia: "chat", answerQuote: "yes, do it" },
      { id: "b", question: "Q2?", severity: "green", answer: "no", answeredAt: "2026-09-26T10:00:00Z" },
    ],
  });
  assert.match(html, /answered in chat/);
  assert.match(html, /yes, do it/);
  assert.match(html, /answered edited into the file/);
});

test("a read-only page with questions still auto-refreshes (pending saves are counted, not read off disabled buttons)", () => {
  const html = page({ steps: [], questions: [{ id: "q", question: "?", severity: "red", answer: null }] });
  const body = /function anySavePending\(\)\{([^}]*)\}/.exec(html)[1];
  assert.doesNotMatch(body, /disabled/);
});

test("the last-update time leads the page and turns stale after 3 hours", () => {
  const at = "2026-09-27T12:00:00-05:00";
  const at5min = render(normalize({ steps: [], updated: at }), { title: "t", now: new Date(Date.parse(at) + 5 * 60e3) }).html;
  assert.ok(at5min.indexOf('class="freshness-top"') < at5min.indexOf("<header>"));
  assert.match(at5min, /Updated <span class="upd-rel">5 min ago<\/span>/);
  assert.match(at5min, /<span class="upd-flag" hidden>Stale/);
  assert.doesNotMatch(at5min, /state updated/);
  const at4h = render(normalize({ steps: [], updated: at }), { title: "t", now: new Date(Date.parse(at) + 4 * 3600e3) }).html;
  assert.match(at4h, /class="updated stale"/);
  assert.match(at4h, /<span class="upd-flag">Stale/);
});

test("the tab is easy to find: repo-first title, a favicon, and a severity dot while a question waits", () => {
  const icon = (html) => decodeURIComponent(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)">/.exec(html)[1]);
  const quiet = render(normalize({ steps: [] }), { title: "twin-compiler" }).html;
  assert.match(quiet, /<title>twin-compiler — build status<\/title>/);
  assert.match(icon(quiet), />TC<\/text>/);
  assert.doesNotMatch(icon(quiet), /<circle/);
  const waiting = render(normalize({ steps: [], questions: [{ id: "q", question: "?", severity: "red", answer: null }] }), { title: "twin-compiler" }).html;
  assert.match(waiting, /<title>\(1\) twin-compiler — build status<\/title>/);
  assert.match(icon(waiting), /<circle[^>]*fill="#E5372B"/);
});

test("an open question with a recommendation offers Accept recommendation; one without doesn't; accepting is labelled", () => {
  const html = page({
    questions: [
      { id: "a", question: "Q1?", severity: "amber", answer: null, recommendation: 'yes, "as an option"' },
      { id: "b", question: "Q2?", severity: "green", answer: null },
      { id: "c", question: "Q3?", severity: "green", answer: "no", answeredAt: "2026-09-26T10:00:00Z", answeredVia: "page", recommendation: "no" },
    ],
  });
  assert.match(html, /<button class="qaccept-btn" data-id="a" data-rec="yes, &quot;as an option&quot;" >Accept recommendation<\/button>/);
  assert.equal(html.match(/<button class="qaccept-btn"/g).length, 1, "only the open question with a recommendation gets the button");
  assert.match(html, /answered on the page \(accepted the recommendation\)/);
});

test("flagged findings get a ★ Flagged filter pill: a tag or a ★ summary counts; none, no pill", () => {
  const html = page({
    steps: [],
    findings: [
      { id: "a", summary: "measured recall", tags: ["interesting"] },
      { id: "b", summary: "★ a surprise" },
      { id: "c", summary: "routine merge" },
    ],
  });
  assert.match(html, /data-group="flag" data-value="1"[^>]*>&#9733; Flagged <span class="fcount">2<\/span>/);
  // The Findings tab's list (data-order) marks exactly the two flagged items; the overview repeats them.
  assert.equal((html.match(/data-flag="1" data-order=/g) || []).length, 2);
  assert.doesNotMatch(page({ steps: [], findings: [{ id: "c", summary: "routine" }] }), /class="fpill" data-group="flag"/);
});
