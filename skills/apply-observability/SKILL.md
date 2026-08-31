---
name: apply-observability
description: >
  Apply the "admin observability page" pattern — an append-only event log +
  telemetry store, a no-op-safe one-way emit seam (observability can never break
  the request that produced the event), denormalized actor attribution (email
  captured at write time, no join back to users), audit events (login/logout/
  account-change) plus latency/token/cost telemetry, one admin-only aggregate
  endpoint (summary + recent + per-model rollup, percentiles computed safely),
  prune-on-read retention, and a StatTiles-over-tables client page with polling or
  manual refresh — to the current repo, adapted to its stack rather than copied
  verbatim. Idempotent: skips or flags existing observability pieces, never
  overwrites. Fire on `/apply-observability` or "add the observability page / add
  monitoring like my other apps / apply my standard observability page."
---

# Apply Observability Pattern

Ports the family's Observability page to the current repo: a self-contained audit
+ telemetry subsystem that admin users read through one page, fed by a **one-way,
no-op-safe emit seam** the rest of the app calls. The defining property is
**decoupling** — observability imports nothing from auth or the data layer; data
flows one way (auth/data/handlers *emit* → observability *consumes*), and a broken
observability store degrades to an empty panel rather than 500-ing the request
that produced the event.

This skill embeds the full spec (§ Pattern spec), which is self-sufficient: the
reference layouts below are shape hints per stack, not files to open.

## Reference layouts (the shapes this pattern takes per stack)

| Role | Stack | Observability code layout |
|---|---|---|
| **Most refined (the reference)** | Node + Fastify + SQLite | `app/server/observability/{routes,store,events}.ts`, transparent query telemetry `app/server/data/telemetry.ts` (`withTelemetry` Proxy), page `app/web/src/pages/Observability.tsx` |
| **Twin (origin)** | Node + Fastify + SQLite | `app/server/observability/{routes,store,events}.ts`, `app/server/data/telemetry.ts`, `app/web/src/pages/Observability.tsx` |
| **Bare `node:http` adaptation** | a zero-framework Node app | an `obs` module (log + aggregate), an inline `GET /api/observability` route on the server entrypoint, and an `Observability` client page |
| **Postgres-native variant** | Node + Fastify + Postgres | `src/server/{stats,auth-events}.ts`, `GET /api/observability/overview` in `src/server/app.ts`, `migrations/*_observability_*.sql`, page `web/src/views/Observability.tsx` |

Pick the layout matching the target's stack. Fastify + SQLite → the reference/twin
layout. Bare `node:http` → the zero-framework adaptation. Postgres app data → the Postgres-native
variant (native `percentile_cont`, events in the app DB). If none matches, implement
from the § Pattern spec using the nearest layout for shape.

**Composes with the household auth pattern.** The page is admin-only via
`apply-auth-pattern`'s `ADMIN_API` allowlist, and login/logout/account-change
audit events are emitted from the auth routes through this skill's emit seam. If
auth exists, wire those emits; if not, the page still works over whatever
telemetry the app emits, and the auth audit events are noted as pending.

## Phase 0 — Preflight (read-only)

1. Detect the stack: language, framework, how routes register, the app's
   datastore, the client framework/styling, and whether there's a data-access
   layer that could be wrapped for transparent telemetry.
2. Detect existing observability: grep for `observability`/`obs`/`telemetry`/
   `audit`/`metrics`/`events` routes and tables, any existing monitoring page,
   any logging seam. Anything found is a **skip-or-flag**, never an overwrite.
3. Decide the store placement (§ Store): a **separate** obs DB (the Fastify + SQLite
   references, cleanest decoupling), the **same** DB as auth (the zero-framework app, simplest), or the
   **app's Postgres** (the Postgres variant). Default to a separate store when the app uses
   SQLite; use the app's Postgres when it already runs Postgres.
4. Inventory what's worth surfacing: what audit-worthy actions exist (logins,
   exports, account/config changes) and what telemetry the app can produce (query
   latency, LLM token/cost, request timing). Don't fabricate signals the app
   doesn't generate.
5. Confirm the page is admin-only (`ADMIN_API`) and that `.gitignore` covers any
   new `*.db`. Show the user a short plan (store choice, tables, event types,
   telemetry source, endpoint shape) and get a go before writing.

