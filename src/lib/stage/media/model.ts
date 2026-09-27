// Pure model of the stage's band-media layer: which asset each section shows, how it is framed
// (fit, Ken Burns drift, beat-cut crops), where a video should be, and the cross-fade between
// sections. Everything is a function of (project, song time t) plus the beat grid, so the
// output window, the console preview and a future offline video export render the same frame.

import { clamp, type TransitionKind } from "../resolve";
import { TRANSITION_SECONDS } from "../director";
import type { AudioAnalysis, Asset, DesignPlan, MediaTreatment, SectionDesign, SectionMedia } from "../../types";
import { MEDIA_BLENDS, MEDIA_TREATMENTS } from "../../schema";

export const TREATMENT_CODE: Record<MediaTreatment, number> = {
  full: 0,
  duotone: 1,
  "grain-film": 2,
  "blur-glow": 3,
  halftone: 4,
  "mask-lyrics": 5,
  "slow-drift": 6,
  "beat-cut": 7,
};

export const BLEND_CODE: Record<SectionMedia["blend"], number> = { normal: 0, screen: 1, multiply: 2, overlay: 3 };

/** Video drift from the wanted position that triggers a seek (seconds). */
export const VIDEO_DRIFT_SECONDS = 0.08;

const TREATMENTS = new Set<string>(MEDIA_TREATMENTS);
const BLENDS = new Set<string>(MEDIA_BLENDS);

export interface BeatInfo {
  /** index of the last beat at or before t (−1 before the first beat) */
  index: number;
  /** 0..1 position inside the beat */
  phase: number;
  /** song time of that beat */
  start: number;
}

