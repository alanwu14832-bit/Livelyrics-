// The designer's view of the mood board (參考圖, phase 4).
//
// Claude: every image the server could read goes into the user turn as a base64 image block,
// preceded by a short label (圖 n, whose board, the operator's note), before the prompt text, and
// the prompt lists the notes and measured colours with the instruction to extract palette,
// texture, composition and typography cues and to cite the image that informed each choice.
// Offline: the colours measured in the browser at upload time (MoodStats) become a palette and a
// scene bias.

import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { moodSummary, type MoodSummary } from "@/lib/moodboard";
import type { MoodImage, SceneId } from "@/lib/types";
import { colorName, ensureContrast, hexToHsl, hsl, hueDistance, luminance } from "./color";
import type { PaletteEntry } from "./palette";

export type VisionMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** A mood board image loaded by the server for Claude (base64, no line breaks). */
export interface VisionImage {
  /** the MoodImage id */
  id: string;
  mediaType: VisionMediaType;
  data: string;
}

/** Claude's per-image limit is 5 MB of base64; downscaled uploads are far below it. */
export const MAX_VISION_IMAGE_BYTES = 3_500_000;
/** Everything the request carries in images (the API allows 32 MB per request). */
export const MAX_VISION_TOTAL_BYTES = 18_000_000;
export const VISION_MEDIA_TYPES: readonly VisionMediaType[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function isVisionMediaType(v: string): v is VisionMediaType {
  return (VISION_MEDIA_TYPES as readonly string[]).includes(v);
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function scopeLabel(m: MoodImage): string {
  return m.scope === "band" ? "樂團參考" : "這首歌的參考";
}

/**
 * The image blocks for the user turn: for each image that was loaded, a text label then the image
 * (numbered like `moodboardBlock`, so 「圖 2」 means the same picture everywhere).
 */
export function visionContent(moodboard: readonly MoodImage[] | undefined, images: readonly VisionImage[] | undefined): BetaContentBlockParam[] {
  const list = moodboard ?? [];
  const loaded = new Map((images ?? []).map((v) => [v.id, v]));
  const out: BetaContentBlockParam[] = [];
  list.forEach((m, i) => {
    const v = loaded.get(m.id);
    if (!v) return;
    out.push({ type: "text", text: `圖 ${i + 1}（${scopeLabel(m)}）${m.note ? `：「${clip(m.note, 200)}」` : ""}` });
    out.push({ type: "image", source: { type: "base64", media_type: v.mediaType, data: v.data } });
  });
  return out;
}

/** The mood board in the prompt text (null without one): notes, measured colours, and what to do with it. */
export function moodboardBlock(moodboard: readonly MoodImage[] | undefined, images: readonly VisionImage[] | undefined): string | null {
  const list = moodboard ?? [];
  if (!list.length) return null;
  const loaded = new Set((images ?? []).map((v) => v.id));
  const rows = list.map((m, i) => {
    const parts = [`圖 ${i + 1}（${scopeLabel(m)}）`];
    if (m.note) parts.push(`操作員說明：「${clip(m.note, 200)}」`);
    if (m.stats?.palette.length) parts.push(`量到的主色：${m.stats.palette.slice(0, 5).join("、")}（亮度 ${m.stats.luma.toFixed(2)}、飽和度 ${m.stats.saturation.toFixed(2)}）`);
    if (!loaded.has(m.id)) parts.push("（這張圖沒有附上，只能依說明與色票判斷）");
    return `- ${parts.join("｜")}`;
  });
  return [
    "樂團與操作員提供的參考圖（上方附上的圖片，編號相同）。請真的看圖：",
    "- 從參考圖萃取配色（主色、點綴、明暗關係）、材質（顆粒、筆觸、印刷網點、雜訊）、構圖（留白、裁切、對稱）與字體線索（粗細、襯線、手寫感）。",
    "- 操作員的說明是最重要的線索（例如「喜歡這個顏色」就取它的顏色，「這種顆粒感」就用 grain-film 或雨絲、水墨的質地）。",
    "- 在理由裡寫明哪張圖啟發了什麼，例如「圖 2 的橘紅 → 副歌主色」「圖 3 的顆粒 → 主歌 grain-film」。",
    "- 參考圖只是參考，不會出現在舞台上；不要把它們當成素材（media）。",
    ...rows,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// offline: palette and scene bias from the measured colours
// ---------------------------------------------------------------------------

export interface MoodPalette {
  entries: PaletteEntry[];
  bg: string;
  primary: string;
  accent: string;
  lyric: string;
  highlight: string;
  bg2: string;
}

function withLightness(hex: string, lo: number, hi: number): string {
  const c = hexToHsl(hex);
  if (c.l >= lo && c.l <= hi) return hex;
  return hsl(c.h, Math.max(c.s, 0.3), Math.max(lo, Math.min(hi, c.l < lo ? lo + 0.05 : hi - 0.05)));
}

/**
 * A stage palette from the mood board: the most vivid colour is the primary (kept exactly when it
 * is bright enough for a screen), the next clearly different colour the accent, the background the
 * darkest colour's hue at stage darkness, a light lyric colour with ≥ 4.5:1 contrast.
 */
export function moodPalette(summary: MoodSummary | null): MoodPalette | null {
  if (!summary || !summary.colors.length) return null;
  const colors = summary.colors.map((c) => c.hex);
  const vivid = summary.vivid ?? colors[0];
  const primary = withLightness(vivid, 0.32, 0.72);
  const ph = hexToHsl(primary);
  const other = colors.find((c) => {
    const x = hexToHsl(c);
    return c !== vivid && x.s >= 0.18 && hueDistance(x.h, ph.h) >= 35 && x.l > 0.1 && x.l < 0.95;
  });
  const accent = other ? withLightness(other, 0.45, 0.76) : hsl(ph.h + 38, Math.max(0.5, ph.s), 0.6);
  const darkest = [...colors].sort((a, b) => luminance(a) - luminance(b))[0];
  const dh = hexToHsl(darkest);
  const bg = dh.s >= 0.12 ? hsl(dh.h, Math.min(0.55, dh.s * 0.7), 0.06) : hsl(ph.h, 0.3, 0.055);
  const ah = hexToHsl(accent);
  const bg2 = hsl(ah.h, 0.4, 0.085);
  const lightest = [...colors].filter((c) => hexToHsl(c).s >= 0.2).sort((a, b) => luminance(b) - luminance(a))[0];
  const highlight = lightest && lightest !== vivid ? withLightness(lightest, 0.66, 0.82) : hsl(ph.h - 25, Math.max(0.55, ph.s), 0.74);
  const lyric = ensureContrast(hsl(ph.h, 0.25, 0.95), bg, []);
  const roles: Array<[string, string]> = [
    [bg, "背景"],
    [primary, "主色"],
    [accent, "點綴"],
    [lyric, "歌詞"],
    [highlight, "高光"],
    [bg2, "對比背景"],
  ];
  const seen = new Set<string>();
  const entries: PaletteEntry[] = [];
  for (const [hex, role] of roles) {
    if (seen.has(hex)) continue;
    seen.add(hex);
    entries.push({ hex, role, name: colorName(hex) });
  }
  return { entries, bg, primary, accent, lyric, highlight, bg2 };
}

/** Scenes the mood board's tone suggests (most fitting first). */
export function moodScenes(summary: MoodSummary | null): SceneId[] {
  if (!summary) return [];
  const { luma, saturation, warmth } = summary;
  if (saturation >= 0.45 && luma >= 0.3) return ["shards", "particles", "bokeh", "grid"];
  if (saturation < 0.18) return ["ink", "rain", "gradient", "motif"];
  if (luma < 0.25) return warmth > 0.1 ? ["nebula", "bokeh", "particles"] : ["nebula", "rain", "particles"];
  if (warmth > 0.15) return ["bokeh", "nebula", "waves"];
  return ["waves", "nebula", "rain"];
}

/** The summary of a designer input's mood board (null without measured images). */
export function inputMood(moodboard: readonly MoodImage[] | undefined): MoodSummary | null {
  return moodSummary(moodboard ?? []);
}
