#!/usr/bin/env python3
"""
loose-ends — global MCP stdio server.

Surfaces the user's persistence layer (auto-memory entries, dotfile hygiene
reports, in-repo doc backlogs, git state) as a single queryable digest scoped
to one repo. Designed to be called automatically when entering a repo context,
so the model can volunteer "btw your sysdoc flagged X" without being asked.

Tool:
  get_loose_ends(repo_path?)  ->  compact JSON digest

Dependency-free (stdlib only). Newline-delimited JSON-RPC 2.0 over
stdin/stdout (MCP stdio), matching the port-registry pattern.
"""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HOME = Path.home()
PROJECTS_ROOT = Path(os.environ.get("PROJECTS_ROOT", HOME / "Projects"))
# Claude Code slugifies the projects root into the auto-memory directory name.
MEMORY_DIR = (
    HOME / ".claude" / "projects"
    / str(PROJECTS_ROOT).replace("/", "-")
    / "memory"
)
HYGIENE_REPORT = PROJECTS_ROOT / ".doc-hygiene-report.md"
SYSDOC_REPORT = PROJECTS_ROOT / ".sysdoc-staleness-report.md"

IN_REPO_DOCS = ("LOW_HANGING_FRUIT.md", "ROADMAP.md", "TODO.md")

SOURCE_EXTS = (".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
               ".go", ".rs", ".rb", ".java", ".kt", ".swift",
               ".c", ".cpp", ".h", ".hpp", ".cs", ".php")


# ---------- data-source readers ----------

def _git(repo, *args):
    r = subprocess.run(["git", "-C", str(repo), *args],
                       capture_output=True, text=True, check=False)
    return r.stdout.strip() if r.returncode == 0 else ""


def git_state(repo):
    out = {}
    branch = _git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    if not branch:
        return {"error": "not a git repo or no HEAD"}
    out["branch"] = branch

    porcelain = _git(repo, "status", "--porcelain")
    uncommitted = len([l for l in porcelain.split("\n") if l.strip()])
    if uncommitted:
        out["uncommitted_files"] = uncommitted

    # Branches with work not on origin/main (filters out merged/stale tips)
    no_merged = _git(repo, "branch", "--no-merged", "origin/main")
    unmerged = [l.strip().lstrip("*").strip()
                for l in no_merged.split("\n") if l.strip()]
    if unmerged:
        ub = {"count": len(unmerged), "sample": unmerged[:5]}
        if len(unmerged) > 5:
            ub["note"] = f"{len(unmerged) - 5} more not shown"
        out["unmerged_branches"] = ub

    # HEAD age
    head_ts = _git(repo, "log", "-1", "--format=%ct")
    if head_ts:
        try:
            out["head_age_days"] = (int(time.time()) - int(head_ts)) // 86400
        except ValueError:
            pass

    return out


def memory_hits(repo_name):
    """Return memory entries that reference this repo.

    Prefers explicit `metadata.repos: [a, b, c]` frontmatter tag (precise).
    Falls back to whole-word body grep for untagged entries (legacy).
    Tagged entries that do NOT include this repo are excluded even if they
    mention it in passing — the tag expresses intent, body grep is the
    accident-tolerant fallback.
    """
    if not MEMORY_DIR.is_dir():
        return []
    pattern = re.compile(rf"\b{re.escape(repo_name)}\b", re.IGNORECASE)
    hits = []
    for p in sorted(MEMORY_DIR.glob("*.md")):
        if p.name == "MEMORY.md":
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        fm = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)", text, re.DOTALL)
        if fm:
            frontmatter, body = fm.group(1), fm.group(2)
        else:
            frontmatter, body = "", text

        tag = re.search(r"^\s*repos:\s*\[([^\]]*)\]", frontmatter, re.MULTILINE)
        if tag:
            tagged = {s.strip().strip("\"'").lower()
                      for s in tag.group(1).split(",") if s.strip()}
            # Empty list means "explicitly global — never surface per-repo"
            if not tagged:
                continue
            if repo_name.lower() not in tagged:
                continue
        else:
            if not pattern.search(body):
                continue

        name = p.stem
        desc = ""
        m = re.search(r"^description:\s*(.+)$", frontmatter, re.MULTILINE)
        if m:
            desc = m.group(1).strip()

        snippet = ""
        for line in body.split("\n"):
            if pattern.search(line):
                snippet = line.strip()[:200]
                break
        if not snippet:
            for line in body.split("\n"):
                stripped = line.strip()
                if stripped and not stripped.startswith("#"):
                    snippet = stripped[:200]
                    break

        hits.append({"name": name, "description": desc, "snippet": snippet})
    return hits


