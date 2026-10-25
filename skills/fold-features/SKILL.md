---
name: fold-features
description: Apply the feature-fold scout's newest report to the live harness. Reads
  docs/feature-fold/ on the claude-code-dev branch claude/feature-fold, walks each card with the
  owner, applies approved patches to ~/.claude, checks them, then ships through
  /sync-claude-slash --ship. Runs only when typed as /fold-features.
disable-model-invocation: true
argument-hint: "[--dry-run] [--only FIX,UPGRADE] [<report date>]"
allowed-tools: Bash(git:*), Bash(gh pr list:*), Bash(gh pr view:*), Bash(gh pr close:*), Bash(cp:*), Bash(mkdir:*), Bash(date:*), Bash(python3:*), Bash(node:*), Read, Edit, Write, Glob, Grep, AskUserQuestion, Skill
---

# Fold features

The weekly `feature-fold` cloud task reads the Claude Code changelog and leaves cards and patches
under `docs/feature-fold/` on the mirror's `claude/feature-fold` branch. This skill is the only
way those cards reach `~/.claude`. The one-way rule holds: edit `~/.claude`, never the mirror's
`commands/` or `skills/`; the mirror catches up through `/sync-claude-slash --ship`.

Args: $ARGUMENTS

- `--dry-run` → steps 1 and 3 only: list the unapplied reports and their cards, change nothing.
- `--only FIX,UPGRADE` → walk only cards with those verdicts.
- `<report date>` → that report only, instead of every unapplied one.

## 1. Read

```
git -C ~/Projects/claude-code-dev fetch origin claude/feature-fold
git -C ~/Projects/claude-code-dev show origin/claude/feature-fold:docs/feature-fold/state.json
```

Shell variables don't carry between Bash calls; spell the mirror path out in each one.

Read every report newer than `applied_through` (`git show origin/claude/feature-fold:<path>`;
don't check the branch out). Nothing unapplied → say so in one line and stop. A report that
doesn't parse into cards → stop and say which file; don't guess at its shape.

## 2. Back up

`mkdir -p ~/.claude/backups/fold-<YYYY-MM-DD> && cp -R ~/.claude/skills ~/.claude/commands ~/.claude/backups/fold-<YYYY-MM-DD>/`.
Also save the current `/doctor prompt-audit` output there if the owner has it in this session.

## 3. Walk the cards

In report order (FIX, UPGRADE, ADOPT, RETIRE, WATCH). For each card show the verdict, the quoted
changelog line with its version, the affected files, and the patch diff if there is one. Then ask
with AskUserQuestion, four cards per call: **apply / skip / defer**. WATCH cards are listed, not
asked. `--dry-run` stops after listing.

## 4. Apply patches

From inside `~/.claude`, for each approved card with a patch:

```
git -C ~/Projects/claude-code-dev show origin/claude/feature-fold:<patch path> > /tmp/fold-<card-id>.patch
cd ~/.claude && git apply --check /tmp/fold-<card-id>.patch && git apply /tmp/fold-<card-id>.patch
```

`git apply` works outside a repository; the patch paths are relative to `~/.claude`. Stop on the
first patch that doesn't apply and report where things stand: which cards applied, which didn't,
and the backup path. Don't hand-merge. A patch that no longer applies usually means `~/.claude`
was edited by hand since the scout ran; that's the owner's to resolve.

## 5. Cards without a patch

For approved RETIRE and ADOPT cards, make the edit by hand, one file at a time, and show the diff.
RETIRE never deletes a command or skill: it adds a ROADMAP item for the owner to decide.

## 6. Check

1. Have the owner run `/reload-skills` (commands and skills also reload on edit in recent
   versions; check the skill listing shows the new descriptions).
2. `/doctor prompt-audit` (owner-typed) compared with the saved one, if the owner runs it.
3. Run each changed skill once in its `--dry-run` or read-only mode where it has one.
4. Tests for changed skill scripts, e.g. `python3 ~/.claude/skills/ux-tournament/scripts/test_cost.py`
   and `node --test <skill>/test/*.test.mjs`.
5. Every file under `~/.claude/commands` and `~/.claude/skills` that differs from the backup must
   belong to an applied card. Anything else → stop and report it.

Red at any step → stop, report, leave the backup in place.

## 7. Ship

1. `/sync-claude-slash --ship`.
2. Update `state.json` without touching the mirror's main checkout:
   `git -C ~/Projects/claude-code-dev worktree add /tmp/fold-state origin/claude/feature-fold -B claude/feature-fold`,
   set `applied_through` to the newest applied version there, commit, `git -C /tmp/fold-state push`,
   then `git -C ~/Projects/claude-code-dev worktree remove /tmp/fold-state`.
3. On `main` (through `/shipit`): add a `CLAUDE-ORIGIN` ROADMAP item for every deferred card.
4. Close the draft PR with a comment listing applied, skipped and deferred cards
   (`gh pr close <n> --comment …`). The next scout run opens a fresh one.

## 8. Pricing PR

If a `feature-fold/pricing-*` PR is open on `claude-code-log`, show it and ask whether to review
it now with `/code-review` on that PR. Never merge it from here.

## Report

Under ten lines: version range folded, cards applied / skipped / deferred, checks run and their
result, the ship SHA, and anything left for the owner.
