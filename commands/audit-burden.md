---
description: Find features carrying technical cost, architectural weight, or delivery constraints disproportionate to their actual value — then trace each back through Claude Code session history to the utterance that created it and determine whether that origin was ever deliberately ratified. Session transcripts are the primary provenance source; git is secondary (what/when, not who/why). Read-only; never edits, refactors, or fixes. Fire on `/audit-burden`, "what's carrying more weight than it earned," or "why are we stuck with X."
argument-hint: "[optional: feature, area, file path, recent decision, or 'the thing that feels wrong' in your words]"
allowed-tools: Read, Glob, Grep, Bash(ls:*), Bash(jq:*), Bash(rg:*), Bash(wc:*), Bash(find:*), Bash(sqlite3:*), Bash(git log:*), Bash(git show:*), Bash(git diff:*), Bash(git blame:*)
---

# Feature burden and inherited-constraint audit

Audit this repository for features, capabilities, requirements, and assumptions that
are currently carrying more technical cost, architectural authority, or delivery
constraint than they were ever deliberately assigned.

This is a read-only audit. Do not edit, refactor, migrate, or fix anything.

Focus hint from the operator, which may be empty:

$ARGUMENTS

If the hint is empty, sweep the whole repository. If it identifies a feature,
area, path, platform, or vague concern such as "the map feels wrong" or "routing
feels stuck," begin there. Trace outward far enough to find the real constraint.
The visible problem may be downstream of the decision that created it.

## Why this exists

This repository is built quickly, through broad agent delegation, persistent
roadmaps, working prototypes, and selective review.

That produces substantial leverage, but it creates a specific failure mode:

1. A real, assumed, habitual, or prototype-specific constraint influences a
   technical decision.
2. That technical decision is believed to be already justified by something deeper.
3. A capability exposed by that technology therefore appears cheap or free.
4. The capability enters the product and roadmap.
5. Code, documentation, infrastructure, and dependent features accumulate around it.
6. The original justification turns out to be weak, obsolete, misunderstood, or
   nonexistent.
7. The capability now appears independently load-bearing because it inherited the
   weight of the architecture built around it.

Plan-level approval feeds this failure mode, and the audit must account for it:
agent-authored plans are approved at the level of intent. A "y", "e", "do it", or
"/shipit" on a long plan ratifies the direction, not every requirement, stance,
or constraint embedded in it. Constraints ride in on approved plans without ever
being individually seen.

The purpose of this audit is not merely to find expensive things.

It is to find features and assumptions that are carrying expense, gating, or
architectural authority they would not have knowingly received if their full cost
had been visible when they were introduced.

Assume the repository is partially unmarked and historically untrustworthy.
Many requirements and assumptions predate the current marking conventions.

An authoritative file proves that the repository currently treats a statement as
authoritative. It does not prove that the operator ever selected, understood, or
approved it.

Do not treat silence, continued implementation, roadmap inclusion, accumulated
code, or bulk approval of the plan that contained it as evidence of human
ratification.

## Core audit model

Work middle-out, and reason — do not just archaeologize.

Begin with a feature, capability, or behavior that appears to be constraining the
system. Then trace in both directions.

### Downstream

Determine what the feature is forcing the repository to carry:

- technologies, frameworks, providers, SDKs, renderers, storage models, or protocols;
- architecture and deployment patterns;
- configuration and operational burden;
- implementation and maintenance cost;
- degraded product quality, performance, reliability, usability, or developer experience;
- blocked migrations or alternative implementations;
- additional features created because the selected technology exposed them;
- roadmap commitments that only make sense under the current implementation;
- workarounds and compatibility layers;
- costs that were described as ordinary finishing work but are actually structural.

### Upstream

Determine why the enabling technology or architecture was believed to be required:

- an explicit product requirement;
- a platform or cross-platform goal;
- a technical limitation;
- a prototype choice;
- an inherited implementation;
- an agent assumption;
- a temporary shortcut;
- a habitual instruction;
- a constraint that was later removed;
- a rationale that was never written down;
- a capability that became its own justification.

Then determine whether that upstream justification still exists and whether it was
ever independently validated — and by whom, in whose words.

## Step 1 — Collect candidate features, requirements, and decisions

