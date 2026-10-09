// 人聲 curve (round 14): where the lead voice is in the mix, so untimed lyric lines can be laid
// over the singing (src/lib/lyrics/align.ts). No speech recogniser: lead vocals sit in the centre of
// a stereo mix, guitars and pads are often wide (as loud in the side signal as in the mid), and the
// voice has its own spectral shape and syllabic rhythm. Per STFT frame of the mid M = (L+R)/2 and
// side S = (L−R)/2 at 11 025 Hz: the vocal band's centre excess Σ max(0, |M|² − |S|²) and its share
// of the mid, the spectral flatness of that centre spectrum (a tonality measure), and twelve
// sub-band levels. At the envelope rate these are compared with the song's own level, with a
// sliding local median (±3 s, so a loud chorus does not read as "all vocals") and with smoothed
// copies (±0.5 s, ±1.5 s), and combined with the analysis's loudness, onset, brightness and bass
// by a logistic model whose weights were fitted on the dev half of a CC-licensed multilingual
// lyrics dataset (JamendoLyrics; see "Lyric timing evaluation" in docs/ARCHITECTURE.md) and
// checked on the held-out half. A mono file (or a stereo file above 20 minutes) has no side: the
// mono model uses band levels, flatness and context only.
// Pure and deterministic (runs in the analysis worker, on the main thread and in Node tests).

import { RealFFT, hannWindow } from "./fft";
import { downsample } from "./resample";

/** The vocal pass runs at this rate (its bands end far below the 5.5 kHz Nyquist). */
export const VOCAL_RATE = 11025;
/** Longer recordings get no side signal (memory stays bounded); they use the mono model. */
export const MAX_SIDE_SECONDS = 20 * 60;

const FFT_SIZE = 512;
const HOP = 256;
/** the centre / flatness band */
const BAND_LO_HZ = 200;
const BAND_HI_HZ = 4000;
/** log-spaced sub-bands for the spectral shape */
export const BANDS = 12;
const BAND_EDGES_HZ = Array.from({ length: BANDS + 1 }, (_, i) => 150 * (5000 / 150) ** (i / BANDS));
/** a side signal this much quieter than the mid (power) is a dual-mono file: the mono model */
const SILENT_SIDE = 1e-4;
/** vocal-band power under which a frame is silence (about −90 dB of a full-scale tone) */
const SILENT_POWER = 1e-9;
/**
 * A stereo lead voice adds centre energy. Uncorrelated (wide) material — two guitars panned apart, a
 * stereo pad, a reverb tail — has a centre share of about 0.5 (each bin's |M|² − |S|² is positive
 * half of the time by chance). The share is median-filtered over ±GATE_MEDIAN_SECONDS (a centred
 * drum hit between two phrases is not a voice); the curve is 0 where it is under GATE_LO and keeps
 * the model's value from GATE_LO + GATE_SPAN; dips shorter than 2 × GATE_FILL_SECONDS are filled (a
 * voice does not leave the centre for a breath or a consonant), so only a sustained wide stretch —
 * a guitar solo, a pad interlude — is cut. A mix whose centre share stays under VETO_SHARE (95th
 * percentile) has no centred sound at all, so no lead voice: its curve is 0 (the lyric timing then
 * falls back to the loudness spread). On the dev half the gate leaves the alignment as it was.
 */
const GATE_LO = 0.5;
const GATE_SPAN = 0.2;
const GATE_MEDIAN_SECONDS = 0.15;
const GATE_FILL_SECONDS = 0.6;
const VETO_SHARE = 0.7;

/** (L − R) / 2 at VOCAL_RATE (or the source rate when lower); null for a recording over 20 minutes. */
export function sideSignal(left: Float32Array, right: Float32Array, sampleRate: number): Float32Array<ArrayBuffer> | null {
  const n = Math.min(left.length, right.length);
  if (!(sampleRate > 0) || n === 0 || n / sampleRate > MAX_SIDE_SECONDS) return null;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = 0.5 * (left[i] - right[i]);
  return sampleRate > VOCAL_RATE ? (downsample(d, sampleRate, VOCAL_RATE) as Float32Array<ArrayBuffer>) : d;
}

