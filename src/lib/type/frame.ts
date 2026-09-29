// The canvas a line is composed for: the lyric safe area (Project.output.lyricSafe), the readable
// area inside it (the lowest band is left free: heads, flags and phones cover the bottom of a
// festival screen), the song's layout grid and the legibility minimum. Everything is in output
// canvas pixels, so the console preview (a smaller drawing buffer) is the same layout scaled.

import { STYLE_METRICS } from "../stage/lyrics/layout";
import { DEFAULT_LYRIC_SAFE } from "../output";
import type { TypeParams } from "../types";
import type { Box, CanvasSpec } from "./model";

/**
 * The smallest readable lyric glyph as a fraction of the canvas' short side: the existing
 * smallest lyric style (the subtitle metric, 4.6 % of the height on 16:9).
 */
export const MIN_READ_FRACTION = STYLE_METRICS.subtitle.size / 100;
/** …and never below this many output pixels (an LED needs well over 16 × 16 physical pixels per glyph). */
export const MIN_READ_PX = 22;
/** The band above the bottom of the safe area that readable text avoids (fraction of the height). */
export const BOTTOM_BAND = 0.1;

export interface Grid {
  cols: number;
  /** the grid box (px) */
  box: Box;
  colW: number;
  gutter: number;
}

export interface Frame {
  W: number;
  H: number;
  aspect: number;
  /**
   * size reference: the height of a 16:9 canvas of this width, capped by the real height; a tall
   * canvas (9:16) leans towards its width (its type is set for the width, not for a letterbox)
   */
  ref: number;
  short: number;
  safe: Box;
  read: Box;
  grid: Grid;
  minRead: number;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

function frac(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, 0, 0.3) : fallback;
}

export function makeFrame(canvas: CanvasSpec, params: Pick<TypeParams, "gridColumns" | "gridMargin">): Frame {
  const W = Math.max(64, canvas.width || 1920);
  const H = Math.max(64, canvas.height || 1080);
  const s = canvas.safe ?? DEFAULT_LYRIC_SAFE;
  const left = frac(s.left, DEFAULT_LYRIC_SAFE.left) * W;
  const right = frac(s.right, DEFAULT_LYRIC_SAFE.right) * W;
  const top = frac(s.top, DEFAULT_LYRIC_SAFE.top) * H;
  const bottom = frac(s.bottom, DEFAULT_LYRIC_SAFE.bottom) * H;
  const safe: Box = { x: left, y: top, w: Math.max(32, W - left - right), h: Math.max(32, H - top - bottom) };
  const short = Math.min(W, H);
  const band = Math.min(BOTTOM_BAND * H, safe.h * 0.2);
  const read: Box = { x: safe.x, y: safe.y, w: safe.w, h: Math.max(32, safe.h - band) };
  const margin = clamp(params.gridMargin ?? 0.4, 0, 1) * 0.06 * short;
  const cols = Math.round(clamp(params.gridColumns ?? 6, 2, 12));
  const gbox: Box = { x: read.x + margin, y: read.y + margin * 0.6, w: Math.max(32, read.w - 2 * margin), h: Math.max(32, read.h - margin * 1.2) };
  const gutter = Math.min(gbox.w * 0.02, short * 0.02);
  const colW = (gbox.w - gutter * (cols - 1)) / cols;
  return {
    W,
    H,
    aspect: W / H,
    ref: Math.min(H, W * (0.8 + (9 / 16 - 0.8) * clamp((W / H - 9 / 16) / (16 / 9 - 9 / 16), 0, 1))),
    short,
    safe,
    read,
    grid: { cols, box: gbox, colW, gutter },
    minRead: Math.max(MIN_READ_PX, MIN_READ_FRACTION * short),
  };
}

/** Left edge of grid column `i` (0-based; negative counts from the right: -1 = last column). */
export function colX(g: Grid, i: number): number {
  const k = i < 0 ? g.cols + i : i;
  return g.box.x + clamp(k, 0, g.cols) * (g.colW + g.gutter);
}

/** Right edge of grid column `i`. */
export function colRight(g: Grid, i: number): number {
  return colX(g, i) + g.colW;
}

/** Width of `n` grid columns (gutters included). */
export function span(g: Grid, n: number): number {
  const k = clamp(n, 1, g.cols);
  return k * g.colW + (k - 1) * g.gutter;
}
