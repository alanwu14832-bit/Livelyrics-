// Phase 7: typography composed with the scene — lines set inside the program's text zone, and the
// restraint rules (small-to-medium by default, large only for the song's few key lines).

import { describe, expect, it } from "vitest";
import { TYPE_RECIPE_IDS, TYPE_VOICE_IDS, type TypeRecipeId } from "../schema";
import { createDemoProject } from "../stage/demo";
import { EXAMPLE_PROGRAMS, instantiateExample } from "../stage/program/examples";
import { canvasZone } from "../stage/program/model";
import type { DesignPlan, LyricLine, TypeSystem, Zone } from "../types";
import { composeLine } from "./compose";
import { keyLineBudget, keyLineKeys } from "./key-lines";
import type { CanvasSpec, Composition, ResolvedHint } from "./model";
import { normalizeTypeSystem } from "./normalize";
import { composeProjectLine, prepareLineText } from "./prepare";
import { resolveLine, resolveSystem } from "./resolve";
import { approxMeasure } from "./text";

const SAFE = { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 };
const C169: CanvasSpec = { width: 1920, height: 1080, safe: SAFE };
const C916: CanvasSpec = { width: 1080, height: 1920, safe: SAFE };

function hint(recipe: TypeRecipeId, over: Partial<ResolvedHint> = {}): ResolvedHint {
  return { recipe, emphasis: [], orientation: "h", energy: 0.6, motionWord: "", seed: 7, dx: 0, dy: 0, scale: 1, rotate: 0, enter: "auto", exit: "auto", color: "ink", escalate: false, motion: null, ...over };
}

function compose(text: string, recipe: TypeRecipeId, canvas: CanvasSpec, zone: Zone | null, over: Partial<ResolvedHint> = {}, voice: (typeof TYPE_VOICE_IDS)[number] = "mv-card"): Composition {
  const lines: LyricLine[] = [{ id: "l0", text, start: 10, end: 14 }];
  const h = hint(recipe, over);
  const lt = prepareLineText(lines, 0, h.emphasis, 60)!;
  const { system } = normalizeTypeSystem({ voice }, { lines, sections: [], duration: 60, voice });
  return composeLine({ lt, lineId: "l0", hint: h, system: resolveSystem(system), canvas, ctx: { lineIndex: 0, lineCount: 1, sectionIndex: 0, sectionKind: "verse", sectionLabel: "", songTitle: "", first: false, zone }, measure: approxMeasure });
}

const TEXTS = ["夜色慢慢落在城市的邊緣", "我們把名字寫進風裡面", "Hey 跟著我唱", "直到天亮", "Tonight we sing until the morning light"];
const LEFT: Zone = { x: 0.07, y: 0.12, w: 0.42, h: 0.58 };
const RIGHT: Zone = { x: 0.52, y: 0.14, w: 0.41, h: 0.56 };

function inside(c: Composition, canvas: CanvasSpec, z: Zone, tol = 2) {
  const W = canvas.width;
  const H = canvas.height;
  const b = c.readBounds;
  return b.x >= z.x * W - tol && b.y >= z.y * H - tol && b.x + b.w <= (z.x + z.w) * W + tol && b.y + b.h <= (z.y + z.h) * H + tol;
}

describe("zone-constrained layout", () => {
  it("every recipe keeps the readable text inside the zone (16:9), restrained or not", () => {
    for (const recipe of TYPE_RECIPE_IDS) {
      for (const text of TEXTS) {
        for (const z of [LEFT, RIGHT]) {
          for (const key of [false, true]) {
            const c = compose(text, recipe, C169, z, { key, energy: key ? 0.85 : 0.45 });
            if (!c.pieces.length) continue;
            expect(inside(c, C169, z), `${recipe} ${key ? "key" : "body"} ${text} ${JSON.stringify(c.readBounds)}`).toBe(true);
          }
        }
      }
    }
  });

  it("on a tall canvas a side zone becomes a band and the text stays in it", () => {
    for (const recipe of TYPE_RECIPE_IDS) {
      for (const z of [LEFT, RIGHT]) {
        const c = compose(TEXTS[1], recipe, C916, z, { key: false, energy: 0.5 });
        if (!c.pieces.length) continue;
        const band = canvasZone(z, 9 / 16);
        expect(inside(c, C916, band), `${recipe} ${JSON.stringify(band)}`).toBe(true);
      }
    }
    // a left zone reads in the upper band, a right one in the lower
    const up = compose(TEXTS[0], "title-card", C916, LEFT, { key: false });
    const down = compose(TEXTS[0], "title-card", C916, RIGHT, { key: false });
    expect(up.readBounds.y + up.readBounds.h).toBeLessThan(C916.height / 2);
    expect(down.readBounds.y).toBeGreaterThan(C916.height / 2 - 1);
  });

  it("without a zone the layout is unchanged (plans without a program)", () => {
    const a = compose(TEXTS[0], "giant-word", C169, null);
    const lines: LyricLine[] = [{ id: "l0", text: TEXTS[0], start: 10, end: 14 }];
    const lt = prepareLineText(lines, 0, [], 60)!;
    const { system } = normalizeTypeSystem({ voice: "mv-card" }, { lines, sections: [], duration: 60, voice: "mv-card" });
    const b = composeLine({ lt, lineId: "l0", hint: hint("giant-word"), system: resolveSystem(system), canvas: C169, ctx: { lineIndex: 0, lineCount: 1, sectionIndex: 0, sectionKind: "verse", sectionLabel: "", songTitle: "", first: false }, measure: approxMeasure });
    expect(JSON.stringify(a.pieces)).toBe(JSON.stringify(b.pieces));
  });
});

