// The output canvas (Project.output): presets, defaults, sanitizing, and the pure geometry the
// projection window and the console preview share (letterbox / pillarbox fit, lyric safe area).
// No DOM: used by the server (storage, PATCH validation), the stage and the console.

import { DEFAULT_SAFETY, normalizeSafety, patchSafety, type SafetyPatch } from "./stage/safety";
import type { LyricSafeArea, ProjectOutput } from "./types";

export interface OutputPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

/** Common LED-wall / projector canvases. "custom" keeps the stored width and height. */
export const OUTPUT_PRESETS: readonly OutputPreset[] = [
  { id: "1080p", label: "1080p", width: 1920, height: 1080 },
  { id: "4k", label: "4K", width: 3840, height: 2160 },
  { id: "ultrawide", label: "超寬 32:9", width: 3840, height: 1080 },
  { id: "strip", label: "長條 3:1", width: 1920, height: 640 },
  { id: "portrait", label: "直式", width: 1080, height: 1920 },
  { id: "5x4", label: "5:4", width: 1280, height: 1024 },
];

export const CUSTOM_PRESET = "custom";

export const OUTPUT_MIN_PX = 64;
export const OUTPUT_MAX_PX = 16384;
/** Largest lyric safe margin per side (fraction of the canvas). */
export const SAFE_MAX = 0.3;

export const DEFAULT_LYRIC_SAFE: LyricSafeArea = { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 };

export const DEFAULT_OUTPUT: ProjectOutput = {
  width: 1920,
  height: 1080,
  preset: "1080p",
  lyricSafe: { ...DEFAULT_LYRIC_SAFE },
  safety: { ...DEFAULT_SAFETY },
};

