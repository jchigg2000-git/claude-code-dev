---
name: security-sweep
description: >-
  Autonomous cross-repo secrets + dependency-vulnerability sweep across the N
  most-recently-worked git repos under a root, one repo per iteration, state in a
  ledger that survives fresh contexts and resumes cleanly. The CROSS-REPO
  autonomous version of the single-repo harden-secrets / harden-deps skills. Fire
  on "/security-sweep", "scan my repos for secrets/vulns", "pre-OSS security
  pass / pre-open-source gate", or a self-paced /loop that wants per-repo security
  work. Follows the autonomous-sweep-core contract: read-only detect gate, act only
  on real exposures, never rotate/rewrite-history/upgrade, never commit/push/merge.
---

# Security sweep (secrets + dep vulns, ledger-driven /loop)

Thin detector on top of **autonomous-sweep-core** — that file owns the loop shape, ledger
mechanics, repo ranking, resume, fan-out, and the never-destructive hard rules. This file only
defines the secrets + dependency-vulnerability detector. Read the core first; do not restate it.

Treat every run as a **pre-open-source gate** — a live secret reachable in git history is the
launch-blocking finding, not a nice-to-have.

## UNIT
One repo per iteration (the core default).

## DETECT (read-only gate — fan out one verifier per candidate)
Nothing is flagged until it survives the gate below. Scan three surfaces:

**(a) Secrets — working tree AND git history.** High-signal regexes: AWS `AKIA[0-9A-Z]{16}`,
Google `AIza[0-9A-Za-z_\-]{35}`, OpenAI/Anthropic `sk-`/`sk-ant-` keys, GitHub `ghp_`/`gho_`,
private-key headers `-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----`, Slack `xox[baprs]-`, and
generic `(password|secret|token|api[_-]?key)\s*[:=]\s*` **only when paired with a high-entropy
value**. Also flag committed `.env` / `.pem` / `credentials` files. History: for each worst
offender, `git log -p -S<token>` and `git grep <regex> $(git rev-list --all)` to prove whether the
value is still reachable from any commit.

**(b) `.gitignore` coverage** for `.env`, `*.pem`, and credential paths — a gap is a future leak.

**(c) Dependency vulns — ecosystem-native only:** `npm audit --json` (Node),
`pip-audit` / `safety` (Python), `govulncheck ./...` (Go), `bundler-audit` (Ruby). Count crit/high.

**The gate — "actually exposed":** flag ONLY a real live-looking credential or a confirmed
advisory. A candidate is NOT exposed if it is a placeholder/example (`your-api-key-here`,
`sk-xxxx`, obvious fakes in docs/tests/`.env.example`), or a dev-only dependency whose vuln is not
reachable in the shipped artifact. Verify every candidate before it earns a ledger row.

## FIX (read-only by default)
Findings go to the ledger by severity — that is the default output. The ONLY auto-safe action (a
`--fix` / "safe tier", and only **with confirmation**) is: add missing entries to `.gitignore`,
and `git rm --cached` a tracked file that should be ignored. Everything else is report-only.
- **NEVER** rotate/regenerate a credential, **NEVER** rewrite git history, **NEVER** run
  `npm audit fix` unattended (breaking changes).
- A committed **live** secret is **CRITICAL**, and its note MUST say: *"rotate the credential —
  code change alone is insufficient."*

## SKIP (detector-specific extension of the core hard rules)
- Never rotate/regenerate any credential.
- Never `git filter-branch` / `git-filter-repo` history rewrites automatically.
- Never modify app code or upgrade/pin a dependency automatically.
- Never exfiltrate a found secret into the ledger verbatim — record `file:line` + a masked
  fingerprint (first 4 + last 4, middle redacted), never the raw value.

## LEDGER COLUMNS
`secrets-tree | secrets-history | gitignore-gaps | dep-vulns(crit/high) | worst-severity | note`

## Domain lessons
- **Mask, never paste.** The ledger and detail log record `file:line` + a masked fingerprint;
  writing the raw value just relocates the leak into a checked-in doc.
- **History ≠ tree.** A secret found only in git history is NOT fixed by deleting it from the
  working tree — it stays reachable from old commits. Flag it for history-rewrite **plus**
  rotation; don't mark it resolved because HEAD is clean.
- **Placeholder keys are the #1 false positive.** `sk-xxxx`, `your-token-here`, and fixture keys
  in README/tests/`.env.example` look exactly like the real thing to a regex — gate them out
  before flagging, or the sweep cries wolf and gets ignored.
- **Runtime CVE > dev-dep CVE.** A vuln in a dependency that never ships in the built artifact
  (test/build tooling) is real but lower priority than a runtime-dependency CVE reachable in prod;
  rank the ledger accordingly so the launch-blockers surface first.
