// Pure real-time feature extraction for the live analysers (media element / microphone).
// Kept free of Web Audio so it can be unit tested with synthetic frames.

import type { LiveAudioFeatures } from "../stage/protocol";

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Number.isFinite(x) ? x : 0);

/** Exponential follower with separate attack/release time constants (seconds). */
function follow(prev: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > prev ? attack : release;
  if (dt <= 0) return prev;
  if (tau <= 0) return target;
  return prev + (target - prev) * (1 - Math.exp(-dt / tau));
}

export interface AdaptiveRangeOptions {
  /** the window never gets narrower than this (dB) */
  minRange: number;
  initialPeak: number;
  initialFloor: number;
  /** values below this absolute level (dB) read as silence */
  gate: number;
  /** seconds for the peak to relax towards quieter material */
  peakRelease?: number;
  /** seconds for the floor to rise towards louder material */
  floorRise?: number;
}

/**
 * Tracks a running loud reference (instant attack, slow release) and quiet reference (fast
 * fall, slow rise) of a dB signal and maps the current value into 0..1 between them, so the
 * output adapts to any input gain (line-in, room mic, quiet master) within a few seconds.
 */
export class AdaptiveRange {
  private peak: number;
  private floor: number;
  constructor(private readonly o: AdaptiveRangeOptions) {
    this.peak = o.initialPeak;
    this.floor = o.initialFloor;
  }

  update(db: number, dt: number): number {
    const x = Number.isFinite(db) ? db : -200;
    if (x < this.o.gate) {
      // silence: let the references relax slowly but do not learn from it
      const tau = (this.o.peakRelease ?? 8) * 2;
      this.peak = follow(this.peak, this.o.initialPeak, dt, tau, tau);
      return 0;
    }
    this.peak = x > this.peak ? x : follow(this.peak, x, dt, 0, this.o.peakRelease ?? 8);
    this.floor = x < this.floor ? follow(this.floor, x, dt, 0, 0.4) : follow(this.floor, x, dt, this.o.floorRise ?? 6, 0);
    const range = Math.max(this.o.minRange, this.peak - this.floor);
    return clamp01((x - (this.peak - range)) / range);
  }
}

/** Tap tempo: median of the recent tap intervals; a gap longer than `resetAfter` starts over. */
export class TapTempo {
  private taps: number[] = [];
  constructor(
    private readonly resetAfter = 2,
    private readonly maxTaps = 8,
  ) {}

  /** Register a tap at time `now` (seconds). Returns the tapped BPM once two taps exist, else null. */
  tap(now: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last != null && (now - last > this.resetAfter || now < last)) this.taps = [];
    // ignore bounces (> 300 BPM)
    if (last != null && now - last < 0.2 && now >= last) return this.bpm();
    this.taps.push(now);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    return this.bpm();
  }

  reset(): void {
    this.taps = [];
  }

  get count(): number {
    return this.taps.length;
  }

  private bpm(): number | null {
    if (this.taps.length < 2) return null;
    const intervals: number[] = [];
    for (let i = 1; i < this.taps.length; i++) intervals.push(this.taps[i] - this.taps[i - 1]);
    intervals.sort((a, b) => a - b);
    const mid = intervals.length >> 1;
    const median = intervals.length % 2 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2;
    if (!(median > 0)) return null;
    const bpm = 60 / median;
    return bpm >= 30 && bpm <= 300 ? bpm : null;
  }
}

export interface ExtractorOptions {
  sampleRate: number;
  fftSize: number;
  /** nudge the beat grid towards detected onsets (default true) */
  phaseLock?: boolean;
}

/**
 * Turns analyser snapshots (time-domain samples + dB spectrum) into smoothed 0..1 features and
 * a beat phase driven by setBpm / tap tempo, gently phase-locked to detected onsets.
 */
export class LiveFeatureExtractor {
  private readonly binHz: number;
  private readonly bassBins: number;
  private readonly fluxBins: number;
  private prevSpectrum: Float32Array | null = null;
  private lastTime: number | null = null;
  private readonly levelRange = new AdaptiveRange({ minRange: 24, initialPeak: -16, initialFloor: -46, gate: -70 });
  private readonly bassRange = new AdaptiveRange({ minRange: 24, initialPeak: -20, initialFloor: -52, gate: -85 });
  private level = 0;
  private bass = 0;
  private onset = 0;
  private fluxMean = 0;
  private fluxPeak = 1;
  private prevOnsetRaw = 0;
  private lastOnsetAt = -Infinity;
  private period: number | null = null;
  private anchor: number | null = null;
  private readonly taps = new TapTempo();
  private readonly phaseLock: boolean;

