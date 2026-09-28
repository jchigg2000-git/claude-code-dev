// snapshot.mjs sees every build, splits live from dormant, and never writes into a checkout.
//   node --test ~/.claude/skills/lead-keeper/test/*.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SNAP = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "snapshot.mjs");

function repo(parent, name, state, commitDate) {
  const root = join(parent, name);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], {
    env: { ...process.env, GIT_COMMITTER_DATE: commitDate, GIT_AUTHOR_DATE: commitDate },
  });
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, ".claude", "build-status.json"), JSON.stringify(state, null, 2) + "\n");
  return root;
}

test("snapshot: live vs dormant, open questions, read-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "lead-keeper-test-"));
  const home = join(dir, "home");
  const scan = join(dir, "projects");
  mkdirSync(home);
  mkdirSync(scan);
  const live = repo(scan, "alpha", {
    repo: "alpha",
    phase: "p1",
    steps: [{ id: 1, name: "Ship it", state: "active" }],
    questions: [
      { id: "q1", question: "Which way?", severity: "red", answer: null, askedAt: "2026-09-26T10:00:00Z" },
      { id: "q2", question: "Settled?", severity: "amber", answer: "yes" },
    ],
    findings: [
      { id: "f1", date: "2026-09-26", kind: "milestone", summary: "Merged the parser" },
      { id: "f2", date: "2026-09-26", kind: "measure", importance: 1, summary: "helper: batch the log compare, 40k tokens, brief plain: read-only, saving ~10k/pass" },
    ],
  }, new Date().toISOString());
  const old = repo(scan, "beta", { repo: "beta", steps: [], findings: [], questions: [] }, "2020-01-01T00:00:00Z");
  execFileSync("touch", ["-t", "202001010000", join(old, ".claude", "build-status.json")]);
  const statePath = join(live, ".claude", "build-status.json");
  const before = { mtime: statSync(statePath).mtimeMs, files: readdirSync(join(live, ".claude")) };

  const out = execFileSync(process.execPath, [SNAP], { env: { ...process.env, BUILD_STATUS_HOME: home, LEADBOOKER_SCAN: scan }, encoding: "utf8" });
  const s = JSON.parse(out);

  assert.deepEqual(s.live.map((b) => b.repo), ["alpha"]);
  assert.deepEqual(s.dormant.map((b) => b.repo), ["beta"]);
  assert.deepEqual(s.live[0].openQuestions.map((q) => [q.id, q.severity]), [["q1", "red"]]);
  assert.deepEqual(s.live[0].steps.active, ["Ship it"]);
  assert.deepEqual(s.live[0].helpers.map((h) => h.summary.slice(0, 7)), ["helper:"]);
  assert.equal(statSync(statePath).mtimeMs, before.mtime);
  assert.deepEqual(readdirSync(join(live, ".claude")), before.files);
  assert.deepEqual(readdirSync(home), []);
});
