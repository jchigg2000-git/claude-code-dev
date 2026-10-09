---
name: build-status
description: Generate and open a local, auto-refreshing HTML "build status" dashboard for whatever repo this is invoked in — narrative step list, git commit trail, detected quality-gate pills, a findings log, questions for the owner and a comment box with a priority — from a per-repo state file (.claude/build-status.json). A deterministic CLI (~/.build-status/bin/build-status) does every write, render and page-server job; this skill does the judgment — attaching to an existing dashboard, Bootstrap, gates, phase changes, and what to record. Asks you to confirm a derived step list instead of inventing one, never asks or opens anything when nobody is attending, works in any repo (Node, Rust, Go or none), and never commits. Fire on `/build-status` or "show me the build status / open the build dashboard."
argument-hint: "[--done <step>] [--next-phase <label>] [--finding <text>] [--note <text>] [--phase <text>] [--gates] [--init] [--open]"
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion, Agent, SendMessage
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
| `--rename <step> <name>` | `bs step rename "<step>" --name "<name>"` (same matching; keeps the step's id and state) |
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
`bs ask --question "..." --severity red|amber|green [--context "..."] --recommend "..." --rationale "..."`
(red blocks work until answered; amber gets expensive to reverse; green is no rush). Unanswered
is `answer: null`. **Every open question carries a recommendation and its rationale.**
`--recommend` is the answer you'd take by default, and `--rationale` says in a sentence or two why.
The page shows both, with an **Accept recommendation** button that saves the recommendation (not
the rationale) as the owner's answer from the page, just as Save does (confirming stays a separate
click). Set or change them later with `bs recommend <qid> "..." --rationale "..."` (`""` removes
both). A question still missing one shows "No recommendation yet." on the page. The recommendation
comes from whoever asked the question, which is usually the main session. If @keeper finds an open
question without one, it asks the main session for a recommendation and rationale and records
them; it doesn't make one up.

**Answers given in chat**: `bs answer <qid> --via chat --quote-file -` with the owner's words,
verbatim, on stdin (a quoted heredoc, as above).
The page shows it as answered in chat. Only the owner's browser can confirm.

**Acting on answers**: an answer is acted on as soon as it's recorded; nothing waits for the owner
to confirm it. On the page an answered question has **Edit** and **Confirm**. With Edit the owner
changes the answer: it's marked edited, delivered again labelled updated, and unsettled. Confirm
hides the question for good. Once the work the answer asked for has landed, or nothing needed
doing and the decision is recorded, run `bs acted <qid> --note "<commit, or what was done>"`, and
the page hides that question too. The page shows only open questions and answers still being
worked, plus a count of the settled ones.

**Waiting on an answer**: run `bs await <qid> --timeout 4h` with the Bash tool's
`run_in_background` — it exits 0 with the answer quoted (the harness wakes you) or 2 on timeout.
A loop that never gets a prompt pulls with `bs answers --new`. Delivered answers are quoted from
the file, not confirmed in chat — act on them per the repo's rules.

**Comments from the owner.** The page's Overview has a comment box with a priority. A comment
lands in `comments[]` as `new`, and @keeper (or the main session, when no keeper runs) decides
when the main session hears it, so the owner can talk to a build without breaking its stride. The
priority sets how soon it arrives and how much weight it carries:

| Priority | Reaches the main session | Who decides what happens |
|---|---|---|
| low | held, then passed on with other comments when a step ends (within 4 h at most) | the keeper may route it alone: suggest it for the backlog, or settle a page/bookkeeping one itself |
| normal | at the next natural break (a step done, a merge or commit on main, the main session messaging the keeper), within 1 h | the main session: do it now if it's small and in scope, file it in the backlog, or decline with a reason |
| high | at the keeper's next pass (≤10 min), even mid-step | the main session weighs it before starting its next piece of work and says what it will do |
| urgent | at once | the main session stops at the next safe point (never leaving a broken tree) and deals with it first; if it disagrees, it asks the owner a red question rather than carry on |

Comments due at the same moment go as one message. Record each move, and the note is what the owner
reads on the page: `bs comment-status <cid> held --note "until the CarPlay fix lands"`, then `sent`,
then `filed --note "ROADMAP §5"`, `done --note "<commit>"` or `declined --note "<why>"`. The keeper
doesn't edit the roadmap; `filed` means the main session added it. The owner changing a comment's
priority sends it back to `new`. A comment that reads as the answer to an open question isn't
recorded as one: the note says to answer it on that question, and it's passed on at its priority.
`bs comments --wait` (with `run_in_background`) exits as soon as a new one lands. A comment given
in chat: `bs comment --priority <p> --text-file - <<'EOF'` with the owner's words, verbatim.

**If you truly must hand-edit** a field no verb covers: re-read immediately before writing,
change only that field, and serialize with Node `JSON.stringify(s, null, 2) + "\n"` or Python
`json.dumps(s, indent=2, ensure_ascii=False) + "\n"` — never Python's default `ensure_ascii`,
which rewrites every non-ASCII character.

## 6. State file, in brief

