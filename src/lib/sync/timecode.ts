// SMPTE timecode maths (phase 5a, 同步): labels HH:MM:SS:FF at 24 / 25 / 29.97 drop-frame / 30
// fps, the frame count and the real time of a label, what the operator types as a start timecode
// (a full label or just an hour), and the zod schema of a stored start timecode. Pure.
//
// Drop-frame (29.97 DF) skips the labels ;00 and ;01 at the start of every minute except each
// tenth, so the labels stay within 3.6 ms per hour of real time. 29.97 non-drop is reported as 30
// (neither MTC nor LTC tells the two apart); its labels then run 0.1 % slow against real time.

import { z } from "zod";

export type FrameRate = 24 | 25 | 29.97 | 30;
export const FRAME_RATES: readonly FrameRate[] = [24, 25, 29.97, 30];

export interface Timecode {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
}

/** The one-song-per-hour convention: the first song starts at 01:00:00:00. */
export const DEFAULT_START_TC = "01:00:00:00";
/** A setlist position beyond this hour has no default timecode (labels stop at 23:59:59:29). */
export const MAX_TC_HOUR = 23;

/** Frames per labelled second: 24, 25 or 30 (29.97 counts 30 labels a second). */
export function nominalFps(rate: FrameRate): 24 | 25 | 30 {
  return rate === 29.97 ? 30 : rate;
}

/** Frames per real second. */
export function realFps(rate: FrameRate): number {
  return rate === 29.97 ? 30000 / 1001 : rate;
}

export function isDropFrame(rate: FrameRate): boolean {
  return rate === 29.97;
}

/** Seconds per frame. */
export function frameSeconds(rate: FrameRate): number {
  return 1 / realFps(rate);
}

/** "25 fps" / "29.97 DF" */
export function rateLabel(rate: FrameRate): string {
  return rate === 29.97 ? "29.97 DF" : `${rate} fps`;
}

/** Frames since 00:00:00:00 for a label (drop-frame aware; frames past the rate are clamped). */
export function tcToFrames(tc: Timecode, rate: FrameRate): number {
  const fps = nominalFps(rate);
  const f = Math.min(Math.max(0, tc.frames), fps - 1);
  let n = ((tc.hours * 60 + tc.minutes) * 60 + tc.seconds) * fps + f;
  if (isDropFrame(rate)) {
    const minutes = tc.hours * 60 + tc.minutes;
    n -= 2 * (minutes - Math.floor(minutes / 10));
  }
  return n;
}

/** The label of a frame count (wraps at 24 hours). */
export function framesToTc(frames: number, rate: FrameRate): Timecode {
  const fps = nominalFps(rate);
  const perDay = isDropFrame(rate) ? 24 * 6 * 17982 : 24 * 3600 * fps;
  let n = ((Math.floor(frames) % perDay) + perDay) % perDay;
  if (isDropFrame(rate)) {
    // 17982 frames per ten minutes, 1798 per dropped minute
    const tens = Math.floor(n / 17982);
    const rest = n % 17982;
    n += 18 * tens + (rest > 1 ? 2 * Math.floor((rest - 2) / 1798) : 0);
  }
  const frameNo = n % fps;
  const total = Math.floor(n / fps);
  return { hours: Math.floor(total / 3600) % 24, minutes: Math.floor(total / 60) % 60, seconds: total % 60, frames: frameNo };
}

/** Real seconds since 00:00:00:00 of a label. */
export function tcToSeconds(tc: Timecode, rate: FrameRate): number {
  return tcToFrames(tc, rate) / realFps(rate);
}

/** The label shown at real time `seconds` (since 00:00:00:00). */
export function secondsToTc(seconds: number, rate: FrameRate): Timecode {
  return framesToTc(Math.floor(seconds * realFps(rate) + 1e-6), rate);
}

const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, "0");

/** 01:00:10:12, with ";" before the frames of a drop-frame label. */
export function formatTc(tc: Timecode, rate?: FrameRate | null): string {
  return `${pad2(tc.hours)}:${pad2(tc.minutes)}:${pad2(tc.seconds)}${rate === 29.97 ? ";" : ":"}${pad2(tc.frames)}`;
}

/** A stored start timecode: HH:MM:SS:FF (frames 00..29; ";" before the frames is accepted). */
export const TIMECODE_RE = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d[:;]([01]\d|2\d)$/;

/** zod: a start timecode as stored on a project or a setlist song. */
export const TimecodeStringSchema = z.string().max(16).regex(TIMECODE_RE, "時間碼格式應為 HH:MM:SS:FF（例如 01:00:00:00）");

/**
 * What the operator typed: a full label (01:00:10:00, 1:00:10;00, 01.00.10.00, full-width ：), a
 * shorter one (HH:MM, HH:MM:SS) or just an hour (3 → 03:00:00:00). Null when it is not a
 * timecode.
 */
export function parseTc(text: string): Timecode | null {
  const s = String(text ?? "")
    .trim()
    .replace(/[：．。，]/g, ":")
    .replace(/[;.,]/g, ":")
    .replace(/\s+/g, "");
  if (!s || s.length > 16 || !/^\d{1,2}(?::\d{1,2}){0,3}$/.test(s)) return null;
  const parts = s.split(":").map((p) => Number(p));
  const [hours, minutes = 0, seconds = 0, frames = 0] = parts;
  if (hours > MAX_TC_HOUR || minutes > 59 || seconds > 59 || frames > 29) return null;
  return { hours, minutes, seconds, frames };
}

/** The canonical stored form of what the operator typed ("3" → "03:00:00:00"), or null. */
export function normalizeTcInput(text: string): string | null {
  const tc = parseTc(text);
  return tc ? formatTc(tc) : null;
}

/** A stored start timecode (tolerant: anything invalid is null). */
export function coerceTcString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!TIMECODE_RE.test(t)) return null;
  return t.replace(";", ":");
}

/** 03:00:00:00 for song 3 (one song per hour), or null past the last hour. */
export function hourTc(hour: number): string | null {
  return Number.isInteger(hour) && hour >= 0 && hour <= MAX_TC_HOUR ? `${pad2(hour)}:00:00:00` : null;
}
