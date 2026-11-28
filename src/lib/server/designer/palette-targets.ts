// Round 28 (N2): colour comes from the song. The round-26 audit found one muted template for every
// song ("深夜X background / X光 primary / near-white / 微光"): punk, city pop and folk came out dusty
// rose on near-black. Each genre family now has real targets in OKLCH — a lightness and chroma range
// per role (primary = the subject, accent = what moves, highlight = the third colour) and 2–3 hue
// relationships — and the song's energy picks the spot inside the ranges, its seed picks the
// relationship. The ranges are also what the prompts teach Claude (PALETTE_TEACHING) and what the
// tests hold the offline designer to. Pure and deterministic.

import { hexToOklch, hueGap, oklchToHex, type Oklch } from "@/lib/stage/oklch";
import { ensureContrast, hexToHsl, hsl } from "./color";
import { nameEntries, type PaletteEntry } from "./palette";
import { hueFamily, recentUses, type RecentLook } from "./recent";

export const PALETTE_FAMILY_IDS = ["punk", "citypop", "folk", "emo", "pastel", "steel", "neon", "indie", "forge", "velvet"] as const;
export type TargetFamilyId = (typeof PALETTE_FAMILY_IDS)[number];

type Range = readonly [number, number];
interface RoleRange {
  L: Range;
  C: Range;
}

export interface PaletteFamily {
  id: TargetFamilyId;
  /** 繁中, the relationship in words (what the concept sentence may say about the palette) */
  label: string;
  /** hue relationships (OKLCH degrees): primary (the subject), accent, highlight */
  variants: ReadonlyArray<readonly [number, number, number]>;
  pri: RoleRange;
  acc: RoleRange;
  hi: RoleRange;
  /** the ground: lightness, chroma, and the hue it leans to (a number, or the primary's) */
  bg: { L: number; C: number; hue: number | "pri" };
}

/** The ten families. Lightness / chroma are OKLCH ranges; the song's energy walks each from its low end to its high end. */
export const PALETTE_FAMILIES: Readonly<Record<TargetFamilyId, PaletteFamily>> = {
  punk: { id: "punk", label: "原色撞色", variants: [[27, 95, 262], [262, 95, 27], [27, 262, 95]], pri: { L: [0.56, 0.64], C: [0.19, 0.24] }, acc: { L: [0.8, 0.86], C: [0.15, 0.18] }, hi: { L: [0.56, 0.62], C: [0.17, 0.21] }, bg: { L: 0.13, C: 0.03, hue: "pri" } },
  citypop: { id: "citypop", label: "夕陽粉配霓虹青", variants: [[355, 205, 75], [335, 195, 60], [15, 235, 95]], pri: { L: [0.66, 0.74], C: [0.16, 0.21] }, acc: { L: [0.8, 0.84], C: [0.1, 0.14] }, hi: { L: [0.8, 0.86], C: [0.11, 0.15] }, bg: { L: 0.16, C: 0.07, hue: 290 } },
  folk: { id: "folk", label: "暖色大地", variants: [[55, 125, 85], [75, 40, 140], [45, 100, 70]], pri: { L: [0.58, 0.66], C: [0.08, 0.12] }, acc: { L: [0.62, 0.7], C: [0.06, 0.09] }, hi: { L: [0.82, 0.88], C: [0.06, 0.09] }, bg: { L: 0.17, C: 0.03, hue: 55 } },
  emo: { id: "emo", label: "冷灰藍加一個熱點", variants: [[255, 25, 280], [235, 15, 300], [285, 35, 250]], pri: { L: [0.46, 0.54], C: [0.035, 0.06] }, acc: { L: [0.58, 0.64], C: [0.19, 0.23] }, hi: { L: [0.62, 0.7], C: [0.04, 0.07] }, bg: { L: 0.12, C: 0.02, hue: "pri" } },
  pastel: { id: "pastel", label: "乾淨的粉彩", variants: [[355, 235, 295], [320, 210, 95], [20, 250, 175]], pri: { L: [0.72, 0.78], C: [0.09, 0.13] }, acc: { L: [0.78, 0.84], C: [0.08, 0.11] }, hi: { L: [0.82, 0.88], C: [0.07, 0.1] }, bg: { L: 0.2, C: 0.04, hue: 270 } },
  steel: { id: "steel", label: "冷鋼灰藍加一點餘燼", variants: [[240, 50, 215], [205, 35, 265], [265, 75, 205]], pri: { L: [0.58, 0.68], C: [0.05, 0.09] }, acc: { L: [0.7, 0.76], C: [0.14, 0.17] }, hi: { L: [0.72, 0.8], C: [0.05, 0.08] }, bg: { L: 0.13, C: 0.025, hue: "pri" } },
  neon: { id: "neon", label: "霓虹", variants: [[195, 330, 295], [330, 195, 125], [295, 150, 350]], pri: { L: [0.7, 0.78], C: [0.13, 0.2] }, acc: { L: [0.62, 0.7], C: [0.2, 0.26] }, hi: { L: [0.6, 0.68], C: [0.17, 0.23] }, bg: { L: 0.12, C: 0.06, hue: 290 } },
  indie: { id: "indie", label: "一冷一暖", variants: [[195, 70, 25], [255, 60, 175], [150, 35, 255]], pri: { L: [0.6, 0.68], C: [0.09, 0.13] }, acc: { L: [0.72, 0.78], C: [0.12, 0.16] }, hi: { L: [0.7, 0.78], C: [0.08, 0.12] }, bg: { L: 0.15, C: 0.03, hue: "pri" } },
  forge: { id: "forge", label: "血紅與鋼", variants: [[25, 60, 250], [35, 20, 240], [15, 75, 260]], pri: { L: [0.46, 0.54], C: [0.15, 0.2] }, acc: { L: [0.66, 0.72], C: [0.14, 0.17] }, hi: { L: [0.6, 0.68], C: [0.03, 0.05] }, bg: { L: 0.1, C: 0.03, hue: 25 } },
  velvet: { id: "velvet", label: "絲絨的金與紫", variants: [[85, 300, 45], [300, 75, 20], [55, 285, 200]], pri: { L: [0.62, 0.74], C: [0.12, 0.17] }, acc: { L: [0.64, 0.72], C: [0.13, 0.17] }, hi: { L: [0.78, 0.84], C: [0.1, 0.13] }, bg: { L: 0.14, C: 0.05, hue: 300 } },
};

