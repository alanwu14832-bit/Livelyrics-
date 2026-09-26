// Small, dependency-free color helpers for the stage renderer (sRGB hex in, 0..1 floats out).

export type RGB = [number, number, number];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse #rgb / #rrggbb into 0..1 floats. Invalid input returns `fallback`. */
export function parseHex(hex: string | null | undefined, fallback: RGB = [0, 0, 0]): RGB {
  if (typeof hex !== "string") return [...fallback];
  const m = HEX_RE.exec(hex.trim());
  if (!m) return [...fallback];
  let body = m[1];
  if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  const n = parseInt(body, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** True for CSS-usable hex colors (#rgb / #rrggbb, leading # required). */
export function isHex(hex: unknown): hex is string {
  return typeof hex === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);

export function toHex(rgb: RGB): string {
  return (
    "#" +
    rgb
      .map((c) =>
        Math.round(clamp01(c) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function mixHex(a: string, b: string, t: number): string {
  return toHex(mixRgb(parseHex(a), parseHex(b), t));
}

/** CSS rgba() string from a hex color. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${Math.round(clamp01(alpha) * 1000) / 1000})`;
}

function channelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(rgb: RGB): number {
  return 0.2126 * channelToLinear(rgb[0]) + 0.7152 * channelToLinear(rgb[1]) + 0.0722 * channelToLinear(rgb[2]);
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: RGB | string, b: RGB | string): number {
  const la = relativeLuminance(typeof a === "string" ? parseHex(a) : a);
  const lb = relativeLuminance(typeof b === "string" ? parseHex(b) : b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Return `fg` nudged toward white (or black, for light backgrounds) until it reaches
 * `minRatio` contrast against `bg`. Keeps the hue as long as possible.
 */
export function ensureContrast(fg: string, bg: string, minRatio = 4.5): string {
  const f = parseHex(fg, [1, 1, 1]);
  const b = parseHex(bg);
  if (contrastRatio(f, b) >= minRatio) return toHex(f);
  const target: RGB = relativeLuminance(b) > 0.4 ? [0, 0, 0] : [1, 1, 1];
  // binary search the smallest mix amount that satisfies the ratio
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixRgb(f, target, mid), b) >= minRatio) hi = mid;
    else lo = mid;
  }
  // 8-bit rounding can land just below the target; step until it holds
  let amount = hi;
  let out = toHex(mixRgb(f, target, amount));
  while (contrastRatio(out, b) < minRatio && amount < 1) {
    amount = Math.min(1, amount + 1 / 255);
    out = toHex(mixRgb(f, target, amount));
  }
  return out;
}

/** Perceived lightness proxy (0..1), handy for choosing overlay tints. */
export function lightness(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

/** Scale a color's brightness (keeps hue). */
export function shade(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex([r * factor, g * factor, b * factor]);
}
