#!/usr/bin/env node
// Regression test for the rubric v2/v3 mechanism fixes in workflow.mjs.
// Runs the real workflow against a stubbed agent runtime and asserts that the script-side gate
// blocks what v1 let through and admits what v2 would have wrongly refused:
//   1. a higher total with a Craft regression cannot dethrone        (no-regression gate, v2)
//   2. a higher total inside the base margin cannot dethrone         (incumbency bias, v2)
//   3. a big win that adds regions is taxed and fails                (growth tax, v3)
//   4. a one-region increase is inside the deadband and untaxed      (counting noise, v3)
//   5. a modest win that cuts regions gets the discount and wins     (cut refund, v3)
//   6. in the subtractive round, only a smaller design is admissible (v2)
//   7. the judge is handed blind labels only — no id, path, approach or incumbency marker
// Usage: node scripts/test-gate.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'workflow.mjs')

// Wrap the workflow (top-level await + top-level return) as an async function taking its globals.
const src = readFileSync(SRC, 'utf8').replace(/^export const meta/m, 'const meta')
const tmp = mkdtempSync(join(tmpdir(), 'uxt-'))
const mod = join(tmp, 'wrapped.mjs')
writeFileSync(mod, `export default async function run({ args, agent, parallel, phase, log, budget }) {\n${src}\n}\n`)
const { default: run } = await import(mod)

// ---- scripted judge scores, keyed by the real candidate id. Incumbent baseline: 80 / UX 65 / Craft 12 / 10 regions.
const S = (total, ux, craft, regions) => ({ total, ux, craft, regions, axes: {}, gap_notes: 'n/a', rationale: 'n/a' })
const SCORES = {
  'r1-anchor-a':   S(80, 65, 12, 10),  // the anchor
  'r2-climb-a':    S(90, 78, 10, 11),  // +10 total, Craft 10 < 12      -> blocked: no-regression
  'r2-climb-b':    S(96, 80, 13, 14),  // +16 total, adds 4 regions     -> blocked: taxed margin is 17
  'r2-climb-c':    S(85, 70, 13, 11),  // +5 total, adds 1 (deadband)   -> blocked: plain margin 8, untaxed
  'r3-subtract-a': S(92, 70, 14, 10),  // clears every score gate, same size -> blocked: subtractive round
  'r3-subtract-b': S(85, 68, 13,  7),  // +5 total, cuts 3 regions      -> WINS: discounted margin is 4
}

const leaks = []
let labelToId = {}
const logs = []
let stageOk = true

const fakeAgent = async (prompt, opts) => {
  const label = opts.label || ''
  if (label.startsWith('stage:')) {
    labelToId = {}
    for (const m of prompt.matchAll(/- (E\d+): .*?source id "([^"]+)"/g)) labelToId[m[1]] = m[2]
    return stageOk ? { ok: true } : { ok: false, note: 'cp failed (simulated)' }
  }
  if (label.startsWith('gen:')) {
    const id = label.slice(4)
    return { id, approach: 'approach-' + id, thesis: 't', mockup: `/x/${id}/mockup.html`,
      screenshot: `/x/${id}/mockup.png`, narrative: `/x/${id}/narrative.md`, rendered: true }
  }
  if (label.startsWith('judge:')) {
    // Blindness: nothing in the judge prompt may identify an entry competing this round.
    for (const id of Object.values(labelToId)) {
      if (prompt.includes(id)) leaks.push(`${label}: prompt names participant ${id}`)
      if (prompt.includes('approach-' + id)) leaks.push(`${label}: prompt names participant approach ${id}`)
    }
    if (/incumbent|champion|reigning|title-?holder/i.test(prompt)) leaks.push(`${label}: prompt mentions incumbency`)
    const entries = [...prompt.matchAll(/- (E\d+): image/g)].map(m => m[1])
    if (!entries.length) throw new Error('judge prompt listed no entries')
    return { scores: entries.map(l => {
      const id = labelToId[l]
      if (!SCORES[id]) throw new Error('unscripted candidate ' + id)
      return Object.assign({ label: l }, SCORES[id])
    }) }
  }
  if (label === 'build-plan') return { path: '/x/plan.md', summary: 's', acceptance: [] }
  throw new Error('unexpected agent label ' + label)
}

