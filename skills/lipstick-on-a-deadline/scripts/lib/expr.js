// A small shunting-yard evaluator for derived data values: + - * / ^ ( ) min max round, numeric literals,
// and identifiers that must be data ids. Anything else is rejected, so a formula can't smuggle code.
const OPS = { '+': [1, 'L'], '-': [1, 'L'], '*': [2, 'L'], '/': [2, 'L'], '^': [3, 'R'], 'u-': [4, 'R'] }
const FNS = { min: Math.min, max: Math.max, round: (x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k } }

export function tokenize(src) {
  const out = []
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][\w.]*)|(\*\*|[-+*/^(),×÷]))/y
  let i = 0
  while (i < src.length) {
    re.lastIndex = i
    const m = re.exec(src)
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(src.slice(i))) break
      throw new Error(`formula: unexpected "${src.slice(i, i + 12)}"`)
    }
    i = re.lastIndex
    if (m[1]) out.push({ t: 'num', v: Number(m[1]) })
    else if (m[2]) out.push(FNS[m[2]] ? { t: 'fn', v: m[2] } : { t: 'id', v: m[2] })
    else out.push({ t: 'op', v: m[3] === '×' ? '*' : m[3] === '÷' ? '/' : m[3] === '**' ? '^' : m[3] })
  }
  return out
}

export function evaluate(src, vars) {
  const toks = tokenize(src)
  const outQ = [], ops = []
  let prev = null
  const argc = []
  for (const tk of toks) {
    if (tk.t === 'num') outQ.push(tk)
    else if (tk.t === 'id') {
      if (!(tk.v in vars)) throw new Error(`formula: unknown id "${tk.v}"`)
      outQ.push({ t: 'num', v: Number(vars[tk.v]) })
    } else if (tk.t === 'fn') { ops.push(tk); argc.push(1) }
    else if (tk.v === ',') {
      while (ops.length && ops[ops.length - 1].v !== '(') outQ.push(ops.pop())
      argc[argc.length - 1]++
    } else if (tk.v === '(') ops.push(tk)
    else if (tk.v === ')') {
      while (ops.length && ops[ops.length - 1].v !== '(') outQ.push(ops.pop())
      if (!ops.length) throw new Error('formula: unbalanced )')
      ops.pop()
      if (ops.length && ops[ops.length - 1].t === 'fn') outQ.push({ ...ops.pop(), n: argc.pop() })
    } else {
      const unary = tk.v === '-' && (!prev || (prev.t === 'op' && prev.v !== ')'))
      const op = unary ? 'u-' : tk.v
      if (!OPS[op]) throw new Error(`formula: bad operator ${tk.v}`)
      while (ops.length) {
        const top = ops[ops.length - 1]
        if (top.t !== 'op' || top.v === '(') break
        const [p1, a1] = OPS[op], [p2] = OPS[top.v]
        if (p2 > p1 || (p2 === p1 && a1 === 'L')) outQ.push(ops.pop()); else break
      }
      ops.push({ t: 'op', v: op })
    }
    prev = tk
  }
  while (ops.length) { const o = ops.pop(); if (o.v === '(') throw new Error('formula: unbalanced ('); outQ.push(o) }
  const st = []
  for (const tk of outQ) {
    if (tk.t === 'num') st.push(tk.v)
    else if (tk.t === 'fn') { const args = st.splice(st.length - tk.n, tk.n); st.push(FNS[tk.v](...args)) }
    else if (tk.v === 'u-') st.push(-st.pop())
    else { const b = st.pop(), a = st.pop(); st.push(tk.v === '+' ? a + b : tk.v === '-' ? a - b : tk.v === '*' ? a * b : tk.v === '/' ? a / b : a ** b) }
  }
  if (st.length !== 1 || !Number.isFinite(st[0])) throw new Error('formula: did not reduce to one number')
  return st[0]
}
