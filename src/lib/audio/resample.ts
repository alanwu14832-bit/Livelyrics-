// Band-limited downsampling (windowed-sinc, polyphase table) and input sanitizing.

/** Copy-on-write sanitizer: returns the input itself when every sample is finite. */
export function sanitizeSamples(input: Float32Array): Float32Array {
  let bad = -1;
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    if (v !== v || v === Infinity || v === -Infinity) {
      bad = i;
      break;
    }
  }
  if (bad < 0) return input;
  const out = new Float32Array(input.length);
  out.set(input.subarray(0, bad));
  for (let i = bad; i < input.length; i++) {
    const v = input[i];
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

const PHASES = 256;

/**
 * Downsample `input` from `fromRate` to `toRate` (toRate < fromRate) with an anti-aliasing
 * Blackman-windowed sinc low-pass. Deterministic; about (2·⌈6·ratio⌉) MACs per output sample.
 */
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError("downsample: sample rates must be positive");
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor((input.length * toRate) / fromRate + 1e-9);
  const out = new Float32Array(outLength);
  if (outLength === 0) return out;

  // cutoff a little under the new Nyquist, expressed in cycles per input sample
  const fc = (0.5 / ratio) * 0.92;
  const half = Math.ceil(6 * ratio);
  const taps = 2 * half;
  const table = new Float32Array((PHASES + 1) * taps);
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const x = k - half + 1 - frac; // distance of input tap from the output position
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const u = (x + half) / (2 * half); // 0..1 across the window
      const w = u <= 0 || u >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * u) + 0.08 * Math.cos(4 * Math.PI * u);
      const h = sinc * w;
      table[p * taps + k] = h;
      sum += h;
    }
    if (sum !== 0) for (let k = 0; k < taps; k++) table[p * taps + k] /= sum;
  }

  const n = input.length;
  for (let o = 0; o < outLength; o++) {
    const pos = o * ratio;
    let i0 = Math.floor(pos);
    let phase = Math.round((pos - i0) * PHASES);
    if (phase === PHASES) {
      phase = 0;
      i0 += 1;
    }
    const base = phase * taps;
    const first = i0 - half + 1;
    let acc = 0;
    if (first >= 0 && first + taps <= n) {
      for (let k = 0; k < taps; k++) acc += input[first + k] * table[base + k];
    } else {
      for (let k = 0; k < taps; k++) {
        const idx = first + k;
        if (idx >= 0 && idx < n) acc += input[idx] * table[base + k];
      }
    }
    out[o] = acc;
  }
  return out;
}

/** One-pole DC blocker (≈10 Hz high-pass). Always returns a new array. */
export function removeDc(input: Float32Array, sampleRate: number, cutoffHz = 10): Float32Array {
  const out = new Float32Array(input.length);
  const r = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let prevX = input.length > 0 ? input[0] : 0;
  let prevY = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = x - prevX + r * prevY;
    out[i] = y;
    prevX = x;
    prevY = y;
  }
  return out;
}
