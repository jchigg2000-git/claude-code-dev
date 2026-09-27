---
name: ux-tournament
description: >-
  Anchor-and-climb UI/UX tournament on the hardest screen of the current repo. A Fable pair sets the
  frame (screen mockup + narrative), sonnet challengers climb it under an opus judge, opus challengers
  push it under a Fable judge when the climb shows signal, and a Fable crown re-scores the result
  against the anchor. Rubric v3: UX, understanding and visual craft are all first-class and neither may
  regress; Triage scores what stands out and Economy scores what the page leaves out; everything is
  judged blind from the rendered PNG before the markup; and the dethrone margin carries a growth tax, so
  adding regions costs more margin than cutting them. Every run leaves a per-screen ledger, the crowned
  mockup + narrative, gap notes, a measured cost line, and an opus build plan for /ratchet-up or
  /feature-dev — never code. `light`, `3x`, `budget:$N` and `screens:N` rescale the spend. Fire on
  `/ux-tournament` or "run the UX tournament / ratchet the UX on <screen>".
---

# /ux-tournament

Money spent first buys the frame; money spent last only polishes it. This skill puts Fable at the start
(anchor) and the end (crown), and lets sonnet and opus do what they are good at in between: improving a
concrete artifact with critique in hand. Every candidate is the same pair of artifacts, a static HTML
mockup of one screen rendered to PNG and a narrative that says what stands out, how the user's experience
gets better, faster, more efficient and more accurate, and what the design removes — so judges compare like
with like across tiers.

> **Rubric v2 (2026-09-20).** The first full run (2026-09-19) cost $171 against a $50
> projection and crowned a design the owner rejected on sight. `rubric-v2-evidence.md` has
> the diagnosis; v2 is the fix and is now in force. What changed: craft cannot be traded for UX any more
> (Craft and hierarchy 5 → 15, plus a no-regression gate on both subtotals); a new **Triage** axis scores
> what stands out, from the PNG, inside the brief's stated reading budget; the incumbent is scored **blind**
> alongside the challengers and the script — not the judge — applies the gate, with the margin raised 3 → 8
> to match the measured incumbency bias; one **subtractive** round per run admits only a design with fewer
> regions; four hard caps (flat page, non-events, unanswered headline, house style) and per-agent tool-use
> caps that address the 242% overrun. The process rule stands and is STEP 9: **show the champion PNG and get
> an explicit acknowledgement before any implementation, even when the invoking message says "ship it".**
>
> **v3, same day.** v2 stopped craft being traded away but left the arithmetic favouring accretion: adding a
> region cost only a discretionary penalty, while cutting one mechanically lost Accuracy and Onboarding
> points. v3 replaces Efficiency with **Economy** (same 10 points — every region must earn its place against
> the facts the brief says the persona needs, and the page must read as one idea; scored with a spine test
> and a deadweight test), puts a **growth tax** on the dethrone margin (`8 + 3 per region added` past a
> one-region deadband, `8 − 2 per region cut` down to a floor of 3), and stops Accuracy demanding provenance
> on every figure. The subtractive round was a one-time squeeze; the tax is the ratchet.

Files in this skill: `rubric.md` (axes, caps, judge protocol, narrative template, mockup contract,
lens catalog), `rubric-v2-evidence.md` (the failed first run behind v2), `workflow.mjs` (the tournament), `scripts/render.sh` (headless Chrome screenshot),
`scripts/cost.py` (actual cost from transcripts, by model and tier), `scripts/test-gate.mjs`
(`node scripts/test-gate.mjs` — regression test for the no-regression gate, the margin, the subtractive
round and judge blindness; run it after editing `workflow.mjs`). `<skill dir>` below is this skill's
base directory, shown when the skill loads; pass it as an absolute path.

## Arguments

`/ux-tournament [--screen <route|component|name>] [--repo <name>] [--slug <name>] [light|3x] [budget:$N] [screens:N] [--reanchor] [--force-climb] [--no-subtract] [--dry-run]`

- `--repo <path|name>` targets that repo: a path is used as-is; a bare name resolves next to the current
  repo (or against the cwd when not inside one). Otherwise `git rev-parse --show-toplevel` from the cwd.
- `--screen` names the screen; otherwise STEP 1 picks the hardest one and says so.
- `--slug` sets the ledger slug; otherwise kebab-case of the screen name.
- `light` / `3x` / `budget:$N` choose the caps (see Budget modes). Default is the calibrated run.
- `screens:N` runs the tournament for the N hardest screens, sequentially, one workflow each.
- `--reanchor` forces a fresh Fable anchor even when the ledger has a champion.
- `--force-climb` runs the opus push tier even when the climb showed no signal.
- `--no-subtract` drops the subtractive round (`subtractRounds: 0`). Default is one per run; drop it only
  when the incumbent is already minimal and you are buying rounds elsewhere.
