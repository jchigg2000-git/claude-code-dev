---
description: Deployment hardening step 5 — validate runtime/deploy config per target. Railway: railway.json/toml, healthcheck, restart policy. npm: package.json publish metadata. Public git: README + LICENSE present, no internal hostnames. Read-only; --fix applies obvious additions (license field, engines, healthcheck path) with confirmation. Fire on `/harden-config`.
argument-hint: "[--fix] [scope path]"
allowed-tools: Bash(jq:*), Bash(npm:*), Bash(git:*), Bash(rg:*), Bash(find:*), Bash(date:*), Bash(mkdir:*), Read, Glob, Grep, Write, mcp__railway__get_service_config, mcp__railway__list_projects, mcp__railway__list_services, mcp__railway__whoami
---

# Harden: Config

Validate deployment and runtime configuration per detected target type. Read-only unless `--fix` is passed.

Args: $ARGUMENTS

Parse flags:
- `--fix` → enable safe mutations (each with per-file confirmation in chat)
- remaining positional → scope path (default: repo root)

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
- Railway target: `railway.json` / `railway.toml` / `Procfile` present, OR `mcp__railway__whoami` succeeds
- Public git: remote URL on github.com/gitlab.com/codeberg.org/sr.ht **AND the repo is actually public** — verify, don't assume from the host: `gh repo view --json visibility,isPrivate` (or `glab repo view`). A **private** repo on a public host is private-git: the public-git rules below (README/LICENSE-required = HIGH, internal-hostname scan, etc.) relax by one level (a private repo's audience is collaborators-only). If visibility is unknown, fall back to `package.json` `"private"`, else assume public and say so.

Record which targets apply. At least one must match or report "no recognized deploy target — nothing to check" and exit cleanly.

---

## Phase 1 — Railway config (Railway target only)

**Parse config file:**
```bash
# Try both formats
cat railway.json 2>/dev/null | jq '.'
cat railway.toml 2>/dev/null
```

**Check for:**

1. `deploy.healthcheckPath` — if missing and the service is HTTP (has `PORT` binding or web start command): flag **HIGH**. Railway will deploy without a health check but can't detect startup failures. (This is the authoritative severity for the missing-healthcheck concern; `harden-observability` may also surface it at MEDIUM — on reconciliation in the consolidated report, keep this HIGH.)

2. `deploy.restartPolicy` — if absent: flag **INFORMATIONAL** (Railway defaults to `ON_FAILURE` which is fine; absence means accepting default).

3. `build.builder` set to `NIXPACKS` without `nixpacksConfig`: flag **INFORMATIONAL** when build uses non-standard language versions or unusual dependencies.

4. Port binding: search for `PORT` in start command or Dockerfile. If service exposes a port but `PORT` env var isn't used as the bind address: flag **HIGH** (Railway injects `PORT`; hardcoded port ignores it).
   ```bash
   rg 'listen\(|\.listen\(' --type js --type ts --type py --type go --type rb -n | grep -v 'process.env.PORT\|os.environ\|os.getenv\|:PORT\|$PORT'
   ```

5. **Live config drift** (if `mcp__railway__get_service_config` is available):
   - Call `mcp__railway__whoami` → `mcp__railway__list_projects` → `mcp__railway__list_services`
   - For each service: `mcp__railway__get_service_config`
   - Compare deployed config against `railway.json`/`railway.toml`; flag any drift as **MEDIUM**
   - While linked, also confirm any **deploy-gating env vars** another step flagged as conditional (e.g. a prod-disabling flag) are actually set — by **presence/name only, never value** (`list_variables` returns plaintext; mask it). This is the cheapest way to resolve a CONDITIONAL-CRITICAL. If not linked, say so and emit a "verify in dashboard" gate rather than skipping silently.

---

## Phase 2 — npm config (npm-publish target only)

Read `package.json`. Check:

**Required fields** (missing = HIGH):
- `name` — must be present and non-empty
- `version` — must be present and valid semver
- `description` — non-empty
- `main` OR `exports` (at least one must exist)
- `repository` — URL pointing to source
- `license` — SPDX id matching detected LICENSE file
- `author` — non-empty

**Strongly recommended** (missing = MEDIUM):
- `files` field — explicit publish whitelist preferred over `.npmignore`; if absent, flag "no files whitelist — will publish everything not .npmignored"
- `engines.node` — declared runtime version
- `keywords` — non-empty (INFORMATIONAL)

