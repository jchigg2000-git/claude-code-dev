// The one write path: lock → re-read → patch by id → temp + fsync + rename → release.
// Every writer goes through here — the shim verbs, the page daemon, init. A hand edit doesn't,
// which is why the post-edit hook exists (hooks.mjs).
//
// The lock is O_EXCL on a per-worktree file inside the git dir, holding {pid, lstart, at}. It is
// broken only when its holder is dead — kill(pid, 0) fails, or that pid now belongs to a process
// with another start time — never for age. Waiters back off with jitter; the CLI waits up to 15 s
// (measured: a locked write of a 217 KB file is ~40-50 ms, so 15 s is hundreds of writers deep),
// the daemon 2 s (then 503), hooks try once. Waits and timeouts go to contention.log, which is
// the measurement the hub's go/no-go gate reads.
import { execFileSync } from "node:child_process";
import {
  appendFileSync, closeSync, constants as fsConstants, copyFileSync, existsSync, fsyncSync, openSync, readFileSync,
  renameSync, statSync, unlinkSync, writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { checkoutFile, ensureDir, homePath, localDate, localIso } from "./paths.mjs";
import { isOwnerTopic, REWRITE_STALE_MS } from "./normalize.mjs";
export { isSettled } from "./normalize.mjs";

export class LockTimeout extends Error {
  constructor(holder, waitedMs) {
    super(`state file is locked by pid ${holder?.pid ?? "?"} (since ${holder?.at ?? "?"}); waited ${waitedMs} ms`);
    this.code = "LOCK_TIMEOUT";
    this.holder = holder;
  }
}
export class Unparseable extends Error {
  constructor(path, cause) {
    super(`${path} does not parse as JSON (${cause.message}) — not writing over it`);
    this.code = "UNPARSEABLE";
  }
}
export class Conflict extends Error {
  constructor(msg) {
    super(msg);
    this.code = "CONFLICT";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A process's start time, as ps prints it. ps formats it in the caller's TZ and locale, so it
// always runs under a fixed one — otherwise two writers with different TZs would each read the
// other's live lock as a recycled pid.
function processStart(pid) {
  try {
    return (
      execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      }).trim() || null
    );
  } catch {
    return null;
  }
}
let ownStart; // computed on first lock use, before any lock file is created, so creating one is instant
const ownStartTime = () => (ownStart === undefined ? (ownStart = processStart(process.pid)) : ownStart);

function holderAlive(holder) {
  if (!holder || !Number.isInteger(holder.pid)) return false;
  try {
    process.kill(holder.pid, 0);
  } catch (err) {
    if (err.code === "ESRCH") return false;
  }
  if (holder.lstart) {
    const now = processStart(holder.pid);
    if (now && now !== holder.lstart) return false; // that pid now belongs to another process
  }
  return true;
}

const readHolder = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null; // mid-write by its creator, or gone
  }
};

