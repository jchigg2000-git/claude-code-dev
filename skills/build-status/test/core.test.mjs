// The write path's own regressions, and the boundary with a repo that owns its dashboard.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { CLI, sandbox } from "./helpers.mjs";

const sandboxes = [];
after(() => sandboxes.forEach((s) => s.cleanup()));

// A holder and a waiter in different TZs/locales must agree the holder is alive. (Losing no
// write is also covered by mutate's re-check before rename, so this tests the lock itself.)
test("a live lock held under another TZ and locale is never broken", async () => {
  const sb = sandbox();
  sandboxes.push(sb);
  sb.cli(["init", "--steps-json", "[]"]);
  const script = (body) => `
    import { withLock } from ${JSON.stringify(join(CLI, "..", "lib", "write.mjs"))};
    import { resolveCheckout } from ${JSON.stringify(join(CLI, "..", "lib", "paths.mjs"))};
    const co = resolveCheckout(${JSON.stringify(sb.repo)});
    ${body}`;
  const run = (body, env) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", script(body)], { env: { ...sb.env, ...env } });
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (out += c));
    return new Promise((r) => p.on("close", (code) => r({ code, out })));
  };
  const holder = run(`await withLock(co, {}, () => new Promise((r) => setTimeout(r, 1500))); console.log("held");`, { TZ: "UTC", LC_ALL: "de_DE.UTF-8" });
  await new Promise((r) => setTimeout(r, 400));
  const waiter = await run(`try { await withLock(co, { waitMs: 300 }, () => {}); console.log("acquired"); } catch (e) { console.log(e.code); }`, { TZ: "America/Chicago", LC_ALL: "C" });
  assert.equal(waiter.out.trim(), "LOCK_TIMEOUT");
  assert.equal((await holder).out.trim(), "held");
});

test("a state file that isn't a JSON object is refused, not silently 'written'", () => {
  const sb = sandbox();
  sandboxes.push(sb);
  mkdirSync(join(sb.repo, ".claude"));
  writeFileSync(join(sb.repo, ".claude", "build-status.json"), "[]");
  assert.equal(sb.cliStatus(["finding", "--summary", "x"]).code, 4);
});

test("a repo with its own generator is attached to: never rendered, served or stopped", () => {
  const sb = sandbox();
  sandboxes.push(sb);
  mkdirSync(join(sb.repo, "tools"));
  writeFileSync(join(sb.repo, "tools", "build-status.mjs"), "// the repo's own page\n");
  writeFileSync(join(sb.repo, "tools", "build-status.json"), JSON.stringify({ steps: [], gate: { lint: "clean" } }, null, 2) + "\n");
  assert.match(sb.cli(["locate"]), /^repo-generator/);
  assert.equal(sb.cliStatus(["render"]).code, 6);
  assert.equal(sb.cliStatus(["stop"]).code, 6);
  assert.equal(sb.cliStatus(["init"]).code, 6);
  assert.equal(sb.cliStatus(["gate", "lint", "3 problems"]).code, 3); // its gate{} shape is the repo's
  sb.cli(["finding", "--summary", "recorded through the lock"]);
  assert.equal(JSON.parse(readFileSync(join(sb.repo, "tools", "build-status.json"), "utf8")).findings[0].summary, "recorded through the lock");
});

test("init --force on a file that parses replaces the steps and keeps everything else", () => {
  const sb = sandbox();
  sandboxes.push(sb);
  sb.cli(["init", "--steps-json", '["old step"]']);
  sb.cli(["finding", "--summary", "kept finding"]);
  sb.cli(["init", "--force", "--steps-json", '["new step"]']);
  const s = JSON.parse(readFileSync(join(sb.repo, ".claude", "build-status.json"), "utf8"));
  assert.deepEqual(s.steps.map((x) => x.name), ["new step"]);
  assert.equal(s.findings[0].summary, "kept finding");
  assert.ok(!readdirSync(join(sb.repo, ".claude")).some((n) => n.includes(".bak")), "backup stays out of the worktree");
});
