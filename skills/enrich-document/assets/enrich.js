/* enrich.js — runtime for the enrich-document skill.
 *
 * Self-contained, zero-dependency. Provides three things:
 *   1. Self-healing internal anchors  — internal links re-resolve to the closest
 *      matching heading at VIEW TIME (fuzzy + normalized + alias matching), so they
 *      survive heading drift, slug/casing differences, and renumbering even if the
 *      document is edited after it was generated. Unresolvable links are made visible,
 *      never silently dead.
 *   2. Claude prompt buttons — each .cl-claude-btn previews its exact prompt on hover/
 *      focus and copies it to the clipboard on click/Enter/Space.
 *   3. TOC scrollspy — highlights the current section in the table of contents.
 *
 * The normalize/slugify/fuzzy logic is intentionally kept in sync with
 * scripts/assemble_html.py so build-time and view-time resolution agree.
 */
(function () {
  "use strict";

  /* ---------------- shared text normalization ---------------- */
  function normalize(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip accents
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  function slugify(s) {
    return normalize(s).replace(/\s+/g, "-");
  }
  function toTokens(s) {
    var n = normalize(s);
    return n ? n.split(/\s+/) : [];
  }
  // "3.1 Foo", "Section 3 — Foo", "Step 2: Foo" -> "foo"
  function stripLeadingNumber(s) {
    return normalize(s)
      .replace(/^(section|chapter|part|appendix|step|fig|figure|table)\s+/, "")
      .replace(/^[0-9]+([.\-][0-9]+)*\s*/, "")
      .trim();
  }
  function dedupe(a) {
    var seen = {}, out = [];
    a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  /* ---------------- fuzzy similarity ---------------- */
  function levRatio(a, b) {
    a = a || ""; b = b || "";
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    var m = a.length, n = b.length, i, j;
    var prev = new Array(n + 1), cur = new Array(n + 1);
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return 1 - prev[n] / Math.max(m, n);
  }
  function jaccard(at, bt) {
    if (!at.length || !bt.length) return 0;
    var A = {}, inter = 0, union = {};
    at.forEach(function (t) { A[t] = 1; union[t] = 1; });
    bt.forEach(function (t) { if (A[t]) inter++; union[t] = 1; });
    return inter / Object.keys(union).length;
  }

  /* ---------------- heading index ---------------- */
  var autoId = 0;
  function ensureId(el) { if (!el.id) el.id = "cl-h-" + (++autoId); return el.id; }

  function buildIndex() {
    var heads = Array.prototype.slice.call(
      document.querySelectorAll("h1,h2,h3,h4,h5,h6,[data-anchor]")
    );
    return heads.map(function (h) {
      var id = h.id || h.getAttribute("data-anchor") || "";
      var text = (h.textContent || "").replace(/\s+/g, " ").trim();
      var aliases = (h.getAttribute("data-anchor-aliases") || "")
        .split(/[\s,]+/).filter(Boolean);
      var slugs = dedupe(
        [slugify(text), slugify(id), slugify(stripLeadingNumber(text))]
          .concat(aliases.map(slugify))
      );
      return { el: h, id: id, text: text, slug: slugify(text), slugs: slugs, tokens: toTokens(text) };
    });
  }

  // Returns a heading id (assigning one if needed), or null.
  function resolve(rawTarget, index) {
    if (!rawTarget) return null;
    var target = rawTarget;
    try { target = decodeURIComponent(rawTarget); } catch (e) {}

    var hit = document.getElementById(rawTarget) || document.getElementById(target);
    if (hit) return ensureId(hit);

    var tSlug = slugify(target);
    var tStrip = slugify(stripLeadingNumber(target));
    var tTok = toTokens(target);

    var best = null, bestScore = 0;
    for (var k = 0; k < index.length; k++) {
      var h = index[k];
      if (h.slugs.indexOf(tSlug) >= 0 || (tStrip && h.slugs.indexOf(tStrip) >= 0)) {
        return ensureId(h.el); // exact normalized / alias / de-numbered match
      }
      var slugScore = h.slugs.reduce(function (mx, s) { return Math.max(mx, levRatio(tSlug, s)); }, 0);
      var score = Math.max(jaccard(tTok, h.tokens), levRatio(tSlug, h.slug), slugScore);
      if (score > bestScore) { bestScore = score; best = h; }
    }
    return best && bestScore >= 0.5 ? ensureId(best.el) : null;
  }

  function healAnchors() {
    var index = buildIndex();
    var links = Array.prototype.slice.call(document.querySelectorAll('a[href^="#"]'));
    var healed = 0, dead = 0;
    links.forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href || href === "#") return;
      var target = href.slice(1);
      if (document.getElementById(target)) return; // already valid
      var id = resolve(target, index);
      if (id) {
        a.setAttribute("href", "#" + id);
        a.setAttribute("data-anchor-healed", target + " → " + id);
        a.title = "Link auto-resolved: #" + target + " → #" + id;
        healed++;
      } else {
        a.setAttribute("data-anchor-dead", target);
        a.title = "No matching section found for #" + target;
        dead++;
        if (window.console) console.warn("[enrich] unresolved internal link:", href);
      }
    });
    return { total: links.length, healed: healed, dead: dead };
  }

  // Deep-links arriving via location.hash also self-heal.
  function healHash() {
    var h = (location.hash || "").slice(1);
    if (!h || document.getElementById(h)) return;
    var id = resolve(h, buildIndex());
    var el = id && document.getElementById(id);
    if (el) el.scrollIntoView();
  }

  /* ---------------- Claude prompt buttons ---------------- */
  function getPrompts() {
    var node = document.getElementById("cl-prompts");
    if (!node) return {};
    try { return JSON.parse(node.textContent || "{}"); } catch (e) {
      if (window.console) console.warn("[enrich] could not parse #cl-prompts JSON");
      return {};
    }
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (res, rej) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        res();
      } catch (e) { rej(e); }
    });
  }

  var tip;
  function showTip(btn, text) {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "cl-tip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = "block";
    var r = btn.getBoundingClientRect();
    tip.style.left = Math.max(8, window.scrollX + r.left) + "px";
    tip.style.top = window.scrollY + r.bottom + 8 + "px";
  }
  function hideTip() { if (tip) tip.style.display = "none"; }

  function flash(btn, msg) {
    var label = btn.querySelector(".cl-claude-label");
    var prev = label ? label.textContent : null;
    if (label) label.textContent = msg;
    btn.classList.add("cl-copied");
    setTimeout(function () {
      if (label && prev != null) label.textContent = prev;
      btn.classList.remove("cl-copied");
    }, 1400);
  }

  function wireButtons() {
    var prompts = getPrompts();
    var btns = Array.prototype.slice.call(document.querySelectorAll(".cl-claude-btn"));
    btns.forEach(function (btn) {
      var id = btn.getAttribute("data-prompt-id");
      var inline = btn.getAttribute("data-prompt");
      var text = (id && prompts[id] != null) ? String(prompts[id]) : (inline || "");
      if (!btn.hasAttribute("tabindex")) btn.setAttribute("tabindex", "0");
      if (!btn.getAttribute("role")) btn.setAttribute("role", "button");
      if (!btn.getAttribute("aria-label")) btn.setAttribute("aria-label", "Preview on hover, click to copy Claude prompt");

      function preview() { if (text) showTip(btn, text); }
      function doCopy(e) {
        if (e) e.preventDefault();
        if (!text) return;
        copyText(text).then(
          function () { flash(btn, "Copied ✓"); },
          function () { flash(btn, "Copy failed"); }
        );
      }
      btn.addEventListener("mouseenter", preview);
      btn.addEventListener("focus", preview);
      btn.addEventListener("mouseleave", hideTip);
      btn.addEventListener("blur", hideTip);
      btn.addEventListener("click", doCopy);
      btn.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") doCopy(e);
        if (e.key === "Escape") hideTip();
      });
    });
  }

  /* ---------------- TOC scrollspy ---------------- */
  function scrollspy() {
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.cl-toc a[href^="#"]'));
    if (!tocLinks.length || !("IntersectionObserver" in window)) return;
    var map = {};
    tocLinks.forEach(function (a) {
      var id = (a.getAttribute("href") || "").slice(1);
      if (id) map[id] = a;
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var a = map[en.target.id];
        if (!a) return;
        tocLinks.forEach(function (x) { x.classList.remove("cl-active"); });
        a.classList.add("cl-active");
      });
    }, { rootMargin: "0px 0px -70% 0px", threshold: 0 });
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  /* ---------------- init ---------------- */
  function init() {
    var report = healAnchors();
    healHash();
    wireButtons();
    scrollspy();
    window.addEventListener("hashchange", healHash);
    if (window.console) {
      console.info("[enrich] internal links:", report.total, "| healed:", report.healed, "| dead:", report.dead);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
