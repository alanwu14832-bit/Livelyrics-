// Radix-2 FFT for real input (packed into a half-size complex FFT) plus window helpers.
// Allocation-free after construction so it can run over tens of thousands of frames.

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

/** Periodic Hann window of length n (the STFT-friendly variant). */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Real FFT of size n (power of two, ≥ 4). `forward` takes n real samples and writes
 * bins 0..n/2 (inclusive) as separate real/imaginary arrays.
 */
export class RealFFT {
  readonly size: number;
  private readonly half: number;
  private readonly rev: Uint32Array;
  /** twiddles of the half-size complex FFT: e^{-2πik/half} */
  private readonly cosH: Float64Array;
  private readonly sinH: Float64Array;
  /** twiddles of the real-split step: e^{-2πik/n} */
  private readonly cosN: Float64Array;
  private readonly sinN: Float64Array;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;

  constructor(n: number) {
    if (!isPowerOfTwo(n) || n < 4) throw new RangeError(`RealFFT: size must be a power of two ≥ 4 (got ${n})`);
    this.size = n;
    const m = n >> 1;
    this.half = m;
    this.rev = new Uint32Array(m);
    const bits = Math.round(Math.log2(m));
    for (let i = 0; i < m; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cosH = new Float64Array(m >> 1 || 1);
    this.sinH = new Float64Array(m >> 1 || 1);
    for (let k = 0; k < m >> 1; k++) {
      this.cosH[k] = Math.cos((2 * Math.PI * k) / m);
      this.sinH[k] = -Math.sin((2 * Math.PI * k) / m);
    }
    this.cosN = new Float64Array(m + 1);
    this.sinN = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) {
      this.cosN[k] = Math.cos((2 * Math.PI * k) / n);
      this.sinN[k] = -Math.sin((2 * Math.PI * k) / n);
    }
    this.zr = new Float64Array(m);
    this.zi = new Float64Array(m);
  }

  /** input: n real samples; outRe/outIm: length ≥ n/2 + 1 */
  forward(input: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array): void {
    const m = this.half;
    const zr = this.zr;
    const zi = this.zi;
    const rev = this.rev;
    const cosH = this.cosH;
    const sinH = this.sinH;
    const cosN = this.cosN;
    const sinN = this.sinN;
    for (let i = 0; i < m; i++) {
      const j = rev[i];
      zr[j] = input[2 * i];
      zi[j] = input[2 * i + 1];
    }
    // iterative radix-2 butterflies
    for (let len = 2; len <= m; len <<= 1) {
      const halfLen = len >> 1;
      const step = m / len;
      for (let k = 0; k < halfLen; k++) {
        const wr = cosH[k * step];
        const wi = sinH[k * step];
        for (let a = k; a < m; a += len) {
          const b = a + halfLen;
          const xr = zr[b];
          const xi = zi[b];
          const br = xr * wr - xi * wi;
          const bi = xr * wi + xi * wr;
          const ar = zr[a];
          const ai = zi[a];
          zr[b] = ar - br;
          zi[b] = ai - bi;
          zr[a] = ar + br;
          zi[a] = ai + bi;
        }
      }
    }
    // split the packed spectrum into the spectrum of the real signal
    for (let k = 0; k <= m; k++) {
      const k1 = k === m ? 0 : k;
      const k2 = k === 0 ? 0 : m - k;
      const ar = zr[k1];
      const ai = zi[k1];
      const cr = zr[k2];
      const ci = -zi[k2];
      const er = 0.5 * (ar + cr);
      const ei = 0.5 * (ai + ci);
      const orr = 0.5 * (ai - ci);
      const oi = -0.5 * (ar - cr);
      const wr = cosN[k];
      const wi = sinN[k];
      outRe[k] = er + (orr * wr - oi * wi);
      outIm[k] = ei + (orr * wi + oi * wr);
    }
  }
}
