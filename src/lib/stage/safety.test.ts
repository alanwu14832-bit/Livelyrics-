import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAFETY,
  FLASH,
  FlashDetector,
  FlashLimiter,
  PulseGate,
  activeSafety,
  capGain,
  gridSize,
  isSaturatedRedHex,
  luminance,
  maxFlashesPerSecond,
  meanLuminance,
  normalizeSafety,
  patchSafety,
  peakLuminance,
  safeReactivity,
  safeTransition,
  safetyReport,
  softenChannel,
  transformHex,
} from "./safety";
import type { DesignPlan, SectionDesign } from "../types";

const COLS = 32;
const ROWS = 18;
const N = COLS * ROWS;

function uniform(r: number, g = r, b = r): Float32Array {
  const a = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    a[i * 3] = r;
    a[i * 3 + 1] = g;
    a[i * 3 + 2] = b;
  }
  return a;
}

/** Run a source sequence through the zero-lag limiter; returns displayed full-frame luminance samples. */
function run(frame: (t: number) => Float32Array, seconds: number, fps: number, opts: { flashLimit?: boolean; redProtect?: boolean; gain?: number } = {}) {
  const lim = new FlashLimiter({ cols: COLS, rows: ROWS, flashLimit: opts.flashLimit ?? true, redProtect: opts.redProtect ?? true, gain: opts.gain ?? 1 });
  const shown: Array<{ t: number; l: number }> = [];
  const source: Array<{ t: number; l: number }> = [];
  const alphas: number[] = [];
  const dt = 1 / fps;
  for (let k = 0; k < Math.round(seconds * fps); k++) {
    const t = k * dt;
    const g = frame(t);
    const step = lim.step(t, k === 0 ? 0 : dt, g);
    alphas.push(step.alpha);
    source.push({ t, l: meanLuminance(g, N, opts.gain ?? 1) });
    shown.push({ t, l: meanLuminance(lim.displayedGrid()!, N, opts.gain ?? 1) });
  }
  return { shown, source, alphas, lim };
}

const square = (hz: number, lo = 0, hi = 1) => (t: number) => uniform(Math.floor(t * hz * 2 + 1e-9) % 2 === 0 ? lo : hi);

describe("settings", () => {
  it("normalizes missing settings to safe mode on with the LED preset", () => {
    expect(normalizeSafety(undefined)).toEqual(DEFAULT_SAFETY);
    expect(normalizeSafety(null)).toMatchObject({ enabled: true, preset: "led", brightness: 0.7, flashLimit: true });
    expect(normalizeSafety({ brightness: 5, soften: -1 })).toMatchObject({ brightness: 1, preset: "indoor", soften: 0 });
    expect(normalizeSafety({ preset: "outdoor", brightness: 0.9 })).toMatchObject({ preset: "outdoor", brightness: 0.55 });
    expect(normalizeSafety({ brightness: 0.62 })).toMatchObject({ preset: "custom", brightness: 0.62 });
    expect(normalizeSafety({ brightness: 0.01 }).brightness).toBe(0.2);
  });

  it("patches presets, custom brightness and the master switch", () => {
    const s = normalizeSafety(undefined);
    expect(patchSafety(s, { preset: "indoor" })).toMatchObject({ preset: "indoor", brightness: 1 });
    expect(patchSafety(s, { brightness: 0.63 })).toMatchObject({ preset: "custom", brightness: 0.63 });
    expect(patchSafety(s, { brightness: 0.55 })).toMatchObject({ preset: "outdoor" });
    const off = patchSafety({ ...s, flashLimit: false }, { enabled: false });
    expect(off.enabled).toBe(false);
    // turning safe mode back on turns the flash limiter on by default
    expect(patchSafety(off, { enabled: true }).flashLimit).toBe(true);
    expect(activeSafety(off)).toMatchObject({ on: false, gain: 1, flashLimit: false });
  });
});

