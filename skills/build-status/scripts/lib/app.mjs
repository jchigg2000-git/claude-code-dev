// The repo's own app: which ports the port registry gives it, and which of those (or of any port a
// process inside the checkout is listening on) answer right now. The page leads with a link to the
// running app, or lists the registered ports when nothing is up. Everything here is best-effort and
// bounded: a missing registry, a slow lsof or a refused connect just means fewer rows, never an
// error, and a burst of renders reuses one probe.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const REGISTRY_PATH = process.env.BUILD_STATUS_PORT_REGISTRY || join(homedir(), "Projects", "portRegistry.md");

// Not something a browser opens: shown as a port, never linked.
const NON_HTTP = /\b(postgres|pgvector|redis|mssql|mysql|sqlite|db|database|duckdb|tunnel|smtp|drda|tn3270)\b/i;
const WEB = /\b(web|frontend|vite|spa|ui|app|site|landing|console|dashboard|preview)\b/i;
const PROBE_TTL_MS = 5000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cells = (line) => line.split("|").slice(1, -1).map((c) => c.trim());
const plain = (s) => s.replace(/\*\*|`|~~/g, "").replace(/\s+/g, " ").trim();

// Rows of the registry's tables whose text names this repo as a whole word. The registry is a
// markdown file of `| Port | Service | Source | Notes |` tables; a released port is struck through
// (`~~8137~~`), a range (`4460-4464`) expands, and the build-status page's own port is skipped.
// Services are often named `<repo>-web`, so a hyphenated suffix still counts, unless the longer
// name is itself another repo (`others`: the sibling directory names).
export function registeredPorts(repo, text, others = new Set()) {
  if (!repo) return [];
  if (text === undefined) {
    try {
      text = readFileSync(REGISTRY_PATH, "utf8");
    } catch {
      return [];
    }
  }
  const name = new RegExp(`(?:^|[^A-Za-z0-9_.-])(${escapeRe(repo)}[A-Za-z0-9_.-]*)`, "gi");
  const lower = repo.toLowerCase();
  const names = (row) =>
    [...row.matchAll(name)].some(([, word]) => {
      let w = word.toLowerCase().replace(/[.-]+$/, "");
      // the longest prefix that is the repo or another repo decides
      while (w.length > lower.length && !others.has(w)) {
        const cut = w.replace(/[-._][^-._]*$/, "");
        if (cut === w) return false;
        w = cut;
      }
      return w === lower;
    });
  const out = new Map();
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const [portCell, service = "", source = ""] = cells(line);
    if (!portCell || portCell.startsWith("~~")) continue;
    const m = /^(\d{2,5})(?:\s*-\s*(\d{2,5}))?$/.exec(plain(portCell));
    if (!m) continue;
    // Service and source only: notes often name a neighbour ("moved off gitjob.io's 5199").
    const row = plain(`${service} ${source}`);
    if (!names(row) || /build-status/i.test(row) || /^RELEASED\b/i.test(plain(service))) continue;
    const lo = Number(m[1]);
    const hi = m[2] ? Math.min(Number(m[2]), lo + 9) : lo;
    const label = plain(service).replace(/(\s*\((backend|frontend)\))+\s*$/i, "");
    // What the page shows: no repo prefix, no parenthetical ("landing web", not the whole row).
    const short = label.replace(/\s*[(;].*$/, "").replace(new RegExp(`^${escapeRe(repo)}[-\\s]*`, "i"), "").trim() || label.replace(/\s*[(;].*$/, "");
    for (let p = lo; p <= hi; p++) if (!out.has(p)) out.set(p, { port: p, label, short, registered: true });
  }
  return [...out.values()];
}

function answers(port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

const lsof = (args) => {
  try {
    return execFileSync("lsof", args, { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] });
  } catch (err) {
    return typeof err.stdout === "string" ? err.stdout : "";
  }
};

// TCP listeners whose process works inside the checkout: catches an app the registry doesn't know
// about (a Vite on its default port, say). Process name kept for the label.
function listenersInside(root) {
  const byPid = new Map();
  let pid = null;
  let cmd = "";
  for (const line of lsof(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]).split("\n")) {
    if (line[0] === "p") pid = line.slice(1);
    else if (line[0] === "c") cmd = line.slice(1);
    else if (line[0] === "n" && pid) {
      const port = Number(/:(\d+)$/.exec(line)?.[1]);
      if (!port) continue;
      const e = byPid.get(pid) || { cmd, ports: new Set() };
      e.ports.add(port);
      byPid.set(pid, e);
    }
  }
  if (!byPid.size) return [];
  const out = [];
  pid = null;
  for (const line of lsof(["-a", "-d", "cwd", "-p", [...byPid.keys()].join(","), "-Fpn"]).split("\n")) {
    if (line[0] === "p") pid = line.slice(1);
    else if (line[0] === "n" && pid) {
      const cwd = line.slice(1);
      if (cwd !== root && !cwd.startsWith(`${root}/`)) continue;
      const e = byPid.get(pid);
      for (const port of e.ports) out.push({ port, label: `${e.cmd} (listening from this checkout, not in the port registry)`, short: e.cmd, registered: false });
    }
  }
  return out;
}

let cache = null; // {key, at, value}

// {ports: [{port, label, registered, up, web, url}]}: running ones first (web before the rest),
// then the registered ones that aren't answering. `exclude` lists the page's own port(s).
export async function appPorts(root, repo, { exclude = [] } = {}) {
  const key = `${root}\0${repo}\0${exclude.join(",")}`;
  if (cache && cache.key === key && Date.now() - cache.at < PROBE_TTL_MS) return cache.value;
  let others = new Set();
  try {
    others = new Set(readdirSync(dirname(root)).map((d) => d.toLowerCase()));
    others.delete(repo.toLowerCase());
  } catch {}
  const rows = new Map(registeredPorts(repo, undefined, others).map((r) => [r.port, r]));
  for (const r of listenersInside(root)) if (!rows.has(r.port)) rows.set(r.port, r);
  for (const p of exclude) rows.delete(Number(p));
  const list = [...rows.values()];
  const up = await Promise.all(list.map((r) => answers(r.port)));
  const ports = list
    .map((r, i) => {
      const http = !NON_HTTP.test(r.label);
      return { ...r, up: up[i], web: http && r.registered && WEB.test(r.label), url: http ? `http://localhost:${r.port}/` : null };
    })
    .sort((a, b) => b.up - a.up || b.web - a.web || b.registered - a.registered || Boolean(b.url) - Boolean(a.url) || a.port - b.port);
  const value = { ports };
  cache = { key, at: Date.now(), value };
  return value;
}
