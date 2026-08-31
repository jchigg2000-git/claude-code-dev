---
name: config-drift
description: >-
  Autonomously sweep config/env drift across the N most-recently-worked git repos
  under a root — code-referenced env vars missing from `.env.example`, unpinned
  dependency versions where a pin is expected, manifest/lockfile mismatch, and
  missing foundational config — one repo per iteration, state in a ledger so it
  survives fresh contexts and resumes cleanly. The CROSS-REPO autonomous version
  of the single-repo lowhangingfruit hygiene audit, focused on config/env drift.
  Fire on "/config-drift", "check for config/env drift across my repos", "is my
  .env.example current", or a self-paced /loop that wants per-repo config-drift
  work. Follows the autonomous-sweep-core contract: read-only detect gate, act
  only on real drift, placeholder-only writes, never a real secret, never
  regenerate a lockfile unattended, never commit/push/merge.
---

# Config/env drift sweep (ledger-driven /loop)

Thin detector on top of **autonomous-sweep-core** — that engine owns the loop, ledger, repo
ranking/enumeration, resume, fan-out, and the never-destructive hard rules. Read it first; this
file only defines the config-drift detector + fixer. Do NOT restate the core.

## UNIT
One repo per iteration.

## DETECT (read-only — the load-bearing gate)
Establish ground truth, then prove *actual* drift before touching anything:
- **(a) ENV DRIFT** — parse env vars actually referenced in code (`process.env.X`,
  `import.meta.env.X`, `os.environ[...]`/`os.getenv(...)`, `Deno.env.get(...)`, viper/`config`
  reads, `ENV[...]`, etc.) and diff against the keys documented in
  `.env.example`/`.env.sample`/`.env.template`. Two directions: keys **used-in-code but missing
  from the example** (onboarding breaks) and keys **in-example but never used** (stale).
- **(b) DEP PINNING** — floating/unpinned versions in manifests (`^`/`~`/`*`/`latest`, unbounded
  ranges) where the ecosystem expects pins.
- **(c) LOCKFILE DRIFT** — manifest vs lockfile out of sync (`package.json` vs the lock, `go.mod`
  vs `go.sum`, `pyproject`/`requirements` vs its lock), or a lockfile missing entirely.
- **(d) MISSING FOUNDATIONAL CONFIG** — `.nvmrc`/`engines`, `.editorconfig` where the repo clearly
  wants one — **light touch**.

**The GATE — "actual drift" is:** a code-referenced env var absent from the example (real
onboarding break); a genuine manifest↔lockfile mismatch; an unpinned version where a pin is
expected. **NOT drift:** an intentionally-optional env var documented elsewhere; a deliberately
-floating version (some tools want `latest`); a repo that intentionally ships no lockfile (a
published library). Fan out one verifier per candidate; each returns a verdict with evidence
(`file:line`), severity, and a concrete recommendation.

## FIX (fan out, disjoint files)
Only for verdicts that passed the gate. Tiered:
- **SAFE (with confirmation):** add a missing **code-referenced** key to `.env.example` with a
  **PLACEHOLDER** value (never a real secret — if you can't infer a safe placeholder, **flag**
  instead of writing); add obvious `.gitignore` entries.
- **CONFIRM:** pinning a floating version — **one-by-one**, respecting the user's update-deps flow.
- **REPORT-ONLY:** lockfile regeneration (must run the package manager) — **flag for the user**,
  do not run it. Stale-in-example keys are reported, not silently deleted.

## SKIP (config-drift extension of the hard rules)
- Never touch a real `.env` file.
- Never write a real credential into `.env.example` — placeholder only.
- Never run a package manager to regenerate a lockfile unattended.
- Never bulk-bump versions — that's the **update-deps** skill's job.

## LEDGER COLUMNS
`env-missing | env-stale | unpinned | lockfile-drift | fixed | note`

## Domain-lessons
- The **#1 real payoff** is a code-referenced env var missing from `.env.example` — an invisible
  onboarding landmine that silently breaks a fresh clone. Prioritize direction (a)-missing.
- **NEVER copy a real value from `.env` into `.env.example`** — placeholder only, and if you're
  unsure what a safe placeholder is, **flag** rather than guess. A leaked secret is worse than
  drift.
- A **"missing lockfile" on a published library is often intentional** — libraries ship version
  ranges, not pinned locks. Don't force a lockfile there; confirm the repo is an app first.
- Distinguish a **deliberately-floating dev tool** (some CLIs are meant to track `latest`) from an
  **accidentally-unpinned runtime dep** — only the latter is drift.
- An **in-example-but-unused key** may be optional/future config, not stale — report it, don't
  delete it out from under the user.
