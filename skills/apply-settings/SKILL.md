---
name: apply-settings
description: >
  Apply the "admin app-shell Settings page" pattern — a server-backed key/value
  settings store (jsonb/JSON KV with typed get/set and read-time coercion),
  validation-on-write spend/enum guards, a page shell of CollapsibleCard sections,
  an admin-only accounts-management section reusing the household-auth users API,
  and client-local preferences (theme/model/lens visibility via localStorage with
  cross-tab sync) — to the current repo, adapted to its stack rather than copied
  verbatim. Idempotent: skips or flags existing settings pieces, never overwrites.
  Fire on `/apply-settings` or "add the settings page / add a settings page like
  my other apps / apply my standard settings page to this app."
---

# Apply Settings Pattern

Ports the family's Settings page to the current repo. The pattern is an **admin
app-shell page** that composes three independently-optional sections over one
consistent shell: (1) a **server-backed KV settings store**, (2) an **admin-only
accounts manager**, and (3) **client-local preferences**. Only the Postgres app has
all three with real server persistence; the Fastify + SQLite apps and the zero-framework Node app
ship the shell with client-only prefs + the accounts section and no server settings
table. This skill treats the KV store as the backbone and the localStorage-only
variant as the degenerate case of the same shell — so a target with no server
settings still gets the same page, just with fewer wired sections.

This skill embeds the full spec (§ Pattern spec), which is self-sufficient: the
reference layouts below are shape hints per stack, not files to open.

## Reference layouts (the shapes this pattern takes per stack)

| Role | Stack | Settings code layout |
|---|---|---|
| **Server-backed KV (the backbone)** | Node + Fastify + Postgres | `src/server/settings.ts`, `GET/PUT /api/settings` in `src/server/app.ts`; `migrations/002_app_state.sql` (`app_setting`); `web/src/views/Settings.tsx`, `web/src/components/{AccountsManager,ThemeToggle,CollapsibleCard}.tsx` |
| **Shell + accounts + roles preview (Fastify)** | Node + Fastify + SQLite | `app/web/src/pages/Settings.tsx`; accounts via `app/server/auth/routes.ts`; roles preview `app/server/roles/routes.ts`; client prefs `web/src/lib/lensSettings.ts` |
| **Shell + accounts + roles preview (origin)** | Node + Fastify + SQLite | `app/web/src/pages/Settings.tsx`; `app/server/roles/routes.ts`; `web/src/lib/lensSettings.ts` |
| **Shell, bare `node:http`, client-only prefs** | a zero-framework Node app | a `Settings` client page; accounts served by the auth HTTP handler (`handleUsersApi`); model preference in a client-side LLM module |

Pick the layout matching the target's stack and persistence. Fastify + a real
settings DB → the server-backed KV backbone. Fastify SPA with only client prefs +
accounts → the shell + accounts layout. Bare `node:http` → the zero-framework adaptation. If none
matches (Express, Flask, Go, etc.), implement from the § Pattern spec using the
nearest layout for shape.

**Depends on the household auth pattern.** The accounts section and the admin gate
reuse `apply-auth-pattern`'s users API and `ADMIN_API` allowlist. If the target
has no auth yet, run `/apply-auth-pattern` first (or the accounts section is
skipped and noted in the closeout).

## Phase 0 — Preflight (read-only)

1. Detect the stack: language, web framework, how routes register, the client
   framework/router, the styling system, and the app's primary datastore
   (SQLite? Postgres? none?). The settings KV store rides the app's existing DB.
2. Detect existing settings: grep for `settings`/`preferences`/`config` routes,
   a `settings`/`app_setting` table, a Settings page/component, localStorage pref
   keys. Anything found is a **skip-or-flag**, never an overwrite (§ Idempotency).
3. Detect auth: is there a household-auth users API + `ADMIN_API` gate? If yes,
   the accounts section wires into it; if no, skip that section and note it.
4. Inventory what the app actually has to configure — the real candidate settings
   (active model, theme, feature toggles, suppressed items). Don't invent
   settings the app has no use for; an app with one real pref gets one row.
5. Show the user a short plan (files to add, files to touch, which of the three
   sections apply, the concrete setting keys) and get a go before writing.

## Pattern spec (the contract — every item is required unless marked optional)

### The settings page shell (always)
- **One page**, admin-reachable, built from **CollapsibleCard sections** — one
  card per concern, each independently collapsible with its open/closed state
  persisted (localStorage key per card, the Postgres app / db2 `collapseKey` idiom).
- Page layout matches the family header convention: `mx-auto max-w-* space-y-*`
  container, an icon-tile + `text-gradient` `<h1>` + muted subtitle, then the
  section cards. Reuse the app's existing shared UI kit (`Card`, `Badge`,
  `Button`, `CollapsibleCard`), never a parallel one.
- Nav entry through the app's existing nav model. If the whole page is
  admin-only, mark the nav item `adminOnly` **and** re-guard the route
  client-side; if only some sections are admin-only (the Postgres app: settings viewer,
  accounts admin), the page is viewer-reachable and the accounts card is gated.

### Server-backed KV settings store (the backbone — include unless the app has no server or truly nothing to persist server-side)
- **One KV table**, decoupled shape: `app_setting(key PK, value <json>, updated_at)`.
  Value column is `jsonb` (Postgres) / `TEXT` holding JSON (SQLite). One row per
  logical setting — **not** one wide typed row — so adding a setting never means
  a migration.
- **Typed get with read-time coercion** (`getSettings`): read all rows, coerce
  each key against a per-key type guard, **fall back to the declared default on
  wrong/missing type**. The typed `AppSettings` object is assembled in code, not
  stored as one blob. Defaults live in one `DEFAULTS` constant.
