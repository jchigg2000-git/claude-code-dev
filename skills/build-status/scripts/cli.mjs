#!/usr/bin/env node
// build-status: the deterministic half of /build-status. Every routine update goes through here —
// agents, hooks and the page daemon — so no LLM ever re-serializes the state file, and a status
// update costs one short Bash call instead of a model turn. The skill (SKILL.md) keeps the
// judgment: Bootstrap, attach, gates, phase changes, and composing what gets written.
//
// Called through the stable launcher ~/.build-status/bin/build-status (written by install.mjs).
import { readFileSync, writeSync } from "node:fs";
import { join, relative } from "node:path";
import { buildId, git, localDate, resolveCheckout, SCRIPTS_DIR } from "./lib/paths.mjs";
import { isAttended, loadState, locate } from "./lib/state.mjs";
import * as W from "./lib/write.mjs";

const USAGE = `build-status <verb> [args] [--root DIR]

Record (each is one locked, atomic, id-patched write):
  finding --summary TEXT [--kind K] [--importance 1-3] [--detail TEXT | --detail-file F] [--id ID] [--date YYYY-MM-DD]
  ask --question TEXT [--severity red|amber|green] [--context TEXT] [--id ID]
  answer QID --via chat --quote TEXT | --quote-file F   (F = - reads stdin; the owner's words, verbatim)
  step done MATCH | step set MATCH todo|active|done | step add NAME [--state S]
  note TEXT          (note "" clears it)
  phase TEXT         next-phase LABEL [--force]
  gate NAME STATUS
  init [--steps-json JSON | --steps-file F] [--phase P] [--repo NAME] [--draft] [--force]
  confirm            (clears the unconfirmed-draft marker Bootstrap leaves when nobody was there)

Read and wait:
  locate [--json]    which state file, whose page, attended or not
  answers [--new] [--json]
  await QID [--timeout 4h]      exit 0 with the answer, 2 on timeout
  status [--json]

Page:
  render [--open] [--no-serve] [--port N]
  stop               stop this checkout's page daemon
  ls [--json]        every checkout with a live page on this machine

Harness:
  hook session-start|user-prompt|stop|post-edit     (reads the hook payload on stdin; always exits 0)
  hooks-snippet      print the hooks.json entries to paste into settings
  version

Exit codes: 0 ok · 1 usage · 2 await timeout · 3 conflict/no match · 4 state file unparseable ·
5 no state file (run /build-status to bootstrap) · 6 page owned by the repo's own generator · 7 lock timeout`;

const BOOL = new Set(["json", "open", "force", "draft", "new", "all", "no-serve", "help", "quiet"]);

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--") && a.length > 2) {
      const eq = a.indexOf("=");
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (BOOL.has(a.slice(2))) flags[a.slice(2)] = true;
      else {
        if (i + 1 >= argv.length) fail(1, `--${a.slice(2)} needs a value`);
        flags[a.slice(2)] = argv[++i];
      }
    } else pos.push(a);
  }
  return { pos, flags };
}

function fail(code, msg) {
  if (msg) console.error(`build-status: ${msg}`);
  process.exit(code);
}

const EXIT = { CONFLICT: 3, UNPARSEABLE: 4, LOCK_TIMEOUT: 7 };

// Hooks must never break a session: every path exits 0, a wedged one is cut off at 1.5 s, and
// nothing (not even argument parsing) runs outside the guard.
async function hook(event) {
  setTimeout(() => process.exit(0), 1500);
  try {
    const { runHook } = await import("./lib/hooks.mjs");
    const input = readFileSync(0, "utf8");
    const r = await runHook(event, input.trim() ? JSON.parse(input) : {});
    if (r?.out) {
      const text = typeof r.out === "string" ? r.out : JSON.stringify(r.out);
      for (let off = 0; off < text.length; ) {
        try {
          off += writeSync(1, text.slice(off));
        } catch (err) {
          if (err.code !== "EAGAIN") throw err;
        }
      }
    }
    if (r?.after) await r.after();
  } catch (err) {
    if (process.env.BUILD_STATUS_DEBUG) console.error(err);
  }
  process.exit(0);
}

