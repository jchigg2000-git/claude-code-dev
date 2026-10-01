---
name: machine-health
description: >-
  Get this Mac out of CPU/memory trouble without breaking other sessions' work:
  snapshot, attribute every hog to its owner (Claude session, repo, container,
  model), knock out what's idle (reversibly), coordinate with the sessions that
  own the rest, then leave a zero-token watchdog running that renices/kills the
  safe cases and wakes you for judgment calls. Fire on "/machine-health", "we're
  low on cpu/memory", "machine is slow", "swap is full", "what's hogging the box",
  "keep things healthy". Local-machine counterpart to /deploy-health.
---

# machine-health

Inline and serial. No Workflow, no subagents: they cost the memory you're trying
to free, and this is process-watching, not reasoning. The watchdog is a stdlib
Python loop (~0.05% CPU); it costs nothing while things are healthy.

Scripts: `~/.claude/skills/machine-health/scripts/` · State + log: `~/.claude/health-watchdog/`

## 1. Snapshot

```bash
sysctl -n hw.memsize hw.ncpu kern.memorystatus_level vm.swapusage; uptime
top -l 1 -o mem -n 12 -stats pid,command,mem,cpu | tail -13   # footprint, not RSS
ps -Ao pid,ppid,%cpu,etime,comm -r | head -30
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
ollama ps
```

`pgrep -f PATTERN` also matches your own shell (and every `$(...)` subshell in a loop), because
the pattern is in its command line, so counts and parent chains come out wrong. Filter with
`ps -Ao pid=,command= | awk '/[G]oogle Chrome --headless/'` instead: the bracketed character keeps
the regex from matching its own text. `ps` RSS hides the big ones. VM guests (Docker, Claude Desktop) and GPU-wired model
weights (llama-server) only show up in `top`'s MEM column or as "wired". A single
`docker stats` sample can spike to 300%+, so resample before calling a container hot.
Single-threaded hogs top out near 100%, so don't wait for 150%.

## 2. Attribute before you kill

"Pay attention to what other builds are doing" is the core of this skill.

- **Processes:** cwd with `lsof -a -p PID -d cwd -Fn`, then walk the PPID chain up
  to the `claude` process. `ListAgents` names the peer sessions; Desktop sessions
  run under `Claude.app/.../claude-code/`.
- **Containers:** `docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'`
  gives the owning repo. `lsof -nP -iTCP -sTCP:ESTABLISHED` against published ports
  shows live clients. Is a session open in that repo?
- **Local models:** `ollama stop <model>` is a cheap probe. If it reloads within
  seconds, something depends on it: find the client with lsof on :11434 and grep
  the active repos for the model name. Then leave it loaded; keep_alive (default
  5m) unloads it once the client stops.

## 3. Knock out, reversibly

- Idle containers (no session in their repo, no host clients): `docker stop`, never `rm`.
  Tell the user the `docker compose up -d` dirs to bring them back.
- Nuisance updaters (Microsoft AutoUpdate etc.): kill.
- Active but greedy builds or scripts: `renice -n 10` first. Kill only on a stated deadline.

## 4. Docker VM memory

Freeing guest memory doesn't shrink the host footprint (Apple Virtualization keeps
it), and `drop_caches` inside the VM won't help the host. The fix is a restart with
a lower `MemoryMiB`: size it to the in-use containers plus ~4 GB headroom.

A restart disrupts other sessions, so get user approval once, then coordinate:
1. `SendMessage` the session whose tests hit the containers: what goes down, for
   how long, and that it comes back with `docker start` (same data). Ask for "go";
   set `notify_when_idle: true`.
2. On "go", send an FYI to the other container-owning sessions, then run
   `bash ~/.claude/skills/machine-health/scripts/docker-recap.sh 10240`.
   It records what was running, backs up settings, stops Docker, sets the cap,
   starts Docker, and `docker start`s everything that was up.
3. Verify (`docker info` MemTotal, `top` footprint), then message the owner "back and healthy".

Undo: copy `~/.claude/health-watchdog/settings-store.backup.json` over Docker's
`settings-store.json` and restart Docker.

## 5. Leave the watchdog running

Check `pgrep -f machine-health/scripts/watchdog.py` first so you never run two.
Then run it with `run_in_background: true`:

```bash
python3 ~/.claude/skills/machine-health/scripts/watchdog.py [--ignore substr,...] [--docker-ports 1433,8161] [--no-docker-window]
```

| Situation | Action |
|---|---|
| vitest/tsc/jest/cargo/xcodebuild/etc. | renice +10; kill if >30m old and still burning CPU for 5m |
| bfs/rg/find/ugrep searches | renice +10; kill if >20m old and still burning CPU |
| any process >80% CPU for 3m | renice +10 |
| `python *.py` script >20m old, pinned | kill |
| orphaned headless `claude -p` >45m | kill |
| critical memory for 3m + idle ollama model | `ollama stop` (15m cooldown) |
| process pinned 15m / container >150% for 10m / critical memory for 15m | **exit 3 → wakes you** |
| Docker cap >12 GB and its ports idle for 10m | **exit 3 → wakes you** (restart window) |

On an ALERT wake-up, attribute the process (step 2), act or coordinate, then restart
the watchdog with `--ignore` for anything you've accepted. `--ignore` substrings also match
ollama model names and the cwd of the owning Claude session, so `--ignore <repo>` keeps the
watchdog off everything that session spawned (vitest workers carry no repo in their command).
When the user puts a session off-limits, touch nothing of it by hand either: no renice (you can't
undo one without sudo), no model unload, no suggestions to it. Actions go to
`~/.claude/health-watchdog/watchdog.log`, with a status line every 10 polls.

## Coordinating with peer sessions

- Desktop sessions may hold your message for their user's approval and let it expire.
  Don't wait on them. State a deadline, renice now, and let the watchdog enforce it.
- Never ask a peer to do something your own session is blocked from doing.

## Report

Lead with before → after numbers: load, swap used, and the footprint of whatever
you fixed. Then:
- what you stopped, and how to restore it;
- what you left running, and whose it is;
- the watchdog's status.

Say plainly what didn't improve, and why.