Cast wide. A candidate is any feature, capability, requirement, assumption, or
embedded decision that constrains what may be built, how it may be built, or what
must be preserved.

Search these sources.

### 1. Explicit markers

Discover and inspect the repository's actual conventions. Search for terms such as:

- `ASSUMPTION`
- `REQ`
- `REQUIREMENT`
- `CONSTRAINT`
- `DECISION`
- `INVARIANT`
- `MUST`
- `NON-NEGOTIABLE`
- `TEMPORARY`
- `PROTOTYPE`
- `CLAUDE-ORIGIN`
- `AGENT-ORIGIN`
- `@assumption`
- `@decision`
- `@constraint`

Do not assume these exact markers are in use. Discover local variants.

### 2. Instruction and authority files

Inspect:

- every `CLAUDE.md`;
- every `AGENTS.md`;
- `.cursorrules`;
- root and relevant nested `README` files;
- `ROADMAP.md`;
- `DECISIONS.md`;
- architecture documents;
- ADRs;
- `docs/`;
- `.github/`;
- contribution guides;
- implementation plans;
- handoff documents;
- generated project-memory files.

### 3. Configuration as constraint

Inspect:

- pinned framework and dependency versions;
- `engines`;
- `packageManager`;
- lockfiles;
- `tsconfig`;
- linting and build settings;
- CI matrices;
- deployment and server configuration;
- infrastructure definitions;
- environment-variable contracts;
- feature flags;
- platform-specific build targets;
- provider-specific formats and schemas.

Configuration may encode stronger requirements than prose.

### 4. Code-embedded constraints

Search for:

- `always`;
- `never`;
- `must`;
- `do not`;
- `keep in sync`;
- `temporary`;
- `workaround`;
- `prototype`;
- `legacy`;
- `TODO`;
- `FIXME`;
- `HACK`;
- `XXX`;
- guard clauses;
- early returns;
- hardcoded data shapes;
- provider-specific abstractions;
- public interfaces whose shape only makes sense because of one implementation;
- duplicated logic preserving a platform decision;
- code paths that exist solely to support a single capability.

### 5. Session history — the primary provenance source

The true origin of a constraint is almost never in git. Git records what changed;
the Claude Code session transcripts record who decided, in what words, with what
confidence, and what the agent then did with that statement. When tracing why a
decision was made, prefer transcripts over git archaeology, and prefer reasoning
about what was actually said over inferring intent from artifacts.

**Locate the transcripts.** They live at
`~/.claude/projects/<encoded-cwd>/*.jsonl`, where `<encoded-cwd>` is the repo's
absolute path with every `/` replaced by `-`. Also list the sibling entries
(`ls ~/.claude/projects/ | rg <repo-name>`) — subdirectory sessions and worktree
sessions get their own directories and may hold the deciding conversation.
If a session-search or session-management MCP is available, use it to find which
session first discussed the feature; otherwise `rg -l` across the `.jsonl` files.

**Filter, never read whole files.** Transcripts run to many MB. Useful extractions:

- My own words (the only text that can prove ratification):
  `jq -r 'select(.type=="user" and (.message.content|type)=="string") | .message.content' <file>.jsonl`
- Which sessions mention the feature at all:
  `rg -l -i '<feature term>' ~/.claude/projects/<encoded-cwd>/`
- Then read narrowly around the hits.

**The vault — deep history beyond the pruning window.** Live transcripts under
`~/.claude/projects/` are pruned after ~30 days. I archive everything to a
SQLite vault at `~/Library/Application Support/claude-vault/vault.db`. Go there
whenever a live transcript is missing, a lineage predates the pruning window, or
you need full-text search across a repo's entire session history. Always open it
read-only:

- Schema: `sessions(session_id, project, started_at)` and
  `messages(session_id, uuid, role, content, timestamp)`, with an FTS5 index
  `messages_fts` over `messages.content` (porter tokenizer). `project` uses the
  same dash-encoded path as the live transcript directories.
