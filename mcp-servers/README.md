# MCP servers

Local custom MCP servers for the Claude Code harness. Both are pure-stdlib Python,
raw JSON-RPC 2.0 over stdio (no pip/npm deps) — single-file, run anywhere with Python 3.

| Server          | Purpose                                                        |
| --------------- | ------------------------------------------------------------- |
| `port-registry` | Single source of truth for dev-app port assignments.          |
| `loose-ends`    | Surfaces unfinished work / memories scoped to the current repo.|

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
