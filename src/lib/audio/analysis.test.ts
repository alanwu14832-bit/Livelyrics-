import { describe, expect, it } from "vitest";
import type { AudioAnalysis } from "../types";
import { ENVELOPE_RATE, PEAK_BUCKETS, PROGRESS_LABELS, analyzeSamples } from "./analysis";
import { clickTrack, prng, sectionedSong, whiteNoise } from "./testing/signals";

/** signed error (s) from each true beat to the nearest detected beat, skipping the edges */
function beatErrors(a: AudioAnalysis, truth: number[], margin = 1): number[] {
  return truth
    .filter((t) => t > margin && t < a.duration - margin)
    .map((t) => {
      let best = Infinity;
      for (const b of a.beats) if (Math.abs(b - t) < Math.abs(best)) best = b - t;
      return best;
    });
}

function expectEnvelopes(a: AudioAnalysis) {
  const n = Math.floor(a.duration * ENVELOPE_RATE) + 1;
  for (const key of ["energy", "onset", "brightness", "bass"] as const) {
    expect(a[key]).toHaveLength(n);
    for (const v of a[key]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  }
}

/** Kick on 1 & 3, snare on 2 & 4, hats on eighths or sixteenths, bass on the downbeat, a pad. */
function groove(bpm: number, seconds: number, subdivision: 2 | 4, sr = 22050): { samples: Float32Array; beats: number[] } {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const rand = prng(bpm);
  const beat = 60 / bpm;
  const beats: number[] = [];
  const add = (t: number, len: number, fn: (tt: number) => number) => {
    const i0 = Math.round(t * sr);
    for (let k = 0; k < len * sr && i0 + k < n; k++) out[i0 + k] += fn(k / sr);
  };
  for (let b = 0, t = 0.2; t < seconds - 0.3; b++, t += beat) {
    beats.push(t);
    const inBar = b % 4;
    if (inBar % 2 === 0) add(t, 0.2, (tt) => Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-tt * 35)) * tt) * Math.exp(-tt * 18) * 0.8);
    else add(t, 0.15, (tt) => (rand() * 2 - 1) * Math.exp(-tt * 22) * 0.5 + Math.sin(2 * Math.PI * 190 * tt) * Math.exp(-tt * 30) * 0.3);
    for (let h = 0; h < subdivision; h++) add(t + (h * beat) / subdivision, 0.04, (tt) => (rand() * 2 - 1) * Math.exp(-tt * 90) * (h === 0 ? 0.18 : 0.12));
    if (inBar === 0) add(t, beat * 1.4, (tt) => Math.sin(2 * Math.PI * 55 * tt) * Math.min(1, tt * 60) * Math.exp(-tt * 3) * 0.35);
  }
  for (let i = 0; i < n; i++) out[i] += 0.03 * (Math.sin((2 * Math.PI * 220 * i) / sr) + Math.sin((2 * Math.PI * 330 * i) / sr));
  return { samples: out, beats };
}