describe("brightness cap and soften maths", () => {
  it("caps full white at the chosen linear brightness", () => {
    for (const b of [1, 0.7, 0.55, 0.3]) {
      const g = capGain(b);
      expect(Math.pow(g, 2.2)).toBeCloseTo(b, 6);
      const a = activeSafety({ ...DEFAULT_SAFETY, brightness: b, preset: "custom", soften: 0 });
      // sRGB luminance of the capped white is close to the gamma-2.2 target
      expect(peakLuminance(a)).toBeGreaterThan(b * 0.93);
      expect(peakLuminance(a)).toBeLessThan(b * 1.07);
    }
    expect(capGain(0.7)).toBeCloseTo(0.8504, 3);
  });

  it("soften is the identity at 0, monotonic, keeps darks and lowers the peak", () => {
    for (let x = 0; x <= 1; x += 0.05) expect(softenChannel(x, 0)).toBeCloseTo(x, 9);
    let prev = -1;
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const y = softenChannel(x, 0.6);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    expect(softenChannel(0.3, 1)).toBeCloseTo(0.3, 9);
    expect(softenChannel(1, 1)).toBeLessThan(0.75);
    expect(softenChannel(1, 0.25)).toBeLessThan(0.95);
  });

  it("transforms lyric colours through soften and cap", () => {
    const a = activeSafety({ ...DEFAULT_SAFETY, soften: 0 });
    expect(transformHex("#ffffff", a)).toBe("#d9d9d9");
    expect(transformHex("#000000", a)).toBe("#000000");
    expect(transformHex("#ffffff", activeSafety({ ...DEFAULT_SAFETY, enabled: false }))).toBe("#ffffff");
  });
});

describe("flash detection", () => {
  it("counts a full-field square wave and ignores a slow fade", () => {
    const det = new FlashDetector(COLS, ROWS);
    let max = 0;
    for (let k = 0; k < 180; k++) {
      const t = k / 60;
      const v = square(10)(t)[0];
      const lum = new Float32Array(N).fill(luminance(v, v, v));
      det.push(t, lum);
      max = Math.max(max, det.flashes(t));
    }
    expect(max).toBeGreaterThanOrEqual(9);

    const fade = new FlashDetector(COLS, ROWS);
    let fmax = 0;
    for (let k = 0; k < 180; k++) {
      const t = k / 60;
      const v = Math.min(1, t / 2);
      fade.push(t, new Float32Array(N).fill(luminance(v, v, v)));
      fmax = Math.max(fmax, fade.transitions(t));
    }
    expect(fmax).toBeLessThanOrEqual(1);
  });

  it("needs a large enough area: a small flashing patch is not a general flash", () => {
    const patch = (w: number, h: number) => {
      const det = new FlashDetector(COLS, ROWS);
      let max = 0;
      for (let k = 0; k < 120; k++) {
        const t = k / 60;
        const on = Math.floor(t * 20) % 2 === 1;
        const lum = new Float32Array(N);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * COLS + x] = on ? 1 : 0;
        det.push(t, lum);
        max = Math.max(max, det.transitions(t));
      }
      return max;
    };
    expect(patch(2, 2)).toBe(0); // 4 of the 66 cells of a field window
    expect(patch(6, 4)).toBeGreaterThan(6); // 24 of 66 = 36 %
  });

  it("ignores changes that stay bright (the darker state is above 0.8)", () => {
    const det = new FlashDetector(4, 4);
    for (let k = 0; k < 120; k++) {
      const t = k / 60;
      det.push(t, new Float32Array(16).fill(Math.floor(t * 20) % 2 ? 0.85 : 1));
    }
    expect(det.transitions(2)).toBe(0);
  });

  it("detects saturated red transitions", () => {
    expect(isSaturatedRedHex("#ff0000")).toBe(true);
    expect(isSaturatedRedHex("#ff8080")).toBe(false);
    expect(isSaturatedRedHex("#200000")).toBe(false);
    const det = new FlashDetector(4, 4);
    let reds = 0;
    for (let k = 0; k < 60; k++) {
      const t = k / 60;
      const on = Math.floor(t * 8) % 2 === 1;
      const q = new Float32Array(16).fill(on ? 320 : 0);
      const ratio = new Float32Array(16).fill(on ? 1 : 0);
      det.push(t, new Float32Array(16).fill(on ? 0.2126 : 0), { q, ratio });
      reds = Math.max(reds, det.redTransitions(t));
    }
    expect(reds).toBeGreaterThanOrEqual(6);
  });

  it("maxFlashesPerSecond counts pairs of opposing transitions", () => {
    const s = Array.from({ length: 120 }, (_, k) => ({ t: k / 60, l: Math.floor((k / 60) * 20) % 2 }));
    expect(maxFlashesPerSecond(s)).toBeGreaterThanOrEqual(9);
    expect(maxFlashesPerSecond(Array.from({ length: 120 }, (_, k) => ({ t: k / 60, l: k / 120 })))).toBe(0.5);
  });
});

