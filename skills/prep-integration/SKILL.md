---
name: prep-integration
description: >
  Prepare THIS repo to be dropped into someone else's environment — a client site, a
  partner tenant, an enterprise landing zone — and emit a copy-pasteable build spec for
  whatever tool will do the wiring on the inside (GitHub Copilot, Cursor, Codex, Claude
  Code). Recons the six seams that always decide integration work (data access, config,
  auth/principal, packaging/runtime, demo-data contamination, network egress), then runs
  a two-round chip interview whose every option cites a real file and a real consequence
  in this repo — including what tooling and what workstation you will actually have on the
  inside, since that changes the shape of what gets built — then runs a pre-flight
  hardening gate (secrets, dependency audit, scoped updates, lint baseline) because none of
  that is fixable from inside an air-gapped tenant, then writes the branch, the
  `integration/` folder, a staged on-site discovery runbook that begins BEFORE the network
  cutoff (external access usually ends at VPN login, not at travel), the source-to-target
  column mapping the host DBA fills in, and — when the repo becomes commit one in the host's
  own VCS — the pre-first-commit scrub. Also emits the field log the on-site agent fills in, and
  consumes a returned one via `--harden-from` to improve itself. Never guesses a source column;
  never strips a seam something else depends on. Fire on `/prep-integration` or "prep this for a client site /
  we're moving this into their environment / build me the integration branch and mapping
  doc."
---

# Prep Integration

The job: take an app that works **here** and make the seams it will be re-pointed at
**there** explicit, env-driven, and documented — before anyone is sitting in a client
conference room burning the engagement clock on discovery.

The premise this skill is built on: **integration failures are almost never about the
code that reads the data. They are about the four questions nobody wrote down** — what
the join key actually is, which fields were only ever synthetic, what the host tenant
blocks on the way out, and what quietly breaks when you rip out auth.

Scope: **the current working directory only.**

## What this does NOT do

- **It does not do the integration.** It produces the branch, the mapping doc, and the
  spec prompt. The actual wiring happens inside the host environment, usually with a
  different tool. Emitting is the whole job unless `--scaffold` is passed.
- **It does not invent a source column, a table name, a hostname, or a credential.**
  `UNMAPPED` is a valid, correct cell. A plausible guess in a mapping doc is worse than
  a blank, because it gets built on.
- It does not add CI/CD — most of these are prototypes going to exactly one host, and a
  pipeline is not the ask.
- It does not write a test suite. Targeted tests pinning a specific new seam only;
  anything broader is `/generate-test-suite`.
- It does not merge to `main` or push.

---

# PHASE 0 — Recon the six seams (read-only, before any question is asked)

**Recon comes first and is non-negotiable.** The interview in PHASE 1 is only worth the
user's attention if every option names a real file and a real consequence *in this repo*.
A generic question set is the failure mode this skill exists to prevent.

Delegate the independent sweeps to parallel subagents on a cheap model — this is
mechanical extraction. Judgment happens in PHASE 1, in the main context. Each sweep
returns findings with `file:line` citations.

### Seam 1 — Data access

The single biggest scope fork. Determine which of these is true:

- **(a) A seam exists.** There is an interface/protocol/ABC that all reads go through,
  with 2+ implementations. Grep for a type with multiple `implements`/`: Protocol`/
  `interface` conformances, a `providers/`, `adapters/`, `repositories/`, or `data/`
  directory, or a factory selecting on an env var. **Integration = fill an implementation.**
- **(b) A stub already exists for the target system.** Even better — someone already
  wrote the unavailable-provider shape. Find it; it usually documents its own
  preconditions in a header comment. **Integration = fill the stub.**
- **(c) No seam.** SQL/ORM calls scattered through route handlers. **Integration =
  build the seam first**, and that is a materially larger job that the user must be told
  about *before* the interview, not discovered mid-build.

Record: the interface file, its method list, the reference implementation that works
today, and the selection mechanism.

### Seam 2 — Configuration

- Is there a single config module (`config.ts`, `settings.py`, `Config` struct) or is
  `process.env` / `os.getenv` / `os.Getenv` read at call sites? Count the scattered reads.
- Is there a `.env.example`? Does it cover everything actually read?
- Are there hardcoded hostnames, ports, schema names, bucket names, or connection
  strings in source, tests, fixtures, or deploy manifests? `rg -n
  '(postgres|mysql|mongodb|jdbc|db2|mssql)://|\.database\.|amazonaws\.com|\.blob\.core|localhost:[0-9]{4}'`
- Does anything fall back **silently** to a local/dev default when production config is
  missing? That is a landmine on site — it looks like it works and serves the wrong data.

### Seam 3 — Auth and the principal

The trap this seam hides: **auth is rarely just login.** Before recommending any strip,
enumerate everything downstream that reads the authenticated principal:

- role / permission / tenant filtering of query results
- per-account rate limits and spend caps
- audit trail and event attribution
- feature or view visibility (if roles and views/lenses are the same objects, deleting
  auth deletes the view model)

