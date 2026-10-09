// Run state: one directory per run under <root>/.lipstick.nosync/<run-id>/ (iCloud skips .nosync names),
// with run.json as the single source of truth so a compacted or interrupted session can resume.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectDir } from './clock.mjs'

export const SCRATCH = '.lipstick.nosync'

export function newRunDir(root, runId) {
  const dir = path.join(root, SCRATCH, runId)
  for (const d of ['', 'prompts', 'frags', 'done', 'png', 'versions']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  return dir
}

export function latestRunDir(root) {
  const base = path.join(root, SCRATCH)
  if (!fs.existsSync(base)) return null
  const runs = fs.readdirSync(base).filter(d => fs.existsSync(path.join(base, d, 'run.json')))
    .map(d => ({ d, t: fs.statSync(path.join(base, d, 'run.json')).mtimeMs })).sort((a, b) => b.t - a.t)
  return runs.length ? path.join(base, runs[0].d) : null
}

// --run <dir|id|last>; defaults to the newest run under the cwd (or LOD_ROOT).
export function resolveRunDir(arg, root = process.env.LOD_ROOT || process.cwd()) {
  if (arg && arg !== 'last') {
    if (fs.existsSync(path.join(arg, 'run.json'))) return path.resolve(arg)
    const p = path.join(root, SCRATCH, arg)
    if (fs.existsSync(path.join(p, 'run.json'))) return p
  }
  const d = latestRunDir(root)
  if (!d) throw new Error(`no run found under ${path.join(root, SCRATCH)}`)
  return d
}

export const loadRun = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'))

export function saveRun(dir, run) {
  const p = path.join(dir, 'run.json')
  const tmp = `${p}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n')
  fs.renameSync(tmp, p)
}

export function readJSON(p, dflt = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return dflt }
}

export function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n')
  fs.renameSync(tmp, p)
}

// The session transcript: the cwd's project dir first, then any project dir holding <sid>.jsonl.
export function findTranscript(cwd, sid) {
  if (!sid) return null
  const p = path.join(projectDir(cwd), `${sid}.jsonl`)
  if (fs.existsSync(p)) return p
  const base = path.join(os.homedir(), '.claude', 'projects')
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const q = path.join(base, d, `${sid}.jsonl`)
    if (fs.existsSync(q)) return q
  }
  return null
}

// main_model and context size from the last main-session assistant entry (usage lines deduped by id;
// the largest value wins because streaming writes partial usage first).
export function sessionFacts(transcript) {
  if (!transcript) return { main_model: null, context_tokens: null }
  const lines = fs.readFileSync(transcript, 'utf8').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    let e
    try { e = JSON.parse(lines[i]) } catch { continue }
    if (e.type !== 'assistant' || !e.message?.usage || e.isSidechain) continue
    const u = e.message.usage
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
    return { main_model: e.message.model || null, context_tokens: ctx }
  }
  return { main_model: null, context_tokens: null }
}

export function tokenize(argv) {
  const s = argv.join(' ')
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}
