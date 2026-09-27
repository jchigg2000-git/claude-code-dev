# ux-tournament rubric — v3 (0–100)

**v3 (2026-09-20).** v2 stopped craft being traded away, but left the arithmetic tilted toward adding: the
cost of a new region was *discretionary* — a judge had to notice the flattening and apply a penalty — while
the cost of removing one was *automatic*, because fewer labels mechanically meant fewer Accuracy and
Onboarding points. A simplifier paid a certain price for an uncertain gain; an accreter collected on three
axes at once and only maybe paid. Over seven rounds that is an accretion engine. v3 answers it three ways:
**Economy** replaces Efficiency (same 10 points, now scoring what a page leaves out and whether it has one
spine), the dethrone margin carries a **growth tax** so adding regions costs more margin and removing them
costs less, and Accuracy no longer asks for provenance on every figure. The subtractive round stays, but it
is no longer the only thing holding size down — it was a one-time squeeze, not a ratchet.

**v2 (2026-09-20).** v1's first live run crowned a design the owner rejected on sight — 22 questions
rendered at one weight, nothing ranked, unreadable inside the brief's own 30-second budget. That was
what v1 asked for, not bad luck: it licensed craft's sacrifice outright, weighted Visual design at
5/100, rewarded coverage on two axes, scored nothing for ranking, and set a +3 dethrone margin under a
measured −7.3 incumbency bias. `rubric-v2-evidence.md` has the evidence. v2 changes the
stance, the axes, the gate, the caps, and the judge protocol.

A version bump forces the reigning champion to be re-scored under this file before any comparison. v1
totals in a ledger are **not** comparable to v2 totals; label them.

## Stance

User experience, user understanding and visual craft are all first-class. **Neither may regress.** A
design that wins on comprehension by abandoning hierarchy, rhythm and restraint has not won, and
neither has a beautiful page that buries the answer. Where everything is emphasised, nothing is.
Hierarchy is not decoration competing with comprehension — it is the mechanism of comprehension at a
glance. And a page earns its regions: where everything is shown, nothing is understood.

A challenger must be **at least equal on both** UX and Craft and **better on at least one** (the
no-regression gate, below). Judges score the rendered PNG first and the markup second; a narrative
claim earns points only where the render visibly delivers it.

