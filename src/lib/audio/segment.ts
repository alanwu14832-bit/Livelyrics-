// Structural segmentation: Foote novelty (Gaussian-tapered checkerboard kernel over a banded
// self-similarity matrix of timbre + chroma + dynamics features), greedy peak picking with a
// minimum section length, beat/bar snapping and merging of adjacent look-alike sections.

import type { AudioSectionGuess } from "../types";
import { CHROMA_COUNT, MFCC_COUNT, type SpectralFrames } from "./features";
import { clamp, cosine, mean, median, movingAverage } from "./stats";

export interface Envelopes {
  rate: number;
  /** 0..1 normalized envelopes (as published in AudioAnalysis) */
  energy: ArrayLike<number>;
  onset: ArrayLike<number>;
  bass: ArrayLike<number>;
  brightness: ArrayLike<number>;
  /** log2 of the spectral centroid in Hz (absolute, held through silence) */
  centroidOctaves: ArrayLike<number>;
}

export interface SegmentInput {
  duration: number;
  spectral: SpectralFrames;
  env: Envelopes;
  /** beat times in seconds (may be empty) */
  beats: number[];
  bpm: number;
}

export interface SegmentOptions {
  /** minimum section length in seconds */
  minSection?: number;
}

const SEG_RATE = 4; // feature frames per second for the self-similarity analysis
const KERNEL_S = 6; // checkerboard half width in seconds
const PEAK_THRESHOLD = 0.16;
const MERGE_DISTANCE = 0.35;

interface FeatureMatrix {
  n: number;
  dims: number;
  data: Float64Array;
}

/** half width (s) of the Hann window that aggregates frame features into one SEG_RATE frame */
const AGG_HALF_S = 1;

/**
 * Feature vectors at SEG_RATE, each a Hann-weighted average over ±AGG_HALF_S (an anti-alias
 * window: beat-rate fluctuations must not look like structure). Every group uses an absolute,
 * perceptual scale (no per-song z-scoring, which would blow stationary noise up into "changes"),
 * chosen so that a squared distance of ≈1 is a clearly audible difference:
 *  - timbre: MFCC 1..12 (amplitude-weighted), 1.5 units per coefficient, averaged over coefficients
 *  - harmony: L2-normalized chroma, weight 0.5 (chord changes inside a section stay moderate)
 *  - loudness 4 dB per unit, bass level 6 dB per unit
 *  - brightness 0.5 octave per unit and onset density 0.25 per unit, each weight 0.5
 */
