// Export settings: variants, codec strings (H.264 level selection by frame size and macroblock
// rate), bitrate presets, the song range and file names. Pure; the browser-only encoder in
// ./encode.ts checks what the machine can actually encode.

import type { DesignPlan, Project } from "../types";
import { type FrameRate, fpsOf } from "./frames";

export type ExportVariant = "full" | "background" | "lyrics";

export const EXPORT_VARIANTS: readonly ExportVariant[] = ["full", "background", "lyrics"];

export const VARIANT_INFO: Record<ExportVariant, { label: string; detail: string; tag: string }> = {
  full: { label: "完整", detail: "場景、素材與歌詞，直接播放", tag: "full" },
  background: { label: "背景", detail: "場景與素材，沒有歌詞", tag: "bg" },
  lyrics: { label: "歌詞層", detail: "只有歌詞，給現場疊在自己的畫面上", tag: "lyrics" },
};

/** matte = black background, white text (luma key); alpha = transparent VP9 WebM (when supported). */
export type LyricLayerFormat = "matte" | "alpha";

export type VideoCodecChoice = "avc" | "vp9";

export type QualityPreset = "standard" | "high" | "max";

export const QUALITY_INFO: Record<QualityPreset, { label: string; bitsPerPixel: number }> = {
  standard: { label: "標準", bitsPerPixel: 0.1 },
  high: { label: "高", bitsPerPixel: 0.16 },
  max: { label: "最高", bitsPerPixel: 0.26 },
};

export interface ExportRange {
  /** song seconds */
  start: number;
  end: number;
}

export interface ExportSettings {
  variants: ExportVariant[];
  lyricFormat: LyricLayerFormat;
  codec: VideoCodecChoice;
  quality: QualityPreset;
  rate: FrameRate;
  range: ExportRange;
  /** mux the song audio (rehearsal previews); off for festival delivery */
  audio: boolean;
}

/**
 * Target bitrate (bits per second) for a canvas and frame rate. VP9 needs about 30 % less than
 * H.264 for the same look. Clamped to what a media server plays back comfortably.
 */
export function targetBitrate(width: number, height: number, fps: number, preset: QualityPreset, codec: VideoCodecChoice): number {
  const bpp = QUALITY_INFO[preset]?.bitsPerPixel ?? QUALITY_INFO.high.bitsPerPixel;
  const k = codec === "vp9" ? 0.7 : 1;
  const raw = width * height * Math.max(1, fps) * bpp * k;
  return Math.round(Math.min(160_000_000, Math.max(2_000_000, raw)) / 100_000) * 100_000;
}

// ---------------------------------------------------------------------------
// H.264 levels (ITU-T H.264 Table A-1). maxBr is in kbit/s for Baseline / Main; High profile
// allows 1.25 times that.

export interface AvcLevel {
  name: string;
  idc: number;
  /** max macroblocks per second */
  maxMbps: number;
  /** max frame size in macroblocks */
  maxFs: number;
  /** max bitrate kbit/s (Main) */
  maxBr: number;
}

export const AVC_LEVELS: readonly AvcLevel[] = [
  { name: "3.0", idc: 0x1e, maxMbps: 40_500, maxFs: 1_620, maxBr: 10_000 },
  { name: "3.1", idc: 0x1f, maxMbps: 108_000, maxFs: 3_600, maxBr: 14_000 },
  { name: "3.2", idc: 0x20, maxMbps: 216_000, maxFs: 5_120, maxBr: 20_000 },
  { name: "4.0", idc: 0x28, maxMbps: 245_760, maxFs: 8_192, maxBr: 20_000 },
  { name: "4.1", idc: 0x29, maxMbps: 245_760, maxFs: 8_192, maxBr: 50_000 },
  { name: "4.2", idc: 0x2a, maxMbps: 522_240, maxFs: 8_704, maxBr: 50_000 },
  { name: "5.0", idc: 0x32, maxMbps: 589_824, maxFs: 22_080, maxBr: 135_000 },
  { name: "5.1", idc: 0x33, maxMbps: 983_040, maxFs: 36_864, maxBr: 240_000 },
  { name: "5.2", idc: 0x34, maxMbps: 2_073_600, maxFs: 36_864, maxBr: 240_000 },
  { name: "6.0", idc: 0x3c, maxMbps: 4_177_920, maxFs: 139_264, maxBr: 240_000 },
  { name: "6.1", idc: 0x3d, maxMbps: 8_355_840, maxFs: 139_264, maxBr: 480_000 },
  { name: "6.2", idc: 0x3e, maxMbps: 16_711_680, maxFs: 139_264, maxBr: 800_000 },
];

