// Build one self-contained page from the brief, the chassis, the brand block, and whichever scene fragments
// are accepted. Words come only from brief.json (M owns them); numbers only from brief.data.
import fs from 'node:fs'
import path from 'node:path'
import { SKILL_DIR } from './clock.mjs'
import { resolveData } from './honesty.mjs'

const CH = path.join(SKILL_DIR, 'chassis')
const read = (p) => fs.readFileSync(p, 'utf8')
export const ARCHETYPES = ['hero-alive', 'pinned-argument', 'full-bleed-number', 'split-before-after', 'scrubbed-timeline', 'peer-rail', 'snap-chapter']
export const FIXED = ['mechanism-stepper', 'limits', 'close']
export const REGISTERS = ['dark-glass', 'paper-ink', 'blueprint', 'night-ink', 'plain-light']
export const SIGNATURES = ['ruled-line', 'spine-path', 'ink-sweep']
const FORCED_DARK = new Set(['dark-glass', 'night-ink'])

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function fmtValue(d) {
  if (!d) return '?'
  let v = d.value
  if (typeof v === 'number') v = v.toLocaleString('en-US', { maximumFractionDigits: d.decimals ?? 2, minimumFractionDigits: d.decimals ?? 0 })
  return `${d.prefix || ''}${v}${d.suffix || ''}`
}

function numSpan(id, table, { count = false } = {}) {
  const d = table[id]
  if (!d) return `<span class="num missing" data-num="${esc(id)}">[missing ${esc(id)}]</span>`
  const ill = d.src === 'illustrative'
  const title = ill ? 'illustrative' : d.src || ''
  const c = count && typeof d.value === 'number' ? ` data-count="${d.value}" data-final="${esc(fmtValue(d))}"` : ''
  return `<span class="num${ill ? ' ill' : ''}" data-num="${esc(id)}" title="${esc(title)}"${c}>${esc(fmtValue(d))}</span>`
}

// Words: escape, then `code` spans and {#id} number references.
export function words(s, table) {
  if (s == null) return ''
  return String(s).split(/(`[^`]*`)/g).map((part, i) => i % 2
    ? `<code>${esc(part.slice(1, -1))}</code>`
    : esc(part).replace(/\{#([\w.\-]+)\}/g, (_, id) => numSpan(id, table))).join('')
}

export function srcChip(d) {
  if (!d) return ''
  if (d.src === 'illustrative') return `<span class="src ill" data-ok-digits>illustrative</span>`
  const s = String(d.src || '')
  return `<span class="src" data-ok-digits>${esc(s.replace(/^seed:/, '').replace(/^git\./, 'git '))}</span>`
}

// ---------- brand ----------
export function brandParts(name) {
  const t = read(path.join(CH, 'brands', `${name}.html`))
  const part = (k) => { const m = t.match(new RegExp(`<!-- @brand:${k} -->([\\s\\S]*?)(?=<!-- @brand:)`)); return m ? m[1].trim() : '' }
  const nm = (t.match(/<!-- @brand:name (.+?) -->/) || [])[1] || ''
  return { name: nm, head: part('head'), tokens: part('tokens'), themeJs: part('theme-js'), switcherCss: part('switcher-css'), switcher: part('switcher') }
}

// ---------- figures for pinned-argument (SVG, words only; values from data) ----------
function figure(fig = {}, table) {
  const items = (fig.items || []).slice(0, 6)
  const n = Math.max(items.length, 1)
  const W = 400, H = 300
  const label = (it) => it.num ? `${esc(it.label || '')}` : esc(it.label || '')
  if (fig.kind === 'bars') {
    const nums = items.map(it => Number(table[it.num]?.value) || 0)
    const max = Math.max(...nums, 1)
    const bh = Math.min(34, (H - 20) / n - 14)
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(fig.caption || '')}">${items.map((it, i) => {
      const y = 14 + i * ((H - 20) / n), w = Math.max(4, (W - 140) * nums[i] / max)
      return `<g data-i="${i}"><text x="0" y="${y + bh * 0.7}">${label(it)}</text><rect class="bar-bg" x="130" y="${y}" width="${W - 140}" height="${bh}" rx="4"/><rect class="bar" x="130" y="${y}" width="${w.toFixed(1)}" height="${bh}" rx="4"/><text class="lbl-muted" x="${Math.min(W - 6, 136 + w)}" y="${y + bh * 0.7}" text-anchor="${w > W - 190 ? 'end' : 'start'}" data-ok-digits>${esc(it.num ? fmtValue(table[it.num]) : '')}</text></g>`
    }).join('')}</svg>`
  }
  if (fig.kind === 'stack') {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(fig.caption || '')}">${items.map((it, i) => {
      const y = 30 + i * ((H - 70) / n), x = 20 + i * 14
      return `<g data-i="${i}"><rect class="box${i === n - 1 ? ' acc' : ''}" x="${x}" y="${y}" width="${W - 40 - i * 28}" height="${(H - 70) / n + 26}" rx="10"/><text x="${x + 16}" y="${y + 24}">${label(it)}</text></g>`
    }).join('')}</svg>`
  }
  // flow (default): boxes top to bottom joined by wires
  const bh = Math.min(46, (H - 20) / n - 16)
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(fig.caption || '')}">${items.map((it, i) => {
    const y = 10 + i * ((H - 20) / n)
    const wire = i < n - 1 ? `<path class="wire" d="M ${W / 2} ${y + bh} L ${W / 2} ${10 + (i + 1) * ((H - 20) / n)}"/>` : ''
    return `<g data-i="${i}"><rect class="box${i === n - 1 ? ' acc' : ''}" x="40" y="${y}" width="${W - 80}" height="${bh}" rx="10"/><text x="${W / 2}" y="${y + bh / 2 + 5}" text-anchor="middle">${label(it)}</text>${wire}</g>`
  }).join('')}</svg>`
}

