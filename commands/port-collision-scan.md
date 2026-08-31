---
description: One-pass port-collision scan across every repo under a root — detects bound ports, identifies collisions, and writes a self-contained reassignment agent for each losing project into ./portFixAgents/. Never edits the losing repos, never builds a registry, never installs an MCP server (use generate-port-registry for the full flow). Re-runnable; overwrites agent files in place. Fire on `/port-collision-scan` or "scan for port collisions / find port conflicts across my projects."
---

# Claude Code Command: One-time port-collision scan

  ## Goal
  One pass: detect the port(s) every repo under one root binds, find collisions,
  and for each project that must move write a self-contained reassignment agent
  into `<root>/portFixAgents/`. No registry is built and no MCP server is
  installed — this only scans and writes agent files. It never edits the losing
  project; it only writes the agent prompt.

  Re-runnable: re-running re-scans and overwrites the agent files in place. Stop
  on any unexpected output (missing root, ambiguous collision) rather than
  guessing.

  ## Argument
  - `[root-dir]` (optional) — directory whose immediate subdirectories are the
    repos to scan. Default `~/Projects`. Resolve to an absolute path; abort if it
    does not exist.

  ## Step 1 — Scan every repo for ports
  For each immediate subdirectory of `<root>` that is a repo, detect the port(s)
  it binds, in this priority order (authoritative config beats docs):

  1. `docker-compose*.y*ml` published/host mappings and `PORT` env
  2. `.env` / `.env.*` (`PORT`, `*_PORT`, `*_ADDR`)
  3. `Dockerfile*` `EXPOSE` / `ENV PORT`
  4. Framework config — `vite.config.*`, `next.config.*`, `package.json` scripts,
     Django settings, `application.properties|yml`, `*.csproj` / `launchSettings.json`
  5. Go `envOr("X_ADDR", ":NNNN")` listen defaults; `Makefile` `?= :NNNN` fallbacks
  6. `*.toml` (e.g. `railway.toml publicPort`)

  Record `project → port(s) → source file`. Treat Docker host-port remaps
  (e.g. `18080:8080`) as intentional and distinct from native-dev ports — list
  both. Skip `node_modules`, `.git`, `dist`, `build`. Repos with no bound port
  are omitted. Backup/variant repos (`*_bk`, `*-dotnet-conv`, …) are scanned but
  never reassigned.

  Suggested sweep:
  ```
  rg -n --no-heading -g '!node_modules' -g '!.git' \
    -g 'vite.config.*' -g 'next.config.*' -g 'docker-compose*' -g 'Dockerfile*' \
    -g '.env*' -g 'Makefile' -g 'main.go' -g '*.toml' -g '*.csproj' \
    -e 'port\s*[:=]\s*[0-9]{2,5}' -e 'EXPOSE\s+[0-9]+' \
    -e 'PORT[=:]\s*"?[0-9]{2,5}' -e 'envOr\("[A-Z_]+",\s*":[0-9]{2,5}' \
    -e '"[0-9]{2,5}:[0-9]{2,5}"' '<root>'
  ```

  ## Step 2 — Resolve collisions
  When two or more projects bind the same port, pick the keeper by this
  precedence (highest wins):

  1. **Priority projects** — an explicit, configured list keeps its port over any
     non-priority project. No project inherits status from being "important"; the
     list is explicit, not inferred.
  2. **Most entrenched / least-churn** — among equals, the holder whose move
     touches the most files (wired Makefiles + compose + docs) keeps it; a
     single-app project moves.
  3. Scratch clones and `*_bk` / `*-dotnet-conv` variants **always move**.

  Every other project on the port is a loser and moves. Allocate each loser a new
  port lowest-free-first from the bands below, skipping every port detected
  anywhere in this scan and any OS-bound port:

  - APIs / backends: `81xx`
  - Frontends (Vite): `51xx`

  ## Step 3 — Write the reassignment agents
  Ensure `<root>/portFixAgents/` exists. For each losing project write
  `<root>/portFixAgents/<project>-port-reassign.md` — one file per project,
  covering every port that project must vacate. Each file is a self-contained
  agent prompt:

  - YAML frontmatter: `name`, `project`, `loser`, `keeps`
  - A collision table (port · loser service · keeper)
  - The new port(s)
  - Exact file edits (path + old → new) to apply in the losing project
  - Verify steps (`rg` shows no residual binds) and a Finalize step
  - The rule (Step 2 #1/#2/#3) that decided the collision — never a project's
    perceived importance
  - Explicit instruction: **do not** touch the keeper or backup/variant repos

  ## Step 4 — Report
  Report: root scanned, repos scanned, the port table (project → port → source),
  collisions found with the deciding rule, and the agent files written. This
  scans and writes agent files only — it does not edit repos or commit.