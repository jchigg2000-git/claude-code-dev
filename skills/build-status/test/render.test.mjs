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
