// Composition recipes: each lays one lyric line out as a typographic composition on the frame
// (output canvas pixels), parameterized by the song's type system and seeded per line. Recipes
// only place text; compose.ts adds ornaments, applies the editor's nudges and guarantees the
// legibility rules (readable text inside the readable area, never below the minimum size).
//
// Reading order is always clear: rows read left → right and top → bottom, vertical columns top →
// bottom and right → left, and a composition that mixes them (巨字＋小字, 直橫交錯) arranges its
// pieces so the eye travels from the first to the last without jumping back.

import type { TypeRecipeId } from "../types";
import { colRight, colX, type Frame } from "./frame";
import type { Box, GlyphBox, LineContext, Measure, Piece, PieceRole, PlateId, ResolvedHint, ResolvedTypeSystem } from "./model";
import { createRng, hashUnit, type Rng } from "./rng";
import { columnEm, rowEm, setColumn, setRow, type RunStyle } from "./set";
import { breakRows, keySpan, splitLongLine, trimIndices, type LineText } from "./text";

export interface Zone {
  /** where the composition leans: the sequencer alternates these between consecutive lines */
  side: "left" | "right" | "center";
  band: "top" | "middle";
}

const SIDES: Zone["side"][] = ["left", "right", "center"];

/** The zone a seed chooses (independent of the canvas, so the sequencer can vary it). */
export function zoneFor(seed: number): Zone {
  const u = hashUnit(`zone|${Math.round(seed)}`);
  const v = hashUnit(`band|${Math.round(seed)}`);
  return { side: SIDES[Math.min(2, Math.floor(u * 3))], band: v < 0.55 ? "top" : "middle" };
}

export interface RecipeCtx {
  lt: LineText;
  hint: ResolvedHint;
  sys: ResolvedTypeSystem;
  frame: Frame;
  ctx: LineContext;
  measure: Measure;
  rng: Rng;
  zone: Zone;
  /** energy with the last chorus' escalation */
  e: number;
  /** scale contrast, density */
  c: number;
  d: number;
  /** sizes (px) */
  body: number;
  small: number;
  giant: number;
  /** the largest a display size may get (restrained lines: a step above the body; key lines: no cap) */
  cap: number;
  weight: number;
  /** plate and window flag of display type (the giant / bled word) */
  displayPlate: PlateId;
  displayWindow: boolean;
  /** plate of the main text (colour role: ink or accent) */
  mainPlate: PlateId;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

function allIdx(lt: LineText, from = 0, to = lt.units.length): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return trimIndices(lt.units, out);
}

/** The span holds no CJK character (a Latin display word such as "Hey"): it reads horizontally only. */
function latinSpan(lt: LineText, idx: readonly number[]): boolean {
  return idx.length > 0 && idx.every((i) => lt.units[i]?.kind !== "cjk");
}

export function piece(role: PieceRole, glyphs: GlyphBox[], o: Partial<Piece> & { plate: PlateId }): Piece {
  return { role, glyphs, alpha: 1, delay: 0, vertical: false, readable: role === "main" || role === "giant" || role === "small", ...o };
}

function style(r: RecipeCtx, size: number, tracking: number, plate: PlateId = r.mainPlate): RunStyle {
  return { size, weight: r.weight, tracking, plate, emphPlate: plate === "accent" ? "ink" : "accent" };
}

interface RowsFit {
  size: number;
  rows: number[][];
  widths: number[];
  /** block width / height at this size (px) */
  w: number;
  h: number;
}

/**
 * The largest size ≤ `wanted` (never below `min`) at which units [from, to) break into ≤ maxRows
 * rows of at most maxW px, stacked with `leading` (× size) within maxH px.
 */
function fitRows(r: RecipeCtx, from: number, to: number, o: { wanted: number; min: number; maxW: number; maxH: number; maxRows: number; tracking: number; leading: number; pyramid?: boolean }): RowsFit | null {
  const idx = allIdx(r.lt, from, to);
  if (!idx.length) return null;
  const width = (ix: number[]) => rowEm(r.lt, ix, r.weight, o.tracking, r.measure);
  let size = Math.max(o.min, o.wanted);
  for (let guard = 0; guard < 40; guard++) {
    const rows = breakRows(r.lt.units, from, to, { max: o.maxW / size, maxRows: o.maxRows, width, pyramid: o.pyramid, wordStarts: r.lt.wordStarts });
    const widths = rows.map((row) => width(row) * size);
    const w = Math.max(0, ...widths);
    const h = rows.length * size + (rows.length - 1) * size * (o.leading - 1);
    if ((w <= o.maxW + 0.5 && h <= o.maxH + 0.5) || size <= o.min + 1e-6) return { size, rows, widths, w, h };
    size = Math.max(o.min, size * 0.93);
  }
  return null;
}

interface ColsFit {
  size: number;
  cols: number[][];
  heights: number[];
  w: number;
  h: number;
  gap: number;
}

/** No column stands taller than this share of the frame (B4: a 27-character column ran off the safe area). */
export const MAX_COLUMN_FRACTION = 0.7;

/** Columns: at most maxCols columns of at most maxH px (never over 70 % of the frame), the block at most maxW px wide. */
function fitColumns(r: RecipeCtx, from: number, to: number, o: { wanted: number; min: number; maxW: number; maxH: number; maxCols: number; tracking: number; gap: number }): ColsFit | null {
  const idx = allIdx(r.lt, from, to);
  if (!idx.length) return null;
  const maxH = Math.min(o.maxH, r.frame.H * MAX_COLUMN_FRACTION);
  const height = (ix: number[]) => columnEm(r.lt, ix, r.weight, o.tracking, r.measure);
  let size = Math.max(o.min, o.wanted);
  for (let guard = 0; guard < 40; guard++) {
    const cols = breakRows(r.lt.units, from, to, { max: maxH / size, maxRows: o.maxCols, width: height, wordStarts: r.lt.wordStarts });
    const heights = cols.map((c) => height(c) * size);
    const h = Math.max(0, ...heights);
    const gap = size * o.gap;
    const w = cols.length * size + (cols.length - 1) * gap;
    if ((h <= maxH + 0.5 && w <= o.maxW + 0.5) || size <= o.min + 1e-6) return { size, cols, heights, w, h, gap };
    size = Math.max(o.min, size * 0.93);
  }
  return null;
}

/** Glyphs of fitted rows, left-aligned at x (or right / centre aligned within the block width). */
function placeRows(r: RecipeCtx, fit: RowsFit, x: number, y: number, st: RunStyle, leading: number, align: "left" | "right" | "center" = "left", order = 0): GlyphBox[] {
  const out: GlyphBox[] = [];
  let k = order;
  fit.rows.forEach((row, i) => {
    const w = fit.widths[i];
    const rx = align === "left" ? x : align === "right" ? x + fit.w - w : x + (fit.w - w) / 2;
    const yc = y + i * st.size * leading + st.size / 2;
    const set = setRow(r.lt, row, rx, yc, st, r.measure, k);
    k += set.glyphs.length;
    out.push(...set.glyphs);
  });
  return out;
}

/** Glyphs of fitted columns, right to left from the block's right edge. */
function placeColumns(r: RecipeCtx, fit: ColsFit, right: number, top: number, st: RunStyle, stagger = 0, order = 0, alignBottom = false): GlyphBox[] {
  const out: GlyphBox[] = [];
  let k = order;
  fit.cols.forEach((col, i) => {
    const xc = right - st.size / 2 - i * (st.size + fit.gap);
    const y = alignBottom ? top + fit.h - fit.heights[i] : top + i * stagger;
    const set = setColumn(r.lt, col, xc, y, st, r.measure, k);
    k += set.glyphs.length;
    out.push(...set.glyphs);
  });
  return out;
}

function sideX(r: RecipeCtx, w: number, inset = 0): number {
  const f = r.frame;
  const g = f.grid;
  switch (r.zone.side) {
    case "left":
      return colX(g, Math.min(inset, g.cols - 1));
    case "right":
      return Math.max(g.box.x, colRight(g, -1 - Math.min(inset, g.cols - 1)) - w);
    default:
      return f.read.x + (f.read.w - w) / 2;
  }
}