- Find the sessions where a term first appeared, scoped to this repo:
  `sqlite3 -readonly "$HOME/Library/Application Support/claude-vault/vault.db" "SELECT m.session_id, min(m.timestamp) FROM messages_fts f JOIN messages m ON m.id=f.rowid JOIN sessions s ON s.session_id=m.session_id WHERE messages_fts MATCH '<term>' AND s.project='<encoded-cwd>' GROUP BY m.session_id ORDER BY 2 LIMIT 10;"`
- Pull my words only, in order, from a candidate session:
  `sqlite3 -readonly "$HOME/Library/Application Support/claude-vault/vault.db" "SELECT timestamp, substr(content,1,2000) FROM messages WHERE session_id='<id>' AND role='user' ORDER BY timestamp;"`
- Read agent context narrowly around a hit (by timestamp window), not whole
  sessions — assistant rows outnumber mine ~14:1.
- FTS MATCH uses porter stemming; if a stemmed query misses, fall back to
  `content LIKE '%<term>%'` scoped to the repo's sessions.

The vault and the live transcripts are the same evidence at different depths:
prefer live `.jsonl` for recent sessions (richer structure — tool calls, message
types), the vault for anything older or for corpus-wide search.

**What to establish from the transcripts:**

- The **first utterance**: the earliest time the constraint or feature was stated,
  and by whom — the operator, or an agent.
- **Register**: was the statement a directive ("we need X"), a passing remark
  ("it'd be cool if"), or a habitual qualifier stated without deliberation?
  A capability mentioned casually because the stack made it visible is not a
  requirement.
- **Bulk approvals**: distinguish the operator's own words from their `y` / `e` / "do it" /
  "/shipit" responses to agent-authored plans. A bare approval ratifies intent,
  not each embedded constraint.
- **The hardening moment**: the session where tentative language ("we could",
  "for now") became authoritative language ("must", "requirement", roadmap entry).
  Identify whether the operator was shown that promotion or it happened inside agent output.
- **Agent restatements**: where an agent restated a casual remark as a hard
  requirement in a later plan or doc. The restatement is not the original statement.
- **Injected stances**: positions (privacy postures, platform goals, quality bars)
  that first appear in agent output with no preceding user utterance at all.

### 6. Git history — secondary, for weight not intent

Use git to establish **what** exists and **when** it accumulated, never **why**:

- commits introducing the feature and the enabling technology;
- follow-up commits expanding around it;
- reverts, and migrations attempted and abandoned;
- commits whose changes exist only to preserve a constraint;
- the sheer accumulation rate around a decision.

A revert or repeated workaround is strong evidence that something is load-bearing.
It is not evidence of why it was chosen — get that from Step 1.5.

### 7. Product surfaces

Identify concrete user-facing or internal capabilities that benefit from each
technology choice.

Do not audit architecture only as architecture. Determine which actual feature is
receiving the value and which feature would disappear or degrade if the architecture
changed.

Deduplicate related evidence. A requirement may appear once in prose and be enforced
across several files. Collapse it into one finding with multiple evidence sites.

## Step 2 — Current blocker test

Report a candidate as a blocker only when there is concrete evidence that it is
constraining current or near-term work.

It qualifies when one or more of these are true:

- work is currently stalled because of it;
- implementation is being routed around it;
- it repeatedly complicates otherwise straightforward changes;
- it forces each new change in an area to pay a recurring tax;
- it prevents a migration, redesign, quality improvement, or platform choice that
  current work is actively approaching;
- it is being repeatedly re-litigated;
- roadmap items depend on its confirmation;
- the supplied focus hint identifies a symptom and repository evidence connects that
  symptom to this constraint.

Do not invent likely future work.

A foreclosed option counts as blocked only when code, recent sessions, open TODOs,
documented plans, roadmap items, or the supplied focus hint show that the option is
actually being pursued.

Drop candidates that are merely true, merely preferences, already satisfied, cheap
to accommodate, or not affecting current work.

## Step 3 — Load-bearing test

Report a candidate as load-bearing only when removing or reversing it requires
meaningful work.

Judge with evidence:

- **Structural weight** — how many files, modules, services, interfaces, schemas,
  deployments, or workflows encode it?
- **Downstream commitments** — what code, data shapes, URLs, contracts, file layouts,
  public behavior, or operational processes only make sense because of it?
