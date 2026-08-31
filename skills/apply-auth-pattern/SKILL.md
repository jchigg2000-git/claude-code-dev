---
name: apply-auth-pattern
description: >
  Apply the "household auth" pattern — opaque-token session-cookie auth (never JWT),
  platform-native scrypt hashing, dedicated SQLite auth DB, one global secure-by-default
  request gate with PUBLIC_API/ADMIN_API allowlists, viewer/admin roles, seed-admin
  bootstrap, login rate limiting, and audit events — to the current repo, adapted to its
  stack rather than copied verbatim. Idempotent: skips or flags existing auth pieces,
  never overwrites. Fire on `/apply-auth-pattern` or "add the household auth pattern /
  add auth like my other apps / apply my standard auth to this app."
---

# Apply Auth Pattern

Ports a proven in-house auth layer to the current repo. The pattern originated in a
Node + Fastify app and has been ported across Fastify, bare `node:http`, and FastAPI
apps — it is framework-portable by design. This skill embeds the full spec (§ Pattern
spec), which is self-sufficient: the reference layouts below are shape hints, not files
to open.

## Reference layouts (the shapes this pattern takes per stack)

| Stack | Role | Auth code layout |
|---|---|---|
| Node + Fastify + SQLite | most refined | `app/server/auth/{store,routes}.ts`, wired in `app/server/index.ts` |
| Node + Fastify + SQLite | the origin | `app/server/auth/{store,routes}.ts` |
| Node + Fastify + Postgres, with a provider seam | Postgres variant | `src/server/auth/{store,provider,routes,cookies}.ts` |
| Bare `node:http` (+ best hardening) | a zero-framework Node app | auth store + HTTP handlers under `server/auth/`, gate wired in the server entrypoint |
| Python + FastAPI | framework port | `src/<pkg>/ui/server/{security,settings,_env}.py`, `auth/{store,provider,routes,events}` |

Pick the layout matching the target's stack. If none matches (Express, Flask, Go,
etc.), implement from the § Pattern spec using the nearest layout for shape.

## Phase 0 — Preflight (read-only)

1. Detect the stack: language, web framework, how the server is assembled, where routes
   register, existing env loading, `.env.example`.
2. Detect existing auth: grep for session/token/login/middleware/guard code, `users` or
   `sessions` tables, auth env vars. Anything found is a **skip-or-flag**, never an
   overwrite (see § Idempotency).
3. Inventory the target's real public surface: health/readiness endpoints, webhook
   receivers, static pages that must stay unauthenticated. These seed `PUBLIC_API`.
4. Confirm there is a writable place for the auth DB (`db/` convention) and that
   `.gitignore` covers `*.db` and `.env` — if not, that goes on the change list.
5. Show the user a short plan (files to add, files to touch, PUBLIC_API contents) and
   get a go before writing anything.

## Pattern spec (the contract — every item below is required unless marked optional)

### Tokens & sessions
- Session cookie holds an **opaque token**: 32 random bytes, hex. **Never JWT**, no
  signing, no session secret.
- Persist **only the SHA-256 of the token** in a `sessions` table (DB leak ≠ replay).
- TTL: 30 days when "remember me" is checked, else 12-hour browser-session cookie.
- Logout deletes the server-side session row, then clears the cookie.
- Password change wipes **all** of that user's sessions; if the caller changed their own
  password, re-issue their session honoring the original remember choice.

### Passwords
- **Platform-native scrypt** — `node:crypto` scrypt or Python `hashlib.scrypt`. No
  bcrypt/argon2 dependency.
- Stored format: `scrypt$N$r$p$saltHex$hashHex` with N=2^15, r=8, p=1, keylen=64
  (Python: set `maxmem` ≥ 96 MiB or scrypt raises).
- Verify with constant-time compare (`timingSafeEqual` / `hmac.compare_digest`).
- Unknown email → verify against a **dummy hash anyway** so timing is uniform, and
  return the identical 401 body as a wrong password (enumeration-safe).
- Minimum password length 8; email normalized NFKC, control characters rejected.

### Storage
- **Dedicated auth DB**, decoupled from app data: SQLite at `<repo>/db/auth.db` by
  default (`AUTH_DB_PATH` to override), optional Postgres via `AUTH_DATABASE_URL` if
  the app already runs Postgres.
- `users(id, email UNIQUE, password_hash, role, created_at, updated_at)`;
  `sessions(token_hash PK, user_id FK ON DELETE CASCADE, created_at, expires_at)`.
