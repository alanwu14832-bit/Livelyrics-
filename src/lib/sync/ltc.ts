// SMPTE linear timecode (LTC) decoding (phase 5a, 時間碼模式): audio samples in, timecode frames
// out. Pure and self-contained on purpose (no imports, no globals): scripts/build-worklets.mjs
// copies this file into the AudioWorklet that runs it in the browser
// (public/worklets/ltc-decoder.js, see ltc-worklet.ts), and vitest runs it on encoder-generated audio.
//
// LTC is biphase mark code at 80 bits a frame (24 fps: 1920 bit/s … 30 fps: 2400 bit/s): every bit
// starts with a transition, a 1 has a second one in its middle. Decoding:
// 1. A 10 Hz DC blocker, then zero crossings with hysteresis (30 % of a fast-attack, 8 ms-release
//    peak follower): level changes and noise do not create or move transitions; the transition
//    time is the interpolated zero crossing, so the hysteresis adds no delay.
// 2. Transition intervals are half bits (short) or whole bits (long). The boundary is 0.75 of the
//    bit period, which adapts to every decoded bit (±1 % speed changes, 44.1 / 48 kHz); before the
//    first bit a fixed boundary works for every frame rate (half bits are 10-13 samples at 48 kHz,
//    whole bits 20-25). A lone half bit, an interval out of range or a dropout resyncs.
// 3. The last 16 bits are the sync word 0011 1111 1111 1101 (0x3FFD; played backwards 0xBFFC).
//    The 64 bits before it hold the BCD timecode (frame, second, minute, hour units and tens, the
//    drop-frame flag at bit 10); the user bits are ignored. Out-of-range digits reject the frame.
// A frame ends at the transition that starts the next one: `end` is that sample position, where
// the tape is one frame past the decoded label (the decode latency the caller adds back).
// The frame rate comes from the measured bit rate (24 / 25 / 30), cross-checked with the frame
// numbers; 29.97 is 30 with the drop-frame flag.

export type LtcFps = 24 | 25 | 30;

export interface LtcFrame {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  dropFrame: boolean;
  /** the tape runs backwards (the sync word arrived reversed) */
  reverse: boolean;
  /** fractional sample index (the decoder's count, or the caller's `start` positions) where the frame ended */
  end: number;
  /** measured samples per frame (80 bits) */
  samplesPerFrame: number;
  /** nominal frames per second from the bit rate */
  fps: LtcFps;
}

const SYNC_FORWARD = 0x3ffd;
const SYNC_REVERSE = 0xbffc;
const FRAME_BITS = 80;
/** below this peak level (about −60 dBFS) the input is silence: no transitions */
const MIN_LEVEL = 0.001;
const HYSTERESIS = 0.3;