- **Cost to reverse** — minutes, hours, an afternoon, several days, or rewrite?
- **Blast radius** — what breaks, degrades, or silently changes if it is removed?
- **Roadmap dependence** — what planned work assumes it will remain?
- **Experience impact** — what quality or usability burden is retained because of it?

If reversing it is a five-minute edit, it is not load-bearing, regardless of how
strongly it is worded.

A candidate must be both currently blocking and meaningfully load-bearing to receive
a full finding.

Track load-bearing items that are not yet blocking separately in the Watchlist.

## Step 4 — Constraint lineage

For every finding, reconstruct the chain:

**originating utterance or assumption  
→ technical decision  
→ exposed capability or feature  
→ dependent implementation  
→ later commitments  
→ current blocker**

Identify the earliest discoverable reason the technical decision was made, and
quote the originating utterance verbatim from the session record when it exists.

Then answer:

- Is that originating constraint still true?
- Was it ever explicitly validated — in my words, not an agent's restatement?
- Was it a product requirement, habitual instruction, agent inference, prototype
  expedient, or imported assumption?
- Would the technical decision still be selected today without it?
- Did downstream capabilities inherit its weight after it weakened or disappeared?
- Has a low-value descendant become the last remaining reason the architecture cannot
  be changed?

If the origin cannot be found, state `origin unknown`.

Never invent a rationale, date, author, or intent.

## Step 5 — Feature burden audit

For every candidate, identify the concrete feature or capability currently benefiting
from the technical decision.

Estimate the feature's **attributed architectural cost**.

Do not measure only the incremental effort required when the feature was added.

Ask instead:

> What burden would no longer be justified if this feature disappeared?

Include:

- technology ownership;
- provider or licensing cost;
- maintenance effort;
- styling or product-design workload;
- platform limitations;
- native-quality compromises;
- performance burden;
- reliability burden;
- compatibility code;
- operational complexity;
- migration resistance;
- blocked alternatives;
- dependent roadmap commitments;
- additional features added because the same stack made them easy.

Separate these three values:

1. **Cost already incurred**
2. **Cost to reverse**
3. **Future value preserved by keeping it**

Do not treat sunk cost or reversal cost as proof that the feature deserves to remain.

## Step 6 — Phantom prerequisite test

When a feature appears inexpensive because its enabling platform or architecture was
already present, verify why that enabling choice existed.

Ask:

- What independent requirement supposedly made the technology necessary before the
  feature was added?
- Is that requirement documented and current — and traceable to my words?
- Was the feature accepted as cheap because the architecture cost appeared already paid?
- Would the architecture still be retained if the feature disappeared?
- Has the feature become the primary reason the architecture cannot now be removed?
- Did the feature retroactively make the previously weak architecture genuinely
  load-bearing?

Classify as **phantom prerequisite** when the enabling technology was assumed to be
independently required but no current validated requirement justifies it.

## Step 7 — Prototype promotion test

Determine whether a prototype, simulator, proof of concept, or diagnostic tool was
silently promoted into production architecture.

Ask:

- What was the component originally built to prove or observe?
- Which parts were instruments and which parts were intended as durable architecture?
- Was there an explicit production-selection decision?
- Were production requirements evaluated separately?
- Did "it works" become "it is the selected production implementation"?
- Were limitations described as future styling, cleanup, polish, or optimization when
  they actually required new data, architecture, providers, or substantial ownership?
- Did features exploit prototype-specific capabilities and thereby make the prototype
  harder to replace?

Classify as **prototype-promoted** when experimental technology entered the production
path without an explicit promotion decision against production requirements.

The prototype itself is not automatically a mistake. Preserve the distinction between:

- knowledge produced by the prototype;
- contracts and algorithms validated by the prototype;
- infrastructure genuinely proven by the prototype;
- implementation materials that merely happened to produce the evidence.

## Step 8 — Circular-authority test

Look for cases where an assumption appears independently validated only because later
artifacts repeat or implement it.

Example:

**agent inference  
→ roadmap entry  
→ code implementation  
→ architecture document cites code  
→ later agent treats all three as confirmation**

Do not count downstream repetitions as independent evidence of the original decision.

Session history is the antidote: two documents agreeing proves nothing if both
descend from one agent utterance. Trace the chain back to its first appearance in
a transcript before crediting any repetition.

