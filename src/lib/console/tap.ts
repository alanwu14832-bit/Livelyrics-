// Tap tempo + beat clock for LIVE mode without a microphone: the operator taps T on the
// beat; the median tap interval gives the tempo and the last tap anchors the phase.
// Pure (times in seconds are passed in).

export class TapClock {
  private taps: number[] = [];
  private period: number | null = null;
  private anchor: number | null = null;

  constructor(
    private readonly resetAfter = 2,
    private readonly maxTaps = 8,
  ) {}

  /** Register a tap at `now` (s). Returns the current tempo (BPM) or null before two taps. */
  tap(now: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last != null && (now - last > this.resetAfter || now < last)) this.taps = [];
    // ignore switch bounce (> 300 BPM)
    if (last != null && now >= last && now - last < 0.2) return this.bpm;
    this.taps.push(now);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    const tapped = this.medianBpm();
    if (tapped != null) this.period = 60 / tapped;
    this.anchor = now;
    return this.bpm;
  }

  /** Seed a tempo (e.g. the analysed studio BPM) without taps; keeps an existing anchor. */
  setBpm(bpm: number, now: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    this.period = 60 / Math.min(300, Math.max(20, bpm));
    if (this.anchor == null) this.anchor = now;
  }

  get bpm(): number | null {
    return this.period ? Math.round((60 / this.period) * 10) / 10 : null;
  }

  /** taps in the current run */
  get count(): number {
    return this.taps.length;
  }

  /** 0..1 position inside the beat, or null without a tempo. */
  phase(now: number): number | null {
    if (!this.period || this.anchor == null) return null;
    const x = (now - this.anchor) / this.period;
    return x - Math.floor(x);
  }

  reset(): void {
    this.taps = [];
    this.period = null;
    this.anchor = null;
  }

  private medianBpm(): number | null {
    if (this.taps.length < 2) return null;
    const intervals: number[] = [];
    for (let i = 1; i < this.taps.length; i++) intervals.push(this.taps[i] - this.taps[i - 1]);
    intervals.sort((a, b) => a - b);
    const mid = intervals.length >> 1;
    const median = intervals.length % 2 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2;
    if (!(median > 0)) return null;
    const bpm = 60 / median;
    return bpm >= 30 && bpm <= 300 ? bpm : null;
  }
}
