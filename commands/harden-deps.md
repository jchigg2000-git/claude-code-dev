---
description: Deployment hardening step 3 — run ecosystem-native vulnerability audit (full tree AND production-only, so shipped CVEs are separated from dev-only ones), flag unpinned versions, abandoned packages, dev-deps leaking into runtime. Read-only; --fix runs `npm audit fix` (non-breaking only) and offers to pin floating versions one-by-one. Fire on `/harden-deps`.
argument-hint: "[--fix] [--no-install] [scope path]"
allowed-tools: Bash(npm:*), Bash(pnpm:*), Bash(yarn:*), Bash(pip:*), Bash(pip-audit:*), Bash(uv:*), Bash(go:*), Bash(govulncheck:*), Bash(cargo:*), Bash(bundle:*), Bash(jq:*), Bash(rg:*), Bash(git:*), Bash(date:*), Bash(mkdir:*), Bash(brew:*), Read, Glob, Grep, Write
---

# Harden: Dependencies

Audit dependencies for vulnerabilities, unpinned versions, abandonment, and dev/prod leakage. Read-only unless `--fix` is passed.

Args: $ARGUMENTS

Parse flags:
- `--fix` → enable safe mutations
- `--no-install` → suppress install prompts
- remaining positional → scope path (default: repo root)

---

## Phase 0 — Pre-flight

```bash
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --porcelain | head -10
```

**Manifest detection:** look for `package.json`, `pyproject.toml` / `requirements*.txt` / `Pipfile`, `go.mod`, `Cargo.toml`, `Gemfile`. Record all found.

**Lockfile detection per ecosystem:**
- npm: `package-lock.json` → `npm`, `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`
- pip: `uv.lock` → `uv`, else `pip`
- go: `go.sum` (always use `go` commands)
- rust: `Cargo.lock`

**Tool check:**
- pip: `which pip-audit` (else offer `brew install pip-audit` or `pip install pip-audit`)
- go: `which govulncheck` (else offer `go install golang.org/x/vuln/cmd/govulncheck@latest`)
- rust: `which cargo-audit` (else offer `cargo install cargo-audit`)

If tool is missing and `--no-install` is not set, print install command and note that the ecosystem will be skipped with a "missing tool" placeholder.

---

## Phase 1 — Vulnerability scan

Run per detected ecosystem. Parse JSON output; bucket findings as: CRITICAL CVE (CVSS ≥ 9), HIGH (≥ 7), MEDIUM (≥ 4), LOW (< 4).

**npm** (use detected package manager) — run it **twice**, full tree and production-only:
```bash
npm audit --json 2>/dev/null                 # full tree: dependencies + devDependencies
npm audit --omit=dev --json 2>/dev/null      # production only: what actually ships/runs
# pnpm: pnpm audit --json / pnpm audit --prod --json
# yarn (berry): yarn npm audit --json --environment production
```

`npm audit` **exits non-zero whenever it finds anything** — that is a finding, not a tool failure. Parse stdout regardless of exit code; only treat empty/unparseable stdout as a tool failure, and record that as DEGRADED coverage rather than "0 vulnerabilities."

**Calibrate severity by which run the vulnerability appears in** — a CVE reachable only through a build tool is not the same risk as one in the request path:
- Present in the `--omit=dev` run → **shipped**: use the severity mapping below as-is.
- Present only in the full run (devDependencies only) → **not shipped**: downgrade one level (CRITICAL→HIGH, HIGH→MEDIUM) and label it `dev-only`. Do not downgrade below MEDIUM if the package runs in CI with repo credentials (a compromised build tool reads secrets) — say which case applies.
- If `--omit=dev` can't run (no lockfile, workspace protocol unsupported by the detected manager), say so and treat every finding as shipped. Assuming dev-only without evidence is how a real CVE gets buried.

**pip:**
```bash
pip-audit --format=json 2>/dev/null
# or: uv audit --format=json (if uv lockfile detected)
```

**go:**
```bash
govulncheck -json ./... 2>/dev/null
```

**rust:**
```bash
cargo audit --json 2>/dev/null
```

**bundler:**
```bash
bundle audit check --update 2>/dev/null
```

For each finding record: package name, version, CVE/GHSA id, severity, description, fixed-in version, whether it's a direct or transitive dep.

CRITICAL CVE in a direct dep = **CRITICAL finding**.
CRITICAL CVE in a transitive dep = **HIGH finding** (harder to patch, but still urgent).

---

## Phase 2 — Version pinning

Check `package.json` (and equivalents for other ecosystems) for floating version specifiers in **production** dependencies:

- npm: `^`, `~`, `*`, `latest`, `x` in `dependencies` (not `devDependencies`)
- pip: `>=` without upper bound, `*`, no version specifier in non-lock install
- go: module versions are always pinned via `go.sum` — skip
- rust: `*` in `Cargo.toml` `[dependencies]`