Identify circular authority when:

- one document cites another;
- implementation follows the document;
- later documentation cites the implementation;
- no independent user decision or validated external requirement exists;
- repeated existence has been mistaken for repeated confirmation.

## Step 9 — Counterfactual selection test

For every finding, answer both questions explicitly:

> If this feature and its current implementation did not exist, would we choose the
> same architecture today for the remaining product?

> If the architecture were not already present, would this feature be valuable enough
> to select it and knowingly accept its full burden?

These questions must be answered separately.

A feature may be valuable without being valuable enough to choose the entire current
stack.

An architecture may still be correct even when one feature no longer justifies it.

## Step 10 — Classification

Assign one or more of these classifications when supported by evidence:

- **intrinsically load-bearing** — independently justified by a current validated
  requirement or sufficiently valuable capability;
- **inherited load-bearing** — became structural through an upstream constraint that
  is now false, weak, obsolete, or uncertain;
- **momentum-bearing** — expensive to reverse primarily because work accumulated;
- **low-value anchor** — a low-priority feature is preventing a broader change;
- **phantom prerequisite** — a technology was assumed to be required independently,
  but no validated requirement currently supports that belief;
- **prototype-promoted** — experimental technology became production architecture
  without explicit reevaluation;
- **capability-priced-as-free** — a capability influenced architecture without its
  full product, design, operational, or maintenance burden being surfaced;
- **borrowed justification** — a feature was accepted because another requirement
  supposedly paid for the architecture;
- **disproportionate bearer** — a feature carries more technical burden than its
  independent value justifies;
- **circularly load-bearing** — the technology justifies the feature while the feature
  has become the primary justification for the technology;
- **replaceable bearer** — the capability matters, but a cheaper implementation could
  preserve most of its value;
- **proportionate** — the feature's value and the architecture's burden remain aligned.

Do not force a dramatic classification when `proportionate` is the correct result.

## Step 11 — Provenance classification

Classify provenance separately from current repository authority:

- **user-ratified** — direct session evidence that the operator explicitly selected or confirmed
  this specific constraint in their own words;
- **user-mentioned** — the operator said it, but the session register shows a passing remark,
  a "cool if we could" aside, or a habitual qualifier — not a deliberate requirement;
- **bulk-approved** — it entered via an agent-authored plan approved with a
  bare `y` / "do it" / "/shipit"; the approval covered the plan's intent, not this
  constraint individually;
- **agent-originated** — first appears in agent output with no preceding user
  utterance; proposed, inferred, or injected by an agent;
- **implementation-derived** — reconstructed from code or configuration;
- **prototype-derived** — inherited from experimental or simulation work;
- **legacy/imported** — inherited from an earlier system, dependency, template, or
  external implementation;
- **unknown** — no reliable origin evidence.

`user-mentioned` and `bulk-approved` are not weak forms of `user-ratified`. They are
the two channels through which most unearned constraints enter. When session evidence
supports one of them, say so plainly rather than rounding up to ratified.

Do not infer user ratification from:

- silence;
- continued existence;
- roadmap inclusion;
- code implementation;
- repeated references;
- lack of objection;
- approval of a plan that happened to contain it;
- an agent's restatement of something the operator said casually;
- placement in `ROADMAP.md`, an ADR, or another SSOT.

Repository authority and human ratification are separate facts.

## Step 12 — Evidence rules

Every factual claim requires a citation.

For repository claims:

`path/to/file.ts:42`

For session claims, cite the transcript and quote the utterance:

`~/.claude/projects/<dir>/<session>.jsonl — "verbatim quote" (user | agent)`

For vault claims, cite the session and timestamp:

`vault:<session_id> @ <timestamp> — "verbatim quote" (user | agent)`

Rules:

- Open every cited source.
- Never claim influence from a file or session you did not inspect.
- Quote stated requirements verbatim.
- Quote my originating utterance verbatim when classifying provenance; never
  paraphrase my intent from an agent's restatement of it.
