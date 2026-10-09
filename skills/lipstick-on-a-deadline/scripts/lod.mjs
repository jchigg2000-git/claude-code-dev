#!/usr/bin/env node
// /lipstick-on-a-deadline — the one CLI the main session (M) and the agents call.
//   start <topic> [N|Nm|--minutes N] [--mobile-first] [--out f] [--src dir] [--root dir] [--brand b] [--inline] [--dry-run] [--force-context]
//   gate | status | promote [--lite] [--pick sN=w] [--revert sN] | pick dir=X | lint <sN.w> | tick <sN.w> | done <sN.w>
//   wait [--for coat1|critic] | kits coat1|critic | finish | rate <1-10> [codes] [run] ["note"] | calibrate | verify [run] | serve [run]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import * as C from './lib/clock.mjs'
import * as F from './lib/facts.mjs'
import * as R from './lib/run.mjs'
import * as L from './lib/ledger.mjs'

const { LADDER, SKILL_DIR, r1, fmtClock, fmtMMSS } = C
const out = (...a) => console.log(...a)
const die = (msg, code = 1) => { console.error(msg); process.exit(code) }
const SELF = path.join(SKILL_DIR, 'scripts', 'lod.mjs')

function parseStartArgs(argv) {
  const t = R.tokenize(argv)
  const o = { topicWords: [], minutes: null, mobileFirst: false, dryRun: false, inline: false, forceContext: false, brand: 'auto' }
  for (let i = 0; i < t.length; i++) {
    const a = t[i]
    const val = () => t[++i]
    if (a === '--minutes') o.minutes = Number(val())
    else if (a === '--mobile-first') o.mobileFirst = true
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--inline') o.inline = true
    else if (a === '--force-context') o.forceContext = true
    else if (a === '--out') o.out = val()
    else if (a === '--src') o.src = val()
    else if (a === '--root') o.root = val()
    else if (a === '--brand') o.brand = val()
    else if (a === '--inline-reason') o.inlineReason = val()
    else if (/^\d+m?$/.test(a) && o.minutes == null) o.minutes = Number(a.replace(/m$/, ''))
    else if (a !== '--') o.topicWords.push(a)
  }
  o.topic = o.topicWords.join(' ').trim()
  if (o.minutes == null) o.minutes = LADDER.default_min
  return o
}

function preflight(root) {
  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(p => fs.existsSync(p))
  const cost = path.join(os.homedir(), '.claude/skills/ux-tournament/scripts/cost.py')
  let writable = false
  try { const p = path.join(root, `.lod-probe-${process.pid}`); fs.writeFileSync(p, 'x'); fs.unlinkSync(p); writable = true } catch {}
  return { chrome: chrome || null, node: process.version, cost_py: fs.existsSync(cost) ? cost : null, session: !!process.env.CLAUDE_CODE_SESSION_ID, writable }
}

function plannedLine(run) {
  return run.plan.map(s => s.kind === 'coat1' ? `coat1(${s.variant})` : s.id).join(' → ')
}

function dispatchLine(run, band) {
  const agents = band.agents || 0
  const parts = []
  if (run.plan.some(s => s.kind === 'coat1')) parts.push(`sonnet×${agents} scenes`)
  if (run.plan.some(s => s.kind === 'critic')) parts.push('opus×1 critic')
  const m = run.plan.some(s => s.kind === 'coat1' && s.variant === 'full') ? 'brief, mechanism centerpiece, fixes' : 'brief, hero, fixes'
  const lo = Math.round(run.N * 0.85 * 60), hi = Math.round(run.N * 1.15 * 60)
  const win = `${fmtMMSS(lo / 60)}–${fmtMMSS(hi / 60)} → ${fmtClock(run.T0 + lo * 1000).slice(0, 5)}–${fmtClock(run.T0 + hi * 1000).slice(0, 5)}`
  return `Dispatch: ${parts.length ? parts.join(', ') + '; ' : 'no agents; '}main session inline: ${m}; ${band.label} ${run.N}m (lands ${win}); ~$${band.usd} list (placeholder until rehearsal); variants off: opt-in line not yet approved; no Workflow, no Fable subagents.`
}

