#!/usr/bin/env python3
"""Weekly doc-hygiene sweep across all git repos under a root directory.

For each repo:
  - Compare HEAD commit date vs latest commit touching README.md / docs/ / CLAUDE.md
  - Run hygiene-check.py --json to capture env drift + broken README commands

Aggregates everything into a markdown report. No LLM calls, no token cost.
Designed for cron/launchd execution: non-interactive, idempotent, exit 0 on success.

Output:
  <root>/.doc-hygiene-report.md  (replaced on each run)

Usage:
  python3 doc-hygiene-sweep.py [--root DIR] [--max-depth N]
                               [--threshold-days N] [--output PATH]
"""

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HYGIENE_SCRIPT = Path(__file__).parent / "hygiene-check.py"

EXCLUDE_DIRS = {".claude", "node_modules", "__pycache__", ".venv", "venv"}


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


def audit_repo(repo, threshold_days):
    name = repo.name
    now = int(time.time())

    head_ts = commit_ts(repo)
    if head_ts is None:
        return {"name": name, "path": str(repo), "error": "no HEAD commit"}

    doc_candidates = ["README.md", "docs", "CLAUDE.md"]
    existing = [p for p in doc_candidates if (repo / p).exists()]
    doc_ts = commit_ts(repo, *existing) if existing else None

    head_age = (now - head_ts) // 86400
    doc_age = ((now - doc_ts) // 86400) if doc_ts else None

    stale = False
    # Only flag actively-developed repos (HEAD touched in last 90 days)
    if head_age < 90:
        if doc_ts is None and existing:
            # Docs exist on disk but never committed (untracked?) — treat as stale
            stale = True
        elif doc_ts and (head_ts - doc_ts) > threshold_days * 86400:
            stale = True

    hygiene = {}
    try:
        r = subprocess.run(
            ["python3", str(HYGIENE_SCRIPT), "--root", str(repo), "--json"],
            capture_output=True, text=True, check=False, timeout=120,
        )
        if r.stdout:
            hygiene = json.loads(r.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
        pass

    return {
        "name": name,
        "path": str(repo),
        "head_age_days": head_age,
        "doc_age_days": doc_age,
        "stale_docs": stale,
        "hygiene": hygiene,
    }


def render_report(audits, threshold_days):
    today = datetime.now().strftime("%Y-%m-%d")
    lines = [f"# Doc Hygiene Report — {today}", ""]
    lines.append(f"{len(audits)} repos audited under `~/Projects/`.")
    lines.append("")

    stale = [a for a in audits if a.get("stale_docs")]
    env_drift = [a for a in audits
                 if a.get("hygiene", {}).get("env_drift", {}).get("status") == "fail"]
    readme_broken = [a for a in audits
                     if a.get("hygiene", {}).get("readme_commands", {}).get("status") == "fail"]
    errored = [a for a in audits if "error" in a]

    needs = {a["name"] for a in stale + env_drift + readme_broken}
    lines.append(f"**{len(needs)} repos need attention.**")
    lines.append("")

    lines.append(f"## Stale docs (HEAD newer than docs by {threshold_days}+ days)")
    if stale:
        for a in stale:
            doc = f"{a['doc_age_days']} days ago" if a['doc_age_days'] is not None else "never"
            lines.append(f"- **{a['name']}** — HEAD: {a['head_age_days']}d ago, docs: {doc}")
    else:
        lines.append("(none)")
    lines.append("")

    lines.append("## Env drift (vars referenced in code but missing from .env.example)")
    if env_drift:
        for a in env_drift:
            missing = a["hygiene"]["env_drift"]["missing"]
            env_file = a["hygiene"]["env_drift"]["env_file"]
            lines.append(f"- **{a['name']}** ({env_file}): {', '.join(missing)}")
        lines.append("")
        lines.append("  Fix per repo: `python3 ~/.claude/skills/shipit/hygiene-check.py --root <repo> --fix-env`")
    else:
        lines.append("(none)")
    lines.append("")

    lines.append("## Broken README commands")
    if readme_broken:
        for a in readme_broken:
            broken = a["hygiene"]["readme_commands"]["broken"]
            lines.append(f"- **{a['name']}**")
            for b in broken:
                lines.append(f"  - {b}")
    else:
        lines.append("(none)")
    lines.append("")

    if errored:
        lines.append("## Could not audit")
        for a in errored:
            lines.append(f"- {a['name']}: {a['error']}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("Generated by `~/.claude/skills/shipit/doc-hygiene-sweep.py`. "
                 "Schedule: weekly via launchd (`com.justinhiggins.shipit.doc-hygiene-sweep`).")

    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path.home() / "Projects"))
    ap.add_argument("--max-depth", type=int, default=2)
    ap.add_argument("--threshold-days", type=int, default=30)
    ap.add_argument("--output")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        print(f"Root does not exist: {root}", file=sys.stderr)
        return 1

    output = Path(args.output) if args.output else (root / ".doc-hygiene-report.md")

    audits = [audit_repo(r, args.threshold_days)
              for r in find_git_repos(root, args.max_depth)]

    output.write_text(render_report(audits, args.threshold_days), encoding="utf-8")
    print(f"Wrote {output} ({len(audits)} repos audited)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
