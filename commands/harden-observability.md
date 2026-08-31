---
description: Deployment hardening step 8 — verify structured logging on error paths, healthcheck endpoint (web) or meaningful exit codes (CLI), flag silent catch blocks. Read-only; --fix adds logging to empty catches and scaffolds /health endpoint with confirmation. Fire on `/harden-observability`.
argument-hint: "[--fix] [scope path]"
allowed-tools: Bash(rg:*), Bash(jq:*), Bash(git:*), Bash(date:*), Bash(mkdir:*), Read, Glob, Grep, Write, Edit
---

# Harden: Observability

Verify that error paths are logged, healthchecks exist, exit codes are meaningful, and credentials aren't leaking into logs. Read-only unless `--fix` is passed.

Args: $ARGUMENTS

Parse flags:
- `--fix` → enable safe mutations, each requiring confirmation in chat
- remaining positional → scope path (default: repo root)

---

## Phase 0 — Pre-flight

```bash
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --porcelain | head -10
```

**Target type detection:**
- Web app: any of `railway.json`, `railway.toml`, `Procfile`, or HTTP framework detected in source
- CLI: `bin` field in `package.json`, or main entrypoint file sets `process.exit`, or `if __name__ == '__main__'` at top level with no HTTP server
- Both may be true (CLI + web in monorepo)

**Logging library detection:**
```bash
# JS/TS
rg --no-heading -l 'pino|winston|bunyan|log4js|loglevel' --type js --type ts 2>/dev/null | head -5
# Python
rg --no-heading -l 'structlog|logging\.getLogger|loguru' --type py 2>/dev/null | head -5
# Go
rg --no-heading -l '"log/slog"|"go.uber.org/zap"|"github.com/sirupsen/logrus"' --type go 2>/dev/null | head -5
# Ruby
rg --no-heading -l 'Logger\.new|Rails\.logger|SemanticLogger' --type rb 2>/dev/null | head -5
```

Record detected logger. If none found: note "no structured logger detected — using language stdlib logging."

---

## Phase 1 — Error-path logging

Find all error-handling blocks. Classify each.

**JavaScript / TypeScript:**
```bash
# Empty catch blocks
rg --no-heading -n 'catch\s*\([^)]*\)\s*\{\s*\}|catch\s*\([^)]*\)\s*\{\s*//[^\n]*\n\s*\}' --type js --type ts

# Catch with only console.log (not structured)
rg --no-heading -n -A3 'catch\s*\(' --type js --type ts | grep -B1 'console\.log\|console\.warn\|console\.error' | grep 'catch'

# Catch that returns 500 without logging
rg --no-heading -n -A5 'catch\s*\(' --type js --type ts | grep -B3 'status(500)\|statusCode\s*=\s*500\|res\.sendStatus(500)'
```

**Python:**
```bash
# Bare except with pass
rg --no-heading -n 'except[^:]*:\s*\n\s*pass' --type py

# Except with only print
rg --no-heading -n -A2 'except[^:]*:' --type py | grep -B1 '^\s*print(' | grep 'except'

# Except that returns 500/generic error silently
rg --no-heading -n -A5 'except[^:]*:' --type py | grep -B3 'HTTPException\|abort(500\|return.*500'
```

**Go:**
```bash
# err != nil blocks without logging
rg --no-heading -n -A3 'if err != nil' --type go | grep -B1 'return\|panic' | grep -v 'log\.'
```

**Classification:**
- Empty catch (`catch {}`, `except: pass`, `} catch (e) { }`) → **HIGH** (silent failure — production errors are invisible)
- Catch with only unstructured `console.log`/`print` → **MEDIUM** (works but not queryable in log aggregators)
- Catch that returns generic 500 without any logging → **HIGH** (error is lost, user gets a 500 with no server-side trace)
- Catch that logs structured error with context → OK

---

## Phase 2 — Healthcheck (web target only)

Search for health endpoint route definitions:

```bash
# JS/TS
rg --no-heading -n "('/health'|\"/health\"|'/healthz'|\"/healthz\"|'/ready'|\"/ready\"|'/ping'|\"/ping\"|'/_health'|\"/_health\")" \
  --type js --type ts

# Python
rg --no-heading -n '"/health"|"/healthz"|"/ready"|"/ping"|"/_health"' --type py

# Go
rg --no-heading -n '"/health"|"/healthz"|"/ready"|"/ping"' --type go
```

**Cross-check against Railway config:**
```bash
cat railway.json 2>/dev/null | jq '.deploy.healthcheckPath // empty'
cat railway.toml 2>/dev/null | rg 'healthcheckPath'
```

