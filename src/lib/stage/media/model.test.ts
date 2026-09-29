import { describe, expect, it } from "vitest";
import { createDemoProject } from "../demo";
import type { Asset, DesignPlan } from "../../types";
import { beatAt, fitScale, framing, needsSeek, resolveMediaFrame, videoTimeAt } from "./model";

const IMG: Asset = { id: "aaaaaaaaaaaa", kind: "image", name: "封面", mimeType: "image/png", file: "aaaaaaaaaaaa.png", width: 1000, height: 1000, bytes: 1, createdAt: "" };
const CLIP: Asset = { ...IMG, id: "bbbbbbbbbbbb", kind: "video", mimeType: "video/mp4", file: "bbbbbbbbbbbb.mp4", duration: 10 };
const assets = new Map([IMG, CLIP].map((a) => [a.id, a]));

function planWithMedia(): DesignPlan {
  const plan = structuredClone(createDemoProject().plan!);
  plan.sections[1].media = { assetId: IMG.id, treatment: "duotone", fit: "cover", opacity: 0.8, blend: "normal" };
  plan.sections[2].media = { assetId: CLIP.id, treatment: "beat-cut", fit: "cover", opacity: 1, blend: "normal" };
  plan.sections[2].transitionIn = "fade";
  plan.sections[3].media = { assetId: "gonegonegone", treatment: "full", fit: "cover", opacity: 1, blend: "normal" };
  return plan;
}

describe("beatAt", () => {
  const analysis = { ...createDemoProject().analysis!, beats: [1, 1.5, 2, 2.5], bpm: 120 };
  it("finds the beat and its phase on the grid, and extends it past both ends", () => {
    expect(beatAt(analysis, 1.75)).toEqual({ index: 1, phase: 0.5, start: 1.5 });
    const after = beatAt(analysis, 3.25)!;
    expect(after.index).toBe(4);
    expect(after.start).toBeCloseTo(3);
    const before = beatAt(analysis, 0.2)!;
    expect(before.index).toBeLessThan(0);
    expect(before.phase).toBeGreaterThanOrEqual(0);
    expect(beatAt(null, 1)).toBeNull();
    expect(beatAt({ ...analysis, beats: [], bpm: 60 }, 2.5)).toEqual({ index: 2, phase: 0.5, start: 2 });
  });
});

describe("framing", () => {
  it("cover crops, contain letterboxes", () => {
    expect(fitScale(16 / 9, 1, "cover")).toEqual({ sx: 1, sy: 9 / 16 });
    expect(fitScale(16 / 9, 1, "contain")).toEqual({ sx: 16 / 9, sy: 1 });
    expect(fitScale(9 / 16, 1, "cover")).toEqual({ sx: 9 / 16, sy: 1 });
  });

  it("slow-drift zooms in over the section and stays inside the texture", () => {
    const at = (progress: number) => framing({ treatment: "slow-drift", fit: "cover", canvasAspect: 16 / 9, texAspect: 16 / 9, progress, beatIndex: 0, seed: 3 });
    const a = at(0);
    const b = at(1);
    expect(b.sx).toBeLessThan(a.sx);
    for (const f of [a, at(0.5), b]) {
      expect(Math.abs(f.ox)).toBeLessThanOrEqual((1 - f.sx) / 2 + 1e-9);
      expect(Math.abs(f.oy)).toBeLessThanOrEqual((1 - f.sy) / 2 + 1e-9);
    }
  });

  it("beat-cut changes the crop every beat, deterministically", () => {
    const f = (n: number) => framing({ treatment: "beat-cut", fit: "cover", canvasAspect: 16 / 9, texAspect: 16 / 9, progress: 0, beatIndex: n, seed: 9 });
    expect(f(1)).toEqual(f(1));
    expect(f(1)).not.toEqual(f(2));
    expect(f(4).sx).toBeGreaterThan(f(5).sx - 1e-9); // the downbeat pulls back to (nearly) the full frame
  });
});

describe("videos", () => {
  it("loops from the section start, and jumps on every beat for beat-cut", () => {
    expect(videoTimeAt({ treatment: "full", t: 27, sectionStart: 24, duration: 10, beat: null, seed: 1 })).toBeCloseTo(3);
    expect(videoTimeAt({ treatment: "slow-drift", t: 36, sectionStart: 24, duration: 10, beat: null, seed: 1 })).toBeCloseTo(2);
    const b1 = { index: 10, phase: 0.2, start: 30 };
    const b2 = { index: 11, phase: 0.2, start: 30.5 };
    const v1 = videoTimeAt({ treatment: "beat-cut", t: 30.1, sectionStart: 24, duration: 10, beat: b1, seed: 1 });
    const v1b = videoTimeAt({ treatment: "beat-cut", t: 30.3, sectionStart: 24, duration: 10, beat: b1, seed: 1 });
    const v2 = videoTimeAt({ treatment: "beat-cut", t: 30.6, sectionStart: 24, duration: 10, beat: b2, seed: 1 });
    expect(((v1b - v1 + 10) % 10)).toBeCloseTo(0.2);
    expect(Math.abs(v2 - v1)).toBeGreaterThan(0.2);
    for (const v of [v1, v1b, v2]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it("seeks only beyond ~80 ms of drift, wrap-aware", () => {
    expect(needsSeek(3.0, 3.05, 10)).toBe(false);
    expect(needsSeek(3.0, 3.2, 10)).toBe(true);
    expect(needsSeek(9.98, 0.01, 10)).toBe(false);
    expect(needsSeek(Number.NaN, 1, 10)).toBe(true);
  });
});

describe("resolveMediaFrame", () => {
  const plan = planWithMedia();
  const cw: [string, string, string] = ["#000000", "#ffffff", "#ff0000"];

  it("shows the section's media and ignores unknown assets", () => {
    const f = resolveMediaFrame(plan, assets, 1, 20, cw);
    expect(f.current?.asset.id).toBe(IMG.id);
    expect(f.current?.weight).toBe(1);
    expect(f.previous).toBeNull();
    const gone = resolveMediaFrame(plan, assets, 3, 47, cw);
    expect(gone.current).toBeNull();
    expect(resolveMediaFrame(null, assets, 1, 20, cw)).toEqual({ current: null, previous: null });
  });

  it("cross-fades from the previous section's media at a boundary (by song time)", () => {
    const start = plan.sections[2].start;
    const mid = resolveMediaFrame(plan, assets, 2, start + 0.5, cw);
    expect(mid.current?.asset.id).toBe(CLIP.id);
    expect(mid.previous?.asset.id).toBe(IMG.id);
    expect(mid.current!.weight + mid.previous!.weight).toBeCloseTo(1);
    const done = resolveMediaFrame(plan, assets, 2, start + 2, cw);
    expect(done.previous).toBeNull();
    expect(done.current?.weight).toBe(1);
    // leaving media for a section without any fades it out
    const out = resolveMediaFrame(plan, assets, 3, plan.sections[3].start + 0.3, cw);
    expect(out.current).toBeNull();
    expect(out.previous?.asset.id).toBe(CLIP.id);
    expect(out.previous!.weight).toBeGreaterThan(0);
  });

  it("cuts instantly when the section cuts in", () => {
    const p = planWithMedia();
    p.sections[2].transitionIn = "cut";
    const f = resolveMediaFrame(p, assets, 2, p.sections[2].start + 0.01, cw);
    expect(f.previous).toBeNull();
    expect(f.current?.weight).toBe(1);
  });
});