`.claude/build-status.json` (or a repo's `tools/build-status.json`): `repo`, `phase`, `steps[]`
(`{id, name, state: todo|active|done}`), `history[]` (closed phases), `gates[]`
(`{name, status}`), `measures[]` (`{id, value, provenance}`), `findings[]` (objects as above, or
plain strings), `note`, `questions[]` (`{id, question, severity, context, recommendation, rationale, answer,
answeredAt, answeredVia, answerQuote, editedAt, confirmed, confirmedAt, actedAt, actedNote}`; an
older file's `ratified` counts as confirmed), `comments[]` (`{id, text, priority:
low|normal|high|urgent, via, at, status: new|held|sent|filed|done|declined, statusAt, note, trail}`). Unknown keys are kept and ignored. Leave it
trackable unless the repo already ignores it; only the generated `build-status.html` is ignored,
and `render` adds that rule itself.

## 7. Hooks (optional, never installed by default)

`bs hooks-snippet` prints hook entries that deliver new answers into sessions (SessionStart,
UserPromptSubmit) and restore the state file if an edit breaks it (PostToolUse). Add them to
settings only when the owner asks. The Stop-hook variant (`hooks/hooks.stop.json`) is opt-in per
repo, for looping builds.

## 8. @keeper — a standing build-status agent

When this is invoked in a session that is running other agents or a long autonomous build (or the
owner asks for "@keeper"), keep one **sonnet** agent on the page for the rest of the session, named
**@keeper** (the owner addresses it that way; relay any "@keeper …" message to it with SendMessage).
Reuse the running one; spawn one only if none exists. It counts toward the session's agent cap.

Brief it with this section, plus the repo's `locate --json` result. @keeper:
- **Records** through the CLI verbs only (§5): every merge, measured result, owner answer acted on
  and decision, when it happens. The main session messages it at each such event; on every pass it
  also compares `git log` since its last pass with the findings and records what is missing.
- **Keeps the file and the page in sync:** after every change to the state file (its own, the main
  session's, or the owner's answers from the page), it renders — `bs render`, or for a
  `repo-generator` the repo's own generator — so the HTML never lags the JSON.
- **Keeps every open question recommended:** on every pass, each open question needs a
  recommendation and a rationale (§5). For any that lacks one, it asks the main session for both
  and records the reply with `bs recommend <qid> "..." --rationale "..."`. In a `repo-generator`
  repo, its own generator shows both, with the Accept button, and has a test for it.
- **Relays owner answers:** new answers in `questions` go to the main session (SendMessage to
  "main") with the id and the answer verbatim; the main session acts on them per the repo's rules,
  without waiting for the owner to confirm. When it reports the work done, @keeper records
  `bs acted <qid> --note "..."`. On every pass it also checks answered questions not yet settled
  against `git log` and the findings, marks the finished ones acted on, and asks the main session
  about any it can't tell.
- **Paces the owner's comments** (§5): on every pass, and whenever `bs comments --wait` wakes it, it
  triages each `new` comment, holds or sends it as its priority says, quotes it verbatim, and
  records every move with `bs comment-status` and the main session's reply as the note. In a
  `repo-generator` repo, its own generator gets the same box, priority, endpoint and statuses,
  reading the same `comments` fields, with a test.
- **Owns how new things are shown.** When the build produces a new kind of result the page has no
  home for (a regression-gate series, per-class scores, a backlog, a model comparison), @keeper adds
  a small view for it — in a `repo-generator` repo's own generator, with a test, committed by path —
  and asks before restructuring the page, removing content, or changing how answers and
  confirming work. It asks the lead bookkeeper, or the main session when no lead is running.
  In a `generic` repo it proposes the view instead (the CLI is shared across repos, so it is not
  edited from one session).
- **Reports to the lead bookkeeper only** (`/lead-keeper`), a session outside every build that
  coordinates the keepers. The session's name is in `~/.build-status/lead/lead.txt`. While
  ListAgents shows that session, @keeper sends it by SendMessage everything it would otherwise
  report or ask: proposals, questions about the page, and work it took on. It uses the main
  session for its duties (relaying owner answers), and falls back to it only when no lead is
  running. The lead's messages reach @keeper through the main session, which relays any message
  starting with `@keeper`. If no @keeper is running, the main session answers it itself.
- **Follows standing orders.** When @keeper starts, it reads `~/.build-status/lead/orders.md`, if
  that exists, and follows the orders marked `(all)` or with its repo's name. It also follows any
  the lead sends it later. Orders let it act without asking anyone, but they stop at the Never
  list below, and the owner and the repo's own rules overrule them.
- **Stays on the books.** It doesn't leave bookkeeping to do the main session's work, with two
  exceptions. One is a build clearly running on its own (`locate --json` says `attended: false`,
  or the build is under /loop or /unleash). The other is work that fits between passes and costs
  less done by @keeper, whose context is already warm, than by a new agent. Either way, the work
  must be the kind the tier map gives sonnet. While it helps, it brings the books current at
  least once a minute (records what happened, renders), so the page is never more than a minute
  behind. It tells the lead in one line what it took on.
- **Never** commits the state file (the main session does), re-serializes it outside the verbs
  except as §5 allows (Node `JSON.stringify(s, null, 2) + "\n"` or Python with
  `ensure_ascii=False`), or starts/stops a page server other than the documented way.
- Between messages it runs a pass about every 10 minutes if its tools allow a timer; otherwise it
  passes whenever the main session messages it.

## 9. Report — short

```
<repo> — <done>/<N> steps, gate: <ok|warn|none>, <M> findings, <Q> open questions
<what changed: written | updated | unchanged>  →  <URL, or "already open, refreshes in ≤20s">
```

Add a line if Bootstrap ran (and whether it's an unconfirmed draft), if `render` replaced a stale
page server, or if it chose a new port. Never commit anything.
