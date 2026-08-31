Crawl this repo to determine the single best next action to resume work. Read-only — do not modify any files.

  Scope: the current working directory only (not sibling repos or parent directories).

  Delegate the investigation across parallel subagents where the searches are independent (git state, TODO scan,
  branch survey, planning docs, test status, mid-edit file detection). Each subagent reports a conclusion, not raw
  output.

  Investigate:
  - Git state: `git status`, staged vs. unstaged diffs, current branch, last 10 commits, stash list
  - Branches: local branches not merged to the default branch (main/master/trunk), with last-commit age
  - Code markers: TODO / FIXME / HACK / XXX added or touched in the last ~30 days (use `git log -p -S` or blame to
  date them, not just current presence)
  - Planning surfaces: ROADMAP.md, TODO.md, NOTES.md, CHANGELOG.md, docs/, any planning/scratch directories (e.g.,
  .claude/plans/, .claude/scratch/, .notes/), any *.md modified recently at repo root
  - Tests: failing, skipped, or `.skip` / `xit` / `@pytest.mark.skip` / `#[ignore]` / `t.Skip` markers added recently
   (adapt to the language/test framework in use)
  - Mid-edit signals: files modified in the last ~7 days containing stub functions (`pass`, `throw new Error("not
  implemented")`, `panic("todo")`, `unimplemented!()`, `TODO: implement`), large commented-out blocks, or unresolved
  merge markers

  Recency definition: "recent" = touched within 14 days; "stale" = older than 30 days. Cite file:line for every
  claim.

  Report format (markdown, terse):

  ## 1. Where I left off
  The most recent thread of work — single paragraph + bulleted file:line citations. If the most recent thread is
  ambiguous (multiple parallel threads with similar recency), say so and list the candidates instead of picking one.

  ## 2. Other open threads
  Bulleted, ranked oldest-touched last. For each: one-line description, file:line or branch name, last-touched date,
  why it looks unfinished.

  ## 3. Recommended next action
  One concrete next step. Include: the specific file(s) or branch to start from, the first command or edit to make,
  and a one-sentence reason citing which thread it resumes. If nothing is genuinely in progress, say so explicitly
  and recommend either closing out cleanly or picking from the roadmap — don't fabricate urgency.

  If you skipped any investigation area (e.g., no test runner detected, no planning docs found, not a git repo), list
   it under a final "## Skipped / couldn't verify" section. Don't pad missing sections.