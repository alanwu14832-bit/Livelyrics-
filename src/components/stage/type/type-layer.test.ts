// M6 / B3 (round 10): the type layer's pure rules — an incoming line waits for an outgoing one it
// would be drawn over, and the display words' box the type pass lights in full ink.
import { describe, expect, it } from "vitest";
import type { LyricLine } from "@/lib/types";
import { normalizeTypeSystem } from "@/lib/type/normalize";
import { composeProjectLine } from "@/lib/type/prepare";
import { approxMeasure } from "@/lib/type/text";
import { createDemoProject } from "@/lib/stage/demo";
import type { Composition } from "@/lib/type/model";
import { boundsOverlap, displayBox, entranceDelay } from "./TypeLayer";

const C169 = { width: 1920, height: 1080, safe: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 } };

function demoComps(): Composition[] {
  const p = createDemoProject();
  const lines: LyricLine[] = p.lyrics.lines;
  const { system } = normalizeTypeSystem({ voice: "mv-card" }, { lines, sections: p.plan!.sections, duration: p.meta.duration, voice: "mv-card" });
  const plan = { ...p.plan!, typeSystem: system };
  return lines.map((_, i) => composeProjectLine(plan, lines, i, C169, approxMeasure, { duration: p.meta.duration, songTitle: p.meta.title })?.comp).filter((c): c is Composition => !!c);
}

const fake = (bounds: { x: number; y: number; w: number; h: number }, exitDur = 0.5): Composition => ({ bounds, exitDur, pieces: [], readBounds: bounds }) as unknown as Composition;

describe("entrance delay (M6)", () => {
  it("an incoming line over the outgoing one waits for the rest of its exit, at most 0.6 s", () => {
    const leaving = fake({ x: 100, y: 100, w: 800, h: 400 }, 0.5);
    const over = fake({ x: 300, y: 200, w: 600, h: 300 });
    expect(entranceDelay(over, leaving, 0)).toBeCloseTo(0.5, 5);
    expect(entranceDelay(over, leaving, 0.3)).toBeCloseTo(0.2, 5);
    expect(entranceDelay(over, fake({ x: 100, y: 100, w: 800, h: 400 }, 2), 0)).toBe(0.6);
  });

  it("no wait for a cut exit, an exit nearly done, or a line elsewhere on the frame", () => {
    const leaving = fake({ x: 100, y: 100, w: 800, h: 400 }, 0.05);
    const over = fake({ x: 300, y: 200, w: 600, h: 300 });
    expect(entranceDelay(over, leaving, 0)).toBe(0);
    expect(entranceDelay(over, fake({ x: 100, y: 100, w: 800, h: 400 }, 0.5), 0.45)).toBe(0);
    const elsewhere = fake({ x: 1100, y: 100, w: 600, h: 300 });
    expect(boundsOverlap(elsewhere, leaving)).toBe(false);
    expect(entranceDelay(elsewhere, fake({ x: 100, y: 100, w: 800, h: 400 }, 0.5), 0)).toBe(0);
    // a touch is not an overlap
    expect(boundsOverlap(fake({ x: 0, y: 0, w: 100, h: 100 }), fake({ x: 98, y: 98, w: 100, h: 100 }))).toBe(false);
  });
});

describe("display box (B3)", () => {
  it("covers the giant and window pieces of a composition and nothing else", () => {
    const comps = demoComps();
    const withGiant = comps.filter((c) => c.pieces.some((p) => p.role === "giant" || p.window));
    expect(withGiant.length).toBeGreaterThan(0);
    for (const c of withGiant) {
      const b = displayBox([c])!;
      expect(b).not.toBeNull();
      for (const p of c.pieces) {
        if (p.role !== "giant" && !p.window) continue;
        for (const g of p.glyphs) {
          expect(g.x).toBeGreaterThanOrEqual(b.x - 1);
          expect(g.x).toBeLessThanOrEqual(b.x + b.w + 1);
        }
      }
    }
    const plain = comps.filter((c) => !c.pieces.some((p) => p.role === "giant" || p.window));
    for (const c of plain) expect(displayBox([c])).toBeNull();
  });
});
