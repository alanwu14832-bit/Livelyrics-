// Pure offline analysis of a mono signal → AudioAnalysis. No DOM / Web Audio dependencies,
// deterministic, so it runs identically in a Web Worker, on the main thread and in Node tests.

import type { AudioAnalysis } from "../types";
import { onsetPass, spectralPass, type SpectralFrames } from "./features";
import { downsample, removeDc, sanitizeSamples } from "./resample";
import { detectSections } from "./segment";
import { clamp01, normalizeBetween, normalizeDb, quantile, round } from "./stats";
import { combinedStrength, estimateTempo, gridBeats, trackBeats } from "./tempo";
import { analyzeVocal } from "./vocal";

export type ProgressCallback = (progress: number, label: string) => void;

export interface AnalyzeOptions {
  /** receives 0..1 and a Traditional-Chinese stage label */
  onProgress?: ProgressCallback;
  /**
   * sample rate of the original recording, reported as `sampleRate` in the result when the
   * caller already converted the samples (e.g. decoded straight to 22.05 kHz)
   */
  sourceSampleRate?: number;
  /**
   * round 14: the side signal (L − R) / 2 of a stereo recording (`sideSignal` in ./vocal, usually at
   * VOCAL_RATE) for the 人聲 curve; without it the curve uses the mono model
   */
  side?: Float32Array | null;
  /** the side signal's sample rate (default: `sampleRate`) */
  sideRate?: number;
}

export const ENVELOPE_RATE = 20;
export const PEAK_BUCKETS = 2000;
export const ANALYSIS_RATE = 22050;

/** absolute level (dBFS power) under which a frame counts as silence */
const SILENCE_DB = -75;
/**
 * The onset envelope of a flux frame peaks slightly before the acoustic attack reaches the
 * window centre; measured on click tracks (see analysis.test.ts) and compensated here.
 */
const ONSET_LATENCY_S = 0.006;
/** below this tempo confidence the beats are a plain grid instead of the DP beat track */
const MIN_TRACKING_CONFIDENCE = 0.15;

export const PROGRESS_LABELS = {
  prepare: "準備分析",
  resample: "重新取樣",
  spectrum: "分析頻譜",
  onsets: "偵測起音",
  tempo: "分析節奏",
  sections: "偵測段落",
  vocal: "偵測人聲",
  done: "分析完成",
} as const;

const toDb = (power: number) => 10 * Math.log10(power + 1e-12);

/** Max |sample| per bucket, 0..1. */
export function computePeaks(x: Float32Array, buckets = PEAK_BUCKETS): number[] {
  const count = Math.min(buckets, x.length);
  const out = new Array<number>(count);
  for (let b = 0; b < count; b++) {
    const from = Math.floor((b * x.length) / count);
    const to = Math.max(from + 1, Math.floor(((b + 1) * x.length) / count));
    let m = 0;
    for (let i = from; i < to; i++) {
      const v = x[i] < 0 ? -x[i] : x[i];
      if (v > m) m = v;
    }
    out[b] = round(Math.min(1, m), 4);
  }
  return out;
}

/** Frame indices (of a series at `srcRate`) whose centres fall within the envelope sample j's window. */
function frameRange(j: number, srcRate: number, count: number, offsetS = 0): [number, number] {
  const t = j / ENVELOPE_RATE - offsetS;
  const half = 0.5 / ENVELOPE_RATE;
  let a = Math.ceil((t - half) * srcRate);
  let b = Math.ceil((t + half) * srcRate) - 1;
  if (b < a) a = b = Math.round(t * srcRate);
  a = Math.max(0, Math.min(count - 1, a));
  b = Math.max(a, Math.min(count - 1, b));
  return [a, b];
}

function levelEnvelope(power: Float64Array, frameRate: number, n: number): { db: Float64Array; norm: Float64Array } {
  const db = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const [a, b] = frameRange(j, frameRate, power.length);
    let s = 0;
    for (let f = a; f <= b; f++) s += power[f];
    db[j] = Math.max(SILENCE_DB - 20, toDb(s / (b - a + 1)));
  }
  const norm = normalizeDb(db);
  for (let j = 0; j < n; j++) if (db[j] < SILENCE_DB) norm[j] = 0;
  return { db, norm };
}