/** The rate `sideSignal` returns for a recording at `sampleRate`. */
export function sideRateFor(sampleRate: number): number {
  return sampleRate > VOCAL_RATE ? VOCAL_RATE : sampleRate;
}

/** The mid (mono) signal at the vocal pass rate. */
export function vocalMid(x: Float32Array, rate: number): { mid: Float32Array; rate: number } {
  return rate > VOCAL_RATE ? { mid: downsample(x, rate, VOCAL_RATE), rate: VOCAL_RATE } : { mid: x, rate };
}

export interface VocalFrames {
  /** frames per second (frame i is centred at i / frameRate seconds) */
  frameRate: number;
  count: number;
  /** a usable side signal was given (else the mono model) */
  stereo: boolean;
  /** Σ |M|² over the vocal band */
  mid: Float64Array;
  /** Σ |S|² over the vocal band (0 without a side signal) */
  side: Float64Array;
  /** Σ max(0, |M|² − |S|²) over the vocal band (= mid without a side signal) */
  centre: Float64Array;
  /** 0..1 spectral flatness of the centre spectrum over the vocal band (1 = noise) */
  flatness: Float64Array;
  /** mid power per sub-band, row-major [frame * BANDS + b] */
  bandMid: Float32Array;
}

function windowFrame(x: Float32Array, center: number, win: Float64Array, out: Float64Array): void {
  const n = win.length;
  const first = center - (n >> 1);
  if (first >= 0 && first + n <= x.length) {
    for (let i = 0; i < n; i++) out[i] = x[first + i] * win[i];
  } else {
    for (let i = 0; i < n; i++) {
      const idx = first + i;
      out[i] = idx >= 0 && idx < x.length ? x[idx] * win[i] : 0;
    }
  }
}