async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  if (verb === "hook") return hook(rest[0]);
  const { pos, flags } = parseArgs(rest);
  if (!verb || verb === "help" || verb === "--help" || flags.help) {
    console.log(USAGE);
    return;
  }

  if (verb === "version") return console.log(buildId());
  if (verb === "hooks-snippet") return process.stdout.write(readFileSync(join(SCRIPTS_DIR, "..", "hooks", "hooks.json"), "utf8"));
  if (verb === "daemon") {
    const { runDaemon } = await import("./lib/daemon.mjs");
    return runDaemon({ root: flags.root, key: flags.key, port: Number(flags.port ?? 0) });
  }
  if (verb === "ls") {
    const { listCheckouts } = await import("./lib/serve.mjs");
    const list = await listCheckouts();
    if (flags.json) return console.log(JSON.stringify(list, null, 2));
    if (!list.length) return console.log("no live build-status pages on this machine");
    for (const c of list) console.log(`${c.url}  ${c.root}${c.openQuestions ? `  (${c.openQuestions} open questions)` : ""}`);
    return;
  }

  const co = resolveCheckout(flags.root || process.cwd());
  const loc = locate(co);
  const rel = (p) => relative(co.root, p) || p;
  const attended = isAttended();

  if (verb === "locate") {
    const info = { root: co.root, kind: loc.kind, statePath: loc.statePath, generator: loc.generator ?? null, primary: co.primary, isGit: co.isGit, attended };
    if (flags.json) return console.log(JSON.stringify(info, null, 2));
    console.log(`${loc.kind}: ${rel(loc.statePath)}${loc.generator ? ` (page owned by ${rel(loc.generator)})` : ""}${co.primary ? "" : " [worktree]"}${attended ? "" : " [unattended]"}`);
    return;
  }

  if (verb === "init") return init(co, loc, flags, attended, rel);

  if (loc.kind === "none") fail(5, `no state file in ${co.root} — run /build-status to bootstrap one`);

  // ---- writes ------------------------------------------------------------------------------
  const write = async (patch, describe) => {
    try {
      const r = await W.mutate(co, loc.statePath, patch);
      if (!flags.quiet) console.log(r.changed === false ? `unchanged: ${describe(r)}${r.note ? ` (${r.note})` : ""}` : `${describe(r)} → ${rel(loc.statePath)}`);
      return r;
    } catch (err) {
      fail(EXIT[err.code] ?? 1, err.message);
    }
  };

  switch (verb) {
    case "finding": {
      if (!flags.summary) fail(1, "finding needs --summary");
      let detail = flags.detail;
      if (flags["detail-file"]) detail = readFileSync(flags["detail-file"], "utf8").trimEnd();
      const importance = flags.importance === undefined ? undefined : Number(flags.importance);
      if (importance !== undefined && ![1, 2, 3].includes(importance)) fail(1, "--importance is 1, 2 or 3");
      if (flags.date && !/^\d{4}-\d{2}-\d{2}$/.test(flags.date)) fail(1, "--date is YYYY-MM-DD");
      await write(
        (raw) => W.addFinding(raw, { id: flags.id, kind: flags.kind, importance, date: flags.date, summary: flags.summary, detail }, { explicitId: Boolean(flags.id) }),
        (r) => `finding "${r.id}"`,
      );
      return;
    }
    case "ask": {
      if (!flags.question) fail(1, "ask needs --question");
      if (flags.severity && !["red", "amber", "green"].includes(flags.severity)) fail(1, "--severity is red, amber or green");
      await write(
        (raw) => W.addQuestion(raw, { id: flags.id, question: flags.question, severity: flags.severity, context: flags.context }, { explicitId: Boolean(flags.id) }),
        (r) => `question "${r.id}"`,
      );
      return;
    }
    case "answer": {
      const [qid] = pos;
      if (flags["quote-file"]) flags.quote = readFileSync(flags["quote-file"] === "-" ? 0 : flags["quote-file"], "utf8").trim();
      if (!qid || !flags.quote) fail(1, "answer needs QID and --quote TEXT (or --quote-file F, - for stdin)");
      if (flags.via && flags.via !== "chat") fail(1, "the shim records chat answers only (--via chat); the page records its own");
      await write((raw) => W.setAnswer(raw, qid, { answer: flags.quote, via: "chat", quote: flags.quote }), (r) => `answer to "${r.id}" (via chat)`);
      return;
    }
    case "step": {
      const [sub, ...args] = pos;
      if (sub === "done") await write((raw) => W.stepDone(raw, args.join(" ")), (r) => `step ${r.id} done${r.promoted != null ? `, step ${r.promoted} now active` : ""}`);
      else if (sub === "set") {
        const state = args.pop();
        await write((raw) => W.setStepState(raw, args.join(" "), state), (r) => `step ${r.id} ${state}`);
      } else if (sub === "add") await write((raw) => W.addStep(raw, args.join(" "), flags.state || "todo"), (r) => `step ${r.id ?? ""} added`);
      else fail(1, "step done MATCH | step set MATCH STATE | step add NAME");
      return;
    }
    case "note":
      await write((raw) => W.setField(raw, "note", pos.join(" ")), () => (pos.join(" ") ? "note set" : "note cleared"));
      return;
    case "phase":
      await write((raw) => W.setField(raw, "phase", pos.join(" ")), () => "phase set");
      return;
    case "next-phase":
      if (!pos.length) fail(1, "next-phase needs a label");
      await write((raw) => W.nextPhase(raw, pos.join(" "), { force: Boolean(flags.force) }), () => `phase closed; now "${pos.join(" ")}" with no steps — add them with step add`);
      return;
    case "gate": {
      const [name, ...status] = pos;
      if (!name || !status.length) fail(1, "gate NAME STATUS");
      await write((raw) => W.upsertGate(raw, name, status.join(" ")), () => `gate ${name}: ${status.join(" ")}`);
      return;
    }
    case "confirm":
      await write((raw) => (raw.draft ? (delete raw.draft, { changed: true }) : { changed: false }), () => "step list confirmed");
      return;
  }

  // ---- reads -------------------------------------------------------------------------------
  switch (verb) {
    case "status": {
      let st;
      try {
        ({ state: st } = await loadState(loc.statePath));
      } catch (err) {
        fail(EXIT[err.code] ?? 1, err.message);
      }
      const done = st.steps.filter((s) => s.state === "done").length;
      const open = st.questions.filter((q) => q.answer == null).length;
      const gate = !st.gates.length ? "none" : st.gates.some((g) => g.ok === false) ? "warn" : "ok";
      const summary = { root: co.root, statePath: loc.statePath, phase: st.phase, done, steps: st.steps.length, gate, findings: st.findings.length, openQuestions: open, draft: Boolean(st.extra.draft) };
      if (flags.json) return console.log(JSON.stringify(summary, null, 2));
      console.log(`${st.repo || co.root.split("/").pop()} — ${done}/${st.steps.length} steps, gate: ${gate}, ${st.findings.length} findings, ${open} open questions${summary.draft ? " (step list unconfirmed)" : ""}`);
      return;
    }
    case "answers": {
      const { answersCommand } = await import("./lib/answers.mjs");
      process.exitCode = await answersCommand(co, loc, { onlyNew: Boolean(flags.new), json: Boolean(flags.json) });
      return;
    }
    case "await": {
      const [qid] = pos;
      if (!qid) fail(1, "await QID [--timeout 4h]");
      const { awaitAnswer, parseDuration } = await import("./lib/answers.mjs");
      process.exitCode = await awaitAnswer(co, loc, qid, parseDuration(flags.timeout ?? "4h"));
      return;
    }
    case "render": {
      if (loc.kind === "repo-generator") fail(6, `this repo's page is owned by its own generator: node ${rel(loc.generator)}`);
      const { ensureServer, openBrowser } = await import("./lib/serve.mjs");
      const { writeStaticHtml } = await import("./lib/page.mjs");
      let srv = { live: false, port: null, url: null, reason: "not serving (--no-serve)" };
      if (!flags["no-serve"]) {
        try {
          srv = await ensureServer(co, loc, { port: flags.port ? Number(flags.port) : undefined });
        } catch (err) {
          if (err.code !== "LOCK_TIMEOUT") throw err;
          srv = { live: false, port: null, url: null, reason: "another render is starting this checkout's page server; try again in a moment" };
        }
      }
      let res;
      try {
        res = await writeStaticHtml(co, loc, srv);
      } catch (err) {
        fail(EXIT[err.code] ?? 1, err.message);
      }
      const s = res.summary;
      console.log(`${s.repo} — ${s.done}/${s.total} steps, gate: ${s.gate}, ${s.findings} findings, ${s.openQuestions} open questions${s.draft ? " (step list unconfirmed)" : ""}`);
      if (srv.note) console.log(srv.note);
      if (srv.started) console.log("page server started (a new one — no tab has it open yet)");
      console.log(`${rel(res.htmlPath)} written${srv.live ? "" : ` (read-only: ${srv.reason})`}`);
      const url = srv.live ? srv.url : `file://${res.htmlPath}`;
      if (flags.open) {
        if (attended) await openBrowser(url);
        else console.log("not opening a browser: nobody is attending this session");
      }
      console.log(`BUILD_STATUS_URL=${url}`);
      return;
    }
    case "stop": {
      if (loc.kind === "repo-generator") fail(6, `this repo's page daemon belongs to its own generator (${rel(loc.generator)}); leaving it alone`);
      const { stopServer } = await import("./lib/serve.mjs");
      const r = await stopServer(co);
      console.log(r.stopped ? `stopped the page daemon (pid ${r.pid})` : r.reason);
      return;
    }
  }
  fail(1, `unknown verb "${verb}"\n\n${USAGE}`);
}

