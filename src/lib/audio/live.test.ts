import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdaptiveRange, LiveFeatureExtractor, TapTempo } from "./live-features";

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

describe("TapTempo", () => {
  it("uses the median of recent intervals", () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(0.5)).toBeCloseTo(120, 6);
    expect(t.tap(1.0)).toBeCloseTo(120, 6);
    expect(t.tap(1.62)).toBeCloseTo(120, 6); // one sloppy tap does not move the median
    expect(t.tap(2.1)).toBeCloseTo(120, 6);
  });

  it("starts over after a gap longer than 2 s and ignores bounces", () => {
    const t = new TapTempo();
    t.tap(0);
    t.tap(0.5);
    expect(t.tap(3)).toBeNull();
    expect(t.count).toBe(1);
    expect(t.tap(3.4)).toBeCloseTo(150, 6);
    expect(t.tap(3.45)).toBeCloseTo(150, 6); // double-trigger
    expect(t.count).toBe(2);
  });
});

describe("AdaptiveRange", () => {
  it("adapts to the input gain within seconds", () => {
    const quiet = new AdaptiveRange({ minRange: 24, initialPeak: -16, initialFloor: -46, gate: -70 });
    let v = 0;
    for (let i = 0; i < 600; i++) v = quiet.update(i % 30 < 3 ? -40 : -60, 1 / 60);
    // the loud moments of a quiet input still reach the top of the range
    expect(quiet.update(-40, 1 / 60)).toBeGreaterThan(0.9);
    expect(v).toBeLessThan(0.3);
    expect(quiet.update(-120, 1 / 60)).toBe(0); // gate
  });
});

/** Analyser snapshot: `level` 0..1 of full scale, flat spectrum at `db`. */
function frame(level: number, db: number, n = 2048): [Float32Array, Float32Array] {
  const td = new Float32Array(n);
  for (let i = 0; i < n; i++) td[i] = level * Math.sin((2 * Math.PI * 100 * i) / 48000);
  return [td, new Float32Array(n / 2).fill(db)];
}

