// Typesetting primitives: a horizontal row or a vertical column of a line's units as positioned
// glyph boxes. CJK characters sit in em cells, Latin words are one run each, spaces only advance;
// in columns brackets / dashes rotate, Latin runs go sideways and short numbers stay upright.

import type { FontRole, GlyphBox, Measure, PlateId } from "./model";
import { unitAdvance, unitColumnAdvance, verticalForm, type LineText } from "./text";

export interface RunStyle {
  /** font size, px */
  size: number;
  weight: number;
  /** letter spacing, em */
  tracking: number;
  plate: PlateId;
  /** plate of emphasized units (default: the accent plate) */
  emphPlate?: PlateId;
}

export interface SetResult {
  glyphs: GlyphBox[];
  /** extent along the reading direction and across it (px) */
  w: number;
  h: number;
}

function fontOf(u: { kind: string; text: string }): FontRole {
  if (u.kind === "latin") return "latin";
  if (u.kind === "punct") {
    const code = u.text.codePointAt(0) ?? 0;
    const fullwidth = (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef) || code === 0x2026 || code === 0x2014;
    return fullwidth ? "cjk" : "latin";
  }
  return "cjk";
}

/**
 * Letter spacing inside a Latin run (em): a tracked word is drawn with the spacing between its
 * letters too, so its cell must grow by it — else the word runs into the space after it
 * ("Theporchlighthums").
 */
function innerTracking(u: { kind: string; text: string }, tracking: number): number {
  return u.kind === "latin" && tracking > 0 ? tracking * Math.max(0, [...u.text].length - 1) : 0;
}

/** Width of units `idx` set as a row (px). */
export function rowWidth(lt: LineText, idx: readonly number[], st: Pick<RunStyle, "size" | "weight" | "tracking">, measure: Measure): number {
  let w = 0;
  let n = 0;
  for (const i of idx) {
    const u = lt.units[i];
    if (!u) continue;
    w += (unitAdvance(u, measure, st.weight) + innerTracking(u, st.tracking)) * st.size;
    n++;
  }
  return w + Math.max(0, n - 1) * st.tracking * st.size;
}

/** Height of units `idx` set as a column (px). */
export function columnHeight(lt: LineText, idx: readonly number[], st: Pick<RunStyle, "size" | "weight" | "tracking">, measure: Measure): number {
  let h = 0;
  let n = 0;
  for (const i of idx) {
    const u = lt.units[i];
    if (!u) continue;
    h += (unitColumnAdvance(u, measure, st.weight) + innerTracking(u, st.tracking)) * st.size;
    n++;
  }
  return h + Math.max(0, n - 1) * st.tracking * st.size;
}

/** Width in ems per unit size (for breaking): the row width of `idx` at size 1. */
export function rowEm(lt: LineText, idx: readonly number[], weight: number, tracking: number, measure: Measure): number {
  return rowWidth(lt, idx, { size: 1, weight, tracking }, measure);
}

export function columnEm(lt: LineText, idx: readonly number[], weight: number, tracking: number, measure: Measure): number {
  return columnHeight(lt, idx, { size: 1, weight, tracking }, measure);
}

/** A row whose left edge is `x` and vertical centre `yc`. `order` is the reading index of its first glyph. */
export function setRow(lt: LineText, idx: readonly number[], x: number, yc: number, st: RunStyle, measure: Measure, order = 0): SetResult {
  const glyphs: GlyphBox[] = [];
  let cursor = x;
  let k = order;
  let first = true;
  for (const i of idx) {
    const u = lt.units[i];
    if (!u) continue;
    if (!first) cursor += st.tracking * st.size;
    first = false;
    const adv = (unitAdvance(u, measure, st.weight) + innerTracking(u, st.tracking)) * st.size;
    if (u.kind !== "space") {
      const font = fontOf(u);
      glyphs.push({
        ch: u.text,
        font,
        weight: st.weight,
        size: st.size,
        x: cursor + adv / 2,
        y: yc,
        w: adv,
        h: st.size,
        rotate: 0,
        plate: lt.emph[i] ? (st.emphPlate ?? "accent") : st.plate,
        order: k++,
        unit: i,
        t0: u.t0,
        tracking: font === "latin" ? st.tracking * st.size : 0,
      });
    }
    cursor += adv;
  }
  return { glyphs, w: cursor - x, h: st.size };
}

/** A column whose horizontal centre is `xc` and top `y`. */
export function setColumn(lt: LineText, idx: readonly number[], xc: number, y: number, st: RunStyle, measure: Measure, order = 0): SetResult {
  const glyphs: GlyphBox[] = [];
  let cursor = y;
  let k = order;
  let first = true;
  for (const i of idx) {
    const u = lt.units[i];
    if (!u) continue;
    if (!first) cursor += st.tracking * st.size;
    first = false;
    const adv = (unitColumnAdvance(u, measure, st.weight) + innerTracking(u, st.tracking)) * st.size;
    if (u.kind !== "space") {
      const f = verticalForm(u);
      const font = fontOf(u);
      // sideways runs: the unrotated cell is (advance × size), turned a quarter
      glyphs.push({
        ch: u.text,
        font,
        weight: st.weight,
        size: st.size,
        x: xc,
        y: cursor + adv / 2,
        w: f.sideways ? adv : st.size,
        h: f.sideways ? st.size : adv,
        rotate: f.rotate,
        plate: lt.emph[i] ? (st.emphPlate ?? "accent") : st.plate,
        order: k++,
        unit: i,
        t0: u.t0,
        tracking: font === "latin" ? st.tracking * st.size : 0,
      });
    }
    cursor += adv;
  }
  return { glyphs, w: st.size, h: cursor - y };
}

/** Move glyphs by (dx, dy). */
export function shift(glyphs: GlyphBox[], dx: number, dy: number): GlyphBox[] {
  for (const g of glyphs) {
    g.x += dx;
    g.y += dy;
  }
  return glyphs;
}
