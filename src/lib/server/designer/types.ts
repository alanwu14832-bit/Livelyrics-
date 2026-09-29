// Designer module input/callback types (re-exported from ./index).

import type { Asset, AudioAnalysis, BandBible, DesignPlan, Lyrics, MoodImage, Research, SongArcDirective, SongMeta } from "@/lib/types";
import type { VisionImage } from "./moodboard";

export interface DesignerInput {
  meta: SongMeta;
  lyrics: Lyrics;
  analysis: AudioAnalysis | null;
  /** the band's uploaded material (album art, photos, MV clips, logo); sections may only show these */
  assets?: Asset[];
  /** the band's visual bible: a hard constraint for research and design (stay in this world) */
  bible?: BandBible | null;
  bandName?: string;
  /** mood board (參考圖): the band's, then the song's; never stage media */
  moodboard?: MoodImage[];
  /** the mood board images the server could read, for Claude's vision input (ids match `moodboard`) */
  moodboardImages?: VisionImage[];
}

export interface DesignerCallbacks {
  onLog?: (message: string) => void;
  /** streaming text (research brief as it is written / designer progress notes) */
  onDelta?: (text: string) => void;
  /** a web search Claude issued */
  onSearch?: (query: string) => void;
  signal?: AbortSignal;
}

export interface DesignRequest extends DesignerInput {
  research: Research | null;
  /** operator's art-direction instruction for a re-design */
  instruction?: string;
  /** the current plan (re-design keeps what the instruction does not ask to change) */
  previous?: DesignPlan | null;
  /** the song's place in a show's arc (energy, palette emphasis, role) */
  arc?: SongArcDirective | null;
}

/** Callbacks that never throw into the designer. */
export function safeCallbacks(cb: DesignerCallbacks = {}): Required<Omit<DesignerCallbacks, "signal">> & { signal?: AbortSignal } {
  const wrap =
    <T>(fn: ((v: T) => void) | undefined) =>
    (v: T) => {
      try {
        fn?.(v);
      } catch {
        /* a UI callback must never break design generation */
      }
    };
  return { onLog: wrap(cb.onLog), onDelta: wrap(cb.onDelta), onSearch: wrap(cb.onSearch), signal: cb.signal };
}
