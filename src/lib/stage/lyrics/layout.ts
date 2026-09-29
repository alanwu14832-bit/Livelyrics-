// Placement boxes and per-style typographic metrics for the lyric layer.
// Boxes are designed inside the default 90 % title-safe area and mapped into the
// project's lyric safe area (Project.output.lyricSafe); sizes are in `cqh`
// (percent of the StageView's height), so the console preview and the
// projector scale identically. `adaptMetrics` re-fits the per-style metrics to
// extreme canvases (32:9 LED strips, 9:16 portrait screens).

import type { LyricPlacement, LyricSafeArea, LyricStyleId, SceneId } from "../../types";
import { DEFAULT_LYRIC_SAFE, safeRectPercent } from "../../output";

/** Fraction of the stage used by the title-safe area (lyrics never leave it). */
export const TITLE_SAFE = 0.9;
/** Action-safe fraction drawn by the guides. */
export const ACTION_SAFE = 0.95;

export type Align = "start" | "center" | "end";

export interface PlacementBox {
  /** percent of stage width/height */
  left: number;
  top: number;
  width: number;
  height: number;
  alignX: Align;
  alignY: Align;
}

export type WritingMode = "horizontal" | "vertical";

const BOXES: Record<LyricPlacement, PlacementBox> = {
  center: { left: 5, top: 14, width: 90, height: 72, alignX: "center", alignY: "center" },
  "lower-third": { left: 5, top: 58, width: 90, height: 32, alignX: "center", alignY: "end" },
  "upper-third": { left: 5, top: 9, width: 90, height: 32, alignX: "center", alignY: "start" },
  left: { left: 6, top: 14, width: 54, height: 72, alignX: "start", alignY: "center" },
  right: { left: 40, top: 14, width: 54, height: 72, alignX: "end", alignY: "center" },
  "vertical-right": { left: 58, top: 9, width: 36, height: 82, alignX: "end", alignY: "start" },
  "vertical-left": { left: 6, top: 9, width: 36, height: 82, alignX: "start", alignY: "start" },
};

const VERTICAL_CENTER: PlacementBox = { left: 14, top: 9, width: 72, height: 82, alignX: "center", alignY: "center" };

export function writingModeFor(style: LyricStyleId, placement: LyricPlacement): WritingMode {
  return style === "vertical" || placement === "vertical-right" || placement === "vertical-left" ? "vertical" : "horizontal";
}

function designBox(placement: LyricPlacement, mode: WritingMode): PlacementBox {
  if (mode === "vertical") {
    switch (placement) {
      case "center":
        return VERTICAL_CENTER;
      case "left":
      case "vertical-left":
        return BOXES["vertical-left"];
      default:
        return BOXES["vertical-right"];
    }
  }
  return BOXES[placement] ?? BOXES.center;
}

/** The designed boxes assume a 5 % margin on every side (the 90 % title-safe area). */
const DESIGN_MARGIN = 5;
const DESIGN_SPAN = 100 - 2 * DESIGN_MARGIN;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Box for a placement, in percent of the stage, inside the lyric safe area `safe`
 * (default: 5 % margins, which reproduces the designed boxes exactly). Vertical text in a
 * horizontal band makes no sense, so the "vertical" style maps horizontal placements onto
 * the nearest vertical column. On a portrait canvas the side placements (left / right) span
 * the full safe width: a half-width column would only fit two or three characters.
 */
export function placementBox(placement: LyricPlacement, mode: WritingMode, safe: LyricSafeArea = DEFAULT_LYRIC_SAFE, aspect = 16 / 9): PlacementBox {
  let box = designBox(placement, mode);
  if (aspect < 1 && mode === "horizontal" && (placement === "left" || placement === "right")) box = { ...BOXES.center, alignX: box.alignX };
  if (aspect < 1 && mode === "vertical" && placement !== "center") box = { ...box, left: box.alignX === "end" ? 40 : 6, width: 54 };
  const sr = safeRectPercent(safe);
  const mapX = (v: number) => sr.left + ((v - DESIGN_MARGIN) / DESIGN_SPAN) * sr.width;
  const mapY = (v: number) => sr.top + ((v - DESIGN_MARGIN) / DESIGN_SPAN) * sr.height;
  const left = mapX(box.left);
  const top = mapY(box.top);
  return {
    left: r3(left),
    top: r3(top),
    width: r3(mapX(box.left + box.width) - left),
    height: r3(mapY(box.top + box.height) - top),
    alignX: box.alignX,
    alignY: box.alignY,
  };
}

