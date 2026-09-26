// Console <-> projection output protocol.
//
// The operator console (/p/[id]) owns the clock and all operator decisions.
// The projection window (/p/[id]/output) is a dumb renderer: it receives the
// Project (plan + lyrics) and a stream of StageState snapshots over a
// BroadcastChannel and renders scene + lyrics only.
//
// Both the console's preview and the projection window render through the same
// <StageView project store /> component, so the preview is exactly the output.

import type { LyricStyleId, Project, SceneId } from "../types";

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
// Messages on BroadcastChannel(channelName(projectId))
// ---------------------------------------------------------------------------

export type StageMessage =
  /** output -> console: output window opened / wants a full resync */
  | { type: "hello"; from: "output"; outputId: string }
  /** console -> output: full project (plan, lyrics, meta). Sent on hello and on edits. */
  | { type: "project"; project: Project }
  /** console -> output: state snapshot. ~30 Hz while playing, immediately on any change. */
  | { type: "state"; state: StageState }
  /** console -> output heartbeat, every 1 s */
  | { type: "ping"; at: number }
  /** output -> console heartbeat reply; lets the console show "output connected" */
  | { type: "pong"; outputId: string; at: number; width: number; height: number; fullscreen: boolean }
  /** console -> output: ask the output window to toggle fullscreen (needs a user gesture there; best effort) */
  | { type: "fullscreen" }
  /** console -> output: ask the output window to close */
  | { type: "close" };

export function channelName(projectId: string): string {
  return `livelyrics:${projectId}`;
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
