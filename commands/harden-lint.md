---
description: Deployment hardening step 6 — static analysis gate. Verify a linter / type-checker / formatter is configured, run them, and flag errors, security-rule hits, suppression drift, and unenforced gates. Read-only; --fix applies ONLY the linter's own safe autofixes, with confirmation. Never silences a rule to make lint pass. Fire on `/harden-lint`.
argument-hint: "[--fix] [--max-warnings N] [scope path]"
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(pnpm:*), Bash(yarn:*), Bash(bun:*), Bash(eslint:*), Bash(biome:*), Bash(oxlint:*), Bash(tsc:*), Bash(prettier:*), Bash(ruff:*), Bash(flake8:*), Bash(pylint:*), Bash(mypy:*), Bash(bandit:*), Bash(black:*), Bash(go:*), Bash(staticcheck:*), Bash(gosec:*), Bash(gofmt:*), Bash(cargo:*), Bash(bundle:*), Bash(rubocop:*), Bash(brakeman:*), Bash(jq:*), Bash(rg:*), Bash(git:*), Bash(date:*), Bash(mkdir:*), Bash(find:*), Bash(which:*), Read, Glob, Grep, Write
---

# Harden: Lint

Static analysis gate before the dynamic one. Answers three questions: **is a linter configured, does the code pass it, and is the gate actually enforced anywhere?** Read-only unless `--fix` is passed.

Runs before `/harden-tests` deliberately — static analysis is cheap and fails fast; a repo that can't pass its own declared lint gate shouldn't be spending minutes in a test suite.

Args: $ARGUMENTS

Parse flags:
- `--fix` → enable the linter's own safe autofixes (per-tool confirmation in chat)
- `--max-warnings N` → warning count above which warnings roll up to a MEDIUM finding (default: 25)
- remaining positional → scope path (default: repo root)

---

## Phase 0 — Pre-flight

```bash
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --porcelain | head -10
```

**Config detection** — a tool only counts as "configured" if its config file or manifest section exists. Record every hit.

JS/TS:
```bash
find . -maxdepth 2 \( -name 'eslint.config.*' -o -name '.eslintrc*' -o -name 'biome.json*' -o -name '.oxlintrc*' \
  -o -name '.prettierrc*' -o -name 'prettier.config.*' -o -name 'tsconfig.json' \) \
  -not -path '*/node_modules/*' 2>/dev/null
jq -r '.scripts // {} | keys[]' package.json 2>/dev/null | rg -i 'lint|format|typecheck|check'
jq -r '(.devDependencies // {}) + (.dependencies // {}) | keys[]' package.json 2>/dev/null \
  | rg -i '^(eslint|@biomejs/biome|oxlint|prettier|typescript)$'
```

Python: `ruff.toml` / `.ruff.toml` / `[tool.ruff]` in `pyproject.toml`, `.flake8`, `setup.cfg [flake8]`, `.pylintrc`, `[tool.mypy]`, `[tool.black]`
Go: `.golangci.yml` / `.golangci.yaml`; `go vet` and `gofmt` are always available with the toolchain
Rust: `clippy.toml`, `[lints]` in `Cargo.toml`, `rustfmt.toml`
Ruby: `.rubocop.yml`, `brakeman.yml`

**Toolchain check** — a configured tool that can't execute is DEGRADED coverage, never a pass:
```bash
ls node_modules/.bin/ 2>/dev/null | rg -x 'eslint|biome|oxlint|tsc|prettier' || echo "node_modules absent"
which ruff flake8 pylint mypy staticcheck gosec rubocop brakeman 2>/dev/null
```

If a tool is configured but not installed, record it as **`UNVERIFIED — <tool> configured but not executable`** and say so in the report header. Do not install dependencies to make it run; note the one-line command the user would run (`npm ci`, `uv sync`, …).

**If no linter, type-checker, or formatter is configured in any detected ecosystem:**
Emit a single **MEDIUM** finding ("no static analysis gate configured") — **HIGH** when the npm-publish or public-git target is set, since the code is consumed by others. Name the ecosystem-idiomatic default in the plan file (eslint or biome / ruff / golangci-lint / clippy / rubocop) as a recommendation only. Then skip to Phase 5. **Never scaffold a lint config** — tool and rule selection is a project decision, same reason `/harden-config` won't author a LICENSE.

---

## Phase 1 — Lint run

Run each configured linter over the scope path. Prefer the repo's own script (`npm run lint`) when one exists — it encodes the project's intended flags — and fall back to invoking the tool directly. Use machine-readable output where available; parse it rather than scraping human output.

JS/TS:
```bash
npx --no-install eslint . --format json 2>/dev/null
# or: npx --no-install biome check --reporter=json .
# or: npx --no-install oxlint --format=json
```

Python:
```bash
ruff check --output-format=json . 2>/dev/null
# or: flake8 --format=json . / pylint -f json <pkg>
```

