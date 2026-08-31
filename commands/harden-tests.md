---
description: Deployment hardening step 7 — inventory tests, identify untested critical paths (auth, payment, data writes, public APIs), generate integration tests for highest-leverage gaps. Wires into existing test runner; never introduces new frameworks. Writes test files only; never modifies app code. Fire on `/harden-tests`.
argument-hint: "[--write] [--top N] [scope path]"
allowed-tools: Bash(rg:*), Bash(jq:*), Bash(npm:*), Bash(pnpm:*), Bash(yarn:*), Bash(pytest:*), Bash(go:*), Bash(cargo:*), Bash(bundle:*), Bash(git:*), Bash(date:*), Bash(mkdir:*), Read, Glob, Grep, Write, Edit
---

# Harden: Tests

Audit test coverage on critical paths and generate integration tests for the highest-leverage gaps. Read-only by default; `--write` generates test files.

Args: $ARGUMENTS

Parse flags:
- `--write` → generate test files for top N gaps
- `--top N` → number of gaps to generate tests for (default: 5)
- remaining positional → scope path (default: repo root)

> Note for orchestrated runs: this step uses `--write`, NOT `--fix`. `harden-for-deploy --fix` maps `--fix` → `--write` here so a full fix run can close test gaps; without it, this step is audit-only and the consolidated report must say so ("Tests: audit-only — N gaps not closed").

---

## Phase 0 — Pre-flight

```bash
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --porcelain | head -10
```

**Test framework detection** — check manifests and existing test files:

JS/TS:
```bash
cat package.json | jq '.devDependencies | keys[]' 2>/dev/null | grep -E 'vitest|jest|mocha|@playwright|supertest'
find . -name '*.test.ts' -o -name '*.test.js' -o -name '*.spec.ts' -o -name '*.spec.js' | head -10
find . -type d -name '__tests__' | head -5
```

Python:
```bash
cat pyproject.toml 2>/dev/null | grep -E 'pytest|unittest'
find . -name 'test_*.py' -o -name '*_test.py' | head -10
```

Go:
```bash
find . -name '*_test.go' | head -10
cat go.mod 2>/dev/null | grep -E 'testify|ginkgo'
```

Rust:
```bash
rg --no-heading -l '#\[cfg\(test\)\]' --type rs | head -10
find . -type d -name 'tests' | head -5
```

Ruby:
```bash
cat Gemfile 2>/dev/null | grep -E 'rspec|minitest'
find . -name '*_spec.rb' -o -name 'test_*.rb' | head -10
```

If no test framework detected at all: output "no test framework detected — will not introduce one. Audit complete: 0 tests found." Report this in the plan file and exit cleanly — this is a valid outcome.

Record: framework name, test runner command, existing test file locations.

---

## Phase 1 — Test inventory

```bash
# Count test files
find . -name '*.test.ts' -o -name '*.test.js' -o -name '*.spec.ts' -o -name '*.spec.js' \
  -o -name '*_test.go' -o -name 'test_*.py' -o -name '*_spec.rb' \
  | grep -v node_modules | grep -v .git | wc -l

# Identify integration vs unit
find . \( -name '*.test.*' -o -name '*.spec.*' -o -name '*_test.*' \) \
  -not -path '*/node_modules/*' -not -path '*/.git/*' \
  | xargs grep -l 'supertest\|request(app\|TestClient\|net/http/httptest\|rack-test\|httptest' 2>/dev/null
```

Classification heuristic:
- File path contains `integration`, `e2e`, `api`, `request`, `http` → likely integration
- File uses an HTTP helper (`supertest`, `TestClient`, `httptest`, `rack-test`) → confirmed integration
- Otherwise → unit

Record counts: total tests, integration tests, unit tests.

---

## Phase 2 — Critical path identification

Build the critical path list by combining:

**From route inventory** (mirror Phase 1 of `/harden-auth`):
```bash
# Find auth-adjacent routes
rg --no-heading -n '(login|signin|signup|register|logout|password.reset|token.refresh|verify.email|forgot.password|reset.password)' \
  --type js --type ts --type py --type go --type rb -i -l | head -20

# Find mutation routes
rg --no-heading -n '\.(post|put|patch|delete)\s*\(' --type js --type ts | head -50
rg --no-heading -n "@(app|router)\.(post|put|patch|delete)\(" --type py | head -50
rg --no-heading -n '(HandleFunc|\.POST|\.PUT|\.PATCH|\.DELETE)\(' --type go | head -50
```

**Payment / external integrations:**
```bash
rg --no-heading -n 'stripe|paddle|braintree|paypal|square|checkout\.' --type js --type ts --type py --type go -i -l | head -10
```

**File upload:**
```bash
rg --no-heading -n 'multer|busboy|formidable|multipart|upload\.' --type js --type ts --type py --type go -i -l | head -10
```

**Email send:**
```bash
rg --no-heading -n 'sendMail|sendEmail|nodemailer|sendgrid|ses\.send|smtp\.' --type js --type ts --type py -i -l | head -10
```

