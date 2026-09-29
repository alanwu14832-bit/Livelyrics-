// Canvas2D painter for the lyric layer, used by the video export. The export runs the very same
// LyricLayer as the projection (same line breaking, placement inside lyricSafe, fit, per-style
// enter / exit / word animations, karaoke progress, emphasis colours, vertical text, translation
// and anticipation lines), laid out in a hidden host at the export size and driven by song time.
// This painter then reads that DOM (layout boxes, computed transforms, opacity, filters, colours,
// text shadows, karaoke clip insets) and draws it into a canvas, so an exported frame matches the
// live output instead of re-implementing the lyric styles a second time.
//
// Compositing follows CSS: every lyric block (which has `isolation: isolate` and its own opacity,
// blur and transform) is painted into its own layer canvas, scrim first, then composited with
// its opacity, filter and transform. Glyph positions come from the DOM layout; glyphs are drawn
// with the same font, weight, size and letter spacing. `matte` paints the luma-matte layer:
// white text at the text's own alpha, no scrim, no shadows.

import {
  alignStart,
  baselineIn,
  caretVisible,
  deviceShadow,
  elementMatrix,
  isIdentity,
  isSidewaysChar,
  layerMargin,
  matteColor,
  parseInset,
  parseMatrix,
  parseOrigin,
  parseTextShadows,
  transparentOf,
  type Shadow,
} from "@/lib/stage/lyrics/paint-math";
import styles from "../lyrics/lyrics.module.css";

export interface LyricPaintOptions {
  /** song time (caret blink phase) */
  t: number;
  /** white-on-transparent luma matte instead of the coloured layer */
  matte: boolean;
}

interface FontMetrics {
  ascent: number;
  descent: number;
}

type Ctx = CanvasRenderingContext2D;

const DEFAULT_SCRIM = "rgba(0, 0, 0, 0.4)";

