---
name: plain-walkthrough
description: Explain a complicated system to non-engineers as a plain-language walkthrough page — one real example followed step by step, one everyday comparison, a short glossary — sized S/M/L/XL (under 1,000 / 2,000 / 3,000 / 4,000 words). One self-contained HTML file, light and dark, gated by a checker for length, reading level and jargon. Fire on `/plain-walkthrough` or "explain this system in plain English / for a non-technical reader / so my boss can follow it". Not for shortening an existing page (`/plain-cut`), ratcheted scrollytelling journey pages (`/generate-journey-page`), or engineer-facing design docs (`/gen-sys-doc`).
argument-hint: "[repo-path | subsystem | topic] [--size S|M|L|XL] [--out <path>] [--for \"<reader>\"]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, AskUserQuestion
---

# /plain-walkthrough

Write one page that lets someone who has never written software understand what a system does and why. **One real example is followed step by step.** In each step, the reader sees what came in, what changed and what happens next. The model is `twin-compiler/docs/proposals/tc-sys-view-turns.html`, **made simpler.** That page runs to about 6,000 words, with 9 turns, 3 interludes, two analogies and several deep-dives. This skill caps every size below it, allows one comparison, and allows no deep-dives.

The page fails if the reader has to know a technical word to follow it. It also fails if it is true but reads like a manual. Explain by *showing the example happen*, not by listing parts.

## Arguments

- **Target** (first positional): a repo path, a named part of the current repo ("the billing sync"), or a topic. Default: the current repo, whole system.
- **`--size S|M|L|XL`**: word budget. Default **M**.

  | Size | Words (strictly under) | Steps | Glossary |
  |---|---|---|---|
  | S | 1,000 | 3–5 | ≤ 5 |
  | M | 2,000 | 4–6 | ≤ 8 |
  | L | 3,000 | 5–8 | ≤ 10 |
  | XL | 4,000 | 6–9 | ≤ 12 |

- **`--out <path>`**: default `<repo>/docs/<slug>-walkthrough.html`. Never overwrite. If the file exists, append `-2`, `-3`, … and say so.
- **`--for "<reader>"`**: who reads it. Default: *a smart adult who has never written software.* It shapes the comparison and the example, not the word budget.

Echo the resolved target, size, reader and out path before starting.

## Step 1: Understand the system (for yourself, not the page)

Read `CLAUDE.md`, `README.md`, the roadmap, any design or system docs, and the entry points. For a large repo, dispatch **one `sonnet` Explore agent** (state it in a dispatch line). It returns a fact sheet:
- what goes in;
- what comes out;
- the handful of things the system does in between, in order;
- what it refuses or protects;
- where it spends money or time.

**Every line is cited `file:line`.** The citations are for you. They never appear on the page. A claim you cannot cite does not go on the page.

## Step 2: Find something real to show

The running example should be something the system actually handles. **Prefer an input the tests or fixtures already use.** Their names and contents are real, and "the tests check this" is the strongest thing the page can say. Run the example if you can, so any number on the page is one the system printed. **If nothing can be run, the page shows no numbers.** Never invent a count, a cost or a percentage.

## Step 3: Outline, then confirm once

Draft the outline in chat and confirm it with **one** AskUserQuestion. Offer: approve / change the example / change the comparison. The outline has:
1. **The example**, in one sentence.
2. **The steps.** Each is a plain heading ("A second letter disagrees") plus the **one new idea** it adds. No step adds two. The number of steps must fit the size.
3. **The comparison**: one everyday thing (a ledger, a library card index, a sorting office, a recipe card). Say where in the steps the reader will already have seen it happen, and give up to 3 points where it stops holding.
4. **The glossary words**, within the size cap. Each must be a word the reader will meet again outside this page. Otherwise, replace it.

## Step 4: Write the page

Start from `assets/chassis.html`. Fill every `{{PLACEHOLDER}}`:
- `TITLE`, `DESCRIPTION`, `SITE_NAME`, `KICKER`, `H1`, `LEDE`, `FOOTER`;
- `THEME_KEY`: a short slug, e.g. `pw-billing`;
- `ALLOW`: the proper names from the example that contain a listed word, e.g. `Ledger API`. **Only names. Never a generic term.** Leave it empty if there are none;
- `BODY`.