export type AvcProfile = "high" | "main";

const PROFILE_IDC: Record<AvcProfile, number> = { high: 0x64, main: 0x4d };

/** Macroblocks per frame (16 × 16) for a frame size. */
export function macroblocks(width: number, height: number): number {
  return Math.ceil(width / 16) * Math.ceil(height / 16);
}

/**
 * Levels that can carry this stream, lowest first. A level fits when the frame size, the
 * macroblock rate, the bitrate and the longest side (√(8 · MaxFS) macroblocks) are within it.
 */
export function avcLevelsFor(width: number, height: number, fps: number, bitrate: number, profile: AvcProfile = "high"): AvcLevel[] {
  const fs = macroblocks(width, height);
  const mbps = fs * fps;
  const brFactor = profile === "high" ? 1.25 : 1;
  const maxSide = Math.max(Math.ceil(width / 16), Math.ceil(height / 16));
  return AVC_LEVELS.filter((l) => fs <= l.maxFs && mbps <= l.maxMbps * 1.0001 && bitrate <= l.maxBr * 1000 * brFactor && maxSide <= Math.sqrt(8 * l.maxFs));
}

export function avcCodecString(profile: AvcProfile, levelIdc: number): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `avc1.${hex(PROFILE_IDC[profile])}00${hex(levelIdc)}`;
}

export interface CodecCandidate {
  codec: VideoCodecChoice;
  codecString: string;
  /** "H.264 High 4.2" */
  label: string;
}

/**
 * H.264 candidates in preference order: High at the lowest fitting level, then higher levels
 * (some encoders only accept a level with headroom), then Main. Empty when no H.264 level can
 * carry the frame (larger than 4096 × 2304 class sizes at level 5.2 and beyond 8K).
 */
export function avcCandidates(width: number, height: number, fps: number, bitrate: number): CodecCandidate[] {
  const out: CodecCandidate[] = [];
  for (const profile of ["high", "main"] as const) {
    const levels = avcLevelsFor(width, height, fps, bitrate, profile).slice(0, 3);
    for (const l of levels) out.push({ codec: "avc", codecString: avcCodecString(profile, l.idc), label: `H.264 ${profile === "high" ? "High" : "Main"} ${l.name}` });
  }
  return out;
}

/** VP9 profile 0 (8-bit 4:2:0) at the lowest level for the luma sample rate and picture size. */
const VP9_LEVELS: ReadonlyArray<{ level: number; name: string; maxPic: number; maxRate: number }> = [
  { level: 30, name: "3", maxPic: 552_960, maxRate: 20_736_000 },
  { level: 31, name: "3.1", maxPic: 983_040, maxRate: 36_864_000 },
  { level: 40, name: "4", maxPic: 2_228_224, maxRate: 83_558_400 },
  { level: 41, name: "4.1", maxPic: 2_228_224, maxRate: 160_432_128 },
  { level: 50, name: "5", maxPic: 8_912_896, maxRate: 311_951_360 },
  { level: 51, name: "5.1", maxPic: 8_912_896, maxRate: 588_251_136 },
  { level: 52, name: "5.2", maxPic: 8_912_896, maxRate: 1_176_502_272 },
  { level: 60, name: "6", maxPic: 35_651_584, maxRate: 1_176_502_272 },
  { level: 61, name: "6.1", maxPic: 35_651_584, maxRate: 2_353_004_544 },
  { level: 62, name: "6.2", maxPic: 35_651_584, maxRate: 4_706_009_088 },
];