export class LtcDecoder {
  readonly sampleRate: number;
  /** absolute index of the next sample */
  private index = 0;
  private hpX = 0;
  private hpY = 0;
  private readonly hpR: number;
  private env = 0;
  private readonly envDecay: number;
  private high = false;
  private prev = 0;
  private zeroUp = -1;
  private zeroDown = -1;
  private lastEdge = -1;
  /** samples per bit, 0 = unknown */
  private bitLen = 0;
  /** the first half of a 1 (its length), -1 = none */
  private pendingHalf = -1;
  private readonly ring = new Uint8Array(FRAME_BITS);
  private ringPos = 0;
  private ringCount = 0;
  private sync = 0;
  /** samples since the last good frame (a long failure forgets the bit rate) */
  private sinceFrame = 0;
  /** good frames decoded so far */
  decoded = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 48000;
    this.hpR = 1 - (2 * Math.PI * 10) / this.sampleRate;
    this.envDecay = Math.exp(-1 / (0.008 * this.sampleRate));
  }

  /** The measured bit period in samples (0 before the first bit). */
  get bitPeriod(): number {
    return this.bitLen;
  }

  /**
   * Decode a block of samples. `start` is the absolute index of samples[0] (an AudioWorklet's
   * currentFrame); a jump in it (an input gap) resyncs. Returns the frames that ended in the block.
   */
  process(samples: ArrayLike<number>, start?: number): LtcFrame[] {
    if (start !== undefined && start !== this.index) {
      this.discontinuity();
      this.index = start;
    }
    const out: LtcFrame[] = [];
    const n0 = this.index;
    for (let i = 0; i < samples.length; i++) {
      const n = n0 + i;
      const x = samples[i];
      const y = x - this.hpX + this.hpR * this.hpY;
      this.hpX = x;
      this.hpY = y;
      const p = this.prev;
      if (p <= 0 && y > 0) this.zeroUp = n - 1 + -p / (y - p);
      else if (p >= 0 && y < 0) this.zeroDown = n - 1 + p / (p - y);
      this.prev = y;
      const a = y < 0 ? -y : y;
      this.env = a > this.env ? a : this.env * this.envDecay;
      if (this.env < MIN_LEVEL) continue;
      const h = this.env * HYSTERESIS;
      if (!this.high) {
        if (y > h) {
          this.high = true;
          this.edge(this.zeroUp, n, out);
        }
      } else if (y < -h) {
        this.high = false;
        this.edge(this.zeroDown, n, out);
      }
    }
    this.index = n0 + samples.length;
    this.sinceFrame += samples.length;
    if (this.sinceFrame > this.sampleRate) {
      // a second without a frame: forget the bit rate (another source may come)
      this.bitLen = 0;
      this.sinceFrame = 0;
    }
    return out;
  }

  /** Forget the bits in flight (an input gap); the bit rate is kept. */
  private discontinuity(): void {
    this.slip();
    this.lastEdge = -1;
    this.zeroUp = -1;
    this.zeroDown = -1;
  }

  private slip(): void {
    this.pendingHalf = -1;
    this.ringCount = 0;
    this.sync = 0;
  }

  private edge(zero: number, n: number, out: LtcFrame[]): void {
    // the zero crossing that the hysteresis confirmed (never before the previous transition)
    const pos = zero > this.lastEdge && zero <= n ? zero : n;
    if (this.lastEdge < 0) {
      this.lastEdge = pos;
      return;
    }
    const len = pos - this.lastEdge;
    this.lastEdge = pos;
    const bl = this.bitLen;
    const sr = this.sampleRate;
    const shortMin = bl ? bl * 0.3 : sr / 6000;
    const boundary = bl ? bl * 0.75 : sr / 3000;
    const longMax = bl ? bl * 1.4 : sr / 1400;
    if (len < shortMin || len > longMax) {
      this.slip();
      return;
    }
    if (len < boundary) {
      if (this.pendingHalf < 0) {
        this.pendingHalf = len;
        return;
      }
      const full = this.pendingHalf + len;
      this.pendingHalf = -1;
      this.adapt(full);
      this.bit(1, out);
      return;
    }
    if (this.pendingHalf >= 0) {
      // a lone half bit: the pairing was off by half a bit; this whole bit starts on a boundary
      this.slip();
    }
    this.adapt(len);
    this.bit(0, out);
  }

  private adapt(full: number): void {
    if (!this.bitLen) this.bitLen = full;
    else if (Math.abs(full - this.bitLen) < 0.25 * this.bitLen) this.bitLen += (full - this.bitLen) * 0.08;
  }

  private bit(b: number, out: LtcFrame[]): void {
    this.ring[this.ringPos] = b;
    this.ringPos = (this.ringPos + 1) % FRAME_BITS;
    if (this.ringCount < FRAME_BITS) this.ringCount++;
    this.sync = ((this.sync << 1) | b) & 0xffff;
    if (this.ringCount < FRAME_BITS) return;
    if (this.sync === SYNC_FORWARD) this.frame(false, out);
    else if (this.sync === SYNC_REVERSE) this.frame(true, out);
  }

  private frame(reverse: boolean, out: LtcFrame[]): void {
    const ring = this.ring;
    const pos = this.ringPos;
    // bit j of the frame data (0..63): forwards the oldest 64 of the last 80 bits, backwards those
    // 64 in reverse order (they belong to the frame played before this sync word)
    const at = (j: number) => ring[(pos + (reverse ? 63 - j : j)) % FRAME_BITS];
    const field = (from: number, count: number) => {
      let v = 0;
      for (let k = 0; k < count; k++) v |= at(from + k) << k;
      return v;
    };
    const fu = field(0, 4);
    const ft = field(8, 2);
    const su = field(16, 4);
    const st = field(24, 3);
    const mu = field(32, 4);
    const mt = field(40, 3);
    const hu = field(48, 4);
    const ht = field(56, 2);
    const frames = ft * 10 + fu;
    const seconds = st * 10 + su;
    const minutes = mt * 10 + mu;
    const hours = ht * 10 + hu;
    if (fu > 9 || su > 9 || mu > 9 || hu > 9 || seconds > 59 || minutes > 59 || hours > 23 || frames > 29) return;
    const measured = this.bitLen > 0 ? this.sampleRate / (FRAME_BITS * this.bitLen) : 25;
    let fps: LtcFps = measured < 24.5 ? 24 : measured < 27.5 ? 25 : 30;
    // a frame number the measured rate cannot have: trust the label
    if (frames >= fps) fps = frames >= 25 ? 30 : 25;
    this.sinceFrame = 0;
    this.decoded++;
    out.push({
      hours,
      minutes,
      seconds,
      frames,
      dropFrame: at(10) === 1,
      reverse,
      end: this.lastEdge,
      samplesPerFrame: FRAME_BITS * this.bitLen,
      fps,
    });
  }
}
