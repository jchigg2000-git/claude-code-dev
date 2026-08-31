---
description: Read-only forensic analysis of this repo — trace system flows from entry points (HTTP routes, CLI, jobs, consumers) through 2–4 call hops to terminal effects (DB writes, queue publishes, external calls), then render a Mermaid system-flow diagram with every claim cited as path/to/file.ext:line. Output goes to docs/architecture/system-flow.md. No code changes. Fire on `/diagramsystemflow` or "draw/diagram the system flow."
allowed-tools: Bash(rg:*), Bash(find:*), Bash(git:*), Read, Glob, Grep, Write
---

You are auditing this repository to produce a system flow diagram. Treat this 
as a read-only forensic task: every claim must be grounded in code that exists 
in this repo, cited by `path/to/file.ext:line`. Do not infer behavior from 
package names, READMEs, or comments alone — read the code.

Phase 1 — Discovery (do this before drawing anything):
1. Identify entry points. Look for: HTTP route handlers, CLI entrypoints, 
   message/queue consumers, scheduled jobs/cron, webhook receivers, event 
   subscribers, main()/lambda handlers, gRPC services. List each with its 
   trigger and file:line.
2. For each entry point, trace the primary call path 2–4 hops deep. Stop at: 
   external service calls, database writes, queue publishes, or framework 
   boundaries.
3. Identify shared infrastructure: auth/authz middleware, logging, retries, 
   circuit breakers, transaction boundaries.
4. Note where sync becomes async (queue publish, event emit, background job 
   enqueue, fire-and-forget HTTP).

Phase 2 — Synthesis:
- Group related entry points into 3–7 logical flows. If the system has more, 
  pick the highest-traffic or most business-critical and say which you skipped.
- For each flow, identify: trigger → key steps → terminal state (response 
  returned, message published, row written, etc.).

Phase 3 — Output (write to `docs/architecture/system-flow.md`):
1. **Assumptions & gaps** — anything you couldn't determine from code alone 
   (runtime config, infra wiring, feature flags). Be specific about what would 
   resolve each gap.
2. **Flow inventory** — table of flows: name, trigger, entry point file:line, 
   terminal effect.
3. **Diagram** — single Mermaid `flowchart TD` (or `sequenceDiagram` if 
   request/response is the dominant pattern; justify the choice). Every node 
   labeled with the actual component name from the code, not a generic 
   abstraction. Every edge labeled with verb + object.
4. **Failure & async behavior** — list each retry, timeout, circuit breaker, 
   dead-letter path, and idempotency mechanism you found, with file:line.
5. **What's NOT in the diagram** — flows you intentionally omitted, with one-
   line reason each.

Constraints:
- No invented components. If you can't find it in the code, say so in 
  Assumptions.
- No "Service" or "Handler" generic boxes — use the actual class/function/file 
  name.
- If the repo is too large to trace fully, sample: pick the 3 most-imported 
  modules and the 3 entry points with the most downstream calls, and say so.