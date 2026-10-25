// The hook entry points (`build-status hook <event>`, payload on stdin). cli.mjs guarantees exit 0
// and a 1.5 s cutoff; each hooks.json entry also sets "timeout": 2. runHook returns what to print
// and, separately, what to record once it's printed — a hook cut off in between shows an answer
// twice rather than never.
//
//   session-start  answers no session has been told yet (since install)
//   user-prompt    answers given since this session started that it hasn't seen
//   stop           the same rule; blocks the stop once with them (opt-in; stop_hook_active and
//                  the seen list mean it can never loop)
//   post-edit      after an Edit/MultiEdit/Write on the state file: a broken file has just that
//                  edit undone; a lossy re-serialization is flagged
//
// session-start and user-prompt also carry the page's new roadmap requests (status new), one line
// each, delivered once on the same ledgers as answers.
//
// Nothing is written for a repo with no state file in any worktree.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { formatBlock, loadLedgers, markDelivered, pendingFor, pruneSessions, repoHasState, updatedIn } from "./answers.mjs";
import { checkoutFile, homePath, loadConfig, realpathSafe, resolveCheckout } from "./paths.mjs";
import { loadState, locate } from "./state.mjs";
import { atomicWrite, withLock, writeLastGood } from "./write.mjs";

const context = (hookEventName, additionalContext) => ({ hookSpecificOutput: { hookEventName, additionalContext } });

export async function runHook(event, payload = {}) {
  const co = resolveCheckout(payload.cwd || process.cwd());
  const sessionId = payload.session_id || process.env.CLAUDE_CODE_SESSION_ID || null;

  if (event === "post-edit") return postEdit(co, payload);
  if (!sessionId || !repoHasState(co)) return null;

  if (event === "session-start") {
    pruneSessions();
    const { items } = await pendingFor(co, { sessionId, rule: "unseen-by-any" });
    // The session's own clock starts now either way, for user-prompt and stop.
    const session = { startedAt: new Date().toISOString(), seen: {} };
    const rq = await roadmapPending(co, { sessionId, rule: "unseen-by-any" });
    if (!items.length && !rq.length) return { after: () => markDelivered(co, [], sessionId, session) };
    // Only the batch the block shows is marked; the rest stay pending for `answers --new`.
    const { text, shown } = combine(co, items, rq);
    return { out: context("SessionStart", text), after: () => markDelivered(co, shown, sessionId, session) };
  }

  if (event === "user-prompt" || event === "stop") {
    if (event === "stop" && payload.stop_hook_active) return null;
    const { items, session } = await pendingFor(co, { sessionId, rule: "since-session-start" });
    const rq = event === "user-prompt" ? await roadmapPending(co, { sessionId, rule: "since-session-start", session }) : [];
    if (!items.length && !rq.length) return null;
    const { text, shown } = combine(co, items, rq);
    return {
      out: event === "stop" ? { decision: "block", reason: text } : context("UserPromptSubmit", text),
      after: () => markDelivered(co, shown, sessionId, session),
    };
  }
  return null;
}

function combine(co, items, rq) {
  const parts = [];
  let shown = [];
  if (items.length) {
    const b = formatBlock(co, items, { updated: updatedIn(co, items) });
    parts.push(b.text);
    shown = b.shown;
  }
  if (rq.length) {
    const b = formatRoadmapBlock(co, rq);
    parts.push(b.text);
    shown = shown.concat(b.shown);
  }
  return { text: parts.join("\n\n"), shown };
}

const ROADMAP_MAX = 5;
const BRIEF_MAX = 300;
const ms = (iso) => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? null : t;
};

// The page's roadmap requests still `new` in this checkout, as ledger items: the same delivered and
// session ledgers as answers, keyed roadmap#<id>, so each reaches a session once.
export async function roadmapPending(co, { sessionId, rule, session = null }) {
  const { installedAt } = loadConfig();
  if (!installedAt) return [];
  const loc = locate(co);
  if (loc.kind === "none") return [];
  let state;
  try {
    ({ state } = await loadState(loc.statePath));
  } catch {
    return [];
  }
  const inst = ms(installedAt);
  const all = state.roadmapRequests
    .filter((r) => (r.status ?? "new") === "new" && (ms(r.at) ?? 0) > inst)
    .map((r) => ({
      kind: "roadmap",
      key: `roadmap#${r.id}`,
      qid: r.id,
      version: createHash("sha1").update(`roadmap\n${r.id}\n${r.at}\n${r.kind}\n${r.itemId}`).digest("hex").slice(0, 16),
      answeredAt: r.at,
      request: r,
    }));
  const { delivered, session: own } = loadLedgers(co, sessionId);
  if (rule === "unseen-by-any") return all.filter((i) => !delivered.versions[i.version]);
  const s = session ?? own;
  if (!s) return [];
  const started = Math.floor((ms(s.startedAt) ?? Date.now()) / 1000) * 1000;
  return all.filter((i) => (ms(i.answeredAt) ?? 0) >= started && !s.seen?.[i.version]);
}

