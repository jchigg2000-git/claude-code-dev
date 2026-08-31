---
description: Move the file most recently generated in this session out of its current location into a shared cross-repo stash under ~/Projects/purgatory/_stash, so it can be picked up from any other repo with /unstash. Offers a chip menu to also persist it long-term to ~/Projects/filing-cabinet, which mirrors the ~/Projects tree. Never stashes source code. Stashes expire nightly. Fire on `/stash` or "stash that file / put that in the filing cabinet."
argument-hint: "[optional path to the file to stash, defaults to the last file generated this session]"
allowed-tools: Bash(mkdir:*), Bash(mv:*), Bash(cp:*), Bash(rm:*), Bash(ls:*), Bash(cat:*), Bash(date:*), Bash(git:*), Bash(basename:*), Bash(file:*), Bash(head:*), Bash(find:*), Bash(grep:*), Bash(rg:*), Bash(stat:*), Bash(printf:*), Bash(jq:*), Bash(bash:*), Read, Write, Glob, Grep, AskUserQuestion
---

# /stash — cross-repo file clipboard

Move a file into a shared store so it can be retrieved from **any** repo with `/unstash`.
This is a clipboard, not an archive: the stash side expires nightly. Long-term keeping is
the explicit second option.

**`/stash` is a move, not a copy.** The file leaves its current location. Two consequences
that shape every rule below:
1. Stashing source code would silently delete part of a working program. Step 3 refuses it
   outright — that gate is not advisory.
2. Stash-only + nightly expiry means the file is gone for good tomorrow. Say so in the
   report so the choice is visible at the moment it's made.

Argument: $ARGUMENTS (optional explicit file path; if empty, infer — see step 2)

## Layout

```
~/Projects/purgatory/_stash/<YYYY-MM-DD>/   # nightly-reaped date partition
    NN__<original-name>                     # NN = zero-padded stash sequence for that day
    manifest.jsonl                          # one JSON line per stash, append-only
~/Projects/filing-cabinet/<repo>/           # optional long-term, mirrors the ~/Projects tree
```

The store is shared with the Codex harness (`~/.codex/prompts/stash.md`) — same paths, same
manifest format, so a file stashed in one harness unstashes in the other. Don't fork the
layout.

### Why `_stash/` is its own subtree — don't "fix" this

`~/Projects/purgatory/` already stages files for the weekly `doc-consolidation` sweep, which
records each one in `purgatory/MANIFEST.tsv` and expires it at 30 days via
`purge_expired.py`. The stash deliberately sits **beside** that, not inside it:

- Stash files are **not** registered in `MANIFEST.tsv`, so `purge_expired.py` never sees
  them. `~/.stash/bin/reap.sh` is what expires them.
- Do not register them there to "unify" the two. `purge_expired.py --days` is global — one
  nightly run at `--days 1` would also delete the doc sweep's 30-day staged docs. Two
  retention policies means two subtrees and two reapers.

## Steps

### 1. Reap first
Run `bash ~/.stash/bin/reap.sh` before anything else. It deletes every `_stash` date
partition older than the cutoff (default: only today survives), so a night the machine slept
still self-heals. Don't report its output unless it errors.

### 2. Identify the file
In priority order:
1. `$ARGUMENTS`, if given — resolve relative to cwd. If it doesn't exist, say so and stop.
2. The file **you** most recently created or wrote in this conversation. Use the actual
   session history, not a guess. Generated reports, docs, diagrams, datasets all count.
3. If this session produced no file, fall back to the newest untracked-or-modified file in
   the current repo (`git status --porcelain` + mtime). Name it in one line before
   proceeding — since this is a move, a wrong pick has to be cheap to catch.
4. If there is still no candidate, say "nothing to stash" and stop. Do not invent one.

### 3. Refuse source code — absolute
Because `/stash` moves, stashing source code deletes it from the program. Never do it —
**not even when the path is named explicitly in `$ARGUMENTS`**. There is no override flag;
if the intent really is to move a source file, that's a `mv` he can run himself.

**Tier 1 — hard refuse on sight.** One line naming the reason, then stop:
- Program-source extensions: `.ts .tsx .js .jsx .mjs .cjs .py .go .rs .swift .java .kt .kts .rb .php .c .h .cc .cpp .hpp .cs .m .mm .scala .ex .exs .erl .lua .pl .r .dart .vue .svelte .astro`
- Build/dependency manifests and lockfiles: `package.json`, `go.mod`, `go.sum`, `Cargo.toml`, `pyproject.toml`, `requirements.txt`, `Gemfile`, `pom.xml`, `*.gradle`, `CMakeLists.txt`, `Dockerfile*`, `Makefile`, `*.lock`, `*-lock.json`, `*.csproj`
- Anything inside `node_modules/`, `vendor/`, `target/`, `dist/`, `build/`, `.venv/`, `.git/`
- Live secret stores: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `auth.json` —
  purgatory and the filing cabinet both sit outside the repo's gitignore
