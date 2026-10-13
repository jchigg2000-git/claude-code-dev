// C2: answers reach sessions exactly once, quoted and labelled; await; the Stop hook can't loop;
// a broken hand edit is restored.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { spawn } from "node:child_process";
import { CLI, sandbox } from "./helpers.mjs";

const sandboxes = [];
after(() => sandboxes.forEach((s) => s.cleanup()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(opts) {
  const sb = sandbox(opts);
  sandboxes.push(sb);
  sb.cli(["init", "--steps-json", '["a"]']);
  sb.cli(["ask", "--id", "colour", "--question", "Header colour?"]);
  sb.statePath = join(sb.repo, ".claude", "build-status.json");
  // What the page daemon does on a Save — in a child process, so it resolves the sandbox's home.
  sb.pageAnswer = (id, answer) =>
    new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ["--input-type=module", "-e", `
        import * as W from ${JSON.stringify(join(CLI, "..", "lib", "write.mjs"))};
        import { resolveCheckout } from ${JSON.stringify(join(CLI, "..", "lib", "paths.mjs"))};
        await W.mutate(resolveCheckout(${JSON.stringify(sb.repo)}), ${JSON.stringify(sb.statePath)}, (raw) => W.setAnswer(raw, ${JSON.stringify(id)}, { answer: ${JSON.stringify(answer)}, via: "page" }));`], { env: sb.env });
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`page answer exited ${code}`))));
    });
  return sb;
}
const ctx = (out) => out?.hookSpecificOutput?.additionalContext ?? "";

test("a page answer reaches the next prompt exactly once, labelled via page", async () => {
  const sb = setup();
  sb.hook("session-start", { session_id: "s1" });
  await sb.pageAnswer("colour", "teal");
  const first = ctx(sb.hook("user-prompt", { session_id: "s1" }));
  assert.match(first, /colour.*"Header colour\?"/);
  assert.match(first, /Recorded answer \(via page, .*\): "teal"/);
  assert.match(first, /not a new task for any agent/);
  assert.doesNotMatch(first, /You answered/);
  assert.equal(sb.hook("user-prompt", { session_id: "s1" }), null);
});

test("a fresh install injects none of the answers already in the file", async () => {
  const sb = setup({ installedAt: null });
  await sb.pageAnswer("colour", "old answer");
  await sleep(1100);
  writeFileSync(join(sb.home, "config.json"), JSON.stringify({ installedAt: new Date().toISOString() }));
  assert.equal(sb.hook("session-start", { session_id: "s2" }), null);
  assert.equal(sb.hook("user-prompt", { session_id: "s2" }), null);
});

test("a changed answer arrives again, labelled updated", async () => {
  const sb = setup();
  sb.hook("session-start", { session_id: "s3" });
  await sb.pageAnswer("colour", "teal");
  sb.hook("user-prompt", { session_id: "s3" });
  await sb.pageAnswer("colour", "navy");
  const again = ctx(sb.hook("user-prompt", { session_id: "s3" }));
  assert.match(again, /\[updated\]/);
  assert.match(again, /"navy"/);
});

test("await exits 0 with an answer given mid-wait, and 2 on timeout", async () => {
  const sb = setup();
  const waiting = sb.cliAsync(["await", "colour", "--timeout", "20s"]);
  await sleep(400);
  await sb.pageAnswer("colour", "teal");
  const r = await waiting;
  assert.equal(r.code, 0);
  assert.match(r.out, /"teal"/);
  sb.cli(["ask", "--id", "day", "--question", "Which day?"]);
  const t = await sb.cliAsync(["await", "day", "--timeout", "1s"]);
  assert.equal(t.code, 2);
});

test("a prompt hook with stdout piped exits within 300 ms", async () => {
  const sb = setup();
  const t0 = Date.now();
  sb.cli(["hook", "user-prompt"], { input: JSON.stringify({ session_id: "s4", cwd: sb.repo }) });
  assert.ok(Date.now() - t0 < 300, `took ${Date.now() - t0} ms`);
});

test("stop blocks once with the answer, then is silent, and honours stop_hook_active", async () => {
  const sb = setup();
  sb.hook("session-start", { session_id: "s5" });
  await sb.pageAnswer("colour", "teal");
  assert.equal(sb.hook("stop", { session_id: "s5", stop_hook_active: true }), null);
  const blocked = sb.hook("stop", { session_id: "s5" });
  assert.equal(blocked.decision, "block");
  assert.match(blocked.reason, /"teal"/);
  assert.equal(sb.hook("stop", { session_id: "s5" }), null);
});

