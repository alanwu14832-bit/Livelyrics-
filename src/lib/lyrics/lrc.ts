// STUB — owned by the SERVER module (shared with the browser). Replace the implementation, keep the exports.
import type { AudioAnalysis, Lyrics } from "../types";

/** Parse LRC ([mm:ss.xx] tags, multiple tags per line, optional <mm:ss.xx> word tags). */
export function parseLrc(text: string): Lyrics {
  void text;
  throw new Error("parseLrc: not implemented");
}

/** Parse untimed plain lyrics, one line per lyric line; blank lines dropped. */
export function parsePlainLyrics(text: string): Lyrics {
  void text;
  throw new Error("parsePlainLyrics: not implemented");
}

/** Detect LRC vs plain text and parse accordingly. */
export function parseLyricsText(text: string, source?: Lyrics["source"]): Lyrics {
  void text;
  void source;
  throw new Error("parseLyricsText: not implemented");
}

/** Serialize to LRC (untimed lines are emitted without a tag). */
export function toLrc(lyrics: Lyrics): string {
  void lyrics;
  throw new Error("toLrc: not implemented");
}

/** Give untimed lines rough start/end times spread across the vocal-looking parts of the song. */
export function distributeLines(lyrics: Lyrics, analysis: AudioAnalysis | null, duration: number): Lyrics {
  void analysis;
  void duration;
  return lyrics;
}

/** Recompute `synced` and ids ("l0".."lN") after edits. */
export function normalizeLyrics(lyrics: Lyrics): Lyrics {
  return lyrics;
}