describe("LiveFeatureExtractor", () => {
  it("produces smoothed 0..1 features that spike on hits", () => {
    const x = new LiveFeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
    const hits: number[] = [];
    let t = 0;
    for (let i = 0; i < 60 * 8; i++, t += 1 / 60) {
      const hit = i % 30 === 0; // 120 BPM
      const [td, sp] = hit ? frame(0.8, -20) : frame(0.2, -60);
      const f = x.process(td, sp, t);
      for (const v of [f.level, f.bass, f.onset, f.beatPhase]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      if (i > 120 && f.onset > 0.8) hits.push(i);
    }
    expect(hits.length).toBeGreaterThan(8);
    expect(hits.every((i) => i % 30 <= 2)).toBe(true);
  });

  it("reads silence as zero", () => {
    const x = new LiveFeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
    let f = x.process(...frame(0, -Infinity), 0);
    for (let i = 1; i < 120; i++) f = x.process(...frame(0, -Infinity), i / 60);
    expect(f.level).toBe(0);
    expect(f.onset).toBe(0);
    expect(f.bass).toBe(0);
    expect(f.beatPhase).toBe(1); // no tempo, no onsets: fully decayed
  });

  it("runs the beat phase from setBpm and re-anchors on tap", () => {
    const x = new LiveFeatureExtractor({ sampleRate: 48000, fftSize: 2048, phaseLock: false });
    x.setBpm(120, 10);
    expect(x.bpm).toBeCloseTo(120, 6);
    expect(x.beatPhase(10)).toBe(0);
    expect(x.beatPhase(10.25)).toBeCloseTo(0.5, 6);
    expect(x.beatPhase(11.1)).toBeCloseTo(0.2, 6);
    x.tap(20.1);
    expect(x.beatPhase(20.1)).toBe(0);
    x.tap(20.5); // two taps 0.4 s apart → 150 BPM
    expect(x.bpm).toBeCloseTo(150, 6);
    expect(x.beatPhase(20.7)).toBeCloseTo(0.5, 6);
    x.setBpm(0, 21);
    expect(x.bpm).toBe(0);
  });

  it("phase-locks the grid to onsets that arrive slightly late", () => {
    const x = new LiveFeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
    x.setBpm(120, 0);
    // the band plays 60 ms behind the grid
    const dt = 1 / 200;
    for (let t = 0; t < 20; t += dt) {
      const beatPos = ((t - 0.06) / 0.5) % 1;
      const hit = beatPos >= 0 && beatPos < dt / 0.5;
      x.process(...(hit ? frame(0.8, -20) : frame(0.2, -60)), t);
    }
    // just after a hit the phase should now be close to 0 (on the beat)
    const p = x.beatPhase(20.06);
    expect(Math.min(p, 1 - p)).toBeLessThan(0.04);
  });

  it("keeps the beat clock running for silent frames", () => {
    const x = new LiveFeatureExtractor({ sampleRate: 48000, fftSize: 2048 });
    x.setBpm(60, 0);
    expect(x.silent(0.5)).toEqual({ level: 0, bass: 0, onset: 0, beatPhase: 0.5 });
  });
});

// ---------------------------------------------------------------------------
// Web Audio wiring, against a small fake graph
// ---------------------------------------------------------------------------

class FakeNode {
  readonly outputs = new Set<FakeNode>();
  constructor(
    readonly kind: string,
    readonly context: FakeContext,
  ) {}
  connect(node: FakeNode) {
    this.outputs.add(node);
    return node;
  }
  disconnect() {
    this.outputs.clear();
  }
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  minDecibels = -100;
  maxDecibels = -30;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getFloatTimeDomainData(a: Float32Array) {
    for (let i = 0; i < a.length; i++) a[i] = 0.3 * Math.sin(i / 5);
  }
  getFloatFrequencyData(a: Float32Array) {
    a.fill(-40);
  }
}

const created: FakeContext[] = [];

class FakeContext {
  state: "suspended" | "running" | "closed" = "suspended";
  sampleRate = 48000;
  readonly destination: FakeNode;
  readonly wrapped = new Set<unknown>();
  /** the node returned by the last createMediaElementSource call */
  elementSource: FakeNode | null = null;
  resumes = 0;
  constructor() {
    this.destination = new FakeNode("destination", this);
    created.push(this);
  }
  addEventListener() {}
  resume() {
    this.resumes++;
    this.state = "running";
    return Promise.resolve();
  }
  createAnalyser() {
    return new FakeAnalyser("analyser", this);
  }
  createMediaElementSource(el: unknown) {
    if (this.wrapped.has(el)) throw new DOMException("already connected", "InvalidStateError");
    this.wrapped.add(el);
    this.elementSource = new FakeNode("element-source", this);
    return this.elementSource;
  }
  createMediaStreamSource() {
    return new FakeNode("stream-source", this);
  }
}

function fakeElement() {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    paused: true,
    addEventListener(type: string, fn: () => void) {
      (listeners[type] ??= []).push(fn);
    },
    fire(type: string) {
      for (const fn of listeners[type] ?? []) fn();
    },
  };
}

type LiveModule = typeof import("./live");

async function freshModule(): Promise<LiveModule> {
  vi.resetModules();
  return import("./live");
}

const windowListeners = new Map<string, EventListener>();

