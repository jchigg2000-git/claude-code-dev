---
name: verify
description: Run this repo's own fast checks (lint, typecheck, unit tests) and stop on red. Claude Code runs it right before each commit; also fire on /verify.
allowed-tools: Bash(npm run:*), Bash(pnpm run:*), Bash(yarn run:*), Bash(npx tsc:*), Bash(make:*), Bash(ruff:*), Bash(mypy:*), Bash(pytest:*), Bash(python3 -m pytest:*), Bash(cargo check:*), Bash(cargo test:*), Bash(go vet:*), Bash(go test:*), Read, Glob, Grep
---

# Verify (pre-commit, fast)

Find the repo's own fast checks, in this order, first match per kind:
1. A `/run-skill-generator` recipe for this project.
2. `package.json` scripts: `lint`, `typecheck` (or `tsc --noEmit` if a `tsconfig.json` exists),
   `test:unit` else `test`. Use the lockfile's package manager.
3. `Makefile` targets: `lint`, `check`, `test`.
4. `pyproject.toml` / `setup.cfg`: `ruff check`, `mypy` (if configured), `pytest -q`.
5. Cargo: `cargo check`, `cargo test`. Go: `go vet ./...`, `go test ./...`.

## Rules
- Fast only: skip e2e, integration, and anything needing a database, a missing `.env`, or the
  network. Say which you skipped.
- About 60s total. If a suite runs longer, run what fits, then say what didn't run.
- Never edit files, never install dependencies. No `node_modules` → that check is skipped; say so.
- No checks found → one line, and the commit goes ahead.

## Report
One line per check: pass / FAIL / skipped (why).
Any FAIL → stop: don't commit; show the failing output (trimmed to the error) and where the work is.
