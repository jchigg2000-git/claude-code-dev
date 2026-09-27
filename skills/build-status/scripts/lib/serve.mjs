// Finding, starting, replacing and stopping this checkout's page daemon.
//
// Port, first that works: the per-worktree port file (in the git dir) → for the primary checkout
// only, a legacy `serverPort` in the state file (read, never written) → an explicit --port →
// listen(0), with the OS's choice recorded in the port file. A recorded port that something else
// holds falls through to listen(0) rather than leaving the page read-only.
//
// A process is ever signalled only when it is provably this package's daemon for this checkout:
// its ping says impl "generic" with this root, AND its command line is `cli.mjs daemon --root
// <root> --key <rootKey>`. The one other thing replaced is the old /build-status command's
// daemon for a repo with no generator of its own, recognised by its exact command-line shape.
// A repo's own generator (`tools/build-status.mjs`) uses the same file-name hash, so the hash alone
// never counts — and serve.mjs is never called for such a repo at all.
import { execFileSync, spawn } from "node:child_process";
import { openSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PING_PATH } from "./daemon.mjs";
import { buildId, checkoutFile, CLI_PATH, ensureDir, homePath, loadConfig, realpathSafe } from "./paths.mjs";
import { loadState, locate } from "./state.mjs";
import { withLock } from "./write.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ping(port, timeoutMs = 600) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${PING_PATH}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return { reachable: true, body };
  } catch {
    return { reachable: false, body: null };
  }
}

const isOurs = (body, co) => body?.tool === "build-status" && body.impl === "generic" && realpathSafe(String(body.root)) === co.root;

function commandLine(pid) {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const isOurDaemonProcess = (pid, co) => {
  const cmd = commandLine(pid);
  return /cli\.mjs daemon /.test(cmd) && cmd.includes(`--root ${co.root} --key ${co.rootKey}`);
};

// The old command ran `node <tmp>/build-status-daemon-<rootKey>.mjs <root> --server-daemon <port>`.
// A repo-local generator runs `... --server-daemon <port> <root>` — different order, never matched.
function legacyCommandDaemon(port, co) {
  let pid = null;
  try {
    pid = Number(execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0]);
  } catch {
    return null;
  }
  if (!pid) return null;
  const cmd = commandLine(pid);
  return cmd.includes(`build-status-daemon-${co.rootKey}.mjs ${co.root} --server-daemon ${port}`) ? pid : null;
}

async function portFree(port, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!(await ping(port, 200)).reachable) return true;
    await sleep(100);
  }
  return false;
}

export function readPortFile(co) {
  try {
    const p = Number(readFileSync(checkoutFile(co, "build-status.port"), "utf8").trim());
    return Number.isInteger(p) && p > 0 && p < 65536 ? p : null;
  } catch {
    return null;
  }
}

async function recordedPort(co, loc) {
  const fromFile = readPortFile(co);
  if (fromFile) return { port: fromFile, source: "port file" };
  if (co.primary) {
    try {
      const { state } = await loadState(loc.statePath);
      if (state.serverPort) return { port: state.serverPort, source: "legacy serverPort" };
    } catch {}
  }
  return null;
}

async function start(co, port) {
  ensureDir(homePath("logs"));
  const logPath = homePath("logs", `${co.rootKey}.log`);
  const log = openSync(logPath, "a");
  if (!port) {
    try {
      unlinkSync(checkoutFile(co, "build-status.port"));
    } catch {}
  }
  const child = spawn(process.execPath, [CLI_PATH, "daemon", "--root", co.root, "--key", co.rootKey, "--port", String(port || 0)], {
    cwd: co.root,
    detached: true,
    stdio: ["ignore", log, log],
  });
  let exited = false;
  child.on("exit", () => (exited = true));
  child.unref();
  // Poll for up to ~3 s: a fixed short sleep read a slow start as failure once a machine had
  // many daemons up.
  const end = Date.now() + 3000;
  while (Date.now() < end && !exited) {
    await sleep(80);
    const p = port || readPortFile(co);
    if (!p) continue;
    const r = await ping(p, 300);
    if (r.reachable && isOurs(r.body, co) && r.body.pid === child.pid) {
      return { live: true, port: p, url: `http://127.0.0.1:${p}/`, started: true };
    }
  }
  if (!exited) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {}
  }
  return { live: false, port: null, url: null, reason: `the page daemon didn't come up (log: ${logPath})` };
}

