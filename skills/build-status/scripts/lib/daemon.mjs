// The per-worktree page daemon: serves the live page on 127.0.0.1 and takes answers from it.
// Started detached by serve.mjs as `cli.mjs daemon --root <root> --key <rootKey> --port <p|0>`.
//
// The front door is checked before anything else, on every route: a Host
// other than 127.0.0.1:<port> or localhost:<port> is refused (DNS rebinding), a preflight gets
// 405, and no CORS header is ever sent. /answer and /comment also need an Origin that is this
// page's own and a JSON body under 64 KB — measured on the old daemon, a cross-site text/plain POST wrote a
// forged answer and a 50 MB body went straight into the state file.
//
// GET renders into the response only; it never writes the HTML file (a stale daemon used to
// overwrite a fresh render that way). A state file that doesn't parse gets the last good render
// with a banner, never a crash — one torn read used to kill the old daemon.
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { renderPage } from "./page.mjs";
import { buildId, checkoutFile, ensureDir, homePath, localIso, resolveCheckout } from "./paths.mjs";
import { locate } from "./state.mjs";
import * as W from "./write.mjs";

export const PING_PATH = "/__build-status-ping";
const MAX_BODY = 64 * 1024;
const HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  // The page is one self-contained file: inline script and style, data: images, and fetches
  // back to itself only.
  "content-security-policy":
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
};

