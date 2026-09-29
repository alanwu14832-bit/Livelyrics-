// Timecode chase (phase 5a, 時間碼模式): positions decoded from MTC or LTC → a steady transport the
// console can follow, and the one-song-per-hour mapping from timecode to a song's time and to the
// setlist item on air. Pure: every call takes its time (ms, one clock for frames and queries).
//
// Rules (the playback rig is the reference, the operator is the safety net):
// - Lock only after `confirmFrames` (3) frames that agree with each other.
// - While locked, a frame within the tolerance (2 frames, at least 80 ms) pulls the position
//   gently (a phase-locked loop, so arrival jitter never shakes the lyrics); anything further off is
//   a candidate. Only `confirmFrames` candidates in a row that agree with each other relocate —
//   a single glitch (a bit error, a stray MIDI message, a jump of any size) never moves the song.
// - No frame for `gapMs` (250 ms): 自由運轉 (freewheel) on the internal clock; after `freewheelMs`
//   (2 s by default) since the last frame: 中斷 (lost). The position then stays where the freewheel
//   ended; the console falls back to manual. Valid frames lock again (three in a row).
// - An MTC full frame (the DAW located while stopped) sets the position at once: 已定位 (stopped).
// - Frames may run backwards (MTC): the position follows them, `direction` says so.

import type { SetItem } from "@/lib/types";
import { DEFAULT_START_TC, MAX_TC_HOUR, frameSeconds, hourTc, parseTc, tcToSeconds, type FrameRate, type Timecode } from "./timecode";

export type ChaseStatus = "waiting" | "locked" | "stopped" | "freewheel" | "lost";

export interface ChaseFrame {
  /** real seconds since 00:00:00:00 at `at` (latency compensated by the decoder) */
  position: number;
  /** ms */
  at: number;
  rate: FrameRate;
  direction?: 1 | -1;
}

export interface ChaseOptions {
  /** keep running this long after the last frame before giving up (ms) */
  freewheelMs?: number;
  /** a frame is late after this long (ms): freewheel starts */
  gapMs?: number;
  /** agreeing frames needed to lock or to relocate */
  confirmFrames?: number;
}

export const DEFAULT_FREEWHEEL_MS = 2000;
export const DEFAULT_GAP_MS = 250;
export const DEFAULT_CONFIRM_FRAMES = 3;
/** how much of a small error one frame corrects (the loop gain) */
const PULL = 0.3;

export interface ChaseState {
  status: ChaseStatus;
  /** real seconds since 00:00:00:00 now (frozen once lost); null before any lock */
  position: number | null;
  rate: FrameRate | null;
  /** the transport moves (locked or freewheeling, forwards or backwards) */
  running: boolean;
  direction: 1 | -1;
}

interface Track {
  position: number;
  at: number;
  direction: 1 | -1;
  rate: FrameRate;
}

function tolerance(rate: FrameRate): number {
  return Math.max(0.08, 2 * frameSeconds(rate));
}

export class TimecodeChase {
  private freewheelMs: number;
  private readonly gapMs: number;
  private readonly confirm: number;
  /** the locked transport (null: never locked since the last reset) */
  private track: Track | null = null;
  private stopped = false;
  private lastFrameAt = Number.NEGATIVE_INFINITY;
  /** frames that disagree with the track (or, unlocked, the frames towards a lock) */
  private candidates: ChaseFrame[] = [];
  private lostOnce = false;

  constructor(opts: ChaseOptions = {}) {
    this.freewheelMs = opts.freewheelMs ?? DEFAULT_FREEWHEEL_MS;
    this.gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
    this.confirm = Math.max(1, opts.confirmFrames ?? DEFAULT_CONFIRM_FRAMES);
  }

  setFreewheel(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.freewheelMs = ms;
  }

  get freewheel(): number {
    return this.freewheelMs;
  }

  reset(): void {
    this.track = null;
    this.stopped = false;
    this.lastFrameAt = Number.NEGATIVE_INFINITY;
    this.candidates = [];
    this.lostOnce = false;
  }

  /** True after the chase lost a lock (until it locks again or resets). */
  get wasLost(): boolean {
    return this.lostOnce;
  }

  private predicted(track: Track, at: number): number {
    return this.stopped ? track.position : track.position + (track.direction * (at - track.at)) / 1000;
  }

