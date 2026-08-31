---
description: Sync the claude-code-dev mirror repo's `commands/` and `skills/` against the live harness at `~/.claude/`. Runs from anywhere — auto-locates `~/Projects/claude-code-dev` and ignores CWD. Phase 1 auto-updates files that already exist in both. Phase 2 lists new harness files in one batch; you answer with comma-delimited numbers/names (or `all`/`none`). Read-only against `~/.claude/`; writes only to the mirror repo; never commits by default — pass `--ship` to also commit/push/merge the synced changes to the mirror's `main` via the shipit pipeline (cwd-independent). Fire on `/sync-claude-slash` or "sync slash commands from harness."
allowed-tools: Bash(diff:*), Bash(cp:*), Bash(ls:*), Bash(find:*), Bash(test:*), Bash(comm:*), Bash(basename:*), Bash(dirname:*), Bash(pwd:*), Bash(mkdir:*), Bash(sort:*), Bash(git:*), Read, Glob, Write, Edit
---

# sync-claude-slash

Sync the local version-controlled mirror of the Claude harness (the `claude-code-dev` repo's `commands/` and `skills/` directories) with the live harness at `~/.claude/`. **Never commits by default** — either run `/shipit` from the mirror afterward, or pass `--ship` to this command to commit + ship the synced changes to the mirror's `main` in one step (see Phase 3).

This skill operates on a fixed mirror path and ignores the current working directory. Invoke it from any repo.

## Flags

- `--ship` → after syncing, run the shipit pipeline **on the mirror repo** (`$HOME/Projects/claude-code-dev`), NOT the CWD: commit the synced files, ff-merge to `main`, push, clean up (Phase 3). This is the one sanctioned cross-repo ship — the harness mirror — for the common "I tuned a command live from inside another project, now version it" flow. Default (no flag): sync only, leave the mirror dirty for a manual `/shipit`.

## Pre-flight

- **Mirror path:** `MIRROR="$HOME/Projects/claude-code-dev"`.
- Verify `$MIRROR` exists. If not, stop and report: `mirror repo not found at $MIRROR.`
- Verify both `$MIRROR/commands/` and `$MIRROR/skills/` exist. If either is missing, stop — wrong path or repo layout changed.
- Verify `~/.claude/commands/` and `~/.claude/skills/` exist. If neither, stop — nothing to sync from.
- Print one line: `Syncing $MIRROR/{commands,skills} against ~/.claude/ (invoked from <CWD>).`

All file operations below target `$MIRROR/commands/` and `$MIRROR/skills/`, never the CWD.

## Phase 1 — Update existing files (automatic, no prompts)

For each file in `$MIRROR/commands/*.md`:

1. Check if `~/.claude/commands/<name>.md` exists.
   - **Yes + identical:** skip silently (don't report).
   - **Yes + differs:** copy the harness version over the mirror version. Report one line: `updated commands/<name>.md` plus a tag — `(description only)` if only the YAML `description:` field changed, otherwise `(body changed)`.
   - **No:** report `commands/<name>.md: repo-only (not in harness, kept as-is)`.

For each `$MIRROR/skills/<name>/SKILL.md`:

- Same logic against `~/.claude/skills/<name>/SKILL.md`.

Do not touch anything outside `$MIRROR/commands/` and `$MIRROR/skills/`. Do not write to `~/.claude/` at any point.

## Phase 2 — Offer new harness files (batched)

After Phase 1, compute:

- **New commands:** files in `~/.claude/commands/` whose names are NOT in `$MIRROR/commands/`.
- **New skills:** subdirectories of `~/.claude/skills/` whose names are NOT in `$MIRROR/skills/`.

If both lists are empty, report `no new harness files to consider` and proceed to closeout.

Otherwise, present **one** numbered list (commands first, then skills, alphabetical within each group):

```
  1. <name> [command|skill] — <first ~120 chars of description>
  2. ...
```

Then ask **one** question:

> Enter comma-delimited numbers and/or names to add (e.g. `1,3,5` or `foo,bar,7`). Use `all` to add every candidate, `none` (or empty) to skip all:

Parse the response:
- `all` (case-insensitive) → add every candidate.
- `none` or empty → skip everything; go to closeout.
- Mixed comma-delimited tokens → take the union of resolved items; strip whitespace; tolerate trailing commas and duplicates.
- Unknown number/name → report `unknown: <token>` and skip just that token; continue with the rest. Do not abort.

For each selected item:
- Command: copy `~/.claude/commands/<name>.md` → `$MIRROR/commands/<name>.md`. Report `added commands/<name>.md`.
- Skill: `mkdir -p $MIRROR/skills/<name>/`, then `cp -R ~/.claude/skills/<name>/. $MIRROR/skills/<name>/` (whole directory tree — SKILL.md plus any sibling files). Report `added skills/<name>/`.

For each unselected candidate, report `skipped <name>`.

## Phase 2.5 — Provenance gate (always, never skipped)

The harness is not only where the user's own work lives — it is also where *vendor* skills land. A plugin or CLI install can drop a whole third-party skill tree into `~/.claude/skills/`, and Phase 2 will happily offer it as a "new skill." The mirror is published as first-party MIT work, so that content must not reach it. This is the failure mode the provenance gate exists to stop.

Run the mirror's own gate over everything Phases 1–2 wrote:

```
python3 "$MIRROR/scripts/provenance-gate.py" --paths <each updated/added path>
```

- **Exit 0** → continue to closeout (or Phase 3 if `--ship`).
- **Exit 1** → the gate found content that doesn't look first-party. **Revert exactly what this run wrote for the blocked paths** (`git -C "$MIRROR" checkout -- <path>` for a Phase 1 update; `rm -rf` the directory or file for a Phase 2 addition), then report each blocked path with the rule that fired. Do **not** attest on the user's behalf, do **not** add an exceptions line, and do **not** pass `--no-verify` downstream. Attestation is the user's judgment, not this command's — surface the finding and let them decide.
- **Exit 2** → the gate is misconfigured (missing/empty `.provenance/first-party.txt`). Report it and stop before committing anything.

Warnings (`fat-skill-tree`, `unreviewed-install-hint`) do not block, but pass them through to the closeout verbatim — a fat new skill directory is the single strongest signal that something was vendored.

If the gate script is absent from `$MIRROR/scripts/`, say so plainly and treat Phase 2 additions as unverified in the closeout. Never silently skip this phase.

## Phase 3 — Ship the mirror (only if `--ship`)

Without `--ship`, skip this entirely (sync only). With `--ship`, commit and merge the synced changes to the mirror's `main` by running the shipit pipeline **against `$MIRROR`, never the CWD** — use `git -C "$MIRROR"` for every git call. This is the one sanctioned cross-repo ship.

Inherit shipit's hard invariants: single attempt per mutating command; never `--force`/`--no-verify`/`reset --hard`/`branch -D`/any `-i`; never delete a branch until the feature tip is confirmed on `origin/main`. On any conflict, non-FF, detached HEAD, in-progress merge/rebase, or anything unexpected → **stop-clean**: abort only what this run started (`git -C "$MIRROR" merge --abort`), report exactly where the work lives (it is safe — in the mirror's working tree and/or the `ship/...` branch), and stop. Do not retry.

**Curation safety:** only commit files under `commands/` and `skills/` that Phase 1 updated or Phase 2 added — stage those explicit paths, never `git add -A`. A live-only file you didn't sync cannot be published by `--ship`.

Steps:
1. `git -C "$MIRROR" status --porcelain -- commands skills` — if empty, report `nothing to ship` and go to closeout.
2. `git -C "$MIRROR" fetch origin`. Confirm on `main` and FF-able: behind → `pull --ff-only`; not on `main`, diverged, or non-FF → stop-clean.
3. `SHA=$(git -C "$MIRROR" rev-parse --short HEAD)`; `git -C "$MIRROR" checkout -b "ship/harness-sync-$SHA"`.
4. Stage only the synced paths: `git -C "$MIRROR" add -- <each updated/added commands/… and skills/… path from Phases 1–2>`.
5. Commit. Subject: `docs: sync harness commands/skills to mirror` (≤72 chars). Body: bulleted list of the updated/added files. Strip any `sk-…`/`ghp_…`/`AKIA…`/`-----BEGIN`-style token from the message. Final line: `Co-Authored-By: Claude <noreply@anthropic.com>`.
6. `git -C "$MIRROR" push -u origin HEAD`.
7. `git -C "$MIRROR" checkout main && git -C "$MIRROR" pull --ff-only && git -C "$MIRROR" merge --ff-only "ship/harness-sync-$SHA"` (if not FF-able, `merge --no-ff` with the default message; on conflict → `merge --abort` + stop-clean).
8. `git -C "$MIRROR" push`.
9. Verify: `git -C "$MIRROR" fetch origin && git -C "$MIRROR" merge-base --is-ancestor <feature-tip-sha> origin/main` — if false, stop-clean.
10. Cleanup (only after verify): `git -C "$MIRROR" branch -d "ship/harness-sync-$SHA"`, then `git -C "$MIRROR" push origin --delete "ship/harness-sync-$SHA"`. Single attempt each; a failed remote-delete is reported under **skipped**, not fatal.

## Closeout

Print a short summary:

- **Updated:** count + names from Phase 1.
- **Added:** count + names from Phase 2.
- **Skipped:** count + names from Phase 2 declines.
- **Repo-only:** count from Phase 1 (mirror files with no harness counterpart).

Final line:
- If `--ship` ran: report the result — `Shipped to claude-code-dev main (<sha>); ship branch cleaned up.` (or, if Phase 3 stopped-clean, the state report telling the user exactly where the work lives).
- Otherwise (sync only), computed via `git -C "$MIRROR" status --short | wc -l`: `Mirror repo has N modified/new files. Run /sync-claude-slash --ship (or cd $MIRROR && /shipit) when ready.`

## Rules

- **Read-only on `~/.claude/`.** Never writes to the live harness.
- **Ignores CWD.** Never writes outside `$MIRROR`. CWD is only used for the "invoked from" line.
- **No commits by default** — leave the mirror dirty for the user. Only `--ship` (Phase 3) commits, and only the synced `commands/`/`skills/` paths, via the shipit pipeline run against `$MIRROR` (never the CWD).
- **Stop on the unexpected** — missing directories, permission errors, or anything ambiguous. Don't guess.
- **Do not touch `agents/` or other top-level dirs** unless explicitly extended in a future revision.
- **Never attest.** Phase 2.5 can revert what this run wrote, but only the user may add a path to `.provenance/first-party.txt` or a line to `.provenance/exceptions.txt`. A sync command that can approve its own output is not a gate.
- **The mirror's pre-commit hook is the backstop, not the primary defense.** Phase 2.5 exists so a vendor tree never lands in the working tree at all; the hook exists because this command's own text gets overwritten by the next sync.
