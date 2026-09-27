---
name: pack-toolbag
description: >
  Pack a minimal, scrubbed, translated subset of my personal harness into a repo that is
  going somewhere I won't have it — a client site, a partner tenant, a handover to another
  team. Selects only the commands that serve the job at hand, TRANSLATES each into the
  target assistant's native format (Claude Code `.claude/`, Copilot `.github/prompts/` +
  `applyTo` instructions, Cursor `.cursor/rules/`, or plain human runbooks when no AI
  tooling is permitted), scrubs every reference to my other work, and sizes each file for
  a weak context window. Hard-excludes anything destructive or anything that would stamp
  my identity on someone else's codebase. Fire on `/pack-toolbag`, "pack my tools into
  this branch", or from `/prep-integration` PHASE 2.
---

# Pack Toolbag

The situation: a repo is going somewhere my `~/.claude/` harness does not exist. Inside
that place the context window is small, the tooling may not be Claude Code, and the
codebase belongs to someone else.

**This is a translation-and-selection job, not a copy job.** Three failure modes it exists
to prevent, in descending order of how much they cost:

1. **Shipping a destructive command into a repo with real branch protection and a
   compliance trail.** `/shipit` force-merges to `main` and deletes remote branches.
2. **Leaking my business context into a client's codebase** — other engagements, other
   client names, my repos, my company, my infrastructure — where their team reads it.
3. **Shipping files in a format the inside assistant cannot read**, or so large its
   context drops them silently. Both fail quietly, which is worse than failing loudly.

Scope: **the current working directory only.** Writes into the repo; never modifies
`~/.claude/`.

## What this does NOT do

- It does not copy the harness. A subset, translated and scrubbed, or nothing.
- It does not generate anything inside the target environment. **Generation happens here,
  where context is cheap**; the target receives small finished files. If a command seems
  to need iterative in-environment generation, the file is too big — split it.
- It does not carry my preferences, working agreements, or `CLAUDE.md` philosophy into
  someone else's repo. Those are mine, they are not theirs, and they read as noise or
  presumption in a codebase I do not own.
- It does not commit or push.

---

# PHASE 0 — Establish the target harness

If invoked from `/prep-integration`, take the ROUND B answer and skip this. Standalone,
ask **one** question: what assistant will exist inside, since it decides every file path
and format below.

| Inside harness | Files it actually reads | Invocation |
|---|---|---|
| **Claude Code** | `.claude/commands/<name>.md`, `.claude/skills/<name>/SKILL.md`, repo `CLAUDE.md` | `/<name>` |
| **Copilot in VS Code / Visual Studio / JetBrains** | `.github/prompts/<name>.prompt.md` (reusable, manual), `.github/copilot-instructions.md` (repo-wide, automatic), `.github/instructions/<name>.instructions.md` (path-scoped via `applyTo` glob, automatic) | `/<name>` in Copilot Chat |
| **Copilot CLI** | `AGENTS.md` and custom-instruction files | automatic |
| **Cursor** | `.cursor/rules/<name>.mdc` | automatic / `@` reference |
| **None permitted** | `integration/runbooks/<name>.md` | a person reads it |

Two notes that decide the layout:

- **Prompt files are the analogue of a slash command** — manually invoked, one task each.
  **Instruction files are the analogue of `CLAUDE.md`** — applied automatically, and
  path-scoped ones only load when the open file matches their `applyTo` glob. That glob is
  the native fix for a small context window: put standing rules in narrow, path-scoped
  instruction files and they cost nothing until they are relevant.
- **When the answer is "none permitted," the translation target is a human.** Strip every
  instruction addressed to a model. What remains must be commands a person can run and
  decisions a person can make.

---

# PHASE 1 — Select the toolbag

**Default to fewer.** A packed toolbag of six commands that all work beats twenty where
four are broken, three are dangerous, and the rest are never invoked.

## The inclusion test

A command earns a slot only if it serves the job the repo is travelling for. For an
integration that means one of:

- **Discover** — probing an unfamiliar environment, surfacing what is unknown or blocked.
- **Wire** — the actual connection, configuration, and mapping work.
- **Prove** — verifying the wiring is right, and that nothing secret or synthetic leaked.
- **Hand over** — explaining the system to the host's team.

Everything else is my workflow, not the job.

## Hard exclusions — never pack, regardless of the inclusion test

- **Anything that pushes, merges, deletes branches, force-writes, or rewrites history.**
  `/shipit` is the archetype: in my own repo it is the point; in a client repo with branch
  protection, required review, and an audit trail it is a live hazard on first invocation.
  If a shipping flow is genuinely wanted inside, write a new one against *their* branch
  policy — do not carry mine.
- **Anything that asserts my identity on their code.** A command that stamps my copyright,
  my license, or my authorship onto a codebase I do not own. This class is not a style problem.
- **Anything scoped beyond the repo** — `~/Projects`-wide sweeps, harness audits, mirror
  syncs, port registries, cross-repo doc consolidation. They will either fail or reach
  somewhere they should not.
- **Anything naming my infrastructure or accounts** — deploy platforms, hosting, personal
  tokens, my memory directory.