export interface StyleMetrics {
  /** main text size in cqh at lyricScale 1 */
  size: number;
  /** max CJK chars per row (column for vertical) */
  maxChars: number;
  maxLines: number;
  /** translation size relative to main */
  translationScale: number;
  /** show the next line as anticipation */
  showNext: boolean;
  /** 0..1 strength of the soft backdrop behind the text */
  scrim: number;
  /** added to the plan font weight */
  weightDelta: number;
  /** added to the plan letter-spacing (em) */
  trackingDelta: number;
  /** line-height */
  leading: number;
}

export const STYLE_METRICS: Record<LyricStyleId, StyleMetrics> = {
  karaoke: { size: 8.4, maxChars: 16, maxLines: 2, translationScale: 0.5, showNext: true, scrim: 0.55, weightDelta: 0, trackingDelta: 0, leading: 1.22 },
  "line-fade": { size: 9, maxChars: 16, maxLines: 2, translationScale: 0.5, showNext: false, scrim: 0.5, weightDelta: 0, trackingDelta: 0.02, leading: 1.24 },
  "word-pop": { size: 9.6, maxChars: 14, maxLines: 2, translationScale: 0.48, showNext: false, scrim: 0.45, weightDelta: 100, trackingDelta: 0, leading: 1.2 },
  typewriter: { size: 8.2, maxChars: 16, maxLines: 2, translationScale: 0.5, showNext: false, scrim: 0.5, weightDelta: 0, trackingDelta: 0.04, leading: 1.26 },
  stack: { size: 7.8, maxChars: 16, maxLines: 2, translationScale: 0.5, showNext: true, scrim: 0.5, weightDelta: 0, trackingDelta: 0.02, leading: 1.25 },
  vertical: { size: 8.2, maxChars: 9, maxLines: 2, translationScale: 0.46, showNext: false, scrim: 0.45, weightDelta: 0, trackingDelta: 0.1, leading: 1.3 },
  impact: { size: 25, maxChars: 6, maxLines: 1, translationScale: 0.2, showNext: false, scrim: 0.35, weightDelta: 200, trackingDelta: -0.02, leading: 1.02 },
  subtitle: { size: 4.6, maxChars: 22, maxLines: 2, translationScale: 0.72, showNext: false, scrim: 0.7, weightDelta: -100, trackingDelta: 0.02, leading: 1.35 },
  hidden: { size: 0, maxChars: 16, maxLines: 2, translationScale: 0.5, showNext: false, scrim: 0, weightDelta: 0, trackingDelta: 0, leading: 1.2 },
};

/** Canvases in this aspect range use the style metrics as designed. */
export const STANDARD_ASPECT: readonly [number, number] = [1.5, 2.05];

/** Rough advance of one CJK glyph in ems (tracking and the wider Latin fallback included). */
const GLYPH_EM = 1.06;

/**
 * Re-fit a style's metrics to the canvas. `aspect` is width / height, `box` the placement box
 * in percent of the stage. Sizes stay in cqh (relative to the canvas height), so:
 * - wide strips (aspect ≥ 2.4) get more characters per row (fewer breaks) where the width
 *   allows, and a size capped so every row still fits the box height;
 * - narrow / portrait canvases get fewer characters per row and more rows (up to 4, the
 *   impact style up to 3) instead of shrinking a 16-character row to an unreadable size.
 * fitBlock() in the lyric layer remains the final safety net.
 */
