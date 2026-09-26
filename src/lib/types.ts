// Shared domain types for Livelyrics.
// Every module (server pipeline, audio analysis, stage renderer, operator console,
// upload flow) builds against these. Change them only in coordination.

import type { DesignPlan } from "./schema";

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