- **Anything about my preferences or my harness itself.** Recalcification, harness hygiene,
  working-agreement enforcement.
- **Showcase and portfolio work.** Journey pages, ratchet ledgers, page-polish loops.

## Candidate shortlist

Re-derive from the live harness each run — the set drifts. As of writing, the commands
that pass the test for an enterprise integration:

| Command | Why it earns a slot |
|---|---|
| `harden-secrets` | First time handling *real* credentials. The highest-value thing to have on site. |
| `ask-me` | Surfaces the decisions blocking the build, which on site are the host's to make. |
| `roadmap` | How multi-day work stays coherent across sessions and a weak context. |
| `rediscover` | Resuming after a day away, or after the context is gone. |
| `diagramsystemflow` / `gen-sys-doc` | Explaining the system to the host's architects — often the actual deliverable. |
| `generate-test-suite` | If tests get added, this right-sizes them instead of a sprawling suite. |
| `harden-auth` | Relevant once the real IdP goes in. |

Present the proposed set with one line each and let me cut it before anything is written.

---

# PHASE 2 — Translate

One agent per command, in parallel, on a cheap model — this is mechanical translation, not
judgment. Batch them and checkpoint between batches so I can see the first two before the
rest are written.

For each selected command:

1. **Read the source** from `~/.claude/commands/<name>.md` or
   `~/.claude/skills/<name>/SKILL.md`.
2. **Retarget the format** per the PHASE 0 table. For Copilot, that means real
   `.prompt.md` frontmatter, not a renamed Claude command file.
3. **Rewrite for the inside context**, which is smaller and knows nothing:
   - **Self-contained.** No cross-references to other toolbag files, no "see my other
     command," no assumed conventions. Each file stands alone.
   - **Target ~100 lines, hard ceiling ~200.** Over that, either the command is doing too
     much for this setting or it needs splitting into two prompts. Do not ship a file the
     inside assistant will silently truncate.
   - **Repo-relative paths only.** Every `~/`, every absolute path, every sibling-repo
     assumption becomes a path inside this repo or is cut.
   - **State what it does not do.** A prompt file that overreaches in an unfamiliar
     codebase is worse than one that stops short.
4. **Scrub.** See PHASE 3 — but do it during translation, not as a pass afterwards.

## Standing rules → instruction files, not prompt files

Anything that is a *rule* rather than a *task* — conventions to follow while editing, a
seam not to break, a directory that is generated — belongs in a path-scoped instruction
file with an `applyTo` glob, so it loads automatically and only when relevant. Examples:
a rule about the data-provider seam scoped to the provider directory; a rule about not
editing generated migrations scoped to their path. This is the single most effective thing
available for a weak inside context: the rule is present when it matters and absent
otherwise.

Keep the repo-wide file (`.github/copilot-instructions.md` / `AGENTS.md` / `CLAUDE.md`)
**short** — what the app is, where the seams are, what must not change. Not my working
agreement.

---

# PHASE 3 — Scrub

Non-negotiable, and it is checked rather than assumed. Grep the emitted files for:

- Absolute home paths, `~/Projects`, any sibling-repo name.
- **Any other client, engagement, employer, or product name.** This is the one with real
  consequences — a client reading my other clients' names in their repo.
- My company, my legal entity, my personal email, my domains.
- Deploy platforms, hosting accounts, dashboards, project ids.
- Tokens, keys, connection strings, internal hostnames — including in examples.
- Model or vendor pins that do not apply inside, and cost/spend numbers.

Anything found is rewritten or removed. **Report the scrub as a count and a list of what
was stripped**, so the result is verifiable rather than claimed.

---

# PHASE 4 — Index and hand off

- Write `<toolbag-dir>/README.md`: what is here, how to invoke it in the target assistant,
  and one line per file. Someone else may be reading this.
- If `/prep-integration` produced `integration/README.md`, add a line pointing at the
  toolbag from its on-site checklist.
- Report: packed / excluded-with-reason / scrubbed. Excluded-with-reason matters most —
  it is where I find out that something I expected to have on site is not coming.

---

# Invariants

- **Fewer, working, scrubbed.** Every one of the three is load-bearing.
- **Translate, never copy.** A `.claude/` command in a `.github/prompts/` directory is a
  file the assistant will not read.
- **Nothing destructive travels.** Branch policy inside is theirs, not mine.
- **Nothing of mine that is not about their job travels** — my identity, my other work, my
  infrastructure, my preferences.
- **Generate out here, consume in there.** Small self-contained files; path-scoped rules
  for anything standing. Never an in-environment generation loop.
- **Report exclusions.** A packed toolbag that silently dropped something is how I discover
  on site that the thing I was counting on is not there.

---

# Arguments

- `--harness=<name>` — target assistant (`claude-code`, `copilot`, `copilot-cli`,
  `cursor`, `none`). Skips PHASE 0.
- `--only=<a,b,c>` — pack exactly these, skipping selection. Hard exclusions still apply.
- `--dry` — run PHASE 0-1 and print the proposed set, the format targets, and the
  exclusions. Write nothing.
- `--dir=<path>` — where the toolbag lands, when the target format does not dictate it.
