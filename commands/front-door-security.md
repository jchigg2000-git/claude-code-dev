---
description: Front-door security pass — find the externally-reachable and irreversible exposures, fix what's safe to fix, flag what needs rotation
argument-hint: [path or scope, optional]
---

# Security: protect the front door

Audit this code for the exposures that actually get you owned, then fix them.
Be a system reviewer, not a linter. Rank by blast radius and reversibility, not count.

## Frame first (≤6 lines, then go)
- What this system is, what data it touches, what it can do.
- The front door: what's reachable by an external/untrusted caller.
- What you can't see from here (no runtime, infra, logs) — name it.

If you can't tell what's externally reachable, say so and ask before guessing.

## Look here, in order
1. **Irreversible** — hardcoded secrets/keys/tokens/connection strings (check git history, not just HEAD); PII/PHI/financial in logs or errors. These need rotation, not just a code change.
2. **Auth at the edge** — missing authn/authz on external routes, IDOR, debug/health endpoints that leak, default creds, weak admin paths.
3. **Untrusted input** — SQLi, command injection, SSRF, path traversal, unsafe deserialization, on anything fed by an external caller.
4. **Exposure** — public buckets/ports, internet-facing admin or debug surfaces, stack traces leaking internals to clients.

Skip supply-chain/CI/IaC depth unless something jumps out — this is the front door, not a full audit.

## Apply fixes
- Fix what closes the exposure with the smallest safe change, in code. Make the edit.
- Do NOT touch anything needing external action (secret rotation, vendor, infra) — flag it instead.
- Don't fix anything you can't defend with evidence. Don't do cosmetic/security-theater changes.

## Output (keep it short — I'll dismiss a wall of text)
**Fixed** — one line each: `file:line — what was exposed → what you changed`.
**Needs you** — exposures you couldn't close in code: what, blast radius, exact external action (rotate this key, etc.).
**Top risk** — the single worst thing here, one sentence.
**Couldn't check** — what and why, if it matters.

Each item carries confidence (verified vs pattern-match) — don't blur the two.
Group findings that share one root cause; one root fix beats ten leaf fixes.

## Stop and ask if
- Regulated data with no declared compliance regime.
- Evidence of an active compromise (live committed secret, backdoor, unexplained admin path).
- Scope is a monorepo / multi-service / multi-cloud sprawl — too big for one pass.
- The real ask is hardening live prod credentials/infra — that's an ops task, say so.
