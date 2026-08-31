---
description: Build a NEW scrollytelling "journey page" in the family style and one-up the reigning champion in the ledger
argument-hint: <topic>  [--out <path>] [--repo <repo-name>] [--title "..."]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, Skill
---

# /generate-journey-page

Build a **brand-new** single-file scrollytelling "journey page" about **$ARGUMENTS**, in the established
family style, AND beat the current champion recorded in the ledger. This command is a **ratchet**: every run
must out-do the best prior page on at least one axis and debut at least one technique no prior page has used.

This is not a reskin generator. If the output looks like a recolored copy of a prior page, the run has failed.

---

## How the topic + output are passed

- **`$ARGUMENTS` = the topic** (everything the user typed after the command), e.g.
  `/generate-journey-page how our rate-limiter survives a thundering herd`.
- **Optional flags inside `$ARGUMENTS`:**
  - `--out <path>` — write the page to an explicit path. Overrides the default entirely.
  - `--repo <name>` — write to `~/Projects/<name>/docs/<slug>.html` (creating `docs/` if needed) instead of the current repo.
  - `--title "..."` — force the page's display title; otherwise derive one from the topic.
- **Default output (no flags): the `docs/` folder of the repo the command is run in.** Resolve it like this:
  1. `REPO_ROOT="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)"` — the root of whatever git repo the current
     working directory is inside.
  2. If `REPO_ROOT` is non-empty → output path is **`$REPO_ROOT/docs/<slug>.html`**.
     If the CWD is **not** inside a git repo → fall back to **`$PWD/docs/<slug>.html`**.
  3. **Create the `docs/` directory if it doesn't exist** (`mkdir -p "<dir>/docs"`), then write the page there.
  4. **Echo the resolved absolute path before writing**, so it's clear where the page is landing.
  - `<slug>` is the kebab-cased topic, truncated to ~6 words (e.g. `thundering-herd-rate-limiter`).
- **Ledger is GLOBAL — one ratchet across every repo:** `~/Projects/.claude/journey-pages/ledger.md`.
  Always read + update it regardless of where the page itself lands (the pages live in their repos' `docs/` folders; the
  ledger is the single cross-repo competition). Record the page's repo-relative path (e.g. `<repo>/docs/<slug>.html`)
  in the Scoreboard row.
- If `$ARGUMENTS` is empty, ask the user for a topic before doing anything else.

Strip the flags out of `$ARGUMENTS` before treating the remainder as the topic text.

---

## STEP 1 — Read the ledger and study the reigning champion (MANDATORY, do this first)

1. **Read** `~/Projects/.claude/journey-pages/ledger.md` in full.
2. Find the **reigning champion** = the Scoreboard row with the highest **Total** (also marked 👑).
3. **Open the champion's actual file** and study it — do not rely on the ledger's summary alone. Use a subagent
   (`Agent`, `general-purpose`) if it's large, asking it to confirm the champion's single most impressive
   technique and weakest rubric axis from the source.
