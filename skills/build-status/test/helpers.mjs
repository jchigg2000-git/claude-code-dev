// Test scaffolding: a throwaway git repo and a throwaway BUILD_STATUS_HOME per test, the CLI run
// as a real process, and raw HTTP (fetch won't let a test set Host or omit Origin).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "cli.mjs");

export function sandbox({ installedAt = new Date(Date.now() - 3600e3).toISOString() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bs-test-"));
  const home = join(dir, "home");
  const repo = join(dir, "repo");
  mkdirSync(home, { recursive: true });
  if (installedAt) writeFileSync(join(home, "config.json"), JSON.stringify({ installedAt }));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
  const env = { ...process.env, BUILD_STATUS_HOME: home, BUILD_STATUS_ATTENDED: "1", CLAUDE_CODE_SESSION_ID: "" };
  const cli = (args, opts = {}) =>
    execFileSync(process.execPath, [CLI, ...args], { cwd: opts.cwd || repo, env: { ...env, ...(opts.env || {}) }, encoding: "utf8", input: opts.input });
  const cliStatus = (args, opts = {}) => {
    try {
      return { code: 0, out: cli(args, opts) };
    } catch (err) {
      return { code: err.status, out: String(err.stdout || "") + String(err.stderr || "") };
    }
  };
  const cliAsync = (args, opts = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], { cwd: opts.cwd || repo, env: { ...env, ...(opts.env || {}) } });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (out += c));
      child.on("close", (code) => resolve({ code, out }));
    });
  const hook = (event, payload, opts = {}) => {
    const out = cli(["hook", event], { ...opts, input: JSON.stringify({ cwd: opts.cwd || repo, ...payload }) });
    return out.trim() ? JSON.parse(out) : null;
  };
  // Stop every page daemon this sandbox started.
  const cleanup = () => {
    try {
      const out = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
      for (const line of out.split("\n")) if (line.includes("cli.mjs daemon") && line.includes(dir)) process.kill(Number(line.trim().split(/\s+/)[0]), "SIGTERM");
    } catch {}
  };
  return { dir, home, repo, env, cli, cliStatus, cliAsync, hook, cleanup };
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
