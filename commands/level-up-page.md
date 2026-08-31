---
description: Improve an EXISTING web page with every loop — a versioned, never-overwrite ratchet that must beat the reigning champion in a per-page ledger
argument-hint: [source.html] [--stem <name>] [--out-dir <path>] [--axis <name>]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, Skill
---

# /level-up-page

Take an **existing** page and produce a **better** version of it — then do it again, and again, each run
out-doing the last. This is the `/generate-journey-page` ratchet pointed at an existing artifact instead of a
blank topic: every run must beat the reigning champion on ≥1 scored axis **and** debut at least one technique no
prior version used. A version that merely reskins the champion has failed.

**Two hard rules that define this command:**
1. **Never overwrite.** Output always lands in a NEW, auto-incrementing file `<stem>-vN.html`. The original source
   page, every prior version, and the ledger history are append-only and untouchable.
2. **The ratchet only goes up.** No ties, no regressions. If a run can't honestly beat the champion, say so — don't
   fudge the score.

---

## How arguments resolve

- **`$ARGUMENTS` first positional (optional)** = the **source page** to improve, e.g. `/level-up-page index.html`.
  If omitted, auto-detect the primary page: the largest `*.html` at the repo root, else the one referenced by the
  most assets, else ask the user.
- **Flags inside `$ARGUMENTS`:**
  - `--stem <name>` — filename stem for versions + ledger (default: the source basename without extension; e.g.
    `index.html` → stem `index`). Use this when the versions should be named differently from the source.
  - `--out-dir <path>` — directory for versions + ledger (default: the source page's own directory, so relative
    asset paths like `img/…`, `assets/…`, and `<script src="data.js">` resolve identically to the source).
  - `--axis <name>` — force which rubric axis this run targets (otherwise attack the champion's weakest).
- **Resolve and ECHO before doing anything:** source path, out-dir, stem, the next version number `N`, and the
  ledger path. Compute `N` by scanning `<out-dir>/<stem>-v*.html` for the highest existing integer and adding 1 —
  **never** assume `v1` if higher versions exist.

The ledger is **per page (per stem)**: `<out-dir>/<stem>-ledger.md`. It is the single competition for this page
across all its versions. (Contrast with `/generate-journey-page`, whose ledger is one global cross-repo ratchet.)

---

## STEP 1 — Read the ledger, study the reigning champion (MANDATORY, first)

1. **If the ledger doesn't exist yet, seed it:** the **source page is the baseline champion** (v0). Read the source
   page (and any CSS/JS/data files it pulls in) and score it honestly on the five axes below; write that as the
   seed Scoreboard row marked 👑, fill the "Techniques already used" list with what the source already does, record
   the source's **layout archetype** in the "Layouts already used (NO-REPEAT)" list, and set the first "Next Must
   Beat" bar. Then continue.
2. **Read the ledger in full.** The **reigning champion** = the Scoreboard row with the highest **Total** (👑).
3. **Open the champion's actual file and study it** — never trust the ledger summary alone. For a large/complex
   champion, delegate to a subagent (`Agent`) to confirm the champion's single most impressive technique and its
   weakest axis from the source.
4. **Write down, in your reply, before building:** the champion's **most impressive technique** and its **weakest
   axis** (the opening you'll attack).
5. **Read the "Techniques already used (NO-REPEAT LIST)" AND the "Layouts already used (NO-REPEAT)" list** — your new
   signature move must not duplicate anything on the former, and your chosen layout archetype must not appear on the latter.
6. **Declare an "escalation thesis" in writing**, three parts:
   - the **NEW layout archetype** this run adopts (§2a.5) and how its bones differ from the champion's — be concrete
     about what gets re-composed, not just "the champion plus X";
   - the **≥1 never-before-used signature move** it debuts (name it concretely); and
   - **which axis** it beats the champion on, **without regressing any other axis**.

Do not start building until Step 1 is written out.

---

## STEP 2 — Build the next version (improve, don't reskin)

### 2a. Preserve the SOUL — REINVENT the SHELL
Split the page in two and treat the halves oppositely. This is the rule that keeps the ratchet from going stale:

- **The SOUL — preserve, never regress.** The real content, data, and facts (don't fabricate or drop any), and the
  brand identity: palette, type system, and voice/tone. If the source is a warm paper scrapbook, every version is
  still recognizably *that* travelogue — same colors, same fonts, same "Vol. I field journal" voice. Reuse the
  source's real assets/data by relative path (e.g. `<script src="data.js">`) instead of duplicating large data blobs.
- **The SHELL — REINVENT every loop.** Layout, section order and composition, the centerpiece, the navigation model,
  and the spatial arrangement of content are **NOT inherited**. Do **not** start from the champion's DOM skeleton and
  bolt new motion onto the same boxes — that is exactly how a ratchet calcifies. Each version must read like a
  *different design of the same material*, not "the champion plus a feature." Same soul, genuinely different bones.

### 2a.5 — Choose a NEW layout archetype (mandatory, anti-staleness)
Read the ledger's **"Layouts already used (NO-REPEAT)"** list and pick a structural paradigm NOT on it. The
champion's archetype is off the table. Examples (not exhaustive — invent your own): vertical editorial scroll ·
horizontal / filmstrip scroll · full-bleed map-first with content over the terrain · magazine / broadsheet grid ·
single-focus deck / slideshow you advance · split-screen (sticky media beside scrolling text) · timeline-as-physical-
spine · masonry mosaic · kinetic-type landing · shuffleable card deck · index / contact-sheet that expands. Recompose
the real content into the new shell — the photos, trips, and trail log are the same; how the reader moves through
them is new.

### 2b. Each version is a self-contained, decoupled file
- Output is **one new `.html`** that owns its own presentation: inline `<style>` and behavior `<script>` so the
  version does **not** depend on the source's CSS/JS files and can never be broken by editing them. (Shared,
  read-only data/asset files referenced by path are fine — they're never overwritten.)
- **Zero external animation/JS libraries.** Pure vanilla JS + Canvas 2D + SVG + CSS keyframes (WebGL/WebGPU/
  WebAudio/View-Transitions allowed — browser-native). Google Fonts is the only allowed CDN.

### 2c. Craft floor (the gate checks these)
- **Respect `prefers-reduced-motion`** — a CSS `@media` block AND a JS `REDUCED` flag that short-circuits count-ups
  (jump to final), particle/canvas loops (static), confetti, smooth-scroll → `auto`, and any scroll-scrubbed motion.
- **Render readably if JS fails** — content visible by default; add `html.js` only once JS runs; a ~2.2s failsafe
  reveal; `init()` wrapped in try/catch; a `window.onerror` handler that reveals everything and shows a visible
  error bar instead of a blank page. Don't make core narrative prose JS-injected.
- **Cull heavy canvas/WebGL on mobile** — early-return on touch/`hover:none`/`<=640px`; cap DPR (≤2); reduce counts.
- **Real or clearly-labeled-placeholder data**; honest caveats over hype.
- Throttle scroll work via rAF; pause loops on `visibilitychange`; use `ResizeObserver`.

### 2d. Build
Write the file to `<out-dir>/<stem>-v<N>.html`. You may delegate independent chunks (one canvas module, per-scene
copy) to subagents, but **you** assemble and own the final single file. Spot-open it after writing to sanity-check
structure (don't re-read the whole thing if Write succeeded).

---

## STEP 3 — Self-critique against the champion (HARD GATE — no ties, no regressions)

Score the new version on all five axes (**Motion innovation · Narrative · Visual polish · Technical daring ·
Cohesion**, each 1–10), calibrated against the champion so the numbers stay comparable. Be honest — inflated
scores poison the ratchet.

**Passes ONLY IF all three are true:**
1. **Layout-divergence check (the anti-staleness gate)** — the version's structure (layout archetype, section
   order/composition, centerpiece, navigation model) is materially different from the champion's, and its archetype
   is absent from the "Layouts already used (NO-REPEAT)" list. **A version that keeps the champion's skeleton and
   only layers on motion/features FAILS this gate even if it scores higher on every axis.** Spot-test: with the
   photos and body copy stripped out, could a reader still tell the two pages apart by structure alone? If not, it's
   a reskin — iterate.
2. **Novel-move check** — debuts ≥1 signature move absent from the ledger's "Techniques already used" list.
3. **Strictly-better check** — scores strictly higher than the champion on ≥1 axis (a tie fails) **and** does not
   regress below the champion on any other axis.

If any fails: **iterate the version** (re-compose into the new shell, deepen the centerpiece, push the novel move,
re-earn polish/cohesion *in the new layout*) and re-score. Don't finish on a reskin, a tie, or a regression. Useful
adversarial check: spawn a subagent to argue (a) the new version is just the champion restructured cosmetically and
(b) it is NOT better on the claimed axis; keep the win only if it survives both. If you genuinely can't beat the
champion after real effort, tell the user — don't fudge.

> **Note on Polish/Cohesion at a ceiling:** once those axes sit at the top, you do **not** win by nudging them —
> you win by re-earning them inside a *new layout* while pushing a different axis. Reinventing the shell is not a
> regression as long as the soul (content, palette, type, voice) is intact and polish/cohesion hold in the new form.

---

## STEP 4 — Record (append-only)

Update `<out-dir>/<stem>-ledger.md`:
1. **Append a new Scoreboard row** (version, title/tagline, date, 5 axis scores, Total, file path). Re-sort by Total desc.
2. **Move the 👑** if the new version dethroned the champion; otherwise leave it (the new version is still logged).
3. **Add a detail entry** for the new version (what it improved, signature move, interactive centerpiece, why it scored as it did).
4. **Add the new signature move(s)** to the **"Techniques already used (NO-REPEAT LIST)."**
5. **Add the version's layout archetype** to the **"Layouts already used (NO-REPEAT)"** list (so the next run must
   pick a different structure).
6. **Prepend a Run-log entry** (note the layout archetype, not just the feature added).
7. **Raise "Next Must Beat"** — a fresh, harder bar, and name which layout archetypes are now spent.

Never delete or rewrite prior rows/entries — the ledger is the audit trail of the ratchet.

---

## STEP 5 — Report to the user

Close out with: the new file path, the version's title/tagline + what it improved over the champion, its 5-axis
self-score + Total, whether it dethroned the champion, the specific never-before-used signature move it debuted,
and a `open <path>` hint. Note anything left unverified (e.g. "scored by inspection, not opened in a browser").

---

### Quick reference
- **Never overwrite:** always write `<stem>-v<N>.html` with `N` = highest existing + 1.
- **Ledger (per page):** `<out-dir>/<stem>-ledger.md`. Seed from the source page as v0 baseline on first run.
- **Default out-dir:** the source page's own directory (so relative asset paths resolve).
- **Three requirements every run:** (a) a **new layout archetype** absent from the ledger (reinvent the shell, keep the soul), (b) a **signature move** new to this page's ledger, AND (c) **strictly beat** the champion on ≥1 axis with no regression. Reskins that only add features fail the layout-divergence gate.
- Sibling command: `/generate-journey-page` (same ratchet, but generates brand-new topic pages against one global ledger).
