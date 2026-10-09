// 「AI 自動對時」 engine (round 15, browser main thread): reads the project's audio, decodes it at
// 16 kHz mono, hands it to the Whisper worker (asr.worker.ts) and reports progress. One run at a
// time; cancel terminates the worker. WebGPU (an adapter with shader-f16) runs the encoder when
// available; if it fails, the run starts again on WebAssembly and WebGPU is not tried again in this
// browser. The audio never leaves the computer: the only network traffic is the one-time model
// download from huggingface.co (and its file CDN).

import type { AsrWord } from "../lyrics/asr-align";
import { ASR_SAMPLE_RATE, type AsrChoice, type AsrDevice } from "./models";
import { isAsrResponse, type AsrErrorCode, type AsrRunRequest, type FakeAsr } from "./protocol";

export type AsrProgress =
  | { stage: "fetch" }
  | { stage: "decode" }
  | { stage: "download"; loaded: number; total: number }
  | { stage: "load" }
  | { stage: "listen"; heard: number; seconds: number };

export type AsrFailure = AsrErrorCode | "cancelled" | "decode" | "busy";

export class AsrError extends Error {
  constructor(
    readonly code: AsrFailure,
    message: string,
  ) {
    super(message);
    this.name = "AsrError";
  }
}

export interface AsrRunResult {
  words: AsrWord[];
  device: AsrDevice;
  /** wall seconds in the worker (model load + listening) */
  seconds: number;
  /** seconds of audio */
  audioSeconds: number;
}

export interface AsrRun {
  promise: Promise<AsrRunResult>;
  cancel(): void;
}

export interface AsrRunOptions {
  /** the project's audio (api.audioUrl) */
  audioUrl: string;
  choice: AsrChoice;
  /** detectAsrDevice() when omitted */
  device?: AsrDevice;
  /** ISO 639-1 for Whisper (asrLanguage), null = let it detect */
  language: string | null;
  onProgress?: (p: AsrProgress) => void;
}

const WEBGPU_FAILED_KEY = "livelyrics:asr:webgpu-failed";

