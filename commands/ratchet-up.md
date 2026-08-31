---
description: Build 2 competing implementations of a feature in parallel agents, score them against a versioned quality ledger, gate on structural divergence, and refuse to ship unless the winner strictly beats the prior champion. Fire on `/ratchet-up` or whenever a feature spec includes the word "ratchet-up".
argument-hint: <feature spec...> [--repo <name>] [--slug <name>]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# /ratchet-up

Implement **$ARGUMENTS** twice, independently, in parallel, on two deliberately different architectural
skeletons — then judge them, and only let the better one into the working tree if it **strictly beats** the
reigning champion for this feature. This is a **ratchet**: every run for a given feature must out-score the
last one. A run that can't honestly beat the champion does not ship — it gets recorded as a loss and the
champion stands.

This is not "generate two drafts and pick one." Two structurally identical candidates with cosmetic
differences **fail the gate automatically**, even if both look fine.

---

## How arguments resolve

- **`$ARGUMENTS`** = the feature spec (everything the user typed/pasted, minus flags below). If this command
  fired because a larger spec document merely *contains* the word "ratchet-up", treat the surrounding spec
  (or the section it's embedded in) as the feature description — extract it, don't ask the user to retype it.
- **`--repo <name>`** — target `~/Projects/<name>` instead of the current working directory's repo.
- **`--slug <name>`** — explicit feature slug for the ledger/worktrees (default: derive a kebab-case slug,
  ~3–6 words, from the spec, e.g. "add retry with backoff to the webhook sender" → `webhook-retry-backoff`).
- If `$ARGUMENTS` (after stripping flags) is empty, ask the user for the feature spec before doing anything else.
- **Resolve and ECHO before doing anything:** repo root (`git rev-parse --show-toplevel`), slug, ledger path,
  and the next run number `N` (highest existing run in the ledger + 1, or 1 if the ledger doesn't exist).

**Ledger is per-feature, inside the target repo:** `<repo-root>/.claude/ratchet-up/<slug>-ledger.md`.
It is the single competition for this feature across every run of `/ratchet-up` against it. A different
feature in the same repo gets its own ledger file; features never compete against each other.

---

## STEP 1 — Read the ledger, identify the champion to beat

1. **If the ledger doesn't exist yet**, this is the feature's first run: there is **no champion** (champion
   Total = 0 / "none"). Seed the ledger with the rubric (below) at **Rubric v1**, empty Scoreboard, empty
   "Skeletons already used" and "Techniques already used" lists. Continue — the better of the two candidates
   wins automatically since there's nothing yet to beat.
2. **Otherwise, read the ledger in full.** The **reigning champion** = the Scoreboard row marked 👑 (highest
   Total **among rows scored at the current rubric version**).
3. **Check the rubric version.** If you are about to change the axes (see "Versioned rubric" below), bump the
   version number and **re-score the champion under the new rubric first** (open its saved diff/patch,
   re-judge it cold) so the new run has a comparable bar. Never compare scores across rubric versions directly.
4. **Read "Skeletons already used (NO-REPEAT)" and "Techniques already used (NO-REPEAT)."** Both candidates
   you build this run must avoid the champion's skeleton entirely, and the two candidates must not share a
   skeleton with each other either.
5. **Write down, before building:** the champion's Total, its weakest axis (the opening to attack), and the
   two skeleton archetypes you'll assign to the two candidates this run.

---

## STEP 2 — Choose two genuinely different skeletons

Pick **two structural approaches** to the same spec that differ in *how the problem is decomposed*, not just
in naming or style. Examples of axes of divergence (combine, don't just reuse this list verbatim): single
function vs. composed pipeline of small functions; class/stateful object vs. pure functions + plain data;
synchronous straight-line vs. event/queue-driven; push (caller drives) vs. pull (consumer drives); wrapping
an existing abstraction vs. introducing a new one; centralized config vs. dependency-injected config. Neither
chosen skeleton may match the champion's skeleton or anything in the ledger's NO-REPEAT list.

**State both skeletons in your reply before launching agents** — this is what STEP 4's gate checks against.

---

## STEP 3 — Build both candidates in parallel, isolated

Launch **two `Agent` calls in a single message** (so they run concurrently), each with `isolation: "worktree"`:

- Give each agent: the full feature spec, **its assigned skeleton** (and an explicit instruction not to drift
  toward the other one or toward the champion's), the repo's conventions (point it at CLAUDE.md / existing
  code style), and a requirement to **write tests** for what it builds and to run them before reporting back.
- Ask each agent to report: files changed, a one-paragraph design rationale, what it explicitly chose *not*
  to do and why, and its test run output.
- Per this repo's working agreement, worktrees belong under `<repo-root>/.claude/worktrees/<name>/` — if the
  tool places one as a sibling of the repo instead, move it in with `git worktree move` before continuing.

Do not let one agent see the other's work-in-progress — independence is the point.

---

## STEP 4 — Layout-divergence gate (HARD GATE, before scoring)

Compare the two candidates' actual diffs (`git diff` in each worktree), not just their descriptions:

1. **Cross-candidate divergence** — do the two candidates differ in skeleton (module boundaries, control
   flow shape, the decomposition itself), not just variable names/formatting? Spot-test: strip identifiers
   and comments from both diffs — could you still tell them apart by structure alone? If not, **fail**: send
   the more-derivative candidate back to its agent with an explicit instruction to re-decompose, not reskin.
2. **NO-REPEAT check** — does either candidate's skeleton match the champion's, or anything in the ledger's
   "Skeletons already used" list? If so, **fail** that candidate the same way.

Do not proceed to scoring until both candidates pass. This gate exists specifically so two competing
implementations can't quietly converge on the same shape and call it a competition.

---

## STEP 5 — Judge both candidates (versioned rubric, 1–10 each axis)

Score **Correctness · Architecture fit · Test coverage · Readability/maintainability · Robustness/efficiency**
(Total /50). Prefer spawning one independent judge agent (fresh context, given both diffs side by side, no
knowledge of which one you'd prefer) so the score isn't self-graded by either builder. If the repo has a test
runner, actually run both candidates' tests rather than trusting self-reports — correctness scores grounded
in real output, not claims.

**Versioned rubric** — the five axes above are Rubric v1. If a future run needs a different axis (e.g. adding
"security posture" for a feature where that matters), bump the ledger's rubric version, log why in the
ledger, and re-score the champion under the new version per STEP 1.3 before comparing.

Tie-break (only if the two candidates tie each other): prefer the axis order above, left to right
(Correctness first, then Architecture fit, etc.) until one pulls ahead.

---

## STEP 6 — The shipping gate (HARD GATE — no ties, no fudging)

The run's winner = whichever candidate scored higher (after tie-break). Then:

- **No champion exists yet (first run for this feature):** the winner ships automatically — there's nothing
  to lose to. Promote it (STEP 7).
- **A champion exists:** the winner ships **only if its Total is strictly greater than the champion's Total**
  on the current rubric version. A tie is a loss. If it doesn't strictly beat the champion: **do not ship
  anything.** The champion stands, both candidates are recorded as losing attempts, and you tell the user
  plainly that this run didn't clear the bar — don't inflate scores to manufacture a win.
- Useful adversarial check before declaring a win: spawn a subagent to argue the winner is *not* actually
  better than the champion on the claimed axis. Keep the win only if it survives.

---

## STEP 7 — Promote (only on a real win)

1. Apply the winning candidate's changes onto the repo's actual current branch in the real working tree
   (e.g. `git diff` from its worktree, then apply/cherry-pick onto the branch you started from) — this makes
   the win usable, not just parked in a worktree. Do not push or merge to a shared/protected branch; that's
   `/shipit`'s job, not this command's.
2. Save **both** candidates' full diffs as patches under `<repo-root>/.claude/ratchet-up/<slug>/run-<N>-{a,b}.patch`
   so a losing-but-interesting approach isn't lost even after its worktree is removed.
3. Remove both temporary worktrees (`git worktree remove`) now that the diffs are archived and the winner is applied.
4. If the run didn't produce a win (STEP 6), still archive both patches, still remove both worktrees, but
   apply nothing to the real working tree.

---

## STEP 8 — Record (append-only — the ratchet's audit trail)

Update `<repo-root>/.claude/ratchet-up/<slug>-ledger.md`:

1. **Append two Scoreboard rows** for this run (one per candidate): run number, date, skeleton archetype,
   5 axis scores, Total, patch path, win/loss. Re-sort by Total desc.
2. **Move the 👑** to the new winner only if it actually shipped (strictly beat the champion); otherwise the
   👑 stays put and both new rows are logged as non-winning.
3. **Add both candidates' skeleton archetypes** to "Skeletons already used (NO-REPEAT)."
4. **Add any new technique(s)** to "Techniques already used (NO-REPEAT)."
5. **Prepend a Run-log entry**: the spec attacked, both skeletons tried, scores, gate outcome, and — if it
   refused to ship — exactly which axis(es) fell short and by how much.
6. **Raise "Next must beat"** to the (possibly unchanged) champion's Total, and note which skeletons are now spent.

Never delete or rewrite prior rows — losses are as much the record as wins.

---

## STEP 9 — Report to the user

State plainly: did anything ship or not. If it shipped — which skeleton won, its 5-axis score + Total, the
margin over the prior champion, and where it landed (branch/working tree path). If it didn't ship — both
candidates' scores, the champion's Total, and the specific gap. Either way: the ledger path, and that both
diffs are archived as patches even if unused. Note anything left unverified (e.g. "judge didn't actually run
the test suite, only read the reported output").

---

### Quick reference
- **Ledger (per feature, in-repo):** `<repo-root>/.claude/ratchet-up/<slug>-ledger.md`. Seeded empty (no
  champion) on the feature's first run.
- **Two agents, two skeletons, parallel, `isolation: "worktree"`** — never let them see each other's diff
  mid-build.
- **Layout-divergence gate (STEP 4):** candidates must differ from each other AND from every skeleton on the
  NO-REPEAT list. Cosmetic-only divergence fails even if both score well.
- **Shipping gate (STEP 6):** strictly greater Total than the champion, no ties, no champion ⇒ auto-ship.
  Losing runs ship nothing but are still fully recorded.
- **Rubric is versioned**: Correctness · Architecture fit · Test coverage · Readability/maintainability ·
  Robustness/efficiency, /50, Rubric v1. Bump the version (and re-score the champion) before changing axes.
- Sibling commands: `/level-up-page` and `/generate-journey-page` run the same ratchet shape against HTML
  pages instead of code features.
