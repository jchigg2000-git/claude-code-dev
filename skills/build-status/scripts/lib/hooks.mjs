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
// Nothing is written for a repo with no state file in any worktree.
import { readFileSync } from "node:fs";
import { formatBlock, markDelivered, pendingFor, pruneSessions, repoHasState, updatedIn } from "./answers.mjs";
import { checkoutFile, realpathSafe, resolveCheckout } from "./paths.mjs";
import { locate } from "./state.mjs";
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
    const after = () => markDelivered(co, items, sessionId, session);
    if (!items.length) return { after };
    return { out: context("SessionStart", formatBlock(co, items, { updated: updatedIn(co, items) })), after };
  }

  if (event === "user-prompt" || event === "stop") {
    if (event === "stop" && payload.stop_hook_active) return null;
    const { items, session } = await pendingFor(co, { sessionId, rule: "since-session-start" });
    if (!items.length) return null;
    const text = formatBlock(co, items, { updated: updatedIn(co, items) });
    return {
      out: event === "stop" ? { decision: "block", reason: text } : context("UserPromptSubmit", text),
      after: () => markDelivered(co, items, sessionId, session),
    };
  }
  return null;
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
