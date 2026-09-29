import { describe, expect, it } from "vitest";
import { RealFFT, hannWindow, isPowerOfTwo } from "./fft";
import { downsample, removeDc, sanitizeSamples } from "./resample";
import { prng } from "./testing/signals";

function naiveDft(x: number[]): { re: number[]; im: number[] } {
  const n = x.length;
  const re: number[] = [];
  const im: number[] = [];
  for (let k = 0; k <= n / 2; k++) {
    let r = 0;
    let i = 0;
    for (let t = 0; t < n; t++) {
      r += x[t] * Math.cos((2 * Math.PI * k * t) / n);
      i -= x[t] * Math.sin((2 * Math.PI * k * t) / n);
    }
    re.push(r);
    im.push(i);
  }
  return { re, im };
}

describe("RealFFT", () => {
  it.each([4, 8, 64, 512, 2048])("matches a naive DFT (n = %i)", (n) => {
    const rand = prng(n);
    const x = Array.from({ length: n }, () => rand() * 2 - 1);
    const fft = new RealFFT(n);
    const re = new Float64Array(n / 2 + 1);
    const im = new Float64Array(n / 2 + 1);
    fft.forward(x, re, im);
    const ref = naiveDft(x);
    for (let k = 0; k <= n / 2; k++) {
      expect(re[k]).toBeCloseTo(ref.re[k], 8);
      expect(im[k]).toBeCloseTo(ref.im[k], 8);
    }
  });

  it("puts a sine into its bin", () => {
    const n = 1024;
    const x = Array.from({ length: n }, (_, t) => Math.sin((2 * Math.PI * 37 * t) / n));
    const re = new Float64Array(n / 2 + 1);
    const im = new Float64Array(n / 2 + 1);
    new RealFFT(n).forward(x, re, im);
    const mags = Array.from(re, (r, k) => Math.hypot(r, im[k]));
    expect(mags.indexOf(Math.max(...mags))).toBe(37);
    expect(mags[37]).toBeCloseTo(n / 2, 6);
  });

  it("rejects sizes that are not powers of two", () => {
    expect(() => new RealFFT(1000)).toThrow(RangeError);
    expect(isPowerOfTwo(1024)).toBe(true);
    expect(isPowerOfTwo(12)).toBe(false);
  });

  it("builds a periodic Hann window", () => {
    const w = hannWindow(8);
    expect(w[0]).toBe(0);
    expect(w[4]).toBeCloseTo(1, 12);
    expect(w[2]).toBeCloseTo(w[6], 12);
  });
});

describe("resampling helpers", () => {
  it("downsamples 44.1 kHz → 22.05 kHz preserving in-band tones and removing aliases", () => {
    const sr = 44100;
    const n = sr;
    const low = new Float32Array(n);
    const high = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      low[i] = Math.sin((2 * Math.PI * 1000 * i) / sr);
      high[i] = Math.sin((2 * Math.PI * 15000 * i) / sr); // above the new Nyquist (11.025 kHz)
    }
    const rms = (a: Float32Array) => Math.sqrt(a.slice(1000, -1000).reduce((s, v) => s + v * v, 0) / (a.length - 2000));
    const lo = downsample(low, sr, 22050);
    const hi = downsample(high, sr, 22050);
    expect(lo.length).toBe(22050);
    expect(rms(lo)).toBeGreaterThan(0.69);
    expect(rms(lo)).toBeLessThan(0.72);
    expect(rms(hi)).toBeLessThan(0.01);
  });

  it("handles non-integer ratios (48 kHz)", () => {
    const x = new Float32Array(48000).fill(0.5);
    const y = downsample(x, 48000, 22050);
    expect(y.length).toBe(22050);
    expect(y[11000]).toBeCloseTo(0.5, 3);
  });

  it("sanitizes non-finite samples without copying clean input", () => {
    const clean = new Float32Array([0, 0.5, -0.5]);
    expect(sanitizeSamples(clean)).toBe(clean);
    const dirty = new Float32Array([0.1, NaN, Infinity, -Infinity, 0.2]);
    expect(Array.from(sanitizeSamples(dirty))).toEqual([Math.fround(0.1), 0, 0, 0, Math.fround(0.2)]);
  });

  it("removes a DC offset", () => {
    const x = new Float32Array(22050).fill(0.4);
    const y = removeDc(x, 22050);
    expect(Math.abs(y[y.length - 1])).toBeLessThan(1e-6);
  });
});
