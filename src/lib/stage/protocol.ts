// Console <-> projection output protocol.
//
// The operator console (/p/[id]) owns the clock and all operator decisions.
// The projection window (/p/[id]/output) is a dumb renderer: it receives the
// Project (plan + lyrics) and a stream of StageState snapshots over a
// BroadcastChannel and renders scene + lyrics only.
//
// Show mode (phase 2b): the show console (/s/[id]/live) drives one projection window for the
// whole show (/s/[id]/output) on showChannelName(showId). Only the item on air talks on that
// channel; every item change arrives as a `project` message (optionally with a `transition` the
// output performs itself) and the next item is announced ahead with `preload`. Every addition is
// optional, so older windows and consoles keep working with newer ones.
//
// 字體藝術 (phase 6): the 排版 editor (/p/[id]/type) posts `plan` on the song's channel after an
// edit; a console adopts its type system and re-broadcasts the project, and a per-song output
// without a console shows it directly.
//
// Both the console's preview and the projection window render through the same
// <StageView project store /> component, so the preview is exactly the output.

import { normalizeOutput } from "../output";
import type { DesignPlan, LyricStyleId, Project, SceneId } from "../types";

export type PlaybackMode = "track" | "live";

export interface StageOverrides {
  /** fade everything to black */
  blackout: boolean;
  /** show/hide the lyric layer */
  lyricsVisible: boolean;
  /** freeze scene motion (lyrics still update) */
  freeze: boolean;
  /** force a scene instead of the plan's section scene; null = follow plan */
  scene: SceneId | null;
  /** force a lyric style; null = follow plan */
  lyricStyle: LyricStyleId | null;
  /** master intensity multiplier, 0..1.5 (1 = as designed) */
  intensity: number;
  /** master lyric size multiplier, 0.5..2 (1 = as designed) */
  lyricScale: number;
  /** show a test pattern / safe-area overlay on the output */
  testPattern: boolean;
}

export const DEFAULT_OVERRIDES: StageOverrides = {
  blackout: false,
  lyricsVisible: true,
  freeze: false,
  scene: null,
  lyricStyle: null,
  intensity: 1,
  lyricScale: 1,
  testPattern: false,
};

/** Live audio features, 0..1 each. */
export interface LiveAudioFeatures {
  level: number;
  bass: number;
  onset: number;
  /** 0..1 position inside the current beat (0 = on the beat) */
  beatPhase: number;
  /**
   * 節拍模式 (phase 5a): beatPhase comes from the band's MIDI clock, so the renderer follows it even
   * in TRACK mode instead of the analysis beat grid. Optional (older consoles never send it).
   */
  clock?: boolean;
}

export interface StageState {
  projectId: string;
  mode: PlaybackMode;
  /** song time in seconds at `sentAt` (offset already applied by the console) */
  t: number;
  playing: boolean;
  /** epoch ms (Date.now()) when `t` was sampled; receivers extrapolate while playing */
  sentAt: number;
  /** index into project.lyrics.lines of the line to display; null = none */
  lineIndex: number | null;
  /** epoch ms when the current line became active (used for untimed / live-cued lines) */
  lineStartedAt: number;
  /** index into plan.sections currently active; null when no plan */
  sectionIndex: number | null;
  /**
   * 保持段落: the console holds `sectionIndex` while time and cues move on. Every layer (scene,
   * colours, media, lyric style) then comes from that section, even for lines sung in another.
   * Optional (older consoles never send it).
   */
  sectionHeld?: boolean;
  overrides: StageOverrides;
  audio: LiveAudioFeatures;
}

export function initialStageState(projectId: string): StageState {
  return {
    projectId,
    mode: "track",
    t: 0,
    playing: false,
    sentAt: Date.now(),
    lineIndex: null,
    lineStartedAt: Date.now(),
    sectionIndex: null,
    overrides: { ...DEFAULT_OVERRIDES },
    audio: { level: 0, bass: 0, onset: 0, beatPhase: 0 },
  };
}

/** Current song time, extrapolated from a snapshot. */
export function stageTime(state: StageState, now: number = Date.now()): number {
  if (!state.playing) return state.t;
  return state.t + Math.max(0, now - state.sentAt) / 1000;
}

// ---------------------------------------------------------------------------
// Messages on BroadcastChannel(channelName(projectId)) or BroadcastChannel(showChannelName(showId))
// ---------------------------------------------------------------------------

/**
 * How the projection window changes to a new item (show mode). The output performs it itself:
 * `fade` dims to black in ms / 2, swaps the project under black (fonts, media and shaders get
 * ready there), then fades back in over ms / 2; `cut` swaps at once.
 */
export interface StageTransition {
  kind: "fade" | "cut";
  /** total length in ms (0..MAX_TRANSITION_MS) */
  ms: number;
}

