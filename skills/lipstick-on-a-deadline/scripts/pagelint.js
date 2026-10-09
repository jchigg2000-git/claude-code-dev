// In-page lint and audit, evaluated by shoot.mjs through CDP Runtime.evaluate. Returns plain JSON.
// Rules: no horizontal overflow, body copy ≥16px, tap targets ≥44px, no stray digits in text, unique ids,
// the hero's words visible at first paint, no wide fixed min-widths, no sticky inside an overflow box,
// layout variety, and the scroll-motion samples that make up the alive ratio.
(function (opts) {
  opts = opts || {};
  var out = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, hoverNone: matchMedia('(hover: none)').matches,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, errors: (window.__lod && window.__lod.errors) || [], findings: [] };
  var push = function (rule, detail) { out.findings.push({ rule: rule, detail: String(detail).slice(0, 200) }); };
  var sel = function (el) {
    if (!el || !el.tagName) return '?';
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + [].slice.call(el.classList, 0, 2).join('.');
    var sec = el.closest && el.closest('section[id]');
    return (sec && sec !== el ? '#' + sec.id + ' ' : '') + s;
  };
  var visible = function (el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  var effOpacity = function (el) { var o = 1; for (var e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };

  // overflow
  out.scrollWidth = document.documentElement.scrollWidth;
  if (out.scrollWidth > innerWidth + 1) {
    var off = [];
    [].forEach.call(document.querySelectorAll('body *'), function (el) {
      if (off.length > 5 || !visible(el)) return;
      var r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.rail')) off.push(sel(el) + ' right=' + Math.round(r.right));
    });
    push('overflow', 'scrollWidth ' + out.scrollWidth + ' > ' + innerWidth + ': ' + off.join(', '));
  }

  // body copy size
  var EXEMPT_TXT = '.kicker,.tag,.src,.when,.scroll-cue,.state,.foot,.mast,.go,small,code,.n,#lod-nav,figcaption';
  var minFont = 99, minAt = '';
  [].forEach.call(document.querySelectorAll('main p, main li'), function (el) {
    if (!visible(el) || el.closest(EXEMPT_TXT) || !el.textContent.trim()) return;
    var f = parseFloat(getComputedStyle(el).fontSize);
    if (f < minFont) { minFont = f; minAt = sel(el); }
  });
  out.minBodyFont = minFont === 99 ? null : minFont;
  if (minFont < 16) push('font', minFont + 'px at ' + minAt);

  // tap targets (inline links inside running text are exempt)
  var minTap = 999, tapAt = '';
  [].forEach.call(document.querySelectorAll('main a, main button, main summary, main [role="button"], main input, main select'), function (el) {
    if (!visible(el)) return;
    if (el.tagName === 'A' && el.closest('p, li') && !el.closest('.links, .rail')) return;
    var r = el.getBoundingClientRect();
    var m = Math.min(r.width, r.height);
    if (m < minTap) { minTap = m; tapAt = sel(el); }
  });
  out.minTap = minTap === 999 ? null : Math.round(minTap);
  if (minTap < 44) push('tap', Math.round(minTap) + 'px at ' + tapAt);

  // stray digits in text (numbers must come through data-num; structural digits are marked data-ok-digits)
  var ALLOWED = '[data-num],[data-ok-digits],code,.src,script,style,noscript,svg,time,.foot,.mast,#lod-err,#lod-nav';
  var walker = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT);
  var n, stray = [];
  while ((n = walker.nextNode())) {
    if (!/\d/.test(n.nodeValue)) continue;
    var p = n.parentElement;
    if (!p || p.closest(ALLOWED)) continue;
    stray.push(sel(p) + ' "' + n.nodeValue.trim().slice(0, 40) + '"');
  }
  if (stray.length) push('digits', stray.slice(0, 6).join(' | '));

  // ids
  var seen = {}, dup = [];
  [].forEach.call(document.querySelectorAll('[id]'), function (el) { if (seen[el.id]) dup.push(el.id); seen[el.id] = 1; });
  if (dup.length) push('dup-id', dup.join(', '));

  // hero words visible at first paint
  var hero = document.querySelector('.a-hero, section[data-archetype="hero-alive"]');
  if (hero) {
    var h1 = hero.querySelector('h1');
    var num = hero.querySelector('[data-num]');
    out.hero = { h1: !!h1, h1Opacity: h1 ? Math.round(effOpacity(h1) * 100) / 100 : 0, h1Bottom: h1 ? Math.round(h1.getBoundingClientRect().bottom + scrollY) : null,
      numBottom: num ? Math.round(num.getBoundingClientRect().bottom + scrollY) : null, numOpacity: num ? Math.round(effOpacity(num) * 100) / 100 : 0 };
    if (!h1 || effOpacity(h1) < 0.99) push('hero-hidden', 'hero headline opacity ' + (h1 ? effOpacity(h1).toFixed(2) : 'missing'));
    if (opts.firstScreen && (!num || out.hero.numBottom > innerHeight)) push('first-screen', 'no hero number inside the first ' + innerHeight + 'px');
  } else push('hero-missing', 'no hero-alive section');

  // wide fixed min-widths outside a min-width media query
  try {
    [].forEach.call(document.styleSheets, function (ss) {
      var walk = function (rules, inMin) {
        [].forEach.call(rules || [], function (r) {
          if (r.cssRules && r.media) return walk(r.cssRules, inMin || /min-width/.test(r.media.mediaText));
          if (r.cssRules && !r.style) return walk(r.cssRules, inMin);
          if (r.style && !inMin) { var mw = parseFloat(r.style.minWidth); if (mw > 360 && /px/.test(r.style.minWidth)) push('min-width', r.selectorText + ' min-width ' + r.style.minWidth); }
          if (r.cssRules && r.style) walk(r.cssRules, inMin);
        });
      };
      walk(ss.cssRules, false);
    });
  } catch (e) {}

  // sticky inside an overflow box never sticks (clip is fine)
  [].forEach.call(document.querySelectorAll('main *'), function (el) {
    if (getComputedStyle(el).position !== 'sticky') return;
    for (var a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      var cs = getComputedStyle(a);
      if (/(hidden|auto|scroll)/.test(cs.overflowX + cs.overflowY)) { push('sticky-overflow', sel(el) + ' inside ' + sel(a)); break; }
    }
  });

  // pinned lengths on phones
  if (innerWidth < 900) [].forEach.call(document.querySelectorAll('main section'), function (s) {
    var h = s.getBoundingClientRect().height / innerHeight;
    if (h > 4.2) push('pin-length', '#' + s.id + ' is ' + h.toFixed(1) + ' screens tall');
  });

  // layout variety
  var arch = [].map.call(document.querySelectorAll('main section[data-archetype]'), function (s) { return s.getAttribute('data-archetype'); });
  out.archetypes = arch;
  var distinct = arch.filter(function (a, i) { return arch.indexOf(a) === i && ['limits', 'close'].indexOf(a) < 0; }).length;
  out.distinctArchetypes = distinct;
  for (var i = 1; i < arch.length; i++) if (arch[i] === arch[i - 1] && ['limits', 'close'].indexOf(arch[i]) < 0) push('adjacent-archetype', arch[i] + ' twice in a row');
  if (distinct < (opts.minArchetypes || 4)) push('variety', distinct + ' distinct layouts (want ' + (opts.minArchetypes || 4) + ')');

  // headings present
  out.headings = [].map.call(document.querySelectorAll('main h1, main h2'), function (h) { return { t: h.textContent.trim().slice(0, 50), o: Math.round(effOpacity(h) * 100) / 100, vis: visible(h) }; });
  return out;
})