## Pattern spec (the contract — every item is required unless marked optional)

### Store
- **Append-only tables.** Audit log: `obs_events(id, ts, type, success, actor_id,
  actor_label, ip, meta<json>)` indexed on `ts` and `type`. Telemetry (when the
  app produces it): `query_telemetry(id, ts, provider, operation, query_time_ms,
  row_count, is_slow, meta)` indexed on `ts` and `(provider,operation)`. The
  Postgres variant splits auth audit into a `login_event` table and telemetry into
  `model_event` — same idea, native columns.
- **Placement** per Phase 0: separate `db/observability.db` via the same DB seam
  the app uses (`OBS_DB_PATH` default, `OBS_DATABASE_URL` optional Postgres), OR
  the app's existing Postgres. **Separate store is the default for SQLite apps** —
  it keeps observability rippable/replaceable.
- **Denormalized actor attribution**: capture `actor_label` (email) **at write
  time**. Never join back to the users table — a failed login has no user row, and
  the point is that auth can be swapped for an IdP without touching this module.

### The emit seam (the one rule that makes this safe)
- **One module** (`events.ts` / the writers in `obs.ts`/`stats.ts`) is the *only*
  thing other code imports. It exposes `recordLogin`, `recordLogout`,
  `recordExport`, `recordAccountChange`, `recordEvent`, and a telemetry recorder.
