// Messages between analyzeFile (main thread) and analyze.worker.ts.

import type { AudioAnalysis } from "../types";

export interface AnalyzeRequest {
  type: "analyze";
  id: number;
  /** transferred, not copied */
  samples: Float32Array;
  sampleRate: number;
  sourceSampleRate?: number;
  /** round 14: the side signal (L − R) / 2 for the 人聲 curve (stereo files up to 20 minutes), transferred */
  side?: Float32Array;
  sideRate?: number;
}

export type WorkerResponse =
  /** the worker script loaded and is ready for a request */
  | { type: "ready" }
  | { type: "progress"; id: number; progress: number; label: string }
  | { type: "result"; id: number; analysis: AudioAnalysis }
  | { type: "error"; id: number; message: string };

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "ready" || type === "progress" || type === "result" || type === "error";
}
