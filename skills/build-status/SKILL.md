---
name: build-status
description: Generate and open a local, auto-refreshing HTML "build status" dashboard for whatever repo this is invoked in — narrative step list, git commit trail, detected quality-gate pills, a findings log and questions for the owner — from a per-repo state file (.claude/build-status.json). A deterministic CLI (~/.build-status/bin/build-status) does every write, render and page-server job; this skill does the judgment — attaching to an existing dashboard, Bootstrap, gates, phase changes, and what to record. Asks you to confirm a derived step list instead of inventing one, never asks or opens anything when nobody is attending, works in any repo (Node, Rust, Go or none), and never commits. Fire on `/build-status` or "show me the build status / open the build dashboard."
argument-hint: "[--done <step>] [--next-phase <label>] [--finding <text>] [--note <text>] [--phase <text>] [--gates] [--init] [--open]"
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

# /build-status

Two halves. **The CLI** — `~/.build-status/bin/build-status`, called `bs` below — does every
write (locked, atomic, patched by id), renders the page, and runs one small page server per
worktree on a free local port. `bs` below is shorthand only — every Bash call is a fresh shell, so
write the full path each time. **You** decide what goes in: which dashboard to attach to, the
starting step list, gate results, phase changes, what counts as a finding. Never hand-edit or
re-serialize the state file when a verb covers it — the page server writes answers into the same
file while it's open.

If `~/.build-status/bin/build-status` is missing, install first: `node ~/.claude/skills/build-status/install.mjs`.
`bs --help` lists every verb and exit code.

**Quoting.** Put text in single quotes (`--summary 'It's…'` breaks — use `'It'"'"'s'`), or, for
anything verbatim from the owner, a quoted heredoc on stdin so the shell never touches it:
`bs answer <qid> --via chat --quote-file - <<'EOF'` … `EOF`.

**Exit 4 — the state file doesn't parse.** Don't write around it. Say so, and name the file. If
an edit just broke it, fix the JSON (the last copy build-status wrote is
`.git/build-status.last-good.json` in that worktree — it can predate other writers, so compare
first). If it can't be saved, Bootstrap with `init --force`: a file that doesn't parse is backed
up into the git dir and replaced.

## 1. Locate — always first

```bash
~/.build-status/bin/build-status locate --json
```

- `kind: "repo-generator"` — the repo already has its own dashboard (`tools/build-status.mjs`
  plus `tools/build-status.json`). **Attach to it**: to show the page, run the repo's own generator
  (`node tools/build-status.mjs`); never bootstrap a second state file, never start or stop a
  page server for it. The record verbs (`finding`, `ask`, `step`, `note`, `answer`) still work on
  its state file.
- `kind: "generic"` — carry on with Arguments.
- `kind: "none"` — Bootstrap (section 3).
- `attended: false` — nobody is watching this session (headless, a scheduled or looping agent).
  Then: never use AskUserQuestion, never claim a port-registry port, never open a browser.
  Bootstrap still writes a list — `init` marks it an unconfirmed draft by itself — and your
  report says so.

## 2. Arguments → verbs

