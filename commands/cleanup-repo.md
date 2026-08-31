---
description: Read-only repo audit for stale/orphaned files, tracked cruft, accidentally-committed secrets, empty files, and gitignore gaps — produces a risk-tiered cleanup plan with evidence per finding (.claude/plans/cleanup-<ts>.md) for a downstream executor agent. Never deletes, modifies, stages, or commits anything. Fire on `/cleanup-repo` or "plan a repo cleanup / audit the repo for stale files."
argument-hint: "[optional scope path, defaults to repo root]"
allowed-tools: Bash(git:*), Bash(rg:*), Bash(find:*), Bash(wc:*), Bash(stat:*), Bash(file:*), Bash(mkdir:*), Bash(date:*), Read, Glob, Grep, Write
---

# Repo Hygiene Audit → Cleanup Plan

You are conducting a read-only repository hygiene audit. Your output is a **plan file** that a separate executor agent will act on. You do not delete, modify, stage, or commit anything in this run.

Scope: $ARGUMENTS (default: repo root from cwd)

---

## Operating contract

1. **Plan, don't execute.** Final output goes to `.claude/plans/cleanup-<YYYYMMDD-HHMMSS>.md`. Nothing else changes.
2. **Evidence per finding.** Every entry cites the exact reason (pattern match, zero references found, last commit timestamp, etc.). No verdicts without receipts.
3. **Risk-tier everything.** Universal cruft and "I think this might be unused" must not appear in the same section.
4. **Conservative on ambiguity.** When in doubt, downgrade to "review required." False positives erode trust faster than missed cleanups.
5. **Never recommend secret deletion as routine.** Anything secret-adjacent is its own section with rotation guidance.

---

## Phase 1 — Inventory

Run in order. Cache results for the detection phase.

```bash
# Repo identity
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --porcelain | head -50

# File sets
git ls-files                                              # tracked
git ls-files --others --exclude-standard                  # untracked, not ignored
git ls-files -i -c --exclude-standard                     # tracked AND matched by .gitignore (priority signal)
git submodule status                                      # exclude these paths from analysis

# Existing ignore rules
find . -name .gitignore -not -path '*/node_modules/*' -not -path '*/.git/*'

# Repo activity baseline
git log -1 --format=%ci
git log --reverse --format=%ci | head -1
```

