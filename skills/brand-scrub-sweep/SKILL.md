---
name: brand-scrub-sweep
description: >-
  Cross-repo detector for ACCIDENTAL real-entity leaks in docs and text — a real
  organization name appearing where only a codename or a fictional stand-in belongs.
  Greps tracked docs/text for real-name match patterns loaded at runtime from a
  gitignored local file, verifies intent before flagging, scrubs only unintentional
  leaks in living docs, flags code-level leaks without editing. One repo per
  iteration, state in a ledger that survives fresh contexts and resumes cleanly.
  Fire on "/brand-scrub-sweep", "scan my repos for accidental client/brand leaks",
  "check for real-entity leaks before publishing", or a self-paced /loop that wants
  per-repo brand-leak triage. Follows the autonomous-sweep-core contract.
---

# Brand-scrub sweep (accidental real-entity leaks, ledger-driven /loop)

Thin detector on top of **autonomous-sweep-core** — that file owns the loop shape, ledger
mechanics, repo ranking, resume, fan-out, and the never-destructive hard rules. This file only
defines the brand-leak detector. Read the core first; do not restate it.

Two distinct protections share this mechanic, and they need different fixes — which is why the
sweep distinguishes them:

- **Codename-only work.** Some engagements may be referred to ONLY by a codename; the real
  entity name must never appear. The real name behind the codename is the leak. The correct
  replacement is that engagement's **codename**.
- **Deliberately vendor-neutral work.** Some repos are first-party product work that is kept
  vendor-neutral by construction — the organizations and data in them are fictional so the
  product could land in any customer's inventory. A REAL organization name appearing there is a
  leak of that discipline, not of anyone's identity. The correct replacement is a **fictional or
  generic stand-in**, not a codename.

This skill NEVER hardcodes, looks up, or writes a real entity name, a codename, or the
correspondence between them.

## Pattern source (load at runtime — never bake real names in)
- **Patterns:** load `~/.claude/brand-scrub-patterns.txt` — one entry per line, the real-name
  match patterns the user maintains and, where a codename is the correct replacement, the
  codename that pattern maps to. This file is **gitignored and never committed**; if absent,
  say so and run generics-only. The skill file itself contains none of these strings, and
  neither the real names nor the codenames nor which repos they belong to are recorded here.
- **Generic patterns (safe to hardcode):** common organization-name suffixes — `\b(Inc|LLC|Ltd|
  PLC|GmbH|N\.?V\.?|Corp|Corporation|Holdings|Group)\b` adjacent to a capitalized multi-word
  token. These describe a *class*, not a named entity, so they live here safely and catch leaks
  even when the runtime pattern file is thin. Expect noise; the intent gate below is what makes
  them usable.

## UNIT
One repo per iteration (the core default).

## DETECT (read-only gate — fan out one verifier per candidate)
Scan **tracked docs/text ONLY**, never source logic:
`git ls-files '*.md' '*.mdx' '*.txt' '*.rst'` plus comment/prose blocks in those docs. Grep each
against the loaded patterns (runtime file + generics). Every candidate then passes an **intent
gate** before it earns a ledger row — "accidental leak" is the whole point:
- **NOT a leak (leave):** (i) the real name is a **deliberate feature** — e.g. a brand-toggle
  config/fixture where the real name is intentional and load-bearing; (ii) it sits in a
  **decision-log / changelog that documents the name's removal** — scrubbing would corrupt
  accurate point-in-time history; (iii) it's **already the codename or stand-in**.
- **Leak (route to fix):** an unintentional real-name occurrence in a **living doc**.

Fan out one verifier per candidate; each returns `file:line`, an intent verdict with evidence,
and what the name should become. Inject the codename mapping as an anchor but have agents verify
intent independently, not trust it.

## FIX
- **SAFE tier (with confirmation):** replace the real name with its **codename or stand-in** in
  **living docs only**. When the right replacement is a judgment call (a specific codename vs a
  generic term like "the client"), make the **SAFE choice** and **SURFACE it to the user** —
  don't guess silently.
- **Code-level leaks are FLAGGED, never edited** — a real name in source, identifiers, or test
  fixtures is reported for the user to handle. A doc/brand pass never touches code.

## SKIP (detector-specific extension of the core hard rules)
- **Never edit code** — flag code leaks, don't scrub them.
- **Never scrub a deliberate brand-toggle feature** (the real name is the point there).
- **Never rewrite a decision-log/changelog that documents the name's removal** — point-in-time.
- **Never scrub data corpora / synthetic fixtures** — that's DATA, not living docs.
- **Never hardcode or record a real name** in the skill OR the ledger (see masking below).

## LEDGER-MASKING (mirror security-sweep — this is load-bearing)
The ledger + detail log live at a checked-in path under `docs/autonomous-sweeps/` — writing a raw
real name there just **relocates the leak into a committed doc**. Record `file:line` + a **masked
fingerprint** (first 2 + last 2 chars, middle redacted) OR the **replacement it should become** —
NEVER the raw hit. The same rule binds any agent verdict and any note.

## LEDGER COLUMNS
`doc-leaks | code-leaks-flagged | scrubbed | intentional-skipped | note`

## Domain lessons
- **Intent first.** A brand-toggle feature and a "we removed X" decision-log are NOT leaks —
  scrubbing them breaks accurate docs. `autonomous-doc-refresh` learned this the hard way; its
  brand caveat is why this gate exists. Verify intent before you touch anything.
- **Don't relocate the leak.** Ledger-mask every hit — `file:line` + fingerprint or replacement,
  never the raw name. A leak paraphrased into a checked-in ledger is still a leak.
- **A doc pass never edits code.** Code-level real-name leaks (source, identifiers, fixtures) are
  FLAGGED for the user, never auto-scrubbed — wrong altitude, wrong blast radius.
- **The real-name patterns live outside the repo of record.** They belong in the gitignored
  `~/.claude/brand-scrub-patterns.txt` — never in this committed skill, which resolves them only
  at runtime.
- **This file names nothing, and that is deliberate.** This skill is itself checked into a public
  repo, so it carries no entity name, no codename, no product name, and no mapping between them.
  Resolve all of that from the runtime pattern file; if it is missing, run generics-only rather
  than guessing from memory.
