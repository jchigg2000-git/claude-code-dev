#!/usr/bin/env python3
"""Regenerate the README's Skills and Slash-commands tables from frontmatter.

Pure stdlib, no dependencies — matches this repo's no-build, no-package ethos.

The script is the single source of truth for the two index tables in README.md.
It reads the `description` frontmatter from every `commands/*.md` and every
`skills/*/SKILL.md`, then rewrites the content between the marker pairs:

    <!-- BEGIN:skills -->   ... <!-- END:skills -->
    <!-- BEGIN:commands --> ... <!-- END:commands -->

Everything outside those markers (Install, Conventions, License, section prose)
is left untouched. Files that lack a `description` frontmatter key fall back to
their first non-empty body line so nothing goes silently undocumented.

Usage:
    python3 scripts/gen-readme.py          # rewrite README.md in place
    python3 scripts/gen-readme.py --check  # exit 1 if README is stale (CI-friendly)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
README = REPO_ROOT / "README.md"
COMMANDS_DIR = REPO_ROOT / "commands"
SKILLS_DIR = REPO_ROOT / "skills"


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Split a Markdown file into (frontmatter dict, body).

    Only the leading `---`-delimited block is treated as frontmatter. Values are
    usually single-line `key: value` pairs; surrounding quotes are stripped.
    Block scalars (`key: >`, `>-`, `|`, `|-`) are also folded, because several
    skills use them for long descriptions — treating `>` as the literal value is
    what produced empty `| skill | > |` rows in the generated tables. Folding is
    lenient rather than spec-exact: continuation lines are joined with single
    spaces, which is all a one-line table cell can carry anyway.

    Files without frontmatter return ({}, text).
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text

    fm: dict[str, str] = {}
    body_start = len(lines)
    i = 1
    while i < len(lines):
        if lines[i].strip() == "---":
            body_start = i + 1
            break
        raw = lines[i]
        if not raw.strip() or raw.lstrip().startswith("#") or ":" not in raw:
            i += 1
            continue
        key, _, value = raw.partition(":")
        key = key.strip()
        value = value.strip()

        # Block scalar: the value is the indented lines that follow.
        if value in (">", ">-", ">+", "|", "|-", "|+"):
            indent = len(raw) - len(raw.lstrip())
            collected: list[str] = []
            i += 1
            while i < len(lines):
                nxt = lines[i]
                if nxt.strip() == "---":
                    break
                if nxt.strip() and (len(nxt) - len(nxt.lstrip())) <= indent:
                    break  # dedented back to a sibling key
                collected.append(nxt.strip())
                i += 1
            fm[key] = " ".join(part for part in collected if part)
            continue

        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        fm[key] = value
        i += 1

    body = "\n".join(lines[body_start:])
    return fm, body


def first_body_line(body: str) -> str:
    for line in body.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def cell(text: str) -> str:
    """Escape a value for a single Markdown table cell."""
    return text.replace("|", "\\|").replace("\n", " ").strip()


def describe(path: Path) -> str:
    fm, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    desc = fm.get("description", "").strip()
    if not desc:
        desc = first_body_line(body)
    return desc


def build_commands_table() -> str:
    rows = ["| Command | What it does |", "|---|---|"]
    for path in sorted(COMMANDS_DIR.glob("*.md")):
        name = path.stem
        desc = describe(path)
        link = f"commands/{path.name}"
        rows.append(f"| [`/{name}`]({link}) | {cell(desc)} |")
    return "\n".join(rows)


def build_skills_table() -> str:
    rows = ["| Skill | What it does |", "|---|---|"]
    for skill_md in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        fm, body = parse_frontmatter(skill_md.read_text(encoding="utf-8"))
        name = fm.get("name", "").strip() or skill_md.parent.name
        desc = fm.get("description", "").strip() or first_body_line(body)
        link = f"skills/{skill_md.parent.name}/SKILL.md"
        rows.append(f"| [`{name}`]({link}) | {cell(desc)} |")
    return "\n".join(rows)


def replace_between(text: str, marker: str, replacement: str) -> str:
    begin = f"<!-- BEGIN:{marker} -->"
    end = f"<!-- END:{marker} -->"
    try:
        b = text.index(begin)
        e = text.index(end, b)
    except ValueError:
        sys.exit(
            f"error: markers {begin} / {end} not found in {README.name}. "
            "Add the marker pair around the table before running the generator."
        )
    before = text[: b + len(begin)]
    after = text[e:]
    return f"{before}\n{replacement}\n{after}"


def render(current: str) -> str:
    out = replace_between(current, "skills", build_skills_table())
    out = replace_between(out, "commands", build_commands_table())
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if README.md is out of date instead of rewriting it",
    )
    args = parser.parse_args()

    current = README.read_text(encoding="utf-8")
    updated = render(current)

    if args.check:
        if current != updated:
            print(
                "README.md is out of date. Run: python3 scripts/gen-readme.py",
                file=sys.stderr,
            )
            return 1
        print("README.md is up to date.")
        return 0

    if current == updated:
        print("README.md already up to date.")
        return 0

    README.write_text(updated, encoding="utf-8")
    print(f"README.md regenerated ({len(list(COMMANDS_DIR.glob('*.md')))} commands, "
          f"{len(list(SKILLS_DIR.glob('*/SKILL.md')))} skills).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
