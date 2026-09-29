// Harmonious palette generation (HSL schemes) with strong lyric contrast.

import type { KeyVisual } from "@/lib/types";
import { colorName, contrastRatio, ensureContrast, hsl, luminance, MIN_LYRIC_CONTRAST } from "./color";

export type PaletteEntry = KeyVisual["palette"][number];
export type Scheme = "analogous" | "complementary" | "split" | "triadic";
export const SCHEMES: readonly Scheme[] = ["analogous", "complementary", "split", "triadic"];

export interface PaletteSpec {
  /** base hue in degrees */
  hue: number;
  scheme: Scheme;
  /** 0..1 overall saturation (0 = monochrome) */
  saturation: number;
  /** 0..1, brighter songs get lighter accents */
  brightness: number;
  /** accent and highlight hues instead of the scheme's (a genre's colours with a lyric image) */
  hues?: [number, number];
}

function schemeHues(h: number, scheme: Scheme): [number, number] {
  switch (scheme) {
    case "analogous":
      return [h + 38, h - 32];
    case "complementary":
      return [h + 180, h + 155];
    case "split":
      return [h + 150, h + 210];
    case "triadic":
      return [h + 120, h + 240];
  }
}

/**
 * Six colors in a fixed role order:
 * [背景, 主色, 點綴, 歌詞, 高光, 對比背景]. palette[1] (主色) is the library accent.
 */
export function buildPalette(spec: PaletteSpec): PaletteEntry[] {
  const h = ((spec.hue % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, spec.saturation));
  const lift = Math.max(0, Math.min(1, spec.brightness));
  const [ha, hb] = spec.hues ?? schemeHues(h, spec.scheme);
  const bg = hsl(h, 0.5 * sat, 0.055);
  const primary = hsl(h, 0.72 * sat, 0.48 + 0.08 * lift);
  const accent = hsl(ha, 0.88 * sat, 0.56 + 0.06 * lift);
  const lyric = hsl(h, 0.4 * sat, 0.95);
  const highlight = hsl(hb, 0.92 * sat, 0.7 + 0.06 * lift);
  const bg2 = hsl(hb, 0.45 * sat, 0.075);
  const entries: Array<[string, string]> = [
    [bg, "背景"],
    [primary, "主色"],
    [accent, "點綴"],
    [ensureContrast(lyric, bg, []), "歌詞"],
    [highlight, "高光"],
    [bg2, "對比背景"],
  ];
  const seen = new Set<string>();
  const out: PaletteEntry[] = [];
  for (const [hex, role] of entries) {
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push({ hex, role, name: colorName(hex) });
  }
  return out;
}

/** Index of the darkest color. */
export function darkestIndex(hexes: readonly string[]): number {
  let best = 0;
  let bestL = Infinity;
  hexes.forEach((h, i) => {
    const l = luminance(h);
    if (l < bestL) {
      bestL = l;
      best = i;
    }
  });
  return best;
}

/** true when some palette color can carry lyrics over `bg`. */
export function hasLyricColor(hexes: readonly string[], bg: string): boolean {
  return hexes.some((h) => contrastRatio(h, bg) >= MIN_LYRIC_CONTRAST);
}
