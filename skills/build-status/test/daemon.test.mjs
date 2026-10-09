// C0 (the front door), C1 (safe writes, a page per worktree, stale replacement) and the crash
// guard — the acceptance checks, driven through the CLI the way a session would.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { http, portOf, sandbox, urlFrom } from "./helpers.mjs";

let sb;
let port;
let origin;
before(() => {
  sb = sandbox();
  sb.cli(["init", "--steps-json", '["a","b"]']);
  sb.cli(["ask", "--id", "q1", "--question", "Colour?"]);
  sb.cli(["ask", "--id", "q2", "--question", "Size?"]);
  sb.cli(["ask", "--id", "q3", "--question", "Day?"]);
  port = portOf(urlFrom(sb.cli(["render"])));
  origin = `http://127.0.0.1:${port}`;
});
after(() => sb.cleanup());

const post = (body, headers) => http(port, { method: "POST", path: "/answer", headers: { host: `127.0.0.1:${port}`, ...headers }, body });
const state = () => JSON.parse(readFileSync(join(sb.repo, ".claude", "build-status.json"), "utf8"));

test("C0: the front door refuses what the old daemon took", async () => {
  const good = { "content-type": "application/json", origin };
  assert.equal((await post('{"id":"q1","answer":"x"}', { origin: "http://evil.example", "content-type": "text/plain" })).status, 403);
  assert.equal((await post('{"id":"q1","answer":"x"}', { "content-type": "application/json" })).status, 403);
  assert.equal((await http(port, { headers: { host: "evil.test" } })).status, 421);
  assert.equal((await post("a".repeat(65 * 1024), good)).status, 413);
  assert.equal((await http(port, { method: "OPTIONS", path: "/answer", headers: { host: `127.0.0.1:${port}`, origin } })).status, 405);
  const ok = await post('{"id":"q1","answer":"teal"}', good);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["access-control-allow-origin"], undefined);
  const q = state().questions.find((x) => x.id === "q1");
  assert.equal(q.answer, "teal");
  assert.equal(q.answeredVia, "page");
});

