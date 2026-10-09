// The owner's clock: T0 from the transcript, the band for N minutes, the stage plan, and the gate that
// decides before every stage whether it runs, runs cheaper, or is cut. Pure functions; lod.mjs does the I/O.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SKILL = 'lipstick-on-a-deadline'
export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const LADDER = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'ladder.json'), 'utf8'))

export const projectDir = (cwd) => path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
export const transcriptPath = (cwd, sid) => path.join(projectDir(cwd), `${sid}.jsonl`)

const NOT_A_BUILD = /(^|\s)(rate|serve|verify)(\s|$)|--dry-run/

// T0 is the latest invocation of this skill that starts a build: a typed slash command, or a Skill tool call.
// Skill bodies (isMeta), tool results and non-build subcommands are ignored. An implausible T0 falls back to
// now − backS and is marked suspect so calibration skips it.
export function findT0(lines, { nowMs, maxAgeS = LADDER.t0_max_age_s, backS = LADDER.t0_suspect_back_s } = {}) {
  let best = null
  for (const raw of lines) {
    let e
    try { e = JSON.parse(raw) } catch { continue }
    const ms = Date.parse(e?.timestamp || '')
    if (!ms || e.isMeta) continue
    if (e.type === 'user' && typeof e.message?.content === 'string') {
      const t = e.message.content
      if (!t.includes(`<command-name>/${SKILL}</command-name>`)) continue
      const args = ((t.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '').trim()
      if (NOT_A_BUILD.test(args)) continue
      if (!best || ms >= best.ms) best = { ms, source: 'command', args }
    } else if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b?.type !== 'tool_use' || b.name !== 'Skill' || b.input?.skill !== SKILL) continue
        const args = String(b.input.args || '').trim()
        if (NOT_A_BUILD.test(args)) continue
        if (!best || ms >= best.ms) best = { ms, source: 'skill_tool', args }
      }
    }
  }
  if (!best || nowMs - best.ms > maxAgeS * 1000 || best.ms > nowMs + 5000) {
    return { ms: nowMs - backS * 1000, source: 'suspect', args: best?.args ?? null }
  }
  return best
}

export function bandFor(minutes) {
  if (minutes < LADDER.floor_min) return null
  return LADDER.bands.find(b => minutes >= b.min && minutes <= b.max) || LADDER.bands[LADDER.bands.length - 1]
}

// Stage p80 in minutes: calibration first (pooled, n ≥ 2), then the ladder seed.
export function stageP80(kind, band, calib = {}, opts = {}) {
  const c = calib.stages?.[kind]
  if (c && c.n >= 2 && typeof c.p80 === 'number') return c.p80
  const s = LADDER.stages[kind]
  if (!s) return 0
  if (kind === 'promote_v0') return opts.renderedDirs ? s.p80_rendered_dirs : s.p80
  if (typeof s.p80 === 'object') return s.p80[band.runs_as || band.name] ?? s.p80.standard
  return s.p80 ?? 0
}

export function coat1Cost(variant, slot) {
  const s = LADDER.stages.coat1
  const v = s.variants[variant]
  return s.spawn * (v.agents ? 1 : 0) + Math.max(v.agents ? slot : 0, v.m_p80)
}

const COAT1_ORDER = ['full', 'lite', 'm_only']

export function buildPlan(band, calib = {}) {
  const renderedDirs = band.directions > 1
  return band.plan.map(kind => {
    const s = LADDER.stages[kind]
    const st = { id: kind, kind, status: 'todo', mandatory: !!s.mandatory, cut_rank: s.cut_rank ?? null, follows: s.follows || null }
    if (kind === 'coat1') {
      st.variant = band.coat1_variant || 'lite'
      st.p80 = coat1Cost(st.variant, LADDER.stages.coat1.slot_p80)
    } else {
      st.p80 = stageP80(kind, band, calib, { renderedDirs })
    }
    return st
  })
}

export function reserveMin(run) { return (run.reserve_frac ?? LADDER.reserve_frac) * run.N }

