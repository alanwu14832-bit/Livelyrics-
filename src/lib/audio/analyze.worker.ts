// Web Worker entry: runs the pure analysis off the main thread.
// Created by analyzeFile via new Worker(new URL("./analyze.worker.ts", import.meta.url)).

import { analyzeSamples } from "./analysis";
import type { AnalyzeRequest, WorkerResponse } from "./worker-protocol";

/** the slice of DedicatedWorkerGlobalScope we use (the project compiles against the DOM lib) */
interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<AnalyzeRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

function send(message: WorkerResponse): void {
  scope.postMessage(message);
}

scope.addEventListener("message", (event: MessageEvent<AnalyzeRequest>) => {
  const req = event.data;
  if (!req || req.type !== "analyze") return;
  try {
    if (!(req.samples instanceof Float32Array)) throw new TypeError("samples must be a Float32Array");
    let lastSent = 0;
    let lastLabel = "";
    const analysis = analyzeSamples(req.samples, req.sampleRate, {
      sourceSampleRate: req.sourceSampleRate,
      onProgress: (progress, label) => {
        // at most ~30 messages per second, but never drop a stage change
        const now = Date.now();
        if (progress < 1 && label === lastLabel && now - lastSent < 33) return;
        lastSent = now;
        lastLabel = label;
        send({ type: "progress", id: req.id, progress, label });
      },
    });
    send({ type: "result", id: req.id, analysis });
  } catch (err) {
    send({ type: "error", id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
});

send({ type: "ready" });
