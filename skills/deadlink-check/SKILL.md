---
name: deadlink-check
description: >-
  Sweep tracked markdown across the N most-recently-worked git repos for BROKEN
  links — dead in-doc anchors, relative file/image paths that point at nothing on
  disk, and external URLs returning hard 4xx/410/dead-host — one repo per iteration,
  state in a ledger so it survives fresh contexts and resumes cleanly. The natural
  sibling to autonomous-doc-refresh: docs can be factually FRESH yet link-ROTTED, and
  this closes that gap. Fire on "/deadlink-check", "find broken links in my docs",
  "check for dead links across repos", or a self-paced /loop that wants per-repo
  link-rot triage. Repairs unambiguous internal targets in place, flags dead external
  URLs (never invents a replacement), never commits/pushes/merges. Follows the
  autonomous-sweep-core contract.
---

# Dead-link check (ledger-driven /loop)

Follows **autonomous-sweep-core** for the loop shape, ledger contract, repo ranking, the
detect-before-act gate, resume, and the never-destructive rules. This file is only the detector.
autonomous-doc-refresh keeps a doc's *claims* true; this keeps its *links* live — a doc can pass
that sweep and still be riddled with rotted links.

## UNIT
One repo per iteration. Within it, the unit's files are all tracked markdown:
`git ls-files '*.md' '*.mdx'`. Exclude data corpora, vendored fixture apps, and `node_modules`
per the core — synthetic/reference `.md` corpora are DATA, never link-checked.

## DETECT (read-only — three link classes)
Extract every link, classify, and prove each is *actually* broken before touching it:
- **(a) IN-DOC ANCHORS** — `[text](#slug)`. Broken iff `#slug` matches no heading in the SAME
  file, where the heading's slug is computed the GitHub way (see lessons). An anchor into another
  file that exists is NOT this class.
- **(b) RELATIVE FILE LINKS** — `[text](./x)` / `[text](../x)` and images `![](x)`. Broken iff
  the resolved path does not exist on disk. Resolve relative to the doc's own directory; strip any
  `#anchor`/`?query` suffix before the disk check.
- **(c) EXTERNAL URLS** — `http(s)://…`. Check reachability with a HEAD (fall back to GET) via
  WebFetch or `curl -sI`. Broken iff a hard 4xx / 410 / dead host (NXDOMAIN, refused). Tolerate
  transients: retry once; if still unreachable (timeout, DNS blip), mark **unverified**, not dead.

**The gate — "actually broken":** anchor with no matching heading in-file · relative path with no
file on disk · external URL returning a hard 4xx/410/dead-host. **NOT broken:** a live redirect
(3xx→200) · a 429 or timeout (→ unverified) · an anchor into a file that DOES exist · a
`mailto:` / `tel:` link. Fan out one verifier per doc; each returns per-link verdicts with
`file:line`, the link, its class, and the resolved target/status code.

## FIX
- **(a) internal anchors + (b) relative paths → REPAIR IN PLACE** — deterministically, and ONLY
  when there is an unambiguous correct target: a heading was renamed (exactly one heading now
  slugs close to the dead anchor), or a file moved to one obvious new path. If more than one
  plausible target exists, **flag — do not guess.**
- **(c) external dead URLs → FLAG ONLY.** Never fabricate a replacement URL.
- Change only the link syntax; preserve surrounding prose and the doc's voice byte-for-byte.

## SKIP
- Never rewrite an external URL to a guessed replacement — dead external = flag, full stop.
- Never touch links in a historical / point-in-time doc: a changelog or release note pointing at
  an old release/tag is CORRECT, not rot (core's point-in-time rule).
- Never edit code — only markdown link syntax. A broken link inside a fenced code sample is an
  example, not a live link; leave it.

## LEDGER COLUMNS
`dead-anchors | dead-relpaths | dead-urls | fixed | flagged | note`

## Domain-lessons
- A **429 or timeout is "unverified," not "dead"** — never delete a live link over rate-limiting or
  a transient blip. Retry once, then mark unverified and move on; the link is probably fine.
- **Compute GitHub heading slugs the way GitHub does** or you false-positive every anchor: lowercase,
  drop punctuation, collapse spaces→hyphens, dedupe repeats with `-1`/`-2`. A hand-rolled slugger
  that keeps punctuation or case will flag anchors that actually resolve.
- A relative link that resolves **only under a different case** (`./API.md` vs `./api.md`) works on
  the user's macOS but breaks on case-sensitive Linux CI — flag it even though it "works here."
- **Never "fix" a historical doc's intentionally-old link** — the target moving is the whole point
  of a point-in-time reference; repairing it rewrites history.
- Strip `#anchor` and `?query` before the on-disk existence check, and treat a bare `#slug` (empty
  path) as an in-doc anchor, not a relative path — or you mis-class and false-positive both.
