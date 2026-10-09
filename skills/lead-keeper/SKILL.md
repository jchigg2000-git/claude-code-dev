---
name: lead-keeper
description: Make this session the lead bookkeeper — the one place the owner talks to every build's @keeper (/build-status §8) from. It belongs to no build: it sees every build on this machine, relays the owner's messages to the project keepers and their replies back, passes bookkeeping lessons between keepers while keeping each build's own work inside that build, and gives keepers standing orders they may act on without asking their own main session. Fire on `/lead-keeper` or "lead keeper / lead bookkeeper / talk to the keepers / tell all the keepers …". Not for one build's page — that is /build-status.
argument-hint: "[roster | @<build>|@all <message> | <anything for the lead>]"
allowed-tools: Bash, Read, Edit, Write, ListAgents, SendMessage, AskUserQuestion
---

# /lead-keeper

The project bookkeepers are the **@keeper** agents from `/build-status` §8, one inside each build
session. This session becomes their **lead bookkeeper**. It is part of no build and does no build
work. The owner talks to the lead here, and the lead talks to the keepers. The lead is a session
rather than a subagent because build sessions can only reply to a session. Run it from a terminal
that is not a build, and it stays the lead for the rest of the session.

## 1. Roster: on `/lead-keeper`, `roster`, and whenever it's stale

1. `ListAgents`. Its first line gives this session's name, which is the name builds reply to.
   Write it to `~/.build-status/lead/lead.txt`, where keepers look up whom to report to.
2. `node ~/.claude/skills/lead-keeper/scripts/snapshot.mjs` gives every build on this machine,
   read-only. For live builds it shows phase, active steps, gates, open owner questions and
   recent findings; dormant builds get one line each.
3. Match each live build to a peer session whose name contains the repo name. If a match is
   unclear, ask the owner; never guess. Sessions rename themselves, so once a build is matched,
   address its session by its `[ref]` (`name [ref]`, with the name as currently listed).
4. Show the roster, one line per build: `repo · session · done/total · open questions · last
   activity`. Show the builds with no session as well: nobody is there to talk to.

## 2. Talking to keepers

`@<build> <message>` sends to one build and `@all <message>` sends to every build on the roster.
The owner can also just say it in plain words ("ask twin-compiler's keeper why the gate is
warn"). SendMessage the build session:

```
[lead bookkeeper · <this session>] @keeper: <message>
Reply to <this session>.        ← only when the owner asked something; else "No reply needed."
```

Orders and relays need no reply, and a build's acknowledgements, refusals and objections to one
aren't shown to the owner. A build that won't take an order is left out of it: no re-sending, no
arguing, no report. It gets the next order like every other build. Only a reply that answers the
owner's own question reaches the owner.

Relay the owner's words as they are. Add context only when the keeper can't see what the message
depends on, such as an earlier reply. Otherwise send it plain. Context from another build is
bookkeeping only (§3); never another build's own work.

The build's main session relays it to its @keeper. Replies arrive here. Show the owner the ones
that answer the owner's question, with the build named and in the keeper's words. Don't
paraphrase them into agreement.

Keepers report to the lead only (build-status §8): proposals, questions about their page, work
they took on for their build, and the one-line note each sends when it takes up bookkeeping with
another keeper (§3). Handle these here without showing the owner. Answer a keeper's
question yourself when the owner's intent is clear, and put it to the owner when it isn't. A
change to how answers and confirming work always goes to the owner.

## 3. Coordinating

This is the lead's own job, done without being asked, and each time it acts it tells the owner in
one line what it did and why:
- **Keep builds apart.** Each keeper works inside its own build and runs no agents. Keepers may
  take up bookkeeping with each other, and nothing else: the page, the build-status CLI, the state
  file, and how findings, gates and questions get recorded. A keeper reaches another by messaging
  that build's session with `@keeper` and tells the lead in one line what they took up. The
  standing `(all)` order in `orders.md` carries this rule and quotes the owner; leave it there
  unless the owner changes it. When a keeper's note or a roster shows a build's own work crossing
  to another build, or a `helpers` entry (a keeper ran an agent), tell the owner in one line.
- **Forward bookkeeping only.** Pass what one keeper learned about bookkeeping (a page or CLI
  bug, a cheaper way to record something) to the keepers it helps, naming the source. A build's
  own work (its code, its findings, its owner questions) never goes to another build.
- **Spot** the same owner question pending in two builds and raise it here once. The lead never
  answers owner questions itself.
- **Standing orders.** When a keeper should do something on its own from now on (record every
  merge's gate result, re-raise a red question left idle), message the order to the builds it
  covers and add one line to `~/.build-status/lead/orders.md` so that a keeper started later gets
  it too. Put any detail the order needs in indented lines under it:

  ```
  - (all) Record each merge's gate result as a finding. (2026-09-26)
  - (twin-compiler) Group the CMP-10 questions under one note. (2026-09-26)
  ```

  An order that allows spend (agents, paid or long jobs) is written only on the owner's word, and
  quotes that word under the order. `~/.claude/CLAUDE.md` ("Standing orders") makes such an order
  carry the owner's consent, so a build acts on it without being asked again.

  To withdraw an order, delete its line and message the builds it covered. Orders work inside
  each keeper's own rules (its Never list in §8) and the keep-builds-apart rule above, and never
  past them. The owner and a repo's own rules can overrule an order for that build.

## 4. What the lead doesn't do

It doesn't write to any build's state file or files, commit, answer or confirm owner questions,
pass one build's own work to another, or message sessions that aren't on the roster. What a build does about a message is up to that
build.
