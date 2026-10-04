// Scene "director": decides which scene slot(s) to render and drives section
// transitions. Pure state machine (wall-clock ms in, render instructions out),
// so it is unit-testable and deterministic.

import type { SceneId } from "../types";
import type { SceneParams, TransitionKind } from "./resolve";

export interface SceneTarget {
  scene: SceneId;
  params: SceneParams;
  colorway: [string, string, string];
  lookKey: string;
  /**
   * 專屬畫面: the scene program's last values for this slot (the renderer's ProgramDraw); the
   * engine refreshes it every frame for the current slot, an outgoing slot keeps its last one
   */
  program?: unknown;
}

export interface SceneSlot {
  target: SceneTarget;
  /** speed-integrated scene clock in seconds (the shaders' `uTime`) */
  clock: number;
}

export type ActiveTransitionKind = Exclude<TransitionKind, "cut">;

export interface DirectorFrame {
  current: SceneSlot;
  /** outgoing slot while a transition runs */
  previous: SceneSlot | null;
  transition: { kind: ActiveTransitionKind; progress: number } | null;
}

export interface DirectorInput {
  target: SceneTarget;
  /** identifies the plan section (changes trigger `transitionIn`) */
  sectionKey: string | null;
  transitionIn: TransitionKind;
  /** wall clock, ms (performance.now()) */
  now: number;
  /** seconds since the previous update (already clamped by the caller) */
  dt: number;
  /** overrides.freeze: scene clocks stop, transitions still complete */
  frozen: boolean;
  /** 0..1 current musical energy (motion speeds up a little when loud) */
  energy: number;
  /** multiplies transition durations (stage-lab slow motion); default 1 */
  durationScale?: number;
  /**
   * Round 12: seconds of song time already elapsed since the section boundary this frame belongs
   * to (track playback). A section change then starts its transition that far in, so the
   * transition follows the song clock — a seek into the first second of a section, a frame capture
   * and the export all show the same moment of it. Null: the wall clock (cues, live mode).
   */
  anchor?: number | null;
  /**
   * The previous section's target, for a director that has no slot yet (the stage opened inside
   * the transition window): the outgoing slot is synthesized so the transition still shows.
   */
  previousTarget?: SceneTarget | null;
}

export const TRANSITION_SECONDS: Record<TransitionKind, number> = {
  cut: 0,
  fade: 1.0,
  flash: 0.8,
  wipe: 0.95,
  bloom: 1.35,
};

/** Operator-driven look changes (scene override, colour edits) use a short fade. */
export const OVERRIDE_FADE_SECONDS = 0.6;

/** Clocks wrap to keep float precision in the shaders. */
const CLOCK_WRAP = 3600;

/** Scene time advanced per wall-clock second for a given speed param and energy. */
export function clockRate(speed: number, energy: number): number {
  const s = Math.min(1, Math.max(0, speed));
  const e = Math.min(1, Math.max(0, energy));
  return (0.18 + 1.5 * Math.pow(s, 1.25)) * (0.85 + 0.35 * e);
}

function sameLookIgnoringParams(a: SceneTarget, b: SceneTarget): boolean {
  return a.scene === b.scene && a.colorway.join() === b.colorway.join();
}

export class SceneDirector {
  private current: SceneSlot | null = null;
  private previous: SceneSlot | null = null;
  private transition: { kind: ActiveTransitionKind; start: number; duration: number; anchored: boolean } | null = null;
  private sectionKey: string | null = null;

  constructor(private readonly initialClock = 0) {}

  reset(): void {
    this.current = null;
    this.previous = null;
    this.transition = null;
    this.sectionKey = null;
  }

  /** The director has rendered a slot (false before the first update). */
  get started(): boolean {
    return this.current != null;
  }

  update(input: DirectorInput): DirectorFrame {
    const { target, now } = input;
    const scale = input.durationScale && input.durationScale > 0 ? input.durationScale : 1;
    const anchorMs = input.anchor != null && Number.isFinite(input.anchor) && input.anchor >= 0 ? input.anchor * 1000 : 0;
    if (!this.current) {
      // opened inside a transition window: the previous section stands in as the outgoing slot
      const synth = !!input.previousTarget && input.anchor != null && input.transitionIn !== "cut" && input.sectionKey != null;
      this.current = { target: synth ? input.previousTarget! : target, clock: this.initialClock };
      this.sectionKey = synth ? `${input.sectionKey}:previous` : input.sectionKey;
    }
    {
      const sectionChanged = input.sectionKey !== this.sectionKey;
      const lookChanged = target.lookKey !== this.current.target.lookKey;
      this.sectionKey = input.sectionKey;
      if (sectionChanged) {
        const kind = input.transitionIn;
        if (kind === "cut") {
          this.previous = null;
          this.transition = null;
          this.current = { target, clock: this.current.clock };
        } else if (!lookChanged && kind !== "flash") {
          this.current.target = target;
        } else {
          this.begin(kind, TRANSITION_SECONDS[kind] * scale, target, now - anchorMs, input.anchor != null);
        }
      } else if (lookChanged) {
        if (sameLookIgnoringParams(target, this.current.target)) this.current.target = target;
        else this.begin("fade", OVERRIDE_FADE_SECONDS * scale, target, now);
      }
    }

    // advance clocks
    const dt = Number.isFinite(input.dt) ? Math.max(0, input.dt) : 0;
    if (!input.frozen && dt > 0) {
      this.current.clock = wrap(this.current.clock + dt * clockRate(this.current.target.params.speed, input.energy));
      if (this.previous) this.previous.clock = wrap(this.previous.clock + dt * clockRate(this.previous.target.params.speed, input.energy));
    }

    let transition: DirectorFrame["transition"] = null;
    if (this.transition && this.previous) {
      // an anchored transition follows the song clock (paused, it holds its moment like the export);
      // once the anchor is gone (a cue, live mode) the wall clock finishes it
      const p = this.transition.anchored && input.anchor != null && Number.isFinite(input.anchor) ? input.anchor / this.transition.duration : (now - this.transition.start) / (this.transition.duration * 1000);
      if (p >= 1 || !Number.isFinite(p)) {
        this.transition = null;
        this.previous = null;
      } else {
        transition = { kind: this.transition.kind, progress: Math.max(0, p) };
      }
    } else {
      this.transition = null;
      this.previous = null;
    }

    return { current: this.current, previous: this.previous, transition };
  }

  private begin(kind: ActiveTransitionKind, duration: number, target: SceneTarget, now: number, anchored = false) {
    const outgoing = this.current!;
    this.previous = { target: outgoing.target, clock: outgoing.clock };
    this.current = { target, clock: outgoing.clock };
    this.transition = { kind, start: now, duration: Math.max(0.05, duration), anchored };
  }
}

function wrap(x: number): number {
  return x >= CLOCK_WRAP ? x - CLOCK_WRAP : x;
}
