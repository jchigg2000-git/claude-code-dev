---
description: Run the full deployment-hardening series (secrets → auth → deps → licenses → config → lint → tests → observability) in order. Stops on CRITICAL from secrets/auth/licenses; otherwise runs through and produces a single consolidated HARDENING_REPORT.md. Never auto-pushes, auto-publishes, or auto-deploys. Fire on `/harden-for-deploy` or "is this safe to deploy?"
argument-hint: "[--fix] [--verify] [--skip <step,...>] [--only <step,...>] [scope path]"
allowed-tools: Bash(git:*), Bash(date:*), Bash(mkdir:*), Bash(rg:*), Bash(find:*), Bash(cat:*), Read, Glob, Grep, Write
---

# Harden: Deploy

Orchestrate the full deployment-hardening series and produce a consolidated report. Never ships anything.

Args: $ARGUMENTS

Parse flags:
- `--fix` → propagate to every step that supports it
- `--verify` → re-run only the cheap read-only probes, diff against the newest `HARDENING_REPORT-*.md`, mark each prior finding closed/still-open. No full scan, no fix. See Phase 4.
- `--skip <step,...>` → skip named steps (e.g., `--skip tests,observability`)
- `--only <step,...>` → run ONLY named steps (e.g., `--only secrets,auth`)
- remaining positional → scope path passed to every step

Valid step names: `secrets`, `auth`, `deps`, `licenses`, `config`, `lint`, `tests`, `observability`

---

## Phase 0 — Pre-flight

```bash
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --porcelain | head -10
git remote -v
```

**Target detection** (uniform across commands):
- npm-publish: `package.json` present AND `"private"` is not `true`
- Railway: `railway.json` / `railway.toml` / `Procfile` present, OR `mcp__railway__whoami` succeeds (linked)
- Public git: remote URL is on github.com, gitlab.com, codeberg.org, sr.ht **AND the repo is actually public** — verify visibility, do NOT assume it from the host:
  ```bash
  gh repo view --json visibility,isPrivate 2>/dev/null   # GitHub
  glab repo view 2>/dev/null | rg -i 'visibility'         # GitLab
  ```
  If the repo is **private**, treat it as private-git (not public-git): the public-git tightening in `harden-licenses`/`harden-config` (stricter UNKNOWN-dep tolerance, missing-LICENSE = HIGH, PII-in-source escalation) relaxes by one level, since the audience is collaborators-only. If visibility can't be determined (no `gh`/`glab`, or unauthenticated), fall back to `package.json` `"private"`; if still unknown, state the assumption ("treating as public — could not verify") and use the stricter rules.

Pass the resolved targets — **including the public-vs-private distinction** — to every step, so severities are calibrated to actual exposure rather than the remote host. (A github.com remote on a private repo is the common false-positive: it should NOT trigger public-git tightening.)

Output a single pre-flight summary in chat:
```
Harden: Deploy
Targets:    [npm-publish] [railway] [public-git | private-git]
Visibility: public | PRIVATE   (gh/glab verified | assumed — could not check)
Scan tools: gitleaks/trufflehog/govulncheck present? lint toolchain executable? (note any missing → degraded coverage)
Steps:      secrets → auth → deps → licenses → config → lint → tests → observability
Fix:        off  (or: on)
Skipped:    <steps if any>
```

---

## Phase 1 — Run steps in order

Execute each step by invoking the corresponding slash command. Steps run sequentially. Per-step plan files land in `.claude/plans/` as normal.

**Default step order:** secrets → auth → deps → licenses → config → lint → tests → observability

`lint` runs before `tests` on purpose: static analysis is cheap and fails fast, so a repo that can't pass its own declared lint gate surfaces that before the test suite spends minutes proving it.

**If `--only` is specified:** run only the named steps in the above order (not the order listed by the user).
**If `--skip` is specified:** run all steps except the named ones.
**If `--fix` is specified:** append `--fix` to every step that supports it (secrets, auth, deps, config, lint, observability). `harden-licenses` has no fix mode (read-only). `harden-tests` uses `--write`, not `--fix`: with `--fix`, ALSO pass `--write` to tests so it generates the highest-leverage gap tests (otherwise `--fix` can never close a test gap). Without `--fix`, tests is audit-only — and the consolidated report MUST then state "Tests: audit-only — N gaps NOT closed," so a `--fix` run is never mistaken for fully fixed.

**`harden-lint --fix` is the only step that rewrites application source**, and it self-gates on a clean working tree. In an orchestrated `--fix` run it will therefore no-op whenever an earlier step has already modified files. That is correct, not a failure — record it in the report as "Lint: fix skipped — tree dirtied by earlier steps" and name the one-line rerun (`/harden-lint --fix` after committing).

**Stop conditions** — after each of these steps, check the per-step plan file for CRITICAL findings:

