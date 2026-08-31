---
description: Write a dated, standalone session handoff document. FIRES ONLY WHEN EXPLICITLY INVOKED as /handoff-to-next — never proactively, never inferred from "wrap up", "I'm done", "clean the context", or the end of a long session. Complements /roadmap rather than replacing it: the roadmap holds the open set, this holds the session narrative.
argument-hint: "[optional: a note about what this session was, or a target path]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Handoff to next

Write **one dated handoff document** capturing where this session ended, for a reader with no
context and no transcript.

## When this fires

**Only when the user types `/handoff-to-next`.** That is the whole trigger.

Do **not** fire it because a session is ending, because the user said "wrap up," "I'm done," "clean
this context," "summarize," or because a long thread looks like it wants closing. Those are not
invocations. If you think a handoff would help and the user has not asked, say so in one line and
carry on — do not write the document.

## Relationship to `/roadmap` — they do different jobs

| | `ROADMAP.md` §0 | this document |
| --- | --- | --- |
| Holds | the **open set** — what is still to do | the **session narrative** — what happened and why |
| Lifetime | living; closure is deletion | immutable once written; dated |
| Overwritten | yes, refreshed each time | **never** — a new date is a new file |

If `ROADMAP.md` exists, **refresh its §0 resume block too** so the two do not disagree, and have the
handoff link to the roadmap rather than duplicating its open items. If it does not exist, do not
create one — that is `/roadmap`'s job, not this one.

## Where it goes

`docs/handoffs/YYYY-MM-DD-<slug>.md`, creating the folder if needed. Never `HANDOFF.md`, never
`docs/handoff.md` — a single mutable file loses the trail, which is why those names were retired.

If the repo already has a conventional location for session notes, use that instead and say so.

## What it must contain

Every claim carries a citation — a `file:line`, a command and its output, a commit SHA, or a
statement id. A handoff that cannot be checked is worse than none.

```markdown
# Handoff — YYYY-MM-DD · <what this session was>

## State
Branch, clean/dirty, last commit SHA, what is deployed, what tests were run and their result.
Cite each one. "Unverified" is said out loud, never rounded up to done.

## What shipped
What actually landed, with SHAs or paths. Not what was attempted.

## What I found by reading that nobody reported
The discoveries that were incidental to the task and would be expensive to rediscover.

## What I deliberately did NOT do, and why
Scope consciously left alone. This is the section that stops the next session redoing a decision.

## Corrections made this session
Anything asserted and then withdrawn, with the correct value. Prevents a future session citing the
withdrawn version out of the transcript.

## Traps — do not re-learn these
Concrete, checkable, one line each.

## Open threads
Ranked, each with a next action and a cost. If ROADMAP.md exists, link to it instead of restating.

## Questions for the owner
Each answerable in one line.
```

## Rules

- **Never invent state.** Run `git status`, `git log -1`, and the repo's check command; report what
  they actually return.
- **Never overwrite an existing handoff.** Same date, different session → append `-2` to the slug.
- **Do not commit, push, or merge.** Writing the file is the whole job.
- **Carry naming and redaction rules forward.** If the repo anonymises identities, the handoff
  anonymises them too, and it says which artifacts are exceptions.
- Length follows the session. A one-hour session gets a short page; a long investigation gets what it
  needs. Do not pad the template's sections when there is nothing in them — delete the empty ones.