def _parse_report_for_repo(report_path, repo_name):
    """Walk a markdown report, return (section_title -> [matching lines])."""
    if not report_path.exists():
        return {}
    pattern = re.compile(rf"\*\*{re.escape(repo_name)}\*\*", re.IGNORECASE)
    sections = {}
    current_section = None
    lines = report_path.read_text(encoding="utf-8", errors="ignore").split("\n")
    for i, line in enumerate(lines):
        if line.startswith("## "):
            current_section = line[3:].strip()
            continue
        if current_section and pattern.search(line):
            sections.setdefault(current_section, []).append(line.strip())
            # Also grab the follow-up indented line if it's a command hint
            if i + 1 < len(lines) and lines[i + 1].startswith("  "):
                sections[current_section].append(lines[i + 1].strip())
    return sections


def hygiene_findings(repo_name):
    sections = _parse_report_for_repo(HYGIENE_REPORT, repo_name)
    if not sections:
        return {}
    out = {}
    for section, items in sections.items():
        key = section.split(" (")[0].lower().replace(" ", "_")
        out[key] = items
    return out


def sysdoc_status(repo_name):
    sections = _parse_report_for_repo(SYSDOC_REPORT, repo_name)
    if not sections:
        return {}
    # Map section titles to status keys
    out = {}
    for section, items in sections.items():
        s = section.lower()
        if "missing" in s:
            out["status"] = "missing"
        elif "stale" in s:
            out["status"] = "stale"
        elif "untracked" in s:
            out["status"] = "untracked_on_disk"
        elif "recently regenerated" in s:
            out["status"] = "ok"
        out.setdefault("hits", []).extend(items)
    return out


def in_repo_docs(repo):
    """Surface the head of in-repo backlog docs (first ~15 lines each)."""
    out = {}
    for fname in IN_REPO_DOCS:
        p = repo / fname
        if not p.exists():
            continue
        try:
            head = p.read_text(encoding="utf-8", errors="ignore").split("\n")[:15]
            out[fname] = "\n".join(head).strip()
        except OSError:
            continue
    return out


def todo_markers(repo):
    """Count TODO/FIXME in files changed vs main (current-branch work only)."""
    # Get changed files vs main (or origin/main)
    changed = _git(repo, "diff", "--name-only", "origin/main..HEAD")
    if not changed:
        changed = _git(repo, "diff", "--name-only", "main..HEAD")
    if not changed:
        return {}
    files = [f for f in changed.split("\n")
             if f.endswith(SOURCE_EXTS) and (repo / f).exists()]
    if not files:
        return {}
    pattern = re.compile(r"\b(TODO|FIXME|XXX|HACK)\b[:\s]?(.*)$")
    hits = []
    for f in files[:50]:  # cap scan
        try:
            for i, line in enumerate((repo / f).read_text(
                    encoding="utf-8", errors="ignore").split("\n"), 1):
                m = pattern.search(line)
                if m:
                    hits.append({
                        "file": f,
                        "line": i,
                        "marker": m.group(1),
                        "text": m.group(2).strip()[:120],
                    })
                    if len(hits) >= 20:
                        break
        except OSError:
            continue
        if len(hits) >= 20:
            break
    if not hits:
        return {}
    return {"count": len(hits), "sample": hits[:5]}


