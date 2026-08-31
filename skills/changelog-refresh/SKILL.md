---
name: changelog-refresh
description: >-
  Sweep the N most-recently-worked git repos under a root for MISSING or STALE
  changelogs — generate a Keep-a-Changelog CHANGELOG.md where a release-bearing
  repo has none, and APPEND the new version section(s) where tags/commits postdate
  the last documented entry — one repo per iteration, state in a ledger so it
  survives fresh contexts and resumes cleanly. Extends the single-repo
  generate-build-report skill into a cross-repo sweep. Fire on
  "/changelog-refresh", "generate/update changelogs across my repos", "which repos
  are missing a CHANGELOG", or a self-paced /loop that wants per-repo changelog
  work. Follows the autonomous-sweep-core contract.
---

# Changelog refresh (ledger-driven cross-repo sweep)

Thin detector on top of **autonomous-sweep-core** — that file owns the loop, ledger, repo
ranking, resume/idempotency, disjoint-file fan-out, and the never-commit/push/merge and
detect-before-act hard rules. This file defines only the changelog detector + fixer. The
single-repo ancestor is `generate-build-report` (reconstruct-then-write); this sweeps it wide.

## UNIT
One repo per iteration (the core default).

## DETECT (read-only gate)
Establish ground truth for the repo, then decide missing / stale / current:
- **(a) Present?** Is there a `CHANGELOG.md` / `HISTORY.md` / `RELEASES.md` (case-insensitive,
  repo root or `docs/`)? `git ls-files | grep -iE 'change ?log|history|releases'`.
- **(b) Stale?** Parse the latest documented entry's version + date. Compare against
  `git tag --sort=-creatordate` and `git log <last-entry-point>..HEAD --oneline`. STALE when a
  tag exists that the changelog never mentions, OR a body of commits lands after the last
  documented entry.
- **(c) Warranted?** A repo warrants a changelog if it has tags/releases OR a publish path
  (npm/PyPI, `publishConfig`, a public git remote, a release workflow). A throwaway/experiment/
  scratch repo does not.

**The gate — "missing or stale":** no changelog on a release-bearing repo, OR tags/commits that
postdate the last changelog entry. **NOT actionable:** an experiment/scratch repo with zero
releases and no publish intent (flag, don't force); a changelog already current to the latest tag
(log `current`).

## FIX (generate or APPEND — never rewrite)
- **Missing** → synthesize a Keep-a-Changelog-style `CHANGELOG.md` from `git tag` + `git log`.
  Group commits by the tag that contains them (`git log <prev-tag>..<tag>`); conventional-commit
  aware — `feat:`→Added, `fix:`→Fixed, `refactor:`/`perf:`/breaking→Changed, `deprecate`→Deprecated,
  `remove`→Removed. Untagged commits ahead of the last tag go under `[Unreleased]`.
- **Stale** → **APPEND only** the new version section(s) since the last documented entry. NEVER
  rewrite, reword, or reorder existing entries — they are point-in-time/historical per the core;
  drift there is not a defect. Match the existing file's heading style, date format, and section
  vocabulary rather than imposing Keep-a-Changelog on a file that doesn't use it.

## SKIP (detector-specific hard rules — extend, don't weaken, the core's)
- Never rewrite/reword/reorder existing changelog entries — **append-only**.
- Never invent a version or date not backed by a real tag or commit.
- Never create a git tag, cut a release, or bump a manifest version.
- Never treat a changelog as "stale docs to correct to current state" — it is historical by
  nature (this is the exact trap `autonomous-doc-refresh` flags changelogs under as point-in-time).
- Don't force a changelog onto a repo with no tags and no publish intent — flag it and move on.

## LEDGER COLUMNS
`has-changelog | latest-entry-vs-latest-tag | action(generated/appended/current) | versions-added | note`

## Domain-lessons
- A CHANGELOG is **point-in-time**: you APPEND, you never rewrite history. This is precisely the
  case `autonomous-doc-refresh` leaves untouched — here it is the whole job, so the append boundary
  is load-bearing, not a nicety.
- **Every version and date must trace to a real tag or commit.** Fabricating a `1.4.0 — 2026-03-01`
  because it "looks due" is the worst failure mode — it publishes a lie into a public artifact.
- A repo with **zero tags and no publish path doesn't need a changelog.** Flag it; forcing one on a
  scratch experiment is noise.
- **Conventional-commit prefixes give you free section grouping**; a repo without them still gets an
  honest flat "what changed since `<tag>`" list — bullet the commit subjects, don't fabricate
  categories you can't back.
- **Preserve the existing file's style.** A hand-curated changelog with prose entries and no
  `[x.y.z]` headers gets new sections in *its* voice — matching format beats being "correct."
