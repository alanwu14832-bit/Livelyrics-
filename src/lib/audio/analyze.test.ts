// analyzeFile's browser pipeline, driven with a fake OfflineAudioContext and a fake Worker that
// mimics structured-clone transfer semantics (detached buffers), load errors and crashes.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioAnalysisError, FILE_PROGRESS_LABELS, analyzeFile, analyzeSamples, isAbortError } from "./analyze";
import { PROGRESS_LABELS } from "./analysis";
import { downsample } from "./resample";
import { buildWav, clickTrack, readWav, readWavChannels } from "./testing/signals";
import type { AnalyzeRequest, WorkerResponse } from "./worker-protocol";

class FakeAudioBuffer {
  constructor(
    private readonly channels: Float32Array[],
    readonly sampleRate: number,
  ) {}
  get length() {
    return this.channels[0]?.length ?? 0;
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  get numberOfChannels() {
    return this.channels.length;
  }
  getChannelData(c: number) {
    return this.channels[c];
  }
}

const decodeCalls: number[] = [];

class FakeOfflineAudioContext {
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    decodeCalls.push(this.sampleRate);
    try {
      const { channels, sampleRate } = readWavChannels(new Uint8Array(data));
      // like browsers, decode at the context rate
      const resampled = sampleRate > this.sampleRate ? channels.map((c) => downsample(c, sampleRate, this.sampleRate)) : channels;
      return Promise.resolve(new FakeAudioBuffer(resampled, sampleRate > this.sampleRate ? this.sampleRate : sampleRate));
    } catch {
      return Promise.reject(new DOMException("Unable to decode audio data", "EncodingError"));
    }
  }
}

type WorkerMode = "ok" | "load-error" | "crash-after-transfer" | "throw-in-constructor" | "silent";

const workerLog: { url: string; transferred: boolean; terminated: boolean }[] = [];
let workerMode: WorkerMode = "ok";

class FakeWorker {
  onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private readonly entry: { url: string; transferred: boolean; terminated: boolean };
  constructor(url: URL) {
    if (workerMode === "throw-in-constructor") throw new Error("Workers are disabled");
    this.entry = { url: url.href, transferred: false, terminated: false };
    workerLog.push(this.entry);
    setTimeout(() => {
      if (workerMode === "load-error") this.fail("Failed to load worker script");
      else if (workerMode !== "silent") this.emit({ type: "ready" });
    }, 1);
  }
  private emit(msg: WorkerResponse) {
    if (!this.entry.terminated) this.onmessage?.({ data: msg } as MessageEvent<unknown>);
  }
  private fail(message: string) {
    if (!this.entry.terminated) this.onerror?.({ message, preventDefault() {} } as ErrorEvent);
  }
  postMessage(req: AnalyzeRequest, transfer: Transferable[]) {
    const cloned = structuredClone(req, { transfer }); // detaches the sender's buffer, like a real worker
    this.entry.transferred = true;
    setTimeout(() => {
      if (workerMode === "crash-after-transfer") return this.fail("Out of memory");
      const analysis = analyzeSamples(cloned.samples, cloned.sampleRate, {
        sourceSampleRate: cloned.sourceSampleRate,
        onProgress: (progress, label) => this.emit({ type: "progress", id: cloned.id, progress, label }),
      });
      this.emit({ type: "result", id: cloned.id, analysis });
    }, 1);
  }
  terminate() {
    this.entry.terminated = true;
  }
}

const demoBytes = readFileSync(path.join(__dirname, "../../../fixtures/demo-song.wav"));
const demoFile = () => new File([demoBytes], "demo-song.wav", { type: "audio/wav" });
const demoReference = (() => {
  const { samples, sampleRate } = readWav(demoBytes);
  return analyzeSamples(samples, sampleRate);
})();

