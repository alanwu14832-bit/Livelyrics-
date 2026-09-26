// Short-time spectral analysis: two STFT passes over the (≈22 kHz) mono signal.
//  - spectral pass (≈93 ms Hann, 75% overlap): loudness, bass band, centroid, MFCC-like timbre, chroma
//  - onset pass (≈46 ms Hann, 75% overlap): log-mel spectral flux with a vibrato-suppressing max filter

import { RealFFT, hannWindow } from "./fft";

export const MFCC_COUNT = 12;
export const CHROMA_COUNT = 12;


export interface SpectralFrames {
  /** frames per second (frame i is centred at i / frameRate seconds) */
  frameRate: number;
  count: number;
  /** mean square of the (windowed) signal, linear power */
  power: Float64Array;
  /** power below ~150 Hz */
  bassPower: Float64Array;
  /** spectral centroid in Hz (0 when the frame is silent) */
  centroid: Float64Array;
  /** MFCC-like coefficients 1..12 (c0 dropped), row-major [frame * MFCC_COUNT + c] */
  mfcc: Float32Array;
  /** pitch-class magnitude of tonal peaks, row-major [frame * 12 + pc] (C = 0) */
  chroma: Float32Array;
}

export interface OnsetFrames {
  frameRate: number;
  count: number;
  /** half-wave rectified log-mel spectral flux, frame i compares frame i with i-1 */
  flux: Float64Array;
  /** same, restricted to bands below ~200 Hz (kick / bass attacks) */
  lowFlux: Float64Array;
}

interface MelBand {
  start: number;
  weights: Float64Array;
  centerHz: number;
}

const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (10 ** (m / 2595) - 1);

/** Triangular mel filters over FFT bins; each band's weights sum to 1 (band = average magnitude). */
export function melFilterbank(fftSize: number, sampleRate: number, bands: number, fMin: number, fMax: number): MelBand[] {
  const nBins = fftSize / 2 + 1;
  const binHz = sampleRate / fftSize;
  const top = Math.min(fMax, sampleRate / 2);
  const mMin = hzToMel(fMin);
  const mMax = hzToMel(top);
  const edges: number[] = [];
  for (let i = 0; i < bands + 2; i++) edges.push(melToHz(mMin + ((mMax - mMin) * i) / (bands + 1)));
  const out: MelBand[] = [];
  for (let b = 0; b < bands; b++) {
    const lo = edges[b];
    const mid = edges[b + 1];
    const hi = edges[b + 2];
    const k0 = Math.max(0, Math.floor(lo / binHz));
    const k1 = Math.min(nBins - 1, Math.ceil(hi / binHz));
    const w: number[] = [];
    for (let k = k0; k <= k1; k++) {
      const f = k * binHz;
      const v = f <= lo || f >= hi ? 0 : f <= mid ? (f - lo) / (mid - lo) : (hi - f) / (hi - mid);
      w.push(v);
    }
    let sum = w.reduce((s, v) => s + v, 0);
    let start = k0;
    let weights = w;
    if (!(sum > 0)) {
      // band narrower than one bin: use the nearest bin
      start = Math.min(nBins - 1, Math.max(0, Math.round(mid / binHz)));
      weights = [1];
      sum = 1;
    }
    out.push({ start, weights: Float64Array.from(weights, (v) => v / sum), centerHz: mid });
  }
  return out;
}

/** Copy one Hann-windowed frame centred at `center` (zero padded outside the signal). */
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

export function frameCount(length: number, hop: number): number {
  return Math.floor(length / hop) + 1;
}

