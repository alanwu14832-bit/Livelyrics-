import { describe, expect, it } from "vitest";
import { SceneDirector, TRANSITION_SECONDS, clockRate, type SceneTarget } from "./director";
import { AudioFeatureMixer, follow, rawFeatures } from "./features";
import { initialStageState } from "./protocol";
import type { AudioAnalysis } from "../types";

const target = (scene: SceneTarget["scene"], color = "#000000", speed = 0.5): SceneTarget => ({
  scene,
  params: { speed, density: 0.5, intensity: 0.5, reactivity: 0.5 },
  colorway: [color, "#ffffff", "#ff0000"],
  lookKey: `${scene}|${color}|${speed}`,
});

const input = (t: SceneTarget, sectionKey: string, now: number, extra: Partial<Parameters<SceneDirector["update"]>[0]> = {}) => ({
  target: t,
  sectionKey,
  transitionIn: "fade" as const,
  now,
  dt: 1 / 60,
  frozen: false,
  energy: 0.5,
  ...extra,
});

describe("SceneDirector", () => {
  it("starts without a transition", () => {
    const d = new SceneDirector();
    const f = d.update(input(target("nebula"), "s0", 0));
    expect(f.transition).toBeNull();
    expect(f.current.target.scene).toBe("nebula");
  });

  it("runs the section's transition and finishes it", () => {
    const d = new SceneDirector();
    d.update(input(target("nebula"), "s0", 0));
    const f = d.update(input(target("grid"), "s1", 100, { transitionIn: "wipe" }));
    expect(f.transition?.kind).toBe("wipe");
    expect(f.previous?.target.scene).toBe("nebula");
    const mid = d.update(input(target("grid"), "s1", 100 + TRANSITION_SECONDS.wipe * 500, { transitionIn: "wipe" }));
    expect(mid.transition?.progress).toBeCloseTo(0.5, 2);
    const end = d.update(input(target("grid"), "s1", 100 + TRANSITION_SECONDS.wipe * 1000 + 1, { transitionIn: "wipe" }));
    expect(end.transition).toBeNull();
    expect(end.previous).toBeNull();
  });

  it("cuts immediately", () => {
    const d = new SceneDirector();
    d.update(input(target("nebula"), "s0", 0));
    const f = d.update(input(target("tunnel"), "s1", 10, { transitionIn: "cut" }));
    expect(f.transition).toBeNull();
    expect(f.current.target.scene).toBe("tunnel");
  });

  it("skips invisible transitions but keeps flashes", () => {
    const d = new SceneDirector();
    d.update(input(target("nebula"), "s0", 0));
    expect(d.update(input(target("nebula"), "s1", 10)).transition).toBeNull();
    expect(d.update(input(target("nebula"), "s2", 20, { transitionIn: "flash" })).transition?.kind).toBe("flash");
  });

  it("fades quickly on operator overrides within a section", () => {
    const d = new SceneDirector();
    d.update(input(target("nebula"), "s0", 0));
    const f = d.update(input(target("rain"), "s0", 10));
    expect(f.transition?.kind).toBe("fade");
    // param-only changes apply in place
    const d2 = new SceneDirector();
    d2.update(input(target("nebula", "#000000", 0.2), "s0", 0));
    expect(d2.update(input(target("nebula", "#000000", 0.9), "s0", 10)).transition).toBeNull();
  });

  it("stops clocks when frozen and keeps clock continuity across transitions", () => {
    const d = new SceneDirector();
    const a = d.update(input(target("nebula"), "s0", 0, { dt: 1 }));
    const c1 = a.current.clock;
    expect(c1).toBeCloseTo(clockRate(0.5, 0.5));
    const frozen = d.update(input(target("nebula"), "s0", 16, { dt: 1, frozen: true }));
    expect(frozen.current.clock).toBe(c1);
    const next = d.update(input(target("grid"), "s1", 32, { dt: 0 }));
    expect(next.current.clock).toBe(c1);
  });
});

const analysis: AudioAnalysis = {
  duration: 10,
  sampleRate: 44100,
  bpm: 120,
  bpmConfidence: 1,
  beats: Array.from({ length: 20 }, (_, i) => i * 0.5),
  envelopeRate: 10,
  energy: Array.from({ length: 100 }, (_, i) => (i < 50 ? 0.2 : 0.9)),
  onset: new Array(100).fill(0.1),
  brightness: new Array(100).fill(0.5),
  bass: new Array(100).fill(0.3),
  peaks: [],
  sections: [],
};

describe("features", () => {
  it("follows with attack/release", () => {
    expect(follow(0, 1, 0, 0.1, 0.1)).toBe(0);
    expect(follow(0, 1, 10, 0.1, 0.1)).toBeCloseTo(1);
    expect(follow(1, 0, 0.1, 0.01, 1)).toBeGreaterThan(0.85);
  });

  it("blends analysis with live features by mode", () => {
    const s = initialStageState("x");
    const track = rawFeatures(analysis, { ...s, audio: { level: 0.5, bass: 0, onset: 0, beatPhase: 0.2 } }, 7);
    expect(track.energy).toBeCloseTo(0.9);
    expect(track.beat).toBeCloseTo(0, 5); // on the analysis beat grid at t=7
    const live = rawFeatures(analysis, { ...s, mode: "live", audio: { level: 0.5, bass: 0, onset: 0, beatPhase: 0.2 } }, 1);
    expect(live.energy).toBeCloseTo(0.5);
    expect(live.beat).toBeCloseTo(0.2);
    const none = rawFeatures(null, s, 3);
    expect(none.energy).toBeGreaterThan(0);
  });

  it("follows the band's MIDI clock over the analysis grid, in TRACK too (phase 5a)", () => {
    const s = initialStageState("x");
    const track = rawFeatures(analysis, { ...s, audio: { level: 0.5, bass: 0, onset: 0, beatPhase: 0.2, clock: true } }, 7);
    expect(track.beat).toBeCloseTo(0.2);
    // without the flag (older consoles, the export) the grid stays
    expect(rawFeatures(analysis, { ...s, audio: { level: 0.5, bass: 0, onset: 0, beatPhase: 0.2 } }, 7).beat).toBeCloseTo(0, 5);
  });

  it("produces a beat pulse only while playing", () => {
    const m = new AudioFeatureMixer();
    const playing = { ...initialStageState("x"), playing: true };
    let f = m.update(analysis, playing, 6.0, 1 / 60);
    for (let i = 0; i < 30; i++) f = m.update(analysis, playing, 6.0, 1 / 60);
    expect(f.pulse).toBeGreaterThan(0.3);
    const paused = { ...playing, playing: false };
    for (let i = 0; i < 120; i++) f = m.update(analysis, paused, 6.4, 1 / 60);
    expect(f.pulse).toBeLessThan(0.3);
  });
});