/** Deterministic beat position from the analysis grid (beats, else bpm), or null without one. */
export function beatAt(analysis: AudioAnalysis | null | undefined, t: number): BeatInfo | null {
  if (!analysis) return null;
  const beats = Array.isArray(analysis.beats) ? analysis.beats : [];
  const bpm = Number.isFinite(analysis.bpm) && analysis.bpm > 0 ? analysis.bpm : 0;
  if (beats.length > 1) {
    if (t < beats[0]) {
      const period = bpm ? 60 / bpm : Math.max(0.2, beats[1] - beats[0]);
      const back = Math.ceil((beats[0] - t) / period);
      const start = beats[0] - back * period;
      return { index: -back, phase: clamp((t - start) / period, 0, 1, 0), start };
    }
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (beats[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const b0 = beats[lo];
    const period = lo + 1 < beats.length ? beats[lo + 1] - b0 : bpm ? 60 / bpm : Math.max(0.2, b0 - beats[lo - 1]);
    if (lo === beats.length - 1 && t - b0 > period) {
      // past the last detected beat: continue the grid
      const n = Math.floor((t - b0) / period);
      const start = b0 + n * period;
      return { index: lo + n, phase: clamp((t - start) / period, 0, 1, 0), start };
    }
    return { index: lo, phase: clamp((t - b0) / Math.max(1e-3, period), 0, 1, 0), start: b0 };
  }
  if (bpm > 0) {
    const period = 60 / bpm;
    const index = Math.floor(t / period);
    return { index, phase: clamp((t - index * period) / period, 0, 1, 0), start: index * period };
  }
  return null;
}

/** Small integer hash -> 0..1 (stable across platforms). */
export function hash01(n: number, salt = 0): number {
  let h = (Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A section's media when it is well formed and names a known asset; null otherwise. */
export function sectionMedia(section: SectionDesign | null | undefined, assets: ReadonlyMap<string, Asset>): { media: SectionMedia; asset: Asset } | null {
  const m = section?.media;
  if (!m || typeof m !== "object" || typeof m.assetId !== "string") return null;
  const asset = assets.get(m.assetId);
  if (!asset) return null;
  return {
    asset,
    media: {
      assetId: m.assetId,
      treatment: TREATMENTS.has(m.treatment) ? m.treatment : "full",
      fit: m.fit === "contain" ? "contain" : "cover",
      opacity: clamp(m.opacity, 0, 1, 0.85),
      blend: BLENDS.has(m.blend) ? m.blend : "normal",
    },
  };
}

// ---------------------------------------------------------------------------
// framing

/** uv transform: texUV = (screenUV − 0.5) · scale + 0.5 + offset */
export interface UvTransform {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

/**
 * Fraction of the texture the screen spans on each axis for a fit mode.
 * cover: ≤ 1 on both axes (crop); contain: ≥ 1 on one axis (bars outside the texture).
 */
export function fitScale(canvasAspect: number, texAspect: number, fit: "cover" | "contain"): { sx: number; sy: number } {
  const a = canvasAspect > 0 && Number.isFinite(canvasAspect) ? canvasAspect : 16 / 9;
  const t = texAspect > 0 && Number.isFinite(texAspect) ? texAspect : a;
  const wider = a > t;
  if (fit === "cover") return wider ? { sx: 1, sy: t / a } : { sx: a / t, sy: 1 };
  return wider ? { sx: a / t, sy: 1 } : { sx: 1, sy: t / a };
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

/**
 * The framing for a treatment at time t. slow-drift: Ken Burns over the section (zoom 1.06 to
 * 1.2 with a pan whose direction depends on the asset and section). beat-cut: a new crop on
 * every beat. Everything else: the plain fit.
 */
export function framing(o: {
  treatment: MediaTreatment;
  fit: "cover" | "contain";
  canvasAspect: number;
  texAspect: number;
  /** 0..1 progress through the section */
  progress: number;
  beatIndex: number;
  seed: number;
}): UvTransform {
  const base = fitScale(o.canvasAspect, o.texAspect, o.fit);
  let zoom = 1;
  let px = 0; // −1..1 of the available pan slack
  let py = 0;
  if (o.treatment === "slow-drift") {
    const u = easeInOut(clamp(o.progress, 0, 1, 0));
    zoom = 1.06 + 0.14 * u;
    const ang = hash01(o.seed, 7) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    px = dx * (u * 2 - 1) * 0.9;
    py = dy * (u * 2 - 1) * 0.9;
  } else if (o.treatment === "beat-cut") {
    const n = o.beatIndex;
    // every 4th beat returns to the full frame (the downbeat reads as a "reset")
    if (((n % 4) + 4) % 4 === 0) zoom = 1.04;
    else zoom = 1.12 + 0.38 * hash01(n, o.seed);
    px = hash01(n, o.seed + 1) * 2 - 1;
    py = hash01(n, o.seed + 2) * 2 - 1;
  }
  const sx = base.sx / zoom;
  const sy = base.sy / zoom;
  const slackX = Math.max(0, (1 - sx) / 2);
  const slackY = Math.max(0, (1 - sy) / 2);
  return { sx, sy, ox: px * slackX, oy: py * slackY };
}

/**
 * Where a video should be at song time t. beat-cut jumps to a new point of the clip on every
 * beat (a hash of the beat index), everything else plays from the section start and loops.
 */
export function videoTimeAt(o: { treatment: MediaTreatment; t: number; sectionStart: number; duration: number; beat: BeatInfo | null; seed: number }): number {
  const d = o.duration > 0 && Number.isFinite(o.duration) ? o.duration : 0;
  if (d <= 0) return 0;
  const mod = (x: number) => ((x % d) + d) % d;
  if (o.treatment === "beat-cut" && o.beat) {
    const offset = hash01(o.beat.index, o.seed + 11) * d;
    return mod(offset + Math.max(0, o.t - o.beat.start));
  }
  return mod(Math.max(0, o.t - o.sectionStart));
}

/** True when the element should seek (it drifted more than VIDEO_DRIFT_SECONDS, wrap-aware). */
export function needsSeek(current: number, wanted: number, duration: number, threshold = VIDEO_DRIFT_SECONDS): boolean {
  if (!Number.isFinite(current)) return true;
  let diff = Math.abs(current - wanted);
  if (duration > 0) diff = Math.min(diff, Math.abs(duration - diff));
  return diff > threshold;
}

// ---------------------------------------------------------------------------
// the frame

export interface MediaLayerState {
  asset: Asset;
  media: SectionMedia;
  sectionIndex: number;
  sectionStart: number;
  sectionEnd: number;
  /** 0..1 contribution in the cross-fade */
  weight: number;
  /** colorway of the section it belongs to */
  colorway: [string, string, string];
}

export interface MediaFrame {
  /** incoming / current section's layer */
  current: MediaLayerState | null;
  /** outgoing layer during a cross-fade */
  previous: MediaLayerState | null;
}

/** Cross-fade length for a section's transitionIn (cut = instant). */
export function mediaFadeSeconds(kind: TransitionKind): number {
  return kind === "cut" ? 0 : Math.max(0.3, TRANSITION_SECONDS[kind] ?? 1);
}

function colorwayOf(s: SectionDesign, fallback: [string, string, string]): [string, string, string] {
  const cw = Array.isArray(s.colorway) ? s.colorway : [];
  return [cw[0] ?? fallback[0], cw[1] ?? fallback[1], cw[2] ?? fallback[2]];
}

/**
 * Media for the section on stage at time t, cross-faded from the previous section's media over
 * the first `mediaFadeSeconds(transitionIn)` of the section. Same asset on both sides: no fade.
 */
export function resolveMediaFrame(
  plan: DesignPlan | null | undefined,
  assets: ReadonlyMap<string, Asset>,
  sectionIndex: number | null,
  t: number,
  fallbackColorway: [string, string, string],
  /** false = show the section's media fully at once (paused, or the playhead jumped here) */
  fade = true,
): MediaFrame {
  const sections = plan?.sections;
  if (!Array.isArray(sections) || sectionIndex == null || !sections[sectionIndex]) return { current: null, previous: null };
  const s = sections[sectionIndex];
  const cur = sectionMedia(s, assets);
  const start = Number.isFinite(s.start) ? s.start : 0;
  const end = Number.isFinite(s.end) ? s.end : start;
  // the song's first section has nothing to fade from
  const fadeSeconds = fade && sectionIndex > 0 ? mediaFadeSeconds(s.transitionIn) : 0;
  const p = fadeSeconds > 0 ? clamp((t - start) / fadeSeconds, 0, 1, 1) : 1;
  const k = p * p * (3 - 2 * p);
  const current: MediaLayerState | null = cur
    ? { ...cur, sectionIndex, sectionStart: start, sectionEnd: end, weight: 1, colorway: colorwayOf(s, fallbackColorway) }
    : null;
  let previous: MediaLayerState | null = null;
  const prevSection = sectionIndex > 0 ? sections[sectionIndex - 1] : null;
  const prev = prevSection ? sectionMedia(prevSection, assets) : null;
  const same = !!(prev && cur && prev.asset.id === cur.asset.id);
  if (k < 1 && prev && prevSection && !same) {
    previous = {
      ...prev,
      sectionIndex: sectionIndex - 1,
      sectionStart: prevSection.start,
      sectionEnd: prevSection.end,
      weight: 1 - k,
      colorway: colorwayOf(prevSection, fallbackColorway),
    };
  }
  if (current && !same) current.weight = k;
  return { current, previous };
}
