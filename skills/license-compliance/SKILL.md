---
name: license-compliance
description: >-
  Autonomously audit license compliance across the N most-recently-worked git
  repos under a root — resolve each repo's own license, check SPDX header
  coverage on source, and flag dependency license conflicts (copyleft pulled
  into a permissive project, UNKNOWN/UNLICENSED, custom non-OSI) — one repo per
  iteration, state in a ledger so it survives fresh contexts and resumes cleanly.
  The CROSS-REPO autonomous version of the single-repo harden-licenses skill.
  Fire on "/license-compliance", "license audit across my repos", "pre-OSS
  license check", or a self-paced /loop that wants per-repo license work. Follows
  the autonomous-sweep-core contract: a pre-OSS-launch gate that pairs with
  security-sweep. Reports conflicts, never removes deps or picks a license.
---

# License compliance sweep (ledger-driven /loop)

The cross-repo autonomous sibling of `harden-licenses`. Walks the top-N repos, one per iteration,
and answers three questions per repo: does it declare its own license, are its source files SPDX-
tagged if it's headed for OSS, and does any dependency license conflict with how it's distributed.
**Follows the [autonomous-sweep-core](../autonomous-sweep-core/SKILL.md) contract** — loop shape,
ledger, ranking, resume, and the never-destructive hard rules are inherited from there; this file
is only the detector + fixer. Standing use case: the gate to run before opening a repo to the
public; pair it with `security-sweep`.

## UNIT
One repo per iteration.

## DETECT (read-only, fan out) — the gate
Establish ground truth, then verify each candidate independently. Three checks:

- **(a) Repo's own license.** Resolve from the LICENSE/COPYING text, then reconcile against manifest
  metadata — `package.json` `"license"`, `pyproject.toml`/`Cargo.toml` `license`, `go.mod` (module
  path + any LICENSE). Record *which* license, and note file-vs-manifest disagreement.
- **(b) SPDX header coverage.** `grep -rL 'SPDX-License-Identifier:' <source>` — measure the fraction
  of source files carrying a header. Absence only matters for a repo **intended for OSS**.
- **(c) Dependency license conflicts.** Enumerate direct + transitive dep licenses with the
  ecosystem-native tool — `license-checker` / `npm ls` (Node), `pip-licenses` (Python),
  `go-licenses` (Go) — split **runtime vs dev**, and flag: copyleft (GPL/AGPL/LGPL) pulled into a
  permissive (MIT/Apache/BSD) project, plus **UNKNOWN/UNLICENSED** and custom non-OSI licenses.

**The gate — "actual conflict" is only:** a genuine incompatibility for the repo's *intended
distribution* (a permissive project shipping AGPL/GPL **runtime** code), OR a missing LICENSE on a
repo **clearly meant to be public** (npm-publish metadata or a public git remote). Everything else
is **not** a conflict: a dev-only dependency's license (not distributed), a private/internal repo
with no publish intent, a deliberately unlicensed private project. Anchor on the repo's publish
intent — that is what turns a flag into a finding.

## FIX
- **Adding a LICENSE file or SPDX headers → CONFIRM-tier.** Offer it; do NOT auto-apply — the
  license *choice* is the user's. Present the likely license (inferred from manifest or a sibling
  repo) and let them confirm before writing.
- **Runtime dep license conflicts → REPORT-ONLY.** Never auto-remove, swap, or downgrade a
  dependency. The fixer is the ledger row + a recovery note (which dep, which license, why it
  conflicts, options).
- Distinguish **runtime vs dev** deps in the ledger, and apply the **stricter** rules when the repo
  carries npm-publish metadata or a public git remote.

## SKIP (detector-specific extension of the hard rules)
- **Never remove or replace a dependency** to resolve a license conflict — report only.
- **Never pick a license for the user** without confirmation.
- **Never rewrite an existing LICENSE** — an existing license file is ground truth, not a defect.

## LEDGER COLUMNS
`repo-license | spdx-coverage | dep-conflicts | unknown-licenses | publish-intent | note`

## Domain-lessons
- **A dev-only GPL tool is generally fine.** A GPL/AGPL build, test, or lint dependency isn't
  distributed, so it doesn't taint a permissive project — don't flag it like a shipped AGPL runtime
  dep. The runtime-vs-dev split is load-bearing; get it right before you raise a conflict.
- **UNKNOWN is worse than a known-incompatible license.** A GPL dep is a decision you can reason
  about; an UNKNOWN/UNLICENSED dep is one you *can't* — you don't even know the terms. Rank UNKNOWN
  above a clear copyleft conflict.
- **No publish path → don't nag about a missing LICENSE.** A repo with `"private": true`, no public
  remote, and no publish metadata is deliberately unlicensed; log it "no publish intent" and move on.
- **The license choice belongs to the user.** Offer a LICENSE or SPDX headers, infer the likely
  pick, but never impose one — writing a license the user didn't choose is a false positive that
  mutates intent.
- **File and manifest can disagree.** An MIT LICENSE with `"license": "Apache-2.0"` in the manifest
  is a real finding — surface the mismatch; don't silently trust either side.
