---
description: Reconstruct how this repo was built from Claude Code session logs + git history and write a single BUILD_REPORT.md — compact stats first, short honest retrospective last.
argument-hint: "[optional output path, default BUILD_REPORT.md]"
allowed-tools: Bash, Read, Write, Glob, Grep, Skill
---

You are generating a **build report** for the repository at the current working directory: a single skimmable Markdown file that reconstructs how this project was built from its Claude Code session transcripts and git history. **Statistics first (compact tables), short narrative last.**

Output path: `$ARGUMENTS` if given, otherwise `BUILD_REPORT.md` in the repo root. Overwrite if it exists. Print the absolute path when done.

## Data sources — read all, attribute carefully

Dedupe everything by `message.id` (token usage) and by entry `uuid` (timestamps/steering) so the same event counted in two places is never double-counted.

1. **Live transcripts** — `~/.claude/projects/<munged-cwd>/*.jsonl`. The directory name is the absolute repo path with `/` and `_` (and, in the older convention, `.`) replaced by `-`. The script attributes a transcript dir to this repo by **either** munging variant of its name **or** the `cwd` field inside entries — this matters because a renamed repo leaves the *old* path in the `cwd` field of files that now live under the new name, so cwd-only matching would silently drop the project's early history. The script's `distinct_cwds` output exposes any such rename.
2. **Sibling archive** — `../claude-code-logs` (auto-detect; also check `~/claude-code-logs` and `~/Projects/claude-code-logs`). Older/fuller history than the live logs may still retain. Filter its entries to this repo by `cwd`.
3. **`git log`** — anchors the build sequence to real timestamps and commits.

**If a source is missing** (e.g. no transcripts found), say so plainly in the report and continue with whatever is available. Never fail the whole report because one source is absent. Never fabricate numbers to fill a gap.

## Step 1 — aggregate the transcripts with a script (do NOT read raw .jsonl into context)

Transcripts are large. Save the script below to a temp file (e.g. `"$(mktemp).py"`) and run it with the repo path as its argument. Work from its JSON output, not the raw logs.