After `/harden-secrets`:
- If any CRITICAL found: stop. In chat:
  ```
  STOP: /harden-secrets found N CRITICAL finding(s).
  <list each: file or commit — credential type>
  Rotate before deploying. Continue anyway? [y/N]
  ```
  Wait for explicit user input. Default: halt. If user types `y` or `yes`: continue.

After `/harden-auth`:
- If any CRITICAL found (e.g., `algorithm: none`, unauthenticated state-changer, public state-changer with no auth): stop with same pattern as above.

After `/harden-licenses`:
- If any CRITICAL found (AGPL in runtime of permissive repo, copyleft in proprietary repo): stop with same pattern.

Other steps (deps, config, lint, tests, observability): never halt on their findings — collect and bubble to consolidated report. Note that `harden-lint` CAN emit a CRITICAL (a security-rule injection sink in shipped code): it does not halt the run, but it is never "continued past" either, so it lands in the stop-the-line list and forces a RED decision.

**Conditional CRITICAL** — a finding that is HIGH normally but becomes CRITICAL under a specific, *verifiable* deploy condition (e.g. "a dev/test auth endpoint is exposed UNLESS the prod env disables it"; "debug mode on UNLESS an env var is set"). Do not silently bury these as plain HIGH:
1. **If the deciding fact is checkable now, check it.** For a Railway target, query the live env (presence only — see below) before finalizing severity. Verifying usually collapses the ambiguity — a flagged bypass is often inert in prod once you confirm the gating var.
2. **If it can't be verified this run,** record it as `CONDITIONAL-CRITICAL`, list it at the TOP of the report's stop-the-line section with the exact one-line verification step, and cap the deploy decision at YELLOW (never GREEN) until it's verified.

**Live environment is a first-class check for Railway targets, not best-effort.** When a Railway target is detected, the env diff (`harden-secrets` Phase 5) and config drift (`harden-config` Phase 1, item 5) are among the most decisive checks in the whole series — they resolve most conditional-criticals. Inspect variable **presence and names only; never read, echo, or write secret VALUES** into any plan/report (mask to `<set, N chars>`). If the project isn't linked, say so loudly and emit an explicit "verify these in the dashboard" gate rather than degrading silently.

---

## Phase 2 — Consolidated report

After all steps complete (or user chose to continue past a halt), stitch the per-step plan files into a single report.

```bash
mkdir -p .claude/plans
TS=$(date +%Y%m%d-%H%M%S)
REPORT=".claude/plans/HARDENING_REPORT-${TS}.md"

# Find per-step plan files from this run (newest of each step type)
SECRETS=$(ls -t .claude/plans/harden-secrets-*.md 2>/dev/null | head -1)
AUTH=$(ls -t .claude/plans/harden-auth-*.md 2>/dev/null | head -1)
DEPS=$(ls -t .claude/plans/harden-deps-*.md 2>/dev/null | head -1)
LICENSES=$(ls -t .claude/plans/harden-licenses-*.md 2>/dev/null | head -1)
CONFIG=$(ls -t .claude/plans/harden-config-*.md 2>/dev/null | head -1)
LINT=$(ls -t .claude/plans/harden-lint-*.md 2>/dev/null | head -1)
TESTS=$(ls -t .claude/plans/harden-tests-*.md 2>/dev/null | head -1)
OBS=$(ls -t .claude/plans/harden-observability-*.md 2>/dev/null | head -1)
```

**Reconcile before stitching.** The same root issue routinely surfaces in multiple steps at different severities (e.g. missing LICENSE flagged by both licenses and config; missing healthcheck rated HIGH by config but MEDIUM by observability; an auth bypass that also appears as an observability log-leak; a lint `security/detect-child-process` hit on the same line `harden-secrets` or `harden-auth` already flagged — keep the higher severity, and keep the lint hit as corroborating evidence in the cluster note rather than as a second finding). Before writing the report:
1. Cluster findings by (concern / file) key across all steps.
2. Per cluster, keep the single HIGHEST severity and note the other steps that raised it ("also flagged by config").
3. The Top-level Summary counts, the stop-the-line list, and the deploy decision all use the **de-duplicated** set — never sum raw per-step counts (that double-counts shared issues). Add a short "De-duplicated distinct findings" list above the per-step sections.

The per-step verbatim sections (below) stay intact for full detail; only the summary / counts / decision use the reconciled set.

Write consolidated report with this structure:

```markdown
# Hardening Report

**Generated:** <ISO 8601>
**Repo:** <root path>
**Branch:** <branch>
**HEAD:** <sha>
**Targets:** [npm-publish] [railway] [public-git | private-git]
**Repo visibility:** public | private  (gh/glab verified | assumed)
**Scan confidence:** full | DEGRADED — <which tools missing / ecosystems skipped>
**Fix mode:** on | off
**Skipped steps:** <list or "none">

---

## Deploy Decision

> **RED — Do not deploy** (N CRITICAL findings)
> OR
> **YELLOW — Deploy with caution** (N HIGH findings; see details)
> OR
> **GREEN — Ready to deploy** (no CRITICAL or HIGH findings)

<one-line rationale>

---

## Top-level Summary

| Step | Status | CRITICALs | HIGHs | MEDIUMs | Plan file |
|---|---|---|---|---|---|
| 1. Secrets | ✓ ran / HALTED / skipped | N | N | N | path |
| 2. Auth | ✓ ran / HALTED / skipped | N | N | N | path |
| 3. Deps | ✓ ran / skipped | N | N | N | path |
| 4. Licenses | ✓ ran / HALTED / skipped | N | N | N | path |
| 5. Config | ✓ ran / skipped | N | N | N | path |
| 6. Lint | ✓ ran / skipped / DEGRADED | N | N | N | path |
| 7. Tests | ✓ ran / skipped | — | N gaps | N gaps | path |
| 8. Observability | ✓ ran / skipped | N | N | N | path |

---

## All Stop-the-line Findings

<Consolidated list of every CRITICAL across all steps. One line each: step — item — severity. If none: "None.">

---

## 1. Secrets

<verbatim content from harden-secrets plan file, prefixed with step heading>

---

## 2. Auth

<verbatim content from harden-auth plan file>

---

## 3. Dependencies

<verbatim content from harden-deps plan file>

---

## 4. Licenses

<verbatim content from harden-licenses plan file>

---

## 5. Config

<verbatim content from harden-config plan file>

---

## 6. Lint

<verbatim content from harden-lint plan file>

---

## 7. Tests

<verbatim content from harden-tests plan file>

---

## 8. Observability

<verbatim content from harden-observability plan file>
```

**Deploy decision logic** (computed on the DE-DUPLICATED finding set):
- Any unresolved CRITICAL (user did not explicitly continue past it) → RED
- Any CRITICAL the user continued past → YELLOW (at minimum), noting "user acknowledged secrets/auth/license issue"
- Any unverified CONDITIONAL-CRITICAL → cap at YELLOW (never GREEN); name the one-line verification step in the rationale
- No CRITICAL but any HIGH → YELLOW
- No CRITICAL, no HIGH → GREEN
- **Scan-confidence cap:** if the secrets scan ran on `grep-fallback` (gitleaks/trufflehog absent), any deps/licenses ecosystem was skipped for a missing tool, or `harden-lint` reported DEGRADED (a linter/type-checker is configured but wasn't executable — e.g. `node_modules` absent), the decision CANNOT exceed YELLOW — record "degraded coverage: <which>" in the header. A clean low-fidelity scan is not a GREEN.
- Skipped steps → downgrade one level (GREEN→YELLOW, YELLOW→RED) with note "N steps skipped — coverage incomplete"

---

## Phase 3 — Chat output

Final chat summary ≤10 lines:
- Deploy decision: GREEN / YELLOW / RED with one-line rationale
- Count of CRITICALs per step (omit steps with zero)
- Path to consolidated report
- ONE suggested next action (rotate credentials / fix auth / run --fix / deploy)

Never enumerate findings in chat. Consolidated report is the source of truth.

---

## Phase 4 — Verify mode (only if `--verify`)

Closes the loop a normal run opens. Skip the full series. Load the newest `.claude/plans/HARDENING_REPORT-*.md`, then re-run ONLY the fast read-only probe for each of its findings — e.g. re-grep the flagged secret path, re-hit `/health`, re-check the Railway var **presence** (never value), re-run `go test` / `npm audit` / `npm audit --omit=dev`, re-run the linter and `tsc --noEmit` for prior lint findings. Emit a delta, one line per prior finding: **CLOSED** / **STILL OPEN** / **UNVERIFIABLE** (with why). Write `.claude/plans/HARDENING_VERIFY-<ts>.md` and a ≤10-line chat summary. Never fixes, never ships. If no prior report exists, say so and suggest a full run.

---

## Hard rules

- Never invokes `/shipit`, `npm publish`, `railway up`, `git push`, or any other shipping action
- Never propagates `--force` to any step
- Never auto-commits, auto-publishes, or auto-deploys anything
- Never modifies anything beyond what individual `--fix` modes already permit
- Step invocations are in-order; no step runs until the previous one completes and (where applicable) the user confirms continuation past a halt

<!-- CLAUDE-ORIGIN (2026-07-30, agent-authored): the lint step's placement at position 6, its non-halting-but-RED-forcing CRITICAL handling, and the extension of the scan-confidence YELLOW cap to cover a DEGRADED lint run are model-authored. The operator asked only that linting be added "where it belongs"; the placement and the gating semantics are inference. Re-derive before citing them as binding. -->