export function defaultOutput(): ProjectOutput {
  return { ...DEFAULT_OUTPUT, lyricSafe: { ...DEFAULT_LYRIC_SAFE }, safety: { ...DEFAULT_SAFETY } };
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function px(v: unknown, fallback: number): number {
  const n = finite(v);
  if (n == null) return fallback;
  return Math.round(Math.min(OUTPUT_MAX_PX, Math.max(OUTPUT_MIN_PX, n)));
}

/** A margin fraction clamped to 0..SAFE_MAX and rounded to 0.001. */
export function safeFraction(v: unknown, fallback = 0.05): number {
  const n = finite(v);
  if (n == null) return fallback;
  return Math.round(Math.min(SAFE_MAX, Math.max(0, n)) * 1000) / 1000;
}

export function presetById(id: string): OutputPreset | undefined {
  return OUTPUT_PRESETS.find((p) => p.id === id);
}

/** The preset whose size matches exactly, or "custom". */
export function presetFor(width: number, height: number): string {
  return OUTPUT_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? CUSTOM_PRESET;
}

/**
 * Any stored or patched value -> a valid ProjectOutput. A known preset id wins over mismatching
 * width/height (so `{ preset: "4k" }` alone is enough); otherwise the preset is derived from the size.
 */
export function normalizeOutput(raw: unknown, base: ProjectOutput = DEFAULT_OUTPUT): ProjectOutput {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const safeRaw = o.lyricSafe && typeof o.lyricSafe === "object" && !Array.isArray(o.lyricSafe) ? (o.lyricSafe as Record<string, unknown>) : {};
  const lyricSafe: LyricSafeArea = {
    top: safeFraction(safeRaw.top, base.lyricSafe.top),
    right: safeFraction(safeRaw.right, base.lyricSafe.right),
    bottom: safeFraction(safeRaw.bottom, base.lyricSafe.bottom),
    left: safeFraction(safeRaw.left, base.lyricSafe.left),
  };
  // LED 安全模式: a file without it (older than phase 3) gets safe mode on with the LED 牆 preset
  const safety = normalizeSafety(o.safety, base.safety ?? DEFAULT_SAFETY);
  const preset = typeof o.preset === "string" ? presetById(o.preset) : undefined;
  if (preset) return { width: preset.width, height: preset.height, preset: preset.id, lyricSafe, safety };
  const width = px(o.width, base.width);
  const height = px(o.height, base.height);
  // "custom" is kept when asked for explicitly (the operator is typing a size); otherwise derived
  return { width, height, preset: o.preset === CUSTOM_PRESET ? CUSTOM_PRESET : presetFor(width, height), lyricSafe, safety };
}

export type OutputPatch = { width?: number; height?: number; preset?: string; lyricSafe?: Partial<LyricSafeArea>; safety?: SafetyPatch };

/**
 * The next canvas after a partial edit: a preset id replaces the size, a size edit keeps the
 * "custom" mode (or re-derives the preset from the new size), and safe-area sides merge.
 */
export function patchOutput(current: ProjectOutput, patch: OutputPatch): ProjectOutput {
  const sizeGiven = patch.width !== undefined || patch.height !== undefined;
  const preset = patch.preset ?? (sizeGiven && current.preset !== CUSTOM_PRESET ? undefined : current.preset);
  const base = current.safety ? current : { ...current, safety: normalizeSafety(undefined) };
  return normalizeOutput(
    {
      width: patch.width ?? current.width,
      height: patch.height ?? current.height,
      preset,
      lyricSafe: { ...current.lyricSafe, ...(patch.lyricSafe ?? {}) },
      safety: patch.safety ? patchSafety(base.safety, patch.safety) : base.safety,
    },
    base,
  );
}

export function outputAspect(output: Pick<ProjectOutput, "width" | "height"> | null | undefined): number {
  const w = output?.width ?? 0;
  const h = output?.height ?? 0;
  if (!(w > 0) || !(h > 0)) return 16 / 9;
  return w / h;
}

/** "16:9", "32:9", "3:1" ... or "1.25:1" when the ratio is not a short one. */
export function aspectLabel(width: number, height: number): string {
  const g = gcd(width, height);
  if (g > 0) {
    const a = width / g;
    const b = height / g;
    if (a <= 64 && b <= 64) return `${a}:${b}`;
  }
  const r = width / Math.max(1, height);
  for (const [v, label] of [
    [16 / 9, "16:9"],
    [16 / 10, "16:10"],
    [21 / 9, "21:9"],
    [32 / 9, "32:9"],
  ] as const) {
    if (Math.abs(v - r) < 0.01) return label;
  }
  return r >= 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`;
}

function gcd(a: number, b: number): number {
  a = Math.round(Math.abs(a));
  b = Math.round(Math.abs(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The largest rect of aspect `width / height` centred in a `boxW` x `boxH` container
 * (letterbox or pillarbox, black bars around it), snapped to whole physical pixels (`dpr` converts
 * CSS px to physical px) so a window sized exactly to the wall shows the canvas 1:1.
 */
export function fitCanvas(boxW: number, boxH: number, width: number, height: number, dpr = 1): Rect {
  const bw = Math.max(0, boxW);
  const bh = Math.max(0, boxH);
  const k = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
  let w = bw;
  let h = bw / aspect;
  if (h > bh) {
    h = bh;
    w = bh * aspect;
  }
  const snap = (v: number) => Math.round(v * k) / k;
  w = Math.min(bw, snap(w));
  h = Math.min(bh, snap(h));
  return { x: snap((bw - w) / 2), y: snap((bh - h) / 2), width: w, height: h };
}

/** The lyric safe rectangle in percent of the canvas (left, top, width, height). */
export function safeRectPercent(safe: LyricSafeArea | null | undefined): { left: number; top: number; width: number; height: number } {
  const s = safe ?? DEFAULT_LYRIC_SAFE;
  const top = safeFraction(s.top) * 100;
  const right = safeFraction(s.right) * 100;
  const bottom = safeFraction(s.bottom) * 100;
  const left = safeFraction(s.left) * 100;
  return { left, top, width: Math.max(1, 100 - left - right), height: Math.max(1, 100 - top - bottom) };
}

/** The drawing-buffer size to render: the element's physical size, never larger than the output canvas. */
export function renderSize(cssW: number, cssH: number, dpr: number, output: Pick<ProjectOutput, "width" | "height"> | null, maxPixels: number): [number, number] {
  let w = Math.max(1, cssW * dpr);
  let h = Math.max(1, cssH * dpr);
  if (output && output.width > 0 && output.height > 0 && w > output.width) {
    const k = output.width / w;
    w *= k;
    h *= k;
  }
  const px = w * h;
  if (px > maxPixels) {
    const k = Math.sqrt(maxPixels / px);
    w *= k;
    h *= k;
  }
  return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
}
