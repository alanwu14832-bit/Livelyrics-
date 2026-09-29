// Offline audio analysis entry points.
//  - analyzeSamples: pure DSP (see ./analysis), safe in Workers and Node tests
//  - analyzeFile: browser pipeline — decode with Web Audio (straight to 22.05 kHz when possible),
//    downmix to mono, analyse in a Web Worker, fall back to the main thread if Workers fail.

import type { AudioAnalysis } from "../types";
import { ANALYSIS_RATE, analyzeSamples } from "./analysis";
import { parseTags } from "./metadata";
import { isWorkerResponse, type AnalyzeRequest } from "./worker-protocol";

export { analyzeSamples, ANALYSIS_RATE, ENVELOPE_RATE, PROGRESS_LABELS } from "./analysis";
export type { AnalyzeOptions, ProgressCallback } from "./analysis";

/** same limit as the upload route */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_DURATION_S = 2 * 3600;

const READY_TIMEOUT_MS = 15_000;
const STALL_TIMEOUT_MS = 60_000;
const SAMPLE_RATE_WAIT_MS = 1_500;

export type AudioAnalysisErrorCode = "empty" | "too-large" | "too-long" | "read" | "unsupported" | "no-audio" | "no-webaudio";

/** A user-presentable failure (Traditional Chinese message). Cancellation rejects with an AbortError instead. */
export class AudioAnalysisError extends Error {
  readonly code: AudioAnalysisErrorCode;
  constructor(code: AudioAnalysisErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AudioAnalysisError";
    this.code = code;
  }
}

export function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

export interface AnalyzeFileOptions {
  /** cancels decoding/analysis; the promise then rejects with an AbortError */
  signal?: AbortSignal;
  /** default true; false forces main-thread analysis */
  worker?: boolean;
}

export const FILE_PROGRESS_LABELS = {
  read: "讀取檔案",
  decode: "解碼音訊",
  prepare: "準備分析",
} as const;

type WebAudioGlobals = typeof globalThis & {
  OfflineAudioContext?: typeof OfflineAudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  Worker?: typeof Worker;
};

function abortError(): DOMException {
  return new DOMException("已取消音訊分析", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Browser: decode an uploaded audio File and analyze it (in a Web Worker when possible). onProgress receives 0..1. */
export async function analyzeFile(
  file: File,
  onProgress?: (progress: number, label: string) => void,
  options: AnalyzeFileOptions = {},
): Promise<AudioAnalysis> {
  const { signal } = options;
  let last = 0;
  const report = (p: number, label: string) => {
    // monotonic, and a throwing UI callback must never break the analysis
    last = Math.max(last, Math.min(1, Math.max(0, p)));
    try {
      onProgress?.(last, label);
    } catch {
      /* ignore */
    }
  };
  throwIfAborted(signal);
  if (!file || typeof file.arrayBuffer !== "function") throw new AudioAnalysisError("read", "無效的檔案。");
  if (file.size === 0) throw new AudioAnalysisError("empty", "檔案是空的（0 位元組），請重新選擇音檔。");
  if (file.size > MAX_FILE_BYTES) {
    throw new AudioAnalysisError("too-large", `檔案超過 ${Math.round(MAX_FILE_BYTES / 1048576)} MB，請先轉成較小的 MP3 或 AAC 再上傳。`);
  }

  report(0, FILE_PROGRESS_LABELS.read);
  const sourceRate = parseTags(file).then((tags) => {
    const sr = tags?.format.sampleRate;
    return typeof sr === "number" && Number.isFinite(sr) && sr > 0 ? sr : undefined;
  });
  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch (err) {
    throw new AudioAnalysisError("read", "無法讀取檔案，請確認檔案沒有被移動、刪除或正被其他程式使用。", { cause: err });
  }
  throwIfAborted(signal);

  report(0.06, FILE_PROGRESS_LABELS.decode);
  const buffer = await decodeAudio(data);
  throwIfAborted(signal);
  if (buffer.length === 0 || !(buffer.duration > 0)) throw new AudioAnalysisError("no-audio", "檔案裡沒有可分析的音訊內容。");
  if (buffer.duration > MAX_DURATION_S) {
    throw new AudioAnalysisError("too-long", `音檔長度超過 ${MAX_DURATION_S / 3600} 小時，請上傳單一歌曲。`);
  }

  report(0.3, FILE_PROGRESS_LABELS.prepare);
  const sourceSampleRate = await Promise.race([sourceRate, delay(SAMPLE_RATE_WAIT_MS).then(() => undefined)]);
  const onAnalysis = (p: number, label: string) => report(0.3 + 0.7 * p, label);

  let samples = downmix(buffer);
  const WorkerCtor = (globalThis as WebAudioGlobals).Worker;
  if (options.worker !== false && typeof WorkerCtor === "function") {
    const outcome = await runInWorker(samples, buffer.sampleRate, sourceSampleRate, onAnalysis, signal);
    if (outcome.ok) return outcome.analysis;
    if (outcome.aborted) throw abortError();
    if (typeof console !== "undefined") console.warn("[livelyrics] 背景分析失敗，改在主執行緒分析：", outcome.error);
    // the samples were handed to the worker (detached): rebuild them from the decoded buffer
    if (outcome.transferred) samples = downmix(buffer);
  }
  // let the UI paint the progress label before the synchronous analysis blocks the thread
  await delay(30);
  throwIfAborted(signal);
  return analyzeSamples(samples, buffer.sampleRate, { sourceSampleRate, onProgress: onAnalysis });
}

/** Average all channels into one new, transferable buffer. */
export function downmix(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  const n = buffer.length;
  const channels = Math.max(1, buffer.numberOfChannels);
  const out = new Float32Array(n);
  if (channels === 1) {
    out.set(buffer.getChannelData(0));
    return out;
  }
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const g = 1 / channels;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const g = globalThis as WebAudioGlobals;
  const Offline = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  let ctx: BaseAudioContext | null = null;
  let dispose: (() => void) | null = null;
  if (typeof Offline === "function") {
    // decodeAudioData resamples to the context rate: decoding at 22.05 kHz saves memory and work
    for (const rate of [ANALYSIS_RATE, 44100, 48000]) {
      try {
        ctx = new Offline(1, 1, rate);
        break;
      } catch {
        /* rate not supported by this browser: try the next */
      }
    }
  }
  if (!ctx) {
    const Realtime = g.AudioContext ?? g.webkitAudioContext;
    if (typeof Realtime !== "function") {
      throw new AudioAnalysisError("no-webaudio", "此瀏覽器不支援 Web Audio，無法分析音訊。請改用最新版的 Chrome、Edge、Firefox 或 Safari。");
    }
    const realtime = new Realtime();
    ctx = realtime;
    dispose = () => void realtime.close().catch(() => {});
  }
  try {
    return await decodeWith(ctx, data);
  } catch (err) {
    throw new AudioAnalysisError(
      "unsupported",
      "無法解碼音訊：檔案可能已損毀，或瀏覽器不支援這個格式。建議改用 MP3、WAV、M4A（AAC）、FLAC 或 OGG。",
      { cause: err },
    );
  } finally {
    dispose?.();
  }
}

/** decodeAudioData with both the promise and the legacy callback form (older Safari). */
function decodeWith(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let done = false;
    const ok = (b: AudioBuffer) => {
      if (done) return;
      done = true;
      resolve(b);
    };
    const fail = (e: unknown) => {
      if (done) return;
      done = true;
      reject(e ?? new Error("decodeAudioData failed"));
    };
    try {
      const p = ctx.decodeAudioData(data, ok, fail) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === "function") p.then(ok, fail);
    } catch (e) {
      fail(e);
    }
  });
}

