---
description: Monthly hygiene sweep of ~/.claude/ (or another path) — deletes empty and exact-duplicate command/skill/agent files, consolidates overlapping same-kind command clusters into a single mode-flagged command, backs up everything first, supports --dry-run, and stops on any ambiguity. Preserves command bodies verbatim; never auto-merges ambiguous or cross-kind definitions. Fire on `/harness-audit` or explicit "audit my harness/skills/commands" requests.
allowed-tools: Bash(ls:*), Bash(find:*), Bash(wc:*), Bash(cp:*), Bash(mv:*), Bash(rm:*), Bash(rmdir:*), Bash(grep:*), Bash(rg:*), Bash(date:*), Bash(mkdir:*), Bash(diff:*), Bash(md5:*), Bash(shasum:*), Bash(stat:*), Bash(sort:*), Bash(basename:*), Bash(dirname:*), Bash(pwd:*), Read, Glob, Grep, Write, Edit
argument-hint: [--dry-run] [--here] [path]
---

# Harness audit (monthly)

Clean up the Claude harness: delete **empty** and **exact-duplicate** command/skill/agent files, and **auto-consolidate overlapping same-kind command clusters** into one command with mode flags. Nothing else — never rewrite the body of a working command, never auto-merge ambiguous or cross-kind definitions, never touch arbitrary project markdown.

Apply `/shipit`-style discipline: **if anything is ambiguous or a step produces output you did not predict, stop and confirm before deleting, renaming, or consolidating.** Removing a working command file is a destructive action: state the exact files and the backup path on its own line, never bundled with anything else and never gated on a one-word menu approval. If unsure whether a cluster is truly redundant, it is **Needs review**, not a merge.

## Scope (where it runs)

- Default start directory = `$HOME/.claude` (the harness itself — this is the intended monthly target).
- First non-flag argument in `$ARGUMENTS` overrides the start directory.
- `--here` forces the start directory to the current working directory instead of `~/.claude`.
- Current working directory: !`pwd`
- Resolved harness root: !`ls -d "$HOME/.claude" 2>/dev/null`
- Recurse the **entire tree** from the resolved start directory. **Target only Claude command/skill/agent definition files**, never arbitrary project markdown:
  - files under any `commands/` directory (expected `*.md`),
  - `SKILL.md` files (and their skill directory),
  - files under any `agents/` directory (expected `*.md`),
  - files under any `.claude/` tree that are command/skill/agent definitions.
- Discovered candidates (harness root): !`find "$HOME/.claude" -type d -name node_modules -prune -o \( -path '*/commands/*' -o -name 'SKILL.md' -o -path '*/agents/*' -o -path '*/.claude/*' \) -type f -print 2>/dev/null`
- Discovered candidates (cwd tree, informational): !`find . -type d -name node_modules -prune -o \( -path '*/commands/*' -o -name 'SKILL.md' -o -path '*/agents/*' -o -path '*/.claude/*' \) -type f -print 2>/dev/null`

Re-verify with tools; treat the snapshots above as starting hints only.

## Mode

`$ARGUMENTS`

- Contains `--dry-run` (or `report-only`): do all inventory + duplicate + consolidation analysis and print the full plan/summary, but make **zero** changes and take no backup. Label output as a dry run. **Recommend a `--dry-run` first** before any run that would consolidate, so the plan is seen before durable changes.
- Otherwise: back up (Step 0), then act.

## Step 0 — Backup (skip only in --dry-run)

```
mkdir -p ~/.claude/.harness-audit-backups
cp -R <start-dir> ~/.claude/.harness-audit-backups/tree-<YYYYMMDD-HHMMSS>
```

Use `date +%Y%m%d-%H%M%S`. If the start dir is huge, back up only the matched candidate files, preserving relative paths. Confirm the backup is non-empty before any deletion **or consolidation**. Prune backup folders older than ~90 days at the end (best-effort). If backup fails, **stop**.

## Step 1 — Inventory

Build a table over every candidate file: `path | kind (command/skill/agent) | bytes | content hash | mtime | effective name | proposed action`. Compute the content hash with `shasum` (or `md5`) over the file body. `effective name` = filename without extension, or skill `name:` from frontmatter. Proposed action ∈ {keep, delete-empty, delete-duplicate, consolidate→<target>, needs-review}.

## Step 2 — Delete EMPTY files

