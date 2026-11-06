/*
 * The browser preview library: a small, moving preview of every technique on the menu,
 * drawn with plain HTML, CSS and JS so it plays in any page with no build step.
 * Each preview imitates its Remotion component (remotion/families, remotion/examples).
 *
 * Works two ways (like menu.js):
 *   - in a browser, as <script src="previews.js"> (after menu.js), it sets
 *     window.KT_PREVIEWS and window.KT
 *   - in Node, require("./previews.js") returns { KT_PREVIEWS, KT }
 * Nothing here touches `document` or `window` until build/tick/fit is called.
 *
 * KT_PREVIEWS[id] = { build(line) -> html, tick(el, p, line), dark?, svg? }
 *   line   { text, key }: the sentence, and its key word (may be "" or not in the text)
 *   build  returns the preview's HTML; put it in a box with   box.innerHTML = build(line)
 *   tick   moves box `el` to time p, in seconds into a KT.LOOP (3.4 s) loop.
 *          p = KT.REST (2.3) shows the settled look: call it once after building,
 *          and again when a preview stops playing. Exits (menu `exit: true`) show the
 *          text gone near the end of the loop.
 *   dark   the preview needs a dark box (background KT.DARK)
 *   svg    the preview is an SVG that KT.fit sizes from its bounding box
 *   static (part of the interface, unused today) no moving preview: show the menu's `look` text instead
 *
 * The box: give it KT.BOX_CSS (position: relative, overflow: hidden, centred content)
 * plus a height and a font-size. The font-size is the biggest the text may be;
 * KT.fit(box) then shrinks it until the text fits (call it after the first tick,
 * when fonts load, and when the box changes size). Colours come from the CSS
 * variables --kt-ink, --kt-accent and --kt-marker, with the house defaults.
 *
 * Every class name the previews use starts with "kt-", so page CSS can't collide with them.
 *
 * Fonts: Poppins (with system fallbacks). Breathing and the cursor
 * preview move smoothly when 'Roboto Flex' (a variable font) is loaded, and step
 * through Poppins' weights otherwise. Chalk uses Caveat if loaded.
 */