```python
#!/usr/bin/env python3
import json, glob, os, re, sys, collections
from datetime import datetime
from collections import defaultdict

REPO = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
home = os.path.expanduser("~")
proj_root = os.path.join(home, ".claude", "projects")

# --- munged-name variants of the repo path (dots->dashes AND dots preserved) ---
# Claude Code names transcript dirs by munging the cwd; the convention changed over
# time, and a renamed repo leaves old `cwd` values inside files now living under the
# new name. Matching by DIR NAME (both variants) + cwd captures pre-rename history.
def munge(p, keep_dot):
    out = p.replace("/", "-").replace("_", "-")
    return out if keep_dot else out.replace(".", "-")
variants = {munge(REPO, False), munge(REPO, True)}

def dir_owned(name):  # transcript dir belongs to this repo (incl. worktree subdirs)?
    return name in variants or any(name.startswith(v + "-") for v in variants)

# --- collect files, tagging TRUSTED (this repo for sure) vs ARCHIVE (mixed bag) ---
trusted_files, archive_files = set(), set()
if os.path.isdir(proj_root):
    for name in os.listdir(proj_root):
        full = os.path.join(proj_root, name)
        if os.path.isdir(full) and dir_owned(name):
            trusted_files.update(glob.glob(os.path.join(full, "*.jsonl")))
    for f in glob.glob(os.path.join(proj_root, "*", "*.jsonl")):  # cwd-match fallback
        if f in trusted_files: continue
        try:
            with open(f, errors="replace") as fh:
                for _ in range(8):
                    line = fh.readline()
                    if not line: break
                    try: o = json.loads(line)
                    except: continue
                    cwd = o.get("cwd", "")
                    if cwd == REPO or cwd.startswith(REPO + "/"):
                        trusted_files.add(f); break
        except: pass
for arch in (os.path.join(REPO, "..", "claude-code-logs"),
             os.path.join(home, "claude-code-logs"),
             os.path.join(home, "Projects", "claude-code-logs")):
    arch = os.path.abspath(arch)
    if os.path.isdir(arch):
        archive_files.update(glob.glob(os.path.join(arch, "**", "*.jsonl"), recursive=True))
files = sorted(trusted_files | archive_files)

# --- load minimal records (tag archive records so we can cwd-filter them) ---
records = []
for f in files:
    _archive = f in archive_files and f not in trusted_files
    try:
        with open(f, errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line: continue
                try: o = json.loads(line)
                except: continue
                msg = o.get("message") or {}
                is_user = o.get("type") == "user"
                text = ""
                if is_user:
                    c = msg.get("content")
                    if isinstance(c, str): text = c
                    elif isinstance(c, list):
                        text = " ".join(b.get("text","") for b in c
                                        if isinstance(b, dict) and b.get("type") == "text")
                records.append({
                    "uuid": o.get("uuid"), "sid": o.get("sessionId"),
                    "cwd": o.get("cwd"), "ts": o.get("timestamp"),
                    "type": o.get("type"), "isMeta": o.get("isMeta", False),
                    "mid": msg.get("id"), "model": msg.get("model"),
                    "usage": msg.get("usage") or {}, "text": text[:600],
                    "archive": _archive,
                })
    except: pass

# --- dedupe raw lines by uuid (kills live/archive overlap) ---
seen_uuid, dd = set(), []
for r in records:
    u = r["uuid"]
    if u and u in seen_uuid: continue
    if u: seen_uuid.add(u)
    dd.append(r)
records = dd

# --- scope: trusted records all count; archive records must cwd-match the repo ---
def in_repo(r):
    if not r["archive"]:
        return True
    c = r["cwd"] or ""
    return c == REPO or c.startswith(REPO + "/")
recs = [r for r in records if in_repo(r)]
repo_sessions = {r["sid"] for r in recs if r["sid"]}
distinct_cwds = collections.Counter(r["cwd"] for r in recs if r["cwd"]).most_common(10)

# --- tokens: dedupe by message.id, split classes, per model ---
seen_mid = set()
tok = defaultdict(int)
by_model = defaultdict(lambda: defaultdict(int))
for r in recs:
    u, mid = r["usage"], r["mid"]
    if not u: continue
    if mid and mid in seen_mid: continue
    if mid: seen_mid.add(mid)
    cw = u.get("cache_creation_input_tokens", 0) or 0
    cc = u.get("cache_creation")
    if isinstance(cc, dict) and not cw:
        cw = (cc.get("ephemeral_5m_input_tokens", 0) or 0) + (cc.get("ephemeral_1h_input_tokens", 0) or 0)
    cls = {"input": u.get("input_tokens", 0) or 0, "output": u.get("output_tokens", 0) or 0,
           "cache_write": cw, "cache_read": u.get("cache_read_input_tokens", 0) or 0}
    m = r["model"] or "unknown"
    for k, v in cls.items():
        tok[k] += v; by_model[m][k] += v

# --- active time: sort timestamps, drop idle gaps > 15 min ---
def parse(ts):
    try: return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except: return None
times = sorted(t for t in (parse(r["ts"]) for r in recs) if t)
GAP, active = 15 * 60, 0.0
for a, b in zip(times, times[1:]):
    d = (b - a).total_seconds()
    if 0 < d <= GAP: active += d

# --- steering ---
CORR = re.compile(r"\b(no,|actually|instead|don'?t|do not|stop|revert|undo|that'?s (wrong|not)|"
                  r"not what i|go back|wrong|nope|why did you|you (broke|removed))\b", re.I)
user_prompts = corrections = interrupts = 0
corr_samples, first_prompt = [], {}
for r in sorted(recs, key=lambda r: (r["ts"] or "")):
    if r["type"] != "user" or r.get("isMeta"): continue
    t = (r.get("text") or "").strip()
    if not t: continue
    if "[Request interrupted by user]" in t:
        interrupts += 1; continue
    user_prompts += 1
    if r["sid"] not in first_prompt:
        first_prompt[r["sid"]] = {"ts": r["ts"], "text": t[:200]}
    if CORR.search(t):
        corrections += 1
        if len(corr_samples) < 10:
            corr_samples.append({"ts": r["ts"], "text": t[:180]})

print(json.dumps({
    "found_any": bool(files), "files": len(files), "records": len(recs),
    "tokens": dict(tok), "by_model": {m: dict(v) for m, v in by_model.items()},
    "active_seconds": round(active), "sessions": len(repo_sessions),
    "span": [times[0].isoformat() if times else None, times[-1].isoformat() if times else None],
    "steering": {"user_prompts": user_prompts, "corrections": corrections, "interrupts": interrupts},
    "distinct_cwds": distinct_cwds,
    "session_first_prompts": list(first_prompt.values()),
    "correction_samples": corr_samples,
    "transcript_files": files[:60],
}, indent=2))
```