Build `BODY` from the blocks in `assets/components.html`, in this order:

1. **What goes in and what comes out**: one figure and 2–3 sentences.
2. **Steps 1…N.** Each step has:
   - a plain heading;
   - a one-line setup (`p.sub`);
   - one figure with a `Look at:` caption and a matching `aria-label`;
   - the three-box strip **What came in / What changed / What happens next**;
   - at most **150 words** of prose.
3. **The comparison**, named *after* the reader has watched it happen. Map it part by part in a small table, then add **Where the comparison stops** (≤ 3 points).
4. **What is real here**: what was run or tested to make the page, where each number came from, and what was simplified or left out.
5. **Words used on this page**: the glossary, in `<section id="words">`.

Add a contents list (`.toc`) only at L or XL.

### Writing rules

- **Short sentences in everyday words.** Aim for about 12 words per sentence. One idea per sentence.
- **Say what happens, with the example's own names.** Write "the letter from Leeds is kept exactly as it arrived", not "inputs are persisted immutably".
- **No code, file paths, function names, command names or version numbers in the visible text.** The one exception is the names of things *inside the example*.
- **Define a word the first time it is needed**, in the same sentence, with `<dfn>`. Then put it in the glossary. If the glossary is full, find a plainer word.
- Every term in `references/plain-words.md` is out, unless the glossary defines it. Use the replacement column.
- **One comparison per page.** A second one is a sign the steps are doing too much.
- **No side sections**: no "how the number is worked out", no tables of every field. If a detail matters, it goes in the step where it happens, in one sentence.
- **Show doubt honestly.** A guess is drawn dashed and a fact solid. When the system can go backwards (less sure after new information), show it happening. Don't smooth it over.

### Figure rules (see the comment at the top of `components.html`)

- One idea per figure and ≤ ~12 labelled things. Text at 16px or more. Hand-drawn inline SVG using the chassis classes only.
- The figure count is at most steps + 2.
- A filled box is the part that did work in this step. An outlined box is idle. Dashed means a guess.
- Keep the same shapes in the same places from step to step, so the reader's eye learns the layout once.

## Step 5: Check

```
python3 ~/.claude/skills/plain-walkthrough/check.py <out.html> --size <S|M|L|XL>
```

It gates:
- word count, steps, figures and words per step;
- average sentence length (≤ 15) and reading grade (Flesch-Kincaid ≤ 8);
- jargon outside the glossary and glossary size;
- an `aria-label` and a `Look at:` caption on every figure;
- self-containment (no external `src`/`href`, `<script src>`, `@import`, or `url()` other than the in-page arrow markers), unique ids, and no leftover placeholders.

Fix the page until every gate passes. **Never edit `check.py`'s limits or delete a `plain-words.md` row to make a gate pass.** Rewrite the page. When a run finds a technical word that slipped past the list, add it to `plain-words.md`.

## Step 6: Look at it

```
~/.claude/skills/plain-walkthrough/shoot.sh <out.html> /tmp/pw-shots
```

It writes 2,400 px tiles for light and dark, at 1280 px and 390 px (`light-1280-00.png`, …). **Open every tile with Read.** The script works around two quirks of headless Chrome. It will not lay out narrower than about 500 px, and it does not paint after a scroll or an `#anchor` jump. So each tile loads the page in an iframe of the right width, shifted by the tile's offset. `--blink-settings=preferredColorScheme=1` forces light mode, which is needed because Chrome otherwise follows the Mac's theme. Check for these:
- labels overlapping or clipped;
- text that disappears in dark mode (every SVG fill must use a class, never a hard-coded colour);
- the strip collapsing to one column on the phone shot. On a phone, figures scroll sideways inside their frame, and that is expected;
- a figure you would not understand without the prose.

The last one is a failure: redraw it.

## Step 7: Report

In a few lines, give:
- the path;
- the size, and each gate's value against its limit;
- the screenshot tiles you opened;
- the example used, and whether it was actually run;
- anything left unverified, such as a claim you could not cite that you therefore left out, or a number you could not produce.

**Never commit.** Hand off to `/shipit`.
