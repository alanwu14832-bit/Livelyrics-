// Mood board (參考圖, phase 4): limits, the colour extraction the browser runs at upload time, the
// coercion of stored lists and the summary the offline designer reads. Pure (no DOM, no Node):
// shared by the upload UI, the API routes and the designer.
//
// Extraction: a deterministic k-means over at most MAX_SAMPLES pixels of the downscaled image
// (farthest-point initialisation, so the same pixels always give the same palette), clusters that
// end up closer than MERGE_DISTANCE merged, most frequent first. Tone: mean luma (Rec. 709 weights
// on the encoded values), mean HSL saturation and a warm / cool balance.

import { coerceAssets } from "./assets";
import type { MoodImage, MoodStats } from "./types";

/** Reference images per scope (a song, a band). */
export const MAX_MOODBOARD_IMAGES = 12;
/** Uploads are downscaled in the browser to this long edge (what Claude sees, and enough for print). */
export const MOOD_MAX_EDGE = 1024;
/** Stored reference images are small; this is the server's ceiling for one. */
export const MAX_MOOD_BYTES = 8 * 1024 * 1024;
export const MOOD_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";
export const MOOD_FORMATS_LABEL = "PNG、JPG、WebP、GIF";

const MAX_SAMPLES = 4096;
const ITERATIONS = 12;
const MERGE_DISTANCE = 28;

export type Rgb3 = [number, number, number];

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

export function rgbHex([r, g, b]: Rgb3): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function hexRgb(hex: string): Rgb3 | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Weighted RGB distance (a cheap perceptual approximation, "redmean"). */
export function colorDistance(a: Rgb3, b: Rgb3): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 3;
}

function saturationOf([r, g, b]: Rgb3): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function lumaOf([r, g, b]: Rgb3): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export interface Cluster {
  hex: string;
  weight: number;
}

/**
 * k-means over weighted colours (deterministic). `points` and `weights` have the same length; the
 * result is sorted by weight (most frequent first), near-duplicates merged.
 */
export function kmeans(points: readonly Rgb3[], weights: readonly number[], k: number): Cluster[] {
  const n = points.length;
  if (!n) return [];
  const total = weights.reduce((a, w) => a + w, 0) || 1;
  // initialisation: the weighted mean's nearest point, then repeatedly the point farthest from every centre
  const mean: Rgb3 = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += (points[i][c] * weights[i]) / total;
  let first = 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = colorDistance(points[i], mean);
    if (d < best) {
      best = d;
      first = i;
    }
  }
  const centres: Rgb3[] = [[...points[first]] as Rgb3];
  const nearest = new Float64Array(n).fill(Infinity);
  while (centres.length < Math.min(k, n)) {
    const last = centres[centres.length - 1];
    let pick = -1;
    let far = -1;
    for (let i = 0; i < n; i++) {
      nearest[i] = Math.min(nearest[i], colorDistance(points[i], last));
      // weight the distance so a lone outlier pixel does not become a colour of its own
      const score = nearest[i] * Math.sqrt(weights[i]);
      if (score > far) {
        far = score;
        pick = i;
      }
    }
    if (pick < 0 || nearest[pick] < 1) break;
    centres.push([...points[pick]] as Rgb3);
  }
  const assign = new Int32Array(n);
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = colorDistance(points[i], centres[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      if (assign[i] !== bi) moved = true;
      assign[i] = bi;
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]];
      const w = weights[i];
      s[0] += points[i][0] * w;
      s[1] += points[i][1] * w;
      s[2] += points[i][2] * w;
      s[3] += w;
    }
    for (let c = 0; c < centres.length; c++) {
      const s = sums[c];
      if (s[3] > 0) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    }
    if (!moved && iter > 0) break;
  }
  const mass = centres.map(() => 0);
  for (let i = 0; i < n; i++) mass[assign[i]] += weights[i];
  let clusters = centres.map((c, i) => ({ rgb: c, weight: mass[i] / total })).filter((c) => c.weight > 0);
  clusters.sort((a, b) => b.weight - a.weight);
  // merge near-duplicates into the heavier one
  const merged: Array<{ rgb: Rgb3; weight: number }> = [];
  for (const c of clusters) {
    const into = merged.find((m) => colorDistance(m.rgb, c.rgb) < MERGE_DISTANCE);
    if (into) {
      const w = into.weight + c.weight;
      into.rgb = [0, 1, 2].map((j) => (into.rgb[j] * into.weight + c.rgb[j] * c.weight) / w) as Rgb3;
      into.weight = w;
    } else merged.push({ rgb: [...c.rgb] as Rgb3, weight: c.weight });
  }
  clusters = merged.sort((a, b) => b.weight - a.weight);
  return clusters.map((c) => ({ hex: rgbHex(c.rgb), weight: Math.round(c.weight * 1000) / 1000 }));
}

/**
 * Palette and tone of an image from its RGBA pixels (e.g. `getImageData` of the downscaled
 * image). Transparent pixels are ignored. Deterministic.
 */