Outcomes:
- No health route AND no Railway healthcheckPath configured → **MEDIUM** (Railway can't detect startup failure)
- No health route AND Railway healthcheckPath IS configured → **CRITICAL** (Railway will probe a non-existent path; deploy will appear to fail or health checks will always fail)
- Health route exists AND matches Railway config → OK
- Health route exists but Railway config missing → **LOW** (add healthcheckPath to Railway config for full coverage)

---

## Phase 3 — CLI exit codes (CLI target only)

```bash
rg --no-heading -n 'process\.exit\(\)' --type js --type ts
rg --no-heading -n 'process\.exit(0)' --type js --type ts
rg --no-heading -n 'sys\.exit()' --type py
```

- `process.exit()` with no argument in error paths → **MEDIUM** (defaults to 0; CI/orchestrators read exit code 0 as success)
- `process.exit(0)` inside a `catch` block → **HIGH** (masks error as success)
- `sys.exit()` with no argument in error paths → **MEDIUM** (same as Node — defaults to 0)

For each hit, inspect surrounding context (±5 lines) to confirm it's on an error path before flagging.

---

## Phase 4 — Sensitive data in logs

Scan log call sites for interpolation of sensitive variable names:

```bash
rg --no-heading -n '(log|logger|console)\.(error|warn|info|debug|log)\s*\([^)]*\b(password|token|secret|key|authorization|cookie|card|ssn|credit_card|api_key|apikey|private_key)\b' \
  --type js --type ts --type py --type go --type rb -i
```

For each match, inspect the surrounding context:
- Variable is directly interpolated (e.g., `logger.info(user.password)`) → **HIGH** (PII/credential leak via logs)
- Variable appears in a label string only (`logger.info('resetting password for user')`) → OK (label, not value)
- Variable is explicitly redacted (`logger.info({ password: '[REDACTED]' })`) → OK

---

## Phase 5 — Output

```bash
mkdir -p .claude/plans
TS=$(date +%Y%m%d-%H%M%S)
PLAN=".claude/plans/harden-observability-${TS}.md"
```

Plan file structure:

```
# Harden: Observability — Report

**Generated:** <ISO 8601>
**Target type:** <web | cli | both>
**Logger:** <detected library or "stdlib/none">
**Scope:** <path>

## Summary

| Section | Count | Severity |
|---|---|---|
| Error-path logging | N | HIGH/MEDIUM |
| Healthcheck | N | CRITICAL/HIGH/MEDIUM/LOW |
| CLI exit codes | N | HIGH/MEDIUM |
| Sensitive data in logs | N | HIGH |

## Stop-the-line findings
<CRITICALs only — one line each>

## Section 1 — Error-path logging
<per finding: file:line, catch type, classification, severity>

## Section 2 — Healthcheck
<finding or "OK">

## Section 3 — CLI exit codes
<per finding: file:line, issue, severity>

## Section 4 — Sensitive data in logs
<per finding: file:line, variable name, severity>

## Fix-mode actions
<only if --fix; list each action applied with confirmation status>
```

---

## Phase 6 — --fix mode (only if --fix was passed)

Each action requires confirmation. Print "Apply fix to `<file>:<line>`: <what will change>? [y/N]" and wait.

**Safe fixes:**
1. Add `logger.error(err, '<context>')` to empty catch blocks. Use detected logger syntax:
   - pino/winston: `logger.error(err, 'context')`
   - console fallback: `console.error('[context]', err)`
   - Python structlog: `logger.exception('context')`
   - Go slog: `slog.Error("context", "err", err)`

2. Scaffold a minimal `/health` route if:
   - No health route exists AND Railway config expects one (healthcheckPath is set)
   - Confirmed by user per confirmation prompt

   Example scaffold for Express:
   ```js
   app.get('/health', (_req, res) => res.sendStatus(200))
   ```
   For FastAPI:
   ```python
   @app.get("/health")
   def health(): return {"status": "ok"}
   ```

**Will NOT:**
- Modify existing logging that's "underpowered" but functional (console.log → structured logger)
- Add observability dependencies (pino, winston, structlog, etc.)
- Touch catch blocks that have existing logging (even if not structured)
- Change exit code values without explicit confirmation about each site

---

## Chat summary

Output ≤10 lines:
- Plan file path
- CRITICAL findings (each in one line)
- Counts by section and severity
- Suggested next: last step in the series — `/harden-for-deploy` for the consolidated report