describe("analyzeSamples: tempo & beats", () => {
  it.each([100, 120, 150])("click track at %i BPM → octave-correct tempo and aligned beats", (bpm) => {
    const { samples, clicks } = clickTrack(bpm, 30, 44100);
    const a = analyzeSamples(samples, 44100);
    expect(Math.abs(a.bpm - bpm)).toBeLessThanOrEqual(2);
    expect(a.bpmConfidence).toBeGreaterThan(0.6);
    const errs = beatErrors(a, clicks);
    expect(errs.every((e) => Math.abs(e) <= 0.05)).toBe(true);
    expect(errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length).toBeLessThan(0.02);
    // one beat per click, no doubled / halved grid
    expect(Math.abs(a.beats.length - clicks.length)).toBeLessThanOrEqual(2);
  });

  it.each([
    [75, 4],
    [90, 2],
    [128, 4],
    [160, 2],
    [174, 2],
  ] as const)("drum groove at %i BPM (1/%i hats) is octave-correct and on the beat, not the off-beat", (bpm, sub) => {
    const { samples, beats } = groove(bpm, 40, sub);
    const a = analyzeSamples(samples, 22050);
    expect(Math.abs(a.bpm - bpm)).toBeLessThanOrEqual(2);
    const errs = beatErrors(a, beats, 2);
    expect(errs.filter((e) => Math.abs(e) <= 0.05).length / errs.length).toBeGreaterThan(0.95);
  });

  it("follows a gradual tempo drift (live band 118 → 126 BPM)", () => {
    const sr = 22050;
    const seconds = 60;
    const out = new Float32Array(sr * seconds);
    const truth: number[] = [];
    const rand = prng(4);
    for (let t = 0.3, b = 0; t < seconds - 0.5; b++) {
      truth.push(t);
      const i0 = Math.round(t * sr);
      for (let k = 0; k < 0.2 * sr && i0 + k < out.length; k++) {
        const tt = k / sr;
        out[i0 + k] += b % 2 === 0 ? Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-tt * 35)) * tt) * Math.exp(-tt * 18) * 0.8 : (rand() * 2 - 1) * Math.exp(-tt * 22) * 0.5;
      }
      t += 60 / (118 + (8 * t) / seconds);
    }
    const a = analyzeSamples(out, sr);
    expect(a.bpm).toBeGreaterThan(118);
    expect(a.bpm).toBeLessThan(126);
    const errs = beatErrors(a, truth, 2);
    expect(errs.filter((e) => Math.abs(e) <= 0.05).length / errs.length).toBeGreaterThan(0.95);
  });

  it("still returns a regular grid with low confidence for arrhythmic noise", () => {
    const a = analyzeSamples(whiteNoise(30, 22050), 22050);
    expect(a.bpmConfidence).toBeLessThan(0.3);
    expect(a.bpm).toBeGreaterThanOrEqual(70);
    expect(a.bpm).toBeLessThanOrEqual(180);
    expect(a.beats.length).toBeGreaterThan(10);
    const period = 60 / a.bpm;
    for (let i = 1; i < a.beats.length; i++) expect(Math.abs(a.beats[i] - a.beats[i - 1] - period)).toBeLessThan(0.02);
  });

  it("reports no tempo for silence, a constant (DC) signal or a lone click", () => {
    const silence = analyzeSamples(new Float32Array(22050 * 10), 22050);
    expect(silence.bpm).toBe(0);
    expect(silence.beats).toEqual([]);
    expect(silence.energy.every((v) => v === 0)).toBe(true);
    expect(analyzeSamples(new Float32Array(22050 * 10).fill(0.3), 22050).bpm).toBe(0);
    const lone = new Float32Array(22050 * 10);
    lone.fill(0.9, 22050 * 5, 22050 * 5 + 200);
    expect(analyzeSamples(lone, 22050).bpm).toBe(0);
  });

  it("keeps beats inside the audible span (no beats in leading / trailing silence)", () => {
    const sr = 22050;
    const x = new Float32Array(sr * 40);
    const { samples } = clickTrack(110, 25, sr);
    x.set(samples, sr * 8);
    const a = analyzeSamples(x, sr);
    expect(Math.abs(a.bpm - 110)).toBeLessThan(1);
    expect(a.beats[0]).toBeGreaterThan(8);
    expect(a.beats[a.beats.length - 1]).toBeLessThan(33.2);
  });
});

