// MIDI Time Code (phase 5a, 時間碼): the eight quarter-frame messages (F1 0nnn dddd) put back
// together into a timecode, and the SysEx full frame (F0 7F <device> 01 01 hh mm ss ff F7) a DAW
// sends when it locates while stopped. Pure.
//
// Quarter frames go out four per frame: piece k of a sequence encoding frame F leaves when the
// transport is at F + k/4 frames, so the whole timecode is known two frames after it started. Going
// forward the sequence completes with piece 7 at F + 1.75 frames; played backwards the pieces
// arrive 7 … 0 and (the mirror image) complete with piece 0 at F. The position reported here is
// the transport position when the completing piece arrived: the latency is already added.
//
// Rate bits (piece 7 bits 1-2, full frame hh bits 5-6): 0 = 24, 1 = 25, 2 = 29.97 drop-frame
// ("30 drop"), 3 = 30.

import { frameSeconds, nominalFps, tcToSeconds, type FrameRate, type Timecode } from "@/lib/sync/timecode";

export const MTC_RATES: readonly FrameRate[] = [24, 25, 29.97, 30];

/** Pieces further apart than this (ms) do not belong to one running sequence. */
export const MTC_MAX_PIECE_GAP_MS = 120;

export interface MtcFrame {
  /** "frame": eight quarter frames completed; "locate": a full-frame SysEx (transport stopped) */
  kind: "frame" | "locate";
  timecode: Timecode;
  rate: FrameRate;
  /** real seconds since 00:00:00:00 at `at` (latency compensated) */
  position: number;
  /** ms, the timestamp of the completing message */
  at: number;
  direction: 1 | -1;
}

function validTc(tc: Timecode, rate: FrameRate): boolean {
  return tc.hours <= 23 && tc.minutes <= 59 && tc.seconds <= 59 && tc.frames < nominalFps(rate);
}

/** A full-frame SysEx, or null for any other SysEx. */
export function parseMtcFullFrame(data: ArrayLike<number>): { timecode: Timecode; rate: FrameRate } | null {
  if (data.length !== 10) return null;
  if (data[0] !== 0xf0 || data[1] !== 0x7f || data[3] !== 0x01 || data[4] !== 0x01 || data[9] !== 0xf7) return null;
  const hh = data[5];
  const rate = MTC_RATES[(hh >> 5) & 3];
  const timecode = { hours: hh & 0x1f, minutes: data[6] & 0x7f, seconds: data[7] & 0x7f, frames: data[8] & 0x7f };
  return validTc(timecode, rate) ? { timecode, rate } : null;
}

export class MtcAssembler {
  private readonly nibbles = new Array<number>(8).fill(0);
  private lastPiece = -1;
  private lastAt = Number.NEGATIVE_INFINITY;
  private direction: 1 | -1 = 1;
  /** consecutive pieces of the current run (8 = a whole timecode is present) */
  private run = 0;

  /** The data byte of an F1 message. Returns a frame when a sequence completes. */
  quarterFrame(piece: number, value: number, at: number): MtcFrame | null {
    const p = piece & 7;
    const v = value & 0x0f;
    let dir: 1 | -1 | 0 = 0;
    if (this.lastPiece >= 0 && at - this.lastAt <= MTC_MAX_PIECE_GAP_MS) {
      if (p === (this.lastPiece + 1) % 8) dir = 1;
      else if (p === (this.lastPiece + 7) % 8) dir = -1;
    }
    if (dir === 0) {
      // a new run (first piece, a gap, or out of order)
      this.run = 1;
    } else if (this.run > 1 && dir !== this.direction) {
      // the transport turned round: this piece and the previous one start the new run
      this.direction = dir;
      this.run = 2;
    } else {
      this.direction = dir;
      this.run = Math.min(this.run + 1, 16);
    }
    this.nibbles[p] = v;
    this.lastPiece = p;
    this.lastAt = at;
    const completing = this.direction === 1 ? 7 : 0;
    if (this.run < 8 || p !== completing) return null;
    const n = this.nibbles;
    const rate = MTC_RATES[(n[7] >> 1) & 3];
    const timecode: Timecode = {
      frames: n[0] | ((n[1] & 1) << 4),
      seconds: n[2] | ((n[3] & 3) << 4),
      minutes: n[4] | ((n[5] & 3) << 4),
      hours: n[6] | ((n[7] & 1) << 4),
    };
    if (!validTc(timecode, rate)) return null;
    const lead = (this.direction === 1 ? 1.75 : 0) * frameSeconds(rate);
    return { kind: "frame", timecode, rate, position: tcToSeconds(timecode, rate) + lead, at, direction: this.direction };
  }

  /** A SysEx message: a full frame locates (and starts the quarter-frame assembly over). */
  fullFrame(data: ArrayLike<number>, at: number): MtcFrame | null {
    const ff = parseMtcFullFrame(data);
    if (!ff) return null;
    this.reset();
    return { kind: "locate", timecode: ff.timecode, rate: ff.rate, position: tcToSeconds(ff.timecode, ff.rate), at, direction: 1 };
  }

  reset(): void {
    this.lastPiece = -1;
    this.lastAt = Number.NEGATIVE_INFINITY;
    this.run = 0;
    this.direction = 1;
  }
}

/** The eight quarter-frame data bytes of one timecode (tests and the e2e fake device). */
export function quarterFrames(tc: Timecode, rate: FrameRate): number[] {
  const r = MTC_RATES.indexOf(rate);
  const nib = [tc.frames & 0x0f, (tc.frames >> 4) & 1, tc.seconds & 0x0f, (tc.seconds >> 4) & 3, tc.minutes & 0x0f, (tc.minutes >> 4) & 3, tc.hours & 0x0f, ((tc.hours >> 4) & 1) | (r << 1)];
  return nib.map((v, k) => (k << 4) | v);
}

/** The SysEx full frame of a timecode. */
export function fullFrameBytes(tc: Timecode, rate: FrameRate, device = 0x7f): number[] {
  const r = MTC_RATES.indexOf(rate);
  return [0xf0, 0x7f, device & 0x7f, 0x01, 0x01, (r << 5) | (tc.hours & 0x1f), tc.minutes, tc.seconds, tc.frames, 0xf7];
}
