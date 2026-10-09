#!/usr/bin/env python3
"""Pre-ship hygiene check for shipit.

Runs three independent checks against the current repo:
  - env_drift: env vars referenced in code but missing from .env.example
  - readme_commands: backticked CLI commands in README that no longer resolve
  - changelog: CHANGELOG.md exists but was not touched in this ship

Exit codes:
  0  - no failures (warnings allowed)
  1  - one or more checks failed (ship should block)

Flags:
  --fix-env   Auto-append missing keys to .env.example with empty values.
  --json      Emit results as JSON.
  --root DIR  Repo root (default: cwd).

Idempotent and read-only unless --fix-env is passed.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SOURCE_EXTS = {
    ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".rb", ".java", ".kt",
    ".swift", ".c", ".cpp", ".h", ".hpp", ".cs", ".php",
    ".scala", ".dart", ".ex", ".exs", ".clj",
}

EXCLUDE_DIRS = {
    "node_modules", ".git", "dist", "build", "target",
    "vendor", ".next", ".nuxt", "out", "__pycache__",
    ".venv", "venv", ".tox", "coverage", ".pytest_cache",
}

TEST_MARKERS = ("/test/", "/tests/", "/__tests__/", "/spec/",
                ".test.", ".spec.", "_test.", "_spec.")

ENV_PATTERNS = [
    re.compile(r"process\.env\.([A-Z_][A-Z0-9_]*)"),
    re.compile(r"process\.env\[[\'\"]([A-Z_][A-Z0-9_]*)[\'\"]\]"),
    re.compile(r"os\.environ\[[\'\"]([A-Z_][A-Z0-9_]*)[\'\"]\]"),
    re.compile(r"os\.environ\.get\([\'\"]([A-Z_][A-Z0-9_]*)[\'\"]"),
    re.compile(r"os\.getenv\([\'\"]([A-Z_][A-Z0-9_]*)[\'\"]"),
    re.compile(r"ENV\[[\'\"]([A-Z_][A-Z0-9_]*)[\'\"]\]"),
    re.compile(r"std::env::var\([\'\"]([A-Z_][A-Z0-9_]*)[\'\"]"),
    re.compile(r"Deno\.env\.get\([\'\"]([A-Z_][A-Z0-9_]*)[\'\"]"),
]

# Always-present platform vars — never flag as missing from .env.example.
ENV_NOISE = {
    "NODE_ENV", "PATH", "HOME", "USER", "PWD", "CI", "DEBUG",
    "PYTHONPATH", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR",
    "VERCEL_ENV", "VERCEL", "RAILWAY_ENVIRONMENT", "PORT",
}


def walk_source_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix not in SOURCE_EXTS:
                continue
            sp = str(p).lower()
            if any(m in sp for m in TEST_MARKERS):
                continue
            yield p


def find_env_refs(root):
    found = set()
    for p in walk_source_files(root):
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pat in ENV_PATTERNS:
            for m in pat.finditer(text):
                found.add(m.group(1))
    return found - ENV_NOISE


def find_env_example(root):
    for name in (".env.example", ".env.sample", ".env.template", ".env.dist"):
        p = root / name
        if p.exists():
            return p
    return None


def parse_env_keys(env_path):
    keys = set()
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        keys.add(line.split("=", 1)[0].strip())
    return keys


def check_env_drift(root, fix):
    env_path = find_env_example(root)
    if env_path is None:
        return {"status": "skip", "reason": "no .env.example"}
    code_vars = find_env_refs(root)
    declared = parse_env_keys(env_path)
    missing = sorted(code_vars - declared)
    rel = str(env_path.relative_to(root))
    if not missing:
        return {"status": "pass", "env_file": rel}
    if fix:
        with env_path.open("a", encoding="utf-8") as f:
            f.write("\n# Auto-added by shipit hygiene-check\n")
            for k in missing:
                f.write(f"{k}=\n")
        return {"status": "fixed", "env_file": rel, "added": missing}
    return {
        "status": "fail",
        "env_file": rel,
        "missing": missing,
        "fix_command": f"python3 {Path(__file__).resolve()} --fix-env",
    }


CMD_RUN = re.compile(r"`(npm|pnpm|yarn|bun)\s+run\s+([a-zA-Z0-9:_-]+)")
CMD_PKG = re.compile(r"`(npm|pnpm|yarn|bun)\s+([a-zA-Z0-9:_-]+)")
CMD_MAKE = re.compile(r"`make\s+([a-zA-Z0-9:_-]+)")
CMD_SCRIPT = re.compile(r"`(\./[a-zA-Z0-9_./-]+\.sh)")

PKG_BUILTINS = {
    "install", "i", "add", "remove", "rm", "test", "start",
    "run", "build", "init", "publish", "link", "unlink",
    "audit", "update", "outdated", "ci", "dlx", "exec",
    "create", "version", "info", "view", "search", "list", "ls",
}


def check_readme_commands(root):
    readme = None
    for name in ("README.md", "Readme.md", "readme.md", "README.MD"):
        p = root / name
        if p.exists():
            readme = p
            break
    if not readme:
        return {"status": "skip", "reason": "no README.md"}

    text = readme.read_text(encoding="utf-8", errors="ignore")

    pkg_scripts = set()
    pkg = root / "package.json"
    if pkg.exists():
        try:
            pkg_scripts = set((json.loads(pkg.read_text()).get("scripts") or {}).keys())
        except (json.JSONDecodeError, OSError):
            pass

    make_targets = set()
    makefile = root / "Makefile"
    if makefile.exists():
        for line in makefile.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r"^([a-zA-Z0-9_.-]+)\s*:", line)
            if m and not m.group(1).startswith("."):
                make_targets.add(m.group(1))

    broken = []

    for m in CMD_RUN.finditer(text):
        script = m.group(2)
        if pkg_scripts and script not in pkg_scripts:
            broken.append(f"`{m.group(1)} run {script}` — script not in package.json")

    for m in CMD_PKG.finditer(text):
        cmd = m.group(2)
        if cmd in PKG_BUILTINS:
            continue
        # Don't double-report `npm run foo` (already caught above).
        if "run" in m.group(0):
            continue
        if pkg_scripts and cmd not in pkg_scripts:
            broken.append(f"`{m.group(1)} {cmd}` — not a builtin and not in package.json scripts")

    for m in CMD_MAKE.finditer(text):
        target = m.group(1)
        if make_targets and target not in make_targets:
            broken.append(f"`make {target}` — target not in Makefile")

    for m in CMD_SCRIPT.finditer(text):
        script = m.group(1)
        sp = root / script.lstrip("./")
        if not sp.exists():
            broken.append(f"`{script}` — file does not exist")

    rel = str(readme.relative_to(root))
    if broken:
        return {"status": "fail", "readme": rel, "broken": broken}
    return {"status": "pass", "readme": rel}


def check_changelog(root):
    cl = None
    for name in ("CHANGELOG.md", "CHANGELOG", "CHANGELOG.MD"):
        p = root / name
        if p.exists():
            cl = p
            break
    if not cl:
        return {"status": "skip", "reason": "no CHANGELOG"}
    rel = str(cl.relative_to(root))

    touched = []
    for args in (["git", "-C", str(root), "diff", "--name-only", "origin/main..HEAD"],
                 ["git", "-C", str(root), "diff", "--name-only", "HEAD"],
                 ["git", "-C", str(root), "status", "--porcelain"]):
        r = subprocess.run(args, capture_output=True, text=True, check=False)
        for line in r.stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            # Strip porcelain status prefix
            if args[-1] == "--porcelain" and len(line) > 3:
                line = line[3:].strip()
            if " -> " in line:
                line = line.split(" -> ")[-1]
            touched.append(line)

    if any(t.lower() == rel.lower() for t in touched):
        return {"status": "pass", "changelog": rel}
    return {
        "status": "warn",
        "changelog": rel,
        "message": "CHANGELOG exists but was not updated for this ship",
    }


def render_human(results):
    out = []
    for name, r in results.items():
        s = r["status"]
        if s == "pass":
            out.append(f"  [OK]   {name}")
        elif s == "skip":
            out.append(f"  [--]   {name} ({r.get('reason', '')})")
        elif s == "fixed":
            out.append(f"  [FIX]  {name} — added {len(r['added'])} key(s) to {r['env_file']}")
            for k in r["added"]:
                out.append(f"           + {k}")
        elif s == "warn":
            out.append(f"  [WARN] {name} — {r.get('message', '')}")
        elif s == "fail":
            out.append(f"  [FAIL] {name}")
            if name == "env_drift":
                out.append(f"           Missing from {r['env_file']}: {', '.join(r['missing'])}")
                out.append(f"           Auto-fix: {r['fix_command']}")
            elif name == "readme_commands":
                for b in r["broken"]:
                    out.append(f"           {b}")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fix-env", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--root", default=".")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not (root / ".git").exists():
        print(f"hygiene-check: not a git repo: {root}", file=sys.stderr)
        return 1

    results = {
        "env_drift": check_env_drift(root, args.fix_env),
        "readme_commands": check_readme_commands(root),
        "changelog": check_changelog(root),
    }

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print(render_human(results))

    return 1 if any(r["status"] == "fail" for r in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