- Always label a session quote as my words or an agent's words.
- Label reconstructed rules as **inferred**.
- Show the reasoning behind inferred rules.
- Cite the originating source and all material enforcement sites.
- Name relevant commits when history supports the finding.
- State `origin unknown` when the origin cannot be found.
- Never guess what I intended.
- When intent is ambiguous, report the competing interpretations side by side.
- Distinguish technical possibility from production suitability.
- Distinguish "can be improved" from the actual work and ownership required to improve it.
- Do not treat an agent's earlier reassurance as validation unless it included evidence
  and explicit tradeoff analysis.

Assign confidence:

- **high** — direct source plus multiple enforcement or history sites;
- **medium** — strong implementation pattern but incomplete origin evidence;
- **low** — plausible interpretation requiring my confirmation.

## Output

No preamble.

Order findings by:

**current shaping power × uncertainty that I knowingly assigned that power**

Do not order primarily by confidence.

For each finding:

---

### N. <short name> · <classification(s)> · <stated|inferred> · <marked|unmarked> · provenance: <type> · confidence: <high|medium|low>

**The feature or requirement**

> Quote it verbatim if stated. If inferred, state the rule the repository is
> actually following in one sentence.

**Where it lives**

List the originating source, if known, and every material enforcement site using
`path:line`.

**Constraint lineage**

Show:

`originating utterance → technical decision → feature → later commitments → current blocker`

Quote the originating utterance when session history contains it. State
`origin unknown` where necessary.

**What it originally appeared to cost**

Explain what the feature or decision looked like at introduction time: free,
incremental, temporary, already paid for, prototype-only, ordinary styling, or
otherwise limited.

Cite the evidence for this interpretation.

**What it has already shaped**

List the concrete implementation that exists because of it:

- code structure;
- platform selection;
- providers;
- schemas;
- APIs;
- data models;
- deployment;
- user experience;
- supporting features;
- workarounds;
- roadmap commitments;
- relevant commits.

This section should show the bill already paid.

**The feature carrying the load**

Identify the concrete user-facing or internal capability currently benefiting from
the architecture.

**Burden it carries**

State the architecture, cost, quality compromise, operational burden, and blocked
alternatives that would lose justification if the feature were removed or
implemented differently.

Separate:

- cost already incurred;
- cost to reverse;
- future value preserved.

**What it is gating**

State the specific current action, migration, quality improvement, design decision,
or roadmap item that cannot move cleanly while this remains unresolved.

Do not state only a broad theme.

**Independent value test**

Would this feature knowingly be assigned this technical burden if both were being
selected today?

Explain why or why not.

**Counterfactual**

Answer:

> Without this feature and its implementation, would the same architecture be selected
> today for the remaining product?

> Without the existing architecture, would this feature justify selecting it today?

**Cost to reverse**

Estimate:

- minutes;
- hours;
- an afternoon;
- several days;
- rewrite.

State what would break, what could be preserved, and what could be discarded.

**Lowest-cost realignment**

Identify the cheapest credible option that preserves the valuable part without
automatically preserving the full inherited burden.

Do not implement it.

Possible outcomes include:

- keep the feature and architecture;
- restyle or improve the current implementation;
- replace only the feature implementation;
- split the feature into a separate surface;
- preserve the data model but replace the client;
- demote the feature;
- remove the feature;
- reopen the architecture decision.

**The question for me**

Ask one sharp question I can answer from my own head in one sentence.

Do not ask merely:

> Should we keep this?

Ask something that resolves the actual lineage or value decision, such as:

> Was cross-platform delivery a present product requirement, or a habitual instruction?

> If the simulator had never existed, would I choose this map stack for the mobile product?

> Is full road-network recoloring important enough to determine the production renderer?

---

Then include exactly these two short sections.

## Watchlist

List load-bearing items that are not yet blocking.

One line each. No full expansion.

These are likely to become the next inherited constraints.

## Realignment

Maximum five lines.

State:

- which findings pull the product in incompatible directions;
- what the repository is currently optimizing for;
- what the documented requirements assume it is optimizing for;
- which feature is carrying the most unassigned technical weight;
- the first decision that would collapse the most uncertainty.

If two findings contradict each other, put that contradiction first.

If nothing passes both the blocker and load-bearing tests, say so in one line, list
the areas checked, and stop.

A clean result is a real result. Do not manufacture findings.
