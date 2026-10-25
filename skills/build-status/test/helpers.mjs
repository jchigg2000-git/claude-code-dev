// Test scaffolding: a throwaway git repo and a throwaway BUILD_STATUS_HOME per test, the CLI run
// as a real process, and raw HTTP (fetch won't let a test set Host or omit Origin).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "cli.mjs");
// A hung CLI call is killed rather than left running after the test run is gone.
const CLI_TIMEOUT_MS = 60e3;

// Every sandbox is torn down when this test process ends, even if a file forgot to call
// cleanup() or the run was interrupted, so no temp dir, daemon or spawned CLI outlives it.
const live = new Set();
const cleanupAll = () => live.forEach((sb) => sb.cleanup());
process.on("exit", cleanupAll);
// A run killed mid-CLI-call can't clean up, so each run also removes dirs left by runs whose
// process is gone (the dir name carries the pid that made it).
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};
for (const name of readdirSync(tmpdir())) {
  const m = /^bs-test-(\d+)-/.exec(name);
  if (m && !alive(Number(m[1]))) rmSync(join(tmpdir(), name), { recursive: true, force: true });
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.once(sig, () => {
    cleanupAll();
    process.exit(128 + (sig === "SIGINT" ? 2 : sig === "SIGTERM" ? 15 : 1));
  });

export function sandbox({ installedAt = new Date(Date.now() - 3600e3).toISOString() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `bs-test-${process.pid}-`));
  const home = join(dir, "home");
  const repo = join(dir, "repo");
  mkdirSync(home, { recursive: true });
  if (installedAt) writeFileSync(join(home, "config.json"), JSON.stringify({ installedAt }));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
  const env = { ...process.env, BUILD_STATUS_HOME: home, BUILD_STATUS_ATTENDED: "1", CLAUDE_CODE_SESSION_ID: "" };
  const cli = (args, opts = {}) =>
    execFileSync(process.execPath, [CLI, ...args], {
      cwd: opts.cwd || repo,
      env: { ...env, ...(opts.env || {}) },
      encoding: "utf8",
      input: opts.input,
      timeout: opts.timeout || CLI_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
  const cliStatus = (args, opts = {}) => {
    try {
      return { code: 0, out: cli(args, opts) };
    } catch (err) {
      return { code: err.status, out: String(err.stdout || "") + String(err.stderr || "") };
    }
  };
  const children = new Set();
  const cliAsync = (args, opts = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], { cwd: opts.cwd || repo, env: { ...env, ...(opts.env || {}) }, timeout: opts.timeout || CLI_TIMEOUT_MS, killSignal: "SIGKILL" });
      children.add(child);
      child.on("exit", () => children.delete(child));
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (out += c));
      child.on("close", (code) => resolve({ code, out }));
    });
  const hook = (event, payload, opts = {}) => {
    const out = cli(["hook", event], { ...opts, input: JSON.stringify({ cwd: opts.cwd || repo, ...payload }) });
    return out.trim() ? JSON.parse(out) : null;
  };
  // Stop every CLI child and page daemon this sandbox started, then remove its temp dir.
  const cleanup = () => {
    for (const child of children) child.kill("SIGKILL");
    try {
      const out = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
      for (const line of out.split("\n")) if (line.includes("cli.mjs daemon") && line.includes(dir)) process.kill(Number(line.trim().split(/\s+/)[0]), "SIGTERM");
    } catch {}
    rmSync(dir, { recursive: true, force: true });
    live.delete(sb);
  };
  const sb = { dir, home, repo, env, cli, cliStatus, cliAsync, hook, cleanup };
  live.add(sb);
  return sb;
}

export function http(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers, setHost: false, agent: false }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export const portOf = (url) => Number(new URL(url).port);
export const urlFrom = (renderOut) => /BUILD_STATUS_URL=(\S+)/.exec(renderOut)[1];
export { spawn };
