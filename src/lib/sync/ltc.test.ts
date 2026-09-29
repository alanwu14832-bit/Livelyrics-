import { describe, expect, it } from "vitest";
import { LtcDecoder, type LtcFrame } from "./ltc";
import { encodeLtc, labelAfter, type LtcEncodeOptions } from "./testing/ltc-encoder";
import { formatTc, type FrameRate, type Timecode } from "./timecode";

const tc = (hours: number, minutes: number, seconds: number, frames: number): Timecode => ({ hours, minutes, seconds, frames });
const label = (f: LtcFrame) => formatTc(f);

/** Decode in 128-sample render quanta, as the AudioWorklet does. */
function decode(samples: Float32Array, sampleRate: number, block = 128): LtcFrame[] {
  const dec = new LtcDecoder(sampleRate);
  const out: LtcFrame[] = [];
  for (let i = 0; i < samples.length; i += block) out.push(...dec.process(samples.subarray(i, Math.min(samples.length, i + block)), i));
  return out;
}

function run(opts: Partial<LtcEncodeOptions> & { rate: FrameRate; sampleRate: number }) {
  const enc = encodeLtc({ start: tc(1, 0, 10, 0), frames: 75, ...opts });
  const frames = decode(enc.samples, opts.sampleRate);
  return { enc, frames };
}

/** Every decoded frame is a real label, in order, and at least `share` of them came through. */
function expectClean(enc: ReturnType<typeof encodeLtc>, frames: LtcFrame[], share = 0.95) {
  const labels = enc.labels.map((l) => formatTc(l));
  const got = frames.map(label);
  let last = -1;
  for (const g of got) {
    const i = labels.indexOf(g, last + 1);
    expect(i, `unexpected frame ${g}`).toBeGreaterThan(last);
    last = i;
  }
  expect(got.length).toBeGreaterThanOrEqual(Math.floor(labels.length * share));
}

