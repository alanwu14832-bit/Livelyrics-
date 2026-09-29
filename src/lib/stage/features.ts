// Blends the pre-computed analysis envelopes (known ahead of time, sample-accurate)
// with the console's live audio features (media-element analyser / microphone),
// and smooths them into pleasant, musical control signals for the shaders.

import { beatPhaseAt, envelopeAt } from "../timeline";
import type { AudioAnalysis } from "../types";
import type { StageState } from "./protocol";
import { PulseGate } from "./safety";

export interface StageAudioFrame {
  /** 0..1 loudness (analysis energy blended with live level) */
  energy: number;
  /** 0..1 live level (for scenes that want the raw signal) */
  level: number;
  bass: number;
  onset: number;
  /** 0..1 analysis brightness (spectral centroid) */
  brightness: number;
  /** 0..1 position in the beat (0 = on the beat) */
  beat: number;
  /** 0..~1.5 beat-synchronous punch (decays across each beat) */
  pulse: number;
}

const num = (x: unknown, fallback = 0) => (typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback);

/** Exponential smoothing with separate attack/release time constants (seconds). */
export function follow(prev: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > prev ? attack : release;
  if (tau <= 0 || dt <= 0) return dt <= 0 ? prev : target;
  const k = 1 - Math.exp(-dt / tau);
  return prev + (target - prev) * k;
}

export interface RawFeatures {
  energy: number;
  level: number;
  bass: number;
  onset: number;
  brightness: number;
  beat: number;
}

/** Unsmoothed blend of analysis and live features at time t. */
export function rawFeatures(analysis: AudioAnalysis | null, state: StageState, t: number): RawFeatures {
  const live = state.audio;
  const lv = { level: num(live?.level), bass: num(live?.bass), onset: num(live?.onset), beat: num(live?.beatPhase) };
  const hasAnalysis = !!analysis && Array.isArray(analysis.energy) && analysis.energy.length > 0;
  const a = hasAnalysis
    ? {
        energy: num(envelopeAt(analysis, "energy", t)),
        bass: num(envelopeAt(analysis, "bass", t)),
        onset: num(envelopeAt(analysis, "onset", t)),
        brightness: num(envelopeAt(analysis, "brightness", t), 0.5),
      }
    : { energy: 0, bass: 0, onset: 0, brightness: 0.5 };
  const hasGrid = !!analysis && ((analysis.beats?.length ?? 0) > 1 || analysis.bpm > 0);
  const liveSignal = lv.level > 0.005 || lv.beat > 0;

  if (state.mode === "live") {
    return {
      energy: Math.max(lv.level, a.energy * 0.45, hasAnalysis || liveSignal ? 0 : 0.35),
      level: lv.level,
      bass: Math.max(lv.bass, a.bass * 0.4),
      onset: Math.max(lv.onset, a.onset * 0.35),
      brightness: a.brightness,
      beat: liveSignal || !hasGrid ? lv.beat : beatPhaseAt(analysis, t),
    };
  }
  return {
    energy: Math.max(a.energy, lv.level * 0.85, hasAnalysis || liveSignal ? 0 : 0.35),
    level: lv.level,
    bass: Math.max(a.bass, lv.bass * 0.85),
    onset: Math.max(a.onset, lv.onset * 0.85),
    brightness: a.brightness,
    // the band's MIDI clock (節拍模式) wins over the analysis beat grid
    beat: hasGrid && live?.clock !== true ? beatPhaseAt(analysis, t) : lv.beat,
  };
}

export interface MixerOptions {
  /**
   * LED 安全模式: slower attacks (no instant spikes), the beat pulse capped at 1 and rate-limited to
   * ≤ 3 rises a second (PulseGate).
   */
  safe?: boolean;
  /** the flash limiter is damping: hold the pulse down */
  hold?: boolean;
}

export class AudioFeatureMixer {
  private s: StageAudioFrame = { energy: 0.3, level: 0, bass: 0, onset: 0, brightness: 0.5, beat: 0, pulse: 0 };
  private playing = 0;
  private primed = false;
  private gate = new PulseGate();

  update(analysis: AudioAnalysis | null, state: StageState, t: number, dt: number, opts: MixerOptions = {}): StageAudioFrame {
    const raw = rawFeatures(analysis, state, t);
    if (!this.primed) {
      this.primed = true;
      this.s = { ...raw, pulse: 0 };
    }
    // while paused keep a little of the moment's character but stop pumping
    this.playing = follow(this.playing, state.playing ? 1 : 0.3, dt, 0.08, 0.35);
    const s = this.s;
    const safe = opts.safe === true;
    s.energy = follow(s.energy, raw.energy, dt, 0.12, 0.6);
    s.level = follow(s.level, raw.level, dt, safe ? 0.08 : 0.03, 0.25);
    s.bass = follow(s.bass, raw.bass, dt, safe ? 0.06 : 0.025, 0.22);
    s.onset = follow(s.onset, raw.onset, dt, safe ? 0.05 : 0.01, 0.16);
    s.brightness = follow(s.brightness, raw.brightness, dt, 0.25, 0.6);
    s.beat = raw.beat;
    const punch = Math.pow(1 - raw.beat, 4);
    const target = (punch * (0.3 + 0.7 * s.energy) + s.onset * 0.45 + s.bass * 0.25) * this.playing;
    if (safe) {
      // a pulse, never a strobe: capped, softer edges, at most SAFE_PULSE_HZ rises a second
      const gated = this.gate.gate(Math.min(1, target), s.pulse, dt, opts.hold === true);
      s.pulse = follow(s.pulse, gated, dt, 0.04, 0.16);
    } else s.pulse = follow(s.pulse, Math.min(1.5, target), dt, 0.012, 0.09);
    return s;
  }
}
