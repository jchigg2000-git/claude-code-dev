---
name: autonomous-sweep-core
description: >-
  Shared scaffold for autonomous, ledger-driven, cross-repo maintenance sweeps.
  NOT usually fired directly — it is the reusable engine that wip-reconciler,
  security-sweep, license-compliance, deadlink-check, test-backfill, deploy-health,
  config-drift, and changelog-refresh all build on. Defines the ledger contract, the
  one-unit-per-iteration loop, repo ranking/enumeration, the load-bearing
  detect-before-act gate, the disjoint-file fan-out pattern, and the never-destructive /
  resume-safe rules. Read this when authoring a new sweep skill or when a detector skill
  says "follow the autonomous-sweep-core contract." Fire on "/autonomous-sweep-core" only
  to inspect or run a raw sweep with an inline detector.
---

# Autonomous sweep core (the shared ledger/loop engine)

Every skill in this family does the same thing structurally: walk the N most-recently-worked
git repos under a root, process **one unit per iteration**, carry all cross-iteration state in a
single **ledger file** (so it survives context summarization and resumes cleanly), act **only**
where something is genuinely broken, and **never** commit/push/merge. What differs per skill is
only the *detector* (what "broken" means) and the *fixer* (what to write). This file is that
shared 90%; a detector skill is the other 10%.

Descended from `autonomous-doc-refresh`, which proved the pattern on a 20-repo run.

## Args (all detectors accept these)
- `root` — directory to scan (default `~/Projects` or the primary working dir).
- `N` — how many repos (default 20), ranked by most-recent-commit date.
- `ledger` — checkpoint path (default `<root>/docs/autonomous-sweeps/<skill-name>/ledger.md`).
  Each detector gets its OWN ledger dir so sweeps don't collide.

## The loop shape (ONE unit per iteration)

A "unit" is one repo by default; a detector may narrow it (e.g. one Railway service, one doc).

**Iteration 0 — build the ledger (then stop):**
1. If the ledger already exists, skip to "per-unit work".
2. Enumerate git repos under `root` (dirs containing `.git`), **excluding** `node_modules`,
   `.claude/worktrees`, vendored/fixture dirs, and archive-only folders. Rank by
   `git -C <repo> log -1 --format=%ct` (most-recent-commit), take the top `N`.
3. Write the ledger: a markdown table with one row per unit —
   `# | unit | last-commit | status=pending | <detector result columns> | note`,
   plus a "Run summary" placeholder and a "Per-unit detail log" section.
4. Stop. The next iteration starts the work.

**Each later iteration — process the FIRST `pending` row only:**
1. Read the ledger, pick the first `status=pending` row → that unit.
2. Run the per-unit detector + fixer (below).
3. Update that row → `done` + result counts + a one-line note; append a detail block.
4. Schedule the next iteration (`ScheduleWakeup`, ~60s, same loop prompt), OR if it's the last
   row, write the final Run summary and end.

Drive the loop with `ScheduleWakeup` (self-paced) OR just continue turn-by-turn. Mid-iteration,
fan out background agents — their completion notifications re-enter the iteration.

## The per-unit shape (what every detector implements)

### 1. Scope (cheap, inline)
Establish ground truth for this unit before spending tokens: list the relevant files/manifests,
read the head of the most-authoritative source, note what the detector cares about.

### 2. DETECT — the load-bearing gate (fan out, read-only)
**This is the whole game.** Nothing gets changed until the detector proves it is *actually*
broken against real source — never against a brief, git history, or an assumption. Each detector
defines its own "actually broken" test and MUST distinguish:
- **broken** → route to fix.
- **fine** → leave, log "clean/skipped". Idempotent: a re-run over already-fixed state must
  find nothing and no-op.
- **point-in-time / intentional** → leave, log "flagged". Historical or deliberate; drift here
  is not a defect (build plans, decision logs, brand toggles, pinned-on-purpose versions).
Fan out one verifier agent per candidate; each returns a structured verdict with evidence
(`file:line`), severity, and a concrete recommendation. Inject known ground truth as an anchor
but instruct agents to **verify independently, not trust it.**

### 3. FIX (fan out, disjoint files)
Only for verdicts that passed the gate. One agent per file/logical group, editing the REAL
working tree in parallel — safe because files are disjoint. Do NOT use worktree isolation;
changes must land in the working tree. Each agent verifies-then-edits, changes only what the
detector flagged, preserves everything accurate, returns a structured summary. Some detectors are
**report-only** (their "fix" is the ledger + recovery instructions) — that is a valid fixer.

### 4. Verify on disk (inline)
`git status --short` (expect only intended `M`/`??`), grep that the fix landed and the defect is
gone, confirm nothing accurate was touched.

### 5. Update the ledger row + append a detail block. Schedule next.

## Hard rules (inherited by every detector — do not weaken)
- **Act ONLY where genuinely broken.** Verify against real source before changing anything.
  This is load-bearing; false positives that mutate accurate state are the primary failure mode.
- **NEVER commit / push / merge / deploy / rotate / scale / restart.** Leave everything in the
  working tree (or, for infra detectors, read-only). Report actions for the user to take; never
  take irreversible or outward-facing ones.
- **Idempotent.** A second run over fixed state must no-op. Dedup against the ledger.
- **Exclude data, not just node_modules:** synthetic datasets, reference corpora, vendored
  fixture apps, test fixtures are DATA — never "fix" them.
- **Point-in-time / intentional artifacts are LEFT, not corrected to current state.**
- **Shared/contract files kept byte-identical across repos stay byte-identical** — sync, don't
  fork.
- **Never start a unit you can't finish.** Check remaining usage at the top of each iteration;
  end cleanly on a completed row, not mid-unit.

## Stop / resume conditions
Stop when all rows are `done`, OR weekly usage is running low. On completion, write a Run summary
at the top of the ledger: units completed, skipped, anything left unverified/risky, and where/why
it stopped. The ledger is the resume point — a re-run finds no `pending` rows and no-ops.

## Authoring a new detector skill on top of this
A detector `SKILL.md` should be thin. It states, in this order:
1. **Frontmatter** — `name` + a `description` that says what it sweeps, its fire triggers, and
   "follows the autonomous-sweep-core contract."
2. **UNIT** — what one iteration processes (repo / service / doc), if not the default repo.
3. **DETECT** — the exact scan commands + the "actually broken" gate that separates broken from
   fine from point-in-time.
4. **FIX** — what it writes/changes (or "report-only"), with the safe/confirm tiers.
5. **SKIP** — what it must never touch (the detector-specific extension of the hard rules).
6. **LEDGER COLUMNS** — the result columns for this sweep.
7. A short **domain-lessons** list of real catches/traps, mirroring this file's voice.
Everything else (loop shape, ranking, resume, never-destructive) is inherited — reference this
file, don't restate it.
