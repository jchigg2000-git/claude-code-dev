---
description: Surface the open questions that are actually shaping or blocking the build path in THIS repo, and make me resolve them. Questions are derived from real repo state (ROADMAP/DECISIONS, TODO/FIXME/DEFER markers, in-flight branches, unratified assumptions in recent work) — never invented to fill a quota. Only load-bearing forks qualify: a different answer must change what gets built. Asks via AskUserQuestion chips with real, mutually exclusive options plus a Defer option whose consequence is stated. Caps at 3-4 per run, ranked by downstream unblocking. Answers land in DECISIONS.md as ratified; deferrals land somewhere a later session trips over them. Fire on `/ask-me` or "what do you need from me / what's blocking you / ask me your open questions."
argument-hint: "[--dry] [topic or path to scope to]"
allowed-tools: Bash(git:*), Bash(rg:*), Bash(date:*), Bash(ls:*), Bash(wc:*), Bash(find:*), Read, Glob, Grep, Edit, Write, AskUserQuestion, Task, Agent
---

# Ask me the questions that are actually load-bearing

The premise: **the expensive failure is not an unanswered question, it's an unasked one that got
silently answered by an agent and then built on.** This command finds the forks in this repo where
my assumption is currently standing in for your decision, and makes you pick — in chips, not prose.

Scope: **the current working directory only.** Not sibling repos, not `~/Projects` at large.

`$ARGUMENTS`:
- `--dry` — do PHASES 1-3 and print the ranked question set. Do not ask, do not write anything.
- anything else — a topic or path to narrow harvesting to (e.g. `auth`, `src/sync/`).

## What this command does NOT do

- It does not implement the answers. Asking and recording is the whole job. When the answers land,
  stop and report — the next command builds.
- It does not manufacture questions to reach the cap. **Zero qualifying questions is a valid,
  correct outcome**; say so plainly and stop.
- It does not ask about anything I could just decide and you could cheaply reverse.

---

# PHASE 1 — Harvest candidates (read-only)

Delegate the independent sweeps to parallel subagents on a cheap model — this is mechanical
extraction, not judgment. Each returns candidate forks with `file:line` or `<doc> §<n>` citations
and the verbatim text that implies the fork. Judgment happens in PHASE 2, in the main context.

Sweeps:

1. **Roadmap / decisions surface.** `ROADMAP.md` — the §0 resume block's *Questions* subsection,
   the §N Open-decisions index, every `🔬 OWED` and `⚠ ASSUMPTION` marker, every `⛔ BLOCKS` line.
   `DECISIONS.md` — read it to know what is **already settled** (those are disqualified) and to
   spot decisions that were superseded without a replacement being chosen.
2. **Code markers.** `git grep -nE '(TODO|FIXME|HACK|XXX|DEFER|BUG|QUESTION|CLAUDE-ORIGIN)'` over
   tracked source. Exclude vendored, generated, fixture, and data-corpus paths. Keep only markers
   that encode a *choice*, not a chore — "TODO: handle the retry case" is a chore; "TODO: decide
   whether we poll or subscribe" is a fork.
3. **In-flight branches.** Local branches unmerged to the default branch, with last-commit age and
   a one-line read of what each one bets on. A branch that bets against `main` is a fork you may
   not have picked yet.
4. **Unratified assumptions in recent work.** Last ~14 days of commits and the working diff. Look
   for load-bearing choices that entered the repo without a `DECISIONS.md` entry — a new dependency,
   a schema shape, a storage or transport choice, an auth model, a rendering approach. These are
   the highest-value candidates: something is already being built on them.
5. **Stub / half-built signals.** `not implemented` / `panic("todo")` / `unimplemented!()` /
   empty handler bodies added recently — each one is a place where the design ran out.

Missing surfaces are facts, not failures. No `ROADMAP.md`, no `DECISIONS.md`, not a git repo →
note it and harvest from what exists.

# PHASE 2 — The load-bearing filter

Every candidate faces one test, and it is strict:

> **Would a different answer change what gets built?** Not what it's called, not how it looks —
> what gets built.

**Disqualified, always:**
- Naming, wording, file layout, formatting, log phrasing.
- Preference polish and anything cosmetic.
- Anything reversible in under an hour later, once real usage exists. If the cost of guessing wrong
  is one refactor I can do myself, I guess and note the assumption — I do not spend your attention.
- Anything `DECISIONS.md` already settles. Re-asking a ratified decision is relitigating it.
- Chores. A missing test, a missing error path, an unhandled edge — that is work, not a question.
- **Anything I can answer by reading.** Open the artifact first. A question whose answer is in the
  repo is a failure of my recon, not a fork for you.

**Qualifies:**
- Two live implementation paths where committing to one makes the other expensive to reach.
- A dependency, framework, or storage/transport choice already partly built on, never ratified.
- A scope boundary that decides whether whole components exist at all.
- A constraint currently being enforced that **no decision entry supports** — inherited from a plan
  doc, a prior agent, or an offhand line of yours. Per the provenance rule, that is exactly the
  moment to ask, before it becomes architecture.

