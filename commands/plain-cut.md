---
description: Rebuild an overbuilt page as a plain-language cut — halve the prose, dial the figure back to one idea per beat, strip the drawn-in defensiveness, and carry every self-containment, contrast, theme, motion and register invariant across unchanged. The cut is a NEW file on a shared chassis; the source page and its build inputs are frozen and must still build byte-identically afterward. Fire on `/plain-cut` or "make this readable cold / cut the prose in half / dial the diagram back / a normal person can't follow this". Not for raising a page's ambition (`/level-up-page`), generating a brand-new topic page (`/generate-journey-page`), or copy-only edits to a page whose structure is already right.
argument-hint: <source.html | build-dir> [--out <stem>] [--figure "<one-line brief>"] [--profile <name>] [--no-marks] [--skip-shots]
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, Bash(node:*), Bash(git:*), Bash(shasum:*), Bash(cp:*), Bash(mkdir:*), Bash(ls:*), Bash(find:*), Bash(grep:*), Bash(wc:*), Bash(mv:*)
---

# /plain-cut

Take a page that is **right but overbuilt** and produce a cut a normal person gets on one read — half the
words, a figure that carries one idea per beat instead of nine at once — **without dumbing it down and
without over-proving it.** The two failure modes are symmetrical and both are fatal: a cut that drops the
argument has dumbed it down; a cut that keeps every proof, counter, legend and caveat has over-proved it.
**If the output looks like a recolored copy of the source with sentences deleted, the run has failed.** Say
so and iterate — do not ship it.

**The non-negotiable: the incumbent is frozen.** The source page, its template, and every build input that
feeds it are read-only for the entire run. The cut is a NEW file assembled on a NEW shared chassis. At the
end, every incumbent page must still build **byte-identically** — proven with a command, not asserted. A run
that improves the cut and perturbs an incumbent is a failed run even if the cut is excellent.

**Measure before you diagnose.** The obvious reading of "too complicated" is "the words are too hard," and
it is usually wrong. Compute reading level across the page family first. If the target already has the
plainest prose of its siblings, a synonym pass is not just useless — it is the move someone already made,
and the complication is structural: redundant copy layers, and a figure drawn at a scale nobody can read.

---

## How arguments resolve

- **`$ARGUMENTS` first positional** = the **source**: a built `.html` page, or a build directory holding the
  template that generates it. If it is a build directory, the template inside is the source of truth and the
  built pages are outputs — never edit a built output.
- **Flags parsed out of `$ARGUMENTS`:**
  - `--out <stem>` — output stem (default `<source-stem>-plain`). Always a NEW file; if the target exists,
    append `-2`, `-3`, … and say so. Never overwrite.
  - `--figure "<brief>"` — one line naming the single idea the cut's figure must carry per beat. If omitted,
    derive it from the source figure and **echo it before building.**
  - `--profile <name>` — validator profile for the cut (default: derive from the out stem).
  - `--no-marks` — skip brand-mark inlining.
  - `--skip-shots` — skip screenshots. **Only honour this if the user typed it**, and record in the report
    that the layout is unproven.
- **If `$ARGUMENTS` is empty after stripping flags:** do not guess and do not fall back to the most recently
  modified file. List the candidates — every `*.html` at the repo root plus every `build/*/*template*.html` —
  with sizes, and ask which to cut. Stop until answered.
- **Resolve and ECHO before doing anything:** repo root, source path, chassis path, out path, profile name,
  validator path, screenshot out-dirs (one per theme).

---

## STEP 1 — Freeze the incumbents and record the baseline (MANDATORY, first)

1. **Enumerate the frozen set** — every file the incumbent pages build from, and every built page. State the
   list explicitly in your reply. Nothing on it may be written for the rest of the run.
2. **Hash them all** (`shasum -a 256`) and paste the hashes into your reply.
3. **Prove the tree is reproducible right now**: run the incumbent build, then
   `git diff --exit-code -- <the built pages>`. It must exit **0**. If it does not exit 0 *before you have
   changed anything*, stop and say so — the tree was already drifted and no byte-identity claim is possible.