function buildFeatures(input: SegmentInput): FeatureMatrix {
  const { spectral, env, duration } = input;
  const n = Math.max(1, Math.ceil(duration * SEG_RATE));
  const DYN = 4;
  const dims = MFCC_COUNT + CHROMA_COUNT + DYN;
  const d0 = MFCC_COUNT + CHROMA_COUNT;
  const data = new Float64Array(n * dims);
  const hann = (dt: number) => (Math.abs(dt) >= AGG_HALF_S ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * dt) / AGG_HALF_S));
  const amp = Float64Array.from(spectral.power, (p) => Math.sqrt(p));
  const chroma = new Float64Array(CHROMA_COUNT);
  const envSeries: ArrayLike<number>[] = [env.centroidOctaves, env.onset];
  const envScale = [1 / 0.5, 1];
  const levelDb = (p: number) => Math.max(-95, 10 * Math.log10(p + 1e-12));

  for (let j = 0; j < n; j++) {
    const row = j * dims;
    const c = (j + 0.5) / SEG_RATE;
    // spectral-frame features
    const f0 = Math.max(0, Math.ceil((c - AGG_HALF_S) * spectral.frameRate));
    const f1 = Math.min(spectral.count - 1, Math.floor((c + AGG_HALF_S) * spectral.frameRate));
    let wSum = 0;
    let wAmpSum = 0;
    let power = 0;
    let bassPower = 0;
    chroma.fill(0);
    for (let f = f0; f <= f1; f++) {
      const w = hann(f / spectral.frameRate - c);
      if (w <= 0) continue;
      const wa = w * (amp[f] + 1e-9);
      wSum += w;
      wAmpSum += wa;
      power += w * spectral.power[f];
      bassPower += w * spectral.bassPower[f];
      for (let k = 0; k < MFCC_COUNT; k++) data[row + k] += wa * spectral.mfcc[f * MFCC_COUNT + k];
      for (let k = 0; k < CHROMA_COUNT; k++) chroma[k] += w * spectral.chroma[f * CHROMA_COUNT + k];
    }
    if (wAmpSum > 0) for (let k = 0; k < MFCC_COUNT; k++) data[row + k] /= wAmpSum;
    let norm = 0;
    for (let k = 0; k < CHROMA_COUNT; k++) norm += chroma[k] * chroma[k];
    norm = Math.sqrt(norm);
    for (let k = 0; k < CHROMA_COUNT; k++) data[row + MFCC_COUNT + k] = norm > 1e-12 && wSum > 0 ? chroma[k] / norm : 0;
    // levels are averaged as power (averaging dB would let the gaps between staccato hits dominate)
    data[row + d0] = wSum > 0 ? levelDb(power / wSum) / 4 : -95 / 4;
    data[row + d0 + 1] = wSum > 0 ? levelDb(bassPower / wSum) / 6 : -95 / 6;
    const e0 = Math.max(0, Math.ceil((c - AGG_HALF_S) * env.rate));
    const e1 = Math.min(env.onset.length - 1, Math.floor((c + AGG_HALF_S) * env.rate));
    for (let k = 0; k < envSeries.length; k++) {
      const series = envSeries[k];
      let s = 0;
      let w = 0;
      for (let e = e0; e <= e1 && e < series.length; e++) {
        const we = hann(e / env.rate - c);
        s += we * series[e];
        w += we;
      }
      data[row + d0 + 2 + k] = w > 0 ? (s / w) * envScale[k] : 0;
    }
  }

  const scales = new Float64Array(dims);
  for (let k = 0; k < MFCC_COUNT; k++) scales[k] = Math.sqrt(1 / MFCC_COUNT) / 1.5;
  for (let k = 0; k < CHROMA_COUNT; k++) scales[MFCC_COUNT + k] = Math.sqrt(0.5);
  scales[d0] = 1; // loudness already divided by 4 dB
  scales[d0 + 1] = 1; // bass level already divided by 6 dB
  scales[d0 + 2] = Math.sqrt(0.5); // octaves already divided by 0.5
  scales[d0 + 3] = Math.sqrt(0.5) / 0.25;
  for (let j = 0; j < n; j++) for (let d = 0; d < dims; d++) data[j * dims + d] *= scales[d];
  return { n, dims, data };
}

function dist2(fm: FeatureMatrix, i: number, j: number): number {
  const { dims, data } = fm;
  let s = 0;
  const a = i * dims;
  const b = j * dims;
  for (let d = 0; d < dims; d++) {
    const x = data[a + d] - data[b + d];
    s += x * x;
  }
  return s;
}