test("post-edit undoes only the edit that broke the file; others' writes survive", async () => {
  const sb = setup();
  sb.cli(["note", "before"]);
  await sb.pageAnswer("colour", "teal"); // an answer the last-good copy predates
  const good = readFileSync(sb.statePath, "utf8");
  const edit = { old_string: '"note": "before"', new_string: '"note": "broken' };
  writeFileSync(sb.statePath, good.replace(edit.old_string, edit.new_string));
  const out = ctx(sb.hook("post-edit", { session_id: "s6", tool_name: "Edit", tool_input: { file_path: sb.statePath, ...edit } }));
  assert.match(out, /just that edit was undone/);
  const s = JSON.parse(readFileSync(sb.statePath, "utf8"));
  assert.equal(s.note, "before");
  assert.equal(s.questions.find((q) => q.id === "colour").answer, "teal");
  // A Write can't be undone: it says so and leaves the file for a person to fix.
  writeFileSync(sb.statePath, "{broken");
  const w = ctx(sb.hook("post-edit", { session_id: "s6", tool_name: "Write", tool_input: { file_path: sb.statePath, content: "{broken" } }));
  assert.match(w, /could not be undone automatically/);
  assert.equal(readFileSync(sb.statePath, "utf8"), "{broken");
});

test("await and answers --new keep the session's own record", async () => {
  const sb = setup();
  sb.hook("session-start", { session_id: "s7" });
  sb.cli(["ask", "--id", "day", "--question", "Which day?"]);
  await sb.pageAnswer("day", "Thursday");
  await sb.pageAnswer("colour", "teal");
  sb.cli(["await", "day", "--timeout", "2s"], { env: { CLAUDE_CODE_SESSION_ID: "s7" } });
  // colour was answered after this session began and it hasn't seen it: the prompt hook still delivers it
  assert.match(ctx(sb.hook("user-prompt", { session_id: "s7" })), /"teal"/);
});

// Seven questions, one answer each, in order: a block shows five, so two have to wait their turn.
async function answerSeven(sb) {
  const ids = ["q1", "q2", "q3", "q4", "q5", "q6", "q7"];
  for (const id of ids) sb.cli(["ask", "--id", id, "--question", `Pick ${id}?`, "--recommend", "x", "--rationale", "y"]);
  for (const id of ids) await sb.pageAnswer(id, `answer-${id}`);
  return ids;
}
const answered = (text) => [...text.matchAll(/"answer-(q\d)"/g)].map((m) => m[1]);

test("answers --new drains a long queue across pulls: every answer shown once, none consumed unseen", async () => {
  const sb = setup();
  const ids = await answerSeven(sb);
  const first = sb.cli(["answers", "--new"]);
  assert.deepEqual(answered(first), ids.slice(0, 5));
  assert.match(first, /and 2 more, not yet delivered: run \S+\/bin\/build-status answers --new/);
  assert.deepEqual(answered(sb.cli(["answers", "--new"])), ids.slice(5));
  assert.match(sb.cli(["answers", "--new"]), /no new answers/);
  // An edit after its first version went out is delivered again, labelled updated.
  await sb.pageAnswer("q2", "answer-q2-revised");
  assert.match(sb.cli(["answers", "--new"]), /- q2 .*\[updated\][\s\S]*"answer-q2-revised"/);
  // --json prints and marks the whole collection.
  const other = setup();
  await answerSeven(other);
  assert.equal(JSON.parse(other.cli(["answers", "--new", "--json"])).length, 7);
  assert.match(other.cli(["answers", "--new"]), /no new answers/);
});

test("a hook marks seen only the answers its block shows", async () => {
  const sb = setup();
  sb.hook("session-start", { session_id: "s9" });
  const ids = await answerSeven(sb);
  assert.deepEqual(answered(ctx(sb.hook("user-prompt", { session_id: "s9" }))), ids.slice(0, 5));
  assert.deepEqual(answered(ctx(sb.hook("user-prompt", { session_id: "s9" }))), ids.slice(5));
  assert.equal(sb.hook("user-prompt", { session_id: "s9" }), null);
  // A new session's start block is capped too; what it couldn't show is still there to pull.
  const late = setup();
  await answerSeven(late);
  assert.deepEqual(answered(ctx(late.hook("session-start", { session_id: "s10" }))), ids.slice(0, 5));
  assert.deepEqual(answered(late.cli(["answers", "--new"])), ids.slice(5));
});

test("a repo with no state file gets nothing written by the hooks", () => {
  const sb = sandbox();
  sandboxes.push(sb);
  assert.equal(sb.hook("session-start", { session_id: "s8" }), null);
  assert.throws(() => readFileSync(join(sb.repo, ".git", "build-status-id")));
});
