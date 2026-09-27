export const meta = {
  name: 'ux-tournament',
  description: 'Anchor-and-climb UI/UX tournament on one screen: Fable anchors, sonnet climbs, opus pushes, Fable crowns; blind scoring, no-regression gate',
  phases: [
    { title: 'Scout', detail: 'sonnet concept sketches, narrative only' },
    { title: 'Anchor', detail: 'Fable generators + judge set the frame', model: 'fable' },
    { title: 'Climb', detail: 'sonnet challengers, opus judge, until a repeat champion' },
    { title: 'Subtract', detail: 'one round where only a design with fewer regions can win' },
    { title: 'Push', detail: 'opus challengers, Fable judge; only on signal' },
    { title: 'Summit', detail: 'Fable challengers; 3x mode only', model: 'fable' },
    { title: 'Crown', detail: 'final champion re-scored blind against the anchor', model: 'fable' },
    { title: 'Plan', detail: 'opus build plan' },
  ],
}

// ---------- args (all paths absolute; the oracle resolves them in SKILL.md STEP 4) ----------
const A = args || {}
const need = (k) => { if (A[k] === undefined || A[k] === null) throw new Error('args.' + k + ' is required'); return A[k] }
const DIR = need('dir')          // <repo>/.claude/ux-tournament/<slug>
const BRIEF = need('brief')      // brief.md
const RUBRIC = need('rubric')    // rubric.md (this skill's copy, v2)
const RENDER = need('render')    // scripts/render.sh
const DATE = need('date')        // YYYY-MM-DD; Date is unavailable inside workflow scripts
const SCREEN = need('screen')    // human name of the screen under design
const CAPS = Object.assign({
  scouts: 3, anchorGens: 2, anchorJudge: 'fable',
  climbRounds: 3, climbGens: 3,
  subtractRounds: 1, subtractGens: 3,
  pushRounds: 2, pushGens: 3,
  summitGens: 0, crown: 'fable',
  margin: 8, nearMiss: 5,        // margin 8 = the measured incumbency bias (rubric v3, Mechanism notes)
  growthTax: 3, cutDiscount: 2, marginFloor: 3, taxDeadband: 1,   // rubric v3 growth tax on the margin
  genTools: 25, judgeTools: 30,  // per-agent tool-use discipline; v1 overran 242% on ~68 uses each
}, A.caps || {})
const LENSES = A.lenses || [
  'comprehension-first', 'speed-first', 'trust-and-provenance', 'novice-first-sixty-seconds', 'expert-density',
  'error-prevention', 'state-coverage', 'decision-support', 'accessibility-first', 'narrow-viewport',
  'hierarchy-and-restraint',
]
const USED = (A.usedApproaches || []).slice()   // NO-REPEAT list from the ledger
let champion = A.incumbent || null              // { id, approach, mockup, screenshot, narrative, total, ux, craft, regions, gapNotes }
const REANCHOR = !!A.reanchor
const FORCE = !!A.forceClimb
let round = A.roundOffset || 0
const calls = { haiku: 0, sonnet: 0, opus: 0, fable: 0 }
const history = []

// ---------- schemas ----------
const SKETCH = { type: 'object', properties: { approach: { type: 'string' }, thesis: { type: 'string' }, narrative: { type: 'string' } }, required: ['approach', 'thesis', 'narrative'] }
const CANDIDATE = { type: 'object', properties: {
  id: { type: 'string' }, approach: { type: 'string' }, thesis: { type: 'string' },
  mockup: { type: 'string' }, screenshot: { type: 'string' }, narrative: { type: 'string' },
  rendered: { type: 'boolean' }, regions: { type: 'number' }, notes: { type: 'string' },
}, required: ['id', 'approach', 'thesis', 'mockup', 'narrative', 'rendered'] }
const SCORE = { type: 'object', properties: {
  label: { type: 'string' }, total: { type: 'number' },
  ux: { type: 'number' }, craft: { type: 'number' },
  axes: { type: 'object' }, regions: { type: 'number' },
  caps: { type: 'array', items: { type: 'string' } }, unbacked: { type: 'number' },
  duplicate_of: { type: 'string' }, gap_notes: { type: 'string' }, rationale: { type: 'string' },
}, required: ['label', 'total', 'ux', 'craft', 'axes', 'regions', 'gap_notes', 'rationale'] }
const MERGE = { type: 'object', properties: {
  label: { type: 'string' }, approach: { type: 'string' }, mockup: { type: 'string' },
  screenshot: { type: 'string' }, narrative: { type: 'string' }, takes_from: { type: 'string' },
}, required: ['label', 'approach', 'mockup', 'narrative'] }
const JUDGMENT = { type: 'object', properties: {
  scores: { type: 'array', items: SCORE }, merge: MERGE, notes: { type: 'string' },
}, required: ['scores'] }
const STAGED = { type: 'object', properties: { ok: { type: 'boolean' }, note: { type: 'string' } }, required: ['ok'] }
const PLAN = { type: 'object', properties: { path: { type: 'string' }, summary: { type: 'string' }, acceptance: { type: 'array', items: { type: 'string' } } }, required: ['path', 'summary'] }

