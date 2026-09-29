// MIDI beat clock (phase 5a, 節拍模式): 24 clocks (F8) per quarter note → a smoothed tempo and the
// beat phase, with the transport (FA start, FB continue, FC stop) and the song position pointer.
// Pure: every call takes its timestamp (ms).
//
// Tempo: a least-squares line through the timestamps of the last ticks (up to four beats), so USB
// and scheduler jitter of a few ms averages out; a tick far off the running period (a lost or
// doubled message) restarts the window, and three ticks in a row consistently off the estimate
// (a real tempo change) do too. The displayed BPM only moves by more than 0.2 BPM.
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
  private times: number[] = [];
  private lastTickAt = Number.NEGATIVE_INFINITY;
  /** ms per tick from the regression */
  private period: number | null = null;
  private display: number | null = null;
  private offTrend = 0;
  /** clock position (ticks) of the last tick */
  private position = 0;
  /** what the next tick's position is after a Start / Continue (null: count on) */
  private nextPosition: number | null = null;
  private transport: "unknown" | "running" | "stopped" = "unknown";
  private aligned = false;
  private sppPosition = 0;

  tick(at: number): void {
    const interval = at - this.lastTickAt;
    if (!(interval <= CLOCK_LOCK_TIMEOUT_MS)) {
      // the first tick, or the clock came back after a pause
      this.times = [];
      this.offTrend = 0;
    } else if (this.period) {
      const ratio = interval / this.period;
      if (ratio < 0.5 || ratio > 2) {
        // a lost or doubled message: start the window again from here
        this.times = [];
        this.offTrend = 0;
      } else {
        // jittered intervals alternate long / short; a tempo change keeps one sign
        const sign = ratio > 1.1 ? 1 : ratio < 0.9 ? -1 : 0;
        this.offTrend = sign === 0 ? 0 : Math.sign(this.offTrend) === sign ? this.offTrend + sign : sign;
        if (Math.abs(this.offTrend) >= 3 && this.times.length >= 3) {
          // a real tempo change: keep only the recent ticks, and compare the next ones with the
          // new tempo (their mean interval) until the window has enough ticks for a fit again
          this.times = [...this.times.slice(-3), at];
          this.period = (at - this.times[0]) / 3;
          this.offTrend = 0;
          this.lastTickAt = at;
          this.advance();
          return;
        }
      }
    }
    this.times.push(at);
    if (this.times.length > CLOCK_WINDOW) this.times.shift();
    this.lastTickAt = at;
    this.fit();
    this.advance();
  }

  /** The song position moves one clock (or to where a Start / Continue put it). */
  private advance(): void {
    if (this.nextPosition != null) {
      this.position = this.nextPosition;
      this.nextPosition = null;
    } else if (this.transport !== "stopped") this.position++;
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
    this.times = [];
    this.lastTickAt = Number.NEGATIVE_INFINITY;
    this.period = null;
    this.display = null;
    this.offTrend = 0;
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
    const locked = this.period != null && this.times.length >= 2 && now - this.lastTickAt <= CLOCK_LOCK_TIMEOUT_MS;
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
    const n = this.times.length;
    if (n < 2) return;
    if (n < CLOCK_MIN_TICKS && this.period != null) {
      // a restarted window keeps the previous estimate until it has enough ticks
      return;
    }
    // least squares t = a + b * i
    const t0 = this.times[0];
    let si = 0;
    let st = 0;
    for (let i = 0; i < n; i++) {
      si += i;
      st += this.times[i] - t0;
    }
    const mi = si / n;
    const mt = st / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const di = i - mi;
      num += di * (this.times[i] - t0 - mt);
      den += di * di;
    }
    const b = den > 0 ? num / den : 0;
    if (!(b > 0)) return;
    // 20..400 BPM
    if (b < 60000 / (CLOCKS_PER_BEAT * 400) || b > 60000 / (CLOCKS_PER_BEAT * 20)) return;
    this.period = b;
    if (n < CLOCK_MIN_TICKS) return;
    const bpm = 60000 / (CLOCKS_PER_BEAT * b);
    if (this.display == null || Math.abs(bpm - this.display) > 0.2) this.display = Math.round(bpm * 10) / 10;
  }
}
