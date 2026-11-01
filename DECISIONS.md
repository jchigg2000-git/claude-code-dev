# claude-code-dev — DECISIONS

Append-only. Newest at the bottom. A decision is never rewritten: a later entry supersedes it and
names the one it replaces. `ROADMAP.md` holds the open set; this file holds what the owner settled.

## 2026-10-25 — prompt-improver's mirror copy stays frozen at its current version
**Ratified by you** (`/ask-me` chip selection). Your words: "Freeze mirror copy".
The fork: `/sync-claude-slash` Phase 1 auto-updates every mirrored skill, so the next sync would
publish `meter.py` (imports the held-out `doc-consolidation/usage_gate.py`) and `calibration.json`
(account usage stats) — ROADMAP §1 MIRROR-10.
Rejected: "Rework, then publish" (standalone meter, gitignored calibration); "Pull it from mirror"
(git rm + not-first-party).

## 2026-10-25 — Plugin marketplace first slice is `harden` + `machine-health`; the rest of PLUG-2's grouping stays open
**Ratified by you** (`/ask-me` chip selection). Your words: "First slice only".
The fork: PLUG-2's seven-plugin grouping (ROADMAP §2), agent-proposed 2026-09-26.
Rejected: "Ratify the grouping" (all seven); "Never mine — drop it".

## 2026-10-25 — Sweeps move to Desktop scheduled tasks only; no cloud sweeps
**Ratified by you** (follow-up to `/ask-me`, after deferring with "not sure what i'm giving up").
Your words: "Desktop only".
The fork: HARN-2 (ROADMAP §3) — built-in schedulers for the sweeps, agent-proposed by the 2.1.310
handoff.
Rejected: "Both, spike first" (Desktop + cloud `/schedule` report sweeps); "Never mine — drop it".