  constructor(opts: ExtractorOptions) {
    this.binHz = opts.sampleRate / opts.fftSize;
    const nBins = opts.fftSize / 2;
    this.bassBins = Math.max(1, Math.min(nBins, Math.round(150 / this.binHz)));
    this.fluxBins = Math.max(2, Math.min(nBins, Math.round(8000 / this.binHz)));
    this.phaseLock = opts.phaseLock ?? true;
  }

  /** current tempo in BPM (0 when none is set) */
  get bpm(): number {
    return this.period ? 60 / this.period : 0;
  }

  setBpm(bpm: number, now: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      this.period = null;
      return;
    }
    this.period = 60 / Math.min(300, Math.max(20, bpm));
    if (this.anchor == null) this.anchor = now;
  }

  /** Manual beat: re-anchors the phase to `now` and updates the tapped tempo. */
  tap(now: number): void {
    const bpm = this.taps.tap(now);
    if (bpm != null) this.period = 60 / bpm;
    this.anchor = now;
  }

  beatPhase(now: number): number {
    if (this.period && this.anchor != null) {
      const x = (now - this.anchor) / this.period;
      const f = x - Math.floor(x);
      return clamp01(f);
    }
    // no tempo: a saw that restarts on every detected onset (fully decayed when nothing happens)
    if (!Number.isFinite(this.lastOnsetAt)) return 1;
    return clamp01((now - this.lastOnsetAt) / 0.5);
  }

  /** Features for a silent frame (analyser unavailable / disposed), keeping the beat clock running. */
  silent(now: number): LiveAudioFeatures {
    this.lastTime = now;
    this.level = this.bass = this.onset = 0;
    return { level: 0, bass: 0, onset: 0, beatPhase: this.beatPhase(now) };
  }

  process(timeDomain: Float32Array, spectrumDb: Float32Array, now: number): LiveAudioFeatures {
    const dt = this.lastTime == null ? 1 / 60 : Math.min(0.5, Math.max(0, now - this.lastTime));
    this.lastTime = now;

    let ss = 0;
    for (let i = 0; i < timeDomain.length; i++) {
      const v = timeDomain[i];
      if (Number.isFinite(v)) ss += v * v;
    }
    const levelDb = 20 * Math.log10(Math.sqrt(ss / Math.max(1, timeDomain.length)) + 1e-9);

    let bassPower = 0;
    for (let k = 1; k < this.bassBins && k < spectrumDb.length; k++) {
      const db = spectrumDb[k];
      if (Number.isFinite(db)) bassPower += 10 ** (db / 10);
    }
    const bassDb = 10 * Math.log10(bassPower + 1e-12);

    // log-spectral flux (dB rises per bin), half-wave rectified
    let flux = 0;
    const prev = this.prevSpectrum;
    const bins = Math.min(this.fluxBins, spectrumDb.length);
    if (prev && prev.length === spectrumDb.length) {
      for (let k = 1; k < bins; k++) {
        const a = Math.max(-100, Number.isFinite(spectrumDb[k]) ? spectrumDb[k] : -100);
        const b = Math.max(-100, Number.isFinite(prev[k]) ? prev[k] : -100);
        if (a > b) flux += a - b;
      }
      flux /= bins;
      prev.set(spectrumDb);
    } else {
      this.prevSpectrum = Float32Array.from(spectrumDb);
    }

    const level01 = this.levelRange.update(levelDb, dt);
    const bass01 = this.bassRange.update(bassDb, dt);
    this.level = follow(this.level, level01, dt, 0.03, 0.25);
    this.bass = follow(this.bass, bass01, dt, 0.025, 0.2);

    // adaptive onset scaling: running mean, decaying peak of the excess
    this.fluxMean = follow(this.fluxMean, flux, dt, 0.6, 0.6);
    const excess = Math.max(0, flux - this.fluxMean);
    this.fluxPeak = Math.max(0.5, excess > this.fluxPeak ? excess : follow(this.fluxPeak, excess, dt, 0, 4));
    const onsetRaw = level01 > 0 ? clamp01(excess / this.fluxPeak) : 0;
    this.onset = Math.max(onsetRaw, this.onset * Math.exp(-dt / 0.12));

    if (onsetRaw >= 0.5 && onsetRaw > this.prevOnsetRaw && now - this.lastOnsetAt >= 0.1) this.onOnset(now);
    this.prevOnsetRaw = onsetRaw;

    return { level: clamp01(this.level), bass: clamp01(this.bass), onset: clamp01(this.onset), beatPhase: this.beatPhase(now) };
  }

  private onOnset(now: number): void {
    this.lastOnsetAt = now;
    if (!this.phaseLock || !this.period || this.anchor == null) return;
    // pull the grid a little towards onsets that land near a predicted beat
    const x = (now - this.anchor) / this.period;
    const err = x - Math.round(x);
    if (Math.abs(err) <= 0.2) this.anchor += err * this.period * 0.15;
  }
}
