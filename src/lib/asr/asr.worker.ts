// 「AI 自動對時」 Web Worker (round 15): runs Whisper (transformers.js + ONNX Runtime Web) on the
// song's 16 kHz mono samples with word timestamps. Created by engine.ts via
// new Worker(new URL("./asr.worker.ts", import.meta.url)); transformers.js is imported lazily here,
// so it lives only in this worker's chunks (never in the server bundle or on other pages).
// The model files come from huggingface.co (pinned revisions, cached by the browser after the first
// download — afterwards a run makes no network request: hub-fetch.ts); the ONNX Runtime WebAssembly
// files are self-hosted (next.config.ts copies them).
// The audio never leaves this computer.

import type { AsrWord } from "../lyrics/asr-align";
import { pinnedFetch } from "./hub-fetch";
import { ASR_PIPELINE, ASR_SAMPLE_RATE, asrChunkCount, asrHeardAfter, asrHubPins, asrModel, type AsrDevice } from "./models";
import type { AsrErrorCode, AsrResponse, AsrRunRequest } from "./protocol";

/** the slice of DedicatedWorkerGlobalScope we use (the project compiles against the DOM lib) */
interface WorkerScope {
  postMessage(message: AsrResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<AsrRunRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;
const send = (message: AsrResponse) => scope.postMessage(message);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** the pipeline call we make (typed loosely: transformers.js' overloads are not worth importing here) */
type Transcriber = ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: Array<{ text: string; timestamp: [number | null, number | null] }> }>) & {
  tokenizer?: { timestamp_begin?: number };
  model?: { generate: (args: unknown) => Promise<unknown> };
};

let loaded: { key: string; pipe: Promise<Transcriber> } | null = null;

function classify(err: unknown, device: AsrDevice): AsrErrorCode {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (/out of memory|\bOOM\b|allocation failed|Cannot allocate|could not allocate|memory access out of bounds|Aborted\(\)|WebAssembly\.Memory|bad_alloc/i.test(msg)) return "memory";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (/fetch|network|Load failed|ERR_|status code|HTTP|Could not locate file|Unauthorized|Forbidden|Not Found|timed? ?out/i.test(msg)) return "download";
  // anything else on WebGPU: the engine tries again on WebAssembly
  if (device === "webgpu") return "webgpu";
  return "unknown";
}

async function loadPipeline(req: AsrRunRequest): Promise<Transcriber> {
  const key = `${req.choice}:${req.device}`;
  if (loaded?.key === key) return loaded.pipe;
  const spec = asrModel(req.choice, req.device);
  const pipe = (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    // pinned, and served from the cache once downloaded (transformers.js asks for a few files at `main`)
    const cacheKey = env.cacheKey;
    env.fetch = pinnedFetch(asrHubPins(), globalThis.fetch.bind(globalThis), () => (typeof caches === "undefined" ? Promise.resolve(null) : caches.open(cacheKey)));
    const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; proxy?: boolean } };
    if (onnx.wasm) {
      // self-hosted, not the CDN transformers.js would pick
      onnx.wasm.wasmPaths = { mjs: `${req.ortBase}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${req.ortBase}ort-wasm-simd-threaded.asyncify.wasm` };
      onnx.wasm.proxy = false;
    }
    let lastSent = 0;
    let lastLoaded = 0;
    const progress = (info: { status?: string; loaded?: number }) => {
      if (info.status !== "progress_total" || typeof info.loaded !== "number") return;
      const now = Date.now();
      lastLoaded = Math.max(lastLoaded, info.loaded);
      if (now - lastSent < 120) return;
      lastSent = now;
      send({ type: "progress", id: req.id, stage: "download", loaded: Math.min(lastLoaded, spec.bytes), total: spec.bytes });
    };
    const created = pipeline("automatic-speech-recognition", spec.id, {
      revision: spec.revision,
      dtype: spec.dtype as never,
      device: spec.device as never,
      progress_callback: progress as never,
    });
    return (await created) as unknown as Transcriber;
  })();
  loaded = { key, pipe };
  pipe.catch(() => {
    if (loaded?.pipe === pipe) loaded = null;
  });
  return pipe;
}

