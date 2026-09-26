// Key-visual motif -> texture source.
// The plan's motifSvg (currentColor, viewBox 0 0 100 100) is rasterized in white on
// transparent via an <img> from a data: URL (an <img> never runs scripts or loads
// external resources). The shader tints it with the colorway (primary core, accent
// glow). If anything fails we draw a generated emblem so the "motif" scene always works.

export const MOTIF_SIZE = 512;

/** Normalize the SVG for standalone rasterization. Returns null when it isn't an SVG. */
export function prepareMotifSvg(svg: string | null | undefined, color = "#ffffff", size = MOTIF_SIZE): string | null {
  if (typeof svg !== "string") return null;
  let s = svg.trim().replace(/^<\?xml[^>]*\?>\s*/i, "");
  const open = /^<svg\b([^>]*)>/i.exec(s);
  if (!open || !/<\/svg>\s*$/i.test(s)) return null;
  let attrs = open[1].replace(/\/$/, "");
  attrs = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  if (!/\sxmlns\s*=/.test(attrs)) attrs += ' xmlns="http://www.w3.org/2000/svg"';
  if (!/\sviewBox\s*=/i.test(attrs)) attrs += ' viewBox="0 0 100 100"';
  attrs += ` width="${size}" height="${size}" color="${color}"`;
  s = `<svg${attrs}>` + s.slice(open[0].length);
  s = s.replace(/currentColor/gi, color);
  return s;
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Small stable 32-bit hash for seeding the generated emblem. */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

/** Generated emblem: concentric rings + a star polygon, deterministic from `seed`. */
export function drawFallbackEmblem(ctx: CanvasRenderingContext2D, size: number, seed: string) {
  const h = hashString(seed || "livelyrics");
  const points = 5 + (h % 4);
  const inner = 0.38 + ((h >> 3) % 20) / 100;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.4;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineJoin = "round";

  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.008;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.86, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 === 0 ? 1 : inner) * R * 0.74;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

export function fallbackMotifCanvas(seed: string, size = MOTIF_SIZE): HTMLCanvasElement {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");
  if (ctx) drawFallbackEmblem(ctx, size, seed);
  return canvas;
}

function loadImage(url: string, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("decode"));
    };
    img.decoding = "async";
    img.src = url;
  });
}

/**
 * Rasterize the plan motif (white on transparent, square, with padding).
 * Never rejects: resolves with the generated emblem on any failure.
 */
export async function rasterizeMotif(svg: string | null | undefined, seed: string, size = MOTIF_SIZE): Promise<{ canvas: HTMLCanvasElement; fallback: boolean }> {
  const prepared = prepareMotifSvg(svg, "#ffffff", size);
  if (!prepared) return { canvas: fallbackMotifCanvas(seed, size), fallback: true };
  try {
    const img = await loadImage(svgToDataUrl(prepared), 4000);
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const pad = size * 0.06;
    ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
    // an SVG that renders nothing visible would leave the scene empty
    const data = ctx.getImageData(0, 0, size, size).data;
    let covered = 0;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 24) covered++;
    if (covered < 3) throw new Error("empty");
    return { canvas, fallback: false };
  } catch {
    return { canvas: fallbackMotifCanvas(seed, size), fallback: true };
  }
}
