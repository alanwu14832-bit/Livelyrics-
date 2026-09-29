// Frame timing for the offline video export. Frame rates are exact rationals (29.97 is
// 30000 / 1001), frame i of a range sits at start + i · den / num seconds, and timecodes follow
// SMPTE (29.97 uses drop-frame numbering, HH:MM:SS;FF). Pure: shared by the export page, the
// cue sheet and the unit tests.

export type FrameRateId = "25" | "29.97" | "30" | "60";

export interface FrameRate {
  id: FrameRateId;
  /** frames per `den` seconds */
  num: number;
  den: number;
  /** nominal integer rate used by timecode frame fields (30 for 29.97) */
  nominal: number;
  /** SMPTE drop-frame numbering (29.97 only) */
  dropFrame: boolean;
  label: string;
}

export const FRAME_RATES: Record<FrameRateId, FrameRate> = {
  "25": { id: "25", num: 25, den: 1, nominal: 25, dropFrame: false, label: "25" },
  "29.97": { id: "29.97", num: 30000, den: 1001, nominal: 30, dropFrame: true, label: "29.97" },
  "30": { id: "30", num: 30, den: 1, nominal: 30, dropFrame: false, label: "30" },
  "60": { id: "60", num: 60, den: 1, nominal: 60, dropFrame: false, label: "60" },
};

export const FRAME_RATE_IDS: readonly FrameRateId[] = ["25", "29.97", "30", "60"];

export function isFrameRateId(x: unknown): x is FrameRateId {
  return typeof x === "string" && (FRAME_RATE_IDS as readonly string[]).includes(x);
}

/** Frames per second as a float (29.97002997...). */
export function fpsOf(rate: FrameRate): number {
  return rate.num / rate.den;
}

/** Tolerance for float noise when converting seconds to frames (well under a microsecond). */
const EPS = 1e-6;

/**
 * Frames needed to cover `duration` seconds: the last frame starts before the end. At least one
 * frame for any positive duration.
 */
export function frameCount(duration: number, rate: FrameRate): number {
  if (!(duration > 0) || !Number.isFinite(duration)) return 0;
  return Math.max(1, Math.ceil((duration * rate.num) / rate.den - EPS));
}

/** Seconds from the range start to frame i (exact rational, evaluated once). */
export function frameOffset(i: number, rate: FrameRate): number {
  return (i * rate.den) / rate.num;
}

/** Song time of frame i for a range starting at `start`. */
export function frameTime(start: number, i: number, rate: FrameRate): number {
  return start + frameOffset(i, rate);
}

/** Integer microsecond timestamp of frame i (WebCodecs time base), rounded to nearest. */
export function frameTimestampUs(i: number, rate: FrameRate): number {
  return Math.round((i * rate.den * 1_000_000) / rate.num);
}

/** Duration of frame i in microseconds; consecutive durations sum exactly to the next timestamp. */
export function frameDurationUs(i: number, rate: FrameRate): number {
  return frameTimestampUs(i + 1, rate) - frameTimestampUs(i, rate);
}

/** Index of the frame showing `offset` seconds after the range start. */
export function frameAt(offset: number, rate: FrameRate): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.floor((offset * rate.num) / rate.den + EPS);
}

/** First frame whose start is at or after `offset` (a cue lands on the frame that shows it). */
export function frameAtOrAfter(offset: number, rate: FrameRate): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.ceil((offset * rate.num) / rate.den - EPS));
}

const pad = (n: number, w = 2) => String(Math.max(0, Math.floor(n))).padStart(w, "0");

/**
 * SMPTE timecode for a frame number. 29.97 uses drop-frame numbering: frame numbers 00 and 01 are
 * skipped at the start of every minute except every tenth, so the timecode tracks wall time
 * (00:10:00;00 is exactly 10 minutes of 29.97 video).
 */
export function timecode(frame: number, rate: FrameRate): string {
  let f = Math.max(0, Math.floor(frame));
  const n = rate.nominal;
  if (rate.dropFrame) {
    const drop = Math.round(n / 15); // 2 for 30
    const perMinute = n * 60 - drop; // 1798
    const perTen = perMinute * 10 + drop; // 17982
    const tens = Math.floor(f / perTen);
    const rem = f % perTen;
    f += drop * 9 * tens + (rem > drop ? drop * Math.floor((rem - drop) / perMinute) : 0);
  }
  const ff = f % n;
  const totalSeconds = Math.floor(f / n);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${rate.dropFrame ? ";" : ":"}${pad(ff)}`;
}

/** Seconds with millisecond precision, e.g. 12.345 (for cue sheets). */
export function seconds3(x: number): string {
  if (!Number.isFinite(x)) return "0.000";
  return (Math.round(x * 1000) / 1000).toFixed(3);
}

/** Human duration for the UI: 「3 分 05 秒」 / 「42 秒」. */
export function durationLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m} 分 ${String(r).padStart(2, "0")} 秒` : `${r} 秒`;
}

/** "83.5", "1:23.5" or "1:23" to seconds; null when it is not a time. */
export function parseTimeInput(value: string): number | null {
  const v = value.trim().replace("：", ":");
  if (!v) return null;
  const m = v.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const min = m[1] ? parseInt(m[1], 10) : 0;
  const sec = parseFloat(m[2]);
  if (m[1] && sec >= 60) return null;
  const t = min * 60 + sec;
  return Number.isFinite(t) ? t : null;
}
