// Everything the brief may cite: the source repo (git facts as seed ids, numbered excerpts as FILE:LINE),
// the sibling pages (titles, h2s, sha256, brand), the topic's denylist, and the global journey frontier.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { SKILL_DIR } from './clock.mjs'

export const DATA_DIR = process.env.LOD_DATA_DIR || path.join(os.homedir(), 'Projects', '.claude', 'lipstick-on-a-deadline')
export const JOURNEY_LEDGER = path.join(os.homedir(), 'Projects', '.claude', 'journey-pages', 'ledger.md')

export const slugify = (s, words = 6) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).slice(0, words).join('-') || 'page'

const git = (dir, args) => {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 << 20 }).trim() } catch { return null }
}
const isRepo = (dir) => !!dir && fs.existsSync(dir) && git(dir, ['rev-parse', '--show-toplevel']) != null

// --src, then ~/Projects/<topic-slug>, then the cwd's git root, then ~/Projects/<basename cwd>, else none.
export function resolveSrc({ src, topic, cwd }) {
  const home = os.homedir()
  const cands = [src && path.resolve(src.replace(/^~/, home)), path.join(home, 'Projects', slugify(topic, 4)),
    git(cwd, ['rev-parse', '--show-toplevel']), path.join(home, 'Projects', path.basename(cwd))]
  for (const c of cands) if (c && isRepo(c)) return git(c, ['rev-parse', '--show-toplevel'])
  return null
}

export function gitFacts(src) {
  if (!src) return {}
  const f = {}
  const put = (id, value, label) => { if (value != null && value !== '') f[id] = { value, label, src: `git ${path.basename(src)}` } }
  const head = git(src, ['rev-parse', '--short', 'HEAD'])
  put('git.head', head, 'commit the facts were read at')
  put('git.commits', Number(git(src, ['rev-list', '--count', 'HEAD'])), 'commits on HEAD')
  const dates = (git(src, ['log', '--format=%ad', '--date=short']) || '').split('\n').filter(Boolean)
  if (dates.length) {
    put('git.first_date', dates[dates.length - 1], 'first commit')
    put('git.last_date', dates[0], 'latest commit')
    const days = new Set(dates)
    put('git.active_days', days.size, 'days with at least one commit')
    const span = Math.round((Date.parse(dates[0]) - Date.parse(dates[dates.length - 1])) / 86400000) + 1
    put('git.span_days', span, 'calendar days from first to latest commit')
    const per = {}
    for (const d of dates) per[d] = (per[d] || 0) + 1
    Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 6).sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([d, n]) => put(`git.commits_on.${d}`, n, `commits on ${d}`))
  }
  put('git.authors', (git(src, ['shortlog', '-sn', 'HEAD']) || '').split('\n').filter(Boolean).length, 'distinct commit authors')
  const files = (git(src, ['ls-files']) || '').split('\n').filter(Boolean)
  put('files.tracked', files.length, 'tracked files')
  const ext = {}
  for (const p of files) { const m = p.match(/\.([a-z0-9]+)$/i); if (m) ext[m[1].toLowerCase()] = (ext[m[1].toLowerCase()] || 0) + 1 }
  Object.entries(ext).sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([e, n]) => put(`files.${e}`, n, `tracked .${e} files`))
  const code = files.filter(p => /\.(ts|tsx|js|mjs|py|go|rs|java|rb|sql|swift|kt)$/i.test(p))
  let loc = 0
  for (const p of code) { try { loc += fs.readFileSync(path.join(src, p), 'utf8').split('\n').length } catch {} }
  if (code.length) put('loc.code', loc, `lines in ${code.length} source files`)
  const tests = files.filter(p => /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z]+$/i.test(p))
  if (tests.length) put('files.test', tests.length, 'test files')
  return f
}

const DOCS = [['README.md', 80], ['ROADMAP.md', 70], ['DECISIONS.md', 30], ['CHANGELOG.md', 30]]