// ---------- archetype templates (v0, and any scene without an accepted fragment) ----------
const head = (sc, table, { h = 'h2' } = {}) =>
  `${sc.kicker ? `<p class="kicker rv">${words(sc.kicker, table)}</p>` : ''}${sc.headline ? `<h2 class="${h} rv">${words(sc.headline, table)}</h2>` : ''}${sc.body ? `<p class="body rv">${words(sc.body, table)}</p>` : ''}`
const hood = (sc, table) => sc.hood ? `<details class="hood"><summary>${esc(sc.hood_label || 'Under the hood')}</summary><div class="hood-in">${words(sc.hood, table)}</div></details>` : ''
const knobStyle = (k = {}) => {
  const st = []
  if (k.pin_svh) st.push(`--pin-h:${Number(k.pin_svh)}svh`)
  if (k.step_gap_svh) st.push(`--step-gap:${Number(k.step_gap_svh)}svh`)
  if (k.range) st.push(`--rv-range:${String(k.range).replace(/[^a-z0-9% ]/gi, '')}`)
  return st.length ? ` style="${st.join(';')}"` : ''
}
const open = (sc, cls, extra = '') =>
  `<section id="${esc(sc.id)}" class="scene ${cls}" data-scene data-archetype="${esc(sc.archetype)}" data-title="${esc(sc.title || sc.headline || sc.id)}"${knobStyle(sc.knobs)}${extra}><span class="ink" aria-hidden="true"></span>`

