---
description: Project hygiene audit + iterative remediation loop. Phase 1 is a read-only audit (gitignore gaps, unused files, manifest/lockfile drift, stale TODO markers, missing foundational config) that produces self-contained per-category handoff packets. Phase 2 surfaces the top 3 highest-leverage items, walks the user through y/n approval in batches, executes the approved set, and ships via /shipit. At session end, prunes the in-repo LOW_HANGING_FRUIT.md ledger to reflect what got done and what's still open. Fire on `/lowhangingfruit` or requests to "find easy cleanup wins" / "low-risk hygiene audit."
allowed-tools: Bash(git:*), Bash(rg:*), Bash(find:*), Bash(wc:*), Bash(stat:*), Bash(go:*), Bash(npm:*), Read, Glob, Grep, Write, Edit
---

# Project Hygiene Audit (Read-Only)

## Role

You are conducting a read-only hygiene audit of a project directory. Output a categorized report of low-risk, low-impact findings a maintainer could address opportunistically. You produce findings, not changes. Do not refactor, edit, format, or restructure anything.

**Handoff requirement.** Each category section in your report must be a self-contained briefing — a downstream agent should be able to copy any single section into a fresh context and begin remediation without seeing this prompt or any other section. No "see above," no implicit references to other categories, no shared preamble.

## Scope

- **Audit root:** the current working directory. Do not traverse outside it.
- **Respect existing ignore files** (`.gitignore`, `.dockerignore`, `.eslintignore`, etc.) when scanning, but flag mismatches between what they cover and what they should cover.
- **Sample, don't exhaust.** For categories requiring file-content inspection, cap at 50 files per category and report coverage in the output.
- **Disambiguate scope before starting.** If multiple plausible project roots exist (monorepo, nested submodules, vendored dependencies), ask before proceeding.

## Categories

Report findings under these exact labels:

1. **`gitignore-gap`** — tracked files matching common ignore patterns (build artifacts, dependency directories, OS metadata, IDE files, logs, env/secrets, lockfiles in unexpected places). Also: untracked files that should be in `.gitignore` to prevent future accidents.

2. **`unused-file`** — files with no inbound references in code, config, docs, or build pipelines. Higher confidence for clearly inert names (`*.bak`, `*.old`, `*.orig`, `*.tmp`, `Untitled*`, `Copy of *`, `_old/`, `.DS_Store`, dated backup dirs).

3. **`drift`** — internal inconsistencies between artifacts that should agree:
   - Manifest vs lockfile (`package.json`/`package-lock.json`, `pyproject.toml`/`uv.lock`, `Gemfile`/`Gemfile.lock`, `Cargo.toml`/`Cargo.lock`, etc.)
   - README/docs referencing files, scripts, commands, or directories that no longer exist
   - Example configs (`*.example`, `*.sample`, `*.template`) drifted from the active config
   - Env vars documented but unused in code, or referenced in code but undocumented

4. **`low-impact-cleanup`** — trailing whitespace, missing EOF newlines, mixed line endings, inconsistent quote styles within a single file, commented-out code blocks ≥ 10 lines, empty files, empty directories.

5. **`stale-marker`** — `TODO`/`FIXME`/`XXX`/`HACK`/`DEPRECATED` comments referencing closed issue numbers, dates > 12 months old, or owners no longer in commit history.

6. **`config-hygiene`** — missing or anomalous foundational files: no `.editorconfig`, no `.gitattributes`, no `LICENSE`, no `README`, no CI config, missing expected lockfile, executable bits on non-script files, unusual permissions.

## Output format

Produce a single Markdown report with two layers: a top-level summary for the human reader, then per-category handoff packets for downstream agents. The summary is **not** intended to be pasted forward; the packets are.

### Layer 1 — Audit summary (human-facing, do not paste forward)

- Audit root path (absolute).
- Branch and commit SHA at audit time.
- Total files: scanned / sampled / skipped (with reason).
- Per-category finding counts and confidence distribution (high / med / low).
- Categories with **zero** findings: list explicitly. Absence is information.
- Anything that blocked the audit or required a scope decision the user resolved.

### Layer 2 — Per-category handoff packets

Emit one packet per category that has at least one finding. Use the template below verbatim. Categories with zero findings get one line in the summary and no packet.

Each packet must:
- Restate enough context that a fresh agent can act without seeing this prompt.
- Carry forward the audit's confidence reasoning, not just conclusions.
- Bound remediation to its own category. No scope creep.
- Note any paths that also appear in other packets (`cross_refs`) so the human or orchestrator can sequence the work and avoid double-actions.

#### Packet template

````markdown
---

## Handoff packet: `<category-label>`

**Audit context (do not modify).**
- Source audit: read-only hygiene audit dated `<ISO date>` against `<repo root>` at commit `<sha>`.
- Audit cap for this category: `<n>` files sampled / `<m>` candidates identified. Sampling strategy: `<one line>`.
- Findings below may be stale if the working tree has moved since the audit. Verify before acting.

**Your role.**
You are a remediation agent for the `<category-label>` category only. You inherit the findings below as starting hypotheses, not commitments.

**Change authority.** `<one of: propose-diff-only | commit-allowed-on-feature-branch | commit-allowed-on-current-branch>`
- Rationale: `<one line tying authority to blast radius and reversibility>`.

