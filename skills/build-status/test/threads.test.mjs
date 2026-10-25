// Threaded Q/A: a question's `thread[]`, owner topics from the page's "Ask the build" box, the
// owner's replies through the page server, the agent's through `reply`, and delivery of the
// owner's messages through `answers --new` and `await`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { isSettled, normalize, threadOf } from "../scripts/lib/normalize.mjs";
import { render } from "../scripts/lib/render.mjs";
import * as W from "../scripts/lib/write.mjs";
import { http, portOf, sandbox, urlFrom } from "./helpers.mjs";

const sandboxes = [];
after(() => sandboxes.forEach((s) => s.cleanup()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function live() {
  const sb = sandbox();
  sandboxes.push(sb);
  sb.cli(["init", "--steps-json", '["a"]']);
  sb.cli(["ask", "--id", "colour", "--question", "Header colour?", "--severity", "red", "--recommend", "teal", "--rationale", "brand"]);
  const port = portOf(urlFrom(sb.cli(["render"])));
  const origin = `http://127.0.0.1:${port}`;
  sb.post = (path, body, headers = { "content-type": "application/json", origin }) =>
    http(port, { method: "POST", path, headers: { host: `127.0.0.1:${port}`, ...headers }, body: JSON.stringify(body) });
  sb.page = async () => (await http(port, { headers: { host: `127.0.0.1:${port}` } })).body;
  sb.state = () => JSON.parse(readFileSync(join(sb.repo, ".claude", "build-status.json"), "utf8"));
  return sb;
}

test("schema round-trip: a thread and an owner topic survive serialize → parse → normalize, and settle as today", () => {
  const raw = { questions: [{ id: "q1", question: "Colour?", severity: "amber", answer: null, answeredAt: null }] };
  W.addThreadMessage(raw, "q1", { from: "agent", text: "Teal or navy?", via: "cli" });
  assert.equal(W.addThreadMessage(raw, "q1", { from: "agent", text: "Teal or navy?" }).changed, false, "a double post is a no-op");
  W.addThreadMessage(raw, "q1", { from: "owner", text: "Teal,\nbut darker", via: "page" });
  const t = W.addOwnerTopic(raw, { text: "Why is the build slow?\nIt took an hour." });
  assert.throws(() => W.addThreadMessage(raw, "q1", { from: "owner", text: "  " }), /can't be empty/);
  const back = normalize(JSON.parse(W.serialize(raw)));
  const q1 = back.questions.find((q) => q.id === "q1");
  assert.deepEqual(threadOf(q1).map((m) => [m.id, m.from, m.text]), [["m1", "agent", "Teal or navy?"], ["m2", "owner", "Teal,\nbut darker"]]);
  const topic = back.questions.find((q) => q.id === t.id);
  assert.deepEqual([topic.origin, topic.severity, topic.recommendation, topic.answer, topic.question], ["owner", undefined, undefined, null, "Why is the build slow?"]);
  assert.equal(isSettled(topic), false);
  assert.equal(isSettled(q1), false, "a thread alone doesn't settle a question");
  W.setActed(raw, t.id, "explained in chat");
  assert.equal(isSettled(raw.questions.find((q) => q.id === t.id)), true, "acted settles an owner topic");
  assert.throws(() => W.setActed(raw, "q1", "x"), /isn't answered/, "an agent's question still needs its answer first");
});

test("a file without thread renders as before, plus the Ask box and a Discuss fold", () => {
  const html = render(normalize({ steps: [], questions: [{ id: "q", question: "Old question?", severity: "amber", answer: null }] }), { title: "t", live: true, port: 1 }).html;
  assert.match(html, /Old question\?/);
  assert.match(html, /role="tab"[^>]*data-tab="questions">Q&amp;A/);
  assert.match(html, /id="ask-card"/);
  assert.match(html, /<details class="qdiscuss" data-id="q"><summary>Discuss<\/summary>/);
  assert.doesNotMatch(html, /<ol class="qthread"/);
  assert.equal(render(normalize({ questions: [{ id: "t1", origin: "owner", question: "x", answer: null, thread: [{ id: "m1", from: "owner", text: "x" }] }] }), { title: "t" }).openQuestions, 0, "an owner topic is not an open question");
});

test("the owner replies and starts a topic through the page server; the page shows both threads", async () => {
  const sb = live();
  assert.equal((await sb.post("/reply", { id: "colour", text: "x" }, { "content-type": "application/json", origin: "http://evil.example" })).status, 403);
  assert.equal((await sb.post("/reply", { id: "nope", text: "x" })).status, 404);
  assert.equal((await sb.post("/reply", { id: "colour", text: " " })).status, 400);
  assert.equal((await sb.post("/reply", { id: "colour", text: "What does <b>navy</b> cost us?" })).status, 200);
  const r = await sb.post("/topic", { text: "Can we ship Friday?" });
  assert.equal(r.status, 200);
  const { id } = JSON.parse(r.body);
  assert.equal((await sb.post("/topic", { text: "Can we ship Friday?" })).status, 200);
  const s = sb.state();
  assert.equal(s.questions.filter((q) => q.origin === "owner").length, 1, "a double-clicked Ask posts once");
  assert.deepEqual(s.questions.find((q) => q.id === "colour").thread.map((m) => [m.from, m.via, m.text]), [["owner", "page", "What does <b>navy</b> cost us?"]]);
  const topic = s.questions.find((q) => q.id === id);
  assert.deepEqual([topic.origin, "severity" in topic, topic.thread[0].from], ["owner", false, "owner"]);
  sb.cli(["reply", id, "--text", "Yes, if the gate stays green."]);
  const html = await sb.page();
  assert.ok(html.includes("What does &lt;b&gt;navy&lt;/b&gt; cost us?") && !html.includes("<b>navy</b>"));
  assert.match(html, new RegExp(`class="qcard qtopic" data-id="${id}"`));
  assert.match(html, /<li class="tmsg agent">[\s\S]*?Yes, if the gate stays green\./);
  assert.match(html, /class="qaccept-btn" data-id="colour"/, "Accept recommendation still works beside the thread");
  // The owner closes the topic with the same confirm an answer uses.
  assert.equal((await sb.post("/answer", { id, confirmed: true })).status, 200);
  assert.doesNotMatch(await sb.page(), new RegExp(`data-id="${id}"`));
});

test("answers --new delivers owner replies and new topics once, labelled; reply and thread work from the CLI", async () => {
  const sb = live();
  await sb.post("/reply", { id: "colour", text: "Is navy accessible?" });
  const { id } = JSON.parse((await sb.post("/topic", { text: "Rename the app?" })).body);
  const out = sb.cli(["answers", "--new"]);
  assert.match(out, /- colour \[reply\] "Header colour\?"[\s\S]*Owner's reply \(via page, [^)]*\): "Is navy accessible\?"/);
  assert.match(out, new RegExp(`- ${id} \\[new topic\\][\\s\\S]*Owner's message \\(via page, [^)]*\\): "Rename the app\\?"`));
  assert.match(out, /reply <id> --text-file -/);
  assert.match(sb.cli(["answers", "--new"]), /no new answers/);
  sb.cli(["reply", "colour", "--text-file", "-"], { input: "Yes: 7.1:1 on white.\n" });
  assert.match(sb.cli(["answers", "--new"]), /no new answers/, "the agent's own messages are never delivered back");
  const j = JSON.parse(sb.cli(["thread", "colour", "--json"]));
  assert.deepEqual(j.thread.map((m) => [m.from, m.text]), [["owner", "Is navy accessible?"], ["agent", "Yes: 7.1:1 on white."]]);
  assert.match(sb.cli(["thread", "colour"]), /agent \(cli\): Yes: 7\.1:1 on white\./);
  assert.equal(sb.cliStatus(["reply", "colour"]).code, 1);
  assert.equal(sb.cliStatus(["reply", "nope", "--text", "x"]).code, 3);
  // await: the build replied last, so it waits for the owner's next message rather than returning at once.
  const waiting = sb.cliAsync(["await", "colour", "--timeout", "20s"]);
  await sleep(500);
  await sb.post("/reply", { id: "colour", text: "Great, go navy." });
  const r = await waiting;
  assert.equal(r.code, 0);
  assert.match(r.out, /\[reply\][\s\S]*"Great, go navy\."/);
  assert.match(sb.cli(["answers", "--new"]), /no new answers/, "await recorded it as delivered");
  sb.cli(["acted", id, "--note", "renamed in abc123"]);
  assert.equal(sb.state().questions.find((q) => q.id === id).actedNote, "renamed in abc123");
});
