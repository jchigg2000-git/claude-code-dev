// The repo's roadmap, read-only, for the page's Roadmap tab. ROADMAP.md is the repo's source of
// truth and only a person or the repo's main session edits it: nothing here writes it, and the page
// only records requests about it (`roadmapRequests[]` in the state file, write.mjs). The main
// session carries a request out by the repo's rules; until then `applyRequests` overlays the open
// ones on the parsed view, so the owner sees the order and removals they asked for, marked pending.
//
// Items are `### ` headings, or top-level bullets that open with a status marker or a checkbox
// (`- ⬜ **CONN-2** …`, `- [ ] …`) where no `### ` item is open in the section. `## ` headings are
// sections. Fenced code is skipped. A file with no `## ` heading gets one unnamed section.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROADMAP_CANDIDATES = ["ROADMAP.md", "ROADMAP", join("docs", "ROADMAP.md")];
export const ROADMAP_OPEN = new Set(["new", "held", "sent", "filed"]);
const MAX_BYTES = 8 * 1024 * 1024;
const SUMMARY_MAX = 200;
const TITLE_MAX = 200;

const MARKERS = { "⬜": "todo", "⏳": "doing", "🔶": "unverified", "🔬": "verifying", "✅": "done", "⛔": "blocked" };
// A marker may carry a variation selector (U+FE0F) after it.
const MARKER_RE = /^(⬜|⏳|🔶|🔬|✅|⛔)️?\s*/u;
const CHECKBOX_RE = /^\[( |x|X)\]\s+/;
// An item id: T16, P0, P3b, LAB-3, SR-1, BL-02a, RL-16–RL-21. Needs a digit; never a date.
const ID_RE = /^[A-Z][A-Z]*-?\d+[a-z]?(?:[–-][A-Z]*-?\d+[a-z]?)?$/;
const BACKLOG_RE = /\b(backlog|parked)\b/i;

export function roadmapPath(rootDir) {
  for (const rel of ROADMAP_CANDIDATES) {
    const p = join(rootDir, rel);
    try {
      if (statSync(p).isFile()) return { path: p, source: rel };
    } catch {}
  }
  return null;
}

const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const plain = (t) =>
  String(t)
    .replace(/\*\*|__|`|~~/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export const slug = (text) =>
  String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-")
    .slice(0, 48) || "item";

// The leading marker, then an id token if the first word looks like one; the rest is the title.
function splitHead(text) {
  let rest = text.trim();
  let marker = "";
  const m = MARKER_RE.exec(rest);
  if (m) {
    marker = m[1];
    rest = rest.slice(m[0].length);
  }
  const word = /^(\S+)/.exec(plain(rest))?.[1]?.replace(/[:,.;]+$/, "") ?? "";
  let id = null;
  let title = plain(rest);
  if (ID_RE.test(word)) {
    id = word;
    title = title.slice(title.indexOf(word) + word.length).replace(/^[\s:,.;—–-]+/, "").trim();
  }
  return { marker, id, title: clip(title, TITLE_MAX) };
}

// A bullet's own text: a bold lead (`**CONN-2** rest`, `**INT-9 — Title.** rest`) is the head and
// the rest is the summary; otherwise the first line is the head.
function splitBullet(text) {
  const t = text.trim();
  const markerMatch = MARKER_RE.exec(t);
  const marker = markerMatch ? markerMatch[1] : "";
  const body = markerMatch ? t.slice(markerMatch[0].length) : t;
  const bold = /^\*\*(.+?)\*\*\s*(.*)$/.exec(body);
  if (bold) {
    const head = splitHead(`${marker} ${bold[1]}`);
    let title = head.title.replace(/[.:]+$/, "");
    let summary = bold[2];
    if (!title && head.id) {
      // `**CONN-2** Build the connectors …`: the bold is only the id; the text is the title.
      title = clip(plain(summary), TITLE_MAX);
      summary = "";
    }
    return { ...head, title: title || head.id || "", lead: summary };
  }
  const head = splitHead(t);
  return { ...head, title: head.title || head.id || "", lead: "" };
}

const statusOf = (marker, checkbox) => (marker ? MARKERS[marker] : checkbox === "x" ? "done" : "todo");

export function parseRoadmap(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
  const sections = [];
  let section = null;
  let item = null; // the item collecting a summary
  let headingItem = null; // the open ### item in this section, which owns its bullets
  let fence = null;
  const used = new Set();
  const unique = (base) => {
    if (!used.has(base)) return used.add(base), base;
    for (let i = 2; ; i++) if (!used.has(`${base}~${i}`)) return used.add(`${base}~${i}`), `${base}~${i}`;
  };
  const ensureSection = (line) => {
    if (!section) {
      section = { id: unique("top"), title: "", backlog: false, line, items: [] };
      sections.push(section);
    }
    return section;
  };
  const addItem = (fields, line) => {
    const sec = ensureSection(line);
    const it = {
      id: unique(fields.id || slug(fields.title || `line ${line}`)),
      title: fields.title,
      marker: fields.marker,
      status: statusOf(fields.marker, fields.checkbox),
      backlog: sec.backlog || BACKLOG_RE.test(fields.title),
      line,
      summary: fields.summary ? clip(plain(fields.summary), SUMMARY_MAX) : "",
      pending: [],
    };
    sec.items.push(it);
    return it;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const n = i + 1;
    const f = /^\s{0,3}(```+|~~~+)/.exec(raw);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;

    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h && h[1].length === 2) {
      const title = plain(h[2]);
      const sid = /^(§\s*\d+[a-z]?)\b/i.exec(title)?.[1]?.replace(/\s+/g, "") ?? slug(title);
      section = { id: unique(sid), title, backlog: BACKLOG_RE.test(title), line: n, items: [] };
      sections.push(section);
      item = headingItem = null;
      continue;
    }
    if (h && h[1].length === 3) {
      const head = splitHead(h[2]);
      item = headingItem = addItem({ ...head, title: head.title || head.id || "" }, n);
      continue;
    }
    if (h) {
      if (h[1].length === 1) item = headingItem = null;
      continue; // # title, #### and deeper stay part of the item
    }

    const b = /^[-*+]\s+(.*)$/.exec(raw);
    if (b && !headingItem) {
      const cb = CHECKBOX_RE.exec(b[1]);
      const rest = cb ? b[1].slice(cb[0].length) : b[1];
      if (cb || MARKER_RE.test(rest)) {
        const head = splitBullet(rest);
        item = addItem({ ...head, checkbox: cb ? cb[1].toLowerCase() : null, summary: head.lead }, n);
        if (head.lead.trim()) item = null; // its summary is its own first line
        continue;
      }
    }
    if (!item) continue;
    // The first prose line under an item is its summary.
    const prose = raw
      .trim()
      .replace(/^>\s*/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(CHECKBOX_RE, "")
      .replace(MARKER_RE, "");
    if (!prose) continue;
    if (!item.summary) item.summary = clip(plain(prose), SUMMARY_MAX);
    item = null;
  }
  return sections;
}

