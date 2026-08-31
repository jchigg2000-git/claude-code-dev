**`ROADMAP.md` is the SINGLE SOURCE OF TRUTH for execution** — what's left, what's next, and
every phase / acceptance criterion / decision, across all workstreams. On any handoff, **read it
first and follow only it as the plan.** There are deliberately **no other `*_PLAN` or handoff
docs** — never recreate them. Put new plan or status content in `ROADMAP.md`. If any doc's status
conflicts with ROADMAP, ROADMAP wins. **Closure is deletion:** a finished item is removed from
`ROADMAP.md`, not marked done — git holds the history.

**Backlog items are not blockers.** No item under a `BACKLOG` / `PARKED` status gates any other
work unless it carries a `⛔ BLOCKS:` line quoting the owner's instruction from when it was
parked. Absent that line, it is non-blocking. Do not infer blocking from urgency or dependency
order.

Read order for a fresh session: this file → `README.md` (generated skill/command index) →
`ROADMAP.md`, then nothing else on demand — there is no separate spec/reference layer.

**This repo mirrors `~/.claude/commands` and `~/.claude/skills`, synced one-way by
`/sync-claude-slash`.** `commands/*.md` and `skills/*/SKILL.md` are command source, not plan or
status docs — never fold them into `ROADMAP.md`, and never let a doc-consolidation-style sweep
treat them as candidates.