export const TEMPLATES = {
  'hero-alive': (sc, t, b) => {
    const hero = b.hero || {}
    const beats = (hero.numbers || []).slice(0, 3).map(n => `<div class="beat"><span class="v">${numSpan(n.id, t)}</span><span class="l">${words(n.label, t)} ${srcChip(t[n.id])}</span></div>`)
    const joined = beats.flatMap((x, i) => i ? [`<div class="beat arrow" aria-hidden="true">→</div>`, x] : [x]).join('')
    return `${open({ ...sc, title: sc.title || 'Start' }, 'a-hero')}<div class="alive" aria-hidden="true"><b></b><i></i><i></i><i></i><i></i><i></i></div><div class="wrap">` +
      `<p class="kicker"><span class="hero-teaser" aria-hidden="true"></span>${words(hero.kicker || sc.kicker, t)}</p><h1 class="h1">${words(hero.outcome, t)}</h1>` +
      `${hero.why ? `<p class="why">${words(hero.why, t)}</p>` : ''}${beats.length ? `<div class="beats">${joined}</div>` : ''}<p class="scroll-cue">${esc(hero.cue || 'Scroll')}</p></div></section>`
  },
  'pinned-argument': (sc, t) => `${open(sc, 'a-pinned', ' data-steps')}<div class="wrap">${head(sc, t)}<div class="grid"><div class="fig" aria-hidden="true">${figure(sc.figure, t)}</div>` +
    `<div class="steps">${(sc.steps || []).map(s => `<div class="step rv"><h3 class="h3">${words(s.title, t)}</h3><p class="body">${words(s.body, t)}</p></div>`).join('')}</div></div>${hood(sc, t)}</div></section>`,
  'full-bleed-number': (sc, t) => `${open(sc, 'a-number')}<div class="wrap">${sc.kicker ? `<p class="kicker rv">${words(sc.kicker, t)}</p>` : ''}` +
    `<p class="big">${numSpan(sc.number?.id, t, { count: true })}${sc.number?.unit ? `<small>${words(sc.number.unit, t)}</small>` : ''}</p>` +
    `${sc.headline ? `<h2 class="h2 rv">${words(sc.headline, t)}</h2>` : ''}<div class="then">${(sc.then || []).map(x => `<p class="rv">${words(x, t)}</p>`).join('')}</div>` +
    `${sc.body ? `<p class="body rv">${words(sc.body, t)}</p>` : ''}<p>${srcChip(t[sc.number?.id])}</p>${hood(sc, t)}</div></section>`,
  'split-before-after': (sc, t) => {
    const pane = (p = {}, cls) => `<div class="pane ${cls}"><p class="tag">${words(p.tag || (cls === 'before' ? 'Before' : 'After'), t)}</p><h3 class="h3">${words(p.title, t)}</h3><p class="body">${words(p.body, t)}</p></div>`
    return `${open(sc, 'a-split')}<div class="wrap">${head(sc, t)}<div class="stage"><div class="panes">${pane(sc.before, 'before')}${pane(sc.after, 'after')}</div></div>${hood(sc, t)}</div></section>`
  },
  'scrubbed-timeline': (sc, t) => `${open(sc, 'a-timeline')}<div class="wrap">${head(sc, t)}<ol>${(sc.items || []).map(it =>
    `<li class="rv"><p class="when">${words(it.when, t)}</p><p class="what">${words(it.what, t)}</p>${it.note ? `<p class="note">${words(it.note, t)}</p>` : ''}${it.count ? `<p class="count">${numSpan(it.count, t, { count: true })}</p>` : ''}</li>`).join('')}</ol>${hood(sc, t)}</div></section>`,
  'peer-rail': (sc, t, b) => {
    const cards = sc.cards || (b.links || []).map(l => ({ title: l.label, body: l.note || '', href: l.href, go: 'Open' }))
    return `${open(sc, 'a-rail')}<div class="wrap">${head(sc, t)}<div class="rail" role="list">${cards.map(c => {
      const inner = `<h3 class="h3">${words(c.title, t)}</h3><p class="body">${words(c.body, t)}</p>${c.href ? `<span class="go">${words(c.go || 'Open', t)} →</span>` : ''}`
      return c.href ? `<a class="card" role="listitem" href="${esc(c.href)}">${inner}</a>` : `<div class="card" role="listitem">${inner}</div>`
    }).join('')}</div>${hood(sc, t)}</div></section>`
  },
  'snap-chapter': (sc, t) => `${open(sc, 'a-chapter')}<div class="wrap">${head(sc, t)}${(sc.list || []).length ? `<ul class="body">${sc.list.map(x => `<li>${words(x, t)}</li>`).join('')}</ul>` : ''}${hood(sc, t)}</div></section>`,
  'mechanism-stepper': (sc, t, b) => {
    const steps = (b.mechanism?.steps || []).slice(0, 7)
    const ord = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
    return `${open({ ...sc, title: sc.title || 'How it works' }, 'a-mech', ' data-mech')}<div class="wrap">${head(sc, t)}<div class="grid">` +
      `<div class="machine" role="group" aria-label="${esc(sc.machine_label || 'The mechanism, step by step')}"><div class="lanes">${steps.map((s, i) => `<div class="lane" data-i="${i}"><span class="n" data-ok-digits>${i + 1}</span><span>${words(s.label, t)}</span></div>`).join('')}</div>` +
      `<div class="ctl"><button type="button" data-act="prev" aria-label="Previous step">←</button><button type="button" data-act="next">Next step →</button><span class="state" aria-live="polite" data-ok-digits></span></div></div>` +
      `<div class="notes">${steps.map((s, i) => `<div class="note rv"><p class="kicker">${ord[i]}</p><h3 class="h3">${words(s.label, t)}</h3><p class="body">${words(s.detail, t)}</p>${s.src ? `<span class="src" data-ok-digits>${esc(s.src)}</span>` : ''}</div>`).join('')}</div></div>${hood(sc, t)}</div></section>`
  },
  limits: (sc, t, b) => `${open({ ...sc, title: sc.title || 'The edges' }, 'a-limits')}<div class="wrap">${head(sc, t)}<ul>${(b.limits || []).map(x => `<li>${words(typeof x === 'string' ? x : x.text, t)}${x.src ? ` <span class="src" data-ok-digits>${esc(x.src)}</span>` : ''}</li>`).join('')}</ul>${hood(sc, t)}</div></section>`,
  close: (sc, t, b) => `${open({ ...sc, title: sc.title || 'Next' }, 'a-close')}<div class="wrap">${head(sc, t)}<div class="links">${(b.links || []).map(l => `<a href="${esc(l.href)}">${words(l.label, t)}</a>`).join('')}</div></div></section>`,
}

