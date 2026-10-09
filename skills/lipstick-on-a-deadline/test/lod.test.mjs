// One regression test per behaviour. Run: node --test ~/.claude/skills/lipstick-on-a-deadline/test/
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as clock from '../scripts/lib/clock.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILL = path.resolve(HERE, '..')
const LOD = path.join(SKILL, 'scripts', 'lod.mjs')
const { LADDER } = clock

// (a) the gate: every band lands inside ±15% when stages take their p80; the default band keeps the
// centerpiece and cuts fix_b first; no agent launches after pens-down; the band table holds.
test('(a) gate lands every band within ±15% and cuts in order', () => {
  for (const m of [9, 12, 14, 17, 20, 25, 30, 34]) {
    const r = clock.simulate(m)
    assert.ok(Math.abs(r.actual - m) / m <= 0.15, `${m} min landed at ${r.actual}`)
  }
  const std = clock.simulate(25)
  const coat = std.steps.find(s => s.stage === 'coat1')
  assert.equal(coat.variant, 'full')
  assert.deepEqual(coat.cuts, ['fix_b'])
  assert.equal(clock.simulate(15).steps.find(s => s.stage === 'coat1').variant, 'lite')
  assert.ok(!clock.simulate(10).steps.some(s => s.stage === 'coat1'))

  const run = clock.newRun({ minutes: 25 })
  for (const s of run.plan) if (['brief', 'promote_v0'].includes(s.id)) s.status = 'done'
  const g = clock.gate(run, 0.85 * 25 * 60000)
  if (g.decision === 'GO' && g.stage === 'coat1') assert.equal(g.agents, false)
  const critic = run.plan.find(s => s.id === 'critic')
  const g2 = clock.gate({ ...run, plan: run.plan.map(s => ({ ...s, status: s.id === 'critic' || s.id === 'finish' ? 'todo' : 'done' })) }, 0.85 * 25 * 60000)
  assert.notEqual(g2.stage === 'critic' && g2.decision, 'GO')
  assert.ok(critic)

  for (const b of LADDER.bands.filter(b => !b.milestone_b)) {
    const plan = clock.buildPlan(b)
    const mandatory = plan.filter(s => s.mandatory).reduce((a, s) => a + s.p80, 0)
    assert.ok(LADDER.elapsed_before_plan_min + mandatory + LADDER.reserve_frac * b.min <= b.min, `${b.name} mandatory floor`)
  }
})

// (b) T0: the latest build invocation wins; rate/dry-run/serve, skill bodies and tool results are ignored;
// a stale or missing invocation falls back to now − 45 s and is marked suspect.
test('(b) T0 comes from the invoking message, not decoys', () => {
  const now = Date.parse('2026-09-26T22:00:00.000Z')
  const at = (s) => new Date(now - s * 1000).toISOString()
  const cmd = (args, s) => JSON.stringify({ type: 'user', timestamp: at(s), message: { role: 'user',
    content: `<command-message>lipstick-on-a-deadline</command-message>\n<command-name>/lipstick-on-a-deadline</command-name>\n<command-args>${args}</command-args>` } })
  const lines = [
    cmd('twin-compiler 25', 90),
    cmd('rate 7 sameness', 20),
    cmd('twin-compiler --dry-run 25', 15),
    JSON.stringify({ type: 'user', isMeta: true, timestamp: at(10), message: { content: [{ type: 'text', text: 'Base directory for this skill: <command-name>/lipstick-on-a-deadline</command-name>' }] } }),
    JSON.stringify({ type: 'user', timestamp: at(8), message: { content: [{ type: 'tool_result', content: '<command-name>/lipstick-on-a-deadline</command-name>' }] } }),
    'not json',
  ]
  const t = clock.findT0(lines, { nowMs: now })
  assert.equal(t.source, 'command')
  assert.equal(t.ms, now - 90000)
  assert.equal(t.args, 'twin-compiler 25')

  const tool = JSON.stringify({ type: 'assistant', timestamp: at(30), message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'lipstick-on-a-deadline', args: 'x 15' } }] } })
  assert.equal(clock.findT0([...lines, tool], { nowMs: now }).source, 'skill_tool')

  const stale = clock.findT0([cmd('twin-compiler 25', 600)], { nowMs: now })
  assert.equal(stale.source, 'suspect')
  assert.equal(stale.ms, now - 45000)
})

// (c) below the floor: refuse, spend nothing, create no run.
test('(c) a budget under 9 minutes is refused before anything is created', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-c-'))
  const r = spawnSync('node', [LOD, 'start', '--root', root, 'topic', '8'], { encoding: 'utf8', env: { ...process.env, LOD_NO_CAFFEINATE: '1' } })
  assert.match(r.stdout + r.stderr, /Smallest honest build is 9 min/)
  assert.equal(fs.existsSync(path.join(root, '.lipstick.nosync')), false)
})
