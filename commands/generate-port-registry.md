---
description: Make port allocation deterministic across all projects under a root — scans every repo for bound ports, writes a single portRegistry.md source-of-truth, generates per-project reassignment agents into ./portFixAgents/ for collisions, and installs a globally-registered `port-registry` MCP server (claim_port/get_registry) so future builds auto-claim free ports. Fire on `/generate-port-registry` or "set up the port registry / fix my port collisions."
argument-hint: "[root-dir (default ~/Projects)]"
allowed-tools: Bash(rg:*), Bash(find:*), Bash(grep:*), Bash(ls:*), Bash(stat:*), Bash(mkdir:*), Bash(mv:*), Bash(chmod:*), Bash(python3:*), Bash(claude:*), Read, Glob, Grep, Write
---

# Claude Code Command: Port Registry + MCP allocator

## Goal
Make port allocation across every project under one root deterministic and
collision-free, and self-serve for future builds:

1. **One registry** — `<root>/portRegistry.md`, a human-readable Markdown file
   that is the single source of truth for which port every service uses.
2. **Collisions become work items** — every project that has to move off a
   contended port gets a self-contained reassignment agent in
   `<root>/portFixAgents/<project>-port-reassign.md`. This command never
   rewrites the losing project itself; it only writes the agent prompt.
3. **Self-serve allocation** — a global stdio MCP server `port-registry`
   exposes `claim_port` / `get_registry`. Claude calls `claim_port`
   automatically whenever it scaffolds a new build, so new services grab the
   lowest free port and the registry is updated in the same step.

This command is idempotent: re-running refreshes the registry and re-installs
the MCP server in place. It is mutating — **stop on any unexpected output**
(missing root, ambiguous registry, failed `claude mcp add`) rather than
guessing.

## Argument
- `[root-dir]` (optional) — directory whose immediate subdirectories are the
  repos to scan. Default `~/Projects`. Resolve to an absolute path; abort if it
  does not exist.

## Step 1 — Locate / seed the registry
- Search `<root>` recursively (case-insensitive) for an existing
  `portRegistry.md` or legacy `portRegistry.txt` / `port*registry*` file.
- If multiple copies exist, keep the **most recently modified**, move it to
  `<root>/portRegistry.md`, and note the others (do not delete repo-local
  copies — leave a short stub there pointing at the global file if a repo
  references it internally).
- If none exists, start a fresh registry from the template in Step 4.
- Legacy `.txt` → convert to `.md` (tables), delete the `.txt`, and rewrite any
  in-repo references (`portRegistry.txt` → `portRegistry.md`), **excluding
  point-in-time audit/history artifacts** (e.g. `*-audit.plan`) whose recorded
  commands must stay verbatim.

## Step 2 — Scan every repo for ports
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
(e.g. `18080:8080`) as intentional and **distinct** from native-dev ports —
list both. Skip `node_modules`, `.git`, `dist`, `build`. Repos that are
scripts/data/docs with no bound port are simply omitted.

Suggested sweep:
```
rg -n --no-heading -g '!node_modules' -g '!.git' \
  -g 'vite.config.*' -g 'next.config.*' -g 'docker-compose*' -g 'Dockerfile*' \
  -g '.env*' -g 'Makefile' -g 'main.go' -g '*.toml' -g '*.csproj' \
  -e 'port\s*[:=]\s*[0-9]{2,5}' -e 'EXPOSE\s+[0-9]+' \
  -e 'PORT[=:]\s*"?[0-9]{2,5}' -e 'envOr\("[A-Z_]+",\s*":[0-9]{2,5}' \
  -e '"[0-9]{2,5}:[0-9]{2,5}"' '<root>'
```

## Step 3 — Resolve collisions
When two or more projects bind the same port, pick the **keeper** by this
precedence (highest wins):

1. **Priority projects** — a configurable per-environment list keeps its port
   over any non-priority project. No project has inherited status from being
   "important" or a day job; the list is explicit, not inferred.
2. **Most entrenched / least-churn** — among equals, the holder whose move
   touches the most files (documented multi-service block, wired Makefiles +
   compose + docs) keeps it; a single-app project moves.
3. Scratch clones and `*_bk` / `*-dotnet-conv` variants **always move** (or are
   not run alongside the original).

