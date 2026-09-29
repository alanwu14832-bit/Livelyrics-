// Pure geometry for the console timeline: visible window, zoom, time <-> x, ruler ticks.

export interface TimeView {
  /** seconds at the left edge */
  start: number;
  /** visible seconds */
  span: number;
}

export const ZOOM_LEVELS = [1, 2, 4, 8, 16] as const;
/** never zoom in further than this many seconds across the whole width */
export const MIN_SPAN = 4;

export function fullView(duration: number): TimeView {
  return { start: 0, span: Math.max(duration, 1) };
}

/** Clamp a view inside [0, duration] with a sane span. */
export function clampView(view: TimeView, duration: number): TimeView {
  const total = Math.max(duration, 1);
  const span = Math.min(total, Math.max(Math.min(MIN_SPAN, total), Number.isFinite(view.span) ? view.span : total));
  const start = Math.min(Math.max(0, Number.isFinite(view.start) ? view.start : 0), total - span);
  return { start, span };
}

export function timeToX(t: number, view: TimeView, width: number): number {
  return ((t - view.start) / view.span) * width;
}

export function xToTime(x: number, view: TimeView, width: number): number {
  if (width <= 0) return view.start;
  return view.start + (x / width) * view.span;
}

/** Zoom by `factor` (>1 = in) keeping `anchor` (seconds) under the same x. */
export function zoomAround(view: TimeView, factor: number, anchor: number, duration: number): TimeView {
  if (!(factor > 0)) return clampView(view, duration);
  const span = view.span / factor;
  const rel = view.span > 0 ? (anchor - view.start) / view.span : 0.5;
  return clampView({ start: anchor - rel * span, span }, duration);
}

/** View for zoom level `zoom` (1 = whole song) centered near `center`. */
export function viewForZoom(zoom: number, center: number, duration: number): TimeView {
  const total = Math.max(duration, 1);
  const span = total / Math.max(1, zoom);
  return clampView({ start: center - span / 2, span }, duration);
}

/**
 * Keep the playhead visible while playing: when it runs past 85 % of the view (or is
 * outside it) the view pages so the playhead sits at 15 %.
 */
export function followPlayhead(view: TimeView, t: number, duration: number): TimeView {
  if (view.span >= Math.max(duration, 1) - 1e-6) return view;
  const rel = (t - view.start) / view.span;
  if (rel >= 0 && rel <= 0.85) return view;
  return clampView({ start: t - view.span * 0.15, span: view.span }, duration);
}

/** Largest start (seconds) that keeps a `span` view inside the song. */
export function maxStart(span: number, duration: number): number {
  return Math.max(0, Math.max(duration, 1) - span);
}

/** Visible seconds for a (continuous) zoom factor: 1 = whole song, never below MIN_SPAN. */
export function spanForZoom(zoom: number, duration: number): number {
  const total = Math.max(duration, 1);
  return Math.min(total, Math.max(Math.min(MIN_SPAN, total), total / Math.max(1, zoom)));
}

/** Zoom factor shown for a span (1 = whole song). */
export function zoomOf(span: number, duration: number): number {
  return Math.max(1, Math.max(duration, 1) / Math.max(1e-6, span));
}

/** The next preset zoom level above (+1) or below (−1) a continuous zoom factor. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const eps = 1e-3;
  if (dir > 0) return ZOOM_LEVELS.find((z) => z > zoom + eps) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  return [...ZOOM_LEVELS].reverse().find((z) => z < zoom - eps) ?? ZOOM_LEVELS[0];
}

/**
 * Continuous follow while playing (UI-35): the view start that keeps the playhead at `anchor`
 * (35 %) of a zoomed view, clamped to the song so the ends do not scroll past.
 */
export function followStart(t: number, span: number, duration: number, anchor = 0.35): number {
  return Math.min(maxStart(span, duration), Math.max(0, t - span * anchor));
}

const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

/** Ruler step (seconds) so labels are at least `minPx` apart. */
export function tickStep(view: TimeView, width: number, minPx = 64): number {
  const pxPerSec = width / Math.max(view.span, 1e-3);
  for (const step of TICK_STEPS) if (step * pxPerSec >= minPx) return step;
  return TICK_STEPS[TICK_STEPS.length - 1];
}

/** Tick times inside the view for a given step. */
export function ticks(view: TimeView, step: number): number[] {
  const out: number[] = [];
  if (!(step > 0)) return out;
  const first = Math.ceil(view.start / step - 1e-9) * step;
  for (let t = first; t <= view.start + view.span + 1e-9 && out.length < 1000; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

/** Label for a ruler tick: m:ss, or m:ss.s for sub-second steps. */
export function tickLabel(t: number, step: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (step < 1) return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  return `${m}:${String(Math.floor(s + 1e-6)).padStart(2, "0")}`;
}

/** Downsample waveform peaks to one value per pixel column in the view (max of the covered buckets). */
export function peaksForView(peaks: readonly number[], duration: number, view: TimeView, columns: number): Float32Array {
  const out = new Float32Array(Math.max(0, Math.floor(columns)));
  if (peaks.length === 0 || duration <= 0 || out.length === 0) return out;
  const perSec = peaks.length / duration;
  for (let c = 0; c < out.length; c++) {
    const t0 = view.start + (c / out.length) * view.span;
    const t1 = view.start + ((c + 1) / out.length) * view.span;
    let i0 = Math.floor(t0 * perSec);
    let i1 = Math.max(i0 + 1, Math.ceil(t1 * perSec));
    i0 = Math.max(0, i0);
    i1 = Math.min(peaks.length, i1);
    let m = 0;
    for (let i = i0; i < i1; i++) {
      const v = peaks[i];
      if (v > m) m = v;
    }
    out[c] = m;
  }
  return out;
}