describe("restraint", () => {
  const maxSize = (c: Composition) => Math.max(...c.pieces.flatMap((p) => p.glyphs.filter((g) => g.unit >= 0).map((g) => g.size)));

  it("a line that is not a key line never gets a display size far above the body", () => {
    for (const recipe of TYPE_RECIPE_IDS) {
      const body = compose(TEXTS[1], recipe, C169, null, { key: false, energy: 0.7 });
      const key = compose(TEXTS[1], recipe, C169, null, { key: true, energy: 0.7 });
      if (!body.pieces.length || !key.pieces.length) continue;
      // at most ~2.5 × the minimum readable size (a step above the body), and never larger than the key line
      expect(maxSize(body), recipe).toBeLessThanOrEqual(Math.max(body.minReadable * 3.2, 1080 * 0.2));
      expect(maxSize(body), recipe).toBeLessThanOrEqual(maxSize(key) + 1);
    }
  });

  it("bleed and window are reserved for key lines (restrained lines become 巨字＋小字)", () => {
    expect(compose(TEXTS[3], "bleed", C169, null, { key: false }).recipe).toBe("giant-word");
    expect(compose(TEXTS[3], "window", C169, null, { key: false }).recipe).toBe("giant-word");
    expect(compose(TEXTS[3], "bleed", C169, null, { key: true }).recipe).toBe("bleed");
    // a recipe the editor set is kept
    expect(compose(TEXTS[3], "bleed", C169, null, { key: false, recipeFixed: true }).recipe).toBe("bleed");
  });

  it("the key-line budget is small and chosen for meaning (the title line, the chorus hook)", () => {
    const p = createDemoProject();
    const lines = p.lyrics.lines;
    const { system } = normalizeTypeSystem({ voice: "mv-card" }, { lines, sections: p.plan!.sections, duration: p.meta.duration, voice: "mv-card" });
    const plan = { ...p.plan!, typeSystem: system };
    const keys = keyLineKeys(plan, lines, p.meta.duration, p.meta.title);
    const distinct = new Set(lines.map((l) => l.text)).size;
    expect(keys.size).toBeGreaterThanOrEqual(1);
    expect(keys.size).toBeLessThanOrEqual(keyLineBudget(distinct));
    const resolved = lines.map((_, i) => resolveLine(plan, lines, i, { duration: p.meta.duration, songTitle: p.meta.title })).filter((r) => r != null);
    const keyed = resolved.filter((r) => r!.hint.key).length;
    expect(keyed).toBeGreaterThan(0);
    expect(keyed / resolved.length).toBeLessThan(0.5);
    expect(keyBudgetOk(keyLineBudget)).toBe(true);
  });

  it("the editor can mark a line as a key line or take it away (TypeLineEdit.key)", () => {
    const p = createDemoProject();
    const lines = p.lyrics.lines;
    const { system } = normalizeTypeSystem({ voice: "mv-card" }, { lines, sections: p.plan!.sections, duration: p.meta.duration, voice: "mv-card" });
    const idx = lines.findIndex((l) => l.text.trim());
    const ts: TypeSystem = { ...system, lines: system.lines.map((l) => (l.lineId === lines[idx].id ? { ...l, edit: { key: true } } : l)) };
    const plan: DesignPlan & { typeSystem: TypeSystem } = { ...p.plan!, typeSystem: ts };
    expect(resolveLine(plan, lines, idx, { duration: p.meta.duration })!.hint.key).toBe(true);
  });
});

describe("the program's zones reach the type engine", () => {
  it("with an example program, every line of the demo song reads inside its section's zone", () => {
    const p = createDemoProject();
    const lines = p.lyrics.lines;
    const { system } = normalizeTypeSystem({ voice: "title-sequence" }, { lines, sections: p.plan!.sections, duration: p.meta.duration, voice: "title-sequence" });
    const program = instantiateExample(EXAMPLE_PROGRAMS[0], p.plan!);
    const plan = { ...p.plan!, typeSystem: system, sceneProgram: program };
    let checked = 0;
    for (const canvas of [C169, C916]) {
      lines.forEach((l, i) => {
        const r = composeProjectLine(plan, lines, i, canvas, approxMeasure, { duration: p.meta.duration, songTitle: p.meta.title });
        if (!r || !r.res.ctx.zone) return;
        const z = canvasZone(r.res.ctx.zone, canvas.width / canvas.height);
        expect(inside(r.comp, canvas, z, 3), `${l.text} ${canvas.width}x${canvas.height}`).toBe(true);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(10);
  });
});

function keyBudgetOk(f: (n: number) => number): boolean {
  return f(1) === 1 && f(10) === 1 && f(30) === 3 && f(200) === 3;
}