Go:
```bash
go vet ./... 2>&1
golangci-lint run --out-format json ./... 2>/dev/null   # if configured
staticcheck ./... 2>&1                                   # if installed
```

Rust:
```bash
cargo clippy --all-targets --message-format=json -- -D warnings 2>/dev/null
```

Ruby:
```bash
bundle exec rubocop --format json 2>/dev/null
```

**Bucket every diagnostic by severity AND by where it lives.** Split files into:
- **shipped** — application/library source that ends up in the deployed artifact or published tarball
- **not shipped** — tests, fixtures, examples, scripts, build config, generated code

Use the same evidence the rest of the series uses: `files` in `package.json`, `.npmignore`, build output dirs, `_test.go` / `*.test.*` / `spec/` / `tests/` path conventions.

Severity mapping:

| Diagnostic | Severity |
|---|---|
| Lint **error** in shipped code | **HIGH** |
| Lint **error** in not-shipped code | MEDIUM |
| Lint warnings in shipped code, total > `--max-warnings` (default 25) | MEDIUM (aggregate — report the count, do not enumerate) |
| Lint warnings at or under threshold | INFORMATIONAL |
| Parse/syntax error reported by the linter | **HIGH** (the file may not build) |

Cap enumerated diagnostics at the 20 highest-severity, then state "+N more — see full lint output". Never paste raw linter output into the plan file.

---

## Phase 2 — Type check

Type errors are a build-time failure risk for any target that builds from source (Railway, npm prepublish), so check them even when the linter is clean.

```bash
npx --no-install tsc --noEmit 2>&1 | tail -40          # if tsconfig.json exists
mypy . 2>&1 | tail -40                                  # if [tool.mypy] configured
```

- Type errors present → **HIGH** — record the count and the top 5 files by error count.
- `tsconfig.json` with `"strict": false` (or `strict` absent) → INFORMATIONAL. Note it; do not flag it as a defect. Loosening strictness is a project decision.
- If TS is present but the build tool only transpiles (vite / esbuild / swc with no `tsc` in the build script), say so explicitly: type errors will **not** fail the deploy build, they'll fail at runtime. That distinction changes what the finding means.

---

## Phase 3 — Security-rule findings

Any diagnostic from a security-category rule escalates above its normal lint severity — these overlap the concerns `/harden-secrets` and `/harden-auth` cover dynamically, and a static hit is corroborating evidence, not noise.

Rules that escalate:
- **JS/TS:** `no-eval`, `no-implied-eval`, `no-new-func`, `react/no-danger`, `@typescript-eslint/no-implied-eval`, anything under `security/*` (`detect-eval-with-expression`, `detect-child-process`, `detect-non-literal-fs-filename`, `detect-unsafe-regex`, `detect-object-injection`)
- **Python:** ruff `S` rules (flake8-bandit) or `bandit` directly — `B1xx` (exec/eval), `B3xx` (injection), `B5xx` (crypto/requests-without-verify), `B6xx` (shell)
- **Go:** `go vet` `unsafeptr`/`printf`, plus `gosec` `G1xx`–`G5xx` when installed
- **Ruby:** `brakeman` when present

Escalation:
- Injection sink reachable from shipped code (eval / `child_process` / shell with interpolated input) → **CRITICAL**
- Any other security-rule hit in shipped code → **HIGH**
- Security-rule hit in tests or scripts → MEDIUM

A CRITICAL here does **not** halt `/harden-for-deploy` (only secrets, auth, and licenses halt) — it bubbles to the consolidated report's stop-the-line list and forces the deploy decision to RED.

If a security rule *plugin* is available for the ecosystem but not enabled in the config, record it as **LOW** with the one-line enablement snippet. Recommendation only — do not enable it.

---

## Phase 4 — Suppression drift and gate enforcement

**Suppressions** — a clean lint run means nothing if the rules were switched off at the call site:
```bash
rg --no-heading -c 'eslint-disable|@ts-ignore|@ts-expect-error|biome-ignore' --glob '!node_modules/**' --glob '!*.lock'
rg --no-heading -c '# noqa|# type: ignore|# nosec|# pylint: disable' --glob '!.venv/**'
rg --no-heading -c '//nolint|#\[allow\(' --glob '!target/**'
rg --no-heading -c 'rubocop:disable'
```
- Suppression with no adjacent reason comment → **LOW** (report the count and the top 3 files).
- Suppression on a **security** rule from Phase 3, anywhere in shipped code → **HIGH**, listed individually with file:line. Silencing a security rule is a decision that should be visible in the report.
- Blanket file-level disable (`/* eslint-disable */` with no rule list, `# flake8: noqa`) in shipped code → MEDIUM.