/** Foote novelty: mean within-block similarity minus mean cross-block similarity, in [-1, 1]. */
export function noveltyCurve(fm: FeatureMatrix, half: number): Float64Array {
  const { n } = fm;
  const band = 2 * half;
  // banded similarity: sim[i * band + δ] = S(i, i + δ), δ in [0, band)
  const sim = new Float64Array(n * band);
  for (let i = 0; i < n; i++) {
    for (let dlt = 0; dlt < band && i + dlt < n; dlt++) sim[i * band + dlt] = Math.exp(-dist2(fm, i, i + dlt) / 3);
  }
  const S = (i: number, j: number) => (i <= j ? sim[i * band + (j - i)] : sim[j * band + (i - j)]);
  const sigma = half / 2;
  const taper = new Float64Array(2 * half);
  for (let k = 0; k < 2 * half; k++) {
    const x = k - half + 0.5;
    taper[k] = Math.exp(-(x * x) / (2 * sigma * sigma));
  }
  const out = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    let within = 0;
    let wW = 0;
    let cross = 0;
    let wC = 0;
    for (let a = 0; a < 2 * half; a++) {
      const i = t - half + a;
      if (i < 0 || i >= n) continue;
      for (let b = a; b < 2 * half; b++) {
        const j = t - half + b;
        if (j < 0 || j >= n) continue;
        const w = taper[a] * taper[b] * (a === b ? 1 : 2);
        const sameSide = a < half === b < half;
        if (sameSide) {
          within += w * S(i, j);
          wW += w;
        } else {
          cross += w * S(i, j);
          wC += w;
        }
      }
    }
    out[t] = wW > 0 && wC > 0 ? within / wW - cross / wC : 0;
  }
  return out;
}

/**
 * Short-scale change detector (≈1 s either side) on the dynamics envelopes plus a lighter
 * harmonic-change term, used for precise boundary placement.
 */
function fineNovelty(env: Envelopes, spectral: SpectralFrames): Float64Array {
  const n = env.energy.length;
  const out = new Float64Array(n);
  const w = Math.max(2, Math.round(env.rate));
  const smoothOnset = movingAverage(env.onset, Math.round(env.rate * 0.25));
  const series: ArrayLike<number>[] = [env.energy, env.bass, smoothOnset, env.brightness];
  const weights = [1, 0.8, 0.8, 0.5];
  const prefix = series.map((src) => {
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + src[i];
    return p;
  });
  // chroma power per envelope frame, as running sums per pitch class
  const chromaPrefix = new Float64Array((n + 1) * CHROMA_COUNT);
  const perFrame = new Float64Array(n * CHROMA_COUNT);
  for (let f = 0; f < spectral.count; f++) {
    const j = Math.min(n - 1, Math.round((f / spectral.frameRate) * env.rate));
    for (let c = 0; c < CHROMA_COUNT; c++) perFrame[j * CHROMA_COUNT + c] += spectral.chroma[f * CHROMA_COUNT + c];
  }
  for (let j = 0; j < n; j++) {
    for (let c = 0; c < CHROMA_COUNT; c++) chromaPrefix[(j + 1) * CHROMA_COUNT + c] = chromaPrefix[j * CHROMA_COUNT + c] + perFrame[j * CHROMA_COUNT + c];
  }
  let totalChroma = 0;
  for (let i = 0; i < perFrame.length; i++) totalChroma += perFrame[i];
  // a window side quieter than this carries no harmonic information (silence is handled by the level terms)
  const minSide = (1e-3 * totalChroma * w) / Math.max(1, n);
  const before = new Float64Array(CHROMA_COUNT);
  const after = new Float64Array(CHROMA_COUNT);
  for (let t = 1; t < n; t++) {
    const a = Math.max(0, t - w);
    const b = Math.min(n, t + w);
    let s = 0;
    for (let k = 0; k < series.length; k++) {
      const mb = (prefix[k][t] - prefix[k][a]) / (t - a);
      const ma = (prefix[k][b] - prefix[k][t]) / (b - t);
      s += weights[k] * (ma - mb) ** 2;
    }
    let sumBefore = 0;
    let sumAfter = 0;
    for (let c = 0; c < CHROMA_COUNT; c++) {
      before[c] = chromaPrefix[t * CHROMA_COUNT + c] - chromaPrefix[a * CHROMA_COUNT + c];
      after[c] = chromaPrefix[b * CHROMA_COUNT + c] - chromaPrefix[t * CHROMA_COUNT + c];
      sumBefore += before[c];
      sumAfter += after[c];
    }
    if (sumBefore > minSide && sumAfter > minSide) s += 0.25 * (1 - cosine(before, after)) ** 2;
    out[t] = Math.sqrt(s);
  }
  return out;
}

