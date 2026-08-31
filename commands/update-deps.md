---
description: Safely update this repo's Node dependencies — detect package manager + workspaces, group outdated by semver bump, prompt on load-bearing calls (majors, breaking changelogs, peer-dep/Node conflicts), apply, run the full check suite, and hand off to /shipit on green. Stops red, offers rollback. Fire on `/update-deps`.
argument-hint: "[--dry-run] [--no-ship] [scope path]"
allowed-tools: Bash(npm:*), Bash(pnpm:*), Bash(yarn:*), Bash(bun:*), Bash(npx:*), Bash(node:*), Bash(jq:*), Bash(rg:*), Bash(git:*), Bash(cat:*), Bash(ls:*), Read, Glob, Grep, WebFetch
---

# Update: Node dependencies

Update Node packages across the repo without introducing breaking changes silently. Patch/minor bumps apply automatically; anything load-bearing stops for a decision; nothing ships until the full check suite is green.

Current state:
- Repo root: !`git rev-parse --show-toplevel 2>/dev/null || echo "NOT A GIT REPO"`
- Branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null`
- Dirty manifests/lockfiles: !`git status --porcelain 2>/dev/null | rg -i 'package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock' || echo "(clean)"`
- package.json locations (any depth, excl. node_modules): !`git ls-files '**/package.json' 'package.json' 2>/dev/null | grep -v node_modules || echo "(none tracked)"`
- Lockfiles (any depth): !`git ls-files '**/package-lock.json' '**/pnpm-lock.yaml' '**/yarn.lock' '**/bun.lock*' 'package-lock.json' 'pnpm-lock.yaml' 'yarn.lock' 'bun.lock*' 2>/dev/null | grep -v node_modules || echo "(none tracked)"`

> The Node project is frequently **not at the repo root** (e.g. a `web/` front end beside a `server/` in another language). Detect the directory that actually holds the target `package.json` + lockfile, and run every `npm`/`pnpm`/`yarn`/`bun` command below **from that directory** — not blindly from the repo root.

Args: $ARGUMENTS

Parse flags:
- `--dry-run` → run Phases 0–2 only (assess + decisions), apply nothing, ship nothing
- `--no-ship` → run through verify, stop before `/shipit`
- remaining positional → scope path (default: repo root)

---

## Phase 0 — Pre-flight

1. If "Repo root" above is `NOT A GIT REPO`, stop — rollback depends on git. Offer `git init` only if the user asks.
2. **Rollback safety:** if the "Dirty manifests/lockfiles" line is anything other than `(clean)`, the manifest and/or lockfile already has uncommitted edits. Rolling back a failed update would clobber them. Stop and confirm with the user (commit/stash first) before proceeding.
3. **Package-manager detection** (lockfile wins over `packageManager` field):
   - `package-lock.json` → **npm**
   - `pnpm-lock.yaml` → **pnpm**
   - `yarn.lock` → **yarn** (check version: `yarn --version` — v1 "classic" vs berry differ on commands)
   - `bun.lockb` / `bun.lock` → **bun**
   - No lockfile but a `packageManager` field in `package.json` → use that; otherwise default to npm and note that no lockfile was found.
4. **Workspace/monorepo detection:** check for `workspaces` in root `package.json`, `pnpm-workspace.yaml`, or a `packages/`-style layout. Enumerate every `package.json` (excluding `node_modules`):
   ```bash
   git ls-files '**/package.json' 'package.json' | rg -v node_modules
   ```
   Record whether this is a single package or a workspace set — it changes the outdated/update commands below.

---

## Phase 1 — Assess (what's outdated)

Run the detected PM's outdated report from the package directory. Add the recursive/workspace flag if Phase 0 found a workspace set.

> **Exit code:** `npm outdated` / `pnpm outdated` exit **1** when anything is outdated (not an error). Append `|| true` and judge success by whether you got parseable JSON, not by exit status.

```bash
# npm
npm outdated --json --long $WORKSPACE_FLAG || true   # --workspaces for workspace sets
# pnpm
pnpm outdated --format json -r              # -r recurses workspaces
# yarn v1
yarn outdated --json
# yarn berry
yarn outdated --json   # or: yarn upgrade-interactive (do NOT run interactive here)
# bun
bun outdated
```

Parse into a table; for each package record: **current**, **wanted** (satisfies current range), **latest**, dependency type (`dependencies` vs `devDependencies` vs `peerDependencies`), and which workspace it lives in.

**Group by semver bump** (current → latest):
- **patch** (`x.y.Z`) and **minor** (`x.Y.z`) → low risk, auto-apply candidates
- **major** (`X.y.z`) → **the breaking-change boundary** — these require a decision
- `0.x.y` packages: treat a **minor** bump as breaking (pre-1.0 semver gives no minor stability guarantee) — escalate to the major/decision bucket.

---

## Phase 2 — Assess risk on the decision bucket

For every package in the major / pre-1.0-minor bucket, gather signals before asking the user:

1. **Changelog / release notes.** Resolve the repo URL and fetch the breaking-changes section:
   ```bash
   npm view <pkg> repository.url homepage deprecated --json
   ```
   Use WebFetch on the project's CHANGELOG / GitHub releases for the target version. Summarize **only** breaking changes between current and latest — migrations, removed APIs, dropped runtimes. If the changelog can't be found, say so explicitly (don't assume "safe").
2. **Deprecation.** If `npm view … deprecated` is non-empty, flag it.
3. **Peer-dependency conflicts.** Check the new version's `peerDependencies` against what's installed:
   ```bash
   npm view <pkg>@<latest> peerDependencies --json
   ```
   Flag any peer that the bump would violate (forces another upgrade, or an unmet peer).
4. **Node-version / `engines`.** If `npm view <pkg>@<latest> engines.node` raises the floor above this repo's Node (`.nvmrc` / `.node-version` / root `engines.node` / CI matrix), flag it — the bump may force a runtime upgrade.

---

## Phase 3 — Decide (prompt on load-bearing calls)

Present the decision bucket in **one batch**, each row with its risk signals:

```
<pkg>  <current> → <latest>  [MAJOR]
  • breaking: <one-line summary, or "changelog not found">
  • peer/engines: <conflict, or "none">
  • deprecated: <yes/no>
  [a] apply   [p] pin to a safe interim version   [s] skip
