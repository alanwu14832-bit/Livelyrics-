// Turns the pure media model (model.ts) into the renderer's per-layer draw instructions. Shared by
// the live StageEngine and the offline export renderer so both frame, tint and punch a band
// asset identically; only where the decoded pixels come from differs.

import type { RGB } from "../color";
import type { MediaLayerDraw } from "../gl/renderer";
import { placementBox, writingModeFor } from "../lyrics/layout";
import { clamp, type StageLook } from "../resolve";
import type { LyricSafeArea, LyricStyleId } from "../../types";
import { BLEND_CODE, TREATMENT_CODE, framing, hashId, videoTimeAt, type BeatInfo, type MediaLayerState } from "./model";

/** A decoded source for one asset (image, canvas or video element at the right frame). */
export interface MediaPixels {
  source: TexImageSource | null;
  width: number;
  height: number;
  version: number;
  hold?: boolean;
}

export function isVideoAsset(layer: MediaLayerState): boolean {
  return layer.asset.kind === "video" || layer.asset.mimeType.startsWith("video/");
}

/** Stable per-(asset, section) seed for framing and beat-cut offsets. */
export function mediaSeed(layer: MediaLayerState): number {
  return hashId(`${layer.asset.id}|${layer.sectionIndex}`) % 100000;
}

/** Where the layer's video should be at song time t (0 for stills). */
export function mediaVideoTime(layer: MediaLayerState, t: number, beat: BeatInfo): number {
  if (!isVideoAsset(layer)) return 0;
  return videoTimeAt({ treatment: layer.media.treatment, t, sectionStart: layer.sectionStart, duration: layer.asset.duration ?? 0, beat, seed: mediaSeed(layer) });
}

export function mediaLayerDraw(layer: MediaLayerState, t: number, beat: BeatInfo, src: MediaPixels, canvasAspect: number, color: (hex: string) => RGB): MediaLayerDraw | null {
  const { asset, media } = layer;
  if (!src.source) return null;
  const seed = mediaSeed(layer);
  const span = Math.max(0.001, layer.sectionEnd - layer.sectionStart);
  // beat index relative to the section start so every section opens on the same framing
  const uv = framing({
    treatment: media.treatment,
    fit: media.fit,
    canvasAspect,
    texAspect: src.width / Math.max(1, src.height),
    progress: (t - layer.sectionStart) / span,
    beatIndex: beat.index,
    seed,
  });
  if (asset.kind === "logo") {
    // a logo sits in the middle at a readable size, never edge to edge
    const k = 1 / 0.46;
    uv.sx *= k;
    uv.sy *= k;
  }
  const downbeat = ((beat.index % 4) + 4) % 4 === 0;
  const punch = media.treatment === "beat-cut" ? Math.exp(-beat.phase * 6) * (downbeat ? 1 : 0.55) : 0;
  return {
    key: asset.id,
    source: src.source,
    version: src.version,
    hold: src.hold,
    width: src.width,
    height: src.height,
    weight: clamp(layer.weight * media.opacity, 0, 1, 0),
    treatment: TREATMENT_CODE[media.treatment] ?? 0,
    blend: BLEND_CODE[media.blend] ?? 0,
    contain: media.fit === "contain",
    uv,
    colorway: [color(layer.colorway[0]), color(layer.colorway[1]), color(layer.colorway[2])],
    punch,
    seed: (seed % 997) / 7,
  };
}

/**
 * The lyric area for mask-lyrics in screen uv (x0, y0, x1, y1; y up): the measured text box
 * (fractions of the stage, y down) while a line shows, else the placement box.
 */
export function mediaLyricBox(
  textBox: [number, number, number, number] | null,
  showing: boolean,
  style: LyricStyleId,
  lyricLook: StageLook,
  safe: LyricSafeArea,
  aspect: number,
): [number, number, number, number] {
  if (textBox && showing) {
    const [x0, y0, x1, y1] = textBox;
    return [x0, 1 - y1, x1, 1 - y0];
  }
  const mode = writingModeFor(style === "hidden" ? lyricLook.lyricStyle : style, lyricLook.placement);
  const box = placementBox(lyricLook.placement, mode, safe, aspect);
  return [box.left / 100, 1 - (box.top + box.height) / 100, (box.left + box.width) / 100, 1 - box.top / 100];
}