// ---------- prompts ----------
const lensFor = (r, k) => LENSES[(r * 3 + k) % LENSES.length]
const dirFor = (id) => DIR + '/rounds/' + id
const blindDirFor = (r) => DIR + '/rounds/blind-r' + r
const incumbentBlock = () => champion
  ? `Incumbent champion: ${champion.id} ("${champion.approach}"), scored ${champion.total}/100 (UX ${champion.ux === undefined ? '?' : champion.ux}/80, Craft ${champion.craft === undefined ? '?' : champion.craft}/15${champion.regions === undefined ? '' : `, ${champion.regions} rendered regions`}).
  mockup: ${champion.mockup}
  screenshot: ${champion.screenshot || '(none)'}
  narrative: ${champion.narrative}
Gap notes from its judge (what a 95 would have needed):
${champion.gapNotes || '(none recorded)'}`
  : 'There is no incumbent yet. You are setting the frame.'

const BLIND_RULE = `Judging is blind: never write your candidate id, the round number, the tier or your lens into mockup.html or narrative.md. Never add a self-check appendix and never assert your own fold position, density or region count — judges are instructed to score those at zero.`

function scoutPrompt(k) {
  return `You are scout ${k + 1} for a UI/UX tournament on the screen "${SCREEN}".
Read ${BRIEF} and the Stance, Narrative template and Lens catalog sections of ${RUBRIC}.
Lens: ${lensFor(round + 1, k)}.
Write a concept sketch only: an approach name, a one-sentence thesis, and a narrative (400 words max) that follows the template headings. No mockup, no files. Say plainly what the eye lands on first and what the design leaves out. The Fable generators will read this and either steal from it or reject it.
Keep to a handful of tool calls; do not explore the repo.
Return the SKETCH object.`
}