/** The genre rule (lexicon/genres.ts) → palette family. */
const FAMILY_OF_GENRE: Readonly<Record<string, TargetFamilyId>> = {
  "post-rock": "steel",
  shoegaze: "neon",
  "dream-pop": "pastel",
  "city-pop": "citypop",
  "indie-rock": "indie",
  "indie-pop": "pastel",
  folk: "folk",
  metal: "forge",
  punk: "punk",
  "post-punk": "steel",
  electronic: "neon",
  "hip-hop": "velvet",
  rnb: "velvet",
  jazz: "velvet",
  "math-rock": "indie",
  emo: "emo",
  psychedelic: "neon",
  "alt-rock": "indie",
  ambient: "steel",
  pop: "pastel",
};

export interface TargetInput {
  genreId?: string | null;
  /** audio mood quadrant (findings.audio.quadrant) */
  quadrant?: string | null;
  /** lyric emotion label (findings.lyrics.emotion.label) */
  emotion?: string | null;
  /** 0..1: how loud / driving the song is (the position inside each range) */
  energy: number;
  /** 0..1 */
  brightness: number;
  seed: number;
  /** an operator's hue (HSL degrees): the primary moves there, the relationship stays */
  hueOverride?: number;
  mono?: boolean;
  looks?: readonly RecentLook[];
  /** the song's strongest lyric image's hue (HSL degrees): pulls the relationship up to 12° toward it */
  imageHue?: number | null;
}

export interface TargetPalette {
  entries: PaletteEntry[];
  family: PaletteFamily;
  variant: number;
  /** 繁中: the built palette in colour words (derived from the OKLCH values), e.g. 「鮮紅、亮黃、藍」 */
  words: string;
}

/** The family a song belongs to: its genre's, else what its words and sound say (`byImage`: only the sound did, so the song's own image may lead the hue). */
export function familyFor(i: Pick<TargetInput, "genreId" | "quadrant" | "emotion">): PaletteFamily & { byImage?: boolean } {
  const byGenre = i.genreId ? FAMILY_OF_GENRE[i.genreId] : undefined;
  if (byGenre) return PALETTE_FAMILIES[byGenre];
  if (i.emotion === "痛苦掙扎") return PALETTE_FAMILIES.emo;
  if (i.emotion === "溫柔明亮") return PALETTE_FAMILIES.pastel;
  if (i.emotion === "平靜內斂") return PALETTE_FAMILIES.steel;
  return { ...bySound(i.quadrant), byImage: true };
}