- Roles: `'viewer' | 'admin'` (default `viewer`). Expired sessions purged on read.
- The user object exposed to handlers/JSON must never include `password_hash`.

### Seed admin (FastAPI-port style — do NOT propagate the committed-hash variant)
- On empty `users` table only: create admin from `ADMIN_SEED_EMAIL` +
  `ADMIN_SEED_PASSWORD`. Hash it at seed time like any other password —
  **never commit a default password or its hash to source.**
- **If those env vars are unset, do NOT fall back to a literal.** Generate a
  random password (≥24 chars from a CSPRNG), print it ONCE to stderr at seed
  time, and force rotation on first login. A shared default literal is the same
  credential in every repo built from this pattern, and it only has to leak from
  one of them — a public mirror, a README, a screenshot — to unlock all of them.
- Repos that already ship a literal fallback are carrying that exposure until
  they migrate; treat it as a finding, not as the pattern.

### The gate
- **One global request gate** — Fastify `onRequest` hook / FastAPI (Starlette)
  middleware / top-of-handler check in bare `node:http`. Registered **before** all
  route modules so new routes are protected automatically; opting out means editing
  the allowlist, never decorating the route.
- Everything under `/api/*` requires a valid session → 401 JSON otherwise. Non-API
  paths (static SPA assets) skip the gate. If the app has server-rendered pages
  instead of a SPA login screen, unauthenticated page navigation gets a
  server-rendered login page.
- `PUBLIC_API` allowlist, seeded from Phase 0 inventory; family baseline:
  `/api/health`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
  (+ `/api/ready` if the app has readiness).
- `ADMIN_API` set → 403 unless `role === 'admin'`; covers user management,
  observability/audit endpoints.
- **Fastify: gate on `req.routeOptions.url`** (the matched route pattern), not
  `req.url` — defeats percent-encoding bypass. Equivalent care in other frameworks:
  match against the router's resolved pattern, not the raw path string.
- Optionally add typed per-handler deps (`require_admin` style) as defense-in-depth on
  admin handlers — the FastAPI port does both.

### Auth routes
- `POST /api/auth/login` (email, password, remember) → sets cookie.
- `POST /api/auth/logout` → deletes session, clears cookie. No-op without a presented
  cookie (prevents forced logout).
- `GET /api/auth/me` → current user or 401 (SPA session-resolution endpoint).
- User management (admin-only): list/create/delete users, change role, reset password.
- **Invariants, enforced server-side and atomically:** never zero admins (can't demote
  or delete the last admin), no self-lockout.

### Cookie & headers
- Cookie: `HttpOnly; SameSite=Lax; Path=/`; `Secure` gated by `COOKIE_SECURE` env
  (default on in production). Warn loudly if serving the built SPA without Secure.