**Safety checks:**
- `private: true` accidentally present → **CRITICAL** (publish will be blocked at `npm publish` time; fine if intent is private, but should be explicit)
- `private` absent when clearly meant to be public → INFORMATIONAL
- Scoped package (`@scope/name`) without `publishConfig.access: "public"` → **HIGH** (npm defaults scoped packages to restricted; publish will fail or publish private)

**Version consistency:**
- If `git tag -l 'v*' | head -5` shows tags, verify latest tag matches `version` field — divergence = MEDIUM

---

## Phase 3 — Public git (public-git target only)

**README check:**
```bash
find . -maxdepth 1 -name 'README*' | head -5
```
- Absent → **MEDIUM**
- Present but < 200 chars → **MEDIUM** (stub README)
- Present, ≥ 200 chars, but no install instruction (heuristic: no `install`, `npm i`, `pip install`, `go get`, `cargo add`) → **LOW**

**LICENSE check:**
```bash
find . -maxdepth 1 -name 'LICENSE*' | head -5
```
- Absent → **HIGH** (implicitly all-rights-reserved — contributors and users can't safely use the code)

**Internal hostname scan:**
```bash
rg --no-heading -n '([a-z0-9-]+\.internal\.[a-z]+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+)' \
  --glob '!*.lock' --glob '!node_modules/**'
```
Flag any internal IP or `.internal.` hostname as **HIGH** (leaks network topology).

**CI secrets-in-logs check** (`.github/workflows/` or `.gitlab-ci.yml`):
```bash
rg --no-heading -n 'echo.*\$\{?[A-Z_]*(SECRET|TOKEN|KEY|PASSWORD|API_KEY)[A-Z_]*\}?' \
  .github/workflows/ .gitlab-ci.yml 2>/dev/null
```
Flag any match as **HIGH** (credential logged in CI output).

**Coworker email scan** — heuristic only; flag as MEDIUM with "review required":
```bash
rg --no-heading -n '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' \
  --glob '!*.lock' --glob '!node_modules/**' --glob '!CHANGELOG*' \
  | grep -v '@example\.com\|@users\.noreply\.github\.com\|noreply@\|no-reply@'
```

---

## Phase 4 — Output

```bash
mkdir -p .claude/plans
TS=$(date +%Y%m%d-%H%M%S)
PLAN=".claude/plans/harden-config-${TS}.md"
```

Plan file structure:

```
# Harden: Config — Report

**Generated:** <ISO 8601>
**Targets:** [railway] [npm-publish] [public-git]
**Branch:** <branch>

## Summary

| Section | Count | Severity |
|---|---|---|
| Railway config | N | HIGH/MEDIUM/INFO |
| npm publish metadata | N | CRITICAL/HIGH/MEDIUM |
| Public git hygiene | N | HIGH/MEDIUM/LOW |

## Stop-the-line findings
<CRITICALs only: item — reason>

## Section 1 — Railway config
<per finding: field, current value or "missing", severity, recommendation>

## Section 2 — npm publish metadata
<per finding: field, current value or "missing", severity, recommendation>

## Section 3 — Public git
<per finding: type, evidence, severity>

## Fix-mode actions
<only if --fix; list actions applied with confirmation status>
```

---

## Phase 5 — --fix mode (only if --fix was passed)

Each action requires explicit confirmation in chat before applying. Print "Apply fix: <description>? [y/N]" and wait.

**Safe fixes:**
1. Add `license` field to `package.json` using SPDX id from detected LICENSE file
2. Add `engines.node` to `package.json` using version from `.nvmrc`, `.node-version`, or `volta.node`
3. Scaffold `deploy.healthcheckPath: "/health"` in `railway.toml` — ONLY if: no healthcheck path currently declared AND a `/health` route exists in application code

**Will NOT:**
- Change `name`, `version`, `private`, `publishConfig.access` (identity/visibility fields)
- Create a LICENSE file (content is a legal decision)
- Create a README (content is a documentation decision)
- Modify any Railway env vars or deployed service configuration

---

## Chat summary

Output ≤10 lines:
- Plan file path
- CRITICAL findings (each described in one line)
- Counts by section and severity
- Suggested next: `/harden-lint` or `/harden-for-deploy`