async function init(co, loc, flags, attended, rel) {
  if (loc.kind === "repo-generator") fail(6, `this repo already keeps its state in ${rel(loc.statePath)}, owned by ${rel(loc.generator)} — attach to it, don't bootstrap a second one`);
  if (loc.kind === "generic" && !flags.force) fail(3, `${rel(loc.statePath)} already exists — attach to it (--force re-derives its steps; a backup is kept)`);
  let steps = [];
  const src = flags["steps-file"] ? readFileSync(flags["steps-file"], "utf8") : flags["steps-json"];
  if (src) {
    try {
      steps = JSON.parse(src);
    } catch (err) {
      fail(1, `steps must be a JSON array (${err.message})`);
    }
    if (!Array.isArray(steps)) fail(1, "steps must be a JSON array of names or {name, state}");
  }
  steps = steps.map((s, i) => {
    const o = typeof s === "string" ? { name: s } : s;
    return { id: i + 1, name: String(o.name), state: ["todo", "active", "done"].includes(o.state) ? o.state : "todo" };
  });
  if (!steps.some((s) => s.state === "active")) {
    const first = steps.find((s) => s.state === "todo");
    if (first) first.state = "active";
  }
  const raw = {
    repo: flags.repo || co.root.split("/").pop(),
    phase: flags.phase || "",
    steps,
    gates: [],
    findings: [],
    questions: [],
    history: [],
    note: "",
  };
  // Nobody there to confirm the derived list: write it, but say on the page that it's a draft.
  if (flags.draft || !attended) raw.draft = { reason: "derived with nobody attending; confirm or replace it", at: localDate() };
  const target = loc.kind === "generic" ? loc.statePath : join(co.root, ".claude", "build-status.json");
  // Re-bootstrapping a file that parses replaces its steps (and phase, if given) and nothing else:
  // findings, questions, answers, history, gates and notes describe the repo, not the step list.
  if (loc.kind === "generic") {
    let parses = true;
    try {
      await W.readRaw(target);
    } catch (err) {
      if (err.code !== "UNPARSEABLE") throw err;
      parses = false;
    }
    if (parses) {
      const backup = W.backupState(co, target);
      try {
        await W.mutate(co, target, (r) => {
          r.steps = steps;
          if (flags.phase) r.phase = flags.phase;
          if (raw.draft) r.draft = raw.draft;
          else delete r.draft;
          return { changed: true };
        });
      } catch (err) {
        fail(EXIT[err.code] ?? 1, err.message);
      }
      console.log(`${rel(target)}: step list replaced with ${steps.length} steps${raw.draft ? " (unconfirmed draft)" : ""}; everything else kept; previous file at ${backup}`);
      return;
    }
  }
  try {
    const r = await W.create(co, target, raw, { force: Boolean(flags.force) });
    console.log(`${rel(target)} created with ${steps.length} steps${raw.draft ? " (unconfirmed draft)" : ""}${r.backup ? `; previous file kept at ${rel(r.backup)}` : ""}`);
    // Leaving the file trackable is the default; a repo that ignores .claude/ decides otherwise,
    // and the person should know the state won't travel with the repo.
    if (co.isGit && git(co.root, ["check-ignore", "-q", target]) !== null) console.log(`note: ${rel(target)} is git-ignored in this repo, so it stays local to this checkout`);
  } catch (err) {
    fail(EXIT[err.code] ?? 1, err.message);
  }
}

await main();
