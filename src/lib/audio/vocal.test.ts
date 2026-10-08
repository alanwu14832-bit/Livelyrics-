// Round 14: the 人聲 curve on synthetic stereo mixes — a centre-panned harmonic "voice" (vibrato,
// syllables) in phrases, over wide-panned chords, centre noise drums and a centre bass. Its phrases
// must start where the voice does; a mix of wide stereo only must read as no voice at all.

import { describe, expect, it } from "vitest";
import { detectPhrases } from "../lyrics/align";
import { analyzeSamples, ENVELOPE_RATE } from "./analysis";
import { prng } from "./testing/signals";
import { sideRateFor, sideSignal, VOCAL_RATE } from "./vocal";

const SR = 22050;
const SECONDS = 32;
const PHRASES: Array<[number, number]> = [
  [3, 7],
  [9.2, 13.5],
  [16, 19.4],
  [21.6, 26.5],
];

interface MixOptions {
  voice?: boolean;
  chords?: boolean;
  drums?: boolean;
  bass?: boolean;
  phrases?: Array<[number, number]>;
  seed?: number;
}

/** L / R channels of a small song at 120 BPM. */
function mix(opts: MixOptions = {}): { left: Float32Array; right: Float32Array } {
  const { voice = true, chords = true, drums = true, bass = true, phrases = PHRASES, seed = 11 } = opts;
  const n = SECONDS * SR;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const rand = prng(seed);
  const beat = 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let l = 0;
    let r = 0;
    if (chords) {
      // two guitars panned hard left and right, different voicings: wide, not centred
      const bar = Math.floor(t / 2) % 2;
      const lNotes = bar ? [196, 246.9, 293.7] : [220, 261.6, 329.6];
      const rNotes = bar ? [233.1, 293.7, 349.2] : [174.6, 220, 261.6];
      const strum = 0.55 + 0.45 * Math.exp(-((t % beat) / beat) * 3);
      for (const f of lNotes) for (let h = 1; h <= 4; h++) l += (0.035 / h) * strum * Math.sin(2 * Math.PI * f * h * t + h);
      for (const f of rNotes) for (let h = 1; h <= 4; h++) r += (0.035 / h) * strum * Math.sin(2 * Math.PI * f * h * t + 2 * h);
    }
    let c = 0;
    if (bass) c += 0.12 * Math.sin(2 * Math.PI * (Math.floor(t / 2) % 2 ? 49 : 55) * t);
    if (drums) {
      const k = t % beat;
      c += 0.5 * Math.sin(2 * Math.PI * (55 + 70 * Math.exp(-k * 30)) * k) * Math.exp(-k * 18);
      const s = (t + beat) % (2 * beat);
      if (s < 0.15) c += 0.18 * (rand() * 2 - 1) * Math.exp(-s * 28);
    }
    if (voice) {
      for (const [a, b] of phrases) {
        if (t < a || t >= b) continue;
        const edge = Math.min(1, (t - a) / 0.03, (b - t) / 0.08);
        const syllable = 0.45 + 0.55 * Math.pow(Math.sin(Math.PI * ((t - a) * 4.2)), 2);
        const f0 = 233 * (1 + 0.012 * Math.sin(2 * Math.PI * 5.6 * t)) * (1 + 0.06 * Math.sin(2 * Math.PI * 0.35 * (t - a)));
        const phase = 2 * Math.PI * f0 * t;
        let v = 0;
        // a vowel-like envelope: harmonics near 700 / 1200 / 2600 Hz louder
        for (let h = 1; h <= 16; h++) {
          const hz = 233 * h;
          const formant = 0.3 + Math.exp(-(((hz - 700) / 250) ** 2)) + 0.7 * Math.exp(-(((hz - 1200) / 300) ** 2)) + 0.4 * Math.exp(-(((hz - 2600) / 400) ** 2));
          v += (formant / h ** 0.6) * Math.sin(h * phase);
        }
        c += 0.075 * edge * syllable * v;
      }
    }
    left[i] = l + c;
    right[i] = r + c;
  }
  return { left, right };
}

function analyse(left: Float32Array, right: Float32Array) {
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (left[i] + right[i]);
  return analyzeSamples(mono, SR, { side: sideSignal(left, right, SR), sideRate: sideRateFor(SR) });
}