export function formatRoadmapBlock(co, items) {
  const repo = basename(co.isGit ? dirname(co.commonDir) : co.root);
  const bs = homePath("bin", "build-status");
  const shown = items.slice(0, ROADMAP_MAX);
  const lines = [`build-status: the page records ${items.length} new roadmap request${items.length === 1 ? "" : "s"} in ${repo} (recorded only; ROADMAP.md is unchanged).`];
  for (const { request: r } of shown) {
    const brief = String(r.dispatch?.brief ?? "").replace(/\s+/g, " ").trim();
    const what =
      r.kind === "reorder" ? ` → ${r.to?.after ? `after ${r.to.after}` : r.to?.before ? `before ${r.to.before}` : "top of its section"}`
      : r.kind === "dispatch" ? ` — opus ${r.dispatch?.opus ?? 0}, sonnet ${r.dispatch?.sonnet ?? 0}${brief ? `; brief: "${brief.length > BRIEF_MAX ? `${brief.slice(0, BRIEF_MAX)}…` : brief}"` : ""}`
      : "";
    lines.push(`- ${r.id} ${r.kind} ${r.itemId} "${r.itemTitle ?? ""}"${what}`);
  }
  if (items.length > shown.length) lines.push(`and ${items.length - shown.length} more: ${bs} roadmap-requests --open`);
  lines.push(`Carry each out by the repo's rules: only this session edits ROADMAP.md, and a dispatch is a request, not a launch. ${bs} roadmap-status <id> sent when you take it up, then done --note '<what changed>' or declined --note '<why>'.`);
  return { text: lines.join("\n"), shown };
}

// Undo exactly the edit that broke the file, so nothing anyone else wrote is lost. Only Edit and
// MultiEdit can be undone this way; a Write replaced the whole file.
function reverseEdit(text, tool, input) {
  const undo = (t, { old_string: before, new_string: after, replace_all }) => {
    if (typeof before !== "string" || typeof after !== "string" || !after) return null;
    const count = t.split(after).length - 1;
    if (count === 0 || (!replace_all && count !== 1)) return null;
    return t.split(after).join(before);
  };
  if (tool === "Edit") return undo(text, input);
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    let t = text;
    for (const e of [...input.edits].reverse()) if ((t = undo(t, e)) === null) return null;
    return t;
  }
  return null;
}

const parses = (t) => {
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
};
const escapes = (text) => (text.match(/\\u[0-9a-fA-F]{4}/g) || []).length;

async function postEdit(co, payload) {
  const file = payload.tool_input?.file_path;
  if (!file) return null;
  const loc = locate(co);
  if (loc.kind === "none" || realpathSafe(file) !== realpathSafe(loc.statePath)) return null;
  const lastGoodPath = checkoutFile(co, "build-status.last-good.json");
  let text;
  try {
    text = readFileSync(loc.statePath, "utf8");
  } catch {
    return null;
  }
  if (!parses(text)) {
    let err = "";
    try {
      JSON.parse(text);
    } catch (e) {
      err = e.message;
    }
    const reverted = reverseEdit(text, payload.tool_name, payload.tool_input);
    if (reverted !== null && parses(reverted)) {
      try {
        await withLock(co, { tryOnly: true, who: "post-edit" }, async () => {
          if (readFileSync(loc.statePath, "utf8") !== text) throw new Error("changed since the edit");
          atomicWrite(co, loc.statePath, reverted);
        });
        return {
          out: context(
            "PostToolUse",
            `build-status: that edit left ${loc.statePath} unparseable (${err}), so just that edit was undone; the file is as it was right before it, and your change is NOT in it. Re-apply it with the build-status CLI (finding, ask, step, note, gate, answer) instead of editing the JSON.`,
          ),
        };
      } catch {}
    }
    return {
      out: context(
        "PostToolUse",
        `build-status: that edit left ${loc.statePath} unparseable (${err}) and it could not be undone automatically. Fix the JSON now — the page and every build-status verb refuse a file that doesn't parse. The last copy build-status wrote is ${lastGoodPath}; it may predate other writers' changes, so compare before restoring from it.`,
      ),
    };
  }
  let lastGood = null;
  try {
    lastGood = readFileSync(lastGoodPath, "utf8");
  } catch {}
  if (lastGood && escapes(text) > escapes(lastGood) + 20) {
    return {
      out: context(
        "PostToolUse",
        `build-status: ${loc.statePath} now has ${escapes(text) - escapes(lastGood)} more \\uXXXX escapes than before — it looks re-serialized with Python's json.dump default (ensure_ascii). Use the build-status CLI, or Node JSON.stringify(s, null, 2) + "\\n", or Python ensure_ascii=False.`,
      ),
    };
  }
  writeLastGood(co, text);
  return null;
}
