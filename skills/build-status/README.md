# build-status (tier 1)

`/build-status` as a skill plus a deterministic CLI. The skill (`SKILL.md`) makes the judgment
calls: attach or bootstrap, the starting step list, gates, and what counts as a finding. The CLI
(`scripts/cli.mjs`, called through `~/.build-status/bin/build-status`) does every write, renders
the page, and runs one small page server per worktree. A status update is one short Bash call,
not a model turn. Measured on the old one-file command, a no-op refresh cost $0.68 and 4 minutes,
because the model re-typed a 67 KB generator on every call.

```
SKILL.md                 the LLM half (153 lines; the old command was 1,563)
install.mjs              install / --rollback (moves the old ~/.claude/commands/build-status.md aside and back)
hooks/hooks.json         opt-in: answers into sessions (SessionStart, UserPromptSubmit), post-edit repair
hooks/hooks.stop.json    opt-in: Stop-hook delivery for looping builds (verified live on Claude Code 2.1.283)
scripts/cli.mjs          verbs: finding ask answer step note phase next-phase gate init confirm
                         locate status answers await render stop ls hook hooks-snippet version
scripts/lib/
  paths.mjs              checkout identity, per-worktree files in the git dir, ~/.build-status layout
  write.mjs              the one write path: O_EXCL lock (broken only if its holder is dead),
                         re-read, patch by id, temp + fsync + rename, re-check for unlocked writers
  normalize.mjs          one read view of either state shape (gates[] or gate{}, plain findings)
  state.mjs              attach before bootstrap: a repo's own generator wins; attended detection
  render.mjs             the page as a pure function; ctx.extraTabs is the seam for repo-specific tabs
  page.mjs git.mjs       what render needs; the static file:// copy
  daemon.mjs serve.mjs   the page server: front door, per-worktree port, stale-build replacement
  answers.mjs hooks.mjs  answers into sessions: ledgers, await, answers --new, post-edit restore
test/                    node --test --test-concurrency=1 test/*.test.mjs
```

## Install / roll back

The canonical copy is `~/.claude/skills/build-status` — edit it in place. Run from there,
`install.mjs` only (re)writes the launcher and config; run from a clone it copies the skill in first.

```bash
node install.mjs              # → ~/.claude/skills/build-status, ~/.build-status/bin/build-status
node install.mjs --rollback   # removes an installed copy + launcher, puts the old command back; never the canonical copy
```

Hooks are never installed automatically. `build-status hooks-snippet` prints the entries.

## Rules that matter

- **Attended vs unattended.** A headless or looping session (`CLAUDE_CODE_SESSION_ATTENDED=0`)
  never gets a question, a registry port claim or a browser. Bootstrap writes an unconfirmed
  draft, and the page says so.
- **A repo with its own dashboard** (`tools/build-status.mjs` + `tools/build-status.json`) is
  attached to, never rendered, served or stopped. The record verbs still write its state file
  through the lock.
- **Only provable processes are signalled.** The daemon's ping says `impl: "generic"` with this
  root, and its command line is `cli.mjs daemon --root <root> --key <key>`. A matching file-name
  hash alone never counts.

## Deferred on purpose

- The git merge driver: 0 conflicts in 48 hours of real use.
- A shared per-machine hub that every repo reports to, and the emit path into it: not built;
  they wait on a go/no-go decision.
- A training-watch layer (Experiments/Models tabs): planned separately. It will plug in through
  `ctx.extraTabs`.
