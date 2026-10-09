#!/usr/bin/env python3
"""Sys-doc regeneration gate for shipit (rules R6 + R7).

Decides whether a ship represents a structural change worth regenerating
the system design doc for. Derived from the 2026-05 backtest: this two-rule
set hit ~90% precision on a sample of 112 commits across 8 repos and is
the high-precision starter set.

  R6: >= 2 new non-test, non-shadcn-ui source files
  R7: any new file under migrations/, prisma/migrations/, db/migrate/, OR
      any change to schema.sql / schema.prisma

Scope: committed changes since origin/main (or main) PLUS uncommitted
changes in the working tree. Skips test paths and shadcn ui scaffolding
which produce noisy false positives.

Exit codes:
  0  - gate did NOT fire (no regen needed)
  1  - gate FIRED (regen recommended)

Flags:
  --json      Emit results as JSON.
  --root DIR  Repo root (default: cwd).
  --range R   git rev range for committed diff (default: origin/main..HEAD).

Read-only. Never modifies the repo.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

SOURCE_EXTS = {
    ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".rb", ".java", ".kt",
    ".swift", ".c", ".cpp", ".h", ".hpp", ".cs", ".php",
    ".scala", ".dart", ".ex", ".exs", ".clj",
}

TEST_MARKERS = ("/test/", "/tests/", "/__tests__/", "/spec/",
                ".test.", ".spec.", "_test.", "_spec.")

SHADCN_MARKER = "/components/ui/"

MIGRATION_DIRS = ("migrations/", "prisma/migrations/", "db/migrate/")

SCHEMA_FILES = {"schema.sql", "schema.prisma"}


def is_structural_source(path):
    p = Path(path)
    if p.suffix not in SOURCE_EXTS:
        return False
    pl = path.lower()
    if SHADCN_MARKER in pl:
        return False
    return not any(m in pl for m in TEST_MARKERS)


def git(root, *args):
    return subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True, text=True, check=False,
    )


def resolve_range(root, requested):
    """Fall back gracefully if origin/main is absent."""
    r = git(root, "rev-parse", "--verify", requested.split("..")[0])
    if r.returncode == 0:
        return requested
    if requested == "origin/main..HEAD":
        r2 = git(root, "rev-parse", "--verify", "main")
        if r2.returncode == 0:
            return "main..HEAD"
    return None


def collect_changes(root, rev_range):
    added = set()
    changed = set()

    if rev_range:
        r = git(root, "diff", "--name-status", rev_range)
        for line in r.stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            status, path = parts[0], parts[-1]
            changed.add(path)
            if status.startswith("A"):
                added.add(path)

    # Uncommitted (staged + unstaged + untracked).
    r = git(root, "status", "--porcelain")
    for line in r.stdout.split("\n"):
        if len(line) < 4:
            continue
        xy, path = line[:2], line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ")[-1]
        changed.add(path)
        if "?" in xy or "A" in xy:
            added.add(path)

    return added, changed


def evaluate(added, changed):
    r6_files = sorted(p for p in added if is_structural_source(p))
    r7_hits = []
    for p in sorted(added):
        pl = p.lower()
        for d in MIGRATION_DIRS:
            if d in pl:
                r7_hits.append({"path": p, "reason": f"new file under {d}"})
                break
    for p in sorted(changed):
        if Path(p).name.lower() in SCHEMA_FILES:
            r7_hits.append({"path": p, "reason": f"change to {Path(p).name}"})
    return r6_files, r7_hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--root", default=".")
    ap.add_argument("--range", default="origin/main..HEAD")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not (root / ".git").exists():
        print(f"sysdoc-gate: not a git repo: {root}", file=sys.stderr)
        return 0  # nothing to gate

    rev_range = resolve_range(root, args.range)
    added, changed = collect_changes(root, rev_range)
    r6_files, r7_hits = evaluate(added, changed)

    r6_fired = len(r6_files) >= 2
    r7_fired = len(r7_hits) > 0
    fired = r6_fired or r7_fired

    result = {
        "fired": fired,
        "range": rev_range or "(no committed range available)",
        "rules": {
            "R6_new_source_files": {
                "fired": r6_fired,
                "count": len(r6_files),
                "files": r6_files[:10],
            },
            "R7_migrations_or_schema": {
                "fired": r7_fired,
                "hits": r7_hits[:10],
            },
        },
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if fired:
            print("  sysdoc-gate: FIRED — system doc regen recommended")
            if r6_fired:
                print(f"    R6: {len(r6_files)} new source file(s)")
                for p in r6_files[:5]:
                    print(f"      + {p}")
                if len(r6_files) > 5:
                    print(f"      ... and {len(r6_files) - 5} more")
            if r7_fired:
                print(f"    R7: {len(r7_hits)} migration/schema change(s)")
                for hit in r7_hits[:5]:
                    print(f"      + {hit['path']} ({hit['reason']})")
        else:
            print(f"  sysdoc-gate: skip "
                  f"({len(r6_files)} new source(s), {len(r7_hits)} migration/schema)")

    return 1 if fired else 0


if __name__ == "__main__":
    sys.exit(main())