/** Beat indices that start a bar (4/4 assumed), or null when the bar phase is unclear. */
export function estimateDownbeatPhase(beats: number[], spectral: SpectralFrames, env: Envelopes): number | null {
  if (beats.length < 16) return null;
  const chromaOf = (from: number, to: number) => {
    const v = new Float64Array(CHROMA_COUNT);
    const f0 = Math.max(0, Math.floor(from * spectral.frameRate));
    const f1 = Math.min(spectral.count, Math.ceil(to * spectral.frameRate));
    for (let f = f0; f < f1; f++) for (let c = 0; c < CHROMA_COUNT; c++) v[c] += spectral.chroma[f * CHROMA_COUNT + c];
    return v;
  };
  const chroma: Float64Array[] = [];
  const energy: number[] = [];
  for (let k = 0; k < beats.length - 1; k++) {
    chroma.push(chromaOf(beats[k], beats[k + 1]));
    energy.push(mean(env.energy, Math.floor(beats[k] * env.rate), Math.ceil(beats[k + 1] * env.rate)));
  }
  const scores = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let k = 1; k < chroma.length; k++) {
    const harmonic = 1 - cosine(chroma[k - 1], chroma[k]);
    const lift = Math.max(0, energy[k] - energy[k - 1]);
    scores[k % 4] += harmonic + 0.5 * lift;
    counts[k % 4]++;
  }
  const avg = scores.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
  let best = 0;
  for (let i = 1; i < 4; i++) if (avg[i] > avg[best]) best = i;
  const others = avg.filter((_, i) => i !== best);
  const rest = mean(others);
  // needs a clear, recurring harmonic change on one beat of the bar
  if (!(avg[best] >= 0.05) || (avg[best] - rest) / avg[best] < 0.35) return null;
  return best;
}

function nearestIndex(sorted: number[], t: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sorted[lo - 1] - t) <= Math.abs(sorted[lo] - t)) return lo - 1;
  return lo;
}

function valueAt(arr: ArrayLike<number>, rate: number, t: number, radius = 0.05): number {
  const a = Math.max(0, Math.floor((t - radius) * rate));
  const b = Math.min(arr.length - 1, Math.ceil((t + radius) * rate));
  let m = 0;
  for (let i = a; i <= b; i++) if (arr[i] > m) m = arr[i];
  return m;
}

/** Move a coarse boundary onto the precise change point, then onto a nearby beat / downbeat. */
function snapBoundary(t: number, fine: Float64Array, fineRate: number, beats: number[], downbeatPhase: number | null, period: number): number {
  let tf = t;
  const a = Math.max(1, Math.floor((t - 2) * fineRate));
  const b = Math.min(fine.length - 1, Math.ceil((t + 2) * fineRate));
  if (b > a) {
    let bi = a;
    for (let i = a; i <= b; i++) if (fine[i] > fine[bi]) bi = i;
    const local: number[] = [];
    for (let i = a; i <= b; i++) local.push(fine[i]);
    if (fine[bi] >= Math.max(0.04, 1.5 * median(local))) tf = bi / fineRate;
  }
  if (beats.length === 0 || !(period > 0)) return tf;
  const k = nearestIndex(beats, tf);
  let ts = Math.abs(beats[k] - tf) <= 0.6 * period ? beats[k] : tf;
  if (downbeatPhase != null && ts === beats[k] && k % 4 !== downbeatPhase) {
    // nearest downbeat within one beat, if the change there is nearly as strong
    const offset = (((downbeatPhase - k) % 4) + 4) % 4; // beats forward to the next downbeat
    const candidates = [k + offset, k + offset - 4].filter((i) => i >= 0 && i < beats.length && Math.abs(i - k) <= 1);
    let bestScore = -Infinity;
    for (const c of candidates) {
      const strength = valueAt(fine, fineRate, beats[c]);
      if (strength >= 0.6 * valueAt(fine, fineRate, ts) && strength > bestScore) {
        bestScore = strength;
        ts = beats[c];
      }
    }
  }
  return ts;
}

