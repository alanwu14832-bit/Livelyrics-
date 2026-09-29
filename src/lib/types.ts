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
  TypeVoiceId,
  TypeRecipeId,
  TypeOrientation,
  TypeColorTreatment,
  TypeOrnamentId,
  TypeEnterId,
  TypeExitId,
  TypeColorRole,
  TypeParams,
  TypeLineDraft,
  TypeLineEdit,
  TypeLine,
  TypeSection,
  TypeSystemDraft,
  TypeSystem,
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

/**
 * Who wrote a research brief (or proposed directions, or made a plan):
 *   claude         the Claude API (paid key): web search + structured outputs
 *   offline        the heuristic designer (older briefs; audio and lyric structure only)
 *   free           免費研究: public data (MusicBrainz, Wikipedia) + local lyric / audio analysis
 *   manual-claude  用 claude.ai 研究: the operator pasted a reply from their own claude.ai account
 */
export type DesignEngine = "claude" | "offline" | "free" | "manual-claude";

export interface Research {
  /** Markdown research brief written in Traditional Chinese */
  brief: string;
  sources: ResearchSource[];
  /** which engine produced it */
  engine: DesignEngine;
  model?: string;
  createdAt: string;
  /**
   * 免費研究: what the free public sources said about the song and the artist, cached so a re-run
   * does not ask again (kept when a claude.ai reply replaces the brief). Absent for Claude briefs.
   */
  publicInfo?: PublicInfo;
}

// ---------------------------------------------------------------------------
// Free research (免費研究): public facts from MusicBrainz and Wikipedia
// ---------------------------------------------------------------------------

/** ok = found; none = asked, nothing matched; failed = unreachable / error; skipped = not asked */
export type SourceStatus = "ok" | "none" | "failed" | "skipped";

export interface MbTag {
  name: string;
  count: number;
}

export interface MbRecordingInfo {
  id: string;
  title: string;
  /** YYYY, YYYY-MM or YYYY-MM-DD */
  firstReleaseDate?: string;
  year?: number;
  /** the album / single it first came out on */
  releaseGroup?: { id: string; title: string; type?: string };
  tags: MbTag[];
  /** milliseconds */
  length?: number;
}

export interface MbArtistInfo {
  id: string;
  name: string;
  sortName?: string;
  /** Group, Person, Orchestra, … */
  type?: string;
  /** ISO 3166-1 code, e.g. "TW" */
  country?: string;
  /** e.g. "Taipei" */
  area?: string;
  beginYear?: number;
  disambiguation?: string;
  /** curated genres (lookup) and folksonomy tags, most votes first */
  genres: MbTag[];
  tags: MbTag[];
  /** official site, YouTube, Bandcamp, setlist.fm, … (url-rels) */
  links: Array<{ type: string; url: string }>;
}

export interface WikiPage {
  lang: "zh" | "en";
  title: string;
  description?: string;
  /** the lead summary (zh pages in the zh-TW variant) */
  extract: string;
  url: string;
}

export interface PublicInfo {
  version: 1;
  /** what was looked up (the song info at the time) */
  query: { title: string; artist: string };
  fetchedAt: string;
  musicbrainz: { recording: MbRecordingInfo | null; artist: MbArtistInfo | null } | null;
  wikipedia: { artist: WikiPage | null; song: WikiPage | null } | null;
  status: { musicbrainz: SourceStatus; wikipedia: SourceStatus };
  /** what went wrong or was skipped (繁中), for the brief */
  notes: string[];
}

/** Who made the current plan: the design step (Claude or the offline designer), 用 claude.ai 研究, or 採用這個方向. */
export interface PlanSource {
  engine: DesignEngine;
  model?: string;
  at: string;
}

// ---------------------------------------------------------------------------
// Band media assets (album art, photos, MV clips, logo) and the output canvas
// ---------------------------------------------------------------------------

export type AssetKind = "image" | "video" | "logo";

/**
 * A file kept in Vercel Blob (cloud mode, see docs/ARCHITECTURE.md "Cloud mode"). Files on the
 * local disk have none: their place follows from the project / band folder and the file name.
 */