- `--dry-run` does STEPS 0–4 (scope, brief, ledger, projection) and stops before spending anything.

## Budget modes (re-calibrated 2026-09-20 from the first live run; ledger actuals override these)

| Mode | Caps | Projected | Fable calls |
|---|---|---|---|
| `light` | scouts 0 · anchor 1 Fable gen, opus judge · climb 1 round × 2 sonnet, opus judge · subtract 1 × 2 sonnet · no push · opus crown | **~$60** | 1 |
| default | scouts 3 · anchor 2 Fable gens, Fable judge · climb ≤3 rounds × 3 sonnet, opus judge · subtract 1 × 3 sonnet · push ≤2 × 3 opus, Fable judge (on signal) · Fable crown | **~$150 expected, $110 floor, $190 ceiling** | 3–6 |
| `3x` | scouts 5 · anchor 3 Fable gens · climb ≤4 · subtract 1 · push ≤3, forced · summit 2 Fable gens + Fable judge · Fable crown | **~$260 expected, $300 ceiling** per screen | 7–11 |
| `budget:$N` | largest mode whose ceiling fits N, then climb/push rounds trimmed to fit; refuse below the light floor (~$50) and say so | ≤ N | varies |

**Measured per call** (2026-09-19 run, 28 agents, $170.88): sonnet **$3.31** · opus **$8.33** · fable
**$7.29**; blind-staging haiku ~$0.10; scouts ~$1 (narrative only); oracle overhead ~$6 (brief, ledger,
report). The v1 projection of $50 was wrong by 242% and the cause was **per-agent volume, not call count**
— roughly 68 tool uses each. v2 caps tool use in the prompts (`genTools: 25`, `judgeTools: 30`) and tells
agents not to explore the repo or re-read files; if a later run measures a lower per-call cost, lower these
projections then, rather than assuming the caps held.

Observed baselines for comparison: a typical `/ratchet-up` run costs $10–16 in its segment (median ~9–13M
tokens, n=21); the most serious Fable polish session on record (2026-09-13) cost ~$77 for
the whole session, of which subagents were $32 and the main Fable loop $45. At default this skill is a
**two-to-three-polish-sessions** purchase, not a cheap one — say that in the projection line, and prefer
`light` for a rerun.

A `+Nk` directive in the invoking message sets a hard output-token ceiling the workflow cannot exceed;
use it when a run must not overshoot no matter what.

## Standing opt-in

Invoking this skill is the opt-in for its own workflow at the chosen mode; if your CLAUDE.md gates
Workflow runs, list this skill there as a standing opt-in. It never starts a second workflow in the same invocation (for `screens:N` each
screen is its own call and the user sees the projection for each before the first spends).

## STEP 0 — Resolve and echo

Resolve repo root, screen (or "to be picked"), slug, ledger path
`<repo>/.claude/ux-tournament/<slug>/ledger.md`, mode, and the run date. Echo them in one line before
anything else. Ensure `<repo>/.claude/ux-tournament/` is gitignored (ledger and rounds are scratch that
must never ride along in a `/shipit` commit); add the ignore line if missing.

## STEP 1 — Pick the screen (assume and proceed)

Skip if `--screen` was given. Otherwise inventory the app's screens cheaply (routes, pages, top-level
views; Glob + a few Reads, no agents) and score each by: distinct data entities shown together, user
decisions made on it, conditional or error states, TODO/FIXME/roadmap/issue mentions, and no existing
ledger. Pick the top score. Echo the pick with the two runners-up in one line and proceed; the user
can stop you. For `screens:N`, take the top N.

## STEP 2 — Write the brief

Write `<slug>/brief.md` once per run. The oracle reads only what the brief needs and never opens
candidate mockups later; the workflow's return value is all it consumes. Template:

```
# Brief — <screen> (<repo>, <date>)
## Domain in plain words            3–6 sentences; define every term a newcomer would not know
## Who uses this screen             personas, frequency, expertise; DOMAIN COMPLEX: yes/no, and why
## Reading budget                   how many seconds the persona actually looks at this screen before acting, and what happens if they overrun (SCORED: Triage and the flat-page cap are measured against it; if you cannot establish it, say "assume 10 seconds")
## What the persona actually needs  the 3–5 facts they came for and the one action they take, listed plainly, in their words (SCORED: this is the list Economy's deadweight test runs against, and it is the only thing constraining the anchor's size in round 1 — a vague list here and the tournament has nothing to charge accretion against)
## The screen's job                 the 1–3 questions it must answer; the primary action; secondary actions
## Current implementation           files, components, routes; current screenshot path if one was cheap to capture; what works; what confuses
## Data actually available          fields and types with their source; what is NOT available (designs may not invent data)
## Known pain points                from roadmap, issues, TODOs, user notes; cite each
## House style                      2–4 sibling screens in the same product, by path, and the grid, type scale, weight ladder and header treatment they share (a design that invents its own caps at 75)
## Constraints                      stack, design tokens or theme, accessibility floor, must-keep elements, out of scope
## Gap notes from the reigning champion   verbatim from the ledger, or "none (first run)"
```

Capture a current screenshot only if the app is trivially runnable; otherwise say "not captured".

## STEP 3 — Read or seed the ledger

If the ledger exists, extract: the champion block (id, approach, paths, total, gap notes), the NO-REPEAT
approach list, the last round number, and the calibration block (actual $ per call by tier). If it does
not, seed it from the template at the end of this file. Copy the ledger's gap notes into the brief.

## STEP 4 — Project the run and print the dispatch line

Compute the projection from the mode's caps and the per-call figures (ledger calibration first, the table
above otherwise). Print one line before spending:

`Dispatch: sonnet×<n> scout/climb, opus×<n> judge/push/plan, fable×<n> anchor/judge/crown; mode <m>; projected $<expected> (ceiling $<max>); ledger champion <id @ total | none>.`

`--dry-run` stops here.

## STEP 5 — Run the tournament

```
Workflow({
  scriptPath: "<skill dir>/workflow.mjs",
  args: {
    dir: "<repo>/.claude/ux-tournament/<slug>",
    brief: "<…>/brief.md",
    rubric: "<skill dir>/rubric.md",
    render: "<skill dir>/scripts/render.sh",
    date: "<YYYY-MM-DD>",
    screen: "<screen name>",
    caps: { … from the mode table … },          // omit for default
    incumbent: { id, approach, mockup, screenshot, narrative, total, ux, craft, regions, gapNotes } | null,
    usedApproaches: [ … NO-REPEAT list … ],
    roundOffset: <last round number in the ledger, 0 if none>,
    reanchor: false, forceClimb: false, hasPlan: <true if a build plan exists>
  }
})
```

Mode caps: `light` → `{ scouts:0, anchorGens:1, anchorJudge:'opus', climbRounds:1, climbGens:2, subtractGens:2, pushRounds:0, crown:'opus' }`;
`3x` → `{ scouts:5, anchorGens:3, climbRounds:4, pushRounds:3, summitGens:2 }` plus `forceClimb:true`;
`--no-subtract` → `{ subtractRounds:0 }`. The defaults (margin 8, one subtractive round, tool caps) live in
the script; do not restate them in `caps` unless you are deliberately overriding one, and say so if you do.

The script climbs on signal: the opus push runs only if the climb dethroned the anchor or produced a
near miss. The crown re-scores the final champion against the anchor in one Fable pass and reverts to
the anchor if the cheap tiers' wins do not survive it.

If the Workflow tool is unavailable, fall back to the same shape with parallel `Agent` calls
(Scout, Anchor, one Climb round, the Subtract round, Crown, Plan), keep the same prompts by reading
`workflow.mjs` — including the blind staging step and the script-side gate, which you apply yourself from
the returned scores — and tell the user the fallback ran and what it skipped.

## STEP 6 — Record