**Database writes** (non-read operations):
```bash
rg --no-heading -n '\.(create|insert|update|delete|save|destroy|upsert)\s*\(' --type js --type ts --type py --type go -n | grep -v 'node_modules\|test\|spec' | head -30
```

For each critical path identified, check for existing integration tests:
- Does any test file import/reference the route handler or path string?
- Is there a test that hits this endpoint with success AND failure cases?

**Coverage requirement**: each critical path needs AT LEAST:
- 1 integration test — happy path (200/201 OK)
- 1 integration test — auth failure (401/403 for authenticated routes)
- 1 integration test — validation failure (400 for malformed input)

If any of these three is missing → gap.

---

## Phase 3 — Gap ranking

Sort uncovered critical paths by exposure risk:

1. **Auth routes** (login, signup, password reset) — highest exposure, lowest tolerance for error
2. **Payment routes** — irreversible financial operations
3. **State-changing public API routes** (POST/PUT/PATCH/DELETE on unauthenticated or unknown-auth routes)
4. **State-changing authenticated routes** — lower blast radius but still important
5. **Read-only public routes** — lowest priority

Within each tier, apply secondary signals:
- Recent commits to the handler file (git log -5 -- <file>): recently changed = higher priority
- File line count > 100 lines = higher complexity signal
- `TODO` / `FIXME` comment near route handler = higher priority

Report top gaps with: route/handler, missing test types (happy/auth/validation), risk tier, secondary signals.

---

## Phase 4 — Generate tests (only if --write flag is passed)

For top N gaps (default N=5, or `--top N` value):

**Discover test file location convention:**
```bash
# Find where existing integration tests live
find . \( -path '*/test/*' -o -path '*/tests/*' -o -path '*/__tests__/*' -o -path '*/spec/*' \) \
  -name '*integration*' -o -name '*api*' -o -name '*request*' \
  -not -path '*/node_modules/*' | head -10
```

Use the same directory and naming convention as existing integration tests.

**Generation principles:**
- Use existing test framework's HTTP helper (supertest for Express, TestClient for FastAPI, httptest for Go, etc.)
- Prefer real DB/service over mocks — integration tests should test the full stack
- If no DB integration test exists as a pattern to follow, generate with a comment `// TODO: wire up test database — see existing unit tests for mock pattern`
- One test file per gap, named to match the route/handler (e.g., `auth.login.integration.test.ts` for the login route)
- Each test file contains: happy path + auth failure + validation failure
- Never modify application code — test files only

**Example shape (Express/supertest):**
```js
import request from 'supertest'
import { app } from '../src/app'

describe('POST /auth/login', () => {
  it('returns 200 with valid credentials', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'valid' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
  })

  it('returns 401 with wrong password', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'test@example.com', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('returns 400 with missing email', async () => {
    const res = await request(app).post('/auth/login').send({ password: 'valid' })
    expect(res.status).toBe(400)
  })
})
```

Adapt the shape to the detected framework. For each file generated, record: path written, route covered, test cases included.

---

## Phase 5 — Output

```bash
mkdir -p .claude/plans
TS=$(date +%Y%m%d-%H%M%S)
PLAN=".claude/plans/harden-tests-${TS}.md"
```

Plan file structure:

```
# Harden: Tests — Report

**Generated:** <ISO 8601>
**Framework:** <detected test framework>
**Mode:** <audit-only | --write (N tests generated)>
**Scope:** <path>

## Summary

| Section | Count |
|---|---|
| Total test files | N |
| Integration tests | N |
| Unit tests | N |
| Critical paths identified | N |
| Critical paths with full coverage | N |
| Gaps (missing coverage) | N |

## Critical paths — coverage status

| Route / Handler | Auth? | Happy | Auth-fail | Validation-fail | Risk tier |
|---|---|---|---|---|---|
| POST /auth/login | yes | ✓ | ✗ | ✓ | auth |
| ... | | | | | |

## Top N gaps (ranked by risk)

### 1. <Route / Handler>
- **Risk tier:** <auth | payment | state-changing | read-only>
- **Missing tests:** happy path / auth failure / validation failure
- **File:** <handler file:line>
- **Secondary signals:** <recent commits / complexity / TODOs>
- **Generated test file:** <path> (only if --write)

...

## Files written (only if --write)
<list of file paths created>

## Verification results (only if --write)
<test run output; any failing tests flagged for user triage>
```

---

## Phase 6 — Verification (only if --write was passed)

After writing test files, run the test suite:

```bash
# npm
npm test 2>&1 | tail -30
# or: npx vitest run / npx jest

# Python
python -m pytest 2>&1 | tail -30

# Go
go test ./... 2>&1 | tail -30

# Rust
cargo test 2>&1 | tail -30
```

For any generated test that fails on first run: flag it in the plan file as "first-run failure — likely assertion mismatch against real app behavior, not a bug." Do NOT attempt to fix the application code. Report the failure to the user for triage.

---

## Chat summary

Output ≤10 lines:
- Plan file path
- Total critical paths, gaps found, tests generated (if --write)
- Any first-run test failures
- Suggested next: `/harden-observability` or `/harden-for-deploy`
