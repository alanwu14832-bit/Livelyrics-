// Round 12 (m4): the section transition is a visible event — the director anchors it to the song
// clock, the compositor and the type pass share its geometry, each kind takes its own path, LED
// 安全模式's conversion holds, and a line's entrance follows its recipe instead of a plain fade.

import { describe, expect, it } from "vitest";
import { entersWithSection } from "@/components/stage/type/TypeLayer";
import { autoEnter } from "@/lib/type/compose";
import { TYPE_RECIPE_IDS, TYPE_VOICE_IDS } from "@/lib/schema";
import { SceneDirector, TRANSITION_SECONDS, type SceneTarget } from "./director";
import { safeTransition, SAFETY_OFF, type ActiveSafety } from "./safety";
import { COMPOSITE_FRAGMENT, TRANSITION_CODE, WIPE_GLSL } from "./scenes/composite";
import { TYPE_FRAGMENT, TYPE_UNIFORMS } from "./scenes/type";

const target = (scene: SceneTarget["scene"], key = scene): SceneTarget => ({ scene, params: { speed: 0.5, density: 0.5, intensity: 0.5, reactivity: 0.5 }, colorway: ["#000000", "#ffffff", "#ff0000"], lookKey: key });
const input = (t: SceneTarget, sectionKey: string, now: number, extra: Partial<Parameters<SceneDirector["update"]>[0]> = {}) => ({ target: t, sectionKey, transitionIn: "wipe" as const, now, dt: 1 / 60, frozen: false, energy: 0.5, ...extra });
const SAFE_ON: ActiveSafety = { on: true, brightness: 0.7, gain: 0.7, soften: 0.25, flashLimit: true, redProtect: true };

describe("each transitionIn takes its own path", () => {
  it("the compositor and the type pass share the codes, and every kind has a branch", () => {
    const codes = Object.values(TRANSITION_CODE);
    expect(new Set(codes).size).toBe(4);
    expect(codes.every((c) => c > 0)).toBe(true);
    // the compositor's branches, in code order: fade, flash, wipe, bloom
    for (const edge of ["uKind < 1.5", "uKind < 2.5", "uKind < 3.5"]) expect(COMPOSITE_FRAGMENT).toContain(edge);
    expect(COMPOSITE_FRAGMENT).toContain("wipeFront(uv, aspect, p)");
    // the type pass reads the same geometry (the words are revealed along the picture's edge)
    expect(TYPE_UNIFORMS).toContain("uTransition");
    expect(TYPE_UNIFORMS).toContain("uTransitionP");
    expect(TYPE_FRAGMENT).toContain(WIPE_GLSL);
    for (const edge of ["uTransition < 1.5", "uTransition < 2.5", "uTransition < 3.5"]) expect(TYPE_FRAGMENT).toContain(edge);
    expect(TYPE_FRAGMENT).toContain("wipeFront(uv, uRes.x / uRes.y, tp)");
  });

  it("LED 安全模式 turns flash and bloom into fades before any of this runs; a wipe and a cut stay", () => {
    expect(safeTransition("flash", SAFE_ON)).toBe("fade");
    expect(safeTransition("bloom", SAFE_ON)).toBe("fade");
    expect(safeTransition("wipe", SAFE_ON)).toBe("wipe");
    expect(safeTransition("cut", SAFE_ON)).toBe("cut");
    expect(safeTransition("flash", SAFETY_OFF)).toBe("flash");
    // the fade branch of the type pass adds no light: only the flash / bloom / wipe branches set tGlow
    const fadeBranch = TYPE_FRAGMENT.slice(TYPE_FRAGMENT.indexOf("if (uTransition < 1.5)"), TYPE_FRAGMENT.indexOf("} else if (uTransition < 2.5)"));
    expect(fadeBranch).not.toContain("tGlow");
  });
});