describe("analyzeSamples: sections", () => {
  it("finds quiet → loud → quiet boundaries within 2 s, with matching energies", () => {
    const song = sectionedSong(
      128,
      [
        { seconds: 20, gain: 0.25, drums: false },
        { seconds: 30, gain: 1, drums: true },
        { seconds: 20, gain: 0.25, drums: false },
      ],
      44100,
    );
    const a = analyzeSamples(song.samples, 44100);
    expect(a.sections).toHaveLength(3);
    expect(a.sections[0].start).toBe(0);
    expect(a.sections[2].end).toBeCloseTo(a.duration, 3);
    expect(Math.abs(a.sections[1].start - 20)).toBeLessThan(2);
    expect(Math.abs(a.sections[2].start - 50)).toBeLessThan(2);
    expect(a.sections[1].energy).toBeGreaterThan(a.sections[0].energy + 0.2);
    expect(a.sections[1].energy).toBeGreaterThan(a.sections[2].energy + 0.2);
    // boundaries are snapped onto the beat grid
    for (const s of a.sections.slice(1)) expect(Math.min(...a.beats.map((b) => Math.abs(b - s.start)))).toBeLessThan(0.02);
  });

  it("covers the song contiguously and respects the minimum section length", () => {
    const song = sectionedSong(
      124,
      [
        { seconds: 45, gain: 0.4, drums: true },
        { seconds: 45, gain: 1, drums: true },
        { seconds: 45, gain: 0.3, drums: false },
        { seconds: 45, gain: 1, drums: true },
      ],
      22050,
    );
    const a = analyzeSamples(song.samples, 22050);
    expect(a.sections.map((s) => s.start)).toHaveLength(4);
    song.boundaries.forEach((b, i) => expect(Math.abs(a.sections[i + 1].start - b)).toBeLessThan(2));
    for (let i = 0; i < a.sections.length; i++) {
      const s = a.sections[i];
      expect(s.end - s.start).toBeGreaterThanOrEqual(7.5);
      if (i > 0) expect(s.start).toBe(a.sections[i - 1].end);
    }
  });

  it("segments a pop arrangement (intro/verse/pre/chorus/bridge/outro with vocals, fills, chord changes)", { timeout: 30_000 }, () => {
    const sr = 22050;
    const beat = 60 / 96;
    const bar = 4 * beat;
    type Part = { bars: number; gain: number; drums: boolean; bass: boolean; vocal: number };
    const intro: Part = { bars: 4, gain: 0.3, drums: false, bass: false, vocal: 0 };
    const verse: Part = { bars: 8, gain: 0.55, drums: true, bass: true, vocal: 0.5 };
    const pre: Part = { bars: 4, gain: 0.7, drums: true, bass: true, vocal: 0.7 };
    const chorus: Part = { bars: 8, gain: 1, drums: true, bass: true, vocal: 1 };
    const bridge: Part = { bars: 4, gain: 0.4, drums: false, bass: true, vocal: 0.6 };
    const outro: Part = { bars: 4, gain: 0.25, drums: false, bass: false, vocal: 0 };
    const plan = [intro, verse, pre, chorus, verse, chorus, bridge, chorus, outro];
    const totalBars = plan.reduce((acc, p) => acc + p.bars, 0);
    const n = Math.round((totalBars * bar + 2) * sr);
    const out = new Float32Array(n);
    const rand = prng(21);
    const chords = [
      [220, 261.63, 329.63],
      [174.61, 220, 261.63],
      [196, 246.94, 293.66],
      [164.81, 196, 246.94],
    ];
    const add = (t: number, len: number, fn: (tt: number, abs: number) => number) => {
      const i0 = Math.round(t * sr);
      for (let k = 0; k < len * sr && i0 + k < n; k++) out[i0 + k] += fn(k / sr, t + k / sr);
    };
    const truth: number[] = [];
    let t = 0;
    for (const part of plan) {
      if (t > 0) truth.push(t);
      for (let b = 0; b < part.bars; b++) {
        const bt = t + b * bar;
        const ch = chords[b % 4];
        add(bt, bar, (tt, abs) => ch.reduce((acc, f) => acc + Math.sin(2 * Math.PI * f * abs) + 0.3 * Math.sin(4 * Math.PI * f * abs), 0) * 0.035 * (0.5 + part.gain) * Math.min(1, tt * 20));
        for (let q = 0; q < 4; q++) {
          const qt = bt + q * beat;
          if (part.drums) {
            if (q % 2 === 0) add(qt, 0.2, (tt) => Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-tt * 35)) * tt) * Math.exp(-tt * 18) * 0.7 * part.gain);
            else add(qt, 0.15, (tt) => (rand() * 2 - 1) * Math.exp(-tt * 22) * 0.4 * part.gain);
            for (let h = 0; h < 2; h++) add(qt + (h * beat) / 2, 0.04, (tt) => (rand() * 2 - 1) * Math.exp(-tt * 90) * 0.12 * part.gain);
            // drum fill at the end of each part
            if (b === part.bars - 1 && q === 3) for (let f = 1; f < 4; f++) add(qt + (f * beat) / 4, 0.1, (tt) => (rand() * 2 - 1) * Math.exp(-tt * 30) * 0.3 * part.gain);
          }
          if (part.bass) add(qt, beat * 0.9, (tt) => Math.sin(Math.PI * ch[0] * tt) * Math.min(1, tt * 80) * Math.exp(-tt * 2) * 0.3 * part.gain);
        }
        // sung phrases with vibrato, resting every fourth bar
        if (part.vocal > 0 && b % 4 !== 3) {
          [ch[2], ch[1], ch[2], ch[0]].forEach((f, i) =>
            add(bt + i * beat, beat * 0.95, (tt) => Math.sin(4 * Math.PI * f * tt + 3 * Math.sin(2 * Math.PI * 5.5 * tt)) * Math.min(1, tt * 15) * 0.12 * part.vocal * (0.5 + part.gain)),
          );
        }
      }
      t += part.bars * bar;
    }
    const a = analyzeSamples(out, sr);
    expect(Math.abs(a.bpm - 96)).toBeLessThan(1);
    const starts = a.sections.slice(1).map((s) => s.start);
    expect(starts).toHaveLength(truth.length);
    truth.forEach((b, i) => expect(Math.abs(starts[i] - b)).toBeLessThan(2));
    const e = a.sections.map((s) => s.energy);
    expect(e[3]).toBeGreaterThan(e[1]); // chorus > verse
    expect(e[1]).toBeGreaterThan(e[0]); // verse > intro
  });

  it("detects a harmony-only change (same loudness, new chord)", () => {
    const sr = 22050;
    const out = new Float32Array(sr * 60);
    const chordA = [220, 277.18, 329.63];
    const chordB = [174.61, 220, 261.63, 311.13];
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let v = 0;
      for (const f of t < 30 ? chordA : chordB) v += Math.sin(2 * Math.PI * f * t);
      out[i] = 0.08 * v;
    }
    for (let bt = 0; bt < 60; bt += 0.6) {
      const k0 = Math.round(bt * sr);
      for (let k = 0; k < 3000 && k0 + k < out.length; k++) {
        const tt = k / sr;
        out[k0 + k] += Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 20) * 0.6;
      }
    }
    const a = analyzeSamples(out, sr);
    expect(a.sections).toHaveLength(2);
    expect(Math.abs(a.sections[1].start - 30)).toBeLessThan(2);
  });

  it("does not split steady material (loops, clicks, noise) into sections", () => {
    const loop = sectionedSong(
      120,
      [
        { seconds: 30, gain: 1, drums: true },
        { seconds: 30, gain: 1, drums: true },
      ],
      22050,
    );
    expect(analyzeSamples(loop.samples, 22050).sections).toHaveLength(1);
    for (const bpm of [75, 90, 170]) expect(analyzeSamples(clickTrack(bpm, 30, 22050).samples, 22050).sections).toHaveLength(1);
    expect(analyzeSamples(whiteNoise(30, 22050), 22050).sections).toHaveLength(1);
  });
});

