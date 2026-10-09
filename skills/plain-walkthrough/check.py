#!/usr/bin/env python3
"""Gate checker for a plain-walkthrough page. Standard library only.

usage: check.py <page.html> [--size S|M|L|XL] [--words <plain-words.md>]
Prints one line per gate and exits 1 if any gate fails.
Limits live in SIZES and COMMON below. Change one only with a reason written next to it.
"""
import os
import re
import sys
from html.parser import HTMLParser

# T-shirt sizes. Words are visible prose words and must stay strictly under the cap.
# The reference page this skill came from (tc-sys-view-turns.html) is ~6,000 words, so every size is simpler.
SIZES = {
    #        words<  steps    glossary<=
    "S":  {"words_lt": 1000, "steps": (3, 5), "glossary_max": 5},
    "M":  {"words_lt": 2000, "steps": (4, 6), "glossary_max": 8},
    "L":  {"words_lt": 3000, "steps": (5, 8), "glossary_max": 10},
    "XL": {"words_lt": 4000, "steps": (6, 9), "glossary_max": 12},
}
DEFAULT_SIZE = "M"
COMMON = {
    "figures_over_steps": 2,  # figures <= steps + 2 (the in/out figure and one for the comparison)
    "step_words_max": 150,    # prose paragraphs inside one step, figure text excluded
    "sentence_avg_max": 15.0,
    "grade_max": 8.0,         # Flesch-Kincaid grade level
}

GLOSSARY_IDS = {"words", "glossary"}  # the glossary section's id
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
BLOCKS = {"p", "li", "td", "th", "figcaption", "h1", "h2", "h3", "h4", "dd", "dt"}
PROSE = {"p", "li", "figcaption"}
WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’\-]*")


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []          # (tag, attrs dict)
        self.blocks = []         # dicts: text, tag, section, step, svg, glossary, figure
        self.buf = None
        self.aria = []           # (label, section)
        self.ids = []
        self.figures = []        # per <figure>: {"svg": bool, "aria": bool, "lookat": bool}
        self.glossary_terms = []
        self.steps = {}          # section id -> step number
        self.section = None
        self._row_first_cell = False
        self._first_td = False

    # context helpers
    def _has(self, tag=None, cls=None):
        for t, a in self.stack:
            if (tag is None or t == tag) and (cls is None or cls in a.get("class", "").split()):
                return True
        return False

    def _hidden(self):
        return any(t in ("style", "script") or "sr" in a.get("class", "").split() or a.get("aria-hidden") == "true"
                   for t, a in self.stack)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.append(a["id"])
        if "aria-label" in a:
            self.aria.append((a["aria-label"], self.section))
        if tag == "section":
            self.section = a.get("id")
        if tag == "figure":
            self.figures.append({"svg": False, "aria": False, "lookat": False})
        if tag == "svg" and "dg" in a.get("class", "").split() and self.figures and self._has("figure"):
            self.figures[-1]["svg"] = True
            self.figures[-1]["aria"] = bool(a.get("aria-label", "").strip())
        if tag in VOID:
            return
        self.stack.append((tag, a))
        if tag in BLOCKS and self.buf is None:
            self.buf = []
            self._row_first_cell = tag == "td" and self._first_td
        if tag == "tr":
            self._first_td = True
        elif tag == "td":
            self._first_td = False

    def handle_startendtag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.append(a["id"])
        if "aria-label" in a:
            self.aria.append((a["aria-label"], self.section))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        # pop to the matching tag (tolerates sloppy nesting)
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                if tag in BLOCKS and self.buf is not None and not any(t in BLOCKS for t, _ in self.stack[:i]):
                    self._flush(tag)
                del self.stack[i:]
                break
        if tag == "section":
            self.section = None

    def _flush(self, tag):
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        self.buf = None
        if not text:
            return
        in_gloss = self.section in GLOSSARY_IDS
        if in_gloss and tag == "td" and self._row_first_cell:
            self.glossary_terms.append(text.lower())
        if tag == "figcaption" and self.figures and text.lower().startswith("look at:"):
            self.figures[-1]["lookat"] = True
        self.blocks.append({"text": text, "tag": tag, "section": self.section,
                            "figure": self._has("figure"), "glossary": in_gloss})

    def handle_data(self, data):
        if self._hidden():
            return
        if self._has("svg"):
            if self._has("text"):
                self.blocks.append({"text": data.strip(), "tag": "svgtext", "section": self.section,
                                    "figure": True, "glossary": False})
            return
        if self.buf is not None:
            self.buf.append(data)
        elif data.strip() and self.section is not None:
            self.blocks.append({"text": data.strip(), "tag": "loose", "section": self.section,
                                "figure": self._has("figure"), "glossary": self.section in GLOSSARY_IDS})


def syllables(word):
    w = word.lower().strip("'’-")
    if len(w) <= 3:
        return 1
    w = re.sub(r"(?:[^laeiouy]es|ed|[^laeiouy]e)$", "", w)
    w = re.sub(r"^y", "", w)
    return max(1, len(re.findall(r"[aeiouy]{1,2}", w)))