4. **Write down, in your reply to the user, before building:**
   - the champion's **single most mind-blowing technique** (verified against the file), and
   - its **weakest rubric axis** (the opening you'll attack).
5. **Read the "Techniques already used (NO-REPEAT LIST)"** and the **"Unexplored frontier"** sections of the ledger.
   Keep the no-repeat list in mind for the whole run — your signature move(s) must not duplicate anything on it.
6. **Declare an "escalation thesis"** in writing:
   - the **≥1 never-before-used signature move** this run will debut (name it specifically — e.g. "WebGL fragment-shader
     heat-haze," "verlet-physics rope," "SVG path-morph between two glyphs," "flow-field particle advection"); and
   - **which rubric axis** it will beat the champion on, and how, **without regressing any other axis**.
   - Prefer pulling from the **Unexplored frontier** list — that is the surest way to clear Motion/Technical-daring.
   - Beating only on **Cohesion** (out-focusing a busy champion) is legitimate and often the cheapest win, but you
     STILL must debut a new signature move (the ratchet has two independent requirements: a new move AND a higher axis).

Do not start building until Step 1 is written out.

---

## STEP 2 — Invent something genuinely new, then build it

### 2a. Invent (no reskinning)
Each run must invent **its own** metaphor, narrative arc, color story, and centerpiece. The metaphor must be
**materially different** from all six baseline pages and any prior run (no second prairie, no second "collapse to
one," no second masking-flip, no second beam/convergence unless radically re-conceived). When in doubt, pick a
metaphor from a different domain entirely (physics, biology, cartography, music, weather, geology, networks, games).

### 2b. The SHARED DNA every journey page MUST have
(Confirmed from the six baseline pages — match this contract.)

- **Self-contained single-file deliverable**: one `.html` (or, if `--repo` targets a React app and the user asks,
  one self-sufficient `.tsx` view). **Zero external animation/JS libraries** — pure vanilla JS + Canvas 2D + SVG +
  CSS keyframes (+ WebGL/WebGPU/WebAudio/View-Transitions are allowed since they're browser-native, not libraries).
  **Google Fonts is the only allowed CDN.** No React/Vue/GSAP/Three/D3/anime.js/etc. unless writing a `.tsx` into an
  app that already bundles React — even then, no animation libs.
- **7–10 scrolly scenes/acts**, ~90–200vh each, with **≥1 pinned/sticky centerpiece** driven by local scroll progress
  (`local = (scrollY - top) / (offsetHeight - innerHeight)` clamped 0–1).
- **`.rv`/`.reveal` IntersectionObserver entrances** (translateY + opacity, staggered `d1`–`d6`, cubic-bezier ease).
- **Top scroll-progress bar** (~3px, `transform: scaleX(var(--progress))`, risk→safe gradient) **and/or** a side
  **depth/fill meter**; plus a **side nav** (minimap dots or depth meter).
- **Count-up metrics from REAL or clearly-labeled-placeholder data** (cubic ease-out, rAF, `toLocaleString`).
- **One arrival burst/confetti** (gravity particle explosion) OR a deliberate, earned calm finale.
- **One genuinely interactive centerpiece** — live computation, draggable inputs, or a scroll-scrubbed transformation.
  **Decoration alone does not count.** It should compute or transform something real in front of the user.
- **Dark base** (`#060912` / `#0a0c14` / `#0a0f1d`), **Fraunces** display serif + **Inter** sans + **JetBrains Mono**;
  glassmorphism cards (`backdrop-filter: blur()+saturate()`); palette drawn from cyan/brand `#38e0f2`, emerald
  `#34d399`, rose `#f43f5e`, gold/wheat `#fbbf24`/`#fb923c`, violet `#a78bfa`, sky `#38bdf8`.
  (Note: only one baseline page actually shipped Fraunces — **use it**; it's an easy polish edge.)

### 2c. Non-negotiable craft (the gate checks these)
- **Respect `prefers-reduced-motion`** — both a CSS `@media` block AND a JS `REDUCED` flag that short-circuits
  count-ups (jump to final), canvas/particle loops (static), confetti, smooth-scroll → `auto`, and any scrubbed motion.
- **Render readably if JS fails** — content visible by default; add `html.js` only once JS runs; a ~2.2s failsafe
  `revealAll()`; wrap `init()` in try/catch; a `window.onerror` handler that reveals everything and shows a visible
  (non-silent) error bar rather than a blank page. Avoid making *core narrative prose* JS-injected.
- **Cull heavy canvas/WebGL on mobile** — early-return particle/shader loops on touch/`hover:none` or `<=640px`;
  cap DPR (≤2); reduce element counts. Never ship an uncapped thousands-of-sprites loop to phones.
- **Real or clearly-labeled-placeholder data** — if synthetic, say so on the page. Include **honest caveats over hype**
  (the strongest baseline pages each have an explicit "honest about the edges" beat).
- Performance: throttle scroll work via rAF; pause loops on `visibilitychange`; use `ResizeObserver`.

### 2d. Build
Write the file to the resolved output path. You may delegate independent chunks (e.g. data prep, one self-contained
canvas module, copywriting per scene) to subagents, but **you** assemble and own the final single file. After writing,
spot-open the file to sanity-check structure (don't re-read the whole thing if Write succeeded).

---

## STEP 3 — Self-critique against the champion (HARD GATE — do not skip, do not ship a tie)

Score your new page on all five axes (Motion innovation · Narrative · Visual polish · Technical daring · Cohesion,
each 1–10), calibrated **against the baseline pages** so the numbers stay comparable. Be honest — inflated scores
poison the ratchet. Then check the gate:

**The new page passes ONLY IF both are true:**
1. **Novel-move check** — it debuts ≥1 signature move that is **absent from the ledger's "Techniques already used"
   list** (across the whole corpus, not just the champion).
2. **Strictly-better check** — it scores **strictly higher than the champion on ≥1 axis** (a tie fails) **and does not
   regress below the champion on any other axis** (matching the champion on the other axes is fine).

If either check fails: **iterate on the page** (deepen the centerpiece, push the novel move further, tighten the
narrative/cohesion, raise polish) and re-score. **Do not finish on a tie or a regression.** If after honest effort you
genuinely cannot beat the champion, say so explicitly to the user rather than fudging the scores — but exhaust real
iteration first. A useful adversarial check: spawn a subagent to try to *refute* your self-scores ("argue this page is
NOT better than the champion on axis X") and only keep the win if it survives.

---

## STEP 4 — Record (the ratchet only goes up)

Update `~/Projects/.claude/journey-pages/ledger.md`:
1. **Append a new Scoreboard row** (with the page's slug, title, today's date, the 5 axis scores, Total, and file path).
   Re-sort the Scoreboard by Total, descending.
2. **Move the 👑** to the new page if it dethroned the champion; otherwise leave it (the new page still gets logged).
3. **Add a Baseline-page-detail-style entry** for the new page (metaphor/arc, signature move, interactive centerpiece,
   why it scored as it did).
4. **Add the new signature move(s)** to the **"Techniques already used (NO-REPEAT LIST)"** so the next run can't reuse them.
   If you used something from the **Unexplored frontier**, remove it from that list (it's explored now).
5. **Prepend a Run-log entry** using the template at the bottom of the ledger.
6. **Raise "Next Must Beat"** — set a fresh, harder bar (new champion Total + which axes are now the hardest to exceed).

---

## STEP 5 — Report to the user

Close out with: the output file path, the new page's title + metaphor, its 5-axis self-score + Total, whether it
dethroned the champion, the specific never-before-used signature move it debuted, and a one-line "to view it" hint
(e.g. `open <path>` for a standalone `.html`). Note anything you left unverified (e.g. "scored by inspection, not
opened in a browser") — honesty over hype, same as the pages themselves.

---

### Quick reference
- Ledger (GLOBAL, one ratchet for all repos): `~/Projects/.claude/journey-pages/ledger.md`
- Default output: **`<repo-root>/docs/<slug>.html`** — the `docs/` folder of the repo the command is run in
  (`git rev-parse --show-toplevel`; if not in a repo, `<CWD>/docs/<slug>.html`). Create `docs/` if missing; echo the path first.
- Baseline exemplars to study (don't copy): the six local journey pages the ledger already
  tracks — two from a Postgres knowledge-management app (one React view, one static HTML),
  two from a Python data-masking app (both static HTML), and two from a member-profile app
  (a journey page and a showcase deck). Read them from the paths recorded in the ledger;
  they are private and are deliberately not listed here.
- Two independent requirements every run: **(a) a signature move new to the whole corpus** AND **(b) strictly beat the champion on ≥1 axis with no regression.**