function bandY(r: RecipeCtx, h: number, topFrac = 0.1, midFrac = 0.46): number {
  const rd = r.frame.read;
  const free = Math.max(0, rd.h - h);
  // a tall frame has room above and below: the composition stands around its optical centre
  const tall = r.frame.aspect < 0.8;
  return rd.y + free * (r.zone.band === "top" ? (tall ? Math.max(topFrac, 0.34) : topFrac) : tall ? Math.max(midFrac, 0.64) : midFrac);
}

export function translationPiece(r: RecipeCtx, x: number, y: number, maxW: number, align: "left" | "right" | "center" = "left"): Piece | null {
  const tr = r.lt.translation;
  if (!tr) return null;
  const rd = r.frame.read;
  maxW = Math.min(maxW, rd.w);
  x = clamp(x, rd.x, rd.x + rd.w - maxW);
  y = Math.min(y, rd.y + rd.h - r.frame.minRead * 2.2);
  const size = Math.max(r.frame.minRead * 0.78, Math.min(r.small * 0.72, r.frame.minRead * 1.2));
  const weight = Math.max(500, r.weight - 200);
  // a translation is set as one plain Latin / CJK run (it has no timing of its own)
  const glyphs: GlyphBox[] = [];
  const words = tr.split(/\s+/).filter(Boolean);
  const spaceW = 0.3 * size;
  const widths = words.map((w) => r.measure(w, /[㐀-鿿]/.test(w) ? "cjk" : "latin", weight) * size);
  const runW = (a: number, b: number) => widths.slice(a, b).reduce((s, w) => s + w, 0) + spaceW * Math.max(0, b - a - 1);
  let rows: string[][] = [words];
  if (runW(0, words.length) > maxW && words.length > 1) {
    // two rows split where the wider one is as short as it can be (no widowed last word)
    let best = 1;
    let bestW = Infinity;
    for (let k = 1; k < words.length; k++) {
      const m = Math.max(runW(0, k), runW(k, words.length));
      if (m < bestW) {
        bestW = m;
        best = k;
      }
    }
    rows = [words.slice(0, best), words.slice(best)];
  }
  rows.forEach((row, ri) => {
    const text = row.join(" ");
    const cjk = /[㐀-鿿]/.test(text);
    const w = r.measure(text, cjk ? "cjk" : "latin", weight) * size;
    const rx = align === "left" ? x : align === "right" ? x + maxW - w : x + (maxW - w) / 2;
    glyphs.push({ ch: text, font: cjk ? "cjk" : "latin", weight, size, x: rx + w / 2, y: y + ri * size * 1.25 + size / 2, w, h: size, rotate: 0, plate: "ink", order: 900 + ri, unit: -1, t0: 0, tracking: 0 });
  });
  return piece("translation", glyphs, { plate: "ink", alpha: 0.86, readable: true, delay: 0.12 });
}

// ---------------------------------------------------------------------------
// 巨字＋小字
// ---------------------------------------------------------------------------

function giantWord(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  const key = keySpan(lt, r.hint.motionWord, lt.latinOnly ? 1 : 3);
  if (!key) return null;
  const [k0, k1] = key;
  const kIdx = allIdx(lt, k0, k1);
  // a Latin display word (Hey) is never stood up sideways, whatever the canvas or the orientation
  const orient = lt.latinOnly || !lt.cjk || latinSpan(lt, kIdx) ? "h" : r.hint.orientation;
  const before: [number, number] = [0, k0];
  const after: [number, number] = [k1, lt.units.length];
  const hasBefore = allIdx(lt, ...before).length > 0;
  const hasAfter = allIdx(lt, ...after).length > 0;
  const rd = f.read;
  const gTrack = lt.latinOnly ? -0.01 : 0.02;
  const pieces: Piece[] = [];

  if (orient === "h") {
    const kEm = rowEm(lt, kIdx, r.weight, gTrack, r.measure);
    let G = Math.min(r.giant * (kIdx.length > 2 ? 0.8 : 1), (rd.w * 0.86) / kEm, rd.h * 0.66);
    for (let guard = 0; guard < 12; guard++) {
      const S = clamp(G * lerp(0.27, 0.13, r.c), f.minRead, Math.max(f.minRead, r.body));
      const smallW = Math.max(G * kEm, rd.w * 0.46);
      const fb = hasBefore ? fitRows(r, ...before, { wanted: S, min: f.minRead, maxW: smallW, maxH: rd.h * 0.3, maxRows: 3, tracking: 0.04, leading: 1.28 }) : null;
      const fa = hasAfter ? fitRows(r, ...after, { wanted: S, min: f.minRead, maxW: smallW, maxH: rd.h * 0.3, maxRows: 3, tracking: 0.04, leading: 1.28 }) : null;
      const gap = S * 0.45;
      const gH = G * 0.94;
      const stackH = (fb ? fb.h + gap : 0) + gH + (fa ? fa.h + gap : 0);
      if (stackH > rd.h && G > f.minRead * 2) {
        G *= 0.92;
        continue;
      }
      const kW = kEm * G;
      const blockW = Math.max(kW, fb?.w ?? 0, fa?.w ?? 0);
      const x = sideX(r, blockW);
      let y = bandY(r, stackH, 0.12, 0.44);
      const kx = r.zone.side === "right" ? x + blockW - kW : r.zone.side === "center" ? x + (blockW - kW) / 2 : x;
      if (fb) {
        pieces.push(piece("small", placeRows(r, fb, kx, y, style(r, fb.size, 0.04), 1.28, "left", 0), { plate: r.mainPlate }));
        y += fb.h + gap;
      }
      const kGlyphs = setRow(lt, kIdx, kx, y + gH / 2, style(r, G, gTrack, r.displayPlate), r.measure, 100).glyphs;
      pieces.push(piece("giant", kGlyphs, { plate: r.displayPlate, window: r.displayWindow, delay: fb ? 0.1 : 0 }));
      y += gH + gap;
      if (fa) {
        // the rest hangs from the giant word's right edge: the eye runs on diagonally
        const ax = Math.max(rd.x, Math.min(rd.x + rd.w - fa.w, kx + kW - fa.w));
        pieces.push(piece("small", placeRows(r, fa, ax, y, style(r, fa.size, 0.04), 1.28, "right", 200), { plate: r.mainPlate, delay: 0.2 }));
        y += fa.h;
      }
      const tp = translationPiece(r, x, y + gap * 0.6, Math.max(blockW, rd.w * 0.4));
      if (tp) pieces.push(tp);
      return pieces;
    }
    return null;
  }

  // vertical giant: "mixed" pairs it with horizontal small text, "v" with small columns
  const kEm = columnEm(lt, kIdx, r.weight, 0, r.measure);
  const G = Math.min(r.giant * 1.05, (rd.h * 0.86) / kEm, rd.w * 0.42);
  const S0 = clamp(G * lerp(0.28, 0.14, r.c), f.minRead, Math.max(f.minRead, r.body * 0.92));
  const kH = kEm * G;
  if (orient === "mixed") {
    const gap = S0 * 0.7;
    const room = rd.w - G - gap * 2;
    const smallW = clamp(room * (r.zone.side === "center" ? 0.46 : 0.8), f.minRead * 4, rd.w * 0.52);
    const fb = hasBefore ? fitRows(r, ...before, { wanted: S0, min: f.minRead, maxW: smallW, maxH: kH * 0.46, maxRows: 3, tracking: 0.04, leading: 1.3 }) : null;
    const fa = hasAfter ? fitRows(r, ...after, { wanted: S0, min: f.minRead, maxW: smallW, maxH: kH * 0.46, maxRows: 3, tracking: 0.04, leading: 1.3 }) : null;
    const top = bandY(r, kH, 0.08, 0.45);
    let kxLeft: number;
    if (r.zone.side === "center") kxLeft = rd.x + (rd.w - G) / 2;
    else if (r.zone.side === "right") kxLeft = colRight(f.grid, -1) - G;
    else kxLeft = colX(f.grid, 0);
    const kGlyphs = setColumn(lt, kIdx, kxLeft + G / 2, top, style(r, G, 0, r.displayPlate), r.measure, 100).glyphs;
    // before: beside the column's top, on the inner side (left of a centred column); after: at its foot, the other side
    const innerRight = r.zone.side !== "right";
    if (fb) {
      const bx = r.zone.side === "center" ? kxLeft - gap - fb.w : innerRight ? kxLeft + G + gap : kxLeft - gap - fb.w;
      pieces.push(piece("small", placeRows(r, fb, bx, top + G * 0.08, style(r, fb.size, 0.04), 1.3, r.zone.side === "center" || !innerRight ? "right" : "left", 0), { plate: r.mainPlate }));
    }
    pieces.push(piece("giant", kGlyphs, { plate: r.displayPlate, window: r.displayWindow, vertical: true, delay: fb ? 0.1 : 0 }));
    if (fa) {
      const ax = r.zone.side === "center" ? kxLeft + G + gap : innerRight ? kxLeft + G + gap : kxLeft - gap - fa.w;
      pieces.push(piece("small", placeRows(r, fa, ax, top + kH - fa.h - G * 0.04, style(r, fa.size, 0.04), 1.3, innerRight || r.zone.side === "center" ? "left" : "right", 200), { plate: r.mainPlate, delay: 0.2 }));
    }
    const tp = translationPiece(r, r.zone.side === "right" ? rd.x + rd.w * 0.4 : kxLeft + G + gap, top + kH + S0 * 0.4, rd.w * 0.45);
    if (tp) pieces.push(tp);
    return pieces;
  }
  // "v": small columns right (before) and left (after) of the giant column
  const gap = S0 * 0.55;
  const fb = hasBefore ? fitColumns(r, ...before, { wanted: S0, min: f.minRead, maxW: rd.w * 0.25, maxH: kH, maxCols: 3, tracking: 0.06, gap: 0.45 }) : null;
  const fa = hasAfter ? fitColumns(r, ...after, { wanted: S0, min: f.minRead, maxW: rd.w * 0.25, maxH: kH, maxCols: 3, tracking: 0.06, gap: 0.45 }) : null;
  const blockW = (fb ? fb.w + gap : 0) + G + (fa ? fa.w + gap : 0);
  const x = sideX(r, blockW);
  const top = bandY(r, kH, 0.08, 0.45);
  let right = x + blockW;
  if (fb) {
    pieces.push(piece("small", placeColumns(r, fb, right, top, style(r, fb.size, 0.06), 0, 0), { plate: r.mainPlate, vertical: true }));
    right -= fb.w + gap;
  }
  pieces.push(piece("giant", setColumn(lt, kIdx, right - G / 2, top, style(r, G, 0, r.displayPlate), r.measure, 100).glyphs, { plate: r.displayPlate, window: r.displayWindow, vertical: true, delay: fb ? 0.1 : 0 }));
  right -= G + gap;
  if (fa) pieces.push(piece("small", placeColumns(r, fa, right, top, style(r, fa.size, 0.06), 0, 200, true), { plate: r.mainPlate, vertical: true, delay: 0.2 }));
  const tp = translationPiece(r, x, top + kH + S0 * 0.4, blockW);
  if (tp) pieces.push(tp);
  return pieces;
}