- **Every emit is best-effort and no-op-safe**: wrapped in try/catch so a failing
  observability write can **never** throw into or slow the request that produced
  the event (the reference layout's `safeRecord`/`safeRecordTelemetry`; the
  zero-framework app's never-throw writers). Fire-and-forget for telemetry.
- **One-way dependency, enforced by import direction**: observability imports
  nothing from auth or the data layer. Auth/data/handlers depend on the emit seam;
  the seam depends on nothing upstream. Keep it that way — it's the whole design.

### Telemetry source
- **Prefer transparent instrumentation over hand-placed calls.** The Fastify + SQLite
  references wrap the DataProvider in a **timing Proxy** (`withTelemetry`) so every
  tracked read op is measured with zero call-site changes; slow threshold
  (`SLOW_MS`/`QUERY_SLOW_MS`, default 750ms), opt-out under tests / an env flag.
  If the target has a single data-access seam, wrap it. If it doesn't, fall back
  to explicit `recordEvent`/`recordQueryTelemetry` at the call sites (the
  zero-framework app's `recordLlmCall`, the Postgres variant's `recordEvent` in the query handler) — and say so.
- Telemetry carries a `source`/`operation` tag so the UI can group (e.g.
  "query-studio" vs "table-explainer", "query" vs "test").

### The aggregate endpoint
- **One admin-only read** — `GET /api/observability` (or `/overview`) returning a
  single payload: a **summary** (counts + KPIs: logins 24h, failed logins 24h,
  distinct users, total events; and for telemetry: call count, success rate,
  tokens, cost, avg + **p95** latency), **recent events** (capped), and a
  **per-model/per-operation rollup** with share bars.
- **Percentiles computed safely for the dialect**: on SQLite there is no
  `percentile_cont`, so compute p50/p95 **in JS over a bounded most-recent window**
  (5000 rows) — this also makes the math identical across SQLite and Postgres. On
  Postgres you may use native `percentile_cont`, but the JS-window approach is the
  portable default.
- **Degraded-mode read**: if the obs store is broken/empty, return a zeroed panel
  with a `200`, not a `500`. The admin panel must never take down on its own
  telemetry (the reference layout's degraded panel).
- **Optional CSV export**: `GET /api/observability/telemetry.csv` (`?format=json`,
  `?limit=N` clamped) — and **audit the export itself** via `recordExport`.
- **Gating**: the endpoint(s) live in the `ADMIN_API` allowlist → 401 anon / 403
  non-admin via the global auth guard. Attribute the reader via `req.authUser`.

### Retention (make it a choice, don't copy blindly)
- **Default: prune on read** (both Fastify + SQLite references / the zero-framework app) — bounded by **both**
  age and row count (`OBS_RETAIN_DAYS` ~90 / `OBS_RETAIN_MAX_ROWS`; telemetry
  shorter, ~14d / larger cap), trimmed opportunistically on each panel read so no
  cron is needed.
- **The Postgres variant's append-with-no-retention is the thing to fix, not replicate** — its
  `model_event`/`login_event` grow unbounded. When porting to a Postgres app, add
  the age+row-count prune (a scheduled job or a prune-on-read) and note it.

### Client page
- **One page**, admin-only in nav (`adminOnly`) **and** re-guarded on the route,
  with a defense-in-depth "administrator access required" panel for direct hits.
- Layout: the family header (icon tile + `text-gradient` h1 + subtitle), then a
  row of **StatTiles** (6 KPIs with tone thresholds — e.g. p95 > 750ms → caution),
  then a **telemetry-by-operation** table with share bars, a **recent-calls**
  table (slow rows tinted), and an **audit/sign-in log** table. Reuse the shared
  UI kit (`Card`, `StatTile`/`StatCard`, `Badge` + `Tone`), never a parallel one.
- **Data delivery**: default to **interval polling** (the family majority — 10–15s
  via TanStack Query `refetchInterval` or `setInterval`) plus a manual Refresh
  button. The Postgres variant's fetch-on-mount + manual-refresh (interval only ticks
  relative-time labels) is acceptable for low-traffic admin use — pick per expected
  traffic and say which. No SSE/WebSocket unless the app already has one.
- CSV export is a plain `<a href download>` relying on the session cookie.

## Adaptation rules

- **Adapt, don't transplant.** Generate code idiomatic to the target: its module
  layout, DB helpers, router, styling. The reference layouts are the spec's proof,
  not a file source.
- **Best-of-family, not lowest-common:** always include the no-op-safe emit seam,
  the one-way import direction, denormalized attribution, safe-dialect percentiles,
  the degraded-mode read, and age+row-count retention — even though not every
  family member has all six (the Postgres variant lacks retention; the zero-framework app shares the auth DB).
- **Telemetry realism:** only surface signals the app actually produces. An app
  with no data layer to wrap gets the audit-event half (logins/logout/changes)
  and a note that query telemetry needs a seam to instrument. Don't fabricate an
  APM you can't feed.
- **Reuse the existing client fetch layer and auth context**; don't add ad-hoc
  fetch or a second auth notion.
- Unrecognized stack: implement from this spec with the nearest reference for
  shape, and note in the closeout that the target had no family reference.

## Idempotency

- Existing observability of any kind (an obs/audit/metrics route or table, a
  monitoring page, a logging seam) → **stop and show findings** before touching
  anything. Offer: (a) leave it, (b) fill only the gaps (e.g. it logs events but
  has no page, or a page with no retention, or hand-placed telemetry that could be
  made transparent), or (c) replace — only on explicit confirmation, preserving
  existing event rows if the schema is compatible.
- Re-running on a repo this skill already treated must be a no-op plus a report of
  drift from the spec, not a duplicate subsystem.
- Never overwrite existing event tables, `.env`, or existing migrations. Verify
  `.gitignore` covers any new `*.db`.

## Tests

Wire into the target's existing test runner (never introduce a new framework).
Minimum set: `GET /api/observability` requires admin (401 anon / 403 viewer);
returns a well-formed summary over an empty store (all zeros, `200` not `500`);
an emitted `login`/`export`/`account_change` event shows up in `recent`; a failing
emit does **not** throw into the caller (mock the store to throw, assert the
request still succeeds); p95 is computed and stable over the window; retention
prunes rows past the age/row-count bound; CSV export is admin-gated and itself
recorded as an `export` event.

## Closeout (required, every run)

- **Added** — files created, routes registered, tables/migrations added, event
  types emitted, telemetry seam wrapped (or the call sites instrumented), the
  store placement chosen.
- **Skipped** — pieces not applicable (e.g. no data layer → no query telemetry; no
  auth → auth audit events pending) and existing pieces left alone, and why.
- **Manual follow-ups** — migrations to run, env vars (`OBS_DB_PATH`/
  `OBS_DATABASE_URL`, retention/threshold overrides), auth emit calls to add if
  auth arrives later, any Postgres retention job the target now needs.
- **Unverified** — anything not exercised end-to-end (e.g. couldn't run the app).