function webgpuFailedBefore(): boolean {
  try {
    return window.localStorage.getItem(WEBGPU_FAILED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberWebgpuFailed(): void {
  try {
    window.localStorage.setItem(WEBGPU_FAILED_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface GpuLike {
  requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null>;
}

/** WebGPU when the browser gives an adapter with shader-f16 (the fp16 encoder), else WebAssembly. */
export async function detectAsrDevice(): Promise<AsrDevice> {
  try {
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    if (!gpu || webgpuFailedBefore()) return "wasm";
    const adapter = await gpu.requestAdapter();
    return adapter && adapter.features.has("shader-f16") ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

/** navigator.deviceMemory (GB, Chromium only; rounded down by the browser), null when unknown. */
export function deviceMemoryGB(): number | null {
  const m = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  return typeof m === "number" && m > 0 ? m : null;
}

/** Decode a song at 16 kHz and average its channels (scripts/timing-eval/decode.cjs --asr does the same). */
export async function decodeForAsr(data: ArrayBuffer): Promise<Float32Array> {
  const Ctx = globalThis.OfflineAudioContext ?? (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) throw new AsrError("decode", "這個瀏覽器不能解碼音檔");
  const ctx = new Ctx(1, 1, ASR_SAMPLE_RATE);
  const buf = await ctx.decodeAudioData(data);
  const n = buf.length;
  const channels = buf.numberOfChannels;
  if (channels === 1) return buf.getChannelData(0).slice();
  const mono = new Float32Array(n);
  for (let c = 0; c < channels; c++) {
    const x = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += x[i];
  }
  for (let i = 0; i < n; i++) mono[i] /= channels;
  return mono;
}

/** the e2e test hook (protocol.ts FakeAsr), set by the test before the page loads */
function fakeHook(): FakeAsr | undefined {
  const f = (globalThis as { __livelyricsFakeAsr?: FakeAsr }).__livelyricsFakeAsr;
  return f && Array.isArray(f.words) ? f : undefined;
}

/** the self-hosted ONNX Runtime WebAssembly (next.config.ts) */
function ortBase(): string {
  const base = process.env.LIVELYRICS_ORT_WASM_BASE || "/ort/";
  return new URL(base, window.location.origin).href;
}

let worker: Worker | null = null;
let active: { id: number } | null = null;
let seq = 0;

/** A run is in progress (one at a time). */
export function asrBusy(): boolean {
  return active != null;
}

function dropWorker(): void {
  worker?.terminate();
  worker = null;
}

/** Messages of one request; resolves with the result or rejects with an AsrError. */
function runInWorker(req: AsrRunRequest, transfer: Transferable[], onProgress?: (p: AsrProgress) => void): { promise: Promise<AsrRunResult>; abort: (err: AsrError) => void } {
  let abort: (err: AsrError) => void = () => {};
  const promise = new Promise<AsrRunResult>((resolve, reject) => {
    let w: Worker;
    try {
      w = worker ??= new Worker(new URL("./asr.worker.ts", import.meta.url));
    } catch (err) {
      reject(new AsrError("unknown", err instanceof Error ? err.message : String(err)));
      return;
    }
    const audioSeconds = req.audio.length / ASR_SAMPLE_RATE;
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      const msg = event.data;
      if (!isAsrResponse(msg) || msg.type === "ready" || msg.id !== req.id) return;
      if (msg.type === "progress") {
        if (msg.stage === "download") onProgress?.({ stage: "download", loaded: msg.loaded, total: msg.total });
        else if (msg.stage === "load") onProgress?.({ stage: "load" });
        else onProgress?.({ stage: "listen", heard: msg.heard, seconds: msg.seconds });
        return;
      }
      cleanup();
      if (msg.type === "result") resolve({ words: msg.words, device: msg.device, seconds: msg.seconds, audioSeconds });
      else reject(new AsrError(msg.code, msg.message));
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      dropWorker();
      const message = event.message || "worker error";
      // a worker that dies loading a model ran out of memory, or its script could not be fetched
      reject(new AsrError(/memory|allocation/i.test(message) ? "memory" : typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unknown", message));
    };
    abort = (err) => {
      cleanup();
      dropWorker();
      reject(err);
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage(req, transfer);
  });
  return { promise, abort: (err) => abort(err) };
}

/**
 * Listen to the project's song and return the recognised words with their timestamps. Rejects with
 * an AsrError: "busy" (another run is going), "cancelled", "decode", "download", "offline",
 * "memory", "unknown".
 */
export function transcribeSong(options: AsrRunOptions): AsrRun {
  if (active) return { promise: Promise.reject(new AsrError("busy", "AI 自動對時已經在進行")), cancel: () => {} };
  const id = ++seq;
  const run = { id };
  active = run;
  const controller = new AbortController();
  let current: { abort: (err: AsrError) => void } | null = null;
  let cancelled = false;
  const progress = options.onProgress;

  const promise = (async (): Promise<AsrRunResult> => {
    progress?.({ stage: "fetch" });
    let data: ArrayBuffer;
    try {
      const res = await fetch(options.audioUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.arrayBuffer();
    } catch (err) {
      if (cancelled) throw new AsrError("cancelled", "已取消");
      throw new AsrError("decode", `讀不到這首歌的音檔（${err instanceof Error ? err.message : String(err)}）`);
    }
    if (cancelled) throw new AsrError("cancelled", "已取消");
    progress?.({ stage: "decode" });
    let audio: Float32Array;
    try {
      audio = await decodeForAsr(data);
    } catch (err) {
      throw err instanceof AsrError ? err : new AsrError("decode", `音檔無法解碼（${err instanceof Error ? err.message : String(err)}）`);
    }
    if (cancelled) throw new AsrError("cancelled", "已取消");
    const fake = fakeHook();
    let device = fake ? (options.device ?? "wasm") : (options.device ?? (await detectAsrDevice()));
    for (;;) {
      // WebGPU may fail and the run starts again on WebAssembly: keep a copy of the samples
      const samples = device === "webgpu" ? audio.slice() : audio;
      const req: AsrRunRequest = { type: "run", id, audio: samples, language: options.language, choice: options.choice, device, ortBase: ortBase(), fake };
      const job = runInWorker(req, [samples.buffer], progress);
      current = job;
      try {
        return await job.promise;
      } catch (err) {
        if (cancelled) throw new AsrError("cancelled", "已取消");
        if (err instanceof AsrError && err.code === "webgpu" && device === "webgpu") {
          rememberWebgpuFailed();
          dropWorker();
          device = "wasm";
          continue;
        }
        // a failed model load leaves nothing worth keeping in the worker
        dropWorker();
        throw err;
      }
    }
  })().finally(() => {
    if (active === run) active = null;
  });

  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      current?.abort(new AsrError("cancelled", "已取消"));
      if (active === run) active = null;
    },
  };
}