If the target registry has a "Collision keeper policy" section, that list is
authoritative — read it and apply it verbatim. Every other project on the port
is a **loser** and moves. Record *which rule* decided each collision in the
agent file, never a project's perceived importance.

For each losing project write `<root>/portFixAgents/<project>-port-reassign.md`
— one file per project, covering every port that project must vacate. Each file
is a self-contained agent prompt:

- YAML frontmatter: `name`, `project`, `loser`, `keeps`
- A collision table (port · loser service · keeper)
- The new port(s), already authoritative in `portRegistry.md`
- Exact file edits (path + old → new) to apply in the losing project
- Verify steps (`rg` shows no residual binds) and a Finalize step
- Explicit instruction: **do not** touch the keeper or backup/variant repos

Allocate new ports from the bands in Step 4, lowest-free-first, skipping every
number that appears anywhere in the registry text (conservative) and any
OS-bound port.

## Step 4 — Write `portRegistry.md`
Markdown, sectioned, one table per group. Skeleton:

```
# Projects — Port Registry

_Last updated: YYYY-MM-DD_

**Scope:** every repo under `<root>`.
Authoritative source of truth. Claude claims new ports via the `port-registry`
MCP tool (`claim_port` / `get_registry`) — see Automation.

## <Primary repo>            (owns the 808x / 517x blocks)
| Port | Service | Source of truth | Notes |
...
## Other active services (no collision)
## Reassigned to clear collisions   (new values authoritative; see ./portFixAgents/)
## Backups / variants — NOT registered
## Next available
| Pool | Next free |
| APIs / backends | 81xx |
| Frontends (Vite) | 51xx |
## Conventions
## Automation
## Claimed via MCP
| Port | Project (kind) | Source |
|------|----------------|--------|
```

Conventions to record: backends in `81xx`, Vite frontends in `51xx`, Go
services read `*_ADDR` env with a `:PORT` default, the registry MUST be updated
in the same change that wires a port. Keep `## Claimed via MCP` the **last**
section (the server appends rows there).

## Step 5 — Install + register the MCP server
Write the server below to `~/.claude/mcp-servers/port-registry/server.py`,
`chmod +x`, then register it at **user scope** so it loads in every project:

```
mkdir -p ~/.claude/mcp-servers/port-registry
# (write server.py — source below)
chmod +x ~/.claude/mcp-servers/port-registry/server.py
claude mcp add -s user port-registry -- python3 ~/.claude/mcp-servers/port-registry/server.py
claude mcp list | grep port-registry      # expect: ✓ Connected
```

If `claude mcp add` reports the server already exists, that is success
(idempotent) — verify with `claude mcp list`. Stop if it does not connect.

> Set `REGISTRY` in the server to the absolute `<root>/portRegistry.md` so it
> resolves from any project's cwd.