// {source, readAt, error?, sections}. Never throws: a missing, unreadable or oversized file is an
// error string and no sections.
export function roadmapView(rootDir) {
  const readAt = new Date().toISOString();
  const found = roadmapPath(rootDir);
  if (!found) return { source: null, readAt, error: `no ${ROADMAP_CANDIDATES.join(", ")} in this checkout`, sections: [] };
  try {
    const size = statSync(found.path).size;
    if (size > MAX_BYTES) return { source: found.source, readAt, error: `${found.source} is ${size} bytes, over the ${MAX_BYTES}-byte limit`, sections: [] };
    return { source: found.source, readAt, sections: parseRoadmap(readFileSync(found.path, "utf8")) };
  } catch (err) {
    return { source: found.source, readAt, error: `can't read ${found.source}: ${err.message}`, sections: [] };
  }
}

export const findItem = (view, id) => {
  for (const s of view?.sections ?? []) {
    const it = s.items.find((x) => x.id === id);
    if (it) return { item: it, section: s };
  }
  return null;
};

export const isOpenRequest = (r) => Boolean(r && typeof r === "object" && ROADMAP_OPEN.has(r.status ?? "new"));

// The view with open requests laid over it, in the order they were made: a reorder moves the item
// (movedByRequest), a remove marks it removed in place, a restore clears that, and every item lists
// its open requests in `pending`. Requests naming an item no longer in the file are listed in
// `unmatched`. The input view is not modified.
export function applyRequests(view, requests = []) {
  const sections = (view?.sections ?? []).map((s) => ({
    ...s,
    items: s.items.map((i) => ({ ...i, pending: [], removed: false, movedByRequest: false })),
  }));
  const out = { ...view, sections, unmatched: [] };
  const where = (id) => {
    for (const s of sections) {
      const k = s.items.findIndex((x) => x.id === id);
      if (k >= 0) return { s, k };
    }
    return null;
  };
  for (const r of Array.isArray(requests) ? requests : []) {
    if (!isOpenRequest(r)) continue;
    const at = where(r.itemId);
    if (!at) {
      out.unmatched.push(r.id);
      continue;
    }
    const it = at.s.items[at.k];
    it.pending.push({ id: r.id, kind: r.kind, status: r.status ?? "new" });
    if (r.kind === "remove") it.removed = true;
    else if (r.kind === "restore") it.removed = false;
    else if (r.kind === "reorder") {
      const to = r.to && typeof r.to === "object" ? r.to : {};
      const after = to.after != null && to.after !== it.id ? where(to.after) : null;
      const before = !after && to.before != null && to.before !== it.id ? where(to.before) : null;
      if ((to.after != null || to.before != null) && !after && !before) continue; // its anchor is gone
      at.s.items.splice(at.k, 1);
      let target = at.s;
      let index = 0;
      const anchor = after ? where(to.after) : before ? where(to.before) : null;
      if (anchor) {
        target = anchor.s;
        index = after ? anchor.k + 1 : anchor.k;
      }
      target.items.splice(index, 0, it);
      it.movedByRequest = true;
      if (target !== at.s) it.backlog = target.backlog || BACKLOG_RE.test(it.title);
    }
  }
  return out;
}