**Reading budget.** The brief states how long the persona actually looks at this screen (e.g. "10 to 30
seconds"). That number is a scored constraint, not colour: Triage and the flat-page cap are measured
against it. If the brief is silent, use ten seconds.

## Axes

| Axis | Weight | 0 looks like | 50 looks like | 100 looks like |
|---|---:|---|---|---|
| **Understanding** | 20 | A new user cannot say what the screen is for or what to do next | The primary question is answerable after reading; hierarchy mostly right | In ten seconds: what this is, what matters now, what to do next. Labels in the user's words, one idea per region |
| **Triage — what stands out** | 15 | Everything one weight, nothing ranked; the eye lands nowhere | Some ranking, but the reader still hunts for the exception | From the rendered image alone, inside the reading budget, without scrolling, a reader can state the 1–3 things unusual about this record now and the one action to take — on every state of the screen |
| **Speed to task** | 15 | Primary task buried behind navigation or ambiguity | Primary task reachable but with detours | The primary task is the first thing the eye and cursor land on; secondary tasks one step away |
| **Accuracy and trust** | 15 | Numbers without units, source, or freshness; misleading aggregates; hidden errors | Correct data, provenance partially shown | Units where a number is ambiguous, and provenance and freshness **wherever they would change a decision** — not a chip on every figure; uncertainty and partial states are visible; nothing shown that the system cannot actually know. Sourcing that nobody reads is deadweight and Economy will charge for it |
| **Economy** | 10 | A stack of panels with no spine; regions, chips, controls and steps the job does not need | Some regions serve no fact the brief asks for; some steps avoidable; the organizing idea is there but you have to assemble it | Economy of means: the fewest regions, controls, steps and decisions that do the job. Every region earns its place against the facts the brief says the persona needs, defaults do the routine work, and the whole page reads as **one idea** rather than a collection of good ones |
| **Craft and hierarchy** | 15 | One type size and weight; no rhythm; the page reads as a wall | Competent, unremarkable; some hierarchy, inconsistently applied | A deliberate type scale and weight ladder, spacing that groups what belongs together, restraint in colour and rule, and a page that looks like it belongs in this product. Calm, and the calm is what makes it fast |
| **Onboarding** | 5 | Blank first run; jargon undefined; no path in | Empty states and some guidance | A first-time user in a complex domain gets a guided entry, defined terms in place, and progressive disclosure that never blocks an expert |
| **Feasibility** | 5 | Needs data or behavior the system does not have | Buildable with notable new backend work | Buildable in the stack from the data the brief says exists |

Total = sum of axes, 0–100, integers, then hard caps.

**Subtotals, recorded per candidate:**

- **UX = Understanding + Triage + Speed + Accuracy + Economy + Onboarding** (max 80)
- **Craft = Craft and hierarchy** (max 15)
- Feasibility (5) sits outside both and gates nothing.

### The two Economy tests

Score Economy with these, in this order, from the PNG:

1. **The spine test.** Before opening anything else, write one sentence naming the page's organizing idea —
   what it is *for*, not what it contains. If you cannot, Economy is **4 or less**, whatever else is good
   about the page. Then read the candidate's own one-sentence thesis in `narrative.md`: if your sentence and
   theirs are not recognisably the same idea, the design does not communicate its own spine, and that costs
   another **−3**.
2. **The deadweight test.** The brief lists the facts the persona actually needs and the one action. Point at
   every rendered region that serves none of them. Each is deadweight: **−2** each on Economy, and past a
   third of the regions it is the Deadweight hard cap — record it in `caps`.

Both tests are about the whole, not the parts. A page can pass every other axis region by region and still
fail these, which is exactly what a merge of merges looks like.

## The no-regression gate

A challenger dethrones the incumbent only if **all three** hold:

1. `UX >= incumbent UX`
2. `Craft >= incumbent Craft`
3. `total >= incumbent total + required margin`

**The required margin carries a growth tax.** Base is **8** (the measured incumbency bias; see Mechanism).
Let `Δ = challenger regions − incumbent regions`:

| Δ | Required margin | In words |
|---|---|---|
| `Δ >= 2` | `8 + 3 × (Δ − 1)` | Adding costs: two more regions needs +11, four more needs +17 |
| `−1 … +1` | `8` | A one-region deadband, so counting noise never moves the bar |
| `Δ <= −2` | `max(3, 8 − 2 × (−Δ − 1))` | Cutting is cheap: three fewer regions needs only +4 |

Doing the same job with less is the cheapest way to win; doing it with more is the most expensive. The
discount is safe precisely because clauses 1 and 2 still stand — a smaller design cannot buy its way in by
losing comprehension or craft, it can only win by being genuinely better at less.

A candidate that regresses either subtotal is scored and reported in full but **cannot win at any
total**. Record both subtotals for every entry in the ledger so the ratchet is auditable across runs.

In the workflow the script applies this gate from the judge's scores; the judge does not pick a winner.
In a manual fallback run, apply it yourself and say which clause blocked each loser.

## Hard caps (apply after summing; lowest cap wins)

- **Flat page.** A reader cannot name the top three facts from the PNG inside the reading budget → cap **65**.
- **Non-events.** More than a third of the rendered rows on a healthy/normal record say that nothing
  happened → cap **70**.
- **Deadweight.** More than a third of the rendered regions serve none of the facts the brief says the
  persona needs → cap **70**. The page is a collection, not a design.
- **Unanswered headline.** The largest text on the page is a question the first region does not answer
  in one sentence → cap **70**.
- **House style.** The design invents its own grid, type scale or header treatment inside a product that
  already has one (the brief names the sibling screens) → cap **75**.
- **Complex-domain new-user test.** The brief marks the domain complex and a first-time user could not
  complete the primary task from this screen without outside help → cap **70**.
- **Invented data.** The design depends on data the brief says is not available → cap **60**.

## Penalties

- **Unbacked narrative claims.** Each claim the render does not visibly deliver: **−2** on Accuracy and
  trust (max −10). Count them in `unbacked`.
- **Comprehension cost.** A choice that measurably costs comprehension (contrast, decorative motion over
  data, hidden labels): **−5** on Understanding.
- **Hierarchy cost.** A choice that flattens ranking in the name of coverage — one more row, one more
  label, one more tally at the same weight as the thing that matters: **−5** on Craft and hierarchy.
  Symmetry is the point: v1 only had the first of these.
- **Duplicate approach.** A near-duplicate of an entry on the ledger's NO-REPEAT list (same skeleton,
  cosmetic differences) is scored normally but **cannot dethrone**; set `duplicate_of`. It may be merged
  from.