function genPrompt(id, lens, sketchText, tier, subtractive) {
  const out = dirFor(id)
  const incRegions = champion && champion.regions !== undefined ? champion.regions : null
  return `You are candidate ${id} (${tier} tier) in a UI/UX tournament on the screen "${SCREEN}".
Read, in order: ${RUBRIC} (stance, axes, the no-regression gate, hard caps, narrative template, mockup contract) and ${BRIEF} (domain, users, the reading budget, the screen's job, current implementation, the data that actually exists, house style and constraints).
${incumbentBlock()}
${champion ? `To dethrone it you must score at least its UX subtotal, at least its Craft subtotal, AND beat its total by the required margin, judged blind by a judge that re-scores it alongside you without being told which entry it is. Improving on it is allowed and often the best move; copying it with cosmetic changes is a duplicate and cannot win.
GROWTH TAX — the margin is not fixed. Base is ${CAPS.margin}. Every region you render beyond the incumbent's${champion.regions === undefined ? '' : ` ${champion.regions}`} (past a one-region deadband) adds ${CAPS.growthTax} to the bar; every region you cut below it takes ${CAPS.cutDiscount} off, down to a floor of ${CAPS.marginFloor}. Adding four regions means beating it by 17; cutting three means beating it by 4. Doing the same job with less is the cheapest way to win here, and adding is the most expensive — but you cannot buy a small page with lost comprehension or craft, because neither subtotal may regress.` : ''}
${subtractive ? `*** SUBTRACTIVE ROUND. Only a design with FEWER rendered regions than the incumbent${incRegions ? ` (it renders ${incRegions})` : ''} can win this round. Cut, merge or demote — do not add. The job is the same job with less on screen: fewer regions, sharper ranking, the exception loud and the routine quiet. A design that keeps every region and restyles them is inadmissible here. ***` : ''}
Your lens: ${subtractive ? 'subtractive' : lens}. Design from this lens first; borrow from others only where it serves the user.
Approaches already used in this ledger (NO-REPEAT; a near-duplicate cannot dethrone): ${USED.length ? USED.join('; ') : 'none yet'}
${sketchText ? `Cheap concept sketches from scouts, to steal from or reject:\n${sketchText}\n` : ''}
Produce, in ${out}/ (create it):
  1. mockup.html — per the mockup contract: one file, inline CSS, no framework or CDN, realistic data from the brief, the product's own grid and type scale (inventing your own caps you at 75), data-ux annotations on every meaningful region, the states that matter.
  2. Render it: bash "${RENDER}" "${out}/mockup.html" "${out}/mockup.png". Look at the PNG (Read it) as a reader would, for ten seconds: can you name the one to three unusual things and the one action? If not, fix the ranking — not the wording — and re-render. If rendering fails twice, set rendered=false and say why in notes.
  3. narrative.md — exactly the template headings, in order, including "What stands out" and "What this removes". Every claim points at a data-ux region that visibly delivers it. Unbacked claims cost points.
Principles: user experience, user understanding and visual craft are all first-class and NEITHER MAY REGRESS. Hierarchy is the mechanism of comprehension at a glance, not decoration competing with it — where everything is emphasised, nothing is; and a page earns its regions, because where everything is shown, nothing is understood. Your page must have ONE SPINE: a stranger looking only at the render should be able to say in one sentence what it is for, and that sentence should be your thesis. Every region must serve one of the facts the brief says the persona actually needs — a region that serves none is deadweight and is scored as such. Never invent data the brief says does not exist. Stack-agnostic.
${BLIND_RULE}
Work in a tight loop: read the two files once each, write, render, look, fix once, write the narrative, return. Aim for under ${CAPS.genTools} tool calls — do not explore the repo, do not re-read what you have read, do not write scratch files. Volume per agent is what made the first run cost three times its projection.
Return the CANDIDATE object with absolute paths; id = "${id}"; regions = the number of distinct top-level data-ux regions your default state renders.`
}

function stagePrompt(staged, bdir) {
  const lines = staged.map(s => `- ${s.label}: html "${s.mockup}"${s.screenshot ? `, png "${s.screenshot}"` : ''}, narrative "${s.narrative}", source id "${s.id}"`).join('\n')
  return `Mechanical file staging for a blind judging pass. No analysis, no commentary, no reading of contents beyond the substitution below.
For each entry, create "${bdir}/<label>/" and copy its files in as mockup.html, mockup.png (if a png is listed) and narrative.md:
${lines}
Then, in every copied file, replace each occurrence of that entry's source id string with its label (e.g. sed -i '' 's/r3-climb-b/E2/g'), and also replace any other entry's source id if it appears. Do not change anything else.
Use one bash call if you can. Return { ok: true } when every listed file exists at its destination, or { ok: false, note: "<what failed>" }.`
}

function judgePrompt(tier, staged, judgeLabel, bdir, subtractive, priorApproaches) {
  const list = staged.map(s => `- ${s.label}: image ${s.png || '(no render; the design failed to render — score what the source shows and say so)'}; source ${s.html}; narrative ${s.md}`).join('\n')
  const mergeId = `r${round}-${tier}-merge`
  return `You are the ${judgeLabel} judge for round ${round} (${tier} tier) of a UI/UX tournament on the screen "${SCREEN}".
Read ${RUBRIC} in full and follow its Judge protocol exactly — PNG first, source second. That means: for each entry, from the image alone and before you open anything else, write one sentence naming the page's organizing idea (if you cannot, its Economy is 4 or less), then score Triage and Craft.
Entries (anonymised; some may have competed in earlier rounds — score each cold on what it is, and do not try to infer which is which):
${list}
Then read ${BRIEF} for the domain, the reading budget and the house style.
${subtractive ? `This is the SUBTRACTIVE round: count each entry's rendered regions carefully, because admissibility depends on it. Score normally otherwise.` : ''}
Score EVERY entry on all eight axes. For each, return: label, axes, ux (Understanding+Triage+Speed+Accuracy+Economy+Onboarding, max 80), craft (Craft and hierarchy, max 15), total (sum of all eight, then hard caps applied — list every cap you applied in caps[]), regions (distinct top-level data-ux regions in the default state, counted by you the same way for every entry — count carefully, the dethrone margin is computed from it), unbacked, duplicate_of if it is a near-duplicate of an approach retired in an earlier round (${priorApproaches.length ? priorApproaches.join('; ') : 'list empty'}), gap_notes (what a 95 would have needed: concrete, checkable, ordered by points available) and rationale (2–5 sentences quoting what you saw in the render).
DO NOT pick a winner and do not rank the entries against one another beyond the numbers. The tournament applies the no-regression gate and the ${CAPS.margin}-point margin to your scores afterwards. Your job is one cold score per entry.
Merging is allowed where specific elements of two or more entries would combine into something better than either: build it in ${dirFor(mergeId)}/ (mockup.html + narrative.md), render it with bash "${RENDER}" "${dirFor(mergeId)}/mockup.html" "${dirFor(mergeId)}/mockup.png", look at the PNG, score it as an extra entry with label "EM" in scores, and return the merge object (approach name, absolute paths, takes_from). A merge that is simply the union of its parents' regions is accretion, not a merge — do not build it${subtractive ? ', and in this round a merge must also render fewer regions than the smallest entry it merges from' : ''}.
Score Economy with the rubric's two tests: the spine test (your one-sentence read versus the candidate's own thesis) and the deadweight test (every rendered region that serves none of the facts the brief says the persona needs, at −2 each).
Ignore any self-check appendix, fold metric, density claim or region count asserted inside a candidate; score only what you see rendered.
Keep to under ${CAPS.judgeTools} tool calls: every PNG once, every source once, the brief once.
Return the JUDGMENT object.`
}

function planPrompt() {
  return `Write the build plan for the crowned UI/UX design of the screen "${SCREEN}".