export function vp9Candidate(width: number, height: number, fps: number): CodecCandidate {
  const pic = width * height;
  const rate = pic * fps;
  const l = VP9_LEVELS.find((v) => pic <= v.maxPic && rate <= v.maxRate) ?? VP9_LEVELS[VP9_LEVELS.length - 1];
  return { codec: "vp9", codecString: `vp09.00.${String(l.level).padStart(2, "0")}.08`, label: `VP9 Profile 0 Level ${l.name}` };
}

// ---------------------------------------------------------------------------
// range

export function songDuration(project: Pick<Project, "meta" | "analysis">): number {
  const d = project.meta?.duration || project.analysis?.duration || 0;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Whole song, or the span from section `from` to the end of section `to` (inclusive). */
export function rangeFor(project: Pick<Project, "meta" | "analysis" | "plan">, from: number | null, to: number | null): ExportRange {
  const duration = songDuration(project);
  const sections = project.plan?.sections ?? [];
  if (from == null || to == null || !sections.length) return { start: 0, end: duration };
  const a = sections[Math.max(0, Math.min(sections.length - 1, Math.min(from, to)))];
  const b = sections[Math.max(0, Math.min(sections.length - 1, Math.max(from, to)))];
  const start = Math.max(0, a.start);
  const end = Math.min(duration || b.end, Math.max(b.end, start + 0.1));
  return { start, end };
}

/** A range clamped to the song, at least one frame long. */
export function clampRange(range: ExportRange, duration: number): ExportRange {
  const d = duration > 0 ? duration : Math.max(range.end, 1);
  const start = Math.min(Math.max(0, Number.isFinite(range.start) ? range.start : 0), Math.max(0, d - 0.05));
  const end = Math.min(d, Math.max(start + 0.05, Number.isFinite(range.end) ? range.end : d));
  return { start, end };
}

export function sectionLabel(plan: DesignPlan | null, index: number): string {
  const s = plan?.sections?.[index];
  return s ? s.label || s.kind || `段落 ${index + 1}` : `段落 ${index + 1}`;
}

// ---------------------------------------------------------------------------
// file names

/** Keep letters (any script), digits and a few separators; everything else becomes "_". */
export function slugify(name: string): string {
  const s = (name || "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/[^\p{L}\p{N}\-_.()]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");
  return s.slice(0, 60) || "livelyrics";
}

export function rateTag(rate: FrameRate): string {
  return rate.id === "29.97" ? "2997" : `${rate.id}p`;
}

export function exportBaseName(title: string, width: number, height: number, rate: FrameRate, range?: ExportRange, duration?: number): string {
  const partial = range && duration && (range.start > 0.01 || range.end < duration - 0.01);
  const span = partial ? `_${Math.floor(range.start)}-${Math.ceil(range.end)}s` : "";
  return `${slugify(title)}_${width}x${height}_${rateTag(rate)}${span}`;
}

export function variantFileName(base: string, variant: ExportVariant, format: LyricLayerFormat, ext: "mp4" | "webm"): string {
  const tag = variant === "lyrics" ? (format === "alpha" ? "lyrics-alpha" : "lyrics-matte") : VARIANT_INFO[variant].tag;
  return `${base}_${tag}.${ext}`;
}

/** Rough output size in bytes for the UI (video bitrate plus 5 % container, audio 192 kbit/s). */
export function estimateBytes(bitrate: number, seconds: number, audio: boolean): number {
  return Math.round(((bitrate * 1.05 + (audio ? 192_000 : 0)) * Math.max(0, seconds)) / 8);
}

export function formatBytes(n: number): string {
  if (!(n > 0)) return "0 MB";
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  return `${Math.round(n / 1e6)} MB`;
}

export { fpsOf };

/** An export estimated above this asks first (a 60-minute set at high quality runs into many GB). */
export const EXPORT_SIZE_CONFIRM_BYTES = 2e9;

/** The 「開始匯出」 guard: true when the estimated size needs the operator's OK. */
export function exportNeedsSizeConfirm(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > EXPORT_SIZE_CONFIRM_BYTES;
}