4. **Dry-run every literal-string copy patch** the incumbent build depends on and record each patch's
   `entries / applied / healed / miss / ambiguous` line. Those numbers are the lockstep baseline.
5. **Write a `verify-frozen` script** that hashes the frozen set and exits non-zero on drift, so the guarantee
   is re-runnable instead of a one-time observation.

Do not read a line of prose for the cut until Step 1 is written out.

---

## STEP 2 — Measure the source, then set the gates as numbers

Report, for the source page and each of its siblings:
- **visible prose word count** — strip `<style>`, `<script>`, comments, tags, entities, **and `sr-only`
  blocks**; sr-only text is accessibility payload, not prose, and must never be counted or cut;
- **average sentence length and polysyllable rate** — this is the measurement that tells you whether the
  problem is vocabulary or structure;
- **primary-figure element count**, split into raw DOM and **parse units** (things with a name, a border, or
  an arrowhead). Texture fields the reader parses as one object count as one;
- **step / section count.**

Then fix the gates and state them as inequalities:
- **Prose gate:** `cutWords * 2 < sourceWords`. Strictly under half. **No ties.**
- **Figure gate:** `cutParseUnits * 2 < sourceParseUnits`. Strictly under half. **No ties.**
- **Structure gate:** the cut has **strictly fewer** sections, **no ties**, AND its centerpiece is a
  different object — not the source's centerpiece with elements deleted.

Name, in writing, the one claim the cut is built to land. Then confirm every deleted paragraph was either
supporting that claim *redundantly* or supporting a different claim the cut deliberately does not make. An
argument the cut drops entirely is not a win on the prose gate — it is dumbing down.

---

## STEP 3 — Derive the readability law before you touch the figure

Find the line in the source that computes render scale from the figure's frame and the stage box. Then build
the table that inverts it: for the **smallest viewport you intend to support** (not the largest — the laptop,
not the 1440 desktop), what is the widest frame that still renders your smallest type above a **12px floor**?

**Frame size and type size are a single decision, and it is settled per beat, not globally.** Every camera
frame in the cut comes out of that table. Delete every inline `font-size` override in the figure — those are
usually the actual source of unreadable type, not the frame.

Where the figure has zoom, register a `--zoom` custom property alongside the existing progress property,
write it once per frame, and gate the sub-label tier on it: `opacity:clamp(0,calc((var(--zoom) - .62)*12),1)`.
Sub-labels then appear exactly when they become legible, on every viewport, with no per-breakpoint authoring.

---

## STEP 4 — Build on a shared chassis, never a fork of the incumbent template

1. **Create the chassis by literal copy**, not by retyping: lift the head — doctype, meta tags, every
   registered custom property, both theme token blocks, the full easing set, the reduced-motion block, the
   print block, and the no-JS pin — verbatim into a NEW chassis file, replacing only title, storage key and
   injection points with placeholders. **Diff the copied region against the source region** and confirm it is
   identical but for those placeholders. Three independent forks silently drift on exactly these invariants;
   one chassis cannot.
2. **Write each cut's body and stylesheet as separate files**, assembled by a build script that mirrors the
   incumbent build's fail-loud contract: an unreplaced placeholder is a non-zero exit, never a silent pass.
   Enforce the self-containment rules *at build time* so they can never ship.
3. **Honour the screenshot tool's element contract.** Read its probe expression and find every element it
   dereferences **without a null guard**. The cut must ship all of them whatever its scale. That is what lets
   one screenshot tool serve every edition instead of forking it.
4. Output is one self-contained file: no external requests, no `<script src>`, and **no inline-reference
   function of any kind — fragment targets included**, because the self-containment check does not
   distinguish them. That bans gradients, clip paths, filters, masks and patterns outright.

---

## STEP 5 — Inline the marks (skip entirely on `--no-marks`)

1. **Inline vector paths only.** A data-URI image fails self-containment exactly as hard as a remote URL, and
   a raster cannot inherit `currentColor`, so it cannot theme.
2. **Check for a vector before hand-drawing.** Look in the asset repo's unmerged branches and history, not
   just the checked-out tree — and confirm any vector you find is the *same mark*, not a later redesign.
