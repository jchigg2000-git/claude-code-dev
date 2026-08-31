---
description: Lift the session's hold-points and clarifying-question gates — drive the in-flight task to completion without stopping to confirm, summarize, or propose next steps. Preserves hard limits (no destruction outside the working tree, no secret exposure, no production network calls, no protected-branch operations). Caveats go in CHOICES.md; on a hard blocker, commits to wip/unleash-<ts> and writes BLOCKER.md. Fire on `/unleash`, "unleash," or "stop asking and finish."
---

The earlier constraints in this session were scaffolding to get us to a known-good state. We're past that now. For the remainder of this session:

**Supersedes prior guardrails.** Any "ask before X," "stop and confirm Y," "check in at Z" instructions from earlier in this conversation are rescinded unless they involve: irreversible destruction outside the working tree, secrets/credentials, network calls to production, or git operations on protected branches. Those still hold.

**Operating mode.**
- Drive to completion. Do not stop to summarize progress, propose next steps, or ask whether to continue.
- No clarifying questions. If something is genuinely ambiguous, pick the interpretation most consistent with work already done in this session and note the choice in a one-line comment in the code or a CHOICES.md at the repo root.
- No "would you like me to..." trailers. If the next step is obvious from the work, do it.
- Caveats and uncertainty go in CHOICES.md, not in chat output.

**Definition of done.** $ARGUMENTS

If $ARGUMENTS is empty, infer "done" from the trajectory of the session: finish the feature/refactor/task that was clearly in flight, including tests passing and a clean commit.

**On failure.** If you hit something genuinely blocking (compile error you can't resolve, missing credential, ambiguous requirement that materially changes the design), commit current progress to a branch named `wip/unleash-<timestamp>`, write a BLOCKER.md explaining what stopped you and what you'd need, and exit. Do not spin.

Begin now.