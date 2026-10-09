// 「AI 自動對時」 (round 15): the pinned speech-recognition models. The data lives in models.json,
// which scripts/timing-eval/transcribe.mjs reads too, so the evaluation runs the browser's files.

import config from "./models.json";

/** 準確 = Whisper small (the default), 快速 = Whisper base */
export type AsrChoice = "accurate" | "fast";
/** where the encoder runs: WebGPU (an adapter with shader-f16) or WebAssembly */
export type AsrDevice = "webgpu" | "wasm";

export interface AsrModelSpec {
  /** Hugging Face model repo */
  id: string;
  /** a commit of that repo: the files never change under us */
  revision: string;
  /** per ONNX session */
  device: Record<string, AsrDevice>;
  dtype: Record<string, string>;
  /** everything the pipeline downloads (bytes) */
  bytes: number;
}

export const ASR_CHOICES: readonly AsrChoice[] = ["accurate", "fast"];
export const ASR_SAMPLE_RATE: number = config.sampleRate;
/** the transformers.js pipeline options (word timestamps, 30 s windows with 5 s strides, transcribe) */
export const ASR_PIPELINE = config.pipeline as { return_timestamps: "word"; chunk_length_s: number; stride_length_s: number; task: "transcribe" };

export function asrModel(choice: AsrChoice, device: AsrDevice): AsrModelSpec {
  const m = config.models[choice];
  const variant = m[device];
  return { id: m.id, revision: m.revision, device: variant.device as Record<string, AsrDevice>, dtype: variant.dtype, bytes: variant.bytes };
}

/** every model id → its pinned revision (the worker's env.fetch pins transformers.js' stray `main` requests) */
export function asrHubPins(): Record<string, string> {
  return Object.fromEntries(ASR_CHOICES.map((c) => [config.models[c].id, config.models[c].revision]));
}

/** "約 250 MB": the one-time download, rounded the way the sheet says it */
export function downloadLabel(choice: AsrChoice, device: AsrDevice): string {
  const mb = asrModel(choice, device).bytes / 1e6;
  const rounded = mb >= 150 ? Math.round(mb / 10) * 10 : Math.round(mb / 5) * 5;
  return `約 ${rounded} MB`;
}

export const ASR_CHOICE_LABEL: Record<AsrChoice, string> = { accurate: "準確", fast: "快速" };
export const ASR_MODEL_NAME: Record<AsrChoice, string> = { accurate: "Whisper small", fast: "Whisper base" };

/** How many 30 s windows the pipeline runs for `seconds` of audio (it advances window − 2 × stride). */
export function asrChunkCount(seconds: number): number {
  const { chunk_length_s: window, stride_length_s: stride } = ASR_PIPELINE;
  const jump = window - 2 * stride;
  if (!(seconds > window)) return 1;
  return Math.ceil((seconds - window) / jump) + 1;
}

/** Seconds of the song heard once window `index` (0-based) is done. */
export function asrHeardAfter(index: number, seconds: number): number {
  const { chunk_length_s: window, stride_length_s: stride } = ASR_PIPELINE;
  const jump = window - 2 * stride;
  if (index + 1 >= asrChunkCount(seconds)) return seconds;
  return Math.min(seconds, (index + 1) * jump + stride);
}