3. **Flatten every inline-reference construct**: gradients collapse to their mid-stop as a flat fill; filters
   are deleted; clip paths become either a CSS `path()` or hand-trimmed geometry. Grep the assembled page and
   confirm zero occurrences.
4. **Strip every `id` from the marks.** A mark inlined twice duplicates ids and fails the unique-id check.
5. **Rewrite the artwork's `<title>`/`<desc>` to avoid every blocklisted term** — source descriptions
   routinely contain brand-fragment words, and the blocklist scans markup, not just prose. **Rewrite the
   sentence; never weaken the blocklist to accommodate artwork.** Check your own code comments too: a comment
   naming the banned words, or containing a banned construct as an example, fails the same check.
6. **Contrast:** logotypes are exempt, but only while never the sole carrier of meaning. Compute the ratio
   against both papers in both themes anyway and report it. For a single-colour silhouette, drive it from an
   existing text token via `currentColor` so it clears 4.5:1 in both themes for free, and say which token.

---

## STEP 6 — Validate the cut, and re-prove the incumbents

1. **Split the checks honestly.** Self-containment, unique ids, resolving anchors, figure→description wiring,
   the no-JS invariant, both theme blocks, reduced motion, print, the meta tags, the brand blocklist,
   contrast, and the register guard are **universal** — full strength, every edition, no knobs. Only counts
   and named-element lists may become per-edition configuration, and **each configured value carries a
   one-line justification in the profile file** so a lowered bar shows up in a diff.
2. **Leave the incumbent validator byte-untouched.** Add a profile-driven validator alongside it.
3. **Anti-weakening meta-gate:** the new validator, run under the incumbent's profile, must pass every
   incumbent page. If it fails one the old validator passes, the new validator is wrong — or it found a real
   bug. Investigate. **Never lower a threshold to make a check go green.**
4. **A skipped check prints `skip (profile)`**, never `ok`.
5. **Re-prove byte-identity:** re-run the incumbent build and `git diff --exit-code`. Exit **0** or stop —
   not "only whitespace", not "only the title". Re-run the copy-patch dry-run; every number must match Step 1.

---

## STEP 7 — Prove the layout with real screenshots (HARD GATE)

**Validator-green is not layout-proof.** The validator does not measure a single rectangle. A page can pass
every check and render as an empty frame, a collapsed column, or six-pixel type.

1. Use the repo's scroll-position screenshot tool, not a plain headless screenshot flag — plain flags do not
   raster after a programmatic scroll, which is how a page gets edited blind through a dozen changes.
   **If screenshots hang with no output and no error, check whether the display has slept**
   (`pmset -g assertions` → `UserIsActive 0`). Headless Chrome stops compositing without vsync;
   `requestAnimationFrame` then fires once and never again, so any rAF-based settle waits forever *and* a
   captured frame would show the page's initial state rather than the scrolled one. Prefix with
   `caffeinate -dimsu`. No Chrome flag fixes this — GPU flags, old headless mode and screencast were all
   tried. Before blaming the page, run the tool against the *unmodified source page*: if the control hangs
   too, the problem is the environment.
   Also check the tool's own port selection. If it derives a debug port from a clock without probing
   availability, concurrent runs collide and a probe can attach to a sibling run's browser — which reads as
   inexplicable results, not as an error. Probe for a free port, and bound every wait so a stall fails
   loudly instead of looking like progress.
2. **Sweep both themes into SEPARATE output directories.** If the sweep does not encode theme in the
   filename, the second sweep silently overwrites the first.
3. **Shoot every CSS breakpoint at the boundary and one pixel below it** — sweeps use round widths and miss
   breakpoints by construction. Cover the two-column layout, tablet, and the mobile collapse.
4. Add a reduced-motion frame, a no-JS frame, and one frame at each end of the scroll.
5. **Read the probe output field by field.** Resolved grid columns show the expected track count per width;
   the figure's measured width and height are both non-zero; render scale is finite; the smallest label is
   **strictly greater than the legibility floor at every width, no ties**; narration and figure have
   **disjoint** x-ranges in two-column; the active step index is **monotonically non-decreasing**.