**Mission.**
`<One paragraph. State the specific remediation goal for this category, the blast radius, and the reversibility profile. Example for gitignore-gap: "Stop tracking files matching standard ignore patterns and add the corresponding entries to .gitignore. Fully reversible via git history. Do not touch files outside the listed paths.">`

**Findings.**

| # | Path | Evidence | Confidence | Suggested action | Disconfirming signal to check |
|---|------|----------|------------|------------------|-------------------------------|
| 1 | `path/to/file` | `<line ref, snippet, or rationale>` | high / med / low | `<concrete action, e.g. git rm --cached + add pattern to .gitignore>` | `<what would invalidate this finding>` |

(Use a table for ≥3 findings; use a bulleted list with the same fields for ≤2.)

**Cross-references.**
- Paths in this packet that also appear in other category packets: `<list, or "none">`. Coordinate or sequence to avoid double-actions.

**Verification gate (run before any change).**
- `<concrete check 1, e.g. git ls-files | grep -E "<pattern>" to confirm path is still tracked>`
- `<concrete check 2, e.g. grep -r "<symbol>" src/ to confirm no new inbound reference appeared>`
- If verification fails for a finding, skip it and report the discrepancy. Do not act on stale findings.

**Out of scope for this packet.**
- `<adjacent issue 1 a remediation agent might be tempted to also fix — explicitly forbid>`
- `<adjacent issue 2>`
- Any finding from another category, even if encountered incidentally.

**Definition of done.**
- `<End-state description: what the repo should look like when this packet is complete.>`
- Report back with: paths changed, paths skipped + reason, verification command output, and any new findings discovered during remediation (do not act on those — escalate).

---
````

## Hard rules

- Read-only. Do not modify any file during the audit.
- For `unused-file`, do not infer from filename alone — require absence of inbound references and state the search scope used.
- For any finding with `low` confidence, populate the disconfirming-signal column. If you cannot articulate one, downgrade the finding or drop it.
- If a category hits the 50-file sampling cap, state the cap was hit and which paths/patterns were prioritized.
- If determining whether something is a finding would require making changes, omit it and note the gap in the audit summary.
- Each packet must be valid Markdown on its own. A user must be able to select a single packet, paste it elsewhere, and have a coherent briefing.

## Post-audit: top-3 batched-remediation loop

After delivering the report (Layer 1 + Layer 2), do **not** stop. Move into an interactive remediation loop:

1. **Surface the top 3 highest-leverage items** from the audit. Order by impact × reversibility × effort, not by category. Lead with the item that most reduces ongoing pain or unblocks future work (e.g., a critical secret exposure or a stale README beats a `.editorconfig` add). For each item, give:
   - One-sentence "what" + one-sentence "why" with the evidence pointer.
   - Concrete file paths.
   - Effort estimate.

2. **Ask `y/n` per item** in a single round (e.g., "Reply `y y n`"). The user can also annotate (e.g., "y but only do X part," "y, are you sure Y isn't load-bearing?"). Treat annotations as binding constraints, not suggestions — verify any "are you sure" with a direct grep/read before acting.

3. **Flag parallelization opportunities.** If two or more approved items are file-disjoint (touch non-overlapping paths) and one is large enough to be worth delegating, offer to spawn a subagent for the bigger one while the main thread handles the others. Do not parallelize file-conflicting items; sequence them. Do not parallelize trivial items where delegation overhead exceeds the work.

4. **Execute the approved set.** Use TaskCreate/TaskUpdate to track each item. After the batch, run `/shipit` (or the project's equivalent) to land the work as a single coherent commit on `main`.

5. **Repeat.** After shipping, if the user asks "what's next?" or "more?", surface the next 3 items from the audit ledger. Skip items the user previously declined unless they re-raise them.

Stop the loop when: the user says stop, the audit has no items left, or three consecutive batches end in all-`n` responses (the remaining items aren't worth the user's attention).

## Closing step: prune the ledger

At the end of each shipped batch — and **always** at the end of the session — rewrite the in-repo audit ledger (typically `LOW_HANGING_FRUIT.md`, or whatever similarly-named planning doc the project uses) so it reflects current reality:

- **Drop** items that just got done. Move them to a "Done" section *only* if the project's convention preserves changelogs in this doc; otherwise just delete them — git history is the record.
- **Drop** items the user explicitly declined this session AND that no longer apply (e.g., a "remove deleted file X" item where X is no longer present anyway).
- **Keep** items the user declined-for-now that are still valid, but note `_declined <date>_` so a future pass doesn't re-litigate. Move them to a "Deferred" sub-section if the doc gets cluttered.
- **Keep** items the audit surfaced but the user never reviewed (the audit produced more findings than the loop got to). Group them under "Pending review."
- **Add** any new findings discovered *during* remediation that weren't in the original audit — but only those a remediation agent couldn't act on within its scope. Don't smuggle in new audit work.
- **Cross-reference** larger items that belong in `roadmap.md` (or equivalent) instead of `LOW_HANGING_FRUIT.md`. Don't duplicate.
- **Update the timestamp and commit SHA** at the top so the next session knows when the ledger was last reconciled.

If the project has no existing ledger doc, create `LOW_HANGING_FRUIT.md` at repo root the first time. Keep it short — a ledger, not a report. The audit produces the full report; the ledger is the running open-item list distilled from it.

Ship the ledger update with the final batch of the session (or as its own small commit if no other work shipped). The ledger should never lag behind the audit by more than one session.