// ---------------------------------------------------------------------------
// 直排欄 and 書寫
// ---------------------------------------------------------------------------

function columns(r: RecipeCtx, big: boolean): Piece[] | null {
  const { lt, frame: f } = r;
  if (!lt.cjk) return null;
  const rd = f.read;
  const size = r.body * (big ? lerp(1.05, 1.28, r.e) : lerp(0.92, 1.08, r.e));
  const tracking = lerp(0.2, 0.06, r.d);
  const fit = fitColumns(r, 0, lt.units.length, { wanted: size, min: f.minRead, maxW: rd.w * (f.aspect < 1 ? 0.8 : 0.5), maxH: rd.h * lerp(0.66, 0.86, r.d), maxCols: big ? 2 : 3, tracking, gap: lerp(0.95, 0.55, r.d) });
  if (!fit) return null;
  let stagger = fit.cols.length > 1 && r.rng.chance(0.5) ? fit.size * (big ? 0.9 : 1.6) : 0;
  if (stagger) {
    stagger = Math.min(stagger, (rd.h * 0.9 - fit.h) / (fit.cols.length - 1));
    if (stagger < fit.size * 0.5) stagger = 0;
  }
  const blockH = fit.h + stagger * (fit.cols.length - 1);
  const x = sideX(r, fit.w, r.rng.chance(0.4) ? 1 : 0);
  const top = bandY(r, blockH, 0.06, 0.42);
  const glyphs = placeColumns(r, fit, x + fit.w, top, style(r, fit.size, tracking), stagger);
  const pieces = [piece("main", glyphs, { plate: r.mainPlate, vertical: true })];
  const tp = translationPiece(r, x, top + blockH + fit.size * 0.5, Math.max(fit.w * 2, rd.w * 0.3));
  if (tp) pieces.push(tp);
  return pieces;
}

// ---------------------------------------------------------------------------
// 直橫交錯
// ---------------------------------------------------------------------------

function cross(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  if (!lt.cjk) return null;
  const rd = f.read;
  const all = allIdx(lt);
  const cjkCount = all.filter((i) => lt.units[i].kind === "cjk").length;
  if (cjkCount < 3) return null;
  // split at the phrase boundary nearest the middle, else at the middle character
  let split = -1;
  let bestD = Infinity;
  const half = cjkCount / 2;
  let count = 0;
  for (const [a, b] of lt.phrases) {
    for (let i = a; i < b; i++) if (lt.units[i].kind === "cjk") count++;
    const d = Math.abs(count - half);
    if (b < lt.units.length && d < bestD && count >= 2 && cjkCount - count >= 1) {
      bestD = d;
      split = b;
    }
  }
  if (split < 0 || bestD > cjkCount * 0.3) {
    let n = 0;
    for (let i = 0; i < lt.units.length; i++) {
      if (lt.units[i].kind === "cjk") n++;
      if (n >= Math.ceil(half)) {
        split = i + 1;
        break;
      }
    }
  }
  const aIdx = allIdx(lt, 0, split);
  const bIdx = allIdx(lt, split, lt.units.length);
  if (!aIdx.length || !bIdx.length) return null;
  const aBig = r.rng.chance(0.55);
  let sa = r.body * (aBig ? lerp(1.2, 1.6, r.c) : 0.86);
  let sb = r.body * (aBig ? 0.84 : lerp(1.15, 1.45, r.c));
  const aEm = columnEm(lt, aIdx, r.weight, 0.06, r.measure);
  const bEm = rowEm(lt, bIdx, r.weight, 0.04, r.measure);
  for (let guard = 0; guard < 30; guard++) {
    const hA = aEm * sa;
    const wB = bEm * sb;
    const gap = sb * 0.18;
    const blockW = sa + gap + wB;
    if ((hA <= rd.h * 0.84 && blockW <= rd.w * 0.94) || (sa <= f.minRead && sb <= f.minRead)) break;
    sa = Math.max(f.minRead, sa * 0.94);
    sb = Math.max(f.minRead, sb * 0.94);
  }
  const hA = aEm * sa;
  const wB = bEm * sb;
  const gap = sb * 0.18;
  let rowsB: RowsFit | null = null;
  if (sa + gap + wB > rd.w * 0.94) {
    // still too long: the horizontal half wraps under itself
    rowsB = fitRows(r, split, lt.units.length, { wanted: sb, min: f.minRead, maxW: rd.w * 0.94 - sa - gap, maxH: rd.h * 0.4, maxRows: 2, tracking: 0.04, leading: 1.2 });
  }
  const bW = rowsB ? rowsB.w : wB;
  const blockW = sa + gap + bW;
  const blockH = hA + (rowsB ? rowsB.h - rowsB.size : 0);
  const x = sideX(r, blockW);
  const top = bandY(r, blockH, 0.08, 0.4);
  const aGlyphs = setColumn(lt, aIdx, x + sa / 2, top, style(r, sa, 0.06), r.measure, 0).glyphs;
  const cornerY = top + hA - sa / 2;
  const pieces: Piece[] = [piece(aBig ? "giant" : "main", aGlyphs, { plate: aBig ? r.displayPlate : r.mainPlate, window: aBig && r.displayWindow, vertical: true })];
  if (rowsB) {
    const g = placeRows(r, rowsB, x + sa + gap, cornerY - rowsB.size / 2, style(r, rowsB.size, 0.04), 1.2, "left", 100);
    pieces.push(piece("main", g, { plate: r.mainPlate, delay: 0.14 }));
  } else {
    const g = setRow(lt, bIdx, x + sa + gap, cornerY, style(r, sb, 0.04, aBig ? r.mainPlate : r.displayPlate), r.measure, 100).glyphs;
    pieces.push(piece(aBig ? "main" : "giant", g, { plate: aBig ? r.mainPlate : r.displayPlate, window: !aBig && r.displayWindow, delay: 0.14 }));
  }
  const tp = translationPiece(r, x + sa + gap, cornerY + Math.max(sb, rowsB?.h ?? 0) * 0.75, rd.w * 0.5);
  if (tp) pieces.push(tp);
  return pieces;
}