type WorkerOutcome =
  | { ok: true; analysis: AudioAnalysis }
  | { ok: false; aborted: boolean; transferred: boolean; error?: unknown };

let jobCounter = 0;

function looksLikeAnalysis(v: unknown): v is AudioAnalysis {
  if (!v || typeof v !== "object") return false;
  const a = v as Partial<AudioAnalysis>;
  return typeof a.duration === "number" && Array.isArray(a.energy) && Array.isArray(a.beats) && Array.isArray(a.sections);
}

/**
 * Analyse in a dedicated worker. The samples are only transferred after the worker reports
 * "ready", so a worker that fails to load leaves them intact for the main-thread fallback.
 */
function runInWorker(
  samples: Float32Array<ArrayBuffer>,
  sampleRate: number,
  sourceSampleRate: number | undefined,
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<WorkerOutcome> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./analyze.worker.ts", import.meta.url));
    } catch (error) {
      resolve({ ok: false, aborted: false, transferred: false, error });
      return;
    }
    const id = ++jobCounter;
    let transferred = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: WorkerOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      resolve(outcome);
    };
    const arm = (ms: number, what: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish({ ok: false, aborted: false, transferred, error: new Error(`analysis worker ${what}`) }), ms);
    };
    const onAbort = () => finish({ ok: false, aborted: true, transferred });
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<unknown>) => {
      const msg = event.data;
      if (!isWorkerResponse(msg)) return;
      if (msg.type === "ready") {
        if (transferred) return;
        const request: AnalyzeRequest = { type: "analyze", id, samples, sampleRate, sourceSampleRate };
        try {
          worker.postMessage(request, [samples.buffer]);
          transferred = true;
        } catch (error) {
          finish({ ok: false, aborted: false, transferred: false, error });
          return;
        }
        arm(STALL_TIMEOUT_MS, "stalled");
        return;
      }
      if (msg.id !== id) return;
      arm(STALL_TIMEOUT_MS, "stalled");
      if (msg.type === "progress") onProgress(msg.progress, msg.label);
      else if (msg.type === "result") {
        if (looksLikeAnalysis(msg.analysis)) finish({ ok: true, analysis: msg.analysis });
        else finish({ ok: false, aborted: false, transferred, error: new Error("malformed worker result") });
      } else finish({ ok: false, aborted: false, transferred, error: new Error(msg.message) });
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      finish({ ok: false, aborted: false, transferred, error: new Error(event.message || "analysis worker failed to load") });
    };
    worker.onmessageerror = () => finish({ ok: false, aborted: false, transferred, error: new Error("analysis worker message error") });
    if (signal?.aborted) onAbort();
    else arm(READY_TIMEOUT_MS, "did not start");
  });
}