function px(v: string | null | undefined, fallback = 0): number {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** A computed `filter` string for canvas (em lengths resolved against the element's font size). */
function canvasFilter(value: string, em: number): string {
  if (!value || value === "none") return "none";
  return value.replace(/(-?[\d.]+)em\b/g, (_, n: string) => `${(parseFloat(n) * em).toFixed(3)}px`);
}

export class LyricPainter {
  private layers = new WeakMap<HTMLElement, HTMLCanvasElement>();
  private caretSince = new WeakMap<HTMLElement, number>();
  private metrics = new Map<string, FontMetrics>();
  private positions = new Map<HTMLElement, [number, number]>();
  private opts: LyricPaintOptions = { t: 0, matte: false };
  private shift = 100000;

  /**
   * @param root the LyricLayer root to paint
   * @param cjkFamily resolved CSS font-family of the plan's CJK font (upright glyph placement in
   *   vertical text uses the metrics of the font that draws them)
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly cjkFamily: string | null = null,
  ) {}

  /** Clear `ctx` (sized like the host) and paint the current lyric layer into it. */
  paint(ctx: Ctx, opts: LyricPaintOptions) {
    this.opts = opts;
    this.positions.clear();
    this.shift = (ctx.canvas.width + ctx.canvas.height) * 4 + 1000;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const cs = getComputedStyle(this.root);
    const alpha = px(cs.opacity, 1);
    if (alpha > 0.002) for (const child of Array.from(this.root.children)) this.paintElement(child as HTMLElement, ctx, alpha);
    ctx.restore();
  }

  /** Untransformed layout position relative to the layer root (offsetParent chain). */
  private pos(el: HTMLElement): [number, number] {
    const cached = this.positions.get(el);
    if (cached) return cached;
    let x = 0;
    let y = 0;
    let cur: HTMLElement | null = el;
    while (cur && cur !== this.root) {
      x += cur.offsetLeft;
      y += cur.offsetTop;
      const parent = cur.offsetParent as HTMLElement | null;
      if (!parent || parent === this.root || !this.root.contains(parent)) break;
      cur = parent;
    }
    const p: [number, number] = [x, y];
    this.positions.set(el, p);
    return p;
  }

  private fontMetrics(ctx: Ctx, font: string): FontMetrics {
    let m = this.metrics.get(font);
    if (!m) {
      ctx.font = font;
      const tm = ctx.measureText("永Hg");
      m = { ascent: tm.fontBoundingBoxAscent || tm.actualBoundingBoxAscent, descent: tm.fontBoundingBoxDescent || tm.actualBoundingBoxDescent };
      if (this.metrics.size > 64) this.metrics.clear();
      this.metrics.set(font, m);
    }
    return m;
  }

  private paintElement(el: HTMLElement, ctx: Ctx, inherited: number) {
    const cs = getComputedStyle(el);
    if (cs.display === "none") return;
    const alpha = inherited * px(cs.opacity, 1);
    if (alpha < 0.002) return;
    if (el.classList.contains(styles.block)) {
      this.paintBlock(el, cs, ctx, alpha);
      return;
    }
    const [x, y] = this.pos(el);
    const m = parseMatrix(cs.transform);
    ctx.save();
    if (!isIdentity(m)) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      ctx.transform(...elementMatrix(m, x, y, parseOrigin(cs.transformOrigin, w, h)));
    }
    if (el.classList.contains(styles.u)) this.paintUnit(el, cs, ctx, alpha);
    else {
      this.paintOwnText(el, cs, ctx, alpha);
      for (const child of Array.from(el.children)) this.paintElement(child as HTMLElement, ctx, alpha);
    }
    ctx.restore();
  }

  /** A lyric block: scrim + content into a layer, composited with opacity, filter and transform. */
  private paintBlock(el: HTMLElement, cs: CSSStyleDeclaration, ctx: Ctx, alpha: number) {
    const [x, y] = this.pos(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w <= 0 || h <= 0) return;
    const em = px(cs.fontSize, 16);
    const shadows = parseTextShadows(cs.textShadow);
    const maxBlur = shadows.reduce((a, s) => Math.max(a, s.blur + Math.abs(s.x) + Math.abs(s.y)), 0);
    // word-pop / impact units can scale past the box a little; stack items carry the next line
    const margin = layerMargin(em, maxBlur) + Math.ceil(em * 0.4);
    const lw = Math.ceil(w + margin * 2);
    const lh = Math.ceil(h + margin * 2);
    let layer = this.layers.get(el);
    if (!layer) {
      layer = document.createElement("canvas");
      this.layers.set(el, layer);
    }
    if (layer.width < lw || layer.height < lh) {
      layer.width = Math.max(layer.width, lw);
      layer.height = Math.max(layer.height, lh);
    }
    const lctx = layer.getContext("2d");
    if (!lctx) return;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    lctx.setTransform(1, 0, 0, 1, margin - x, margin - y);
    if (!this.opts.matte && !el.classList.contains(styles.noScrim)) this.paintScrim(lctx, cs, x, y, w, h, em);
    this.paintOwnText(el, cs, lctx, 1);
    for (const child of Array.from(el.children)) this.paintElement(child as HTMLElement, lctx, 1);

    ctx.save();
    const m = parseMatrix(cs.transform);
    if (!isIdentity(m)) ctx.transform(...elementMatrix(m, x, y, parseOrigin(cs.transformOrigin, w, h)));
    ctx.globalAlpha = Math.min(1, alpha);
    const filter = canvasFilter(cs.filter, em);
    if (filter !== "none") ctx.filter = filter;
    ctx.drawImage(layer, 0, 0, lw, lh, x - margin, y - margin, lw, lh);
    ctx.restore();
  }

  private paintScrim(ctx: Ctx, cs: CSSStyleDeclaration, x: number, y: number, w: number, h: number, em: number) {
    const color = cs.getPropertyValue("--ly-scrim").trim() || DEFAULT_SCRIM;
    // radial-gradient(closest-side, scrim, transparent) over inset(-0.5em -1.1em): an ellipse
    // touching the pseudo element's sides, drawn as a unit circle scaled to it
    const sx = x - 1.1 * em;
    const sy = y - 0.5 * em;
    const sw = w + 2.2 * em;
    const sh = h + em;
    const rx = sw / 2;
    const ry = sh / 2;
    if (rx <= 0 || ry <= 0) return;
    ctx.save();
    ctx.translate(sx + rx, sy + ry);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, color);
    g.addColorStop(1, transparentOf(color));
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  private font(cs: CSSStyleDeclaration): string {
    return `${cs.fontStyle === "normal" ? "" : `${cs.fontStyle} `}${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  }

  private setText(ctx: Ctx, cs: CSSStyleDeclaration) {
    ctx.font = this.font(cs);
    const ls = cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing);
    ctx.letterSpacing = `${ls}px`;
    ctx.fontKerning = "normal";
    ctx.textRendering = "optimizeLegibility";
  }

  private color(value: string): string {
    return this.opts.matte ? matteColor(value) : value;
  }

  /**
   * Draw `run` with the CSS shadows first (glyphs shifted off canvas, only the shadow lands in
   * place) and the fill on top. `draw` paints the glyphs at the current transform.
   */
  private withShadows(ctx: Ctx, shadows: Shadow[], fill: string, alpha: number, draw: () => void) {
    ctx.globalAlpha = Math.min(1, alpha);
    if (!this.opts.matte) {
      for (const s of shadows) {
        const m = ctx.getTransform();
        const d = deviceShadow(s, m, this.shift);
        ctx.save();
        ctx.setTransform(m.a, m.b, m.c, m.d, m.e - this.shift, m.f);
        ctx.shadowColor = s.color;
        ctx.shadowOffsetX = d.offsetX;
        ctx.shadowOffsetY = d.offsetY;
        ctx.shadowBlur = d.blur;
        ctx.fillStyle = "#000";
        draw();
        ctx.restore();
      }
    }
    ctx.fillStyle = fill;
    draw();
  }

  /** Glyphs of `text` in a box: horizontal on the line's baseline, or vertical-rl (mixed). */
  private glyphs(ctx: Ctx, cs: CSSStyleDeclaration, text: string, x: number, y: number, w: number, h: number, align: string | null) {
    const vertical = cs.writingMode.startsWith("vertical");
    const fs = px(cs.fontSize, 16);
    const ls = cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing);
    if (!vertical) {
      const { ascent, descent } = this.fontMetrics(ctx, ctx.font);
      const lineH = cs.lineHeight === "normal" ? h : px(cs.lineHeight, h);
      const base = baselineIn(y, Math.min(lineH, h) || lineH, ascent, descent);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const tx = align ? alignStart(x, w, ctx.measureText(text).width, align, cs.direction === "rtl") : x;
      return () => ctx.fillText(text, tx, base);
    }
    // vertical-rl, text-orientation: mixed (Blink's placement): the column's content area is
    // centred in the line box with the primary font's ascent on the right, the alphabetic
    // baseline sits at its left + descent. Sideways (Latin) runs are rotated 90° clockwise onto
    // that baseline; upright glyphs start their em box at the top of their advance (1em +
    // tracking) and are centred at baseline + (ascent − descent) / 2 of the font that draws them
    // (the CJK font: the Latin font of the stack has no CJK glyphs).
    const primary = this.fontMetrics(ctx, ctx.font);
    const contentLeft = x + (w - (primary.ascent + primary.descent)) / 2;
    const baseX = contentLeft + primary.descent;
    const mainFont = ctx.font;
    const uprightFont = this.cjkFamily ? `${cs.fontStyle === "normal" ? "" : `${cs.fontStyle} `}${cs.fontWeight} ${cs.fontSize} ${this.cjkFamily}` : mainFont;
    const upright = this.fontMetrics(ctx, uprightFont);
    ctx.font = uprightFont;
    const emAscent = ctx.measureText("永").emHeightAscent || fs * 0.88;
    ctx.font = mainFont;
    const runs: Array<{ text: string; sideways: boolean; advance: number }> = [];
    for (const ch of text) {
      const sideways = isSidewaysChar(ch);
      const last = runs[runs.length - 1];
      if (last && last.sideways && sideways) last.text += ch;
      else runs.push({ text: ch, sideways, advance: 0 });
    }
    let total = 0;
    for (const r of runs) {
      r.advance = r.sideways ? ctx.measureText(r.text).width : fs + ls;
      total += r.advance;
    }
    const cx = baseX + (upright.ascent - upright.descent) / 2;
    const start = align ? alignStart(y, h, total, align) : y;
    return () => {
      let p = start;
      for (const r of runs) {
        if (r.sideways) {
          ctx.save();
          ctx.font = mainFont;
          ctx.letterSpacing = `${ls}px`;
          ctx.translate(baseX, p);
          ctx.rotate(Math.PI / 2);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.fillText(r.text, 0, 0);
          ctx.restore();
        } else {
          ctx.save();
          // tracking runs down the column, not across it
          ctx.letterSpacing = "0px";
          ctx.font = uprightFont;
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillText(r.text, cx, p + emAscent);
          ctx.restore();
        }
        p += r.advance;
      }
    };
  }

  /** Direct (non-whitespace) text of an element that is not a unit: translation rows, the next line. */
  private paintOwnText(el: HTMLElement, cs: CSSStyleDeclaration, ctx: Ctx, alpha: number) {
    let text = "";
    for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? "";
    if (!text.trim() || el.children.length > 0) return;
    const [x, y] = this.pos(el);
    this.setText(ctx, cs);
    const draw = this.glyphs(ctx, cs, text, x, y, el.offsetWidth, el.offsetHeight, cs.textAlign);
    this.withShadows(ctx, parseTextShadows(cs.textShadow), this.color(cs.color), alpha, draw);
  }

  /** One lyric unit (a CJK character or a Latin word) with its karaoke fill and typewriter caret. */
  private paintUnit(el: HTMLElement, cs: CSSStyleDeclaration, ctx: Ctx, alpha: number) {
    const [x, y] = this.pos(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let text = "";
    for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? "";
    if (text) {
      this.setText(ctx, cs);
      const draw = this.glyphs(ctx, cs, text, x, y, w, h, null);
      this.withShadows(ctx, parseTextShadows(cs.textShadow), this.color(cs.color), alpha, draw);
    }
    const fill = el.querySelector<HTMLElement>(`:scope > .${styles.fill}`);
    if (fill && text) {
      const fcs = getComputedStyle(fill);
      const clip = parseInset(fcs.clipPath, w, h);
      if (!clip || (clip.w > 0.01 && clip.h > 0.01)) {
        ctx.save();
        if (clip) {
          ctx.beginPath();
          ctx.rect(x + clip.x, y + clip.y, clip.w, clip.h);
          ctx.clip();
        }
        this.setText(ctx, fcs);
        const draw = this.glyphs(ctx, fcs, text, x, y, w, h, null);
        this.withShadows(ctx, parseTextShadows(fcs.textShadow), this.color(fcs.color), alpha * px(fcs.opacity, 1), draw);
        ctx.restore();
      }
    }
    if (el.classList.contains(styles.caret)) this.paintCaret(el, cs, ctx, alpha, x, y, w, h);
  }

  private paintCaret(el: HTMLElement, cs: CSSStyleDeclaration, ctx: Ctx, alpha: number, x: number, y: number, w: number, h: number) {
    const t = this.opts.t;
    if (el.classList.contains(styles.caretBlink)) {
      if (!this.caretSince.has(el)) this.caretSince.set(el, t);
      if (!caretVisible(t - (this.caretSince.get(el) ?? t))) return;
    } else this.caretSince.delete(el);
    const em = px(cs.fontSize, 16);
    const vertical = cs.writingMode.startsWith("vertical");
    const accent = cs.getPropertyValue("--ly-accent").trim() || "#ffffff";
    const r = vertical ? { x: x + 0.14 * em, y: y + h + 0.08 * em - 0.06 * em, w: Math.max(0, w - 0.28 * em), h: 0.06 * em } : { x: x + w + 0.08 * em - 0.06 * em, y: y + 0.14 * em, w: 0.06 * em, h: Math.max(0, h - 0.28 * em) };
    const shadows: Shadow[] = [{ color: accent, x: 0, y: 0, blur: 0.3 * em }];
    this.withShadows(ctx, shadows, this.color(accent), alpha, () => ctx.fillRect(r.x, r.y, r.w, r.h));
  }
}
