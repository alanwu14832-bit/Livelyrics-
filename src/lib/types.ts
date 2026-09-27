// Shared domain types for Livelyrics.
// Every module (server pipeline, audio analysis, stage renderer, operator console,
// upload flow) builds against these. Change them only in coordination.

import type { DesignPlan, FontId, MediaTreatment, SceneId, SectionMedia } from "./schema";

export type { DesignPlan } from "./schema";
export type {
  SceneId,
  LyricStyleId,
  LyricPlacement,
  SectionKind,
  FontId,
  SectionDesign,
  KeyVisual,
  LineDesign,
  CueNote,
  SectionMedia,
  MediaTreatment,
} from "./schema";

// ---------------------------------------------------------------------------
// Audio analysis (computed in the browser at upload time, stored on the project)
// ---------------------------------------------------------------------------

export interface AudioSectionGuess {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  /** 0..1 mean normalized energy inside the section */
  energy: number;
}

export interface AudioAnalysis {
  /** seconds */
  duration: number;
  sampleRate: number;
  /** estimated tempo, beats per minute (0 when unknown) */
  bpm: number;
  /** 0..1 confidence of the tempo estimate */
  bpmConfidence: number;
  /** beat timestamps in seconds */
  beats: number[];
  /** frames per second of the envelope arrays below (e.g. 20) */
  envelopeRate: number;
  /** 0..1 normalized RMS loudness per envelope frame */
  energy: number[];
  /** 0..1 normalized onset strength (spectral flux) per envelope frame */
  onset: number[];
  /** 0..1 normalized spectral centroid ("brightness") per envelope frame */
  brightness: number[];
  /** 0..1 normalized low-band (bass) energy per envelope frame */
  bass: number[];
  /** waveform peaks for drawing the timeline: max |sample| per bucket, 0..1 */
  peaks: number[];
  /** structural boundaries from novelty detection (unlabeled) */
  sections: AudioSectionGuess[];
}

// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------

export interface LyricWord {
  text: string;
  /** seconds, absolute song time */
  start: number;
  /** seconds, absolute song time */
  end: number;
}

export interface LyricLine {
  /** stable id, e.g. "l0", "l1" ... */
  id: string;
  text: string;
  /** optional second-language line (translation / romanization) */
  translation?: string;
  /** seconds; null when not yet timed */
  start: number | null;
  /** seconds; null when not yet timed (derived from next line start if absent) */
  end: number | null;
  /** optional word/character-level timing */
  words?: LyricWord[];
}

export type LyricsSource = "lrclib-synced" | "lrclib-plain" | "user" | "embedded" | "none";

