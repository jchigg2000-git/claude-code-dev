---
description: Deployment hardening step 4 — resolve repo license, enumerate every dep's license (direct + transitive), flag conflicts (GPL/AGPL pulled into MIT/Apache, UNKNOWN, custom non-OSI). Distinguishes runtime vs dev deps. Stricter rules for npm publish + public git. Read-only — never auto-removes deps. Fire on `/harden-licenses`.
argument-hint: "[scope path]"
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(pnpm:*), Bash(yarn:*), Bash(pip:*), Bash(pip-licenses:*), Bash(go:*), Bash(go-licenses:*), Bash(cargo:*), Bash(cargo-license:*), Bash(bundle:*), Bash(jq:*), Bash(rg:*), Bash(git:*), Bash(date:*), Bash(mkdir:*), Bash(brew:*), Read, Glob, Grep, Write
---

# Harden: Licenses

Enumerate dependency licenses and flag conflicts with the repo's declared license. Read-only — no `--fix` mode (license conflicts require human resolution).

Args: $ARGUMENTS

Scope path: first positional arg, default repo root.

---

## Phase 0 — Pre-flight

```bash
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git remote -v
```

**Target detection:**
- npm target: `package.json` present AND `"private"` is not `true`
- Railway target: `railway.json` / `railway.toml` / `Procfile` present
- Public git: remote on github.com, gitlab.com, codeberg.org, sr.ht

**Manifest detection:** look for `package.json`, `pyproject.toml`/`requirements*.txt`/`Pipfile`, `go.mod`, `Cargo.toml`, `Gemfile`. Record which are found.

**Tool check** per detected ecosystem:
- npm: `which license-checker` (part of `npm i -g license-checker`)
- pip: `which pip-licenses`
- go: `which go-licenses`
- cargo: `which cargo-license`
- bundler: `which license_finder`

For any missing tool, print install hint and note that its ecosystem will be skipped.

**Allowlist**: read `.harden-licenses-allow` at repo root if present (one SPDX-id per line). These suppress flagging.

---

## Phase 1 — Repo license resolution

Check in order:
1. `LICENSE`, `LICENSE.md`, `LICENSE.txt` — read content; identify SPDX id from first line or `SPDX-License-Identifier:` field
2. `package.json` `license` field
3. `pyproject.toml` `[project] license` or `[project] license-files`
4. `Cargo.toml` `[package] license`
5. `go.mod` has no license field — fall back to file scan

If unresolved: record `UNKNOWN` and flag as MEDIUM "no declared license." Use `UNKNOWN` for all compatibility math (worst-case assumption).

---

## Phase 2 — Dependency license enumeration

Run per detected ecosystem. Collect: dep name, version, license SPDX id, runtime vs dev.

**npm:**
```bash
npx license-checker --json --production 2>/dev/null > /tmp/licenses-prod.json
npx license-checker --json --development 2>/dev/null > /tmp/licenses-dev.json
```
Parse both. Mark production deps as `runtime`, devDependencies as `dev`.

**pip:**
```bash
pip-licenses --format=json --with-system 2>/dev/null
```
Classify runtime vs dev using `pyproject.toml` optional-dependencies or `requirements-dev.txt` heuristic.

**go:**
```bash
go-licenses csv ./... 2>/dev/null
```
All Go deps are runtime (no dev-only concept in go.mod stdlib).

**cargo:**
```bash
cargo license --json 2>/dev/null
```
Use `[dev-dependencies]` vs `[dependencies]` from `Cargo.toml` for classification.

**bundler:**
```bash
bundle exec license_finder report --format json 2>/dev/null
```

---

## Phase 3 — Compatibility matrix

Apply rules based on repo license type:

