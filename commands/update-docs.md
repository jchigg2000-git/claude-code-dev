---
description: Audit and refresh documentation in the current repo — walks every non-gitignored file, cross-references doc claims against actual code/manifests/structure, fixes stale content in place. Autonomously adds clear-cut cruft to .gitignore (and untracks it) with a closeout report; flags ambiguous cases instead of guessing. Never commits, pushes, or merges. Fire on `/update-docs` or "refresh/update the docs."
argument-hint: "[optional scope path, defaults to repo root]"
allowed-tools: Bash(git:*), Bash(rg:*), Bash(find:*), Bash(ls:*), Bash(wc:*), Bash(stat:*), Bash(file:*), Bash(cat:*), Bash(head:*), Bash(date:*), Bash(node:*), Bash(jq:*), Read, Edit, Write, Glob, Grep, Skill, AskUserQuestion
---

# Update Docs — Stale Documentation Sweep

You are refreshing this repo's documentation against current reality. Your job: find stale claims in docs, fix them in place, and clean up obvious gitignore gaps along the way. Report what you did.

Scope: $ARGUMENTS (default: repo root from cwd)

---

## Operating contract

1. **Edit in place.** Preserve voice, structure, and formatting conventions of each file. Don't rewrite for style — only fix what's actually wrong.
2. **No invention.** Don't add features, benchmarks, or claims the code doesn't support. If a doc gap exists but you're not sure what belongs there, flag it; don't fabricate.
3. **Evidence-driven.** Every change must be grounded in something concrete: a manifest version, a file that does/doesn't exist, a CLI flag the code actually exposes, a path that resolves.
4. **Autonomous gitignore for clear-cut cruft.** Build artifacts, secrets, caches, IDE configs, OS junk, node_modules-style dirs → add to .gitignore (and `git rm --cached` if tracked). No confirmation needed. Report each one.
5. **Conservative on ambiguity.** If you can't tell whether a doc claim is stale or just abstract, flag it. If you can't tell whether a file is cruft or intentional, leave it alone and flag it.
6. **No git side effects beyond .gitignore + index untracking.** Do not commit, push, merge, or branch. Leave the tree dirty for the user.
7. **Licenses are delegated, never authored here.** A missing license is Phase 6b's business: signal-gated, offered interactively, never applied on an unattended run.

---

## Phase 1 — Inventory

```bash
# Repo identity
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git status --porcelain | head -50

# File sets
git ls-files                                              # tracked
git ls-files --others --exclude-standard                  # untracked, not ignored
git ls-files -i -c --exclude-standard                     # tracked but matched by .gitignore (already-leaked cruft signal)

# Existing ignore rules
find . -name .gitignore -not -path '*/node_modules/*' -not -path '*/.git/*'
```