```

Decision rules:
- **patch/minor** (the low-risk bucket): apply without asking — just list what will change.
- **major / pre-1.0-minor / any with a flagged conflict**: do **not** apply without an explicit `a`. Default to skip.
- If the user picks `p`, ask which interim version (e.g. the latest non-breaking within the current major).

If `--dry-run`: print the full plan (auto-apply set + decision bucket with recommendations) and **stop here**. Apply nothing.

---

## Phase 4 — Update

Apply in two passes so a failure is easy to attribute:

1. **Low-risk pass** — patch/minor:
   ```bash
   # npm:   npm update [names...]        (respects ranges; bumps within them)
   # pnpm:  pnpm update [names...] -r
   # yarn:  yarn upgrade [names...]      (berry: yarn up [names...])
   # bun:   bun update [names...]
   ```
2. **Approved-major pass** — one explicit install per approved package so the manifest range moves:
   ```bash
   # npm:   npm install <pkg>@<version>
   # pnpm:  pnpm add <pkg>@<version>     (-r / --filter for a specific workspace)
   # yarn:  yarn add <pkg>@<version>     (berry: yarn add)
   # bun:   bun add <pkg>@<version>
   ```

The install/update steps refresh the lockfile automatically — confirm the lockfile is in the diff. Do **not** hand-edit lockfiles.

---

## Phase 5 — Verify (full check suite)

Read the root (and each affected workspace's) `package.json` `scripts`. Run, in order, only the steps that exist — but always do a clean install:

1. **Clean install** (proves the lockfile resolves from scratch):
   ```bash
   npm ci         # pnpm i --frozen-lockfile  /  yarn install --immutable  /  bun install --frozen-lockfile
   ```
   If `npm ci` fails because the lockfile is out of sync, that's a real failure — stop.
2. **Build** — `scripts.build` if present.
3. **Typecheck** — `scripts.typecheck`, else `npx tsc --noEmit` if TypeScript is a dependency.
4. **Lint** — `scripts.lint` if present.
5. **Tests** — `scripts.test` if present (skip the npm placeholder `"echo \"Error: no test specified\""`).

For a workspace set, run the suite at the root if root scripts orchestrate workspaces; otherwise run per affected workspace.

**On any failure — STOP. Do not ship a red build.** Report which step failed with its output, then offer rollback:

```bash
# restore manifests + lockfile to pre-update state, then reinstall
git restore package.json package-lock.json **/package.json   # adjust lockfile name per PM
npm ci
```

Wait for the user to choose: roll back, or attempt a fix (e.g. drop the offending package back a version and re-verify). Never auto-rollback without asking — they may want to debug from the broken state.

---

## Phase 6 — Ship

Only on a fully green suite, and only if `--no-ship` was **not** passed:

- **cwd matters.** `/shipit` runs `git` via inline commands against the *current* working directory. If this command was invoked from a parent dir that isn't the repo (e.g. `~/Projects` while the repo is `~/Projects/<name>`), the handoff will operate on the wrong tree. Ensure cwd is the repo root first; if you can't guarantee that, run the equivalent git pipeline yourself from the repo root (branch → stage → commit → push → switch main → `pull --ff-only` → `merge --no-ff` → push main → delete local + remote branch). The build artifact dir (`dist/`) and `node_modules` must already be gitignored — confirm before staging.
- Hand off to `/shipit`. Let shipit own branch/commit/push/merge — don't duplicate its git work here.
- Suggest a commit message summarizing the bumps, e.g. `chore(deps): bump <N> packages (<major list>)`. Note that the changes may live in a subdir (`web/package.json`, lockfile, + any source fix like a `vite-env.d.ts`).

If `--no-ship`: stop with the working tree updated and verified; tell the user the suite is green and they can `/shipit` when ready.

---

## Chat summary

Output ≤10 lines:
- Package manager + whether it's a workspace set
- Auto-applied (patch/minor) count
- Major decisions: applied / pinned / skipped (name them)
- Verify result per step (build/typecheck/lint/test: pass/fail/skip)
- Shipped? (yes via /shipit · held for --no-ship · stopped red · dry-run)
- Anything skipped or unverified (e.g. "changelog not found for X")