export interface BlobRef {
  /** public blob URL (the API routes redirect there) */
  url: string;
  /** pathname inside the blob store, e.g. "projects/<id>/asset-<random>.png" */
  pathname: string;
}

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
  /** cloud mode: where the file lives in Vercel Blob (`file` still names its type) */
  blob?: BlobRef;
}

// ---------------------------------------------------------------------------
// Mood board (phase 4): reference images the band gives the designer. Never stage media.
// ---------------------------------------------------------------------------

/**
 * Colours and tone of one reference image, measured in the browser at upload time (k-means over
 * the downscaled pixels, src/lib/moodboard.ts). The offline designer reads these; Claude sees the
 * image itself.
 */
export interface MoodStats {
  /** dominant colours, most frequent first (2 to 6, lowercase #rrggbb) */
  palette: string[];
  /** share of the image each palette colour covers (same order, sums to about 1) */
  weights: number[];
  /** mean perceived lightness 0..1 */
  luma: number;
  /** mean saturation 0..1 */
  saturation: number;
  /** mean (red − blue) balance, -1 (cool) .. 1 (warm) */
  warmth: number;
}

/**
 * A mood board image (參考圖). Stored like an asset (same folder / Blob prefix, ids unique across
 * both), kept in its own list (`Project.moodboard`, `Band.moodboard`) so it is never shown on
 * stage. `note` is the operator's cue for the designer, e.g. 「喜歡這個顏色」「這種顆粒感」.
 * Uploads are downscaled in the browser to at most MOOD_MAX_EDGE px (WebP / JPEG).
 */
export interface MoodImage extends Asset {
  stats?: MoodStats;
}

// ---------------------------------------------------------------------------
// Design directions (phase 4): 2–3 pitched looks the band chooses from
// ---------------------------------------------------------------------------

/** 提案中 / 已選定 / 已退回 */
export type DirectionStatus = "proposed" | "selected" | "rejected";

export interface DirectionComment {
  id: string;
  text: string;
  at: string;
  /** "comment" = the band's / operator's note; "revision" = the note a revision followed */
  kind: "comment" | "revision";
}

/** Which mood board image informed what (Claude cites them; the offline designer names the palette source). */
export interface DirectionReference {
  imageId: string;
  /** 繁中, e.g. 「取了它的橘紅與顆粒感」 */
  cue: string;
}

