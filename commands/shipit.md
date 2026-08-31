---
description: Ship the working tree to main — fast git-only pipeline: guard secrets/large files → branch (if on main) → commit → push → merge to main → push main → delete local+remote branch. Fast by default; pass `--check` (or `--full`) to also run the hygiene + sysdoc gates and gen-sys-doc regen. Pass `--prod` (alias `--promote`) to then fast-forward the repo's long-lived deploy branch (default `production`) to main — the deliberate prod gate in staging/production repos. Stops cleanly on anything weird with a precise "where the work is now" report. Fires on `/shipit` and natural-language ship requests ("ship it", "ship this", "ship and merge"). Not for commit-only / push-only / merge-only.
allowed-tools: Bash(git:*), Bash(python3:*)
argument-hint: [branch-if-on-main] [commit-message] [--check] [--prod]
---

# Ship it (fast)

Pre-gathered state (already loaded — don't re-run these before acting):
- Repo root: !`git rev-parse --show-toplevel 2>/dev/null || echo "NOT-A-REPO"`
- Branch: !`git branch --show-current 2>/dev/null`
- Status: !`git status --short 2>/dev/null`
- Untracked: !`git ls-files --others --exclude-standard 2>/dev/null`
- Diff (tracked, **stat only**): !`git rev-parse --verify -q HEAD >/dev/null 2>&1 && git diff HEAD --stat || echo "(no commits yet — initial commit, or not a repo)"`

**If "Repo root" above is `NOT-A-REPO`**, the pre-gather ran outside a git repo — this happens
whenever the session or subagent cwd is a parent directory like `~/Projects` rather than the
target repo. Do **not** stop. The pre-gathered state is simply empty, so ignore it and re-gather
explicitly against the intended repo with `git -C <repo> ...` for every step of the pipeline
below. Everything else in this command applies unchanged.

Args: $ARGUMENTS

Ship the working tree to `main` with the **fewest possible commands**. **Stop immediately and report the exact state if anything fails or looks unexpected — never attempt history recovery; I rebuild from a clear report, I do not reason about conflicts you guessed at.**

## Speed rules
- **Batch** the git pipeline: chain safe sequential steps with `&&` in **one or two Bash calls**, not one call per step.
- The state above is already loaded — do not re-run `status`/`branch`/`diff --stat` before acting.
- The diff is **stat-only by design**: the full working-tree diff was the single largest thing this
  command injected, and nothing in the pipeline needs it. The guard reads Status + Untracked, mode
  detection reads Branch, and branch naming reads the changed paths. Pull real hunks only in the one
  narrow case named in pipeline step 2, and only for the paths that need them.
- The hygiene + sysdoc gates are **OFF by default** — they're the slow part. Run them only if `--check` or `--full` is in the args (see *Optional gates*).

## Pre-flight (no Bash — just read the state above)
1. **Nothing to ship:** Status clean AND no untracked → **first check whether the branch is AHEAD of its upstream** (first line of `git status -sb`, or `git log @{u}..HEAD --oneline`). A clean tree does not mean nothing to ship: work committed in an earlier turn or an earlier session sits on the local branch until it is pushed, and answering "nothing to ship" there is a false report of where the work lives.
   - **Ahead, not diverged** (no `behind`) → **push-only run**: `git push`, then verify and report. On `main` that is the entire job — do not create a branch to carry commits that are already on `main`, and skip pipeline steps 1, 4, 5 and 7.
   - **Ahead *and* behind** (diverged) → stop-clean per rule 4.
   - **Level with upstream, nothing staged, nothing untracked** → stop: "nothing to ship." **Unless `--prod`/`--promote` is in the args** — then this is a promote-only run: skip the whole pipeline below and go straight to *Promotion*. (Promoting work that landed on `main` in an earlier session is the common case; requiring a dummy commit to reach the gate would be absurd.)
2. **Mode:**
   - **Unborn mode** (Diff line says "no commits yet"): there is no `main` to branch from or merge into — the first commit *creates* it. Commit directly on the current branch and `git push -u origin HEAD`. Skip steps 1, 4, 5, 6 of the pipeline entirely. This is the one case where committing on `main` is correct.
   - **Main mode** (branch is `main`): first non-flag arg = new branch name (else infer a short kebab name from the diff); remaining non-flag args = commit message. **Never commit on `main`.**
   - **Feature mode** (any other branch): skip branch creation; all non-flag args = commit message. Note the branch name now — needed for merge + delete.
3. **Secret / large-file guard (free — inspect the Status + Untracked lists above):** flag any path matching `.env*` (but `.env.example` is fine), `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `*.sqlite`, or obviously huge (>50 MB).
   - **None match** (normal case): `git add -A` is fine.
   - **Any match:** do **not** `git add -A`. Stage only the safe paths and list the skipped ones in the report. This guard is the whole reason this command is safe to run fast — do not skip it.
4. **Weird git state → stop-clean** (don't ship): detached HEAD, or an in-progress op (`.git/MERGE_HEAD`, `CHERRY_PICK_HEAD`, `BISECT_LOG`, `rebase-merge/`, `rebase-apply/`), or `main` diverged from `origin/main`. Report where the work is; let me choose.

## Optional gates (only if `--check`/`--full` in args)
- `python3 ~/.claude/skills/shipit/hygiene-check.py --root "$(git rev-parse --show-toplevel)"` — exit 1 → stop, surface its output (it prints the failures + an auto-fix command for env drift; don't auto-apply).
- `python3 ~/.claude/skills/shipit/sysdoc-gate.py --root "$(git rev-parse --show-toplevel)"` — exit 1 → the change is structural; run `/gen-sys-doc --no-pdf`, then include the regenerated doc in the commit.

## Pipeline (chain into ~1–2 Bash calls)
1. Main mode only: `git checkout -b <branch>`.
2. Stage per the guard above, then commit. Commit message: use the message arg verbatim as subject.
   **Only if no message arg was given**, author a Conventional Commits message from the stat — and only
   if the stat is too vague to name the change, fold
   `git diff HEAD --unified=0 -- <the 1–3 most substantive paths, never lockfiles or generated files>`
   into the Bash call you are already making. Never re-request the full `git diff HEAD`. Subject ≤ 72 chars. Strip any `sk-…`/`ghp_…`/`gho_…`/`xox[bpa]-…`/`AKIA…`/`-----BEGIN` token from the message. Last line:
   `Co-Authored-By: Claude <noreply@anthropic.com>`
   If a pre-commit hook modifies files, re-stage and retry the commit **once**.
3. `git push -u origin HEAD`
4. `git checkout main && git pull --ff-only`  *(non-FF → stop-clean)*
5. `git merge --ff-only <branch> || git merge --no-ff <branch>`  *(conflict → `git merge --abort`, stay on main, stop-clean)*
6. `git push`  *(rejected/protected → stop-clean; do not open a PR, do not retry)*
7. **Verify then delete:** confirm `<tip-sha>` is on `origin/main` (`git merge-base --is-ancestor <tip> origin/main`), then `git branch -d <branch> && git push origin --delete <branch>`. Remote-delete failure → report under **skipped** and continue (work is already on `origin/main`).

## Promotion (only if `--prod` / `--promote` in args)

**`--prod` and `--promote` are the same flag.** `--prod` is the primary spelling.

Some repos deploy `main` to a **staging** environment and a long-lived **deploy branch** to production, so that promoting to the live site is a deliberate act rather than a side effect of shipping. `--prod` performs that promotion after the pipeline above lands on `main`.

**The deploy branch is permanent infrastructure — it is a deploy trigger, not a feature branch.** It is never deleted, and step 7's delete never applies to it.

**Never check out the deploy branch.** The whole promotion is one server-side refspec push, so the working tree stays on `main` the entire time and no local deploy branch is ever created. A local `production` is pure liability — it goes stale, and it is something to accidentally commit onto.

1. **Resolve the branch:** the arg after `--prod`/`--promote` if given, else `production`. Confirm it exists on the remote (`git ls-remote --exit-code --heads origin <deploy-branch>`). **Missing → stop-clean**, report "no `<deploy-branch>` branch on origin — this repo does not use the promotion topology"; do **not** create it (creating a deploy branch wires up a live environment and is never a side effect of shipping).
2. `git fetch origin`
3. **Nothing to promote** (`origin/<deploy-branch>` already equals `origin/main`) → say so in one line, skip to the report.
4. `git push origin origin/main:<deploy-branch>`
   - **Push `origin/main`, never local `main`.** Post-fetch, that is exactly the commit CI proved green and staging deployed. Local `main` can be ahead of it, and promoting an unverified commit is the one thing this gate exists to prevent.
   - **Fast-forward is enforced by git itself** — a non-FF push is rejected without `--force`. No `--ff-only` flag is needed and no merge commit is ever created, so the promoted SHA is identical to the one already checked green and the CI-gated platform reuses that result instead of re-running.
   - **Rejection means the deploy branch has commits `main` does not** — a hotfix landed directly on production. **Stop-clean**: report it and say `main` has to absorb them first. Never `--force`, never resolve it here.
5. **Clean up any pre-existing local deploy branch:** if `git branch --list <deploy-branch>` is non-empty, `git branch -d <deploy-branch>` (safe delete; it will refuse if it holds unmerged work, which is itself worth reporting). Nothing in this flow creates one, but an older session or a manual promotion may have left one behind.

In the report, add a **promoted** bucket: deploy branch name, the SHA now on it, and — if the platform gates on CI — that the deploy is queued behind that commit's checks rather than already live. Never claim the promotion is deployed; this command only moves git refs.

## Hard nevers
`--no-verify`, `--force` / `--force-with-lease`, `reset --hard`, `clean -fd`, `checkout .`, `branch -D`, any `-i` flag. Single attempt per command (the one exception is the pre-commit-hook re-stage in step 2). **Never delete, force-push, or create the promotion deploy branch.**

## Report
Branch name, commit SHA, what landed on `origin/main`, and buckets: **done / skipped** (secret-guarded files, remote-prune failures) **/ stop-clean** (exact state, where every piece of work lives). State whether the optional gates ran.

End the report there. No closing question, no offer of next steps, no asking whether the prompt meant
something else or whether a re-sent/duplicate request was intended. If the work was already shipped, say
so in one line.

### "End the report" means stop talking — not stop working

This command gets used two ways, and the difference decides what happens after the report:

- **Terminal ship** — shipping *was* the task. The report is the last thing in the turn; yield.
- **Checkpoint ship** — the ship happened *inside* work that is still in flight: an autonomous loop,
  `/unleash`, or a multi-phase build that ships each phase as it lands. Here the report is a by-product
  emitted in passing. Print it, then **immediately resume the work that was already underway** — same
  turn, no handoff. Do not narrate what was just shipped beyond the report, do not preview what is next,
  do not ask which thing to pick up.

**Default to checkpoint whenever there is unfinished work in flight** — an open todo list, a stated
multi-phase plan, or a standing instruction to keep going. A ship is a git operation, not a permission
gate and not a stopping point. Treating a mid-build checkpoint as terminal is the actual failure mode
here: four ships in one 46-minute build is normal use, and each one handing the session back is friction
the command is supposed to remove.
