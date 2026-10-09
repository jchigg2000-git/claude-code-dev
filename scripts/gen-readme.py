#!/usr/bin/env python3
"""Regenerate the README's grouped catalog of commands, skills and MCP servers.

Pure stdlib, no dependencies — matches this repo's no-build, no-package ethos.

Two sources, because they serve two readers:

- `docs/readme-catalog.json` — a plain-English one-line summary and a group for
  every entry. Written for people browsing GitHub; lives only in this repo.
- each file's `description` frontmatter — written for Claude (it decides when a
  skill fires), synced from ~/.claude. Used only as the fallback for an entry the
  catalog doesn't cover yet, cut to its first sentence.

It discovers every `commands/*.md`, `skills/*/SKILL.md` and
`mcp-servers/*/server.py`, then rewrites the content between

    <!-- BEGIN:catalog --> ... <!-- END:catalog -->

Everything outside those markers is left untouched. An entry with no catalog
summary is listed under "Not yet summarized" and named on stderr; a catalog key
with no matching file is an error, so a removed skill can't leave a ghost row.

Usage:
    python3 scripts/gen-readme.py          # rewrite README.md in place
    python3 scripts/gen-readme.py --check  # exit 1 if README is stale (CI-friendly)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG = "docs/readme-catalog.json"
UNSORTED = {"id": "unsorted", "title": "Not yet summarized",
            "blurb": f"New arrivals with no plain summary in `{CATALOG}` yet; the text is "
                     "the first sentence of the description Claude reads."}
KINDS = {"commands": "command", "skills": "skill", "mcp": "MCP server"}


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


def first_sentence(desc: str) -> str:
    """Fallback summary: the description's first sentence, trigger phrases cut."""
    desc = re.split(r"\s*\b(?:Fire on|Fires on|FIRES ONLY)\b", desc)[0].strip()
    m = re.match(r"(.+?[.!?])(?:\s|$)", desc)
    text = m.group(1) if m else desc
    return text if len(text) <= 200 else text[:199].rstrip() + "…"


def discover(root: Path) -> dict[str, tuple[str, Path]]:
    """Catalog key → (display name, link path) for everything that ships."""
    found: dict[str, tuple[str, Path]] = {}
    for path in sorted((root / "commands").glob("*.md")):
        found[f"commands/{path.stem}"] = (f"/{path.stem}", path)
    for path in sorted((root / "skills").glob("*/SKILL.md")):
        found[f"skills/{path.parent.name}"] = (path.parent.name, path)
    for path in sorted((root / "mcp-servers").glob("*/server.py")):
        found[f"mcp/{path.parent.name}"] = (path.parent.name, path.parent)
    return found


def slug(title: str) -> str:
    """GitHub's heading anchor for a plain-text title."""
    return re.sub(r"[^\w\- ]", "", title.lower()).replace(" ", "-")


def build_catalog(root: Path) -> tuple[str, list[str]]:
    """Return (markdown for the catalog block, keys with no catalog summary)."""
    catalog = json.loads((root / CATALOG).read_text(encoding="utf-8"))
    groups = catalog["groups"]
    entries = catalog["entries"]
    found = discover(root)

    orphans = sorted(set(entries) - set(found))
    if orphans:
        sys.exit(f"error: {CATALOG} lists entries with no matching file: {', '.join(orphans)}. "
                 "Remove them (or restore the file).")
    group_ids = {g["id"] for g in groups}
    bad = sorted(k for k, e in entries.items() if e.get("group") not in group_ids)
    if bad:
        sys.exit(f"error: {CATALOG} entries with an unknown group: {', '.join(bad)}")

    rows: dict[str, list[str]] = {g["id"]: [] for g in groups + [UNSORTED]}
    missing = []
    # Rows follow the catalog's own order (it reads 1–8 for the harden steps); uncatalogued last.
    order = {key: i for i, key in enumerate(entries)}
    for key in sorted(found, key=lambda k: (order.get(k, len(order)), k)):
        name, path = found[key]
        entry = entries.get(key)
        if entry and entry.get("summary", "").strip():
            group, summary = entry["group"], entry["summary"].strip()
        else:
            missing.append(key)
            group = "unsorted"
            summary = first_sentence(describe(path)) if path.is_file() else ""
        link = path.relative_to(root).as_posix() + ("/" if path.is_dir() else "")
        kind = KINDS[key.split("/", 1)[0]]
        rows[group].append(f"| [`{name}`]({link}) | {kind} | {cell(summary)} |")

    shown = [g for g in groups + [UNSORTED] if rows[g["id"]]]
    out = ["**At a glance:**", ""]
    out += [f"- [{g['title']}](#{slug(g['title'])}) ({len(rows[g['id']])})" for g in shown]
    for g in shown:
        out += ["", f"### {g['title']}", "", g["blurb"], "",
                "| Name | Kind | What it does |", "|---|---|---|", *rows[g["id"]]]
    return "\n".join(out), missing


def replace_between(text: str, marker: str, replacement: str) -> str:
    begin = f"<!-- BEGIN:{marker} -->"
    end = f"<!-- END:{marker} -->"
    try:
        b = text.index(begin)
        e = text.index(end, b)
    except ValueError:
        sys.exit(
            f"error: markers {begin} / {end} not found in README.md. "
            "Add the marker pair around the catalog before running the generator."
        )
    before = text[: b + len(begin)]
    after = text[e:]
    return f"{before}\n{replacement}\n{after}"


def render(current: str, root: Path = REPO_ROOT) -> tuple[str, list[str]]:
    block, missing = build_catalog(root)
    return replace_between(current, "catalog", block), missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if README.md is out of date instead of rewriting it",
    )
    args = parser.parse_args()

    readme = REPO_ROOT / "README.md"
    current = readme.read_text(encoding="utf-8")
    updated, missing = render(current)
    if missing:
        # Never fails the run: a fresh sync must not be blocked on prose.
        print(f"{len(missing)} entries have no summary in {CATALOG} "
              f"(listed under \"{UNSORTED['title']}\"): {', '.join(missing)}", file=sys.stderr)

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

    readme.write_text(updated, encoding="utf-8")
    print(f"README.md regenerated ({len(discover(REPO_ROOT))} entries).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
