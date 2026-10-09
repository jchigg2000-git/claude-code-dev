#!/usr/bin/env node
// Every build on this machine in one read-only JSON snapshot, for the lead bookkeeper
// (/lead-keeper). Each state file is found and read through build-status's own locate + normalize;
// nothing is ever written, in a checkout or anywhere else.
//
//   node snapshot.mjs [--live-hours N]     builds with activity in the last N hours (default 48) in
//                                          full, the rest as one line each
//
// Builds come from two places, de-duplicated by resolved root: every checkout that has served a
// page (~/.build-status/checkouts), and every $LEADBOOKER_SCAN/*/ holding a state file (default
// ~/Projects; "" turns the scan off).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { normalize } from "../../build-status/scripts/lib/normalize.mjs";
import { HOME_DIR, git, resolveCheckout } from "../../build-status/scripts/lib/paths.mjs";
import { locate } from "../../build-status/scripts/lib/state.mjs";

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const mtime = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

function discover() {
  const roots = new Set();
  const checkouts = join(HOME_DIR, "checkouts");
  if (existsSync(checkouts)) {
    for (const f of readdirSync(checkouts)) {
      if (!f.endsWith(".json")) continue;
      try {
        const { root } = JSON.parse(readFileSync(join(checkouts, f), "utf8"));
        if (root) roots.add(root);
      } catch {}
    }
  }
  const scan = process.env.LEADBOOKER_SCAN ?? join(homedir(), "Projects");
  if (scan && existsSync(scan)) {
    for (const d of readdirSync(scan, { withFileTypes: true })) {
      const r = join(scan, d.name);
      if (d.isDirectory() && (existsSync(join(r, ".claude", "build-status.json")) || existsSync(join(r, "tools", "build-status.json")))) roots.add(r);
    }
  }
  const byRoot = new Map();
  for (const r of roots) {
    if (!existsSync(r)) continue;
    const co = resolveCheckout(r);
    byRoot.set(co.root, co);
  }
  return [...byRoot.values()];
}

function build(co, now, liveMs) {
  const loc = locate(co);
  if (loc.kind === "none") return null;
  const commitAt = co.isGit ? git(co.root, ["log", "-1", "--format=%cI"]) : null;
  const lastMs = Math.max(mtime(loc.statePath), Date.parse(commitAt) || 0);
  let s;
  try {
    s = normalize(JSON.parse(readFileSync(loc.statePath, "utf8")));
  } catch {
    return { root: co.root, repo: basename(co.root), live: true, lastActivity: iso(lastMs), error: `${loc.statePath} does not parse` };
  }
  const repo = s.repo || basename(co.root);
  if (now - lastMs >= liveMs) return { root: co.root, repo, live: false, lastActivity: iso(lastMs) };
  return {
    root: co.root,
    repo,
    kind: loc.kind,
    live: true,
    lastActivity: iso(lastMs),
    phase: s.phase,
    draft: Boolean(s.extra.draft),
    steps: {
      done: s.steps.filter((x) => x.state === "done").length,
      total: s.steps.length,
      active: s.steps.filter((x) => x.state === "active").map((x) => clip(x.name, 160)),
    },
    gates: s.gates.map((g) => `${g.name}: ${g.status}`),
    note: clip(s.note, 200),
    openQuestions: s.questions
      .filter((q) => q.answer == null)
      .map((q) => ({ id: q.id, severity: q.severity || "amber", askedAt: q.askedAt || null, question: clip(q.question, 220) })),
    // The owner's page comments still open (new, held, sent), so the lead can see one sit past its
    // priority's window (lead/orders.md).
    openComments: s.comments
      .filter((c) => ["new", "held", "sent"].includes(c.status ?? "new"))
      .map((c) => ({ id: c.id, priority: c.priority || "normal", status: c.status || "new", at: c.at || null, statusAt: c.statusAt || null, text: clip(c.text, 160) })),
    recentFindings: s.findings.slice(-5).map((f) => ({ date: f.date || null, kind: f.kind || null, importance: f.importance ?? null, summary: clip(f.summary, 180) })),
    // Keepers run no agents (lead/orders.md), so any `helper:` finding is one the lead reports to the owner.
    helpers: s.findings
      .filter((f) => /^helper:/i.test(String(f.summary ?? "")))
      .slice(-10)
      .map((f) => ({ date: f.date || null, summary: clip(f.summary, 220) })),
  };
}

const args = process.argv.slice(2);
const i = args.indexOf("--live-hours");
const liveHours = Number(i === -1 ? 48 : args[i + 1]);
const now = Date.now();
const builds = discover()
  .map((co) => build(co, now, liveHours * 3600e3))
  .filter(Boolean)
  .sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)));

console.log(
  JSON.stringify(
    {
      at: iso(now),
      live: builds.filter((b) => b.live).map(({ live, ...rest }) => rest),
      dormant: builds.filter((b) => !b.live).map(({ repo, root, lastActivity }) => ({ repo, root, lastActivity })),
    },
    null,
    2,
  ),
);
