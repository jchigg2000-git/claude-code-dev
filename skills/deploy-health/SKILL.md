---
name: deploy-health
description: >-
  Sweep the health of DEPLOYED services (primarily Railway), one service per
  iteration, reading live infra read-only:
  latest deployment status, HTTP error rate, response-time trend, crash/restart
  loops, and deploy-vs-repo-HEAD drift (stale deploys). REPORT-ONLY — never
  deploys, redeploys, scales, restarts, or changes variables/domains. State lives
  in a ledger so it survives fresh contexts and resumes cleanly. Fire on
  "/deploy-health", "check my deployed services", "are my Railway apps healthy",
  or a self-paced /loop that wants per-service health triage. Follows the
  autonomous-sweep-core contract.
---

# Deploy health (ledger-driven /loop over deployed SERVICES)

Read `autonomous-sweep-core` first — loop shape, iteration-0 ledger build, first-`pending`-row
processing, resume/idempotency, and the never-destructive hard rules are all inherited from it.
This file is only the detector: what one unit is, what "actually degraded" means, and what to
write. Unlike its siblings, this sweeps **infrastructure, not repos** — and it is strictly
read-only against that infra.

## UNIT
One deployed **service** per iteration — NOT one repo (a repo may back several services, and a
service may have no local repo). **Iteration 0** enumerates every service across the user's
Railway projects and writes one ledger row per service:
- Projects/services via the CLI or GraphQL — e.g. `railway list`, or a GraphQL `me { projects
  { edges { node { name services { edges { node { id name } } } } } } }` query (see the token
  rule below). Do NOT lean on the Railway MCP to enumerate — verify it once, then fall to CLI.
- Row per service, `status=pending`, keyed by `project / service (+ env)`.

## DETECT — the "actually degraded" gate (read-only against infra)
Per service, pull only reads:
- **Latest deployment status** — crashed / failed / succeeded / removed.
- **Health** — HTTP 5xx error rate, response-time trend, restart/crash-loop count.
- **DRIFT** — deploy serving a commit much older than the backing repo's HEAD (**stale deploy**);
  cost/scale anomalies.
- **Failed-deploy reason** — via the CLI form below (a bare `railway logs` will NOT show it).

**Degraded (route to report)** = a crashed/failed latest deploy · an elevated 5xx rate · a
crash loop · OR a deploy staler than repo HEAD by a meaningful margin.
**NOT degraded (leave, log clean)** = a healthy service within normal variance · an
intentionally paused / removed / archived service.

### Railway access constraints (operating rules — hard-won, do not relearn)
- **The Railway MCP dies independently.** It authenticates with its OWN token that expires apart
  from the CLI and routinely returns `Unauthorized` even when `railway whoami` succeeds. Verify
  with **ONE** MCP call; if it 401s, **ABANDON the MCP for the whole session** and use the CLI.
  Do NOT retry the MCP — that is the #1 time-sink in this sweep.
- **Failed-deploy reasons ARE reachable from the CLI** — the explicit `-d` + `-s` form is
  required: `railway logs -d <deployment-id> -s <service> -e <env> -p <project> --lines N`
  (`-b` = build logs). A **bare `railway logs` targets the latest SUCCESSFUL deploy** and will
  silently hide the crash you are investigating.
- **For reads the CLI doesn't expose, hit GraphQL directly:** `POST
  https://backboard.railway.com/graphql/v2` with
  `Authorization: Bearer $(jq -r .user.accessToken ~/.railway/config.json)` — use
  **`.user.accessToken`**, NOT `.user.token` (empty in this env).

## FIX — REPORT-ONLY
No fix agents mutate anything. This detector's "fix" is the write-up. Read-only against infra —
**NEVER deploy, redeploy, scale, restart, or change variables/domains.** For each degraded
service, write per-service health plus the **specific suggested action for the user to run**,
e.g. "latest deploy crashed on missing env `VAR_X` — set it and redeploy" or "deploy is 40
commits behind HEAD — redeploy from `main`". The ledger row + the exact command IS the deliverable.

## SKIP (this detector's extension of the hard rules)
- Never `railway up` / deploy / redeploy / scale / restart.
- Never set or change variables or domains.
- Never delete or remove a service.
- Never keep hammering a 401'd MCP — fall back to the CLI per the constraints above.
- Leave intentionally paused / removed services alone (log them, don't flag).

## LEDGER COLUMNS
`deploy-status | error-rate | resp-time | crash-loop | deploy-vs-HEAD-lag | note`

## Domain-lessons (real traps)
- **The MCP-token-dies-independently trap is the #1 time-sink.** The MCP token expires apart from
  the CLI, so `Unauthorized` appears even mid-healthy-session. Verify once, then commit to the
  CLI for the rest of the run — don't strum the MCP.
- **A bare `railway logs` silently shows the last SUCCESSFUL deploy**, hiding the crash you're
  chasing. Always use `railway logs -d <deployment-id> -s <service>` to see a failed deploy's
  reason.
- **A deploy serving a commit far behind repo HEAD is "stale"** — a real drift finding worth
  reporting even when the service itself is "up" and green.
- **Use `.user.accessToken`, not `.user.token`**, for the GraphQL bearer — `.token` is empty in
  this environment and will read as "no token found".
- **A service with no backing local repo can't be drift-checked** — report health only, and note
  that deploy-vs-HEAD lag is `n/a`, don't guess.
