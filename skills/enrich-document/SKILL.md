---
name: enrich-document
description: >
  Enrich a target document with (1) navigable internal links — a table of contents plus
  cross-references wired to durable, self-healing in-document anchors; (2) external links —
  named tools, companies, products, and technologies hyperlinked to their canonical
  reference pages; and (3) Claude prompt actions — a small ✶ Claude button on each
  actionable/technical item that previews the exact prompt on hover and copies it to the
  clipboard on click. Presents best-fit output formats up front (recommended one
  highlighted), does its best work in the chosen format, and only at the very end raises
  whether a different file type would produce a materially better result. Use when the
  user wants to enrich, cross-link, add a TOC to, hyperlink, or make a document
  interactive/navigable. Fire on `/enrich-document` or "enrich this doc / add a TOC and
  links / make this document navigable."
argument-hint: "[path/to/document] [--format html|md|hybrid]"
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, WebSearch, WebFetch, Bash(python3:*), Bash(ls:*), Bash(file:*), Bash(open:*), Bash(wc:*)
---

# enrich-document

Enrich a single target document so it is navigable, well-linked, and actionable. You add
**exactly three things**, spelled out in full below because the document and the user's
intent are all you have — do not assume context from any prior conversation.

`$ARGUMENTS` may contain a target path and/or a `--format` flag. If no path is given, look
for the most likely target (a recently-edited `.md`/`.html`/`.txt`/`.docx` in scope, or
ask), then confirm before proceeding.

The skill's own assets live next to this file:
`~/.claude/skills/enrich-document/{assets,scripts,references}/`.

---

## The three enrichments (always all three)

### 1. Navigable internal links — TOC + cross-references on durable anchors

- Build a **table of contents** from the document's headings, each entry an anchor link to
  the corresponding in-document section.