function bySound(quadrant: string | null | undefined): PaletteFamily {
  switch (quadrant) {
    case "dark-slow":
      return PALETTE_FAMILIES.emo;
    case "gentle-float":
      return PALETTE_FAMILIES.pastel;
    case "cold-drive":
      return PALETTE_FAMILIES.steel;
    case "warm-groove":
      return PALETTE_FAMILIES.citypop;
    default:
      return PALETTE_FAMILIES.indie;
  }
}

const lerp = (r: Range, t: number) => r[0] + (r[1] - r[0]) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const wrap = (h: number) => ((h % 360) + 360) % 360;

// ---------------------------------------------------------------------------
// colour words from OKLCH values
// ---------------------------------------------------------------------------

const HUE_WORDS: Array<[number, string]> = [
  [15, "桃紅"],
  [40, "紅"],
  [65, "橙"],
  [80, "琥珀"],
  [105, "黃"],
  [135, "黃綠"],
  [170, "綠"],
  [200, "青綠"],
  [230, "青"],
  [255, "天藍"],
  [280, "藍"],
  [310, "紫"],
  [345, "洋紅"],
  [361, "桃紅"],
];

/** A plain colour word from the OKLCH values of a hex: 「鮮紅」「亮黃」「淡天藍」「灰藍」「深橙」. */
export function colourWord(hex: string): string {
  const { L, C, H } = hexToOklch(hex);
  const base = (HUE_WORDS.find(([limit]) => H < limit) ?? HUE_WORDS[0])[1];
  if (C < 0.012) return L < 0.3 ? "近黑" : L > 0.9 ? "近白" : "灰";
  if (C < 0.05) return `灰${base}`;
  if (L < 0.4) return `深${base}`;
  if (C >= 0.17) return `鮮${base}`;
  if (L >= 0.78 && C < 0.11) return `淡${base}`;
  if (L >= 0.78) return `亮${base}`;
  return base;
}

/** The built palette in colour words: its three colours (primary, accent, highlight), no duplicate word. */
export function paletteWords(entries: readonly PaletteEntry[]): string {
  const words: string[] = [];
  for (const e of [entries[1], entries[2], entries[4]]) {
    if (!e) continue;
    const w = colourWord(e.hex);
    if (!words.includes(w)) words.push(w);
  }
  return words.join("、");
}

// ---------------------------------------------------------------------------
// the palette
// ---------------------------------------------------------------------------

/** Build a song's palette from its family's targets. Entry order as palette.ts: [背景, 主色, 點綴, 歌詞, 高光, 對比背景]. */
export function buildTargetPalette(input: TargetInput): TargetPalette {
  const family = familyFor(input);
  const t = clamp01(input.energy);
  // the relationship: the seed's draw, moved off a primary family the library's last songs wore twice
  const start = (input.seed >>> 6) % family.variants.length;
  const worn = (v: number) => recentUses(input.looks, "palette", hueFamily(hexToHsl(oklchToHex({ L: 0.6, C: 0.15, H: family.variants[v][0] })).h));
  let variant = start;
  for (let k = 0; k < family.variants.length; k++) {
    const v = (start + k) % family.variants.length;
    if (worn(v) < 2) {
      variant = v;
      break;
    }
  }
  const [hp0, ha0, hh0] = family.variants[variant];
  // the seed nudges every hue the same way (±7°), so two songs of one relationship still differ a little
  const jitter = (((input.seed >>> 8) % 15) - 7) as number;
  let rotate = jitter;
  if (input.imageHue != null) {
    const toward = hexToOklch(hsl(input.imageHue, 0.7, 0.5)).H - hp0;
    const diff = ((((toward + 180) % 360) + 360) % 360) - 180;
    // a genre keeps its colours (the image nudges them 12 degrees at most); with no genre the song's own image leads the hue
    rotate += family.byImage ? diff : Math.max(-12, Math.min(12, diff * 0.2));
  }
  if (input.hueOverride != null) rotate = hexToOklch(hsl(input.hueOverride, 0.7, 0.5)).H - hp0;
  const hp = wrap(hp0 + rotate);
  const ha = wrap(ha0 + rotate);
  const hh = wrap(hh0 + rotate);
  const chroma = input.mono ? 0.08 : 1;
  const pick = (r: RoleRange, h: number): Oklch => ({ L: lerp(r.L, t * 0.7 + clamp01(input.brightness) * 0.3), C: lerp(r.C, t) * chroma, H: h });
  const hex = (c: Oklch) => oklchToHex(c);
  const bgHue = family.bg.hue === "pri" ? hp : wrap(family.bg.hue + rotate * 0.5);
  const bg = hex({ L: family.bg.L, C: family.bg.C * (input.mono ? 0.2 : 1), H: bgHue });
  const primary = hex(pick(family.pri, hp));
  const accent = hex(pick(family.acc, ha));
  const highlight = hex(pick(family.hi, hh));
  const bg2 = hex({ L: family.bg.L + 0.03, C: family.bg.C * (input.mono ? 0.2 : 1), H: wrap(ha) });
  const lyric = ensureContrast(hex({ L: 0.96, C: 0.012, H: hp }), bg, []);
  const entries = nameEntries([
    [bg, "背景"],
    [primary, "主色"],
    [accent, "點綴"],
    [lyric, "歌詞"],
    [highlight, "高光"],
    [bg2, "對比背景"],
  ]);
  return { entries, family, variant, words: paletteWords(entries) };
}

