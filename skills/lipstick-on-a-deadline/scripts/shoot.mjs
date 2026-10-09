#!/usr/bin/env node
// Render a page with headless Chrome over CDP (Node 24's global WebSocket; no dependencies) and audit it.
//   shoot.mjs <page.html> --out <dir> [--passes phone,scroll,reduced,nojs,desktop,themes,tiles] [--frames 32]
//             [--throttle 4] [--min-archetypes 4] [--label v1] [--dirs A=a.html,B=b.html,C=c.html] [--timeout 60]
// Writes PNGs and audit.json into --out and prints a one-line summary. Exit 0 unless Chrome itself fails.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary']
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const PAGELINT = fs.readFileSync(path.join(HERE, 'pagelint.js'), 'utf8')

export function findChrome() { return process.env.LOD_CHROME || CHROMES.find(p => fs.existsSync(p)) || null }

class CDP {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.waiters = []
    this.ws = new WebSocket(url)
    this.ready = new Promise((res, rej) => { this.ws.addEventListener('open', res); this.ws.addEventListener('error', rej) })
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString())
      if (m.id && this.pending.has(m.id)) {
        const { res, rej, method } = this.pending.get(m.id); this.pending.delete(m.id)
        m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)
      } else if (m.method) {
        this.waiters = this.waiters.filter(w => { if (w.method === m.method && (!w.sessionId || w.sessionId === m.sessionId)) { w.res(m.params); return false } return true })
      }
    })
  }
  send(method, params = {}, sessionId, ms = 20000) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((res, rej) => {
      const t = setTimeout(() => { if (this.pending.delete(id)) rej(new Error(`${method}: no reply in ${ms / 1000}s`)) }, ms)
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v) }, rej: (e) => { clearTimeout(t); rej(e) }, method })
    })
  }
  failAll(err) { for (const [, p] of this.pending) p.rej(err); this.pending.clear() }
  wait(method, sessionId, ms = 8000) {
    return Promise.race([new Promise(res => this.waiters.push({ method, sessionId, res })), sleep(ms).then(() => null)])
  }
}

async function launch() {
  const chrome = findChrome()
  if (!chrome) throw new Error('Chrome not found (set LOD_CHROME)')
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-chrome-'))
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${ud}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' })
  let caf = null
  try { caf = spawn('caffeinate', ['-dimsu', '-w', String(proc.pid)], { stdio: 'ignore' }) } catch {}
  const f = path.join(ud, 'DevToolsActivePort')
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(f)) {
      const [port, p] = fs.readFileSync(f, 'utf8').trim().split('\n')
      if (port && p) {
        const cdp = new CDP(`ws://127.0.0.1:${port}${p}`)
        await cdp.ready
        return { cdp, proc, caf, ud }
      }
    }
    await sleep(50)
  }
  proc.kill('SIGKILL')
  throw new Error('Chrome did not start (no DevToolsActivePort in 5 s)')
}

async function newPage(cdp, { w, h, mobile = false, dpr = 1, reduced = false, scheme = 'light', noJs = false }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const s = (m, p) => cdp.send(m, p, sessionId)
  await s('Page.enable'); await s('Runtime.enable')
  await s('Page.bringToFront').catch(() => {})
  await s('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile, screenWidth: w, screenHeight: h })
  if (mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }, { name: 'prefers-color-scheme', value: scheme }] })
  if (noJs) await s('Emulation.setScriptExecutionDisabled', { value: true })
  const page = {
    s, sessionId, w, h, dpr,
    async goto(url) { const loaded = cdp.wait('Page.loadEventFired', sessionId); await s('Page.navigate', { url }); await loaded },
    async eval(expr) {
      if (process.env.LOD_DEBUG) console.error(`[${w}] eval ${expr.replace(/\s+/g, ' ').slice(0, 70)}`)
      const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      return r.result.value
    },
    async shot(file, { jpeg = false, scale = 1 } = {}) {
      const p = { format: jpeg ? 'jpeg' : 'png', ...(jpeg ? { quality: 58 } : {}) }
      if (scale !== 1) p.clip = { x: 0, y: 0, width: w, height: h, scale }
      const { data } = await s('Page.captureScreenshot', p)
      const buf = Buffer.from(data, 'base64')
      if (file) fs.writeFileSync(file, buf)
      return buf
    },
    async frames(n = 2) { await page.eval(`new Promise(r => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : r(1)); requestAnimationFrame(f); setTimeout(() => r(0), 120 * ${n}) })`) },
    close: () => cdp.send('Target.closeTarget', { targetId }),
  }
  return page
}

