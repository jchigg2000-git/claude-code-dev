/* lipstick chassis runtime. JS only enhances: the page is complete and moving (CSS scroll-driven) without it. */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOBILE = matchMedia('(max-width: 899px), (hover: none)').matches;
  var SDA = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()'));
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var DATA = {};
  try { DATA = JSON.parse((document.getElementById('lod-data') || {}).textContent || '{}'); } catch (e) {}
  var QA = { ready: false, errors: [], scenes: [] };
  window.__lod = QA;

  function revealAll() {
    root.classList.remove('io');
    [].forEach.call(document.querySelectorAll('.rv'), function (el) { el.classList.add('in'); });
  }
  function showErr(msg) {
    QA.errors.push(String(msg || 'error'));
    revealAll();
    var bar = document.getElementById('lod-err');
    if (bar) { bar.textContent = 'Part of this page failed to run. Everything is still readable. (' + String(msg || '').slice(0, 120) + ')'; bar.classList.add('on'); }
  }
  window.addEventListener('error', function (e) { showErr(e.message); });
  window.addEventListener('beforeprint', revealAll);

  if (root.dataset.forceDark === '1') root.setAttribute('data-theme', 'dark');

  // ---- scene registry: fragments call LOD.scene(id, fn) ----
  var registry = [];
  var listeners = [];
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function localProgress(el) {
    var r = el.getBoundingClientRect();
    var span = el.offsetHeight - innerHeight;
    return span > 0 ? clamp(-r.top / span) : clamp(1 - r.top / innerHeight);
  }
  function tap(fn) {
    if (document.startViewTransition && !REDUCED) { try { return document.startViewTransition(fn); } catch (e) {} }
    fn();
  }
  function fmt(v) { return typeof v === 'number' ? v.toLocaleString() : String(v); }
  window.LOD = {
    reduced: REDUCED, mobile: MOBILE, dpr: DPR, data: DATA,
    scene: function (id, fn) { registry.push({ id: id, fn: fn }); },
    tap: tap, fmt: fmt
  };

  function apiFor(el) {
    var mine = [];
    var api = {
      root: el, reduced: REDUCED, mobile: MOBILE, dpr: DPR,
      get progress() { return localProgress(el); },
      onProgress: function (fn) { mine.push(fn); listeners.push({ el: el, fn: fn }); },
      data: function (id) { var d = DATA[id]; return d ? d.value : undefined; },
      $: function (s) { return el.querySelector(s); },
      $$: function (s) { return [].slice.call(el.querySelectorAll(s)); },
      tap: tap, fmt: fmt,
      visible: function (fn, margin) {
        var io = new IntersectionObserver(function (es) { es.forEach(function (e) { fn(e.isIntersecting, e); }); }, { rootMargin: margin || '0px' });
        io.observe(el);
      }
    };
    return api;
  }

  // ---- one scroll loop: page progress (fallback for the root timeline) and per-scene progress ----
  var ticking = false;
  var visibleScenes = new Set();
  function frame() {
    ticking = false;
    var max = document.documentElement.scrollHeight - innerHeight;
    root.style.setProperty('--progress', max > 0 ? clamp(scrollY / max).toFixed(4) : '0');
    for (var i = 0; i < listeners.length; i++) {
      var l = listeners[i];
      if (!visibleScenes.has(l.el)) continue;
      try { l.fn(localProgress(l.el)); } catch (e) { showErr(e.message); }
    }
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }

  // ---- reveals when scroll-driven animation is missing ----
  function setupReveals() {
    if (SDA || REDUCED || !('IntersectionObserver' in window)) return;
    root.classList.add('io');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px' });
    [].forEach.call(document.querySelectorAll('.rv'), function (el) { io.observe(el); });
  }

  // ---- count-ups (the static text already holds the final value) ----
  function setupCounts() {
    if (REDUCED) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var el = e.target, to = Number(el.getAttribute('data-count')), dec = (String(to).split('.')[1] || '').length;
        if (!isFinite(to)) return;
        var t0 = performance.now(), dur = 1100;
        (function step(t) {
          var k = Math.min(1, (t - t0) / dur), v = to * (1 - Math.pow(1 - k, 3));
          el.textContent = dec ? v.toFixed(dec) : Math.round(v).toLocaleString();
          if (k < 1) requestAnimationFrame(step); else el.textContent = el.getAttribute('data-final') || fmt(to);
        })(t0);
      });
    }, { threshold: 0.6 });
    [].forEach.call(document.querySelectorAll('[data-count]'), function (el) {
      if (el.getBoundingClientRect().top < innerHeight) return;
      io.observe(el);
    });
  }

  // ---- side nav from section[data-title]; jumps ride a view transition ----
  function setupNav() {
    var nav = document.getElementById('lod-nav');
    var secs = [].slice.call(document.querySelectorAll('section[data-title]'));
    if (!nav || !secs.length) return;
    secs.forEach(function (s) {
      var a = document.createElement('a');
      a.href = '#' + s.id; a.setAttribute('aria-label', s.getAttribute('data-title'));
      var sp = document.createElement('span'); sp.textContent = s.getAttribute('data-title'); a.appendChild(sp);
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        tap(function () { s.scrollIntoView({ block: 'start', behavior: 'instant' }); });
        history.replaceState(null, '', '#' + s.id);
      });
      nav.appendChild(a);
    });
    var links = [].slice.call(nav.querySelectorAll('a'));
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var i = secs.indexOf(e.target);
        links.forEach(function (l, j) { l.setAttribute('aria-current', j === i ? 'true' : 'false'); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    secs.forEach(function (s) { io.observe(s); });
  }

  // ---- mechanism stepper: scroll sets the step; buttons step it by hand ----
  function setupMech() {
    [].forEach.call(document.querySelectorAll('[data-mech],[data-steps]'), function (sec) {
      var lanes = [].slice.call(sec.querySelectorAll('.lane, .fig [data-i]'));
      var notes = [].slice.call(sec.querySelectorAll('.note, .step'));
      if (!lanes.length || !notes.length) return;
      var state = sec.querySelector('.ctl .state');
      var n = lanes.length;
      function set(i) {
        i = Math.max(0, Math.min(n - 1, i));
        sec.setAttribute('data-step', String(i));
        lanes.forEach(function (l, j) { l.classList.toggle('on', j === i); l.classList.toggle('done', j < i); });
        if (state) state.textContent = 'Step ' + (i + 1) + ' of ' + n;
      }
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) set(notes.indexOf(e.target)); });
      }, { rootMargin: '-45% 0px -45% 0px' });
      notes.forEach(function (x) { io.observe(x); });
      var prev = sec.querySelector('[data-act="prev"]'), next = sec.querySelector('[data-act="next"]');
      if (prev) prev.addEventListener('click', function () { tap(function () { set(Number(sec.getAttribute('data-step') || 0) - 1); }); });
      if (next) next.addEventListener('click', function () { tap(function () { set(Number(sec.getAttribute('data-step') || 0) + 1); }); });
      set(0);
    });
  }

  // ---- signature spine: a path down the left gutter sized to the viewport ----
  function setupSig() {
    var sig = document.getElementById('sig');
    if (!sig) return;
    function size() {
      var wrap = parseFloat(getComputedStyle(root).getPropertyValue('--wrap')) || 1180;
      var x = Math.max(14, (innerWidth - Math.min(wrap, innerWidth)) / 2 - 16), h = innerHeight;
      sig.style.setProperty('--sig-path', 'path("M ' + x + ' 70 C ' + (x + 38) + ' ' + (h * 0.3) + ', ' + (x - 30) + ' ' + (h * 0.62) + ', ' + x + ' ' + (h - 36) + '")');
    }
    size();
    addEventListener('resize', size, { passive: true });
  }

  function init() {
    setupReveals();
    setupSig();
    setupNav();
    setupMech();
    var sceneIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) visibleScenes.add(e.target); else visibleScenes.delete(e.target); });
    }, { rootMargin: '10% 0px 10% 0px' });
    registry.forEach(function (r) {
      var el = document.getElementById(r.id);
      if (!el) return;
      sceneIO.observe(el);
      try { r.fn(el, apiFor(el)); QA.scenes.push(r.id); } catch (e) { showErr(r.id + ': ' + e.message); }
    });
    // canvas / heavy extras only where they can't hurt: desktop, hover, motion allowed
    if (MOBILE || REDUCED) [].forEach.call(document.querySelectorAll('[data-extra="desktop"]'), function (x) { x.hidden = true; });
    setupCounts();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('visibilitychange', function () { root.classList.toggle('paused', document.hidden); });
    frame();
    QA.ready = true;
  }
  setTimeout(function () { if (!QA.ready) showErr('init did not finish'); }, 2600);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { try { init(); } catch (e) { showErr(e.message); } });
  else { try { init(); } catch (e) { showErr(e.message); } }
})();
