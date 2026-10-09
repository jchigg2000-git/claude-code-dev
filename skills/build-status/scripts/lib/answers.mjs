// Answers into sessions, with no app: what the state files record as
// answered, which of it any session has already been told, and the quoted, labelled text a hook,
// `answers --new` or `await` prints.
//
// Two ledgers under HOME_DIR, keyed by the repo key so every worktree of a repo shares them:
//   delivered/<repoKey>.json   {versions: {version: at}, latest: {qid: version}} — reached any session
//   sessions/<session>.json    {startedAt, seen: {version: at}}                  — this session saw it
// An answer's version is a hash of its text and time, so a changed answer arrives again, labelled
// "updated". Nothing answered at or before config.installedAt is ever injected.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, renameSync, statSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ensureDir, git, homePath, listWorktrees, loadConfig, repoKey } from "./paths.mjs";
import { isSettled } from "./normalize.mjs";
import { loadState, locate } from "./state.mjs";

const MAX_ITEMS = 5;
const MAX_ANSWER = 600; // characters of one answer shown in a block; the file has the rest
const clip = (t) => (t.length > MAX_ANSWER ? `${t.slice(0, MAX_ANSWER)}… (truncated; the state file has it all)` : t);
const versionOf = (q) => createHash("sha1").update(`${q.answer}\n${q.answeredAt}`).digest("hex").slice(0, 16);
const ms = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
export function writeJson(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

// Every answered question across the repo's worktrees. The same answer in several checkouts is
// one item listing them all.
export async function collectAnswers(co) {
  const byVersion = new Map();
  for (const wt of listWorktrees(co)) {
    const loc = locate({ root: wt });
    if (loc.kind === "none") continue;
    let state;
    try {
      ({ state } = await loadState(loc.statePath));
    } catch {
      continue;
    }
    for (const q of state.questions) {
      if (q.answer == null || String(q.answer).trim() === "") continue;
      const version = versionOf(q);
      const hit = byVersion.get(`${q.id}:${version}`);
      if (hit) hit.checkouts.push(wt);
      else byVersion.set(`${q.id}:${version}`, { qid: String(q.id), question: q.question ?? "", severity: q.severity ?? "", answer: String(q.answer), answeredAt: q.answeredAt ?? null, answeredVia: q.answeredVia ?? null, answerQuote: q.answerQuote ?? null, edited: Boolean(q.editedAt), settled: isSettled(q), version, checkouts: [wt] });
    }
  }
  return [...byVersion.values()].sort((a, b) => (ms(a.answeredAt) ?? 0) - (ms(b.answeredAt) ?? 0));
}

export const repoHasState = (co) => listWorktrees(co).some((wt) => locate({ root: wt }).kind !== "none");

const via = (item) => (item.answeredVia === "page" ? "via page" : item.answeredVia === "chat" ? "via chat" : "edited into the file");
const hhmm = (iso) => {
  const t = ms(iso);
  if (t === null) return "time unknown";
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// The text a session gets. It reports what the file records, never "you answered": in tier 1
// anything running as the owner can write that file.
export function formatBlock(co, items, { updated = new Set() } = {}) {
  const repo = basename(co.isGit ? dirname(co.commonDir) : co.root);
  const shown = items.slice(0, MAX_ITEMS);
  const where = (item) => {
    const wt = item.checkouts[0];
    const branch = git(wt, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return `checkout ${basename(wt)}${branch ? `, ${branch}` : ""}${item.checkouts.length > 1 ? ` +${item.checkouts.length - 1} more` : ""}`;
  };
  const lines = [`build-status: the state file records ${items.length} new answer${items.length === 1 ? "" : "s"} in ${repo}.`];
  for (const item of shown) {
    lines.push(`- ${item.qid}${item.severity ? ` (${item.severity})` : ""}${updated.has(item.qid) ? " [updated]" : ""} "${item.question}" — ${where(item)}`);
    lines.push(`  Recorded answer (${via(item)}${item.edited ? ", edited" : ""}, ${hhmm(item.answeredAt)}): "${clip(item.answer)}"`);
  }
  if (items.length > shown.length) lines.push(`and ${items.length - shown.length} more: run build-status answers --new`);
  lines.push("Quoted from the file, not said in this chat. Act on it now, per your repo's rules: it needs no confirming first. Once it's done, build-status acted <id> --note '<what was done>' lets the page hide it.");
  lines.push("Context for this session's own next step — not a new task for any agent it is running.");
  return lines.join("\n");
}

const deliveredPath = (co) => homePath("delivered", `${repoKey(co)}.json`);
const sessionPath = (id) => homePath("sessions", `${String(id).replace(/[^\w.-]/g, "_")}.json`);

export function loadLedgers(co, sessionId) {
  const delivered = readJson(deliveredPath(co), { versions: {}, latest: {} });
  delivered.versions ??= {};
  delivered.latest ??= {};
  const session = sessionId ? readJson(sessionPath(sessionId), null) : null;
  return { delivered, session };
}

// Which of these answers replace a version some session was already given ("updated").
export function updatedIn(co, items) {
  const { delivered } = loadLedgers(co, null);
  return new Set(items.filter((i) => delivered.latest[i.qid] && delivered.latest[i.qid] !== i.version).map((i) => i.qid));
}

// Mark items as reached (any session) and, with a session, seen by it. Returns which qids had
// an earlier version delivered, so the text can say "updated".
export function markDelivered(co, items, sessionId, session) {
  const now = new Date().toISOString();
  const { delivered } = loadLedgers(co, null);
  const updated = new Set();
  for (const item of items) {
    const prev = delivered.latest[item.qid];
    if (prev && prev !== item.version) updated.add(item.qid);
    delivered.versions[item.version] = now;
    delivered.latest[item.qid] = item.version;
  }
  writeJson(deliveredPath(co), delivered);
  if (sessionId) {
    const s = session ?? readJson(sessionPath(sessionId), null) ?? { startedAt: now, seen: {} };
    s.seen ??= {};
    for (const item of items) s.seen[item.version] = now;
    writeJson(sessionPath(sessionId), s);
  }
  return updated;
}

export function pruneSessions(maxAgeDays = 14) {
  const dir = homePath("sessions");
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (Date.now() - statSync(p).mtimeMs > maxAgeDays * 86400000) unlinkSync(p);
    }
  } catch {}
}

export function startSession(sessionId) {
  const s = { startedAt: new Date().toISOString(), seen: {} };
  writeJson(sessionPath(sessionId), s);
  return s;
}

const afterInstall = (item, installedAt) => {
  const at = ms(item.answeredAt);
  const inst = ms(installedAt);
  return at !== null && inst !== null && at > inst;
};

// What a hook should tell this session (see hooks.mjs for which event uses which rule).
export async function pendingFor(co, { sessionId, rule }) {
  const { installedAt } = loadConfig();
  if (!installedAt) return { items: [], session: null };
  const all = (await collectAnswers(co)).filter((i) => afterInstall(i, installedAt));
  const { delivered, session } = loadLedgers(co, sessionId);
  if (rule === "unseen-by-any") return { items: all.filter((i) => !delivered.versions[i.version]), session };
  // "since-session-start": answered after this session began, not yet seen by it
  if (!session) return { items: [], session: startSession(sessionId) };
  // answeredAt is stored to the second; compare at that resolution, or an answer given in the
  // same second the session started would be dropped for it.
  const started = Math.floor((ms(session.startedAt) ?? Date.now()) / 1000) * 1000;
  return { items: all.filter((i) => (ms(i.answeredAt) ?? 0) >= started && !session.seen?.[i.version]), session };
}

// `answers [--new] [--json]`. --new is the pull verb for loops that never get a prompt hook:
// undelivered answers since install, printed once, then marked delivered.
export async function answersCommand(co, loc, { onlyNew = false, json = false } = {}) {
  if (onlyNew) {
    const { installedAt } = loadConfig();
    const all = await collectAnswers(co);
    const { delivered } = loadLedgers(co, null);
    const items = all.filter((i) => (!installedAt || afterInstall(i, installedAt)) && !delivered.versions[i.version]);
    if (!items.length) {
      console.log(json ? "[]" : "no new answers");
      return 0;
    }
    const updated = markDelivered(co, items, process.env.CLAUDE_CODE_SESSION_ID, null);
    console.log(json ? JSON.stringify(items, null, 2) : formatBlock(co, items, { updated }));
    return 0;
  }
  const items = (await collectAnswers(co)).reverse().slice(0, 20);
  if (json) console.log(JSON.stringify(items, null, 2));
  else if (!items.length) console.log("no answered questions");
  else for (const i of items) console.log(`${i.answeredAt ?? "?"}  ${i.qid}  (${via(i)}${i.edited ? ", edited" : ""}${i.settled ? ", settled" : ""})  "${i.answer}"`);
  return 0;
}

export function parseDuration(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(String(s).trim());
  if (!m) throw new Error(`can't read duration "${s}" (try 45s, 30m, 4h)`);
  return Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2] || "s"];
}