From the return value only. Append to the ledger: one scoreboard row per round (round, phase, tier, judge
model, blind yes/no, each candidate as `id total/UX/Craft/regions`, the incumbent's blind re-score with its
subtotals, verdict, and — this is the auditable part of the ratchet — **why each blocked challenger was
blocked** (`entries[].blocked`: UX regression, Craft regression, under margin, subtractive, duplicate) with
the **required margin** each one faced (`entries[].required` — 8 plus or minus the growth tax, so a reader
can see what the region count cost or saved). Then
the champion block rewritten (id, approach, paths, total, UX, Craft, regions, **gap notes verbatim**), the
NO-REPEAT list extended with every approach name used, and a run-log entry (date, mode, rubric version,
rounds, calls by tier, changed yes/no, plan path). Never overwrite prior rows. Totals scored under rubric v1
are not comparable to v2 totals — label any pre-2026-09-20 row `(v1)`.

## STEP 7 — Cost line (actual, not projected)

```
python3 <skill dir>/scripts/cost.py --cwd "$PWD" --latest --since "<run start ISO>" --json
```

Record in the ledger: total $, $ by tier, subagent $ vs main-loop $, output tokens from the workflow.
Update the calibration block: per-call $ by tier = tier $ ÷ calls[tier] from the return value. If actual
exceeds projection by more than 30%, say so in the report and name the tier that overshot.

## STEP 8 — Report and hand off

Short. Champion vs anchor (ids, totals, and both subtotals), whether the crown reverted anything, what the
subtractive round removed (or that nothing survived it), the first two gap notes, actual vs projected cost,
the build plan path, and the next command: `/ratchet-up "<plan summary>" --repo <name>` when the change is a
bounded feature, `/feature-dev` when it is broad. Then one line on the rerun: which lenses remain untried and
what the ledger says about the plateau (score per run).

## STEP 9 — Show the render and stop

**Read the champion PNG yourself, describe what you see, give the user the PNG path, and get an explicit
acknowledgement before any implementation begins.** This holds even when the invoking message said "ship it",
"just build it", or set `/unleash`: this skill's output is a design, a ledger, and a build plan — never code.
A "ship it" authorises the *plan*, not an unseen redesign of a real screen.

Before you show it, apply the reading-budget test to the render and say the answer plainly, even when it
is unflattering: *in the brief's reading budget, looking only at this image, can you name the one to three
things unusual about this record and the one action to take?* If the answer is no, say so and recommend a
rerun or a manual fix instead of handing over the plan — a judged 90 that fails this test means the rubric
drifted again, and that finding is worth more than the run.

## Ledger template

```
# ux-tournament ledger — <screen> (<repo>)
Rubric: v3 (0–100). Base margin 8 (+3 per region added past a 1-region deadband, −2 per region cut, floor 3). Near miss 5.
Gate: UX ≥ incumbent UX AND Craft ≥ incumbent Craft AND total ≥ incumbent + required margin.

## Champion 👑
id · approach · total (UX /80, Craft /15, N regions) · date · rubric version · mockup · screenshot · narrative
### Gap notes (verbatim from the crowning judge)
…

## Scoreboard
| Run | Round | Phase | Tier | Judge | Blind | Candidates (id total/UX/Craft/regions) | Incumbent re-score (total/UX/Craft/regions) | Required margin | Verdict | Blocked (id — why) | Near miss |
|---|---|---|---|---|---|---|---|---|---|---|---|

## Approaches already used (NO-REPEAT)
- …

## Calibration (actual $ per call, updated every run)
| Tier | Calls | $ | $/call | Run |
|---|---|---|---|---|

## Run log (append-only)
- <date> · mode · rubric version · rounds · calls sonnet/opus/fable/haiku · projected $ / actual $ · changed? · plan path
```

## Quick reference

- Anchor and climb: Fable frames, sonnet and opus climb, Fable crowns. Reruns skip the anchor.
- One rubric, every tier. The incumbent is re-scored **blind** alongside the challengers every round and the
  script applies the gate — the judge never learns which entry holds the title and never picks a winner.
- Neither UX nor Craft may regress. Dethroning needs both subtotals held and the required margin on the
  total — 8, **plus 3 for every region added** past a one-region deadband, **minus 2 for every region cut**
  (floor 3). Doing the same job with less is the cheapest way to win. Ties lose.
- Triage is scored from the PNG before any HTML is opened, against the brief's reading budget; Economy is
  scored with the spine test (name the page's one idea from the image) and the deadweight test (any region
  serving none of the facts the brief lists, −2 each).
- One subtractive round per run: only a design with fewer rendered regions can win it. A merge that is just
  the union of its parents is accretion, not a merge.
- Narrative earns points only where the render delivers the claim; a candidate's own self-check scores zero.
  Invented data caps at 60, a flat page at 65, inventing a house style at 75.
- Push tier only on signal; crown reverts cheap wins that fail a blind Fable re-score.
- The oracle never reads candidates. Cost is measured after the run, not guessed, and feeds the next projection.
- Nothing here ships code: the output is a design, a ledger, and a build plan — and STEP 9's acknowledgement
  gate holds even against "ship it".

Sibling commands: `/ratchet-up` (two competing code builds, judged), `/level-up-page` and
`/generate-journey-page` (HTML page ratchets), `/uxrefine` (single-pass UI polish on a branch).
