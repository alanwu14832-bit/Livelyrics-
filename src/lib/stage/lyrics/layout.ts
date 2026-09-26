// Placement boxes and per-style typographic metrics for the lyric layer.
// All boxes live inside the 90 % title-safe area; sizes are in `cqh`
// (percent of the StageView's height), so the console preview and the
// projector scale identically.

import type { LyricPlacement, LyricStyleId, SceneId } from "../../types";

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

/**
 * Box for a placement. Vertical text in a horizontal band makes no sense, so the
 * "vertical" style maps horizontal placements onto the nearest vertical column.
 */
export function placementBox(placement: LyricPlacement, mode: WritingMode): PlacementBox {
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
