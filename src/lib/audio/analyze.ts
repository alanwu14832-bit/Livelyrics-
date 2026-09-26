// STUB — owned by the AUDIO module. Replace the implementation, keep the exports.
import type { AudioAnalysis } from "../types";

/** Pure offline analysis of mono samples. Deterministic; safe to run in a Worker or in Node tests. */
export function analyzeSamples(mono: Float32Array, sampleRate: number): AudioAnalysis {
  void mono;
  void sampleRate;
  throw new Error("analyzeSamples: not implemented");
}

/** Browser: decode an uploaded audio File and analyze it (in a Web Worker when possible). onProgress receives 0..1. */
export async function analyzeFile(file: File, onProgress?: (progress: number, label: string) => void): Promise<AudioAnalysis> {
  void file;
  void onProgress;
  throw new Error("analyzeFile: not implemented");
}