async function run(req: AsrRunRequest): Promise<void> {
  const t0 = performance.now();
  const seconds = req.audio.length / ASR_SAMPLE_RATE;
  const spec = asrModel(req.choice, req.device);
  send({ type: "progress", id: req.id, stage: "download", loaded: 0, total: spec.bytes });
  const asr = await loadPipeline(req);
  send({ type: "progress", id: req.id, stage: "load" });
  send({ type: "progress", id: req.id, stage: "listen", heard: 0, seconds });

  // progress: the pipeline calls model.generate once per 30 s window (wrapped here to count them);
  // inside a window Whisper decodes segment by segment (a seek loop: streamer.end() after each),
  // and a timestamp token says how far into the segment the words are
  const jump = ASR_PIPELINE.chunk_length_s - 2 * ASR_PIPELINE.stride_length_s;
  const timestampBegin = asr.tokenizer?.timestamp_begin;
  let windowIndex = 0;
  let segmentOffset = 0;
  let lastTimestamp = 0;
  let heard = 0;
  let lastSent = 0;
  const report = (t: number, force = false) => {
    heard = Math.min(seconds, Math.max(heard, t));
    const now = Date.now();
    if (!force && now - lastSent < 200) return;
    lastSent = now;
    send({ type: "progress", id: req.id, stage: "listen", heard, seconds });
  };
  const streamer = {
    put(value: Array<Array<bigint | number>>) {
      if (typeof timestampBegin !== "number") return;
      const ids = value?.[0];
      if (!ids || ids.length !== 1) return; // the prompt, not a generated token
      const id = Number(ids[0]);
      if (id < timestampBegin) return;
      lastTimestamp = (id - timestampBegin) * 0.02;
      // never past this window's end (the segment offsets are an estimate)
      const windowStart = windowIndex * jump;
      report(Math.min(windowStart + ASR_PIPELINE.chunk_length_s - ASR_PIPELINE.stride_length_s, windowStart + segmentOffset + lastTimestamp));
    },
    end() {
      segmentOffset += lastTimestamp;
      lastTimestamp = 0;
    },
  };
  const model = asr.model;
  const generate = model?.generate;
  if (model && typeof generate === "function") {
    model.generate = async (args: unknown) => {
      segmentOffset = 0;
      lastTimestamp = 0;
      try {
        return await generate.call(model, args);
      } finally {
        report(asrHeardAfter(windowIndex, seconds), true);
        windowIndex = Math.min(windowIndex + 1, asrChunkCount(seconds) - 1);
      }
    };
  }
  let result: Awaited<ReturnType<Transcriber>>;
  try {
    result = await asr(req.audio, { ...ASR_PIPELINE, language: req.language ?? undefined, streamer });
  } finally {
    if (model && typeof generate === "function") model.generate = generate;
  }
  const words: AsrWord[] = (result.chunks ?? []).map((c) => ({ text: c.text, start: c.timestamp?.[0] ?? null, end: c.timestamp?.[1] ?? null }));
  send({ type: "result", id: req.id, words, device: req.device, seconds: (performance.now() - t0) / 1000 });
}

/** the e2e hook: a canned transcript with simulated progress, no model */
async function fakeRun(req: AsrRunRequest): Promise<void> {
  const fake = req.fake!;
  const step = Math.max(0, fake.stepMs ?? 60);
  const total = asrModel(req.choice, req.device).bytes;
  for (let k = 0; k <= 10; k++) {
    send({ type: "progress", id: req.id, stage: "download", loaded: Math.round((total * k) / 10), total });
    await sleep(step);
  }
  send({ type: "progress", id: req.id, stage: "load" });
  await sleep(step);
  const seconds = req.audio.length / ASR_SAMPLE_RATE;
  const n = asrChunkCount(seconds);
  send({ type: "progress", id: req.id, stage: "listen", heard: 0, seconds });
  for (let k = 0; k < n; k++) {
    await sleep(step);
    send({ type: "progress", id: req.id, stage: "listen", heard: asrHeardAfter(k, seconds), seconds });
  }
  if (fake.fail) {
    send({ type: "error", id: req.id, code: fake.fail, message: `fake ${fake.fail}` });
    return;
  }
  send({ type: "result", id: req.id, words: fake.words, device: req.device, seconds: 0 });
}

let busy = false;

scope.addEventListener("message", (event: MessageEvent<AsrRunRequest>) => {
  const req = event.data;
  if (!req || req.type !== "run") return;
  if (busy) {
    send({ type: "error", id: req.id, code: "unknown", message: "busy" });
    return;
  }
  busy = true;
  const job = req.fake ? fakeRun(req) : run(req);
  job
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: "error", id: req.id, code: classify(err, req.device), message });
    })
    .finally(() => {
      busy = false;
    });
});

send({ type: "ready" });