export interface DesignDirection {
  /** short id, unique within the project ("d" + 8 hex) */
  id: string;
  /** "A" | "B" | "C" */
  letter: string;
  /** 方向名稱, e.g. 「冷調膠片感」 */
  name: string;
  /** one-line pitch */
  pitch: string;
  /** 繁中 Markdown: mood and reference rationale, citing the research and the mood board */
  rationale: string;
  references: DirectionReference[];
  /** 場景傾向 in words */
  sceneTendency: string;
  /** 歌詞處理 in words */
  lyricTreatment: string;
  /** the full plan this direction expands to (palette and typography live in plan.keyVisual) */
  plan: DesignPlan;
  status: DirectionStatus;
  comments: DirectionComment[];
  engine: DirectionEngine;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

/** Directions come from Claude (API), the offline designer, or a pasted claude.ai reply. */
export type DirectionEngine = "claude" | "offline" | "manual-claude";

export interface DirectionSet {
  engine: DirectionEngine;
  model?: string;
  createdAt: string;
  directions: DesignDirection[];
}

/** The plan a direction replaced, so 「復原」 can bring it back. */
export interface PlanSnapshot {
  plan: DesignPlan;
  at: string;
  /** 繁中, what replaced it, e.g. 「採用方向 B「飽和拼貼」」 */
  reason: string;
  /** who made that plan, when it was known (復原 brings it back with the plan) */
  source?: PlanSource;
}

/** Fractions (0..0.3) of the canvas kept free of lyrics on each side. */
export interface LyricSafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** LED 安全模式 brightness presets (src/lib/stage/safety.ts SAFETY_PRESETS), or "custom". */
export type SafetyPresetId = "indoor" | "led" | "outdoor" | "custom";

/**
 * LED 安全模式 (phase 3): the output limiter settings, stored with the canvas (per song, and per show
 * for the venue). Old files without it are normalized to safe mode on with the LED 牆 preset.
 */
export interface OutputSafety {
  /** master switch: off = no brightness cap, no flash limiter, no source-level softening */
  enabled: boolean;
  preset: SafetyPresetId;
  /** maximum output luminance as a fraction of the display's full white (linear light), 0.2..1 */
  brightness: number;
  /** WCAG 2.3.1 general flash limiter (≤ 3 flashes in any second) */
  flashLimit: boolean;
  /** saturated-red flash protection (every red transition counts) */
  redProtect: boolean;
  /** 0..1 highlight / contrast softening (a shoulder on the brightest values) */
  soften: number;
}

/** The pixel canvas the show is designed for (projector, LED wall, portrait screen). */
export interface ProjectOutput {
  width: number;
  height: number;
  /** preset id from OUTPUT_PRESETS (src/lib/output.ts), or "custom" */
  preset: string;
  lyricSafe: LyricSafeArea;
  /** LED 安全模式 (phase 3) */
  safety: OutputSafety;
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
  /** cloud mode: the audio file in Vercel Blob (`audioFile` still names its type) */
  audioBlob?: BlobRef;
  /** cloud mode: the client-driven pipeline run, so a refreshed page can pick it up */
  pipeline?: PipelineRecord;
  /** the song's mood board (phase 4); absent = none */
  moodboard?: MoodImage[];
  /** the band's mood board (scope "band"), attached on read like `bandAssets`; never stored */
  bandMoodboard?: MoodImage[];
  /** 設計方向提案 (phase 4); absent = none proposed yet */
  directions?: DirectionSet;
  /** the plan before the last 「採用這個方向」, for 復原 */
  previousPlan?: PlanSnapshot;
  /** cloud mode: 提出設計方向 / 修改方向 in progress (or its last failure) */
  directionsJob?: JobState;
  /** who made the current plan (the design step, 用 claude.ai 研究, 採用這個方向); absent on older projects */
  planSource?: PlanSource;
  /** 時間碼 (phase 5a): where the song starts on the playback rig's timecode; absent = 01:00:00:00 */
  timecode?: SongTimecode;
}

/** A song's place on the playback rig's timecode (phase 5a, one song per hour by default). */
export interface SongTimecode {
  /** HH:MM:SS:FF, e.g. 01:00:00:00 */
  start: string;
}

export type ProcessStepId = "lyrics" | "research" | "design";

/**
 * A pipeline run as recorded on the project in cloud mode, where every step is its own request
 * (bounded by the platform's time limit) and the page drives the steps one after another.
 */
export interface PipelineRecord {
  runId: string;
  /** every step of the run, in pipeline order */
  steps: ProcessStepId[];
  status: "running" | "done" | "error";
  /** the step executing now; null between two steps */
  current: ProcessStepId | null;
  startedAt: string;
  /** last change (a step started or ended) */
  updatedAt: string;
  /** finished steps of this run */
  results: Partial<Record<ProcessStepId, { status: "done" | "skipped"; message?: string; at: string }>>;
  failed?: ProcessStepId;
  error?: string;
  /** what the run was asked to do, so it can be continued or retried */
  instruction?: string;
  arc?: SongArcDirective;
  /** the run does not call the Claude API (免費研究 + the offline designer) */
  free?: boolean;
}

/** A long server job (a Claude call) recorded on its document in cloud mode. */
export interface JobState {
  status: "running" | "error";
  startedAt: string;
  message?: string;
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
  /** cloud mode: 從作品產生視覺聖經 in progress (or its last failure) */
  bibleJob?: JobState;
  /** the band's mood board (phase 4): applies to all its songs; absent = none */
  moodboard?: MoodImage[];
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
  | {
      id: string;
      kind: "song";
      projectId: string;
      note?: string;
      /**
       * 時間碼 (phase 5a): where this song starts on the playback rig's timecode, HH:MM:SS:FF. Absent =
       * its position among the songs (song n at n:00:00:00, one song per hour).
       */
      timecode?: string;
    }
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
  /** cloud mode: 整場弧線 in progress (or its last failure) */
  arcJob?: JobState;
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