Detect toolchain from manifests: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle*`, `*.csproj`, `Gemfile`, `composer.json`, `requirements*.txt`, `Pipfile`. Record versions, declared scripts, declared bins/entrypoints — these are your source of truth for cross-referencing.

---

## Phase 2 — Identify documentation surfaces

In-scope files (anything not gitignored):

- Top-level: `README*`, `CONTRIBUTING*`, `CHANGELOG*`, `ARCHITECTURE*`, `ROADMAP*`, `SECURITY*`, `CODE_OF_CONDUCT*`
- Directories: `docs/**`, `documentation/**`, `.github/**.md`
- Extensions: `*.md`, `*.mdx`, `*.rst`, `*.txt` (if doc-shaped)
- Inline: top-of-file module docstrings / package docs IF the user's project relies on them as primary docs (skim, don't deep-edit)

Skip: third-party `vendor/**` docs, `node_modules/**`, lockfiles, anything matched by `.gitignore`. (`LICENSE*` / `NOTICE*` get a dedicated pass in Phase 6 — don't fold them into general stale-claim editing here.)

---

## Phase 3 — Stale-claim detection

For each in-scope doc file, check claims against repo state:

| Claim type | How to verify |
|---|---|
| Install / setup commands | Do the scripts exist in `package.json`/`Makefile`/etc.? Does the runtime version match the manifest? |
| Run / dev commands | Are the script names current? Are the flags real? |
| File / directory paths | Does the path resolve? Use Glob/Read. |
| Internal links (`./foo.md`, `../docs/bar`) | Target file exists? |
| Version numbers (Node, Python, language requirements) | Match `engines`, `python_requires`, `rust-toolchain`, etc.? |
| Dependency names | Still in the manifest? Renamed? |
| Code snippets / API examples | API still exists with that signature? (grep for the symbol) |
| Env var names | Referenced in code? |
| Port numbers / endpoints | Match what the code actually binds / exposes? |
| TODO/FIXME in docs referencing planned work | Is the work done? (grep code for the feature) |
| Architecture diagrams / file-tree listings | Does the tree still look like that? |

For each finding, decide:

- **Fix in place** — the correct value is unambiguous (e.g., script renamed `dev` → `start`, version bumped, path moved).
- **Flag as ambiguous** — claim is unclear, abstracted, or could be intentional aspiration vs. drift. Leave the doc untouched, add to closeout.

---

## Phase 4 — Gitignore sweep (autonomous)

While walking, flag any file matching clear-cut cruft patterns:

**Always-ignore (act without asking):**

- `.env`, `.env.local`, `.env.*` (NOT `.env.example` / `.env.sample`)
- `.DS_Store`, `Thumbs.db`, `desktop.ini`
- `node_modules/`, `.venv/`, `venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`
- `dist/`, `build/`, `out/`, `target/` (when matched with the language's standard build dir)
- `.next/`, `.nuxt/`, `.svelte-kit/`, `.turbo/`, `.parcel-cache/`
- `*.log`, `npm-debug.log*`, `yarn-debug.log*`, `yarn-error.log*`
- `.idea/`, `.vscode/` (unless repo already has tracked `.vscode/` files — then leave it)
- `coverage/`, `.nyc_output/`, `*.coverage`, `htmlcov/`
- `*.swp`, `*.swo`, `*~`
- Anything with `secret`, `credential`, `private_key`, `.pem`, `.p12`, `.key` in the name (treat as secret-adjacent — ignore, then **flag in closeout for rotation review**)

**Action per match:**

1. Add appropriate pattern to `.gitignore` (use the smallest pattern that covers it — `.env` not `apps/foo/.env`).
2. If currently tracked (`git ls-files --error-unmatch <path>` succeeds), also `git rm --cached <path>`.
3. Record in the closeout: file/pattern, reason, whether it was tracked.

**Ambiguous (don't ignore — flag instead):**

- Files that *could* be intentional fixtures or examples (e.g., `test-output.json`, `sample-data.csv`).
- Large binaries that might be assets.
- Anything where the name doesn't clearly map to a known cruft pattern.

---

## Phase 5 — Apply edits

For each "fix in place" finding from Phase 3:

1. Read the file.
2. Use Edit to replace the exact stale string with the corrected one.
3. Preserve surrounding formatting (code fences, list markers, heading levels).
4. If a section is broadly wrong (not just a string), prefer a minimal rewrite of just that section over rewriting the whole file.

If the same stale claim appears in multiple files (e.g., wrong Node version in README and CONTRIBUTING), fix all instances.

---

## Phase 6 — License consistency audit

Verify the declared license is consistent everywhere it appears. License drift is silent and legally meaningful — worth a dedicated pass rather than folding into the general stale-claim sweep.

**Inventory license claims:**

- Root: `LICENSE*`, `COPYING*`, `NOTICE*` — what license is declared, what copyright year, what holder
- Manifests: `license` field in `package.json`, `pyproject.toml` (`[project] license` or classifiers), `Cargo.toml`, `composer.json`, `Gemfile`/`*.gemspec`, `go.mod` (LICENSE-only convention), etc.
- Docs: README license section, shields/badges (`img.shields.io/.../license-*`), CONTRIBUTING, any cross-references to `LICENSE.md`
- Source headers: `SPDX-License-Identifier` comments at top of source files — only where the project already uses them as a convention. Don't introduce headers that aren't already there.

**Cross-check:**

| Check | How |
|---|---|
| Root LICENSE exists | At least one of `LICENSE` / `LICENSE.md` / `LICENSE.txt` / `COPYING` at repo root |
| Manifest license matches LICENSE | Manifest `license` field uses the SPDX id matching the root license file content |
| README license claim matches | README "License" section / badge names the same license as the root file |
| SPDX headers consistent | All `SPDX-License-Identifier:` headers use the same id as the root license |
| Copyright year current | Copyright year in LICENSE / headers covers the current year (per `date +%Y`); flag if it ended more than a year ago without update |
| Copyright holder consistent | Same name/entity across LICENSE, headers, and docs |
| No stale prior-license references | If the license has changed, no docs / headers / manifests / badges still name the old one |

**Action per finding:**

- **Fix in place** — clear-cut drift only: copyright year bump (`2024` → `2026` on the copyright line), SPDX identifier typo in a manifest (`"MIT License"` → `"MIT"`), README badge URL pointing at the wrong license slug, holder name spelling fix where the correct spelling is unambiguous from the root LICENSE.
- **Flag as ambiguous** — anything that requires deciding which source is authoritative: LICENSE says MIT but `package.json` says Apache-2.0, multiple holders listed inconsistently, partial SPDX-header adoption across the codebase. Leave the files untouched; add to closeout.
- **No license at all** — handled by Phase 6b below, not by flagging here.

**Never relicense.** If the root LICENSE file's license type itself looks wrong relative to everything else, that is always a flag — never an edit. Changing a license is a legal decision, not a doc-hygiene one.

---

## Phase 6b — No license at all

Fires only when Phase 6 found **no license anywhere**: no root `LICENSE*`/`COPYING*`, no manifest `license` field, no SPDX headers, no README license section. If any of those exist, skip this phase entirely.

An unlicensed repo is not automatically a defect. Per the base working agreement, most repos under `~/Projects` are local prototypes where a license isn't wanted, so the response is signal-gated.

**Read the signals:**

| Signal | Weight |
|---|---|
| Public git remote (github.com, gitlab.com, codeberg.org, sr.ht) and not a fork | strong |
| Publishable package — `package.json` without `"private": true`, a `publishConfig`, a PyPI/crates manifest set up to publish | strong |
| Client-facing or commercial — deployed instance, Railway/compose prod config, a named client brand, revenue or sales framing in README/ROADMAP | strong |
| Distributed binary or installer — notarized app, release artifacts, download page | strong |
| Localhost-only, sandbox/demo/personal framing in README, no remote, no deploy | negative — prototype |

**Action:**

- **No strong signal** → one factual line in the report: *"No license (fine for a local prototype)."* Do not call it a gap, do not offer, do not nag. Same posture as the CI/CD rule.
- **Any strong signal, running interactively** → surface it and offer the fix. State which signal fired, then ask once via `AskUserQuestion`:
  - **Keep it closed** — report that the repo wants a proprietary license and stop there. This command never writes one; choosing and applying a commercial license is a deliberate step taken separately.
  - **Open source it** — hand off to `/harden-licenses` for the OSI path; do not write an OSI license from here.
  - **Leave it** — record the decline in the report so the next run doesn't re-ask.
- **Any strong signal, running unattended** → **report only, never apply.** Autonomous callers (`/autonomous-doc-refresh`, the weekly doc-consolidation LaunchAgent, any `-p` headless run) must not stamp a license onto a repo without the operator in the loop. Emit the line *"Unlicensed + <signal> — pick a license when you're at a keyboard"* and move on. Detect unattended by the absence of an interactive session; if in doubt, treat it as unattended.

**Surface, never write.** This phase's entire job is to raise the signal and record the answer. Do not write license text, manifest license fields, or a README license section from here — that is a separate, deliberate act.

---

## Phase 7 — Closeout report

Print to chat. Format:

```
## update-docs report

### Files updated
- path/to/README.md
  - Node version 18 → 20 (matches package.json engines)
  - `npm run dev` → `npm start` (script renamed)
- path/to/docs/setup.md
  - Removed reference to deprecated --legacy-auth flag

### .gitignore changes
- Added `.env` — secret config, was untracked
- Added `dist/` — build output, untracked
- Added `.DS_Store` — OS cruft, was TRACKED, ran `git rm --cached`
- Added `*.pem` — secret-adjacent, was TRACKED, ran `git rm --cached` ⚠️ ROTATE: api-key.pem may have been exposed in git history

### License consistency
- LICENSE copyright year 2024 → 2026 (current year per `date +%Y`)
- package.json `"license": "MIT License"` → `"MIT"` (SPDX id)
- README badge URL slug `license-mit-orange` already correct
- Flag: pyproject.toml classifier names Apache-2.0 but root LICENSE is MIT — needs human decision on which is authoritative
- No license + public remote → flagged; needs a license decision (nothing written)
  (other shapes this line takes: "No license (fine for a local prototype)" · "Unlicensed + publishable package — pick a license when you're at a keyboard" · "No license — you declined, not re-asking")

### Flagged — ambiguous doc claims (not edited)
- README.md L42: "supports Postgres, MySQL, and SQLite" — only Postgres adapter found in src/; unclear if others are planned or removed
- docs/architecture.md L88: file tree listing references `services/billing/` which doesn't exist; could be aspirational

### Flagged — ambiguous files (not gitignored)
- test-output.json (top-level) — could be a tracked fixture or stale run output; you decide

### Skipped / unverified
- Code snippets in docs/api-examples.md — couldn't confirm signatures without running the code
- ARCHITECTURE.md — large file, scanned but no obviously-stale claims found

### Next steps
- Review the flagged items above
- If any .pem/.key was previously committed, rotate the secret (git history still has it)
- Commit when satisfied
```

Keep the report tight — one line per change, no prose paragraphs. The user reads diffs, not your essay about diffs.

---

## Hard constraints

- Never `git commit`, `git push`, `git merge`, `git branch`, or `git checkout -b`.
- Never modify code files — docs only. The one exception is `.gitignore`.
- Never delete a file from disk. `git rm --cached` (index-only) is the only removal allowed, and only for clear-cut cruft.
- Never modify third-party vendored docs. Edits to `LICENSE` / `NOTICE` are limited to the narrow fixes Phase 6 allows (copyright year bumps, SPDX identifier or holder-name typos) — never relicense, never rewrite the license body.
- Never write a *new* license yourself. Phase 6b surfaces the gap and records the decision; applying a license is always a separate, deliberate step.
- If the repo is not a git repo (`git rev-parse` fails), stop and tell the user — this command assumes git.