function tryCreate(path) {
  try {
    const fd = openSync(path, "wx");
    writeSync(fd, JSON.stringify({ pid: process.pid, lstart: ownStartTime(), at: localIso() }));
    closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
}

// Breaking a dead holder's lock is itself serialised by a second lock, so two waiters that both
// saw the same dead holder can't have the second one delete the first one's fresh lock.
// Unreadable (being written this instant, or truncated by a crash): dead only once it's old.
const staleUnreadable = (path) => {
  try {
    return Date.now() - statSync(path).mtimeMs > 5000;
  } catch {
    return false;
  }
};

function breakIfDead(lockPath) {
  const holder = readHolder(lockPath);
  if (holder === null ? !staleUnreadable(lockPath) : holderAlive(holder)) return false;
  const breaker = lockPath + ".break";
  if (!tryCreate(breaker)) {
    const b = readHolder(breaker);
    if (b === null ? staleUnreadable(breaker) : !holderAlive(b)) {
      try {
        unlinkSync(breaker);
      } catch {}
    }
    return false;
  }
  try {
    const again = readHolder(lockPath);
    if (JSON.stringify(again) === JSON.stringify(holder)) {
      try {
        unlinkSync(lockPath);
      } catch {}
      return true;
    }
    return false;
  } finally {
    try {
      unlinkSync(breaker);
    } catch {}
  }
}

function logContention(co, entry) {
  try {
    ensureDir(homePath());
    appendFileSync(homePath("contention.log"), JSON.stringify({ at: localIso(), root: co.root, ...entry }) + "\n");
  } catch {}
}

export async function withLock(co, { waitMs = 15000, tryOnly = false, who = "cli", name = "build-status.lock" } = {}, fn) {
  const lockPath = checkoutFile(co, name);
  ownStartTime();
  const t0 = Date.now();
  let delay = 10;
  for (;;) {
    if (tryCreate(lockPath)) break;
    if (breakIfDead(lockPath)) continue;
    const waited = Date.now() - t0;
    if (tryOnly || waited >= waitMs) {
      const holder = readHolder(lockPath);
      if (!tryOnly) logContention(co, { who, waitedMs: waited, outcome: "timeout", holder: holder?.pid ?? null });
      throw new LockTimeout(holder, waited);
    }
    await sleep(Math.min(delay, waitMs - waited) * (0.5 + Math.random()));
    delay = Math.min(delay * 1.6, 250);
  }
  const waited = Date.now() - t0;
  if (waited > 50) logContention(co, { who, waitedMs: waited, outcome: "acquired" });
  try {
    return await fn();
  } finally {
    try {
      const holder = readHolder(lockPath);
      if (holder?.pid === process.pid) unlinkSync(lockPath);
    } catch {}
  }
}

// Read the raw JSON. A hand edit doesn't take the lock, so a parse failure may be a write in
// flight: retry three times, 50 ms apart, before calling it unparseable.
export async function readRaw(statePath, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return JSON.parse(readFileSync(statePath, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") throw err;
      lastErr = err;
      if (i < retries) await sleep(50);
    }
  }
  throw new Unparseable(statePath, lastErr);
}

export const serialize = (raw) => JSON.stringify(raw, null, 2) + "\n";

function addToInfoExclude(co, pattern) {
  if (!co.isGit) return;
  const exclude = join(co.commonDir, "info", "exclude");
  try {
    const cur = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    if (!cur.split("\n").includes(pattern)) {
      ensureDir(dirname(exclude));
      appendFileSync(exclude, (cur && !cur.endsWith("\n") ? "\n" : "") + pattern + "\n");
    }
  } catch {}
}

// temp + fsync + rename. The temp file lives in the git dir so it can never show in `git status`;
// if that's another filesystem (EXDEV), it goes beside the state file and its pattern is added to
// .git/info/exclude (local, never committed).
export function atomicWrite(co, statePath, text) {
  const writeTemp = (tmp) => {
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  const tmp = checkoutFile(co, `build-status.tmp.${process.pid}`);
  writeTemp(tmp);
  try {
    renameSync(tmp, statePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    if (err.code !== "EXDEV") throw err;
    const side = join(dirname(statePath), `.${basename(statePath)}.tmp.${process.pid}`);
    addToInfoExclude(co, `.${basename(statePath)}.tmp.*`);
    writeTemp(side);
    renameSync(side, statePath);
  }
  writeLastGood(co, text);
}

// The last copy this package wrote (or the post-edit hook validated). Written from the bytes
// themselves, never copied from the live file, so it can't pick up a hand edit mid-flight.
export function writeLastGood(co, text) {
  try {
    const dest = checkoutFile(co, "build-status.last-good.json");
    const tmp = `${dest}.tmp.${process.pid}`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, dest);
  } catch {}
}

// The whole transaction. `patch(raw)` mutates the raw object in place and returns a result; a
// result with `changed: false` skips the write (and leaves `updated` alone).
//
// The lock only binds writers that use it. A hand edit, or a repo's own page daemon, writes
// without it; so the file's identity is checked again just before the rename, and if anything
// landed in between, the patch is re-applied to that newer version. That shrinks the window in
// which this write could drop someone else's from the whole read-patch-serialize time to the
// instant of the rename.
const fileKey = (p) => {
  try {
    const st = statSync(p);
    return `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
};
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export async function mutate(co, statePath, patch, opts = {}) {
  return withLock(co, opts, async () => {
    for (let attempt = 0; ; attempt++) {
      const before = fileKey(statePath);
      const raw = await readRaw(statePath);
      if (!isPlainObject(raw)) throw new Unparseable(statePath, new Error("the top level is not a JSON object"));
      const result = (await patch(raw)) ?? { changed: true };
      if (result.changed === false) return result;
      raw.updated = localIso();
      const text = serialize(raw);
      if (fileKey(statePath) !== before && attempt < 5) continue;
      atomicWrite(co, statePath, text);
      return result;
    }
  });
}

// A copy of the state file as it is now, kept in the git dir (so `git add -A` can't pick it up)
// under a name that never overwrites an earlier one.
export function backupState(co, statePath) {
  const stamp = localIso().replace(/[-:]/g, "").slice(0, 15);
  for (let i = 1; ; i++) {
    const backup = checkoutFile(co, `build-status.bak-${stamp}${i > 1 ? `-${i}` : ""}.json`);
    try {
      copyFileSync(statePath, backup, fsConstants.COPYFILE_EXCL);
      return backup;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
}

// Create a state file that doesn't exist yet (Bootstrap), or — with `force` — replace one that
// can't be patched (it doesn't parse). The old file is backed up first, never overwritten in place.
export async function create(co, statePath, raw, { force = false } = {}) {
  return withLock(co, {}, async () => {
    let backup = null;
    if (existsSync(statePath)) {
      if (!force) throw new Conflict(`${statePath} already exists — pass --force to replace it (a backup is kept)`);
      backup = backupState(co, statePath);
    }
    ensureDir(dirname(statePath));
    raw.updated = localIso();
    atomicWrite(co, statePath, serialize(raw));
    return { backup };
  });
}

// ---- patches: each takes the raw object and mutates it by id, never rebuilding the file ------

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const arr = (raw, key) => (Array.isArray(raw[key]) ? raw[key] : (raw[key] = []));

export const slugify = (text) =>
  String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-")
    .slice(0, 48) || "finding";

function uniqueId(list, base) {
  const ids = new Set(list.map((x) => (x && typeof x === "object" ? String(x.id) : null)));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function addFinding(raw, f, { explicitId = false } = {}) {
  const list = arr(raw, "findings");
  const finding = { id: f.id || slugify(f.summary), kind: f.kind, importance: f.importance, date: f.date || localDate(), summary: f.summary, detail: f.detail };
  for (const k of Object.keys(finding)) if (finding[k] === undefined || finding[k] === null || finding[k] === "") delete finding[k];
  const existing = list.find((x) => x && typeof x === "object" && String(x.id) === String(finding.id));
  if (existing) {
    const { id: _a, date: _b, ...theirs } = existing;
    const { id: _c, date: _d, ...ours } = finding;
    if (sameJson(theirs, ours)) return { changed: false, id: existing.id, note: "already recorded" };
    if (explicitId) throw new Conflict(`a different finding with id "${finding.id}" already exists`);
    finding.id = uniqueId(list, finding.id);
  }
  list.push(finding);
  return { changed: true, id: finding.id };
}

export function addQuestion(raw, q, { explicitId = false } = {}) {
  const list = arr(raw, "questions");
  const question = {
    id: q.id || slugify(q.question),
    question: q.question,
    severity: q.severity || "amber",
    ...(q.context ? { context: q.context } : {}),
    ...(q.recommendation ? { recommendation: q.recommendation } : {}),
    ...(q.recommendation && q.rationale ? { rationale: q.rationale } : {}),
    answer: null,
    answeredAt: null,
    askedAt: localIso(),
  };
  const existing = list.find((x) => String(x.id) === String(question.id));
  if (existing) {
    if (existing.question === question.question) return { changed: false, id: existing.id, note: "already asked" };
    if (explicitId) throw new Conflict(`a different question with id "${question.id}" already exists`);
    question.id = uniqueId(list, question.id);
  }
  list.push(question);
  return { changed: true, id: question.id };
}

function findQuestion(raw, id) {
  const q = arr(raw, "questions").find((x) => x && String(x.id) === String(id));
  if (!q) throw new Conflict(`no question with id "${id}"`);
  return q;
}

// An answer from the page (`via: "page"`) or recorded from chat (`via: "chat"`, with the owner's
// words verbatim in `answerQuote`). The same text again is a no-op, so a retried save can't
// move `answeredAt`. A changed answer (the page's Edit) is marked edited and unsettles the
// question: the build hasn't acted on the new one yet.
export function setAnswer(raw, id, { answer, via, quote }) {
  const q = findQuestion(raw, id);
  const text = String(answer ?? "").trim();
  if (!text) throw new Conflict("an answer can't be empty");
  if (q.answer === text && q.answeredVia === via) return { changed: false, id: q.id };
  const now = localIso();
  if (q.answer != null && String(q.answer).trim() && q.answer !== text) q.editedAt = now;
  for (const k of ["confirmed", "confirmedAt", "actedAt", "actedNote", "ratified", "ratifiedAt"]) delete q[k];
  q.answer = text;
  q.answeredAt = now;
  if (via) q.answeredVia = via;
  if (quote !== undefined) q.answerQuote = quote;
  else delete q.answerQuote;
  return { changed: true, id: q.id };
}

// The answer the asker recommends, and why; the page offers it as a one-click "Accept
// recommendation" (accepting saves the recommendation only). An empty text removes both, and the
// button with them; a rationale left undefined keeps the one already there.
export function setRecommendation(raw, id, text, rationale) {
  const q = findQuestion(raw, id);
  const next = String(text ?? "").trim();
  const why = next ? (rationale === undefined ? q.rationale ?? "" : String(rationale).trim()) : "";
  if ((q.recommendation ?? "") === next && (q.rationale ?? "") === why) return { changed: false, id: q.id };
  if (next) q.recommendation = next;
  else delete q.recommendation;
  if (why) q.rationale = why;
  else delete q.rationale;
  return { changed: true, id: q.id };
}

const answered = (q) => q.answer != null && String(q.answer).trim() !== "";

// The owner's Confirm: done with this question; the page hides it for good. Only the page sets it.
export function setConfirmed(raw, id) {
  const q = findQuestion(raw, id);
  if (!answered(q) && !isOwnerTopic(q)) throw new Conflict(`question "${q.id}" has no answer to confirm`);
  if (q.confirmed) return { changed: false, id: q.id };
  q.confirmed = true;
  q.confirmedAt = localIso();
  return { changed: true, id: q.id };
}

// The build acted on the answer: the work it asked for landed, or nothing needed doing and the
// decision is recorded. The page hides it; the note says what was done.
export function setActed(raw, id, note) {
  const q = findQuestion(raw, id);
  if (!answered(q) && !isOwnerTopic(q)) throw new Conflict(`question "${q.id}" isn't answered yet`);
  const what = String(note ?? "").trim();
  if (q.actedAt && (q.actedNote ?? "") === what) return { changed: false, id: q.id };
  q.actedAt = localIso();
  if (what) q.actedNote = what;
  else delete q.actedNote;
  return { changed: true, id: q.id };
}

// ---- threads: the conversation around a question (SKILL.md §5). Messages are appended, never
// edited; ids are m1, m2, … within the question. The same text as the thread's last message from
// the same side is a no-op, so a double-clicked Reply can't post it twice.
export const THREAD_MAX = 8000;

function threadText(text) {
  const body = String(text ?? "").trim();
  if (!body) throw new Conflict("a message can't be empty");
  if (body.length > THREAD_MAX) throw new Conflict(`a message is at most ${THREAD_MAX} characters`);
  return body;
}

function pushMessage(q, from, body, via) {
  if (!Array.isArray(q.thread)) q.thread = [];
  const last = q.thread.at(-1);
  if (last && last.from === from && last.text === body) return { changed: false, id: q.id, msgId: last.id, note: "already posted" };
  const n = q.thread.reduce((m, x) => Math.max(m, Number(/^m(\d+)$/.exec(String(x?.id))?.[1]) || 0), 0) + 1;
  q.thread.push({ id: `m${n}`, from, text: body, at: localIso(), ...(via ? { via } : {}) });
  return { changed: true, id: q.id, msgId: `m${n}` };
}

// A message on an existing question's thread: the owner's from the page, the agent's from the CLI.
export function addThreadMessage(raw, id, { from, text, via }) {
  if (from !== "owner" && from !== "agent") throw new Conflict('from is "owner" or "agent"');
  return pushMessage(findQuestion(raw, id), from, threadText(text), via);
}

// The owner starting a topic from the page's "Ask the build" box: a question with origin "owner",
// no severity and no recommendation, whose first thread message is the owner's text. The title is
// that text's first line, clipped. The same text as an open topic's opening message is a no-op.
export function addOwnerTopic(raw, { text, via = "page" }) {
  const body = threadText(text);
  const list = arr(raw, "questions");
  const dup = list.find((q) => q && isOwnerTopic(q) && !q.confirmed && !q.actedAt && Array.isArray(q.thread) && q.thread[0]?.text === body);
  if (dup) return { changed: false, id: dup.id, note: "already posted" };
  const n = list.reduce((m, q) => Math.max(m, Number(/^t(\d+)$/.exec(String(q?.id))?.[1]) || 0), 0) + 1;
  const first = body.split("\n")[0].trim();
  const at = localIso();
  list.push({
    id: uniqueId(list, `t${n}`),
    origin: "owner",
    question: first.length > 140 ? `${first.slice(0, 139)}…` : first,
    answer: null,
    answeredAt: null,
    askedAt: at,
    thread: [{ id: "m1", from: "owner", text: body, at, via }],
  });
  return { changed: true, id: list.at(-1).id, msgId: "m1" };
}

// ---- comments: the owner's notes to the build, typed into the page (or recorded from chat). The
// keeper paces each to the main session by its priority and records what became of it; the page
// shows that trail. Open is new/held/sent; filed, done and declined are closed.
export const COMMENT_PRIORITIES = ["low", "normal", "high", "urgent"];
export const COMMENT_STATUSES = ["new", "held", "sent", "filed", "done", "declined"];
export const COMMENT_OPEN = new Set(["new", "held", "sent"]);
const COMMENT_MAX = 8000;

function findComment(raw, id) {
  const c = arr(raw, "comments").find((x) => x && String(x.id) === String(id));
  if (!c) throw new Conflict(`no comment with id "${id}"`);
  return c;
}

// The same text still waiting as `new` is a no-op, so a double-clicked Send can't post it twice.
export function addComment(raw, { text, priority = "normal", via = "page" }) {
  const body = String(text ?? "").trim();
  if (!body) throw new Conflict("a comment can't be empty");
  if (body.length > COMMENT_MAX) throw new Conflict(`a comment is at most ${COMMENT_MAX} characters`);
  if (!COMMENT_PRIORITIES.includes(priority)) throw new Conflict(`priority is ${COMMENT_PRIORITIES.join(", ")}`);
  const list = arr(raw, "comments");
  const dup = list.find((c) => c && c.text === body && c.status === "new");
  if (dup) return { changed: false, id: dup.id, note: "already posted" };
  const n = list.reduce((m, c) => Math.max(m, Number(/^c(\d+)$/.exec(String(c?.id))?.[1]) || 0), 0) + 1;
  const at = localIso();
  list.push({ id: `c${n}`, text: body, priority, via, at, status: "new", statusAt: at });
  return { changed: true, id: `c${n}` };
}

// What became of it, with a note the page shows beside it. Declining needs the reason.
export function setCommentStatus(raw, id, status, note) {
  if (!COMMENT_STATUSES.includes(status) || status === "new") throw new Conflict("status is held, sent, filed, done or declined");
  const c = findComment(raw, id);
  const why = String(note ?? "").trim();
  if (status === "declined" && !why) throw new Conflict("declining a comment needs a note saying why");
  if (c.status === status && (c.note ?? "") === why) return { changed: false, id: c.id };
  c.status = status;
  c.statusAt = localIso();
  if (why) c.note = why;
  else delete c.note;
  arr(c, "trail").push({ at: c.statusAt, status, ...(why ? { note: why } : {}) });
  return { changed: true, id: c.id };
}

// The owner changing an open comment's priority sends it back to `new`, so the keeper triages it
// again at the new level (and tells the main session if it already had it).
export function setCommentPriority(raw, id, priority) {
  if (!COMMENT_PRIORITIES.includes(priority)) throw new Conflict(`priority is ${COMMENT_PRIORITIES.join(", ")}`);
  const c = findComment(raw, id);
  if (!COMMENT_OPEN.has(c.status ?? "new")) throw new Conflict(`comment "${c.id}" is closed (${c.status})`);
  if (c.priority === priority) return { changed: false, id: c.id };
  const at = localIso();
  arr(c, "trail").push({ at, priority, from: c.priority, status: c.status });
  c.priority = priority;
  c.status = "new";
  c.statusAt = at;
  return { changed: true, id: c.id };
}

// ---- rewrites: the comment box's Improve and Enrich buttons. The page queues the owner's draft
// as `pending`; @keeper rewrites it on its own model (prompt-improver's Improve or Enrich) and
// records the result, which the page offers beside the box. Nothing here is a comment: the owner
// still edits and Sends. A request left pending past REWRITE_STALE_MS stops waking watchers.
export const REWRITE_MODES = ["improve", "enrich"];
export { REWRITE_STALE_MS };
const REWRITE_KEEP_CLOSED = 5;

function findRewrite(raw, id) {
  const r = arr(raw, "rewrites").find((x) => x && String(x.id) === String(id));
  if (!r) throw new Conflict(`no rewrite with id "${id}"`);
  return r;
}

// Keeps every open request and only the last few closed ones, so the state file doesn't grow.
function pruneRewrites(raw) {
  const list = arr(raw, "rewrites");
  const closed = list.filter((r) => r?.status === "closed");
  const drop = new Set(closed.slice(0, Math.max(0, closed.length - REWRITE_KEEP_CLOSED)));
  raw.rewrites = list.filter((r) => r && !drop.has(r));
}

// The same draft and mode still pending is a no-op, so a double click can't queue it twice. A new
// request supersedes any earlier open one: the box only ever offers the latest.
export function requestRewrite(raw, { text, mode }) {
  const body = String(text ?? "").trim();
  if (!body) throw new Conflict("there's nothing in the box to rewrite");
  if (body.length > COMMENT_MAX) throw new Conflict(`a comment is at most ${COMMENT_MAX} characters`);
  if (!REWRITE_MODES.includes(mode)) throw new Conflict(`mode is ${REWRITE_MODES.join(" or ")}`);
  const list = arr(raw, "rewrites");
  const dup = list.find((r) => r && r.status === "pending" && r.text === body && r.mode === mode);
  if (dup) return { changed: false, id: dup.id, note: "already queued" };
  const at = localIso();
  for (const r of list) if (r && r.status !== "closed") Object.assign(r, { status: "closed", closedAt: at });
  const n = list.reduce((m, r) => Math.max(m, Number(/^r(\d+)$/.exec(String(r?.id))?.[1]) || 0), 0) + 1;
  list.push({ id: `r${n}`, mode, text: body, at, status: "pending" });
  pruneRewrites(raw);
  return { changed: true, id: `r${n}` };
}

// The keeper's result, or why it couldn't (`failed` with a note the page shows).
export function setRewrite(raw, id, { result, fail }) {
  const r = findRewrite(raw, id);
  if (r.status === "closed") throw new Conflict(`rewrite "${r.id}" is closed (the owner moved on)`);
  const at = localIso();
  if (fail != null) {
    const why = String(fail).trim();
    if (!why) throw new Conflict("a failed rewrite needs a note saying why");
    Object.assign(r, { status: "failed", note: why, doneAt: at });
    delete r.result;
    return { changed: true, id: r.id };
  }
  const body = String(result ?? "").trim();
  if (!body) throw new Conflict("a rewrite can't be empty");
  if (body.length > COMMENT_MAX) throw new Conflict(`a rewrite is at most ${COMMENT_MAX} characters`);
  if (r.status === "done" && r.result === body) return { changed: false, id: r.id };
  Object.assign(r, { status: "done", result: body, doneAt: at });
  delete r.note;
  return { changed: true, id: r.id };
}

// The owner used it or dismissed it; either way the box stops offering it.
export function closeRewrite(raw, id) {
  const r = findRewrite(raw, id);
  if (r.status === "closed") return { changed: false, id: r.id };
  Object.assign(r, { status: "closed", closedAt: localIso() });
  pruneRewrites(raw);
  return { changed: true, id: r.id };
}

// Pending and still fresh enough to wake a watcher.
export const isLiveRewrite = (r, now = Date.now()) =>
  Boolean(r) && r.status === "pending" && !(now - Date.parse(r.at ?? "") > REWRITE_STALE_MS);

// ---- roadmap requests: the page's Roadmap tab records what the owner asks of ROADMAP.md (move,
// remove, restore, dispatch). Nothing here touches ROADMAP.md: the main session carries a request
// out by the repo's rules and records what became of it. `view` is roadmap.mjs's roadmapView of the
// checkout, read just before the write, so an item id is checked against the file as it is now.
export const ROADMAP_KINDS = ["reorder", "remove", "dispatch", "restore"];
export const ROADMAP_STATUSES = ["new", "held", "sent", "filed", "done", "declined", "withdrawn"];
export const ROADMAP_REQ_OPEN = new Set(["new", "held", "sent", "filed"]);
export const DISPATCH_BRIEF_MAX = 2000;

function findRoadmapRequest(raw, id) {
  const r = arr(raw, "roadmapRequests").find((x) => x && String(x.id) === String(id));
  if (!r) throw new Conflict(`no roadmap request with id "${id}"`);
  return r;
}

const viewItem = (view, id) => {
  for (const s of view?.sections ?? []) {
    const it = (s.items ?? []).find((x) => x.id === id);
    if (it) return { item: it, section: s };
  }
  return null;
};

const agents = (v, name) => {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1) throw new Conflict(`${name} is 0 or 1`);
  return n;
};

export function addRoadmapRequest(raw, { kind, itemId, to, dispatch, via = "page" }, view) {
  if (!ROADMAP_KINDS.includes(kind)) throw new Conflict(`kind is ${ROADMAP_KINDS.join(", ")}`);
  const id = typeof itemId === "string" ? itemId.trim() : "";
  if (!id || id.length > 200) throw new Conflict("itemId is required");
  if (view?.error) throw new Conflict(`the roadmap can't be read: ${view.error}`);
  const list = arr(raw, "roadmapRequests");
  let found = viewItem(view, id);
  if (!found && kind === "restore") {
    // A remove the main session already carried out took the item out of the file; restore names it
    // by the earlier request.
    const prior = [...list].reverse().find((r) => r && r.kind === "remove" && r.itemId === id && !["withdrawn", "declined"].includes(r.status));
    if (prior) found = { item: { id, title: prior.itemTitle ?? "" }, section: { id: prior.section ?? "" } };
  }
  if (!found) throw new Conflict(`no roadmap item "${id}" in ${view?.source ?? "the roadmap"}`);
  const req = { kind, itemId: id, itemTitle: String(found.item.title ?? ""), section: String(found.section.id ?? "") };
  if (kind === "reorder") {
    const t = to && typeof to === "object" ? to : {};
    const anchor = (v, name) => {
      if (v === undefined || v === null || v === "") return null;
      if (typeof v !== "string") throw new Conflict(`to.${name} is an item id or null`);
      if (v === id) throw new Conflict(`an item can't move ${name} itself`);
      if (!viewItem(view, v)) throw new Conflict(`no roadmap item "${v}" to move ${name}`);
      return v;
    };
    req.to = { after: anchor(t.after, "after"), before: anchor(t.before, "before") };
  }
  if (kind === "dispatch") {
    const d = dispatch && typeof dispatch === "object" ? dispatch : {};
    const brief = String(d.brief ?? "").trim();
    if (brief.length > DISPATCH_BRIEF_MAX) throw new Conflict(`a dispatch brief is at most ${DISPATCH_BRIEF_MAX} characters`);
    req.dispatch = { opus: agents(d.opus, "opus"), sonnet: agents(d.sonnet, "sonnet"), brief };
  }
  if (kind === "restore" && !list.some((r) => r && r.kind === "remove" && r.itemId === id && !["withdrawn", "declined"].includes(r.status))) {
    throw new Conflict(`"${id}" has no remove request to undo`);
  }
  // The same request still waiting as new is a no-op, so a double click can't record it twice.
  const dup = list.find(
    (r) => r && r.status === "new" && r.kind === kind && r.itemId === id && sameJson(r.to ?? null, req.to ?? null) && sameJson(r.dispatch ?? null, req.dispatch ?? null),
  );
  if (dup) return { changed: false, id: dup.id, request: dup, note: "already requested" };
  const n = list.reduce((m, r) => Math.max(m, Number(/^rq(\d+)$/.exec(String(r?.id))?.[1]) || 0), 0) + 1;
  const at = localIso();
  const record = { id: `rq${n}`, at, via, ...req, status: "new", statusAt: at, trail: [{ at, status: "new" }] };
  list.push(record);
  return { changed: true, id: record.id, request: record };
}

// What became of a request, with a note the page shows. Declining needs the reason.
export function setRoadmapRequestStatus(raw, id, status, note) {
  if (!["held", "sent", "filed", "done", "declined"].includes(status)) throw new Conflict("status is held, sent, filed, done or declined");
  const r = findRoadmapRequest(raw, id);
  const why = String(note ?? "").trim();
  if (status === "declined" && !why) throw new Conflict("declining a roadmap request needs a note saying why");
  if (r.status === status && (r.note ?? "") === why) return { changed: false, id: r.id, request: r };
  r.status = status;
  r.statusAt = localIso();
  if (why) r.note = why;
  else delete r.note;
  arr(r, "trail").push({ at: r.statusAt, status, ...(why ? { note: why } : {}) });
  return { changed: true, id: r.id, request: r };
}

// The owner taking a request back from the page. Only one nobody has picked up yet (still new).
export function withdrawRoadmapRequest(raw, id) {
  const r = findRoadmapRequest(raw, id);
  if (r.status === "withdrawn") return { changed: false, id: r.id, request: r };
  if ((r.status ?? "new") !== "new") throw new Conflict(`roadmap request "${r.id}" is already ${r.status}; it can't be withdrawn`);
  r.status = "withdrawn";
  r.statusAt = localIso();
  arr(r, "trail").push({ at: r.statusAt, status: "withdrawn" });
  return { changed: true, id: r.id, request: r };
}

const isActive = (s) => s.state === "active" || s.state === "doing";

export function matchStep(raw, match) {
  const steps = arr(raw, "steps");
  const m = String(match).trim();
  if (/^\d+$/.test(m)) {
    const byId = steps.filter((s) => String(s.id) === m);
    if (byId.length === 1) return byId[0];
  }
  const hits = steps.filter((s) => String(s.name ?? "").toLowerCase().includes(m.toLowerCase()));
  if (hits.length === 1) return hits[0];
  const list = steps.map((s) => `  ${s.id}. [${s.state}] ${s.name}`).join("\n");
  throw new Conflict(`${hits.length ? "ambiguous" : "no"} step match for "${m}"; steps are:\n${list}`);
}

// `--done`: mark it done; if nothing is left active, promote the lowest-id todo.
export function stepDone(raw, match) {
  const step = matchStep(raw, match);
  if (step.state === "done") return { changed: false, id: step.id };
  step.state = "done";
  const steps = arr(raw, "steps");
  let promoted = null;
  if (!steps.some(isActive)) {
    const next = steps
      .filter((s) => s.state === "todo")
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))[0];
    if (next) {
      next.state = "active";
      promoted = next.id;
    }
  }
  return { changed: true, id: step.id, promoted };
}

