#!/usr/bin/env python3
"""Resource watchdog: fixes the safe things itself, exits to wake Claude for judgment calls.

Auto:  renice build/test/search procs to +10; kill ones stuck past their age cap while
       still burning CPU; renice anything pinning a core for 3m; kill python scripts
       pinned past 20m of age; kill orphaned headless `claude -p`; kill MS AutoUpdate;
       unload an idle ollama model under sustained critical memory pressure.
Exit:  sustained CPU hog (process >80% for 15m, container >150% for 10m), sustained critical pressure, or an
       idle window to restart Docker with a lower memory cap. Exit code 3 + ALERT line.

Flags: --once  --dry-run  --ignore a,b (substring match on command / container name / ollama
       model, and on the cwd of an owning claude session: `--ignore ask-meadowlark` protects
       every process that session spawned, including its `node (vitest N)` workers)
       --no-docker-window
"""
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

DIR = Path.home() / ".claude/health-watchdog"
LOG = DIR / "watchdog.log"
DOCKER_SETTINGS = Path.home() / "Library/Group Containers/group.com.docker/settings-store.json"

POLL_S = 60
STUCK_BUILD_MIN, STUCK_SEARCH_MIN, STUCK_CPU, STUCK_POLLS = 30, 20, 15.0, 5
ORPHAN_CLAUDE_MIN = 45
HOG_CPU, HOG_POLLS = 150.0, 10  # containers
SPIN_CPU, SPIN_RENICE_POLLS, SPIN_ESCALATE_POLLS = 80.0, 3, 15  # procs: one pinned core counts
SCRIPT_KILL_MIN = 20
CRIT_FREE_PCT, CRIT_SWAP_FREE_MB = 10, 1024
CRIT_UNLOAD_POLLS, CRIT_ESCALATE_POLLS, OLLAMA_COOLDOWN_S = 3, 15, 900
DOCKER_IDLE_POLLS, DOCKER_CAP_TARGET_MIB = 10, 12288

BUILD = re.compile(r"node \(vitest|\bvitest\b|\btsc\b|\bjest\b|\besbuild\b|\bwebpack\b|next build|"
                   r"vite build|\bcargo\b|go build|swift-build|xcodebuild|playwright")
SEARCH = re.compile(r"^(\S*/)?(bfs|ugrep|rg|fd|find|mdfind)(\s|$)")
WATCH = re.compile(r"--watch|\s-w(\s|$)")
SCRIPT = re.compile(r"\b(Python|python3?(\.\d+)?)\s+(-\S+\s+)*\S+\.py(\s|$)")
NUISANCE = re.compile(r"Microsoft Update Assistant|Microsoft AutoUpdate")
HOG_ALLOW = re.compile(r"WindowServer|kernel_task|com\.apple\.Virtualization|llama-server|mds_stores|mdworker")
CLAUDE = re.compile(r"^(\S*/)?claude(\.exe)?(\s|$)")

DRY = "--dry-run" in sys.argv
ONCE = "--once" in sys.argv
NO_DOCKER_WINDOW = "--no-docker-window" in sys.argv
IGNORE = []
if "--ignore" in sys.argv:
    IGNORE = [s for s in sys.argv[sys.argv.index("--ignore") + 1].split(",") if s]
# --docker-ports a,b: only these container ports gate the docker window, and builds don't
DOCKER_PORTS = set()
if "--docker-ports" in sys.argv:
    DOCKER_PORTS = {int(s) for s in sys.argv[sys.argv.index("--docker-ports") + 1].split(",") if s}


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {'[dry] ' if DRY else ''}{msg}"
    print(line, flush=True)
    with LOG.open("a") as f:
        f.write(line + "\n")


