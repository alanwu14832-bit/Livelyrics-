import { describe, expect, it } from "vitest";
import { SCENE_CLOCK_STEP, beatIndexAt, buildSceneClock, offlineSceneFrame, trackStateAt } from "./offline";
import { TRANSITION_SECONDS, clockRate } from "./director";
import { section, testLyrics, testPlan } from "../console/test-fixtures";
import type { AudioAnalysis, Project } from "../types";

function analysis(duration: number): AudioAnalysis {
  const rate = 20;
  const n = Math.ceil(duration * rate);
  const energy = Array.from({ length: n }, (_, i) => (i / rate < 20 ? 0.2 : 0.9));
  return {
    duration,
    sampleRate: 44100,
    bpm: 120,
    bpmConfidence: 1,
    beats: Array.from({ length: duration * 2 }, (_, i) => i * 0.5),
    envelopeRate: rate,
    energy,
    onset: energy.map(() => 0.1),
    brightness: energy.map(() => 0.5),
    bass: energy.map(() => 0.3),
    peaks: [],
    sections: [],
  };
}

function project(): Project {
  return {
    id: "p1",
    meta: { title: "t", artist: "", duration: 40, fileName: "a.wav", mimeType: "audio/wav" },
    analysis: analysis(40),
    lyrics: testLyrics(),
    plan: testPlan([
      section("s0", 0, 8, { scene: "nebula", sceneParams: { speed: 0.2, density: 0.5, intensity: 0.5, audioReactivity: 0.5 } }),
      section("s1", 8, 24, { scene: "tunnel", transitionIn: "bloom", sceneParams: { speed: 0.9, density: 0.5, intensity: 0.5, audioReactivity: 0.5 } }),
      section("s2", 24, 40, { scene: "tunnel", transitionIn: "cut" }),
    ]),
    assets: [],
    // the designed transitions (LED 安全模式 off; the safe-mode frames are tested below)
    output: {
      width: 1920,
      height: 1080,
      preset: "1080p",
      lyricSafe: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
      safety: { enabled: false, preset: "led", brightness: 0.7, flashLimit: true, redProtect: true, soften: 0.25 },
    },
  } as unknown as Project;
}

describe("trackStateAt", () => {
  it("is the state the console publishes while the track plays", () => {
    const s = trackStateAt(project(), 9);
    expect(s).toMatchObject({ mode: "track", playing: true, lineIndex: 0, sectionIndex: 1 });
    expect(s.overrides.blackout).toBe(false);
    expect(trackStateAt(project(), 11.5).lineIndex).toBeNull();
  });
});

describe("deterministic scene clock", () => {
  it("is a pure function of song time", () => {
    const a = buildSceneClock(project());
    const b = buildSceneClock(project());
    for (const t of [0, 0.3, 7.99, 8, 12.345, 33.3]) expect(a.raw(t)).toBe(b.raw(t));
    // querying out of order changes nothing (no hidden state)
    const x = a.raw(30);
    a.raw(2);
    expect(a.raw(30)).toBe(x);
  });

  it("increases continuously at the section's speed", () => {
    const c = buildSceneClock(project());
    let prev = c.raw(0);
    for (let t = 0.01; t < 40; t += 0.01) {
      const v = c.raw(t);
      expect(v).toBeGreaterThan(prev);
      // continuous: no jump bigger than the fastest rate allows
      expect(v - prev).toBeLessThan(0.01 * clockRate(1, 1) + 1e-9);
      prev = v;
    }
    // faster section: the clock runs faster there
    const slow = c.raw(6) - c.raw(5);
    const fast = c.raw(12) - c.raw(11);
    expect(fast).toBeGreaterThan(slow * 3);
    // the rate follows clockRate(speed, smoothed energy)
    expect(c.raw(5 + SCENE_CLOCK_STEP) - c.raw(5)).toBeCloseTo(SCENE_CLOCK_STEP * clockRate(0.2, c.energyAt(5)), 6);
  });

  it("louder music speeds the clock up a little (smoothed energy)", () => {
    const c = buildSceneClock(project());
    expect(c.energyAt(19)).toBeCloseTo(0.2, 2);
    expect(c.energyAt(19.5)).toBeGreaterThan(0.2);
    expect(c.energyAt(19.5)).toBeLessThan(0.9);
    expect(c.energyAt(23)).toBeCloseTo(0.9, 2);
  });

  it("wraps like the live director", () => {
    const c = buildSceneClock(project());
    expect(c.at(10)).toBeGreaterThanOrEqual(0);
    expect(c.at(10)).toBeLessThan(3600);
  });
});

describe("offlineSceneFrame", () => {
  it("runs the section transition from the boundary by song time", () => {
    const p = project();
    const c = buildSceneClock(p);
    const d = TRANSITION_SECONDS.bloom;
    expect(offlineSceneFrame(p, 7.9, c).transition).toBeNull();
    const f = offlineSceneFrame(p, 8 + d / 2, c);
    expect(f.transition?.kind).toBe("bloom");
    expect(f.transition?.progress).toBeCloseTo(0.5, 9);
    expect(f.previous?.target.scene).toBe("nebula");
    expect(f.current.target.scene).toBe("tunnel");
    expect(offlineSceneFrame(p, 8 + d + 0.01, c).transition).toBeNull();
    // cut: never a transition
    expect(offlineSceneFrame(p, 24.1, c).transition).toBeNull();
    // the first section has nothing to come from
    expect(offlineSceneFrame(p, 0.1, c).transition).toBeNull();
  });

  it("gives the same frame however it is reached", () => {
    const p = project();
    const a = offlineSceneFrame(p, 8.4, buildSceneClock(p));
    offlineSceneFrame(p, 30, buildSceneClock(p));
    const b = offlineSceneFrame(p, 8.4, buildSceneClock(p));
    expect(b).toEqual(a);
  });

  it("uses the analysis beat grid for the beat index", () => {
    expect(beatIndexAt(project(), 10.2)).toBe(20);
  });
});

describe("offlineSceneFrame in LED 安全模式", () => {
  it("turns the bloom into a fade and clamps reactivity, like the live stage", () => {
    const p = project();
    const safe = { ...p, output: { ...p.output, safety: { ...p.output.safety, enabled: true } } } as Project;
    const c = buildSceneClock(safe);
    const f = offlineSceneFrame(safe, 8 + TRANSITION_SECONDS.fade / 2, c);
    expect(f.transition?.kind).toBe("fade");
    expect(f.current.target.params.reactivity).toBeLessThanOrEqual(0.5);
    // an old project file without the field is safe too
    const legacy = { ...p, output: { width: 1920, height: 1080, preset: "1080p", lyricSafe: p.output.lyricSafe } } as unknown as Project;
    expect(offlineSceneFrame(legacy, 8.3, buildSceneClock(legacy)).transition?.kind).toBe("fade");
  });
});
