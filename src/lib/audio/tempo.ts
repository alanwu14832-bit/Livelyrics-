// Tempo estimation (autocorrelation + harmonic comb with an octave-aware prior) and
// dynamic-programming beat tracking (Ellis 2007) over an onset-strength envelope.

import { clamp, clamp01, gaussianSmooth, mean, median, movingAverage, sampleAt, std } from "./stats";

export const MIN_BPM = 70;
export const MAX_BPM = 180;

export interface TempoEstimate {
  /** 0 when the signal has no rhythmic content at all */
  bpm: number;
  /** 0..1 */
  confidence: number;
}

/**
 * Onset strength for tempo/beat tracking: flux minus its 1-second local mean, half-wave
 * rectified and scaled to unit standard deviation (all zeros for silence).
 */
export function onsetStrength(flux: ArrayLike<number>, frameRate: number): Float64Array {
  const n = flux.length;
  const local = movingAverage(flux, Math.round(0.5 * frameRate));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, flux[i] - local[i]);
  const s = std(out);
  if (s > 1e-9) for (let i = 0; i < n; i++) out[i] /= s;
  else out.fill(0);
  return out;
}

/** Normalized autocorrelation r(τ)/r(0) of the mean-removed signal for τ = 0..maxLag (unbiased). */
export function autocorrelation(x: ArrayLike<number>, maxLag: number): Float64Array {
  const n = x.length;
  const L = Math.max(0, Math.min(maxLag, n - 1));
  const out = new Float64Array(L + 1);
  if (n < 2) return out;
  const m = mean(x);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = x[i] - m;
  for (let lag = 0; lag <= L; lag++) {
    let s = 0;
    const end = n - lag;
    for (let i = 0; i < end; i++) s += y[i] * y[i + lag];
    out[lag] = s / end;
  }
  const r0 = out[0];
  if (!(r0 > 1e-12)) return new Float64Array(L + 1);
  for (let lag = 0; lag <= L; lag++) out[lag] /= r0;
  return out;
}

/** At least four distinct onsets (≥ 100 ms apart) spread over at least two seconds. */
function hasRhythmicActivity(strength: Float64Array, frameRate: number): boolean {
  const gap = Math.max(1, Math.round(0.1 * frameRate));
  let count = 0;
  let first = -1;
  let last = -Infinity;
  for (let i = 1; i < strength.length - 1; i++) {
    const v = strength[i];
    if (v < 1 || v < strength[i - 1] || v < strength[i + 1] || i - last < gap) continue;
    if (first < 0) first = i;
    last = i;
    count++;
    if (count >= 4 && last - first >= 2 * frameRate) return true;
  }
  return false;
}

/** Log-normal tempo preference centred on 120 BPM, with a small extra preference for 80–160. */
export function tempoPrior(bpm: number): number {
  const oct = Math.log2(bpm / 120);
  const g = Math.exp(-0.5 * (oct / 0.9) ** 2);
  return bpm >= 80 && bpm <= 160 ? g : g * 0.9;
}

const COMB_HORIZON_S = 4;

/**
 * Weighted mean autocorrelation at the multiples of the beat period, with weights tapering
 * linearly to zero at a fixed horizon (smooth in the period, so no bias at round tempi).
 */
function combScore(ac: Float64Array, periodFrames: number, horizonFrames: number): number {
  let s = 0;
  let wSum = 0;
  for (let m = 1; ; m++) {
    const lag = m * periodFrames;
    if (lag >= horizonFrames || lag > ac.length - 1) break;
    const w = 1 - lag / horizonFrames;
    s += w * sampleAt(ac, lag);
    wSum += w;
  }
  return wSum > 0 ? s / wSum : 0;
}