/** The show console's default take: fade through black. */
export const TAKE_FADE_MS = 800;
export const MAX_TRANSITION_MS = 3000;
export const DEFAULT_TAKE_TRANSITION: StageTransition = { kind: "fade", ms: TAKE_FADE_MS };

export type StageMessage =
  /** output -> console: output window opened / wants a full resync */
  | { type: "hello"; from: "output"; outputId: string }
  /**
   * console -> output: full project (plan, lyrics, meta). Sent on hello and on edits. Show mode:
   * also on every take, with the `transition` to perform when the project changes.
   * `sender` (optional, like on state / ping / preload) identifies the console instance.
   */
  | { type: "project"; project: Project; transition?: StageTransition; sender?: string }
  /** console -> output: state snapshot. ~30 Hz while playing, immediately on any change. */
  | { type: "state"; state: StageState; sender?: string }
  /** console -> output (show mode): the next item, to warm its fonts and media without showing it */
  | { type: "preload"; project: Project; sender?: string }
  /** console -> output heartbeat, every 1 s */
  | { type: "ping"; at: number; sender?: string }
  /**
   * output -> console heartbeat reply; lets the console show "output connected".
   * width/height are the output viewport in physical pixels (CSS px × devicePixelRatio,
   * rounded), e.g. 1920×1080 on a projector — use them for the preview's aspect ratio.
   */
  | { type: "pong"; outputId: string; at: number; width: number; height: number; fullscreen: boolean; limiter?: LimiterReport }
  /** console -> output: ask the output window to toggle fullscreen (needs a user gesture there; best effort) */
  | { type: "fullscreen" }
  /** console -> output: ask the output window to close */
  | { type: "close" }
  /**
   * 排版 editor -> consoles and the per-song output: the plan after a 字體藝術 edit (the editor saves
   * it). A console adopts its type system and re-broadcasts; an output without a console shows it.
   */
  | { type: "plan"; projectId: string; plan: DesignPlan; sender?: string };

/**
 * LED 安全模式 (phase 3): what the projection window's flash limiter is doing, reported on every
 * pong (optional: older outputs never send it). The safety settings themselves travel inside
 * `project.output.safety` with every `project` message.
 */
export interface LimiterReport {
  /** safe mode is on in the output */
  on: boolean;
  /** the limiter is damping right now */
  damping: boolean;
  /** damping episodes since the output took the current project */
  engaged: number;
}

export function channelName(projectId: string): string {
  return `livelyrics:${projectId}`;
}

/** The one channel of a whole show: the show console's item on air <-> the show's projection window. */
export function showChannelName(showId: string): string {
  return `livelyrics:show:${showId}`;
}