Read ${BRIEF}, then the champion: mockup ${champion.mockup}, screenshot ${champion.screenshot || '(none)'}, narrative ${champion.narrative}. Gap notes (known shortfalls, do not paper over them): ${champion.gapNotes || '(none)'}.
Inspect the repo named in the brief to learn the real stack, component conventions, data access, and test setup. Do not implement anything.
Write ${DIR}/build-plan-${DATE}.md with: (1) a five-line summary; (2) what to keep from the current screen; (3) ordered file-level steps in the repo's own idiom, mapping the mockup's type scale and hierarchy onto the product's real design tokens — say explicitly where the mockup's own scale must be dropped in favour of the house one; (4) a table mapping every narrative claim to an acceptance criterion a reviewer can check, including the triage test ("in the reading budget, from the rendered page, a reader can name the 1–3 unusual things and the one action"); (5) tests to add (one regression test per behavior, no generated suites); (6) explicitly out of scope; (7) risks and open questions. Keep it under 250 lines.
Return the PLAN object: path (absolute), summary, acceptance (the criteria list).`
}

// ---------- helpers ----------
// rubric v3: the dethrone margin carries a growth tax. Adding regions costs margin, removing them
// refunds it, with a one-region deadband so ±1 counting noise never moves the bar.
function requiredMargin(cRegions, iRegions) {
  const base = CAPS.margin
  if (typeof cRegions !== 'number' || typeof iRegions !== 'number' || !isFinite(cRegions) || !isFinite(iRegions)) return base
  const d = cRegions - iRegions
  if (d > CAPS.taxDeadband) return base + CAPS.growthTax * (d - CAPS.taxDeadband)
  if (-d > CAPS.taxDeadband) return Math.max(CAPS.marginFloor, base - CAPS.cutDiscount * (-d - CAPS.taxDeadband))
  return base
}

function rotate(arr, n) { if (!arr.length) return arr; const k = ((n % arr.length) + arr.length) % arr.length; return arr.slice(k).concat(arr.slice(0, k)) }

async function stageBlind(entries) {
  // entries: [{ id, approach, mockup, screenshot, narrative, incumbent }] already rotated
  const bdir = blindDirFor(round)
  const staged = entries.map((e, i) => {
    const label = 'E' + (i + 1)
    return { label, id: e.id, approach: e.approach, mockup: e.mockup, screenshot: e.screenshot, narrative: e.narrative, incumbent: e.incumbent,
      html: bdir + '/' + label + '/mockup.html', png: e.screenshot ? bdir + '/' + label + '/mockup.png' : '', md: bdir + '/' + label + '/narrative.md' }
  })
  let ok = false
  try {
    calls.haiku += 1
    const r = await agent(stagePrompt(staged, bdir), { label: `stage:r${round}`, phase: 'stage', model: 'haiku', schema: STAGED, agentType: 'general-purpose' })
    ok = !!(r && r.ok)
    if (!ok) log(`r${round} stage: blind staging failed (${r && r.note ? r.note : 'no result'}); judging from original paths`)
  } catch (e) {
    log(`r${round} stage: blind staging threw; judging from original paths`)
  }
  if (!ok) staged.forEach(s => { s.html = s.mockup; s.png = s.screenshot || ''; s.md = s.narrative })
  return { staged, blind: ok }
}

function record(phase, tier, judgeModel, rows, outcome, blind) {
  history.push({
    round, phase, tier, judge: judgeModel, blind,
    subtractive: !!outcome.subtractive,
    entries: rows,                                   // [{ id, label, incumbent, total, ux, craft, regions, caps, duplicate_of, blocked }]
    incumbent_rescore: outcome.incumbentScore ? outcome.incumbentScore.total : null,
    incumbent_ux: outcome.incumbentScore ? outcome.incumbentScore.ux : null,
    incumbent_craft: outcome.incumbentScore ? outcome.incumbentScore.craft : null,
    verdict: outcome.verdict, champion: outcome.champion.id, total: outcome.champion.total,
    near_miss: outcome.nearMiss, gap_notes: outcome.champion.gapNotes, rationale: outcome.rationale,
  })
}

async function generate(tier, model, n, phaseName, sketchText, subtractive) {
  round += 1
  const r = round
  const cands = (await parallel(Array.from({ length: n }, (_, k) => () => {
    const id = `r${r}-${tier}-${String.fromCharCode(97 + k)}`
    calls[model] += 1
    return agent(genPrompt(id, lensFor(r, k), sketchText, tier, subtractive), { label: `gen:${id}`, phase: phaseName, model, schema: CANDIDATE, agentType: 'general-purpose' })
  }))).filter(Boolean)
  if (!cands.length) throw new Error(`round ${r}: no candidates returned`)
  if (cands.length < n) log(`round ${r}: ${n - cands.length} of ${n} generators returned nothing`)
  return cands
}

// Blind scoring pass + script-side no-regression gate. The judge never sees incumbency and never
// picks a winner; every verdict below is computed from its cold numbers.
async function judge(tier, model, cands, phaseName, opts) {
  const subtractive = !!(opts && opts.subtractive)
  const entries = cands.map(c => ({ id: c.id, approach: c.approach, mockup: c.mockup, screenshot: c.screenshot, narrative: c.narrative, incumbent: false }))
  if (champion) entries.push({ id: champion.id, approach: champion.approach, mockup: champion.mockup, screenshot: champion.screenshot, narrative: champion.narrative, incumbent: true })
  const { staged, blind } = await stageBlind(rotate(entries, round))

  // An entry can never be a duplicate of itself: any approach competing this round is withheld from the
  // judge's NO-REPEAT list, otherwise the list names the reigning champion's approach and blindness leaks.
  const here = staged.map(s => s.approach).filter(Boolean)
  const priorApproaches = USED.filter(a => !here.includes(a))
  calls[model] += 1
  const j = await agent(judgePrompt(tier, staged, model, blindDirFor(round), subtractive, priorApproaches), { label: `judge:r${round}-${tier}`, phase: phaseName, model, schema: JUDGMENT, agentType: 'general-purpose' })
  if (!j || !j.scores || !j.scores.length) throw new Error(`round ${round}: judge returned nothing`)

  const byLabel = {}
  j.scores.forEach(s => { byLabel[s.label] = s })
  const mergeId = `r${round}-${tier}-merge`
  const pool = staged.map(s => ({ entry: s, score: byLabel[s.label] })).filter(x => x.score)
  if (j.merge && byLabel[j.merge.label]) {
    pool.push({ entry: { label: j.merge.label, id: mergeId, approach: j.merge.approach, mockup: j.merge.mockup, screenshot: j.merge.screenshot || '', narrative: j.merge.narrative, incumbent: false, merged: true }, score: byLabel[j.merge.label] })
  }
  const incPair = pool.find(x => x.entry.incumbent)
  const incumbentScore = incPair ? incPair.score : null
  const challengers = pool.filter(x => !x.entry.incumbent)

  const blockedReason = (s) => {
    if (s.duplicate_of) return `duplicate of ${s.duplicate_of}`
    if (!incumbentScore) return null
    if (subtractive && !(s.regions < incumbentScore.regions)) return `subtractive round: ${s.regions} regions vs incumbent ${incumbentScore.regions}`
    if (s.ux < incumbentScore.ux) return `UX regression ${s.ux} < ${incumbentScore.ux}`
    if (s.craft < incumbentScore.craft) return `Craft regression ${s.craft} < ${incumbentScore.craft}`
    const req = requiredMargin(s.regions, incumbentScore.regions)
    if (s.total < incumbentScore.total + req) {
      const d = s.regions - incumbentScore.regions
      const why = req === CAPS.margin ? '' : (d > 0 ? ` (adds ${d} regions)` : ` (cuts ${-d} regions)`)
      return `under margin: ${s.total} < ${incumbentScore.total} + ${req}${why}`
    }
    return null
  }
  challengers.forEach(x => {
    x.blocked = blockedReason(x.score)
    x.required = incumbentScore ? requiredMargin(x.score.regions, incumbentScore.regions) : null
  })
  const admissible = challengers.filter(x => !x.blocked).sort((a, b) => b.score.total - a.score.total)
  const winner = admissible[0] || null

  let verdict, champ
  if (!incumbentScore) {
    const top = challengers.filter(x => !x.score.duplicate_of).sort((a, b) => b.score.total - a.score.total)[0] || challengers.sort((a, b) => b.score.total - a.score.total)[0]
    verdict = 'first'
    champ = top
  } else if (winner) {
    verdict = winner.entry.merged ? 'merged' : 'dethroned'
    champ = winner
  } else {
    verdict = 'incumbent_stands'
    champ = incPair
  }

  const winTotal = champ.score.total
  const nearMiss = pool.some(x => x !== champ && (winTotal - x.score.total) <= CAPS.nearMiss)

  champion = {
    id: champ.entry.id, approach: champ.entry.approach,
    mockup: champ.entry.mockup, screenshot: champ.entry.screenshot, narrative: champ.entry.narrative,
    total: champ.score.total, ux: champ.score.ux, craft: champ.score.craft, regions: champ.score.regions,
    gapNotes: champ.score.gap_notes,
  }

  const rows = pool.map(x => ({
    id: x.entry.id, label: x.entry.label, incumbent: !!x.entry.incumbent,
    total: x.score.total, ux: x.score.ux, craft: x.score.craft, regions: x.score.regions,
    caps: x.score.caps || [], duplicate_of: x.score.duplicate_of || null,
    required: x.required === undefined ? null : x.required,
    blocked: x.blocked || null, rationale: x.score.rationale, gap_notes: x.score.gap_notes,
  }))
  const outcome = { verdict, champion, nearMiss, incumbentScore, subtractive, rationale: j.notes || '' }
  record(phaseName, tier, model, rows, outcome, blind)

  pool.forEach(x => { if (!x.entry.incumbent && x.entry.approach && !USED.includes(x.entry.approach)) USED.push(x.entry.approach) })
  const blockedNote = challengers.filter(x => x.blocked).map(x => `${x.entry.id} (${x.blocked})`).join(', ')
  log(`r${round} ${tier}${subtractive ? ' [subtractive]' : ''}${blind ? '' : ' [NOT blind]'}: ${verdict}; champion ${champion.id} @ ${champion.total} (UX ${champion.ux}/80, Craft ${champion.craft}/15, ${champion.regions} regions)${nearMiss ? ' (near miss)' : ''}${blockedNote ? `; blocked: ${blockedNote}` : ''}`)
  return { verdict, nearMiss, incumbentScore }
}

// ---------- Scout ----------
let sketchText = ''
if (CAPS.scouts > 0 && (!champion || REANCHOR)) {
  phase('Scout')
  const sk = (await parallel(Array.from({ length: CAPS.scouts }, (_, k) => () => {
    calls.sonnet += 1
    return agent(scoutPrompt(k), { label: `scout:${k + 1}`, phase: 'Scout', model: 'sonnet', schema: SKETCH, agentType: 'general-purpose' })
  }))).filter(Boolean)
  sketchText = sk.map((s, i) => `${i + 1}. ${s.approach} — ${s.thesis}\n${s.narrative}`).join('\n\n')
  log(`scout: ${sk.length} sketches`)
}

// ---------- Anchor ----------
if (!champion || REANCHOR) {
  phase('Anchor')
  const cands = await generate('anchor', 'fable', CAPS.anchorGens, 'Anchor', sketchText, false)
  await judge('anchor', CAPS.anchorJudge, cands, 'Anchor', {})
} else {
  log(`anchor: skipped; ledger champion ${champion.id} @ ${champion.total} is the anchor (re-scored blind in round 1 below)`)
}
const anchorSnap = Object.assign({}, champion)

// ---------- Climb ----------
phase('Climb')
let signal = false, repeat = false, climbRounds = 0
while (climbRounds < CAPS.climbRounds && !repeat) {
  climbRounds += 1
  const cands = await generate('climb', 'sonnet', CAPS.climbGens, 'Climb', '', false)
  const j = await judge('climb', 'opus', cands, 'Climb', {})
  if (j.verdict === 'incumbent_stands') repeat = true; else signal = true
  if (j.nearMiss) signal = true
}
if (!repeat) log(`climb: cap of ${CAPS.climbRounds} rounds hit without a repeat champion; promoting ${champion.id}`)

// ---------- Subtract: one round per run where only a smaller design can win ----------
if (CAPS.subtractRounds > 0 && champion) {
  phase('Subtract')
  for (let i = 0; i < CAPS.subtractRounds; i++) {
    const cands = await generate('subtract', 'sonnet', CAPS.subtractGens, 'Subtract', '', true)
    const j = await judge('subtract', 'opus', cands, 'Subtract', { subtractive: true })
    if (j.verdict !== 'incumbent_stands') signal = true
  }
}

// ---------- Push ----------
if (CAPS.pushRounds > 0 && (signal || FORCE)) {
  phase('Push')
  let pr = 0, prepeat = false
  while (pr < CAPS.pushRounds && !prepeat) {
    pr += 1
    const cands = await generate('push', 'opus', CAPS.pushGens, 'Push', '', false)
    const j = await judge('push', 'fable', cands, 'Push', {})
    if (j.verdict === 'incumbent_stands') prepeat = true
  }
  if (!prepeat) log(`push: cap of ${CAPS.pushRounds} rounds hit without a repeat champion; promoting ${champion.id}`)
} else if (CAPS.pushRounds > 0) {
  log('push: skipped; climb showed no signal (no dethrone, no near miss). Pass forceClimb to override.')
}

// ---------- Summit (3x only) ----------
if (CAPS.summitGens > 0) {
  phase('Summit')
  const cands = await generate('summit', 'fable', CAPS.summitGens, 'Summit', '', false)
  await judge('summit', 'fable', cands, 'Summit', {})
}

// ---------- Crown: the final champion must beat the anchor blind under one Fable pass, or the anchor stands ----------
const changed = champion.id !== anchorSnap.id
if (changed && CAPS.crown) {
  phase('Crown')
  const finalist = Object.assign({}, champion)
  champion = anchorSnap
  round += 1
  const j = await judge('crown', CAPS.crown, [finalist], 'Crown', {})
  if (j.verdict === 'incumbent_stands') log(`crown: anchor ${anchorSnap.id} stands; the cheaper tiers' wins did not survive a blind Fable re-score`)
} else if (!changed) {
  log(`crown: skipped; anchor ${anchorSnap.id} was never dethroned`)
}

// ---------- Plan ----------
let plan = null
if (champion.id !== anchorSnap.id || !A.hasPlan) {
  phase('Plan')
  calls.opus += 1
  plan = await agent(planPrompt(), { label: 'build-plan', phase: 'Plan', model: 'opus', schema: PLAN, agentType: 'general-purpose' })
} else {
  log('plan: skipped; champion unchanged and a build plan already exists')
}

let outputTokens = null
try { outputTokens = budget.spent() } catch (e) { outputTokens = null }

return {
  date: DATE, screen: SCREEN, dir: DIR, rubric: 'v3', margin: CAPS.margin,
  tax: { growthTax: CAPS.growthTax, cutDiscount: CAPS.cutDiscount, floor: CAPS.marginFloor, deadband: CAPS.taxDeadband },
  champion, anchor: { id: anchorSnap.id, total: anchorSnap.total, ux: anchorSnap.ux, craft: anchorSnap.craft },
  changed: champion.id !== anchorSnap.id,
  rounds: round - (A.roundOffset || 0), lastRound: round,
  calls, outputTokens, usedApproaches: USED, history, plan,
  acknowledgementRequired: true,   // SKILL.md STEP 9: show the PNG, get an explicit ack, before any code
}
