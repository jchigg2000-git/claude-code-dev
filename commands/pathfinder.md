---
description: Read-only repo crawl that surfaces a ranked set of feature ideas worth adding — product surface map, prior-art scan, dependency capability audit, friction signal scan, primitive reuse search, roadmap gap analysis. Every candidate is cited (file:line, dep name, or comparable tool); no vibes-based suggestions. Fans out parallel subagents for independent investigations. Never edits. Fire on `/pathfinder` or "find feature ideas for this repo."
allowed-tools: Bash(git:*), Bash(rg:*), Bash(find:*), Bash(wc:*), Bash(stat:*), Bash(jq:*), Read, Glob, Grep, WebFetch, WebSearch
---

Crawl this repo to surface a ranked set of feature ideas worth adding. Read-only — do not modify any files.

Scope: the current working directory only (not sibling repos or parent directories). Goal is feature discovery, not bug-fixing or cleanup — those belong to other commands.

Delegate across parallel subagents where the investigations are independent (product surface map, domain/competitor scan, dependency capability audit, friction signal scan, roadmap gap analysis, primitive reuse search). Each subagent reports a synthesized conclusion, not raw output.

Investigate:
- Product surface map: what does this repo actually do today? Enumerate user-facing entry points (CLI commands, HTTP routes, UI screens, public API, exported library functions). For each, note the obvious adjacent capability that is conspicuously missing.
- Domain / prior art: identify the problem domain from README, package metadata, and code. Name 2–4 comparable tools or standards in that space and list capabilities they offer that this repo does not. Cite the comparable tool by name; do not fabricate features.
- Dependency capability audit: list direct dependencies and flag any whose capabilities are under-utilized — i.e., the repo pulls them in but only uses a thin slice. Each represents a low-cost feature surface.
- Friction signals: scan for evidence of unmet user need — TODO/FIXME notes describing missing features (not bugs), comments like "would be nice", "later", "v2", open issues referenced in code, error messages that hint at unimplemented paths, config flags that are declared but unused.
- Primitive reuse opportunities: find internal abstractions (classes, modules, services) that are used in only one place but were clearly designed to generalize. Each is a candidate for a second use case.
- Roadmap gap analysis: read ROADMAP.md, TODO.md, CHANGELOG.md, docs/, planning directories (e.g., .claude/plans/, .notes/). Distinguish "already planned" from "obvious gap nobody has written down yet." Focus the report on the latter.
- Cross-cutting opportunities: observability, accessibility, performance, extensibility (plugin hooks, config surface), integration surface (webhooks, exports, imports). Note any that are weak or absent relative to the repo's apparent maturity.

Evidence rules:
- Cite file:line for every claim about the current state of the code.
- For each proposed feature, name the specific signal that prompted it (a missing route, an unused dep capability, a comparable tool's feature, etc.). No vibes-based suggestions.
- Distinguish "extends existing primitive" (cheap) from "new primitive required" (expensive) for each idea.

Report format (markdown, terse):

## 1. What this repo does today
2–4 sentence synthesis of the product surface. One paragraph, no bullets. This frames every recommendation below.

## 2. Feature candidates
Ranked list, highest-leverage first. For each:
- **Name** — one-line description
- **Signal:** the specific evidence (file:line, dep name, comparable tool, etc.)
- **Cost:** extends existing primitive / new primitive / cross-cutting infra
- **Why now:** one sentence on why this is non-obvious or under-served

Aim for 5–10 candidates. Quality over quantity — drop anything you can't cite.

## 3. Top recommendation
The single feature you would build next, with reasoning that references the ranking criteria (leverage, cost, signal strength). Include the first concrete step (file to create, primitive to extend, prototype to spike).

## 4. Explicitly out of scope
Ideas you considered and rejected, with one-line reasons (already planned, too speculative, requires domain knowledge you don't have, etc.). This is as important as the recommendations — it prevents re-litigating the same ideas next session.

If you skipped any investigation area (e.g., no dependency manifest, no public API surface, comparable-tools search not feasible without web access), list it under a final "## Skipped / couldn't verify" section. Don't pad missing sections.