**Enforcement** — is the gate wired to anything, or does it only run when someone remembers?
```bash
rg --no-heading -l 'lint|typecheck|tsc|ruff|clippy|vet' .github/workflows/ .gitlab-ci.yml 2>/dev/null
find . -maxdepth 2 \( -name '.pre-commit-config.yaml' -o -name '.husky' -o -name 'lefthook.yml' \) -not -path '*/node_modules/*'
jq -r '.scripts // {} | keys[]' package.json 2>/dev/null | rg -x 'lint|typecheck|check'
```
- Linter configured but referenced by no CI job, no pre-commit hook, and no manifest script → **LOW** ("advisory-only gate"). Escalate to MEDIUM if Phase 1 also found shipped-code errors — that combination is what an unenforced gate looks like once it's been unenforced for a while.

---

## Phase 5 — Output

```bash
mkdir -p .claude/plans
TS=$(date +%Y%m%d-%H%M%S)
PLAN=".claude/plans/harden-lint-${TS}.md"
```

Plan file structure:

```
# Harden: Lint — Report

**Generated:** <ISO 8601>
**Ecosystems:** <js/ts | python | go | rust | ruby>
**Tools run:** <eslint 9.x, tsc 5.x, ruff 0.x — with versions>
**Scan confidence:** full | DEGRADED — <configured-but-unexecutable tools, ecosystems skipped>
**Mode:** read-only | --fix
**Warning threshold:** <N>

## Summary

| Section | Count | Severity |
|---|---|---|
| Lint errors (shipped code) | N | HIGH |
| Lint errors (tests/scripts) | N | MEDIUM |
| Lint warnings | N | MEDIUM/INFO |
| Type errors | N | HIGH |
| Security-rule findings | N | CRITICAL/HIGH |
| Suppressions without reason | N | LOW |
| Suppressed security rules | N | HIGH |
| Gate enforcement | wired | CI + pre-commit | advisory-only | LOW |

## Stop-the-line findings
<CRITICALs only: rule — file:line — why it's a sink. If none: "None.">

## Section 1 — Lint
<top 20 by severity: rule id, file:line, message, shipped/not-shipped. Then "+N more".>

## Section 2 — Type check
<error count, top 5 files, whether the deploy build actually runs tsc>

## Section 3 — Security rules
<per finding: rule, file:line, severity, escalation reason>

## Section 4 — Suppressions and enforcement
<counts, top files, individually-listed suppressed security rules, gate wiring status>

## Fix-mode actions
<only if --fix; per tool: command run, files changed, diffstat>
```

---

## Phase 6 — --fix mode (only if `--fix` was passed)

This step modifies **application source**, which no other read-only step in this series does. It is gated harder as a result.

**Pre-conditions — all must hold, else report and skip the fix:**
1. Working tree is clean (`git status --porcelain` empty). A dirty tree means autofix churn is indistinguishable from the user's in-flight work. If dirty: say so and stop — do not offer to stash.
2. Per-tool confirmation in chat: `"Run <tool> autofix? Touches N files. [y/N]"` — wait for input.

**Safe actions:**
1. `eslint --fix` / `biome check --write` / `ruff check --fix` / `gofmt -w` / `cargo fmt` / `rubocop -a` — the tools' own conservative autofix tiers only.
2. After each tool: `git diff --stat` and record the diffstat in the plan file.

**Will NOT:**
- Pass `--unsafe-fixes`, `ruff --fix --unsafe-fixes`, `rubocop -A`, `cargo clippy --fix --allow-dirty`, or any tier the tool itself labels unsafe
- **Add, edit, or relax a lint config, or insert a suppression comment, to make a finding go away.** Silencing a rule is not a fix — it converts a visible HIGH into an invisible one, and it is the single most tempting wrong move in this step. Every finding either gets a real code fix or stays in the report.
- Scaffold a linter, formatter, or type-checker where none is configured
- Auto-fix type errors (`tsc` has no autofix; do not hand-edit types under `--fix`)
- Commit, stage, push, or run any test suite

**After fixing, re-run Phase 1 and Phase 2** and report the before/after counts. A `--fix` run that leaves errors behind must say so plainly — a partial fix reported as a pass is a false report.

---

## Chat summary

Output ≤10 lines:
- Plan file path
- Errors / type errors / security-rule findings, with counts
- Scan confidence if DEGRADED, and which tool couldn't run
- Files changed (only if `--fix`), and remaining errors after the fix
- Suggested next: `/harden-tests` or `/harden-for-deploy`

---

<!-- CLAUDE-ORIGIN (2026-07-30, agent-authored): the entire severity model in this file — the shipped-vs-not-shipped split, the HIGH/MEDIUM/LOW thresholds, the default 25-warning ceiling, the security-rule escalation to CRITICAL, and the clean-tree pre-condition on --fix — was authored by the model, not decided by the owner, who asked for "linting in the harden routine"; everything above about *how strict* is inference. Re-derive before citing any of it back as binding. -->

