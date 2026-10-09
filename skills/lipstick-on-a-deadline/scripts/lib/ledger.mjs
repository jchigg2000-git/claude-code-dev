// The local ledger: runs.jsonl (one line per run), ledger.md (a readable row per run), calibration.json.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './facts.mjs'
import { LADDER } from './clock.mjs'
import { readJSON, writeJSON } from './run.mjs'

export const RUNS = path.join(DATA_DIR, 'runs.jsonl')
export const LEDGER_MD = path.join(DATA_DIR, 'ledger.md')
export const CALIB = path.join(DATA_DIR, 'calibration.json')

export function readRuns() {
  if (!fs.existsSync(RUNS)) return []
  return fs.readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

export function writeRuns(runs) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${RUNS}.${process.pid}.tmp`
  fs.writeFileSync(tmp, runs.map(r => JSON.stringify(r)).join('\n') + (runs.length ? '\n' : ''))
  fs.renameSync(tmp, RUNS)
}

export function upsertRun(rec) {
  const runs = readRuns()
  const i = runs.findIndex(r => r.run_id === rec.run_id)
  if (i >= 0) runs[i] = { ...runs[i], ...rec }
  else runs.push(rec)
  writeRuns(runs)
  return runs
}

export const loadCalib = () => readJSON(CALIB, { stages: {}, usd: {}, reserve_frac: LADDER.reserve_frac })

export function lastDirections(runs, n = 3) {
  return runs.filter(r => r.direction && !r.rehearsal).slice(-n).map(r => r.direction)
}

// The last three rated runs' reason codes become hard constraints on the next brief.
export function activeConstraints(runs) {
  const rated = runs.filter(r => typeof r.rating === 'number' && !r.rehearsal).slice(-3)
  const codes = [...new Set(rated.flatMap(r => r.reasons || []))]
  return codes.filter(c => LADDER.reason_codes[c]).map(c => ({ code: c, rule: LADDER.reason_codes[c] }))
}

const p80 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.8 * s.length) - 1)] }

// Pooled p80 per stage kind over the last 10 clean runs; the reserve rises after 2 misses in the last 5.
export function calibrate(runs = readRuns()) {
  const clean = runs.filter(r => !r.rehearsal && r.t0_source !== 'suspect' && (r.context_tokens ?? 0) <= LADDER.context.warn_tokens && r.stages)
  const byKind = {}
  for (const r of clean.slice(-10)) for (const s of r.stages) if (s.actual_min > 0 && !String(s.kind).startsWith('fill')) (byKind[s.kind] ||= []).push(s.actual_min)
  const stages = {}
  for (const [k, xs] of Object.entries(byKind)) stages[k] = { p80: Math.round(p80(xs) * 100) / 100, n: xs.length }
  const last5 = runs.filter(r => !r.rehearsal && typeof r.pct_off === 'number').slice(-5)
  const misses = last5.filter(r => Math.abs(r.pct_off) > 15).length
  const reserve_frac = misses >= 2 ? LADDER.reserve_frac_bumped : LADDER.reserve_frac
  const usd = {}
  for (const r of runs.filter(r => r.usd_sub_by_tier && r.agent_counts).slice(-10)) {
    for (const [tier, n] of Object.entries(r.agent_counts)) if (n > 0 && r.usd_sub_by_tier[tier] != null) (usd[tier] ||= []).push(r.usd_sub_by_tier[tier] / n)
  }
  const usd_per_agent = Object.fromEntries(Object.entries(usd).map(([t, xs]) => [t, Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100]))
  const calib = { updated: new Date().toISOString(), stages, reserve_frac, usd_per_agent, n_runs: clean.length }
  const prev = loadCalib()
  writeJSON(CALIB, calib)
  return { prev, calib }
}

export function ledgerRow(r) {
  const cell = (x) => (x == null || x === '' ? '—' : String(x).replace(/\|/g, '/'))
  return `| ${[r.date, r.topic, r.band, r.target_min, r.actual_min, r.pct_off != null ? `${r.pct_off > 0 ? '+' : ''}${r.pct_off}%` : null,
    (r.versions || []).length ? `v0–v${r.versions.length - 1}` : null, (r.cuts || []).join(', '), r.fills,
    r.usd_main != null ? `$${r.usd_main}` : null, r.usd_sub != null ? `$${r.usd_sub}` : null,
    r.rating, (r.reasons || []).join(', '), r.page ? path.basename(r.page) : null].map(cell).join(' | ')} |`
}

export function renderLedger(runs = readRuns()) {
  const head = `# /lipstick-on-a-deadline ledger\n\nNon-contest runs: target vs actual minutes on the owner's clock, $ at list price from cost.py, and the owner's rating.\nGenerated from runs.jsonl by lod.mjs; edit runs.jsonl (or use rate) rather than this file.\n\n| Date | Topic | Band | Target | Actual | Δ | Versions | Cuts | Fills | $ main | $ sub | Rating | Reasons | Page |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`
  const rows = runs.filter(r => !r.rehearsal).map(ledgerRow).join('\n')
  const reh = runs.filter(r => r.rehearsal).map(ledgerRow).join('\n')
  const dirs = runs.filter(r => r.direction).map(r => `- ${r.date} ${r.topic}: ${[r.direction.register, r.direction.signature, (r.direction.archetypes || []).join('/')].join(' · ')}`).join('\n')
  const body = `${head}${rows}\n\n## Rehearsals\n\n| Date | Topic | Band | Target | Actual | Δ | Versions | Cuts | Fills | $ main | $ sub | Rating | Reasons | Page |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${reh}\n\n## Directions used (the next run must differ from the last three)\n\n${dirs || '- none yet'}\n`
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(LEDGER_MD, body)
}
