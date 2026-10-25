// One read-only view of a state file, whichever shape it's in. Accepts `gates[]` or a
// repo's `gate{}`, `doing` as `active`, plain-string findings; every key it doesn't know is kept
// under `extra`. It never writes back: writers patch the raw file, renderers read this.
import { createHash } from "node:crypto";

const KNOWN = new Set([
  "repo", "phase", "serverPort", "history", "updated", "steps", "gates", "gate",
  "measures", "findings", "note", "questions", "comments", "rewrites", "roadmapRequests",
]);

// true passed, false failed, null not run or not recognised. "ok" is a whole word ("broken" isn't
// a pass), and a negated pass ("not ok", "not passing") is a failure.
export function gateOk(status) {
  const t = String(status ?? "").toLowerCase();
  if (/fail|error|\bwarn|problem|issue|broken|\bnot (ok|pass|clean)/.test(t)) return false;
  if (/clean|pass|\bok\b/.test(t)) return true;
  return null;
}

// The one roll-up `status`, `render` and the page share: ok only when every gate passed; any
// failure is warn; a gate not run or not recognised keeps it at unknown.
export function gateSummary(gates) {
  if (!gates.length) return "none";
  if (gates.some((g) => g.ok === false)) return "warn";
  return gates.every((g) => g.ok === true) ? "ok" : "unknown";
}

export function normalizeGates(raw) {
  if (Array.isArray(raw.gates)) {
    return raw.gates
      .filter((g) => g && typeof g === "object")
      .map((g) => ({ name: String(g.name ?? ""), status: String(g.status ?? ""), ok: gateOk(g.status) }));
  }
  if (raw.gate && typeof raw.gate === "object" && !Array.isArray(raw.gate)) {
    return Object.entries(raw.gate).map(([name, v]) => {
      const status = v && typeof v === "object" ? String(v.status ?? JSON.stringify(v)) : String(v);
      return { name, status, ok: gateOk(status) };
    });
  }
  return [];
}

// An answered question is settled, and the page hides it, once the owner confirms it or the build
// has acted on it. Ratify was retired on 2026-10-09, when the owner said it had read as a go-ahead
// rather than a done: a ratification from before that day settles; one from that day on doesn't.
export const RATIFY_RETIRED = "2026-10-09";
// An owner-started topic (`origin: "owner"`) has no answer to give: it settles once the owner
// closes it (confirmed) or the build has acted on it.
export const isSettled = (q) =>
  Boolean(
    q &&
      (isOwnerTopic(q)
        ? q.confirmed || q.actedAt
        : q.answer != null && String(q.answer).trim() &&
          (q.confirmed || q.actedAt || (q.ratified && String(q.ratifiedAt ?? "").slice(0, 10) < RATIFY_RETIRED))),
  );

// Threaded Q/A. A question may carry `thread[]` of {id, from: "owner"|"agent", text, at, via?}:
// the conversation around it. The `answer` stays the owner's decision; a file without `thread`
// reads as an empty one. An owner topic is a question the owner started from the page.
export const isOwnerTopic = (q) => Boolean(q && q.origin === "owner");
export const threadOf = (q) =>
  (Array.isArray(q?.thread) ? q.thread : []).filter((m) => m && typeof m === "object" && typeof m.text === "string" && (m.from === "owner" || m.from === "agent"));
// Open for the owner to answer: an agent-asked question with no answer yet. Owner topics wait on
// the build, not the owner, so they never count here.
export const isOpenQuestion = (q) => Boolean(q) && !isOwnerTopic(q) && (q.answer == null || String(q.answer).trim() === "");

// How long an Improve/Enrich request may sit pending before watchers stop waking on it and the page
// says the keeper never took it up.
export const REWRITE_STALE_MS = 30 * 60 * 1000;

export const plainFindingId = (text) => "s_" + createHash("sha1").update(String(text)).digest("hex").slice(0, 12);

export function normalize(raw) {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const extra = {};
  for (const [k, v] of Object.entries(s)) if (!KNOWN.has(k)) extra[k] = v;
  return {
    repo: typeof s.repo === "string" ? s.repo : "",
    phase: typeof s.phase === "string" ? s.phase : "",
    note: typeof s.note === "string" ? s.note : "",
    updated: s.updated ?? null,
    serverPort: Number.isInteger(s.serverPort) ? s.serverPort : null,
    history: arr(s.history).filter((h) => h && typeof h === "object"),
    steps: arr(s.steps)
      .filter((st) => st && typeof st === "object")
      .map((st) => ({ ...st, state: st.state === "doing" ? "active" : st.state })),
    gates: normalizeGates(s),
    measures: arr(s.measures).filter((m) => m && typeof m === "object"),
    findings: arr(s.findings).map((f) =>
      typeof f === "string" ? { id: plainFindingId(f), summary: f, plain: true } : f && typeof f === "object" ? f : null,
    ).filter(Boolean),
    questions: arr(s.questions).filter((q) => q && typeof q === "object"),
    comments: arr(s.comments).filter((c) => c && typeof c === "object" && typeof c.text === "string"),
    rewrites: arr(s.rewrites).filter((r) => r && typeof r === "object" && typeof r.text === "string"),
    // The page's requests about ROADMAP.md (write.mjs); each object is kept whole, unknown keys too.
    roadmapRequests: arr(s.roadmapRequests).filter((r) => r && typeof r === "object" && typeof r.id === "string" && typeof r.kind === "string"),
    extra,
  };
}