Delete a candidate if it is **empty**: zero bytes, only whitespace, or frontmatter with no usable body. Record `path — empty`. If a file is empty **and** malformed (wrong/missing extension, misspelled name), still delete it as empty and note the malformation in the report. If a file looks like an intentional placeholder you are unsure about, **do not delete it** — list under "Needs review."

## Step 3 — Malformed filenames (non-empty)

A **non-empty** file with a wrong/missing extension or an obviously misspelled name is **never auto-renamed** (renaming a command silently breaks its invocation). List it under "Needs review" with the suggested correct name and a one-line reason. Do not act.

## Step 4 — Exact duplicates

Two safe, auto cases:

1. **Identical content**: same content hash across multiple files. Keep exactly one — prefer the copy highest in the tree / most canonical `commands/`·`agents/`·`.claude/` location, oldest by mtime if still ambiguous. Delete the rest.
2. **Same effective name, same kind, identical body** (pure shadow copy): keep the canonical one (same precedence rule); delete the shadows.

Same effective name but **different content** is a conflict, not a duplicate — **do not delete either**; list under "Needs review" with a one-line diff summary. Same name across **different kinds** (command vs skill vs agent) is **never** an exact duplicate — route to Step 5 / Needs review. Never delete the last surviving copy; verify the keeper exists and is non-empty before removing duplicates.

## Step 5 — Consolidate overlapping clusters (auto, guarded)

A **cluster** is two or more **same-kind** command files whose `description:` frontmatter and body indicate clearly redundant or strictly overlapping scope (e.g. several repo-hygiene audits, several frontend-refinement passes). Detect clusters from frontmatter intent + obvious name/scope overlap, not a hardcoded list.

Auto-consolidate a cluster **only when all hold**:

- all members are the **same kind** (command-with-command); a skill or agent in the group is excluded and left as-is,
- there is a clear **primary** (most developed / most recently modified by mtime) to host the merged command,
- every other member's purpose folds cleanly into the primary as a distinct **mode flag**,
- no member is itself ambiguous, half-written, or in active conflict.

To consolidate:

1. Choose the primary; its invocation name is the merged command's name.
2. Build the merged command file: keep the primary's frontmatter (broaden its `description`/`argument-hint` to list the new `--<mode>` flags), then append each non-primary member's **full body verbatim** under a clearly labeled `## Mode: --<name>` section. Bodies are **moved, never rewritten** — content is preserved exactly.
3. Confirm the backup (Step 0) contains every original. Then `rm` the non-primary originals.
4. Report on its own line: `Consolidated {a, b, c} → <primary> (modes: --a --b --c) — originals in <backup path>`.

**Do not auto-consolidate** — route to "Needs review" with a concrete proposed plan — when: members span different kinds (e.g. a `shipit` command vs a `shipit` skill with different bodies), bodies materially conflict, there is no clear primary, or redundancy is uncertain. Recommend, do not execute, in those cases.

Never edit the body of a command except by moving it verbatim into a merged command. Never consolidate the last general-purpose command of its kind out of existence.

## Step 6 — Summary (always, including --dry-run)

Print a tight report — no raw file dumps:

1. **Scope**: resolved start dir, count of candidates by kind.
2. **Deleted (empty)**: each path + `empty` (+ `malformed` note if applicable).
3. **Deleted (duplicate)**: each path + the kept file it duplicated.
4. **Consolidated**: each cluster → primary, the mode flags, and the backup path of the originals.
5. **Kept canonical**: for each duplicate/cluster set, what was kept and why.
6. **Needs review**: malformed non-empty names (with suggested rename), same-name-different-content conflicts, cross-kind same-name conflicts, and proposed-but-not-executed consolidations with a concrete plan.
7. **Backup location** (or "dry run — no changes").
8. One line: monthly cadence; mention `/schedule` or `/loop` to automate if not already.

## Guardrails

- Never rewrite the body of a working command; consolidation only moves bodies verbatim into a labeled mode.
- Never delete the last surviving copy of a command/skill/agent.
- Never auto-merge cross-kind or ambiguous definitions — those are Needs review.
- Removing or relocating a working command is destructive: backup first, state exact files + backup path on their own line, never bundle into a menu, never proceed on a one-word approval when uncertain.
- Backup non-empty or **stop**. Ambiguous or unexpected output → **stop and confirm**.

## Cadence

Designed to run **monthly** and is idempotent — a second run on an already-clean tree scans everything and reports "nothing to do." Do not self-schedule; only suggest it.