const meanOver = (curve: number[], a: number, b: number) => {
  const xs = curve.slice(Math.round(a * ENVELOPE_RATE), Math.round(b * ENVELOPE_RATE));
  return xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
};

describe("人聲 curve (synthetic stereo mixes)", () => {
  const full = mix();
  const a = analyse(full.left, full.right);

  it("is an envelope like the others: one 0..1 value per frame, rounded", () => {
    expect(a.vocal).toBeDefined();
    expect(a.vocal!.length).toBe(a.energy.length);
    for (const v of a.vocal!) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.round(v * 10000) / 10000).toBe(v);
    }
  });

  it("finds the voice's phrases: each onset within ±0.25 s, nothing in between", () => {
    const phrases = detectPhrases(a.vocal!, ENVELOPE_RATE);
    expect(phrases.length, JSON.stringify(phrases)).toBe(PHRASES.length);
    PHRASES.forEach(([start], k) => expect(Math.abs(phrases[k].start - start), `phrase ${k}: ${JSON.stringify(phrases[k])}`).toBeLessThanOrEqual(0.25));
    // the voice is clearly higher inside its phrases than in the gaps between them
    expect(meanOver(a.vocal!, 4, 6.5)).toBeGreaterThan(meanOver(a.vocal!, 7.6, 8.8) + 0.3);
  });

  it("does the same for another phrase layout and drum pattern", () => {
    const layout: Array<[number, number]> = [
      [1.5, 4.5],
      [6.1, 9.9],
      [12.3, 17],
      [19.5, 22],
      [24.2, 29.6],
    ];
    const other = mix({ phrases: layout, seed: 5 });
    const phrases = detectPhrases(analyse(other.left, other.right).vocal!, ENVELOPE_RATE);
    expect(phrases.length, JSON.stringify(phrases)).toBe(layout.length);
    layout.forEach(([start], k) => expect(Math.abs(phrases[k].start - start), `phrase ${k}: ${JSON.stringify(phrases[k])}`).toBeLessThanOrEqual(0.25));
  });

  it("a mix of wide stereo only reads as no voice", () => {
    const wide = mix({ voice: false, drums: false, bass: false });
    const w = analyse(wide.left, wide.right);
    expect(detectPhrases(w.vocal!, ENVELOPE_RATE)).toEqual([]);
    expect(Math.max(...w.vocal!)).toBeLessThan(0.5);
  });

  it("so does the backing track without the voice (centred drum hits are not a voice)", () => {
    const backing = mix({ voice: false });
    const b = analyse(backing.left, backing.right);
    expect(detectPhrases(b.vocal!, ENVELOPE_RATE)).toEqual([]);
    expect(Math.max(...b.vocal!)).toBeLessThan(0.5);
  });

  it("keeps analyzeSamples(mono) working without a side channel (the mono model)", () => {
    const mono = new Float32Array(full.left.length);
    for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (full.left[i] + full.right[i]);
    const m = analyzeSamples(mono, SR);
    expect(m.vocal!.length).toBe(m.energy.length);
    expect(meanOver(m.vocal!, 4, 6.5)).toBeGreaterThan(meanOver(m.vocal!, 7.6, 8.8));
    // silence is never a voice
    const silent = analyzeSamples(new Float32Array(SR * 3), SR);
    expect(Math.max(...silent.vocal!)).toBe(0);
  });

  it("the side signal is (L − R) / 2 at the vocal pass rate, and none past 20 minutes", () => {
    const l = Float32Array.from({ length: SR }, (_, i) => Math.sin(i / 7));
    const r = Float32Array.from({ length: SR }, (_, i) => 0.25 * Math.sin(i / 7));
    const side = sideSignal(l, r, VOCAL_RATE)!;
    expect(side[100]).toBeCloseTo(0.375 * Math.sin(100 / 7), 5);
    expect(sideSignal(l, r, SR)!.length).toBe(Math.floor((SR * VOCAL_RATE) / SR));
    expect(sideSignal(new Float32Array(10), new Float32Array(10), 10 / (21 * 60))).toBeNull();
  });
});
