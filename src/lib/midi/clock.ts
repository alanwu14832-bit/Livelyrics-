// MIDI beat clock (phase 5a, 節拍模式): 24 clocks (F8) per quarter note → a smoothed tempo and the
// beat phase, with the transport (FA start, FB continue, FC stop) and the song position pointer.
// Pure: every call takes its timestamp (ms).
//
// Tempo: a least-squares line through (tick number, timestamp) of the last ticks (up to four
// beats), so USB and scheduler jitter of a few ms averages out. Every tick counts as the next one
// and is judged against that line, not against the previous tick: late and bunched ticks (a busy
// sender, a driver that delivers two at once, coarse timestamps) are only jitter, never a restart.
// Three ticks in a row sitting one period off the line mean a tick was lost or doubled (it is
// counted back in or out); three drifting further and further the same way are a real tempo
// change (the line restarts from them). The displayed BPM only moves by more than 0.2 BPM.
// Phase: the first clock after Start is beat 1; Song Position (sixteenths, 6 clocks each) then
// Continue resumes elsewhere. Clocks without any transport message (the console joined a running
// show) still give the tempo and a steady pulse, but the downbeat is unknown (`aligned` false).
// Lock: a tick within the last 500 ms and a tempo estimate.

export const CLOCKS_PER_BEAT = 24;
export const CLOCK_LOCK_TIMEOUT_MS = 500;
/** ticks in the regression window (4 beats) */
export const CLOCK_WINDOW = 96;
/** ticks before a tempo is reported */
export const CLOCK_MIN_TICKS = 12;
/**
 * Three ticks growing this far off the line (in periods) are a tempo change. Coarse timestamps
 * (quantized to 15.6 ms: the old Windows timer) stay within ±0.63 periods even at 200 BPM.
 */
const DRIFT = 0.75;

export interface ClockStatus {
  locked: boolean;
  /** the transport runs (or no transport message was seen) */
  running: boolean;
  /** smoothed tempo, 0.1 BPM steps (null before a lock) */
  bpm: number | null;
  /** 0..1 position in the beat (0 = on the beat); null when not locked or stopped */
  phase: number | null;
  /** the phase follows a Start / Song Position (false: the downbeat is a guess) */
  aligned: boolean;
}

export class MidiClock {
  /** the regression window: tick number (counted since the window started) and timestamp */
  private win: Array<{ i: number; t: number }> = [];
  /** tick number of the last counted tick */
  private count = 0;
  private lastTickAt = Number.NEGATIVE_INFINITY;
  /** ms per tick (the line's slope) */
  private period: number | null = null;
  /** the line's intercept: tick i is expected at intercept + i * period */
  private intercept = 0;
  /** how far the last ticks were off the line (in periods, after counting lost ones) */
  private residuals: number[] = [];
  private display: number | null = null;
  /** clock position (ticks) of the last tick */
  private position = 0;
  /** what the next tick's position is after a Start / Continue (null: count on) */
  private nextPosition: number | null = null;
  private transport: "unknown" | "running" | "stopped" = "unknown";
  private aligned = false;
  private sppPosition = 0;

  tick(at: number): void {
    const gap = at - this.lastTickAt;
    if (!(gap <= CLOCK_LOCK_TIMEOUT_MS)) {
      // the first tick, or the clock came back after a pause (the old tempo helps it lock again)
      this.restart(at);
      return;
    }
    const p = this.period;
    // every tick counts as the next one; where it sits against the line decides what it was
    const residual = p != null && this.win.length >= 4 ? (at - (this.intercept + (this.count + 1) * p)) / p : null;
    this.count1(at, residual);
    const r = this.residuals;
    if (r.length < 3) return;
    const [x, y, z] = r.slice(-3);
    const spread = Math.max(x, y, z) - Math.min(x, y, z);
    const step = Math.round(z);
    if ((step === 1 || step === -1) && spread < 0.15 && [x, y, z].every((v) => Math.abs(v - step) <= 0.3)) {
      // three ticks in a row one period off, and staying there: a tick was lost (late) or doubled
      // (early) three ticks ago; count it back in (or out)
      for (const e of this.win.slice(-3)) e.i += step;
      this.count += step;
      if (this.transport !== "stopped") this.position += step;
      this.residuals = [];
      this.fit();
      return;
    }
    if (Math.sign(x) === Math.sign(y) && Math.sign(y) === Math.sign(z) && Math.abs(z) >= DRIFT && Math.abs(y) > Math.abs(x) && Math.abs(z) > Math.abs(y)) {
      // drifting further and further the same way: a real tempo change. The line restarts from
      // the recent ticks at their own tempo (coarse timestamps never drift this far).
      const recent = this.win.slice(-4);
      const first = recent[0];
      const last = recent[recent.length - 1];
      if (last.i > first.i) {
        this.period = (last.t - first.t) / (last.i - first.i);
        this.intercept = last.t - last.i * this.period;
        this.win = recent;
      }
      this.residuals = [];
    }
  }