export async function ensureServer(co, loc, { port: explicit } = {}) {
  if (loc.kind !== "generic") return { live: false, port: null, url: null, reason: "this repo's page is owned by its own generator" };
  // One ensure at a time per checkout, so two renders can't start two daemons.
  return withLock(co, { name: "build-status.serve.lock", waitMs: 8000, who: "serve" }, async () => {
    const want = explicit ? { port: explicit, source: "--port" } : await recordedPort(co, loc);
    const notes = [];
    if (want) {
      const { reachable, body } = await ping(want.port);
      if (reachable && isOurs(body, co)) {
        if (body.build === buildId()) return { live: true, port: want.port, url: `http://127.0.0.1:${want.port}/`, started: false };
        if (isOurDaemonProcess(body.pid, co)) {
          process.kill(body.pid, "SIGTERM");
          await portFree(want.port, 2000);
          const r = await start(co, want.port);
          if (r.live) return { ...r, replaced: body.pid, note: `replaced the page daemon from build ${body.build} (pid ${body.pid})` };
          notes.push(`couldn't restart on ${want.port}`);
        } else notes.push(`port ${want.port} answers as this checkout's page but pid ${body.pid} isn't a daemon this package started; left alone`);
      } else if (reachable && body?.tool === "build-status" && !body.impl && realpathSafe(String(body.root)) === co.root) {
        const pid = legacyCommandDaemon(want.port, co);
        if (pid) {
          process.kill(pid, "SIGTERM");
          await portFree(want.port, 2000);
          const r = await start(co, want.port);
          if (r.live) return { ...r, replaced: pid, note: `replaced the old /build-status command's daemon (pid ${pid})` };
          notes.push(`couldn't restart on ${want.port}`);
        } else notes.push(`port ${want.port} is served by another build-status daemon for this repo that this package can't verify; left alone`);
      } else if (reachable) {
        notes.push(`port ${want.port} (${want.source}) is in use by something else`);
      } else {
        const r = await start(co, want.port);
        if (r.live) return r;
        notes.push(`couldn't bind ${want.port} (${want.source})`);
      }
    }
    const r = await start(co, 0);
    if (notes.length) r.note = `${notes.join("; ")}${r.live ? ` — serving on ${r.port} instead` : ""}`;
    return r;
  });
}

export async function stopServer(co) {
  const port = readPortFile(co);
  if (!port) return { stopped: false, reason: "no page daemon recorded for this checkout" };
  const { reachable, body } = await ping(port);
  if (!reachable) return { stopped: false, reason: "this checkout's page daemon isn't running" };
  if (!isOurs(body, co) || !isOurDaemonProcess(body.pid, co)) return { stopped: false, reason: `port ${port} isn't this checkout's page daemon; left alone` };
  process.kill(body.pid, "SIGTERM");
  await portFree(port, 2000);
  return { stopped: true, pid: body.pid };
}

export async function listCheckouts() {
  const dir = homePath("checkouts");
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const path = join(dir, name);
    let entry;
    try {
      entry = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    const { reachable, body } = await ping(entry.port, 400);
    if (!reachable || body?.impl !== "generic" || body.pid !== entry.pid) {
      try {
        unlinkSync(path);
      } catch {}
      continue;
    }
    let openQuestions = 0;
    try {
      openQuestions = (await loadState(entry.statePath)).state.questions.filter((q) => q.answer == null).length;
    } catch {}
    out.push({ root: entry.root, url: `http://127.0.0.1:${entry.port}/`, port: entry.port, pid: entry.pid, openQuestions });
  }
  return out.sort((a, b) => a.root.localeCompare(b.root));
}

export function openBrowser(url) {
  const { browser } = loadConfig();
  const [cmd, args] =
    process.platform === "darwin" ? ["open", browser ? ["-a", browser, url] : [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {}
}

export { locate };