# ---------- top-level orchestration ----------

def get_loose_ends(repo_path=None):
    repo = Path(repo_path or os.getcwd()).resolve()
    if not (repo / ".git").exists():
        return {"error": f"not a git repo: {repo}"}

    repo_name = repo.name
    result = {"repo": repo_name, "path": str(repo)}

    git = git_state(repo)
    if git:
        result["git"] = git

    hyg = hygiene_findings(repo_name)
    if hyg:
        result["hygiene"] = hyg

    sd = sysdoc_status(repo_name)
    if sd:
        result["sysdoc"] = sd

    irepo = in_repo_docs(repo)
    if irepo:
        result["in_repo_docs"] = irepo

    todos = todo_markers(repo)
    if todos:
        result["todos_in_branch"] = todos

    mem = memory_hits(repo_name)
    if mem:
        result["memory_hits"] = mem

    # Summary line — count distinct attention buckets
    buckets = 0
    if hyg:
        buckets += sum(1 for v in hyg.values() if v)
    if sd and sd.get("status") in ("missing", "stale", "untracked_on_disk"):
        buckets += 1
    if git.get("unpushed_branches"):
        buckets += len(git["unpushed_branches"])
    if todos:
        buckets += 1
    if irepo:
        buckets += len(irepo)
    result["summary"] = (f"{buckets} loose end(s)"
                         if buckets else "no loose ends detected")

    return result


# ---------- MCP plumbing (mirrors port-registry) ----------

TOOLS = [
    {
        "name": "get_loose_ends",
        "description": (
            "Return a compact digest of loose ends for a repo: env drift, "
            "broken README commands, stale or missing system-design docs, "
            "in-repo backlog docs (LOW_HANGING_FRUIT.md, ROADMAP.md, TODO.md), "
            "TODO/FIXME markers introduced in the current branch, unpushed "
            "branches and uncommitted changes, and auto-memory entries that "
            "reference this repo. CALL THIS when the user enters a repo for "
            "the first time in a session, mentions a specific repo by name, "
            "or asks 'what's the state' / 'what needs attention' / 'what's "
            "left to do here'. Repo defaults to cwd if omitted. Empty "
            "sections are omitted from the response."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "repo_path": {
                    "type": "string",
                    "description": (
                        "Absolute path to the repo. Defaults to current "
                        "working directory if omitted."
                    ),
                },
            },
        },
    },
]


def _result(call_id, result):
    return {"jsonrpc": "2.0", "id": call_id, "result": result}


def _error(call_id, code, message):
    return {"jsonrpc": "2.0", "id": call_id,
            "error": {"code": code, "message": message}}


def _text_content(payload):
    return {"content": [{"type": "text", "text": payload}], "isError": False}


def handle(msg):
    method = msg.get("method")
    mid = msg.get("id")

    if method == "initialize":
        proto = (msg.get("params") or {}).get("protocolVersion") or "2025-06-18"
        return _result(mid, {
            "protocolVersion": proto,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "loose-ends", "version": "1.0.0"},
        })

    if method in ("notifications/initialized", "initialized"):
        return None

    if method == "ping":
        return _result(mid, {})

    if method == "tools/list":
        return _result(mid, {"tools": TOOLS})

    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        try:
            if name == "get_loose_ends":
                res = get_loose_ends(args.get("repo_path"))
                return _result(mid, _text_content(json.dumps(res, indent=2)))
            return _error(mid, -32601, f"unknown tool: {name}")
        except Exception as e:
            return _result(mid, {
                "content": [{"type": "text", "text": f"error: {e}"}],
                "isError": True,
            })

    if mid is not None:
        return _error(mid, -32601, f"method not found: {method}")
    return None


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        reply = handle(msg)
        if reply is not None:
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