Record: the guard location, the public-route allowlist, the admin-route allowlist, and
the full list of downstream principal consumers. **The default recommendation is always
"bypass the gate behind a mode flag, keep the principal", not "delete auth"** — unless
recon proves nothing downstream consumes it.

### Seam 4 — Packaging and runtime

- Existing `Dockerfile` / `compose` / deploy manifests, and what platform they assume.
- **Fixed-UID and writable-path assumptions.** OpenShift/ARO runs containers as an
  arbitrary non-root UID in group 0; anything that `chown`s to a fixed UID, writes beside
  a file it does not own, or creates SQLite WAL/journal files in a non-group-writable
  directory fails at boot. Check for `USER <n>`, `chown`, volume mounts, and any
  write-probe or lazy-write path.
- Privileged ports (<1024), hostPort bindings, and whether an injected `PORT` is honored.
- Health and readiness endpoints — their exact paths, and whether they are on the public
  allowlist. Probes that hit a gated path fail closed and the pod never goes ready.
- **Native / compiled dependencies and target architecture.** Anything with a build step
  or a prebuilt binary — `better-sqlite3`, `ibm_db`, `oracledb`, `psycopg2`, `grpcio`,
  Sharp, Prisma engines. For each: does a prebuild exist for the deploy arch, and for the
  *workstation* arch someone will develop on? Container platforms are effectively always
  `linux/amd64`; Apple-Silicon workstations are `arm64` and several enterprise DB drivers
  (IBM's especially) have poor or no arm64 story. Record the list — it is what makes the
  workstation question in ROUND B load-bearing rather than noise.
- **Build-time network needs, and WHEN external access ends.** Does the image build reach a
  package registry? Does any dependency fetch a second payload at install time (native DB
  drivers routinely download a client library from the vendor, separate from the registry)?
  **Establish the moment external access is lost.** It is very often *VPN login*, not travel —
  a full-tunnel client kills public egress the second it connects, on a laptop that had it a
  minute earlier. Everything that must come from outside is then a **pre-cutoff** task, and
  discovering that at the wrong end of the tunnel costs a session, not a minute.

### Seam 5 — Demo-data contamination

The embarrassing failure: demoing synthetic numbers to the client who owns the real ones.

- Is seed/fixture/demo data **baked into the image** or committed to the repo? (`COPY
  db/*.db`, checked-in `.db`/`.parquet`/`seed*.sql`/fixtures.)
- Is there any path where the app silently falls back to it when the real source is
  unreachable?
- Are there `showcase` / `demo` / `sample` flags or routes still reachable?
- Which fields in the read model are **synthetic-only** — invented for the demo with no
  real upstream? These are the fields that vanish or need a new source on real data, and
  they must be marked as such in the mapping doc. This list usually only exists in a
  design/discovery doc, not in code.

### Seam 6 — Network egress

A host tenant will block most of this, and each block is a silent runtime failure:

- Outbound LLM / AI provider calls, and whether a tenant-local alternative is already
  configured (an Azure/Bedrock/Vertex code path sitting unused next to a public one).
- Telemetry, error reporting, analytics endpoints.
- Runtime fetches of reference data, code sets, map tiles, fonts, CDN assets.
- Package-registry access at build time if they build inside the tenant.

Record each with its config key and whether it can be disabled by config alone.

### Also collect

- **Schema DDL** for the read model — this is the *target* side of the mapping doc.
- **Any prior discovery/design doc** describing the real source system. Repos that were
  built from a real catalog often carry one, and it is the *only* honest source for the
  upstream side of the mapping. Read it for what it actually claims: a doc that says
  "definition-only catalog, every label synthesized" is telling you most of your mapping
  rows are `SYNTHETIC`, not `mapped`.
- Existing parity/smoke harnesses worth extending rather than replacing.
- **Generated SQL or API calls with a minimum server version.** Pagination syntax, null-ordering,
  window functions and JSON operators all have version floors, and on an older host they fail as
  *syntax errors* rather than wrong answers. Grep the shared query layer for them and turn each
  into a version blank in the discovery runbook, with the local workaround named — this is
  cheap to write down and expensive to diagnose cold.

**Report the recon in ~10 lines before asking anything**, leading with the data-seam
verdict (a/b/c) because it sets the size of the whole job.

---

# PHASE 1 — The interview

**Two rounds, maximum 4 chips each, chips not prose.** Every option must name a real file,
a real config key, or a real consequence found in PHASE 0.

- **ROUND A — shape.** What the integration *is*: system of record, read path, auth
  disposition, landing zone. These decide the workstreams.
- **ROUND B — delivery.** What the work will be *done with and on*: the harness inside the
  wall, the workstation, the network posture, the optional add-ons. These decide the
  artifacts' form.

Run A, fold the answers, then run B with what A settled removed. Skip ROUND B entirely if
recon plus ROUND A already answered all of it — two rounds is a cap, not a quota.

## Disqualified — never ask

- Anything PHASE 0 already answered. If the repo has exactly one plausible source system
  and a stub for it, do not ask "which source system" — state it and move on.
- Anything cheaply reversible later. Directory names, doc filenames, branch naming.
- Anything the user cannot know yet. If the answer is genuinely "we find out on site,"
  that is not a question — that is a row in the mapping doc.

## ROUND A — shape

1. **System of record.** What is the app actually reading from over there? Options should
   be grounded: the stubbed system, the plausible alternatives for that stack, and an
   explicit "unknown — discover on site" whose consequence (a provider-agnostic scaffold
   instead of a filled implementation) is stated.
2. **Read path.** Live reads through the seam / ETL-copy into an app-owned store and
   reuse a working implementation / hybrid. This decides whether the mapping doc is a
   *SQL translation contract* or an *ETL spec* — say so in the option descriptions.
3. **Auth disposition.** Bypass-the-gate-keep-the-principal (recommend this by default,
   and name the downstream consumers from Seam 3 that survive) / full strip (name what
   breaks) / keep it and seed an account. If the user is replacing it with a specific IdP
   later — Entra, Okta, Ping, Auth0 — capture that, because it determines where the seam
   comment goes.
4. **Landing zone.** ARO/OpenShift, vanilla K8s, Azure Container Apps, ECS, a VM, on-prem
   Docker. Only ask if recon could not infer it. This decides the manifest set and the
   arbitrary-UID question.

## ROUND B — delivery

5. **The harness inside the wall.** *Always ask this — it changes the shape of every
   artifact, not just its phrasing.* What tooling will actually be available on the
   inside, and it is frequently not what is available out here:

   - **An agentic CLI (Claude Code, Codex CLI, Cursor agent).** Ship a single spec
     document plus a repo-root instructions file the agent reads itself. It can run
     commands, so discovery ships as executable probe scripts.
   - **An in-editor assistant (GitHub Copilot in VS Code / JetBrains).** Weaker
     multi-file execution and a smaller working context. Chunk the spec into
     **one self-contained prompt per workstream**, each restating its own ground truth,
     ordered so they can be pasted in sequence. Do not emit one monolithic spec it will
     silently truncate.
   - **No AI tooling permitted** — common in regulated tenants, and the answer that
     changes the most. The deliverable stops being prompts entirely: every workstream
     becomes a human runbook with explicit commands, and discovery becomes the primary
     artifact rather than a preamble.
   - **Unknown / decided on arrival.** Emit the human-runnable form, since it degrades
     gracefully — an agent can consume a runbook, but a human cannot consume a prompt.

   Capture the model too if an agent is named; it sets how much ground truth to inline.

6. **Workstation OS and architecture.** **Ask only when Seam 4 found at least one of:** a
   container image to build, a native/compiled dependency, or shell scripts among the
   deliverables. Otherwise skip and keep the slot. When it is live, it decides three
   concrete things and you should say which in the option descriptions:

   - **Cross-arch builds.** Container targets are effectively always `linux/amd64`. From
     an Apple-Silicon workstation that means `--platform linux/amd64` plus emulation, or a
     remote/in-cluster build — discovering this on site costs an afternoon.
   - **Native driver availability.** Enterprise DB drivers (IBM's above all) frequently
     ship no arm64 macOS prebuild. If Seam 4 flagged one, an Apple-Silicon answer makes
     "prove the driver installs" the very first discovery step.
   - **Shell dialect and line endings.** Everything runnable must be emitted in the shell
     they actually have — POSIX (`bash`/`zsh`) or PowerShell, and Windows-native is *not*
     WSL2. Emit `.ps1` alongside `.sh`, or a single dialect, but never a bash script for a
     PowerShell-only workstation. Add `.gitattributes` for CRLF if Windows is in play.

   Options: macOS Apple Silicon / macOS Intel / Windows + WSL2 / Windows native
   (PowerShell) / Linux.

7. **Network posture inside the tenant — and when external access ends.** Ask if Seam 6 found
   outbound calls, or a build that needs a package registry, or any install-time vendor
   download. Two dimensions, and the second is the one people forget:

   - **What is reachable from inside**: open / corporate proxy with TLS interception (needs
     `HTTP(S)_PROXY` + a custom CA in the image *and* in the driver's own TLS config) / fully
     air-gapped.
   - **When does outside access stop?** Options that actually occur: *stays available* (split
     tunnel, or a second machine) / *ends at VPN login* (full tunnel — the common one) / *ended
     already* (handed a machine with no egress at all).

   **"Ends at VPN login" is the answer that reshapes the runbook**, because the cutoff is a
   moment the user controls and can accidentally cross. It makes a **pre-cutoff dependency
   pull** stage 1 of the emitted discovery runbook — ahead of connectivity checks, which cannot
   run until after the thing that closes the window. Air-gapped or proxied additionally makes
   dependency vendoring a before-you-travel task. Either way it belongs at the top of the
   emitted checklist, never inside a workstream that assumes it can reach a registry.

8. **Add-ons** (`multiSelect: true`). The optional workstreams recon surfaced — container
   fixes, deploy manifests, tenant-local AI provider, demo-data quarantine, observability
   shipping. Always include **"pack my toolbag"** as an option: a scrubbed, translated
   subset of my own commands, in the inside harness's native format, so the tooling I
   rely on exists over there. Selected ⇒ run `/pack-toolbag` in PHASE 2, passing the
   ROUND B harness answer so it does not re-ask.

Fold answers straight into PHASE 2. Do not confirm, do not restate them back.

---

# PHASE 1.5 — Pre-flight hardening gate

**Runs before the branch is cut, not as a workstream the inside tool inherits.** Two facts
make the timing non-negotiable:

- **You cannot patch a vulnerability from inside an air-gapped or TLS-intercepted tenant.**
  Whatever versions travel in are the versions you are stuck with for the engagement.
- **Enterprise landing zones scan images on push and block on findings.** ACR/Defender,
  OpenShift admission, Harbor, ECR — a critical in the *production* tree is a rejected
  deploy, not a comment on a report.

Delegate to the existing commands; do not reimplement any of this. Run in this order,
because each one's failure invalidates the next. (`/harden-for-deploy` runs the fuller
series — reach for it when the host wants a complete hardening report, but note it also
generates tests and Railway-flavored config checks that are wrong for this purpose.)

1. **`/harden-secrets`** — working tree *and* git history. A credential already committed
   is a stop-everything, and it must be found before the repo is handed to anyone else's
   environment. Never rotate silently; report and let me rotate.
2. **`/harden-deps`** — the ecosystem-native audit, **full tree and production-only
   separately**. Production-only is the number that gates the deploy; dev-only findings are
   noise for this purpose and should be labelled as such, not fixed reflexively.
3. **`/update-deps`** — but **scoped**. Patch, minor, and anything that is the fix for a
   finding from step 2. **Majors are deferred by default** — a breaking bump days before a
   client engagement is risk with no upside, unless it *is* the CVE fix, in which case take
   it and run the full check suite.
4. **`/harden-lint`** — linter, type-checker, formatter. The goal is **a green baseline,
   not clean code.** On site you will make fast changes in an unfamiliar environment with a
   weak-context assistant, and a green typecheck is the only cheap signal that you broke
   something. A baseline that was already red is worthless as a signal. Never silence a
   rule to reach green.
5. **`/harden-licenses`** — only when the host is an enterprise. Their OSS/legal review
   will ask for a dependency license inventory, and a GPL/AGPL package inside a
   proprietary client deployment is a blocker discovered at the worst possible time. If
   they require an SBOM, generate it here where the toolchain works.

## Thresholds

Set from the ROUND A/B answers, and state them rather than assuming:

- **Host platform scans images** ⇒ production-tree critical and high are **blocking**.
  Fix, or record an accepted-risk line with the reason — an unexplained finding will be
  bounced back by their security review and cost days.
- **Air-gapped or proxied tenant** ⇒ everything above is a hard gate, and
  **vendoring happens after the audit, never before.** Auditing a vendored bundle you
  already committed is the wrong order.
- **Open network inside** ⇒ the gate is advisory; findings can be fixed on site.

## Record the baseline

Write `integration/baseline.md`: audit counts by severity for both trees, lint and
typecheck status, runtime and toolchain versions, the resolved dependency versions that
matter, and the date. This is what answers *"was this already broken before I touched it?"*
at hour six on site — the single cheapest thing to capture now and the most expensive to
reconstruct later.

## Commit separately

In `--scaffold` mode this lands as its own commit ahead of any integration work. The diff
the host's team reviews must not mix *"we wired your data"* with *"we bumped forty
packages."*

## And on site

New dependencies land during integration — the database driver above all. Put a
**re-run of the audit after the driver is installed** into `integration/README.md`'s
checklist. This gate is a baseline, not a one-time event.

---

# PHASE 2 — Emit

## 2.1 The branch

Name it `integration/<host-or-platform>` (e.g. `integration/client-aro`). Create it only
under `--scaffold`; otherwise just state it in the spec prompt.

## 2.2 The `integration/` folder

Always at the repo root, always named `integration/` — the host's team will look for it
there and nowhere else.

- **`integration/discovery.md`** — the kickoff. **Written first, run first, and it is the
  highest-value page in the folder.** See § The discovery contract below.
- **`integration/README.md`** — what this folder is, the on-site order of operations
  (discovery → mapping → implement → parity), and what to do *before travelling* (vendor
  dependencies if the tenant is air-gapped, confirm driver availability for the
  workstation arch). Write it for someone with a laptop, a VPN, and 45 minutes before the
  next meeting.
- **`integration/source-target-mapping.md`** — see § The mapping contract below.
- **Probe scripts** in the workstation's shell dialect, if the ROUND B answers say a shell
  is available — `integration/probes/*.sh` or `*.ps1`, referenced by `discovery.md`. When a
  cutoff exists, the **pre-cutoff pull is the first of them**, and it is the one that must also
  work on a machine where nothing has been installed yet.
  Where the two sides of a boundary can disagree — a VM or WSL guest versus its host — emit the
  probe for **both** and say that the comparison is itself the diagnostic. A guest that cannot
  resolve DNS while the host can is a guest-networking problem, not the host tenant's firewall,
  and that distinction saves hours of asking the wrong team.
- **The toolbag**, if that add-on was selected — delegated to `/pack-toolbag` with the
  ROUND B harness answer. It lands wherever the inside assistant actually reads from
  (`.github/prompts/`, `.claude/`, `.cursor/rules/`, or `integration/runbooks/`), not in
  a folder of my choosing. Link it from `integration/README.md`.
- **`integration/env-contract.md`** or an updated `.env.example` — every variable the app
  reads, one-line purpose, marked required/optional for a host run.
- **Handover artifacts**, when the repo will become commit one of a repository in the host's own
  VCS rather than travelling as a git remote — a scrub script and the generated change-rationale
  file. See § The handover contract.
- **`integration/FIELD-LOG.md` plus its egress packager — ALWAYS.** See § The feedback contract.
  This is the only artifact whose audience is this skill rather than the host, and it is the only
  reason the next engagement starts from a better position than this one.
- Deploy manifests under `integration/<platform>/` if the add-on was selected.

## 2.3 The spec prompt

A single fenced block, clean enough to paste into the downstream tool with zero editing.
No meta, no change notes, no mode words inside the fence. Structure it as:

1. **Branch + do-not-merge instruction.**
2. **Ground truth** — a bullet list of the exact files the downstream tool must read
   before writing code, each with a one-line statement of what it is. This is the highest-
   leverage section: it stops the other tool re-deriving what PHASE 0 already established,
   and it stops it "helpfully" refactoring a seam it did not understand.
3. **One section per workstream**, each with concrete acceptance criteria.
4. **Constraints** — what must not change (the interface, the shared DTOs, the UI), no
   CI/CD, no broad test suite, `TODO(integration):` markers instead of guessed values,
   and a closing instruction to report done / stubbed-pending-access / blocked.

Then, **outside the fence**, a short provenance note: which requirements came from the
user's answers and which the skill authored. Agent-authored requirements get a
`CLAUDE-ORIGIN` tag if they land in a committed file.

---

# PHASE 3 — Harden from a returned field log

Triggered by `--harden-from=<path>`. **This mode does not prep anything** — it does not recon, does
not interview, does not touch the current repo's integration branch. It edits *this skill* and, if
they exist, the emitted templates it produces. Run it in the harness repo, not at a client.

1. **Read the log in full.** It is small by construction.
2. **Group entries by `Class`**, because the class determines the shape of the fix:
   - `wrong-assumption` → **correct the assertion.** Find where this skill or its templates state
     the wrong thing and fix the statement. This is the best kind of entry: it makes the output
     smaller and more accurate, not bigger.
   - `wrong-order` → **re-sequence.** A stage in the wrong place, or a question asked too late to
     change what got built.
   - `missing-artifact` → **add**, but only after asking whether an existing artifact should have
     covered it. Extending beats creating; a new file is the most expensive fix available.
   - `wrong-format` → **change the emitted form**, not the content. Usually a ROUND B answer that
     was wrong or never asked — the shell dialect, the harness, the workstation.
   - `unknowable-in-advance` → **change nothing.** Record it and move on. Resisting these is what
     keeps the skill usable.
3. **Weight by cost, not by count.** One entry that cost half a day outranks five that cost ten
   minutes. The log records cost for exactly this reason.
4. **Prefer replacing to adding.** Before every edit, ask what this makes *unnecessary*. A skill
   that only grows becomes one nobody reads to the end, and the sections most likely to be skipped
   are the ones added last.
5. **Honour the wins.** An entry saying a stage earned its place is a note not to trim it in a later
   pass looking for length.
6. **Report the diff as: corrected / added / re-sequenced / deliberately ignored.** The last
   category matters most — it is the record of what was consciously left alone, so the next pass
   does not relitigate it.

Never copy a client-specific detail out of a log into this skill, even if it survived the egress
check. Generalise it: "a warehouse whose driver downloads a second payload at install time", not
that client's driver.

---

---

# The discovery contract

`integration/discovery.md` is the first thing anyone opens on site. It is a **staged
runbook that terminates in filled-in blanks**, and those blanks are the inputs to
everything else.

**It is not a second mapping doc.** The mapping doc says *what a field should map to*;
discovery says *what is actually reachable, authenticated, populated, and true*. If a fact
belongs in a table of fields, it goes in the mapping doc. Keep the boundary sharp or both
documents rot.

**Two governing constraints.**

*Discovery runs before the app can boot.* Config is not right yet — that is what discovery is
for. So probes must be **standalone**, not `npm run <anything>` against the app, and must
degrade to a bare shell command when a script cannot be run. Order them cheapest-first: never
debug a driver when the real problem is DNS.

*Some windows close instead of opening.* Every other stage gets easier once you are on the
host's network; the dependency pull gets **impossible**. So the runbook does not start at
connectivity — it starts one stage earlier, off the tunnel, and states plainly when it is safe
to connect. Ordering these two wrong is the most expensive mistake the runbook can contain,
because the recovery is "disconnect and start the day again."

## Stages

Each stage gets: the question it answers, a runnable command in the workstation's shell
dialect, **a blank to record the answer**, and a **STOP gate** — the explicit statement that
later stages are meaningless until this one passes.

**-1. Pre-cutoff dependency pull.** *Only when ROUND B question 7 says external access ends at
some point the user crosses — which is usually VPN login.* Everything that must come from
outside, fetched and **verified loadable** while it still can be. Emit it as a script, and end
it with an explicit "safe to connect now" gate plus a `--verify` mode for re-checking later.

Ordering inside this stage is load-bearing and is worth stating in the emitted script, because
each of these has bitten:

  - **Package-manager install first.** A clean install (`npm ci`, `pip install -r`, …) typically
    *wipes* the dependency directory, so anything installed before it is destroyed.
  - **Then the out-of-band native driver**, installed without touching the manifest or lockfile
    so the repo's reproducible install stays valid for every other build.
  - **Then container base images**, if anything will be built locally — and note that the image
    build itself usually runs the package install *inside* the container, so that build is also
    a pre-cutoff task, not a later one.
  - **Then any audit or scan**, which needs a *vulnerability database* and not merely a package
    registry — so it cannot be recomputed afterwards either.

  *STOP: do not cross the cutoff until this reports clean. Nothing here is recoverable from the
  other side, and a driver that will not install out here will not install in there.*

0. **Access.** Am I even on the network? VPN state, DNS resolution of the host, TCP
   reachability of the port (`nc -zv host port` / `Test-NetConnection host -Port n`), TLS
   handshake, proxy variables in effect, corporate CA present. *STOP: nothing below works
   until this passes, and 90% of lost first hours die here.*
1. **Driver / client.** Does the client library *still* load now that you are inside, and does
   it work against **this server version**? When a pre-cutoff stage exists the install already
   happened there, and this stage must **download nothing** — a probe that quietly retries an
   install against closed egress hangs and then misdiagnoses itself as a driver fault. Say so in
   the emitted script, and name the real causes of a load that worked outside and fails inside:
   the corporate CA, and proxy variables the shell inside a VM or WSL did not inherit. Record the
   exact driver version. *STOP: no connection without it.*
2. **Credentials and identity.** Can I authenticate? Record: the account name, the schemas
   it can see, and — explicitly — **whether it is read-only**. A write-capable account
   handed over "temporarily" is a finding, not a convenience.
3. **Catalog reality.** For every object the mapping doc expects: does it exist, what are
   its real column names and types, and **how many rows does it actually have?** Row
   counts matter more than they look: a catalog that is definition-only, or a table that
   is populated in prod but empty in the environment you were given, invalidates the plan
   silently. Record counts, not just existence.
4. **The blocking questions.** The identity-key bridge from the mapping doc's row zero —
   sample both key columns, confirm the format, and determine whether any join path
   exists. Plus any `UNMAPPED` field the host said they would resolve. *This is the stage
   that decides whether the engagement's scope survives contact.*
5. **Platform.** Can I build and push an image? Does the registry authenticate, does the
   namespace/project exist, are egress rules what was described, do the health probes'
   paths return what the manifests assume?

## Rules

- **Every stage records its answer inline** in a fenced block or a blank field. An
  un-captured discovery answer gets re-derived tomorrow.
- **Findings route explicitly.** Each stage ends by naming where its output goes: mapping
  doc row, `TODO(integration):` marker, config value, or a question for the host.
- **No credentials, hostnames, or connection strings in the committed file** — placeholders
  only, and say where the real values come from.
- **Every command must be copy-pasteable and read-only.** Discovery never writes to the
  host's systems.
- If the ROUND B harness answer was *no AI tooling*, discovery is the artifact the whole
  engagement runs on — expand it, and make every step executable by a person with a
  terminal and no context.

---

# The mapping contract

The deliverable the whole engagement bottlenecks on. Optimize it for a DBA filling it in
next to you — one row per field, grouped by target table, greppable, no prose between rows.

```
| App field | App read model (schema.table.column) | Type | Upstream source (schema.table.column) | **Host actual column** _(blank — fill on site)_ | Transform / join notes | Status |
```

Rules, all load-bearing:

- **Derive the app side exhaustively from the actual DDL**, not from memory or docs. Every
  column any read path touches gets a row. Columns that exist but are never read get a row
  marked `unused` — they are free deletions the host does not have to supply.
- **Populate the upstream side only from a real discovery artifact.** Where none names a
  source, write `UNMAPPED`. Never infer a source table from a similar-sounding name.
- **Leave the host column blank.** That column is the on-site deliverable and its blankness
  is the point.
- **`Status` ∈ `mapped` / `UNMAPPED` / `SYNTHETIC` / `BLOCKED`.** `SYNTHETIC` means the
  field was invented for the demo and has no upstream — the host must supply a real source
  or accept the field disappears. Getting this column right is what stops a demo field
  being mistaken for a delivered one.
- **Lead the document with the identity-key section.** Almost every one of these
  integrations has a join-key problem: the source system keys two subject areas
  differently, no bridge table exists, and the local model quietly collapsed them into one
  clean id. Every field downstream of that bridge is blocked until the host resolves it.
  **Find it in recon and make it row zero**, with the exact key names, types, and tables.
  If there is genuinely no key mismatch, say so explicitly — that absence is worth stating.
- **Header section: the ranked question list for the host DBA.** Ordered by how many
  mapping rows each answer unblocks.

---

# The feedback contract — closing the loop

Every artifact this skill emits is a **guess about an environment nobody has seen**. Without a
return path those guesses never improve, and the same wrong assumption is shipped to the next
engagement with the same confidence. Emit the return path every time.

## `integration/FIELD-LOG.md`

Append-only, written **at the moment of friction** — never as an end-of-engagement retro. A retro is
written when everyone is tired and leaving, so it records the last two hours and calls it the
engagement.

The trigger to state in the file: *write it when you are annoyed.* More than ~10 minutes lost to
something the prep should have prevented is an entry, and two lines per field is a complete entry.

Each entry carries the usual what-happened fields plus **the two that make it mechanically
actionable** rather than a complaint:

- **Which artifact should have caught it** — a specific file and section, or explicitly "nothing".
  This routes the fix instead of leaving someone to guess where it belongs.
- **The fix, as one imperative sentence** aimed at the *process*, not at that repo.

And a `Class` that routes the kind of fix: `wrong-assumption` / `missing-artifact` / `wrong-order` /
`wrong-format` / **`unknowable-in-advance`**.

**`unknowable-in-advance` is load-bearing, not filler.** Without an explicit escape hatch every
entry becomes a new check, and a runbook that accretes paranoid checks for things that will never
recur is a runbook nobody reads. Most fixes should be *replacing* a wrong assumption, not adding a
step.

**Log wins too.** "This stage caught the problem in four minutes" identifies what must not be
trimmed — information the failures alone cannot supply, and the only defence against a later
hardening pass deleting the parts that are quietly working.

## Make capture cost under a minute

If the harness inside supports invocable prompts, emit one (`/log-friction`) that reconstructs the
entry from recent context and appends it in the right format. **A log that is expensive to write
does not get written**, and that failure is silent.

## The egress packager

The log leaves the host's tenant, which makes it the exact mirror of the handover scrub: that one
stops our material getting *in*, this one stops theirs getting *out*.

- **Two layers, because one is not enough.** A `--deny` list of the client-specific strings only the
  operator knows (their name, hosts, schemas), plus **generic shape detectors** that work without
  knowing who the client is: IPv4, FQDNs, connection-string fragments, database URLs, emails, and
  `SCHEMA.TABLE`-style identifiers. Names need the deny list — a client's name looks like an
  ordinary word to a regex. Shapes need the detectors — nobody remembers every hostname they typed.
- **Refuse to package on any hit**, and print the offending lines so they can be rewritten
  generically.
- **Verify the detectors actually fire** by testing against a poisoned copy before shipping the
  script. A check that silently never matches is worse than no check, because it is trusted.

## Tell the inside agent it is part of the job

State it in the repo-root instructions file, not only in a doc. An assistant that finds an empty
`FIELD-LOG.md` and no instruction will reasonably treat it as decoration and never write to it.

---

# The handover contract — when the repo enters the host's own VCS

Frequently the branch does not travel as a git remote at all: it is downloaded as an archive and
becomes **commit one of a fresh repository** in the host's system. That path has two properties
worth designing for, and the second is unforgiving.

**History does not travel.** The archive is a working tree with no `.git`, so every commit message
goes with it — and on this kind of branch the messages carry most of the *why*. Emit that reasoning
as a normal file (generate it from the log before export) so it survives. The compensation: their
repo starts clean, with no historical secret exposure to reason about.

**The first commit is the point of no return.** Everything that should not live in the host's source
control has to be gone *before* `git init`, because afterwards it is in a history their team will
clone. So:

- **Do not strip early.** Demo fixtures, seed databases and local docs are usually *needed while the
  integration work happens* — a synthetic dataset is often the reference side of the parity check
  and the test fixture. Removing them on day one breaks the tools the engagement runs on. Removing
  them on day thirty, before the first commit, costs nothing.
- **Emit a scrub script, not a checklist.** It should refuse to run once the tree has commits (and
  say how to recover), and it should **verify by grep and fail loudly** rather than asserting it
  worked.
- **Separate what is safe to auto-delete from what needs a decision.** Auto-remove fixtures, local
  state and internal docs. Do not auto-remove anything whose deletion leaves the app broken or
  whose replacement is the user's call — third-party branding rendered in the UI is the recurring
  example, and it is also the only leak that is *visible on screen* rather than buried in a
  comment. Block on those and state the options.
- **Distinguish a mention from a dependency.** Platform-detection code naming a former host is
  functional and may be security-relevant; deleting it changes behaviour. Report it as a judgement
  call with the consequence named, and never let a scrub script rewrite logic.
- **Say what the archive silently broke.** Executable bits do not survive; line-ending attributes
  only protect once committed, so they must land in the *first* commit, not later.

---

# Invariants

These are the things that make the output worth pasting. Violating any one of them
produces a document that reads complete and is not.

- **Recon before questions.** A question whose options do not cite this repo is a template
  question, and template questions get template answers.
- **Blank beats plausible.** In a mapping doc, in a manifest, in an env file.
- **Never strip a seam without enumerating its dependents first.** Auth is the recurring
  case, but it applies to any cross-cutting concern — tenancy, feature flags, audit.
- **Silent fallback is the enemy.** Every place the app can quietly serve local/demo data
  when the real source is missing becomes a fail-loud path, or it becomes a mapping-doc row.
- **Name what is synthetic.** The fields that only ever existed for the demo are the ones
  that will be presented as real if nobody labels them.
- **The downstream tool gets ground truth, not instructions to go find it.** Cite files.
- **`TODO(integration):` at the code site with the exact open question** — never a guessed
  value, never only a note in chat.
- **Discovery cannot depend on the app booting.** The app not booting is the normal state
  during discovery. Probes are standalone or they are useless.
- **Emit in the shell they actually have.** A bash script for a PowerShell-only Windows
  workstation is a deliverable that fails on first contact.
- **Match the artifact to the harness, not to your own.** Prompts assume an agent; a
  regulated tenant may allow none. Runbooks degrade gracefully in a way prompts do not.
- **Find the cutoff, and put it in the runbook.** External access usually ends at *VPN login*,
  not at travel — a moment the user crosses themselves, on a machine that had egress a minute
  earlier. Every window that closes rather than opens gets its own stage BEFORE connectivity,
  and an explicit "safe to connect now" gate. Air-gapped or proxied additionally makes vendoring
  a before-you-travel task. Either way it goes at the top of the checklist, never inside a
  workstream that assumes it can reach a registry.
- **Always emit the return path.** Every artifact here is a guess about an unseen environment. A
  prep that cannot be told it was wrong ships the same wrong assumption to the next engagement with
  undiminished confidence. The field log is not optional output.
- **A pre-cutoff stage must verify, not just fetch.** "Downloaded" is not the property that
  matters; "installs, loads, and runs here" is. A native driver that unpacked but cannot load is
  indistinguishable from a working one until you are on the far side of the tunnel.
- **Harden before the branch, not inside the tenant.** Anything requiring a package
  registry, a vulnerability database, or a working toolchain has to be done while those
  still work. Deferring it to the inside is deferring it to never.
- **The lint gate produces a signal, not clean code.** Green-before-travel is what makes a
  later failure legible. Chasing style in someone else's timeline is the tangent.
- **Deps and integration are separate commits.** A host reviewing the diff must be able to
  see the wiring without forty version bumps on top of it.

---

# Arguments

- `--harden-from=<path>` — PHASE 3. Consume a returned field log and improve this skill. Runs
  nothing else.
- `--dry` — run PHASE 0 and print the recon plus the question set. Ask nothing, write
  nothing. Skips the PHASE 1.5 gate.
- `--skip-preflight` — skip the PHASE 1.5 hardening gate. Only sane when it was run
  recently; say so in the closeout rather than letting the omission pass silently.
- `--scaffold` — also create the branch and write the `integration/` folder and manifests
  locally, not just the spec prompt. Does not commit, does not push.
- `--harness=<name>` — the tooling available inside the wall (`claude-code`, `codex`,
  `copilot`, `cursor`, `none`). Skips ROUND B question 5 and sets the artifact shape:
  agentic CLI → one spec + instructions file; in-editor assistant → chunked per-workstream
  prompts; `none` → human runbooks and scripts, no prompts at all.
- `--os=<name>` — the on-site workstation (`mac-arm`, `mac-intel`, `wsl`, `windows`,
  `linux`). Skips ROUND B question 6 and fixes the shell dialect, the container build
  flags, and the driver-availability warnings.
- `--tool=<name>` — deprecated alias for `--harness`.
- Anything else — treated as the host/platform name for the branch and folder naming.
