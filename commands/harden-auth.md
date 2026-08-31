---
description: Deployment hardening step 2 — review auth/session/authz surfaces. Identifies insecure cookies, broad CORS, missing CSRF, unauthenticated state-changing routes, weak password storage, JWT secret handling. Read-only by default; --fix tightens cookie flags and obvious CORS misconfigs only with confirmation. Fire on `/harden-auth`.
argument-hint: "[--fix] [scope path]"
allowed-tools: Bash(rg:*), Bash(jq:*), Bash(git:*), Bash(date:*), Bash(mkdir:*), Read, Glob, Grep, Write
---

# Harden: Auth

Audit authentication, session, and authorization surfaces. Read-only unless `--fix` is passed.

Args: $ARGUMENTS

Parse flags:
- `--fix` → enable safe mutations, each requiring per-file confirmation in chat
- remaining positional → scope path (default: repo root)

---

## Phase 0 — Pre-flight

```bash
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --porcelain | head -10
```

**Framework detection** — scan manifests and imports to identify web framework(s) present:

JS/TS: detect from `package.json` dependencies and `import`/`require` in source files:
- Express: `express`
- Fastify: `fastify`
- Hono: `hono`
- Koa: `koa`
- Next.js: `next` + (`app/` or `pages/api/` directory present)
- Nuxt: `nuxt`
- SvelteKit: `@sveltejs/kit`
- NestJS: `@nestjs/core`

Python: scan `pyproject.toml`/`requirements*.txt` and `import` statements:
- FastAPI: `fastapi`
- Flask: `flask`
- Django: `django`
- Starlette: `starlette`

Go: scan `go.mod`:
- `net/http` (stdlib)
- `github.com/gin-gonic/gin`, `github.com/labstack/echo`, `github.com/gofiber/fiber`, `github.com/go-chi/chi`

Ruby: `Gemfile`:
- Rails: `rails`
- Sinatra: `sinatra`

If no web framework detected: output "no web framework detected — skipping auth audit" and exit cleanly. This is a normal outcome for CLIs, libraries, and scripts.

---

## Phase 1 — Route inventory

Map all routes per detected framework(s). For each route record: method, path pattern, handler file:line, auth classification.

**Auth classification heuristics:**

*auth-required-explicit*: middleware visibly applied (`app.use(authMiddleware)`, `router.use(requireAuth)`, `@UseGuards()`, Django `@login_required`, `Depends(get_current_user)` in FastAPI, `before_action :authenticate_user!` in Rails).

*auth-required-implicit*: handler is inside a group/router that has explicit auth middleware applied at the group level.

*public*: no auth middleware visible at route or group level; or explicitly marked (`AllowAnonymous`, `@Public()`, `login_required=False`).

*unknown*: auth may exist but can't be statically determined (e.g., middleware applied via variable reference, complex conditional).

```bash
# Find route definitions per framework (adapt patterns to detected framework)
# Express
rg --no-heading -n '\.(get|post|put|patch|delete|all)\s*\(' --type js --type ts

# FastAPI
rg --no-heading -n '@(app|router)\.(get|post|put|patch|delete)\(' --type py

# Django
rg --no-heading -n 'path\(|url\(' --type py

# Go net/http / chi / gin
rg --no-heading -n 'HandleFunc\(|\.GET\(|\.POST\(|\.PUT\(|\.PATCH\(|\.DELETE\(' --type go
```

Output: table of method / path / classification / file:line.

---

## Phase 2 — Authentication surface

**Password storage:**
```bash
rg --no-heading -n 'bcrypt|argon2|scrypt|pbkdf2' --type js --type ts --type py --type go --type rb -l
rg --no-heading -n 'md5\(|sha1\(|SHA1\(|MD5\(' --type js --type ts --type py --type go --type rb | grep -i 'password\|passwd\|pwd'
rg --no-heading -n "password\s*===\s*|password\s*==\s*|stored_password\s*==" --type js --type ts --type py
```
- bcrypt/argon2/scrypt/pbkdf2 found → OK (note which)
- md5/sha1 near "password" context → **HIGH** (broken hash)
- plaintext compare → **CRITICAL**

**JWT:**
```bash
rg --no-heading -n "algorithm\s*[=:]\s*['\"]none['\"]|alg\s*[=:]\s*['\"]none['\"]" --type js --type ts --type py
rg --no-heading -n "secret\s*[=:]\s*['\"][^'\"]{1,20}['\"]" --type js --type ts --type py | grep -i 'jwt\|sign\|token'
rg --no-heading -n "jwt\.sign\|jwt\.verify\|jose\.|PyJWT\|python-jose\|jsonwebtoken" --type js --type ts --type py
```
- `algorithm: 'none'` → **CRITICAL** (signature is skipped)
- JWT secret hardcoded (< 20 chars or literal string in source, not from env) → **HIGH**
- `jwt.verify` not called on protected routes → **HIGH**

**Session:**
```bash
rg --no-heading -n "session\(\s*\{|express-session|connect-mongo|cookie-session" --type js --type ts
```
For each session config block, check: `secret` from env (not hardcoded), `cookie.httpOnly: true`, `cookie.secure: true` (or conditional on NODE_ENV), `cookie.sameSite` set, `maxAge` reasonable (< 30 days).

---

## Phase 3 — CSRF

For any state-changing route (POST/PUT/PATCH/DELETE) that accepts cookies (session-based auth):