Distinguish: libraries (floating ranges are standard practice) vs applications (pinning is safer). Use heuristic: if `package.json` has no `main`/`module`/`exports` AND has `bin` → CLI tool → pin. If it has `main`/`exports` only → library → floating ranges are normal, downgrade to INFORMATIONAL.

Flag each unpinned production dep with: declared range, current resolved version from lockfile.

---

## Phase 3 — Abandoned packages

For each direct dependency (not transitive), check last-publish timestamp:

```bash
# npm: check registry metadata
npm view <package> time.modified --json 2>/dev/null
```

Flag any dep with last publish > 24 months ago as MEDIUM. Include: package name, last publish date, weekly download count (signal of community maintenance).

Limit to top 20 direct deps by transitive dependency count to avoid rate-limiting.

---

## Phase 4 — Dev/prod leak (npm only)

Compare `dependencies` vs `devDependencies` in `package.json`.

**Build/test tools in `dependencies`** (should be `devDependencies`):
Known build-tool heuristics (flag as MEDIUM):
`webpack`, `vite`, `rollup`, `esbuild`, `parcel`, `turbopack`, `babel`, `swc`, `tsc`, `typescript`, `jest`, `vitest`, `mocha`, `jasmine`, `karma`, `playwright`, `cypress`, `eslint`, `prettier`, `stylelint`, `husky`, `lint-staged`, `semantic-release`, `standard-version`

**Runtime tools in `devDependencies`** (should be `dependencies`):
- `dotenv` if `process.env` is accessed in non-test files
- `express`, `fastify`, `hono`, `koa` or any HTTP framework if `bin` or entrypoint imports them
- Database clients if accessed in non-test code

For each mismatch, flag with: package name, current placement, recommended placement, evidence.

---

## Phase 5 — engines field (npm publish only)

If npm target (not private):
- Flag missing `engines` field as MEDIUM
- Flag `engines.node` missing or too-permissive (`>=0`) as LOW
- Detect Node version from: `.nvmrc`, `.node-version`, `volta.node`, CI matrix `node-version`; recommend setting `engines.node` to that version

---

## Phase 6 — Output

```bash
mkdir -p .claude/plans
TS=$(date +%Y%m%d-%H%M%S)
PLAN=".claude/plans/harden-deps-${TS}.md"
```

Plan file structure:

```
# Harden: Dependencies — Report

**Generated:** <ISO 8601>
**Ecosystems:** <npm | pip | go | cargo | bundler>
**Package manager:** <npm | pnpm | yarn | uv | pip>

## Summary

| Section | Count | Severity |
|---|---|---|
| Vulnerabilities — shipped, direct | N | CRITICAL/HIGH |
| Vulnerabilities — shipped, transitive | N | HIGH/MEDIUM |
| Vulnerabilities — dev-only | N | HIGH/MEDIUM (downgraded one level) |
| Unpinned production deps | N | MEDIUM |
| Abandoned (24+ months) | N | MEDIUM |
| Dev/prod misplacement | N | MEDIUM |
| engines field | N | LOW |

## Stop-the-line findings
<CRITICAL CVEs: package@version — CVE-XXXX-XXXX — description>

## Section 1 — Vulnerabilities
<per finding: package, version, CVE/GHSA, severity, description, fixed-in, direct/transitive, shipped | dev-only>
<audit scope: full-tree + production-only, or "production scope UNVERIFIED — <why>">

## Section 2 — Version pinning
<per dep: name, declared range, resolved version, recommendation>

## Section 3 — Abandoned packages
<per dep: name, last publish, download count>

## Section 4 — Dev/prod leak
<per mismatch: name, current placement, recommended, evidence>

## Section 5 — engines field
<finding or "OK">

## Fix-mode actions
<only if --fix; list each action applied>
```

---

## Phase 7 — --fix mode (only if --fix was passed)

Safe actions — each is non-breaking:

1. `npm audit fix` (never `--force`, never `--legacy-peer-deps`). Report what was upgraded, then **re-run both audits** (full and `--omit=dev`) and report what remains — `npm audit fix` routinely leaves the CVEs that need a major bump, and a fix run that reports only what it closed reads as clean when it isn't.
2. For each unpinned production dep: print `"Pin <name> from <range> to <exact>? [y/N]"` — wait for per-dep confirmation. If confirmed: update `package.json` to exact version string.

**Will NOT:**
- Run `npm audit fix --force` (may introduce breaking changes)
- Upgrade across major versions
- Remove packages
- Change package manager or regenerate lockfiles destructively
- Auto-fix pip, go, cargo, or bundler (ecosystem-specific fix commands vary too much; report what to run)

---

## Chat summary

Output ≤10 lines:
- Plan file path
- CRITICAL CVEs with package names
- Counts by section
- Suggested next: `/harden-licenses` or `/harden-for-deploy`

<!-- CLAUDE-ORIGIN (2026-07-30, agent-authored): the dev-only one-level severity downgrade in Phase 1, and its "don't downgrade below MEDIUM if it runs in CI with repo credentials" carve-out, are model-authored calibration — not an operator-set rule. Re-derive before citing either as binding. -->