test("GET renders into the response only; a corrupt state file doesn't kill the daemon", async () => {
  const html = join(sb.repo, ".claude", "build-status.html");
  const before = statSync(html).mtimeMs;
  assert.equal((await http(port, { headers: { host: `127.0.0.1:${port}` } })).status, 200);
  assert.equal(statSync(html).mtimeMs, before);
  const path = join(sb.repo, ".claude", "build-status.json");
  const good = readFileSync(path, "utf8");
  writeFileSync(path, "{broken");
  const res = await http(port, { headers: { host: `127.0.0.1:${port}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers["x-build-status-stale"], "1");
  assert.equal((await http(port, { path: "/__build-status-ping", headers: { host: `127.0.0.1:${port}` } })).status, 200);
  writeFileSync(path, good);
});

test("C1: 10 concurrent shim writes and 3 page answers lose nothing", async () => {
  const good = { "content-type": "application/json", origin };
  const results = await Promise.all([
    ...Array.from({ length: 10 }, (_, i) => sb.cliAsync(["finding", "--summary", `concurrent finding ${i}`, "--quiet"])),
    post('{"id":"q1","answer":"final colour"}', good),
    post('{"id":"q2","answer":"large"}', good),
    post('{"id":"q3","answer":"Thursday"}', good),
  ]);
  assert.ok(results.slice(0, 10).every((r) => r.code === 0), JSON.stringify(results.slice(0, 10)));
  assert.ok(results.slice(10).every((r) => r.status === 200));
  const s = state();
  for (let i = 0; i < 10; i++) assert.ok(s.findings.some((f) => f.summary === `concurrent finding ${i}`), `finding ${i} lost`);
  assert.deepEqual(s.questions.map((q) => q.answer), ["final colour", "large", "Thursday"]);
});

test("C1: a worktree gets its own live page", async () => {
  const wt = join(sb.dir, "wt");
  execFileSync("git", ["-C", sb.repo, "worktree", "add", "-q", wt, "-b", "wt"]);
  execFileSync("mkdir", ["-p", join(wt, ".claude")]);
  writeFileSync(join(wt, ".claude", "build-status.json"), readFileSync(join(sb.repo, ".claude", "build-status.json")));
  const wtUrl = urlFrom(sb.cli(["render"], { cwd: wt }));
  assert.notEqual(portOf(wtUrl), port);
  const ping = JSON.parse((await http(portOf(wtUrl), { path: "/__build-status-ping", headers: { host: `127.0.0.1:${portOf(wtUrl)}` } })).body);
  assert.equal(ping.root, execFileSync("realpath", [wt], { encoding: "utf8" }).trim());
});

test("C1: a changed build replaces the running daemon on the next render", async () => {
  const pingNow = async () => JSON.parse((await http(port, { path: "/__build-status-ping", headers: { host: `127.0.0.1:${port}` } })).body);
  const before = await pingNow();
  const out = sb.cli(["render"], { env: { BUILD_STATUS_BUILD: "next-build" } });
  assert.match(out, /replaced the page daemon/);
  assert.equal(portOf(urlFrom(out)), port);
  const after = await pingNow();
  assert.equal(after.build, "next-build");
  assert.notEqual(after.pid, before.pid);
});

test("C1: no lock, temp or port file ever shows in git status", () => {
  const status = execFileSync("git", ["-C", sb.repo, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
  assert.deepEqual(
    status.split("\n").filter(Boolean).map((l) => l.slice(3)).sort(),
    [".claude/build-status.json", ".gitignore"],
  );
  assert.ok(existsSync(join(sb.repo, ".git", "build-status.port")));
});

test("a page comment lands with its priority; the keeper's statuses and the owner's re-prioritising show on the page", async () => {
  const post = (path, body, headers = { "content-type": "application/json", origin }) => http(port, { method: "POST", path, headers: { host: `127.0.0.1:${port}`, ...headers }, body });
  assert.equal((await post("/comment", '{"text":"x"}', { "content-type": "text/plain", origin: "http://evil.example" })).status, 403);
  assert.equal((await post("/comment", '{"text":"x","priority":"whenever"}')).status, 400);
  const sent = await post("/comment", JSON.stringify({ text: "Rename the <b>CarPlay</b> card", priority: "high" }));
  assert.equal(sent.status, 200);
  const { id } = JSON.parse(sent.body);
  assert.equal((await post("/comment", JSON.stringify({ text: "Rename the <b>CarPlay</b> card", priority: "high" }))).status, 200);
  let c = state().comments;
  assert.equal(c.length, 1, "a double-clicked Send posts once");
  assert.deepEqual([c[0].id, c[0].priority, c[0].status, c[0].via], [id, "high", "new", "page"]);
  assert.equal(sb.cliStatus(["comment-status", id, "declined"]).code, 3, "declining needs a reason");
  sb.cli(["comment-status", id, "held", "--note", "after the current step"]);
  assert.equal((await post("/comment", JSON.stringify({ id, priority: "urgent" }))).status, 200);
  c = state().comments[0];
  assert.deepEqual([c.priority, c.status], ["urgent", "new"], "a re-prioritised comment goes back for triage");
  assert.match(sb.cli(["comments", "--wait", "--timeout", "1s"]), new RegExp(`${id}  \\[urgent\\] new`));
  sb.cli(["comment-status", id, "filed", "--note", "ROADMAP §5"]);
  assert.match(sb.cli(["comments", "--open"]), /no open comments/);
  assert.equal(sb.cliStatus(["comments", "--wait", "--timeout", "1s"]).code, 2);
  assert.equal((await post("/comment", JSON.stringify({ id, priority: "low" }))).status, 400, "a closed comment can't be re-prioritised");
  const page = (await http(port, { headers: { host: `127.0.0.1:${port}` } })).body;
  assert.match(page, /class="qanswer-input cbox"/);
  assert.match(page, /filed to the backlog/);
  assert.match(page, /ROADMAP §5/);
  assert.ok(page.includes("Rename the &lt;b&gt;CarPlay&lt;/b&gt; card") && !page.includes("<b>CarPlay</b>"));
});

test("Confirm and acted hide an answered question; Edit's changed answer unsettles it, is marked edited, and is delivered as updated", async () => {
  const post = (body) => http(port, { method: "POST", path: "/answer", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", origin }, body: JSON.stringify(body) });
  const page = async () => (await http(port, { headers: { host: `127.0.0.1:${port}` } })).body;
  sb.cli(["ask", "--id", "q4", "--question", "Which lane?"]);
  sb.cli(["ask", "--id", "q5", "--question", "Which road?"]);
  assert.equal((await post({ id: "q4", confirmed: true })).status, 404, "nothing to confirm before an answer");
  await post({ id: "q4", answer: "left" });
  await post({ id: "q5", answer: "north" });
  let html = await page();
  assert.ok(!/Ratify/.test(html));
  assert.match(html, /class="qconfirm-btn" data-id="q4"/);
  assert.match(html, /class="qedit-btn" data-id="q4" data-answer="left"/);
  assert.match(sb.cli(["answers", "--new"]), /q4[\s\S]*Act on it now/);
  await post({ id: "q4", answer: "right" });
  const q4 = state().questions.find((q) => q.id === "q4");
  assert.equal(q4.answer, "right");
  assert.ok(q4.editedAt);
  assert.match(sb.cli(["answers", "--new"]), /q4 \(amber\) \[updated\][\s\S]*edited/);
  assert.equal((await post({ id: "q4", confirmed: true })).status, 200);
  sb.cli(["acted", "q5", "--note", "routed north in abc123"]);
  html = await page();
  assert.ok(!html.includes('data-id="q4"') && !html.includes('data-id="q5"'), "settled questions are hidden");
  assert.match(html, /settled questions? hidden/);
  await post({ id: "q5", answer: "south" });
  const q5 = state().questions.find((q) => q.id === "q5");
  assert.deepEqual([q5.actedAt, q5.actedNote], [undefined, undefined], "a changed answer hasn't been acted on yet");
  assert.match(await page(), /class="qconfirm-btn" data-id="q5"/);
});
