// Pure geometry and CSS-value parsing for the Canvas2D lyric painter (the video export draws
// the live DOM lyric layer into a canvas). Everything here is deterministic and unit tested; the
// painter itself (src/components/stage/export/LyricPainter.ts) only reads computed styles and
// layout boxes and hands them to these functions.

export interface Shadow {
  color: string;
  x: number;
  y: number;
  blur: number;
}

/** Split a CSS list on top-level commas (not inside parentheses). */
export function splitTopLevel(value: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const COLOR_RE = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|transparent|[a-z]+(?=\s|$))/i;

/**
 * Computed `text-shadow` ("rgba(0, 0, 0, 0.5) 0px 2px 4px, rgb(...) 0px 0px 20px") to a list,
 * in CSS paint order reversed: the first shadow is painted on top, so callers draw the returned
 * list front to back as given (last CSS shadow first).
 */
export function parseTextShadows(value: string | null | undefined): Shadow[] {
  if (!value || value === "none") return [];
  const out: Shadow[] = [];
  for (const part of splitTopLevel(value)) {
    const m = part.match(COLOR_RE);
    const color = m ? m[1] : "rgba(0, 0, 0, 1)";
    const rest = m ? part.replace(m[1], " ") : part;
    const nums = (rest.match(/-?[\d.]+(?:e-?\d+)?px|-?[\d.]+(?:e-?\d+)?/g) ?? []).map((n) => parseFloat(n));
    out.push({ color, x: nums[0] ?? 0, y: nums[1] ?? 0, blur: Math.max(0, nums[2] ?? 0) });
  }
  return out.reverse();
}

/** 2D affine matrix [a, b, c, d, e, f] (canvas setTransform order). */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Computed `transform` ("none" | "matrix(a, b, c, d, e, f)" | "matrix3d(...)") to a 2D matrix. */
export function parseMatrix(value: string | null | undefined): Matrix {
  if (!value || value === "none") return IDENTITY;
  const m2 = value.match(/^matrix\(([^)]*)\)$/);
  if (m2) {
    const v = m2[1].split(",").map((x) => parseFloat(x));
    if (v.length === 6 && v.every(Number.isFinite)) return v as Matrix;
    return IDENTITY;
  }
  const m3 = value.match(/^matrix3d\(([^)]*)\)$/);
  if (m3) {
    const v = m3[1].split(",").map((x) => parseFloat(x));
    if (v.length === 16 && v.every(Number.isFinite)) return [v[0], v[1], v[4], v[5], v[12], v[13]];
  }
  return IDENTITY;
}

export function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** Computed `transform-origin` ("12.5px 30px" or "12.5px 30px 0px") to [x, y]. */
export function parseOrigin(value: string | null | undefined, w: number, h: number): [number, number] {
  if (!value) return [w / 2, h / 2];
  const parts = value.trim().split(/\s+/);
  const one = (s: string | undefined, size: number) => {
    if (!s) return size / 2;
    if (s.endsWith("%")) return (parseFloat(s) / 100) * size;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : size / 2;
  };
  return [one(parts[0], w), one(parts[1], h)];
}

/** m1 · m2 (apply m2 first, then m1), canvas matrix convention. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

/** The CSS transform of an element whose border box starts at (x, y): T(x+ox, y+oy) · M · T(−x−ox, −y−oy). */
export function elementMatrix(m: Matrix, x: number, y: number, origin: [number, number]): Matrix {
  if (isIdentity(m)) return IDENTITY;
  const px = x + origin[0];
  const py = y + origin[1];
  return multiply(multiply([1, 0, 0, 1, px, py], m), [1, 0, 0, 1, -px, -py]);
}

/** Apply a matrix to a vector (no translation): where a local offset lands in device space. */
export function mapVector(m: Pick<DOMMatrix2DInit, "a" | "b" | "c" | "d"> | Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d] = Array.isArray(m) ? m : [m.a ?? 1, m.b ?? 0, m.c ?? 0, m.d ?? 1];
  return [a * x + c * y, b * x + d * y];
}

/** Uniform scale of a matrix (square root of the determinant), for blur radii. */
export function matrixScale(m: Pick<DOMMatrix2DInit, "a" | "b" | "c" | "d"> | Matrix): number {
  const [a, b, c, d] = Array.isArray(m) ? m : [m.a ?? 1, m.b ?? 0, m.c ?? 0, m.d ?? 1];
  return Math.sqrt(Math.abs(a * d - b * c)) || 1;
}

/**
 * The shadow pass draws the glyphs far off canvas and lets the shadow land on the real spot, so
 * only the shadow is visible (canvas shadows are drawn in device space, unaffected by the
 * transform, while CSS shadows scale and rotate with the element). Returns the device-space
 * shadow offset and blur for a CSS shadow under the current transform, given that the glyphs are
 * shifted by `shift` device pixels to the left.
 */