6. **Open every screenshot with the Read tool and look at it.** Then open the mark screenshots next to the
   source artwork — clipping and flattening are visual-only failures no probe can see.
7. **Read the probe tool's source before trusting a probe field.** A field named like a measurement may be a
   proxy with a constant baked in from the page it was written for — e.g. a "smallest label" that is really
   `nominalUnits * boxWidth / viewBoxWidth` for a nominal size the cut no longer uses. Chasing a phantom
   failure costs as much as missing a real one. Verify legibility from the smallest `font-size` that actually
   applies, times the reported render scale, and separately confirm no inline `font-size` overrides survive
   inside the figure — those are usually the real cause of unreadable type, not the frame alone.

If any label anywhere renders below the floor, the frame is too wide. Tighten it and re-shoot. That is the
whole point of the cut.

---

## STEP 8 — Distribute

Copy only the named new files to the destination the user asked for. Explicit filenames — never a wildcard
that could sweep in an incumbent, never `-r`, never a delete-mirroring sync. Hash source and destination and
confirm they match; for self-contained single files a hash match is a complete correctness proof. List the
destination directory afterward so the user sees exactly what landed.

---

## STEP 9 — Report to the user

Close out with: the new file paths; the one claim the cut lands; source vs cut numbers for **prose words,
figure parse units, and sections**, each shown as the inequality it had to satisfy; the validator profile and
every value differing from the incumbent profile, with its justification; the byte-identity result for the
incumbents (the literal `git diff --exit-code` code); the copy-patch numbers before and after; the widths and
scroll positions actually shot and the probe fields checked; the marks' measured contrast in both themes.

Then **note anything left unverified** — every skipped width, every theme not shot, every probe field not
read, every mark not compared against its source artwork, anything scored by inspection rather than by
opening it. Under-claiming is free; over-claiming is how a page ships broken.

---

## Guardrails

This command may write **only** to:

- the new chassis/build directory it creates for the cut, and files inside it;
- the new profile-driven validator and its profile file under `<repo>/checks/` — **new files only**;
- the new cut's output `.html` file(s) at the repo root, named in its own config;
- the screenshot output directories under `<repo>/test-screenshots/**`;
- a `CHOICES.md` at the repo root recording judgment calls;
- the destination directory the user explicitly named, and only the files it just built.

It may **never** write to:

- the incumbent build directory or anything inside it — template, generated fragments, generators, build
  scripts, or copy-patch JSON;
- the incumbent validator;
- any incumbent built page;
- any external brand-asset repository — those are read-only sources, always.

Never commit, never push, never merge — hand off to `/shipit`. Never install a package to make a step easier.
Never regenerate a hand-tuned generated fragment: regeneration moves coordinates tuned by hand elsewhere, and
the validator will not notice.

---

### Quick reference
- **Measure before diagnosing.** If the target already reads plainer than its siblings, the problem is
  structure and scale, not vocabulary. Do not run a synonym pass.
- **Three gates, all strict, no ties:** prose `cut*2 < source`, figure parse units `cut*2 < source`, sections
  `cut < source`.
- **The hard stop:** `git diff --exit-code` over the incumbent pages must exit **0**. Non-zero ends the run
  regardless of how good the cut is.
- **Universal invariants, never per-edition:** self-containment (no external `src`/`href`, no inline-reference
  functions, no `@import`, no data URIs, no `<script src>`), unique ids, resolving anchors, figure→sr-only
  wiring, the no-JS render, both theme blocks, reduced motion, print, the meta tags, the brand blocklist,
  4.5:1 contrast in both themes, and the register guard.
- **Configurable, with written justification only:** step counts, element counts, named counter ids, prose
  ceiling.
- **The blocklist is not a knob.** Rewrite the artwork's alt text instead.
- **Frame size and type size are one decision**, settled per beat against the smallest supported viewport.
- Sibling commands: `/level-up-page` (raise an existing page's ambition), `/generate-journey-page` (new topic
  page against the global ratchet), `/ratchet-up` (two competing implementations, scored).