### `server.py` (dependency-free stdlib; newline-delimited JSON-RPC 2.0 / MCP stdio)
```python
#!/usr/bin/env python3
"""port-registry — global MCP stdio server. Single source of truth: <root>/portRegistry.md
Tools: get_registry(); claim_port(project, kind?) -> reserve lowest free port, append a row, return it."""
import json, os, re, socket, sys, time
from contextlib import closing

REGISTRY = os.path.expanduser("~/Projects/portRegistry.md")  # set to <root>/portRegistry.md
LOCK = REGISTRY + ".lock"
FRONTEND = {"start": 5189, "end": 5999}
BACKEND  = {"start": 8114, "end": 8999}
RESERVED = {8085}

def _read():
    try:
        with open(REGISTRY, "r", encoding="utf-8") as f: return f.read()
    except FileNotFoundError: return ""

def _used_ports(text):
    return {int(m) for m in re.findall(r"(?<!\d)(\d{4,5})(?!\d)", text) if 1 <= int(m) <= 65535}

def _os_bound(port):
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try: s.bind(("127.0.0.1", port)); return False
        except OSError: return True

def _lock():
    deadline = time.time() + 5
    while True:
        try: os.close(os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)); return
        except FileExistsError:
            if time.time() > deadline:
                try: os.unlink(LOCK)
                except OSError: pass
            time.sleep(0.05)

def _unlock():
    try: os.unlink(LOCK)
    except OSError: pass

def claim_port(project, kind=None):
    project = (project or "").strip() or "unnamed-project"
    band = FRONTEND if (kind or "").lower() in ("frontend","fe","ui","web","vite") else BACKEND
    _lock()
    try:
        text = _read(); used = _used_ports(text) | RESERVED; chosen = None
        for p in range(band["start"], band["end"] + 1):
            if p in used: continue
            if _os_bound(p): used.add(p); continue
            chosen = p; break
        if chosen is None: raise RuntimeError(f"no free port in {band['start']}-{band['end']}")
        today = time.strftime("%Y-%m-%d")
        label = "frontend" if band is FRONTEND else "backend"
        row = f"| {chosen} | {project} ({label}) | claimed via port-registry MCP on {today} |"
        header = "## Claimed via MCP"
        if header in text:
            new_text = text.rstrip() + "\n" + row + "\n"
        else:
            new_text = text.rstrip() + f"\n\n{header}\n\n| Port | Project (kind) | Source |\n|------|----------------|--------|\n{row}\n"
        new_text = re.sub(r"(Last updated: )\d{4}-\d{2}-\d{2}", rf"\g<1>{today}", new_text, count=1)
        tmp = REGISTRY + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f: f.write(new_text)
        os.replace(tmp, REGISTRY)
        return {"port": chosen, "project": project, "kind": label, "registry": REGISTRY,
                "note": f"Port {chosen} reserved for {project} and written to the registry."}
    finally:
        _unlock()

TOOLS = [
    {"name": "claim_port",
     "description": "Reserve a free TCP port for a new build/service and record it in the global port registry. ALWAYS call this when scaffolding or configuring a new server, API, or frontend in ANY project instead of hardcoding a port. Returns the reserved port; it is written to the registry.",
     "inputSchema": {"type": "object", "properties": {
        "project": {"type": "string", "description": "Project / service name to record."},
        "kind": {"type": "string", "description": "'frontend' for a Vite/web port (51xx); else a backend/API port (81xx)."}},
        "required": ["project"]}},
    {"name": "get_registry",
     "description": "Return the full current contents of the global port registry.",
     "inputSchema": {"type": "object", "properties": {}}},
]

def _result(i, r): return {"jsonrpc": "2.0", "id": i, "result": r}
def _error(i, c, m): return {"jsonrpc": "2.0", "id": i, "error": {"code": c, "message": m}}
def _text(p): return {"content": [{"type": "text", "text": p}], "isError": False}

def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        proto = (msg.get("params") or {}).get("protocolVersion") or "2025-06-18"
        return _result(mid, {"protocolVersion": proto, "capabilities": {"tools": {}},
                             "serverInfo": {"name": "port-registry", "version": "1.0.0"}})
    if method in ("notifications/initialized", "initialized"): return None
    if method == "ping": return _result(mid, {})
    if method == "tools/list": return _result(mid, {"tools": TOOLS})
    if method == "tools/call":
        p = msg.get("params") or {}; name = p.get("name"); args = p.get("arguments") or {}
        try:
            if name == "get_registry": return _result(mid, _text(_read()))
            if name == "claim_port":
                return _result(mid, _text(json.dumps(claim_port(args.get("project"), args.get("kind")), indent=2)))
            return _error(mid, -32601, f"unknown tool: {name}")
        except Exception as e:
            return _result(mid, {"content": [{"type": "text", "text": f"error: {e}"}], "isError": True})
    if mid is not None: return _error(mid, -32601, f"method not found: {method}")
    return None

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try: msg = json.loads(line)
        except json.JSONDecodeError: continue
        reply = handle(msg)
        if reply is not None:
            sys.stdout.write(json.dumps(reply) + "\n"); sys.stdout.flush()

if __name__ == "__main__":
    main()
```

## Step 6 — Smoke test, then report
- Pipe an `initialize` + `tools/call claim_port` into the server; confirm it
  returns a port and appends a row under `## Claimed via MCP`. Remove the
  smoke-test row afterward.
- Report: registry path, repos scanned, the port table, collisions found,
  agent files written, MCP server path, and the exact `claude mcp add` command
  (so the user can confirm/re-run the one registration step).

## Notes
- This command **builds infrastructure**; it does not commit. Shipping the
  resulting edits (e.g. in-repo reference rewrites, the registry) is a separate
  explicit step — never bundled in here.
- Backup/variant repos (`*_bk`, `*-dotnet-conv`, …) are listed as NOT
  registered and never reassigned.