// What moved between two scroll positions: computed style of motion-bearing elements in view.
const SAMPLE = `(() => {
  const els = document.querySelectorAll('[data-motion], .rv, .a-number .big, .a-split .after, .a-timeline ol, .lane, .fig [data-i], #sig .tok, #lod-progress, .a-chapter .wrap, .scene > .ink, [data-scene] [class*="-"]');
  const out = {}; let pinned = false; const H = innerHeight;
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H || r.width === 0) return;
    const cs = getComputedStyle(el);
    out[i] = [cs.opacity, cs.transform, cs.clipPath, cs.maskSize || cs.webkitMaskSize, cs.offsetDistance, cs.backgroundColor].join('|');
  });
  document.querySelectorAll('main *').forEach(el => {
    if (pinned) return;
    const cs = getComputedStyle(el);
    if (cs.position !== 'sticky') return;
    const r = el.getBoundingClientRect(), top = parseFloat(cs.top) || 0;
    if (Math.abs(r.top - top) < 2 && r.bottom > 0 && r.top < H) pinned = true;
  });
  return { out, pinned };
})()`

function aliveBetween(a, b) {
  if (!a || !b) return false
  if (b.pinned) return true
  for (const k of Object.keys(b.out)) if (k in a.out && a.out[k] !== b.out[k]) return true
  return false
}

async function sheet(cdp, images, file, { cols = 8, cellW = 195, cellH = 422, title = '' } = {}) {
  const rows = Math.ceil(images.length / cols)
  const W = cols * (cellW + 8) + 8, H = rows * (cellH + 26) + 40
  const html = `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#222;color:#ddd;font:12px system-ui}h1{font:600 14px system-ui;margin:10px}
    .g{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:8px;padding:0 8px 8px}figure{margin:0}img{width:${cellW}px;height:${cellH}px;object-fit:cover;object-position:top;display:block;background:#fff}
    figcaption{padding:3px 0;color:#bbb}</style><h1>${title}</h1><div class=g>${images.map(im => `<figure><img src="data:image/${im.jpeg ? 'jpeg' : 'png'};base64,${im.buf.toString('base64')}"><figcaption>${im.label}</figcaption></figure>`).join('')}</div>`
  const tmp = path.join(os.tmpdir(), `lod-sheet-${process.pid}-${Date.now()}.html`)
  fs.writeFileSync(tmp, html)
  const p = await newPage(cdp, { w: W, h: H })
  await p.goto(pathToFileURL(tmp).href)
  await sleep(150)
  await p.shot(file)
  await p.close()
  fs.unlinkSync(tmp)
  return file
}

