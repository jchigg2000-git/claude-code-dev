---
description: Generate a focused, token-frugal unit + regression test suite for the current repo, then confirm UI functionality
argument-hint: "[optional: path/module to focus on]"
---

# Generate test suite

Generate a **focused, high-value** set of unit and regression tests for this repo. Hit the high points — do **not** aim for exhaustive coverage. Be token-frugal throughout.

Optional focus target: `$ARGUMENTS` (a path, module, or feature). If empty, pick the highest-value targets yourself.

## 1. Detect the stack (don't ask, infer)

- Identify language, package manager, and the existing test framework/runner (pytest, jest/vitest, go test, cargo test, rspec, etc.).
- Reuse the repo's existing test conventions, helpers, and directory layout. If **no** framework exists, choose the conventional one for the stack and state that choice in one line.

## 2. Pick high-value targets

Prioritize, in order:
1. The focus target in `$ARGUMENTS`, if given.
2. Core business logic and pure functions with real branching.
3. Error-prone or known-fragile paths (parsing, money/dates, auth, state transitions).
4. Recently changed files (`git diff` / recent commits) if the tree has history.

Skip trivial getters, glue code, and framework boilerplate.

## 3. Write the tests

- **Unit tests** for the targets above.
- **Regression tests** for obvious edge cases and any bug-prone behavior.
- Cap the first pass at a **handful of test files** (≈3–6). Mirror existing naming/structure. Don't restate the obvious in comments.

## 4. Run and report

- Run the new suite with the repo's runner.
- Report pass/fail **concisely** — counts and any failures, not full logs.

## 5. Confirm UI (only if there's a frontend)

Lightweight smoke check, **not** full E2E:
- A render/component test for a key view, **or**
- Boot the dev server and confirm it starts and the main route responds.

Skip this step entirely for backend/CLI/library repos.

## Constraints

- Keep token usage low: summarize rather than dumping full files; don't over-explain.
- Never modify application code — write tests only. Flag (don't fix) any bug a test exposes.

## Closeout (always end with this)

One short block:
- **Tested:** what got covered
- **Passing / failing:** results
- **Skipped:** what was intentionally left out and why