export function deviceShadow(shadow: Shadow, m: Pick<DOMMatrix2DInit, "a" | "b" | "c" | "d"> | Matrix, shift: number): { offsetX: number; offsetY: number; blur: number } {
  const [dx, dy] = mapVector(m, shadow.x, shadow.y);
  return { offsetX: dx + shift, offsetY: dy, blur: shadow.blur * matrixScale(m) };
}

/**
 * Baseline of a single-line inline box of height `lineHeight` (CSS half-leading model): the
 * content area (ascent + descent) is centered in the line box.
 */
export function baselineIn(top: number, lineHeight: number, ascent: number, descent: number): number {
  return top + (lineHeight - (ascent + descent)) / 2 + ascent;
}

/** Horizontal start of a text run of width `textW` in a box, for a computed `text-align`. */
export function alignStart(boxX: number, boxW: number, textW: number, align: string, rtl = false): number {
  const a = align === "start" ? (rtl ? "right" : "left") : align === "end" ? (rtl ? "left" : "right") : align;
  if (a === "center" || a === "-webkit-center") return boxX + (boxW - textW) / 2;
  if (a === "right" || a === "-webkit-right") return boxX + boxW - textW;
  return boxX;
}

/** Computed `clip-path: inset(t r b l)` to a rect inside a w × h box; null = no clip. */
export function parseInset(value: string | null | undefined, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  if (!value || value === "none") return null;
  const m = value.match(/^inset\(([^)]*)\)/);
  if (!m) return null;
  const raw = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/);
  const vals = raw.length === 1 ? [raw[0], raw[0], raw[0], raw[0]] : raw.length === 2 ? [raw[0], raw[1], raw[0], raw[1]] : raw.length === 3 ? [raw[0], raw[1], raw[2], raw[1]] : raw;
  const len = (s: string, size: number) => (s.endsWith("%") ? (parseFloat(s) / 100) * size : parseFloat(s) || 0);
  const top = len(vals[0], h);
  const right = len(vals[1], w);
  const bottom = len(vals[2], h);
  const left = len(vals[3], w);
  return { x: left, y: top, w: Math.max(0, w - left - right), h: Math.max(0, h - top - bottom) };
}

/** The ::before scrim of a lyric block: inset −0.5em −1.1em, an ellipse gradient to transparent. */
export function scrimRect(x: number, y: number, w: number, h: number, em: number): { cx: number; cy: number; rx: number; ry: number; x: number; y: number; w: number; h: number } {
  const sx = x - 1.1 * em;
  const sy = y - 0.5 * em;
  const sw = w + 2.2 * em;
  const sh = h + 1.0 * em;
  return { cx: sx + sw / 2, cy: sy + sh / 2, rx: sw / 2, ry: sh / 2, x: sx, y: sy, w: sw, h: sh };
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Computed colour ("rgb(1, 2, 3)" | "rgba(1, 2, 3, 0.5)" | "#rrggbb") to numbers. */
export function parseColor(value: string | null | undefined): Rgba {
  if (!value) return { r: 0, g: 0, b: 0, a: 0 };
  const v = value.trim();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const m = v.match(/^rgba?\(([^)]*)\)$/i);
  if (m) {
    const raw = m[1].split(/[\s,/]+/).filter(Boolean);
    const num = (p: string | undefined, scale: number, fallback: number) => (p == null ? fallback : p.endsWith("%") ? (parseFloat(p) / 100) * scale : parseFloat(p));
    const a = num(raw[3], 1, 1);
    return { r: num(raw[0], 255, 0), g: num(raw[1], 255, 0), b: num(raw[2], 255, 0), a: Math.min(1, Math.max(0, Number.isFinite(a) ? a : 1)) };
  }
  const h = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (h) {
    const n = parseInt(h[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h[2] ? parseInt(h[2], 16) / 255 : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export function rgbaString(c: Rgba): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 1000) / 1000})`;
}

/** The same colour with alpha 0 (a gradient to "transparent" in premultiplied space). */
export function transparentOf(value: string): string {
  return rgbaString({ ...parseColor(value), a: 0 });
}

/** For the luma matte: white at the colour's own alpha. */
export function matteColor(value: string): string {
  return rgbaString({ r: 255, g: 255, b: 255, a: parseColor(value).a });
}

/** `caretBlink` (1.1 s, steps(1), hidden in the second half) as a function of time since it started. */
export const CARET_BLINK_SECONDS = 1.1;
export function caretVisible(sinceSeconds: number): boolean {
  if (!(sinceSeconds > 0)) return true;
  const p = (sinceSeconds % CARET_BLINK_SECONDS) / CARET_BLINK_SECONDS;
  return p < 0.5;
}

/** Latin (and digit) characters are set sideways in vertical-rl + text-orientation: mixed. */
export function isSidewaysChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x2e80 && !/[　-〿＀-￯]/.test(ch);
}

/** Margin around a block's layer canvas so the scrim, shadows and glows are not clipped. */
export function layerMargin(em: number, maxShadowBlur: number): number {
  return Math.ceil(Math.max(1.2 * em, 0.6 * em + maxShadowBlur * 1.5) + 4);
}
