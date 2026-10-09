# claude-code-dev

My personal toolkit for [Claude Code](https://docs.claude.com/en/docs/claude-code): the slash commands, skills and MCP servers I use every day to plan, build, check and ship software with Claude.

- A **slash command** is a set of instructions you run by typing `/name` in Claude Code.
- A **skill** is the same idea packaged as a folder. Claude can also start a skill on its own when your request matches what it's for.
- An **MCP server** is a small local program that gives Claude extra tools to call.

Each name in the catalog below links to the instructions Claude actually reads. The one-line summary beside it is written for you.

## Install

Drop the contents into Claude Code's user-level config directory:

```bash
# Skills
mkdir -p ~/.claude/skills
cp -R skills/* ~/.claude/skills/

# Slash commands
mkdir -p ~/.claude/commands
cp commands/*.md ~/.claude/commands/
```

Skills are auto-loaded by name. Slash commands appear in the palette as `/<filename-without-extension>`.

If you're going to commit to this repo, activate the commit gates once per clone:

```bash
git config core.hooksPath githooks
```

## What's in here

Grouped by what you'd use it for. Commands and skills both run as `/name`.

<!-- BEGIN:catalog -->
**At a glance:**

- [Ship and save work](#ship-and-save-work) (4)
- [Plan and pick work back up](#plan-and-pick-work-back-up) (7)
- [Deploy hardening](#deploy-hardening) (10)
- [Repo health and cleanup](#repo-health-and-cleanup) (7)
- [Weekly sweeps across your repos](#weekly-sweeps-across-your-repos) (11)
- [Docs and diagrams](#docs-and-diagrams) (7)
- [Pages and UI polish](#pages-and-ui-polish) (6)
- [Build features and tests](#build-features-and-tests) (4)
- [App building blocks](#app-building-blocks) (4)
- [Hand a repo to another team](#hand-a-repo-to-another-team) (2)
- [Your Claude setup](#your-claude-setup) (7)
- [MCP servers](#mcp-servers) (2)

### Ship and save work

Get work committed, merged and safely parked.

| Name | Kind | What it does |
|---|---|---|
| [`/shipit`](commands/shipit.md) | command | Commits your work, merges it into main and pushes, then deletes the branch. If anything looks off, it stops and tells you where things are. |
| [`/stash`](commands/stash.md) | command | Moves a file Claude just made into a shared holding area so you can pull it into another repo. The holding area empties nightly. |
| [`/unstash`](commands/unstash.md) | command | Drops the most recently stashed file into the current repo. |
| [`/handoff-to-next`](commands/handoff-to-next.md) | command | Writes a dated note on what happened this session so the next session, or person, can pick up cold. Runs only when you ask. |

### Plan and pick work back up

Know what's left, what's next, and what's waiting on you.

| Name | Kind | What it does |
|---|---|---|
| [`/roadmap`](commands/roadmap.md) | command | Makes one ROADMAP.md the only list of what's left, folds other plan docs into it, and adds a check that catches the roadmap falling behind. |
| [`/cleanup-roadmap`](commands/cleanup-roadmap.md) | command | For coming back to a project: commits leftover work if it builds, prunes finished and stale roadmap items, then ships. |
| [`/rediscover`](commands/rediscover.md) | command | Looks over the repo and tells you the single best next thing to do. Changes nothing. |
| [`/ask-me`](commands/ask-me.md) | command | Finds the few open decisions actually blocking work in this repo and asks you them with real options, then records your answers. |
| [`/pathfinder`](commands/pathfinder.md) | command | Suggests a ranked list of features worth adding, each backed by evidence from the code. Changes nothing. |
| [`build-status`](skills/build-status/SKILL.md) | skill | A live page in your browser showing how a build is going: steps done and left, recent commits, test status, findings, and questions for you. |
| [`lead-keeper`](skills/lead-keeper/SKILL.md) | skill | One session that watches every build-status page on this Mac, passes your messages to each build and brings their replies back. |

### Deploy hardening

The `harden-*` series: checks to run before something goes live. `/harden-for-deploy` runs the eight numbered steps in order.

| Name | Kind | What it does |
|---|---|---|
| [`/harden-for-deploy`](commands/harden-for-deploy.md) | command | Runs all eight harden steps in order and writes one report. Stops early on anything critical. Never deploys. |
| [`/harden-secrets`](commands/harden-secrets.md) | command | Step 1: looks for leaked passwords and API keys in the code and its git history. |
| [`/harden-auth`](commands/harden-auth.md) | command | Step 2: reviews login, sessions and permissions for weak spots such as insecure cookies or unprotected routes. |
| [`/harden-deps`](commands/harden-deps.md) | command | Step 3: checks dependencies for known vulnerabilities, separating what ships to production from dev-only tools. |
| [`/harden-licenses`](commands/harden-licenses.md) | command | Step 4: lists every dependency's license and flags any that clash with yours, such as GPL code inside an MIT project. |
| [`/harden-config`](commands/harden-config.md) | command | Step 5: checks deploy settings for the target (Railway, npm or public GitHub): health check, license, README, no internal hostnames. |
| [`/harden-lint`](commands/harden-lint.md) | command | Step 6: makes sure a linter and type checker are set up and passing, without silencing rules to get there. |
| [`/harden-tests`](commands/harden-tests.md) | command | Step 7: finds important code with no tests (login, payments, data writes) and writes tests for the biggest gaps. |
| [`/harden-observability`](commands/harden-observability.md) | command | Step 8: checks that errors get logged, nothing fails silently, and there's a health-check endpoint. |
| [`/front-door-security`](commands/front-door-security.md) | command | A quick security pass on what outsiders can reach: fixes what's safe to fix and flags leaked keys that need replacing. |

### Repo health and cleanup

One-repo audits and fixes for cruft, risk and dead weight.

| Name | Kind | What it does |
|---|---|---|
| [`/cleanup-repo`](commands/cleanup-repo.md) | command | Finds stale files, committed junk, leaked secrets and .gitignore gaps, and writes a cleanup plan. Deletes nothing. |
| [`/lowhangingfruit`](commands/lowhangingfruit.md) | command | Finds easy cleanup wins, shows you the top three, and does the ones you approve. |
| [`/audit-burden`](commands/audit-burden.md) | command | Finds features that cost more than they're worth and traces each to the conversation that added it. Changes nothing. |
| [`/update-deps`](commands/update-deps.md) | command | Updates Node dependencies safely: asks before big upgrades, runs your checks, and offers to roll back if anything breaks. |
| [`/port-collision-scan`](commands/port-collision-scan.md) | command | Finds local projects that try to use the same network port and writes a fix-up plan for each clash. |
| [`/generate-port-registry`](commands/generate-port-registry.md) | command | Gives every local project its own port, recorded in one file, and installs the port-registry server so new projects get one automatically. |
| [`/get-network-logs`](commands/get-network-logs.md) | command | Pulls a deployed app's access logs and works out who's visiting (people, bots or scanners) and from where. |

### Weekly sweeps across your repos

Each sweep works through your most recently used repos one at a time, keeping a progress file so it can stop and resume. None of them commit or push.

| Name | Kind | What it does |
|---|---|---|
| [`autonomous-sweep-core`](skills/autonomous-sweep-core/SKILL.md) | skill | The shared engine the other sweeps are built on. You rarely run it directly. |
| [`autonomous-doc-refresh`](skills/autonomous-doc-refresh/SKILL.md) | skill | Fixes docs that no longer match the code, checking every claim against the source first. |
| [`brand-scrub-sweep`](skills/brand-scrub-sweep/SKILL.md) | skill | Finds real company names that slipped into docs where a codename belongs, and scrubs the accidental ones. |
| [`changelog-refresh`](skills/changelog-refresh/SKILL.md) | skill | Writes a CHANGELOG.md where one is missing and adds entries for releases it hasn't covered yet. |
| [`config-drift`](skills/config-drift/SKILL.md) | skill | Finds settings that have drifted: env vars missing from .env.example, unpinned versions, lockfiles out of step. |
| [`deadlink-check`](skills/deadlink-check/SKILL.md) | skill | Finds broken links in docs, fixes the internal ones it can, and flags dead external ones. |
| [`deploy-health`](skills/deploy-health/SKILL.md) | skill | Checks deployed services (mainly Railway) for failed deploys, errors, slowdowns, crash loops and stale code. Report only. |
| [`license-compliance`](skills/license-compliance/SKILL.md) | skill | Checks each repo's license and flags dependencies whose licenses conflict with it. |
| [`security-sweep`](skills/security-sweep/SKILL.md) | skill | Looks for leaked secrets and vulnerable dependencies and reports them. Never rewrites history or upgrades anything. |
| [`test-backfill`](skills/test-backfill/SKILL.md) | skill | Writes tests for important untested code, using each repo's existing test setup. |
| [`wip-reconciler`](skills/wip-reconciler/SKILL.md) | skill | Finds work at risk of being lost (uncommitted changes, stashes, unpushed branches) and gives you the commands to rescue it. |

### Docs and diagrams

Write, check and explain documentation.

| Name | Kind | What it does |
|---|---|---|
| [`/gen-sys-doc`](commands/gen-sys-doc.md) | command | Reads the whole repo and writes one system design document with diagrams, checking every diagram and link. |
| [`/gen-sdd-doc`](commands/gen-sdd-doc.md) | command | Writes a Solution Design Document for engineering leads and reviewers: architecture, decisions and risks, fact-checked. |
| [`/diagramsystemflow`](commands/diagramsystemflow.md) | command | Traces how requests and jobs flow through the code and draws it, with every step pointing to a file and line. |
| [`/update-docs`](commands/update-docs.md) | command | Checks the docs against the actual code and fixes what's out of date. Doesn't commit. |
| [`/generate-build-report`](commands/generate-build-report.md) | command | Writes BUILD_REPORT.md: how this repo was built, from Claude session logs and git history, with an honest look back. |
| [`enrich-document`](skills/enrich-document/SKILL.md) | skill | Adds a table of contents, cross-links, links to the tools it names, and copy-a-prompt buttons to a document. |
| [`plain-walkthrough`](skills/plain-walkthrough/SKILL.md) | skill | Explains a complicated system to non-engineers in one page: a real example walked step by step, plus a short glossary. |

### Pages and UI polish

Build and improve web pages and app screens. The page builders keep a scorecard, and a new version only counts if it beats the best one so far.

| Name | Kind | What it does |
|---|---|---|
| [`/generate-journey-page`](commands/generate-journey-page.md) | command | Builds a new one-page, scroll-driven explainer on a topic. Each new page has to beat the best one so far. |
| [`/level-up-page`](commands/level-up-page.md) | command | Makes a better version of an existing web page as a new file. Each version has to beat the last. |
| [`/plain-cut`](commands/plain-cut.md) | command | Makes a plain-language version of an overbuilt page: half the words, simpler figures. The original stays untouched. |
| [`/uxrefine`](commands/uxrefine.md) | command | Polishes an app's look and feel on a separate branch (layout, spacing, empty and error states, accessibility) without changing behavior. |
| [`/frontendtailwind`](commands/frontendtailwind.md) | command | Like /uxrefine, but for Tailwind + shadcn/ui projects and visuals only. |
| [`ux-tournament`](skills/ux-tournament/SKILL.md) | skill | AI models compete to redesign an app's hardest screen, judged blind; you get the winning design and a build plan. Expensive. |

### Build features and tests

Plan and build new work, with tests.

| Name | Kind | What it does |
|---|---|---|
| [`/feature-dev`](commands/feature-dev.md) | command | Guided feature build: studies the codebase, asks you the questions that matter, designs the approach, then builds it. |
| [`/ratchet-up`](commands/ratchet-up.md) | command | Builds two competing versions of a feature, scores them, and ships the winner only if it beats the current best. |
| [`self-improve-loop`](skills/self-improve-loop/SKILL.md) | skill | Works on one repo for up to four hours, finding security, speed, UI and code-quality fixes and shipping them one at a time. |
| [`/generate-test-suite`](commands/generate-test-suite.md) | command | Writes a focused set of tests for the parts of the repo that matter most, then checks the UI still works. |

### App building blocks

The `apply-*` series adds a proven piece from my other apps to this one, adapted to its stack. Each one skips what's already there.

| Name | Kind | What it does |
|---|---|---|
| [`apply-auth-pattern`](skills/apply-auth-pattern/SKILL.md) | skill | Adds login: accounts, sessions, viewer and admin roles, rate-limited sign-in, and an audit log. |
| [`apply-observability`](skills/apply-observability/SKILL.md) | skill | Adds an admin page showing what the app is doing: events, logins, response times and AI token costs. |
| [`apply-settings`](skills/apply-settings/SKILL.md) | skill | Adds an admin Settings page: saved app settings, account management, and per-browser preferences such as theme. |
| [`/apply-seo`](commands/apply-seo.md) | command | Adds what search engines and link previews need (sitemap, robots.txt, page titles, share cards), asking before it changes anything. |

### Hand a repo to another team

For a repo that's going into someone else's environment.

| Name | Kind | What it does |
|---|---|---|
| [`prep-integration`](skills/prep-integration/SKILL.md) | skill | Gets this repo ready to drop into a client's or partner's environment and writes the build spec for whoever wires it in. |
| [`pack-toolbag`](skills/pack-toolbag/SKILL.md) | skill | Packs a small, scrubbed set of these tools into a repo that's leaving, translated for their AI assistant or as plain runbooks. |

### Your Claude setup

For the Claude Code setup itself and the Mac it runs on.

| Name | Kind | What it does |
|---|---|---|
| [`prompt-improver`](skills/prompt-improver/SKILL.md) | skill | Offers to sharpen your prompt before Claude answers it. One keypress to accept or dismiss. |
| [`/unleash`](commands/unleash.md) | command | Tells Claude to stop asking for confirmation and finish the task, while keeping a few hard safety limits. |
| [`/claude-md-audit`](commands/claude-md-audit.md) | command | Finds duplicated, contradictory or stale instructions across all your CLAUDE.md files and tidies them with your OK. |
| [`/harness-audit`](commands/harness-audit.md) | command | Monthly tidy of your Claude commands and skills: removes empty and duplicate files and merges near-duplicates, with backups. |
| [`/harvestccskills`](commands/harvestccskills.md) | command | Builds a database of the skills and work in your Claude history, for a portfolio or résumé. |
| [`/sync-claude-slash`](commands/sync-claude-slash.md) | command | Copies your live Claude commands and skills into this repo so they're versioned and published. |
| [`machine-health`](skills/machine-health/SKILL.md) | skill | For when this Mac is slow or out of memory: finds what's hogging it, safely stops idle things, and leaves a watchdog running. |

### MCP servers

Small local servers that give Claude extra tools. Setup is in [mcp-servers/README.md](mcp-servers/README.md).

| Name | Kind | What it does |
|---|---|---|
| [`port-registry`](mcp-servers/port-registry/) | MCP server | Hands each new project a free network port and records it, so two local apps never fight over one. |
| [`loose-ends`](mcp-servers/loose-ends/) | MCP server | Gives Claude a quick digest of what's unfinished in a repo: uncommitted work, TODOs, stale docs, open backlog items. |
<!-- END:catalog -->

## Conventions

- Every slash command has frontmatter with at least a `description`. Where the command shells out, `allowed-tools` is restricted to the specific commands it needs.
- Audit-style commands are read-only and produce handoff plans for a separate executor pass — never one-shot mutations.
- Commands that mutate state (`/shipit`, `/frontendtailwind`) stop on any unexpected output rather than attempting recovery.
- The catalog above is generated by `scripts/gen-readme.py` from `docs/readme-catalog.json`, which holds a plain-English summary and a group for every entry. Don't hand-edit between the catalog's BEGIN/END comment markers. Each file's `description` frontmatter is written for Claude (it decides when a skill fires) and is used only as a fallback for an entry the catalog doesn't cover yet. `/sync-claude-slash --ship` regenerates the catalog; run `python3 scripts/gen-readme.py` by hand after any other change (or `--check` to catch drift).
- Everything under `commands/` and `skills/` is first-party, and `scripts/provenance-gate.py` enforces that rather than trusting it. See below.

## Provenance gate

This repo is populated by `/sync-claude-slash`, which copies one-way out of `~/.claude/`. That directory holds hand-written work *and* whatever a vendor installer drops there — a plugin or CLI install can unpack an entire third-party skill tree into it, and a bulk sync will happily offer that up as a "new skill." Everything published here is first-party and MIT-licensed, so vendor content must not reach it.

A prompt-level "don't sync that one" rule can't defend against this, because the sync command's own text is itself overwritten by the next sync. So the gate is a script plus a hook.

```bash
python3 scripts/provenance-gate.py            # staged paths (what the hook runs)
python3 scripts/provenance-gate.py --all      # whole tree
python3 scripts/provenance-gate.py --attest <path>   # approve new first-party work
```

Two layers, because they fail differently:

1. **Path allowlist** — `.provenance/first-party.txt` lists every attested path under `commands/` and `skills/`. Anything at a **new** path is denied until you attest it by hand. This is what catches a bulk sync sweeping in a directory nobody read.
2. **Content heuristics** — run on every scanned file *including* allowlisted ones, since layer 1 is blind to a vendor file that overwrites an approved path. They look for what a published artifact leaves behind: a self-declared skill id/version, a telemetry caller string, pinned deep links into someone else's source tree, a foreign copyright or non-MIT SPDX id, a vendor `llms.txt` docs feed, a bundled `LICENSE` or package manifest, semver frontmatter.

Blocking rules are deliberately biased toward false positives — a blocked commit costs one line in `.provenance/exceptions.txt` (`path`, `rule`, `reason`, tab-separated); a miss costs a license violation in a public repo. Two rules warn instead of blocking: `fat-skill-tree` and `unreviewed-install-hint`.

When it fires you have four options, and it prints all of them: delete the file (the harness copy is untouched, so nothing is lost), attest it, waive the rule with a written reason, or `git commit --no-verify` and fix it after. `/sync-claude-slash` runs the same gate at Phase 2.5 and reverts what it wrote on a block, but it is forbidden from attesting on your behalf — a sync that can approve its own output isn't a gate.

## License

[MIT](LICENSE)
