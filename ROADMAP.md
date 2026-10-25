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
  - 2.1.310 facts (checked 2026-10-25 against the changelog, not yet tried here): a marketplace
    `command` source with `mode: "link"` uses the plugin in place (2.1.229), and
    `--plugin-dir <folder>` loads every plugin in a folder and picks up edits (2.1.265). Both
    weaken §2's "live edits mean reinstalling" objection. `claude plugin eval` (2.1.269) can be
    the scored acceptance test, and `claude plugin details <name>` shows each plugin's projected
    token cost.
  - Plugins enabled only in user settings, or declared in a repo's `.claude/settings.json`, don't
    load in cloud sessions. `/cloud-plugins` decides whether `claude --cloud` sessions started
    from this Mac carry them.
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
  installs from the marketplace. If `mode: "link"` or `--plugin-dir` (PLUG-1) replaces the loose
  copies on this Mac instead of sitting beside them, re-decide this rule.

### Parked ideas (§2)
- **PLUG-8 Reach.** Installable isn't discoverable. Look into a listing in
  `anthropics/claude-plugins-official` (submission process not yet checked) and link the
  marketplace from the jchdev essays.

## §3 Harness follow-ups (2.1.310 update, 2026-10-25)

All `CLAUDE-ORIGIN`: proposed by the 2.1.310 harness-update handoff, not yet decided by the owner.

- ⬜ **HARN-1 Fork `pathfinder` and `gen-sys-doc`?** `CLAUDE-ORIGIN`. Five read-only reports
  now run with `context: fork` + `background: false` (`rediscover`, `cleanup-repo`,
  `diagramsystemflow`, `audit-burden`, `port-collision-scan`). These two were held back because
  they spawn subagents (pathfinder's parallel investigations, gen-sys-doc's refuter), and it is
  unconfirmed whether a forked run can. Fork them only after confirming it can.
- ⬜ **HARN-2 Sweeps on a schedule** `CLAUDE-ORIGIN`. Desktop scheduled tasks run on the Mac,
  load `~/.claude/skills/` and can use a fresh worktree per run; they fit the `~/Projects`
  walkers (`wip-reconciler`, `autonomous-doc-refresh`, `test-backfill`) and could replace the
  launchd jobs (`doc-hygiene-sweep`, `sysdoc-staleness`). Cloud scheduled tasks (`/schedule`)
  run with the Mac off but see only attached repos and not `~/.claude`; they fit report-only
  sweeps over a fixed repo list (`security-sweep`, `license-compliance`, `deadlink-check`,
  `config-drift`, `deploy-health`) and need the cloud setup script or account skills to find
  the skill. Spike `wip-reconciler` locally and `deadlink-check` in the cloud. A scheduled
  sweep's output is its report; the never-commit rule holds.
- ⬜ **HARN-3 `build-status` readable from the phone** `CLAUDE-ORIGIN`. The page is served on
  the Mac's localhost. Spike a private Artifact copy first (the phone can open it); a Claude Mod
  pane (2.1.287, `plugin-authoring`) is the other route.
- ⬜ **HARN-4 Background sessions instead of orphaned `claude -p`** `CLAUDE-ORIGIN`.
  `machine-health`'s watchdog kills orphaned headless runs. Check whether the launchd jobs that
  spawn `claude -p` should move to `claude --bg` (`claude agents` can attach, log, stop and
  respawn them).
- ⬜ **HARN-5 Commands → skills** `CLAUDE-ORIGIN`. The 2.1.310 loader labels
  `~/.claude/commands/` a deprecated source; only skills get `paths`, a supporting-files folder
  and live reload. Migrating ~45 files touches `sync-claude-slash`, the provenance allowlist and
  `gen-readme.py`, so plan it as one change.
- ⬜ **HARN-6 Recurring inventory prompt as a skill** `CLAUDE-ORIGIN`. A long versioned prompt
  that re-inventories the local projects gets re-pasted regularly. Draft it with `skill-creator`
  (with an eval), run its fan-out as a Workflow so the subagent cap queues instead of failing, and
  consider a Desktop scheduled task since it reads local folders.
- ⬜ **HARN-7 `prompt-improver` explicit-only?** `CLAUDE-ORIGIN`. Its description fires it on
  every standalone prompt, but in practice it's started by hand. If `/skill-doctor` shows the
  description costing context in every session, `disable-model-invocation: true` with sentinels
  kept matches that use. Owner's call; it reverses the standing "fire aggressively" decision.
- ⬜ **HARN-8 Account skills for cloud** `CLAUDE-ORIGIN`. Skills enabled on the claude.ai
  account load in cloud sessions, cloud scheduled tasks and Cowork, and sync into terminal
  sessions under `~/.claude/skills/synced/`. The upload accepts only Agent Skills spec fields
  (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`); a file with
  `argument-hint`, `context` or `disable-model-invocation` fails with "Unexpected key(s)". Use it
  only for a few skills wanted everywhere, with trimmed frontmatter.