| `$ARGUMENTS` | Do |
|---|---|
| *(none)*, `--refresh` | `bs render` — re-render; reuses the running page server, replaces it if its code is stale |
| `--done <step>` | `bs step done "<step>"` (numeric id or name substring; ambiguous → it lists the steps and exits 3: pick, don't guess) |
| `--finding <text>` | `bs finding --summary "<text>"`, adding `--kind`, `--importance`, `--detail-file` when you know them (section 5) |
| `--note <text>` | `bs note "<text>"` (`bs note ""` clears) |
| `--phase <text>` | `bs phase "<text>"` — renames; doesn't move on |
| `--next-phase <label>` | Derive the new step list as Bootstrap does and confirm it (attended), then `bs next-phase "<label>"` and `bs step add "<name>"` per step. If steps are still open it refuses and lists them: ask before `--force` — a phase abandoned mid-way is worth noticing |
| `--gates` | Run the detected gates including tests (section 4); record each with `bs gate <name> "<status>"` |
| `--init` | Bootstrap again, with `bs init ... --force` (the old file is backed up, never overwritten) |
| `--open` | `bs render --open` |

After any change, `bs render` and report. Open the page (`bs render --open`) when asked, or when
render prints "page server started" in an attended session — nobody has that page open yet.

## 3. Bootstrap (kind `none`, or `--init`)

Derive a starting step list rather than asking for one:
1. A root `ROADMAP.md` open set (checklist items or bullets under Now / Next / Open), `todo`, in file order.
2. Else another plan surface: `PLAN.md`, `TODO.md`, `docs/plan*`, `docs/roadmap*`, the newest `docs/handoffs/*.md`.
3. Else the last ~12 commit subjects (`git log --pretty=%s -12`), all `done` — never invent forward steps from history.

Attended: show the list, then AskUserQuestion (header `Build status`, "Use this as the starting
step list?"): **Use it** (default) or **Start empty instead**. Then:

```bash
bs init --steps-json '["First step", "Second step"]' [--phase "<label>"]    # or --steps-json '[]'
```

Steps from commit history are already done: pass them as objects,
`--steps-json '[{"name":"Ship the parser","state":"done"}]'`. The first `todo` becomes `active`
automatically. `--init` on a state file that parses replaces only its steps (and phase); findings,
questions, answers and history stay. Unattended: skip the question and run the same
`init` — the page and your report will call it an unconfirmed draft; `bs confirm` clears that
once the owner accepts it. There is no port to claim: the page server picks a free port per
worktree and remembers it (`bs render --port N` pins one if the owner wants a fixed URL). If
`init` notes the file is git-ignored in this repo, pass that on — the state then stays local.

## 4. Gates

Detect, first match wins, and record every result with `bs gate <name> "<status>"`:
- **Node** (`package.json`): scripts matching `typecheck`/`type-check`/`tsc`, `lint`, `test`;
  runner from the lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm run).
- **Rust** (`Cargo.toml`): `cargo check`, `cargo clippy --quiet` if installed, `cargo test`.
- **Go** (`go.mod`): `go build ./...`, `go vet ./...`, `go test ./...`.
- **Makefile** only: whichever of `make lint` / `make test` / `make check` exist.
- **None**: record nothing; the page says "no gates detected". Never fail over a missing runner.

Typecheck/lint/vet run on every invocation that re-checks gates; the **test** gate only with
`--gates` (or once during an attended Bootstrap, with consent). Status is the tool's own short
words — `"clean"`, `"3 problems"`, `"112 passed, 1 skipped"`; the page colours it by keyword. A
state file that keeps gates as a `gate` object belongs to the repo's own tooling; `bs gate`
refuses to write it, so leave it.

## 5. What to record, and when

The findings log is only worth reading if it's complete, so record each finding **when it
happens**, not at the end of the session:
- a measured result — an eval, benchmark, test or accuracy figure worth quoting (a range and a floor with the number of runs, and what the misses were, not a best run);
- a merge of a round, branch or phase into the main line (what it built, what the gate measured);
- an owner decision acted on — when the work an answered question asked for starts or lands, quoting the answer;
- a decision recorded in the repo's decision log, including a proposal considered and not adopted.

```bash
bs finding --summary "One line the list shows" --kind measure --importance 2 --detail-file /tmp/detail.md
```

Kinds: `research`, `bug`, `decision`, `correction`, `measure`, `milestone`, `blocker` (others
render neutrally). Importance: 3 changes a headline result, finds or closes a path to a wrong
result or a security or privacy exposure, or records an owner decision or change of direction; 2
is a fix merged, a review's findings, a measured experiment; 1 is notes and housekeeping.
`--date` defaults to today; use the day it happened. Detail supports paragraphs, `- ` bullets and
fenced blocks; everything else is escaped. Before a session ends, compare
`git log --since=<newest finding's date>` with the log and record what's missing.

**Questions for the owner** — only decisions a human must make, not TODOs you could resolve:
`bs ask --question "..." --severity red|amber|green [--context "..."]` (red blocks work until
answered; amber gets expensive to reverse; green is no rush). Unanswered is `answer: null`.

**Answers given in chat**: `bs answer <qid> --via chat --quote-file -` with the owner's words,
verbatim, on stdin (a quoted heredoc, as above).
The page shows it as answered in chat. Only the owner's browser can ratify.

**Waiting on an answer**: run `bs await <qid> --timeout 4h` with the Bash tool's
`run_in_background` — it exits 0 with the answer quoted (the harness wakes you) or 2 on timeout.
A loop that never gets a prompt pulls with `bs answers --new`. Delivered answers are quoted from
the file, not confirmed in chat — act on them per the repo's rules.

**If you truly must hand-edit** a field no verb covers: re-read immediately before writing,
change only that field, and serialize with Node `JSON.stringify(s, null, 2) + "\n"` or Python
`json.dumps(s, indent=2, ensure_ascii=False) + "\n"` — never Python's default `ensure_ascii`,
which rewrites every non-ASCII character.

## 6. State file, in brief

`.claude/build-status.json` (or a repo's `tools/build-status.json`): `repo`, `phase`, `steps[]`
(`{id, name, state: todo|active|done}`), `history[]` (closed phases), `gates[]`
(`{name, status}`), `measures[]` (`{id, value, provenance}`), `findings[]` (objects as above, or
plain strings), `note`, `questions[]` (`{id, question, severity, context, answer, answeredAt,
answeredVia, answerQuote, ratified, ratifiedAt}`). Unknown keys are kept and ignored. Leave it
trackable unless the repo already ignores it; only the generated `build-status.html` is ignored,
and `render` adds that rule itself.

## 7. Hooks (optional, never installed by default)

`bs hooks-snippet` prints hook entries that deliver new answers into sessions (SessionStart,
UserPromptSubmit) and restore the state file if an edit breaks it (PostToolUse). Add them to
settings only when the owner asks. The Stop-hook variant (`hooks/hooks.stop.json`) is opt-in per
repo, for looping builds.

## 8. Report — short

```
<repo> — <done>/<N> steps, gate: <ok|warn|none>, <M> findings, <Q> open questions
<what changed: written | updated | unchanged>  →  <URL, or "already open, refreshes in ≤20s">
```

Add a line if Bootstrap ran (and whether it's an unconfirmed draft), if `render` replaced a stale
page server, or if it chose a new port. Never commit anything.