// ---------------------------------------------------------------------------
// 網格詩
// ---------------------------------------------------------------------------

interface Cell {
  unit: number;
  span: number;
}

function gridPoem(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  // a grid of em cells is a CJK form: Latin words forced into cells leave half the grid empty
  if (!lt.cjk || lt.units.some((u) => u.kind === "latin")) return null;
  const rd = f.read;
  const vertical = r.hint.orientation === "v" && lt.cjk;
  // a CJK character (or a kept mark) takes one cell, a Latin word the cells its width needs
  const span = new Map<number, number>();
  lt.units.forEach((u, i) => {
    if (u.kind === "space") return;
    if (u.kind === "punct" && !"「」『』！？…".includes(u.text)) return;
    span.set(i, u.kind === "latin" ? Math.max(1, Math.ceil(r.measure(u.text, "latin", r.weight) / 0.92)) : 1);
  });
  if (!span.size) return null;
  const cellsIn = (idx: number[]) => idx.reduce((a, i) => a + (span.get(i) ?? 0), 0);
  const total = cellsIn([...span.keys()]);
  const maxCols = f.aspect < 1 ? 5 : f.aspect > 2.4 ? 12 : 8;
  // the poem's lines break at phrases and words and balance (never 「城市 / 的邊緣」, never one orphan cell)
  const oneRow = f.aspect < 1 ? 5 : f.aspect > 2.4 ? 12 : 7;
  const wanted = total <= oneRow ? 1 : total <= maxCols * 2 ? 2 : 3;
  const cols0 = clamp(Math.ceil(total / wanted), 3, maxCols);
  // one cell of slack: a word is never split to square the grid
  const rowsIdx = wanted === 1 ? [allIdx(lt)] : breakRows(lt.units, 0, lt.units.length, { max: Math.min(maxCols, cols0 + 1), maxRows: 4, width: cellsIn, wordStarts: lt.wordStarts });
  const lines: Cell[][] = rowsIdx.map((row) => row.filter((i) => span.has(i)).map((i) => ({ unit: i, span: span.get(i)! }))).filter((l) => l.length > 0);
  if (!lines.length) return null;
  const cols = clamp(Math.max(cols0, ...lines.map((l) => l.reduce((a, c) => a + c.span, 0))), 3, maxCols + 2);
  const rows = lines.length;
  const across = vertical ? rows : cols;
  const down = vertical ? cols : rows;
  // a tall frame's grid is set larger (the poem is the picture there)
  const cell = Math.max(f.minRead / 0.72, Math.min((rd.w * (f.aspect < 1 ? 0.92 : 0.66)) / across, (rd.h * 0.8) / down, r.body * lerp(1.15, 1.45, r.e) * (f.aspect < 0.8 ? 1.35 : 1), r.cap / 0.72));
  const gw = across * cell;
  const gh = down * cell;
  const x0 = sideX(r, gw);
  const y0 = bandY(r, gh, 0.08, 0.42);
  const size = cell * 0.72;
  const glyphs: GlyphBox[] = [];
  const chips: Piece[] = [];
  let order = 0;
  lines.forEach((line, li) => {
    const used = line.reduce((a, c) => a + c.span, 0);
    // a later, shorter line may start a cell in (the indent of a poem); the rest of the grid stays empty
    let pos = !vertical && li > 0 && used <= cols - 2 && r.rng.chance(0.4) ? 1 : 0;
    for (const c of line) {
      const u = lt.units[c.unit];
      const cx = vertical ? x0 + gw - (li + 0.5) * cell : x0 + (pos + c.span / 2) * cell;
      const cy = vertical ? y0 + (pos + 0.5) * cell : y0 + (li + 0.5) * cell;
      const emph = lt.emph[c.unit];
      const set = vertical ? setColumn(lt, [c.unit], cx, cy - size / 2, style(r, size, 0), r.measure, order) : setRow(lt, [c.unit], cx - (r.measure(u.text, u.kind === "latin" ? "latin" : "cjk", r.weight) * size) / 2, cy, style(r, size, 0), r.measure, order);
      order += set.glyphs.length;
      glyphs.push(...set.glyphs);
      if (emph) chips.push(piece("chip", [], { plate: "accent", alpha: 0.24, readable: false, rect: { x: cx - (cell * c.span) / 2 + 2, y: cy - cell / 2 + 2, w: cell * c.span - 4, h: cell - 4 } }));
      pos += c.span;
    }
  });
  const grid = piece("grid", [], { plate: "ink", alpha: 0.22, readable: false, rect: { x: x0, y: y0, w: gw, h: gh }, grid: { cols: across, rows: down } });
  const out = [grid, ...chips, piece("main", glyphs, { plate: r.mainPlate, vertical })];
  const tp = translationPiece(r, x0, y0 + gh + cell * 0.3, Math.max(gw, rd.w * 0.3));
  if (tp) out.push(tp);
  return out;
}

// ---------------------------------------------------------------------------
// 出血
// ---------------------------------------------------------------------------