- Extensionless files whose first line is a shebang, or that `file` reports as a script or
  binary executable

**Tier 2 — ambiguous extension, so test before allowing.** `.html .css .scss .sql .sh .json .yml .yaml .toml .xml` are as often generated deliverables as they are source. Refuse if
**either** holds, allow otherwise:
- the file is **tracked by git** (`git ls-files --error-unmatch <file>`) — a tracked file is
  part of the repo, and moving it is a repo mutation wearing a stash costume
- it's **referenced by other files** in the repo (imported, `<script src>`/`<link href>`,
  named in a config or build script) — check with a quick `rg` for its basename

**Everything else is fair game**: untracked generated reports, docs, `.md`, `.pdf`, `.csv`,
`.png`, diagrams, exports, scratch notes. That's what this command is for.

### 4. Determine the origin repo
`git rev-parse --show-toplevel` from the file's directory; use its basename. Not a git
repo → use the basename of the nearest directory under `~/Projects`, else `_loose`.

### 5. Ask where it lands
Present a chip menu with **AskUserQuestion**, stash-only first so ⏎ takes the default:

- header: `Stash`
- question: `Move <filename> out of <repo> — stash only, or also keep it?`
- option 1 (default): **Stash only** — "Reachable from any repo via /unstash. Deleted from here now, and gone entirely tonight."
- option 2: **Also persist** — "Also copies to ~/Projects/filing-cabinet/<repo>/, which survives the nightly reap."

Ask exactly this once. Don't chain follow-up questions about categorization — that's
inferred in step 7, not negotiated.

### 6. Move it into the stash partition (always, both options)
- `mkdir -p ~/Projects/purgatory/_stash/$(date +%Y-%m-%d)`
- Sequence `NN` = (count of existing `NN__*` files in that dir) + 1, zero-padded to 2.
- If persisting, do step 7's cabinet copy **from the source file first**, while it still
  exists. Cabinet copy, then move. Never the other way around.
- **Move it**: `mv` the file into the partition as `NN__<original-name>`.
- **Verify before trusting the delete.** After `mv`, confirm the destination exists and its
  size matches what the source was. If `mv` fails (cross-device, permissions), fall back to
  `cp` → verify size → `rm` the source. If verification fails at any point, **leave the
  source in place**, remove the partial destination, and report the failure. A stash that
  half-happened must never end with the source gone.
- Append one line to that partition's `manifest.jsonl` (this is the stash's own manifest —
  never `purgatory/MANIFEST.tsv`, see the note above):

```json
{"seq":"03","ts":"<ISO8601 local>","original_name":"foo.md","stored_name":"03__foo.md","origin_repo":"my-project","origin_path":"/Users/<you>/Projects/my-project/foo.md","source_removed":true,"persisted":false,"cabinet_path":null,"category":null}
```

`origin_path` records where it was moved from, so `/unstash` can say where it came from.
Write the JSON with a heredoc or `jq -n`, never string-concatenated shell that could break
on quotes in a filename.

### 7. If persisting — infer the category, don't impose one
Destination base: `~/Projects/filing-cabinet/<origin_repo>/`.

Categorization is **emergent**, decided at write time by looking at what's already there:

- Read the existing tree under that repo's cabinet folder (`find ... -maxdepth 2`).
- **If a scheme is already apparent** — the folder has subdirectories and this file clearly
  belongs to one (`reports/`, `specs/`, `diagrams/`, `drafts/`, `data/`…) — file it there.
- **If ≥3 loose files at that level share an obvious category with this one**, that's the
  scheme becoming apparent: create the subfolder, move those siblings into it, and file
  this one there too. Say in one line what you created and what moved.
- **Otherwise file flat** at the repo folder root. Do not invent a taxonomy for file #1.
  A premature `misc/` is worse than a flat folder.

Judge category by what the file *is* (report, spec, diagram, dataset, draft), not by its
filename alone — read enough of it to be right.

Never overwrite in the cabinet. If the name is taken and contents differ, write
`<stem>.<YYYYMMDD-HHMMSS><ext>` and say so. If contents are identical, skip the copy and
say it was already filed.

Then update that manifest line's `persisted`, `cabinet_path`, and `category`.

### 8. Report — 3 lines max
```
moved    foo.md  out of my-project → ~/Projects/purgatory/_stash/2026-07-29/03__foo.md
filed    ~/Projects/filing-cabinet/my-project/reports/foo.md
```
Stash-only runs replace the `filed` line with the expiry warning, because with the source
deleted the stash partition is the only copy left:
```
only copy — expires tonight at 03:15. Re-run and pick "also persist" to keep it.
```
Pick it up anywhere with `/unstash`.
