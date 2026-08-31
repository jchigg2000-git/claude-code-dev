#!/usr/bin/env python3
"""Block third-party content from entering this mirror.

Pure stdlib, no dependencies — matches this repo's no-build, no-package ethos.

This repo is published as first-party MIT work, but it is populated by
`/sync-claude-slash`, which copies one-way out of `~/.claude/`. The harness is
also where *vendor* skills land (a `railway`-style install drops a whole skill
tree there). A prompt-level "don't sync that one" rule cannot defend this,
because the sync command itself gets overwritten by the next sync. So the
defense is a script plus a pre-commit hook.

Two independent layers, because they fail differently:

  1. PATH ALLOWLIST (`.provenance/first-party.txt`) — deny by default. Every
     tracked path under `commands/` and `skills/` must be listed. Anything
     arriving at a NEW path is blocked until you explicitly attest it. This is
     the layer that catches a bulk sync sweeping in a directory you didn't read.

  2. CONTENT HEURISTICS — run against every scanned file *including* allowlisted
     ones, because layer 1 is blind to a vendor file that overwrites a path
     already approved. These look for the fingerprints a published third-party
     artifact leaves behind: self-reported skill id/version, telemetry caller
     strings, pinned deep links into someone else's source tree, foreign
     copyright lines, bundled LICENSE files, package manifests.

Deliberately biased toward false positives. A blocked commit costs one line in
`.provenance/exceptions.txt`; a leak costs a license violation in a public repo.

Usage:
    python3 scripts/provenance-gate.py                  # staged paths (hook mode)
    python3 scripts/provenance-gate.py --all            # every tracked path
    python3 scripts/provenance-gate.py --paths a.md b/   # explicit paths
    python3 scripts/provenance-gate.py --attest a.md    # approve new paths
    python3 scripts/provenance-gate.py --all --quiet    # findings only

Exit codes: 0 = clean (warnings allowed), 1 = blocked, 2 = usage/setup error.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PROV_DIR = REPO_ROOT / ".provenance"
ALLOWLIST = PROV_DIR / "first-party.txt"
EXCEPTIONS = PROV_DIR / "exceptions.txt"

# Only these trees are gated. Everything else in the repo (README, LICENSE,
# scripts/, mcp-servers/) is hand-authored here and never touched by a sync.
GATED_ROOTS = ("commands/", "skills/")

OWNER = "Justin Higgins"

# Files we never try to read as text.
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".ico", ".woff", ".woff2"}

# A detector cannot be its own subject. This file states the rules as regexes and
# the control files quote the patterns they waive, so scanning them means every
# waiver re-trips the rule it waives — you cannot write the reason down without
# tripping it again. These three are exempt from the CONTENT rules only; they are
# still the thing a reviewer reads, and none of them live under a gated root.
SELF_PATHS = {
    "scripts/provenance-gate.py",
    ".provenance/first-party.txt",
    ".provenance/exceptions.txt",
}


# --------------------------------------------------------------------------- #
# Content rules
# --------------------------------------------------------------------------- #
# Each rule: (id, severity, compiled regex, why it implicates third-party code)
# Severity "block" fails the gate; "warn" reports and passes.

CONTENT_RULES = [
    (
        "vendor-telemetry",
        "block",
        re.compile(
            r"""(?xi)
            \b(?:SKILL|PLUGIN|TOOL|AGENT)_(?:ID|VERSION|SLUG)\s*=      # self-identifying artifact
          | \b[A-Z][A-Z0-9_]*_CALLER\s*=                               # phone-home attribution
          | ^\s*X-(?:Skill|Plugin)-Version\s*:                         # vendor request header
            """,
            re.MULTILINE,
        ),
        "declares its own id/version or reports a caller string upstream — "
        "the shape of a published, versioned vendor artifact, not a local file",
    ),
    (
        "pinned-upstream-source",
        "block",
        re.compile(r"(?i)\b(?:github|gitlab|bitbucket)\.com/[\w.-]+/[\w.-]+/(?:blob|tree|raw)/"),
        "deep-links into a pinned revision of someone else's source tree — "
        "authored by someone reading that repo's internals",
    ),
    (
        "foreign-copyright",
        "block",
        re.compile(
            r"""(?xim)
            ^.*Copyright\s*(?:\(c\)|©)\s*(?!.*"""
            + re.escape(OWNER)
            + r""").*$
          | Licen[cs]ed\s+under\s+the\s+(?:Apache|GNU|Mozilla|BSD|Eclipse)
          | ^\s*SPDX-License-Identifier\s*:\s*(?!MIT\s*$)
          | \bAll\s+rights\s+reserved\b
            """,
        ),
        f"carries a copyright, license grant, or SPDX id that is not {OWNER}'s MIT",
    ),
    (
        "vendor-llm-docs",
        "block",
        re.compile(r"(?i)\bllms(?:-docs|-full|-templates|-changelog|-blog)?\.(?:txt|md)\b"),
        "cites a vendor's machine-readable docs feed — written by that vendor "
        "for their own agent surface",
    ),
    (
        "foreign-author",
        "block",
        re.compile(r"(?im)^\s*(?:author|authors|maintainer|publisher|vendor)\s*:\s*(.+)$"),
        f"frontmatter names an author other than {OWNER}",
    ),
    (
        "artifact-version",
        "block",
        re.compile(r"(?im)^\s*version\s*:\s*v?\d+\.\d+"),
        "carries a semver frontmatter field — a distribution marker; nothing "
        "authored in this repo is versioned per-file",
    ),
    (
        "unreviewed-install-hint",
        "warn",
        re.compile(r"(?i)\b(?:npm|pnpm|yarn)\s+i(?:nstall)?\s+-g\s+@[\w.-]+/"),
        "tells the reader to globally install a scoped vendor package",
    ),
]

# Basenames that mean "this directory was unpacked from a distributed package."
BUNDLED_FILE_NAMES = {
    "license", "license.txt", "license.md", "licence", "licence.txt",
    "notice", "notice.txt", "copying", "copying.txt", "authors", "patents",
    "package.json", "pyproject.toml", "setup.py", "setup.cfg",
    "cargo.toml", "go.mod", "gemfile", "composer.json", "version",
}

# A skill directory fatter than this is probably a vendored doc set. Warn only —
# `enrich-document` is legitimately multi-file.
FAT_SKILL_FILE_COUNT = 12


# --------------------------------------------------------------------------- #
# Repo plumbing
# --------------------------------------------------------------------------- #

def git(*args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(REPO_ROOT), *args],
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        sys.exit(f"error: git {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout


def staged_paths() -> list[str]:
    out = git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
    return [p for p in out.splitlines() if p.strip()]


def tracked_paths() -> list[str]:
    return [p for p in git("ls-files").splitlines() if p.strip()]


def expand(paths: list[str]) -> list[str]:
    """Turn user-supplied paths (possibly directories) into repo-relative files."""
    out: list[str] = []
    for raw in paths:
        p = Path(raw)
        if not p.is_absolute():
            p = REPO_ROOT / raw
        try:
            rel = p.resolve().relative_to(REPO_ROOT)
        except ValueError:
            sys.exit(f"error: {raw} is outside the repo")
        if p.is_dir():
            out += [
                str(f.resolve().relative_to(REPO_ROOT))
                for f in sorted(p.rglob("*"))
                if f.is_file()
            ]
        else:
            out.append(str(rel))
    return out


def is_gated(path: str) -> bool:
    return path.startswith(GATED_ROOTS)


def read_list(path: Path) -> list[str]:
    if not path.exists():
        return []
    lines = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            lines.append(line)
    return lines


def load_allowlist() -> set[str]:
    return set(read_list(ALLOWLIST))


def load_exceptions() -> set[tuple[str, str]]:
    """Parse `path<TAB>rule<TAB>reason`. Rule `*` waives every rule for the path."""
    pairs: set[tuple[str, str]] = set()
    for line in read_list(EXCEPTIONS):
        fields = [f.strip() for f in re.split(r"\t+|\s{2,}", line) if f.strip()]
        if len(fields) < 3:
            sys.exit(
                f"error: malformed line in {EXCEPTIONS.name} (need path, rule, reason):\n  {line}"
            )
        pairs.add((fields[0], fields[1]))
    return pairs


def waived(exceptions: set[tuple[str, str]], path: str, rule: str) -> bool:
    return (path, rule) in exceptions or (path, "*") in exceptions


# --------------------------------------------------------------------------- #
# Scanning
# --------------------------------------------------------------------------- #

class Finding:
    def __init__(self, severity: str, rule: str, path: str, line: int, evidence: str, why: str):
        self.severity = severity
        self.rule = rule
        self.path = path
        self.line = line
        self.evidence = evidence
        self.why = why


def read_text(path: str) -> str | None:
    f = REPO_ROOT / path
    if f.suffix.lower() in BINARY_SUFFIXES or not f.is_file():
        return None
    try:
        return f.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return None


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def snippet(text: str, start: int, end: int, width: int = 120) -> str:
    frag = text[start:end].strip().replace("\n", " ")
    return frag[:width] + ("…" if len(frag) > width else "")


def scan_content(path: str, text: str, exceptions: set[tuple[str, str]]) -> list[Finding]:
    findings: list[Finding] = []
    for rule_id, severity, pattern, why in CONTENT_RULES:
        if waived(exceptions, path, rule_id):
            continue
        for m in pattern.finditer(text):
            # `foreign-author` is the one rule with a legitimate passing value.
            if rule_id == "foreign-author" and m.group(1).strip().strip("'\"") == OWNER:
                continue
            findings.append(
                Finding(severity, rule_id, path, line_of(text, m.start()),
                        snippet(text, m.start(), m.end()), why)
            )
            break  # one finding per rule per file is enough to block
    return findings


def scan_structure(paths: list[str], exceptions: set[tuple[str, str]]) -> list[Finding]:
    findings: list[Finding] = []
    for path in paths:
        if not is_gated(path):
            continue
        name = Path(path).name.lower()
        if name in BUNDLED_FILE_NAMES and not waived(exceptions, path, "bundled-package-file"):
            findings.append(Finding(
                "block", "bundled-package-file", path, 1, name,
                "a license/manifest file inside a skill or command tree means the "
                "directory was unpacked from a distributed package",
            ))
    # Fat skill directories (warn only).
    skill_dirs: dict[str, int] = {}
    for path in paths:
        parts = Path(path).parts
        if len(parts) >= 2 and parts[0] == "skills":
            skill_dirs[parts[1]] = skill_dirs.get(parts[1], 0) + 1
    for skill, count in sorted(skill_dirs.items()):
        target = f"skills/{skill}/"
        if count > FAT_SKILL_FILE_COUNT and not waived(exceptions, target, "fat-skill-tree"):
            findings.append(Finding(
                "warn", "fat-skill-tree", target, 1, f"{count} files",
                f"more than {FAT_SKILL_FILE_COUNT} files in one skill — vendored "
                "doc sets are fat; confirm you wrote all of it",
            ))
    return findings


def scan(paths: list[str], allowlist: set[str], exceptions: set[tuple[str, str]]) -> list[Finding]:
    findings: list[Finding] = []

    for path in sorted(set(paths)):
        if is_gated(path) and path not in allowlist:
            findings.append(Finding(
                "block", "unlisted-path", path, 1, path,
                "not attested as first-party — new paths are denied by default",
            ))
        if path in SELF_PATHS:
            continue
        text = read_text(path)
        if text is not None:
            findings += scan_content(path, text, exceptions)

    findings += scan_structure(paths, exceptions)
    return findings


# --------------------------------------------------------------------------- #
# Attest
# --------------------------------------------------------------------------- #

def attest(paths: list[str]) -> int:
    files = [p for p in expand(paths) if is_gated(p)]
    if not files:
        print("nothing to attest — --attest only covers commands/ and skills/", file=sys.stderr)
        return 2
    current = load_allowlist()
    new = sorted(p for p in files if p not in current)
    if not new:
        print("all given paths are already attested.")
        return 0
    print("You are attesting that you authored the following, with Claude, yourself:")
    for p in new:
        print(f"  {p}")
    lines = sorted(current | set(new))
    PROV_DIR.mkdir(exist_ok=True)
    ALLOWLIST.write_text(_allowlist_text(lines), encoding="utf-8")
    print(f"\nAdded {len(new)} path(s) to {ALLOWLIST.relative_to(REPO_ROOT)}.")
    print("Re-run the gate to confirm the content rules also pass.")
    return 0


def _allowlist_text(paths: list[str]) -> str:
    header = (
        "# First-party paths — every file here was authored by "
        f"{OWNER} (with Claude).\n"
        "#\n"
        "# scripts/provenance-gate.py denies any path under commands/ or skills/ that\n"
        "# is not listed. That is the point: a bulk `/sync-claude-slash` cannot sweep in\n"
        "# a vendor skill tree without a human adding lines here.\n"
        "#\n"
        "# Attest new work with:  python3 scripts/provenance-gate.py --attest <path>\n"
        "# Do not add a path you have not read.\n"
    )
    return header + "\n" + "\n".join(paths) + "\n"


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #

def report(findings: list[Finding], scanned: int, quiet: bool) -> int:
    blocks = [f for f in findings if f.severity == "block"]
    warns = [f for f in findings if f.severity == "warn"]

    if not blocks and not warns:
        if not quiet:
            print(f"provenance gate: clean ({scanned} path(s) scanned).")
        return 0

    def emit(group: list[Finding], label: str) -> None:
        print(f"\n{label}", file=sys.stderr)
        by_rule: dict[str, list[Finding]] = {}
        for f in group:
            by_rule.setdefault(f.rule, []).append(f)
        for rule, items in sorted(by_rule.items()):
            print(f"\n  [{rule}] {items[0].why}", file=sys.stderr)
            for f in items[:20]:
                loc = f"{f.path}:{f.line}" if f.line > 1 else f.path
                print(f"    {loc}", file=sys.stderr)
                if f.evidence and f.evidence != f.path:
                    print(f"      → {f.evidence}", file=sys.stderr)
            if len(items) > 20:
                print(f"    … and {len(items) - 20} more", file=sys.stderr)

    if warns:
        emit(warns, "provenance gate — WARNINGS (not blocking):")

    if blocks:
        emit(blocks, "provenance gate — BLOCKED:")
        print(
            "\nNothing was committed. Pick one:\n"
            "  • It is not yours      → delete it from this repo (the harness copy is untouched).\n"
            "  • It is yours          → python3 scripts/provenance-gate.py --attest <path>\n"
            "  • Rule is wrong here   → add a line to .provenance/exceptions.txt:\n"
            "                             <path><TAB><rule><TAB><why this is fine>\n"
            "  • Emergency override   → git commit --no-verify  (and fix it after)\n",
            file=sys.stderr,
        )
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true", help="scan every tracked path")
    parser.add_argument("--paths", nargs="+", metavar="PATH", help="scan these paths")
    parser.add_argument("--attest", nargs="+", metavar="PATH",
                        help="record paths as first-party, then exit")
    parser.add_argument("--quiet", action="store_true", help="print findings only")
    args = parser.parse_args()

    if args.attest:
        return attest(args.attest)

    if args.all:
        paths = tracked_paths()
    elif args.paths:
        paths = expand(args.paths)
    else:
        paths = staged_paths()

    if not paths:
        if not args.quiet:
            print("provenance gate: nothing to scan.")
        return 0

    allowlist = load_allowlist()
    if not allowlist:
        print(
            f"error: {ALLOWLIST.relative_to(REPO_ROOT)} is missing or empty, so every path "
            "would be denied.\nSeed it once with:\n"
            "  git ls-files commands skills | python3 -c \"import sys,pathlib;"
            "pathlib.Path('.provenance/first-party.txt').write_text(sys.stdin.read())\"\n"
            "then review it by hand.",
            file=sys.stderr,
        )
        return 2

    findings = scan(paths, allowlist, load_exceptions())
    return report(findings, len(paths), args.quiet)


if __name__ == "__main__":
    raise SystemExit(main())