describe("flash limiter", () => {
  it("reduces a 10 Hz full-field strobe to at most 3 flashes a second", () => {
    for (const fps of [60, 30, 24]) {
      const { shown, source } = run(square(10), 4, fps);
      expect(maxFlashesPerSecond(source)).toBeGreaterThan(3);
      expect(maxFlashesPerSecond(shown)).toBeLessThanOrEqual(3);
      // a damped strobe settles to a steady grey rather than black
      const tail = shown.slice(-fps).map((s) => s.l);
      expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(FLASH.DELTA);
    }
  });

  it("limits 4 Hz and 25 Hz strobes too", () => {
    for (const hz of [4, 6, 25]) {
      const { shown } = run(square(hz), 4, 60);
      expect(maxFlashesPerSecond(shown)).toBeLessThanOrEqual(3);
    }
  });

  it("leaves a slow fade and a 1 Hz pulse untouched", () => {
    const fade = run((t) => uniform(Math.min(1, t / 3)), 4, 60);
    expect(fade.alphas.every((a) => a === 1)).toBe(true);
    expect(fade.shown.map((s) => s.l)).toEqual(fade.source.map((s) => s.l));
    const slow = run(square(1), 4, 60);
    expect(slow.alphas.every((a) => a === 1)).toBe(true);
  });

  it("limits saturated red flashes (each red transition counts)", () => {
    const red = (t: number) => (Math.floor(t * 10) % 2 ? uniform(1, 0, 0) : uniform(0, 0, 0));
    const { lim } = run(red, 3, 60, { flashLimit: false, redProtect: true });
    // after damping, the modelled display no longer produces red transitions faster than the budget
    expect(lim.status.redTransitions).toBeLessThanOrEqual(FLASH.MAX_RED);
    expect(lim.status.sourceRed).toBeGreaterThan(FLASH.MAX_RED);
    expect(lim.engagedCount).toBeGreaterThanOrEqual(1);
  });

  it("does nothing when both protections are off", () => {
    const { shown, source, alphas } = run(square(10), 2, 60, { flashLimit: false, redProtect: false });
    expect(alphas.every((a) => a === 1)).toBe(true);
    expect(maxFlashesPerSecond(shown)).toBe(maxFlashesPerSecond(source));
  });

  it("is deterministic: the same frames give the same alpha sequence", () => {
    const seq = (t: number) => uniform(0.5 + 0.5 * Math.sin(t * 40) * (t > 1 ? 1 : 0), 0.3, 0.2);
    const a = run(seq, 3, 50).alphas;
    const b = run(seq, 3, 50).alphas;
    expect(a).toEqual(b);
    expect(a.some((x) => x < 1)).toBe(true);
  });

  it("works with a lagged observation (live readback)", () => {
    const lim = new FlashLimiter({ cols: COLS, rows: ROWS, flashLimit: true, redProtect: true, gain: 1 });
    const pending: Array<{ t: number; g: Float32Array; a: number }> = [];
    const shownModel: number[] = [];
    let displayed: Float32Array | null = null;
    const samples: Array<{ t: number; l: number }> = [];
    for (let k = 0; k < 240; k++) {
      const t = k / 60;
      const g = square(10)(t);
      const a = lim.alphaFor(k === 0 ? 0 : 1 / 60);
      // what the GPU shows: the same mix per pixel
      if (!displayed) displayed = g.slice();
      else for (let i = 0; i < displayed.length; i++) displayed[i] += (g[i] - displayed[i]) * a;
      samples.push({ t, l: meanLuminance(displayed, N) });
      pending.push({ t, g, a });
      // two frames of readback lag
      if (pending.length > 2) {
        const m = pending.shift()!;
        lim.observe(m.t, m.g, m.a);
      }
      shownModel.push(a);
    }
    expect(maxFlashesPerSecond(samples)).toBeLessThanOrEqual(3);
  });

  it("the brightness cap lowers every displayed value", () => {
    const full = run(() => uniform(1), 1, 30, { gain: 1 }).shown.at(-1)!.l;
    const capped = run(() => uniform(1), 1, 30, { gain: capGain(0.55) }).shown.at(-1)!.l;
    expect(full).toBeCloseTo(1, 5);
    expect(capped).toBeLessThan(0.6);
  });
});

