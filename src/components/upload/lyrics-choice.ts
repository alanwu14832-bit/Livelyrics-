// Turning a picked LRCLIB result / pasted text into the ProcessRequest.lyricsText.

import type { LyricsSearchResult } from "@/lib/api-client";
import { toLrc } from "@/lib/lyrics/lrc";
import type { Lyrics } from "@/lib/types";

/** LRCLIB synced timings are trusted only when the recording length matches this closely. */
export const DURATION_TOLERANCE = 3;

export function durationDelta(result: Pick<LyricsSearchResult, "duration">, songDuration: number | undefined): number | null {
  if (!songDuration || !(songDuration > 0) || !(result.duration > 0)) return null;
  return result.duration - songDuration;
}

export function timingTrusted(result: Pick<LyricsSearchResult, "duration" | "synced">, songDuration: number | undefined): boolean {
  if (!result.synced) return false;
  const d = durationDelta(result, songDuration);
  return d == null || Math.abs(d) <= DURATION_TOLERANCE;
}

export function plainText(lyrics: Lyrics): string {
  return lyrics.lines.map((l) => l.text).join("\n") + (lyrics.lines.length ? "\n" : "");
}

/** Text to send as lyricsText: LRC when the timings are used, else plain lines. */
export function resultToLyricsText(result: Pick<LyricsSearchResult, "synced" | "lyrics">, useTiming: boolean): string {
  return result.synced && useTiming ? toLrc(result.lyrics) : plainText(result.lyrics);
}

/** Strip timings from Lyrics (keeps text + translations). */
export function withoutTimings(lyrics: Lyrics): Lyrics {
  return {
    ...lyrics,
    synced: false,
    lines: lyrics.lines.map((l) => {
      const line = { id: l.id, text: l.text, start: null, end: null } as Lyrics["lines"][number];
      if (l.translation) line.translation = l.translation;
      return line;
    }),
  };
}

export interface LrcHeaderTags {
  title?: string;
  artist?: string;
  album?: string;
}

const HEADER_KEYS: Record<string, keyof LrcHeaderTags> = { ti: "title", ar: "artist", al: "album" };

/** Song info from LRC header tags ([ti:…] [ar:…] [al:…]) at the top of pasted lyrics. */
export function lrcHeaderTags(text: string): LrcHeaderTags {
  const out: LrcHeaderTags = {};
  // headers live at the top; stop at the first timed line so lyric text is never read as a tag
  for (const raw of text.split(/\r?\n/).slice(0, 40)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^\[(ti|ar|al)\s*:\s*(.*?)\s*\]$/i.exec(line);
    if (m) {
      const key = HEADER_KEYS[m[1].toLowerCase()];
      if (m[2] && !out[key]) out[key] = m[2].slice(0, 200);
      continue;
    }
    if (/^\[\d/.test(line) || !line.startsWith("[")) break;
  }
  return out;
}