(function (root) {
  "use strict";

  var LOOP = 3.4;
  var REST = 2.3;
  var DARK = "#16171D";
  var BOX_CSS = "position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;";

  var INK = "var(--kt-ink,#1E1E24)";
  var ACC = "var(--kt-accent,#F2643D)";
  var MARKER = "var(--kt-marker,#FFE14D)";
  var ACC_HEX = "#F2643D";
  var PAPER = "#F4EFE6";
  var BLUE = "#3D6CF2";
  var TEAL = "#2A9D8F";
  var YELLOW = "#F4B942";
  var FAINT = "#D9D2C3";
  var MUTED = "#8A8578";

  var FONT = "Poppins,'Segoe UI',system-ui,sans-serif";
  var MONO = "'Courier Prime','Courier New',Courier,monospace";
  var SERIF = "Georgia,'Times New Roman',serif";
  var HAND = "Caveat,'Segoe Print','Comic Sans MS',cursive";
  var FLEX = "'Roboto Flex',Poppins,'Segoe UI',system-ui,sans-serif";
  var HEAVY = "'Arial Black',Poppins,Arial,sans-serif";

  // ---------------------------------------------------------------- timing

  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function mix(p, a, b) { return a + (b - a) * p; }
  function eOut(x) { x = clamp(x); return 1 - Math.pow(1 - x, 4); }
  function eIn(x) { x = clamp(x); return x * x * x; }
  function eInOut(x) { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function back(x, c) { x = clamp(x); c = c == null ? 1.7 : c; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  function bounce(x) {
    x = clamp(x);
    var n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  }
  /** 0 → 1 between seconds a and b (eased). */
  function prog(t, a, b, e) {
    if (!(b > a)) return t >= a ? 1 : 0;
    var x = clamp((t - a) / (b - a));
    return e ? e(x) : x;
  }
  /** Springy 0 → 1 (overshoots) from `at`, lasting `dur`. */
  function pop(t, at, dur, c) { return prog(t, at, at + dur, function (x) { return back(x, c); }); }
  /** Start of item i of n, so that every item (lasting len) is done by `end`, at most `step` apart. */
  function stag(i, n, len, step, end) {
    if (n <= 1) return 0;
    return i * Math.min(step, Math.max(0, end - len) / (n - 1));
  }
  /** A repeatable random number in [0, 1). */
  function rnd(a, b) {
    var x = Math.sin((a || 0) * 12.9898 + (b || 0) * 78.233 + 1.2345) * 43758.5453;
    return x - Math.floor(x);
  }
  function fx(n, d) { return (+n).toFixed(d == null ? 3 : d); }

  // ---------------------------------------------------------------- text

  // Ruling R4/R4b: identical to keyMatch in remotion/layout.tsx.
  var PUNCTUATION = /[.,!?;:"'()“”‘’]/g;
  function bare(s) { return String(s).replace(PUNCTUATION, "").toLocaleLowerCase(); }
  /** True when `word` is the key word, ignoring punctuation and case. */
  function keyMatch(word, key) { return !!key && bare(key).length > 0 && bare(word) === bare(key); }

  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  /** The line's words and the index of the first key-word match (or -1). */
  function parse(line) {
    var text = line && line.text != null ? String(line.text) : "";
    var words = text.split(/\s+/).filter(function (w) { return w.length > 0; });
    var key = line ? line.key : "";
    var k = -1;
    for (var i = 0; i < words.length; i++) if (keyMatch(words[i], key)) { k = i; break; }
    return { text: words.join(" "), words: words, k: k, chars: Array.from(words.join(" ")).length };
  }

  /**
   * The words as spans (class "kt-w"; the first key-word match also has data-key and the
   * accent colour). Options:
   *   letters  wrap each letter in a span (class "kt-c", data-i = its index in the line)
   *   cstyle   (ch, gi, isKey) -> extra style for a letter
   *   inner    (word, i, isKey, firstLetterIndex) -> the word's inner HTML
   *   wstyle   (word, i, isKey) -> extra style for the word
   *   noColor  don't colour the key word
   */
  function wordsHTML(P, o) {
    o = o || {};
    var gi = 0;
    return P.words.map(function (w, i) {
      var key = i === P.k;
      var chars = Array.from(w);
      var inner;
      if (o.inner) inner = o.inner(w, i, key, gi);
      else if (o.letters) {
        inner = chars.map(function (ch, j) {
          return '<span class="kt-c" data-i="' + (gi + j) + '" style="display:inline-block;' + (o.cstyle ? o.cstyle(ch, gi + j, key) : "") + '">' + esc(ch) + "</span>";
        }).join("");
      } else inner = esc(w);
      gi += chars.length;
      var color = key && !o.noColor ? "color:" + (o.keyColor || ACC) + ";" : "";
      return '<span class="kt-w"' + (key ? " data-key" : "") + ' style="display:inline-block;white-space:nowrap;' + color + (o.wstyle ? o.wstyle(w, i, key) : "") + '">' + inner + "</span>";
    }).join("");
  }

  var BASE = "font-family:" + FONT + ";font-weight:800;line-height:1.2;color:" + INK + ";text-align:center;";
  var LINE = "display:flex;flex-wrap:wrap;justify-content:center;align-items:baseline;column-gap:.28em;";

  /** The root element KT.fit sizes. */
  function fitRoot(P, inner, style) {
    return '<div class="kt-fit" role="img" aria-label="' + esc(P.text) + '" style="position:relative;' + BASE + (style || "") + '">' + inner + "</div>";
  }
  /** A root that fills the box (scenes that lay themselves out). */
  function sceneRoot(P, inner, style) {
    return '<div class="kt-scene" role="img" aria-label="' + esc(P.text) + '" style="position:absolute;inset:0;overflow:hidden;' + BASE + (style || "") + '">' + inner + "</div>";
  }
  /** Records an SVG filter's url on the root (data-filter), for tick to switch on and off. */
  function withFilter(html, id) { return html.replace('class="kt-fit"', 'class="kt-fit" data-filter="url(#' + id + ')"'); }
  /** A copy of the line laid over the first one. */
  function layer(cls, inner, style) {
    return '<div class="kt-' + cls + '" style="' + LINE + "position:absolute;inset:0;" + (style || "") + '">' + inner + "</div>";
  }
  /** A canvas covering the box. */
  var CANVAS = '<canvas class="kt-cv" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>';

  var uidN = 0;
  function uid(p) { uidN += 1; return "kt" + p + uidN; }

  /** Splits words into at most n groups of similar length (in characters). */
  function chunks(words, n) {
    n = Math.max(1, Math.min(n, words.length));
    var total = words.reduce(function (a, w) { return a + w.length + 1; }, 0);
    var out = [], cur = [], acc = 0;
    words.forEach(function (w, i) {
      cur.push(w);
      acc += w.length + 1;
      var left = words.length - i - 1;
      if (out.length < n - 1 && (acc >= (total * (out.length + 1)) / n || left === n - 1 - out.length)) {
        out.push(cur);
        cur = [];
      }
    });
    if (cur.length) out.push(cur);
    return out;
  }
  /** The key word without its punctuation, else the longest word. */
  function headWord(P) {
    var w = P.k >= 0 ? P.words[P.k] : P.words.slice().sort(function (a, b) { return b.length - a.length; })[0] || "";
    var t = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}²³]+$/gu, "");
    return t || w;
  }

  // ---------------------------------------------------------------- DOM helpers (only called from tick/fit)

  /** Per-box cache of queried elements and measurements; reset when the box gets new content. */
  function mem(el) {
    var r = el.firstElementChild;
    var c = el.__kt;
    if (!c || c.r !== r) c = el.__kt = { r: r, q: {}, m: {}, s: {} };
    return c;
  }
  function all(el, sel) {
    var c = mem(el);
    return c.q[sel] || (c.q[sel] = Array.prototype.slice.call(el.querySelectorAll(sel)));
  }
  function one(el, sel) { return all(el, sel)[0] || null; }
  function rootOf(el) { return one(el, ".kt-fit") || one(el, ".kt-scene") || el.firstElementChild || el; }
  function sizeKey(el) {
    var r = rootOf(el);
    var f = typeof document !== "undefined" && document.fonts ? document.fonts.status : "";
    return el.clientWidth + "x" + el.clientHeight + "|" + r.offsetWidth + "x" + r.offsetHeight + "|" + r.style.fontSize + "|" + f;
  }
  /** fn(), cached until the box or its text changes size. */
  function measured(el, name, fn) {
    var c = mem(el);
    var k = sizeKey(el);
    var m = c.m[name];
    if (m && m.k === k) return m.v;
    var v = fn();
    c.m[name] = { k: k, v: v };
    return v;
  }
  /** Position of `node` inside `top` (layout position: transforms are ignored). */
  function offsetIn(node, top) {
    var x = 0, y = 0, n = node;
    while (n && n !== top) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    if (n !== top) {
      var a = node.getBoundingClientRect(), b = top.getBoundingClientRect();
      return { x: a.left - b.left, y: a.top - b.top, w: node.offsetWidth, h: node.offsetHeight };
    }
    return { x: x, y: y, w: node.offsetWidth, h: node.offsetHeight };
  }
  function fsOf(el) {
    return measured(el, "fs", function () { return parseFloat(getComputedStyle(rootOf(el)).fontSize) || 16; });
  }
  function cssVar(el, name, fallback) {
    var c = mem(el);
    if (!(name in c.s)) c.s[name] = (getComputedStyle(el).getPropertyValue(name) || "").trim() || fallback;
    return c.s[name];
  }
  /** Word boxes inside the root: { x, y, w, h, cx, cy, key }. */
  function wordBoxes(el, sel) {
    var r = rootOf(el);
    return measured(el, "wb" + (sel || ""), function () {
      return all(el, sel || ".kt-fit > .kt-w").map(function (w) {
        var o = offsetIn(w, r);
        o.cx = o.x + o.w / 2;
        o.cy = o.y + o.h / 2;
        o.key = w.hasAttribute("data-key");
        return o;
      });
    });
  }
  /** Letter centres inside the root. */
  function letterBoxes(el, sel) {
    var r = rootOf(el);
    return measured(el, "lb" + (sel || ""), function () {
      return all(el, sel || ".kt-fit .kt-c").map(function (c) {
        var o = offsetIn(c, r);
        o.cx = o.x + o.w / 2;
        o.cy = o.y + o.h / 2;
        return o;
      });
    });
  }
  /** Which wrapped line each word is on. */
  function lineIndex(el, words) {
    return measured(el, "lines", function () {
      var tops = [];
      var idx = words.map(function (w) {
        var t = Math.round(w.offsetTop);
        var j = tops.findIndex(function (u) { return Math.abs(u - t) < 3; });
        if (j < 0) { tops.push(t); j = tops.length - 1; }
        return j;
      });
      var order = tops.map(function (t, i) { return i; }).sort(function (a, b) { return tops[a] - tops[b]; });
      var rank = [];
      order.forEach(function (o, i) { rank[o] = i; });
      return { of: idx.map(function (j) { return rank[j]; }), n: tops.length };
    });
  }
  /** Gives each word span its own slice of one background spread over the whole root. */
  function spreadBackground(el, sel) {
    var r = rootOf(el);
    var spans = all(el, sel);
    measured(el, "bg" + sel, function () {
      var W = r.offsetWidth, H = r.offsetHeight;
      spans.forEach(function (s) {
        var o = offsetIn(s, r);
        s.style.backgroundSize = W + "px " + H + "px";
        s.style.backgroundPosition = -o.x + "px " + -o.y + "px";
      });
      return true;
    });
    return spans;
  }
  /** The box-sized canvas, cleared, with the root's offset in the box. */
  function canvas(el) {
    var cv = one(el, "canvas.kt-cv");
    if (!cv) return null;
    var w = el.clientWidth, h = el.clientHeight;
    var d = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) {
      cv.width = Math.round(w * d);
      cv.height = Math.round(h * d);
    }
    var ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var r = rootOf(el);
    var o = measured(el, "rootpos", function () { return offsetIn(r, el); });
    return { ctx: ctx, w: w, h: h, x: o.x, y: o.y };
  }
  /**
   * Draws the words on a hidden canvas and measures the ink in a grid of cw × ch cells
   * (in root px). Cached per size, so it runs once per layout, not every frame.
   */
  function inkGrid(el, cw, ch) {
    var r = rootOf(el);
    return measured(el, "ink" + fx(cw, 2) + "x" + fx(ch, 2), function () {
      var W = Math.max(1, Math.ceil(r.offsetWidth)), H = Math.max(1, Math.ceil(r.offsetHeight));
      var cols = Math.max(1, Math.floor(W / cw)), rows = Math.max(1, Math.floor(H / ch));
      var g = { cols: cols, rows: rows, cw: cw, ch: ch, ink: new Float32Array(cols * rows), key: new Uint8Array(cols * rows) };
      var cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      var ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) return g;
      ctx.textBaseline = "alphabetic";
      all(el, ".kt-fit > .kt-w").forEach(function (s) {
        var cs = getComputedStyle(s);
        ctx.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
        if ("letterSpacing" in ctx) ctx.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
        var o = offsetIn(s, r);
        var t = s.textContent;
        var m = ctx.measureText(t);
        var fsz = parseFloat(cs.fontSize);
        var A = m.fontBoundingBoxAscent || fsz * 0.95, D = m.fontBoundingBoxDescent || fsz * 0.25;
        ctx.fillStyle = s.hasAttribute("data-key") ? "#00ff00" : "#ff0000";
        ctx.fillText(t, o.x, o.y + (o.h - (A + D)) / 2 + A);
      });
      var data = ctx.getImageData(0, 0, W, H).data;
      var step = Math.max(1, Math.floor(Math.min(cw, ch) / 4));
      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < cols; col++) {
          var ink = 0, key = 0, n = 0;
          for (var y = Math.floor(row * ch); y < (row + 1) * ch && y < H; y += step) {
            for (var x = Math.floor(col * cw); x < (col + 1) * cw && x < W; x += step) {
              var i = (y * W + x) * 4;
              ink += data[i + 3];
              key += data[i + 1] > data[i] ? data[i + 3] : 0;
              n++;
            }
          }
          var j = row * cols + col;
          g.ink[j] = n ? ink / (n * 255) : 0;
          g.key[j] = key > ink / 2 ? 1 : 0;
        }
      }
      return g;
    });
  }
  /** A cell size (in px) giving at most about `budget` cells over the root. */
  function cellFor(el, budget, wanted) {
    var r = rootOf(el);
    var area = Math.max(1, r.offsetWidth * r.offsetHeight);
    return Math.max(wanted, Math.sqrt(area / budget), 1.5);
  }
  /** The ink cells that are mostly ink: [{ x, y, key }] (cell top-left, root px). */
  function grains(el, budget) {
    var cell = cellFor(el, budget * 3, fsOf(el) / 12);
    var g = inkGrid(el, cell, cell);
    return measured(el, "grains" + budget, function () {
      var out = [];
      for (var i = 0; i < g.ink.length; i++) {
        if (g.ink[i] >= 0.5) out.push({ x: (i % g.cols) * cell, y: Math.floor(i / g.cols) * cell, key: g.key[i] === 1, i: out.length });
      }
      return { cell: cell, list: out };
    });
  }
  function setAll(list, prop, value) { for (var i = 0; i < list.length; i++) list[i].style[prop] = value; }

  // ---------------------------------------------------------------- fit

  /**
   * Shrinks the preview's text until it fits its box (binary search on the root's
   * font-size, starting from the box's own font-size). SVG previews get a viewBox
   * around their content instead.
   */
  function fit(box) {
    if (!box || !box.querySelectorAll) return;
    Array.prototype.forEach.call(box.querySelectorAll("svg[data-kt-bbox]"), function (svg) {
      var g = svg.querySelector("[data-kt-content]") || svg;
      try {
        var b = g.getBBox();
        if (b.width > 0 && b.height > 0) {
          var pad = Math.max(b.width, b.height) * 0.03;
          svg.setAttribute("viewBox", fx(b.x - pad, 1) + " " + fx(b.y - pad, 1) + " " + fx(b.width + 2 * pad, 1) + " " + fx(b.height + 2 * pad, 1));
        }
      } catch (e) { /* not rendered yet */ }
    });
    var r = box.querySelector(".kt-fit");
    if (!r) return;
    r.style.fontSize = "";
    var cs = getComputedStyle(box);
    var availW = box.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    var availH = box.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
    if (availW <= 0 || availH <= 0) return;
    // A preview whose moving copies would inflate its scroll size marks the part to measure.
    var m = r.querySelector("[data-kt-measure]") || r;
    var max = parseFloat(getComputedStyle(r).fontSize) || 16;
    var fits = function (size) {
      r.style.fontSize = size + "px";
      return Math.max(m.scrollWidth, r.offsetWidth) <= availW + 0.5 && Math.max(m.scrollHeight, r.offsetHeight) <= availH + 0.5;
    };
    if (fits(max)) { r.style.fontSize = ""; return; }
    var lo = 5, hi = max;
    for (var i = 0; i < 8; i++) {
      var mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    r.style.fontSize = Math.floor(lo * 4) / 4 + "px";
  }

  // ================================================================ the previews

  var T0 = 0.1; // every preview waits this long before it starts
  var EXIT = [2.4, 3.15]; // when exits break the text up

  var P_ = {};

  // ---------------------------------------------------------------- 0 · The basics

  // Whole words slide, pop, drop, rise; the key word spins in.
  var MOVES = [
    { len: 0.45, e: eOut, f: function (q) { return { o: q, t: "translateX(" + fx(mix(q, -4, 0)) + "em)" }; } },
    { len: 0.45, e: function (x) { return back(x, 2.2); }, f: function (q) { return { o: Math.min(1, q * 3), t: "scale(" + fx(Math.max(0, q)) + ")" }; } },
    { len: 0.55, e: bounce, f: function (q, x) { return { o: Math.min(1, x * 4), t: "translateY(" + fx(mix(q, -3, 0)) + "em)" }; } },
    { len: 0.45, e: eOut, f: function (q) { return { o: q, t: "translateX(" + fx(mix(q, 4, 0)) + "em)" }; } },
    { len: 0.45, e: function (x) { return back(x, 1.6); }, f: function (q) { return { o: Math.min(1, q * 2), t: "translateY(" + fx(mix(q, 1.4, 0)) + "em) rotate(" + fx(mix(q, -14, 0)) + "deg)" }; } },
  ];
  P_["motion-typography"] = {
    build: function (line) { var P = parse(line); return fitRoot(P, wordsHTML(P), LINE); },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length;
      ws.forEach(function (w, i) {
        var a = T0 + stag(i, n, 0.55, 0.12, 1.3);
        var x = prog(p, a, a + 0.55);
        var s;
        if (w.hasAttribute("data-key")) {
          var q = back(x, 1.6);
          s = { o: Math.min(1, q * 2), t: "rotate(" + fx(mix(q, -200, 0)) + "deg) scale(" + fx(mix(q, 0.2, 1)) + ")" };
        } else {
          var m = MOVES[i % MOVES.length];
          var xm = prog(p, a, a + m.len);
          s = m.f(m.e(xm), xm);
        }
        w.style.opacity = p < a ? 0 : s.o;
        w.style.transform = s.t;
      });
    },
  };

  // Each word condenses out of a liquid blob (blur under a hard alpha edge), then wobbles like elastic.
  P_["fluid-typography"] = {
    build: function (line) {
      var P = parse(line), id = uid("goo");
      return '<svg width="0" height="0" style="position:absolute"><filter id="' + id + '"><feColorMatrix class="kt-goo" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 255 -140"/></filter></svg>' +
        withFilter(fitRoot(P, wordsHTML(P, { letters: true, cstyle: function () { return "transform-origin:50% 90%;"; } }), LINE + "font-weight:900;"), id);
    },
    tick: function (el, p) {
      var r = rootOf(el), goo = one(el, ".kt-goo");
      var soft = prog(p, 0.8, 1.25, eInOut);
      if (goo) goo.setAttribute("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 " + fx(mix(soft, 255, 1), 2) + " " + fx(mix(soft, -140, 0), 2));
      r.style.filter = p < 1.25 ? r.getAttribute("data-filter") : "none";
      var ws = all(el, ".kt-w"), n = ws.length;
      ws.forEach(function (w, i) {
        var a = T0 + stag(i, n, 0.7, 0.06, 0.95);
        var c = prog(p, a, a + 0.7, eInOut);
        var blur = mix(c, 0.35, 0);
        w.style.filter = blur > 0.003 ? "blur(" + fx(blur) + "em)" : "none";
        w.style.opacity = p < a ? 0 : 1;
        var key = w.hasAttribute("data-key");
        Array.prototype.forEach.call(w.children, function (ch, j) {
          var q = prog(p, a + 0.3 + j * 0.015, 1.3);
          var amt = (key ? 0.55 : 0.35) * Math.sin(q * Math.PI * 3) * Math.exp(-q * 3);
          ch.style.transform = "scale(" + fx(1 - amt * 0.35) + "," + fx(1 + amt) + ")";
        });
      });
    },
  };

  // Each word pops on in turn; the key word lands bigger, in the accent colour.
  P_["word-by-word-reveal"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, { wstyle: function (w, i, key) { return key ? "font-size:1.35em;" : ""; } }), LINE);
    },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length;
      ws.forEach(function (w, i) {
        var a = T0 + stag(i, n, 0.4, 0.14, 1.2);
        var key = w.hasAttribute("data-key");
        var q = key ? pop(p, a, 0.4, 3) : pop(p, a, 0.3, 1.6);
        w.style.opacity = p < a ? 0 : 1;
        w.style.transform = "translateY(" + fx(mix(q, 0.3, 0)) + "em) scale(" + fx(q) + ")";
      });
    },
  };

  // Camera-move typography (example): phrases wind round a loop on a big canvas; a camera flies
  // from one to the next, turning with them, then pulls back to show the whole layout.
  P_["camera-move-typography"] = {
    build: function (line) {
      var P = parse(line);
      var groups = P.words.length <= 4 ? P.words.map(function (w) { return [w]; }) : chunks(P.words, 4);
      var gi = 0;
      var phrases = groups.map(function (g) {
        var html = g.map(function (w) {
          var i = gi++;
          return i === P.k ? '<span data-key style="color:' + ACC + '">' + esc(w) + "</span>" : esc(w);
        }).join(" ");
        return '<span class="kt-ph" style="position:absolute;left:0;top:0;white-space:nowrap;transform-origin:0 50%;line-height:1.2">' + html + "</span>";
      }).join("");
      return sceneRoot(P, '<div class="kt-cam" style="position:absolute;left:50%;top:50%;transform-origin:0 0">' + phrases + "</div>");
    },
    tick: function (el, p) {
      var cam = one(el, ".kt-cam");
      var ph = all(el, ".kt-ph");
      if (!cam || ph.length === 0) return;
      var W = el.clientWidth, H = el.clientHeight;
      var lay = measured(el, "cam", function () {
        var x = 0, y = 0, ang = 0, gap = fsOf(el) * 0.35;
        var keys = [], pts = [];
        var out = ph.map(function (s) {
          var w = s.offsetWidth, h = s.offsetHeight;
          var c = Math.cos((ang * Math.PI) / 180), sn = Math.sin((ang * Math.PI) / 180);
          var o = { x: x, y: y, a: ang, w: w, h: h };
          keys.push({ x: x + (w / 2) * c, y: y + (w / 2) * sn, a: ang, z: Math.min(1.6, (0.86 * W) / Math.max(1, w), (0.7 * H) / Math.max(1, h)) });
          pts.push([x, y], [x + w * c, y + w * sn]);
          x += (w + gap) * c;
          y += (w + gap) * sn;
          ang += 90;
          return o;
        });
        var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
        var hh = Math.max.apply(null, out.map(function (o) { return o.h; }));
        var bx0 = Math.min.apply(null, xs) - hh, bx1 = Math.max.apply(null, xs) + hh;
        var by0 = Math.min.apply(null, ys) - hh, by1 = Math.max.apply(null, ys) + hh;
        keys.push({ x: (bx0 + bx1) / 2, y: (by0 + by1) / 2, a: 90 * Math.ceil((ph.length - 1) / 4) * 4, z: Math.min(1, (0.92 * W) / (bx1 - bx0), (0.92 * H) / (by1 - by0)) });
        if (ph.length === 1) keys[1].a = 0;
        return { ph: out, keys: keys };
      });
      lay.ph.forEach(function (o, i) {
        ph[i].style.transform = "translate(" + fx(o.x, 2) + "px," + fx(o.y - o.h / 2, 2) + "px) rotate(" + o.a + "deg)";
      });
      // Camera: hold each phrase in turn, then pull back.
      var n = ph.length, seg = 1.5 / n;
      var k = lay.keys, cur;
      if (p < T0) cur = k[0];
      else {
        var i = Math.min(n, Math.floor((p - T0) / seg));
        var a = i < n ? T0 + i * seg : 1.6;
        var from = k[Math.max(0, i - 1)], to = k[Math.min(i, k.length - 1)];
        var q = i === 0 ? 1 : i < n ? prog(p, a, a + seg * 0.45, eInOut) : prog(p, 1.6, 2.1, eInOut);
        cur = { x: mix(q, from.x, to.x), y: mix(q, from.y, to.y), a: mix(q, from.a, to.a), z: Math.exp(mix(q, Math.log(from.z), Math.log(to.z))) };
      }
      cam.style.transform = "scale(" + fx(cur.z) + ") rotate(" + fx(-cur.a, 2) + "deg) translate(" + fx(-cur.x, 2) + "px," + fx(-cur.y, 2) + "px)";
      cam.style.opacity = prog(p, T0 - 0.05, T0 + 0.1);
    },
  };

  // The line arrives, then the key word grows bigger, bolder and coloured (with a little shake)
  // while the others get quieter. The enlarged size is reserved from the start, so it never crowds.
  var EMPH = 1.6;
  P_["emphasis-scaling"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        noColor: true,
        wstyle: function (w, i, key) { return key ? "position:relative;font-size:" + EMPH + "em;font-weight:900;" : ""; },
        inner: function (w, i, key) {
          return key ? '<span style="visibility:hidden">' + esc(w) + '</span><span class="kt-big" style="position:absolute;left:0;right:0;bottom:0;white-space:nowrap;transform-origin:50% 85%">' + esc(w) + "</span>" : esc(w);
        },
      }), LINE);
    },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length, big = one(el, ".kt-big");
      var e = big ? prog(p, 0.5, 0.9, function (x) { return back(x, 1.8); }) : 0;
      var quiet = clamp(e);
      var shake = p > 0.9 && p < 1.2 ? Math.sin(p * 140) * 0.04 * (1 - prog(p, 0.9, 1.2)) : 0;
      ws.forEach(function (w, i) {
        var a = T0 + stag(i, n, 0.25, 0.06, 0.45);
        var k = prog(p, a, a + 0.25, eOut);
        var key = w.hasAttribute("data-key");
        w.style.opacity = k * (key ? 1 : mix(quiet, 1, 0.75));
        w.style.transform = "translateY(" + fx(mix(k, 0.2, 0)) + "em)" + (key ? "" : " scale(" + fx(mix(quiet, 1, 0.92)) + ")");
      });
      if (big) {
        big.style.transform = "translateX(" + fx(shake) + "em) scale(" + fx(mix(e, 1, EMPH) / EMPH) + ")";
        big.style.color = e > 0.3 ? ACC : INK;
        big.style.fontWeight = e > 0.5 ? 900 : 800;
      }
    },
  };

  // The line rises in, then a highlighter bar sweeps in behind the key word.
  P_["marker-highlight"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        noColor: true,
        wstyle: function (w, i, key) { return key ? "position:relative;" : ""; },
        inner: function (w, i, key) {
          return key ? '<span class="kt-bar" style="position:absolute;left:-.1em;right:-.1em;top:42%;bottom:.04em;border-radius:.08em;background:' + MARKER + ';transform-origin:0 50%"></span><span style="position:relative">' + esc(w) + "</span>" : esc(w);
        },
      }), LINE);
    },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length;
      ws.forEach(function (w, i) {
        var a = T0 + stag(i, n, 0.3, 0.06, 0.5);
        var k = prog(p, a, a + 0.3, eOut);
        w.style.opacity = k;
        w.style.transform = "translateY(" + fx(mix(k, 0.25, 0)) + "em)";
      });
      var bar = one(el, ".kt-bar");
      if (bar) bar.style.transform = "rotate(-1deg) scaleX(" + fx(prog(p, 0.6, 1.1, eInOut)) + ")";
    },
  };

  // Words drop from above with real gravity, bouncing smaller each time; the key word squashes and shakes the line.
  var RESTITUTION = 0.4;
  var FALL_SHARE = 1 / (1 + (2 * RESTITUTION) / (1 - RESTITUTION));
  function dropHeight(q) {
    if (q <= 0) return 1;
    var g = 2 / (FALL_SHARE * FALL_SHARE);
    if (q < FALL_SHARE) return 1 - 0.5 * g * q * q;
    var v = g * FALL_SHARE * RESTITUTION, rest = q - FALL_SHARE;
    while (v > 0.02) {
      var d = (2 * v) / g;
      if (rest < d) return v * rest - 0.5 * g * rest * rest;
      rest -= d;
      v *= RESTITUTION;
    }
    return 0;
  }
  P_["physics-based"] = {
    build: function (line) { var P = parse(line); return fitRoot(P, wordsHTML(P, { wstyle: function () { return "transform-origin:50% 100%;"; } }), LINE); },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length, r = rootOf(el), fs = fsOf(el);
      var SPAN = 0.75;
      var tops = measured(el, "drop", function () {
        var ro = offsetIn(r, el).y;
        return ws.map(function (w) { return ro + w.offsetTop + fs * 1.5; });
      });
      var shake = 0;
      ws.forEach(function (w, i) {
        var a = T0 + stag(i, n, SPAN, 0.15, 1.5);
        var q = (p - a) / SPAN;
        var key = w.hasAttribute("data-key");
        var air = prog(q, 0, FALL_SHARE);
        var s = q - FALL_SHARE;
        var squash = s > 0 ? Math.exp(-s * 9) * Math.cos(s * 28) * (1 - prog(q, 0.85, 1)) : 0;
        var k = key ? 1 : 0.4;
        var spin = (rnd(i, 3) * 2 - 1) * 90, tilt = (rnd(i, 4) * 2 - 1) * 3;
        w.style.opacity = q < 0 ? 0 : 1;
        w.style.transform = "translateY(" + fx(-dropHeight(q) * tops[i], 1) + "px) rotate(" + fx(mix(air, spin, tilt), 2) + "deg) scale(" + fx(1 + squash * 0.15 * k) + "," + fx(1 - squash * 0.2 * k) + ")";
        if (key && s > 0 && s * SPAN < 0.2) shake = Math.sin(s * SPAN * 160) * 0.05 * (1 - (s * SPAN) / 0.2);
      });
      r.style.transform = shake ? "translate(" + fx(shake * 0.6) + "em," + fx(shake) + "em)" : "";
    },
  };

  // Letters appear one at a time (a short pause after punctuation) with a blinking block cursor.
  var PAUSE = { ",": 3, ".": 4, "!": 4, "?": 4, ";": 3, ":": 3 };
  P_.typewriter = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, { inner: function (w) { return Array.from(w).map(function (ch) { return '<span class="kt-c">' + esc(ch) + "</span>"; }).join(""); } }) +
        '<span class="kt-cur" style="display:inline-block;position:relative;width:0;height:0"><span style="position:absolute;left:.06em;bottom:-.2em;width:.55em;height:1em;background:' + ACC + '"></span></span>', LINE + "font-family:" + MONO + ";font-weight:700;line-height:1.3;");
    },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), cur = one(el, ".kt-cur");
      var c = mem(el);
      if (!c.cost) {
        c.cost = [];
        all(el, ".kt-w").forEach(function (w, wi) {
          Array.prototype.forEach.call(w.children, function (l, j) { c.cost.push((PAUSE[l.textContent] || 1) + (wi > 0 && j === 0 ? 1 : 0)); });
        });
      }
      var total = c.cost.reduce(function (a, b) { return a + b; }, 0);
      var budget = prog(p, T0, 1.5) * total, shown = 0;
      for (var i = 0; i < c.cost.length; i++) { if (budget < c.cost[i]) break; budget -= c.cost[i]; shown++; }
      cs.forEach(function (l, i) { l.style.visibility = i < shown ? "visible" : "hidden"; });
      if (cur) {
        if (c.curAt !== shown) {
          c.curAt = shown;
          if (shown === 0 && cs[0]) cs[0].parentNode.insertBefore(cur, cs[0]);
          else if (cs[shown - 1]) cs[shown - 1].after(cur);
        }
        cur.style.opacity = shown >= cs.length ? Math.floor(p * 2) % 2 === 0 ? 1 : 0 : 1;
      }
    },
  };

  // Text-as-image (example): the key word fills a right-angled triangle, row by row,
  // and the line runs along the hypotenuse; the camera zooms in to show it's all words.
  P_["text-as-image"] = {
    build: function (line) {
      var P = parse(line), id = uid("tri");
      var word = esc(headWord(P) || "type");
      var reps = Math.max(3, Math.ceil(200 / (Math.max(2, Array.from(headWord(P)).length + 1) * 6)) + 1);
      var rowText = new Array(reps).fill(word).join(" ");
      var rows = "";
      for (var i = 0; i < 13; i++) rows += '<text class="kt-row" x="56" y="' + (30 + i * 10.8) + '" font-size="10" style="fill:' + BLUE + '">' + rowText + "</text>";
      var len = Math.hypot(180, 140);
      var fs = Math.min(14, (len * 0.95) / (Math.max(1, P.chars) * 0.6));
      return sceneRoot(P,
        '<svg viewBox="0 0 300 180" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block"><defs><clipPath id="' + id + 'c"><path d="M60 20 L60 160 L240 160 Z"/></clipPath><path id="' + id + 'p" d="M60 20 L240 160"/></defs>' +
        '<g class="kt-zoom" style="transform-origin:120px 110px"><g clip-path="url(#' + id + 'c)">' + rows + "</g>" +
        '<path d="M60 150 L70 150 L70 160" fill="none" style="stroke:' + INK + '" stroke-width="1.2"/>' +
        '<text class="kt-edge" font-size="' + fx(fs, 2) + '" style="fill:' + ACC + '" dy="-2"><textPath href="#' + id + 'p" startOffset="50%" text-anchor="middle">' + esc(P.text) + "</textPath></text></g></svg>", "font-weight:900;");
    },
    tick: function (el, p) {
      all(el, ".kt-row").forEach(function (r, i) {
        var a = T0 + i * 0.07;
        var q = prog(p, a, a + 0.5, eOut);
        r.setAttribute("transform", "translate(" + fx((1 - q) * (i % 2 ? 200 : -200), 1) + " 0)");
      });
      var edge = one(el, ".kt-edge");
      if (edge) edge.style.opacity = prog(p, 1.0, 1.3);
      var z = one(el, ".kt-zoom");
      if (z) z.style.transform = "scale(" + fx(1 + 2.2 * Math.sin(Math.PI * prog(p, 1.4, 2.15, eInOut))) + ")";
    },
  };

  // Burst of digital failure: red/cyan copies split apart, slices jump, blocks flash; then it calms to a faint fringe.
  var GLITCH_SLICES = 6;
  P_.glitch = {
    build: function (line) {
      var P = parse(line), plain = wordsHTML(P), inner = '<div class="kt-base" data-kt-measure style="' + LINE + 'visibility:hidden">' + plain + "</div>";
      inner += layer("red", wordsHTML(P, { noColor: true }), "color:#FF2A4D;opacity:.85;");
      inner += layer("cyan", wordsHTML(P, { noColor: true }), "color:#00E5FF;opacity:.85;");
      for (var i = 0; i < GLITCH_SLICES; i++) {
        var top = i === 0 ? -50 : (i * 100) / GLITCH_SLICES, bottom = i === GLITCH_SLICES - 1 ? -50 : 100 - ((i + 1) * 100) / GLITCH_SLICES;
        inner += layer("sl", plain, "clip-path:inset(" + fx(top, 2) + "% -20% " + fx(bottom, 2) + "% -20%);");
      }
      for (var b = 0; b < 6; b++) inner += '<div class="kt-blk" style="position:absolute;opacity:.8;background:' + ["#FF2A4D", "#00E5FF", INK][b % 3] + '"></div>';
      return fitRoot(P, inner, "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el);
      var g = p < 0.75 ? 1 : 1 - prog(p, 0.75, 1.3, eIn);
      var f = Math.floor(p * 30);
      var R = function (k) { return rnd(k, f) * 2 - 1; };
      var flicker = g > 0.3 && rnd(99, f) < 0.25 ? 0.35 : 1;
      r.style.opacity = prog(p, T0, T0 + 0.1) * flicker;
      var split = 0.02 + g * 0.18;
      var red = one(el, ".kt-red"), cyan = one(el, ".kt-cyan");
      if (red) red.style.transform = "translate(" + fx(-split + R(1) * g * 0.1) + "em," + fx(R(2) * g * 0.04) + "em)";
      if (cyan) cyan.style.transform = "translate(" + fx(split + R(3) * g * 0.1) + "em," + fx(R(4) * g * 0.04) + "em)";
      all(el, ".kt-sl").forEach(function (s, i) { s.style.transform = rnd(10 + i, f) < g * 0.7 ? "translateX(" + fx(R(20 + i) * g * 0.8) + "em)" : ""; });
      all(el, ".kt-blk").forEach(function (b, i) {
        b.style.display = g > 0.6 ? "block" : "none";
        if (g > 0.6) {
          b.style.left = fx(5 + rnd(30 + i, f) * 75, 1) + "%";
          b.style.top = fx(rnd(40 + i, f) * 100, 1) + "%";
          b.style.width = fx(3 + rnd(50 + i, f) * 20, 1) + "%";
          b.style.height = fx(0.03 + rnd(60 + i, f) * 0.12) + "em";
        }
      });
    },
  };

  // Each wrapped line rises from behind its own invisible edge, one line after the other.
  P_["masking-and-reveals"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        wstyle: function () { return "overflow:hidden;padding:.04em .1em .1em;margin:0 -.1em;"; },
        inner: function (w) { return '<span class="kt-in" style="display:inline-block">' + esc(w) + "</span>"; },
      }), LINE + "align-items:flex-end;");
    },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), ins = all(el, ".kt-in");
      var L = lineIndex(el, ws);
      ins.forEach(function (s, i) {
        var a = T0 + stag(L.of[i], L.n, 0.65, 0.15, 1.2);
        s.style.transform = "translateY(" + fx(mix(prog(p, a, a + 0.65, eOut), 115, 0), 2) + "%)";
      });
    },
  };

  // A solid block of text (thin copies stacked behind, each darker) flies in and turns to show its depth.
  var DEPTH = 12;
  P_["3d-extrusion"] = {
    build: function (line) {
      var P = parse(line), copies = "";
      for (var i = DEPTH - 1; i >= 1; i--) {
        var k = i / (DEPTH - 1), pct = Math.round(70 - k * 35);
        var dark = function (c) { return "color-mix(in srgb," + c + " " + pct + "%,black)"; };
        copies += layer("ex", wordsHTML(P, { keyColor: dark(ACC) }), "color:" + dark(INK) + ";transform:translateZ(" + fx(-i * 0.016) + "em);");
      }
      return fitRoot(P, '<div class="kt-body" style="position:relative;transform-style:preserve-3d">' + copies + '<div data-kt-measure style="' + LINE + 'position:relative">' + wordsHTML(P) + "</div></div>", "font-weight:900;perspective:12em;padding:.35em 1.1em;");
    },
    tick: function (el, p) {
      var b = one(el, ".kt-body");
      if (!b) return;
      var q = prog(p, T0, 0.85, eOut), turn = prog(p, 0.2, 1.2, eInOut);
      b.style.transform = "translateZ(" + fx(mix(q, -10, 0)) + "em) rotateX(" + fx(mix(turn, 35, 12), 2) + "deg) rotateY(" + fx(mix(turn, -70, -16), 2) + "deg)";
      b.style.opacity = Math.min(1, q * 3);
    },
  };

  // ---------------------------------------------------------------- 1 · Letter choreography

  function letterRoot(line, style, cstyle) {
    var P = parse(line);
    return fitRoot(P, wordsHTML(P, { letters: true, cstyle: cstyle }), LINE + (style || ""));
  }

  // Every letter drops in from above with a little overshoot, a beat after the one before.
  P_.cascade = {
    build: function (line) { return letterRoot(line, "font-weight:900;"); },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length;
      cs.forEach(function (c, i) {
        var q = pop(p, T0 + stag(i, N, 0.45, 0.06, 1.3), 0.45, 1.8);
        c.style.opacity = Math.min(1, q * 2);
        c.style.transform = "translateY(" + fx(mix(q, -1.1, 0)) + "em)";
      });
    },
  };

  // Letters pop up in a shuffled order.
  P_["random-order-pop-on"] = {
    build: function (line) { return letterRoot(line, "font-weight:900;"); },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length, c = mem(el);
      if (!c.rank) {
        c.rank = [];
        cs.map(function (x, i) { return { i: i, r: rnd(i, 7) }; }).sort(function (a, b) { return a.r - b.r; }).forEach(function (o, k) { c.rank[o.i] = k; });
      }
      cs.forEach(function (l, i) { l.style.transform = "scale(" + fx(pop(p, T0 + stag(c.rank[i], N, 0.35, 0.09, 1.3), 0.35, 2.5)) + ")"; });
    },
  };

  // Each letter bobs on a sine wave, slightly behind its neighbour; big as they arrive, a gentle ripple after.
  P_.wave = {
    build: function (line) { return letterRoot(line, "font-weight:900;line-height:1.5;"); },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length;
      var amp = 0.3 * (1 - 0.75 * prog(p, 0.4, 1.2, eInOut));
      cs.forEach(function (c, i) {
        var a = T0 + stag(i, N, 0.3, 0.04, 0.8);
        var k = prog(p, a, a + 0.3, eOut);
        c.style.opacity = k;
        c.style.transform = "translateY(" + fx(Math.sin(p * 5 - i * 0.6) * amp * k) + "em)";
      });
    },
  };

  // Letters turn over like cards, hinged at the bottom, one after another.
  P_["3d-flip-in"] = {
    build: function (line) { return letterRoot(line, "font-weight:900;", function () { return "transform-origin:50% 100%;"; }); },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length;
      cs.forEach(function (c, i) {
        var a = T0 + stag(i, N, 0.5, 0.07, 1.3);
        var q = prog(p, a, a + 0.5, eOut);
        c.style.transform = "perspective(5em) rotateX(" + fx(mix(q, -95, 0), 2) + "deg)";
        c.style.opacity = q > 0.02 ? 1 : 0;
      });
    },
  };

  // Letters start far apart and drift together — the movie-trailer look.
  P_["tracking-in"] = {
    build: function (line) { var P = parse(line); return fitRoot(P, wordsHTML(P), LINE + "font-weight:600;"); },
    tick: function (el, p) {
      var r = rootOf(el), k = prog(p, 0, 1.6, function (x) { return 1 - Math.pow(1 - x, 2); });
      r.style.letterSpacing = fx(mix(k, 0.5, 0.04)) + "em";
      r.style.opacity = prog(p, 0, 0.6, eOut);
    },
  };

  // The whole line fades in gently, with no other movement.
  P_["simple-fade"] = {
    build: function (line) { var P = parse(line); return fitRoot(P, wordsHTML(P), LINE); },
    tick: function (el, p) { rootOf(el).style.opacity = prog(p, T0, 1.1, eOut); },
  };

  // Each word slams down from huge, one per beat; the line jolts on every impact.
  var SLAM = 0.2;
  P_.stomp = {
    build: function (line) { var P = parse(line); return fitRoot(P, wordsHTML(P), LINE + "font-weight:900;"); },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length, jolt = 0;
      ws.forEach(function (w, i) {
        var a = T0 + stag(i, n, SLAM, 0.18, 1.3);
        var k = prog(p, a, a + SLAM);
        var key = w.hasAttribute("data-key");
        w.style.opacity = k > 0 ? Math.min(1, k * 4) : 0;
        w.style.transform = "scale(" + fx(1 + (1 - eOut(k)) * (key ? 3.2 : 2.2)) + ")";
        var s = p - (a + SLAM);
        if (s > 0 && s < 0.15) jolt += Math.sin(s * 120) * (key ? 0.06 : 0.025) * (1 - s / 0.15);
      });
      rootOf(el).style.transform = jolt ? "translateY(" + fx(jolt) + "em)" : "";
    },
  };

  // ---------------------------------------------------------------- 2 · Cuts, slices and masks

  // A blade cuts diagonally through the whole wrapped block; the two halves slide apart along the cut.
  P_.slice = {
    build: function (line) {
      var P = parse(line), plain = wordsHTML(P);
      return fitRoot(P,
        '<div class="kt-top" data-kt-measure style="' + LINE + 'clip-path:polygon(-10% -50%,110% -50%,110% 40%,-10% 62%)">' + plain + "</div>" +
        layer("bot", plain, "clip-path:polygon(-10% 62%,110% 40%,110% 150%,-10% 150%);") +
        '<svg class="kt-blade" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"><line x1="-6" y1="61.1" x2="-6" y2="61.1" vector-effect="non-scaling-stroke" stroke-width="2" style="stroke:' + INK + '"/></svg>',
        "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el), top = one(el, ".kt-top"), bot = one(el, ".kt-bot"), blade = one(el, ".kt-blade"), ln = one(el, ".kt-blade line");
      r.style.opacity = prog(p, T0, T0 + 0.2);
      // One cut across the whole block: through the middle of a single line, or corner to
      // corner across wrapped lines (so it crosses the text, not the gap between lines).
      var nl = top ? lineIndex(el, all(el, ".kt-top > .kt-w")).n : 1;
      var yl = nl > 1 ? 80 : 62, yr = nl > 1 ? 20 : 40;
      var yAt = function (x) { return yl + ((x + 10) / 120) * (yr - yl); };
      if (top && bot && top.getAttribute("data-n") !== String(nl)) {
        top.setAttribute("data-n", nl);
        top.style.clipPath = "polygon(-10% -50%,110% -50%,110% " + yr + "%,-10% " + yl + "%)";
        bot.style.clipPath = "polygon(-10% " + yl + "%,110% " + yr + "%,110% 150%,-10% 150%)";
      }
      var cut = prog(p, 0.3, 0.7, eInOut), apart = prog(p, 0.75, 1.3, eInOut);
      if (ln) {
        var x = mix(cut, -6, 106);
        ln.setAttribute("y1", fx(yAt(-6), 2));
        ln.setAttribute("x2", fx(x, 2));
        ln.setAttribute("y2", fx(yAt(x), 2));
        blade.style.opacity = cut > 0 ? 1 - apart : 0;
      }
      if (top) top.style.transform = "translate(" + fx(-apart * 0.16) + "em," + fx(-apart * 0.07) + "em)";
      if (bot) bot.style.transform = "translate(" + fx(apart * 0.16) + "em," + fx(apart * 0.07) + "em)";
    },
  };

  // The text arrives in thin horizontal strips that slide in from alternating sides and lock together.
  var STRIPS = 10;
  P_.shred = {
    build: function (line) {
      var P = parse(line), plain = wordsHTML(P), inner = '<div data-kt-measure style="' + LINE + 'visibility:hidden">' + plain + "</div>";
      for (var i = 0; i < STRIPS; i++) {
        var t = i === 0 ? -50 : (i * 100) / STRIPS, b = i === STRIPS - 1 ? -50 : 100 - ((i + 1) * 100) / STRIPS;
        inner += layer("s", plain, "clip-path:inset(" + fx(t, 2) + "% -5% " + fx(b, 2) + "% -5%);");
      }
      return fitRoot(P, inner, "font-weight:900;");
    },
    tick: function (el, p) {
      all(el, ".kt-s").forEach(function (s, i) {
        var a = T0 + stag(i, STRIPS, 0.55, 0.06, 1.3);
        s.style.transform = "translateX(" + fx((1 - prog(p, a, a + 0.55, eInOut)) * (i % 2 ? 1 : -1) * 130, 2) + "%)";
      });
    },
  };

  // The letters are windows onto a moving picture: a sunset sky with a drifting sun.
  P_.knockout = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, { noColor: true, wstyle: function (w, i, key) { return "color:transparent;-webkit-background-clip:text;background-clip:text;background-repeat:no-repeat;" + (key ? "-webkit-text-stroke:.025em " + ACC + ";" : ""); } }), LINE + "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el);
      r.style.opacity = prog(p, T0, 0.5);
      r.style.transform = "scale(" + fx(mix(prog(p, T0, 0.9, eOut), 0.9, 1)) + ")";
      var spans = spreadBackground(el, ".kt-w");
      var d = (p % 6) / 6 + 0.15;
      var pic = "radial-gradient(circle at " + fx(mix(d, 10, 90), 1) + "% " + fx(mix(d, 80, 35), 1) + "%, #FFE38A 0, #F4B942 14%, transparent 15%), linear-gradient(180deg, #2B2D6E 0%, #C2477A 55%, " + ACC + " 80%, #F4B942 100%)";
      setAll(spans, "backgroundImage", pic);
    },
  };

  // Zoom through a letter (exit): the text sits still, then the camera dives through the hole in a letter
  // (in the key word if it has one) and ends on a full frame of the accent colour.
  var HOLEY = "oO0QDdbpqgaeABPR68&9@";
  P_["zoom-through-a-letter"] = {
    build: function (line) {
      var P = parse(line);
      var order = P.words.map(function (w, i) { return i; }).sort(function (a, b) { return (b === P.k) - (a === P.k); });
      var hole = null;
      for (var oi = 0; oi < order.length && !hole; oi++) {
        var ch = Array.from(P.words[order[oi]]);
        for (var hi = 0; hi < HOLEY.length && !hole; hi++) {
          var j = ch.indexOf(HOLEY[hi]);
          if (j >= 0) hole = { w: order[oi], j: j };
        }
      }
      var inner = wordsHTML(P, {
        inner: function (w, i) {
          if (!hole || hole.w !== i) return esc(w);
          return Array.from(w).map(function (c, j) {
            if (j !== hole.j) return esc(c);
            var low = c === c.toLowerCase() && c !== c.toUpperCase();
            return '<span class="kt-hole" style="position:relative;display:inline-block">' + esc(c) + '<span class="kt-disc" style="position:absolute;left:50%;top:' + (low ? 60 : 50) + "%;width:" + (low ? 0.2 : 0.3) + "em;height:" + (low ? 0.2 : 0.3) + "em;transform:translate(-50%,-50%);border-radius:50%;background:" + ACC + ';opacity:0"></span></span>';
          }).join("");
        },
      });
      return '<div class="kt-fill" style="position:absolute;inset:0;background:' + ACC + ';opacity:0;z-index:1"></div>' + fitRoot(P, inner, LINE + "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el), h = one(el, ".kt-hole"), disc = one(el, ".kt-disc"), fill = one(el, ".kt-fill");
      var out = prog(p, EXIT[0], EXIT[1]);
      var c = measured(el, "zoom", function () {
        var at;
        if (h) { var o = offsetIn(disc || h, r); at = disc ? { x: o.x + o.w / 2, y: o.y + o.h / 2, r: o.w / 2 } : { x: o.x + o.w / 2, y: o.y + o.h / 2, r: o.w / 4 }; }
        else {
          var wb = wordBoxes(el), k = wb.filter(function (b) { return b.key; })[0] || wb[Math.floor(wb.length / 2)];
          at = k ? { x: k.cx, y: k.cy, r: fsOf(el) * 0.1 } : { x: r.offsetWidth / 2, y: r.offsetHeight / 2, r: 4 };
        }
        at.max = Math.min(400, Math.max(8, (1.2 * Math.hypot(el.clientWidth, el.clientHeight)) / Math.max(1, at.r)));
        return at;
      });
      var z = prog(out, 0, 0.85, eIn);
      r.style.transformOrigin = fx(c.x, 1) + "px " + fx(c.y, 1) + "px";
      r.style.transform = "scale(" + fx(Math.exp(z * Math.log(c.max))) + ")";
      r.style.opacity = prog(p, T0, 0.4);
      if (disc) disc.style.opacity = prog(out, 0, 0.15);
      if (fill) fill.style.opacity = prog(out, 0.78, 0.95);
    },
  };

  // ---------------------------------------------------------------- 3 · Breaking apart and building up

  // Shatter (exit): cracks flash across the text, then it breaks into triangles that fly from the impact point and fall.
  var SH_COLS = 6, SH_ROWS = 2;
  function shards() {
    var vx = function (c, r) { return (c / SH_COLS) * 100 + (c > 0 && c < SH_COLS ? (rnd(c, r + 50) - 0.5) * 0.45 * (100 / SH_COLS) : 0); };
    var vy = function (c, r) { return (r / SH_ROWS) * 100 + (r > 0 && r < SH_ROWS ? (rnd(c + 50, r) - 0.5) * 0.7 * (100 / SH_ROWS) : 0); };
    var out = [];
    for (var r = 0; r < SH_ROWS; r++) {
      for (var c = 0; c < SH_COLS; c++) {
        var a = [vx(c, r), vy(c, r)], b = [vx(c + 1, r), vy(c + 1, r)], d = [vx(c, r + 1), vy(c, r + 1)], e = [vx(c + 1, r + 1), vy(c + 1, r + 1)];
        [[a, b, e], [a, e, d]].forEach(function (tri) {
          // Pad the outer edges so nothing near them is cut off.
          var pad = tri.map(function (q) { return [q[0] <= 0 ? -20 : q[0] >= 100 ? 120 : q[0], q[1] <= 0 ? -40 : q[1] >= 100 ? 140 : q[1]]; });
          out.push({ tri: tri, pad: pad, cx: (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy: (tri[0][1] + tri[1][1] + tri[2][1]) / 3 });
        });
      }
    }
    return out;
  }
  P_.shatter = {
    build: function (line) {
      var P = parse(line), plain = wordsHTML(P), sh = shards();
      var inner = '<div data-kt-measure style="' + LINE + 'visibility:hidden">' + plain + "</div>";
      sh.forEach(function (s) {
        inner += layer("sh", plain, "clip-path:polygon(" + s.pad.map(function (q) { return fx(q[0], 2) + "% " + fx(q[1], 2) + "%"; }).join(",") + ");");
      });
      inner += '<svg class="kt-cracks" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:-.1em;width:calc(100% + .2em);height:calc(100% + .2em);overflow:visible;opacity:0">' +
        sh.map(function (s) { return '<polygon points="' + s.tri.map(function (q) { return fx(q[0], 2) + "," + fx(q[1], 2); }).join(" ") + '" fill="none" stroke="' + PAPER + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>'; }).join("") + "</svg>";
      return fitRoot(P, inner, "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el), sh = all(el, ".kt-sh"), cr = one(el, ".kt-cracks"), c = mem(el);
      if (!c.shards) c.shards = shards();
      var out = prog(p, EXIT[0], EXIT[1]);
      var BREAK = 0.22, cracking = out > 0 && out < BREAK, s = prog(out, BREAK, 1);
      var hit = measured(el, "hit", function () {
        var k = wordBoxes(el).filter(function (b) { return b.key; })[0];
        return k ? { x: (k.cx / Math.max(1, r.offsetWidth)) * 100, y: (k.cy / Math.max(1, r.offsetHeight)) * 100 } : { x: 50, y: 50 };
      });
      var W = el.clientWidth, H = el.clientHeight;
      r.style.opacity = prog(p, T0, 0.4);
      r.style.transform = cracking ? "translateX(" + fx(Math.sin(out * 300) * 0.012) + "em)" : "";
      if (cr) cr.style.opacity = cracking ? 1 : 0;
      sh.forEach(function (el2, i) {
        var d = c.shards[i];
        var dx = (d.cx - hit.x) / 50, dy = (d.cy - hit.y) / 50;
        var sp = 0.6 + rnd(i, 9) * 0.8;
        var x = dx * W * 0.35 * sp * s, y = dy * H * 0.25 * sp * s + H * 0.9 * s * s;
        el2.style.transformOrigin = fx(d.cx, 1) + "% " + fx(d.cy, 1) + "%";
        el2.style.transform = s > 0 ? "translate(" + fx(x, 1) + "px," + fx(y, 1) + "px) rotate(" + fx((rnd(i, 11) - 0.5) * 600 * s, 1) + "deg)" : "";
        el2.style.opacity = 1 - prog(s, 0.55, 1);
      });
    },
  };

  // Disintegrate (exit): the text erodes left to right into grains that drift away up and to the right.
  var LIFE = 0.45;
  P_.disintegrate = {
    build: function (line) { var P = parse(line); return CANVAS + fitRoot(P, wordsHTML(P), LINE + "font-family:" + HEAVY + ";font-weight:900;"); },
    tick: function (el, p) {
      var r = rootOf(el), out = prog(p, EXIT[0], EXIT[1]);
      r.style.opacity = prog(p, T0, 0.4);
      var cv = canvas(el);
      if (out <= 0 || !cv) { r.style.webkitMaskImage = r.style.maskImage = ""; return; }
      var G = grains(el, 1500), fs = fsOf(el), cell = G.cell;
      var jitter = fs * 0.6, W = r.offsetWidth;
      var startX = -jitter, endX = startX + (W + 2 * jitter) / (1 - LIFE);
      var edge = mix(out, startX, endX), soft = fs * 0.3;
      var mask = "linear-gradient(90deg, transparent " + fx(edge - soft, 1) + "px, black " + fx(edge + soft, 1) + "px)";
      r.style.webkitMaskImage = r.style.maskImage = mask;
      var ink = cssVar(el, "--kt-ink", "#1E1E24"), acc = cssVar(el, "--kt-accent", ACC_HEX);
      G.list.forEach(function (g, i) {
        var at = g.x + cell / 2 + (rnd(i, 1) - 0.5) * 2 * jitter;
        if (edge < at) return;
        var s = (out - (at - startX) / (endX - startX)) / LIFE;
        if (s >= 1) return;
        var x = g.x + s * (0.5 + rnd(i, 2) * 2.5) * fs + s * s * 0.8 * fs;
        var y = g.y - s * (rnd(i, 3) * 1.8 - 0.3) * fs + Math.sin(s * 5 + i) * 0.1 * fs * s;
        var size = cell * mix(s, 0.85, 0.4);
        cv.ctx.globalAlpha = 1 - s;
        cv.ctx.fillStyle = g.key ? acc : ink;
        cv.ctx.fillRect(cv.x + x, cv.y + y, size, size);
      });
      cv.ctx.globalAlpha = 1;
    },
  };

  // A cloud of dots flies in from all over and settles into the text; then the crisp letters take over.
  P_["particle-assemble"] = {
    build: function (line) { var P = parse(line); return CANVAS + fitRoot(P, wordsHTML(P), LINE + "font-family:" + HEAVY + ";font-weight:900;"); },
    tick: function (el, p) {
      var r = rootOf(el), crisp = prog(p, 1.0, 1.35, eInOut);
      r.style.opacity = crisp;
      var cv = canvas(el);
      if (!cv || crisp >= 1) return;
      var G = grains(el, 1200), cell = G.cell;
      var ink = cssVar(el, "--kt-ink", "#1E1E24"), acc = cssVar(el, "--kt-accent", ACC_HEX);
      cv.ctx.globalAlpha = 1 - crisp;
      G.list.forEach(function (g, i) {
        var d = T0 + rnd(i, 5) * 0.35;
        var q = prog(p, d, d + 0.5, eInOut);
        var sx = mix(rnd(i, 6), -0.2, 1.2) * cv.w - cv.x, sy = mix(rnd(i, 7), -0.2, 1.2) * cv.h - cv.y;
        cv.ctx.fillStyle = q >= 1 ? (g.key ? acc : ink) : acc;
        cv.ctx.beginPath();
        cv.ctx.arc(cv.x + mix(q, sx, g.x + cell / 2), cv.y + mix(q, sy, g.y + cell / 2), cell * 0.45, 0, 6.2832);
        cv.ctx.fill();
      });
      cv.ctx.globalAlpha = 1;
    },
  };

  // ---------------------------------------------------------------- 4 · Characters that change in place

  var UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", LOWER = "abcdefghijklmnopqrstuvwxyz", DIGITS = "0123456789", SYMBOLS = "#$%&@*!?+=<>/";
  function setFor(ch) {
    if (UPPER.indexOf(ch) >= 0) return UPPER;
    if (LOWER.indexOf(ch) >= 0) return LOWER;
    if (DIGITS.indexOf(ch) >= 0) return DIGITS;
    if (ch.toLocaleLowerCase() !== ch.toLocaleUpperCase()) return ch === ch.toLocaleUpperCase() ? UPPER : LOWER;
    return SYMBOLS;
  }
  function pick(set, a, b) { return set[Math.floor(rnd(a, b) * set.length)]; }

  // Random characters flicker in every slot, then lock into the real letters one by one; the key word locks last.
  P_.scramble = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, { inner: function (w, i, key, gi) { return Array.from(w).map(function (ch, j) { return '<span class="kt-c" data-i="' + (gi + j) + '" data-ch="' + esc(ch) + '">' + esc(ch) + "</span>"; }).join(""); } }), LINE + "font-family:" + MONO + ";font-weight:700;");
    },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length, c = mem(el);
      if (!c.rank) {
        var order = [];
        [false, true].forEach(function (k) { cs.forEach(function (l, i) { if (!!l.closest("[data-key]") === k) order.push(i); }); });
        c.rank = [];
        order.forEach(function (gi, k) { c.rank[gi] = k; });
      }
      var step = Math.floor(p * 15);
      cs.forEach(function (l, i) {
        var ch = l.getAttribute("data-ch");
        var locked = p >= T0 + mix((c.rank[i] + 1) / N, 0.25, 1.3);
        var t = locked || p < T0 ? ch : pick(setFor(ch), i, step);
        if (l.textContent !== t) l.textContent = t;
        l.style.color = locked ? "" : MUTED;
        l.style.visibility = p < T0 ? "hidden" : "visible";
      });
    },
  };

  // Every character is a little window with a strip rolling behind it: digits on dark wheels, letters like a slot machine.
  P_.odometer = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        wstyle: function () { return "display:inline-flex;"; },
        inner: function (w, i, key, gi) {
          return Array.from(w).map(function (ch, j) {
            var digit = DIGITS.indexOf(ch) >= 0;
            return '<span class="kt-slot" data-ch="' + esc(ch) + '" data-j="' + j + '" data-n="' + Array.from(w).length + '" style="display:inline-block;position:relative;overflow:hidden;vertical-align:top;height:1.2em;line-height:1.2em">' +
              (digit ? '<span style="position:absolute;inset:.04em .02em;border-radius:.1em;background:' + INK + '"></span>' : "") +
              '<span style="visibility:hidden">' + esc(ch) + '</span><span class="kt-a" style="position:absolute;left:0;right:0;top:0;text-align:center' + (digit ? ";color:" + PAPER : "") + '">' + esc(ch) + '</span><span class="kt-b" style="position:absolute;left:0;right:0;top:1.2em;text-align:center' + (digit ? ";color:" + PAPER : "") + '"></span></span>';
          }).join("");
        },
      }), LINE + "align-items:flex-start;line-height:1.3;");
    },
    tick: function (el, p) {
      all(el, ".kt-slot").forEach(function (s, gi) {
        var c = s.__kt || (s.__kt = { ch: s.getAttribute("data-ch"), j: +s.getAttribute("data-j"), n: +s.getAttribute("data-n"), key: !!s.closest("[data-key]"), a: s.querySelector(".kt-a"), b: s.querySelector(".kt-b") });
        var digit = DIGITS.indexOf(c.ch) >= 0, rolls = setFor(c.ch) !== SYMBOLS;
        s.style.opacity = prog(p, T0, T0 + 0.2);
        if (!rolls) return;
        var end = c.key ? 1.4 : mix(c.n > 1 ? c.j / (c.n - 1) : 1, 0.9, 1.25);
        var total = (digit ? 20 : 8) + c.j * 2 + (c.key ? 6 : 0);
        var pos = prog(p, T0, end, eInOut) * total, k0 = Math.floor(pos);
        var cellAt = function (k) {
          if (k >= total) return c.ch;
          if (digit) return DIGITS[(((Number(c.ch) - (total - k)) % 10) + 10) % 10];
          return pick(setFor(c.ch), gi, k);
        };
        c.a.textContent = cellAt(k0);
        c.b.textContent = k0 + 1 <= total ? cellAt(k0 + 1) : "";
        c.a.style.top = fx((k0 - pos) * 1.2) + "em";
        c.b.style.top = fx((k0 + 1 - pos) * 1.2) + "em";
      });
    },
  };

  // Every character is a hinged card, like an airport departures board, flipping through a few characters before landing.
  var CARD = "#2A2B33";
  function half(cls, top) {
    return '<span class="kt-' + cls + '" style="position:absolute;left:0;right:0;top:' + (top ? "0" : "50%") + ";height:50%;overflow:hidden;background:" + CARD + ";border-radius:" + (top ? ".08em .08em 0 0" : "0 0 .08em .08em") + ";transform-origin:50% " + (top ? "100%" : "0") + '"><span style="position:absolute;left:0;right:0;top:' + (top ? "0" : "-100%") + ';height:200%;line-height:1.12em;text-align:center"></span></span>';
  }
  P_["split-flap-board"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        noColor: true,
        wstyle: function (w, i, key) { return key ? "color:" + ACC + ";" : ""; },
        inner: function (w) {
          return Array.from(w).map(function (ch) {
            return '<span class="kt-card" data-ch="' + esc(ch) + '" style="display:inline-block;position:relative;vertical-align:top;height:1.12em;line-height:1.12em;padding:0 .08em;margin-right:.06em"><span style="visibility:hidden">' + esc(ch) + "</span>" + half("t", true) + half("bt", false) + half("ft", true) + half("fb", false) + '<span style="position:absolute;left:0;right:0;top:calc(50% - .012em);height:.024em;background:#0E0F14"></span></span>';
          }).join("");
        },
      }), LINE + "font-family:" + MONO + ";font-weight:700;line-height:1.35;color:" + PAPER + ";column-gap:.2em;");
    },
    tick: function (el, p) {
      var cards = all(el, ".kt-card"), N = cards.length;
      cards.forEach(function (card, gi) {
        var c = card.__kt || (card.__kt = { ch: card.getAttribute("data-ch"), t: card.querySelector(".kt-t > span"), bt: card.querySelector(".kt-bt > span"), ft: card.querySelector(".kt-ft"), fb: card.querySelector(".kt-fb") });
        var set = setFor(c.ch), flips = 4 + Math.floor(rnd(gi, 13) * 6), goal = set.indexOf(c.ch);
        var charAt = function (k) { return k >= flips ? c.ch : goal >= 0 ? set[(((goal - (flips - k)) % set.length) + set.length) % set.length] : pick(set, gi, k); };
        var a = T0 + stag(gi, N, 0.7, 0.03, 1.35);
        var f = prog(p, a, a + 0.7) * flips, idx = Math.min(flips, Math.floor(f)), frac = f - idx, done = idx >= flips;
        var prev = charAt(idx), next = done ? prev : charAt(idx + 1);
        card.style.opacity = prog(p, Math.max(0, a - 0.1), a + 0.02);
        c.t.textContent = next;
        c.bt.textContent = prev;
        c.ft.firstChild.textContent = prev;
        c.fb.firstChild.textContent = next;
        c.ft.style.display = !done && frac < 0.5 ? "block" : "none";
        c.fb.style.display = !done && frac >= 0.5 ? "block" : "none";
        c.ft.style.transform = "perspective(4em) rotateX(" + fx(-frac * 180, 1) + "deg)";
        c.fb.style.transform = "perspective(4em) rotateX(" + fx((1 - frac) * 180, 1) + "deg)";
      });
    },
  };

  // Every word starts as an anagram of itself; the letters glide in arcs to their real places.
  P_.anagram = {
    build: function (line) { return letterRoot(line, ""); },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length, r = rootOf(el);
      r.style.opacity = prog(p, 0, 0.15);
      var offs = measured(el, "ana", function () {
        return ws.map(function (w, wi) {
          var ls = Array.prototype.slice.call(w.children), m = ls.length;
          var widths = ls.map(function (l) { return l.offsetWidth; });
          var chars = ls.map(function (l) { return l.textContent; });
          var perm = ls.map(function (l, j) { return j; }).sort(function (a, b) { return rnd(wi, a + 1) - rnd(wi, b + 1); });
          if (m > 1 && perm.every(function (q, j) { return chars[q] === chars[j]; })) perm = perm.map(function (q, j) { return (j + 1) % m; });
          var at = function (order) { var x = [], acc = 0; order.forEach(function (j) { x[j] = acc; acc += widths[j]; }); return x; };
          var home = at(ls.map(function (l, j) { return j; })), start = at(perm);
          return ls.map(function (l, j) { return start[j] - home[j]; });
        });
      });
      ws.forEach(function (w, wi) {
        var a = T0 + 0.15 + stag(wi, n, 0.6, 0.08, 1.1);
        var q = prog(p, a, a + 0.6, eInOut), key = w.hasAttribute("data-key");
        Array.prototype.forEach.call(w.children, function (l, j) {
          var lift = Math.sin(q * Math.PI) * (j % 2 ? 0.45 : -0.45) * (key ? 1.4 : 1);
          l.style.transform = "translate(" + fx((1 - q) * (offs[wi] ? offs[wi][j] : 0), 1) + "px," + fx(lift) + "em)";
        });
      });
    },
  };

  // ---------------------------------------------------------------- 5 · Shape-shifting letters

  // A wave of boldness ripples through the text as the weight slider moves; the key word breathes deeper.
  /**
   * Letters whose weight changes: each letter's slot is held at the heaviest weight
   * (an invisible copy), and the visible letter (class "kt-v") is centred on it,
   * so changing weights never re-wrap or overflow the line.
   */
  function heldLetters(line, style, heavy) {
    var P = parse(line);
    return fitRoot(P, wordsHTML(P, {
      noColor: true,
      inner: function (w, i, key) {
        return Array.from(w).map(function (ch) {
          return '<span class="kt-c" style="display:inline-block;position:relative"><span style="visibility:hidden;font-weight:' + heavy + '">' + esc(ch) + '</span><span class="kt-v" style="position:absolute;left:-.5em;right:-.5em;top:0;text-align:center' + (key ? ";color:" + ACC : "") + '">' + esc(ch) + "</span></span>";
        }).join("");
      },
    }), LINE + style);
  }

  P_["variable-font-breathing"] = {
    build: function (line) { return heldLetters(line, "font-family:" + FLEX + ";font-weight:400;", 900); },
    tick: function (el, p) {
      var cs = all(el, ".kt-v"), N = cs.length, c = mem(el);
      if (!c.keys) { c.keys = cs.map(function (l) { return !!l.closest("[data-key]"); }); c.w = []; }
      cs.forEach(function (l, i) {
        var a = T0 + stag(i, N, 0.45, 0.03, 1.0);
        var k = prog(p, a, a + 0.45, eOut);
        var wave = 700 + (c.keys[i] ? 280 : 200) * Math.sin(p * 3.2 - i * 0.55);
        // Weight in steps of 25, written only when it changes (re-shaping a letter is the costly part).
        var wght = Math.max(100, Math.min(1000, Math.round(mix(k, 100, wave) / 25) * 25));
        l.style.opacity = Math.min(1, k * 2);
        if (c.w[i] !== wght) { c.w[i] = wght; l.style.fontWeight = wght; }
      });
    },
  };

  // The text squeezes thin, stretches wide, then leans forward as it settles.
  P_["width-stretch"] = {
    build: function (line) { var P = parse(line); return fitRoot(P, '<div class="kt-st" style="' + LINE + '">' + wordsHTML(P) + "</div>", "font-family:" + FLEX + ";"); },
    tick: function (el, p) {
      var st = one(el, ".kt-st");
      if (!st) return;
      var w;
      if (p < 0.55) w = mix(prog(p, T0, 0.55, eInOut), 1, 0.4);
      else if (p < 1.0) w = mix(prog(p, 0.55, 1.0, eInOut), 0.4, 1.12);
      else w = mix(prog(p, 1.0, 1.4, eInOut), 1.12, 1);
      var slant = mix(prog(p, 0.95, 1.4, eInOut), 0, -10);
      // The component moves the font's width and slant sliders; a transform gives the same look with any font.
      st.style.transform = "scaleX(" + fx(w) + ") skewX(" + fx(slant, 2) + "deg)";
      rootOf(el).style.opacity = prog(p, 0, 0.2);
    },
  };

  // Every letter is built from its four quarters, flying in from different directions and snapping together.
  var QUARTERS = ["inset(0 50% 50% 0)", "inset(0 0 50% 50%)", "inset(50% 50% 0 0)", "inset(50% 0 0 50%)"];
  P_.construction = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        inner: function (w) {
          return Array.from(w).map(function (ch) {
            return '<span class="kt-c" style="display:inline-block;position:relative"><span style="visibility:hidden">' + esc(ch) + "</span>" +
              QUARTERS.map(function (q, k) { return '<span class="kt-q" style="position:absolute;left:0;top:0;clip-path:' + q + (k === 0 ? ";color:" + ACC : "") + '">' + esc(ch) + "</span>"; }).join("") + "</span>";
          }).join("");
        },
      }), LINE + "font-weight:900;");
    },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length;
      cs.forEach(function (c, gi) {
        var a = T0 + stag(gi, N, 0.6, 0.05, 1.35);
        var key = !!c.closest("[data-key]");
        var qs = c.__q || (c.__q = Array.prototype.slice.call(c.querySelectorAll(".kt-q")));
        var done = p >= a + 0.6;
        qs.forEach(function (q, k) {
          var t = prog(p, a + k * 0.07, a + 0.38 + k * 0.07, eInOut);
          var ang = rnd(gi, k + 20) * Math.PI * 2, dist = (key ? 3 : 2) + rnd(gi, k + 30) * 1.5, spin = (rnd(gi, k + 40) - 0.5) * 400;
          q.style.opacity = t > 0 ? 1 : 0;
          q.style.color = done ? "inherit" : k === 0 ? ACC : "";
          q.style.transform = "translate(" + fx((1 - t) * Math.cos(ang) * dist) + "em," + fx((1 - t) * Math.sin(ang) * dist) + "em) rotate(" + fx((1 - t) * spin, 1) + "deg)";
        });
      });
    },
  };

  // Each letter starts as a different letter and its outline melts like liquid into the real one.
  function morphFrom(ch, seed) {
    var set = UPPER.indexOf(ch) >= 0 ? UPPER : LOWER.indexOf(ch) >= 0 ? LOWER : DIGITS.indexOf(ch) >= 0 ? DIGITS : null;
    if (!set) return null;
    return set[(set.indexOf(ch) + 3 + Math.floor(rnd(seed, 17) * (set.length - 6))) % set.length];
  }
  P_["outline-morph"] = {
    build: function (line) {
      var P = parse(line), id = uid("morph");
      return '<svg width="0" height="0" style="position:absolute"><filter id="' + id + '"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 40 -18"/></filter></svg>' +
        withFilter(fitRoot(P, wordsHTML(P, {
          inner: function (w, i, key, gi) {
            return Array.from(w).map(function (ch, j) {
              var from = morphFrom(ch, gi + j);
              if (!from) return '<span class="kt-c" style="display:inline-block">' + esc(ch) + "</span>";
              var L = "position:absolute;left:0;right:0;top:0;text-align:center;";
              return '<span class="kt-c kt-m" style="display:inline-block;position:relative"><span style="visibility:hidden">' + esc(ch) + '</span><span class="kt-f" style="' + L + '">' + esc(from) + '</span><span class="kt-t" style="' + L + '">' + esc(ch) + "</span></span>";
            }).join("");
          },
        }), LINE + "font-weight:900;"), id);
    },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length, r = rootOf(el);
      r.style.opacity = prog(p, 0, 0.15);
      var any = false;
      cs.forEach(function (c, gi) {
        if (!c.classList.contains("kt-m")) return;
        var a = T0 + 0.1 + stag(gi, N, 0.45, 0.05, 1.3);
        var m = prog(p, a, a + 0.45, eInOut);
        var f = c.children[1], t = c.children[2];
        var blur = Math.sin(m * Math.PI) * 0.07;
        f.style.opacity = 1 - m;
        t.style.opacity = m;
        f.style.filter = t.style.filter = blur > 0.002 ? "blur(" + fx(blur) + "em)" : "none";
        c.style.filter = m > 0 && m < 1 ? r.getAttribute("data-filter") : "none";
        if (m < 1) any = true;
      });
      if (!any) r.style.filter = "none";
    },
  };

  // ---------------------------------------------------------------- 6 · Warp and distortion

  // A noise pattern nudges every edge and changes a few times a second, so the outlines shiver like hand-drawn animation.
  P_["line-boil"] = {
    build: function (line) {
      var P = parse(line), id = uid("boil");
      var f = function (s) { return '<filter id="' + id + s + '" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence class="kt-tb" type="fractalNoise" baseFrequency="0.3" numOctaves="2" seed="1"/><feDisplacementMap class="kt-dm' + s + '" in="SourceGraphic" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>'; };
      return '<svg width="0" height="0" style="position:absolute">' + f("w") + f("k") + "</svg>" +
        fitRoot(P, wordsHTML(P, { wstyle: function (w, i, key) { return "filter:url(#" + id + (key ? "k" : "w") + ");"; } }), LINE + "font-weight:900;");
    },
    tick: function (el, p) {
      var fs = fsOf(el), r = rootOf(el);
      var amt = mix(prog(p, 0.3, 0.9), 0, 0.055 * fs);
      var seed = Math.floor(p / 0.133);
      all(el, ".kt-tb").forEach(function (t) { t.setAttribute("seed", seed); t.setAttribute("baseFrequency", fx(6 / fs)); });
      var w = one(el, ".kt-dmw"), k = one(el, ".kt-dmk");
      if (w) w.setAttribute("scale", fx(amt, 2));
      if (k) k.setAttribute("scale", fx(amt * 1.8, 2));
      r.style.opacity = prog(p, 0, 0.3);
      r.style.transform = "scale(" + fx(mix(prog(p, 0, 0.5, eOut), 0.94, 1)) + ")";
    },
  };

  // The text is cut into thin vertical strips that each ride a sine wave, like a flag in the wind.
  var FLAG = 24;
  P_["flag-wave"] = {
    build: function (line) {
      var P = parse(line), plain = wordsHTML(P), inner = '<div data-kt-measure style="' + LINE + 'visibility:hidden">' + plain + "</div>";
      for (var i = 0; i < FLAG; i++) {
        var l = i === 0 ? -20 : (i * 100) / FLAG, r = i === FLAG - 1 ? -20 : 100 - ((i + 1) * 100) / FLAG - 0.3;
        inner += layer("fl", plain, "clip-path:inset(-50% " + fx(r, 2) + "% -50% " + fx(l, 2) + "%);");
      }
      return fitRoot(P, inner, "font-weight:900;");
    },
    tick: function (el, p) {
      var amp = mix(prog(p, 0.4, 1.2, eInOut), 0.22, 0.1) * prog(p, T0, 0.4);
      rootOf(el).style.opacity = prog(p, 0, 0.3);
      all(el, ".kt-fl").forEach(function (s, i) {
        var x = i / FLAG, ph = x * 9 - p * 5;
        var shade = 1 - 0.2 * (Math.cos(ph) * 0.5 + 0.5) * (amp / 0.22);
        s.style.transform = "translateY(" + fx(Math.sin(ph) * amp * (0.3 + x)) + "em)";
        s.style.filter = "brightness(" + fx(shade) + ")";
      });
    },
  };

  // A lens passes over the text, swells what's under it, lingers on the key word, then glides off.
  var ZOOM = 1.45;
  P_.bulge = {
    build: function (line) {
      var P = parse(line), plain = wordsHTML(P);
      return fitRoot(P, '<div class="kt-base" data-kt-measure style="' + LINE + '">' + plain + "</div>" +
        '<div class="kt-lensclip" style="position:absolute;inset:-1em;padding:1em"><div class="kt-lens" style="' + LINE + '">' + plain + '</div><div class="kt-shine" style="position:absolute;inset:0"></div></div>' +
        '<div class="kt-ring" style="position:absolute;left:0;top:0;border-radius:50%;box-sizing:border-box;border:.05em solid ' + INK + ';box-shadow:0 .06em .2em rgba(0,0,0,.15)"></div>', "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el), base = one(el, ".kt-base"), clip = one(el, ".kt-lensclip"), lens = one(el, ".kt-lens"), ring = one(el, ".kt-ring"), shine = one(el, ".kt-shine");
      r.style.opacity = prog(p, 0, 0.3);
      if (p >= 1.45 || p < T0) {
        base.style.webkitMaskImage = base.style.maskImage = "";
        clip.style.display = ring.style.display = "none";
        return;
      }
      clip.style.display = ring.style.display = "block";
      var fs = fsOf(el);
      var L = measured(el, "lens", function () {
        var wb = wordBoxes(el, ".kt-base > .kt-w");
        var t = wb.filter(function (b) { return b.key; })[0] || wb[Math.floor((wb.length - 1) / 2)] || { cx: r.offsetWidth / 2, cy: r.offsetHeight / 2, w: fs };
        return { t: t, R: Math.max(fs * 0.75, Math.min(fs * 1.6, t.w * 0.62)), W: r.offsetWidth };
      });
      var R = L.R, q = prog(p, T0, 1.4), lx;
      if (q < 0.4) lx = mix(eInOut(q / 0.4), -R * 1.3, L.t.cx);
      else if (q < 0.55) lx = L.t.cx;
      else lx = mix(eInOut((q - 0.55) / 0.45), L.t.cx, L.W + R * 1.3);
      var ly = L.t.cy + Math.sin(q * Math.PI * 2) * 0.12 * fs;
      var hole = "radial-gradient(circle " + fx(R, 1) + "px at " + fx(lx, 1) + "px " + fx(ly, 1) + "px, transparent " + fx(R - 0.5, 1) + "px, black " + fx(R + 0.5, 1) + "px)";
      base.style.webkitMaskImage = base.style.maskImage = hole;
      var pad = fs; // the clip box is padded by 1em on every side
      clip.style.clipPath = "circle(" + fx(R, 1) + "px at " + fx(lx + pad, 1) + "px " + fx(ly + pad, 1) + "px)";
      lens.style.transformOrigin = fx(lx, 1) + "px " + fx(ly, 1) + "px";
      lens.style.transform = "scale(" + ZOOM + ")";
      shine.style.background = "radial-gradient(circle " + fx(R, 1) + "px at " + fx(lx + pad - R * 0.3, 1) + "px " + fx(ly + pad - R * 0.3, 1) + "px, rgba(255,255,255,.35), rgba(255,255,255,0) 70%)";
      ring.style.width = ring.style.height = fx(2 * R, 1) + "px";
      ring.style.transform = "translate(" + fx(lx - R, 1) + "px," + fx(ly - R, 1) + "px)";
      ring.style.opacity = 1 - prog(p, 1.35, 1.45);
    },
  };

  // ---------------------------------------------------------------- 7 · Line, light and shadow

  // The outline draws itself like a pen, row after row, then the colour fills in.
  P_["stroke-write-on"] = {
    svg: true,
    build: function (line) {
      var P = parse(line);
      var rows = Math.max(1, Math.min(P.words.length, Math.round(Math.sqrt(P.chars / 9))));
      var groups = rows > 1 ? chunks(P.words, rows) : [P.words];
      var gi = 0, maxChars = 1;
      var texts = groups.map(function (g, i) {
        var chars = Array.from(g.join(" ")).length;
        maxChars = Math.max(maxChars, chars);
        var spans = g.map(function (w) {
          var key = gi++ === P.k;
          return "<tspan" + (key ? ' data-key style="fill:' + ACC + ";stroke:" + ACC + '"' : "") + ">" + esc(w) + "</tspan>";
        }).join(" ");
        var D = Math.max(1, chars) * 4 * 60;
        return '<text class="kt-row" data-d="' + D + '" x="0" y="' + i * 72 + '" text-anchor="middle" font-size="60" font-weight="800" stroke-width="2.2" stroke-linejoin="round" stroke-dasharray="' + D + " " + D + '" stroke-dashoffset="0" style="font-family:' + FONT + ";fill:" + INK + ";stroke:" + INK + '">' + spans + "</text>";
      }).join("");
      var w = maxChars * 0.62 * 60, h = groups.length * 72;
      return '<svg data-kt-bbox role="img" aria-label="' + esc(P.text) + '" viewBox="' + fx(-w / 2, 0) + " -60 " + fx(w, 0) + " " + fx(h + 20, 0) + '" preserveAspectRatio="xMidYMid meet" style="width:92%;height:80%;overflow:visible"><g data-kt-content>' + texts + "</g></svg>";
    },
    tick: function (el, p) {
      var rows = all(el, ".kt-row"), n = rows.length;
      var fill = prog(p, 1.15, 1.55, eInOut);
      rows.forEach(function (t, i) {
        var D = +t.getAttribute("data-d");
        var a = T0 + stag(i, n, 0.9, 0.2, 1.15);
        t.setAttribute("stroke-dashoffset", fx(D * (1 - prog(p, a, a + 0.9, eInOut)), 1));
        t.setAttribute("fill-opacity", fx(fill));
        t.style.opacity = p < a ? 0 : 1;
      });
    },
  };

  // Glass tubes on a dark sign buzz on letter by letter, flickering as they catch, then glow steadily.
  P_["neon-sign"] = {
    dark: true,
    build: function (line) { return letterRoot(line, "font-weight:400;line-height:1.25;color:#2A2B33;"); },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length, c = mem(el);
      if (!c.tube) c.tube = cs.map(function (l) { return l.closest("[data-key]") ? "#4FE3FF" : "#FF4FA3"; });
      if (!c.state) c.state = [];
      cs.forEach(function (l, i) {
        var on = T0 + stag(i, N, 0.2, 0.06, 1.1) + 0.1;
        var buzz = p >= on && p < on + 0.25 && rnd(i, Math.floor(p * 15)) < 0.45;
        var lit = p >= on && !buzz;
        if (c.state[i] === lit) return;
        c.state[i] = lit;
        var t = c.tube[i];
        l.style.color = lit ? "#FFFFFF" : "#2A2B33";
        l.style.textShadow = lit ? "0 0 .04em " + t + ",0 0 .12em " + t + ",0 0 .3em " + t + ",0 0 .55em " + t : "none";
        l.style.webkitTextStroke = ".015em " + (lit ? t : "#3A3B44");
      });
    },
  };

  // A band of light slides across the text, like a reflection on polished gold; the key word is metal in the accent colour.
  P_["light-sweep"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, { noColor: true, wstyle: function () { return "color:transparent;-webkit-background-clip:text;background-clip:text;background-repeat:no-repeat;"; } }), LINE + "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el), spans = spreadBackground(el, ".kt-w");
      r.style.opacity = prog(p, 0, 0.35);
      var x = mix(prog(p, 0.25, 1.4, eInOut), -40, 140);
      var grad = function (d, m, l) { return "linear-gradient(110deg," + d + " 0%," + m + " " + fx(x - 16, 1) + "%," + l + " " + fx(x, 1) + "%," + m + " " + fx(x + 16, 1) + "%," + d + " 100%)"; };
      var gold = grad("#8A6A1F", "#C9A64A", "#FFF6D6");
      var metal = grad("color-mix(in srgb," + ACC + " 65%,black)", ACC, "color-mix(in srgb," + ACC + " 20%,white)");
      spans.forEach(function (s) {
        var key = s.hasAttribute("data-key");
        s.style.backgroundImage = key ? metal : gold;
        s.style.filter = "drop-shadow(0 .03em 0 " + (key ? "color-mix(in srgb," + ACC + " 45%,black)" : "#5E4712") + ")";
      });
    },
  };

  // A long, hard diagonal shadow grows out of every letter.
  P_["long-shadow"] = {
    build: function (line) { var P = parse(line); return fitRoot(P, wordsHTML(P), LINE + "font-weight:900;"); },
    tick: function (el, p) {
      var r = rootOf(el);
      r.style.opacity = prog(p, 0, 0.3);
      var len = mix(prog(p, 0.25, 1.4, eInOut), 0, 0.55), steps = 28;
      var sh = function (c) {
        if (len <= 0.001) return "none";
        var out = [];
        for (var i = 1; i <= steps; i++) { var d = fx((i * len) / steps, 4); out.push(d + "em " + d + "em 0 " + c); }
        return out.join(",");
      };
      var plain = sh("color-mix(in srgb," + INK + " 22%," + PAPER + ")"), keyed = sh("color-mix(in srgb," + ACC + " 35%," + PAPER + ")");
      all(el, ".kt-w").forEach(function (w) { w.style.textShadow = w.hasAttribute("data-key") ? keyed : plain; });
    },
  };

  // The box is dark; a circle of light roams, finds the key word, then opens up to show it all.
  P_["spotlight-reveal"] = {
    dark: true,
    build: function (line) {
      var P = parse(line);
      return '<div class="kt-pool" style="position:absolute;inset:0"></div>' + fitRoot(P, wordsHTML(P), LINE + "font-weight:900;color:" + PAPER + ";");
    },
    tick: function (el, p) {
      var r = rootOf(el), pool = one(el, ".kt-pool"), fs = fsOf(el);
      var g = measured(el, "spot", function () {
        var wb = wordBoxes(el), k = wb.filter(function (b) { return b.key; })[0];
        var W = r.offsetWidth, H = r.offsetHeight, tx = k ? k.cx : W / 2, ty = k ? k.cy : H / 2;
        var far = Math.max(Math.hypot(tx, ty), Math.hypot(W - tx, ty), Math.hypot(tx, H - ty), Math.hypot(W - tx, H - ty));
        return { W: W, H: H, tx: tx, ty: ty, far: far, o: offsetIn(r, el) };
      });
      var u = p / 1.5;
      var find = prog(u, 0, 0.6, eInOut), sway = 1 - prog(u, 0.45, 0.6);
      var sx = mix(find, g.W * 0.1, g.tx) + Math.sin(u * 9) * 0.6 * fs * sway;
      var sy = mix(find, -fs * 0.2, g.ty) + Math.cos(u * 7) * 0.3 * fs * sway;
      var rad = mix(prog(u, 0.6, 0.95, eInOut), fs * 0.9, (g.far + fs * 0.4) / 0.8);
      var light = "radial-gradient(circle " + fx(rad, 1) + "px at " + fx(sx, 1) + "px " + fx(sy, 1) + "px, black " + fx(rad * 0.8, 1) + "px, transparent " + fx(rad, 1) + "px)";
      r.style.webkitMaskImage = r.style.maskImage = light;
      r.style.opacity = prog(p, 0, 0.15);
      if (pool) pool.style.background = "radial-gradient(circle " + fx(rad * 1.2, 1) + "px at " + fx(g.o.x + sx, 1) + "px " + fx(g.o.y + sy, 1) + "px, #2A2B33 0%, #0E0F14 100%)";
    },
  };

  // ---------------------------------------------------------------- 8 · Elemental materials

  function waveURI(hex) {
    return "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='10' viewBox='0 0 40 10' preserveAspectRatio='none'><path d='M0 6 Q10 0 20 6 T40 6 V10 H0 Z' fill='" + hex.replace("#", "%23") + "'/></svg>\")";
  }
  // The letters are outlines, and a wavy liquid rises inside them like water filling a glass
  // (only part-way if the line contains a percentage).
  P_["liquid-fill"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, { noColor: true, wstyle: function (w, i, key) { return "color:transparent;-webkit-background-clip:text;background-clip:text;-webkit-text-stroke:.025em " + (key ? ACC : BLUE) + ";background-repeat:repeat-x,no-repeat;"; } }), LINE + "font-weight:900;");
    },
    tick: function (el, p, line) {
      var ws = all(el, ".kt-w"), n = ws.length, c = mem(el);
      if (c.level == null) {
        var m = /(\d{1,3}(?:[.,]\d+)?)\s?%/.exec(parse(line).text);
        c.level = m ? Math.min(1, Math.max(0.05, parseFloat(m[1].replace(",", ".")) / 100)) * 0.75 + 0.1 : 1.05;
        c.acc = cssVar(el, "--kt-accent", ACC_HEX);
      }
      rootOf(el).style.opacity = prog(p, 0, 0.2);
      ws.forEach(function (w, i) {
        var key = w.hasAttribute("data-key"), col = key ? c.acc : BLUE;
        var a = T0 + stag(i, n, 1.0, 0.08, 1.35);
        var f = mix(prog(p, a, a + 1.0, eInOut), -0.1, c.level);
        var top = (1 - f) * 1.2;
        w.style.backgroundImage = waveURI(col) + ", linear-gradient(" + col + "," + col + ")";
        w.style.backgroundSize = ".9em .2em, 100% " + fx(Math.max(0, f * 1.2 + 0.1)) + "em";
        w.style.backgroundPosition = fx(-((p * 0.9 + i * 0.3) % 0.9)) + "em " + fx(top - 0.18) + "em, 0 " + fx(top) + "em";
      });
    },
  };

  // The text appears crisp, then its edges swell and roughen like ink soaking into paper.
  P_["ink-bleed"] = {
    build: function (line) {
      var P = parse(line), id = uid("bleed");
      var f = function (s) { return '<filter id="' + id + s + '" x="-20%" y="-20%" width="140%" height="140%"><feMorphology class="kt-mo' + s + '" operator="dilate" radius="0" in="SourceGraphic" result="fat"/><feTurbulence class="kt-tb" type="fractalNoise" baseFrequency="0.6" numOctaves="3" seed="4" result="noise"/><feDisplacementMap class="kt-dm' + s + '" in="fat" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>'; };
      return '<svg width="0" height="0" style="position:absolute">' + f("w") + f("k") + "</svg>" +
        fitRoot(P, wordsHTML(P, { wstyle: function (w, i, key) { return "filter:url(#" + id + (key ? "k" : "w") + ");"; } }), LINE + "font-weight:600;");
    },
    tick: function (el, p) {
      var fs = fsOf(el), k = prog(p, 0.2, 1.4, eOut);
      rootOf(el).style.opacity = prog(p, 0, 0.3);
      all(el, ".kt-tb").forEach(function (t) { t.setAttribute("baseFrequency", fx(12.6 / fs)); });
      [["w", 0.03, 0.1], ["k", 0.045, 0.14]].forEach(function (s) {
        var mo = one(el, ".kt-mo" + s[0]), dm = one(el, ".kt-dm" + s[0]);
        if (mo) mo.setAttribute("radius", fx(k * s[1] * fs, 2));
        if (dm) dm.setAttribute("scale", fx(mix(k, 0.01, s[2]) * fs, 2));
      });
    },
  };

  // The text sits on a waterline with a flipped, faded copy below it that ripples.
  P_["water-reflection"] = {
    build: function (line) {
      var P = parse(line), id = uid("water");
      return '<svg width="0" height="0" style="position:absolute"><filter id="' + id + '" x="-10%" y="-20%" width="120%" height="140%"><feTurbulence class="kt-tb" type="fractalNoise" baseFrequency="0.05 0.5" numOctaves="2" seed="1" result="n"/><feDisplacementMap class="kt-dm" in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter></svg>' +
        fitRoot(P, '<div class="kt-up" style="' + LINE + '">' + wordsHTML(P) + '</div><div class="kt-wl" style="align-self:stretch;height:.025em;min-height:1px;margin:.04em 0;background:' + INK + '"></div>' +
          '<div class="kt-dn" style="' + LINE + "transform:scaleY(-1);filter:url(#" + id + ') blur(.006em);-webkit-mask-image:linear-gradient(to top,#000 0%,transparent 90%);mask-image:linear-gradient(to top,#000 0%,transparent 90%)">' + wordsHTML(P) + "</div>", "display:flex;flex-direction:column;align-items:stretch;");
    },
    tick: function (el, p) {
      var fs = fsOf(el), rise = prog(p, T0, 0.85, eOut);
      var up = one(el, ".kt-up"), wl = one(el, ".kt-wl"), dn = one(el, ".kt-dn"), tb = one(el, ".kt-tb"), dm = one(el, ".kt-dm");
      if (up) { up.style.opacity = rise; up.style.transform = "translateY(" + fx((1 - rise) * -0.2) + "em)"; }
      if (wl) wl.style.opacity = 0.25 * prog(p, 0.25, 0.85);
      if (dn) dn.style.opacity = 0.35 * prog(p, 0.4, 1.3);
      if (tb) { tb.setAttribute("seed", Math.floor(p * 15)); tb.setAttribute("baseFrequency", fx(1.9 / fs) + " " + fx(17 / fs)); }
      if (dm) dm.setAttribute("scale", fx(0.11 * fs, 2));
    },
  };

  // Smoke dissolve (exit): the text holds, then word by word it swirls, blurs, spreads and drifts up until gone.
  P_["smoke-dissolve"] = {
    build: function (line) {
      var P = parse(line), id = uid("smoke");
      return '<svg width="0" height="0" style="position:absolute"><filter id="' + id + '" x="-60%" y="-120%" width="220%" height="340%"><feTurbulence class="kt-tb" type="fractalNoise" baseFrequency="0.08" numOctaves="3" seed="1" result="n"/><feDisplacementMap class="kt-dm" in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter></svg>' +
        withFilter(fitRoot(P, wordsHTML(P), LINE), id);
    },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length, r = rootOf(el), fs = fsOf(el);
      var out = prog(p, EXIT[0], EXIT[1]);
      r.style.opacity = prog(p, T0, 0.4);
      var maxP = 0;
      ws.forEach(function (w, i) {
        var a = stag(i, n, 0.7, 0.12, 1);
        var q = out > 0 ? prog(out, a, a + 0.7, eInOut) : 0;
        maxP = Math.max(maxP, q);
        w.style.opacity = 1 - q;
        w.style.filter = q > 0 ? "blur(" + fx(q * 0.07) + "em)" : "none";
        w.style.transform = "translateY(" + fx(-q * 0.8) + "em)";
        w.style.letterSpacing = fx(q * 0.15) + "em";
      });
      var tb = one(el, ".kt-tb"), dm = one(el, ".kt-dm");
      if (tb) { tb.setAttribute("seed", Math.floor(p * 10) % 50); tb.setAttribute("baseFrequency", fx(1.7 / fs)); }
      if (dm) dm.setAttribute("scale", fx(maxP * fs, 2));
      r.style.filter = maxP > 0 ? r.getAttribute("data-filter") : "none";
    },
  };

  // ---------------------------------------------------------------- 9 · 3D surfaces

  // A mirror-like metal inside the letters: sky above a horizon, dark ground below; the horizon sweeps into place.
  P_.chrome = {
    dark: true,
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, { noColor: true, wstyle: function (w, i, key) { return "color:transparent;-webkit-background-clip:text;background-clip:text;-webkit-text-stroke:.012em " + (key ? ACC : "#C9D3DF") + ";filter:drop-shadow(0 .03em .05em rgba(0,0,0,.6));"; } }), LINE + "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el), s = prog(p, 0.3, 1.4, eInOut);
      var h = mix(s, 8, 50) + Math.sin(p * 1.6) * 5 * s;
      var metal = function (sky, ground) { return "linear-gradient(180deg,#E9F3FF 0%," + sky + " " + fx(h - 14, 1) + "%,#FFFFFF " + fx(h - 1, 1) + "%,#2B2118 " + fx(h, 1) + "%," + ground + " " + fx(h + 18, 1) + "%,#F0D9B5 100%)"; };
      var plain = metal("#8DB7E8", "#8A6F55"), keyed = metal("color-mix(in srgb," + ACC + " 70%,white)", "color-mix(in srgb," + ACC + " 80%,black)");
      all(el, ".kt-w").forEach(function (w) { w.style.backgroundImage = w.hasAttribute("data-key") ? keyed : plain; });
      r.style.opacity = prog(p, 0.15, 0.5);
      r.style.transform = "scale(" + fx(mix(prog(p, 0, 0.9, eOut), 0.92, 1)) + ")";
    },
  };

  // A rainbow sheen slides across the letters like a foil sticker; the words sweep on left to right.
  var FOIL = ["#F77FC6", "#6FC9F2", "#8EDB8A", "#F2CF5B"];
  P_.holographic = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, { noColor: true, wstyle: function (w, i, key) { return "color:transparent;-webkit-background-clip:text;background-clip:text;background-repeat:no-repeat;-webkit-text-stroke:" + (key ? ".02em " + ACC : ".014em color-mix(in srgb," + INK + " 55%,transparent)") + ";"; } }), LINE + "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el), spans = spreadBackground(el, ".kt-w"), n = spans.length;
      var band = Math.max(r.offsetWidth, fsOf(el)) * 0.6, period = band * FOIL.length;
      var shift = ((p * 0.35 * band) % period) - period;
      var ang = 100 + Math.sin(p * 2) * 20;
      var foil = "repeating-linear-gradient(" + fx(ang, 1) + "deg," + FOIL.concat(FOIL[0]).map(function (c, i) { return c + " " + fx(i * band + shift, 1) + "px"; }).join(",") + ")";
      spans.forEach(function (s, i) {
        var a = T0 + stag(i, n, 0.5, 0.1, 1.3), q = prog(p, a, a + 0.5, eOut);
        s.style.backgroundImage = foil;
        s.style.opacity = q;
        s.style.transform = "translateX(" + fx(mix(q, -0.3, 0)) + "em)";
      });
    },
  };

  // Letters swell like balloons, with a soft highlight and a shade that suggest a round surface.
  function balloon(c) { return "radial-gradient(circle at 35% 28%,#FFFFFF 0%,color-mix(in srgb," + c + " 45%,white) 18%," + c + " 55%,color-mix(in srgb," + c + " 70%,black) 100%)"; }
  P_.inflated = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        noColor: true,
        inner: function (w, i, key) {
          var c = key ? ACC : "#FF6F9A";
          return Array.from(w).map(function (ch) {
            return '<span class="kt-c" style="display:inline-block;color:transparent;background-image:' + balloon(c) + ";-webkit-background-clip:text;background-clip:text;-webkit-text-stroke:.055em " + c + ";paint-order:stroke fill;filter:drop-shadow(0 .06em .06em color-mix(in srgb," + c + ' 40%,transparent));transform-origin:50% 80%">' + esc(ch) + "</span>";
          }).join("");
        },
      }), LINE + "font-weight:900;column-gap:.35em;");
    },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length;
      var breathe = 1 + Math.sin(p * 4) * 0.012 * prog(p, 1.5, 1.9);
      cs.forEach(function (c, i) {
        var a = T0 + stag(i, N, 0.6, 0.04, 1.35);
        var x = prog(p, a, a + 0.6);
        var el2 = x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin(((x * 10 - 0.75) * 2 * Math.PI) / 3 / 1.2) + 1;
        c.style.opacity = prog(p, a, a + 0.1);
        c.style.transform = "scale(" + fx(mix(el2, 0.3, 1) * breathe) + ")";
      });
    },
  };

  // Every letter sits on a spinning can; it slows to a stop with the text facing you, then sways.
  P_["wrapped-on-a-cylinder"] = {
    build: function (line) { return letterRoot(line, ""); },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), r = rootOf(el), fs = fsOf(el);
      var g = measured(el, "cyl", function () {
        var lb = letterBoxes(el), W = r.offsetWidth, H = r.offsetHeight;
        return { lb: lb, cx: W / 2, cy: H / 2, R: Math.max(fs, W / 2 / 0.9) };
      });
      var R = g.R, Pp = 3 * R;
      var spin = (prog(p, T0, 1.4, eOut) - 1) * Math.PI * 2 + Math.sin(p * 1.2) * 0.07 * prog(p, 1.4, 1.9);
      r.style.opacity = prog(p, T0, 0.35);
      cs.forEach(function (c, i) {
        var b = g.lb[i];
        if (!b) return;
        var s = b.cx - g.cx, a = s / R + spin, cos = Math.cos(a), D = Pp + R * (1 - cos), f = Pp / D;
        var sx = (Pp * ((Pp + R) * cos - R)) / (D * D);
        var nx = R * Math.sin(a) * f;
        c.style.transform = "translate(" + fx(nx - s, 1) + "px," + fx((b.cy - g.cy) * (f - 1), 1) + "px) scale(" + fx(sx) + "," + fx(f) + ")";
        c.style.opacity = sx > 0 ? 1 : 0.12;
      });
    },
  };

  // ---------------------------------------------------------------- 10 · Screen and print looks

  // A dark board of dots; only the dots inside the letters light up. The text scrolls in from the right.
  P_["led-board"] = {
    dark: true,
    build: function (line) { var P = parse(line); return CANVAS + fitRoot(P, wordsHTML(P, { noColor: true }), LINE + "font-weight:900;color:transparent;"); },
    tick: function (el, p) {
      var cv = canvas(el);
      if (!cv) return;
      var cell = cellFor(el, 5000, fsOf(el) / 9);
      var g = inkGrid(el, cell, cell);
      var shift = Math.round((1 - prog(p, T0, 1.3, eOut)) * g.cols);
      var rr = cell * 0.36, x0 = cv.x, y0 = cv.y, ctx = cv.ctx;
      var on = "#FFB627", key = "#5CFF7A";
      ctx.globalAlpha = prog(p, 0, 0.15);
      ctx.fillStyle = "#2A2B33";
      var row, col;
      for (row = -1; row <= g.rows; row++) for (col = -1; col <= g.cols; col++) { ctx.beginPath(); ctx.arc(x0 + (col + 0.5) * cell, y0 + (row + 0.5) * cell, rr, 0, 6.2832); ctx.fill(); }
      ctx.shadowBlur = cell * 0.9;
      for (row = 0; row < g.rows; row++) {
        for (col = shift; col < g.cols; col++) {
          var i = row * g.cols + (col - shift);
          if (g.ink[i] < 0.4) continue;
          ctx.fillStyle = ctx.shadowColor = g.key[i] ? key : on;
          ctx.beginPath();
          ctx.arc(x0 + (col + 0.5) * cell, y0 + (row + 0.5) * cell, rr, 0, 6.2832);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },
  };

  // Chunky blocks sharpen into crisp text as the grid gets finer, in steps.
  var PIXEL_STEPS = [0.8, 0.4, 0.2, 0.1];
  P_["pixelate-reveal"] = {
    build: function (line) { var P = parse(line); return CANVAS + fitRoot(P, wordsHTML(P, { noColor: true }), LINE + "font-weight:900;"); },
    tick: function (el, p) {
      var r = rootOf(el), cv = canvas(el), fs = fsOf(el);
      var k = Math.floor(prog(p, T0, 1.3) * PIXEL_STEPS.length);
      var crisp = p < T0 ? 0 : k >= PIXEL_STEPS.length ? 1 : 0;
      r.style.color = crisp ? "" : "transparent";
      var key = one(el, ".kt-fit > [data-key]");
      if (key) key.style.color = crisp ? ACC : "transparent";
      if (!cv || crisp || p < T0) return;
      var cell = Math.max(PIXEL_STEPS[k] * fs, cellFor(el, 4000, 1.5));
      var g = inkGrid(el, cell, cell);
      var ink = cssVar(el, "--kt-ink", "#1E1E24"), acc = cssVar(el, "--kt-accent", ACC_HEX);
      for (var i = 0; i < g.ink.length; i++) {
        if (g.ink[i] < 0.02) continue;
        cv.ctx.globalAlpha = Math.min(1, g.ink[i] * 1.4);
        cv.ctx.fillStyle = g.key[i] ? acc : ink;
        cv.ctx.fillRect(cv.x + (i % g.cols) * cell, cv.y + Math.floor(i / g.cols) * cell, cell + 0.5, cell + 0.5);
      }
      cv.ctx.globalAlpha = 1;
    },
  };

  // The word is rebuilt from printed dots: more ink, bigger dot; the dots grow in left to right.
  P_.halftone = {
    build: function (line) { var P = parse(line); return CANVAS + fitRoot(P, wordsHTML(P, { noColor: true }), LINE + "font-weight:900;color:transparent;"); },
    tick: function (el, p) {
      var cv = canvas(el);
      if (!cv) return;
      var cell = cellFor(el, 5000, fsOf(el) / 9);
      var g = inkGrid(el, cell, cell);
      var ink = cssVar(el, "--kt-ink", "#1E1E24"), acc = cssVar(el, "--kt-accent", ACC_HEX), ctx = cv.ctx;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.18 * prog(p, 0, 0.35);
      for (var j = 0; j < g.ink.length; j++) { ctx.beginPath(); ctx.arc(cv.x + ((j % g.cols) + 0.5) * cell, cv.y + (Math.floor(j / g.cols) + 0.5) * cell, cell * 0.13, 0, 6.2832); ctx.fill(); }
      ctx.globalAlpha = 1;
      for (var i = 0; i < g.ink.length; i++) {
        var v = g.ink[i];
        if (v < 0.04) continue;
        var c = i % g.cols, a = T0 + (c / Math.max(1, g.cols)) * 0.65;
        var grow = prog(p, a, a + 0.7, eOut);
        if (grow <= 0) continue;
        ctx.fillStyle = g.key[i] ? acc : ink;
        ctx.beginPath();
        ctx.arc(cv.x + (c + 0.5) * cell, cv.y + (Math.floor(i / g.cols) + 0.5) * cell, Math.sqrt(v) * cell * 0.64 * grow, 0, 6.2832);
        ctx.fill();
      }
    },
  };

  // Each cell becomes a character — "." for a little ink, "@" for a lot — printed top to bottom over a drizzle of 0s and 1s.
  var RAMP = " .:-=+*#%@";
  P_.ascii = {
    dark: true,
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, { noColor: true }) + '<pre class="kt-asc" aria-hidden="true" style="position:absolute;left:0;top:0;margin:0;font-family:' + MONO + ';font-weight:700;color:#5CFF9D;text-align:left;white-space:pre"></pre>', LINE + "font-weight:900;color:transparent;");
    },
    tick: function (el, p) {
      var pre = one(el, ".kt-asc"), c = mem(el);
      if (!pre) return;
      var cw = cellFor(el, 3500, fsOf(el) / 11) / Math.SQRT2, chh = cw * 2;
      var g = inkGrid(el, cw, chh);
      var printed = prog(p, T0, 1.35, eInOut) * 1.05, noise = Math.floor(p * 15);
      var sig = g.cols + "x" + g.rows + "|" + Math.floor(printed * g.rows) + "|" + (printed * g.rows < g.rows ? noise : -1);
      if (c.asc === sig) return;
      c.asc = sig;
      pre.style.fontSize = fx(cw / 0.6, 2) + "px";
      pre.style.lineHeight = fx(chh, 2) + "px";
      var html = "";
      for (var r = 0; r < g.rows; r++) {
        var shown = r / g.rows < printed, run = "", runKey = false;
        for (var col = 0; col < g.cols; col++) {
          var i = r * g.cols + col;
          var ch = shown ? RAMP[Math.min(RAMP.length - 1, Math.floor(g.ink[i] * RAMP.length))] : rnd(i, noise) < 0.08 ? (rnd(i + 1, noise) < 0.5 ? "0" : "1") : " ";
          var k = shown && g.key[i] === 1;
          if (k !== runKey && run) { html += runKey ? '<span style="color:' + ACC + '">' + esc(run) + "</span>" : esc(run); run = ""; }
          runKey = k;
          run += ch;
        }
        html += (runKey ? '<span style="color:' + ACC + '">' + esc(run) + "</span>" : esc(run)) + "\n";
      }
      pre.innerHTML = html;
    },
  };

  // An 80s video-tape picture: colour fringes, jitter, a rolling noise band, scanlines; it rolls in like a tape finding its tracking.
  P_.vhs = {
    dark: true,
    build: function (line) {
      var P = parse(line), plain = wordsHTML(P);
      var lbl = "position:absolute;top:.5em;font-family:" + MONO + ";font-weight:700;font-size:.42em;color:#FFFFFF;z-index:2";
      return '<div style="' + lbl + ';left:.7em">PLAY ▶</div><div class="kt-tc" style="' + lbl + ';right:.7em">SP 0:14</div>' +
        fitRoot(P, '<div class="kt-tape" style="position:relative">' + layer("vr", wordsHTML(P, { noColor: true }), "color:#FF2A4D;mix-blend-mode:screen;opacity:.8;") + layer("vc", wordsHTML(P, { noColor: true }), "color:#00E5FF;mix-blend-mode:screen;opacity:.8;") +
          '<div style="' + LINE + 'position:relative;opacity:.92">' + plain + "</div></div>", "font-weight:900;color:#FFFFFF;") +
        '<div class="kt-band" style="position:absolute;left:0;right:0;height:.3em;background:linear-gradient(180deg,transparent,rgba(255,255,255,.18),transparent)"></div>' +
        '<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.25) 0 2px,transparent 2px 5px);pointer-events:none"></div>';
    },
    tick: function (el, p) {
      var tape = one(el, ".kt-tape"), vr = one(el, ".kt-vr"), vc = one(el, ".kt-vc"), band = one(el, ".kt-band"), tc = one(el, ".kt-tc");
      var track = prog(p, 0, 1.0, eOut), fringe = mix(prog(p, 0.3, 1.4, eInOut), 0.12, 0.03);
      var jit = (rnd(7, Math.floor(p * 30)) - 0.5) * 0.025;
      rootOf(el).style.opacity = prog(p, 0, 0.15);
      if (tape) tape.style.transform = "translate(" + fx(jit) + "em," + fx(-(1 - track) * 2.5) + "em)";
      if (vr) vr.style.transform = "translateX(" + fx(-fringe) + "em)";
      if (vc) vc.style.transform = "translateX(" + fx(fringe) + "em)";
      if (band) band.style.top = fx(((p * 0.45) % 1) * 110 - 5, 1) + "%";
      if (tc) tc.textContent = "SP 0:" + String(14 + Math.floor(p)).padStart(2, "0");
    },
  };

  // ---------------------------------------------------------------- 11 · Hand-made and analogue

  var CUT_FONTS = [FONT, SERIF, MONO, "Impact,'Arial Black',sans-serif", HAND, "'Times New Roman',serif"];
  var CUT_PAPERS = ["#FFFFFF", YELLOW, "#1E1E24", "#BFE3DD", "#FFFFFF", "#E8D7FF", "#D9E4F5"];
  // Every letter is cut from a different magazine and pasted on one by one; the cut-outs keep jittering.
  P_["ransom-note-collage"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        noColor: true,
        wstyle: function () { return "display:inline-flex;align-items:center;gap:.04em;"; },
        inner: function (w, i, key, gi) {
          return Array.from(w).map(function (ch, j) {
            var g = gi + j, paper = key ? ACC : CUT_PAPERS[Math.floor(rnd(g, 61) * CUT_PAPERS.length)];
            var dark = key || paper === "#1E1E24";
            return '<span class="kt-c" style="display:inline-block;font-family:' + CUT_FONTS[Math.floor(rnd(g, 62) * CUT_FONTS.length)] + ";font-size:" + fx(0.86 + rnd(g, 63) * 0.24) + "em;line-height:1.1;background:" + paper + ";color:" + (dark ? "#FFFFFF" : INK) + ';padding:.02em .08em;box-shadow:.03em .04em 0 rgba(0,0,0,.15)">' + esc(ch) + "</span>";
          }).join("");
        },
      }), LINE + "font-weight:700;line-height:1.4;row-gap:.1em;");
    },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length, step = Math.floor(p / 0.1), settled = prog(p, 1.3, 1.6);
      cs.forEach(function (c, i) {
        var at = T0 + stag(i, N, 0.2, 0.06, 1.3), wob = mix(settled, 1, 0.45);
        c.style.opacity = p >= at ? 1 : 0;
        c.style.transform = "translateY(" + fx((rnd(i, step + 500) - 0.5) * 0.05 * wob) + "em) rotate(" + fx((rnd(i, step) - 0.5) * 6 * wob + (rnd(i, 64) - 0.5) * 8, 2) + "deg) scale(" + fx(mix(pop(p, at, 0.2, 3), 1.3, 1)) + ")";
      });
    },
  };

  // Every letter is a paper card hopping in at a choppy 8 frames a second, each pose slightly off.
  P_["paper-stop-motion"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        wstyle: function () { return "display:inline-flex;gap:.08em;"; },
        cstyle: function () { return "background:#FFFDF6;padding:.05em .1em;line-height:1.15;box-shadow:.04em .06em 0 rgba(0,0,0,.12);clip-path:polygon(1% 2%,99% 0%,100% 97%,0% 100%);"; },
        letters: true,
      }), LINE + "font-weight:900;line-height:1.45;row-gap:.15em;column-gap:.4em;");
    },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length, k = Math.floor(p * 8), pq = k / 8;
      cs.forEach(function (c, i) {
        var a = T0 + stag(i, N, 0.6, 0.06, 1.3), q = prog(pq, a, a + 0.6, eOut);
        var hop = Math.sin(q * Math.PI) * 0.7;
        var jx = (rnd(i, k + 70) - 0.5) * 0.035, jy = (rnd(i, k + 71) - 0.5) * 0.035;
        c.style.opacity = q > 0 ? 1 : 0;
        c.style.transform = "translate(" + fx((1 - q) * -3 + jx) + "em," + fx(-hop + jy) + "em) rotate(" + fx((rnd(i, k + 72) - 0.5) * 4 + (1 - q) * -30, 2) + "deg)";
      });
    },
  };

  // Old cinema: a dark sepia frame with grain, flicker, the odd scratch, and a frame that wobbles.
  P_["faux-film"] = {
    dark: true,
    build: function (line) {
      var P = parse(line), id = uid("film");
      return '<div class="kt-frame" style="position:absolute;inset:0;background:#1A1712"><div class="kt-scr" style="position:absolute;top:0;bottom:0;width:2px;background:rgba(255,255,255,.35)"></div><div class="kt-dust" style="position:absolute;width:.12em;height:.12em;border-radius:50%;background:rgba(0,0,0,.7)"></div></div>' +
        fitRoot(P, wordsHTML(P), LINE + "font-family:" + SERIF + ";font-weight:700;letter-spacing:.04em;color:#F1E6CF;") +
        '<svg style="position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:overlay;opacity:.55;pointer-events:none"><filter id="' + id + '"><feTurbulence class="kt-tb" type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="1"/></filter><rect width="100%" height="100%" filter="url(#' + id + ')"/></svg>' +
        '<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,.6) 100%);pointer-events:none"></div>';
    },
    tick: function (el, p) {
      var f = Math.floor(p * 24), R = function (k) { return rnd(k, f); };
      var r = rootOf(el), frame = one(el, ".kt-frame"), scr = one(el, ".kt-scr"), dust = one(el, ".kt-dust"), tb = one(el, ".kt-tb");
      if (frame) frame.style.filter = "brightness(" + fx(0.9 + R(1) * 0.2) + ") sepia(.4)";
      if (scr) { scr.style.display = R(2) < 0.5 ? "block" : "none"; scr.style.left = fx(R(3) * 100, 1) + "%"; }
      if (dust) { dust.style.display = R(4) < 0.2 ? "block" : "none"; dust.style.left = fx(R(5) * 100, 1) + "%"; dust.style.top = fx(R(6) * 80, 1) + "%"; }
      if (tb) tb.setAttribute("seed", f % 100);
      r.style.transform = "translate(" + fx((R(7) - 0.5) * 0.03) + "em," + fx((R(8) - 0.5) * 0.04) + "em)";
      r.style.opacity = prog(p, 0.15, 0.8) * (p < 0.8 ? 0.75 + R(9) * 0.25 : 1);
      r.style.filter = "sepia(.4) brightness(" + fx(0.92 + R(10) * 0.16) + ")";
    },
  };

  // Handwriting on a chalkboard: grainy strokes that write themselves on, word by word.
  P_.chalk = {
    dark: true,
    build: function (line) {
      var P = parse(line), id = uid("chalk");
      return '<div style="position:absolute;inset:0;background:#2F4A3A;border:.25em solid #8A5A36;box-sizing:border-box"></div>' +
        '<svg width="0" height="0" style="position:absolute"><filter id="' + id + '" x="-5%" y="-10%" width="110%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.2 1.6" result="holes"/><feComposite in="SourceGraphic" in2="holes" operator="in" result="grainy"/><feTurbulence class="kt-tb" type="fractalNoise" baseFrequency="0.07" numOctaves="1" seed="1" result="w"/><feDisplacementMap in="grainy" in2="w" scale="1" xChannelSelector="R" yChannelSelector="G"/></filter></svg>' +
        fitRoot(P, wordsHTML(P, { keyColor: "var(--kt-accent," + YELLOW + ")" }), LINE + "font-family:" + HAND + ";font-weight:700;color:#F5F5EE;filter:url(#" + id + ");");
    },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length, tb = one(el, ".kt-tb");
      if (tb) tb.setAttribute("seed", Math.floor(p * 6));
      ws.forEach(function (w, i) {
        var a = T0 + stag(i, n, 0.35, 0.22, 1.4);
        w.style.clipPath = "inset(-20% " + fx(100 - prog(p, a, a + 0.35, eInOut) * 100, 2) + "% -20% -5%)";
      });
    },
  };

  // ---------------------------------------------------------------- 12 · Paths and geometry

  function svgSpans(P) {
    return P.words.map(function (w, i) { return '<tspan style="fill:' + (i === P.k ? ACC : INK) + '">' + esc(w) + "</tspan>"; }).join(" ");
  }
  function polyline(pts) {
    var d = "", len = 0;
    pts.forEach(function (q, i) {
      d += (i === 0 ? "M" : "L") + fx(q[0], 1) + " " + fx(q[1], 1) + " ";
      if (i > 0) len += Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]);
    });
    return { d: d, len: len };
  }
  var CHAR_W = 0.6; // average Poppins character width, in em

  // Letters ride along a curve — two waves of y = sin x; the curve draws itself, then the text slides into place.
  P_["text-on-a-path"] = {
    build: function (line) {
      var P = parse(line), id = uid("sine");
      var pts = [];
      for (var i = 0; i <= 160; i++) { var x = (i / 160) * 344; pts.push([28 + x, 80 - Math.sin((x / 344) * Math.PI * 4) * 26]); }
      var pl = polyline(pts);
      var fs = Math.min(22, 26 * 0.9, (0.94 * pl.len) / (Math.max(1, P.chars) * CHAR_W));
      return sceneRoot(P, '<svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;overflow:visible"><path id="' + id + '" d="' + pl.d + '" fill="none"/>' +
        '<path class="kt-curve" d="' + pl.d + '" fill="none" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" stroke-linecap="round" stroke-width="' + fx(Math.max(1.5, fs * 0.05), 2) + '" style="stroke:' + INK + ';stroke-opacity:.18"/>' +
        '<text font-size="' + fx(fs, 2) + '" font-weight="800" text-anchor="middle" dominant-baseline="middle" style="font-family:' + FONT + '"><textPath class="kt-tp" href="#' + id + '" data-len="' + fx(pl.len, 1) + '" data-w="' + fx(P.chars * CHAR_W * fs, 1) + '" startOffset="' + fx(pl.len / 2, 1) + '">' + svgSpans(P) + "</textPath></text></svg>");
    },
    tick: function (el, p) {
      var curve = one(el, ".kt-curve"), tp = one(el, ".kt-tp");
      if (curve) curve.setAttribute("stroke-dashoffset", fx(1 - prog(p, T0, 0.85, eInOut)));
      if (tp) {
        var len = +tp.getAttribute("data-len"), w = +tp.getAttribute("data-w");
        tp.setAttribute("startOffset", fx(mix(prog(p, 0.3, 1.5, eOut), -w / 2, len / 2), 1));
      }
    },
  };

  // Words run round a circle that slowly rotates; the key word sits in an accent disc in the middle.
  P_["circular-badge"] = {
    build: function (line) {
      var P = parse(line), id = uid("badge");
      var R = 70, circ = 2 * Math.PI * R, unitChars = P.chars + 3;
      var n = Math.max(1, Math.round(circ / (unitChars * CHAR_W * 0.17 * R)));
      var fs = Math.min(26, circ / (n * unitChars * CHAR_W));
      var ring = new Array(n).fill(svgSpans(P)).join(" · ") + " · ";
      var key = P.k >= 0 ? headWord(P) : "✓";
      var keyFs = Math.min(0.5 * 0.58 * R, (1.5 * 0.58 * R) / (Math.max(1, Array.from(key).length) * CHAR_W));
      return sceneRoot(P, '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block"><g class="kt-spin" style="transform-origin:100px 100px">' +
        '<path id="' + id + '" d="M 30 100 a 70 70 0 1 1 140 0 a 70 70 0 1 1 -140 0" fill="none"/>' +
        '<text font-size="' + fx(fs, 2) + '" font-weight="800" style="font-family:' + FONT + '"><textPath href="#' + id + '" textLength="' + fx(circ * 0.995, 1) + '" lengthAdjust="spacing">' + ring + "</textPath></text></g>" +
        '<g class="kt-disc" style="transform-origin:100px 100px"><circle cx="100" cy="100" r="' + fx(0.58 * R, 1) + '" style="fill:' + ACC + '"/><text x="100" y="100" text-anchor="middle" dominant-baseline="central" font-size="' + fx(keyFs, 2) + '" font-weight="900" style="fill:#FFFFFF;font-family:' + FONT + '">' + esc(key) + "</text></g></svg>");
    },
    tick: function (el, p) {
      var spin = one(el, ".kt-spin"), disc = one(el, ".kt-disc");
      rootOf(el).style.opacity = prog(p, 0, 0.3);
      if (spin) spin.style.transform = "rotate(" + fx(p * 15, 2) + "deg) scale(" + fx(mix(prog(p, 0, 0.9, eInOut), 0.6, 1)) + ")";
      if (disc) disc.style.transform = "scale(" + fx(prog(p, 0.45, 1.2, eOut)) + ")";
    },
  };

  // Text flows in along a spiral, curling towards the centre, and the spiral slowly turns.
  P_.spiral = {
    build: function (line) {
      var P = parse(line), id = uid("spiral");
      var Rout = 88, Rin = 0.14 * Rout, TURNS = 3, N = 400, pts = [];
      for (var i = 0; i <= N; i++) {
        var th = -Math.PI + (i / N) * TURNS * Math.PI * 2, rr = Rout - (Rout - Rin) * (i / N);
        pts.push([100 + rr * Math.cos(th), 100 + rr * Math.sin(th)]);
      }
      var pl = polyline(pts);
      var w1 = Math.max(1, P.chars) * CHAR_W, sep = 3 * CHAR_W;
      var fs = Math.min(22, ((Rout - Rin) / TURNS) * 0.72, (0.95 * pl.len) / w1);
      var copies = Math.max(1, Math.floor((0.95 * pl.len) / fs / (w1 + sep)));
      var textW = copies * (w1 + sep) * fs;
      return sceneRoot(P, '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block"><g class="kt-spin" style="transform-origin:100px 100px"><path id="' + id + '" d="' + pl.d + '" fill="none"/>' +
        '<text font-size="' + fx(fs, 2) + '" font-weight="800" style="font-family:' + FONT + '"><textPath class="kt-tp" href="#' + id + '" data-len="' + fx(pl.len, 1) + '" data-w="' + fx(textW, 1) + '" startOffset="' + fx(pl.len * 0.005, 1) + '">' + new Array(copies).fill(svgSpans(P)).join(" · ") + "</textPath></text></g></svg>");
    },
    tick: function (el, p) {
      var spin = one(el, ".kt-spin"), tp = one(el, ".kt-tp");
      rootOf(el).style.opacity = prog(p, 0, 0.25);
      if (spin) spin.style.transform = "rotate(" + fx(-p * 6, 2) + "deg)";
      if (tp) tp.setAttribute("startOffset", fx(mix(prog(p, T0, 1.4, eOut), -(+tp.getAttribute("data-w")), +tp.getAttribute("data-len") * 0.005), 1));
    },
  };

  // ---------------------------------------------------------------- 13 · Repetition, layout and loops

  // The text swoops in and swings to rest; faded outline copies show where it was a moment earlier.
  var ECHOES = 9;
  P_.echo = {
    build: function (line) {
      var P = parse(line), inner = "";
      for (var k = ECHOES; k >= 1; k--) inner += layer("ec", wordsHTML(P, { noColor: true }), "color:transparent;-webkit-text-stroke:.015em " + ACC + ";");
      return fitRoot(P, inner + '<div class="kt-main" style="' + LINE + 'position:relative">' + wordsHTML(P) + "</div>", "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el), W = el.clientWidth, H = el.clientHeight, fs = fsOf(el);
      var moveEnd = 1.0, delay = 0.045;
      var at = function (s) {
        var q = clamp((s - T0) / moveEnd), e = (1 - q) * (1 - q);
        return [-Math.cos(q * Math.PI * 2.5) * e * 0.35 * W, Math.sin(q * Math.PI * 5) * e * 0.12 * H];
      };
      r.style.opacity = prog(p, T0, T0 + 0.08);
      var m = one(el, ".kt-main"), xy = at(p);
      if (m) m.style.transform = "translate(" + fx(xy[0], 1) + "px," + fx(xy[1], 1) + "px)";
      all(el, ".kt-ec").forEach(function (c, j) {
        var k = ECHOES - j, q = at(p - k * delay);
        var away = Math.min(1, Math.hypot(q[0], q[1]) / (0.15 * fs));
        c.style.opacity = Math.max(0, (0.65 - k * 0.05) * away);
        c.style.transform = "translate(" + fx(q[0], 1) + "px," + fx(q[1], 1) + "px)";
      });
    },
  };

  // The same text stacked in outline, like plates, fanning out up and to the right behind the filled front copy.
  var PLATES = 5, PLATE_DX = 0.2, PLATE_DY = -0.24; // plate offsets in em (wider than the component's, to read at preview size)
  P_["outline-stack"] = {
    build: function (line) {
      var P = parse(line), inner = "";
      for (var i = PLATES; i >= 1; i--) inner += layer("pl", wordsHTML(P, { noColor: true, wstyle: function (w, j, key) { return "color:transparent;-webkit-text-stroke:.02em " + (key ? ACC : INK) + ";"; } }), "opacity:" + fx(1 - i * 0.1, 2) + ";");
      return fitRoot(P, '<div class="kt-stack" style="position:relative">' + inner + '<div style="' + LINE + 'position:relative">' + wordsHTML(P) + "</div></div>", "font-weight:900;padding:" + fx(-PLATES * PLATE_DY, 2) + "em " + fx(PLATES * PLATE_DX, 2) + "em 0 0;");
    },
    tick: function (el, p) {
      var fan = prog(p, 0.2, 1.4, eInOut), ripple = Math.sin(fan * Math.PI);
      rootOf(el).style.opacity = prog(p, 0, 0.15);
      // Keep the whole stack centred as it fans out (the root's padding holds the fanned plates).
      var st = one(el, ".kt-stack");
      if (st) st.style.transform = "translate(" + fx(((1 - fan) * PLATES * PLATE_DX) / 2) + "em," + fx(((1 - fan) * PLATES * PLATE_DY) / 2) + "em)";
      all(el, ".kt-pl").forEach(function (pl, j) {
        var i = PLATES - j, wob = Math.sin(p * 6 - i * 0.5) * 0.06 * ripple;
        pl.style.transform = "translate(" + fx(i * PLATE_DX * fan + wob) + "em," + fx(i * PLATE_DY * fan) + "em)";
      });
    },
  };

  // Nested frames in a dark box, with the text along their walls, grow exponentially so they seem to fly at you forever.
  var TUNNEL = 7;
  P_["text-tunnel"] = {
    dark: true,
    build: function (line) {
      var P = parse(line), walls;
      var spans = function (ws, from) { return ws.map(function (w, j) { return from + j === P.k ? '<span class="kt-k">' + esc(w) + "</span>" : esc(w); }).join(" "); };
      if (P.chars <= 30) {
        var copies = Math.max(1, Math.floor(30 / (P.chars + 3)));
        var t = new Array(copies).fill(spans(P.words, 0)).join(" · ");
        walls = [t, "", t, ""];
        var hc = copies * (P.chars + 3), vc = 1;
      } else {
        var groups = [], from = 0, total = P.chars, cut = [0.32, 0.5, 0.82, 1], cur = [], acc = 0, wi = 0;
        P.words.forEach(function (w, i) {
          cur.push(w);
          acc += w.length + 1;
          if (wi < 3 && acc >= total * cut[wi] && i < P.words.length - 1) { groups.push({ w: cur, from: from }); from = i + 1; cur = []; wi++; }
        });
        groups.push({ w: cur, from: from });
        while (groups.length < 4) groups.push({ w: [], from: 0 });
        walls = groups.map(function (g) { return spans(g.w, g.from); });
        var len = function (g) { return Array.from(g.w.join(" ")).length; };
        hc = Math.max(len(groups[0]), len(groups[2]), 1);
        vc = Math.max(len(groups[1]), len(groups[3]), 1);
      }
      var size = "min(9cqh," + fx(86 / (hc * CHAR_W), 2) + "cqw," + fx(66 / (vc * CHAR_W), 2) + "cqh)";
      var place = [
        "left:50%;top:calc(3cqh + .6em);transform:translate(-50%,-50%)",
        "left:calc(100% - 3cqh - .6em);top:50%;transform:translate(-50%,-50%) rotate(90deg)",
        "left:50%;top:calc(100% - 3cqh - .6em);transform:translate(-50%,-50%) rotate(180deg)",
        "left:calc(3cqh + .6em);top:50%;transform:translate(-50%,-50%) rotate(270deg)",
      ];
      var frame = '<div class="kt-fr" style="position:absolute;inset:0;border:2px solid;box-sizing:border-box;container-type:size;font-size:' + size + '">' +
        walls.map(function (w, i) { return w ? '<div style="position:absolute;white-space:pre;line-height:1.2;' + place[i] + '">' + w + "</div>" : ""; }).join("") + "</div>";
      return sceneRoot(P, '<div style="position:absolute;inset:0;container-type:size">' + new Array(TUNNEL).fill(frame).join("") + "</div>", "font-weight:900;background:#1E1E24;");
    },
    tick: function (el, p) {
      var frs = all(el, ".kt-fr"), c = mem(el);
      if (!c.acc) c.acc = cssVar(el, "--kt-accent", ACC_HEX);
      var s = Math.min(p, 1.2), travel = 0.25 * p + 1.35 * (s - (s * s) / 2.4);
      rootOf(el).style.opacity = prog(p, 0, 0.2);
      frs.forEach(function (f, i) {
        var z = (i + (travel % 1)) / TUNNEL, scale = 0.06 * Math.pow(22, z);
        var n = i - Math.floor(travel), col = n % 2 === 0 ? c.acc : PAPER, other = col === PAPER ? c.acc : PAPER;
        f.style.transform = "scale(" + fx(scale, 4) + ")";
        f.style.borderWidth = fx(2 / scale, 2) + "px";
        f.style.borderColor = col;
        f.style.color = col;
        f.style.zIndex = i;
        f.style.opacity = Math.min(1, z * 2.5) * (1 - prog(z, 0.88, 1));
        var ks = f.__k || (f.__k = Array.prototype.slice.call(f.querySelectorAll(".kt-k")));
        setAll(ks, "color", other);
      });
    },
  };

  // Three bands of the text scroll in opposite directions and wrap around seamlessly; the middle band is on an accent strip.
  P_.marquee = {
    build: function (line) {
      var P = parse(line);
      var unit = function (band) {
        return '<span class="kt-u">' + P.words.map(function (w, i) { return i === P.k ? '<span style="color:' + (band === 1 ? INK : ACC) + '">' + esc(w) + "</span>" : esc(w); }).join(" ") + " ✦ </span>";
      };
      var copies = Math.max(3, Math.ceil(60 / Math.max(1, P.chars + 3)) + 1);
      var bands = [0, 1, 2].map(function (b) {
        return '<div style="' + (b === 1 ? "background:" + ACC + ";color:" + PAPER + ";" : "") + 'overflow:hidden"><div class="kt-band" style="white-space:pre;line-height:1.08;font-size:24cqh;display:inline-block">' + new Array(copies).fill(unit(b)).join("") + "</div></div>";
      }).join("");
      return sceneRoot(P, '<div style="position:absolute;inset:0;container-type:size;display:flex;flex-direction:column;justify-content:center;gap:1cqh;text-align:left">' + bands + "</div>", "font-weight:900;");
    },
    tick: function (el, p) {
      var bands = all(el, ".kt-band"), W = el.clientWidth;
      var uw = measured(el, "unit", function () { return bands.map(function (b) { var u = b.querySelector(".kt-u"); return u ? Math.max(1, u.offsetWidth) : 1; }); });
      var travel = 0.08 * W * p + 0.8 * W * prog(p, 0, 1.4, eOut);
      rootOf(el).style.opacity = prog(p, 0, 0.2);
      bands.forEach(function (b, r) {
        var dir = r % 2 ? 1 : -1, u = uw[r];
        b.style.transform = "translateX(" + fx(((((travel * dir) % u) + u) % u) - u, 1) + "px)";
      });
    },
  };

  // The text fills a rectangle edge to edge; when the box changes shape, the lines re-fit (stretching to fill its height).
  function fitLines(P) {
    var lines = [], cur = [];
    var flush = function () {
      if (!cur.length) return;
      var prev = lines[lines.length - 1];
      // A lone short word (like "a") joins the line before rather than filling the box on its own.
      if (cur.length === 1 && cur[0].length <= 3 && prev && !prev.key) prev.text += " " + cur[0];
      else lines.push({ text: cur.join(" "), key: false });
      cur = [];
    };
    P.words.forEach(function (w, i) {
      if (i === P.k) { flush(); lines.push({ text: w, key: true }); return; }
      if (cur.length && cur.concat(w).join(" ").length > 14) flush();
      cur.push(w);
    });
    flush();
    return lines;
  }
  P_["fit-to-box"] = {
    build: function (line) {
      var P = parse(line);
      var lines = fitLines(P).map(function (l) { return '<div class="kt-ln" style="white-space:pre;line-height:1;width:max-content;margin:0 auto;' + (l.key ? "color:" + ACC : "") + '">' + esc(l.text) + "</div>"; }).join("");
      return sceneRoot(P, '<div class="kt-bx" style="position:absolute;left:50%;top:50%;outline:1.5px solid color-mix(in srgb,' + INK + ' 22%,transparent);outline-offset:3px"><div class="kt-stk" style="transform-origin:50% 0">' + lines + "</div></div>", "font-weight:800;");
    },
    tick: function (el, p) {
      var bx = one(el, ".kt-bx"), stk = one(el, ".kt-stk"), lns = all(el, ".kt-ln");
      if (!bx || !stk) return;
      var W = el.clientWidth, H = el.clientHeight;
      var w100 = measured(el, "fit100", function () { return lns.map(function (l) { l.style.fontSize = "100px"; var w = Math.max(1, l.offsetWidth); l.style.fontSize = ""; return w; }); });
      var shapes = [[0.3 * W, 0.78 * H], [0.84 * W, 0.5 * H], [0.56 * W, 0.72 * H]];
      var seg = p < 0.75 ? 0 : 1, q = seg === 0 ? prog(p, T0, 0.75, eInOut) : prog(p, 0.75, 1.4, eInOut);
      var bw = mix(q, shapes[seg][0], shapes[seg + 1][0]), bh = mix(q, shapes[seg][1], shapes[seg + 1][1]);
      bx.style.width = fx(bw, 1) + "px";
      bx.style.height = fx(bh, 1) + "px";
      bx.style.transform = "translate(-50%,-50%)";
      // Each line spans the box's width; the stack then stretches or squeezes vertically to fill
      // its height (the component uses the font's width and weight sliders for this). Past the
      // limits, everything shrinks evenly, leaving space at the sides.
      var total = 0;
      lns.forEach(function (l, i) { var s = (bw * 100) / w100[i]; l.style.fontSize = fx(s, 2) + "px"; total += s; });
      var sy = Math.min(2.4, Math.max(0.6, bh / Math.max(1, total)));
      var f = Math.min(1, bh / Math.max(1, total * sy));
      stk.style.transform = "scale(" + fx(f) + "," + fx(f * sy) + ")";
      stk.style.marginTop = fx(Math.max(0, (bh - total * sy * f) / 2), 1) + "px";
      lns.forEach(function (l, i) {
        var a = T0 + stag(i, lns.length, 0.3, 0.06, 0.6), pp = prog(p, a, a + 0.3, eOut);
        l.style.opacity = pp;
        l.style.transform = "translateY(" + fx(mix(pp, 0.3, 0)) + "em)";
      });
      bx.style.opacity = 1;
    },
  };

  // ---------------------------------------------------------------- 14 · Text living inside footage (examples)

  function buildings(seed, n, color, minH, maxH) {
    var out = "", x = 0;
    for (var i = 0; i < n; i++) {
      var w = 6 + rnd(seed, i) * 8, h = minH + rnd(seed + 1, i) * (maxH - minH);
      out += '<div style="position:absolute;bottom:0;left:' + fx(x, 2) + "%;width:" + fx(w - 0.6, 2) + "%;height:" + fx(h, 1) + "%;background:" + color + '"></div>';
      x += w;
    }
    return out;
  }
  function titleSize(text, maxCqh) {
    var chars = Math.max(1, Array.from(text).length);
    return "min(" + maxCqh + "cqh," + fx(118 / (chars * 0.66), 2) + "cqw)";
  }

  // Match-moved title (example): the title sits at its own depth between far and near buildings and moves with the camera.
  P_["match-moved-title"] = {
    build: function (line) {
      var P = parse(line), title = P.k >= 0 ? headWord(P) : P.text;
      return sceneRoot(P, '<div style="position:absolute;inset:0;container-type:size;background:#C9DDEA">' +
        '<div class="kt-far" style="position:absolute;left:-20%;width:160%;bottom:0;height:100%">' + buildings(3, 14, "#9DB6CB", 25, 70) + "</div>" +
        '<div class="kt-ttl" style="position:absolute;left:50%;top:50%;white-space:nowrap;font-weight:900;color:' + ACC + ";font-size:" + titleSize(title, 42) + '">' + esc(title) + "</div>" +
        '<div class="kt-near" style="position:absolute;left:-30%;width:180%;bottom:0;height:100%">' + buildings(9, 15, "#3D4A63", 15, 45) + "</div></div>", "font-weight:900;");
    },
    tick: function (el, p) {
      var pan = mix(prog(p, 0, 2.2, eInOut), 1, -1);
      var far = one(el, ".kt-far"), ttl = one(el, ".kt-ttl"), near = one(el, ".kt-near");
      if (far) far.style.transform = "translateX(" + fx(pan * 4, 2) + "cqw)";
      if (ttl) ttl.style.transform = "translate(calc(-50% + " + fx(pan * 9, 2) + "cqw),-50%)";
      if (near) near.style.transform = "translateX(" + fx(pan * 18, 2) + "cqw)";
      rootOf(el).style.opacity = prog(p, 0, 0.2);
    },
  };

  // Text behind subject (example): a person walks in front of a big title.
  P_["text-behind-subject"] = {
    build: function (line) {
      var P = parse(line), title = P.k >= 0 ? headWord(P) : P.text;
      var person = '<svg class="kt-who" viewBox="0 0 40 100" style="position:absolute;bottom:4cqh;left:0;height:88cqh;overflow:visible"><circle cx="20" cy="10" r="8" fill="#1E1E24"/><rect x="12" y="20" width="16" height="40" rx="7" fill="#1E1E24"/><path class="kt-l1" d="M17 56 L13 98" stroke="#1E1E24" stroke-width="6" stroke-linecap="round"/><path class="kt-l2" d="M23 56 L27 98" stroke="#1E1E24" stroke-width="6" stroke-linecap="round"/></svg>';
      return sceneRoot(P, '<div style="position:absolute;inset:0;container-type:size;background:#F6D9C4">' +
        '<div style="position:absolute;left:0;right:0;bottom:0;height:4cqh;background:#E2BFA4"></div>' +
        '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);white-space:nowrap;font-weight:900;color:' + ACC + ";font-size:" + titleSize(title, 50) + '">' + esc(title) + "</div>" + person + "</div>", "font-weight:900;");
    },
    tick: function (el, p) {
      var who = one(el, ".kt-who"), l1 = one(el, ".kt-l1"), l2 = one(el, ".kt-l2");
      var q = prog(p, T0, 1.9, function (x) { return x; });
      var walking = q > 0 && q < 1, sw = walking ? Math.sin(p * 14) * 6 : 0;
      if (who) who.style.transform = "translateX(" + fx(mix(eOut(q), -10, 72), 2) + "cqw)";
      if (l1) l1.setAttribute("d", "M17 56 L" + fx(13 + sw, 1) + " 98");
      if (l2) l2.setAttribute("d", "M23 56 L" + fx(27 - sw, 1) + " 98");
    },
  };

  // Labels in the scene (example): thin leader lines attach labels to a real object (a mug), one after another.
  P_["labels-in-the-scene"] = {
    build: function (line) {
      var P = parse(line);
      var groups = P.words.length ? chunks(P.words, Math.min(3, P.words.length)) : [];
      var spots = [
        { ax: 152, ay: 70, lx: 204, ly: 30, anchor: "start" },
        { ax: 118, ay: 52, lx: 58, ly: 26, anchor: "end" },
        { ax: 120, ay: 88, lx: 58, ly: 104, anchor: "end" },
      ];
      var gi = 0;
      var labels = groups.map(function (g, i) {
        var s = spots[i], txt = g.join(" "), hasKey = false;
        var html = g.map(function (w) { var k = gi++ === P.k; if (k) hasKey = true; return k ? '<tspan style="fill:' + ACC + '">' + esc(w) + "</tspan>" : esc(w); }).join(" ");
        var fs = Math.min(11, 54 / (Math.max(1, Array.from(txt).length) * 0.55));
        var ex = s.lx + (s.anchor === "start" ? -4 : 4);
        return '<g class="kt-lab"><circle class="kt-dot" cx="' + s.ax + '" cy="' + s.ay + '" r="2.4" style="fill:' + BLUE + '"/><line class="kt-ln" x1="' + s.ax + '" y1="' + s.ay + '" x2="' + s.ax + '" y2="' + s.ay + '" data-x="' + ex + '" data-y="' + s.ly + '" stroke-width="1" style="stroke:' + BLUE + '"/>' +
          '<text class="kt-tx" x="' + s.lx + '" y="' + s.ly + '" text-anchor="' + s.anchor + '" dominant-baseline="middle" font-size="' + fx(fs, 2) + '" font-weight="700" style="fill:' + BLUE + ";font-family:" + FONT + '">' + html + "</text></g>";
      }).join("");
      return sceneRoot(P, '<svg viewBox="0 0 260 130" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;overflow:visible">' +
        '<rect x="-400" y="108" width="1060" height="22" fill="#B8865A"/><rect x="-400" y="-200" width="1060" height="308" fill="#E9DCC9"/><path d="M150 58 a14 14 0 0 1 0 30" fill="none" stroke="#FFFFFF" stroke-width="7"/><rect x="104" y="44" width="48" height="66" rx="6" fill="#FFFFFF"/>' + labels + "</svg>", "background:#B8865A;");
    },
    tick: function (el, p) {
      all(el, ".kt-lab").forEach(function (g, i) {
        var a = T0 + i * 0.4;
        var dot = g.querySelector(".kt-dot"), ln = g.querySelector(".kt-ln"), tx = g.querySelector(".kt-tx");
        var d = pop(p, a, 0.25, 2), l = prog(p, a + 0.15, a + 0.5, eInOut);
        dot.setAttribute("r", fx(2.4 * d, 2));
        var x1 = +ln.getAttribute("x1"), y1 = +ln.getAttribute("y1");
        ln.setAttribute("x2", fx(mix(l, x1, +ln.getAttribute("data-x")), 1));
        ln.setAttribute("y2", fx(mix(l, y1, +ln.getAttribute("data-y")), 1));
        tx.style.opacity = prog(p, a + 0.4, a + 0.65);
      });
    },
  };

  // ---------------------------------------------------------------- 15 · Text driven by sound

  /** When each of n words is said: spread evenly from a to b seconds. */
  function sayTimes(n, a, b) { var out = []; for (var i = 0; i < n; i++) out.push(n <= 1 ? a : mix(i / (n - 1), a, b)); return out; }

  // Two or three words at a time; the word being said pops bigger, tilts and turns yellow.
  P_["word-highlight-captions"] = {
    build: function (line) {
      var P = parse(line), groups = [], cur = [];
      P.words.forEach(function (w, i) {
        cur.push(i);
        if (cur.length === 3 || /[.,!?;:]["'”’)]*$/.test(w)) { groups.push(cur); cur = []; }
      });
      if (cur.length) groups.push(cur);
      var inner = groups.map(function (g) {
        return '<div class="kt-g" style="grid-area:1/1;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:0 .3em">' + g.map(function (i) {
          return '<span class="kt-w" data-i="' + i + '"' + (i === P.k ? " data-key" : "") + ' style="display:inline-block;white-space:pre;color:#FFFFFF;-webkit-text-stroke:.07em #000;paint-order:stroke fill">' + esc(P.words[i]) + "</span>";
        }).join("") + "</div>";
      }).join("");
      return fitRoot(P, inner, "display:grid;place-items:center;font-weight:900;");
    },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), gs = all(el, ".kt-g"), n = ws.length;
      var at = sayTimes(n, T0, 1.9), active = 0;
      for (var i = 0; i < n; i++) if (p >= at[i]) active = i;
      ws.forEach(function (w, i) {
        var on = i === active, key = w.hasAttribute("data-key"), q = pop(p, at[i], 0.25, 3);
        w.style.color = on ? (key ? ACC : MARKER) : key ? ACC : "#FFFFFF";
        w.style.fontSize = on ? fx(mix(q, 1, 1.12)) + "em" : "1em";
        w.style.transform = on ? "rotate(-3deg)" : "";
        w.style.opacity = p >= at[i] - 0.02 || i < active ? 1 : 0;
      });
      gs.forEach(function (g) {
        var has = Array.prototype.some.call(g.children, function (w) { return +w.getAttribute("data-i") === active; });
        g.style.visibility = has ? "visible" : "hidden";
      });
    },
  };

  // The whole line shows in a pale tint, and colour sweeps through each word as it is sung.
  P_["karaoke-sweep"] = {
    build: function (line) {
      var P = parse(line);
      return fitRoot(P, wordsHTML(P, {
        noColor: true,
        wstyle: function () { return "position:relative;"; },
        inner: function (w, i, key) {
          var c = key ? ACC : BLUE;
          return '<span style="color:color-mix(in srgb,' + c + ' 24%,transparent)">' + esc(w) + '</span><span class="kt-f" style="position:absolute;left:0;top:0;white-space:pre;color:' + c + ';clip-path:inset(-20% 100% -20% 0)">' + esc(w) + "</span>";
        },
      }), LINE);
    },
    tick: function (el, p) {
      var fs = all(el, ".kt-f"), c = mem(el);
      if (!c.cum) {
        var wts = fs.map(function (f) { return Array.from(f.textContent).length + 1; }), tot = Math.max(1, wts.reduce(function (a, b) { return a + b; }, 0)), acc = 0;
        c.cum = [0].concat(wts.map(function (w) { acc += w; return acc / tot; }));
      }
      rootOf(el).style.opacity = prog(p, 0, 0.15);
      fs.forEach(function (f, i) {
        var fill = prog(p, mix(c.cum[i], 0.15, 2.0), mix(c.cum[i + 1], 0.15, 2.0));
        f.style.clipPath = "inset(-20% " + fx(100 - fill * 100, 2) + "% -20% 0)";
      });
    },
  };

  // The text punches on every beat (the first of every four loudest); the key word punches hardest.
  P_["beat-pulse"] = {
    build: function (line) { var P = parse(line); return fitRoot(P, wordsHTML(P), LINE + "font-weight:900;"); },
    tick: function (el, p) {
      var step = 0.5, last = Math.floor((p - T0) / step);
      var kick = last < 0 ? 0 : (last % 4 === 0 ? 1 : 0.6) * Math.exp(-(p - (T0 + last * step)) * 9);
      var r = rootOf(el);
      r.style.opacity = prog(p, T0, T0 + 0.05);
      r.style.transform = "scale(" + fx(1 + kick * 0.16) + ")";
      all(el, ".kt-w").forEach(function (w) {
        w.style.fontSize = w.hasAttribute("data-key") ? fx(1 + kick * 0.2) + "em" : "";
        w.style.letterSpacing = fx(kick * 0.04) + "em";
      });
    },
  };

  // ---------------------------------------------------------------- 16 · Text as character, data and interface (examples)

  // Letters with personality (example): every O becomes an eye that looks around and blinks; the word breathes and flinches.
  P_["letters-with-personality"] = {
    build: function (line) {
      var P = parse(line), lastW = P.words.length - 1;
      return fitRoot(P, wordsHTML(P, {
        inner: function (w, i) {
          var cs = Array.from(w);
          return cs.map(function (ch, j) {
            var last = i === lastW && j === cs.length - 1;
            if (/[oO0]/.test(ch)) {
              var low = ch === "o";
              return '<span class="kt-eye" style="display:inline-block;position:relative;box-sizing:border-box;width:' + (low ? ".52em" : ".66em") + ";height:" + (low ? ".56em" : ".74em") + ";border:.12em solid currentColor;border-radius:50%;margin:0 .03em;vertical-align:-.02em" + (last ? ";color:" + ACC : "") + '"><span class="kt-pu" style="position:absolute;left:50%;top:50%;width:.2em;height:.26em;margin:-.13em 0 0 -.1em;border-radius:50%;background:currentColor"></span></span>';
            }
            return '<span class="kt-c" style="display:inline-block;transform-origin:50% 100%' + (last ? ";color:" + ACC : "") + '">' + esc(ch) + "</span>";
          }).join("");
        },
      }), LINE + "font-weight:900;");
    },
    tick: function (el, p) {
      var r = rootOf(el), look = Math.sin(p * 2.2) * 0.1;
      var blink = (p > 0.9 && p < 1.02) || (p > 1.95 && p < 2.07);
      var flinch = p > 1.3 && p < 1.5 ? Math.sin(((p - 1.3) / 0.2) * Math.PI) : 0;
      r.style.opacity = prog(p, T0, 0.3);
      r.style.transform = "translateY(" + fx(-flinch * 0.15) + "em) scale(" + fx(mix(pop(p, T0, 0.4, 2), 0.6, 1)) + ")";
      all(el, ".kt-pu").forEach(function (u) { u.style.transform = "translateX(" + fx(look) + "em) scaleY(" + (blink ? 0.12 : 1) + ")"; });
      all(el, ".kt-c").forEach(function (c, i) { c.style.transform = "scaleY(" + fx(1 + Math.sin(p * 4 + i * 0.4) * 0.03) + ")"; });
    },
  };

  // Chart made of type (example): each bar is a word repeated; the number of repeats is the value.
  var BAR_COLORS = [BLUE, TEAL, ACC];
  var BAR_COUNTS = [3, 5, 8];
  P_["chart-made-of-type"] = {
    build: function (line) {
      var P = parse(line), seen = {}, rows = [];
      P.words.forEach(function (w, i) {
        var b = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}²³]+$/gu, "") || w;
        if (!seen[b.toLowerCase()] && rows.length < 3) { seen[b.toLowerCase()] = 1; rows.push({ w: b, key: i === P.k }); }
      });
      var html = rows.map(function (r, i) {
        var n = BAR_COUNTS[i], col = r.key ? ACC : BAR_COLORS[i];
        // Long labels repeat as a short tag (their first three letters), as the example suggests.
        var chars = Array.from(r.w), tag = esc(chars.length > 5 ? chars.slice(0, 3).join("") : r.w);
        return '<div class="kt-row" data-n="' + n + '" style="white-space:nowrap;text-align:left;line-height:1.35"><span style="color:' + INK + '">' + esc(r.w) + '</span> <span class="kt-bar" data-w="' + tag + '" style="color:' + col + ';font-size:.8em">' + new Array(n).fill(tag).join(" ") + '</span> <span class="kt-num" style="color:' + MUTED + ';font-weight:600;font-size:.7em">' + n + "</span></div>";
      }).join("");
      return fitRoot(P, html, "font-weight:900;display:flex;flex-direction:column;align-items:flex-start;");
    },
    tick: function (el, p) {
      all(el, ".kt-row").forEach(function (r, i) {
        var bar = r.children[1], num = r.children[2], n = +r.getAttribute("data-n");
        var a = T0 + i * 0.35, k = Math.round(prog(p, a, a + 0.6) * n);
        var t = new Array(k).fill(bar.getAttribute("data-w")).join(" ");
        if (bar.textContent !== t) bar.textContent = t;
        num.style.opacity = k >= n ? 1 : 0;
        r.style.opacity = prog(p, T0, T0 + 0.2);
      });
    },
  };

  // Chat bubbles (example): messages pop in, with "typing…" dots before each reply.
  P_["chat-bubbles"] = {
    build: function (line) {
      var P = parse(line), msgs = [], cur = [];
      P.words.forEach(function (w) { cur.push(w); if (/[.!?:;,]["'”’)]*$/.test(w) && cur.length >= 2) { msgs.push(cur); cur = []; } });
      if (cur.length) msgs.push(cur);
      if (msgs.length < 2 || msgs.length > 3) msgs = chunks(P.words, Math.min(3, Math.max(1, Math.ceil(P.words.length / 4))));
      var gi = 0;
      var html = msgs.map(function (m, i) {
        var me = i % 2 === 1;
        var txt = m.map(function (w) { var k = gi++ === P.k; return k ? '<b style="color:' + (me ? "#FFE14D" : ACC) + '">' + esc(w) + "</b>" : esc(w); }).join(" ");
        return '<div class="kt-msg" data-me="' + (me ? 1 : 0) + '" style="align-self:' + (me ? "flex-end" : "flex-start") + ";max-width:80%;transform-origin:" + (me ? "100% 100%" : "0 100%") + '">' +
          '<div class="kt-dots" style="display:none;background:' + BLUE + ';border-radius:.7em;padding:.35em .55em;gap:.18em">' + [0, 1, 2].map(function () { return '<span style="display:inline-block;width:.3em;height:.3em;border-radius:50%;background:#FFFFFF;margin:0 .06em"></span>'; }).join("") + "</div>" +
          '<div class="kt-txt" style="background:' + (me ? BLUE : "#E9E2D4") + ";color:" + (me ? "#FFFFFF" : INK) + ';border-radius:.6em;padding:.3em .6em;text-align:left;font-weight:600">' + txt + "</div></div>";
      }).join("");
      return fitRoot(P, html, "display:flex;flex-direction:column;gap:.3em;width:min(100%,16em);font-size:.75em;line-height:1.25;");
    },
    tick: function (el, p) {
      var ms = all(el, ".kt-msg"), n = ms.length;
      var at = sayTimes(n, T0, 1.6);
      ms.forEach(function (m, i) {
        var dots = m.children[0], txt = m.children[1], me = m.getAttribute("data-me") === "1";
        var typing = i > 0 && p >= at[i] - 0.45 && p < at[i];
        m.style.visibility = p >= at[i] || typing ? "visible" : "hidden";
        dots.style.display = typing ? "inline-flex" : "none";
        txt.style.display = typing ? "none" : "block";
        if (typing) Array.prototype.forEach.call(dots.children, function (d, k) { d.style.transform = "translateY(" + fx(Math.sin(p * 12 - k) * -0.1) + "em)"; });
        m.style.transform = "scale(" + fx(typing ? 1 : pop(p, at[i], 0.3, 2)) + ")";
        m.style.alignSelf = me ? "flex-end" : "flex-start";
      });
    },
  };

  // Search-bar typing (example): a query types itself, then suggestions drop down.
  var ENDINGS = ["explained", "for kids", "meaning"];
  P_["search-bar-typing"] = {
    build: function (line) {
      var P = parse(line), chars = Array.from(P.text);
      // Suggestions repeat the query; a long one is cut short so the endings stay visible.
      var short = chars.length > 28 ? chars.slice(0, 26).join("").trim() + "…" : P.text;
      return fitRoot(P, '<div style="background:#FFFFFF;border-radius:2em;padding:.4em .9em;box-shadow:0 .1em .4em rgba(0,0,0,.12);text-align:left;white-space:normal"><span style="color:' + MUTED + '">⌕ </span><span class="kt-q">' + esc(P.text) + '</span><span class="kt-caret" style="display:inline-block;width:.06em;height:1em;vertical-align:-.15em;margin-left:.04em;background:' + BLUE + '"></span></div>' +
        '<div class="kt-sug" style="margin-top:.3em;background:#FFFFFF;border-radius:.5em;padding:.3em .9em;text-align:left;box-shadow:0 .1em .4em rgba(0,0,0,.08);font-size:.75em">' +
        ENDINGS.map(function (e) { return '<div style="padding:.15em 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:' + MUTED + '">' + esc(short) + "</span> <b>…" + e + "</b></div>"; }).join("") + "</div>", "font-weight:500;width:min(100%,22em);font-size:.8em;");
    },
    tick: function (el, p, line) {
      var q = one(el, ".kt-q"), caret = one(el, ".kt-caret"), sug = one(el, ".kt-sug"), c = mem(el);
      if (!c.chars) c.chars = Array.from(parse(line).text);
      var n = Math.floor(prog(p, T0, 1.2) * c.chars.length);
      var t = c.chars.slice(0, n).join("");
      if (q && q.textContent !== t) q.textContent = t;
      if (caret) caret.style.opacity = n < c.chars.length || Math.floor(p * 2) % 2 === 0 ? 1 : 0;
      if (sug) {
        var s = prog(p, 1.3, 1.6, eOut);
        sug.style.opacity = s;
        sug.style.transform = "translateY(" + fx((1 - s) * -0.4) + "em)";
      }
    },
  };

  // ---------------------------------------------------------------- 17 · Code, interaction and AI

  // Each letter's height comes from a formula, y = a·sin(3t + 0.5n) + b·sin(5.3t − 1.1n).
  P_["sine-wave-type"] = {
    build: function (line) { return letterRoot(line, "font-weight:900;line-height:1.6;"); },
    tick: function (el, p) {
      var cs = all(el, ".kt-c"), N = cs.length;
      var amp = mix(prog(p, 0.45, 1.4, eInOut), 0.45, 0.16);
      cs.forEach(function (c, n) {
        var a = T0 + stag(n, N, 0.3, 0.03, 0.9);
        c.style.opacity = prog(p, a, a + 0.3);
        c.style.transform = "translateY(" + fx(amp * (0.7 * Math.sin(p * 3 + n * 0.5) + 0.3 * Math.sin(p * 5.3 - n * 1.1)), 4) + "em)";
      });
    },
  };

  // A pretend mouse pointer glides across the text; letters near it grow heavier and turn to the accent colour.
  P_["cursor-reactive"] = {
    build: function (line) {
      var ptr = '<svg class="kt-ptr" viewBox="0 0 50 70" style="position:absolute;left:0;top:0;width:.3em;height:.42em;overflow:visible"><path d="M 2 2 L 2 56 L 16 44 L 26 66 L 36 61 L 26 40 L 44 40 Z" fill="#FFFFFF" stroke="#1E1E24" stroke-width="4" stroke-linejoin="round"/></svg>';
      return heldLetters(line, "font-family:" + FLEX + ";font-weight:400;", 900).replace(/<\/div>$/, ptr + "</div>");
    },
    tick: function (el, p) {
      var cs = all(el, ".kt-v"), ptr = one(el, ".kt-ptr"), r = rootOf(el), fs = fsOf(el), c = mem(el);
      if (!c.keys) { c.keys = cs.map(function (l) { return !!l.closest("[data-key]"); }); c.w = []; }
      var g = measured(el, "cur", function () {
        var lb = letterBoxes(el), wb = wordBoxes(el), W = r.offsetWidth, H = r.offsetHeight;
        var t = wb.filter(function (b) { return b.key; })[0] || wb[wb.length - 1] || { cx: W / 2, cy: H / 2 };
        return { lb: lb, tx: t.cx, ty: t.cy, W: W, H: H };
      });
      var q = prog(p, T0, 1.35, eInOut), hover = prog(p, 1.35, 1.8);
      var px = mix(q, -0.8 * fs, g.tx) + Math.cos(p * 2) * 0.08 * fs * hover;
      var py = mix(q, 0.3 * g.H, g.ty) + Math.sin(q * Math.PI * 2) * 0.35 * g.H + Math.sin(p * 2.6) * 0.06 * fs * hover;
      r.style.opacity = prog(p, 0, 0.2);
      if (ptr) ptr.style.transform = "translate(" + fx(px, 1) + "px," + fx(py, 1) + "px)";
      cs.forEach(function (l, i) {
        var b = g.lb[i];
        if (!b) return;
        var near = Math.max(0, 1 - Math.hypot(b.cx - px, b.cy - py) / (1.6 * fs));
        // Weight in steps of 25, written only when it changes (re-shaping a letter is the costly part).
        var wght = Math.round(mix(near, 400, 900) / 25) * 25;
        if (c.w[i] !== wght) {
          c.w[i] = wght;
          l.style.fontWeight = wght;
          l.style.color = c.keys[i] || near > 0.5 ? ACC : "";
          l.style.transform = "translateY(" + fx(-near * 0.12) + "em) scaleX(" + fx(1 + near * 0.12) + ")";
        }
      });
    },
  };

  // Generative flow (example): the text is made of dots that a swirling flow field blows apart, then lets drift home.
  P_["generative-flow"] = {
    build: function (line) { var P = parse(line); return CANVAS + fitRoot(P, wordsHTML(P, { noColor: true }), LINE + "font-weight:900;color:transparent;"); },
    tick: function (el, p) {
      var cv = canvas(el);
      if (!cv) return;
      var G = grains(el, 1400), cell = G.cell, fs = fsOf(el);
      var storm = Math.sin(Math.PI * prog(p, 0.15, 2.05, eInOut));
      var ink = cssVar(el, "--kt-ink", "#1E1E24"), acc = cssVar(el, "--kt-accent", ACC_HEX), ctx = cv.ctx;
      var PUSH = 2.2 * fs;
      ctx.fillStyle = storm > 0.25 ? acc : ink;
      G.list.forEach(function (g) {
        var c = g.x / cell, r = g.y / cell;
        var ang = 2 * Math.sin(0.08 * c + p) + 2 * Math.cos(0.12 * r - 0.7 * p);
        var x = g.x + Math.cos(ang) * PUSH * storm * (0.6 + (c % 5) * 0.1);
        var y = g.y + Math.sin(ang) * PUSH * storm * (0.6 + (r % 5) * 0.1);
        ctx.beginPath();
        ctx.arc(cv.x + x + cell / 2, cv.y + y + cell / 2, cell * 0.38, 0, 6.2832);
        ctx.fill();
      });
    },
  };

  // A pretend browser window: as the visitor scrolls, the text builds word by word.
  P_["scroll-linked"] = {
    build: function (line) {
      var P = parse(line);
      var bar = '<div style="position:absolute;left:0;right:0;top:0;height:.75em;background:#ECE6DA;display:flex;align-items:center;gap:.2em;padding-left:.35em">' + ["#F2643D", YELLOW, TEAL].map(function (c) { return '<span style="width:.26em;height:.26em;border-radius:50%;background:' + c + '"></span>'; }).join("") + "</div>";
      return fitRoot(P, bar + '<div class="kt-thumb" style="position:absolute;right:.12em;top:.9em;width:.16em;height:30%;border-radius:.08em;background:' + FAINT + '"></div>' +
        '<div class="kt-hint" style="position:absolute;left:.4em;bottom:.15em;font-size:.35em;font-weight:500;color:' + MUTED + '">↓ scroll</div>' +
        '<div class="kt-in" style="' + LINE + '">' + wordsHTML(P) + "</div>", "background:#FFFFFF;border-radius:.3em;padding:1.15em .9em .6em;box-shadow:0 .2em .6em rgba(0,0,0,.12);overflow:hidden;font-weight:900;");
    },
    tick: function (el, p) {
      var ws = all(el, ".kt-w"), n = ws.length, sc = prog(p, T0, 1.4, eInOut);
      var inr = one(el, ".kt-in"), th = one(el, ".kt-thumb"), hint = one(el, ".kt-hint");
      rootOf(el).style.opacity = prog(p, 0, 0.2);
      if (inr) inr.style.transform = "translateY(" + fx((1 - sc) * 0.3) + "em)";
      if (th) th.style.transform = "translateY(" + fx(sc * 120, 1) + "%)";
      if (hint) hint.style.opacity = 1 - sc;
      ws.forEach(function (w, i) {
        var q = prog(sc, i / Math.max(1, n), (i + 1) / Math.max(1, n), eOut), c = w.hasAttribute("data-key") ? ACC : INK;
        w.style.color = q >= 1 ? c : "color-mix(in srgb," + c + " " + Math.round(25 + q * 55) + "%," + FAINT + ")";
        w.style.transform = "translateY(" + fx((1 - q) * 0.35) + "em)";
        w.style.opacity = 0.35 + q * 0.65;
      });
    },
  };

  // ---------------------------------------------------------------- exports

  var KT = {
    LOOP: LOOP,
    REST: REST,
    DARK: DARK,
    BOX_CSS: BOX_CSS,
    fit: fit,
    keyMatch: keyMatch,
    esc: esc,
  };
  var KT_PREVIEWS = P_;

  if (typeof module === "object" && module.exports) module.exports = { KT_PREVIEWS: KT_PREVIEWS, KT: KT };
  if (root) {
    root.KT_PREVIEWS = KT_PREVIEWS;
    root.KT = KT;
  }
})(typeof window !== "undefined" ? window : null);
