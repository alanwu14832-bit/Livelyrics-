// Small numeric helpers shared by the analysis stages. All pure and allocation-light.

export type NumArray = ArrayLike<number>;

export function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Round to `digits` decimals; non-finite values become 0. */
export function round(x: number, digits: number): number {
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** q-quantile (0..1) with linear interpolation. Ignores non-finite values; NaN for empty input. */
export function quantile(values: NumArray, q: number): number {
  const sorted: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) sorted.push(v);
  }
  if (sorted.length === 0) return NaN;
  sorted.sort((a, b) => a - b);
  const pos = clamp(q, 0, 1) * (sorted.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

export function median(values: NumArray): number {
  return quantile(values, 0.5);
}

export function mean(values: NumArray, from = 0, to = values.length): number {
  const a = Math.max(0, from);
  const b = Math.min(values.length, to);
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += values[i];
  return s / (b - a);
}

export function std(values: NumArray): number {
  const n = values.length;
  if (n === 0) return 0;
  const m = mean(values);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / n);
}

/** Centered moving average with a (2·half + 1)-sample window, shrinking at the edges. */
export function movingAverage(values: NumArray, half: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  const h = Math.max(0, Math.floor(half));
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h);
    const b = Math.min(n, i + h + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

/** Gaussian smoothing (σ in samples), edge-normalized so the ends are not pulled towards 0. */
export function gaussianSmooth(values: NumArray, sigma: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (!(sigma > 0)) {
    for (let i = 0; i < n; i++) out[i] = values[i];
    return out;
  }
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(2 * radius + 1);
  for (let k = -radius; k <= radius; k++) kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
  for (let i = 0; i < n; i++) {
    let s = 0;
    let w = 0;
    const a = Math.max(0, i - radius);
    const b = Math.min(n - 1, i + radius);
    for (let j = a; j <= b; j++) {
      const kw = kernel[j - i + radius];
      s += values[j] * kw;
      w += kw;
    }
    out[i] = s / w;
  }
  return out;
}

/** Linear interpolation of a regularly sampled series at fractional index x (clamped at the ends). */
export function sampleAt(values: NumArray, x: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (x <= 0) return values[0];
  if (x >= n - 1) return values[n - 1];
  const i = Math.floor(x);
  const f = x - i;
  return values[i] * (1 - f) + values[i + 1] * f;
}

/** Robust scaling of `values` into 0..1 between the given low/high reference levels. */
export function normalizeBetween(values: NumArray, lo: number, hi: number): Float64Array {
  const out = new Float64Array(values.length);
  const range = hi - lo;
  if (!(range > 1e-12)) return out;
  for (let i = 0; i < values.length; i++) out[i] = clamp01((values[i] - lo) / range);
  return out;
}

/**
 * Normalize a level series expressed in dB: the 97th percentile maps to 1 and 0 sits 6 dB under
 * the 5th percentile (so quiet passages keep a little level), with the span kept between 18 and
 * 45 dB so a heavily compressed master is not stretched into noise and silence does not flatten
 * the rest.
 */
export function normalizeDb(db: NumArray, minRange = 18, maxRange = 45): Float64Array {
  const hi = quantile(db, 0.97);
  if (!Number.isFinite(hi)) return new Float64Array(db.length);
  const lo = clamp(quantile(db, 0.05) - 6, hi - maxRange, hi - minRange);
  return normalizeBetween(db, lo, hi);
}

/** Cosine similarity of two equally long vectors (0 when either is all zeros). */
export function cosine(a: NumArray, b: NumArray): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}
