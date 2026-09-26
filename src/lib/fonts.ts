// All fonts are loaded once in the root layout via next/font (self-hosted at build
// time, so the projection output works offline at the venue). Components refer to
// fonts by FontId and use fontStack() to get a CSS font-family value.

import {
  Anton,
  Bebas_Neue,
  Cactus_Classical_Serif,
  Chiron_Hei_HK,
  Geist_Mono,
  Huninn,
  Iansui,
  LXGW_WenKai_TC,
  Noto_Sans_TC,
  Noto_Serif_TC,
  Playfair_Display,
  Space_Grotesk,
} from "next/font/google";
import type { FontId } from "./schema";

// CJK fonts are huge; Google serves them in unicode-range slices, so no preload.
const notoSansTC = Noto_Sans_TC({ subsets: ["latin"], variable: "--font-noto-sans-tc", display: "swap", preload: false });
const notoSerifTC = Noto_Serif_TC({ subsets: ["latin"], variable: "--font-noto-serif-tc", display: "swap", preload: false });
const wenkai = LXGW_WenKai_TC({ subsets: ["latin"], weight: ["300", "400", "700"], variable: "--font-lxgw-wenkai-tc", display: "swap", preload: false });
const huninn = Huninn({ subsets: ["latin"], weight: "400", variable: "--font-huninn", display: "swap", preload: false });
const chironHei = Chiron_Hei_HK({ subsets: ["latin"], variable: "--font-chiron-hei-hk", display: "swap", preload: false });
const iansui = Iansui({ subsets: ["latin"], weight: "400", variable: "--font-iansui", display: "swap", preload: false });
const cactus = Cactus_Classical_Serif({ subsets: ["latin"], weight: "400", variable: "--font-cactus-classical-serif", display: "swap", preload: false });
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas-neue", display: "swap" });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair-display", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

/** className string to put on <html> so every font CSS variable is defined. */
export const fontVariables = [
  notoSansTC,
  notoSerifTC,
  wenkai,
  huninn,
  chironHei,
  iansui,
  cactus,
  bebas,
  anton,
  spaceGrotesk,
  playfair,
  geistMono,
]
  .map((f) => f.variable)
  .join(" ");

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