describe("LTC decoder", () => {
  it("decodes every rate at 44.1 and 48 kHz, frame ends to the sample", () => {
    for (const sampleRate of [44100, 48000]) {
      for (const rate of [24, 25, 29.97, 30] as FrameRate[]) {
        const { enc, frames } = run({ rate, sampleRate });
        expectClean(enc, frames, 0.97);
        const nominal = rate === 29.97 ? 30 : rate;
        for (const f of frames) {
          expect(f.fps).toBe(nominal);
          expect(f.dropFrame).toBe(rate === 29.97);
          expect(f.reverse).toBe(false);
          // where the frame ended (the next frame's first transition)
          const k = enc.labels.findIndex((l) => formatTc(l) === label(f));
          expect(Math.abs(f.end - enc.ends[k])).toBeLessThan(1);
        }
        expect(frames[frames.length - 1].samplesPerFrame).toBeCloseTo(sampleRate / (rate === 29.97 ? 30000 / 1001 : rate), -1);
      }
    }
  });

  it("starts at the requested label (25 fps from 01:00:10:00)", () => {
    const { frames } = run({ rate: 25, sampleRate: 48000 });
    // the very first frame needs its sync word: it is the first one decoded
    expect(label(frames[0])).toBe("01:00:10:00");
    expect(label(frames[frames.length - 1])).toBe("01:00:12:24");
  });

  it("decodes 29.97 drop-frame labels across a minute boundary", () => {
    const start = tc(1, 0, 59, 20);
    const enc = encodeLtc({ sampleRate: 48000, rate: 29.97, start, frames: 30 });
    const frames = decode(enc.samples, 48000);
    const got = frames.map(label);
    expect(got).toContain("01:00:59:29");
    expect(got).toContain("01:01:00:02");
    expect(got).not.toContain("01:01:00:00");
    expect(got).not.toContain("01:01:00:01");
    expect(frames.every((f) => f.dropFrame)).toBe(true);
    expect(got.at(-1)).toBe(formatTc(labelAfter(start, 29.97, 29)));
  });

  it("survives noise and a soft, sine-like line", () => {
    for (const sampleRate of [44100, 48000]) {
      const { enc, frames } = run({ rate: 25, sampleRate, noise: 0.12, smoothing: 3, amplitude: 0.5, seed: 21 });
      expectClean(enc, frames, 0.9);
    }
    // heavier noise: fewer frames, but never a wrong one
    const { enc, frames } = run({ rate: 30, sampleRate: 48000, noise: 0.25, amplitude: 0.5, seed: 4 });
    expectClean(enc, frames, 0.5);
  });

  it("survives level changes (a fade to −26 dB, a sudden step, a slow swell)", () => {
    const fade = (t: number) => (t < 0.5 ? 1 : t < 1.5 ? 1 - 0.95 * (t - 0.5) : 0.05);
    const a = run({ rate: 25, sampleRate: 48000, amplitude: 0.8, gain: fade });
    expectClean(a.enc, a.frames, 0.95);
    const step = (t: number) => (t < 1 ? 0.9 : 0.04);
    const b = run({ rate: 30, sampleRate: 44100, amplitude: 1, gain: step });
    expectClean(b.enc, b.frames, 0.95);
    const swell = (t: number) => 0.02 + t / 3;
    const c = run({ rate: 24, sampleRate: 48000, amplitude: 1, gain: swell });
    expectClean(c.enc, c.frames, 0.95);
  });

  it("follows ±1 % speed", () => {
    for (const speed of [0.99, 1.01]) {
      for (const rate of [25, 30] as FrameRate[]) {
        const { enc, frames } = run({ rate, sampleRate: 48000, speed });
        expectClean(enc, frames, 0.97);
        const expected = 48000 / ((rate === 30 ? 30 : 25) * speed);
        expect(frames.at(-1)!.samplesPerFrame).toBeGreaterThan(expected * 0.995);
        expect(frames.at(-1)!.samplesPerFrame).toBeLessThan(expected * 1.005);
      }
    }
  });

  it("recovers within a couple of frames after a dropout", () => {
    const enc = encodeLtc({ sampleRate: 48000, rate: 25, start: tc(1, 0, 10, 0), frames: 100, dropouts: [[1.0, 1.4]] });
    const frames = decode(enc.samples, 48000);
    const got = frames.map(label);
    // before and after the silence
    expect(got).toContain("01:00:10:20");
    const afterGap = enc.labels.map((l) => formatTc(l)).filter((_, k) => enc.ends[k] / 48000 > 1.4 + 2 / 25);
    for (const l of afterGap) expect(got).toContain(l);
    // nothing decoded inside the gap
    expect(frames.filter((f) => f.end / 48000 > 1.0 + 1 / 25 && f.end / 48000 < 1.4)).toHaveLength(0);
    expectClean(enc, frames, 0.8);
  });

  it("ignores the user bits", () => {
    const { enc, frames } = run({ rate: 25, sampleRate: 48000, userBits: true, seed: 99 });
    expectClean(enc, frames, 0.97);
  });

  it("decodes the same frames in any block size", () => {
    const enc = encodeLtc({ sampleRate: 48000, rate: 30, start: tc(2, 0, 0, 0), frames: 40, noise: 0.05 });
    const a = decode(enc.samples, 48000, 128).map((f) => [label(f), Math.round(f.end * 100)]);
    const b = decode(enc.samples, 48000, 1000).map((f) => [label(f), Math.round(f.end * 100)]);
    const c = new LtcDecoder(48000).process(enc.samples).map((f) => [label(f), Math.round(f.end * 100)]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("reads a line played backwards", () => {
    const enc = encodeLtc({ sampleRate: 48000, rate: 25, start: tc(1, 0, 10, 0), frames: 30 });
    const reversed = Float32Array.from(enc.samples).reverse();
    const frames = decode(reversed, 48000);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames.every((f) => f.reverse)).toBe(true);
    // labels come out in descending order
    const got = frames.map(label);
    expect([...got].sort().reverse()).toEqual(got);
  });

  it("finds nothing in silence or noise", () => {
    const silent = new Float32Array(48000);
    expect(decode(silent, 48000)).toHaveLength(0);
    let seed = 3;
    const noise = Float32Array.from({ length: 96000 }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    });
    expect(decode(noise, 48000)).toHaveLength(0);
  });
});