describe("source-level safety", () => {
  const on = activeSafety(DEFAULT_SAFETY);
  const off = activeSafety({ ...DEFAULT_SAFETY, enabled: false });

  it("turns flash and bloom into fades and clamps reactivity", () => {
    expect(safeTransition("flash", on)).toBe("fade");
    expect(safeTransition("bloom", on)).toBe("fade");
    expect(safeTransition("wipe", on)).toBe("wipe");
    expect(safeTransition("flash", off)).toBe("flash");
    expect(safeReactivity(0.9, ["#101010", "#4466ff"], on)).toBe(0.5);
    expect(safeReactivity(0.9, ["#ff0000", "#ffffff"], on)).toBe(0.25);
    expect(safeReactivity(0.9, ["#ff0000", "#ffffff"], off)).toBe(0.9);
  });

  it("rate-limits the beat pulse to 3 rises a second", () => {
    const gate = new PulseGate(3);
    let p = 0;
    const rises: number[] = [];
    let rising = false;
    for (let k = 0; k < 600; k++) {
      const t = k / 120;
      const target = (t * 8) % 1 < 0.2 ? 1 : 0; // an 8 Hz trigger
      const allowed = gate.gate(target, p, 1 / 120);
      const next = p + (allowed - p) * 0.5;
      if (next > p + 0.02 && !rising) {
        rises.push(t);
        rising = true;
      } else if (next <= p) rising = false;
      p = next;
    }
    for (let i = 0; i < rises.length; i++) {
      const inWindow = rises.filter((r) => r >= rises[i] && r < rises[i] + 1).length;
      expect(inWindow).toBeLessThanOrEqual(3);
    }
    expect(rises.length).toBeGreaterThan(8);
  });

  it("reports the sections safe mode changes", () => {
    const section = (i: number, patch: Partial<SectionDesign>): SectionDesign => ({
      id: `s${i}`,
      kind: "verse",
      label: `段 ${i}`,
      start: i * 10,
      end: i * 10 + 10,
      energy: 0.5,
      scene: "gradient",
      sceneParams: { speed: 0.3, density: 0.5, intensity: 0.6, audioReactivity: 0.3 },
      colorway: ["#101018", "#4466ff", "#ffcc00"],
      lyricStyle: "line-fade",
      lyricPlacement: "center",
      lyricScale: 1,
      lyricColor: "#ffffff",
      transitionIn: "fade",
      media: null,
      rationale: "",
      ...patch,
    });
    const plan = {
      sections: [section(0, {}), section(1, { transitionIn: "flash" }), section(2, { sceneParams: { speed: 0.5, density: 0.5, intensity: 0.8, audioReactivity: 0.9 } }), section(3, { colorway: ["#ff0000", "#ff2200", "#ffffff"] }), section(4, { lyricStyle: "impact" })],
      lines: [],
    } as unknown as DesignPlan;
    const r = safetyReport(plan, on, { bpm: 200 });
    expect(r.sections.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(r.sections[0].changes[0].text).toContain("閃白");
    expect(r.notes.join()).toContain("200 BPM");
    expect(safetyReport(plan, off).sections).toEqual([]);
  });

  it("sizes the grid by aspect", () => {
    expect(gridSize(16 / 9)).toEqual({ cols: 32, rows: 18 });
    expect(gridSize(32 / 9)).toEqual({ cols: 32, rows: 9 });
    expect(gridSize(9 / 16)).toEqual({ cols: 18, rows: 32 });
  });
});