export async function shoot(pageFile, o = {}) {
  const outDir = o.out || path.join(path.dirname(pageFile), 'png')
  fs.mkdirSync(outDir, { recursive: true })
  const passes = new Set((o.passes || 'phone,scroll,reduced,nojs,desktop,themes').split(','))
  const url = pathToFileURL(path.resolve(pageFile)).href
  const label = o.label || path.basename(pageFile, '.html')
  const audit = { page: pageFile, label, at: new Date().toISOString(), passes: [...passes], findings: [], files: {} }
  const add = (pass, f) => audit.findings.push({ pass, ...f })
  const t0 = Date.now()
  const { cdp, proc, caf, ud } = await launch()
  const hard = setTimeout(() => { cdp.failAll(new Error(`shoot: over the ${o.timeout || 60}s limit`)); try { proc.kill('SIGKILL') } catch {} }, (o.timeout || 60) * 1000)
  try {
    if (o.dirs) {
      // direction sheet: first screen at 390 and 1440 for each assembled direction
      const ims = []
      for (const [id, f] of o.dirs) {
        for (const [w, h, mobile, dpr] of [[390, 844, true, 2], [1440, 900, false, 1]]) {
          const p = await newPage(cdp, { w, h, mobile, dpr })
          await p.goto(pathToFileURL(path.resolve(f)).href)
          await sleep(1200)
          ims.push({ buf: await p.shot(null, { jpeg: true, scale: mobile ? 0.5 : 0.3 }), jpeg: true, label: `${id} · ${w}px` })
          await p.close()
        }
      }
      audit.files.directions = await sheet(cdp, ims, path.join(outDir, 'directions.png'), { cols: 6, cellW: 230, cellH: 300, title: 'Directions: first screen at 390 and 1440' })
      return audit
    }

    if (passes.has('phone') || passes.has('scroll')) {
      const p = await newPage(cdp, { w: 390, h: 844, mobile: true, dpr: 2 })
      const nav = Date.now()
      const loaded = p.goto(url)
      await sleep(300)
      const a = await p.shot(path.join(outDir, 'phone-first-0.3.png'))
      const early = await p.eval(`(() => { const h = document.querySelector('.a-hero h1, section[data-archetype="hero-alive"] h1'); if (!h) return null; let o = 1; for (let e = h; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o })()`).catch(() => null)
      await loaded
      await sleep(Math.max(0, 1200 - (Date.now() - nav)))
      const b = await p.shot(path.join(outDir, 'phone-first-1.2.png'))
      audit.files.phoneFirst = [path.join(outDir, 'phone-first-0.3.png'), path.join(outDir, 'phone-first-1.2.png')]
      for (let i = 0; i < 26; i++) { if (await p.eval('!!(window.__lod && window.__lod.ready)').catch(() => false)) break; await sleep(100) }
      const lint = await p.eval(`(${PAGELINT})(${JSON.stringify({ firstScreen: true, minArchetypes: o.minArchetypes || 4 })})`)
      audit.phone = { w: lint.w, dpr: lint.dpr, hoverNone: lint.hoverNone, scrollWidth: lint.scrollWidth, minBodyFont: lint.minBodyFont, minTap: lint.minTap,
        hero: lint.hero, heroEarlyOpacity: early, heroAlive: !a.equals(b), archetypes: lint.archetypes, distinctArchetypes: lint.distinctArchetypes, errors: lint.errors }
      if (lint.w !== 390 || !lint.hoverNone) add('phone', { rule: 'emulation', detail: `innerWidth ${lint.w}, hover:none ${lint.hoverNone}` })
      if (early != null && early < 0.99) add('phone', { rule: 'hero-hidden', detail: `hero headline opacity ${early} at 0.3 s` })
      if (a.equals(b)) add('phone', { rule: 'hero-still', detail: 'first screen identical at 0.3 s and 1.2 s (no alive layer moving)' })
      for (const f of lint.findings) add('phone', f)
      for (const e of lint.errors) add('phone', { rule: 'js-error', detail: e })

      if (passes.has('scroll')) {
        const frames = o.frames || 32
        await p.eval(`window.__loaf = 0; try { new PerformanceObserver(l => { window.__loaf += l.getEntries().length }).observe({ type: 'long-animation-frame', buffered: false }) } catch (e) { window.__loaf = -1 }`)
        if (o.throttle !== 0) await p.s('Emulation.setCPUThrottlingRate', { rate: o.throttle || 4 })
        const max = await p.eval('document.documentElement.scrollHeight - innerHeight')
        const ims = []
        let prev = null, alive = 0
        for (let i = 0; i < frames; i++) {
          const y = Math.round(max * i / (frames - 1))
          await p.eval(`scrollTo(0, ${y})`)
          await p.frames(2)
          const smp = await p.eval(SAMPLE)
          if (i > 0 && aliveBetween(prev, smp)) alive++
          prev = smp
          ims.push({ buf: await p.shot(null, { jpeg: true, scale: 0.5 }), jpeg: true, label: `${Math.round(100 * i / (frames - 1))}%` })
        }
        await p.s('Emulation.setCPUThrottlingRate', { rate: 1 })
        audit.phone.aliveRatio = Math.round(alive / (frames - 1) * 100) / 100
        audit.phone.loaf = await p.eval('window.__loaf')
        audit.phone.pageScreens = Math.round((max + 844) / 844 * 10) / 10
        if (audit.phone.aliveRatio < (o.aliveTarget || 0.6)) add('scroll', { rule: 'alive', detail: `alive ratio ${audit.phone.aliveRatio} (target ${o.aliveTarget || 0.6})`, warn: true })
        audit.files.phoneScroll = await sheet(cdp, ims, path.join(outDir, 'phone-scroll.png'), { title: `${label} · 390px scroll-through, ${frames} frames, CPU ×${o.throttle || 4}` })
      }
      await p.close()
    }

    if (passes.has('tiles')) {
      const p = await newPage(cdp, { w: 390, h: 1200, mobile: true, dpr: 1 })
      await p.goto(url)
      await p.eval(`document.documentElement.classList.add('qa')`)
      await sleep(400)
      const max = await p.eval('document.documentElement.scrollHeight - innerHeight')
      const ims = []
      for (let i = 0; i < 4; i++) { await p.eval(`scrollTo(0, ${Math.round(max * i / 3)})`); await p.frames(2); ims.push({ buf: await p.shot(null), label: `tile ${i + 1}` }) }
      audit.files.tiles = await sheet(cdp, ims, path.join(outDir, 'phone-tiles.png'), { cols: 4, cellW: 390, cellH: 1200, title: `${label} · 390px tiles (end states)` })
      await p.close()
    }

    if (passes.has('reduced')) {
      const p = await newPage(cdp, { w: 390, h: 844, mobile: true, dpr: 1, reduced: true })
      await p.goto(url)
      await sleep(400)
      const lint = await p.eval(`(${PAGELINT})({})`)
      const hidden = lint.headings.filter(h => !h.vis || h.o < 0.99)
      audit.reduced = { headings: lint.headings.length, hidden: hidden.length }
      if (hidden.length) add('reduced', { rule: 'reduced-hidden', detail: hidden.map(h => h.t).join(' | ') })
      await p.close()
    }

    if (passes.has('nojs')) {
      const p = await newPage(cdp, { w: 390, h: 844, mobile: true, dpr: 1, noJs: true })
      await p.goto(url)
      await sleep(500)
      const heads = await p.eval(`[...document.querySelectorAll('main h1, main h2')].map(h => { const r = h.getBoundingClientRect(); let o = 1; for (let e = h; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return { t: h.textContent.trim().slice(0, 40), o, vis: r.width > 0 } })`)
      const js = await p.eval(`document.documentElement.classList.contains('js')`)
      const hidden = heads.filter(h => !h.vis || h.o < 0.99)
      // motion without JS: compare motion samples at several scroll positions, scene by scene
      const max = await p.eval('document.documentElement.scrollHeight - innerHeight')
      const moved = new Set()
      let prev = null
      for (let i = 0; i <= 24; i++) {
        await p.eval(`scrollTo(0, ${Math.round(max * i / 24)})`)
        await p.frames(2)
        const smp = await p.eval(`(() => { const o = {}; document.querySelectorAll('main section[id]').forEach(s => { s.querySelectorAll('.rv, [data-motion], .big, .after, ol, .wrap').forEach((el, j) => { const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return; const cs = getComputedStyle(el); o[s.id + ':' + j] = [cs.opacity, cs.transform, cs.clipPath, cs.maskSize || cs.webkitMaskSize].join('|') }) }); return o })()`)
        if (prev) for (const k of Object.keys(smp)) if (k in prev && prev[k] !== smp[k]) moved.add(k.split(':')[0])
        prev = smp
      }
      audit.nojs = { jsRan: js, headings: heads.length, hidden: hidden.length, scenesWithMotion: [...moved] }
      if (js) add('nojs', { rule: 'nojs-emulation', detail: 'scripts still ran; the no-JS pass is unverified' })
      if (hidden.length) add('nojs', { rule: 'nojs-hidden', detail: hidden.map(h => h.t).join(' | ') })
      if (moved.size < 2) add('nojs', { rule: 'nojs-still', detail: `scroll motion in ${moved.size} scene(s) without JS (want 2)` })
      await p.close()
    }

    if (passes.has('desktop')) {
      const p = await newPage(cdp, { w: 1440, h: 900, dpr: 1 })
      await p.goto(url)
      await sleep(1200)
      await p.shot(path.join(outDir, 'desktop-first.png'))
      audit.files.desktopFirst = path.join(outDir, 'desktop-first.png')
      const lint = await p.eval(`(${PAGELINT})({ minArchetypes: ${o.minArchetypes || 4} })`)
      const nav = await p.eval(`document.querySelectorAll('#lod-nav a').length`)
      audit.desktop = { scrollWidth: lint.scrollWidth, navLinks: nav, errors: lint.errors }
      for (const f of lint.findings.filter(f => ['overflow', 'dup-id', 'hero-hidden'].includes(f.rule))) add('desktop', f)
      for (const e of lint.errors) add('desktop', { rule: 'js-error', detail: e })
      if (!nav) add('desktop', { rule: 'nav', detail: 'no side nav links' })
      if (passes.has('scroll')) {
        const max = await p.eval('document.documentElement.scrollHeight - innerHeight')
        const ims = []
        for (let i = 0; i < 12; i++) { await p.eval(`scrollTo(0, ${Math.round(max * i / 11)})`); await p.frames(2); ims.push({ buf: await p.shot(null, { jpeg: true, scale: 0.25 }), jpeg: true, label: `${Math.round(100 * i / 11)}%` }) }
        audit.files.desktopScroll = await sheet(cdp, ims, path.join(outDir, 'desktop-scroll.png'), { cols: 4, cellW: 360, cellH: 225, title: `${label} · 1440px scroll-through` })
      }
      await p.close()
    }

    if (passes.has('themes')) {
      const hasToggle = fs.readFileSync(pageFile, 'utf8').includes('data-theme-set=')
      if (hasToggle) {
        const ims = []
        for (const scheme of ['light', 'dark']) {
          const p = await newPage(cdp, { w: 390, h: 844, mobile: true, dpr: 1, scheme })
          await p.goto(url)
          await sleep(900)
          ims.push({ buf: await p.shot(path.join(outDir, `phone-first-${scheme}.png`)), label: scheme })
          await p.close()
        }
        audit.files.themes = await sheet(cdp, ims, path.join(outDir, 'phone-themes.png'), { cols: 2, cellW: 390, cellH: 844, title: `${label} · first screen, light and dark` })
      }
    }
  } finally {
    clearTimeout(hard)
    try { cdp.ws.close() } catch {}
    try { proc.kill('SIGTERM') } catch {}
    try { caf?.kill() } catch {}
    setTimeout(() => { try { fs.rmSync(ud, { recursive: true, force: true }) } catch {} }, 300)
  }
  audit.ms = Date.now() - t0
  audit.blocking = audit.findings.filter(f => !f.warn && BLOCKING.has(f.rule)).length
  fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(audit, null, 2))
  return audit
}