export interface Lyrics {
  source: LyricsSource;
  /** true when every line has a start time */
  synced: boolean;
  lines: LyricLine[];
  /** e.g. "zh-Hant", "en", "ja" */
  language?: string;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface SongMeta {
  title: string;
  artist: string;
  album?: string;
  year?: number;
  /** seconds */
  duration: number;
  /** original filename of the upload */
  fileName: string;
  /** mime type of the stored audio */
  mimeType: string;
}

export type PipelineStepId = "analyze" | "lyrics" | "research" | "design" | "done";

export type ProjectStatus = "new" | "processing" | "ready" | "error";

export interface ResearchSource {
  title: string;
  url: string;
}

export interface Research {
  /** Markdown research brief written in Traditional Chinese */
  brief: string;
  sources: ResearchSource[];
  /** which engine produced it */
  engine: "claude" | "offline";
  model?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Band media assets (album art, photos, MV clips, logo) and the output canvas
// ---------------------------------------------------------------------------

export type AssetKind = "image" | "video" | "logo";

export interface Asset {
  /** short id, e.g. "a1b2c3d4e5f6" (lowercase hex) */
  id: string;
  kind: AssetKind;
  /** display name (defaults to the original file name without extension) */
  name: string;
  /** stored Content-Type, e.g. "image/png", "video/mp4" */
  mimeType: string;
  /** file name inside the project's assets/ folder, e.g. "a1b2c3d4e5f6.png" */
  file: string;
  /** intrinsic pixel size, measured in the browser before upload */
  width: number;
  height: number;
  /** seconds (videos only) */
  duration?: number;
  bytes: number;
  createdAt: string;
  /** operator's note for the designer, e.g. "第二張專輯封面，樂團最愛" */
  note?: string;
  tags?: string[];
  /**
   * Where the file lives. Absent (or "project") = the project's own assets/ folder; "band" = the
   * band's shared library (data/bands/<bandId>/assets). Band assets carry "band" in a project's
   * merged view (`Project.bandAssets`, src/lib/asset-scope.ts); ids are unique across both.
   */
  scope?: "project" | "band";
}

/** Fractions (0..0.3) of the canvas kept free of lyrics on each side. */
export interface LyricSafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The pixel canvas the show is designed for (projector, LED wall, portrait screen). */
export interface ProjectOutput {
  width: number;
  height: number;
  /** preset id from OUTPUT_PRESETS (src/lib/output.ts), or "custom" */
  preset: string;
  lyricSafe: LyricSafeArea;
}

export interface Project {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  /** last error message when status === "error" */
  error?: string;
  meta: SongMeta;
  /** audio file name inside the project folder, e.g. "audio.mp3" */
  audioFile: string;
  analysis: AudioAnalysis | null;
  lyrics: Lyrics;
  research: Research | null;
  plan: DesignPlan | null;
  /** band material; [] for projects created before assets existed */
  assets: Asset[];
  /** output canvas; 1920x1080 for projects created before it existed */
  output: ProjectOutput;
  /** the band (樂團) this song belongs to; absent for projects created before bands existed */
  bandId?: string;
  /**
   * The band's shared media library (scope "band"), attached by the server when the project is
   * read through the API; never stored in project.json. Plans may reference these ids too.
   */
  bandAssets?: Asset[];
}

/** lightweight listing entry */
export interface ProjectSummary {
  id: string;
  title: string;
  artist: string;
  duration: number;
  status: ProjectStatus;
  updatedAt: string;
  /** first palette color, for the library card */
  accent?: string;
  /** a few plan palette colors (background first), for the library card */
  palette?: string[];
  /** last error message when status === "error" */
  error?: string;
  bandId?: string;
  /** number of lyric lines (0 = no lyrics yet) */
  lyricLines?: number;
  lyricsSynced?: boolean;
  /** true when a design plan exists */
  hasPlan?: boolean;
}

// ---------------------------------------------------------------------------
// Band (樂團) and its visual bible (視覺聖經)
// ---------------------------------------------------------------------------

/** How much the band wants lyrics on screen across its songs. */
export type LyricPolicyMode = "chorus-only" | "full" | "minimal";

export interface BandPaletteColor {
  hex: string;
  /** 背景、主色、點綴、歌詞、高光 … */
  role: string;
  name: string;
}

export interface BandBible {
  /** 繁中 Markdown: 世界觀、氣質、禁忌 */
  summary: string;
  /** 4 to 8 colours when set (first = deepest background); [] = not decided yet */
  palette: BandPaletteColor[];
  fonts: { cjkFont: FontId; latinFont: FontId; weight: number };
  motifs: string[];
  /** preferred treatments for band material */
  treatments: MediaTreatment[];
  sceneAffinity: SceneId[];
  sceneAvoid: SceneId[];
  lyricPolicy: { mode: LyricPolicyMode; note: string };
  dos: string[];
  donts: string[];
  /** who wrote it last: the designer (claude / offline heuristic) or the operator */
  source: { engine: "claude" | "offline" | "manual"; model?: string; updatedAt: string } | null;
}

export interface Band {
  /** 12 lowercase hex chars, like project ids */
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  bible: BandBible;
  /** shared material reused across the band's songs (logo, album covers, photos, MV clips) */
  assets: Asset[];
}

export interface BandSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** a few bible palette colours for the card */
  palette?: string[];
  songCount: number;
  showCount: number;
  assetCount: number;
  /** true when the bible has a summary or a palette */
  hasBible: boolean;
}

// ---------------------------------------------------------------------------
// Show / setlist (演出)
// ---------------------------------------------------------------------------

export type SetItemKind = "song" | "walk-in" | "walk-out" | "interlude" | "standby";
export type LookItemKind = Exclude<SetItemKind, "song">;

/** A non-song moment of the show, rendered as a synthetic one-section plan (src/lib/show.ts lookToPlan). */
export interface SetLook {
  scene: SceneId;
  /** [background, primary, accent] */
  colorway: [string, string, string];
  media: SectionMedia | null;
  /** big text on screen (band name, MC line); empty = none */
  text?: string;
  /** seconds, for the running time */
  durationHint?: number;
}

export type SetItem =
  | { id: string; kind: "song"; projectId: string; note?: string }
  | { id: string; kind: LookItemKind; title: string; look: SetLook; note?: string };

export type ArcRole = "opener" | "build" | "peak" | "breather" | "finale" | "encore";
/** which palette role leads the song's colorways */
export type PaletteEmphasis = "shadow" | "primary" | "accent" | "highlight";

/** The show-arc designer's note for one song of the setlist. */
export interface SongArcNote {
  itemId: string;
  projectId: string;
  /** 0-based index among the songs */
  position: number;
  role: ArcRole;
  /** 0..1 target energy of this song within the show */
  energy: number;
  emphasis: PaletteEmphasis;
  /** 繁中, one or two sentences */
  note: string;
  /** set when the song was re-designed to follow this note */
  appliedAt?: string;
}

export interface ShowArc {
  engine: "claude" | "offline";
  model?: string;
  createdAt: string;
  /** 繁中 Markdown overview of the arc */
  overview: string;
  songs: SongArcNote[];
}

export interface Show {
  id: string;
  bandId: string;
  name: string;
  /** YYYY-MM-DD */
  date?: string;
  venue?: string;
  /** the venue's canvas; "套用到所有歌曲" copies it onto every song */
  output: ProjectOutput;
  items: SetItem[];
  notes: string;
  arc: ShowArc | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShowSummary {
  id: string;
  bandId: string;
  name: string;
  date?: string;
  venue?: string;
  songCount: number;
  itemCount: number;
  updatedAt: string;
}

/**
 * Show-arc direction for one song's (re)design (ProcessRequest.arc): the designer follows the
 * song's place in the set (Claude reads it, the offline designer shifts intensity and palette).
 */
export interface SongArcDirective {
  showName: string;
  position: number;
  total: number;
  role: ArcRole;
  energy: number;
  emphasis: PaletteEmphasis;
  note: string;
}

// ---------------------------------------------------------------------------
// Processing pipeline events (server -> browser, Server-Sent Events)
// POST /api/projects/[id]/process streams `data: <PipelineEvent JSON>\n\n`
// ---------------------------------------------------------------------------

export type PipelineEvent =
  /**
   * First event when this request joined a run that was already in progress (or had just
   * finished) instead of starting one. `steps` are the steps that run covers;
   * `sameRequest` is false when this request's own steps/instruction/lyrics were NOT applied.
   */
  | { type: "attached"; steps: Array<"lyrics" | "research" | "design">; sameRequest: boolean }
  | { type: "step"; step: PipelineStepId; status: "start" | "done" | "skipped" | "error"; message?: string }
  | { type: "log"; step: PipelineStepId; message: string }
  /** incremental research text / designer thoughts to show live */
  | { type: "delta"; step: PipelineStepId; text: string }
  | { type: "search"; query: string }
  | { type: "done"; project: Project }
  | { type: "error"; message: string };
