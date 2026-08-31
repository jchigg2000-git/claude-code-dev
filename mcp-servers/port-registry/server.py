#!/usr/bin/env python3
"""
port-registry — global MCP stdio server.

Single source of truth: the registry Markdown file, resolved from the
PORT_REGISTRY_PATH environment variable and defaulting to
~/Projects/portRegistry.md.

Tools:
  - get_registry()                 -> current registry text
  - claim_port(project, kind?)     -> reserves the lowest free port, appends an
                                      entry to the registry, returns the port

Dependency-free (stdlib only) so it runs from any project, forever, with no
npm/pip install. Newline-delimited JSON-RPC 2.0 over stdin/stdout (MCP stdio).
"""

import json
import os
import re
import socket
import sys
import time
from contextlib import closing

REGISTRY = os.environ.get(
    "PORT_REGISTRY_PATH",
    os.path.join(os.path.expanduser("~"), "Projects", "portRegistry.md"),
)
LOCK = REGISTRY + ".lock"

FRONTEND = {"start": 5189, "end": 5999}   # Vite 51xx range
BACKEND = {"start": 8114, "end": 8999}    # API 81xx range
RESERVED = {8085}                         # planned observability daemon


# ---------- registry helpers ----------

def _read():
    try:
        with open(REGISTRY, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def _used_ports(text):
    """Every standalone 4–5 digit number in the registry counts as taken."""
    ports = set()
    for m in re.finditer(r"(?<!\d)(\d{4,5})(?!\d)", text):
        n = int(m.group(1))
        if 1 <= n <= 65535:
            ports.add(n)
    return ports


def _os_bound(port):
    """Best-effort: treat a port we can't bind locally as in use."""
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return False
        except OSError:
            return True


def _lock():
    """Crude cross-process lock via O_CREAT|O_EXCL; ~5s budget."""
    deadline = time.time() + 5
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            return
        except FileExistsError:
            if time.time() > deadline:
                # stale lock — break it rather than hang forever
                try:
                    os.unlink(LOCK)
                except OSError:
                    pass
            time.sleep(0.05)


def _unlock():
    try:
        os.unlink(LOCK)
    except OSError:
        pass


def claim_port(project, kind=None):
    project = (project or "").strip() or "unnamed-project"
    band = FRONTEND if (kind or "").lower() in ("frontend", "fe", "ui", "web", "vite") else BACKEND
    _lock()
    try:
        text = _read()
        used = _used_ports(text) | RESERVED
        chosen = None
        for p in range(band["start"], band["end"] + 1):
            if p in used:
                continue
            if _os_bound(p):
                used.add(p)
                continue
            chosen = p
            break
        if chosen is None:
            raise RuntimeError(f"no free port in range {band['start']}-{band['end']}")

        today = time.strftime("%Y-%m-%d")
        label = "frontend" if band is FRONTEND else "backend"
        row = (f"| {chosen} | {project} ({label}) | "
               f"claimed via port-registry MCP on {today} |")
        header = "## Claimed via MCP"
        if header in text:
            # section is last in the file by construction — append the row
            new_text = text.rstrip() + "\n" + row + "\n"
        else:
            new_text = text.rstrip() + (
                f"\n\n{header}\n\n"
                f"| Port | Project (kind) | Source |\n"
                f"|------|----------------|--------|\n{row}\n"
            )
        new_text = re.sub(r"(Last updated: )\d{4}-\d{2}-\d{2}",
                          rf"\g<1>{today}", new_text, count=1)

        tmp = REGISTRY + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(new_text)
        os.replace(tmp, REGISTRY)
        return {
            "port": chosen,
            "project": project,
            "kind": label,
            "registry": REGISTRY,
            "note": f"Port {chosen} reserved for {project} and written to the registry.",
        }
    finally:
        _unlock()


# ---------- MCP plumbing ----------

TOOLS = [
    {
        "name": "claim_port",
        "description": (
            "Reserve a free TCP port for a new build/service and record it in "
            "the global port registry. ALWAYS call this when scaffolding or "
            "configuring a new server, API, or frontend in ANY project instead "
            "of hardcoding a port. Returns the reserved port; it is written to "
            "the global port registry file."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "project": {
                    "type": "string",
                    "description": "Project / service name to record in the registry.",
                },
                "kind": {
                    "type": "string",
                    "description": "'frontend' for a Vite/web port (51xx); anything else for a backend/API port (81xx).",
                },
            },
            "required": ["project"],
        },
    },
    {
        "name": "get_registry",
        "description": "Return the full current contents of the global port registry.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def _result(call_id, result):
    return {"jsonrpc": "2.0", "id": call_id, "result": result}


def _error(call_id, code, message):
    return {"jsonrpc": "2.0", "id": call_id, "error": {"code": code, "message": message}}


def _text_content(payload):
    return {"content": [{"type": "text", "text": payload}], "isError": False}


def handle(msg):
    method = msg.get("method")
    mid = msg.get("id")

    if method == "initialize":
        proto = (msg.get("params") or {}).get("protocolVersion") or "2025-06-18"
        return _result(mid, {
            "protocolVersion": proto,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "port-registry", "version": "1.0.0"},
        })

    if method in ("notifications/initialized", "initialized"):
        return None  # notification, no reply

    if method == "ping":
        return _result(mid, {})

    if method == "tools/list":
        return _result(mid, {"tools": TOOLS})

    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        try:
            if name == "get_registry":
                return _result(mid, _text_content(_read()))
            if name == "claim_port":
                res = claim_port(args.get("project"), args.get("kind"))
                return _result(mid, _text_content(json.dumps(res, indent=2)))
            return _error(mid, -32601, f"unknown tool: {name}")
        except Exception as e:  # surface tool errors as MCP tool errors
            return _result(mid, {
                "content": [{"type": "text", "text": f"error: {e}"}],
                "isError": True,
            })

    if mid is not None:
        return _error(mid, -32601, f"method not found: {method}")
    return None


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        reply = handle(msg)
        if reply is not None:
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
