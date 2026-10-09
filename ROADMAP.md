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
marker that gates anything. `CLAUDE-ORIGIN` on an item means an agent proposed it and the owner
hasn't decided it.

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
- ⬜ **MIRROR-7 Sync is blind to sibling files.** `/sync-claude-slash` Phase 1 compares only
  `SKILL.md`, so a changed or added script inside an existing skill never reaches the mirror.
  The 2026-10-09 sync caught the backlog up by hand (build-status, lead-keeper, machine-health,
  ux-tournament, shipit trees); the fix is a whole-tree compare in the harness copy of the
  command, so the next drift doesn't wait for someone to notice.
- ⬜ **MIRROR-8 `doc-consolidation` held out.** `usage_gate.py` reads the Claude Code OAuth token
  from the macOS Keychain to call the undocumented `api.anthropic.com/api/oauth/usage` endpoint.
  Rework that before the skill can be mirrored; until then every sync offers it again.

### Parked ideas
None.

## §2 Plugin marketplace

Owner intent, 2026-09-26: *"I would make em plugins if that gets em picked up by people
potentially"* and *"just write over in the claude code dev repo and I'll pick it up there."*
The goal is adoption by other people. The owner's own daily use stays as loose skills in
`~/.claude/`: plugins install as a cached copy, so live edits would mean reinstalling.
Start with **PLUG-5 (first-slice paths) → PLUG-1 → PLUG-2 (first slice only)**. That's enough
to prove the install path. If PLUG-1 moves files, PLUG-4 has to land first.

- ⬜ **PLUG-1 Marketplace scaffold.** Add `.claude-plugin/marketplace.json` at the root. Prefer
  defining each plugin inside it over the existing `commands/` + `skills/` layout rather than
  moving files into `plugins/<name>/`. 14 entries in the official marketplace use
  `"strict": false` with a `skills: [...]` list pointing into an existing tree (e.g.
  `amd-skills`). Keeping the layout keeps the sync, the provenance gate and `gen-readme.py`
  working unchanged.
  - Spike first: does a `commands` list work the same way under `strict: false`? (Only `skills`
    appears in the official catalog.)
  - Replace the README's `cp -R` install with `/plugin marketplace add
    jchigg2000-git/claude-code-dev`, then `/plugin install <name>@claude-code-dev`.
  - Invocations become namespaced (`harden:harden-auth`). Whether in-prose cross-references
    like "run /harden-secrets" still resolve is unverified, so the acceptance test covers it.
  - Accept when a clean account (the second Claude account works) installs `harden` and
    `machine-health` from the marketplace and both run, including `harden-for-deploy` reaching
    its steps.
  - Anything newly public gets a human brand-scrub read. The automated scrub gate has no pattern
    file and no callers, so never cite it as proof of clean.
- ⬜ **PLUG-2 Grouping** `CLAUDE-ORIGIN` (proposed in a ~/Projects session 2026-09-26, not
  ratified; re-derive before treating as binding). First slice: `harden` + `machine-health`.

  | Plugin | Contents |
  |---|---|
  | `harden` | `harden-for-deploy` + its 8 steps |
  | `repo-sweeps` | `autonomous-sweep-core` + the 9 skills that follow its contract (all except `doc-consolidation`) + `autonomous-doc-refresh`. They depend on the core, so this has to be one plugin |
  | `machine-health` | local CPU/memory triage + watchdog. Description must say macOS-only |
  | `app-patterns` | `apply-auth-pattern`, `apply-observability`, `apply-settings` |
  | `repo-docs` | `gen-sys-doc`, `gen-sdd-doc`, `update-docs`, `diagramsystemflow`, `enrich-document`, `generate-build-report`, `roadmap`, `cleanup-roadmap` |
  | `page-craft` | `level-up-page`, `plain-cut`, `generate-journey-page`, `uxrefine`, `frontendtailwind`, `ux-tournament` (description states its ~$150/run cost) |
  | `repo-tools` | `shipit`, `cleanup-repo`, `lowhangingfruit`, `pathfinder`, `audit-burden`, `ask-me`, `front-door-security`, `prep-integration`, `port-collision-scan`, `generate-port-registry` + `mcp-servers/port-registry`, `update-deps`, `generate-test-suite`, `apply-seo`, `get-network-logs` |

  Unassigned, in neither this table nor PLUG-3: `claude-md-audit`, `feature-dev`, `ratchet-up`,
  `self-improve-loop`. `ux-tournament` hands off to `/ratchet-up` or `/feature-dev`, and
  `self-improve-loop` ships through `/ratchet-up` + `/shipit`. Namespaced plugins make those
  cross-plugin calls, so either co-locate them or state the dependency in each description.

- ⬜ **PLUG-3 Stays out of the marketplace** `CLAUDE-ORIGIN`:
  - **Personal glue:** `prompt-improver`, `preference-recalcification` (already MIRROR-4),
    `pack-toolbag`, `sync-claude-slash`, `harness-audit`, `harvestccskills`,
    `stash`/`unstash`, `unleash`, `doc-consolidation` (tied to the owner's LaunchAgent and
    purgatory dir), `build-status`, `mcp-servers/loose-ends`.
  - **Fix before publishing:** `rediscover` has no frontmatter at all (`commands/rediscover.md`
    starts with prose). Add a `description:` block.
- ⬜ **PLUG-4 Gate + tooling follow-through — only if PLUG-1 moves files.**
  `scripts/provenance-gate.py` scans only `commands/` and `skills/`, so a `plugins/**` layout
  silently escapes all three of its layers. This must land before or with PLUG-1, never after.
  - Extend the allowlist, the content heuristics and the known-third-party list to `plugins/`,
    and move the `.provenance/first-party.txt` and `not-first-party.txt` entries to the new paths.
  - Teach `sync-claude-slash` which plugin dir each harness path maps to.
  - Make `scripts/gen-readme.py` emit a per-plugin index.
  - Re-check MIRROR-5's `SOURCE_ROOTS` stance against `plugins/`.
- ⬜ **PLUG-5 Path rewrites.** Installed plugins live under `~/.claude/plugins/cache/`, so
  hardcoded `~/.claude/skills/...` paths break. These marketplace-bound files still have them:
  `skills/machine-health`, `skills/autonomous-doc-refresh`, `skills/enrich-document`,
  `skills/shipit` (helper scripts; the skill itself is disabled), `commands/shipit`.
  Rewrite them to the skill's base directory, shown when the skill loads.
  `skills/ux-tournament` already does this and is the pattern to copy (`<skill dir>/...`).
- ⬜ **PLUG-7 Local-install rule.** Never install these plugins on the primary machine
  alongside the loose `~/.claude/` copies, or every skill fires twice. The second account
  installs from the marketplace.

### Parked ideas (§2)
- **PLUG-8 Reach.** Installable isn't discoverable. Look into a listing in
  `anthropics/claude-plugins-official` (submission process not yet checked) and link the
  marketplace from the jchdev essays.