/** Per-frame vocal features of the mid (and side) signal, both at `rate`. */
export function vocalFrames(mid: Float32Array, side: Float32Array | null, rate: number): VocalFrames {
  const n = side ? Math.min(mid.length, side.length) : mid.length;
  const count = Math.floor(n / HOP) + 1;
  const fft = new RealFFT(FFT_SIZE);
  const win = hannWindow(FFT_SIZE);
  const nBins = FFT_SIZE / 2 + 1;
  const binHz = rate / FFT_SIZE;
  const k0 = Math.max(1, Math.ceil(BAND_LO_HZ / binHz));
  const k1 = Math.min(nBins - 2, Math.floor(BAND_HI_HZ / binHz));
  const bins = k1 - k0 + 1;
  const scale = 4 / FFT_SIZE;
  const buf = new Float64Array(FFT_SIZE);
  const re = new Float64Array(nBins);
  const im = new Float64Array(nBins);
  const pm = new Float64Array(nBins);
  const bandOf = new Int8Array(nBins).fill(-1);
  for (let k = 0; k < nBins; k++) {
    const hz = k * binHz;
    for (let b = 0; b < BANDS; b++) if (hz >= BAND_EDGES_HZ[b] && hz < BAND_EDGES_HZ[b + 1]) bandOf[k] = b;
  }
  const out: VocalFrames = {
    frameRate: rate / HOP,
    count,
    stereo: !!side,
    mid: new Float64Array(count),
    side: new Float64Array(count),
    centre: new Float64Array(count),
    flatness: new Float64Array(count),
    bandMid: new Float32Array(count * BANDS),
  };
  for (let f = 0; f < count; f++) {
    const c = f * HOP;
    windowFrame(mid, c, win, buf);
    fft.forward(buf, re, im);
    let sm = 0;
    const row = f * BANDS;
    for (let k = 0; k < nBins; k++) {
      const p = (re[k] * re[k] + im[k] * im[k]) * scale * scale;
      pm[k] = p;
      if (k >= k0 && k <= k1) sm += p;
      if (bandOf[k] >= 0) out.bandMid[row + bandOf[k]] += p;
    }
    let ss = 0;
    let ce = 0;
    let logSum = 0;
    if (side) {
      windowFrame(side, c, win, buf);
      fft.forward(buf, re, im);
      for (let k = k0; k <= k1; k++) {
        const p = (re[k] * re[k] + im[k] * im[k]) * scale * scale;
        ss += p;
        const e = pm[k] > p ? pm[k] - p : 0;
        ce += e;
        logSum += Math.log(e + 1e-14);
      }
    } else {
      for (let k = k0; k <= k1; k++) {
        ce += pm[k];
        logSum += Math.log(pm[k] + 1e-14);
      }
    }
    out.mid[f] = sm;
    out.side[f] = ss;
    out.centre[f] = ce;
    out.flatness[f] = ce > 1e-14 ? Math.min(1, Math.exp(logSum / bins) / (ce / bins)) : 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// the curve
// ---------------------------------------------------------------------------

/** The analysis envelopes the model reads (0..1 at the envelope rate). */
export interface VocalEnvelopes {
  energy: ArrayLike<number>;
  onset: ArrayLike<number>;
  brightness: ArrayLike<number>;
  bass: ArrayLike<number>;
}

/**
 * Logistic models (standardisation folded into the coefficients), fitted on the dev half of the
 * evaluation set (35 songs). Features at the envelope rate; levels are log10 power relative to the
 * song's 90th percentile of the vocal-band mid level:
 *   lm[b]   sub-band b mid level            lmid / lcen / lside  vocal-band mid / centre / side level
 *   cr      centre share of the mid         flat                 flatness of the centre spectrum
 *   energy, onset, bright, bass             the analysis envelopes
 *   x_loc   x minus its ±3 s sliding median x_s05 / x_s15        x averaged over ±0.5 s / ±1.5 s
 *   x_d     x(t + 0.2 s) − x(t − 0.2 s)     lcen_std             std of lcen over ±0.3 s (syllables)
 */
const STEREO_MODEL = {
  bias: -7.0926,
  lm: [-0.20847, -0.22837, 0.23329, 0.33908, 0.37023, 0.24277, 0.057843, 0.0086295, -0.016902, -0.38781, 0.53784, -0.7935],
  lmid: -0.21309,
  lcen: -0.40248,
  lside: -0.021032,
  cr: 6.824,
  flat: -2.8484,
  energy: 2.7582,
  onset: -0.39486,
  bright: 2.1824,
  bass: -0.26912,
  lcen_loc: -0.81535,
  lcen_s05: 1.1063,
  lcen_s15: -0.17312,
  lcen_d: 0.13268,
  cr_loc: -5.5789,
  cr_s05: 4.2924,
  cr_s15: -5.3903,
  cr_d: -0.15732,
  lmid_loc: 1.0424,
  lmid_s05: 1.6232,
  lmid_s15: 0.46079,
  lmid_d: -0.3232,
  lcen_std: 3.2438,
} as const;

const MONO_MODEL = {
  bias: -1.4824,
  lm: [-0.13655, -0.21563, 0.1297, 0.33029, 0.31656, 0.14269, 0.075784, 0.02672, 0.019948, -0.32644, 0.63792, -0.77057],
  lmid: -0.12257,
  flat: -3.2403,
  energy: 2.8791,
  onset: -0.17003,
  bright: 2.0805,
  bass: -0.54591,
  lmid_loc: -0.38565,
  lmid_s05: 2.9166,
  lmid_s15: -0.08872,
  lmid_d: -0.21711,
  lcen_std: 3.6591,
} as const;

/** average of the frames that round to each envelope index (a frame-free index keeps the last value) */
function pool(x: ArrayLike<number>, frameRate: number, n: number, envRate: number, stride = 1, offset = 0): Float64Array {
  const sum = new Float64Array(n);
  const cnt = new Float64Array(n);
  const frames = Math.floor((x.length - offset + stride - 1) / stride);
  for (let i = 0; i < frames; i++) {
    const j = Math.round((i / frameRate) * envRate);
    if (j >= 0 && j < n) {
      sum[j] += x[i * stride + offset];
      cnt[j]++;
    }
  }
  for (let j = 0; j < n; j++) sum[j] = cnt[j] ? sum[j] / cnt[j] : j > 0 ? sum[j - 1] : 0;
  return sum;
}

function movingAverage(x: Float64Array, half: number): Float64Array {
  const n = x.length;
  const prefix = new Float64Array(n + 1);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

/** a sliding quantile, evaluated every `step` samples and linearly interpolated (cheap, smooth) */
function slidingQuantile(x: Float64Array, half: number, q: number, step = 10): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const knots: number[] = [];
  const vals: number[] = [];
  const buf: number[] = [];
  for (let c = 0; ; c += step) {
    const cc = Math.min(n - 1, c);
    buf.length = 0;
    for (let k = Math.max(0, cc - half); k <= Math.min(n - 1, cc + half); k++) buf.push(x[k]);
    buf.sort((a, b) => a - b);
    knots.push(cc);
    vals.push(buf[Math.min(buf.length - 1, Math.floor(q * (buf.length - 1)))]);
    if (cc === n - 1) break;
  }
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k + 1 < knots.length && knots[k + 1] < i) k++;
    const a = knots[k];
    const k2 = Math.min(knots.length - 1, k + 1);
    const b = knots[k2];
    const f = b > a ? (i - a) / (b - a) : 0;
    out[i] = vals[k] * (1 - f) + vals[k2] * f;
  }
  return out;
}

