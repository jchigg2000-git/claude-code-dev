#!/bin/bash
# Restart Docker Desktop with a lower memory cap, then bring back whatever was running.
# Containers are `docker start`ed by name: same containers, same volumes, nothing recreated.
set -euo pipefail
CAP_MIB=${1:-10240}
DIR=~/.claude/health-watchdog
SETTINGS=~/Library/Group\ Containers/group.com.docker/settings-store.json

docker ps --format '{{.Names}}' > "$DIR/docker-running-before.txt"
echo "running before: $(tr '\n' ' ' < "$DIR/docker-running-before.txt")"
cp "$SETTINGS" "$DIR/settings-store.backup.json"

docker desktop stop
python3 - "$SETTINGS" "$CAP_MIB" <<'EOF'
import json, sys
p, cap = sys.argv[1], int(sys.argv[2])
d = json.load(open(p)); old = d.get("MemoryMiB"); d["MemoryMiB"] = cap
json.dump(d, open(p, "w"), indent=2)
print(f"MemoryMiB {old} -> {cap}")
EOF
docker desktop start

for _ in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
docker info >/dev/null 2>&1 || { echo "docker did not come back within 180s"; exit 1; }

xargs docker start < "$DIR/docker-running-before.txt"
sleep 15
docker ps --format '{{.Names}}\t{{.Status}}'