## Judge protocol

1. **PNG first.** Open every entry's `mockup.png` and, from the image alone, before opening any HTML:
   write the spine sentence (Economy test 1), then score **Triage** and **Craft and hierarchy**. You are
   scoring where an eye lands and whether the page has one idea, and source can tell you neither. Write all
   of it down before step 2.
2. Then read the brief, then each entry's `mockup.html` **once** and its `narrative.md`. Source is for
   verifying claims, counting regions, and checking that no invented data crept in — not for forming the
   impression.
3. **Ignore self-assessment inside a candidate.** Any self-check appendix, fold metric, density claim or
   region count asserted by the design itself scores zero credit. Count regions yourself.
4. **Blind.** The entries are labelled `E1…En` and one of them may be a design that has already competed
   and is currently the champion. You are not told which, and you should not try to work it out. Score
   every entry cold, on what it is.
5. Score every entry on all eight axes; report `ux`, `craft`, `total`, the caps you applied and why,
   `unbacked`, and `regions` — the distinct top-level `data-ux` regions rendered in the default state,
   counted the same way for every entry. **Count carefully: the dethrone margin is computed from it.** A
   state switcher is a region; a repeated row inside one region is not.
6. **Do not pick a winner.** Return scores and rationale; the tournament applies the no-regression gate
   and the margin. (Manual fallback: apply them yourself.)
7. **Gap notes per entry:** what a 95 would have needed. Concrete, checkable, ordered by points
   available. Vague notes waste the next round — they are its brief.
8. **Merging** is allowed where specific elements of two or more entries would combine into something
   better than either: build it (mockup + narrative, rendered), score it as its own entry, and say what
   it takes from whom. Never merge for cosmetic reasons, never inherit a score, and a merge that is
   simply the union of its parents' regions is an accretion, not a merge — do not build it.
9. Rationale: two to five sentences per entry, quoting what you saw in the render, not what the
   narrative said.

## Narrative template (generators: use these headings, in this order, nothing else at H2)

```
# <approach name>
One-sentence thesis. This is the spine: a judge writes their own one-sentence read of your render before
they read this line, and the two have to be the same idea.

## What stands out
What the eye lands on first, second, third — in the default state and in each other state. The 1–3
things a reader can name inside the reading budget, and the one action.
## Better
How a user understands more, sooner. Point at regions by their data-ux name.
## Faster
Seconds or steps saved on the primary task, and where in the mockup that happens.
## More efficient
Decisions removed, inputs removed, defaults introduced. Be specific.
## More accurate
What the user can now trust that they could not before: units, provenance, freshness, uncertainty, errors surfaced.
## First sixty seconds (complex domains)
What a first-time user sees, reads, and does. Which terms are defined in place.
## Craft and hierarchy
The type scale, weight ladder, spacing and colour decisions that produce the ranking above, and how they
sit inside the product's existing house style (name the sibling screens from the brief).
## What this removes
Regions, rows, labels and controls the incumbent had and this does not — and why nothing was lost.
## Not in this design
What the data or the stack does not support, so the judge is not misled.
```