function brightnessEnvelope(spec: SpectralFrames, n: number, loudEnough: (f: number) => boolean): { octaves: Float64Array; norm: Float64Array } {
  const raw = new Float64Array(n).fill(NaN);
  for (let j = 0; j < n; j++) {
    const [a, b] = frameRange(j, spec.frameRate, spec.count);
    let s = 0;
    let c = 0;
    for (let f = a; f <= b; f++) {
      if (spec.centroid[f] > 0 && loudEnough(f)) {
        s += Math.log2(spec.centroid[f]);
        c++;
      }
    }
    if (c > 0) raw[j] = s / c;
  }
  const lo0 = quantile(raw, 0.05);
  const hi0 = quantile(raw, 0.95);
  if (!Number.isFinite(lo0) || !Number.isFinite(hi0)) return { octaves: new Float64Array(n), norm: new Float64Array(n) };
  // at least 1.2 octaves of range so a steady timbre does not flicker across the full scale
  const mid = (lo0 + hi0) / 2;
  const halfRange = Math.max(0.6, (hi0 - lo0) / 2);
  // silent frames hold the last known brightness (or the first one, at the start)
  let first = 0;
  while (first < n && Number.isNaN(raw[first])) first++;
  let last = first < n ? raw[first] : mid;
  for (let j = 0; j < n; j++) {
    if (Number.isNaN(raw[j])) raw[j] = last;
    else last = raw[j];
  }
  return { octaves: raw, norm: normalizeBetween(raw, mid - halfRange, mid + halfRange) };
}

function onsetEnvelope(flux: Float64Array, frameRate: number, n: number): Float64Array {
  // flux above its local (1 s) mean, max-pooled into each envelope frame
  const local = new Float64Array(flux.length);
  const half = Math.round(0.5 * frameRate);
  const prefix = new Float64Array(flux.length + 1);
  for (let i = 0; i < flux.length; i++) prefix[i + 1] = prefix[i] + flux[i];
  for (let i = 0; i < flux.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(flux.length, i + half + 1);
    local[i] = Math.max(0, flux[i] - (prefix[b] - prefix[a]) / (b - a));
  }
  const pooled = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const [a, b] = frameRange(j, frameRate, flux.length, ONSET_LATENCY_S);
    let m = 0;
    for (let f = a; f <= b; f++) if (local[f] > m) m = local[f];
    pooled[j] = m;
  }
  let max = 0;
  for (let j = 0; j < n; j++) if (pooled[j] > max) max = pooled[j];
  const hi = Math.max(quantile(pooled, 0.98), 0.25 * max);
  if (!(hi > 1e-9)) return new Float64Array(n);
  for (let j = 0; j < n; j++) pooled[j] = clamp01(pooled[j] / hi);
  return pooled;
}

function slidingMax(values: ArrayLike<number>, half: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) if (values[k] > m) m = values[k];
    out[i] = m;
  }
  return out;
}

const roundArray = (a: ArrayLike<number>, digits = 4) => Array.from(a, (v) => round(v, digits));