function bleed(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  const rd = f.read;
  const key = keySpan(lt, r.hint.motionWord, 2);
  if (!key) return null;
  const kIdx = allIdx(lt, ...key);
  const vertical = lt.cjk && !latinSpan(lt, kIdx) && (r.hint.orientation === "v" || (f.aspect < 0.85 && r.hint.orientation !== "h"));
  const crop = r.rng.range(0.14, 0.26);
  const pieces: Piece[] = [];
  const plate = r.displayWindow ? "spot" : r.displayPlate;
  const gap = f.minRead * 0.8;
  // the bled word is a display word: full ink, no alpha (B3)
  const giantOpts = { plate, window: r.displayWindow, bleed: true, readable: false, alpha: 1 } as const;
  if (!vertical) {
    const kEm = rowEm(lt, kIdx, r.weight, -0.02, r.measure);
    const n = Math.max(1, kEm);
    // as large as the frame allows while a readable column stays free beside it
    const roomy = (rd.w * 0.62 - gap) / Math.max(0.6, n - crop);
    const G = Math.min(f.H * lerp(0.7, 0.98, r.c), (f.W * 0.74) / Math.max(0.6, n - crop), f.H * 0.98, Math.max(roomy, f.H * 0.46));
    const kW = kEm * G;
    const leftEdge = r.zone.side !== "right";
    const kx = leftEdge ? -crop * G : f.W - kW + crop * G;
    let cy = f.H * (r.zone.band === "top" ? 0.44 : 0.52);
    // the readable line in the free side, its top on the giant's top (or its foot on the giant's foot)
    const visible = leftEdge ? kx + kW : kx;
    const freeX = leftEdge ? Math.max(rd.x, visible + gap) : rd.x;
    const freeW = leftEdge ? rd.x + rd.w - freeX : Math.min(rd.w, visible - gap - rd.x);
    let fit: RowsFit | null = null;
    let x = freeX;
    let y = rd.y;
    if (freeW >= rd.w * 0.24) {
      fit = fitRows(r, 0, lt.units.length, { wanted: r.body * 0.8, min: f.minRead, maxW: Math.min(freeW, rd.w * 0.46), maxH: rd.h * 0.6, maxRows: 4, tracking: 0.04, leading: 1.26 });
      if (fit) {
        x = leftEdge ? freeX : freeX + freeW - fit.w;
        y = r.zone.band === "top" ? clamp(cy - G * 0.4, rd.y, rd.y + rd.h - fit.h) : clamp(cy + G * 0.4 - fit.h, rd.y, rd.y + rd.h - fit.h);
      }
    }
    if (!fit) {
      // too little room beside the giant: the line runs above it and the giant drops under the line
      fit = fitRows(r, 0, lt.units.length, { wanted: r.body * 0.72, min: f.minRead, maxW: rd.w * 0.8, maxH: rd.h * 0.3, maxRows: 2, tracking: 0.04, leading: 1.22 });
      if (!fit) return null;
      x = leftEdge ? rd.x + rd.w - fit.w : rd.x;
      y = rd.y;
      cy = Math.max(cy, y + fit.h + gap + G * 0.47);
    }
    pieces.push(piece("giant", setRow(lt, kIdx, kx, cy, style(r, G, -0.02, plate), r.measure, 100).glyphs, giantOpts));
    pieces.push(piece("main", placeRows(r, fit, x, y, style(r, fit.size, 0.04), 1.26, leftEdge ? "left" : "right", 0), { plate: r.mainPlate, delay: 0.12 }));
    const tp = translationPiece(r, x, y + fit.h + fit.size * 0.4, fit.w, leftEdge ? "left" : "right");
    if (tp) pieces.push(tp);
    return pieces;
  }
  // vertical: the column runs off the top or the bottom edge, the line stands beside it
  const kEm = columnEm(lt, kIdx, r.weight, 0, r.measure);
  const G = Math.min(f.W * lerp(0.55, 0.78, r.c), (f.H * 0.74) / Math.max(0.6, kEm - crop), f.aspect < 1 ? f.W * 0.5 : f.W);
  const kH = kEm * G;
  const topEdge = r.zone.band === "top";
  const ky = topEdge ? -crop * G : f.H - kH + crop * G;
  const side = r.zone.side === "center" ? (hashUnit(`bleed|${Math.round(r.hint.seed)}`) < 0.5 ? "left" : "right") : r.zone.side;
  const kxc = side === "right" ? f.W - G * 0.55 : G * 0.55;
  pieces.push(piece("giant", setColumn(lt, kIdx, kxc, ky, style(r, G, 0, plate), r.measure, 100).glyphs, { ...giantOpts, vertical: true }));
  const freeX = side === "right" ? rd.x : Math.max(rd.x, kxc + G / 2 + gap);
  const freeW = side === "right" ? Math.min(rd.w, kxc - G / 2 - gap - rd.x) : rd.x + rd.w - freeX;
  // the visible part of the column (the line aligns to its end inside the frame)
  const visTop = Math.max(rd.y, ky);
  const visBottom = Math.min(rd.y + rd.h, ky + kH);
  if (freeW >= rd.w * 0.3) {
    const fit = fitRows(r, 0, lt.units.length, { wanted: r.body * 0.8, min: f.minRead, maxW: Math.min(freeW, rd.w * 0.5), maxH: rd.h * 0.5, maxRows: 3, tracking: 0.04, leading: 1.26 });
    if (!fit) return null;
    const x = side === "right" ? Math.max(rd.x, kxc - G / 2 - gap - fit.w) : Math.min(rd.x + rd.w - fit.w, kxc + G / 2 + gap);
    const y = topEdge ? clamp(visBottom - fit.h, rd.y, rd.y + rd.h - fit.h) : clamp(visTop, rd.y, rd.y + rd.h - fit.h);
    pieces.push(piece("main", placeRows(r, fit, x, y, style(r, fit.size, 0.04), 1.26, side === "right" ? "right" : "left", 0), { plate: r.mainPlate, delay: 0.12 }));
    const tp = translationPiece(r, x, y + fit.h + fit.size * 0.4, fit.w, side === "right" ? "right" : "left");
    if (tp) pieces.push(tp);
    return pieces;
  }
  // a narrow frame: the line under (or over) the column's end, flush with its side
  const fit = fitRows(r, 0, lt.units.length, { wanted: r.body * 0.8, min: f.minRead, maxW: rd.w * 0.9, maxH: rd.h * 0.3, maxRows: 3, tracking: 0.04, leading: 1.26 });
  if (!fit) return null;
  const y = topEdge ? Math.min(rd.y + rd.h - fit.h, ky + kH + fit.size * 0.6) : Math.max(rd.y, ky - fit.h - fit.size * 0.6);
  const x = side === "right" ? rd.x + rd.w - fit.w : rd.x;
  pieces.push(piece("main", placeRows(r, fit, x, y, style(r, fit.size, 0.04), 1.26, side === "right" ? "right" : "left", 0), { plate: r.mainPlate, delay: 0.12 }));
  return pieces;
}

// ---------------------------------------------------------------------------
// 散落
// ---------------------------------------------------------------------------

