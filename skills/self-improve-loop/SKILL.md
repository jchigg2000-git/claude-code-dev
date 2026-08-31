---
name: self-improve-loop
description: >-
  Run a bounded, self-pacing self-improvement loop against the CURRENT repo it is
  invoked in. Deep multi-agent analysis swarm (via Workflow/ultracode) ranks a backlog
  across exactly five focus areas — security hardening, performance tuning, UI
  improvements, code smells/refactors, UX improvements — then an adaptive budget-aware
  loop implements the highest impact-per-effort items within a LOW-to-MEDIUM risk
  envelope, one item per /shipit, until a 4-hour wall-clock cap fires, the usage window
  is exhausted, or the backlog runs dry. UI/UX items ship via /ratchet-up; non-UI items
  inline or via one focused agent. State lives in an in-repo ledger so a fresh context
  resumes cleanly and never drops an in-flight item. Fire on "/self-improve-loop",
  "self-improve this repo", or a self-paced /loop that wants bounded repo self-improvement.
  Scope is ONLY the invoking repo; never touches other repos or files outside the working tree.
---

# Self-improve loop (bounded, self-pacing, single-repo)

A self-paced improvement loop that hardens and refines **the repo it is invoked in** —
nothing else. It runs a deep multi-agent analysis **once**, builds a ranked backlog
across five focus areas, then works the backlog highest-leverage-first, shipping one item
at a time, until a hard stop fires. All state lives in an in-repo ledger so the loop
survives fresh contexts and resumes without re-analyzing.

> **This skill explicitly authorizes calling the `Workflow` tool.** A skill instructing
> Claude to call Workflow is a valid ultracode opt-in path. Run the deep-analysis and
> re-analysis passes as a Workflow (multi-agent swarm). If the Workflow tool is
> unavailable, fall back to fanning out parallel `Agent()` calls inline for those passes,
> and **tell the user** so they can re-run with `ultracode` set.

---

## Role & risk envelope (READ FIRST — these are hard constraints)

- **Scope.** Only the repo the skill is invoked in. Never touch other repos, never edit
  files outside the working tree. First thing the loop does is confirm it is inside a git
  work tree (`git rev-parse --show-toplevel`); that path is the boundary for everything.
- **Focus areas (the ONLY eligible work).** Rank and select the backlog strictly within
  these five:
  1. **Security hardening**
  2. **Performance tuning**
  3. **UI improvements**
  4. **Code smells / refactors**
  5. **UX improvements**
  Doc staleness, hygiene, and net-new features are **out of scope** unless they *directly
  serve* one of the five above.
- **Risk budget: LOW-to-MEDIUM only.** INELIGIBLE (skip and log why): schema/data
  migrations, credential rotation, git history rewrites, dependency major-bumps with
  breaking changes, infra/prod deploys, deleting anything the skill did not itself create.
  Any item whose risk reads **above MEDIUM** is skipped, with the reason recorded in the
  ledger.
- **Impact budget: LOW-to-HIGHEST.** Impact is **not capped**; risk is. Prefer the
  highest-impact item that still fits the risk envelope.

---

## UI / UX work MUST go through `/ratchet-up`

- **Any item that adjusts a UI component** — visual, layout, interaction, or UX flow —
  is implemented via the **`/ratchet-up`** command on that component: build competing
  implementations, score against the quality ledger, and ship **only if the winner
  strictly beats the prior champion**. Do **not** hand-edit UI components directly.
- **Non-UI items** (security, performance, code smells with no UI surface) are implemented
  inline or via a **single focused agent** as normal.
- Rule of thumb for classification: if the change renders differently to a human or
  changes an interaction/flow, it is UI/UX → `/ratchet-up`. If it only changes behavior
  behind the interface, it is non-UI → inline / single agent.

---

## State — the ledger (`.claude/self-improve-ledger.md`)

Everything that must survive a fresh context lives in **`<repo-root>/.claude/self-improve-ledger.md`**.

- **Consistency decision: the ledger is gitignored, not committed.** On first run, ensure
  `.claude/self-improve-ledger.md` is present in the repo's `.gitignore` (add the line if
  missing). Rationale: the ledger is loop scratch state, it churns every iteration, and it
  must never ride along in a `/shipit` commit for an unrelated improvement item. Keeping it
  out of git also keeps each shipped commit clean (one item = one focused commit).
- **On every (re)invocation: resume from the ledger; do NOT re-analyze from scratch** if a
  ledger with a live (non-expired, unfinished) backlog exists.

Ledger structure (Markdown; keep it machine-parseable and human-readable):