function cmdStart(argv) {
  const o = parseStartArgs(argv)
  const cwd = process.cwd()
  const root = path.resolve(o.root || cwd)
  if (!o.topic) die('Topic missing. Usage: /lipstick-on-a-deadline <topic> [minutes] [--mobile-first]', 2)
  if (o.minutes < LADDER.floor_min) { out(`Smallest honest build is ${LADDER.floor_min} min (v0 + polish). Run at ${LADDER.floor_min}?`); return }
  const band = C.bandFor(o.minutes)
  if (band.milestone_b) { out(`${band.label} (${band.min}+ min) isn't built yet: it lands in milestone B. Run at 34 or less for now, or wait.`); return }
  const note = o.minutes > LADDER.calibrated_max ? `uncalibrated band above ${LADDER.calibrated_max} min` : null
  const minutes = Math.min(o.minutes, LADDER.hard_max)

  const nowMs = Date.now()
  const sid = process.env.CLAUDE_CODE_SESSION_ID || null
  const transcript = R.findTranscript(cwd, sid)
  const t0 = C.findT0(transcript ? fs.readFileSync(transcript, 'utf8').split('\n') : [], { nowMs })
  const { main_model, context_tokens } = R.sessionFacts(transcript)
  if (!o.dryRun && context_tokens != null && context_tokens > LADDER.context.refuse_tokens && !o.forceContext) {
    out(`This session already holds ~${Math.round(context_tokens / 1000)}k tokens, so every turn is slow and the ±15% window would likely be missed. Open a fresh session in ${cwd} and run the same command, or add --force-context.`)
    return
  }

  const calib = L.loadCalib()
  const T0 = o.dryRun ? nowMs : t0.ms
  const run = {
    v: 1, run_id: null, topic: o.topic, slug: F.slugify(o.topic), date: new Date(T0).toISOString().slice(0, 10),
    N: minutes, T0, D: T0 + minutes * 60000, band: band.name, band_label: band.label, scenes_max: band.scenes, agents: band.agents,
    directions: band.directions, mobile_first: o.mobileFirst, inline: o.inline, inline_reason: o.inline ? (o.inlineReason || 'owner') : 'none',
    t0_source: o.dryRun ? 'dry-run' : t0.source, session_id: sid, transcript, main_model, context_tokens, note,
    reserve_frac: calib.reserve_frac ?? LADDER.reserve_frac, plan: C.buildPlan(band, calib), stages: [], agents_log: [], versions: [],
    cuts: [], fills: 0, root, cwd, out_hint: o.out || null, brand_arg: o.brand,
  }
  if (o.inline) for (const s of run.plan) if (s.kind === 'coat1') { s.variant = 'm_only'; s.p80 = C.coat1Cost('m_only', 0) }
  if (o.inline) for (const s of run.plan) if (s.kind === 'critic') { s.status = 'cut'; s.why = 'inline' }

  const pf = preflight(root)
  if (o.dryRun) {
    const sim = C.simulate(minutes, { calib })
    out(dispatchLine(run, band))
    out(`DRY RUN ${band.label} ${minutes}m · plan: ${plannedLine(run)}`)
    for (const s of sim.steps) out(`  ${fmtMMSS(s.at).padStart(6)}  ${s.stage}${s.variant ? `(${s.variant})` : ''} ${s.dur}m${s.cuts.length ? `  [cut ${s.cuts.join(', ')}]` : ''}`)
    out(`  lands ~${sim.actual} min (${r1((sim.actual - minutes) / minutes * 100)}%) at p80 seeds`)
    out(`preflight: chrome ${pf.chrome ? 'ok' : 'MISSING'} · node ${pf.node} · cost.py ${pf.cost_py ? 'ok' : 'MISSING'} · session id ${pf.session ? 'ok' : 'MISSING'} · transcript ${transcript ? 'found' : 'MISSING'} · scratch writable ${pf.writable ? 'ok' : 'NO'} · context ${context_tokens != null ? Math.round(context_tokens / 1000) + 'k' : '?'} (${main_model || 'model ?'}) · T0 would be ${t0.source}`)
    const cons = L.activeConstraints(L.readRuns())
    out(`constraints: ${cons.length ? cons.map(c => c.code).join(', ') : 'none'}`)
    return
  }
  if (!pf.writable) die(`Scratch is not writable under ${root}.`)

  const stamp = new Date(T0)
  const pad = (n) => String(n).padStart(2, '0')
  run.run_id = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}-${run.slug}`
  const dir = R.newRunDir(root, run.run_id)
  run.dir = dir

  const src = F.resolveSrc({ src: o.src, topic: o.topic, cwd })
  run.src = src
  const seed = F.gitFacts(src)
  R.writeJSON(path.join(dir, 'facts.seed.json'), seed)
  const sibs = F.siblings(root)
  run.siblings = sibs.map(s => ({ file: s.file, sha256: s.sha256 }))
  R.writeJSON(path.join(dir, 'siblings.json'), sibs)
  run.brand = F.detectBrand(root, sibs, o.brand)
  run.prefix = F.sharedPrefix(sibs.map(s => s.file))
  run.deny = F.denylist(run.slug)
  const runs = L.readRuns()
  const cons = L.activeConstraints(runs)
  run.constraints = cons.map(c => c.code)
  const lastDirs = L.lastDirections(runs)
  const fr = F.frontier()

  if (!process.env.LOD_NO_CAFFEINATE) {
    try {
      const c = spawn('caffeinate', ['-dimsu', '-t', String(minutes * 60 + 300)], { detached: true, stdio: 'ignore' })
      c.unref(); run.caffeinate_pid = c.pid
    } catch {}
  }
  run.preflight = pf
  run.stages.push({ kind: 'start', planned_min: LADDER.elapsed_before_plan_min, actual_min: r1((Date.now() - T0) / 60000) })
  R.saveRun(dir, run)

  // ---- the digest M reads instead of opening files ----
  const lines = []
  const P = (s = '') => lines.push(s)
  P(dispatchLine(run, band))
  P(`LOD START ${run.run_id} · ${band.label} ${minutes}m${note ? ` (${note})` : ''} · T0 ${fmtClock(T0)} (${run.t0_source}) · deadline ${fmtClock(run.D)} · model ${main_model || '?'} · context ${context_tokens != null ? Math.round(context_tokens / 1000) + 'k' : '?'}`)
  if (context_tokens != null && context_tokens > LADDER.context.warn_tokens) P(`WARN context above ${LADDER.context.warn_tokens / 1000}k: judgment turns will run slow.`)
  P(`run dir: ${dir}`)
  P(`out: ${root}/${run.prefix ? `${run.prefix}<slug>-view.html` : '<slug>.html'} (set brief.filename; never overwrites)`)
  P(`plan: ${plannedLine(run)}${run.mobile_first ? ' · MOBILE-FIRST' : ''}`)
  P(`brand: ${run.brand}${run.brand === 'tc' ? ' (siblings share its tokens: system sans, accent #467871 / #64BFB5, light+dark)' : ''}`)
  P(`scenes: at most ${band.scenes} incl. hero, mechanism and limits; directions: ${band.directions === 1 ? '1 (text-picked)' : '3 (rendered; pick after promote)'}`)
  P(`constraints from ratings: ${cons.length ? cons.map(c => `${c.code} → ${c.rule}`).join('; ') : 'none'}`)
  P(`last directions (must differ): ${lastDirs.length ? lastDirs.map(d => `${d.register}/${d.signature}`).join(', ') : 'none'}`)
  if (run.deny.length) P(`NEVER WRITE (sensitive identifiers): ${run.deny.join(', ')} — use readable domain names, e.g. Claims.LineItem`)
  P('')
  P(`siblings (link out to them; scenes must not restate their h2 claims):`)
  for (const s of sibs) P(`  ${s.file} "${s.title}"${s.h2.length ? ` — ${s.h2.slice(0, 8).join(' · ')}` : ''}`)
  P('')
  P(`source: ${src || 'none (every number must be labelled illustrative)'}`)
  P(`facts seed (cite as "seed:<id>"):`)
  for (const [id, f] of Object.entries(seed)) P(`  ${id} = ${f.value}   (${f.label})`)
  for (const ex of F.excerpts(src)) {
    P('')
    P(`${ex.file} (${ex.total} lines; cite as "${ex.file}:LINE"):`)
    for (const [n, t] of ex.lines) if (t.trim()) P(`  ${String(n).padStart(3)}| ${t}`)
  }
  const idx = F.numbersIndex(src)
  if (idx.length) {
    P('')
    P(`more citeable numbers (FILE:LINE):`)
    for (const [f, n, t] of idx) P(`  ${f}:${n}| ${t}`)
  }
  if (fr.frontier.length || fr.used.length) {
    P('')
    P(`journey frontier (optional inspiration): ${fr.frontier.slice(0, 10).join('; ')}`)
    P(`already used across the journey family (avoid as the signature): ${fr.used.slice(0, 14).join('; ')}`)
  }
  P('')
  P(`NEXT (≤${C.stageP80('brief', band)} min): Write ${path.join(dir, 'brief.json')} per ${path.join(SKILL_DIR, 'brief.schema.md')}, then run: node ${SELF} promote`)
  out(lines.join('\n'))
}

function cmdStatus(argv) {
  const dir = R.resolveRunDir(argv[0])
  const run = R.loadRun(dir)
  const now = Date.now()
  out(`${run.run_id} · ${run.band_label} ${run.N}m · elapsed ${fmtMMSS((now - run.T0) / 60000)} · left ${fmtMMSS((run.D - now) / 60000)}`)
  for (const s of run.plan) out(`  ${s.status.padEnd(5)} ${s.id}${s.variant ? `(${s.variant})` : ''} p80 ${s.p80}${s.why ? ` — ${s.why}` : ''}`)
  const cp = C.checkpoint(run, now)
  if (cp) out(cp)
}

const cmds = { start: cmdStart, status: cmdStatus }
export { cmds, out, die, SELF, dispatchLine, plannedLine }

const [cmd, ...rest] = process.argv.slice(2)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('lod.mjs')) {
  const more = await import('./lib/commands.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e })
  const all = { ...cmds, ...(more.commands || {}) }
  if (!all[cmd]) die(`unknown command: ${cmd || '(none)'}\ncommands: ${Object.keys(all).join(', ')}`, 2)
  try { await all[cmd](rest) } catch (e) { die(`lod ${cmd}: ${e.stack || e.message}`) }
}