const RUNTIME = {
  args: {
    dir: '/x', brief: '/x/brief.md', rubric: '/x/rubric.md', render: '/x/render.sh',
    date: '2026-09-20', screen: 'test screen',
    caps: { scouts: 0, anchorGens: 1, anchorJudge: 'opus', climbRounds: 2, climbGens: 3,
      subtractRounds: 1, subtractGens: 2, pushRounds: 0, summitGens: 0, crown: null },
  },
  agent: fakeAgent,
  parallel: (fns) => Promise.all(fns.map(f => f())),
  phase: () => {},
  log: (m) => logs.push(m),
  budget: { spent: () => 0 },
}
const out = await run(RUNTIME)

// ---- assertions ----
const fail = []
const check = (cond, msg) => { if (!cond) fail.push(msg) }
const byRound = Object.fromEntries(out.history.map(h => [h.round, h]))
const row = (r, id) => byRound[r].entries.find(e => e.id === id) || {}
const blockedFor = (r, id) => row(r, id).blocked

check(out.rubric === 'v3', `rubric ${out.rubric} != v3`)
check(byRound[1].verdict === 'first', `r1 verdict ${byRound[1].verdict} != first`)

// round 2 — every challenger blocked, each for its own reason
check(byRound[2].verdict === 'incumbent_stands', `r2 verdict ${byRound[2].verdict} != incumbent_stands`)
check(byRound[2].incumbent_rescore === 80, `r2 incumbent re-score ${byRound[2].incumbent_rescore} != 80`)
check(/Craft regression/.test(blockedFor(2, 'r2-climb-a') || ''), `r2-climb-a: "${blockedFor(2, 'r2-climb-a')}" != Craft regression`)
check(blockedFor(2, 'r2-climb-b') === 'under margin: 96 < 80 + 17 (adds 4 regions)', `r2-climb-b: "${blockedFor(2, 'r2-climb-b')}" != taxed margin 17`)
check(row(2, 'r2-climb-b').required === 17, `r2-climb-b required ${row(2, 'r2-climb-b').required} != 17`)
check(blockedFor(2, 'r2-climb-c') === 'under margin: 85 < 80 + 8', `r2-climb-c: "${blockedFor(2, 'r2-climb-c')}" != untaxed margin 8 (deadband)`)
check(row(2, 'r2-climb-c').required === 8, `r2-climb-c required ${row(2, 'r2-climb-c').required} != 8 — the one-region deadband is not holding`)

// round 3 — subtractive, and the cut discount lets a +5 win through
check(byRound[3].subtractive === true, 'r3 not marked subtractive')
check(/subtractive round/.test(blockedFor(3, 'r3-subtract-a') || ''), `r3-subtract-a: "${blockedFor(3, 'r3-subtract-a')}" != subtractive`)
check(row(3, 'r3-subtract-b').required === 4, `r3-subtract-b required ${row(3, 'r3-subtract-b').required} != 4 (8 − 2×2 for cutting 3)`)
check(byRound[3].verdict === 'dethroned', `r3 verdict ${byRound[3].verdict} != dethroned — a +5 win that cut 3 regions should clear the discounted margin`)
check(out.champion.id === 'r3-subtract-b', `champion ${out.champion.id} != r3-subtract-b`)
check(out.champion.regions === 7 && out.champion.craft === 13 && out.champion.ux === 68, 'champion subtotals not carried')

// blindness
check(out.history.every(h => h.blind === true), 'a round judged non-blind')
check(leaks.length === 0, 'blindness leaks: ' + leaks.join(' | '))

// ---- scenario 2: blind staging fails -> the run must still complete, gate unchanged, and say so ----
stageOk = false
const out2 = await run(RUNTIME)
check(out2.champion.id === 'r3-subtract-b', `fallback champion ${out2.champion.id} != r3-subtract-b`)
check(out2.history.every(h => h.blind === false), 'fallback run not marked non-blind')
check(logs.some(m => /blind staging failed/.test(m)), 'fallback did not log the staging failure')

if (fail.length) { console.error('FAIL\n- ' + fail.join('\n- ')); process.exit(1) }
console.log(`PASS — margin ${out.margin} base, tax +${out.tax.growthTax}/region over a ${out.tax.deadband}-region deadband, refund −${out.tax.cutDiscount} to a floor of ${out.tax.floor}`)
console.log(`       ${out.history.length} rounds; blocked: 96@+16 (added 4) and 85@+5 (deadband); crowned ${out.champion.id} @ ${out.champion.total} on +5 after cutting 3 regions`)
