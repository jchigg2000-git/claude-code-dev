// Where things live: the checkout, its identity, and the machine-local ~/.build-status layout.
// Everything machine-local sits under HOME_DIR (overridable with BUILD_STATUS_HOME, which is how
// the tests keep off the real one). Everything per-worktree sits inside that worktree's git dir,
// so it can never be staged.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOME_DIR = process.env.BUILD_STATUS_HOME || join(homedir(), ".build-status");
export const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI_PATH = join(SCRIPTS_DIR, "cli.mjs");

export const realpathSafe = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

export function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// One short hash of the checkout's resolved path: names this checkout's daemon, log and registry
// entry. (The old command and repo-local generators used the same formula for their daemon file
// names, so a matching hash alone never makes a process ours — see serve.mjs.)
export const rootKey = (root) => createHash("sha256").update(realpathSafe(root)).digest("hex").slice(0, 16);

export function resolveCheckout(start = process.cwd()) {
  const top = git(start, ["rev-parse", "--show-toplevel"]);
  const root = realpathSafe(top || start);
  if (!top) return { root, isGit: false, gitDir: null, commonDir: null, primary: true, rootKey: rootKey(root) };
  const [gitDirRel, commonDirRel] = (git(root, ["rev-parse", "--git-dir", "--git-common-dir"]) || ".git\n.git").split("\n");
  const gitDir = realpathSafe(resolve(root, gitDirRel));
  const commonDir = realpathSafe(resolve(root, commonDirRel));
  return { root, isGit: true, gitDir, commonDir, primary: gitDir === commonDir, rootKey: rootKey(root) };
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const homePath = (...parts) => join(HOME_DIR, ...parts);

// A per-worktree file (lock, temp, port, last-good copy). Inside the worktree's own git dir when
// there is one; otherwise under HOME_DIR, keyed by the checkout.
export function checkoutFile(co, name) {
  if (co.isGit) return join(co.gitDir, name);
  return join(ensureDir(homePath("local", co.rootKey)), name);
}

// A random 128-bit id, created once and shared by every worktree of the repo.
export function repoKey(co) {
  const path = co.isGit
    ? join(co.commonDir, "build-status-id")
    : join(ensureDir(homePath("ids")), createHash("sha256").update(co.root).digest("hex"));
  if (!existsSync(path)) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, randomBytes(16).toString("hex") + "\n");
      closeSync(fd);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
  return readFileSync(path, "utf8").trim();
}

export function listWorktrees(co) {
  if (!co.isGit) return [co.root];
  const out = git(co.root, ["worktree", "list", "--porcelain"]);
  if (!out) return [co.root];
  return out
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => realpathSafe(l.slice("worktree ".length)))
    .filter((p) => existsSync(p));
}

export function loadConfig() {
  try {
    return JSON.parse(readFileSync(homePath("config.json"), "utf8"));
  } catch {
    return {};
  }
}

// The build id: a hash of every script this package runs. A daemon whose ping reports another
// build is stale and gets replaced on the next run.
let cachedBuild = null;
export function buildId() {
  if (process.env.BUILD_STATUS_BUILD) return process.env.BUILD_STATUS_BUILD; // tests: simulate a code change
  if (cachedBuild) return cachedBuild;
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".mjs")) hash.update(name).update(readFileSync(p));
    }
  };
  walk(SCRIPTS_DIR);
  cachedBuild = hash.digest("hex").slice(0, 12);
  return cachedBuild;
}

export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ISO timestamp with the local offset, the shape the state file has always carried.
export function localIso(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}
