// Messages between the 「AI 自動對時」 engine (engine.ts, main thread) and asr.worker.ts.

import type { AsrWord } from "../lyrics/asr-align";
import type { AsrChoice, AsrDevice } from "./models";

/**
 * The e2e test hook (never set by the app): a canned transcript the worker returns instead of
 * running the model, with simulated download and listening progress. Set it as
 * `window.__livelyricsFakeAsr` before the page loads.
 */
export interface FakeAsr {
  words: AsrWord[];
  /** ms between simulated progress steps (default 60) */
  stepMs?: number;
  /** fail with this error code instead of answering */
  fail?: AsrErrorCode;
}

export interface AsrRunRequest {
  type: "run";
  id: number;
  /** 16 kHz mono, transferred */
  audio: Float32Array;
  /** ISO 639-1 for Whisper, null = detect */
  language: string | null;
  choice: AsrChoice;
  device: AsrDevice;
  /** where the ONNX Runtime WebAssembly files are served (self-hosted, see next.config.ts) */
  ortBase: string;
  fake?: FakeAsr;
}

export type AsrErrorCode =
  /** a model file could not be downloaded (retry) */
  | "download"
  /** no network on first use (the model is not cached yet) */
  | "offline"
  /** the model did not fit in memory (suggest 快速) */
  | "memory"
  /** WebGPU failed: the engine retries on WebAssembly */
  | "webgpu"
  | "unknown";

export type AsrProgressMessage =
  /** downloading (or reading from the browser cache) the model files; bytes over every file seen so far */
  | { type: "progress"; id: number; stage: "download"; loaded: number; total: number }
  /** creating the ONNX sessions */
  | { type: "progress"; id: number; stage: "load" }
  /** seconds of the song heard so far */
  | { type: "progress"; id: number; stage: "listen"; heard: number; seconds: number };

export type AsrResponse =
  /** the worker script loaded */
  | { type: "ready" }
  | AsrProgressMessage
  | { type: "result"; id: number; words: AsrWord[]; device: AsrDevice; seconds: number }
  | { type: "error"; id: number; code: AsrErrorCode; message: string };

export function isAsrResponse(value: unknown): value is AsrResponse {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "ready" || type === "progress" || type === "result" || type === "error";
}