If the JSON shows `found_any: false`, note "no transcripts located" in the report and lean on git history only. If `distinct_cwds` shows more than one project path (e.g. a predecessor name plus the current one), the repo was **renamed** — say so in the report ("built as `<old>`, later renamed `<new>`") and confirm against the first git commits rather than treating the older sessions as foreign.

## Step 2 — git history

```bash
git log --reverse --pretty=format:'%h%x09%aI%x09%s'   # chronological: hash, ISO date, subject
git log --shortstat --pretty=format:'%h %aI %s'        # for net-lines / churn
```
Also grab a rough size signal: total tracked LOC (`git ls-files | xargs wc -l 2>/dev/null | tail -1`) and file count. Use these for the human-effort estimate.

## Step 3 — pricing (use current rates, not memory)

Detect the model(s) from `by_model`. Get **current** per-MTok pricing — invoke the `claude-api` skill (or Skill tool) for it. Only if that's unavailable, fall back to the table below and **label it "rates as of training cutoff — verify"**:

| Model | Input | Output | Cache write (5m) | Cache read |
|---|---|---|---|---|
| Opus 4.x | $15 | $75 | $18.75 | $1.50 |
| Sonnet 4.x | $3 | $15 | $3.75 | $0.30 |
| Haiku 4.5 | $1 | $5 | $1.25 | $0.10 |

Cost per class = `tokens / 1e6 × rate`. Sum across classes and models. Note the 1M-context beta charges ~2× input/output on prompts over 200K tokens — mention as a caveat only if a `[1m]` model appears; don't try to reconstruct per-request sizes.

## Step 4 — write the report

Structure exactly this order. Keep tables compact.

```
# Build Report — <repo name>
_Generated <date> from Claude Code session logs + git history._

**At a glance:** built in ~<H> active hours across <N> sessions, ~$<cost>, roughly <Z>× faster than a solo human estimate. <one-line data-completeness note>

## Build sequence
| When | Phase | Trigger |
(scaffold/build → major features → fixes → ship; each row a timestamp + the commit hash/subject or the prompt snippet that kicked it off; derive from git log cross-referenced with session_first_prompts)

## Build time
| Metric | Value |
| Active wall-clock | <Hh Mm> (idle gaps >15 min excluded) |
| Sessions | <N> |
| Calendar span | <first> → <last> |

## Estimated cost (USD)
| Token class | Tokens | Rate ($/MTok) | Cost |
| Input / Output / Cache write / Cache read / **Total** |
Models: <list>. Rates source: <claude-api skill | fallback table (verify)>.

## Human-effort equivalent
| Metric | Value |
| Output | <commits> commits, <files> files, ~<net> lines |
| Mid-level dev estimate | ~<H> h (~<D> days) |
| Actual active build time | <from above> |
| Speed-up multiplier | ~<Z>× |
Assumptions: <state them — e.g. "~X production lines/day incl. testing & debugging">.

## Steering
| Metric | Count |
| User prompts | … |
| Course-corrections | … |
| Interrupts | … |
| Off-task reins (est.) | … (qualitative — judged from correction_samples) |

## Retrospective
<150–300 words>
```

## Tone for the retrospective

A fun, honest retrospective of how the build went — the strong runs, the blunders, the moments the wheel got yanked back (use `correction_samples` for real texture). Funny about the mistakes but **kind** — nothing that would embarrass someone reading it over their shoulder. **No inflated metrics.** If the data is thin, say so plainly rather than dressing it up. The numbers should be defensible: every figure traces to the script output, git log, or a stated assumption.

When done, print the absolute path to the written report.
