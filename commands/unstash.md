---
description: Retrieve the file most recently put in the shared stash by /stash and drop it in the root of the current repo. Pulls only from the most recent stash partition under ~/Projects/purgatory/_stash; if that partition is gone (nightly expiry), reports that and stops. Fire on `/unstash` or "grab what I stashed / unstash that file."
argument-hint: "(no arguments — always the most recent stash)"
allowed-tools: Bash(ls:*), Bash(cat:*), Bash(cp:*), Bash(date:*), Bash(git:*), Bash(find:*), Bash(basename:*), Bash(stat:*), Bash(bash:*), Bash(jq:*), Read, Write
---

# /unstash — pick up the last stashed file here

The other half of `/stash`. Drops the most recently stashed file into the **root of the
current repo**, whichever repo that is. That's the point: stash in one repo, unstash in
another.

`/stash` **moved** the file out of its origin, so until tonight's reap the stash partition
holds the only copy of anything that wasn't also persisted. Retrieval therefore **copies
and never consumes** — the stash stays in place, so `/unstash` is repeatable and a failed
paste can't lose the file.

Store: `~/Projects/purgatory/_stash/<YYYY-MM-DD>/`. This is the stash's own subtree, tracked
by its own `manifest.jsonl` — unrelated to `purgatory/MANIFEST.tsv`, which belongs to the
weekly `doc-consolidation` sweep. Never read stash state from that TSV.

## Steps

### 1. Reap first
Run `bash ~/.stash/bin/reap.sh`. It removes every `_stash` date partition older than the
cutoff. Doing this first is what makes the expiry honest — an expired stash must not be
retrievable just because the machine slept through 03:15.

### 2. Find the most recent stash
- `ls -1d ~/Projects/purgatory/_stash/*/ 2>/dev/null | sort | tail -1` → the newest date
  partition.
- **Only** that partition. Never fall back to an older one, never merge across days.
- Within it, the most recent stash is the **last line of `manifest.jsonl`**. Use the
  manifest as the source of truth, not file mtimes.

### 3. Nothing there → say so and stop
Report plainly and stop. No searching the filing cabinet, no offering alternatives, no
reconstructing from elsewhere — an empty stash is a complete answer:

- No `~/Projects/purgatory/_stash/` at all → `no stash store — nothing has been stashed yet`
- Store exists but no date partitions → `stash is empty — last night's stashes expired`
- Partition exists but `manifest.jsonl` is missing or empty → `stash partition <date> has no recorded stashes`

If the manifest's last entry has `"persisted": true`, add exactly one line naming its
`cabinet_path` so the file is still findable. Don't copy it — that's not what was asked.

### 4. Determine the destination
`git rev-parse --show-toplevel` from cwd → repo root. Not a git repo → use cwd, and say
which directory you used.

### 5. Copy it in
- Restore under the manifest's `original_name`, not the `NN__`-prefixed stored name.
- **Copy**, don't move — see the note at the top. The stash stays retrievable until
  tonight, so `/unstash` works across several repos and survives a bad paste.
- Target exists already:
  - identical contents → skip the copy, report `already present, unchanged`
  - different contents → write `<stem>.unstashed-<HHMMSS><ext>` and say so. Never
    clobber a file in the repo.

### 6. Report — 1–2 lines
```
unstashed  foo.md → ~/Projects/other-repo/foo.md
from       ~/Projects/purgatory/_stash/2026-07-29/  (moved out of my-project at 18:42)
```
Use the manifest's `origin_path` for that second line — it's the only record of where the
file used to live, since `/stash` removed it from there.