export function excerpts(src) {
  const out = []
  if (!src) return out
  for (const [name, n] of DOCS) {
    const p = path.join(src, name)
    if (!fs.existsSync(p)) continue
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    out.push({ file: name, total: lines.length, lines: lines.slice(0, n).map((t, i) => [i + 1, t.slice(0, 180)]) })
  }
  return out
}

// Lines carrying digits across the docs, beyond the excerpt windows, so the brief can cite FILE:LINE.
export function numbersIndex(src, limit = 70) {
  const out = []
  if (!src) return out
  for (const [name, skip] of DOCS) {
    const p = path.join(src, name)
    if (!fs.existsSync(p)) continue
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    lines.forEach((t, i) => {
      if (i < skip || out.length >= limit) return
      if (/\d/.test(t) && /[a-z]{3}/i.test(t) && !/^\s*[-|]{3}/.test(t) && !/^#/.test(t)) out.push([name, i + 1, t.trim().slice(0, 170)])
    })
  }
  return out
}

export const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

export function siblings(root, { exclude = [] } = {}) {
  const out = []
  for (const f of fs.readdirSync(root).filter(f => f.endsWith('.html')).sort()) {
    if (exclude.includes(f)) continue
    const p = path.join(root, f)
    const html = fs.readFileSync(p, 'utf8')
    const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || f
    const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14)
    out.push({ file: f, title, h2, sha256: sha256(p), bytes: html.length })
  }
  return out
}

export function sharedPrefix(files) {
  if (files.length < 2) return ''
  let pre = files[0]
  for (const f of files) while (!f.startsWith(pre)) pre = pre.slice(0, -1)
  const m = pre.match(/^[a-z0-9]+-/i)
  return m ? m[0] : ''
}

// A brand file declares <!-- @brand:detect <regex> -->; auto picks the one matching ≥2 siblings.
export function detectBrand(root, sibs, want = 'auto') {
  const dir = path.join(SKILL_DIR, 'chassis', 'brands')
  const brands = fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, ''))
  if (want !== 'auto') return brands.includes(want) ? want : 'journey'
  for (const b of brands) {
    const m = fs.readFileSync(path.join(dir, `${b}.html`), 'utf8').match(/<!-- @brand:detect (.+?) -->/)
    if (!m) continue
    const re = new RegExp(m[1])
    const hits = sibs.filter(s => re.test(fs.readFileSync(path.join(root, s.file), 'utf8'))).length
    if (hits >= 2) return b
  }
  return 'journey'
}

export function denylist(topicSlug, briefSensitive = []) {
  const p = path.join(DATA_DIR, 'topics', `${topicSlug}.json`)
  let deny = []
  if (fs.existsSync(p)) deny = JSON.parse(fs.readFileSync(p, 'utf8')).deny || []
  return [...new Set([...deny, ...briefSensitive].filter(Boolean))]
}

// Soft no-repeat from the global journey ledger: headings of the NO-REPEAT list and the frontier bullets.
export function frontier(limit = 18) {
  if (!fs.existsSync(JOURNEY_LEDGER)) return { used: [], frontier: [] }
  const t = fs.readFileSync(JOURNEY_LEDGER, 'utf8')
  const sect = (h) => { const i = t.indexOf(h); if (i < 0) return ''; const j = t.indexOf('\n## ', i + h.length); return t.slice(i, j < 0 ? undefined : j) }
  const bullets = (s) => s.split('\n').filter(l => /^\s*[-*] /.test(l) && !/^\s*[-*] ~~/.test(l)).map(l => l.replace(/^\s*[-*] /, '').replace(/\*\*/g, '').split(/ — | – |: /)[0].trim().slice(0, 90))
  return { used: bullets(sect('## Techniques already used')).slice(0, limit), frontier: bullets(sect('## Unexplored frontier')).slice(0, limit) }
}