export function detectSections(input: SegmentInput, options: SegmentOptions = {}): AudioSectionGuess[] {
  const { duration, env } = input;
  const minSection = options.minSection ?? 7.5;
  const sectionEnergy = (start: number, end: number) =>
    clamp(mean(env.energy, Math.floor(start * env.rate), Math.max(Math.floor(start * env.rate) + 1, Math.ceil(end * env.rate))), 0, 1);
  const whole = [{ start: 0, end: duration, energy: sectionEnergy(0, duration) }];
  if (!(duration > 2 * minSection)) return duration > 0 ? whole : [];

  const raw = buildFeatures(input);
  const half = Math.round(KERNEL_S * SEG_RATE);
  const nov = noveltyCurve(raw, half);
  if (process.env.SEG_DEBUG) console.log("nov", Array.from(nov).map((v, i) => (i % 4 === 0 ? `${i / 4}:${v.toFixed(2)}` : "")).filter(Boolean).join(" "));

  // local maxima (±2 s) above the absolute threshold
  const radius = 2 * SEG_RATE;
  const candidates: { t: number; score: number }[] = [];
  for (let j = 1; j < nov.length - 1; j++) {
    if (nov[j] < PEAK_THRESHOLD) continue;
    let isMax = true;
    for (let k = Math.max(0, j - radius); k <= Math.min(nov.length - 1, j + radius); k++) {
      if (nov[k] > nov[j] || (nov[k] === nov[j] && k < j)) {
        isMax = false;
        break;
      }
    }
    if (isMax) candidates.push({ t: j / SEG_RATE, score: nov[j] });
  }
  candidates.sort((x, y) => y.score - x.score || x.t - y.t);

  const period = input.bpm > 0 ? 60 / input.bpm : 0;
  const fine = fineNovelty(env, input.spectral);
  const downbeat = estimateDownbeatPhase(input.beats, input.spectral, env);
  const accepted: { t: number; score: number }[] = [];
  for (const c of candidates) {
    const t = snapBoundary(c.t, fine, env.rate, input.beats, downbeat, period);
    if (t < minSection || t > duration - minSection) continue;
    if (accepted.some((a) => Math.abs(a.t - t) < minSection)) continue;
    accepted.push({ t, score: c.score });
  }
  accepted.sort((x, y) => x.t - y.t);

  // merge adjacent sections whose average features are close
  let bounds = [0, ...accepted.map((a) => a.t), duration];
  const sectionMean = (start: number, end: number) => {
    const j0 = Math.max(0, Math.floor(start * SEG_RATE));
    const j1 = Math.min(raw.n, Math.max(j0 + 1, Math.floor(end * SEG_RATE)));
    const v = new Float64Array(raw.dims);
    for (let j = j0; j < j1; j++) for (let d = 0; d < raw.dims; d++) v[d] += raw.data[j * raw.dims + d];
    for (let d = 0; d < raw.dims; d++) v[d] /= j1 - j0;
    return v;
  };
  for (;;) {
    if (bounds.length <= 2) break;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 1; i < bounds.length - 1; i++) {
      const left = sectionMean(bounds[i - 1], bounds[i]);
      const right = sectionMean(bounds[i], bounds[i + 1]);
      let d = 0;
      for (let k = 0; k < raw.dims; k++) d += (left[k] - right[k]) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestDist >= MERGE_DISTANCE) break;
    bounds = bounds.filter((_, i) => i !== bestIdx);
  }

  const out: AudioSectionGuess[] = [];
  for (let i = 0; i < bounds.length - 1; i++) out.push({ start: bounds[i], end: bounds[i + 1], energy: sectionEnergy(bounds[i], bounds[i + 1]) });
  return out;
}