export function spectralPass(
  x: Float32Array,
  sampleRate: number,
  fftSize: number,
  onFrame?: (done: number, total: number) => void,
): SpectralFrames {
  const hop = fftSize / 4;
  const count = frameCount(x.length, hop);
  const fft = new RealFFT(fftSize);
  const win = hannWindow(fftSize);
  let winPow = 0;
  for (let i = 0; i < fftSize; i++) winPow += win[i] * win[i];
  const buf = new Float64Array(fftSize);
  const nBins = fftSize / 2 + 1;
  const re = new Float64Array(nBins);
  const im = new Float64Array(nBins);
  const mag = new Float64Array(nBins);
  const binHz = sampleRate / fftSize;
  const scale = 4 / fftSize; // a full-scale sine peaks at ≈1

  const bassLo = Math.max(1, Math.round(20 / binHz));
  const bassHi = Math.max(bassLo + 1, Math.round(150 / binHz));
  const centroidLo = Math.max(1, Math.round(40 / binHz));

  const melBands = melFilterbank(fftSize, sampleRate, 40, 30, 11000);
  const nMel = melBands.length;
  const logMel = new Float64Array(nMel);
  const dct = new Float64Array(MFCC_COUNT * nMel);
  for (let c = 0; c < MFCC_COUNT; c++) {
    for (let b = 0; b < nMel; b++) dct[c * nMel + b] = Math.cos((Math.PI * (c + 1) * (b + 0.5)) / nMel) * Math.sqrt(2 / nMel);
  }

  // hard pitch-class assignment for bins in the musically useful range
  const pcOfBin = new Int8Array(nBins).fill(-1);
  for (let k = 1; k < nBins; k++) {
    const f = k * binHz;
    if (f < 80 || f > 5000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    pcOfBin[k] = ((Math.round(midi) % 12) + 12) % 12;
  }

  const power = new Float64Array(count);
  const bassPower = new Float64Array(count);
  const centroid = new Float64Array(count);
  const mfcc = new Float32Array(count * MFCC_COUNT);
  const chroma = new Float32Array(count * CHROMA_COUNT);
  const progressEvery = Math.max(1, Math.floor(count / 50));

  for (let f = 0; f < count; f++) {
    windowFrame(x, f * hop, win, buf);
    let ms = 0;
    for (let i = 0; i < fftSize; i++) ms += buf[i] * buf[i];
    power[f] = ms / winPow;

    fft.forward(buf, re, im);
    let bass = 0;
    let magSum = 0;
    let magFreq = 0;
    for (let k = 0; k < nBins; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
      mag[k] = m;
      if (k >= bassLo && k < bassHi) bass += m * m;
      if (k >= centroidLo) {
        magSum += m;
        magFreq += m * k * binHz;
      }
    }
    // chroma from tonal peaks only (local maxima above −60 dBFS), linear magnitude, so that the
    // noise floor and broadband percussion do not wash out the harmony
    for (let k = 1; k < nBins - 1; k++) {
      const pc = pcOfBin[k];
      const m = mag[k];
      if (pc >= 0 && m > 1e-3 && m >= mag[k - 1] && m > mag[k + 1]) chroma[f * CHROMA_COUNT + pc] += m;
    }
    bassPower[f] = bass;
    centroid[f] = magSum > 1e-9 ? magFreq / magSum : 0;

    for (let b = 0; b < nMel; b++) {
      const band = melBands[b];
      let s = 0;
      for (let j = 0; j < band.weights.length; j++) s += mag[band.start + j] * band.weights[j];
      logMel[b] = Math.log(1e-5 + s);
    }
    for (let c = 0; c < MFCC_COUNT; c++) {
      let s = 0;
      for (let b = 0; b < nMel; b++) s += dct[c * nMel + b] * logMel[b];
      mfcc[f * MFCC_COUNT + c] = s;
    }
    if (onFrame && f % progressEvery === 0) onFrame(f, count);
  }
  return { frameRate: sampleRate / hop, count, power, bassPower, centroid, mfcc, chroma };
}

/** log compression knee: magnitudes below ≈ 1/γ (−60 dBFS) contribute almost linearly (i.e. little) */
const LOG_GAMMA = 1000;

export function onsetPass(
  x: Float32Array,
  sampleRate: number,
  fftSize: number,
  onFrame?: (done: number, total: number) => void,
): OnsetFrames {
  const hop = fftSize / 4;
  const count = frameCount(x.length, hop);
  const fft = new RealFFT(fftSize);
  const win = hannWindow(fftSize);
  const buf = new Float64Array(fftSize);
  const nBins = fftSize / 2 + 1;
  const re = new Float64Array(nBins);
  const im = new Float64Array(nBins);
  const mag = new Float64Array(nBins);
  const scale = 4 / fftSize;
  const bands = melFilterbank(fftSize, sampleRate, 36, 30, 8000);
  const nb = bands.length;
  let lowBands = 0;
  while (lowBands < nb && bands[lowBands].centerHz < 200) lowBands++;
  let prev = new Float64Array(nb);
  let cur = new Float64Array(nb);
  const flux = new Float64Array(count);
  const lowFlux = new Float64Array(count);
  const progressEvery = Math.max(1, Math.floor(count / 50));

  for (let f = 0; f < count; f++) {
    windowFrame(x, f * hop, win, buf);
    fft.forward(buf, re, im);
    for (let k = 0; k < nBins; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
    for (let b = 0; b < nb; b++) {
      const band = bands[b];
      let s = 0;
      for (let j = 0; j < band.weights.length; j++) s += mag[band.start + j] * band.weights[j];
      cur[b] = Math.log1p(LOG_GAMMA * s);
    }
    if (f > 0) {
      let total = 0;
      let low = 0;
      for (let b = 0; b < nb; b++) {
        // compare against the max of the neighbouring bands in the previous frame (SuperFlux-style)
        let ref = prev[b];
        if (b > 0 && prev[b - 1] > ref) ref = prev[b - 1];
        if (b + 1 < nb && prev[b + 1] > ref) ref = prev[b + 1];
        const d = cur[b] - ref;
        if (d > 0) {
          total += d;
          if (b < lowBands) low += d;
        }
      }
      flux[f] = total;
      lowFlux[f] = low;
    }
    const t = prev;
    prev = cur;
    cur = t;
    if (onFrame && f % progressEvery === 0) onFrame(f, count);
  }
  return { frameRate: sampleRate / hop, count, flux, lowFlux };
}