- Security headers on **every** response: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS in production.
- CSRF (apply it, don't just rely on SameSite): explicit
  same-origin **Origin-header check on every state-changing route** (login, logout,
  user mutations).
- CORS: default deny / same-origin only. No permissive CORS plugin unless the app
  already needs cross-origin, and then allowlist-only with empty default.

### Credential surfaces (password-manager / vault support)

The goal: a browser or 1Password/Bitwarden-style vault can **fill** the sign-in form
and, after a successful sign-in or password change, **offer to save or update** the
entry. This is cheap to add and near-impossible to retrofit into muscle memory once
users have trained themselves around a form that never prompts.

- **Enumerate every credential surface before editing — there is usually more than
  one.** Grep the target for `type="password"` and fix *all* of it, not just the
  `/login` route. An inline "sign in to continue" panel on a landing page or in a
  modal is the one that gets missed, and a half-annotated app trains the vault to
  store a duplicate junk entry.
- **A real `<form>` with a submit event is mandatory.** Managers key off form
  submission; a `<div>` of inputs with an `onClick` button can never trigger a save
  prompt no matter how the fields are annotated. This also makes Enter work.
- **Sign-in / sign-up form:**
  - username field: `name="email"` (or `username`) + `autoComplete="username"`.
  - password field: `autoComplete="current-password"` when signing IN,
    `"new-password"` when signing UP. If one form toggles between modes, this
    attribute **must track the mode** — otherwise sign-up invites the manager to
    autofill an existing password into a new-account field.
- **After a successful sign-in, navigate for real.** SPA soft-navigation
  (`router.push`, `setUser(...)`, a state flip) leaves the save prompt unreliable to
  absent, because the manager never sees a navigation follow the submit. Use a full
  `window.location.assign(next)` / equivalent. Bonus: server-rendered frameworks then
  re-render every route against the just-set cookie instead of a cached payload.
  *(Known gap: both Fastify + SQLite references currently flip React state here and do NOT
  navigate — fix on next touch.)*
- **Change-password form needs a username anchor.** Without one the manager guesses
  which vault entry is being updated and usually guesses "new entry", leaving the
  real credential stale. Include the signed-in email as a readonly
  `autoComplete="username"` text input, visually hidden via an `sr-only`-style class
  with `tabIndex={-1}` + `aria-hidden`. Do **not** use `type="hidden"` or the
  `hidden` attribute — managers skip those. Pair with `current-password` /
  `new-password` on the actual fields.
- Do not add `autoComplete="off"` to credential fields "for security". It does not
  stop modern managers, and it does suppress the save prompt.

### Rate limiting & audit
- Login: **5 attempts / 15 min per client IP** → 429. In-process store is fine;
  Redis-backed via `REDIS_URL` if the app scales horizontally.
- Behind a proxy (Railway = one hop): take the **rightmost** X-Forwarded-For hop, or
  set the framework's trust-proxy to exactly 1. Never trust the whole XFF chain; if
  not behind a proxy, don't trust XFF at all.
- Audit events for login success/failure, logout, and account changes — into the
  app's existing observability/log channel (one-way dependency, best-effort, no
  secrets in events). Throttled 429s still get audited.

### Env & config
- Vars (names are the family convention — keep them): `AUTH_DB_PATH`,
  `AUTH_DATABASE_URL` (optional), `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`,
  `COOKIE_SECURE`, `REDIS_URL` (optional). Document every one in `.env.example` with
  a comment; never write values.
- Load env the way the target already does; if it has no loader, use the platform's
  native one (`node --env-file` / `process.loadEnvFile` / `load_local_env` pattern)
  imported first, with real exported vars winning over file values.
- Optional but cheap: a provider seam (`AuthProvider` interface, `local` implemented,
  `oidc` declared-but-throws) — include it when the target plausibly grows SSO.

## Adaptation rules

- **Adapt, don't transplant.** Generate code idiomatic to the target: its module
  layout, error style, logger, DB helpers. The reference repos are the spec's proof,
  not a file source. Copying verbatim across frameworks is how the pattern rots.
- **Best-of-family, not lowest-common:** always include the Origin-header CSRF check,
  env-only seeding, timing-uniform verify, and matched-route-pattern gating — even
  though not every family member has all four.
- Frontend: if the target is a SPA, add the minimal mirror — an auth context that
  resolves `GET /api/auth/me` on load and drops to login on any 401 (the Fastify +
  SQLite reference's `web/src/lib/auth.tsx` is the model). If server-rendered, the gate's login page
  covers it.
- Unrecognized stack: implement from this spec with the nearest reference for shape,
  and say in the closeout that the target had no family reference.

## Idempotency

- Existing auth of any kind → **stop and show findings** before touching it. Offer:
  (a) leave it, (b) fill only the gaps (e.g. it has login but no rate limit), or
  (c) replace — replace only on explicit confirmation, preserving existing user data
  if the schema is compatible.
- Re-running on a repo this skill already treated must be a no-op plus a report of
  drift from the spec, not a duplicate layer.
- Never overwrite `.env`, existing DBs, or existing migrations. Never commit `.env`
  or `db/*.db` — verify `.gitignore` covers both and add entries if missing.

## Tests

Wire into the target's existing test runner (never introduce a new framework). Minimum
set: unauthenticated `/api/*` → 401; public allowlist reachable; wrong password and
unknown email → identical 401; login → me → logout round-trip; admin route 403 for
viewer; rate limit trips at 6th attempt; last-admin demote/delete rejected.

## Closeout (required, every run)

- **Added** — files created, routes registered, env vars now expected.
- **Skipped** — existing pieces left alone, and why.
- **Manual follow-ups** — env vars the user must set (`ADMIN_SEED_*`, `COOKIE_SECURE`
  in prod), first-login password rotation, Railway/deploy config if the healthcheck
  path changed.
- **Unverified** — anything not exercised end-to-end (e.g. couldn't run the app).