function quantileOf(x: ArrayLike<number>, q: number): number {
  const s = Array.from(x).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0;
}

const log10 = (x: Float64Array) => x.map((v) => Math.log10(v + 1e-9));

/** sliding median over ±half samples */
function slidingMedian(x: Float64Array, half: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) buf.push(x[k]);
    buf.sort((a, b) => a - b);
    out[i] = buf[buf.length >> 1];
  }
  return out;
}

/** sliding max (sign 1) or min (sign −1) over ±half samples */
function slidingExtreme(x: Float64Array, half: number, sign: 1 | -1): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) m = Math.max(m, sign * x[k]);
    out[i] = sign * m;
  }
  return out;
}

/** The centre-share gate (see GATE_LO): 0..1 per envelope frame, all 0 for a mix with nothing centred. */
function centreGate(cr: Float64Array, mid: Float64Array, envRate: number): Float64Array {
  const share = slidingMedian(cr, Math.max(1, Math.round(GATE_MEDIAN_SECONDS * envRate)));
  const sounding: number[] = [];
  for (let i = 0; i < share.length; i++) if (mid[i] >= SILENT_POWER) sounding.push(share[i]);
  if (sounding.length === 0 || quantileOf(sounding, 0.95) < VETO_SHARE) return new Float64Array(share.length);
  const open = share.map((c) => Math.min(1, Math.max(0, (c - GATE_LO) / GATE_SPAN)));
  // closing: fill the short dips
  const fill = Math.max(1, Math.round(GATE_FILL_SECONDS * envRate));
  return slidingExtreme(slidingExtreme(open, fill, 1), fill, -1);
}