export function setStepState(raw, match, state) {
  if (!["todo", "active", "done"].includes(state)) throw new Conflict(`step state must be todo, active or done`);
  const step = matchStep(raw, match);
  if (step.state === state) return { changed: false, id: step.id };
  step.state = state;
  return { changed: true, id: step.id };
}

export function renameStep(raw, match, name) {
  const next = String(name ?? "").trim();
  if (!next) throw new Conflict("a step name can't be empty");
  const step = matchStep(raw, match);
  if (step.name === next) return { changed: false, id: step.id };
  if (arr(raw, "steps").some((s) => s !== step && s.name === next)) throw new Conflict(`another step is already named "${next}"`);
  step.name = next;
  return { changed: true, id: step.id };
}

export function addStep(raw, name, state = "todo") {
  const steps = arr(raw, "steps");
  if (steps.some((s) => s.name === name)) return { changed: false, note: "a step with that name exists" };
  const id = steps.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0) + 1;
  steps.push({ id: steps.length ? id : 1, name, state });
  return { changed: true, id: steps.at(-1).id };
}

export function setField(raw, key, value) {
  if ((raw[key] ?? "") === value) return { changed: false };
  raw[key] = value;
  return { changed: true };
}

export function nextPhase(raw, label, { force = false } = {}) {
  const steps = arr(raw, "steps");
  const open = steps.filter((s) => s.state !== "done");
  if (open.length && !force) {
    throw new Conflict(
      `the current phase still has ${open.length} open step(s):\n${open.map((s) => `  ${s.id}. [${s.state}] ${s.name}`).join("\n")}\npass --force to close it anyway`,
    );
  }
  arr(raw, "history").push({ phase: raw.phase || "(unnamed phase)", steps: steps.length, completedAt: localDate() });
  raw.phase = label;
  raw.steps = [];
  return { changed: true };
}

// A repo that keeps its gates as an object (`gate{}`) owns that shape; writing a `gates[]` beside
// it would give the page two answers, so this refuses rather than guessing.
export function upsertGate(raw, name, status) {
  if (!Array.isArray(raw.gates) && raw.gate && typeof raw.gate === "object") {
    throw new Conflict("this state file keeps gates as a `gate` object; update it with the repo's own tooling");
  }
  const gates = arr(raw, "gates");
  const g = gates.find((x) => x.name === name);
  if (g) {
    if (g.status === status) return { changed: false };
    g.status = status;
  } else gates.push({ name, status });
  return { changed: true };
}
