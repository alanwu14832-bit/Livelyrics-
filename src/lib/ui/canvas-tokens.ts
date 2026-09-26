// Design tokens for <canvas> drawing. A canvas cannot use var(), so timelines and
// waveforms read the CSS custom properties from their own element (never from
// document.documentElement: the console is a dark island inside a light page) and
// re-read them when the appearance changes.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function channel(s: string): number {
  const t = s.trim();
  if (t.endsWith("%")) return Math.round(clamp01(parseFloat(t) / 100) * 255);
  return Math.round(Math.min(255, Math.max(0, parseFloat(t))));
}

function alphaPart(s: string | undefined): number {
  if (s == null || s.trim() === "") return 1;
  const t = s.trim();
  return clamp01(t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t));
}

/** Parse the colour forms the tokens use: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax). */
export function parseCssColor(input: string | null | undefined): Rgba | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = h.split("").map((c) => parseInt(c + c, 16));
      return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
    }
    return null;
  }
  const m = /^rgba?\((.*)\)$/.exec(s);
  if (!m) return null;
  const body = m[1].trim();
  let parts: string[];
  let alpha: string | undefined;
  if (body.includes(",")) {
    parts = body.split(",");
    if (parts.length === 4) alpha = parts.pop();
  } else {
    const [rgb, a] = body.split("/");
    parts = rgb.trim().split(/\s+/);
    alpha = a;
  }
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(parseFloat(p)))) return null;
  const a = alphaPart(alpha);
  if (!Number.isFinite(a)) return null;
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a };
}

export function rgbaString(c: Rgba): string {
  return `rgba(${c.r},${c.g},${c.b},${Math.round(c.a * 1000) / 1000})`;
}

/**
 * The colour with its alpha multiplied by `alpha` (so an already translucent token such as
 * --separator stays proportionally translucent). Unparseable input falls back to white.
 */
export function tokenAlpha(color: string, alpha: number): string {
  const c = parseCssColor(color) ?? { r: 255, g: 255, b: 255, a: 1 };
  return rgbaString({ ...c, a: clamp01(c.a * alpha) });
}

/**
 * Read custom properties from `el` (inherited from the nearest [data-theme] scope).
 * `spec` maps a key to [custom property, fallback].
 */
export function readTokens<K extends string>(el: Element, spec: Record<K, readonly [string, string]>): Record<K, string> {
  let cs: CSSStyleDeclaration | null = null;
  try {
    cs = getComputedStyle(el);
  } catch {
    cs = null;
  }
  const out = {} as Record<K, string>;
  for (const key of Object.keys(spec) as K[]) {
    const [name, fallback] = spec[key];
    out[key] = cs?.getPropertyValue(name).trim() || fallback;
  }
  return out;
}

/**
 * Call `cb` whenever the resolved tokens may have changed: system appearance or contrast
 * changes, or a data-theme attribute changes anywhere in the document. Returns an unsubscribe.
 */
export function subscribeAppearance(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const queries = ["(prefers-color-scheme: dark)", "(prefers-contrast: more)"]
    .map((q) => {
      try {
        return window.matchMedia(q);
      } catch {
        return null;
      }
    })
    .filter((q): q is MediaQueryList => q != null);
  for (const q of queries) q.addEventListener("change", cb);
  let mo: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined") {
    mo = new MutationObserver(cb);
    mo.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["data-theme"] });
  }
  return () => {
    for (const q of queries) q.removeEventListener("change", cb);
    mo?.disconnect();
  };
}