  /** A decoded frame. */
  push(frame: ChaseFrame): void {
    if (!Number.isFinite(frame.position) || !Number.isFinite(frame.at)) return;
    const direction = frame.direction ?? 1;
    const f: ChaseFrame = { ...frame, direction };
    const status = this.status(frame.at);
    const track = this.track;
    if (track && (status === "locked" || status === "freewheel" || status === "stopped") && track.rate === f.rate) {
      const expect = this.predicted(track, f.at);
      const err = f.position - expect;
      // stopped (located): the transport starts from about there, in either direction
      if (Math.abs(err) <= tolerance(f.rate) && (direction === track.direction || this.stopped)) {
        this.track = this.stopped ? { position: f.position, at: f.at, direction, rate: f.rate } : { position: expect + err * PULL, at: f.at, direction, rate: f.rate };
        this.stopped = false;
        this.lastFrameAt = f.at;
        this.candidates = [];
        return;
      }
    }
    // not on the track: collect agreeing frames until there are enough to (re)lock
    const last = this.candidates[this.candidates.length - 1];
    if (last) {
      const expect = last.position + ((last.direction ?? 1) * (f.at - last.at)) / 1000;
      const agrees = last.rate === f.rate && (last.direction ?? 1) === direction && Math.abs(f.position - expect) <= tolerance(f.rate) && f.at >= last.at;
      if (!agrees) this.candidates = [];
    }
    this.candidates.push(f);
    if (this.candidates.length > this.confirm) this.candidates.shift();
    // (a rejected frame never keeps the lock alive: a line full of garbage freewheels, then fails)
    if (this.candidates.length >= this.confirm) {
      this.track = { position: f.position, at: f.at, direction, rate: f.rate };
      this.stopped = false;
      this.lastFrameAt = f.at;
      this.candidates = [];
      this.lostOnce = false;
    }
  }

  /** An explicit locate (MTC full frame): trusted at once, the transport is stopped there. */
  locate(position: number, at: number, rate: FrameRate): void {
    if (!Number.isFinite(position) || !Number.isFinite(at)) return;
    this.track = { position, at, direction: 1, rate };
    this.stopped = true;
    this.lastFrameAt = at;
    this.candidates = [];
    this.lostOnce = false;
  }

  status(now: number): ChaseStatus {
    if (!this.track) return "waiting";
    if (this.stopped) return "stopped";
    const since = now - this.lastFrameAt;
    if (since <= this.gapMs) return "locked";
    if (since <= this.freewheelMs) return "freewheel";
    this.lostOnce = true;
    return "lost";
  }

  state(now: number): ChaseState {
    const status = this.status(now);
    const track = this.track;
    if (!track) return { status, position: null, rate: null, running: false, direction: 1 };
    // lost: the position stays where the freewheel ended
    const at = status === "lost" ? Math.min(now, this.lastFrameAt + this.freewheelMs) : now;
    return { status, position: this.predicted(track, at), rate: track.rate, running: status === "locked" || status === "freewheel", direction: track.direction };
  }
}

// ---------------------------------------------------------------------------
// timecode → song time, timecode → setlist item
// ---------------------------------------------------------------------------

/** Seconds since 00:00:00:00 of a stored start timecode at `rate` (default 01:00:00:00). */
export function startSeconds(start: string | null | undefined, rate: FrameRate): number {
  const tc: Timecode = parseTc(start ?? "") ?? parseTc(DEFAULT_START_TC)!;
  return tcToSeconds(tc, rate);
}

/** Song time for a chase position: timecode minus the song's start timecode. */
export function songTimeAt(position: number, start: string | null | undefined, rate: FrameRate): number {
  return position - startSeconds(start, rate);
}

export interface TimecodeSlot {
  itemId: string;
  projectId: string;
  /** stored form HH:MM:SS:FF */
  start: string;
  /** false: the default (the song's position in the setlist = its hour) */
  explicit: boolean;
  /** 1-based among the songs */
  songNumber: number;
}

/**
 * The start timecode of every song of a setlist: its own `timecode`, else its position among the
 * songs (song 1 at 01:00:00:00, song 2 at 02:00:00:00, …; none past 23:00:00:00).
 */
export function setlistSlots(items: readonly SetItem[]): TimecodeSlot[] {
  const out: TimecodeSlot[] = [];
  let n = 0;
  for (const item of items) {
    if (item.kind !== "song") continue;
    n++;
    const own = item.timecode && parseTc(item.timecode) ? item.timecode : null;
    const start = own ?? (n <= MAX_TC_HOUR ? hourTc(n) : null);
    if (start) out.push({ itemId: item.id, projectId: item.projectId, start, explicit: !!own, songNumber: n });
  }
  return out;
}

/** The start timecode a setlist song chases (explicit or its position), or null. */
export function slotStart(items: readonly SetItem[], itemId: string): string | null {
  return setlistSlots(items).find((s) => s.itemId === itemId)?.start ?? null;
}

/**
 * The song whose range holds a chase position: the latest start at or before it, until the next
 * song's start or one hour later, whichever comes first. Null between songs.
 */
export function slotAt(position: number, slots: readonly TimecodeSlot[], rate: FrameRate): TimecodeSlot | null {
  const sorted = slots.map((s) => ({ s, at: startSeconds(s.start, rate) })).sort((a, b) => a.at - b.at);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const { s, at } = sorted[i];
    if (position < at) continue;
    const next = sorted.slice(i + 1).find((x) => x.at > at)?.at ?? Number.POSITIVE_INFINITY;
    return position < Math.min(next, at + 3600) ? s : null;
  }
  return null;
}