**Permissive repo** (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, Artistic-2.0):
- CRITICAL: any `AGPL-*` in **runtime** deps (network-copyleft infects hosted web app)
- HIGH: `GPL-2.0`, `GPL-2.0-only`, `GPL-2.0-or-later`, `GPL-3.0`, `GPL-3.0-only`, `GPL-3.0-or-later` in runtime deps
- HIGH: `LGPL-*` in runtime deps for statically-linked ecosystems (Go, Rust, bundled JS); INFORMATIONAL for dynamic linking
- MEDIUM: `UNKNOWN` or missing license field in runtime dep
- MEDIUM: custom license text (non-OSI) in runtime dep
- INFORMATIONAL: any copyleft in dev-only deps

**Copyleft repo** (GPL-3.0, AGPL-3.0):
- Permissive deps are fine
- Flag incompatible copyleft combinations (e.g., GPL-2.0-only vs GPL-3.0)
- AGPL-3.0 repo + GPL-2.0-only dep → CRITICAL incompatibility

**Commercial / proprietary** (no LICENSE file, "All rights reserved"):
- ALL copyleft runtime deps → CRITICAL
- UNKNOWN runtime deps → HIGH

Suppress any flag if the dep's SPDX id is in the `.harden-licenses-allow` allowlist.

---

## Phase 4 — Publish-target tightening

Applies to **npm-publish** or **genuinely public** git. "Public git" means the repo is actually public — verify with `gh repo view --json visibility,isPrivate` (or `glab repo view`), don't infer it from a github.com/gitlab.com remote. A **private** repo (even on a public host) does NOT get this tightening: its audience is collaborators-only, so a missing LICENSE / UNKNOWN dep is not a publication exposure. If visibility can't be verified, fall back to `package.json` `"private"`; if still unknown, apply the tightening but note the assumption.

When the tightening applies:
- UNKNOWN runtime deps → HIGH (was MEDIUM)
- Custom non-OSI text → HIGH (was MEDIUM)
- No `LICENSE` file in repo root → HIGH (add one before publishing)

When it does NOT (private repo): keep these at their Phase-3 baseline (MEDIUM / INFORMATIONAL) and note "private repo — public-git tightening relaxed."

---

## Phase 5 — Dev-only carve-out

For every copyleft dep classified as dev-only: flag as INFORMATIONAL with note "dev-only — does not ship, safe for permissive repos under standard build-tooling interpretation."

Do not suppress — document so the decision is visible.

---

## Phase 6 — Output

```bash
mkdir -p .claude/plans
TS=$(date +%Y%m%d-%H%M%S)
PLAN=".claude/plans/harden-licenses-${TS}.md"
```

Write plan file:

```
# Harden: Licenses — Report

**Generated:** <ISO 8601>
**Targets:** [npm-publish] [railway] [public-git]
**Repo license:** <SPDX id or UNKNOWN>
**Ecosystems scanned:** <npm | pip | go | cargo | bundler>
**Allowlist:** <path if present, else "none">

## Summary

| Section | Count | Severity |
|---|---|---|
| CRITICAL conflicts | N | CRITICAL |
| HIGH conflicts | N | HIGH |
| MEDIUM (unknown/custom) | N | MEDIUM |
| Dev-only copyleft | N | INFO |

## Stop-the-line findings
<every CRITICAL: dep@version — license — conflict reason>

## Full license matrix

| Dep | Version | License | Runtime/Dev | Compatible? | Severity |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... |

## Section 3 — Conflict details
<per CRITICAL/HIGH: dep, license, why it conflicts, resolution options (find alternative, request relicensing, accept obligation, add to allowlist)>

## Section 4 — Publish-target tightening
<findings upgraded due to npm/public-git target>

## Section 5 — Dev-only copyleft (informational)
<list with "safe for permissive repo" note>

## Resolution options (user)
License conflicts require human resolution — no auto-fix available:
1. Find an alternative dep with a compatible license
2. Request relicensing (only if dep author is accessible)
3. Accept the copyleft obligation (consult counsel for GPL/AGPL implications)
4. Add the SPDX-id to .harden-licenses-allow to suppress flagging (documents acceptance)
```

---

## Chat summary

Output ≤10 lines:
- Plan file path
- Count of CRITICALs (with dep names)
- Count by severity tier
- Suggested next: `/harden-config` or `/harden-for-deploy`

No `--fix` mode exists for this command.
