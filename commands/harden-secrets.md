---
description: Deployment hardening step 1 — scan working tree + git history for secrets, verify .gitignore coverage, check npm-tarball/Railway env exposure. Read-only by default; --fix applies safe .gitignore + git rm --cached actions only. Never rotates credentials. Fire on `/harden-secrets` or "scan for secrets before deploy."
argument-hint: "[--fix] [--no-install] [scope path]"
allowed-tools: Bash(git:*), Bash(rg:*), Bash(find:*), Bash(npm:*), Bash(jq:*), Bash(gitleaks:*), Bash(trufflehog:*), Bash(brew:*), Bash(date:*), Bash(mkdir:*), Bash(file:*), Read, Glob, Grep, Write, mcp__railway__list_variables, mcp__railway__list_projects, mcp__railway__list_services, mcp__railway__whoami
---

# Harden: Secrets

Scan the working tree and git history for leaked credentials. Read-only unless `--fix` is passed.

Args: $ARGUMENTS

Parse flags from args:
- `--fix` → enable safe mutations (git rm --cached, .gitignore additions)
- `--no-install` → suppress brew install prompts
- remaining positional arg → scope path (default: repo root)

---

## Phase 0 — Pre-flight

```bash
# Repo identity
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --porcelain | head -20
git remote -v
```

**Target detection** (check all three):
- npm target: `package.json` present AND `"private"` is not `true`
- Railway target: any of `railway.json` / `railway.toml` / `Procfile` present, OR attempt `mcp__railway__whoami` (succeeds = linked)
- Public git: remote URL is on github.com, gitlab.com, codeberg.org, or sr.ht

**Tool detection**: run `which gitleaks` and `which trufflehog`. If either is missing and `--no-install` is not set, print:
```
Missing: <tool>. Install with: brew install gitleaks trufflehog
Proceeding with available tools; fallback path has reduced fidelity.
```
Record which scan path is active: `gitleaks` | `trufflehog` | `grep-fallback`.

---

## Phase 1 — Working-tree scan

Scope: the scope path argument (default: `.`).

Run the following pattern checks. For every match, read enough of the file to confirm it is not a test fixture or template before flagging.

**File-name/extension patterns** (case-insensitive):
- Extensions: `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.pkcs12`, `*.jks`, `*.keystore`
- Filenames containing: `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`, `credentials`, `private_key`, `api_key`, `apikey`
- `.env` files that are NOT `.env.example`, `.env.sample`, `.env.template`
- `*.kubeconfig`, `kubeconfig`

```bash
rg --files | rg -i '\.(pem|key|pfx|p12|pkcs12|jks|keystore)$|id_rsa|id_ed25519|id_ecdsa|id_dsa|credentials|private_key|api_key|apikey|\.kubeconfig'
find . -name '.env' -not -name '.env.example' -not -name '.env.sample' -not -name '.env.template' -not -path '*/node_modules/*'
```

**Content patterns** (run over non-binary files in scope):
```bash
# Provider token prefixes
rg --no-heading -n '(AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|xoxb-[0-9A-Za-z-]{50,}|sk-[A-Za-z0-9]{48}|sk_live_[A-Za-z0-9]{24}|AIza[0-9A-Za-z-_]{35}|glpat-[A-Za-z0-9_-]{20}|npm_[A-Za-z0-9]{36}|dckr_pat_[A-Za-z0-9_-]{50}|eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*)'

# Embedded-cred connection strings
rg --no-heading -n '(postgres|postgresql|mongodb|redis|mysql|amqp)://[^:@\s]+:[^@\s]+@'

# High-entropy standalone strings (≥40 chars, base64-like)
rg --no-heading -n '[A-Za-z0-9+/]{40,}={0,2}' | grep -v 'node_modules\|\.git\|\.lock\|package-lock\|yarn.lock\|pnpm-lock'
```

For each content match, inspect surrounding context (±3 lines). Fixtures are identifiable by: path contains `test`, `spec`, `fixture`, `mock`, `fake`; value is a known-bad placeholder like `EXAMPLEKEY` or all-zeros.

Severity: working-tree matches = HIGH (not yet committed history). Flag CRITICAL only if the file is also tracked (`git ls-files --error-unmatch <path>`).

---

## Phase 2 — Git-history scan

All Phase 2 hits are **CRITICAL** — credentials in history require rotation regardless of removal.

Choose scan path:
- **gitleaks available**: `gitleaks detect --no-banner --redact --report-format json --report-path /tmp/gitleaks-report.json && cat /tmp/gitleaks-report.json | jq '.[]' 2>/dev/null || echo "[]"`
- **trufflehog available (gitleaks not)**: `trufflehog git file://. --json --no-update 2>/dev/null | head -200`
- **fallback**: `git log -p --all -- . 2>/dev/null | rg -n '(AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{48}|sk_live_[A-Za-z0-9]{24}|glpat-[A-Za-z0-9_-]{20})' | head -100`

Record which path ran. Fallback path adds note: "reduced fidelity — install gitleaks for full coverage."

For each history hit: record file path, commit SHA, provider/type, redacted value excerpt.

---

## Phase 3 — .gitignore coverage

