---
description: Ship the working tree to main — fast git-only pipeline: guard secrets/large files → branch (if on main) → commit → push → merge to main → push main → delete local+remote branch. Fast by default; pass `--check` (or `--full`) to also run the hygiene + sysdoc gates and gen-sys-doc regen. Pass `--prod` (alias `--promote`) to then fast-forward the repo's long-lived deploy branch (default `production`) to main — the deliberate prod gate in staging/production repos. Stops cleanly on anything weird with a precise "where the work is now" report. Fires on `/shipit` and natural-language ship requests ("ship it", "ship this", "ship and merge"). Not for commit-only / push-only / merge-only.
allowed-tools: Bash(git:*), Bash(python3:*)
argument-hint: [branch-if-on-main] [commit-message] [--check] [--prod]
---

# Ship it (fast)

Pre-gathered state (already loaded — don't re-run these before acting):
- Branch: !`git branch --show-current`
- Status: !`git status --short`
- Untracked: !`git ls-files --others --exclude-standard`
- Diff (tracked): !`git rev-parse --verify -q HEAD >/dev/null && git diff HEAD || echo "(no commits yet — initial commit)"`

Args: $ARGUMENTS

Ship the working tree to `main` with the **fewest possible commands**. **Stop immediately and report the exact state if anything fails or looks unexpected — never attempt history recovery; I rebuild from a clear report, I do not reason about conflicts you guessed at.**

## Speed rules
- **Batch** the git pipeline: chain safe sequential steps with `&&` in **one or two Bash calls**, not one call per step.
- The state above is already loaded — do not re-run `status`/`diff`/`branch` before acting.
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
2. Stage per the guard above, then commit. Commit message: use the message arg verbatim as subject, else generate a Conventional Commits message from the diff. Subject ≤ 72 chars. Strip any `sk-…`/`ghp_…`/`gho_…`/`xox[bpa]-…`/`AKIA…`/`-----BEGIN` token from the message. Last line:
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

End the report there. No closing question, no offer of next steps, no asking whether the prompt meant something else or whether a re-sent/duplicate request was intended. If the work was already shipped, say so in one line and stop.
