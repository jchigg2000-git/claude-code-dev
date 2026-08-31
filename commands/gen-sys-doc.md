---
description: Full repo crawl → single Markdown system design document with inline Mermaid diagrams. Pre-flights language/framework/build tooling, inventories entry points, modules, dependencies, integrations, runtime surfaces, and config surfaces, then synthesizes them into a system design doc with diagrams and verifies every diagram, anchor, and link before finishing. Read-only against source code; writes only the Markdown doc. Fire on `/gen-sys-doc` or "generate/produce a system design document for this repo."
---

Args: $ARGUMENTS

## Step 0 — Read the accumulated craft notes (do this first)

Read the **Lessons learned** section of `~/Projects/.claude/doc-quality/gen-sys-doc/ledger.md`. These are hard-won craft rules distilled from earlier runs (diagram density, orphan-node checks, Mermaid pitfalls, verifying counts before shipping them). Apply them. Ignore the rest of that file — the scoreboard, run log, rubric, and champion machinery are retired and are kept only as history.

Do not score this doc, do not compare it to a previous one, and do not write to the ledger.

If an existing `docs/system-design.md` is present, treat it as prior art to correct and replace, not as a competitor to out-point.

Do a full crawl of this repository and produce a single Markdown system design document. The document is Markdown-only with all diagrams as inline Mermaid code blocks — do not export a PDF and do not render diagrams to image files (SVG/PNG).

Pre-flight (do first, before crawling):
1. Identify the primary language(s), framework(s), and build tooling. State them explicitly.
2. List the top-level directories and their apparent purpose in one line each.
3. Confirm scope: monorepo vs single service, presence of infra-as-code, presence of tests or docs that disclose intent. If anything is ambiguous, ask before proceeding.

Inventory pass (write to stdout before writing the doc):
- Entry points (CLI commands, HTTP routes, main functions, scheduled jobs, message handlers)
- Top-level modules/services with one-line responsibility per module
- Internal dependencies (module-to-module references)
- External integrations (HTTP/gRPC clients, datastores, queues, third-party SDKs, auth providers)
- Runtime/deployment surfaces (Dockerfile, docker-compose, k8s manifests, CI config, IaC)
- Configuration surfaces (env vars, config files, secret references)
- Known unknowns: anything that looks important but cannot be verified from code alone

Document output:
Write to `docs/system-design.md` (create the directory if needed).

Start the document with two things a non-expert engineer needs before any architecture:
- A 2–3 line **"What this is / who it's for / how to read this"** orientation block.
- A **table of contents** whose entries are working in-doc anchor links to each section below.

Hyperlink the first mention of every external tool, framework, datastore, or third-party service to its canonical docs, so a non-expert can leave and come back.

Structure:
1. Overview (one-paragraph what-and-why, plus an "at a glance" bullet list of stack and key integrations)
2. Architecture (high-level diagram and narrative)
3. Components (one subsection per module/service: responsibility, inputs, outputs, key files)
4. Data Flow (sequence diagrams for the most important flows)
5. External Integrations (table: name, protocol, direction, source files)
6. Deployment (runtime topology, configuration surfaces, secrets handling)
7. Key Design Decisions / Risks (include anything flagged as unverifiable during inventory)

Diagrams (Mermaid, all grounded in code):
- One high-level system/context diagram (C4 context level is fine)
- One component/module diagram
- 2 to 4 sequence diagrams for the most important user-facing or business-critical flows. Cap at 4. Pick by frequency or blast radius.
- One data/ER or state diagram if the domain warrants it. Skip if it would be noise.

Each diagram block must:
- Be preceded by a one-paragraph caption explaining what boundary or flow it shows.
- Be followed by a "Grounded in:" list with `path:line` references for each labeled component or interaction.
- Be embedded as a fenced ` ```mermaid ` code block in the Markdown. Do not render diagrams to SVG/PNG or reference image files — the Mermaid source stays inline so the document renders without external assets.
- Pass Mermaid syntax validation before embedding (e.g. `mmdc -i diagram.mmd -o /dev/null` or equivalent). Fix any syntax errors so every block renders cleanly where Mermaid is supported.

Verification conventions:
- Reference real file paths inline as `path:line` whenever a claim is tied to a specific code location.
- For anything not directly verifiable from code (inferred intent, undocumented runtime behavior), mark inline with `> [UNVERIFIED]` and state what evidence is missing.
- Do not invent endpoints, services, or integrations you cannot point to in code.

Process notes:
- If the repo is large enough that a complete walk is impractical, state the depth limit applied (e.g., "traversed top 3 levels, sampled module internals") and which areas were sampled vs. fully read.

## Verify before you finish (do this after writing the doc)

No scoring, no gate, no ledger write. Just make sure the thing is correct.

1. **Mechanical checks:**
   - Resolve every in-doc anchor (TOC + body). Any that doesn't jump to a real heading is broken; fix it.
   - Resolve every external URL you added. Dead or redirecting links get fixed or removed, and each third party is linked exactly once at first mention.
   - Every Mermaid block passes syntax validation (`mmdc -i diagram.mmd -o /dev/null` or equivalent) **after the final edit**, not just once mid-draft.
2. **Re-derive every load-bearing number yourself.** Any integer you print (route counts, table counts, migration counts, module counts) gets one precise command you ran, not a figure carried from a subagent, another doc, or an earlier draft. If a decomposition is given, check that the parts sum to the total.
3. **Refuter pass:** spawn a general-purpose subagent and have it attack the doc — argue it is not findable or clear for a non-expert, that a specific claim is wrong, that a link is broken, or that a diagram is too dense to parse in ~10 seconds. Tell it to spot-check citations by opening the files and to run any quickstart commands the doc gives. Fix every point that lands; say plainly which ones did not.
4. **Report to chat:** output path, what the refuter caught and how you fixed it, and anything left unverified (e.g. "anchors resolved by inspection, not opened in a browser"; "nothing run against a deployed environment").