Check that each Phase-1 hit has a `.gitignore` match. Also check for these standard patterns regardless of whether they were hit:

```
.env
.env.local
.env.*.local
*.pem
*.key
id_rsa*
id_ed25519*
credentials
kubeconfig
*.kubeconfig
```

Run `git check-ignore -v <path>` for each Phase-1 file hit to confirm coverage.

Missing patterns → flag as MEDIUM; include proposed additions.

---

## Phase 4 — npm tarball (npm target only)

```bash
npm pack --dry-run --json 2>/dev/null | jq '.[0].files[].path'
```

Run Phase-1 content patterns over every file path that would be included. Any hit = **CRITICAL** (publicly published package).

Common gotcha: `.env` absent from both `.gitignore` and `files`/`.npmignore` — it gets packed silently.

---

## Phase 5 — Railway env diff (Railway target only)

For a Railway target this is a **first-class, high-value check**, not best-effort — it resolves most conditional-criticals (e.g. "is the prod-disabling env var actually set?"). Run it, don't skip it.

1. `mcp__railway__whoami` → `mcp__railway__list_projects` → for each project: `mcp__railway__list_services` → `mcp__railway__list_variables`
2. Extract code-referenced env vars from source: `rg 'process\.env\.([A-Z_]+)|os\.environ\[.([A-Z_]+).\]|os\.getenv\(.([A-Z_]+).\)|ENV\[.([A-Z_]+).\]'` (also catch helper-wrapped reads, e.g. `env("KEY", ...)`, where keys are literals)
3. Produce three buckets:
   - **Referenced-but-missing in Railway** → HIGH (will break prod)
   - **Set-in-Railway-but-unreferenced** → LOW (dead config)
   - **Present in code + Railway** → OK (just list for completeness)

**Secrets discipline:** report variable **presence and names only — never read, echo, or write a secret VALUE** into the plan/report. Mask to `<set, N chars>` (a 4-char suffix is acceptable only for non-secret identifiers). `list_variables` returns plaintext values; do not let them reach the report.

Fallback if not linked: diff `.env.example` (if present) against code-referenced vars — and say so **loudly**, emitting an explicit "verify these in the Railway dashboard before deploy" gate. Do not let a not-linked state silently read as "env checked OK."

---

## Phase 6 — Output

```bash
mkdir -p .claude/plans
TS=$(date +%Y%m%d-%H%M%S)
PLAN=".claude/plans/harden-secrets-${TS}.md"
```

Write the plan file with this structure:

```
# Harden: Secrets — Report

**Generated:** <ISO 8601>
**Targets:** [npm] [railway] [public-git]
**Scan tools:** <gitleaks X.X | trufflehog X.X | grep-fallback>
**Scope:** <path>
**Branch:** <branch>
**HEAD:** <sha>

## Summary

| Section | Count | Severity |
|---|---|---|
| 1. Working tree | N | HIGH / CRITICAL |
| 2. Git history | N | CRITICAL |
| 3. .gitignore coverage | N | MEDIUM |
| 4. npm tarball | N | CRITICAL |
| 5. Railway env | N | HIGH / LOW |

## Stop-the-line findings
<every CRITICAL: file:line or commit:sha — one line each>

## Section 1 — Working tree
<per finding: path, pattern matched, evidence excerpt (redacted), severity, tracked?>

## Section 2 — Git history
<per finding: file, commit SHA, type, redacted excerpt, scan tool>

## Section 3 — .gitignore coverage
<missing patterns with proposed additions>

## Section 4 — npm tarball
<only if npm target; per finding: packed path, pattern matched>

## Section 5 — Railway env
<Missing in Railway | Dead config | OK — per var>

## Required follow-up (user)
- Rotate every credential found in git history — assume compromised.
- History rewrite (git filter-repo / BFG) — out of scope for this command. Decide separately.

## Fix-mode actions
<only if --fix; list each safe action applied>
```

---

## Phase 7 — --fix mode (only if --fix was passed)

Safe actions only — each requires no further confirmation (they are safe by definition):

1. For each Phase-1 **tracked** file hit: `git rm --cached "<path>"` (preserves local copy)
2. For each missing `.gitignore` pattern from Phase 3: append to `.gitignore`

**Will NOT**:
- Rotate, invalidate, or modify any credential
- Rewrite git history
- Modify Railway env vars
- Edit `.npmignore` or `files` in `package.json` (ambiguous intent)
- Auto-commit the changes (user commits separately)

Print each action taken. End with: "Local copy preserved. Working tree now has untracked secrets files — add to .gitignore was applied. Commit the .gitignore change separately."

---

## Chat summary (always, after plan file is written)

Output ≤10 lines:
- Plan file path
- Count of CRITICALs (with file paths for each)
- Count by section (1-5)
- Suggested next: `/harden-auth` or `/harden-for-deploy`

Do not enumerate non-CRITICAL findings in chat. Plan file is the source of truth.

---

## Hard rules

- Never rotates credentials
- Never rewrites git history
- Never modifies Railway env
- Never auto-commits anything
- Never flags a file as CRITICAL without reading enough to confirm it's not a fixture