def sh(*cmd, timeout=30):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def etime_min(s):
    days, _, rest = s.rpartition("-")
    parts = [int(p) for p in rest.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, sec = parts
    return (int(days or 0) * 86400 + h * 3600 + m * 60 + sec) / 60


def procs():
    out = []
    for line in sh("ps", "-Ao", "pid=,ppid=,pcpu=,rss=,etime=,nice=,command=").splitlines():
        f = line.split(None, 6)
        if len(f) == 7:
            out.append(dict(pid=int(f[0]), ppid=int(f[1]), cpu=float(f[2]), rss_mb=int(f[3]) // 1024,
                            age=etime_min(f[4]), nice=int(f[5]), cmd=f[6]))
    return out


def ignored(text):
    return any(s in text for s in IGNORE)


def guarded(ps):
    """Pids descended from a claude session whose cwd matches --ignore."""
    if not IGNORE:
        return set()
    sessions = [str(p["pid"]) for p in ps if CLAUDE.match(p["cmd"])]
    owners, pid = set(), None
    if sessions:
        for line in sh("lsof", "-a", "-d", "cwd", "-Fpn", "-p", ",".join(sessions)).splitlines():
            if line[:1] == "p":
                pid = int(line[1:])
            elif line[:1] == "n" and pid and ignored(line[1:]):
                owners.add(pid)
    parent = {p["pid"]: p["ppid"] for p in ps}
    out = set()
    for p in ps:
        a, hops = p["pid"], 0
        while a > 1 and hops < 64:
            if a in owners:
                out.add(p["pid"])
                break
            a, hops = parent.get(a, 1), hops + 1
    return out


def kill_tree(p, why):
    log(f"KILL pid={p['pid']} age={p['age']:.0f}m cpu={p['cpu']:.0f}% ({why}): {p['cmd'][:140]}")
    if DRY:
        return
    subprocess.run(["pkill", "-TERM", "-P", str(p["pid"])], capture_output=True)
    try:
        os.kill(p["pid"], signal.SIGTERM)
    except ProcessLookupError:
        pass


def mem_state():
    level = int(sh("sysctl", "-n", "kern.memorystatus_level").strip() or 100)
    m = re.search(r"free = ([\d.]+)M", sh("sysctl", "-n", "vm.swapusage"))
    swap_free = float(m.group(1)) if m else 1e9
    return level, swap_free


def established():
    """(remote_port, process_name) for every established TCP connection."""
    out = []
    for line in sh("lsof", "-nP", "-iTCP", "-sTCP:ESTABLISHED").splitlines()[1:]:
        f = line.split()
        m = re.search(r"->\S*:(\d+)$", f[8]) if len(f) > 8 else None
        if m:
            out.append((int(m.group(1)), f[0]))
    return out


def docker_ports():
    ports = set()
    for m in re.finditer(r":(\d+)->", sh("docker", "ps", "--format", "{{.Ports}}")):
        ports.add(int(m.group(1)))
    return ports


def docker_cpu():
    out = {}
    for line in sh("docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}", timeout=45).splitlines():
        name, _, pct = line.partition("\t")
        try:
            out[name] = float(pct.rstrip("%"))
        except ValueError:
            pass
    return out


def docker_cap_mib():
    try:
        return json.loads(DOCKER_SETTINGS.read_text()).get("MemoryMiB", 0)
    except (OSError, ValueError):
        return 0


def ollama_loaded():
    return [l.split()[0] for l in sh("ollama", "ps").splitlines()[1:] if l.strip()]


def escalate(reason):
    log(f"ALERT {reason}")
    print(f"ALERT {reason}", flush=True)
    sys.exit(3)


def main():
    DIR.mkdir(parents=True, exist_ok=True)
    reniced, hot, hog, chog = set(), {}, {}, {}
    crit_polls = docker_idle = polls = 0
    last_unload = 0.0
    log(f"start poll={POLL_S}s ignore={IGNORE} docker_window={'off' if NO_DOCKER_WINDOW else 'on'}")
    while True:
        polls += 1
        ps = procs()
        live = {p["pid"] for p in ps}
        hands_off = guarded(ps)
        builds = 0
        for p in ps:
            cmd = p["cmd"]
            if ignored(cmd) or p["pid"] in hands_off:
                continue
            kind = "build" if BUILD.search(cmd) and not WATCH.search(cmd) else \
                   "search" if SEARCH.search(cmd) else None

            if kind:
                builds += kind == "build"
                if p["nice"] < 10 and p["pid"] not in reniced:
                    reniced.add(p["pid"])
                    if not DRY:
                        subprocess.run(["renice", "-n", "10", "-p", str(p["pid"])], capture_output=True)
                cap = STUCK_BUILD_MIN if kind == "build" else STUCK_SEARCH_MIN
                if p["age"] > cap and p["cpu"] > STUCK_CPU:
                    hot[p["pid"]] = hot.get(p["pid"], 0) + 1
                    if hot[p["pid"]] >= STUCK_POLLS:
                        kill_tree(p, f"{kind} stuck >{cap}m")
                        hot.pop(p["pid"])
                else:
                    hot.pop(p["pid"], None)
                continue

            if cmd.startswith("claude -p") and p["ppid"] == 1 and p["age"] > ORPHAN_CLAUDE_MIN:
                kill_tree(p, f"orphaned headless claude >{ORPHAN_CLAUDE_MIN}m")
            elif NUISANCE.search(cmd):
                kill_tree(p, "nuisance updater")
            elif p["cpu"] > SPIN_CPU and not HOG_ALLOW.search(cmd) and p["pid"] != os.getpid():
                n = hog[p["pid"]] = hog.get(p["pid"], 0) + 1
                if n == SPIN_RENICE_POLLS and p["nice"] < 10:
                    log(f"RENICE pid={p['pid']} cpu={p['cpu']:.0f}% for {n}m: {cmd[:140]}")
                    if not DRY:
                        subprocess.run(["renice", "-n", "10", "-p", str(p["pid"])], capture_output=True)
                if SCRIPT.search(cmd) and p["age"] > SCRIPT_KILL_MIN and n >= STUCK_POLLS:
                    kill_tree(p, f"script pinned past {SCRIPT_KILL_MIN}m")
                    hog.pop(p["pid"])
                elif n >= SPIN_ESCALATE_POLLS:
                    escalate(f"proc-hog pid={p['pid']} cpu={p['cpu']:.0f}% for {n}m: {cmd[:160]}")
            else:
                hog.pop(p["pid"], None)
        for d in (hot, hog):
            for pid in [k for k in d if k not in live]:
                d.pop(pid)
        reniced &= live

        stats = docker_cpu()
        for name, pct in stats.items():
            if pct > HOG_CPU and not ignored(name):
                chog[name] = chog.get(name, 0) + 1
                if chog[name] >= HOG_POLLS:
                    escalate(f"container-hog {name} cpu={pct:.0f}% for {HOG_POLLS}m")
            else:
                chog.pop(name, None)

        level, swap_free = mem_state()
        conns = established()
        crit = level < CRIT_FREE_PCT and swap_free < CRIT_SWAP_FREE_MB
        crit_polls = crit_polls + 1 if crit else 0
        if crit_polls >= CRIT_UNLOAD_POLLS and time.time() - last_unload > OLLAMA_COOLDOWN_S:
            models = [m for m in ollama_loaded() if not ignored(m)]
            if models and not any(port == 11434 and name != "ollama" for port, name in conns):
                for mdl in models:
                    log(f"UNLOAD ollama {mdl} (free={level}% swap_free={swap_free:.0f}M, no clients)")
                    if not DRY:
                        sh("ollama", "stop", mdl)
                last_unload = time.time()
        if crit_polls >= CRIT_ESCALATE_POLLS:
            escalate(f"pressure critical for {crit_polls}m (free={level}% swap_free={swap_free:.0f}M)")

        if not NO_DOCKER_WINDOW and docker_cap_mib() > DOCKER_CAP_TARGET_MIB:
            dports = DOCKER_PORTS or docker_ports()
            busy = (builds and not DOCKER_PORTS) or \
                any(port in dports and not name.startswith("com.docke") for port, name in conns)
            docker_idle = 0 if busy else docker_idle + 1
            if docker_idle >= DOCKER_IDLE_POLLS:
                escalate(f"docker-window: no builds and no clients on container ports for {docker_idle}m; "
                         f"Docker cap is {docker_cap_mib()}MiB")

        if polls == 1 or polls % 10 == 0:
            load = sh("sysctl", "-n", "vm.loadavg").strip("{} \n").split()[0]
            log(f"status free={level}% swap_free={swap_free:.0f}M load={load} builds={builds} "
                f"containers={len(stats)} ollama={','.join(ollama_loaded()) or '-'} docker_idle={docker_idle}m")
        if ONCE:
            return
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()
