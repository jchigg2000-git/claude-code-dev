---
name: shipit
description: End-to-end shipping pipeline — branch (if on main) → commit → push → merge to main → push main → delete local + remote feature branch. Resolves the simple cases without asking, stops cleanly on anything weird with a precise "where the work is now" report so the user can rebuild rather than reason about a conflict. Supports `--dry-run` and `--message "<text>"`. Fires on `/shipit` or natural-language equivalents ("ship it", "ship this", "ship and merge"). Idempotent on clean trees. Does not fire for commit-only, push-only, or merge-only requests.
---

# Ship it

Ship the current working state to `main`. Be decisive on the simple cases. On anything weird — conflicts, non-FF, hook failures, protected branches, in-progress merge/rebase/bisect, detached HEAD with surprise commits, anything that requires reasoning about history — **stop cleanly and report where every piece of work currently lives.** The user can rebuild from a clear state report; they cannot easily reason about a conflict you guessed at.

This file is the sole source of truth for `/shipit` behavior. A future agent reading only this file must be able to re-derive the same behavior.

## Entry

- `/shipit` — no required args.
- `/shipit --dry-run` — run snapshot + decide + hygiene + gate phases (all read-only), print the plan for the mutating phases, exit 0 without committing/pushing/merging.
- `/shipit --message "<text>"` — use `<text>` verbatim as the commit subject when committing dirty state. Body auto-generated from `git diff --stat`.
- `/shipit --skip-hygiene` — skip `phase:hygiene`. Use sparingly; bypasses real drift.
- `/shipit --skip-sysdoc-gate` — skip `phase:sysdoc-gate`. Use when you know the change is structural but want to defer regen.

Natural-language equivalents ("ship it", "ship this", "ship and merge", "ship to main") fire the same flow. Do not fire for commit-only / push-only / merge-only requests, and do not fire when the user is asking what `/shipit` *would* do.

## Hard invariants

- Refuse to run if `git rev-parse --show-toplevel` is not under `$HOME`.
- Never use `--no-verify`, `--force`, `--force-with-lease`, `reset --hard`, `clean -fd`, `checkout .`, `branch -D`, or any `-i` flag.
- Never delete a branch (local or remote) unless the feature tip has just been confirmed present on `origin/main` via `phase:verify`.
- No interactive prompts of any kind.
- Single attempt per mutating git command. Do not retry. If something fails, route to the **stop-clean** procedure below.

## Phases (one status line per phase)

1. `phase:snapshot` — capture once and do not re-snapshot mid-run:
   - `git branch --show-current`
   - `git status --porcelain=v1 -b`
   - `git ls-files --others --exclude-standard`
   - `git diff --stat HEAD`
   - `git rev-parse HEAD`
2. `phase:decide` — match exactly one decision-table row below and print it.
3. `phase:hygiene` — run `python3 <skill-dir>/hygiene-check.py --root <repo-root>`. Exit 0 = continue. Exit 1 = stop-clean, surfacing the script's full output (the failures are listed there with an auto-fix command for env drift). Skipped if `--skip-hygiene`. Read-only; the auto-fix is never invoked automatically.
4. `phase:sysdoc-gate` — run `python3 <skill-dir>/sysdoc-gate.py --root <repo-root>`. Exit 0 = continue silently. Exit 1 = the change is structural (rules R6 or R7 fired); invoke `/gen-sys-doc --no-pdf` to regenerate `docs/architecture/system-design.md`. Any regen output becomes part of the dirty state for `phase:commit` to pick up. On `--dry-run`, run the detector but DO NOT invoke gen-sys-doc — just report what would happen. Skipped if `--skip-sysdoc-gate`. Rule set is R6 (≥2 new non-test, non-shadcn source files) + R7 (migrations/schema changes); see **Sibling scripts** below.
5. `phase:commit` — only if dirty. Skipped silently otherwise.
6. `phase:push-feature` — `git push -u origin HEAD`.
7. `phase:merge` — see "Merge to main" below.
8. `phase:push-main` — `git push` on `main`.
9. `phase:verify` — confirm the remote `main` actually contains the feature tip: `git fetch origin && git merge-base --is-ancestor <feature-tip-sha> origin/main`. If false, stop-clean.
10. `phase:cleanup` — only after `phase:verify` passes: first `git branch -d <feature>` locally, then `git push origin --delete <feature>` to prune the remote tracking branch so it doesn't accumulate. Both are single-attempt: if `branch -d` fails the work is safe on `origin/main` and the local branch is left for the user to inspect; if `push --delete` fails (branch protection, concurrent push, already gone) report it in closeout under **skipped** and continue — the work is already on `origin/main`, the dangling remote ref is hygiene, not state. Do not retry, do not stop-clean for this.
11. `phase:closeout` — four buckets: **done / skipped / unverified / risky**. Always note whether sysdoc-gate fired in closeout.