Never write your candidate id, round number, tier or lens into either file: judging is blind. Never add
a self-check appendix or assert your own fold position, density or region count — it scores zero.

## Mockup contract (generators)

- One file, `mockup.html`, inline CSS, no framework, no CDN, no external fonts. Minimal inline JS only for
  showing states (tabs or toggles). Renders at 1440×1000 via `scripts/render.sh`; check the PNG and fix
  clipping, overflow, and contrast before returning.
- **House style.** The brief names sibling screens in the same product. Your grid, type scale, header
  treatment and colour tokens come from there. Inventing your own is a hard cap at 75.
- **Rank something.** Every state must have a first thing. If a reader cannot say what the page wants
  them to look at, it is a flat page and caps at 65.
- **One spine, and no deadweight.** The page is one idea, and a stranger should be able to say what it is
  from the render alone. Every region must serve one of the facts the brief says the persona needs; a region
  that serves none costs Economy points, and adding regions raises the bar you have to clear.
- Realistic data from the brief's data section. Never invent fields the brief says do not exist.
- Every meaningful region carries `data-ux="<name>"` and the narrative refers to regions by those names.
- Show the states that matter: loading, empty, error, partial or stale. Stacked panels or a state switcher
  are both fine — but a switcher is a region too, and it counts.
- Stack-agnostic. The build plan translates to the real stack afterwards.
- Reference the incumbent freely; improving on it is often the winning move. Copying it with cosmetic
  changes is a duplicate. **Adding to it is not automatically improving it** — see the subtractive round.

## Mechanism notes (why the numbers are what they are)

- **Margin 8.** Across v1's seven rounds every champion lost points when re-scored as the incumbent
  (mean −7.3, range −2 to −12, as common within one judge model as across two). That is novelty bias, and
  +3 made dethroning near-automatic. v2 answers it twice: the margin is 8, and the incumbent is scored
  blind alongside the challengers rather than announced as the thing to beat.
- **The subtractive round.** One round per run admits only a design with **fewer** rendered regions than
  the incumbent. It is a squeeze, not a ratchet — outside that round nothing stopped the next champion
  growing straight back, which is why v3 added the tax.
- **The growth tax.** An axis measures one snapshot; bloat is a property of the trajectory across rounds.
  So the anti-bloat instrument belongs in the gate, not the scorecard: it is deterministic, needs no
  judgement, and is auditable in the ledger. The deadband of one region keeps ±1 counting noise from moving
  the bar. Note what the tax does *not* do: nothing constrains round 1, where the anchor sets the region
  count — that is the brief's job, via the facts the persona actually needs.
- **Craft at 15, not 5.** At 5, the optimal play was to spend all craft on any UX increment however
  marginal. At 15, plus the no-regression gate, it cannot be traded at all.

## Lens catalog

Each generator in a round gets a different lens; rotation is deterministic so a rerun explores new lenses.

1. comprehension-first — labels, hierarchy, plain words, one idea per region
2. speed-first — the primary task in the fewest seconds
3. trust-and-provenance — where every number comes from, how fresh, how certain
4. novice-first-sixty-seconds — guided entry, defined terms, progressive disclosure
5. expert-density — scanning, keyboard, high information density without noise
6. error-prevention — constraints, confirmation only where irreversible, undo, validation in place
7. state-coverage — loading, empty, error, partial, stale as designed states
8. decision-support — compare, recommend, explain why
9. accessibility-first — contrast, focus order, semantics, reduced motion
10. narrow-viewport — the same job at 390px wide
11. hierarchy-and-restraint — one type scale, one weight ladder, the exception loud and the routine quiet
12. subtractive — the same job with fewer regions than the incumbent (the subtractive round's lens)
