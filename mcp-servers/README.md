# MCP servers

Two small local servers that give Claude extra tools to call. Both are a single
pure-stdlib Python file speaking raw JSON-RPC 2.0 over stdio, so there's nothing to
install beyond Python 3.

| Server | What it's for | Tools it gives Claude |
| --- | --- | --- |
| `port-registry` | Stops two local apps fighting over the same network port. When Claude sets up a new server or frontend, it asks for a free port instead of guessing one, and the choice is recorded in one shared registry file. | `claim_port` reserves a free port and records it. `get_registry` shows every assignment. |
| `loose-ends` | Tells Claude what's unfinished in a repo the moment you start working there: uncommitted or unpushed work, new TODOs, stale or missing docs, open backlog items, and saved memories about the repo. | `get_loose_ends` returns that digest for a repo (the current one by default). |

`/generate-port-registry` builds the registry file and installs `port-registry` for you.

## Register (per machine)

These run from `~/.claude/mcp-servers/`. Add to `~/.claude.json` under the root
`mcpServers` block:

```json
"mcpServers": {
  "port-registry": { "command": "python3", "args": ["/Users/<you>/.claude/mcp-servers/port-registry/server.py"] },
  "loose-ends":    { "command": "python3", "args": ["/Users/<you>/.claude/mcp-servers/loose-ends/server.py"] }
}
```

## Configuration

Both servers resolve their paths at runtime and fall back to sensible defaults, so
they work unmodified on any machine.

| Variable | Used by | Default |
| --- | --- | --- |
| `PORT_REGISTRY_PATH` | `port-registry` | `~/Projects/portRegistry.md` |
| `PROJECTS_ROOT` | `loose-ends` | `~/Projects` |

Set them in the `mcpServers` entry if your layout differs:

```json
"port-registry": {
  "command": "python3",
  "args": ["/Users/<you>/.claude/mcp-servers/port-registry/server.py"],
  "env": { "PORT_REGISTRY_PATH": "/path/to/portRegistry.md" }
}
```
