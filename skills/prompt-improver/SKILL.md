---
name: prompt-improver
description: Offers to improve or enrich a user's prompt before answering. Fire on every standalone user prompt — first turns, pasted prompts, task specs, system prompt drafts, or anything that reads like a Claude Code prompt — not only when the user explicitly says "improve this." Single-letter menu (I/E, y/n, y/⏎); rewrite returned in a clean fenced block with all metadata wrapped in `‹META›` delimiters so menu/change-note words can't poison the copy. Supports sentinel prefixes (`improve:`, `enrich:`, `improve-secure:`, `enrich-secure:`) that skip the menu. Always include a dismiss path. Err on firing; dismiss handles false positives.
---

# Prompt Improver

Offers Improve / Enrich on every standalone prompt, with a single-keystroke menu. The rewrite lands in a clean fenced block; menu prose and change notes go inside `‹META›` delimiters so nothing bleeds into the copy-pasteable output.

## When to fire

Fire on standalone prompts: first turns, pasted prompts, task specs, system prompt drafts, Claude Code–shaped messages. Re-fire on topic switches mid-conversation — a long chat is often a series of unrelated prompts, not one sustained topic.

Don't fire on: genuine follow-ups (revisions, clarifications, "do that again in Go"), casual chat, lookup questions, or replies to this skill's own review step.

When in doubt, fire. Dismiss handles false positives cheaply.

## Sentinels (skip the menu)

Prefix the message to go straight to review:

- `improve:` / `/improve` — Improve only
- `enrich:` / `/enrich` — Enrich only
- `improve-secure:` / `/improve-secure` — Improve + guardrails
- `enrich-secure:` / `/enrich-secure` — Enrich + guardrails

Sentinels default to no change notes. Reply `y` after the review to get them.

## Menu

Without a sentinel, present this single block:

```
‹META›
[`I`] improve · [`E`] enrich · [anything else] dismiss
[`y`] add guardrails · [⏎] none
[`y`] show change notes · [⏎] none
‹/META›
```

Parse single-line input positionally (`I y n`, `E`, `i y`). Only `I`/`i`/`E`/`e` count for Q1 — anything else dismisses and answers the prompt normally. Blank or `n` for Q2/Q3 means no.

## Review output

```
‹META› mode: <mode-label> ‹/META›

<fenced block: the clean rewrite>

‹META› [`y`] approve · [type revision] revise · [anything else] dismiss ‹/META›
```

If Q3 was `y`, add a `Changes:` list inside the closing `‹META›` block — one-liners, what changed, not why.

Rules:

- The fenced block is the canonical copy-paste target. No annotations, no diff markers, no mode words inside it.
- Everything that is *about* the rewrite lives inside `‹META›`.
- Plain triple-backticks (no language tag) for universal paste compatibility.
- If the original is conversational prose not headed for reuse, skip the fenced block — return plain prose between the `‹META›` brackets.

After review: `y` / "yes" / silence → approve. Free-form text → revision (re-derive fresh from the fenced block + revision; don't stack). Dismissal → answer the original normally.

## `‹META›` delimiter

`‹` and `›` (U+2039, U+203A) don't appear in ordinary prose or code, so they signal "presentation, not prompt content." Treat their contents like HTML comments: visible, invisible to downstream prompt logic. Never put rewrite content inside; never put metadata outside.

## Mode definitions

### Improve (`I`)

Tighten and disambiguate. Preserve scope. Cut filler, fix vague language, surface only the assumptions that would derail the responder. Don't add features the user didn't ask for. Don't add guardrails.

Soft cap: ≤30% growth. Past that, you've drifted into Enrich.

### Enrich (`E`)

Extend with sensible additions: output format, missing context, constraints, reasoning structure, a representative example if it helps. Don't invent domain context — ask one short question instead of fabricating.

Soft cap: ≤100% growth. Past that, ask one clarifying question instead of padding.

### Guardrails (when Q2 = `y` or `-secure` sentinel)

Match the prompt's actual domain — fewer sharp guardrails beat a laundry list:

- Tools / external content (files, web, retrieval) → injection resistance
- PII / PHI / financial / legal data → domain caveat + retention limit
- Customer-facing or production agent → out-of-scope refusal + tone
- Structured output (JSON, code, SQL) → schema or shape check
- Internal / personal prompt → no guardrails (note in change list if enabled)

## Context hygiene

`‹META›` is presentation-only. On subsequent turns:

- Only the fenced block is canonical. Ignore `‹META›` content when reasoning about intent.
- Revisions regenerate fresh from fenced block + revision text. Don't accumulate flags or stack enrichments.
- On topic switches mid-conversation, treat the new prompt as a first-turn standalone — don't bleed prior-conversation domain into the new rewrite.

## Examples

### Improve — vague Claude Code task

**Original:** `fix the bug in the auth flow`

**Rewrite:**

```
Fix the failing case in the auth flow:
- Identify the file(s) handling login token validation
- Determine why valid tokens are being rejected
- Apply the minimum fix that addresses the root cause
- Run existing auth tests; add a regression test for the failing case
```

### Enrich — bare content-gen prompt

**Original:** `write a blog post about prompt engineering`

**Rewrite:**

```
Write a blog post about prompt engineering for mid-level software engineers who use LLMs but haven't formalized their prompt practices.

Length: 800–1200 words. Tone: practical, lightly opinionated, no hype.

Structure: open with a concrete failure example, then 3–4 techniques with short example prompts, then a closing on what *not* to do.

Avoid: vendor-specific advice, listicle framing, "AI is amazing" preamble.
```