function scatter(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  const rd = f.read;
  const units = allIdx(lt).filter((i) => lt.units[i].kind !== "space");
  if (!units.length) return null;
  const vertical = lt.cjk && r.hint.orientation === "v";
  const calm = r.sys.voice === "ink" ? 0.55 : 1;
  // the experimental voice throws the characters wider apart in size (the calm ones keep them close)
  const loud = r.sys.voice === "glitch" ? 1 : 0;
  const base = Math.max(f.minRead * 1.05, r.body * lerp(0.82, 1.02, r.e) * (1 + 0.18 * loud));
  const sizes = units.map((i) => Math.max(f.minRead, base * (lt.emph[i] ? 1.38 + 0.2 * loud : 0.8 - 0.08 * loud + (0.42 + 0.3 * loud) * r.rng.next())));
  const adv = (k: number) => {
    const u = lt.units[units[k]];
    return (u.kind === "latin" ? r.measure(u.text, "latin", r.weight) : 1) * sizes[k];
  };
  // split into two paths at the phrase boundary nearest the middle when one would be too long
  const total = units.reduce((a, _, k) => a + adv(k) * 1.22, 0);
  const avail = vertical ? rd.h * 0.86 : rd.w * lerp(0.62, 0.9, r.d);
  let paths: number[][] = [units.map((_, k) => k)];
  if (total > avail) {
    let best = Math.floor(units.length / 2);
    let bestD = Infinity;
    for (let k = 1; k < units.length; k++) {
      const prev = units[k - 1];
      const boundary = lt.units.slice(prev + 1, units[k]).some((u) => u.kind === "space" || u.kind === "punct");
      const d = Math.abs(k - units.length / 2) - (boundary ? 2 : 0);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    paths = [units.map((_, k) => k).slice(0, best), units.map((_, k) => k).slice(best)];
  }
  const scale = Math.min(1, avail / Math.max(...paths.map((p) => p.reduce((a, k) => a + adv(k) * 1.22, 0))));
  const glyphs: GlyphBox[] = [];
  const slope = r.rng.range(-0.16, 0.16) * (vertical ? 0 : 1);
  paths.forEach((p, pi) => {
    const len = p.reduce((a, k) => a + adv(k) * 1.22 * scale, 0);
    if (!vertical) {
      const x0 = pi === 0 ? sideX(r, len) : Math.min(rd.x + rd.w - len, sideX(r, len) + base * 1.2);
      let x = x0;
      const bandTop = bandY(r, base * (paths.length * 2.2), 0.12, 0.42);
      const y0 = bandTop + pi * base * 2.1;
      for (const k of p) {
        const s = Math.max(f.minRead, sizes[k] * scale);
        const a = adv(k) * scale;
        const jitter = (r.rng.next() - 0.5) * base * 0.55 * calm;
        const yc = y0 + (x - x0) * slope + jitter + s / 2;
        const set = setRow(lt, [units[k]], x + (a * 1.22 - a) / 2, yc, style(r, s, 0), r.measure, glyphs.length);
        for (const g of set.glyphs) g.rotate = (r.rng.next() - 0.5) * 0.26 * calm;
        glyphs.push(...set.glyphs);
        x += a * 1.22;
      }
    } else {
      const top = rd.y + (rd.h - len) * (r.zone.band === "top" ? 0.1 : 0.45);
      const xc = sideX(r, base * 2.4) + base * 1.2 - pi * base * 2.2;
      let y = top;
      for (const k of p) {
        const s = Math.max(f.minRead, sizes[k] * scale);
        const set = setColumn(lt, [units[k]], xc + (r.rng.next() - 0.5) * base * 0.6 * calm, y, style(r, s, 0), r.measure, glyphs.length);
        for (const g of set.glyphs) g.rotate += (r.rng.next() - 0.5) * 0.22 * calm;
        glyphs.push(...set.glyphs);
        y += adv(k) * 1.22 * scale;
      }
    }
  });
  const pieces = [piece("main", glyphs, { plate: r.mainPlate, vertical })];
  const b = glyphs.reduce<Box | null>((acc, g) => (acc ? { x: Math.min(acc.x, g.x - g.w / 2), y: Math.min(acc.y, g.y - g.h / 2), w: 0, h: Math.max(acc.h, g.y + g.h / 2) } : { x: g.x - g.w / 2, y: g.y - g.h / 2, w: 0, h: g.y + g.h / 2 }), null);
  const tp = b ? translationPiece(r, b.x, b.h + base * 0.4, rd.w * 0.5) : null;
  if (tp) pieces.push(tp);
  return pieces;
}

// ---------------------------------------------------------------------------
// 海報堆疊
// ---------------------------------------------------------------------------

function poster(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  const rd = f.read;
  const tracking = lt.latinOnly ? -0.01 : 0.0;
  const width = (ix: number[]) => rowEm(lt, ix, r.weight, tracking, r.measure);
  const all = allIdx(lt);
  const totalEm = width(all);
  const perRow = f.aspect < 1 ? 4 : lerp(7, 4.5, r.c);
  const maxRows = clamp(Math.round(totalEm / perRow + 0.4), 1, 4);
  const rows = breakRows(lt.units, 0, lt.units.length, { max: Math.max(2, totalEm / Math.max(1, maxRows) + 0.8), maxRows, width, wordStarts: lt.wordStarts }).filter((row) => row.length);
  if (!rows.length) return null;
  let blockW = rd.w * (f.aspect < 1 ? 0.9 : lerp(0.46, 0.7, r.d)) * (0.9 + 0.2 * r.e);
  const gap = 0.06;
  let sizes: number[] = [];
  for (let guard = 0; guard < 30; guard++) {
    sizes = rows.map((row) => clamp(blockW / Math.max(0.5, width(row)), f.minRead * 1.1, Math.max(f.minRead * 1.1, Math.min(rd.h * 0.34, r.cap))));
    const h = sizes.reduce((a, s) => a + s * (1 + gap), 0);
    if (h <= rd.h * 0.8 || blockW < rd.w * 0.25) break;
    blockW *= 0.92;
  }
  const actualW = Math.max(...rows.map((row, i) => width(row) * sizes[i]));
  const blockH = sizes.reduce((a, s) => a + s * (1 + gap), 0) - sizes[sizes.length - 1] * gap;
  const x = sideX(r, actualW);
  const y0 = bandY(r, blockH, 0.16, 0.44);
  const glyphs: GlyphBox[] = [];
  const rules: Piece[] = [];
  let y = y0;
  let order = 0;
  rows.forEach((row, i) => {
    const s = sizes[i];
    const w = width(row) * s;
    const rx = r.zone.side === "right" ? x + actualW - w : x;
    const set = setRow(lt, row, rx, y + s * 0.5, style(r, s, tracking), r.measure, order);
    order += set.glyphs.length;
    glyphs.push(...set.glyphs);
    y += s * (1 + gap);
    if (i < rows.length - 1 && r.sys.params.ornament >= 0.45) rules.push(piece("rule", [], { plate: "ink", alpha: 0.5, readable: false, rect: { x, y: y - s * gap * 0.5 - Math.max(1, s * 0.012), w: actualW, h: Math.max(2, s * 0.024) }, delay: 0.05 * i }));
  });
  return [piece("main", glyphs, { plate: r.mainPlate }), ...rules];
}

// ---------------------------------------------------------------------------
// 鏤空窗
// ---------------------------------------------------------------------------

function windowRecipe(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  const rd = f.read;
  const key = keySpan(lt, r.hint.motionWord, 3);
  if (!key) return null;
  const kIdx = allIdx(lt, ...key);
  const vertical = lt.cjk && !latinSpan(lt, kIdx) && (r.hint.orientation === "v" || (f.aspect < 0.85 && kIdx.length > 1));
  const pieces: Piece[] = [];
  const S = Math.max(f.minRead, Math.min(r.small, r.body * 0.62));
  const line = fitRows(r, 0, lt.units.length, { wanted: S, min: f.minRead, maxW: rd.w * (f.aspect < 1 ? 0.9 : 0.46), maxH: rd.h * 0.22, maxRows: 2, tracking: 0.06, leading: 1.25 });
  if (!line) return null;
  if (!vertical) {
    const kEm = rowEm(lt, kIdx, r.weight, -0.02, r.measure);
    const G = Math.min((rd.w * 0.94) / kEm, rd.h * 0.8 - line.h, r.giant * 1.3);
    const kW = kEm * G;
    const kx = r.zone.side === "center" ? rd.x + (rd.w - kW) / 2 : r.zone.side === "left" ? rd.x : rd.x + rd.w - kW;
    const ky = rd.y + line.h + S * 0.8 + (rd.h - line.h - S * 0.8 - G) * 0.5;
    pieces.push(piece("giant", setRow(lt, kIdx, kx, ky + G / 2, style(r, G, -0.02, "spot"), r.measure, 100).glyphs, { plate: "spot", window: true, readable: false }));
    const lx = r.zone.side === "right" ? rd.x : rd.x + rd.w - line.w;
    pieces.push(piece("main", placeRows(r, line, lx, rd.y, style(r, line.size, 0.06), 1.25, r.zone.side === "right" ? "left" : "right", 0), { plate: r.mainPlate, delay: 0.1 }));
    return pieces;
  }
  const kEm = columnEm(lt, kIdx, r.weight, 0, r.measure);
  const G = Math.min((rd.h * 0.9) / kEm, rd.w * 0.62, r.giant * 1.4);
  const kH = kEm * G;
  const kxc = rd.x + rd.w / 2;
  const top = rd.y + (rd.h - kH) * 0.5;
  pieces.push(piece("giant", setColumn(lt, kIdx, kxc, top, style(r, G, 0, "spot"), r.measure, 100).glyphs, { plate: "spot", window: true, readable: false, vertical: true }));
  pieces.push(piece("main", placeRows(r, line, rd.x, rd.y, style(r, line.size, 0.06), 1.25, "left", 0), { plate: r.mainPlate, delay: 0.1 }));
  return pieces;
}

// ---------------------------------------------------------------------------
// 殘影 and 撕裂
// ---------------------------------------------------------------------------

function mainBlock(r: RecipeCtx, sizeK: number, maxRows: number, align: "left" | "right" | "center"): { pieces: Piece[]; box: Box; size: number } | null {
  const { lt, frame: f } = r;
  const rd = f.read;
  const vertical = lt.cjk && r.hint.orientation === "v";
  if (vertical) {
    const fit = fitColumns(r, 0, lt.units.length, { wanted: r.body * sizeK, min: f.minRead, maxW: rd.w * 0.5, maxH: rd.h * 0.8, maxCols: maxRows, tracking: 0.06, gap: 0.5 });
    if (!fit) return null;
    const x = sideX(r, fit.w);
    const y = bandY(r, fit.h, 0.08, 0.42);
    return { pieces: [piece("main", placeColumns(r, fit, x + fit.w, y, style(r, fit.size, 0.06)), { plate: r.mainPlate, vertical: true })], box: { x, y, w: fit.w, h: fit.h }, size: fit.size };
  }
  const fit = fitRows(r, 0, lt.units.length, { wanted: r.body * sizeK, min: f.minRead, maxW: rd.w * (f.aspect < 1 ? 0.92 : 0.72), maxH: rd.h * 0.6, maxRows, tracking: 0.02, leading: 1.18, pyramid: true });
  if (!fit) return null;
  const x = sideX(r, fit.w);
  const y = bandY(r, fit.h, 0.12, 0.42);
  return { pieces: [piece("main", placeRows(r, fit, x, y, style(r, fit.size, 0.02), 1.18, align), { plate: r.mainPlate })], box: { x, y, w: fit.w, h: fit.h }, size: fit.size };
}

function echo(r: RecipeCtx): Piece[] | null {
  const block = mainBlock(r, lerp(1.0, 1.2, r.e), 2, r.zone.side === "right" ? "right" : "left");
  if (!block) return null;
  const main = block.pieces[0];
  const n = 3 + Math.round(r.e * 2);
  const angle = r.rng.pick([-0.5, 0.5, Math.PI / 2, -Math.PI / 2 + 0.3]);
  const step = block.size * lerp(0.16, 0.28, r.c);
  const dx = Math.cos(angle) * step;
  const dy = Math.sin(angle) * step;
  const echoes: Piece[] = [];
  for (let k = n; k >= 1; k--) {
    const glyphs = main.glyphs.map((g) => ({ ...g, plate: "accent" as PlateId }));
    echoes.push(piece("echo", glyphs, { plate: "accent", alpha: 0.5 * Math.pow(0.62, k - 1), readable: false, vertical: main.vertical, echo: { index: k, dx: dx * k, dy: dy * k }, delay: 0.04 * k }));
  }
  const tp = translationPiece(r, block.box.x, block.box.y + block.box.h + block.size * 0.5, block.box.w);
  return [...echoes, main, ...(tp ? [tp] : [])];
}

function split(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  const rd = f.read;
  if (lt.cjk && r.hint.orientation === "v") {
    const block = mainBlock(r, lerp(1.05, 1.3, r.e), 2, "left");
    if (!block) return null;
    block.pieces[0].slices = 5 + r.rng.int(5);
    block.pieces[0].tear = 0.3;
    return block.pieces;
  }
  // a torn poster: the line in two or three rows at its words, each row as wide as the block, the
  // rows knocked out of line with each other and one of them torn into shifted slices
  const tracking = lt.latinOnly ? -0.01 : 0.0;
  const width = (ix: number[]) => rowEm(lt, ix, r.weight, tracking, r.measure);
  const all = allIdx(lt);
  const totalEm = width(all);
  const rowsWanted = totalEm <= 4.5 ? 1 : totalEm <= 12 ? 2 : 3;
  const rows = (rowsWanted === 1 ? [all] : breakRows(lt.units, 0, lt.units.length, { max: totalEm / rowsWanted + 0.8, maxRows: rowsWanted, width, wordStarts: lt.wordStarts })).filter((row) => row.length);
  if (!rows.length) return null;
  let blockW = rd.w * (f.aspect < 1 ? 0.9 : f.aspect > 2.4 ? 0.4 : lerp(0.46, 0.62, r.e));
  let sizes: number[] = [];
  for (let guard = 0; guard < 30; guard++) {
    sizes = rows.map((row) => clamp(blockW / Math.max(0.5, width(row)), f.minRead * 1.1, Math.max(f.minRead * 1.1, Math.min(rd.h * 0.3, r.cap))));
    const h = sizes.reduce((a, sz) => a + sz * 1.04, 0);
    if (h <= rd.h * 0.74 || blockW < rd.w * 0.25) break;
    blockW *= 0.92;
  }
  const actualW = Math.max(...rows.map((row, i) => width(row) * sizes[i]));
  const shifts = rows.map((_, i) => (i === 0 ? 0 : (r.rng.next() - 0.5) * 0.9 * sizes[i]));
  const minShift = Math.min(0, ...shifts);
  const maxShift = Math.max(0, ...shifts);
  const blockH = sizes.reduce((a, sz) => a + sz * 1.04, 0) - sizes[sizes.length - 1] * 0.04;
  const x = clamp(sideX(r, actualW + maxShift - minShift) - minShift, rd.x - minShift, rd.x + rd.w - actualW - maxShift);
  const y0 = bandY(r, blockH, 0.14, 0.42);
  const torn = rows.length > 1 ? 1 + r.rng.int(rows.length - 1) : 0;
  const pieces: Piece[] = [];
  let y = y0;
  let order = 0;
  rows.forEach((row, i) => {
    const sz = sizes[i];
    const w = width(row) * sz;
    const rx = (r.zone.side === "right" ? x + actualW - w : x) + shifts[i];
    const set = setRow(lt, row, rx, y + sz * 0.5, style(r, sz, tracking), r.measure, order);
    order += set.glyphs.length;
    pieces.push(piece("main", set.glyphs, { plate: r.mainPlate, slices: 4 + r.rng.int(5), tear: i === torn ? 0.2 : 0.05, delay: 0.05 * i }));
    y += sz * 1.04;
  });
  const tp = translationPiece(r, x, y + sizes[sizes.length - 1] * 0.3, actualW, r.zone.side === "right" ? "right" : "left");
  if (tp) pieces.push(tp);
  return pieces;
}

// ---------------------------------------------------------------------------
// 低語 and 片名卡
// ---------------------------------------------------------------------------

function whisper(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  const rd = f.read;
  const size = f.minRead * lerp(1.0, 1.28, r.e);
  const tracking = lt.latinOnly ? 0.08 : lerp(0.3, 0.16, r.d);
  // brush and ink whisper down a column; the others in one or two short rows
  const vertical = lt.cjk && (r.hint.orientation === "v" || (r.sys.voice === "ink" && r.hint.orientation !== "h"));
  // never centred like a caption: it hangs from a grid column on one side, at a third of the height
  const side = r.zone.side === "center" ? (hashUnit(`whisper|${Math.round(r.hint.seed)}`) < 0.5 ? "left" : "right") : r.zone.side;
  const inset = f.grid.cols >= 6 ? 1 : 0;
  if (vertical) {
    const fit = fitColumns(r, 0, lt.units.length, { wanted: size, min: f.minRead, maxW: rd.w * 0.3, maxH: rd.h * 0.62, maxCols: 2, tracking, gap: 0.9 });
    if (!fit) return null;
    const x = side === "left" ? colX(f.grid, inset) : colRight(f.grid, -1 - inset) - fit.w;
    const y = rd.y + (rd.h - fit.h) * (r.zone.band === "top" ? 0.2 : 0.46);
    const out = [piece("main", placeColumns(r, fit, x + fit.w, y, style(r, fit.size, tracking)), { plate: r.mainPlate, vertical: true })];
    if (r.sys.params.ornament >= 0.2) {
      // a short hairline over the first column
      const rh = fit.size * 1.6;
      const ry = y - fit.size * 0.8 - rh;
      if (ry > f.safe.y) out.push(piece("rule", [], { plate: "ink", alpha: 0.7, readable: false, rect: { x: x + fit.w - fit.size / 2 - 1, y: ry, w: Math.max(2, fit.size * 0.04), h: rh } }));
    }
    return out;
  }
  const measureW = rd.w * (f.aspect < 1 ? 0.8 : f.aspect > 2.4 ? 0.24 : 0.36);
  const fit = fitRows(r, 0, lt.units.length, { wanted: size, min: f.minRead, maxW: measureW, maxH: rd.h * 0.3, maxRows: 2, tracking, leading: 1.7 });
  if (!fit) return null;
  const x = side === "right" ? colRight(f.grid, -1 - inset) - fit.w : colX(f.grid, inset);
  const y = rd.y + (rd.h - fit.h) * (r.zone.band === "top" ? 0.3 : 0.62);
  const out = [piece("main", placeRows(r, fit, x, y, style(r, fit.size, tracking), 1.7, side === "right" ? "right" : "left"), { plate: r.mainPlate })];
  if (r.sys.params.ornament >= 0.2) {
    const rw = fit.size * 1.6;
    const rx = side === "right" ? x + fit.w + fit.size * 0.7 : x - rw - fit.size * 0.7;
    if (rx > f.safe.x - 1 && rx + rw < f.safe.x + f.safe.w + 1) out.push(piece("rule", [], { plate: "ink", alpha: 0.7, readable: false, rect: { x: rx, y: y + fit.size / 2 - 1, w: rw, h: Math.max(2, fit.size * 0.04) } }));
  }
  return out;
}

function titleCard(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  const rd = f.read;
  const tracking = lt.latinOnly ? 0.06 : lerp(0.2, 0.1, r.d);
  const vertical = lt.cjk && r.hint.orientation === "v";
  const rule = (x: number, y: number, w: number, h: number, delay = 0): Piece => piece("rule", [], { plate: "ink", alpha: 0.85, readable: false, rect: { x, y, w, h }, delay });
  if (vertical) {
    const fit = fitColumns(r, 0, lt.units.length, { wanted: r.body * 0.95, min: f.minRead, maxW: rd.w * 0.5, maxH: rd.h * 0.78, maxCols: 2, tracking, gap: 0.8 });
    if (!fit) return null;
    const x = rd.x + (rd.w - fit.w) / 2;
    const y = rd.y + (rd.h - fit.h) * 0.4;
    const t = Math.max(2, fit.size * 0.03);
    return [
      piece("main", placeColumns(r, fit, x + fit.w, y, style(r, fit.size, tracking)), { plate: r.mainPlate, vertical: true }),
      rule(x - fit.size * 0.6, y - fit.size * 0.3, t, fit.h + fit.size * 0.6),
      rule(x + fit.w + fit.size * 0.6 - t, y - fit.size * 0.3, t, fit.h + fit.size * 0.6),
    ];
  }
  const fit = fitRows(r, 0, lt.units.length, { wanted: r.body * lerp(0.82, 0.98, r.e), min: f.minRead, maxW: rd.w * (f.aspect < 1 ? 0.92 : 0.7), maxH: rd.h * 0.42, maxRows: 2, tracking, leading: 1.3, pyramid: true });
  if (!fit) return null;
  const x = rd.x + (rd.w - fit.w) / 2;
  const y = rd.y + (rd.h - fit.h) * (r.zone.band === "top" ? 0.28 : 0.44);
  const t = Math.max(2, fit.size * 0.028);
  const ruleW = Math.min(rd.w, fit.w + fit.size * 1.6);
  const rx = rd.x + (rd.w - ruleW) / 2;
  const out = [piece("main", placeRows(r, fit, x, y, style(r, fit.size, tracking), 1.3, "center"), { plate: r.mainPlate, delay: 0.08 })];
  if (r.sys.params.ornament >= 0.15) {
    out.push(rule(rx, y - fit.size * 0.55, ruleW, t), rule(rx, y + fit.h + fit.size * 0.55 - t, ruleW, t, 0.06));
  }
  const tp = translationPiece(r, rx, y + fit.h + fit.size * 0.8, ruleW, "center");
  if (tp) out.push(tp);
  return out;
}

// ---------------------------------------------------------------------------
// long lines (B4): two staggered phrases
// ---------------------------------------------------------------------------

/**
 * The line-length policy's layout: a line over the length limit (text.ts `isLongUnits`) is set as
 * two phrases, each in at most two rows (or two columns), the second stepped down and across
 * from the first so the eye reads one after the other — never one column the height of the
 * frame, never a 30-character row. No display word: a long line is read, not shown. Null when
 * the line has no acceptable cut (the recipe then lays it out as usual).
 */
export function longLine(r: RecipeCtx): Piece[] | null {
  const { lt, frame: f } = r;
  const cut = splitLongLine(lt.units, lt.wordStarts);
  if (!cut) return null;
  const rd = f.read;
  const [a, b] = cut;
  const vertical = lt.cjk && r.hint.orientation === "v";
  const pieces: Piece[] = [];
  if (vertical) {
    const tracking = lerp(0.16, 0.06, r.d);
    const size = r.body * lerp(0.95, 1.1, r.e);
    const maxH = Math.min(rd.h * 0.8, f.H * MAX_COLUMN_FRACTION);
    const fa = fitColumns(r, a[0], a[1], { wanted: size, min: f.minRead, maxW: rd.w * 0.3, maxH: maxH * 0.78, maxCols: 2, tracking, gap: 0.5 });
    const fb = fitColumns(r, b[0], b[1], { wanted: size, min: f.minRead, maxW: rd.w * 0.3, maxH: maxH * 0.78, maxCols: 2, tracking, gap: 0.5 });
    if (!fa || !fb) return null;
    const s = Math.min(fa.size, fb.size);
    const A = fitColumns(r, a[0], a[1], { wanted: s, min: f.minRead, maxW: rd.w * 0.3, maxH: maxH * 0.78, maxCols: 2, tracking, gap: 0.5 }) ?? fa;
    const B = fitColumns(r, b[0], b[1], { wanted: s, min: f.minRead, maxW: rd.w * 0.3, maxH: maxH * 0.78, maxCols: 2, tracking, gap: 0.5 }) ?? fb;
    // the first phrase stands right, the second steps down to its left (columns read right to left)
    const gap = s * 1.1;
    const stagger = Math.min(s * 1.6, Math.max(0, Math.min(rd.h, maxH) - Math.max(A.h, B.h)));
    const blockW = A.w + gap + B.w;
    const blockH = Math.max(A.h, B.h + stagger);
    const x = sideX(r, blockW);
    const top = bandY(r, blockH, 0.08, 0.42);
    pieces.push(piece("main", placeColumns(r, A, x + blockW, top, style(r, s, tracking), 0, 0), { plate: r.mainPlate, vertical: true }));
    pieces.push(piece("main", placeColumns(r, B, x + B.w, top + stagger, style(r, s, tracking), 0, 100), { plate: r.mainPlate, vertical: true, delay: 0.16 }));
    const tp = translationPiece(r, x, top + blockH + s * 0.5, Math.max(blockW * 1.5, rd.w * 0.3));
    if (tp) pieces.push(tp);
    return pieces;
  }
  const tracking = lt.latinOnly ? 0.0 : 0.03;
  const size = r.body * lerp(0.92, 1.05, r.e);
  const measureW = rd.w * (f.aspect < 1 ? 0.9 : f.aspect > 2.4 ? 0.42 : 0.6);
  const fa = fitRows(r, a[0], a[1], { wanted: size, min: f.minRead, maxW: measureW, maxH: rd.h * 0.4, maxRows: 2, tracking, leading: 1.24 });
  const fb = fitRows(r, b[0], b[1], { wanted: size, min: f.minRead, maxW: measureW, maxH: rd.h * 0.4, maxRows: 2, tracking, leading: 1.24 });
  if (!fa || !fb) return null;
  const s = Math.min(fa.size, fb.size);
  const A = fitRows(r, a[0], a[1], { wanted: s, min: f.minRead, maxW: measureW, maxH: rd.h * 0.4, maxRows: 2, tracking, leading: 1.24 }) ?? fa;
  const B = fitRows(r, b[0], b[1], { wanted: s, min: f.minRead, maxW: measureW, maxH: rd.h * 0.4, maxRows: 2, tracking, leading: 1.24 }) ?? fb;
  // the second phrase steps across by two ems (towards the frame's centre) and down a gap
  const gap = s * 0.55;
  const step = Math.min(s * 2, Math.max(0, rd.w - Math.max(A.w, B.w)));
  const toRight = r.zone.side !== "right";
  const blockW = Math.max(A.w, B.w) + step;
  const blockH = A.h + gap + B.h;
  const x = sideX(r, blockW);
  const y = bandY(r, blockH, 0.12, 0.42);
  const ax = toRight ? x : x + step;
  const bx = toRight ? x + step : x;
  pieces.push(piece("main", placeRows(r, A, ax, y, style(r, s, tracking), 1.24, toRight ? "left" : "right", 0), { plate: r.mainPlate }));
  pieces.push(piece("main", placeRows(r, B, bx, y + A.h + gap, style(r, s, tracking), 1.24, toRight ? "left" : "right", 100), { plate: r.mainPlate, delay: 0.16 }));
  const tp = translationPiece(r, x, y + blockH + s * 0.45, Math.max(blockW, rd.w * 0.4));
  if (tp) pieces.push(tp);
  return pieces;
}

export type RecipeFn = (r: RecipeCtx) => Piece[] | null;

export const RECIPE_FNS: Record<TypeRecipeId, RecipeFn> = {
  "giant-word": giantWord,
  "vertical-column": (r) => columns(r, false),
  cross,
  "grid-poem": gridPoem,
  bleed,
  scatter,
  poster,
  window: windowRecipe,
  "brush-write": (r) => (r.lt.cjk && r.hint.orientation !== "h" ? columns(r, true) : mainBlock(r, lerp(1.0, 1.2, r.e), 2, "left")?.pieces ?? null),
  echo,
  split,
  whisper,
  "title-card": titleCard,
};

/** What a recipe becomes when it cannot lay this line out (Latin text, a line too short). */
export const RECIPE_FALLBACK: Record<TypeRecipeId, TypeRecipeId> = {
  "giant-word": "title-card",
  "vertical-column": "title-card",
  cross: "poster",
  "grid-poem": "title-card",
  bleed: "giant-word",
  scatter: "title-card",
  poster: "title-card",
  window: "giant-word",
  "brush-write": "title-card",
  echo: "title-card",
  split: "title-card",
  whisper: "title-card",
  "title-card": "whisper",
};

export { createRng };
