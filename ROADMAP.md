# claude-code-dev — ROADMAP

> ⭐ **SINGLE SOURCE OF TRUTH.** On any handoff or fresh session, **read this first and follow
> only this** for what's left and what's next. There are **no other `*_PLAN` / handoff docs** —
> they are consolidated here. If another doc's status ever conflicts with this one, **this wins.**
>
> **Closure is deletion.** A finished item is removed from this file, not marked done. Git and
> the commit history hold what happened; this file holds only what can still change.
>
> **Reference** (opened on demand, never as "the plan"): `README.md` — the auto-generated
> skill/command index. Regenerate with `python3 scripts/gen-readme.py` after adding or renaming
> a command or skill.

**Legend:** ⏳ in progress · ⬜ not started · 🔬 verification owed · ⛔ **BLOCKS** — the only
marker that gates anything.

**Backlog items are not blockers.** No item under `BACKLOG` / `PARKED` may be cited as gating any
other work unless it carries a `⛔ BLOCKS:` line with the owner's verbatim instruction. Absent
that line, treat it as non-blocking.

## §1 Mirror maintenance

Maintenance on the mirror itself (sync tooling, commit gates) — not the skills and commands it
carries, which are content, not plan items.

- ⬜ **MIRROR-4** `skills/preference-recalcification` and the personal-workflow content it
  depended on are deliberately **not mirrored** — the skill is personal to the owner's harness
  and references local files no clone has. Its path is absent from
  `.provenance/first-party.txt`, so a future `/sync-claude-slash` will surface it as a new,
  unattested path rather than silently re-adding it. Decide once whether to keep that stance.
- ⬜ **MIRROR-5** `commands/` and `skills/` are deliberately excluded from the roadmap sync
  gate's `SOURCE_ROOTS`: a change there is a sync of content authored in `~/.claude/`, not a
  unit of work this file tracks, and including them would fire the gate on every
  `/sync-claude-slash --ship`. Revisit only if the mirror starts carrying original work.

### Parked ideas
None.