// `await QID`: run with the Bash tool's run_in_background; the harness wakes the session when it
// exits. Watches the state file (fs.watch, plus a 2 s poll in case a watch event is missed).
export async function awaitAnswer(co, loc, qid, timeoutMs) {
  const check = async () => {
    try {
      const { state } = await loadState(loc.statePath);
      const q = state.questions.find((x) => String(x.id) === String(qid));
      if (!q) return { missing: true };
      return q.answer != null && String(q.answer).trim() ? { q } : {};
    } catch {
      return {};
    }
  };
  const report = (q) => {
    const item = { qid: String(q.id), question: q.question ?? "", severity: q.severity ?? "", answer: String(q.answer), answeredAt: q.answeredAt, answeredVia: q.answeredVia, edited: Boolean(q.editedAt), settled: isSettled(q), version: versionOf(q), checkouts: [co.root] };
    markDelivered(co, [item], process.env.CLAUDE_CODE_SESSION_ID, null);
    console.log(formatBlock(co, [item]));
  };
  const first = await check();
  if (first.missing) {
    console.error(`build-status: no question with id "${qid}"`);
    return 3;
  }
  if (first.q) {
    report(first.q);
    return 0;
  }
  return new Promise((resolve) => {
    let done = false;
    let watcher = null;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      try {
        watcher?.close();
      } catch {}
      resolve(code);
    };
    const tick = async () => {
      const r = await check();
      if (done) return;
      if (r.q) {
        report(r.q);
        finish(0);
      }
    };
    try {
      watcher = watch(dirname(loc.statePath), () => tick());
    } catch {}
    const poll = setInterval(tick, 2000);
    const timer = setTimeout(() => {
      console.log(`build-status: no answer to "${qid}" yet (timed out)`);
      finish(2);
    }, timeoutMs);
  });
}