def load_terms(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\|\s*([^|]+?)\s*\|", line)
        if not m or m.group(1) in ("Term",) or set(m.group(1)) <= set("-: "):
            continue
        rows.append([v.strip() for v in m.group(1).split("/") if v.strip()])
    return rows


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 2
    page_path = argv[0]
    words_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "references", "plain-words.md")
    if "--words" in argv:
        words_path = argv[argv.index("--words") + 1]
    size = DEFAULT_SIZE
    if "--size" in argv:
        size = argv[argv.index("--size") + 1].upper()
        if size not in SIZES:
            print(f"unknown size {size!r}; use one of {', '.join(SIZES)}")
            return 2
    raw = open(page_path, encoding="utf-8").read()
    p = Page()
    p.feed(raw)

    # step sections: a section whose .sn badge is a number
    step_nums = re.findall(r'<section class="sec" id="([^"]+)">\s*<div class="sh"><span class="sn">(\d+)</span>', raw)
    step_ids = {sid for sid, _ in step_nums}
    steps = len(step_nums)

    prose = [b for b in p.blocks if b["tag"] in PROSE and not b["glossary"]]
    visible = [b for b in p.blocks if b["tag"] != "svgtext"]
    n_words = sum(len(WORD.findall(b["text"])) for b in visible)

    sentences = []
    for b in prose:
        for s in re.split(r"(?<=[.!?])\s+", b["text"]):
            w = WORD.findall(s)
            if w:
                sentences.append(w)
    all_w = [w for s in sentences for w in s]
    avg = len(all_w) / len(sentences) if sentences else 0.0
    grade = (0.39 * avg + 11.8 * (sum(syllables(w) for w in all_w) / len(all_w)) - 15.59) if all_w else 0.0

    step_words = {}
    for b in p.blocks:
        if b["section"] in step_ids and b["tag"] == "p" and not b["figure"]:
            step_words[b["section"]] = step_words.get(b["section"], 0) + len(WORD.findall(b["text"]))
    long_steps = {k: v for k, v in step_words.items() if v > COMMON["step_words_max"]}

    figs = [f for f in p.figures if f["svg"]]
    no_aria = sum(1 for f in figs if not f["aria"])
    no_look = sum(1 for f in figs if not f["lookat"])

    # jargon: prose, diagram labels and aria-labels outside the glossary
    scan = " \n ".join([b["text"] for b in p.blocks if not b["glossary"]] +
                       [lbl for lbl, sec in p.aria if sec not in GLOSSARY_IDS])
    # proper names from the example (e.g. "Ledger API") may be listed, comma-separated, in
    # <meta name="plain-allow" content="...">; they are removed from the scan. Names only, never generic terms.
    allow = re.search(r'<meta name="plain-allow" content="([^"]*)"', raw)
    for name in (allow.group(1).split(",") if allow else []):
        if name.strip():
            scan = re.sub(re.escape(name.strip()), " ", scan, flags=re.I)
    gloss = set(p.glossary_terms)
    hits = []
    for variants in load_terms(words_path):
        if any(v.lower() in gloss for v in variants):
            continue
        for v in variants:
            n = len(re.findall(r"(?<![\w-])" + re.escape(v) + r"s?(?![\w-])", scan, re.I))
            if n:
                hits.append(f"{v}×{n}")

    external = re.findall(r'(?:src|href)\s*=\s*["\'](?:https?:)?//[^"\']*|<script[^>]+\bsrc=|@import|url\((?!#)[^)]*\)'
                          r'|<link[^>]+rel=["\']?stylesheet', raw, re.I)
    dup_ids = sorted({i for i in p.ids if p.ids.count(i) > 1})
    placeholders = sorted(set(re.findall(r"\{\{[A-Z0-9_]+\}\}", raw)))

    L = dict(COMMON, **SIZES[size])
    lo, hi = L["steps"]
    print(f"size {size}: under {L['words_lt']} words, {lo}-{hi} steps\n")
    gates = [
        ("visible words", n_words, f"< {L['words_lt']}", n_words < L["words_lt"]),
        ("steps", steps, f"{lo}-{hi}", lo <= steps <= hi),
        ("figures", len(figs), f"<= steps+{L['figures_over_steps']} ({steps + L['figures_over_steps']})",
         len(figs) <= steps + L["figures_over_steps"]),
        ("longest step (words)", max(step_words.values(), default=0), f"<= {L['step_words_max']}"
         + (f"  over: {', '.join(f'{k}={v}' for k, v in long_steps.items())}" if long_steps else ""), not long_steps),
        ("avg sentence (words)", round(avg, 1), f"<= {L['sentence_avg_max']}", avg <= L["sentence_avg_max"]),
        ("reading grade (F-K)", round(grade, 1), f"<= {L['grade_max']}", grade <= L["grade_max"]),
        ("jargon outside glossary", len(hits), "0" + (f"  found: {', '.join(hits)}" if hits else ""), not hits),
        ("glossary terms", len(gloss), f"<= {L['glossary_max']}", len(gloss) <= L["glossary_max"]),
        ("figures without aria-label", no_aria, "0", no_aria == 0),
        ("figures without 'Look at:'", no_look, "0", no_look == 0),
        ("external refs", len(external), "0" + (f"  found: {external[:3]}" if external else ""), not external),
        ("duplicate ids", len(dup_ids), "0" + (f"  found: {dup_ids[:5]}" if dup_ids else ""), not dup_ids),
        ("unreplaced placeholders", len(placeholders), "0" + (f"  found: {placeholders}" if placeholders else ""),
         not placeholders),
    ]
    width = max(len(g[0]) for g in gates)
    for name, val, limit, ok in gates:
        print(f"{'ok  ' if ok else 'FAIL'}  {name:<{width}}  {val!s:>6}   limit {limit}")
    failed = [g for g in gates if not g[3]]
    print(f"\n{len(gates) - len(failed)}/{len(gates)} gates pass" + ("" if not failed else " — fix and re-run"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