export function extractMoodStats(data: ArrayLike<number>, k = 5): MoodStats {
  const count = Math.floor(data.length / 4);
  const stride = Math.max(1, Math.floor(count / MAX_SAMPLES));
  const points: Rgb3[] = [];
  let lumaSum = 0;
  let satSum = 0;
  let warmSum = 0;
  for (let p = 0; p < count; p += stride) {
    const i = p * 4;
    if (data[i + 3] < 128) continue;
    const rgb: Rgb3 = [data[i], data[i + 1], data[i + 2]];
    points.push(rgb);
    lumaSum += lumaOf(rgb);
    satSum += saturationOf(rgb);
    warmSum += (rgb[0] - rgb[2]) / 255;
  }
  if (!points.length) return { palette: ["#000000"], weights: [1], luma: 0, saturation: 0, warmth: 0 };
  // quantise to 5 bits per channel first: identical colours become one weighted point (fast, and a flat image is one cluster)
  const bins = new Map<number, { rgb: Rgb3; w: number }>();
  for (const [r, g, b] of points) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = bins.get(key);
    if (bin) {
      bin.rgb = [bin.rgb[0] + r, bin.rgb[1] + g, bin.rgb[2] + b];
      bin.w++;
    } else bins.set(key, { rgb: [r, g, b], w: 1 });
  }
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const pts = keys.map((key) => {
    const bin = bins.get(key)!;
    return [bin.rgb[0] / bin.w, bin.rgb[1] / bin.w, bin.rgb[2] / bin.w] as Rgb3;
  });
  const ws = keys.map((key) => bins.get(key)!.w);
  const clusters = kmeans(pts, ws, k).slice(0, 6);
  const n = points.length;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    palette: clusters.map((c) => c.hex),
    weights: clusters.map((c) => c.weight),
    luma: r3(lumaSum / n),
    saturation: r3(satSum / n),
    warmth: r3(Math.max(-1, Math.min(1, warmSum / n))),
  };
}

const HEX = /^#[0-9a-f]{6}$/;

/** Stats from the browser (or a stored file), or undefined when malformed. */
export function sanitizeMoodStats(v: unknown): MoodStats | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const palette = Array.isArray(o.palette) ? o.palette.filter((h): h is string => typeof h === "string").map((h) => h.trim().toLowerCase()).filter((h) => HEX.test(h)).slice(0, 6) : [];
  if (!palette.length) return undefined;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
  const rawW = Array.isArray(o.weights) ? o.weights : [];
  let weights = palette.map((_, i) => num(rawW[i], 0, 1, 1 / palette.length));
  const sum = weights.reduce((a, w) => a + w, 0);
  weights = weights.map((w) => Math.round((sum > 0 ? w / sum : 1 / palette.length) * 1000) / 1000);
  return { palette, weights, luma: num(o.luma, 0, 1, 0.5), saturation: num(o.saturation, 0, 1, 0.3), warmth: num(o.warmth, -1, 1, 0) };
}

/** Stored mood board list (images only), dropping anything malformed. */
export function coerceMoodboard(raw: unknown, scope?: "band"): MoodImage[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, unknown>();
  for (const item of raw) if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") byId.set((item as { id: string }).id, item);
  return coerceAssets(raw)
    .filter((a) => a.kind !== "video" && a.mimeType.startsWith("image/"))
    .slice(0, MAX_MOODBOARD_IMAGES)
    .map((a) => {
      const img: MoodImage = { ...a, kind: "image" };
      const stats = sanitizeMoodStats((byId.get(a.id) as { stats?: unknown } | undefined)?.stats);
      if (stats) img.stats = stats;
      if (scope) img.scope = scope;
      else delete img.scope;
      delete img.tags;
      return img;
    });
}

/** The mood board a song's designer sees: the band's first (it frames the world), then the song's own. */
export function mergedMoodboard(project: { moodboard?: MoodImage[]; bandMoodboard?: MoodImage[] } | null | undefined): MoodImage[] {
  if (!project) return [];
  const band = (project.bandMoodboard ?? []).map((m) => ({ ...m, scope: "band" as const }));
  const own = (project.moodboard ?? []).filter((m) => !band.some((b) => b.id === m.id));
  return [...band, ...own];
}

export interface MoodSummary {
  /** merged dominant colours of every image, most weight first (≤ 6) */
  colors: Cluster[];
  luma: number;
  saturation: number;
  warmth: number;
  /** the most saturated colour that carries real weight (the "you liked this colour" colour) */
  vivid: string | null;
  /** ids of the images the summary came from */
  imageIds: string[];
}

/**
 * One reading of the whole mood board: every image's palette weighted by its share (images whose
 * note says the colour is the point, 「顏色」「色」, count double). Null without measured images.
 */
export function moodSummary(images: readonly MoodImage[] | null | undefined): MoodSummary | null {
  const measured = (images ?? []).filter((m) => m.stats && m.stats.palette.length);
  if (!measured.length) return null;
  const pts: Rgb3[] = [];
  const ws: number[] = [];
  let luma = 0;
  let sat = 0;
  let warm = 0;
  let total = 0;
  for (const m of measured) {
    const s = m.stats!;
    const boost = m.note && /顏色|色調|配色|色彩|colou?r/i.test(m.note) ? 2 : 1;
    s.palette.forEach((hex, i) => {
      const rgb = hexRgb(hex);
      if (!rgb) return;
      pts.push(rgb);
      ws.push((s.weights[i] ?? 1 / s.palette.length) * boost);
    });
    luma += s.luma * boost;
    sat += s.saturation * boost;
    warm += s.warmth * boost;
    total += boost;
  }
  const colors = kmeans(pts, ws, 6).slice(0, 6);
  let vivid: string | null = null;
  let vividScore = 0;
  for (const c of colors) {
    const rgb = hexRgb(c.hex)!;
    const score = saturationOf(rgb) * Math.sqrt(c.weight) * (lumaOf(rgb) > 0.08 && lumaOf(rgb) < 0.95 ? 1 : 0.2);
    if (score > vividScore) {
      vividScore = score;
      vivid = c.hex;
    }
  }
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { colors, luma: r3(luma / total), saturation: r3(sat / total), warmth: r3(warm / total), vivid, imageIds: measured.map((m) => m.id) };
}

/** Longest-edge fit for the browser's downscale (never upscales). */
export function fitWithin(width: number, height: number, max = MOOD_MAX_EDGE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