// ---------- fragments ----------
function matchBlock(css, start) {
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return i + 1
  }
  return css.length
}

// Scope a fragment's CSS: hoist @keyframes/@property, rename keyframes and timeline names to sN-*, and nest
// everything else under #sN so bare selectors can't leak.
export function scopeCss(css, sid) {
  let rest = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const hoisted = []
  const kf = new Map()
  for (;;) {
    const m = rest.match(/@(?:-webkit-)?(keyframes|property)\s+([\w-]+)/)
    if (!m) break
    const s = m.index, e = matchBlock(rest, s)
    let block = rest.slice(s, e)
    if (m[1] === 'keyframes') { const nn = m[2].startsWith(`${sid}-`) ? m[2] : `${sid}-${m[2]}`; kf.set(m[2], nn); block = block.replace(m[2], nn) }
    hoisted.push(block)
    rest = rest.slice(0, s) + rest.slice(e)
  }
  const timelines = new Set()
  rest.replace(/(?:view|scroll)-timeline(?:-name)?\s*:\s*(--[\w-]+)/g, (_, n) => { timelines.add(n); return '' })
  const renameTimelines = (s) => [...timelines].reduce((acc, n) => acc.replace(new RegExp(`${n}(?![\\w-])`, 'g'), n.startsWith(`--${sid}-`) ? n : `--${sid}-${n.slice(2)}`), s)
  const renameKf = (s) => s.replace(/(animation(?:-name)?\s*:)([^;}]*)/g, (all, p, v) => p + [...kf].reduce((acc, [a, b]) => acc.replace(new RegExp(`(^|[\\s,])${a}(?=[\\s,;]|$)`, 'g'), `$1${b}`), v))
  rest = renameTimelines(renameKf(rest)).trim()
  return { css: `${hoisted.map(h => renameTimelines(h)).join('\n')}\n#${sid}{\n${rest}\n}`, keyframes: [...kf.values()], timelines: [...timelines] }
}