// Rules that stop a version being promoted; the rest are reported for the fix pass.
export const BLOCKING = new Set(['overflow', 'hero-hidden', 'hero-missing', 'first-screen', 'js-error', 'dup-id', 'digits', 'reduced-hidden', 'nojs-hidden', 'emulation'])

export function summary(a) {
  const ph = a.phone || {}
  const bits = [`${a.label}: ${a.blocking} blocking / ${a.findings.length} findings`]
  if (ph.w) bits.push(`390 ok=${ph.w === 390 && ph.hoverNone} font ${ph.minBodyFont} tap ${ph.minTap} alive ${ph.aliveRatio ?? '-'} loaf ${ph.loaf ?? '-'} layouts ${ph.distinctArchetypes}`)
  if (a.nojs) bits.push(`no-JS motion in ${a.nojs.scenesWithMotion.length} scenes`)
  bits.push(`${(a.ms / 1000).toFixed(1)}s`)
  return bits.join(' · ')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2)
  const o = {}
  let page = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i]
    if (a === '--out') o.out = v()
    else if (a === '--passes') o.passes = v()
    else if (a === '--frames') o.frames = Number(v())
    else if (a === '--throttle') o.throttle = Number(v())
    else if (a === '--label') o.label = v()
    else if (a === '--min-archetypes') o.minArchetypes = Number(v())
    else if (a === '--timeout') o.timeout = Number(v())
    else if (a === '--dirs') o.dirs = v().split(',').map(x => x.split('='))
    else page = a
  }
  if (!page) { console.error('usage: shoot.mjs <page.html> --out <dir> [--passes …]'); process.exit(2) }
  shoot(page, o).then(a => { console.log(summary(a)); for (const f of a.findings) console.log(`  [${f.pass}] ${f.warn ? 'warn ' : ''}${f.rule}: ${f.detail}`) })
    .catch(e => { console.error(`shoot: ${e.message}`); process.exit(1) })
}