```markdown
# Self-improve ledger — <repo-name>

## Run metadata
- repo_root: <abs path from git rev-parse --show-toplevel>
- start_epoch: <date +%s at first run>
- start_human: <human-readable>
- hard_deadline_epoch: <start_epoch + 14400>   # +4h
- last_touched_epoch: <updated each iteration>
- status: analyzing | looping | stopped

## Backlog (ranked; highest impact ÷ effort first)
| id | focus_area | title | file:line | impact(1-5) | risk(1-5) | est_minutes | status |
|----|-----------|-------|-----------|-------------|-----------|-------------|--------|
| 1  | security  | ...   | app/x:42  | 5           | 2         | 20          | done   |
| 2  | perf      | ...   | lib/y:88  | 4           | 2         | 30          | in_progress |
| 3  | ui        | ...   | ui/Z.tsx  | 3           | 1         | 45          | todo   |
| 4  | codesmell | ...   | ...       | 4           | 4         | -           | skipped(risk>MEDIUM) |

## Log (append-only)
- [<epoch>] item 1 (security) DONE via /shipit — SHA abc1234 — verified: unit+build green
- [<epoch>] item 4 SKIPPED — risk 4/5 (schema migration) exceeds MEDIUM envelope
- [<epoch>] batch re-paced: est was 3 items/checkpoint, actuals ran long → 2 items/checkpoint

## Closeout (written on stop)
- stop_reason: hard_deadline | usage_window_exhausted(inferred) | backlog_empty
- done: [...]  not_done: [...]  unverified: [...]  risky: [...]
```

- **`status` values per item:** `todo` → `in_progress` → `done` | `skipped(<reason>)`.
- **Never silently drop an in-flight item.** The instant work starts on an item, set its
  status to `in_progress` and stamp `last_touched_epoch` **before** doing the work. If the
  loop is interrupted (usage window, crash, user stop), the next session sees
  `in_progress` and resumes that exact item rather than losing it.

---

## Phase 1 — Deep analysis (expert agent swarm, run FIRST, ONCE)

Runs only when no live ledger backlog exists. Steps:

1. **Stamp the clock.**
   - `start=$(date +%s)`
   - `hard_deadline=$((start + 14400))`   # 4 hours
   - Write run metadata to the ledger; set `status: analyzing`.
2. **Detect the repo's checks** (build/test/lint commands) so later verification is real —
   read `package.json` scripts, `Makefile`, `pyproject.toml`, CI config, etc. Record them
   in the ledger.
3. **Launch the analysis Workflow** (multi-agent swarm). Fan out **one expert finder per
   focus dimension** (security, performance, UI, code smells, UX). Each finder returns
   **structured findings with `file:line` evidence** — not vibes. Then an **independent
   corroboration pass** re-opens each finding at its `file:line` and returns
   `confirmed | narrowed | refuted`. A finding is dropped ONLY on firsthand contradicting
   evidence; uncertainty **narrows** it, never kills it, and every drop is logged with its
   reason so nothing disappears silently. Findings are then **deduped** and **scored**
   `{focus_area, impact 1-5, risk 1-5, est_minutes}`.
4. **Drop `risk > MEDIUM` (i.e. risk ≥ 4)** items — log each drop with its reason.
5. **Rank** remaining items by **impact ÷ effort** (effort ≈ `est_minutes`) and **write the
   backlog to the ledger.** Set `status: looping`.

**Workflow skeleton** (author inline when firing; adapt models/effort to repo size):

```js
export const meta = {
  name: 'self-improve-analysis',
  description: 'Fan out five focus-area finders, corroborate against source, rank a backlog',
  phases: [{ title: 'Find' }, { title: 'Verify' }, { title: 'Rank' }],
}
const FOCUS = [
  { key: 'security',  prompt: 'Find security-hardening opportunities in THIS repo only...' },
  { key: 'perf',      prompt: 'Find performance-tuning opportunities...' },
  { key: 'ui',        prompt: 'Find UI-improvement opportunities (visual/layout/interaction)...' },
  { key: 'codesmell', prompt: 'Find code smells / refactor opportunities...' },
  { key: 'ux',        prompt: 'Find UX-improvement opportunities (flows, feedback, states)...' },
]
const FINDING = { /* JSON schema: {findings:[{title,file,line,rationale,impact,risk,est_minutes}]} */ }
const VERDICT = { /* JSON schema: {status:'confirmed'|'narrowed'|'refuted', why:string, risk:number} */ }

const graded = await pipeline(
  FOCUS,
  f => agent(`${f.prompt} Return file:line evidence for every finding. Scope: only this repo.`,
             { label: `find:${f.key}`, phase: 'Find', schema: FINDING }),
  (res, f) => parallel((res?.findings ?? []).map(x => () =>
    agent(`Corroborate this finding against the REAL source. Open the file at its file:line first —
do not judge from the JSON alone. Return status:
  'confirmed' — the evidence is there as described;
  'narrowed'  — real but smaller, different, or lower-severity than claimed (say how);
  'refuted'   — you opened the file and the claimed condition is NOT present.