/** The 0..1 人聲 curve at `envRate` (n frames) from the frames and the analysis envelopes. */
export function vocalCurve(frames: VocalFrames, env: VocalEnvelopes, n: number, envRate = 20): Float64Array {
  const out = new Float64Array(n);
  if (n === 0 || frames.count === 0) return out;
  const fr = frames.frameRate;
  const mid = pool(frames.mid, fr, n, envRate);
  const side = pool(frames.side, fr, n, envRate);
  const cen = pool(frames.centre, fr, n, envRate);
  // a dual-mono "stereo" file reads like mono
  let sp = 0;
  let mp = 0;
  for (let j = 0; j < n; j++) {
    sp += side[j];
    mp += mid[j];
  }
  const stereo = frames.stereo && sp > SILENT_SIDE * mp;
  const ref = quantileOf(log10(mid), 0.9);
  const lmid = log10(mid).map((v) => v - ref);
  const lcen = stereo ? log10(cen).map((v) => v - ref) : lmid;
  const flat = pool(frames.flatness, fr, n, envRate);
  const at = (a: ArrayLike<number>, i: number) => (a.length ? Number(a[Math.min(a.length - 1, i)]) || 0 : 0);
  const z = new Float64Array(n);
  const addTerm = (w: number, x: ArrayLike<number>) => {
    for (let i = 0; i < n; i++) z[i] += w * x[i];
  };
  const context = (x: Float64Array, w: { loc: number; s05: number; s15: number; d: number }) => {
    const med = slidingQuantile(x, 3 * envRate, 0.5);
    const s05 = movingAverage(x, Math.round(0.5 * envRate));
    const s15 = movingAverage(x, Math.round(1.5 * envRate));
    const d = Math.round(0.2 * envRate);
    for (let i = 0; i < n; i++) {
      z[i] += w.loc * (x[i] - med[i]) + w.s05 * s05[i] + w.s15 * s15[i] + w.d * (x[Math.min(n - 1, i + d)] - x[Math.max(0, i - d)]);
    }
  };
  const m = stereo ? STEREO_MODEL : MONO_MODEL;
  let gate: Float64Array | null = null;
  z.fill(m.bias);
  for (let b = 0; b < BANDS; b++) addTerm(m.lm[b], log10(pool(frames.bandMid, fr, n, envRate, BANDS, b)).map((v) => v - ref));
  addTerm(m.lmid, lmid);
  addTerm(m.flat, flat);
  for (let i = 0; i < n; i++) z[i] += m.energy * at(env.energy, i) + m.onset * at(env.onset, i) + m.bright * at(env.brightness, i) + m.bass * at(env.bass, i);
  context(lmid, { loc: m.lmid_loc, s05: m.lmid_s05, s15: m.lmid_s15, d: m.lmid_d });
  if (stereo) {
    const s = STEREO_MODEL;
    const cr = cen.map((v, i) => v / (mid[i] + 1e-12));
    addTerm(s.lcen, lcen);
    addTerm(s.lside, log10(side).map((v) => v - ref));
    addTerm(s.cr, cr);
    context(lcen, { loc: s.lcen_loc, s05: s.lcen_s05, s15: s.lcen_s15, d: s.lcen_d });
    context(cr, { loc: s.cr_loc, s05: s.cr_s05, s15: s.cr_s15, d: s.cr_d });
    gate = centreGate(cr, mid, envRate);
  }
  // syllabic modulation: the std of the centre level over ±0.3 s
  const half = Math.round(0.3 * envRate);
  const m1 = movingAverage(lcen, half);
  const m2 = movingAverage(lcen.map((v) => v * v), half);
  for (let i = 0; i < n; i++) z[i] += m.lcen_std * Math.sqrt(Math.max(0, m2[i] - m1[i] * m1[i]));
  // digital silence is never a voice, whatever the song's own level
  for (let i = 0; i < n; i++) out[i] = mid[i] < SILENT_POWER ? 0 : (gate ? gate[i] : 1) / (1 + Math.exp(-z[i]));
  return out;
}

/** The whole vocal pass: mid (any rate) and optional side (at `sideRate`) → the 0..1 curve. */
export function analyzeVocal(
  x: Float32Array,
  rate: number,
  side: Float32Array | null,
  sideRate: number,
  env: VocalEnvelopes,
  n: number,
  envRate = 20,
): Float64Array {
  let { mid, rate: vr } = vocalMid(x, rate);
  let s = side;
  if (s && sideRate !== vr) {
    // both at the same rate: the lower of the two
    if (sideRate > vr) s = downsample(s, sideRate, vr);
    else {
      mid = downsample(mid, vr, sideRate);
      vr = sideRate;
    }
  }
  return vocalCurve(vocalFrames(mid, s, vr), env, n, envRate);
}