```bash
rg --no-heading -n 'csrf|csurf|@csrf_protect|csrf_token|CSRFMiddleware|doubleCsrf' --type js --type ts --type py --type rb
```

- CSRF middleware present and applied to state-changing routes → OK
- No CSRF middleware present, session-based auth used, state-changing routes exist → **HIGH**
- `sameSite: 'strict'` cookie alone: flag as **MEDIUM** with note "partial protection — browser-enforced only, bypass via subdomain or redirect"

---

## Phase 4 — CORS

```bash
rg --no-heading -n "Access-Control-Allow-Origin|cors\(\|CORS(" --type js --type ts --type py --type go -n
```

For each CORS config:
- `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` → **CRITICAL** (browser blocks this combination, but it signals a misunderstanding of CORS; the config will silently fail in ways that look like auth bugs)
- Wildcard origin `*` on mutation routes (POST/PUT/PATCH/DELETE) → **HIGH**
- CORS applied globally without origin allowlist → **MEDIUM**
- `origin: true` (reflect requester origin) with credentials → **HIGH** (equivalent to wildcard for authenticated requests)

---

## Phase 5 — Rate limiting

Check login, signup, and password-reset routes from Phase 1 for visible rate limiting:

```bash
rg --no-heading -n 'rate.?limit|rateLimit|slowapi|django.?ratelimit|throttle|RateLimiter' --type js --type ts --type py --type go --type rb
```

For each auth route (login, signup, password-reset, token-refresh) in Phase 1's inventory: does a rate limiter visibly apply? If no rate limiter found anywhere → **MEDIUM** (all auth routes unprotected). If rate limiter exists but not on specific auth routes → **LOW** per route.

---

## Phase 6 — Unauthenticated state-changers

From Phase 1's route inventory: every route classified as `public` or `unknown` with method POST/PUT/PATCH/DELETE that is not an explicitly-public registration endpoint (signup, contact form):

Flag as **HIGH** — likely missing auth gate. Evidence: route path, method, file:line.

---

## Phase 7 — Debug / admin surface

```bash
rg --no-heading -n "'/debug'|\"/_debug\"|'/admin'|'/internal'|'/__inspect__'" --type js --type ts --type py --type go
rg --no-heading -n "introspection.*true|playground.*true|graphiql.*true" --type js --type ts
rg --no-heading -n "stack.*trace|stackTrace|traceback" --type js --type ts --type py | grep -i 'response\|send\|render\|json'
```

- Debug/admin route without auth middleware → **HIGH**
- GraphQL introspection enabled without env-gate → **MEDIUM** (enable in dev, disable in prod)
- Stack traces sent to client → **HIGH** (information disclosure)

---

## Phase 8 — Output

```bash
mkdir -p .claude/plans
TS=$(date +%Y%m%d-%H%M%S)
PLAN=".claude/plans/harden-auth-${TS}.md"
```

Plan file structure:

```
# Harden: Auth — Report

**Generated:** <ISO 8601>
**Framework(s):** <detected list>
**Scope:** <path>

## Summary

| Section | Count | Severity |
|---|---|---|
| Route inventory | public/auth/unknown counts | — |
| Authentication | N findings | CRITICAL/HIGH |
| CSRF | N findings | HIGH/MEDIUM |
| CORS | N findings | CRITICAL/HIGH/MEDIUM |
| Rate limiting | N findings | MEDIUM/LOW |
| Unauthenticated state-changers | N | HIGH |
| Debug/admin surface | N | HIGH/MEDIUM |

## Stop-the-line findings
<every CRITICAL — one line with file:line>

## Section 1 — Route inventory
| Method | Path | Auth | File:Line |
| ... | ... | ... | ... |

## Section 2 — Authentication
<per finding: type (password/JWT/session), issue, file:line, severity>

## Section 3 — CSRF
<per finding: route, issue, severity>

## Section 4 — CORS
<per finding: config location, issue, severity>

## Section 5 — Rate limiting
<routes missing rate limiting>

## Section 6 — Unauthenticated state-changers
<per route: method, path, file:line>

## Section 7 — Debug/admin surface
<per finding: route or pattern, issue, severity>

## Fix-mode actions
<only if --fix; list each action applied with confirmation status>
```

---

## Phase 9 — --fix mode (only if --fix was passed)

Each action requires explicit per-file confirmation in chat. Print "Apply fix to `<file>`: <what will change>? [y/N]" and wait.

**Safe fixes:**
1. Add `httpOnly: true`, `secure: true`, `sameSite: 'lax'` to session/cookie config blocks where these are missing
2. Replace `Access-Control-Allow-Origin: *` with an env-driven allowlist scaffold:
   ```js
   origin: process.env.ALLOWED_ORIGINS?.split(',') ?? []
   // TODO: set ALLOWED_ORIGINS="https://yourapp.com" in Railway/env
   ```

**Requires explicit typed confirmation (print warning, user must type "yes I understand")**:
3. Replace `algorithm: 'none'` with `HS256` — print loud warning: "This will break verification of all existing tokens. All active sessions will be invalidated. Type 'yes I understand' to proceed."

**Will NOT:**
- Create auth middleware from scratch
- Add CSRF tokens
- Add rate limiting dependencies
- Modify JWT secret values
- Change route access patterns (too risky without full context)

---

## Chat summary

Output ≤10 lines:
- Plan file path
- CRITICAL findings (each in one line with file:line)
- Counts by section
- Suggested next: `/harden-deps` or `/harden-for-deploy`
