---
name: wip-reconciler
description: >-
  Sweep the N most-recently-worked git repos under a root for DROPPED / AT-RISK
  work — uncommitted changes, stashes, unpushed-ahead branches, and local-only
  branches carrying unique commits — so loose ends left by non-linear work stop
  silently risking loss. One repo per iteration, state in a ledger that survives
  fresh contexts and resumes cleanly. REPORT-ONLY: it never commits, pushes, or
  stashes — the deliverable is the surfaced loose end plus exact recovery commands.
  Fire on "/wip-reconciler", "find my work at risk", "which repos have
  unpushed/uncommitted work", or a self-paced /loop that wants per-repo at-risk-work
  triage. Follows the autonomous-sweep-core contract.
---

# WIP reconciler (at-risk git work — ledger-driven /loop)

Finds work that exists **only locally** across your top-N repos and hands you the recovery
commands. You work non-linearly and leave loose ends — uncommitted edits, stashes, and unpushed
branches accumulate and quietly risk loss. This surfaces them; it never touches them. All loop
shape, ledger mechanics, ranking, resume, and the never-destructive rules are **inherited from
`autonomous-sweep-core` — read that; this file only specifies the detector.**

## UNIT
One repo per iteration (the core default).

## DETECT — the at-risk gate (read-only, per repo)
Run inline, all `git -C <repo>`:
- **(a) uncommitted / untracked:** `git status --porcelain=v1` → any output = dirty tree.
- **(b) stashes:** `git stash list` → each entry is work parked off-tree.
- **(c) branches ahead of upstream:** `git for-each-ref --format='%(refname:short) %(upstream:short) %(upstream:track)' refs/heads` → flag any showing `[ahead N]`, and any with **no upstream at all**.
- **(d) local-only branches with unique commits:** `git log --branches --not --remotes --oneline` → commits that live on no remote.
- **(e) extra worktrees:** `git worktree list` → each is a second tree that can hide its own dirty/ahead state.
- **(f) recency:** most-recent-commit age (`git -C <repo> log -1 --format=%cr`) — context for how stale the at-risk work is.

**The gate — "actually at risk":** work that exists ONLY locally — uncommitted, stashed,
ahead-of-remote, or an unpushed branch holding unique commits. Distinguish:
- **at risk** → route to report (write recovery commands + risk tier).
- **not at risk / clean** → a clean tree fully in sync with its remote. Log "clean", no-op.
- **point-in-time / intentional** → an experiment branch the user clearly abandoned that lives
  only locally. Flag it once so it's visible; **don't nag** — abandonment is a choice, not a defect.

Extra worktrees (e): recurse the detector into each — a worktree can carry dirty or ahead state
the main tree doesn't show.

## FIX — REPORT-ONLY
This sweep **never** commits, pushes, or stashes — doing so would violate the core's hard rules and
could push half-done work outward. Per at-risk repo, write into the ledger:
- The **exact recovery commands** the user can run, filled in for this repo — e.g.
  `git push -u origin <branch>` for an unpushed branch, `git stash show -p stash@{0}` to inspect a
  stash before deciding, `git status` / `git diff` for a dirty tree.
- A **risk tier:** `uncommitted-only` = low · `unpushed-commits` = medium · `unpushed-AND-behind`
  (ahead *and* behind remote) = **merge-risk** (a plain push will be rejected; needs rebase/merge).

**Surfacing the loose end IS the deliverable** — this is the tool arm of your "never silently drop
a thread" working agreement. The report makes the dropped thread re-findable; the user decides.

## SKIP
Never run `git push`, `git commit`, `git stash drop` / `pop` / `apply`, `git merge`, or
`git rebase`; never delete or move a branch or worktree; never `git add` or `git checkout`/`restore`.
**Never touch the working tree at all** — every command above is read-only inspection.

## LEDGER COLUMNS
`uncommitted | stashes | unpushed-branches | ahead/behind | risk-tier | note`

## Domain-lessons (real catches / traps)
- A branch that is **ahead AND behind** its remote is a rebase/merge hazard, not a clean push —
  tier it `merge-risk` and flag it louder; a naive `git push` will bounce.
- You have a known real case: **~6 repos carrying unpushed `harden-llm-errors` branches**. This
  sweep is exactly what catches that class — unpushed branches with unique commits that fell off
  the radar. Expect it to re-surface them until they're pushed or deliberately dropped.
- An untracked file matching **`.gitignore` intent** (build output, `dist/`, `.env.local`, logs,
  coverage) is **not lost work** — it's regenerable artifact. Don't count generated cruft as
  at-risk; if `git status` shows only ignored-class noise, the tree is effectively clean.
- **A stash is invisible in `git status`** — it's the classic silent loss (parked "for a minute,"
  then buried under a branch switch). Always list stashes even when the tree looks clean.
- **A dirty extra worktree hides from the main checkout** — the main tree can read clean while a
  sibling worktree holds hours of uncommitted work. Descend into every `git worktree list` entry.
