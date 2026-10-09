// One read-only view of a state file, whichever shape it's in. Accepts `gates[]` or a
// repo's `gate{}`, `doing` as `active`, plain-string findings; every key it doesn't know is kept
// under `extra`. It never writes back: writers patch the raw file, renderers read this.
import { createHash } from "node:crypto";

const KNOWN = new Set([
  "repo", "phase", "serverPort", "history", "updated", "steps", "gates", "gate",
  "measures", "findings", "note", "questions", "comments",
]);

export function gateOk(status) {
  const t = String(status ?? "").toLowerCase();
  if (/fail|error|\bwarn|problem|issue/.test(t)) return false;
  if (/clean|pass|ok/.test(t)) return true;
  return null;
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
export const isSettled = (q) =>
  Boolean(
    q && q.answer != null && String(q.answer).trim() &&
      (q.confirmed || q.actedAt || (q.ratified && String(q.ratifiedAt ?? "").slice(0, 10) < RATIFY_RETIRED)),
  );

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
    extra,
  };
}
