# Evidence — why rubric v2 exists: v1 crowned a design that fails its brief. Cause and fix.

> **STATUS: applied.** Every fix below is in force as rubric **v2** (`rubric.md`), the blind-scoring +
> script-side gate rewrite of `workflow.mjs`, the re-calibrated budgets and STEP 9 acknowledgement gate in
> `SKILL.md`, and the regression test at `scripts/test-gate.mjs` (2026-09-20). This file stays as the
> evidence and the reasoning; do not re-apply it.

2026-09-20. Evidence: the first live run, on a record-overview screen, 2026-09-19, default
mode, 28 agents, 7 rounds, $170.88 against a $50 projection.

## 1. The rule the rubric is missing

**Neither UI nor UX may ever regress.** Both are deliverables. A design does not win by trading one
for the other — not generously, not slightly. A challenger must be at least equal on both and better
on at least one.

v1 `rubric.md:15` said the opposite:

> "Visual design is compromised **whenever** it competes with comprehension, task speed, accuracy of
> what is shown, or a new user's first sixty seconds in a complex domain."

Unlimited licence: any UX gain of any size justifies any UI cost. With **Visual design weighted 5 of
100**, the optimal play is to spend all craft on any UX increment, however marginal. v1 `SKILL.md:9`
stated a narrower version ("compromised **only in favor of** UX"), but judges read `rubric.md`.

## 2. What that produced

The brief said the persona reads this screen in 10 to 30 seconds, between other tasks. The owner's
verdict on the shipped result, paraphrased: nothing stands out; the persona would need ten minutes of
reading on a screen meant for a half-minute glance, while the person they serve waits.

On a healthy record: 22 questions, all at one type size and weight, 7 of them stating that nothing
happened. The persona needs about 4 facts. Nothing ranks them. The largest text on the page is a
question the page never answers in one line, and the strip under the record's name is spent on
`22 questions · 15 answered · 7 say why there is no answer` — commentary about the page, not the
record.

That is what the rubric asked for. Understanding (25) rewards labelling every region, Accuracy (20)
rewards sourcing every figure, and craft is free to spend on either. **Hierarchy is not decoration
competing with comprehension; it is the mechanism of comprehension at a glance.** Licensing its
sacrifice removed the only tool that delivers the ten-second read the rubric scores.

## 3. Three mechanism faults

**(a) A systematic incumbency penalty swamps the dethrone margin.** Every champion lost points when
re-scored cold as incumbent, unchanged:

| Artifact | Won at | Re-scored | Drop | Judge |
|---|---:|---:|---:|---|
| r1-anchor-merge | 87 | 80 | −7 | fable → opus |
| r2-climb-a | 84 | 82 | −2 | opus → opus |
| r3-climb-b | 85 | 75 | −10 | opus → opus |
| r4-climb-merge | 93 | 81 | −12 | opus → fable |
| r5-push-merge | 90 | 83 | −7 | fable → fable |
| r6-push-merge | 91 | 85 | −6 | fable → fable |

Mean −7.3, never positive, and as common within one judge model as across two — novelty bias, not
model variance. The margin is **+3**. Under a −7.3 bias, dethroning is near-automatic: six champions
in seven rounds. **This also breaks the no-regression rule in §4**, which compares against the
incumbent's score. Fix it first or the ratchet measures against a depressed baseline.

**(b) Merges only add.** Nothing rewards removal, so each merge appended a region: standing row,
per-band tallies, task-effect sentence, page tally, eight-state switcher. The champion is a merge of
merges. The tournament is an accretion engine and (a) keeps it running.

**(c) Judges scored from markup.** Each read 100–140 KB of `mockup.html`. Source confirms a region
exists; it cannot experience an eye landing nowhere. Candidates also shipped `self-check` appendices
asserting their own fold metrics, and mockups use their own type scale, so those claims do not survive
translation into the real design system.

## 4. The fix

**Stance — replace `rubric.md:15`:**

> User experience, user understanding and visual craft are all first-class. **Neither may regress.** A
> design that wins on comprehension by abandoning hierarchy, rhythm and restraint has not won, and
> neither has a beautiful page that buries the answer. Where everything is emphasised, nothing is.

**Axes (v2 — the bump forces a champion re-score, which is correct here):**

| Axis | v1 | v2 |
|---|---:|---:|
| Understanding | 25 | 20 |
| **Triage — what stands out** (new) | — | **15** |
| Speed to task | 20 | 15 |
| Accuracy and trust | 20 | 15 |
| Efficiency | 15 | 10 |
| **Craft and hierarchy** (was Visual design) | 5 | **15** |
| Onboarding | 10 | 5 |
| Feasibility | 5 | 5 |

Triage: *"From the rendered image alone, in ten seconds, without scrolling — can a reader state the one
to three things unusual about this record now, and the one action to take?"* 0 = everything one weight,
nothing ranked. 15 = the eye lands on what matters first, on every state of the screen.

**The no-regression gate.** Score two subtotals: **UX** (Understanding + Triage + Speed + Accuracy +
Efficiency + Onboarding, 80) and **Craft** (15). A challenger dethrones only if `UX ≥ incumbent UX`
**and** `Craft ≥ incumbent Craft`, and it beats the incumbent's total by the margin. A candidate that
regresses either subtotal is scored and reported but **cannot win at any total**. Record both subtotals
per candidate in the ledger so the ratchet is auditable across runs.

**Hard caps.** Flat page: a reader cannot name the top three facts in ten seconds from the PNG → **65**.
Non-events: more than a third of rendered rows on a healthy record say nothing happened → **70**.
Unanswered headline: the largest text is a question the first region does not answer in one sentence →
**70**. House style: the design invents its own grid, type scale or header treatment inside a product
that already has one → **75** (name the sibling screens in the brief).

**Judge protocol.** Score Triage and Craft from the PNG *before* opening the HTML; source is for
verifying claims only. Do not credit fold, density or self-check claims made inside a mockup.

**Mechanism.** Re-score the incumbent with the judge model that crowned it, or present it blind beside
challengers, or raise the margin to the measured ~8. Add one subtractive round per run where the only
admissible winner has *fewer* regions than the incumbent. Carry any persona time budget stated in the
brief into the rubric as a scored constraint — this one said 10 to 30 seconds and nothing scored it.

**Process.** `SKILL.md` says "Nothing here ships code: the output is a design, a ledger, and a build
plan." A "ship it" in the invoking message overrode that and a full-page redesign reached `main` with
nobody having seen it rendered. **Show the champion PNG and get an explicit acknowledgement before any
implementation**, whatever the invoking message says. Reconcile v1 `SKILL.md:9` with v1 `rubric.md:15`.

## 5. Cost

Projected $50 (ceiling $67), actual **$170.88**, +242%. Call counts matched the caps; the overrun was
per-agent volume (~68 tool uses each). Per call: sonnet $3.31, opus $8.33, fable $7.29. Project a
default run at **$150–175**, `light` at **~$60**. The run produced a screen rebuilt twice that still
fails the owner's first test — these fixes are worth more than another run at the current rubric.