- Add **cross-references**: where the text refers to another section ("see the setup
  section", "as described above", "per the schema below"), turn that reference into an
  internal anchor link.
- Make internal-target resolution **as durable and fault-tolerant as possible**. Tolerate
  heading drift, slug/casing differences, renumbering, and near-miss matches instead of
  emitting dead anchors. The mechanism is provided for you (see *Durability*, below):
  build-time pre-resolution **and** view-time self-healing. Never ship a silently dead
  anchor — unresolved links must be visibly flagged.

### 2. External links — canonical reference pages

- Find named **tools, companies, products, and technologies** (e.g. React, Docker,
  PostgreSQL, Anthropic, Railway, Kubernetes).
- Hyperlink the **first mention** of each to its **canonical** reference page (official
  homepage or official docs).
- Resolution order: check `references/canonical-links.json` first; for anything not there,
  `WebSearch` for the official site and link only when confident it is the canonical
  domain. **When uncertain, leave it as plain text** — a wrong link is worse than no link.
  Do not link generic words, the document's own product, or the same entity more than once.

### 3. Claude prompt actions — hover-preview, click-to-copy

- Put a small **✶ Claude** button on each **actionable or technical** item (steps,
  commands, config/code blocks, named techniques, troubleshooting items, design decisions).
- The button **previews the exact prompt on hover** and **copies it to the clipboard on
  click**. The prompt must be a self-contained, ready-to-paste Claude instruction for that
  item — see `references/prompt-actions.md` for how to write the prompt and the exact
  markup/JSON contract. Signal over noise: skip prose; don't button every paragraph.

---

## Procedure

### Step 0 — Read and inventory the target (silent groundwork)

Read the document. Determine its current format and, briefly, its shape:
- headings (levels + text) → drives the TOC and anchor index;
- internal references in the prose → drives cross-references;
- named tools/companies/products/tech → drives external links;
- actionable/technical items → drives Claude prompt actions.

### Step 1 — Present best-fit output formats FIRST (recommended highlighted)

Before doing any enrichment work, present a **short list of the best-fit output formats**
for *this* document via `AskUserQuestion`, with the **recommended** option first and
labeled "(Recommended)", and a **one-line rationale** for why someone might pick each.
Tailor the list to the document, but the core options are:

- **Self-contained HTML** — *Recommended when the Claude prompt actions matter.* Only
  format that supports all three fully: hover-preview + click-to-copy buttons, AND
  self-healing anchors. One portable file.
- **Markdown (GitHub-flavored)** — *Most portable & diff-friendly.* Native TOC, anchors,
  and external links; but Claude buttons degrade to copyable `<details>` blocks and anchor
  durability is left to the host renderer.
- **Markdown + inline HTML (hybrid)** — *Keep a .md that's richer where HTML is allowed.*
  Real buttons/anchors where HTML renders, graceful text where it doesn't (e.g. GitHub).

Pick the default recommendation by what the document needs: lots of actionable/technical
items → **HTML**; a README / repo doc meant to live in version control → **Markdown**.
If the user passed `--format`, honor it and skip the menu. The chosen format is the
**output** format for this run.

### Step 2 — Do the enrichment, in the chosen format

Apply all three enrichments. Format-specific guidance:

**If HTML (or hybrid):**
1. Convert/emit the document as an HTML **body fragment** (headings keep their text;
   you may add `id`s but the assembler will fill any you miss). Build the TOC as
   `<nav class="cl-toc">…</nav>` with `lvl-N` classes per depth.
2. Add cross-reference and TOC links as `<a href="#slug">`.
3. Add external links per enrichment #2.
4. Add Claude buttons per enrichment #3, and collect their prompts into a `prompts.json`
   map (`{ "p-id": "prompt text" }`) — see `references/prompt-actions.md`.
5. Assemble the single self-contained file with the provided script (this inlines CSS/JS,
   ensures heading ids + aliases, and **pre-resolves every internal link**, reporting any
   it cannot match):

   ```bash
   python3 ~/.claude/skills/enrich-document/scripts/assemble_html.py \
     --body /path/body.html --prompts /path/prompts.json \
     --title "Doc Title" --out /path/<name>.enriched.html
   ```
   Read the script's stderr report. If it lists dead links, fix the source reference and
   re-run — do not ship dead anchors.

**If Markdown:**
1. Generate a TOC with GitHub-compatible slugs (lowercase; strip punctuation; spaces→`-`;
   de-dupe with `-1`, `-2`). To harden against heading edits, also drop an explicit
   `<a id="stable-slug"></a>` immediately above each heading so links keep resolving even
   if the heading text later changes.
2. Add cross-reference links `[text](#slug)` using the same slugs.
3. Add external links `[name](https://canonical)` per enrichment #2.
4. Add Claude prompt actions as the degraded `<details>` + copyable code-fence form from
   `references/prompt-actions.md`.

To sanity-check slugs/links in Markdown, you can also run the resolver: convert headings +
intended targets to a tiny HTML body and run `assemble_html.py` purely for its dead-link
report, or just verify each target slug exists in your TOC.

### Step 3 — Closeout report

State plainly what you added: counts of TOC entries, cross-references, external links, and
Claude prompt actions; the anchor report (exact / healed / **dead**); and any external
links you deliberately left unlinked because the canonical URL was uncertain. Give the
output path. Follow the repo working agreement: done / not done / unverified / risky.

### Step 4 — ONLY NOW: would a different file type be materially better?

After the work is done, and **only at the very end**, raise whether a *different* output
format would genuinely produce a better result — and only if the gain is real, not as
boilerplate. Typical case: the user chose Markdown for portability, but the document turned
out to be dense with actionable items, so the hover-preview/one-click-copy Claude buttons
and self-healing anchors would be materially better as **HTML**. Name the concrete benefit
and offer to also produce that version. If the chosen format already maximizes the
document's value, say so and stop.

---

## Durability (how internal anchors survive drift)

Resolution is **belt-and-suspenders** and you get both layers for free:

- **Build time** — `assemble_html.py` ensures every heading has a stable id plus a
  de-numbered alias, then pre-resolves each internal link against the real headings using
  exact-id → normalized-slug → alias → de-numbered → fuzzy (≥ 0.5) matching, and reports
  anything it cannot match.
- **View time** — `assets/enrich.js` re-runs the same resolver in the browser on load and
  on `hashchange`. So if headings are edited *after* generation (renamed, renumbered, case
  changed), links re-resolve to the closest current heading instead of breaking. Truly
  unresolvable links are marked `data-anchor-dead` and shown with a wavy red underline —
  visible, never silent.

The normalize/slug/fuzzy logic is intentionally identical in `enrich.js` and
`assemble_html.py`; keep them in sync if you change one.

## Format capability matrix (be honest about degradation)

| Enrichment                    | HTML | Markdown (GitHub) | Hybrid |
|-------------------------------|------|-------------------|--------|
| TOC + cross-ref anchors       | ✅ self-healing | ✅ renderer-dependent | ✅ |
| External canonical links      | ✅ | ✅ | ✅ |
| Hover-preview of prompt       | ✅ | ❌ (degraded) | ⚠️ where HTML renders |
| One-click copy of prompt      | ✅ | ⚠️ via code-block copy button | ⚠️ |

Always tell the user which capabilities degraded in the format they chose — that honesty
is what the Step 4 alternative-format raise is built on.

## Notes

- Work on a copy / new output file; never destroy the original (`<name>.enriched.html` or
  `<name>.enriched.md` beside it unless told otherwise).
- This skill enriches **one document**. For DOCX/PDF sources, read the text (convert if
  needed) and treat HTML or Markdown as the output target; clipboard/hover are not
  achievable in PDF/DOCX, so note that if the user wants those.
