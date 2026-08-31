---
name: test-backfill
description: >-
  Autonomously backfill tests for untested CRITICAL paths across the N
  most-recently-worked git repos under a root, one repo per iteration, state
  carried in a ledger so it survives fresh contexts and resumes cleanly. Fire on
  "/test-backfill", "backfill tests across my repos", "which repos have untested
  critical paths", or a self-paced /loop that wants per-repo test-gap work. The
  CROSS-REPO autonomous version of the single-repo generate-test-suite /
  harden-tests skills. Generates tests INTO the existing runner only, never
  touches app code, never adds a framework, never chases 100%. Follows the
  autonomous-sweep-core contract.
---

# Test backfill (ledger-driven cross-repo /loop)

The cross-repo autonomous sibling of `generate-test-suite` / `harden-tests`: instead of one
repo you drive, it sweeps many, **one repo per iteration**, filling the highest-leverage test
gaps. Loop shape, ledger contract, ranking, resume, fan-out, and the never-destructive rules are
all inherited from **autonomous-sweep-core** — read that; this file is only the detector + fixer.

## UNIT — one repo per iteration
The default sweep unit (a repo). **Ranking twist for iteration 0:** rank not by recency alone but
surface the **widest coverage gap on critical paths first**. A repo with auth + payment +
data-writes and zero tests outranks a well-tested one, even if the tested one committed more
recently. Record the gap estimate (count of untested critical paths) in the ledger row so the
ordering is auditable and a re-run reproduces it.

## DETECT — read-only, the load-bearing gate
Fan out one read-only verifier per repo. It establishes three things:
- **(a) Runner + framework.** Detect the existing test runner (jest/vitest/mocha, pytest, `go
  test`, rspec, etc.) from manifests + config + a test dir. A repo with **NO runner** is a
  different, lower-priority case: scaffolding a whole framework unattended is out of scope — **flag
  it, do not scaffold.**
- **(b) Critical untested paths.** Trace which of these have **no corresponding test**: auth /
  session, payment / billing, data writes (DB mutations, migrations), public / unauthenticated API
  handlers, permission checks. These are the only gaps worth filling.
- **(c) Coverage signal, cheaply.** If a `--coverage` summary is one command away, capture it as a
  weak before-number — but **do NOT block on a full coverage run**; a slow instrumented run is not
  worth it.

**The gate — "worth a test":** a genuinely untested critical path in a repo that **already has a
runner**. **NOT worth it:** a path already covered; a trivial getter/formatter; a repo with no test
framework (flag, don't scaffold); throwaway/experimental code.

## FIX — fan out, disjoint test files
Only for paths that passed the gate. One agent per test file / logical group.
- Generate tests **INTO the existing runner only** — never introduce a new framework, never change
  app/source code. **Test files only.**
- Each generated test must **actually run and pass against current behavior** —
  **characterization** tests that lock in what the code does today, not aspirational specs.
- If a generated test **reveals a likely bug**, do **NOT** fix the code — record it as a `bug-flag`
  in the ledger note. Report-only for defects.

## SKIP — never touch
- Never modify application / source code (test files only).
- Never add a new test framework or runner (flag the no-runner repo instead).
- Never write a test that doesn't pass against current behavior.
- Never chase 100% coverage — target the highest-leverage critical gaps only.
- (Plus all inherited hard rules: no commit/push/merge; idempotent; exclude data/fixtures.)

## LEDGER COLUMNS
`runner | critical-gaps | tests-generated | coverage-before/after | bug-flags | note`
(`critical-gaps` doubles as the iteration-0 ranking estimate.)

## Domain lessons
- **Characterization locks in CURRENT behavior.** If current behavior is a bug, the test documents
  it and you raise a `bug-flag` — you do NOT silently "fix" it into an aspirational assertion. The
  sweep never edits source.
- **No runner = human decision.** Picking and scaffolding a test framework unattended is scope
  creep; flag it and move on. A framework choice is the user's to make.
- **Coverage % is a weak signal.** An untested `POST /transfer` handler matters more than 20% more
  line coverage on a formatter. Rank by critical-path exposure, not by the coverage number.
- **A test that fails to run is worse than no test.** Verify green (`git status --short` + actually
  run the new test) BEFORE writing the ledger row — a red or flaky test poisons the suite and the
  next run's signal.