export function estimateTempo(strength: Float64Array, frameRate: number): TempoEstimate {
  if (strength.length < frameRate * 2 || !hasRhythmicActivity(strength, frameRate)) return { bpm: 0, confidence: 0 };

  const smooth = gaussianSmooth(strength, Math.max(0.5, 0.02 * frameRate));
  const horizon = COMB_HORIZON_S * frameRate;
  const maxLag = Math.ceil(horizon + (60 / MIN_BPM) * frameRate);
  const ac = autocorrelation(smooth, maxLag);

  const step = 0.1;
  const count = Math.round((MAX_BPM - MIN_BPM) / step) + 1;
  const raw = new Float64Array(count);
  const weighted = new Float64Array(count);
  let best = 0;
  for (let i = 0; i < count; i++) {
    const bpm = MIN_BPM + i * step;
    const s = combScore(ac, (60 * frameRate) / bpm, horizon);
    raw[i] = s;
    weighted[i] = s > 0 ? s * tempoPrior(bpm) : s;
    if (weighted[i] > weighted[best]) best = i;
  }
  // fine search around the coarse peak (the prior is flat at this scale)
  let bpm = MIN_BPM + best * step;
  let peak = raw[best];
  for (let b = bpm - step; b <= bpm + step + 1e-9; b += step / 20) {
    if (b < MIN_BPM || b > MAX_BPM) continue;
    const sc = combScore(ac, (60 * frameRate) / b, horizon);
    if (sc > peak) {
      peak = sc;
      bpm = b;
    }
  }
  // Octave check: when every in-between pulse is as strong as the chosen beat (a plain
  // click / straight-eighths feel), the prior alone must not halve the tempo.
  if (2 * bpm <= MAX_BPM) {
    const doubled = combScore(ac, (60 * frameRate) / (2 * bpm), horizon);
    if (doubled >= 0.92 * peak && doubled > 0) {
      bpm *= 2;
      peak = doubled;
    }
  }
  const floor = median(raw);
  const confidence = clamp01((peak - Math.max(0, floor)) / 0.45);
  return { bpm, confidence };
}

/** Beat-tracking onset function: full-band strength plus the low band (kick / bass), unit std. */
export function combinedStrength(flux: ArrayLike<number>, lowFlux: ArrayLike<number>, frameRate: number, lowWeight = 1): Float64Array {
  const all = onsetStrength(flux, frameRate);
  const low = onsetStrength(lowFlux, frameRate);
  const out = new Float64Array(all.length);
  for (let i = 0; i < out.length; i++) out[i] = all[i] + lowWeight * low[i];
  const s = std(out);
  if (s > 1e-9) for (let i = 0; i < out.length; i++) out[i] /= s;
  return out;
}

export interface BeatTrack {
  /** beat positions in (fractional) frames */
  frames: number[];
  /** beat period in frames, refined by a least-squares fit over onset-anchored beats */
  period: number;
}

/**
 * Ellis-style DP beat tracker. `tightness` penalises deviations from the target period
 * (log-ratio squared).
 */
export function trackBeats(strength: Float64Array, frameRate: number, bpm: number, tightness = 100): BeatTrack {
  const n = strength.length;
  if (n === 0 || !(bpm > 0)) return { frames: [], period: 0 };
  const period = (60 * frameRate) / bpm;
  const local = gaussianSmooth(strength, Math.max(0.5, period / 32));
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const minBack = Math.max(1, Math.round(period / 2));
  const maxBack = Math.max(minBack + 1, Math.round(2 * period));
  const txCost = new Float64Array(maxBack + 1);
  for (let d = minBack; d <= maxBack; d++) txCost[d] = -tightness * Math.log(d / period) ** 2;

  let localMax = 0;
  for (let i = 0; i < n; i++) if (local[i] > localMax) localMax = local[i];
  const quiet = 0.01 * localMax;
  let started = false;
  for (let t = 0; t < n; t++) {
    // predecessors before the start of the signal act as a free chain start (score 0)
    let bestScore = -Infinity;
    let bestPrev = -1;
    for (let d = minBack; d <= maxBack; d++) {
      const p = t - d;
      const s = (p >= 0 ? cum[p] : 0) + txCost[d];
      if (s > bestScore) {
        bestScore = s;
        bestPrev = p;
      }
    }
    cum[t] = local[t] + bestScore;
    // no chaining through the leading silence
    back[t] = started || local[t] >= quiet ? Math.max(-1, bestPrev) : -1;
    if (local[t] >= quiet) started = true;
  }

  // last beat: the latest local maximum of the cumulative score that is not weak
  const maxima: number[] = [];
  for (let t = 1; t < n - 1; t++) if (cum[t] > cum[t - 1] && cum[t] >= cum[t + 1]) maxima.push(t);
  if (maxima.length === 0) return { frames: [], period };
  const med = median(maxima.map((t) => cum[t]));
  let last = maxima[maxima.length - 1];
  for (let i = maxima.length - 1; i >= 0; i--) {
    if (cum[maxima[i]] >= 0.5 * med) {
      last = maxima[i];
      break;
    }
  }
  const frames: number[] = [];
  for (let t = last; t >= 0; t = back[t]) {
    frames.push(t);
    if (back[t] >= t) break;
  }
  frames.reverse();
  return regularizeBeats(frames, local, period);
}

