#!/usr/bin/env python3
"""ux-tournament cost meter — price a Claude Code session (top level + subagents) from local transcripts.

Method: scan the session's top-level .jsonl and every file under <session-id>/ recursively, dedupe
assistant messages by message.id (resumed sessions replay turns), sum usage per model, price cache
reads and cache writes separately. Cache writes use the ephemeral_1h/5m split when the usage block
has it; otherwise 1h is assumed (Claude Code's default TTL).

Usage:
  cost.py --cwd <repo> [--session <id> | --latest] [--since ISO] [--until ISO] [--subagents-only] [--json]
  cost.py --project-dir ~/.claude/projects/<encoded> --session <id>

Rates are $/MTok (input, output, cache_read, cache_write_5m, cache_write_1h). Verified 2026-09-19
against the claude-api skill table (cached 2026-06-24). Re-verify when a model changes.
"""
import argparse, glob, json, os, re, sys

RATES = {
    "claude-fable-5-1": (10.0, 50.0, 0.25, 12.5, 20.0),
    "claude-mythos-5-1": (10.0, 50.0, 0.25, 12.5, 20.0),
    "claude-fable-5":   (10.0, 50.0, 1.00, 12.5, 20.0),
    "claude-opus-5":    (5.0, 25.0, 0.50, 6.25, 10.0),
    "claude-opus-4-8":  (5.0, 25.0, 0.50, 6.25, 10.0),
    "claude-opus-4-7":  (5.0, 25.0, 0.50, 6.25, 10.0),
    "claude-opus-4-6":  (5.0, 25.0, 0.50, 6.25, 10.0),
    "claude-sonnet-5":  (2.0, 10.0, 0.20, 2.5, 4.0),
    "claude-sonnet-4-6": (3.0, 15.0, 0.30, 3.75, 6.0),
    "claude-haiku-4-5": (1.0, 5.0, 0.10, 1.25, 2.0),
}
TIER = {"fable": "fable", "mythos": "fable", "opus": "opus", "sonnet": "sonnet", "haiku": "haiku"}


def rate_for(model):
    m = re.sub(r"-\d{8}$", "", model or "")
    for k in sorted(RATES, key=len, reverse=True):
        if m.startswith(k):
            return RATES[k]
    return None


def tier_for(model):
    for k, v in TIER.items():
        if k in (model or ""):
            return v
    return "other"


def encode_cwd(path):
    return re.sub(r"[^A-Za-z0-9]", "-", os.path.abspath(path))


def iter_files(project_dir, sid):
    top = os.path.join(project_dir, f"{sid}.jsonl")
    subs = glob.glob(os.path.join(project_dir, sid, "**", "*.jsonl"), recursive=True)
    return top, sorted(subs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cwd")
    ap.add_argument("--project-dir")
    ap.add_argument("--session")
    ap.add_argument("--latest", action="store_true")
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--subagents-only", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    pdir = a.project_dir or os.path.join(os.path.expanduser("~/.claude/projects"), encode_cwd(a.cwd or os.getcwd()))
    if not os.path.isdir(pdir):
        sys.exit(f"cost: project dir not found: {pdir}")
    sid = a.session
    if not sid:
        tops = [p for p in glob.glob(os.path.join(pdir, "*.jsonl"))]
        if not tops:
            sys.exit("cost: no sessions in " + pdir)
        sid = os.path.basename(max(tops, key=os.path.getmtime))[:-6]
    top, subs = iter_files(pdir, sid)
    files = ([] if a.subagents_only else [top]) + subs
    files = [f for f in files if os.path.exists(f)]

    seen = set()
    per = {}
    n_msgs = 0
    for f in files:
        with open(f, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    m = json.loads(line)
                except Exception:
                    continue
                if m.get("type") != "assistant":
                    continue
                msg = m.get("message") or {}
                u = msg.get("usage")
                if not u:
                    continue
                ts = m.get("timestamp") or ""
                if a.since and ts < a.since:
                    continue
                if a.until and ts > a.until:
                    continue
                mid = msg.get("id") or m.get("uuid")
                if mid in seen:
                    continue
                seen.add(mid)
                n_msgs += 1
                model = msg.get("model") or "unknown"
                d = per.setdefault(model, {"input": 0, "output": 0, "cache_read": 0, "cw_5m": 0, "cw_1h": 0})
                d["input"] += u.get("input_tokens", 0) or 0
                d["output"] += u.get("output_tokens", 0) or 0
                d["cache_read"] += u.get("cache_read_input_tokens", 0) or 0
                cc = u.get("cache_creation") or {}
                if cc:
                    d["cw_5m"] += cc.get("ephemeral_5m_input_tokens", 0) or 0
                    d["cw_1h"] += cc.get("ephemeral_1h_input_tokens", 0) or 0
                else:
                    d["cw_1h"] += u.get("cache_creation_input_tokens", 0) or 0

    rows, total, unpriced, by_tier = [], 0.0, [], {}
    for model, d in sorted(per.items()):
        r = rate_for(model)
        toks = d["input"] + d["output"] + d["cache_read"] + d["cw_5m"] + d["cw_1h"]
        if r:
            usd = (d["input"] * r[0] + d["output"] * r[1] + d["cache_read"] * r[2] + d["cw_5m"] * r[3] + d["cw_1h"] * r[4]) / 1e6
        else:
            usd = None
            unpriced.append(model)
        rows.append({"model": model, "tokens": toks, "usd": usd, **d})
        if usd is not None:
            total += usd
            t = tier_for(model)
            by_tier[t] = round(by_tier.get(t, 0.0) + usd, 4)

    out = {"session": sid, "project_dir": pdir, "files": len(files), "subagent_files": len(subs),
           "messages": n_msgs, "since": a.since, "until": a.until, "models": rows,
           "usd_total": round(total, 2), "usd_by_tier": by_tier, "unpriced_models": unpriced}
    if a.json:
        print(json.dumps(out, indent=2))
        return
    print(f"session {sid[:8]}  files {len(files)} (subagents {len(subs)})  assistant msgs {n_msgs}")
    if a.since or a.until:
        print(f"window {a.since or '-'} .. {a.until or '-'}")
    print(f"{'model':26s} {'tokens':>10s} {'in':>9s} {'out':>9s} {'cache_rd':>11s} {'cw_5m':>9s} {'cw_1h':>9s} {'usd':>9s}")
    for r in rows:
        usd = f"${r['usd']:.2f}" if r["usd"] is not None else "unpriced"
        print(f"{r['model'][:26]:26s} {r['tokens']/1e6:9.2f}M {r['input']:9d} {r['output']:9d} {r['cache_read']:11d} {r['cw_5m']:9d} {r['cw_1h']:9d} {usd:>9s}")
    print(f"TOTAL ${total:.2f}   by tier: " + ", ".join(f"{k} ${v:.2f}" for k, v in by_tier.items()))
    if unpriced:
        print("unpriced models (add to RATES): " + ", ".join(unpriced))


if __name__ == "__main__":
    main()
