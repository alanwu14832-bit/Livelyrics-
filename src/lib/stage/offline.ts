// Deterministic stage state for offline rendering (the video export): everything the live
// StageEngine derives from the wall clock is derived from song time here.
//
// - trackStateAt: the StageState the console would publish while playing the track at t
//   (line, section, no overrides, no live audio: the analysis envelopes drive the scene).
// - buildSceneClock: the shaders' scene clock as a pure function of t. Live, the clock is
//   integrated frame by frame from the section's speed and the smoothed energy; here the same
//   integral is precomputed on a 20 Hz grid from song start, so frame t of an export is the
//   same whether the export starts at 0 or in the middle of the song.
// - offlineSceneFrame: the director's output (current slot, outgoing slot and section
//   transition) computed from the section boundaries instead of the moment a change arrived.

import { beatAt } from "./media/model";
import { TRANSITION_SECONDS, clockRate, type DirectorFrame, type SceneSlot, type SceneTarget } from "./director";
import { follow, rawFeatures } from "./features";
import { DEFAULT_OVERRIDES, type StageState } from "./protocol";
import { clamp, lyricLookAt, resolveLook, type StageLook } from "./resolve";
import { lineIndexAt, sectionIndexAt } from "../timeline";
import type { Project } from "../types";
import { programModeKey } from "./program/model";

/** The console's published state while TRACK playback passes song time t. */
export function trackStateAt(project: Project, t: number): StageState {
  const duration = project.meta?.duration || project.analysis?.duration || 0;
  return {
    projectId: project.id,
    mode: "track",
    t,
    playing: true,
    sentAt: 0,
    lineIndex: project.lyrics ? lineIndexAt(project.lyrics, t, duration) : null,
    lineStartedAt: 0,
    sectionIndex: sectionIndexAt(project.plan, t),
    overrides: { ...DEFAULT_OVERRIDES },
    audio: { level: 0, bass: 0, onset: 0, beatPhase: 0 },
  };
}

/** Grid step of the precomputed scene clock (the analysis envelope rate). */
export const SCENE_CLOCK_STEP = 0.05;
const CLOCK_WRAP = 3600;

export interface SceneClock {
  /** scene clock (uTime) at song time t, wrapped to [0, 3600) like the live director's */
  at(t: number): number;
  /** unwrapped value (tests, transitions) */
  raw(t: number): number;
  /** smoothed energy the clock integrates with at t */
  energyAt(t: number): number;
}

function speedAt(project: Project, t: number): number {
  const plan = project.plan;
  const i = sectionIndexAt(plan, t);
  const sp = i != null && plan ? plan.sections[i]?.sceneParams : undefined;
  return clamp(sp?.speed ?? 0.35, 0, 1, 0.35);
}

/**
 * Precompute the scene clock for a project. Energy is smoothed with the live mixer's
 * attack / release (0.12 s / 0.6 s) at the grid step, so the clock speeds up with the music the
 * same way the live one does.
 */
export function buildSceneClock(project: Project): SceneClock {
  const duration = Math.max(1, project.meta?.duration || project.analysis?.duration || 0);
  const n = Math.ceil(duration / SCENE_CLOCK_STEP) + 2;
  const acc = new Float64Array(n + 1);
  const energy = new Float32Array(n + 1);
  const rate = new Float32Array(n + 1);
  const analysis = project.analysis ?? null;
  const base = trackStateAt(project, 0);
  let e = rawFeatures(analysis, base, 0).energy;
  for (let k = 0; k <= n; k++) {
    const t = k * SCENE_CLOCK_STEP;
    if (k > 0) e = follow(e, rawFeatures(analysis, base, t).energy, SCENE_CLOCK_STEP, 0.12, 0.6);
    energy[k] = e;
    rate[k] = clockRate(speedAt(project, t), e);
    if (k < n) acc[k + 1] = acc[k] + SCENE_CLOCK_STEP * rate[k];
  }
  const raw = (t: number): number => {
    if (!Number.isFinite(t)) return 0;
    if (t <= 0) return t * rate[0];
    const x = t / SCENE_CLOCK_STEP;
    const k = Math.floor(x);
    if (k >= n) return acc[n] + (t - n * SCENE_CLOCK_STEP) * rate[n];
    return acc[k] + (t - k * SCENE_CLOCK_STEP) * rate[k];
  };
  const energyAt = (t: number): number => {
    const k = Math.min(n, Math.max(0, Math.floor(t / SCENE_CLOCK_STEP)));
    return energy[k];
  };
  return {
    raw,
    energyAt,
    at: (t) => {
      const v = raw(t) % CLOCK_WRAP;
      return v < 0 ? v + CLOCK_WRAP : v;
    },
  };
}

export interface OfflineSceneFrame extends DirectorFrame {
  state: StageState;
  look: StageLook;
  lyricLook: StageLook;
  /** the outgoing section's look while a transition runs (專屬畫面: its program state) */
  previousLook?: StageLook | null;
}

function targetOf(look: StageLook): SceneTarget {
  return { scene: look.scene, params: look.params, colorway: look.colorway, lookKey: look.lookKey };
}

/**
 * The director's frame at song time t during continuous playback: the section's look, and
 * while inside the first TRANSITION_SECONDS of a section, the previous section as the outgoing
 * slot with progress (t − start) / duration. Same rules as SceneDirector: a cut never
 * transitions, an unchanged look only transitions for "flash", the first section never does.
 */
export function offlineSceneFrame(project: Project, t: number, clock: SceneClock): OfflineSceneFrame {
  const state = trackStateAt(project, t);
  const look = resolveLook(project, state, t);
  const lyricLook = lyricLookAt(project, state, t, look);
  const current: SceneSlot = { target: targetOf(look), clock: clock.at(t) };
  let previous: SceneSlot | null = null;
  let transition: DirectorFrame["transition"] = null;
  let previousLook: StageLook | null = null;
  const idx = look.sectionIndex;
  const sections = project.plan?.sections ?? [];
  const kind = look.transitionIn;
  if (idx != null && idx > 0 && sections[idx] && kind !== "cut") {
    const start = sections[idx].start;
    const duration = TRANSITION_SECONDS[kind];
    const elapsed = t - start;
    if (elapsed >= 0 && elapsed < duration) {
      const prevLook = resolveLook(project, { ...state, sectionIndex: idx - 1 }, t);
      const programChanged = programModeKey(project.plan, prevLook.section, prevLook.sectionIndex) !== programModeKey(project.plan, look.section, look.sectionIndex);
      if (prevLook.lookKey !== look.lookKey || programChanged || kind === "flash") {
        const prevClock = clock.raw(start) + elapsed * clockRate(prevLook.params.speed, clock.energyAt(t));
        previous = { target: targetOf(prevLook), clock: ((prevClock % CLOCK_WRAP) + CLOCK_WRAP) % CLOCK_WRAP };
        previousLook = prevLook;
        transition = { kind, progress: elapsed / duration };
      }
    }
  }
  return { state, look, lyricLook, current, previous, transition, previousLook };
}

/** Beat index for the shaders' uBeatN: the analysis grid (live counts beats since the page opened). */
export function beatIndexAt(project: Project, t: number): number {
  return beatAt(project.analysis, t)?.index ?? 0;
}