// What should happen next. Mutates run.plan (cuts, variant downgrades) and returns the decision.
export function gate(run, nowMs) {
  const cuts = []
  const N = run.N
  const minsLeft = () => (run.D - nowMs) / 60000
  const elapsedFrac = (nowMs - run.T0) / 60000 / N
  const pensDown = elapsedFrac >= LADDER.pens_down_frac
  const reserve = reserveMin(run)
  const todoAfter = (i) => run.plan.slice(i + 1).filter(s => s.status === 'todo')
  const cutStage = (s, why) => {
    s.status = 'cut'; s.why = why; cuts.push(s.id)
    for (const f of run.plan) if (f.follows === s.id && f.status === 'todo') { f.status = 'cut'; f.why = `follows ${s.id}`; cuts.push(f.id) }
  }

  for (let guard = 0; guard < 50; guard++) {
    const idx = run.plan.findIndex(s => s.status === 'todo')
    if (idx < 0) return { decision: 'DONE', cuts }
    const s = run.plan[idx]
    const tail = todoAfter(idx).reduce((a, t) => a + t.p80, 0)
    const left = minsLeft()
    const window = left - tail - reserve
    const base = { stage: s.id, left: r1(left), tail: r1(tail), reserve: r1(reserve), window: r1(window), cuts, pensDown }

    if (s.kind === 'finish') {
      const fill = pickFill(window - s.p80)
      if (fill) return { ...base, decision: 'FILL', fill, fill_min: LADDER.fills[fill], deadline_ms: nowMs + LADDER.fills[fill] * 60000 }
      return { ...base, decision: 'GO', slot: s.p80 }
    }
    if (s.mandatory) return { ...base, decision: 'GO', slot: s.p80, behind: window < s.p80 }
    if (s.follows) return { ...base, decision: 'GO', slot: s.p80 }

    const C = LADDER.stages.coat1
    if (s.kind === 'coat1') {
      if (pensDown && C.variants[s.variant].agents) { s.variant = 'm_only'; s.p80 = coat1Cost('m_only', 0) }
      const def = C.variants[s.variant]
      if (window >= coat1Cost(s.variant, C.slot_min)) {
        const slot = def.agents ? Math.min(C.slot_p80, window - C.spawn) : 0
        s.p80 = coat1Cost(s.variant, slot)
        const agentDeadline = Math.min(nowMs + (C.spawn + slot) * 60000, run.T0 + LADDER.agent_deadline_frac * N * 60000)
        return { ...base, decision: 'GO', variant: s.variant, m_piece: def.m_piece, agents: def.agents,
          slot: r1(slot), deadline_ms: def.agents ? agentDeadline : null, m_deadline_ms: nowMs + s.p80 * 60000 }
      }
    } else if (!(s.kind === 'critic' && pensDown) && window >= s.p80) {
      return { ...base, decision: 'GO', slot: s.p80, deadline_ms: nowMs + s.p80 * 60000 }
    }

    // It doesn't fit. Cut a cheaper-to-lose stage from the tail first; then run a cheaper variant of this
    // stage; then cut this stage.
    const victim = todoAfter(idx)
      .filter(t => !t.mandatory && !t.follows && t.cut_rank != null && t.cut_rank < (s.cut_rank ?? 99))
      .sort((a, b) => a.cut_rank - b.cut_rank)[0]
    if (victim && !(s.kind === 'critic' && pensDown)) { cutStage(victim, `made room for ${s.id}`); continue }
    const next = s.kind === 'coat1' ? COAT1_ORDER[COAT1_ORDER.indexOf(s.variant) + 1] : null
    if (next) { s.variant = next; s.p80 = coat1Cost(next, C.slot_p80); continue }
    cutStage(s, pensDown && s.kind === 'critic' ? 'pens down' : `window ${r1(window)} < need`)
  }
  throw new Error('gate did not converge')
}

export function pickFill(window) {
  if (window >= LADDER.fills.standard) return 'standard'
  if (window >= LADDER.fills.micro) return 'micro'
  return null
}

// Projected finish with every remaining todo stage at p80.
export function projection(run, nowMs) {
  const rest = run.plan.filter(s => s.status === 'todo').reduce((a, s) => a + s.p80, 0)
  return nowMs + rest * 60000
}

export function checkpoint(run, nowMs) {
  const frac = (nowMs - run.T0) / 60000 / run.N
  const P = projection(run, nowMs)
  const diff = Math.round((P - run.D) / 1000)
  const tag = frac >= 0.8 ? 'CP80' : frac >= 0.5 ? 'CP50' : null
  if (!tag) return null
  return `${tag} ${diff <= 0 ? 'ON' : `BEHIND by ${diff}s`} (projected ${fmtClock(P)} vs deadline ${fmtClock(run.D)})`
}

// Walk the gate with every stage taking exactly its p80. Used by --dry-run and the tests.
export function newRun({ minutes, T0 = 0, calib = {}, reserveFrac = LADDER.reserve_frac }) {
  const band = bandFor(minutes)
  if (!band) return null
  return { N: minutes, T0, D: T0 + minutes * 60000, band: band.name, reserve_frac: reserveFrac, plan: buildPlan(band, calib) }
}

export function simulate(minutes, { calib = {}, elapsedBefore = LADDER.elapsed_before_plan_min } = {}) {
  const run = newRun({ minutes, calib })
  if (!run) return null
  let now = elapsedBefore * 60000
  const steps = []
  for (let i = 0; i < 60; i++) {
    const g = gate(run, now)
    if (g.decision === 'DONE') break
    const s = run.plan.find(x => x.id === g.stage)
    const dur = g.decision === 'FILL' ? g.fill_min : s.p80
    steps.push({ at: r1(now / 60000), stage: g.decision === 'FILL' ? `fill:${g.fill}` : s.id, variant: g.variant, dur: r1(dur), cuts: g.cuts })
    now += dur * 60000
    if (g.decision !== 'FILL') s.status = 'done'
  }
  return { run, steps, actual: r1(now / 60000) }
}

export const r1 = (x) => Math.round(x * 10) / 10
export const fmtClock = (ms) => new Date(ms).toTimeString().slice(0, 8)
export const fmtMMSS = (min) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${String(Math.abs(s % 60)).padStart(2, '0')}` }