  /** Start the line again at this tick. */
  private restart(at: number): void {
    this.win = [{ i: 0, t: at }];
    this.count = 0;
    this.residuals = [];
    if (this.period != null) this.intercept = at;
    this.lastTickAt = at;
    this.advance(1);
  }

  /** Count the next tick at `at` (`residual`: how far off the line it was, in periods). */
  private count1(at: number, residual: number | null): void {
    this.count += 1;
    this.win.push({ i: this.count, t: at });
    if (this.win.length > CLOCK_WINDOW) this.win.shift();
    if (residual != null) {
      this.residuals.push(residual);
      if (this.residuals.length > 3) this.residuals.shift();
    }
    this.lastTickAt = at;
    this.fit();
    this.advance(1);
  }

  /** The song position moves `steps` clocks (the first one to where a Start / Continue put it). */
  private advance(steps: number): void {
    for (let k = 0; k < steps; k++) {
      if (this.nextPosition != null) {
        this.position = this.nextPosition;
        this.nextPosition = null;
      } else if (this.transport !== "stopped") this.position++;
    }
  }

  start(): void {
    this.transport = "running";
    this.aligned = true;
    this.nextPosition = 0;
    this.sppPosition = 0;
  }

  continue(): void {
    this.transport = "running";
    this.nextPosition = this.sppPosition;
  }

  stop(): void {
    this.transport = "stopped";
    this.nextPosition = null;
    // a later Continue resumes after the last clock
    this.sppPosition = this.position + 1;
  }

  /** F2: sixteenth notes since the song start (6 clocks each). */
  songPosition(beats: number): void {
    this.sppPosition = Math.max(0, beats) * 6;
    this.aligned = true;
    if (this.transport !== "running") this.position = this.sppPosition;
  }

  reset(): void {
    this.win = [];
    this.count = 0;
    this.lastTickAt = Number.NEGATIVE_INFINITY;
    this.period = null;
    this.intercept = 0;
    this.residuals = [];
    this.display = null;
    this.position = 0;
    this.nextPosition = null;
    this.transport = "unknown";
    this.aligned = false;
    this.sppPosition = 0;
  }

  /** Raw tempo of the regression (BPM), null without enough ticks. */
  get tempo(): number | null {
    return this.period ? 60000 / (CLOCKS_PER_BEAT * this.period) : null;
  }

  status(now: number): ClockStatus {
    const locked = this.period != null && this.win.length >= 2 && now - this.lastTickAt <= CLOCK_LOCK_TIMEOUT_MS;
    const running = this.transport !== "stopped";
    let phase: number | null = null;
    if (locked && running && this.period) {
      const frac = Math.min(1, Math.max(0, (now - this.lastTickAt) / this.period));
      const pos = this.position + frac;
      phase = (((pos % CLOCKS_PER_BEAT) + CLOCKS_PER_BEAT) % CLOCKS_PER_BEAT) / CLOCKS_PER_BEAT;
    }
    return { locked, running, bpm: locked ? this.display : null, phase, aligned: this.aligned };
  }

  private fit(): void {
    const n = this.win.length;
    if (n < 2) return;
    let si = 0;
    let st = 0;
    const t0 = this.win[0].t;
    for (const { i, t } of this.win) {
      si += i;
      st += t - t0;
    }
    const mi = si / n;
    const mt = st / n + t0;
    if (n < 4 && this.period != null) {
      // a restarted window keeps the previous tempo for its first ticks (only the line moves)
      this.intercept = mt - mi * this.period;
      return;
    }
    // least squares t = intercept + period * i
    let num = 0;
    let den = 0;
    for (const { i, t } of this.win) {
      const di = i - mi;
      num += di * (t - mt);
      den += di * di;
    }
    const b = den > 0 ? num / den : 0;
    // 20..400 BPM
    if (!(b > 0) || b < 60000 / (CLOCKS_PER_BEAT * 400) || b > 60000 / (CLOCKS_PER_BEAT * 20)) return;
    this.period = b;
    this.intercept = mt - mi * b;
    if (n < CLOCK_MIN_TICKS) return;
    const bpm = 60000 / (CLOCKS_PER_BEAT * b);
    if (this.display == null || Math.abs(bpm - this.display) > 0.2) this.display = Math.round(bpm * 10) / 10;
  }
}