/** Pure offline analysis of mono samples. Deterministic; safe to run in a Worker or in Node tests. */
export function analyzeSamples(mono: Float32Array, sampleRate: number, options: AnalyzeOptions = {}): AudioAnalysis {
  if (!(mono instanceof Float32Array)) throw new TypeError("analyzeSamples: samples must be a Float32Array");
  if (!Number.isFinite(sampleRate) || sampleRate < 1000) throw new RangeError(`analyzeSamples: invalid sample rate ${sampleRate}`);
  let lastReported = -1;
  const report = (p: number, label: string) => {
    if (!options.onProgress) return;
    const q = Math.round(clamp01(p) * 1000) / 1000;
    if (q === lastReported && q !== 1) return;
    lastReported = q;
    options.onProgress(q, label);
  };
  report(0, PROGRESS_LABELS.prepare);

  const clean = sanitizeSamples(mono);
  const duration = clean.length / sampleRate;
  const reportedRate = options.sourceSampleRate && options.sourceSampleRate > 0 ? Math.round(options.sourceSampleRate) : Math.round(sampleRate);
  const peaks = computePeaks(clean);
  const nEnv = Math.floor(duration * ENVELOPE_RATE) + 1;

  let x = clean;
  let sr = sampleRate;
  if (sampleRate > 24000) {
    report(0.01, PROGRESS_LABELS.resample);
    x = downsample(clean, sampleRate, ANALYSIS_RATE);
    sr = ANALYSIS_RATE;
  }
  x = removeDc(x, sr);
  const specSize = sr >= 15000 ? 2048 : 1024;

  report(0.06, PROGRESS_LABELS.spectrum);
  const spectral = spectralPass(x, sr, specSize, (d, t) => report(0.06 + (0.4 * d) / t, PROGRESS_LABELS.spectrum));
  report(0.46, PROGRESS_LABELS.onsets);
  const onsets = onsetPass(x, sr, specSize / 2, (d, t) => report(0.46 + (0.2 * d) / t, PROGRESS_LABELS.onsets));

  const energy = levelEnvelope(spectral.power, spectral.frameRate, nEnv);
  const bass = levelEnvelope(spectral.bassPower, spectral.frameRate, nEnv).norm;
  const frameDb = Array.from(spectral.power, toDb);
  const topDb = quantile(frameDb, 0.97);
  const audibleDb = Math.max(SILENCE_DB, topDb - 50);
  // centroid only from frames near the local level (decay tails between hits read as "dark")
  const localTop = slidingMax(frameDb, Math.round(0.25 * spectral.frameRate));
  const bright = brightnessEnvelope(spectral, nEnv, (f) => frameDb[f] > audibleDb && frameDb[f] > localTop[f] - 30);
  const brightness = bright.norm;
  const onset = onsetEnvelope(onsets.flux, onsets.frameRate, nEnv);

  report(0.68, PROGRESS_LABELS.tempo);
  const strength = combinedStrength(onsets.flux, onsets.lowFlux, onsets.frameRate);
  const tempo = estimateTempo(strength, onsets.frameRate);
  let bpm = tempo.bpm;
  let beats: number[] = [];
  if (bpm > 0) {
    // musical span: first..last frame within 40 dB of the loud parts
    let firstActive = frameDb.findIndex((d) => d > Math.max(SILENCE_DB, topDb - 40));
    let lastActive = frameDb.length - 1;
    while (lastActive > 0 && !(frameDb[lastActive] > Math.max(SILENCE_DB, topDb - 40))) lastActive--;
    if (firstActive < 0) firstActive = 0;
    const spanStart = firstActive / spectral.frameRate - 0.1;
    const spanEnd = lastActive / spectral.frameRate + 0.1;
    const fr = onsets.frameRate;
    const toSeconds = (f: number) => f / fr + ONSET_LATENCY_S;
    // weak periodicity: a strict grid is more useful on stage than a DP path chasing noise
    if (tempo.confidence >= MIN_TRACKING_CONFIDENCE) {
      const track = trackBeats(strength, fr, bpm);
      beats = track.frames.map(toSeconds).filter((t) => t >= spanStart && t <= spanEnd && t >= 0 && t <= duration);
      if (beats.length >= 4 && track.period > 0) bpm = (60 * fr) / track.period;
    }
    if (beats.length < 4) {
      beats = gridBeats(strength, fr, bpm, Math.max(0, Math.round(spanStart * fr)), Math.min(strength.length - 1, Math.round(spanEnd * fr)))
        .map(toSeconds)
        .filter((t) => t >= 0 && t <= duration);
    }
  }

  report(0.82, PROGRESS_LABELS.sections);
  const sections = detectSections({
    duration,
    spectral,
    env: {
      rate: ENVELOPE_RATE,
      energy: energy.norm,
      onset,
      bass,
      brightness,
      centroidOctaves: bright.octaves,
    },
    beats,
    bpm,
  });

  // round 14: the 人聲 curve (centre-panned, voice-shaped energy against its local context)
  report(0.9, PROGRESS_LABELS.vocal);
  const side = options.side instanceof Float32Array && options.side.length > 0 ? sanitizeSamples(options.side) : null;
  const vocal = analyzeVocal(x, sr, side, side ? (options.sideRate && options.sideRate > 0 ? options.sideRate : sampleRate) : sr, { energy: energy.norm, onset, brightness, bass }, nEnv, ENVELOPE_RATE);

  const result: AudioAnalysis = {
    duration: round(duration, 3),
    sampleRate: reportedRate,
    bpm: round(bpm, 2),
    bpmConfidence: round(bpm > 0 ? tempo.confidence : 0, 3),
    beats: beats.map((t) => round(t, 3)),
    envelopeRate: ENVELOPE_RATE,
    energy: roundArray(energy.norm),
    onset: roundArray(onset),
    brightness: roundArray(brightness),
    bass: roundArray(bass),
    vocal: roundArray(vocal),
    peaks,
    sections: sections.map((s) => ({ start: round(s.start, 3), end: round(s.end, 3), energy: round(s.energy, 4) })),
  };
  report(1, PROGRESS_LABELS.done);
  return result;
}