beforeEach(() => {
  vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
  vi.stubGlobal("Worker", FakeWorker);
  workerMode = "ok";
  workerLog.length = 0;
  decodeCalls.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("analyzeFile", () => {
  it("decodes, analyses in the worker and reports monotonic progress", async () => {
    const events: [number, string][] = [];
    const a = await analyzeFile(demoFile(), (p, l) => events.push([p, l]));
    expect(JSON.stringify(a)).toBe(JSON.stringify(demoReference));
    expect(workerLog).toHaveLength(1);
    expect(workerLog[0].url).toMatch(/analyze\.worker\.ts$/);
    expect(workerLog[0].transferred).toBe(true);
    expect(workerLog[0].terminated).toBe(true);
    expect(decodeCalls[0]).toBe(22050);
    const labels = events.map((e) => e[1]);
    for (const l of [FILE_PROGRESS_LABELS.read, FILE_PROGRESS_LABELS.decode, FILE_PROGRESS_LABELS.prepare, PROGRESS_LABELS.tempo, PROGRESS_LABELS.sections]) {
      expect(labels).toContain(l);
    }
    for (let i = 1; i < events.length; i++) expect(events[i][0]).toBeGreaterThanOrEqual(events[i - 1][0]);
    expect(events[events.length - 1][0]).toBe(1);
  });

  it("downmixes stereo and decodes 44.1 kHz files straight to 22.05 kHz", async () => {
    const { samples } = clickTrack(120, 12, 44100);
    const right = samples.map((v) => v * 0.5);
    const file = new File([buildWav([samples, right], 44100)], "stereo.wav");
    const a = await analyzeFile(file);
    expect(decodeCalls[0]).toBe(22050);
    expect(a.sampleRate).toBe(44100); // reported from the container, not the decode rate
    expect(Math.abs(a.bpm - 120)).toBeLessThan(1);
    expect(a.duration).toBeCloseTo(12, 1);
  });

  it.each(["load-error", "throw-in-constructor"] as const)("falls back to the main thread when the worker cannot start (%s)", async (mode) => {
    workerMode = mode;
    const a = await analyzeFile(demoFile());
    expect(JSON.stringify(a)).toBe(JSON.stringify(demoReference));
  });

  it("recovers when the worker crashes after the samples were transferred", async () => {
    workerMode = "crash-after-transfer";
    const a = await analyzeFile(demoFile());
    expect(workerLog[0].transferred).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(demoReference));
  });

  it("falls back when the worker never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      workerMode = "silent";
      const job = analyzeFile(demoFile());
      await vi.advanceTimersByTimeAsync(20_000);
      const a = await job;
      expect(a.bpm).toBeCloseTo(demoReference.bpm, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can be forced onto the main thread", async () => {
    const a = await analyzeFile(demoFile(), undefined, { worker: false });
    expect(workerLog).toHaveLength(0);
    expect(a.bpm).toBe(demoReference.bpm);
  });

  it("rejects with an AbortError when cancelled", async () => {
    const before = new AbortController();
    before.abort();
    await expect(analyzeFile(demoFile(), undefined, { signal: before.signal })).rejects.toSatisfy(isAbortError);

    const during = new AbortController();
    const job = analyzeFile(demoFile(), (_p, label) => {
      if (label === PROGRESS_LABELS.spectrum) during.abort();
    }, { signal: during.signal });
    await expect(job).rejects.toSatisfy(isAbortError);
    expect(workerLog.every((w) => w.terminated)).toBe(true);
  });

  it("explains unusable files in Traditional Chinese", async () => {
    const corrupt = new File([new Uint8Array(1024).fill(7)], "broken.mp3");
    await expect(analyzeFile(corrupt)).rejects.toMatchObject({ name: "AudioAnalysisError", code: "unsupported" });
    await expect(analyzeFile(corrupt)).rejects.toThrow(/無法解碼音訊/);
    await expect(analyzeFile(new File([], "empty.wav"))).rejects.toMatchObject({ code: "empty" });
    const silentFile = new File([buildWav([new Float32Array(0)], 22050)], "zero.wav");
    await expect(analyzeFile(silentFile)).rejects.toMatchObject({ code: "no-audio" });
  });

  it("reports a missing Web Audio implementation", async () => {
    vi.stubGlobal("OfflineAudioContext", undefined);
    vi.stubGlobal("AudioContext", undefined);
    const err = await analyzeFile(demoFile()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AudioAnalysisError);
    expect((err as AudioAnalysisError).code).toBe("no-webaudio");
  });

  it("ignores exceptions thrown by the progress callback", async () => {
    const a = await analyzeFile(demoFile(), () => {
      throw new Error("UI bug");
    });
    expect(a.bpm).toBe(demoReference.bpm);
  });
});
