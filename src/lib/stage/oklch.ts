// OKLCH (Björn Ottosson's OKLab) for the palette targets of round 28: the designer reasons about a
// song's colour as lightness / chroma / hue (equal steps look equal), then converts to sRGB hex with
// the chroma reduced until the colour is inside the sRGB gamut. Pure; shared by the designer, the
// probe's subject-colour measure and the tests.

import { parseHex, toHex, type RGB } from "./color";

export interface Oklch {
  /** 0..1 */
  L: number;
  /** 0..~0.4 */
  C: number;
  /** degrees 0..360 */
  H: number;
}

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** sRGB (0..1 floats, as stage/color.ts) → OKLCH. */
export function rgbToOklch([r, g, b]: RGB): Oklch {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  return { L, C, H: C < 1e-4 ? 0 : ((((Math.atan2(bb, a) * 180) / Math.PI) % 360) + 360) % 360 };
}

export function hexToOklch(hex: string): Oklch {
  return rgbToOklch(parseHex(hex));
}

function oklchToLinear({ L, C, H }: Oklch): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (c: [number, number, number]) => c.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH → sRGB hex; the chroma is reduced (lightness and hue kept) until the colour fits the sRGB gamut. */
export function oklchToHex(c: Oklch): string {
  const L = Math.max(0, Math.min(1, c.L));
  let lo = 0;
  let hi = Math.max(0, c.C);
  let rgb = oklchToLinear({ L, C: hi, H: c.H });
  if (!inGamut(rgb)) {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ L, C: mid, H: c.H }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear({ L, C: lo, H: c.H });
  }
  return toHex(rgb.map((v) => gam(Math.max(0, Math.min(1, v)))) as RGB);
}

/** Smallest angle between two hues, 0..180. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** 「L 0.62 · C 0.19 · H 264」 for tables and notes. */
export function oklchLabel(c: Oklch): string {
  return `L ${c.L.toFixed(2)} · C ${c.C.toFixed(2)} · H ${Math.round(c.H)}`;
}