export function parseFragment(html) {
  const style = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || ''
  const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i) || [])[1] || ''
  const section = (html.match(/<section\b[\s\S]*<\/section>/i) || [])[0] || ''
  return { style, script, section, raw: html }
}

// Node-side checks a fragment must pass before it can be assembled. Chrome lint (pagelint.js) does the rest.
export function lintFragmentNode(html, sid, archetype) {
  const f = parseFragment(html)
  const errs = []
  if (!f.section) errs.push('no <section> element')
  const open = f.section.match(/^<section\b[^>]*>/i)?.[0] || ''
  if (!new RegExp(`\\bid="${sid}"`).test(open)) errs.push(`section id must be "${sid}"`)
  if (!/\bdata-scene\b/.test(open)) errs.push('section needs data-scene')
  if (archetype && !new RegExp(`data-archetype="${archetype}"`).test(open)) errs.push(`section data-archetype must be "${archetype}"`)
  for (const m of f.section.matchAll(/\bid="([^"]+)"/g)) if (m[1] !== sid && !m[1].startsWith(`${sid}-`)) errs.push(`id "${m[1]}" must start with ${sid}-`)
  for (const m of (f.style + f.section).matchAll(/view-transition-name\s*:\s*([\w-]+)/g)) if (m[1] !== 'none' && !m[1].startsWith(`${sid}-`)) errs.push(`view-transition-name "${m[1]}" must start with ${sid}-`)
  if (/\b(?:src|href)\s*=\s*["']https?:/i.test(f.section) || /url\(\s*["']?https?:/i.test(f.style) || /\b(fetch|import)\s*\(\s*["'`]https?:/.test(f.script)) errs.push('external URL')
  if (/<script[^>]*\bsrc=/i.test(html)) errs.push('external script')
  if (/addEventListener\(\s*['"](scroll|resize)['"]/.test(f.script)) errs.push('window scroll/resize listener (use api.onProgress)')
  if (f.script && !new RegExp(`LOD\\.scene\\(\\s*['"]${sid}['"]`).test(f.script)) errs.push(`script must call LOD.scene('${sid}', …)`)
  if ((html.match(/<style/gi) || []).length > 1) errs.push('more than one <style>')
  if ((html.match(/<script/gi) || []).length > 1) errs.push('more than one <script>')
  return errs
}

// Fill data-slot="path" (text from the scene) and data-num="id" (values from data).
export function fillSlots(section, sc, table) {
  const get = (p) => p.split('.').reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) ? Number(k) : k]), sc)
  let s = section.replace(/(<(\w+)\b[^>]*\bdata-slot="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (all, open, tag, p, inner, close) => {
    const v = get(p)
    return v == null ? all : `${open}${words(v, table)}${close}`
  })
  s = s.replace(/(<(\w+)\b[^>]*\bdata-num="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (all, open, tag, id, inner, close) =>
    table[id] ? `${open.replace(/>$/, ` title="${esc(table[id].src === 'illustrative' ? 'illustrative' : table[id].src || '')}">`)}${esc(fmtValue(table[id]))}${close}` : all)
  return s
}

// ---------- the page ----------
export function sceneList(brief) {
  const scenes = (brief.scenes || []).slice()
  if (!scenes.some(s => s.archetype === 'hero-alive')) scenes.unshift({ id: 's0', archetype: 'hero-alive' })
  return scenes
}

export function assemble({ brief, seed = {}, frags = {}, brand = 'tc', outFile = 'page.html', register, signature, type, run = {} }) {
  const { table, errors } = resolveData(brief, seed)
  const dir = brief.direction || {}
  const opt = (dir.options || []).find(o => o.id === (dir.chosen || (dir.options || [])[0]?.id)) || {}
  const reg = register || opt.register || 'plain-light'
  const sig = signature || opt.signature || brief.signature?.preset || 'ruled-line'
  const typ = type || opt.type || ''
  const B = brandParts(brand)
  const used = {}
  const fragCss = [], fragJs = []
  const sections = sceneList(brief).map(sc => {
    const f = frags[sc.id]
    if (f) {
      const p = parseFragment(f.html)
      const scoped = scopeCss(p.style, sc.id)
      fragCss.push(`/* ${sc.id}.${f.writer} */\n${scoped.css}`)
      if (p.script.trim()) fragJs.push(`<script>/* ${sc.id}.${f.writer} */\n${p.script}\n</script>`)
      used[sc.id] = f.writer
      return fillSlots(p.section, sc, table)
    }
    const tpl = TEMPLATES[sc.archetype]
    used[sc.id] = 'template'
    return tpl ? tpl(sc, table, brief) : `<!-- unknown archetype ${esc(sc.archetype)} for ${esc(sc.id)} -->`
  })
  const heroLabel = brief.nav_label || 'The story'
  const masthead = B.switcher
    .replace(/\{\{SELF_FILE\}\}/g, esc(outFile)).replace(/\{\{SELF_LABEL\}\}/g, esc(heroLabel)).replace(/\{\{SELF_SUB\}\}/g, esc(brief.nav_sub || 'the journey'))
    .replace(/\{\{BRAND_NAME\}\}/g, esc(B.name)).replace(/\{\{LINKS\}\}/g, (brief.links || []).map(l => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(''))
  const srcRows = Object.values(table).filter(d => d.id && !d.hidden).map(d =>
    `<li><span data-ok-digits>${esc(d.label || d.id)}: ${esc(fmtValue(d))}</span> ${d.formula ? `<span class="src" data-ok-digits>${esc(d.formula)}</span>` : srcChip(d)}</li>`).join('')
  const asOf = seed['git.head'] ? `Repository facts read at commit <code>${esc(seed['git.head'].value)}</code>.` : ''
  const dataJson = JSON.stringify(Object.fromEntries(Object.entries(table).map(([k, d]) => [k, { value: d.value, src: d.src || null }]))).replace(/</g, '\\u003c')
  const html = `<!doctype html>
<html lang="en" data-register="${esc(reg)}" data-sig="${esc(sig)}"${typ ? ` data-type="${esc(typ)}"` : ''}${FORCED_DARK.has(reg) ? ' data-force-dark="1"' : ''}${run.mobile_first ? ' data-mobile-first="1"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(brief.title || 'Untitled')}${B.name && brand !== 'journey' ? ` · ${esc(B.name)}` : ''}</title>
<meta name="description" content="${esc(brief.spine || '')}">
<meta name="generator" content="lipstick-on-a-deadline ${esc(run.run_id || '')}">
${B.head}
${B.tokens}
${B.themeJs}
<script>if(document.documentElement.getAttribute('data-force-dark')==='1')document.documentElement.setAttribute('data-theme','dark')</script>
<style>
${read(path.join(CH, 'chassis.css'))}
${read(path.join(CH, 'registers.css'))}
</style>
${B.switcherCss}
<style id="lod-frags">
${fragCss.join('\n')}
</style>
</head>
<body id="top">
<a class="skip" href="#${esc(sceneList(brief)[0].id)}">Skip to the story</a>
<div id="lod-progress" aria-hidden="true"></div>
${masthead}
<div id="sig" aria-hidden="true"><span class="rule"></span><span class="tok"></span><span class="tok"></span><span class="tok"></span></div>
<nav id="lod-nav" aria-label="Chapters"></nav>
<main>
${sections.join('\n')}
</main>
<footer class="foot"><div class="wrap">
<p><b>Where the numbers come from.</b> Each figure on this page is read from the source or derived from figures that are. ${asOf}</p>
<ul class="body" style="columns:2 280px;padding-left:18px;margin:8px 0">${srcRows}</ul>
${Object.values(table).some(d => d.src === 'illustrative') ? '<p>Figures marked illustrative are examples, not measurements.</p>' : ''}
</div></footer>
<div id="lod-err" role="alert"></div>
<script type="application/json" id="lod-data">${dataJson}</script>
<script>
${read(path.join(CH, 'chassis.js'))}
</script>
${fragJs.join('\n')}
</body>
</html>
`
  return { html, used, dataErrors: errors, table, register: reg, signature: sig }
}