`--dry-run` runs phases 1–4 (all read-only; sysdoc-gate detection only, no regen), prints the planned actions for 5–10, exits 0.

## Decision table — first matching row wins

| State | Action |
|---|---|
| Clean tree, on `main`, in sync with `origin/main` | No-op success. |
| Clean tree, on `main`, ahead of `origin/main` (fast-forward push possible) | `git push`. Done. |
| Clean tree, on `main`, behind `origin/main` | `git pull --ff-only`. If non-FF, stop-clean. |
| Clean tree, on `main`, diverged from `origin/main` | Stop-clean. Pulling here means reasoning about history. |
| Clean tree, on feature branch | Run merge-to-main. |
| Dirty tree, on `main` | Create `ship/<slug>-<short-sha>` (slug from `--message` if given, else inferred from changed top-level paths). Commit there. Then run as feature branch. **Never commit to `main`.** |
| Dirty tree, on feature branch | Commit on this branch with generated message. Then run merge-to-main. |
| Detached HEAD | Stop-clean. Tell the user the HEAD SHA and the branches that contain it (`git branch --contains HEAD`). They decide which branch to land on. |
| Untracked file matches `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `*.sqlite`, or size > 50 MB | Do not stage that path. List it in **skipped** with the reason. Stage and commit everything else. |
| `.git/MERGE_HEAD`, `.git/CHERRY_PICK_HEAD`, `.git/BISECT_LOG`, `.git/rebase-merge/`, or `.git/rebase-apply/` exists | Stop-clean. Recovery is `git <op> --abort` and the user chooses. |

If the snapshot doesn't match any row, stop-clean and surface the mismatch.

## Merge to main

1. `git fetch origin`.
2. `git checkout main`.
3. `git pull --ff-only`. If non-FF, stop-clean.
4. `git merge --ff-only <feature>` if possible. Otherwise `git merge --no-ff <feature>` with the default merge message.
5. If the merge conflicts: `git merge --abort` (this is a clean undo, not destructive recovery — it returns to the pre-merge state), then stop-clean.
6. Continue to `phase:push-main`. If the push is rejected (protected branch, non-FF, or any reason): stop-clean. Do not try `gh pr create`; do not retry.

## Commit message generation

When committing dirty state:

- `--message "<text>"` provided → use `<text>` verbatim as subject; body is a one-paragraph summary of `git diff --stat` (top-level dirs touched + net line delta), capped at 8 lines.
- Otherwise → infer a Conventional Commits type from the changed paths:
  - `test:` if all changes are under test paths.
  - `docs:` if all changes are under `docs/` or `*.md`/`*.mdx`.
  - `feat:` if there are new files in source dirs.
  - `fix:` if the diff is net-negative and looks like a regression repair (deletions > additions in non-test code).
  - `refactor:` if additions ≈ deletions across existing files.
  - `chore:` otherwise.
- Subject ≤ 72 chars. Body ≤ 8 lines.
- Last line: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- Strip any token matching `sk-…`, `ghp_…`, `gho_…`, `xox[bpa]-…`, `AKIA…`, or `-----BEGIN` from the message before committing.

## Stop-clean procedure (the only error path)

The pipeline never tries to reason its way through history. When any decision-table row says "stop-clean," when any git command fails, or when anything else looks unexpected:

1. Do not run any further mutating command.
2. If a `merge`/`rebase`/`cherry-pick` is in progress *because of this run*, abort it (`git merge --abort` etc.). Anything not started by this run is left alone.
3. Print the **state report**:
   - current branch and SHA
   - what's on `origin/<branch>` and on `origin/main`
   - the local branches this run created (if any) and their SHAs
   - which phase failed and the exact git output
   - **where every piece of in-flight work currently lives** — local commits not on any remote, staged changes, unstaged changes, untracked files, stashes created by this run (none should exist; if any do, list them)
4. Exit non-zero.

The state report is the contract: from it the user must be able to see exactly what is recoverable from the remote, what only exists locally, and what (if anything) is genuinely gone.

Genuinely-gone cases this pipeline can produce: **none by design.** Every mutating command is either a fast-forward, a clean `--no-ff` merge that we abort on conflict, a `git add` + `git commit` (reversible with `git reset HEAD~` if needed — but we don't do that), a `git push` (additive on the remote), or a branch deletion that only fires after `phase:verify` proved the same commits live on `origin/main`. If `phase:push-main` succeeds but the local `branch -d` in `phase:cleanup` fails, the feature branch still exists locally and the work is on `origin/main` — nothing is lost. If the local delete succeeds but the remote `push --delete` fails, the only artifact left is the dangling `origin/<feature>` reference; closeout reports it under **skipped** and the user prunes it manually.

## Sibling scripts

Two read-only Python scripts live next to this file and back `phase:hygiene` and `phase:sysdoc-gate`. They are runnable standalone for ad-hoc checks (`python3 ~/.claude/skills/shipit/hygiene-check.py --root <repo>`).

### `hygiene-check.py`

Three checks. Exit 1 if any check returns `fail`; warnings do not block.

- **env_drift** — greps source files for env var references (`process.env.X`, `os.environ['X']`, `os.getenv('X')`, etc.), diffs against `.env.example`. Skips if no `.env.example`. Auto-fix is opt-in: pass `--fix-env` to append missing keys with empty values. Block-with-auto-fix-offered semantics: the failure report includes the exact `--fix-env` command; the user runs it and re-ships.
- **readme_commands** — extracts backticked CLI commands from `README.md` (`npm run X`, `make X`, `./script.sh`) and verifies each resolves (script in `package.json`, target in `Makefile`, file exists). Hard block on miss.
- **changelog** — if `CHANGELOG.md` exists but was not touched in this ship's commit range, warn (does not block).

Flags: `--root DIR`, `--fix-env`, `--json`.

### `sysdoc-gate.py`

Two-rule structural change detector. Exit 1 if either rule fires.

- **R6** — ≥2 new non-test, non-shadcn-ui source files (covers JS/TS/Py/Go/Rust/Ruby/Swift/Java/etc.).
- **R7** — any new file under `migrations/`, `prisma/migrations/`, `db/migrate/`, OR any change to `schema.sql` / `schema.prisma`.

Scope: committed changes in `origin/main..HEAD` PLUS uncommitted changes. Falls back to `main..HEAD` if no `origin/main`, else uncommitted-only.

Rule set chosen for high precision (~90% in 2026-05 backtest, 8 repos × 15 commits). Recall ~70%; the monthly `gen-sys-doc` cron is the safety net for missed structural changes. To tune, edit the script and re-backtest before changing the gate semantics in this file.

Flags: `--root DIR`, `--range REV`, `--json`.

## Out of scope

- Concurrency defense (lock files, worktree fallbacks, breadcrumbs). If two ships collide, you'll sort it out by hand.
- History preservation cleverness (rebase-vs-merge selection based on commit authorship). If `main` is diverged, we stop.
- Protected-branch PR auto-merge via `gh`. If the push is refused, we stop and the user opens the PR.
- Pre-commit hook auto-fix retry. If the hook fails, we stop.
- Stale-artifact sweeping. If `ship/*` branches accumulate, the user prunes them.
- Tag creation, release notes, changelog generation.
- Anything touching another repo.
