// Small display helpers for the console (numbers, colors, motif preview).

/** "+0.25 s" / "−0.10 s" / "±0.00 s" */
export function formatOffset(offset: number): string {
  const v = Number.isFinite(offset) ? Math.round(offset * 100) / 100 : 0;
  if (v === 0) return "±0.00 s";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} s`;
}

/** The offset for the HUD and status capsules: "+0.15 秒" / "−0.10 秒" / "0.00 秒". */
export function formatOffsetSeconds(offset: number): string {
  const v = Number.isFinite(offset) ? Math.round(offset * 100) / 100 : 0;
  if (v === 0) return "0.00 秒";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} 秒`;
}

/** Countdown to a cue: "12.3 秒後", "現在", "3 分 05 秒後" ("" when unknown). */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  if (seconds <= 0.05) return "現在";
  if (seconds < 60) return `${seconds.toFixed(1)} 秒後`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m} 分 ${String(s).padStart(2, "0")} 秒後`;
}

/** "120" / "92.4"; "" when there is no tempo (the caller says so in words, never a dash). */
export function formatBpm(bpm: number | null | undefined): string {
  return typeof bpm === "number" && Number.isFinite(bpm) && bpm > 0 ? bpm.toFixed(bpm >= 100 ? 0 : 1) : "";
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(x: unknown): x is string {
  return typeof x === "string" && HEX.test(x.trim());
}

function toRgb(hex: string): [number, number, number] {
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance of a hex color (0 for invalid input). */
export function luminance(hex: string): number {
  if (!isHexColor(hex)) return 0;
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Near-black or near-white text, whichever reads better on `bg`. */
export function readableTextOn(bg: string): string {
  if (!isHexColor(bg)) return "#ffffff";
  return contrast("#0b0c10", bg) >= contrast("#ffffff", bg) ? "#0b0c10" : "#ffffff";
}

/** `#rrggbb` + alpha → rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  if (!isHexColor(hex)) return `rgba(255,255,255,${alpha})`;
  const [r, g, b] = toRgb(hex);
  return `rgba(${r},${g},${b},${Math.min(1, Math.max(0, alpha))})`;
}

/**
 * The plan's motif SVG as a data: URL for an <img>. An <img> never executes scripts or
 * fetches external resources, so even an unsanitized SVG is inert there. Returns null
 * when the string is not an SVG document.
 */
export function motifDataUrl(svg: string | null | undefined, color: string): string | null {
  if (typeof svg !== "string") return null;
  let s = svg.trim().replace(/^<\?xml[^>]*\?>\s*/i, "");
  const open = /^<svg\b([^>]*)>/i.exec(s);
  if (!open || !/<\/svg>\s*$/i.test(s)) return null;
  let attrs = open[1].replace(/\/\s*$/, "");
  if (!/\sxmlns\s*=/.test(attrs)) attrs += ' xmlns="http://www.w3.org/2000/svg"';
  if (!/\sviewBox\s*=/i.test(attrs)) attrs += ' viewBox="0 0 100 100"';
  const fill = isHexColor(color) ? color : "#ffffff";
  s = `<svg${attrs} color="${fill}">${s.slice(open[0].length)}`.replace(/currentColor/gi, fill);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

/** Host part of a URL for compact source lists ("" when unparsable). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
