// Waveform drawing helpers shared by the upload card and the lyrics-editor timeline.

/**
 * Reduce/expand `peaks` (0..1 per bucket over the whole song) to `count` bars covering the
 * fraction range [from, to) of the song. Each bar takes the max of the buckets it covers.
 */
export function resamplePeaks(peaks: readonly number[], count: number, from = 0, to = 1): number[] {
  const n = Math.max(0, Math.floor(count));
  const out = new Array<number>(n).fill(0);
  if (n === 0 || peaks.length === 0 || !(to > from)) return out;
  const len = peaks.length;
  for (let i = 0; i < n; i++) {
    const a = (from + ((to - from) * i) / n) * len;
    const b = (from + ((to - from) * (i + 1)) / n) * len;
    let lo = Math.floor(a);
    let hi = Math.ceil(b);
    if (hi <= lo) hi = lo + 1;
    lo = Math.max(0, lo);
    hi = Math.min(len, hi);
    let m = 0;
    for (let k = lo; k < hi; k++) {
      const v = peaks[k];
      if (Number.isFinite(v) && v > m) m = v;
    }
    out[i] = Math.min(1, m);
  }
  return out;
}

export interface DrawWaveformOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** fraction range of the song to draw */
  from?: number;
  to?: number;
  /** bar width + gap in CSS pixels (already scaled by the caller's transform) */
  bar?: number;
  gap?: number;
  /** minimum visible bar height in px */
  minHeight?: number;
}

/** Mirrored bar waveform centred vertically in the box. */
export function drawWaveform(ctx: CanvasRenderingContext2D, peaks: readonly number[], opts: DrawWaveformOptions): void {
  const bar = opts.bar ?? 2;
  const gap = opts.gap ?? 1;
  const step = bar + gap;
  const count = Math.max(1, Math.floor(opts.width / step));
  const values = resamplePeaks(peaks, count, opts.from ?? 0, opts.to ?? 1);
  const mid = opts.y + opts.height / 2;
  const minH = opts.minHeight ?? 1;
  ctx.fillStyle = opts.color;
  for (let i = 0; i < count; i++) {
    // perceptual boost so quiet passages stay visible
    const v = Math.sqrt(values[i]);
    const h = Math.max(minH, v * opts.height);
    ctx.fillRect(opts.x + i * step, mid - h / 2, bar, h);
  }
}

/** Size a canvas to its CSS box at the device pixel ratio; returns the CSS size. */
export function fitCanvas(canvas: HTMLCanvasElement): { width: number; height: number; dpr: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return { width: rect.width, height: rect.height, dpr };
}