const fileKey = (p) => {
  try {
    const st = statSync(p);
    return `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
};

// Reads at most `limit` bytes; past that it keeps draining (so the response can still be sent)
// but stops buffering, and reports too-large.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on("end", () => (size > limit ? reject(Object.assign(new Error("body too large"), { status: 413 })) : resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

export async function runDaemon({ root, key, port = 0 }) {
  const co = resolveCheckout(root);
  const loc = locate(co);
  if (loc.kind !== "generic") {
    console.error(`build-status daemon: ${co.root} has no state file this package renders (${loc.kind}); not serving`);
    process.exit(1);
  }
  if (key && key !== co.rootKey) {
    console.error(`build-status daemon: key ${key} doesn't match ${co.root}`);
    process.exit(1);
  }
  const build = buildId();
  const registryPath = homePath("checkouts", `${co.rootKey}.json`);
  const portFile = checkoutFile(co, "build-status.port");
  let boundPort = null;
  let cache = null; // {key, html, at} — a burst of tabs refreshing together renders once
  let lastGood = null;

  const hosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]);
  const origins = () => new Set([`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`]);
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { ...HEADERS, ...headers });
    res.end(body);
  };
  const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { "content-type": "application/json", ...headers });

  async function page(req, res) {
    const k = fileKey(loc.statePath);
    let html;
    let stale = false;
    if (cache && cache.key === k && Date.now() - cache.at < 2000) html = cache.html;
    else {
      try {
        ({ html } = await renderPage(co, loc, { live: true, port: boundPort }));
        lastGood = html;
        cache = { key: k, html, at: Date.now() };
      } catch (err) {
        if (!lastGood) {
          return send(res, 503, `build-status: the state file can't be read right now (${err.message}). Reload in a moment.\n`, { "content-type": "text/plain; charset=utf-8" });
        }
        stale = true;
        html = lastGood.replace(
          "<body>",
          '<body><div style="background:#fff4e5;border-bottom:1px solid #f0c890;padding:8px 16px;font:13px system-ui">The state file doesn\'t parse right now (a write in progress, or a broken hand edit); showing the last good render.</div>',
        );
      }
    }
    const headers = { "content-type": "text/html; charset=utf-8", vary: "accept-encoding", ...(stale ? { "x-build-status-stale": "1" } : {}) };
    if (/\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) return send(res, 200, gzipSync(html), { ...headers, "content-encoding": "gzip" });
    return send(res, 200, html, headers);
  }

  // The front door every POST shares: this page's own Origin, a JSON body, under 64 KB. Returns
  // {msg}, or null once it has answered the request itself.
  async function readPost(req, res) {
    const drain = () => req.resume();
    if (!origins().has(String(req.headers.origin || ""))) {
      drain();
      json(res, 403, { ok: false, error: "cross-origin or origin-less requests are refused" });
      return null;
    }
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      drain();
      json(res, 415, { ok: false, error: "send application/json" });
      return null;
    }
    if (Number(req.headers["content-length"]) > MAX_BODY) {
      drain();
      json(res, 413, { ok: false, error: "body too large" }, { connection: "close" });
      return null;
    }
    try {
      return { msg: JSON.parse(await readBody(req, MAX_BODY)) };
    } catch (err) {
      json(res, err.status || 400, { ok: false, error: err.status ? "body too large" : "body is not JSON" });
      return null;
    }
  }

  // A new comment ({text, priority}) or a changed priority on an open one ({id, priority}).
  async function comment(req, res) {
    const got = await readPost(req, res);
    if (!got) return;
    const msg = got.msg;
    const priority = typeof msg?.priority === "string" ? msg.priority : undefined;
    const hasText = typeof msg?.text === "string" && msg.text.trim().length > 0;
    const id = typeof msg?.id === "string" ? msg.id : null;
    if (!hasText && !(id && priority)) return json(res, 400, { ok: false, error: "text (a new comment), or id and priority, required" });
    try {
      const r = await W.mutate(
        co,
        loc.statePath,
        (raw) => (hasText ? W.addComment(raw, { text: msg.text, priority: priority ?? "normal", via: "page" }) : W.setCommentPriority(raw, id, priority)),
        { waitMs: 2000, who: "daemon" },
      );
      cache = null;
      return json(res, 200, { ok: true, id: r.id });
    } catch (err) {
      if (err.code === "LOCK_TIMEOUT") return json(res, 503, { ok: false, error: "busy, try again" });
      if (err.code === "CONFLICT") return json(res, 400, { ok: false, error: err.message });
      if (err.code === "UNPARSEABLE") return json(res, 503, { ok: false, error: "the state file doesn't parse right now; try again" });
      throw err;
    }
  }

  async function answer(req, res) {
    const got = await readPost(req, res);
    if (!got) return;
    const msg = got.msg;
    const id = msg && msg.id;
    const hasAnswer = typeof msg?.answer === "string" && msg.answer.trim().length > 0;
    // Confirm only ever sets; `ratified: true` is what a tab still showing the old page sends.
    const hasConfirm = msg?.confirmed === true || msg?.ratified === true;
    if (!id || (!hasAnswer && !hasConfirm)) return json(res, 400, { ok: false, error: "id and (a non-empty answer or confirmed: true) required" });
    try {
      await W.mutate(
        co,
        loc.statePath,
        (raw) => {
          let changed = false;
          if (hasAnswer) changed = W.setAnswer(raw, id, { answer: msg.answer, via: "page" }).changed || changed;
          if (hasConfirm) changed = W.setConfirmed(raw, id).changed || changed;
          return { changed };
        },
        { waitMs: 2000, who: "daemon" },
      );
      cache = null;
      return json(res, 200, { ok: true, id });
    } catch (err) {
      if (err.code === "LOCK_TIMEOUT") return json(res, 503, { ok: false, error: "busy, try again" });
      if (err.code === "CONFLICT") return json(res, 404, { ok: false, error: err.message });
      if (err.code === "UNPARSEABLE") return json(res, 503, { ok: false, error: "the state file doesn't parse right now; try again" });
      throw err;
    }
  }

  async function handle(req, res) {
    if (!hosts().has(String(req.headers.host || "").toLowerCase())) return json(res, 421, { ok: false, error: "misdirected request" });
    if (req.method === "OPTIONS") return json(res, 405, { ok: false, error: "method not allowed" }, { allow: "GET, POST" });
    const path = String(req.url || "/").split("?")[0];
    if (path === PING_PATH && req.method === "GET") {
      return json(res, 200, { tool: "build-status", impl: "generic", root: co.root, build, pid: process.pid, port: boundPort, statePath: loc.statePath });
    }
    if ((path === "/" || path === "/build-status.html") && req.method === "GET") return page(req, res);
    if (path === "/answer") {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" }, { allow: "POST" });
      return answer(req, res);
    }
    if (path === "/comment") {
      if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" }, { allow: "POST" });
      return comment(req, res);
    }
    return json(res, 404, { ok: false, error: "not found" });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(`build-status daemon: ${err.stack || err}`);
      try {
        if (!res.headersSent) json(res, 500, { ok: false, error: "internal error" });
        else res.end();
      } catch {}
    });
  });

  const cleanup = () => {
    try {
      if (JSON.parse(readFileSync(registryPath, "utf8")).pid === process.pid) unlinkSync(registryPath);
    } catch {}
  };
  const shutdown = () => {
    cleanup();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("uncaughtException", (err) => console.error(`build-status daemon: ${err.stack || err}`));

  server.on("error", (err) => {
    console.error(`build-status daemon: can't listen on 127.0.0.1:${port}: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    boundPort = server.address().port;
    writeFileSync(portFile, `${boundPort}\n`);
    ensureDir(homePath("checkouts"));
    writeFileSync(registryPath, JSON.stringify({ root: co.root, port: boundPort, pid: process.pid, build, startedAt: localIso(), statePath: loc.statePath }, null, 2) + "\n");
    console.log(`${localIso()} build-status daemon ${build} listening on 127.0.0.1:${boundPort} for ${co.root}`);
  });

  // An ephemeral worktree that's been removed takes its page with it.
  setInterval(() => {
    if (!existsSync(co.root) || !existsSync(loc.statePath)) {
      console.log(`${localIso()} ${co.root} or its state file is gone; exiting`);
      shutdown();
    }
  }, 60000).unref();
}