export function adaptMetrics(metrics: StyleMetrics, style: LyricStyleId, box: Pick<PlacementBox, "width" | "height">, aspect: number, mode: WritingMode): StyleMetrics {
  if (style === "hidden" || metrics.size <= 0 || !(aspect > 0) || !Number.isFinite(aspect)) return metrics;
  // the metrics were designed on 16:9 (and hold up to ~16:10 and 2:1): leave those canvases exactly as designed
  if (aspect >= STANDARD_ASPECT[0] && aspect <= STANDARD_ASPECT[1]) return metrics;
  const s = metrics.size / 100; // font size in canvas heights
  const boxW = (box.width / 100) * aspect; // box width in canvas heights
  const boxH = box.height / 100;
  const totalChars = metrics.maxChars * metrics.maxLines;
  if (mode === "vertical") {
    // columns run down the box height: chars per column from the height, columns across the width
    const perCol = Math.max(3, Math.floor(boxH / (s * GLYPH_EM)));
    const cols = Math.max(1, Math.floor(boxW / (s * metrics.leading)));
    const maxChars = Math.min(metrics.maxChars, perCol);
    const need = Math.ceil(totalChars / maxChars);
    const maxLines = Math.min(Math.max(metrics.maxLines, Math.min(need, cols)), 4);
    const k = Math.min(1, boxW / (maxLines * s * metrics.leading));
    return k >= 0.999 && maxChars === metrics.maxChars && maxLines === metrics.maxLines ? metrics : { ...metrics, size: r3(metrics.size * k), maxChars, maxLines };
  }
  const fitChars = Math.floor(boxW / (s * GLYPH_EM));
  if (fitChars >= metrics.maxChars) {
    if (aspect >= 2.4 && style !== "impact") {
      // a strip: use the width, keep rows short in number
      const maxChars = Math.min(Math.round(metrics.maxChars * 1.6), fitChars);
      const rowH = s * metrics.leading;
      const k = Math.min(1, boxH / (metrics.maxLines * rowH + (metrics.showNext ? rowH * 0.5 : 0)));
      return { ...metrics, maxChars, size: r3(metrics.size * k) };
    }
    return metrics;
  }
  const minChars = style === "impact" ? 3 : style === "subtitle" ? 10 : 6;
  const maxChars = Math.max(minChars, fitChars);
  const lineCap = style === "impact" ? 3 : 4;
  const maxLines = Math.min(lineCap, Math.max(metrics.maxLines, Math.ceil(totalChars / maxChars)));
  // shrink only as much as the rows need (width) and the stack of rows allows (height)
  const kw = Math.min(1, boxW / (maxChars * s * GLYPH_EM));
  const kh = Math.min(1, boxH / (maxLines * s * metrics.leading * (1 + (metrics.showNext ? 0.25 : 0))));
  const k = Math.min(kw, kh);
  return { ...metrics, size: r3(metrics.size * k), maxChars, maxLines };
}

/**
 * Scenes with a bright feature where lyrics usually sit (the synthwave sun on the horizon,
 * the key-visual emblem, the tunnel's glowing vanishing point) need a stronger backdrop
 * behind the text to keep it readable on a big screen.
 */
const SCENE_SCRIM_BOOST: Partial<Record<SceneId, number>> = {
  grid: 1.75,
  motif: 1.5,
  tunnel: 1.4,
  shards: 1.25,
  bokeh: 1.2,
};

/** Backdrop alpha (0..0.85) for a lyric style over a scene. */
export function scrimAlpha(style: LyricStyleId, scene: SceneId): number {
  const base = (STYLE_METRICS[style] ?? STYLE_METRICS["line-fade"]).scrim * 0.62;
  return Math.min(0.85, base * (SCENE_SCRIM_BOOST[scene] ?? 1));
}

export function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 700;
  return Math.round(Math.min(900, Math.max(300, w)) / 100) * 100;
}

/** CSS justify/align value for flex layouts. */
export function flexAlign(a: Align): "flex-start" | "center" | "flex-end" {
  return a === "start" ? "flex-start" : a === "end" ? "flex-end" : "center";
}