describe("analyzeSamples: envelopes, peaks & robustness", () => {
  it("normalizes envelopes robustly (percentile-based: one spike does not flatten the song)", () => {
    const song = sectionedSong(120, [{ seconds: 30, gain: 0.5, drums: true }], 22050);
    const spiked = song.samples.slice();
    // a single hit far louder than anything else
    for (let i = 0; i < 400; i++) spiked[22050 * 15 + i] = i % 2 ? 1 : -1;
    const plain = analyzeSamples(song.samples, 22050);
    const a = analyzeSamples(spiked, 22050);
    expectEnvelopes(a);
    const med = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)];
    for (const key of ["energy", "onset", "bass"] as const) {
      expect(Math.abs(med(a[key]) - med(plain[key]))).toBeLessThan(0.05);
      expect(Math.max(...a[key])).toBe(1);
    }
    // the loud material itself reaches the top of the scale
    expect(Math.max(...plain.energy)).toBe(1);
  });

  it("maps quiet passages low but above zero, loud passages near one", () => {
    const song = sectionedSong(
      120,
      [
        { seconds: 20, gain: 0.25, drums: false },
        { seconds: 20, gain: 1, drums: true },
      ],
      22050,
    );
    const a = analyzeSamples(song.samples, 22050);
    const avg = (from: number, to: number) => {
      const s = a.energy.slice(from * ENVELOPE_RATE, to * ENVELOPE_RATE);
      return s.reduce((p, q) => p + q, 0) / s.length;
    };
    expect(avg(2, 18)).toBeGreaterThan(0.05);
    expect(avg(2, 18)).toBeLessThan(0.45);
    expect(avg(22, 38)).toBeGreaterThan(0.6);
    const bassQuiet = a.bass.slice(2 * ENVELOPE_RATE, 18 * ENVELOPE_RATE);
    const bassLoud = a.bass.slice(22 * ENVELOPE_RATE, 38 * ENVELOPE_RATE);
    expect(Math.max(...bassLoud)).toBeGreaterThan(Math.max(...bassQuiet));
  });

  it("returns ~2000 waveform peaks in 0..1 and reports the input sample rate / duration", () => {
    const sr = 48000;
    const x = new Float32Array(sr * 12);
    for (let i = 0; i < x.length; i++) x[i] = (i < x.length / 2 ? 0.25 : 0.8) * Math.sin((2 * Math.PI * 440 * i) / sr);
    const a = analyzeSamples(x, sr);
    expect(a.sampleRate).toBe(48000);
    expect(a.duration).toBe(12);
    expect(a.peaks).toHaveLength(PEAK_BUCKETS);
    expect(a.peaks[100]).toBeCloseTo(0.25, 2);
    expect(a.peaks[1900]).toBeCloseTo(0.8, 2);
    expect(analyzeSamples(x.subarray(0, 22050), 22050, { sourceSampleRate: 44100 }).sampleRate).toBe(44100);
  });

  it.each([8000, 11025, 16000, 32000, 96000])("works at %i Hz", (sr) => {
    const { samples } = clickTrack(126, 20, sr);
    const a = analyzeSamples(samples, sr);
    expect(Math.abs(a.bpm - 126)).toBeLessThanOrEqual(2);
    expect(a.duration).toBeCloseTo(20, 2);
    expectEnvelopes(a);
  });

  it("handles empty, tiny and corrupt input", () => {
    const empty = analyzeSamples(new Float32Array(0), 44100);
    expect(empty.duration).toBe(0);
    expect(empty.bpm).toBe(0);
    expect(empty.peaks).toEqual([]);
    expect(empty.sections).toEqual([]);
    expectEnvelopes(empty);
    const tiny = analyzeSamples(new Float32Array(100).fill(0.5), 44100);
    expectEnvelopes(tiny);
    expect(tiny.sections).toHaveLength(1);
    const { samples } = clickTrack(120, 20, 44100);
    for (let i = 0; i < samples.length; i += 997) samples[i] = NaN;
    samples[5] = Infinity;
    const dirty = analyzeSamples(samples, 44100);
    expect(Math.abs(dirty.bpm - 120)).toBeLessThan(1);
    expectEnvelopes(dirty);
    expect(JSON.stringify(dirty)).not.toMatch(/null|NaN|Infinity/);
  });

  it("rejects invalid arguments", () => {
    expect(() => analyzeSamples(new Float32Array(10), 0)).toThrow(RangeError);
    expect(() => analyzeSamples(new Float32Array(10), NaN)).toThrow(RangeError);
    expect(() => analyzeSamples([0, 1] as unknown as Float32Array, 44100)).toThrow(TypeError);
  });

  it("does not modify the caller's samples", () => {
    const { samples } = clickTrack(120, 5, 22050);
    const copy = samples.slice();
    analyzeSamples(samples, 22050);
    expect(samples).toEqual(copy);
  });

  it("is deterministic", () => {
    const song = sectionedSong(
      118,
      [
        { seconds: 20, gain: 0.3, drums: false },
        { seconds: 20, gain: 1, drums: true },
      ],
      44100,
    );
    expect(JSON.stringify(analyzeSamples(song.samples, 44100))).toBe(JSON.stringify(analyzeSamples(song.samples.slice(), 44100)));
  });

  it("reports monotonic progress with Traditional Chinese labels", () => {
    const events: [number, string][] = [];
    analyzeSamples(clickTrack(120, 10, 44100).samples, 44100, { onProgress: (p, l) => events.push([p, l]) });
    expect(events[0]).toEqual([0, PROGRESS_LABELS.prepare]);
    expect(events[events.length - 1]).toEqual([1, PROGRESS_LABELS.done]);
    for (let i = 1; i < events.length; i++) expect(events[i][0]).toBeGreaterThanOrEqual(events[i - 1][0]);
    const labels = new Set(events.map((e) => e[1]));
    for (const l of [PROGRESS_LABELS.resample, PROGRESS_LABELS.spectrum, PROGRESS_LABELS.tempo, PROGRESS_LABELS.sections]) expect(labels.has(l)).toBe(true);
  });

  it("analyses 3 minutes of 44.1 kHz audio quickly", { timeout: 60_000 }, () => {
    const base = sectionedSong(
      124,
      [
        { seconds: 45, gain: 0.4, drums: true },
        { seconds: 45, gain: 1, drums: true },
        { seconds: 45, gain: 0.3, drums: false },
        { seconds: 45, gain: 1, drums: true },
      ],
      44100,
    ).samples;
    const t0 = performance.now();
    const a = analyzeSamples(base, 44100);
    const ms = performance.now() - t0;
    expect(a.duration).toBeCloseTo(180, 1);
    expect(Math.abs(a.bpm - 124)).toBeLessThan(1);
    // ≈1 s on a laptop; generous bound for loaded CI machines
    expect(ms).toBeLessThan(8000);
    // compact enough to POST as JSON
    expect(JSON.stringify(a).length).toBeLessThan(200_000);
  });
});