beforeEach(() => {
  created.length = 0;
  windowListeners.clear();
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("window", {
    isSecureContext: true,
    addEventListener: (type: string, fn: EventListener) => windowListeners.set(type, fn),
    removeEventListener: (type: string) => windowListeners.delete(type),
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createMediaElementAnalyser", () => {
  it("wraps each element once, keeps it audible and shares one context", async () => {
    const live = await freshModule();
    const el = fakeElement();
    const a = live.createMediaElementAnalyser(el as unknown as HTMLMediaElement);
    const b = live.createMediaElementAnalyser(el as unknown as HTMLMediaElement);
    expect(created).toHaveLength(1);
    const ctx = created[0];
    expect(ctx.wrapped.size).toBe(1);

    const f = a.getFeatures();
    for (const v of Object.values(f)) expect(Number.isFinite(v)).toBe(true);

    // graph: source -> analyser -> destination
    const source = ctx.elementSource!;
    expect(source).not.toBeNull();
    const analyser = [...source.outputs][0] as FakeAnalyser;
    expect(analyser.kind).toBe("analyser");
    expect(analyser.smoothingTimeConstant).toBe(0);
    expect([...analyser.outputs]).toEqual([ctx.destination]);

    a.dispose();
    a.dispose(); // idempotent
    expect([...source.outputs]).toEqual([analyser]); // b still listening
    b.dispose();
    // nobody listens: bypass, but the element must stay audible
    expect([...source.outputs]).toEqual([ctx.destination]);

    const c = live.createMediaElementAnalyser(el as unknown as HTMLMediaElement);
    expect(ctx.wrapped.size).toBe(1);
    expect([...source.outputs][0]).toBeInstanceOf(FakeAnalyser);
    c.dispose();
  });

  it("resumes the suspended context on the first gesture and on play", async () => {
    const live = await freshModule();
    const el = fakeElement();
    live.createMediaElementAnalyser(el as unknown as HTMLMediaElement);
    const ctx = created[0];
    expect(ctx.state).toBe("suspended");
    expect(windowListeners.has("pointerdown")).toBe(true);
    el.fire("play");
    expect(ctx.resumes).toBe(1);
    ctx.state = "suspended";
    windowListeners.get("keydown")?.(new Event("keydown"));
    expect(ctx.resumes).toBe(2);
  });

  it("degrades to a silent analyser without Web Audio", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const live = await freshModule();
    const a = live.createMediaElementAnalyser(fakeElement() as unknown as HTMLMediaElement);
    expect(a.getFeatures()).toMatchObject({ level: 0, bass: 0, onset: 0 });
    a.setBpm(100);
    expect(a.getBpm?.()).toBeCloseTo(100, 6);
    a.dispose();
  });
});

describe("createMicAnalyser", () => {
  function stubMedia(getUserMedia: (c: MediaStreamConstraints) => Promise<unknown>) {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: async () => [] } });
  }

  it("opens the raw input, does not monitor it, and stops the tracks on dispose", async () => {
    const stop = vi.fn();
    let constraints: MediaStreamConstraints | undefined;
    stubMedia(async (c) => {
      constraints = c;
      return { getTracks: () => [{ stop }] };
    });
    const live = await freshModule();
    const mic = await live.createMicAnalyser("dev-1");
    const audio = constraints?.audio as MediaTrackConstraints;
    expect(audio.echoCancellation).toBe(false);
    expect(audio.noiseSuppression).toBe(false);
    expect(audio.autoGainControl).toBe(false);
    expect(audio.deviceId).toEqual({ exact: "dev-1" });
    const ctx = created[0];
    expect(ctx.state).toBe("running");
    const f = mic.getFeatures();
    expect(f.level).toBeGreaterThanOrEqual(0);
    mic.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(ctx.destination.outputs.size).toBe(0);
  });

  it.each([
    ["NotAllowedError", "denied", /權限/],
    ["NotFoundError", "not-found", /找不到/],
    ["OverconstrainedError", "not-found", /指定的輸入裝置/],
    ["NotReadableError", "busy", /其他程式/],
  ])("maps %s to a helpful message", async (name, code, message) => {
    stubMedia(async () => {
      throw new DOMException("x", name);
    });
    const live = await freshModule();
    const err = await live.createMicAnalyser().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(live.LiveAudioError);
    expect((err as InstanceType<LiveModule["LiveAudioError"]>).code).toBe(code);
    expect((err as Error).message).toMatch(message);
  });

  it("refuses insecure origins and missing mediaDevices", async () => {
    vi.stubGlobal("window", { isSecureContext: false, addEventListener() {}, removeEventListener() {} });
    let live = await freshModule();
    await expect(live.createMicAnalyser()).rejects.toMatchObject({ code: "insecure" });
    vi.stubGlobal("window", { isSecureContext: true, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("navigator", {});
    live = await freshModule();
    await expect(live.createMicAnalyser()).rejects.toMatchObject({ code: "unsupported" });
  });
});
