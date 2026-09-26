// Font registry metadata, kept free of next/font so it can be imported from server
// code (designer), unit tests and the browser alike. src/lib/fonts.ts loads the actual
// font files and re-exports everything here.

import type { FontId } from "./schema";

export interface FontInfo {
  id: FontId;
  /** 中文顯示名 */
  label: string;
  cssVar: string;
  cjk: boolean;
  generic: "sans-serif" | "serif" | "cursive";
}

export const FONTS: Record<FontId, FontInfo> = {
  "noto-sans-tc": { id: "noto-sans-tc", label: "思源黑體", cssVar: "--font-noto-sans-tc", cjk: true, generic: "sans-serif" },
  "noto-serif-tc": { id: "noto-serif-tc", label: "思源宋體", cssVar: "--font-noto-serif-tc", cjk: true, generic: "serif" },
  "lxgw-wenkai-tc": { id: "lxgw-wenkai-tc", label: "霞鶩文楷", cssVar: "--font-lxgw-wenkai-tc", cjk: true, generic: "serif" },
  huninn: { id: "huninn", label: "粉圓", cssVar: "--font-huninn", cjk: true, generic: "sans-serif" },
  "chiron-hei-hk": { id: "chiron-hei-hk", label: "昭源黑體", cssVar: "--font-chiron-hei-hk", cjk: true, generic: "sans-serif" },
  iansui: { id: "iansui", label: "芫荽", cssVar: "--font-iansui", cjk: true, generic: "cursive" },
  "cactus-classical-serif": { id: "cactus-classical-serif", label: "仙人掌明體", cssVar: "--font-cactus-classical-serif", cjk: true, generic: "serif" },
  "bebas-neue": { id: "bebas-neue", label: "Bebas Neue", cssVar: "--font-bebas-neue", cjk: false, generic: "sans-serif" },
  anton: { id: "anton", label: "Anton", cssVar: "--font-anton", cjk: false, generic: "sans-serif" },
  "space-grotesk": { id: "space-grotesk", label: "Space Grotesk", cssVar: "--font-space-grotesk", cjk: false, generic: "sans-serif" },
  "playfair-display": { id: "playfair-display", label: "Playfair Display", cssVar: "--font-playfair-display", cjk: false, generic: "serif" },
};

/**
 * CSS font-family for lyric text: Latin font first (it has no CJK glyphs, so the
 * browser falls through to the CJK font for Chinese characters), then CJK font.
 */
export function fontStack(cjkFont: FontId, latinFont?: FontId): string {
  const cjk = FONTS[cjkFont] ?? FONTS["noto-sans-tc"];
  const parts: string[] = [];
  if (latinFont && FONTS[latinFont] && !FONTS[latinFont].cjk) parts.push(`var(${FONTS[latinFont].cssVar})`);
  parts.push(`var(${cjk.cssVar})`);
  if (!cjk.cjk) parts.push(`var(${FONTS["noto-sans-tc"].cssVar})`);
  parts.push(cjk.generic);
  return parts.join(", ");
}