**Provenance clause — mandatory.** If a candidate exists *only* because agent-authored text proposed
it (roadmap prose, a prior session's plan, a `CLAUDE-ORIGIN` line), say so inside the question text
in one clause — *"this is inherited from <source>, never ratified"* — and make one of its options
**"Never mine — drop it."** Do not present agent-authored proposals as though they were weighed
alternatives. Do not write an argument for or against them; state the fork and let the chips carry it.

# PHASE 3 — Rank and cap

Rank by **downstream work unblocked** — how much building is currently either stalled or being done
on an unratified guess. Not by how interesting the question is.

Cap: **3-4 questions.** `AskUserQuestion` accepts at most 4. If more than 4 survive PHASE 2, ask the
top 3-4 and carry the exact remaining count into the report and the durable record.

# PHASE 4 — Ask

One `AskUserQuestion` call, all questions in it. Contract per question:

- **`header`** ≤ 12 chars — the fork's subject, not a verb ("Storage", "Auth model", "Sync").
- **`question`** — one sentence naming the fork and what it decides. Cite the evidence inline
  (`src/db/index.ts:44`, `ROADMAP §3`). No preamble, no framing of what you'd prefer.
- **`options`** — 2-4 total, and **the Defer option consumes one slot**, so 1-3 real forks plus
  Defer. Each real option: a 1-5 word `label`, and a `description` that is **one line of
  implication** — what gets built, what becomes expensive, what you can stop thinking about.
  Options must be genuinely mutually exclusive; two flavors of the same answer is one option.
- **`multiSelect: false`** unless the forks genuinely compose.
- Use `preview` only when the fork is a concrete artifact you'd want to compare side by side
  (two schema shapes, two API surfaces, two layouts). Never for preference questions.

**The Defer option — non-negotiable format.** Every question carries one, labeled `Defer`, and its
description states the *consequence*, concretely:

> what I will assume in the meantime · and/or what stays blocked · and/or what gets built that may
> need rework

Never `"Decide later"`. Never `"Skip"`. A Defer whose description does not name a consequence is a
broken question — rewrite it before asking. If deferring genuinely costs nothing, the question
failed PHASE 2; drop it.

Do not add a recommendation, do not order options to steer, do not append a fifth option — the
harness supplies "Other" for free-text.

# PHASE 5 — Record

Get today's date from `date +%Y-%m-%d`. Never guess it.

## Resolved → `DECISIONS.md`

Append (never rewrite; supersede if it reverses an existing entry), newest at the bottom.

**If the file already has an established heading format, match it — the template below is only the
default for a file that has none.** A repo whose entries are numbered (`## D-0042 — <title>`) has
those ids cited from source comments, roadmaps and UIs; introducing a second heading shape breaks
every one of those citations. Continue the existing numbering.

```markdown
## YYYY-MM-DD — <the verdict, as a sentence>
**Ratified by you** (`/ask-me` chip selection). Your words: "<the exact option label>"<, plus any
notes you added, verbatim>.
The fork: <one line — what was actually being decided, and the citation it came from>.
Rejected: <the other option labels, one clause each>.
```

Keep the provenance honest and separated: **the verdict is user-ratified; the framing around it is
mine.** Do not write a rationale you attribute to me — if I picked a chip without explaining why,
the entry records the choice, not an invented reason. If an answer arrived via "Other", that text
is verbatim gold: quote it exactly.

If `DECISIONS.md` does not exist, create it with the standard header (append-only contract,
supersede-never-rewrite) and mention that `/roadmap` installs the full triad — do not run it.

## Deferred → somewhere a later session trips over it

Both of these, when applicable:

1. **`ROADMAP.md` §N Open-decisions index** — one line, carrying the consequence:
   ```markdown
   - 🔬 **OPEN — <the fork>.** Deferred YYYY-MM-DD by you. **Meanwhile:** <what I'm assuming /
     what's blocked / what may need rework>. Evidence: `<file:line>`. *(question authored by me —
     CLAUDE-ORIGIN; the deferral is yours)*
   ```
   Also add it to the §0 resume block's *Questions* subsection so a fresh session hits it first.
2. **A marker at the code site**, when the question anchors to specific code:
   `// TODO(open-question, YYYY-MM-DD): <fork> — assuming <X> until decided. See ROADMAP §N.`

No `ROADMAP.md` and no natural code site → write the block into the repo's existing notes/scratch
doc. Do not create a new rival plan doc; that is the exact pattern `/roadmap` exists to kill.

## Still-unasked → same index, one line each

Surplus questions that survived PHASE 2 but lost the ranking get a one-line entry in the same index,
tagged `CLAUDE-ORIGIN` (I authored them, you have not seen them). They are candidates for the next
`/ask-me` run, which re-ranks from live repo state — they are **not** a queue that accrues authority
by sitting there. If a later run finds one no longer load-bearing, delete the line.

# PHASE 6 — Report

Exactly one line:

```
/ask-me: <n> resolved · <n> deferred · <n> still unasked → DECISIONS.md, ROADMAP §<n>
```

Then stop. No recap of what was decided — it is in the file, and you just answered it. If nothing
qualified, the line is `/ask-me: no load-bearing open questions — <n> candidates all failed the
"changes what gets built" test.`
