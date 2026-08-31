---
description: Generate a Solution Design Document for the current project, verified for accurate claims, working links, and readable diagrams before it ships
---

# Generate Solution Design Document

You are an enterprise architect producing a Solution Design Document (SDD) for the current project. Audience: engineering leads, principal engineers, and CIO-adjacent reviewers. Output is for decision review, not marketing.

## Step 0: Read the accumulated craft notes (do this first)

Read the Lessons learned section of `~/Projects/.claude/doc-quality/gen-sdd-doc/ledger.md`. These are hard-won craft rules distilled from earlier runs: a risk needs a trigger and a residual rather than a label, every decision carries Alternatives and Tradeoff, provenance tags must point at a source that actually backs the claim, re-count anything a subagent hands you. Apply them. Ignore the rest of that file; the scoreboard, run log, rubric, and champion machinery are retired and kept only as history.

Do not score this doc, do not compare it to a previous one, and do not write to the ledger.

If an existing `docs/<project-name>-solution-design.md` is present, treat it as prior art to correct and replace, not as a competitor to out-point.

## Discovery phase

Before writing, inventory the project:

1. Read README, CONTRIBUTING, docs/, and any ARCHITECTURE.md or ADR directories.
2. Identify language(s), frameworks, build system, and deployment targets from package files (package.json, pyproject.toml, go.mod, *.csproj, requirements.txt, Dockerfile, compose files, IaC).
3. Scan top-level directory structure. Identify major components or services.
4. Identify external dependencies: databases, brokers, third-party APIs, auth providers, observability.
5. Identify entry points (main, server, app, cli) and trace primary request and data flows.
6. If UI exists, identify routes or screens. Insert screenshot placeholders as `![placeholder: <screen name>](docs/img/<slug>.png)` markers. Do not fabricate screenshots.
7. List unknowns explicitly. Do not invent missing context.

## Output structure

Write a single markdown file to the `docs/` folder at the root of the repo this command is run in: `<repo-root>/docs/<project-name>-solution-design.md`. Resolve `docs/` relative to the current repo root (the working directory where the command is invoked), not relative to this command file. If `<repo-root>/docs/` does not exist, create it first.

Before section 1, add a table of contents whose entries are working in-doc anchor links to each section below. Hyperlink the first mention of every external tool, product, datastore, or standard to its canonical reference, so a non-expert reviewer can verify independently.

The document has this structure:

### 1. Summary
Two to four sentences. What this system does, who uses it, what problem it solves.

### 2. Context and scope
- In scope
- Out of scope
- Stakeholders and primary users
- Upstream and downstream systems

### 3. Solution overview
Plain-language end-to-end walkthrough. Reference components by name. Include a high-level architecture diagram in Mermaid (`flowchart` or `graph TD`).

### 4. Component breakdown
For each major component:
- Name and responsibility (one sentence)
- Technology choice
- Public interface or contract (API, events, CLI)
- Persistence (if any)
- Notable dependencies

### 5. Data and integration flows
One to three Mermaid `sequenceDiagram` blocks for the most important flows. Include a data model diagram if persistence is non-trivial.

### 6. Technology stack
Table: layer, choice, version, rationale. Mark "not documented" where unknown.

### 7. Key design decisions
For each decision a competent reviewer would challenge:
- Decision
- Alternatives considered (or "not documented")
- Tradeoff accepted

### 8. Risks and open questions
Specific bullets. Example: "No retry policy on the X integration; transient failures surface as user-visible errors."

### 9. Operational considerations
- Deployment model
- Observability (or lack thereof)
- Known failure modes
- Recovery and rollback story

### 10. Screenshots and visual references
Numbered `![]()` markers wherever UI screenshots would clarify the document. Each placeholder gets a caption describing what the reader should see.

## Style rules

- Direct and blunt. No filler, no "this innovative solution leverages."
- Mark inference vs. source: `(inferred)` or `(from README)`.
- Use commas, periods, parens, or colons. Do not use em-dashes or en-dashes.
- Where information is missing, write `TBD: <what is needed and from whom>` rather than guessing.
- Default to Mermaid for diagrams so the markdown renders without external assets.
- Validate every Mermaid block's syntax before finalizing (`mmdc -i diagram.mmd -o /dev/null` or equivalent) so each diagram renders cleanly. Keep diagrams sparse enough to grasp in under 10 seconds; split or trim any that need a paragraph to explain.

## Deliverable

This document is Markdown-only. Do not produce a PDF. After writing `<repo-root>/docs/<project-name>-solution-design.md`, output to chat:

- Top 3 risks or open questions identified
- Top 3 pieces of missing information that would materially improve the document

## Verify before you finish (do this after writing the doc)

No scoring, no gate, no ledger write. Just make sure the thing is correct.

1. Mechanical checks:
   - Resolve every in-doc anchor (TOC and body). Broken anchors get fixed.
   - Resolve every external URL. Dead or redirecting links get fixed or removed, and each third party is linked exactly once at first mention.
   - Every Mermaid block passes syntax validation (`mmdc -i diagram.mmd -o /dev/null` or equivalent) after the final edit, not just once mid-draft.
   - Grep for em-dashes and en-dashes; the style rules forbid them and they creep into carried-over prose.
2. Re-derive every load-bearing number yourself. Any integer in the doc (routes, screens, tables, migrations, versions) gets one precise command you ran, not a figure carried from a subagent or another doc. Cross-check any inventory table (screen maps, integration lists) against its source of truth for completeness.
3. Refuter pass: spawn a general-purpose subagent and have it attack the SDD. Ask it to argue the doc is not findable or clear for a non-expert reviewer, that a specific risk or decision is too vague to act on, that a claim is factually wrong, that a link is broken, or that a diagram is too dense to parse in 10 seconds. Tell it to spot-check citations by opening the files. Fix every point that lands; say plainly which ones did not.
4. Report to chat, alongside the top-3 risks and top-3 gaps above: output path, what the refuter caught and how you fixed it, and anything left unverified.

## Guardrails

Do not change any files other than the ones you create: `<repo-root>/docs/<project-name>-solution-design.md`, the `<repo-root>/docs/` folder itself if it does not yet exist, plus the `<repo-root>/docs/img/` directory if screenshot placeholders are added. The quality ledger is read-only now; do not write to it.
