#!/usr/bin/env python3
"""Monthly sys-doc staleness audit across all git repos under a root directory.

For each repo:
  - If docs/system-design.md exists: compare its latest commit
    date to HEAD. Flag stale if HEAD is newer by --threshold-days.
  - If missing: flag if the repo is large + active enough to warrant one
    (defaults: >=50 commits, >=10 source files, HEAD touched in last 90 days).

Outputs a markdown report with the manual commands to run /gen-sys-doc per
flagged repo. Does NOT auto-invoke gen-sys-doc — that requires LLM tokens and
is left as a deliberate user action.

Output:
  <root>/.sysdoc-staleness-report.md  (replaced on each run)

Usage:
  python3 sysdoc-staleness.py [--root DIR] [--max-depth N]
                              [--threshold-days N] [--min-commits N]
                              [--output PATH]
"""

import argparse
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

SYSDOC_PATH = "docs/system-design.md"

EXCLUDE_DIRS = {".claude", "node_modules", "__pycache__", ".venv", "venv"}

SOURCE_EXTS = (
    ".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
    ".go", ".rs", ".rb", ".java", ".kt", ".swift",
    ".c", ".cpp", ".h", ".hpp", ".cs", ".php",
)


def find_git_repos(root, max_depth):
    root = Path(root).resolve()
    yield from _walk(root, max_depth, 0)


def _walk(path, max_depth, depth):
    if depth > max_depth:
        return
    if (path / ".git").exists():
        yield path
        return
    try:
        for entry in path.iterdir():
            if (entry.is_dir()
                    and entry.name not in EXCLUDE_DIRS
                    and not entry.name.startswith(".")):
                yield from _walk(entry, max_depth, depth + 1)
    except (PermissionError, OSError):
        pass


def git(repo, *args):
    r = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True, check=False)
    return r.stdout.strip() if r.returncode == 0 else ""


def commit_ts(repo, *paths):
    args = ["log", "-1", "--format=%ct"]
    if paths:
        args.append("--")
        args.extend(paths)
    out = git(repo, *args)
    try:
        return int(out) if out else None
    except ValueError:
        return None


def commit_count(repo):
    out = git(repo, "rev-list", "--count", "HEAD")
    try:
        return int(out) if out else 0
    except ValueError:
        return 0


def source_file_count(repo):
    out = git(repo, "ls-files")
    if not out:
        return 0
    return sum(1 for line in out.split("\n") if line.endswith(SOURCE_EXTS))


def audit_repo(repo, threshold_days, min_commits):
    name = repo.name
    now = int(time.time())

    head_ts = commit_ts(repo)
    if head_ts is None:
        return {"name": name, "status": "error", "reason": "no HEAD"}

    head_age = (now - head_ts) // 86400
    sysdoc = repo / SYSDOC_PATH

    if sysdoc.exists():
        doc_ts = commit_ts(repo, SYSDOC_PATH)
        if doc_ts is None:
            # File on disk but not tracked
            return {"name": name, "path": str(repo), "status": "untracked",
                    "head_age": head_age}
        doc_age = (now - doc_ts) // 86400
        gap = doc_age - head_age
        if gap > threshold_days and head_age < 90:
            return {"name": name, "path": str(repo), "status": "stale",
                    "doc_age": doc_age, "head_age": head_age, "gap": gap}
        return {"name": name, "status": "ok", "doc_age": doc_age,
                "head_age": head_age}

    # Missing
    if head_age < 90:
        cc = commit_count(repo)
        sc = source_file_count(repo)
        if cc >= min_commits and sc >= 10:
            return {"name": name, "path": str(repo), "status": "missing",
                    "commits": cc, "src_files": sc, "head_age": head_age}
    return {"name": name, "status": "skip"}


def render_report(audits, threshold_days, min_commits):
    today = datetime.now().strftime("%Y-%m-%d")
    lines = [f"# System Doc Staleness Report — {today}", ""]
    lines.append(f"{len(audits)} repos audited under `~/Projects/`.")
    lines.append("")

    missing = [a for a in audits if a.get("status") == "missing"]
    stale = [a for a in audits if a.get("status") == "stale"]
    untracked = [a for a in audits if a.get("status") == "untracked"]
    ok = [a for a in audits if a.get("status") == "ok"]
    errored = [a for a in audits if a.get("status") == "error"]

    needs = len(missing) + len(stale) + len(untracked)
    lines.append(f"**{needs} repos need attention.**")
    lines.append("")

    lines.append(f"## Missing `{SYSDOC_PATH}` "
                 f"(active repos with ≥{min_commits} commits + ≥10 source files)")
    if missing:
        for a in missing:
            lines.append(f"- **{a['name']}** — {a['commits']} commits, "
                         f"{a['src_files']} source files, HEAD {a['head_age']}d ago")
            lines.append(f"  - `cd {a['path']} && claude /gen-sys-doc`")
    else:
        lines.append("(none)")
    lines.append("")

    lines.append(f"## Stale (HEAD newer than `system-design.md` by {threshold_days}+ days)")
    if stale:
        for a in stale:
            lines.append(f"- **{a['name']}** — doc: {a['doc_age']}d ago, "
                         f"HEAD: {a['head_age']}d ago (gap: {a['gap']}d)")
            lines.append(f"  - `cd {a['path']} && claude /gen-sys-doc`")
    else:
        lines.append("(none)")
    lines.append("")

    if untracked:
        lines.append("## Untracked sysdoc on disk (file present but not committed)")
        for a in untracked:
            lines.append(f"- **{a['name']}** — HEAD {a['head_age']}d ago")
        lines.append("")

    if ok:
        ok_sorted = sorted(ok, key=lambda a: a.get("doc_age", 9999))
        lines.append("## Recently regenerated (no action)")
        for a in ok_sorted[:10]:
            lines.append(f"- {a['name']} — doc: {a['doc_age']}d ago")
        if len(ok_sorted) > 10:
            lines.append(f"  ...and {len(ok_sorted) - 10} more")
        lines.append("")

    if errored:
        lines.append("## Could not audit")
        for a in errored:
            lines.append(f"- {a['name']}: {a.get('reason', 'unknown')}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("Generated by `~/.claude/skills/shipit/sysdoc-staleness.py`. "
                 "Schedule: monthly via launchd (`com.justinhiggins.shipit.sysdoc-staleness`).")

    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path.home() / "Projects"))
    ap.add_argument("--max-depth", type=int, default=2)
    ap.add_argument("--threshold-days", type=int, default=30)
    ap.add_argument("--min-commits", type=int, default=50)
    ap.add_argument("--output")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        print(f"Root does not exist: {root}", file=sys.stderr)
        return 1

    output = (Path(args.output) if args.output
              else (root / ".sysdoc-staleness-report.md"))

    audits = [audit_repo(r, args.threshold_days, args.min_commits)
              for r in find_git_repos(root, args.max_depth)]

    output.write_text(
        render_report(audits, args.threshold_days, args.min_commits),
        encoding="utf-8",
    )
    print(f"Wrote {output} ({len(audits)} repos audited)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
