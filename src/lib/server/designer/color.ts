// Color math for the designer: hex parsing, HSL, WCAG contrast and palette helpers.
// Pure and deterministic (used by normalizePlan and the offline designer).

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parse #rgb, #rgba, #rrggbb or #rrggbbaa (with or without "#"); alpha is dropped. */
export function parseHex(input: unknown): Rgb | null {
  if (typeof input !== "string") return null;
  const m = HEX_RE.exec(input.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).replace(/./g, (c) => c + c);
  h = h.slice(0, 6);
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function channel(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, "0");
}

export function toHex(c: Rgb): string {
  return `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
}

/** Canonical lowercase #rrggbb, or null when the input is not a hex color. */
export function normalizeHex(input: unknown): string | null {
  const c = parseHex(input);
  return c ? toHex(c) : null;
}

/** WCAG 2.x relative luminance, 0..1. */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Hsl {
  /** degrees 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  l: number;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  if (ss === 0) return { r: ll * 255, g: ll * 255, b: ll * 255 };
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hue = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: hue(hh + 1 / 3) * 255, g: hue(hh) * 255, b: hue(hh - 1 / 3) * 255 };
}

/** Hex from HSL (h in degrees, s/l 0..1). */
export function hsl(h: number, s: number, l: number): string {
  return toHex(hslToRgb({ h, s, l }));
}

export function hexToHsl(hex: string): Hsl {
  const c = parseHex(hex);
  return c ? rgbToHsl(c) : { h: 0, s: 0, l: 0 };
}

export const WHITE = "#ffffff";
export const NEAR_BLACK = "#0a0a0f";
export const BLACK = "#000000";
export const MIN_LYRIC_CONTRAST = 4.5;

/**
 * A lyric color that reaches `min` contrast against `bg`. Keeps `preferred` when it
 * passes; otherwise the palette color with the highest contrast that passes; otherwise
 * white / near-black (pure black as the last resort for mid-grey backgrounds).
 */
export function ensureContrast(preferred: string | null, bg: string, palette: readonly string[], min = MIN_LYRIC_CONTRAST): string {
  if (preferred && contrastRatio(preferred, bg) >= min) return preferred;
  let best: string | null = null;
  let bestRatio = 0;
  for (const c of palette) {
    const r = contrastRatio(c, bg);
    if (r >= min && r > bestRatio) {
      best = c;
      bestRatio = r;
    }
  }
  if (best) return best;
  const neutral = contrastRatio(WHITE, bg) >= contrastRatio(NEAR_BLACK, bg) ? WHITE : NEAR_BLACK;
  if (contrastRatio(neutral, bg) >= min) return neutral;
  return contrastRatio(WHITE, bg) >= contrastRatio(BLACK, bg) ? WHITE : BLACK;
}

/** Angular distance between two hues, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

const HUE_NAMES: Array<[number, string]> = [
  [12, "緋"],
  [32, "橙"],
  [48, "琥珀"],
  [66, "金"],
  [95, "萊姆"],
  [150, "翡翠"],
  [185, "青"],
  [215, "湛藍"],
  [245, "靛"],
  [275, "堇"],
  [305, "紫"],
  [335, "洋紅"],
  [360, "緋"],
];

/** Short Traditional-Chinese poetic name for a color (e.g. 「深夜靛」「微光金」). */
export function colorName(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.12) {
    if (l < 0.12) return "墨黑";
    if (l < 0.35) return "炭灰";
    if (l < 0.7) return "霧灰";
    if (l < 0.92) return "銀白";
    return "月白";
  }
  const base = HUE_NAMES.find(([limit]) => h < limit)?.[1] ?? "緋";
  if (l < 0.16) return `深夜${base}`;
  if (l < 0.32) return `暗${base}`;
  if (l < 0.62) return base.length === 1 ? `${base}光` : base;
  if (l < 0.85) return `微光${base}`;
  return `${base}白`;
}
