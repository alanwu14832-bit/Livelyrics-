// A SMPTE LTC encoder for the tests (phase 5a): timecode labels → biphase-mark audio at any sample
// rate, with the imperfections a real line has (speed error, noise, level changes, dropouts, soft
// edges). Not imported by application code. scripts/e2e-sync.cjs has a plain-JS copy of the same
// bit layout for the WAV it feeds to Chromium's fake microphone.

import { prng } from "@/lib/audio/testing/signals";
import { framesToTc, realFps, tcToFrames, type FrameRate, type Timecode } from "../timecode";

export interface LtcEncodeOptions {
  sampleRate: number;
  rate: FrameRate;
  start: Timecode;
  /** frames to encode */
  frames: number;
  /** peak amplitude (default 0.5) */
  amplitude?: number;
  /** tape speed: 1.01 = 1 % fast (the timecode itself is unchanged) */
  speed?: number;
  /** uniform white noise of this amplitude */
  noise?: number;
  seed?: number;
  /** one-pole low-pass time constant in samples (0 = sharp, 3 ≈ a sine-ish line) */
  smoothing?: number;
  /** gain over time (seconds from the start of the signal) */
  gain?: (t: number) => number;
  /** silent stretches [from, to) in seconds */
  dropouts?: ReadonlyArray<readonly [number, number]>;
  /** silence before the first frame (seconds) */
  leadIn?: number;
  /** random user bits (the decoder must ignore them) */
  userBits?: boolean;
}

export interface LtcEncoded {
  samples: Float32Array;
  /** sample position where each frame ends (the next frame's first transition) */
  ends: number[];
  labels: Timecode[];
}

const SYNC = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];

/** The 80 bits of one frame, bit 0 first. */
export function ltcFrameBits(tc: Timecode, rate: FrameRate, user = 0): number[] {
  const bits = new Array<number>(80).fill(0);
  const put = (from: number, count: number, v: number) => {
    for (let k = 0; k < count; k++) bits[from + k] = (v >> k) & 1;
  };
  put(0, 4, tc.frames % 10);
  put(8, 2, Math.floor(tc.frames / 10));
  bits[10] = rate === 29.97 ? 1 : 0;
  put(16, 4, tc.seconds % 10);
  put(24, 3, Math.floor(tc.seconds / 10));
  put(32, 4, tc.minutes % 10);
  put(40, 3, Math.floor(tc.minutes / 10));
  put(48, 4, tc.hours % 10);
  put(56, 2, Math.floor(tc.hours / 10));
  // user bits: groups of 4 at 4, 12, 20, 28, 36, 44, 52, 60
  [4, 12, 20, 28, 36, 44, 52, 60].forEach((at, g) => put(at, 4, (user >> (g * 4)) & 0xf));
  for (let k = 0; k < 16; k++) bits[64 + k] = SYNC[k];
  // polarity correction: an even number of zeros in the frame (bit 59 at 25 fps, else 27)
  const parity = rate === 25 ? 59 : 27;
  bits[parity] = 0;
  const zeros = bits.filter((b) => b === 0).length;
  if (zeros % 2 === 1) bits[parity] = 1;
  return bits;
}

export function encodeLtc(opts: LtcEncodeOptions): LtcEncoded {
  const { sampleRate: sr, rate, start, frames } = opts;
  const amp = opts.amplitude ?? 0.5;
  const speed = opts.speed ?? 1;
  const bitLen = sr / (80 * realFps(rate) * speed);
  const lead = Math.round((opts.leadIn ?? 0) * sr);
  const total = lead + Math.ceil(frames * 80 * bitLen) + Math.ceil(bitLen * 4);
  const rand = prng(opts.seed ?? 7);
  const edges: number[] = [];
  const ends: number[] = [];
  const labels: Timecode[] = [];
  const first = tcToFrames(start, rate);
  let t = lead;
  for (let k = 0; k < frames; k++) {
    const label = framesToTc(first + k, rate);
    labels.push(label);
    const user = opts.userBits ? Math.floor(rand() * 0xffffffff) : 0;
    for (const b of ltcFrameBits(label, rate, user)) {
      edges.push(t);
      if (b) edges.push(t + bitLen / 2);
      t += bitLen;
    }
    ends.push(t);
  }
  // the transition that starts the next (unsent) frame closes the last bit
  edges.push(t);
  // box-filtered square wave: each sample is the mean level over its interval
  const out = new Float32Array(total);
  let level = -1;
  let e = 0;
  for (let n = 0; n < total; n++) {
    let acc = 0;
    let from = n;
    while (e < edges.length && edges[e] < n + 1) {
      if (edges[e] > from) {
        acc += level * (edges[e] - from);
        from = edges[e];
      }
      level = -level;
      e++;
    }
    acc += level * (n + 1 - from);
    // silence before the first transition and after the last
    out[n] = n + 1 <= lead || n >= t + 1 ? 0 : acc * amp;
  }
  const tau = opts.smoothing ?? 0;
  if (tau > 0) {
    const k = 1 - Math.exp(-1 / tau);
    let y = 0;
    for (let n = 0; n < total; n++) {
      y += (out[n] - y) * k;
      out[n] = y;
    }
  }
  const noise = opts.noise ?? 0;
  for (let n = 0; n < total; n++) {
    const sec = n / sr;
    let v = out[n];
    if (opts.gain) v *= opts.gain(sec);
    if (opts.dropouts?.some(([a, b]) => sec >= a && sec < b)) v = 0;
    if (noise > 0) v += (rand() * 2 - 1) * noise;
    out[n] = v;
  }
  return { samples: out, ends, labels };
}

/** The label a frame count after `start` has (drop-frame aware). */
export function labelAfter(start: Timecode, rate: FrameRate, frames: number): Timecode {
  return framesToTc(tcToFrames(start, rate) + frames, rate);
}
