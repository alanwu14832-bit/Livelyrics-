// All fonts are loaded once in the root layout via next/font (self-hosted at build
// time, so the projection output works offline at the venue). Components refer to
// fonts by FontId and use fontStack() to get a CSS font-family value. The registry
// itself lives in ./font-meta (no next/font import) so server code can use it too.

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

// Nothing is preloaded: CJK fonts are huge (Google serves them in unicode-range slices),
// and the Latin display fonts only appear on some pages, so a preload would just warn
// "preloaded but not used" everywhere else. Everything is served from localhost anyway,
// and the stage re-measures lyrics when a font finishes loading.
// Huninn, Chiron Hei HK and Iansui have no fallback metrics in next/font, so their
// size-adjusted fallback is disabled (it would only log a build error).
const notoSansTC = Noto_Sans_TC({ subsets: ["latin"], variable: "--font-noto-sans-tc", display: "swap", preload: false });
const notoSerifTC = Noto_Serif_TC({ subsets: ["latin"], variable: "--font-noto-serif-tc", display: "swap", preload: false });
const wenkai = LXGW_WenKai_TC({ subsets: ["latin"], weight: ["300", "400", "700"], variable: "--font-lxgw-wenkai-tc", display: "swap", preload: false });
const huninn = Huninn({ subsets: ["latin"], weight: "400", variable: "--font-huninn", display: "swap", preload: false, adjustFontFallback: false });
const chironHei = Chiron_Hei_HK({ subsets: ["latin"], variable: "--font-chiron-hei-hk", display: "swap", preload: false, adjustFontFallback: false });
const iansui = Iansui({ subsets: ["latin"], weight: "400", variable: "--font-iansui", display: "swap", preload: false, adjustFontFallback: false });
const cactus = Cactus_Classical_Serif({ subsets: ["latin"], weight: "400", variable: "--font-cactus-classical-serif", display: "swap", preload: false });
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas-neue", display: "swap", preload: false });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap", preload: false });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap", preload: false });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair-display", display: "swap", preload: false });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap", preload: false });

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

export { FONTS, fontStack, type FontInfo } from "./font-meta";
