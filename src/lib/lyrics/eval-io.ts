// Node-only I/O of the local evaluation harnesses (timing-eval.test.ts, structure-eval.test.ts):
// 16-bit WAV reading and the per-song analysis cache. Used by tests only; never imported by the app.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { analyzeSamples } from "../audio/analysis";
import { sideRateFor, sideSignal } from "../audio/vocal";
import type { AudioAnalysis } from "../types";

export const REPO = path.resolve(__dirname, "../../..");

export interface Wav {
  rate: number;
  left: Float32Array;
  right: Float32Array | null;
}

export function readWav(file: string): Wav {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${file}: not a WAV file`);
  let pos = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16 || channels < 1 || channels > 2) throw new Error(`${file}: expected 16-bit mono / stereo PCM`);
      const n = Math.floor(Math.min(size, buf.length - body) / (2 * channels));
      const bytes = buf.subarray(body, body + n * 2 * channels);
      // little-endian hosts only (every machine this runs on); copy when the view would be unaligned
      const pcm = (bytes.byteOffset & 1) === 0 ? new Int16Array(bytes.buffer, bytes.byteOffset, n * channels) : new Int16Array(Uint8Array.from(bytes).buffer);
      const left = new Float32Array(n);
      const right = channels === 2 ? new Float32Array(n) : null;
      for (let i = 0; i < n; i++) {
        left[i] = pcm[i * channels] / 32768;
        if (right) right[i] = pcm[i * 2 + 1] / 32768;
      }
      return { rate, left, right };
    }
    pos = body + size + (size & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

/** The analysis cache key: the analysis code itself (any change re-analyses every song). */
export function analysisCodeKey(): string {
  const dir = path.join(REPO, "src/lib/audio");
  const h = createHash("sha1");
  for (const f of fs.readdirSync(dir).sort()) {
    if (f.endsWith(".ts") && !f.endsWith(".test.ts")) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  }
  return h.digest("hex").slice(0, 10);
}

export function analyse(cache: string, stem: string, key: string): { analysis: AudioAnalysis; seconds: number; cached: boolean } {
  const cacheFile = path.join(cache, `${stem}.analysis-${key}.json`);
  if (fs.existsSync(cacheFile)) return { analysis: JSON.parse(fs.readFileSync(cacheFile, "utf8")) as AudioAnalysis, seconds: 0, cached: true };
  const wav = readWav(path.join(cache, `${stem}.wav`));
  const mono = monoOf(wav);
  const t0 = performance.now();
  // the upload's own path: the mono downmix, and the side signal of a stereo file (analyzeFile)
  const side = wav.right ? sideSignal(wav.left, wav.right, wav.rate) : null;
  const analysis = analyzeSamples(mono, wav.rate, { side, sideRate: sideRateFor(wav.rate) });
  const seconds = (performance.now() - t0) / 1000;
  fs.writeFileSync(cacheFile, JSON.stringify(analysis));
  return { analysis, seconds, cached: false };
}

export function monoOf(wav: Wav): Float32Array {
  const mono = new Float32Array(wav.left.length);
  if (wav.right) for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (wav.left[i] + wav.right[i]);
  else mono.set(wav.left);
  return mono;
}