/**
 * Sub-frame refinement of beats that sit on an onset, a least-squares tempo over those anchored
 * beats, and exact-period spacing for beats without onset support (sustained or silent
 * passages), where the DP can only step in whole frames and would otherwise drift.
 */
function regularizeBeats(frames: number[], local: Float64Array, period: number): BeatTrack {
  const n = local.length;
  if (frames.length === 0) return { frames: [], period };
  const support = frames.map((b) => Math.max(local[b], b > 0 ? local[b - 1] : 0, b + 1 < n ? local[b + 1] : 0));
  const positive = support.filter((v) => v > 0);
  const threshold = Math.max(0.3, positive.length > 0 ? 0.15 * median(positive) : 0);
  const anchored = support.map((v) => v >= threshold);
  const out = frames.map((b, i) => {
    if (!anchored[i] || b <= 0 || b >= n - 1) return b;
    const a = local[b - 1];
    const c = local[b + 1];
    const denom = a - 2 * local[b] + c;
    return denom < 0 ? b + clamp((0.5 * (a - c)) / denom, -0.5, 0.5) : b;
  });
  const anchors: number[] = [];
  for (let i = 0; i < out.length; i++) if (anchored[i]) anchors.push(i);

  // least-squares slope of anchored beat position vs. beat index
  let refined = period;
  if (anchors.length >= 8) {
    const mi = mean(anchors);
    const mt = mean(anchors.map((i) => out[i]));
    let num = 0;
    let den = 0;
    for (const i of anchors) {
      num += (i - mi) * (out[i] - mt);
      den += (i - mi) ** 2;
    }
    const slope = den > 0 ? num / den : 0;
    if (slope > 0 && Math.abs(slope - period) <= 0.03 * period) refined = slope;
  }

  if (anchors.length === 0) return { frames: out.map((_, i) => out[0] + i * refined).filter((f) => f <= n - 1), period: refined };
  for (let i = 0; i < anchors[0]; i++) out[i] = out[anchors[0]] - (anchors[0] - i) * refined;
  for (let k = 1; k < anchors.length; k++) {
    const a = anchors[k - 1];
    const b = anchors[k];
    if (b - a < 2) continue;
    const step = (out[b] - out[a]) / (b - a);
    for (let i = a + 1; i < b; i++) out[i] = out[a] + (i - a) * step;
  }
  const lastAnchor = anchors[anchors.length - 1];
  for (let i = lastAnchor + 1; i < out.length; i++) out[i] = out[lastAnchor] + (i - lastAnchor) * refined;
  return { frames: out.filter((f) => f >= 0 && f <= n - 1), period: refined };
}

/** Regular grid at `bpm` over [startFrame, endFrame], phase chosen to best match the onsets. */
export function gridBeats(strength: Float64Array, frameRate: number, bpm: number, startFrame: number, endFrame: number): number[] {
  if (!(bpm > 0) || endFrame <= startFrame) return [];
  const period = (60 * frameRate) / bpm;
  const local = gaussianSmooth(strength, Math.max(0.5, period / 32));
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < period; phase += 1) {
    let s = 0;
    for (let f = startFrame + phase; f <= endFrame; f += period) s += sampleAt(local, f);
    if (s > bestScore) {
      bestScore = s;
      bestPhase = phase;
    }
  }
  const out: number[] = [];
  for (let f = startFrame + bestPhase; f <= endFrame; f += period) out.push(f);
  return out;
}