/** The chroma ranges' span, for the signature test: [hue of primary, hue of accent, mean chroma of the three colours]. */
export function paletteSignature(entries: readonly PaletteEntry[]): { hp: number; ha: number; chroma: number } {
  const c = [entries[1], entries[2], entries[4]].filter(Boolean).map((e) => hexToOklch(e.hex));
  return { hp: c[0].H, ha: c[1].H, chroma: c.reduce((a, x) => a + x.C, 0) / c.length };
}

/** Two palettes read as different songs: the primary's hue, the accent's hue or the saturation differs visibly. */
export function palettesDistinct(a: readonly PaletteEntry[], b: readonly PaletteEntry[]): boolean {
  const x = paletteSignature(a);
  const y = paletteSignature(b);
  return hueGap(x.hp, y.hp) >= 20 || hueGap(x.ha, y.ha) >= 25 || Math.abs(x.chroma - y.chroma) >= 0.04;
}

/** Does a palette lie in its family's ranges (the test's and the prompts' contract)? Returns the misses. */
export function outOfFamily(entries: readonly PaletteEntry[], family: PaletteFamily): string[] {
  const miss: string[] = [];
  const slack = 0.03;
  const roles: Array<[string, PaletteEntry | undefined, RoleRange]> = [
    ["主色", entries[1], family.pri],
    ["點綴", entries[2], family.acc],
    ["高光", entries[4], family.hi],
  ];
  for (const [name, e, r] of roles) {
    if (!e) continue;
    const c = hexToOklch(e.hex);
    if (c.L < r.L[0] - slack || c.L > r.L[1] + slack) miss.push(`${name}明度 ${c.L.toFixed(2)} 不在 ${r.L.join("–")}`);
    if (c.C < r.C[0] - slack || c.C > r.C[1] + slack) miss.push(`${name}彩度 ${c.C.toFixed(2)} 不在 ${r.C.join("–")}`);
  }
  return miss;
}

/**
 * What the prompts teach Claude about colour (compact: the families' ranges, in OKLCH — L lightness, C chroma,
 * H hue). The same ranges are what the offline designer builds and what the tests hold it to.
 */
export const PALETTE_TEACHING = `配色目標（OKLCH：L 明度、C 彩度、H 色相角；背景 L 0.10–0.20、C ≤ 0.07；主色、點綴、高光三色明度差 ≥ 0.1）：
- 龐克：原色撞色，紅 27°、黃 95°、藍 262°，主色 C 0.19–0.24
- 城市流行：夕陽粉 355°＋霓虹青 205°＋琥珀 75°，主色 L 0.66–0.74、C 0.16–0.21
- 民謠：暖色大地，赭 55°、苔綠 125°、麥黃 85°，C 0.08–0.12
- 艾摩：低彩度冷灰藍 255°（C 0.04）加一個熱點紅 25°（C 0.2）
- 抒情／流行：乾淨粉彩 L 0.72–0.84、C 0.08–0.13（粉 355°、天藍 235°、薰衣草 295°）
- 後搖滾／氛圍：冷鋼灰藍 240°（C 0.06）加一點餘燼橘 50°
- 電子／迷幻：霓虹青 195°、洋紅 330°、紫 295°，C 0.15–0.26
- 獨立搖滾：一冷一暖（青 195°＋琥珀 70°），C 0.09–0.15；金屬：血紅 25°（L 0.5）＋鋼灰
主色是主角，整首歌色相不變；點綴是動的那一個；高光是第三色。不要「深夜X／X光／近白」的套版：字色以外沒有近白，最亮處是同色相的滿值。`;
