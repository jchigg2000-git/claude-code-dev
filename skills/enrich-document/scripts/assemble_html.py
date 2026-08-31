#!/usr/bin/env python3
"""assemble_html.py — build-time assembler + internal-link resolver for enrich-document.

Takes an HTML *body fragment* (everything that goes inside <body>, produced by the
skill) and emits a single self-contained .html file by inlining assets/enrich.css and
assets/enrich.js into assets/template.html.

While assembling it makes internal links durable:
  * Ensures every heading has a stable id (slugified, de-duplicated) and a
    data-anchor-aliases attribute carrying its de-numbered slug, so renumbering and
    casing drift still resolve.
  * Pre-resolves every internal link (href="#...") against the real headings using the
    same normalize/slug/fuzzy logic as enrich.js (exact id -> normalized slug -> alias
    -> de-numbered -> fuzzy >= 0.5). Rewrites the href to the resolved id; leaves a
    data-anchor-dead marker on anything it genuinely cannot match.
  * Prints a JSON report (counts + any dead links) to stderr so the skill can surface it.

This is belt-and-suspenders: assemble_html.py fixes links at build time, enrich.js fixes
them again at view time, so links survive edits made after generation.

Usage:
  assemble_html.py --body body.html --out enriched.html \
      [--prompts prompts.json] [--title "Doc title"] [--assets <dir>]

Stdlib only.
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from difflib import SequenceMatcher

HEADING_RE = re.compile(r"<(h[1-6])\b([^>]*)>(.*?)</\1>", re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")
ATTR_RE = lambda name: re.compile(r'\b' + name + r'\s*=\s*"([^"]*)"', re.IGNORECASE)
ID_ATTR = ATTR_RE("id")
ALIAS_ATTR = ATTR_RE("data-anchor-aliases")
HREF_HASH_RE = re.compile(r'href\s*=\s*"#([^"]*)"', re.IGNORECASE)


# ---------------- text normalization (mirror of enrich.js) ----------------
def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def slugify(s: str) -> str:
    return re.sub(r"\s+", "-", normalize(s))


def tokens(s: str):
    n = normalize(s)
    return n.split() if n else []


def strip_leading_number(s: str) -> str:
    n = normalize(s)
    n = re.sub(r"^(section|chapter|part|appendix|step|fig|figure|table)\s+", "", n)
    n = re.sub(r"^[0-9]+([.\-][0-9]+)*\s*", "", n)
    return n.strip()


def lev_ratio(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def jaccard(at, bt) -> float:
    if not at or not bt:
        return 0.0
    A, B = set(at), set(bt)
    return len(A & B) / len(A | B)


def text_of(inner_html: str) -> str:
    return re.sub(r"\s+", " ", TAG_RE.sub("", inner_html)).strip()


# ---------------- heading model ----------------
class Heading:
    def __init__(self, ident, text):
        self.id = ident
        self.text = text
        self.slug = slugify(text)
        self.tokens = tokens(text)
        self.slugs = []
        for s in (slugify(text), slugify(ident), slugify(strip_leading_number(text))):
            if s and s not in self.slugs:
                self.slugs.append(s)


def ensure_heading_ids(body: str):
    """Give every heading a stable id + de-numbered alias. Returns (new_body, headings)."""
    used = set(ID_ATTR.search(m.group(0)).group(1)
               for m in HEADING_RE.finditer(body) if ID_ATTR.search(m.group(0)))
    headings = []

    def repl(m):
        tag, attrs, inner = m.group(1), m.group(2), m.group(3)
        text = text_of(inner)
        idm = ID_ATTR.search(attrs)
        if idm:
            ident = idm.group(1)
        else:
            base = slugify(text) or "section"
            ident = base
            i = 1
            while ident in used:
                i += 1
                ident = f"{base}-{i}"
            used.add(ident)
            attrs = f'{attrs} id="{ident}"'
        # add de-numbered alias if it differs and is not already present
        alias = slugify(strip_leading_number(text))
        existing_alias = ALIAS_ATTR.search(attrs)
        alias_list = existing_alias.group(1).split() if existing_alias else []
        if alias and alias != ident and alias not in alias_list:
            alias_list.append(alias)
            if existing_alias:
                attrs = ALIAS_ATTR(  # noqa
                    "data-anchor-aliases").sub(
                    'data-anchor-aliases="%s"' % " ".join(alias_list), attrs)
            else:
                attrs = f'{attrs} data-anchor-aliases="{" ".join(alias_list)}"'
        headings.append(Heading(ident, text))
        return f"<{tag}{attrs}>{inner}</{tag}>"

    new_body = HEADING_RE.sub(repl, body)
    return new_body, headings


def resolve(target: str, headings, id_set):
    """Mirror of enrich.js resolve(): returns a heading id or None."""
    if not target:
        return None
    if target in id_set:
        return target
    t_slug = slugify(target)
    t_strip = slugify(strip_leading_number(target))
    t_tok = tokens(target)
    best, best_score = None, 0.0
    for h in headings:
        if t_slug in h.slugs or (t_strip and t_strip in h.slugs):
            return h.id
        slug_score = max((lev_ratio(t_slug, s) for s in h.slugs), default=0.0)
        score = max(jaccard(t_tok, h.tokens), lev_ratio(t_slug, h.slug), slug_score)
        if score > best_score:
            best_score, best = score, h
    return best.id if best and best_score >= 0.5 else None


def heal_links(body: str, headings):
    id_set = set(h.id for h in headings)
    report = {"total": 0, "exact": 0, "healed": 0, "dead": 0, "dead_targets": []}

    # Rewrite each anchor tag that contains an href="#..."; mark dead ones.
    anchor_re = re.compile(r"<a\b[^>]*>", re.IGNORECASE)

    def fix_anchor(m):
        tag = m.group(0)
        hm = HREF_HASH_RE.search(tag)
        if not hm:
            return tag
        report["total"] += 1
        target = hm.group(1)
        if target in id_set:
            report["exact"] += 1
            return tag
        resolved = resolve(target, headings, id_set)
        if resolved:
            report["healed"] += 1
            tag = HREF_HASH_RE.sub('href="#%s"' % resolved, tag, count=1)
            if "data-anchor-healed" not in tag:
                tag = tag[:-1] + ' data-anchor-healed="%s">' % (target + " -> " + resolved)
            return tag
        report["dead"] += 1
        report["dead_targets"].append(target)
        if "data-anchor-dead" not in tag:
            tag = tag[:-1] + ' data-anchor-dead="%s">' % target
        return tag

    return anchor_re.sub(fix_anchor, body), report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--body", required=True, help="HTML body fragment file")
    ap.add_argument("--out", required=True, help="output .html path")
    ap.add_argument("--prompts", help="JSON file: { promptId: promptText } for Claude buttons")
    ap.add_argument("--title", default="Enriched document")
    ap.add_argument("--assets", help="assets dir (default: ../assets next to this script)")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    assets = args.assets or os.path.join(here, "..", "assets")

    def read(p):
        with open(p, "r", encoding="utf-8") as f:
            return f.read()

    body = read(args.body)
    css = read(os.path.join(assets, "enrich.css"))
    js = read(os.path.join(assets, "enrich.js"))
    template = read(os.path.join(assets, "template.html"))

    prompts_json = "{}"
    if args.prompts and os.path.exists(args.prompts):
        # validate + re-serialize so the embedded JSON is guaranteed well-formed
        prompts_json = json.dumps(json.loads(read(args.prompts)), ensure_ascii=False, indent=0)

    body, headings = ensure_heading_ids(body)
    body, report = heal_links(body, headings)

    html = (template
            .replace("{{TITLE}}", args.title)
            .replace("{{STYLE}}", css)
            .replace("{{BODY}}", body)
            .replace("{{PROMPTS_JSON}}", prompts_json)
            .replace("{{SCRIPT}}", js))

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)

    report["headings"] = len(headings)
    report["out"] = args.out
    print(json.dumps(report, indent=2), file=sys.stderr)
    if report["dead"]:
        print("WARNING: %d internal link(s) could not be resolved: %s"
              % (report["dead"], ", ".join(report["dead_targets"])), file=sys.stderr)


if __name__ == "__main__":
    main()