- **`setSetting` upsert**: `INSERT ... ON CONFLICT (key) DO UPDATE SET value=…,
  updated_at=…`. Value serialized to JSON on write.
- **Endpoints**: `GET /api/settings` → the full typed settings object; `PUT
  /api/settings` → accepts a **partial patch**, validates, persists changed keys,
  returns the fresh full object. Gate at the level the setting deserves — global
  app settings can be viewer-readable but should be **admin-only to write** unless
  a setting is genuinely per-nobody/global-and-safe; per-user settings need a
  user scope column (the family doesn't have per-user server settings yet — if the
  target needs it, add `user_id` to the PK and say so in the closeout).
- **Validation-on-write is a real guard, not decoration**: constrain enums
  (`theme ∈ {light,dark,system}`) and, critically, any setting that gates spend or
  external calls (the Postgres app validates `activeModel` against the model catalog so an
  arbitrary id can't drive arbitrary paid inference) → `400` on violation. Never
  persist an unvalidated value that reaches a billable/external path.

### Accounts management section (include when household auth exists)
- An **admin-only** card that reuses the auth users API verbatim — do **not**
  build a second user store. List / create (email + role + min-8 password) /
  change-role / reset-password / delete, each hitting `GET/POST /api/auth/users`
  and `PATCH/DELETE /api/auth/users/:id`.
- All the auth invariants are enforced **server-side already** (never zero admins,
  no self-lockout); the UI just surfaces the errors — never re-implement the
  invariants client-side as the source of truth.
- Factor it as its own component (an `AccountsManager.tsx`) so the settings
  page stays a composition, not a monolith.

### Client-local preferences (include for anything that is genuinely per-browser)
- Prefs that are per-device and don't need server truth (which lenses are
  visible, theme when there's no cross-device requirement, a model pick that's a
  local convenience) live in **localStorage**, exposed reactively via
  `useSyncExternalStore` with a small store module (`lensSettings.ts` idiom).
- **Cross-tab sync**: subscribe to the `storage` event so a change in one tab
  updates others. Validate on read (filter to known ids; force-include any
  non-hideable base item — the Fastify + SQLite apps always keep the base lens on).
- Namespaced key convention: `<app>.<pref>` (e.g. `myapp.activeLenses`,
  `db2explorer.model`, `myapp.theme`).

### The theme trap (do NOT reproduce)
- The Postgres app writes `theme` to the server but the client **only ever applies theme
  from localStorage** — server persistence is a dead "syncs across devices" path.
  If the target wants server-persisted theme, **wire the read-back**: on load,
  hydrate the local theme store from `GET /api/settings.theme` (server wins on
  first load, localStorage caches thereafter). If it doesn't need cross-device
  theme, keep theme **client-only** and don't add a server column that lies. Never
  ship the half-wired version.

## Adaptation rules

- **Adapt, don't transplant.** Generate code idiomatic to the target: its module
  layout, error style, DB helpers, router, styling system. The reference repos are
  the spec's proof, not a file source.
- **Compose only the sections that apply.** A target with one real pref and no
  auth gets the shell + one client-local pref and nothing else — that's the
  correct minimal output, not a failure. Say which sections you included and why.
- **Match the persistence to the app's datastore.** Postgres app → jsonb KV +
  `percentile`-free simple reads (the Postgres app). SQLite app → JSON-in-TEXT KV
  (better-sqlite3). No server DB / static-hosted SPA → client-local only, and say
  the server settings backbone was intentionally skipped.
- **Reuse the existing client fetch layer and auth context** (`api`/`apiSend`,
  `useAuth`) — never add ad-hoc `fetch` or a second auth notion.
- Unrecognized stack: implement from this spec with the nearest reference for
  shape, and note in the closeout that the target had no family reference.

## Idempotency

- Existing settings of any kind (a settings route, an `app_setting`/`settings`
  table, a Settings page, localStorage pref keys) → **stop and show findings**
  before touching anything. Offer: (a) leave it, (b) fill only the gaps (e.g. it
  has client prefs but no server KV, or a page but no validation guard), or
  (c) replace — replace only on explicit confirmation, preserving existing setting
  rows if the schema is compatible.
- Re-running on a repo this skill already treated must be a no-op plus a report of
  drift from the spec, not a duplicate page or table.
- Never overwrite existing settings rows, `.env`, or existing migrations. New
  migrations are additive and idempotent-safe.

## Tests

Wire into the target's existing test runner (never introduce a new framework).
Minimum set: `GET /api/settings` returns defaults on an empty store; `PUT` with a
valid partial patch persists and round-trips; `PUT` with an out-of-enum `theme`
or an unknown spend-gated value → `400` and does **not** persist; read-time
coercion returns the default when a stored row has the wrong type; write to a
settings key is rejected/allowed per its gate (admin-only write returns 403 for
viewer); the accounts section's mutations surface the server invariants
(last-admin demote rejected). Client: a localStorage pref survives reload and
syncs across tabs.

## Closeout (required, every run)

- **Added** — files created, routes registered, migrations added, setting keys now
  defined, which of the three sections were included.
- **Skipped** — sections not applicable (e.g. no auth → no accounts card; no
  server DB → no KV store) and existing pieces left alone, and why.
- **Manual follow-ups** — migrations to run, any per-user-settings scope the target
  needs that the family baseline doesn't cover, first values an admin should set.
- **Unverified** — anything not exercised end-to-end (e.g. couldn't run the app).
