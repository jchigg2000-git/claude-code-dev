// Honesty is mechanical: numbers live only in brief.data and each is checked against its source; word fields
// carry no bare digits; the topic's sensitive identifiers never appear. Every failure names where to fix it.
import fs from 'node:fs'
import path from 'node:path'
import { evaluate } from './expr.js'

const NUM_RE = /(?<![\d.])[~$]?\d[\d,]*(?:\.\d+)?(?![\d.])/g
export const numsIn = (s) => (String(s).match(NUM_RE) || []).map(t => Number(t.replace(/[~$,]/g, '')))
const WORD_KEYS = new Set(['kicker', 'headline', 'body', 'hood', 'title', 'outcome', 'why', 'label', 'what', 'note', 'tag', 'teaser',
  'go', 'then', 'steps', 'detail', 'text', 'phone', 'spine', 'metaphor', 'exec', 'tech', 'creative', 'caption', 'close', 'when', 'limits', 'item'])
const NON_WORD = new Set(['id', 'src', 'href', 'archetype', 'formula', 'of', 'knobs', 'register', 'signature', 'preset', 'span', 'params',
  'filename', 'chosen', 'options', 'num', 'count', 'rank', 'data', 'links', 'cut_order', 'sensitive', 'kind', 'value', 'prefix', 'suffix', 'decimals', 'reader', 'beat', 'type_treatment', 'archetypes', 'phone_motion'])

// Strip {#id} references and `code` spans; what remains must not hold digits.
export const stripAllowed = (s) => String(s).replace(/\{#[\w.\-]+\}/g, '').replace(/`[^`]*`/g, '')

export function digitFindings(brief) {
  const out = []
  const walk = (v, p, inWords) => {
    if (v == null) return
    if (typeof v === 'string') { if (inWords && /\d/.test(stripAllowed(v))) out.push(`digit in ${p}: "${v.slice(0, 70)}"`); return }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`, inWords)); return }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      if (NON_WORD.has(k)) continue
      walk(x, p ? `${p}.${k}` : k, inWords || WORD_KEYS.has(k) || ['hero', 'scenes', 'readers', 'mechanism', 'limits'].includes(k))
    }
  }
  for (const k of ['title', 'spine', 'metaphor', 'readers', 'hero', 'scenes', 'mechanism', 'limits', 'close']) walk(brief[k], k, true)
  return out
}

export function refsIn(brief) {
  const ids = new Set()
  JSON.stringify(brief).replace(/\{#([\w.\-]+)\}/g, (_, id) => { ids.add(id); return '' })
  return ids
}

// Resolve data: literal values, seed values, and derived formulas (inputs first). Returns { table, errors }.
export function resolveData(brief, seed = {}) {
  const table = {}, errors = []
  const entries = brief.data || []
  for (const d of entries) {
    if (!d || !d.id) { errors.push('data entry without id'); continue }
    if (d.formula) continue
    let value = d.value
    if (value === undefined && typeof d.src === 'string' && d.src.startsWith('seed:')) value = seed[d.src.slice(5)]?.value
    table[d.id] = { ...d, value }
  }
  for (let pass = 0; pass < 5; pass++) for (const d of entries.filter(e => e?.formula && !table[e.id])) {
    const vars = Object.fromEntries(Object.entries(table).filter(([, v]) => typeof v.value === 'number').map(([k, v]) => [k, v.value]))
    if ((d.of || []).some(id => !(id in vars))) continue
    try { table[d.id] = { ...d, value: evaluate(d.formula, vars), src: d.src || `derived: ${d.formula}` } } catch (e) { errors.push(`${d.id}: ${e.message}`) }
  }
  for (const d of entries.filter(e => e?.formula && !table[e.id])) errors.push(`${d.id}: formula inputs missing (${(d.of || []).join(', ')})`)
  return { table, errors }
}

const norm = (v) => String(v).trim().toLowerCase()

// Check each data entry against its source: seed:<id> must equal the seed; FILE:LINE must hold the value
// within ±3 lines (numbers compared numerically, so 381 never matches 3810); illustrative is allowed but
// never on the hero; derived values are fine when their inputs are.
export function checkData(table, { seed = {}, src = null, heroIds = new Set() } = {}) {
  const errors = [], notes = []
  for (const [id, d] of Object.entries(table)) {
    const s = String(d.src || '')
    if (d.formula) continue
    if (d.value === undefined || d.value === null || d.value === '') { errors.push(`${id}: no value`); continue }
    if (s.startsWith('seed:')) {
      const sv = seed[s.slice(5)]
      if (!sv) errors.push(`${id}: unknown seed "${s.slice(5)}"`)
      else if (norm(sv.value) !== norm(d.value)) errors.push(`${id}: value ${d.value} ≠ seed ${s.slice(5)} = ${sv.value}`)
      continue
    }
    if (s === 'illustrative') { if (heroIds.has(id)) errors.push(`${id}: the hero can't use an illustrative number`); else notes.push(`${id} illustrative`); continue }
    const m = s.match(/^([^:]+):(\d+)(?:[-–](\d+))?$/)
    if (!m) { errors.push(`${id}: src must be seed:<id>, FILE:LINE or illustrative (got "${s}")`); continue }
    if (!src) { errors.push(`${id}: no source repo to check ${s} against`); continue }
    const file = path.join(src, m[1])
    if (!fs.existsSync(file)) { errors.push(`${id}: ${m[1]} not found in ${src}`); continue }
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    const lo = Math.max(0, Number(m[2]) - 4), hi = Math.min(lines.length, Number(m[3] || m[2]) + 3)
    const win = lines.slice(lo, hi).join('\n').replace(/^\s*>\s?/gm, '').replace(/[*`]/g, '')
    const ok = typeof d.value === 'number' ? numsIn(win).some(n => Math.abs(n - d.value) < 1e-9) : win.toLowerCase().includes(norm(d.value))
    if (!ok) errors.push(`${id}: ${d.value} not found at ${s} (±3 lines)`)
  }
  return { errors, notes }
}

export function denyHits(text, deny = []) {
  const hits = []
  for (const t of deny) {
    if (!t) continue
    const re = /^[A-Za-z]+$/.test(t) ? new RegExp(`\\b${t}\\b`, 'i') : new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    if (re.test(text)) hits.push(t)
  }
  return hits
}
