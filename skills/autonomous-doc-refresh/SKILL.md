---
name: autonomous-doc-refresh
description: >-
  Autonomously refresh documentation across the N most-recently-worked git repos
  under a root directory, fixing ONLY stale docs, one repo per iteration, state
  carried in a ledger file so it survives fresh contexts and resumes cleanly.
  Fire on "/autonomous-doc-refresh", "refresh docs across my repos", "update stale
  docs in my top N repos", or a self-paced /loop that wants per-repo doc staleness
  work. Verifies every doc claim against actual source before editing; leaves
  accurate and point-in-time docs untouched; never commits/pushes/merges.
---

# Autonomous documentation refresh (ledger-driven /loop)

A self-paced loop that refreshes stale documentation across many repos, **one repo per
iteration**, with all cross-iteration state in a single **ledger file** (so it works
even when context is summarized between iterations). Proven on a 20-repo run.

## Args
- `root` — directory to scan (default `~/Projects` or the primary working dir).
- `N` — how many repos (default 20), ranked by most-recent-commit date.
- `ledger` — checkpoint path (default `<root>/docs/autonomous-doc-update/ledger.md`).

## The loop shape (ONE repo per iteration)

**Iteration 0 — build the ledger (then stop):**
1. If the ledger already exists, skip to "per-iteration work".
2. Enumerate git repos under `root` (dirs containing `.git`), **excluding** `node_modules`,
   `.claude/worktrees`, and archive-only folders. Rank by `git -C <repo> log -1 --format=%ct`
   (most-recent-commit), take the top `N`.
3. Write the ledger: a markdown table with one row per repo —
   `# | repo | last-commit | status=pending | updated | generated | skipped-fresh | flagged | note`,
   plus a "Run summary" placeholder and a "Per-repo detail log" section.
4. Stop. The next iteration starts the work.

**Each later iteration — process the FIRST `pending` row only:**
1. Read the ledger, pick the first `status=pending` row → that repo.
2. Do the per-repo refresh (below).
3. Update that repo's ledger row → `done` + counts + a one-line note; append a detail block.
4. Schedule the next iteration (`ScheduleWakeup`, ~60s, same loop prompt), OR if it's the
   last row, write the final Run summary and end.

Drive the loop with `ScheduleWakeup` (self-paced) OR just continue turn-by-turn. Mid-iteration,
launch background `Workflow`s / agents — their completion notifications re-enter the iteration.

## Per-repo refresh (the core)

### 1. Scope (cheap, inline)
- List tracked docs: `git ls-files | grep -iE '\.(md|mdx|rst)$|README'` (minus `node_modules`).
- List manifests (package.json, go.mod, pyproject, requirements, Dockerfile, compose, railway).
- `git log -15 --oneline` + per-doc last-commit dates → find docs that **predate** the last
  substantive code change to what they document.
- Read the README head + establish ground truth (routes, entry points, key features, ports).
- **Brand/privacy grep** if relevant — delegate to `brand-scrub-sweep`, which loads its
  real-name patterns at runtime and never hardcodes one; see the caveat below.

### 2. Verify (fan out — read-only)
Launch a `Workflow`: **one verifier agent per code-facing doc** + **one triage agent** for the
rest. Each verifier: reads its doc, cross-checks EVERY concrete claim against the actual code,
returns a structured verdict — `stale | fresh | point-in-time-leave | missing` + severity +
recommendation + concrete `staleClaims{claim, reality, evidence:file:line}` + `missingCoverage`.
Inject known ground truth as an anchor but instruct agents to **verify independently, not trust it**.

### 3. Route
- **stale, living doc** → fix-in-place.
- **stale, system-design / solution-design doc** → regenerate via `gen-sys-doc` / `gen-sdd-doc`
  skill — UNLESS the repo deliberately removed generated design-doc artifacts (respect that),
  or the doc is ~90% fresh with localized errors (targeted fix-in-place is cheaper and preserves
  hand-written rationale).
- **genuinely missing + beneficial** (no README, stock scaffold) → generate.
- **fresh** → leave, log "skipped-fresh".
- **point-in-time** (build plans, handoffs, decision/choices logs, analyses, reports, roadmaps,
  presentations, changelogs) → leave, log "flagged". Historical by nature; drift is not a defect.

### 4. Fix (fan out — disjoint files)
Launch a `Workflow` with **one agent per file** (or logical group), all editing the REAL working
tree in parallel — safe because files are disjoint (do NOT use worktree isolation; changes must
land in the working tree). Each agent verifies-then-edits, preserves accurate content + voice,
changes only what's stale/missing, and returns a structured summary.

### 5. Verify on disk (inline)
`git status --short` (expect only the intended `M`/`??`), grep that the fix landed and the stale
claim is gone, confirm design docs were overwritten not duplicated, confirm point-in-time/fresh
docs are untouched.

### 6. Update the ledger row + append a detail block. Schedule next.

## Hard rules
- **Fix ONLY stale docs.** Accurate docs are left untouched and logged fresh.
- **Verify against code before editing** — this is load-bearing. Do not trust the brief, git
  history, or your own assumption. (Real catches this earns: an SSE feature reverted to polling
  in the working tree though git history shows it; a lens count that was actually correct; an
  intentional feature that looks like a bug.)
- **NEVER commit / push / merge.** Leave everything in the working tree.
- **Exclude data corpora, not just node_modules:** synthetic datasets, reference corpora, vendored
  fixture apps, test fixtures are DATA, not docs — never "refresh" them. (e.g. thousands of
  synthetic contract/claim/schema `.md` files.)
- **Point-in-time docs are left, not "fixed" to current state** — rewriting history is wrong.
- **Shared/contract docs kept byte-identical across repos** stay byte-identical — sync, don't
  add repo-specific prose to the shared body.
- **Brand/privacy scrub only ACCIDENTAL real-entity leaks** — and VERIFY intent first: a real
  name may be a *deliberate feature* (e.g. a brand-toggle) or a *decision-log noting its removal*,
  in which case scrubbing would break accurate docs. Never touch code as part of a doc pass —
  flag code-level leaks instead. When the replacement (codename vs generic) is a judgment call,
  make the safe choice and surface it to the user.

## Stop conditions
Stop when all rows are `done`, OR weekly usage is running low (never start a repo you can't finish
— end cleanly on a completed row). On completion, write a Run summary at the top of the ledger:
repos completed, skipped, anything left unverified/risky, and where/why it stopped. The ledger
doubles as the resume point (a re-run finds no `pending` rows and no-ops).

## Notes
- Design-doc regen via the skills self-scores on a ratchet ledger at
  `<root>/.claude/doc-quality/{gen-sys-doc,gen-sdd-doc}/ledger.md`. A preserve-voice refresh that
  lacks the external-hyperlink pass should log provenance-only and NOT post itself as champion.
- If `~/.claude/commands/gen-sys-doc.md` is empty or missing, agents follow that ratchet-ledger
  convention directly and still produce good docs.
