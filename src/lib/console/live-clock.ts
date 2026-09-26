// Virtual song clock for LIVE mode: the band plays, the operator cues lines. Cueing a
// timed line jumps the clock to that line's start; the clock then runs at 1× until the
// next timed line's start and holds there until the next cue. Pure (times are passed in).

export class LiveClock {
  private anchorT = 0;
  private anchorAt = 0;
  private hold: number | null = null;
  private running = false;
  private limit = Number.POSITIVE_INFINITY;

  /** Song time (seconds) at epoch ms `now`. */
  time(now: number): number {
    const base = this.running ? this.anchorT + Math.max(0, now - this.anchorAt) / 1000 : this.anchorT;
    const cap = Math.min(this.hold ?? Number.POSITIVE_INFINITY, this.limit);
    return Math.max(0, Math.min(base, Math.max(this.anchorT, cap)));
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** The time the clock will stop at (null = runs to the song end). */
  get holdAt(): number | null {
    return this.hold;
  }

  /** True while running but parked at the hold point. */
  isHeld(now: number): boolean {
    if (!this.running) return false;
    const cap = Math.min(this.hold ?? Number.POSITIVE_INFINITY, this.limit);
    return Number.isFinite(cap) && this.time(now) >= cap - 1e-6;
  }

  /** Song duration: the clock never runs past it. */
  setLimit(duration: number): void {
    this.limit = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  }

  /** Jump to `t` (keeps running / stopped as it was) and set the next hold point. */
  jump(t: number, hold: number | null, now: number): void {
    this.anchorT = Number.isFinite(t) ? Math.max(0, t) : 0;
    this.anchorAt = now;
    this.hold = hold != null && Number.isFinite(hold) && hold > this.anchorT ? hold : hold === null ? null : this.anchorT;
  }

  start(now: number): void {
    if (this.running) return;
    this.anchorAt = now;
    this.running = true;
  }

  stop(now: number): void {
    if (!this.running) return;
    this.anchorT = this.time(now);
    this.anchorAt = now;
    this.running = false;
  }
}