describe("the director follows the song clock", () => {
  it("anchors a section change to the time already elapsed since the boundary", () => {
    const d = new SceneDirector();
    d.update(input(target("nebula"), "s0", 0));
    // the first frame of s1 arrives 0.4 s into the section (a slow frame, a seek): the wipe is 0.4 s in
    const f = d.update(input(target("grid"), "s1", 1000, { anchor: 0.4 }));
    expect(f.transition?.kind).toBe("wipe");
    expect(f.transition?.progress).toBeCloseTo(0.4 / TRANSITION_SECONDS.wipe, 3);
    const later = d.update(input(target("grid"), "s1", 1000 + (TRANSITION_SECONDS.wipe - 0.4) * 1000 + 5, { anchor: TRANSITION_SECONDS.wipe + 0.005 }));
    expect(later.transition).toBeNull();
  });

  it("a stage that opens inside the window shows the transition from the previous section", () => {
    const d = new SceneDirector();
    expect(d.started).toBe(false);
    const f = d.update(input(target("grid"), "s1", 500, { anchor: 0.2, previousTarget: target("nebula") }));
    expect(d.started).toBe(true);
    expect(f.transition?.kind).toBe("wipe");
    expect(f.previous?.target.scene).toBe("nebula");
    expect(f.current.target.scene).toBe("grid");
    expect(f.transition?.progress).toBeCloseTo(0.2 / TRANSITION_SECONDS.wipe, 3);
    // a cut never synthesizes one; without an anchor the first frame is plain
    const c = new SceneDirector();
    expect(c.update(input(target("grid"), "s1", 500, { anchor: 0.2, previousTarget: target("nebula"), transitionIn: "cut" })).transition).toBeNull();
    const p = new SceneDirector();
    expect(p.update(input(target("grid"), "s1", 500, { previousTarget: target("nebula") })).transition).toBeNull();
  });

  it("an anchored transition holds its moment while the song is paused, and finishes on the song clock", () => {
    const d = new SceneDirector();
    d.update(input(target("nebula"), "s0", 0));
    d.update(input(target("grid"), "s1", 1000, { anchor: 0.3 }));
    // the wall clock runs on for 5 s, the song does not: the frame still shows 0.3 s into the wipe
    const held = d.update(input(target("grid"), "s1", 6000, { anchor: 0.3 }));
    expect(held.transition?.progress).toBeCloseTo(0.3 / TRANSITION_SECONDS.wipe, 3);
    const done = d.update(input(target("grid"), "s1", 6100, { anchor: TRANSITION_SECONDS.wipe + 0.01 }));
    expect(done.transition).toBeNull();
  });

  it("without an anchor (cues, live mode) the wall clock still drives it", () => {
    const d = new SceneDirector();
    d.update(input(target("nebula"), "s0", 0));
    const f = d.update(input(target("grid"), "s1", 100));
    expect(f.transition?.progress).toBeCloseTo(0, 3);
  });
});

describe("the words enter with the section", () => {
  const tr = { sectionStart: 24, seconds: TRANSITION_SECONDS.wipe };
  it("a timed line starting at the boundary takes the transition; a pickup from the previous section does not", () => {
    expect(entersWithSection({ enterAt: 24, cueAt: 0 }, tr, 0)).toBe(true);
    expect(entersWithSection({ enterAt: 23.8, cueAt: 0 }, tr, 0)).toBe(true);
    expect(entersWithSection({ enterAt: 24.5, cueAt: 0 }, tr, 0)).toBe(true);
    expect(entersWithSection({ enterAt: 21, cueAt: 0 }, tr, 0)).toBe(false);
    expect(entersWithSection({ enterAt: 26, cueAt: 0 }, tr, 0)).toBe(false);
  });
  it("a cued line takes it only when its cue fell inside the transition", () => {
    expect(entersWithSection({ enterAt: null, cueAt: 10_000 }, tr, 10_400)).toBe(true);
    expect(entersWithSection({ enterAt: null, cueAt: 10_000 }, tr, 12_000)).toBe(false);
  });
});

describe("a line's entrance follows its recipe", () => {
  it("mask wipes, rises, hard cuts on the beat, writes and blooms — a plain fade only for a whisper", () => {
    expect(autoEnter("mv-card", "giant-word", "still")).toBe("cut");
    expect(autoEnter("mv-card", "vertical-column", "still")).toBe("wipe");
    expect(autoEnter("title-sequence", "giant-word", "still")).toBe("scale");
    expect(autoEnter("title-sequence", "title-card", "still")).toBe("wipe");
    expect(autoEnter("title-sequence", "poster", "still")).toBe("wipe");
    expect(autoEnter("title-sequence", "grid-poem", "still")).toBe("rise");
    expect(autoEnter("mv-card", "window", "still")).toBe("bloom");
    expect(autoEnter("ink", "vertical-column", "still")).toBe("write");
    expect(autoEnter("ink", "brush-write", "still")).toBe("write");
    expect(autoEnter("glitch", "split", "still")).toBe("glitch");
    expect(autoEnter("mv-card", "scatter", "still")).toBe("fall");
    expect(autoEnter("mv-card", "whisper", "still")).toBe("fade");
    expect(autoEnter("mv-card", "whisper", "rise")).toBe("rise");
    // across every voice and recipe the plain fade is the exception, not the rule
    let fades = 0;
    let total = 0;
    for (const v of TYPE_VOICE_IDS) {
      for (const r of TYPE_RECIPE_IDS) {
        total++;
        if (autoEnter(v, r, "still") === "fade") fades++;
      }
    }
    expect(fades / total).toBeLessThan(0.15);
  });
});
