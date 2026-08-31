---
description: RETIRED — superseded by `/roadmap`. Session handoffs now live in the §0 "▶ RESUME HERE" block of the repo's single-source-of-truth ROADMAP.md, not in a separate docs/handoff.md. Do not fire this; do not write a handoff doc. If invoked, refresh the roadmap's resume block instead.
argument-hint: "(retired — use /roadmap)"
allowed-tools: Read
---

# RETIRED — this command has been superseded by `/roadmap`

**Do not write `docs/handoff.md` or `HANDOFF.md`. Do not produce a standalone handoff document.**

Session handoffs are now part of the single-source-of-truth roadmap. `/roadmap` installs and
maintains a `ROADMAP.md` whose §0 opens with a dated resume block:

```markdown
> ### ▶ RESUME HERE — session handoff YYYY-MM-DD. The <prior date> block below is history.
>
> **State:** <branch, clean/dirty, tests, deployed — every claim cited.>
>
> **▶ NEXT ACTION: <ID> — <one line>**
>
> #### What shipped
> #### What I found by reading that nobody reported
> #### What I deliberately did NOT do, and why
> #### Questions — each one line from you
```

That block carries everything this command used to write, and does it better: prior handoffs are
demoted to `— HISTORY, superseded by the block above` rather than overwritten, so the trail of
where things stood survives; the handoff sits next to the work it refers to; and there is one file
to read on a fresh session instead of two that can disagree.

## If you were invoked

Run the equivalent work through `/roadmap` instead — refresh the repo's `ROADMAP.md`, which adds a
new resume block and demotes the previous one. Say in one line that `/handoff-to-next` is retired
and that you routed to `/roadmap`.

If the repo has no `ROADMAP.md` yet, `/roadmap` will install one and fold any existing
`docs/handoff.md` into §0 as history.

**Under no circumstances create a new standalone handoff, plan, or status document.** Rival plan
docs are exactly what the roadmap pattern exists to eliminate.