// ---------------------------------------------------------------------------
// Defensive parsing (the output never trusts what arrives on the channel)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const index = (v: unknown): number | null => (finite(v) && Number.isInteger(v) && v >= 0 ? v : null);
const unit = (v: unknown, fallback: number) => (finite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** A transition from the wire: a known kind and a finite, bounded length; null otherwise. */
export function sanitizeTransition(raw: unknown): StageTransition | null {
  if (!isRecord(raw) || (raw.kind !== "fade" && raw.kind !== "cut")) return null;
  const ms = finite(raw.ms) ? Math.round(Math.min(MAX_TRANSITION_MS, Math.max(0, raw.ms))) : raw.kind === "fade" ? TAKE_FADE_MS : 0;
  return { kind: raw.kind, ms };
}

function sanitizeOverrides(raw: unknown): StageOverrides {
  const o = isRecord(raw) ? raw : {};
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (finite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  return {
    blackout: bool(o.blackout, DEFAULT_OVERRIDES.blackout),
    lyricsVisible: bool(o.lyricsVisible, DEFAULT_OVERRIDES.lyricsVisible),
    freeze: bool(o.freeze, DEFAULT_OVERRIDES.freeze),
    // ids are validated by the renderer (resolve.ts); only the type is checked here
    scene: typeof o.scene === "string" ? (o.scene as SceneId) : null,
    lyricStyle: typeof o.lyricStyle === "string" ? (o.lyricStyle as LyricStyleId) : null,
    intensity: num(o.intensity, 0, 1.5, DEFAULT_OVERRIDES.intensity),
    lyricScale: num(o.lyricScale, 0.5, 2, DEFAULT_OVERRIDES.lyricScale),
    testPattern: bool(o.testPattern, DEFAULT_OVERRIDES.testPattern),
  };
}

/**
 * A state snapshot from the wire with every field repaired (missing or malformed values get safe
 * defaults). `projectId` fixes the project (the per-song output); otherwise the snapshot must
 * name one. Null when it is not a state at all.
 */
export function sanitizeStageState(raw: unknown, projectId?: string, now: number = Date.now()): StageState | null {
  if (!isRecord(raw)) return null;
  const id = projectId ?? (typeof raw.projectId === "string" && raw.projectId ? raw.projectId : null);
  if (!id) return null;
  const audio = isRecord(raw.audio) ? raw.audio : {};
  const state: StageState = {
    projectId: id,
    mode: raw.mode === "live" ? "live" : "track",
    t: finite(raw.t) ? Math.max(0, raw.t) : 0,
    playing: raw.playing === true,
    sentAt: finite(raw.sentAt) ? raw.sentAt : now,
    lineIndex: index(raw.lineIndex),
    lineStartedAt: finite(raw.lineStartedAt) ? raw.lineStartedAt : now,
    sectionIndex: index(raw.sectionIndex),
    overrides: sanitizeOverrides(raw.overrides),
    audio: { level: unit(audio.level, 0), bass: unit(audio.bass, 0), onset: unit(audio.onset, 0), beatPhase: unit(audio.beatPhase, 0), ...(audio.clock === true ? { clock: true } : {}) },
  };
  if (raw.sectionHeld === true) state.sectionHeld = true;
  return state;
}

function isProjectLike(v: unknown): v is Project {
  return isRecord(v) && typeof v.id === "string" && v.id.length > 0 && isRecord(v.meta);
}

/**
 * The project from the wire with its output canvas (size, lyric area, LED safety) repaired. A
 * project without one is left alone: the renderer then uses the default canvas, and missing LED
 * safety settings always mean safe mode on (projectSafety in safety.ts).
 */
function withSafeOutput(p: Project): Project {
  const out = (p as { output?: unknown }).output;
  return isRecord(out) ? { ...p, output: normalizeOutput(out) } : p;
}

export function sanitizeLimiter(raw: unknown): LimiterReport | null {
  if (!isRecord(raw)) return null;
  return { on: raw.on === true, damping: raw.damping === true, engaged: finite(raw.engaged) && raw.engaged >= 0 ? Math.floor(raw.engaged) : 0 };
}

/**
 * One channel message, checked field by field; null for anything unknown or malformed (the
 * receiver ignores it). A project is only checked for its id and meta: the renderer repairs the
 * rest (resolve.ts) and never throws on bad plan data.
 */
export function parseStageMessage(raw: unknown): StageMessage | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;
  const sender = typeof raw.sender === "string" && raw.sender ? { sender: raw.sender } : {};
  switch (raw.type) {
    case "hello":
      return typeof raw.outputId === "string" ? { type: "hello", from: "output", outputId: raw.outputId } : null;
    case "project": {
      if (!isProjectLike(raw.project)) return null;
      const transition = sanitizeTransition(raw.transition);
      return { type: "project", project: withSafeOutput(raw.project), ...(transition ? { transition } : {}), ...sender };
    }
    case "preload":
      return isProjectLike(raw.project) ? { type: "preload", project: withSafeOutput(raw.project), ...sender } : null;
    case "state": {
      const state = sanitizeStageState(raw.state);
      return state ? { type: "state", state, ...sender } : null;
    }
    case "ping":
      return { type: "ping", at: finite(raw.at) ? raw.at : Date.now(), ...sender };
    case "pong":
      if (typeof raw.outputId !== "string") return null;
      return {
        type: "pong",
        outputId: raw.outputId,
        at: finite(raw.at) ? raw.at : Date.now(),
        width: finite(raw.width) ? raw.width : 0,
        height: finite(raw.height) ? raw.height : 0,
        fullscreen: raw.fullscreen === true,
        ...(sanitizeLimiter(raw.limiter) ? { limiter: sanitizeLimiter(raw.limiter)! } : {}),
      };
    case "fullscreen":
      return { type: "fullscreen" };
    case "close":
      return { type: "close" };
    case "plan": {
      // the renderer repairs the rest (resolve.ts, the type engine's resolver) and never throws
      const plan = raw.plan;
      if (typeof raw.projectId !== "string" || !raw.projectId || !isRecord(plan) || !Array.isArray(plan.sections) || !isRecord(plan.keyVisual)) return null;
      return { type: "plan", projectId: raw.projectId, plan: plan as unknown as DesignPlan, ...sender };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// StageStore: how <StageView> reads state without re-rendering React at 60 fps
// ---------------------------------------------------------------------------

export interface StageStore {
  get(): StageState;
  subscribe(listener: (state: StageState) => void): () => void;
}

export interface WritableStageStore extends StageStore {
  set(next: StageState): void;
  update(patch: Partial<StageState>): void;
}

export function createStageStore(initial: StageState): WritableStageStore {
  let state = initial;
  const listeners = new Set<(s: StageState) => void>();
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      state = next;
      for (const l of listeners) l(state);
    },
    update(patch) {
      state = { ...state, ...patch };
      for (const l of listeners) l(state);
    },
  };
}
