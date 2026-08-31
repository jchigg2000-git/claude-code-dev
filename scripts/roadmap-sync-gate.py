#!/usr/bin/env python3
# CLAUDE-ORIGIN: authored by Claude, ported 2026-08-19 from
# the roadmap-sync rule described in commands/roadmap.md ("The sync gate").
"""The sync gate — fail when tracked source changed and ROADMAP.md did not.

`CLAUDE.md` names ROADMAP.md the single source of truth for execution, and that held only as
well as whoever was working remembered it. The owner, 2026-08-19, verbatim: *"Is roadmap
updated? Is that part of your standard operating procedure so I can quit asking?"* — the answer
to the second can only be a check, because a rule enforced by diligence is a rule someone has
to keep asking about.

Three design decisions, each of which looks like a weakness and is the reason the gate survives
instead of being deleted in a hurry three weeks in:

1. It fires only on a DIRTY tree. A clean checkout, a docs-only change, or no git at all pass
   silently. It catches the moment a unit of work is being finished — the only moment the
   roadmap is cheap to write.
2. The opt-out is deliberate and is printed in the failure text. Mid-unit runs are ordinary and
   punishing them would get this deleted rather than obeyed. Typing the variable is a choice;
   forgetting the roadmap is not.
3. SOURCE_ROOTS is a deliberate subset. `commands/` and `skills/` are NOT in it: this repo is a
   one-way mirror of `~/.claude/` (see CLAUDE.md), so a change there is a sync of content
   authored elsewhere, not a unit of work this roadmap tracks. Only the repo's own first-party
   tooling counts.

Standalone:  python3 scripts/roadmap-sync-gate.py
Skip:        CCDEV_SKIP_ROADMAP_SYNC=1 <whatever runs it>
"""

import os
import subprocess
import sys

DOC = "ROADMAP.md"
SKIP_ENV = "CCDEV_SKIP_ROADMAP_SYNC"

# The trees where a change means a unit of work happened in THIS repo. Deliberately excludes
# commands/ and skills/ (mirrored from ~/.claude/, one-way) and docs/ (reference, not work).
SOURCE_ROOTS = ("scripts", "mcp-servers", "githooks")

MAX_SHOWN = 4


def changed_paths():
    """Paths from `git status --porcelain`, with rename destinations resolved."""
    try:
        out = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return None  # no git, no worktree, nothing to say

    paths = []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        # `XY path` and, for renames, `XY old -> new`. The destination is what matters.
        p = line[2:].strip()
        i = p.rfind(" -> ")
        if i >= 0:
            p = p[i + 4:]
        paths.append(p.strip('"'))
    return paths


def check():
    """Return the problem text, or None when there is none."""
    if os.environ.get(SKIP_ENV):
        return None

    paths = changed_paths()
    if paths is None:
        return None

    touched = []
    doc_touched = False
    for p in paths:
        if p == DOC:
            doc_touched = True
            continue
        if p.replace(os.sep, "/").split("/", 1)[0] in SOURCE_ROOTS:
            touched.append(p)

    if doc_touched or not touched:
        return None

    shown = touched[:MAX_SHOWN]
    if len(touched) > MAX_SHOWN:
        shown = shown + ["… and %d more" % (len(touched) - MAX_SHOWN)]

    return (
        "%d source file(s) changed and %s did not — %s.\n"
        "          A finished unit of work replaces §0's '▶ RESUME HERE' block and deletes\n"
        "          what it closed. If this is a mid-unit run rather than a finished one, run it\n"
        "          again with %s=1."
        % (len(touched), DOC, ", ".join(shown), SKIP_ENV)
    )


def main():
    problem = check()
    if problem:
        sys.stderr.write("ROADMAP SYNC GATE: FAILED\n\n  " + problem + "\n\n")
        return 1
    if "--quiet" not in sys.argv:
        print("ROADMAP SYNC GATE: PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