Detect primary language(s) from manifest files: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle*`, `*.csproj`, `Gemfile`, `composer.json`. Record which were found — detectors will use this.

If working tree is dirty, **note it in the plan header but continue**. The executor agent will gate on clean tree.

---

## Phase 2 — Detectors

Run each. Every finding records: `path`, `category`, `evidence`, `risk`, `recommended_action`.

### D1. Tracked cruft (LOW risk)

Cross-reference tracked files against well-known cruft patterns. The `git ls-files -i -c --exclude-standard` output from Phase 1 is the highest-priority slice — those files are tracked **and** match an existing ignore rule, meaning they were committed before the rule was added.

Patterns to match against tracked files:

- **OS:** `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.Spotlight-V100`, `.Trashes`
- **Editor:** `*.swp`, `*.swo`, `*~`, `.idea/`, `.vs/`, `*.suo`, `*.user`, `*.ntvs*`
- **Python:** `__pycache__/`, `*.pyc`, `*.pyo`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `*.egg-info/`, `.coverage`, `htmlcov/`, `.tox/`, `.venv/`, `venv/`
- **Node:** `node_modules/`, `.next/`, `.turbo/`, `.parcel-cache/`, `npm-debug.log*`, `yarn-debug.log*`, `pnpm-debug.log*`
- **Build outputs:** `dist/`, `build/`, `out/`, `target/` (if Rust/Java), `bin/`, `obj/`
- **Coverage:** `coverage/`, `.nyc_output/`, `lcov.info`, `*.lcov`
- **Logs:** `*.log`, `logs/`
- **Env (real):** `.env`, `.env.local`, `.env.*.local` — but NOT `.env.example`, `.env.sample`, `.env.template`
- **Java:** `*.class`, `.gradle/`
- **.NET:** `bin/`, `obj/`, `*.user`, `*.suo`
- **Rust:** `target/` (only if `Cargo.toml` present at that level)

For `.vscode/` specifically: read the contents. If `settings.json` contains absolute paths or per-user config, flag. If it's generic team config (`tasks.json`, shared linter settings), do not flag.

**Action:** `git rm --cached "<path>"` + add pattern to `.gitignore`.
**Risk:** LOW.

### D2. Backup / scratch files (LOW risk)

Match against tracked **and** untracked files:

- `*.bak`, `*.orig`, `*.old`, `*.tmp`, `*.~*`
- `*-backup.*`, `*-copy.*`, `* copy.*`, `*-DELETEME*`, `*-TODO*`
- Root-level `scratch.*`, `tmp.*`, `test.*` (if no test framework conventions match)
- Files with `(1)`, `(2)`, ` 2.`, ` 3.` numeric suffixes typical of editor "save as" duplicates

**Action:** `rm "<path>"` (filesystem delete). For tracked variants: `git rm "<path>"`.
**Risk:** LOW. But verify a non-suffixed canonical version exists before recommending removal of a `*-copy` file.

### D3. Empty or near-empty files (MEDIUM risk — review)

- Zero-byte files, excluding intentional markers: `.gitkeep`, `.keep`, `__init__.py`, `mod.rs`, `index.ts` placeholder patterns
- Files with only whitespace, only a shebang, only a single comment line
- Markdown files with only a heading and no body content

**Action:** Flag for review. Do not auto-recommend deletion.
**Risk:** MEDIUM.

### D4. Possibly orphaned source files (HIGH risk — review only)

For each source file in the detected primary language(s), search for references with `rg`:

- Bare filename (without extension) as a whole-word match
- Module path (e.g., `from foo.bar.baz import` for Python, `from '@/lib/baz'` for TS)
- Each exported symbol (function, class, type) — extract via language-aware patterns

**Automatic disqualifiers — if any apply, do NOT flag the file as orphaned:**

- Entrypoint: `main.py`, `__main__.py`, `index.{js,ts,jsx,tsx}`, `cli.{py,ts}`, `app.{py,ts}`, `server.{js,ts}`, `main.rs`, `main.go`
- Test discovery match: `test_*.py`, `*_test.py`, `*.test.{js,ts}`, `*.spec.{js,ts}`, `*_test.go`, `tests/**`, `__tests__/**`
- Lives in `bin/`, `scripts/`, `examples/`, `docs/`, `migrations/`, `seeds/`, `fixtures/`
- Referenced in a manifest:
  - `package.json` `scripts`, `bin`, `main`, `module`, `exports`
  - `pyproject.toml` `[project.scripts]`, `[project.entry-points]`
  - `Cargo.toml` `[[bin]]`, `[lib]`
  - `go.mod` (treat all `.go` files in module as live unless cmd dir is unreferenced)
- Bare filename appears in any string literal anywhere in the codebase (signal for dynamic loading)
- File is referenced in CI config (`.github/workflows/`, `.gitlab-ci.yml`, etc.)

**Action:** Flag with full evidence trail (commands run, results found). Mark "human review required."
**Risk:** HIGH — never auto-delete. Heuristic reference analysis is unreliable for production code.

### D5. Git-staleness signal (INFORMATIONAL only)

For tracked files: last-touched timestamp via `git log -1 --format=%ct -- <file>`. Surface files untouched for 18+ months.

This is informational. Many correctly-stable files (LICENSE, schemas, vendored configs) will appear here. **Do not** make deletion recommendations based on staleness alone.

**Action:** List in informational section, sorted by last-touched ascending.
**Risk:** N/A — review only.

### D6. Gitignore gap analysis (LOW risk)

- Untracked-and-not-ignored files matching D1 cruft patterns: those should be added to `.gitignore` even though they're not yet committed (defense for future contributors)
- Compare existing `.gitignore` against the standard pattern set for the detected primary language. List standard entries that are missing.

**Action:** Propose additions. Group by language and category.
**Risk:** LOW.

### D7. Secrets-adjacent files (CRITICAL)

Match (case-insensitive) against tracked files:

- Extensions: `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.pkcs12`, `*.jks`, `*.keystore`
- Filenames containing: `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`, `credentials`, `secret`, `password`, `private_key`, `api_key`, `apikey`, `token`
- `.env` files with non-trivial content (not `.env.example` / `.env.sample` / `.env.template`)
- `*.kubeconfig`, `kubeconfig`
- AWS-style `credentials` files in any path

For each hit, **read enough of the file to confirm it's not a template or test fixture** before flagging as critical. A `test/fixtures/fake.pem` for unit tests is not a credential leak.

**Action — confirmed leaks only:**
1. `git rm --cached "<path>"` (preserves local copy)
2. Add pattern to `.gitignore`
3. **Rotate the credential** — assume compromised since it's in git history
4. Separate decision: history rewrite via `git filter-repo` or BFG (call out as out-of-scope for the executor agent)

**Risk:** CRITICAL.

---

## Phase 3 — Plan output

Create directory `.claude/plans/` if missing. Write plan to `.claude/plans/cleanup-<YYYYMMDD-HHMMSS>.md`.

Use this exact structure (the executor agent parses by section heading):

```
# Repo Cleanup Plan

**Generated:** <ISO 8601 timestamp>
**Repo root:** <absolute path>
**Branch:** <current branch>
**HEAD:** <short SHA>
**Working tree:** clean | dirty (N modified, M untracked)
**Detected languages:** <list>

## Summary

| Section | Count | Risk |
|---|---|---|
| 1. Critical — Secrets | N | CRITICAL |
| 2. Tracked cruft → gitignore | N | LOW |
| 3. Backup/scratch deletion | N | LOW |
| 4. Empty/near-empty files | N | MEDIUM (review) |
| 5. Possibly orphaned sources | N | HIGH (review) |
| 6. Stale by git activity | N | INFO |
| 7. Gitignore amendments | N | LOW |

## Pre-flight (executor must verify before acting)

- [ ] Working tree is clean
- [ ] Current branch is not the default branch, OR a dedicated cleanup branch has been created
- [ ] Re-scan: every path in this plan still exists with the same hash recorded below
- [ ] User has been shown sections 1, 4, 5 and approved before any execution

## Execution contract

1. Execute sections in this order: **2, 3, 7**, then HALT.
2. Sections 1, 4, 5 require explicit human approval per finding before any action.
3. One commit per section. Commit message: `chore: cleanup <section name>`.
4. If a file no longer matches its recorded hash, skip and log.
5. Never combine sections in one commit. Never squash.
6. After section 1 actions: print rotation reminder prominently. Do not silently proceed.

---

## Section 1 — CRITICAL: Secrets in tree

<one block per finding>

### `<path>`
- **Detected by:** D7 (<specific pattern>)
- **Recorded hash:** <git hash-object output>
- **Evidence:** <first 80 chars of content if non-binary, redacted appropriately, OR file type confirmation>
- **Action:**
  ```
  git rm --cached "<path>"
  ```
- **Gitignore addition:** `<pattern>`
- **Required follow-up:** Rotate this credential. It exists in git history regardless of removal.
- **Out of scope for executor:** History rewrite (git filter-repo / BFG) — surface to user as a separate decision.

---

## Section 2 — Tracked cruft → gitignore

### `<path>`
- **Detected by:** D1 (<specific pattern>)
- **Recorded hash:** <hash>
- **Evidence:** Matches well-known cruft pattern `<pattern>`. Tracked since <first commit date>.
- **Action:**
  ```
  git rm --cached "<path>"
  ```
- **Gitignore addition:** `<pattern>`

---

## Section 3 — Backup/scratch deletion

<as above with `rm` or `git rm` action depending on tracked status>

---

## Section 4 — Empty / near-empty files (review required)

### `<path>`
- **Detected by:** D3
- **Evidence:** <size in bytes, content snippet>
- **Recommendation:** Review and confirm intent. Do not auto-delete.

---

## Section 5 — Possibly orphaned source files (review required)

### `<path>`
- **Detected by:** D4
- **Last modified:** <date>
- **Reference search performed:**
  - `rg -w "<filename>" --type <lang>` → <N results in M files: list paths>
  - `rg "<module path>"` → <N results>
  - Symbol search for `<sym1>`, `<sym2>`, ...: <results>
- **Disqualifiers checked:** entrypoint=NO, test=NO, manifest=NO, dynamic-load=NO, ci=NO
- **Recommendation:** Human review. Heuristic only — confirm before deletion.

---

## Section 6 — Stale by git activity (informational)

| Path | Last touched | Last touched by |
|---|---|---|
| ... | ... | ... |

No action recommended. Inclusion criterion: 18+ months untouched.

---

## Section 7 — Gitignore amendments

### Top-level `.gitignore` additions

```
<patterns grouped by language/purpose with comments>
```

### Reasoning per pattern

- `<pattern>` — <why>
```

---

## Phase 4 — Chat report

Output a tight summary in chat after writing the plan:

- Plan path: `.claude/plans/cleanup-<timestamp>.md`
- Counts per section (table)
- **Any CRITICAL findings called out explicitly with file paths**
- Suggested next step (the executor command, when one exists)

Do not enumerate findings in chat. The plan file is the source of truth.

---

## Hard rules — what you must NOT do this run

- No deletion, modification, staging, committing of any file
- No `git rm`, `git add`, `git commit`, `git checkout`, no `.gitignore` edit
- No deletion recommendations for source files based on reference analysis alone
- No skipping the secrets pass
- No mixing risk tiers within a single section
- No truncating the plan to fit a length budget — completeness matters more than brevity