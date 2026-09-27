// Find the state file before ever creating one, and load it.
// Order, first match wins:
//   1. a repo-local generator with its own state (tools/build-status.mjs + tools/build-status.json):
//      the repo owns its page and its daemon; this package writes the file through the lock but
//      never renders it or manages that daemon;
//   2. .claude/build-status.json, this package's own path;
//   3. tools/build-status.json with no local generator: rendered with this package's renderer.
// Nothing found: `none`, and only Bootstrap creates .claude/build-status.json.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { normalize } from "./normalize.mjs";
import { readRaw } from "./write.mjs";

export function locate(co) {
  const p = (...x) => join(co.root, ...x);
  const toolsState = p("tools", "build-status.json");
  const toolsGen = p("tools", "build-status.mjs");
  const local = p(".claude", "build-status.json");
  if (existsSync(toolsGen) && existsSync(toolsState)) {
    return { kind: "repo-generator", statePath: toolsState, generator: toolsGen, htmlPath: null };
  }
  if (existsSync(local)) return { kind: "generic", statePath: local, htmlPath: p(".claude", "build-status.html") };
  if (existsSync(toolsState)) return { kind: "generic", statePath: toolsState, htmlPath: p("tools", "build-status.html") };
  return { kind: "none", statePath: local, htmlPath: p(".claude", "build-status.html") };
}

export async function loadState(statePath) {
  const raw = await readRaw(statePath);
  return { raw, state: normalize(raw) };
}

// Is a person watching this session? Claude Code marks attended sessions; a headless run
// (claude -p, a scheduled agent) or anything outside Claude with no TTY counts as unattended.
// Unattended runs never ask, never claim a registry port, never open a browser.
export function isAttended(env = process.env) {
  if (env.BUILD_STATUS_ATTENDED === "1") return true;
  if (env.BUILD_STATUS_ATTENDED === "0") return false;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) {
    if (String(env.CLAUDE_CODE_ENTRYPOINT || "").startsWith("sdk")) return false;
    return env.CLAUDE_CODE_SESSION_ATTENDED === "1";
  }
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