Unsure, out of context, or could not reach the evidence => 'narrowed' with the reason.
ONLY firsthand contradicting evidence justifies 'refuted':\n${JSON.stringify(x)}`,
          { label: `verify:${f.key}`, phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...x, focus_area: f.key, verdict: v })))),
)
const all      = graded.flat().filter(Boolean)
const refuted  = all.filter(x => x.verdict?.status === 'refuted')
const kept     = all.filter(x => x.verdict?.status !== 'refuted')   // confirmed + narrowed both survive
log(`verify: kept ${kept.length}, refuted ${refuted.length}` +
    (refuted.length ? ` — ${refuted.map(d => `${d.title} (${d.verdict.why})`).join('; ')}` : ''))
// dedup by file:line + title, drop risk>=4, rank by impact/est_minutes, return backlog
return { backlog: rankAndFilter(kept), refuted }   // refuted travels WITH the backlog — never a silent drop
```

If `Workflow` is unavailable: run the same fan-out as parallel inline `Agent()` calls
(five finders → corroborate → dedup → rank), and **tell the user** to re-run with
`ultracode` for the full swarm.

---

## Phase 2 — Adaptive, budget-aware loop

Repeat until a **STOP condition** fires:

1. **Pace the batch.** Look at the next several `todo` items and **sum their
   `est_minutes`.** Combine that with **remaining wall-clock**
   (`remaining = hard_deadline - $(date +%s)`) to decide, for this batch: how many items
   to attempt before the next checkpoint, and when to trigger a re-analysis. **Re-estimate
   and re-pace at the END of every batch** — if items ran longer/shorter than estimated,
   adjust batch size and log the adjustment.
2. **Pick the item** with the highest **impact ÷ effort** still inside the risk envelope
   (risk ≤ 3 / MEDIUM). Set its status to `in_progress`; stamp `last_touched_epoch`.
3. **Implement it.**
   - **Adjusts a UI component →** run **`/ratchet-up`** on that component. Ship only if the
     winner strictly beats the champion; if it does not beat the champion, mark the item
     `skipped(ratchet: no improvement)` and move on.
   - **Otherwise →** implement **inline** or via a **single focused agent**.
4. **Verify it.** Run the repo's relevant checks recorded in Phase 1 (tests / build / lint).
   If verification fails and can't be quickly fixed within the item's scope, revert the
   change, mark `skipped(verify failed)`, and log it — do not ship red.
5. **Ship it with `/shipit`** (commit → push → merge to main). **One item = one shipit.**
   Record the returned commit **SHA** in the ledger log.
6. **Update the ledger.** Mark the item `done`, re-rank remaining, stamp
   `last_touched_epoch`. **If the backlog is running low**, trigger a **fresh, lighter
   analysis swarm** across the five focus areas to refill it (same Workflow, smaller finder
   fan-out).

Then loop back to step 1.

### STOP conditions (whichever comes first)

- **`now >= hard_deadline`** — the 4-hour cap. **HARD.** Check `$(date +%s)` against
  `hard_deadline_epoch` at the **top of every iteration**; if reached mid-batch, finish
  nothing new — go straight to closeout.
- **Usage window exhausted** — see honesty note; treated as a **natural terminator**, not a
  polled condition.
- **Backlog empty AND a re-analysis pass surfaces nothing eligible.**

On stop: write the **Closeout** section to the ledger and **print to the user:
done / not done / unverified / risky.**

---

## Honesty notes (baked in — do not paper over these)

- **The 4-hour cap IS enforceable.** It is pure wall-clock: compare `$(date +%s)` to the
  stored `hard_deadline_epoch` each iteration. Enforce it literally.
- **"Run until the usage window is exhausted" is NOT pollable from inside the loop.** There
  is no API to read remaining usage-window budget. So it is a **natural terminator**: when
  the window runs out, the session simply stops responding mid-loop. This is *safe by
  design* because the ledger holds an `in_progress` item and full backlog — the **next
  session resumes cleanly** from exactly where it stopped. The loop does not pretend to
  detect this; it relies on ledger-resume to make the abrupt stop harmless.
- **Never silently drop an in-flight item.** Because status is flipped to `in_progress`
  *before* work begins, an interrupted item is always visible to the next session as
  in-progress and gets resumed — it never vanishes to make a summary look finished.

---

## Resuming (fresh context)

On invocation, before anything else:

1. `git rev-parse --show-toplevel` → confirm we're in a repo; that's the scope boundary.
2. Read `.claude/self-improve-ledger.md` if present.
   - **No ledger, or `hard_deadline_epoch` already passed / `status: stopped`** → run
     **Phase 1** fresh (a passed deadline means a prior run completed; start a new run only
     if the user clearly wants another pass).
   - **Live ledger (`status: looping`, deadline in the future)** → **skip Phase 1**, pick up
     any `in_progress` item first, then continue **Phase 2** from the ranked backlog.
3. Re-stamp `last_touched_epoch` and proceed.
