import { describe, expect, it } from "vitest";
import { TYPE_RECIPE_IDS, TYPE_VOICE_IDS, type TypeRecipeId } from "../schema";
import { createDemoProject } from "../stage/demo";
import type { DesignPlan, LyricLine, TypeSystem } from "../types";
import { composeLine } from "./compose";
import { makeFrame } from "./frame";
import { glyphBox, type CanvasSpec, type Composition, type ResolvedHint } from "./model";
import { normalizeTypeSystem } from "./normalize";
import { composeProjectLine, prepareLineText } from "./prepare";
import { resolveSystem } from "./resolve";
import { approxMeasure, breakRows, verticalForm } from "./text";
import { tokenizeLyric } from "../stage/lyrics/tokenize";
import { VOICES } from "./vocab";

const SAFE = { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 };
const CANVASES: Record<string, CanvasSpec> = {
  "16:9": { width: 1920, height: 1080, safe: SAFE },
  "32:9": { width: 3840, height: 1080, safe: SAFE },
  "9:16": { width: 1080, height: 1920, safe: SAFE },
};

function demo(voice: (typeof TYPE_VOICE_IDS)[number] = "mv-card"): { plan: DesignPlan & { typeSystem: TypeSystem }; lines: LyricLine[]; duration: number } {
  const p = createDemoProject();
  const plan = p.plan!;
  const lines = p.lyrics.lines;
  const duration = p.meta.duration;
  const { system } = normalizeTypeSystem({ voice }, { lines, sections: plan.sections, duration, voice });
  return { plan: { ...plan, typeSystem: system }, lines, duration };
}

function hint(recipe: TypeRecipeId, over: Partial<ResolvedHint> = {}): ResolvedHint {
  return { recipe, emphasis: [], orientation: "h", energy: 0.6, motionWord: "", seed: 7, dx: 0, dy: 0, scale: 1, rotate: 0, enter: "auto", exit: "auto", color: "ink", escalate: false, motion: null, ...over };
}

function compose(text: string, recipe: TypeRecipeId, canvas: CanvasSpec, over: Partial<ResolvedHint> = {}, voice: (typeof TYPE_VOICE_IDS)[number] = "mv-card", translation?: string): Composition {
  const lines: LyricLine[] = [{ id: "l0", text, start: 10, end: 14, ...(translation ? { translation } : {}) }];
  const h = hint(recipe, over);
  const lt = prepareLineText(lines, 0, h.emphasis, 60)!;
  const { system } = normalizeTypeSystem({ voice }, { lines, sections: [], duration: 60, voice });
  return composeLine({ lt, lineId: "l0", hint: h, system: resolveSystem(system), canvas, ctx: { lineIndex: 0, lineCount: 1, sectionIndex: null, sectionKind: "chorus", sectionLabel: "", songTitle: "示範之歌", first: true }, measure: approxMeasure });
}

const TEXTS = ["夜色慢慢落在城市的邊緣", "我們把名字寫進風裡面", "Hey 跟著我唱", "直到天亮", "就算世界再大再遠，我們的歌會找到方向", "Tonight we sing until the morning light"];

describe("type engine: layout", () => {
  it("is deterministic: the same seed and canvas give the same geometry", () => {
    for (const recipe of TYPE_RECIPE_IDS) {
      const a = compose(TEXTS[0], recipe, CANVASES["16:9"], { seed: 42, orientation: "mixed" });
      const b = compose(TEXTS[0], recipe, CANVASES["16:9"], { seed: 42, orientation: "mixed" });
      expect(JSON.stringify(a.pieces)).toBe(JSON.stringify(b.pieces));
      expect(a.key).toBe(b.key);
    }
  });

  it("a different seed can move the composition (another zone)", () => {
    const a = compose(TEXTS[1], "vertical-column", CANVASES["16:9"], { seed: 1 });
    const keys = new Set<string>();
    for (let s = 0; s < 12; s++) keys.add(JSON.stringify(compose(TEXTS[1], "vertical-column", CANVASES["16:9"], { seed: s }).readBounds));
    expect(keys.size).toBeGreaterThan(1);
    expect(a.pieces.length).toBeGreaterThan(0);
  });

  for (const [name, canvas] of Object.entries(CANVASES)) {
    it(`every recipe fits ${name}: readable text inside the readable area, glyphs at or above the minimum`, () => {
      const frame = makeFrame(canvas, VOICES["mv-card"].params);
      for (const recipe of TYPE_RECIPE_IDS) {
        for (const text of TEXTS) {
          for (const orientation of ["h", "v", "mixed"] as const) {
            for (const seed of [3, 77, 512]) {
              const c = compose(text, recipe, canvas, { orientation, seed, energy: seed % 2 ? 0.8 : 0.35 }, "mv-card", seed === 77 ? "Our song will find its way" : undefined);
              const readable = c.pieces.filter((p) => p.readable);
              expect(readable.length, `${recipe} ${text}`).toBeGreaterThan(0);
              for (const p of readable) {
                for (const g of p.glyphs) {
                  const b = glyphBox(g);
                  const tol = 2;
                  expect(b.x, `${recipe}/${orientation}/${seed} "${text}" x`).toBeGreaterThanOrEqual(frame.safe.x - tol);
                  expect(b.x + b.w, `${recipe}/${orientation}/${seed} "${text}" right`).toBeLessThanOrEqual(frame.safe.x + frame.safe.w + tol);
                  expect(b.y, `${recipe}/${orientation}/${seed} "${text}" top`).toBeGreaterThanOrEqual(frame.safe.y - tol);
                  expect(b.y + b.h, `${recipe}/${orientation}/${seed} "${text}" bottom`).toBeLessThanOrEqual(frame.read.y + frame.read.h + tol);
                  if (g.unit >= 0 && p.role !== "translation") expect(g.size, `${recipe} size`).toBeGreaterThanOrEqual(frame.minRead - 0.5);
                }
              }
              // every sung unit appears exactly once in the readable text (the line reads whole)
              const shown = readable.filter((p) => p.role !== "translation").flatMap((p) => p.glyphs.filter((g) => g.unit >= 0).map((g) => g.unit));
              const expected = tokenizeLyric(text)
                .map((u, i) => ({ u, i }))
                .filter(({ u }) => u.kind === "cjk" || u.kind === "latin")
                .map(({ i }) => i);
              for (const i of expected) expect(shown.filter((x) => x === i).length, `${recipe} unit ${i} of "${text}"`).toBe(1);
            }
          }
        }
      }
    });
  }

  it("reading order runs through the line: glyph order follows the text", () => {
    for (const recipe of TYPE_RECIPE_IDS) {
      const c = compose(TEXTS[0], recipe, CANVASES["16:9"], { orientation: "mixed" });
      const glyphs = c.pieces.filter((p) => p.readable && p.role !== "translation").flatMap((p) => p.glyphs).filter((g) => g.unit >= 0);
      const byOrder = [...glyphs].sort((a, b) => a.order - b.order).map((g) => g.unit);
      expect(byOrder, recipe).toEqual([...byOrder].sort((a, b) => a - b));
    }
  });
});

describe("type engine: CJK rules", () => {
  it("vertical text rotates brackets, dashes and Latin, keeps CJK and short numbers upright", () => {
    const units = tokenizeLyric("「夜」—Hey 12…");
    const forms = units.map((u) => [u.text, verticalForm(u).rotate !== 0]);
    expect(forms).toEqual([
      ["「", true],
      ["夜", false],
      ["」", true],
      ["—", true],
      ["Hey", true],
      [" ", false],
      ["12", false],
      ["…", true],
    ]);
  });

  it("禁則: no row starts with closing punctuation or ends with opening punctuation, soft punctuation dropped at row ends", () => {
    const text = "我們「一起」唱，直到天亮。再見！好嗎？";
    const units = tokenizeLyric(text);
    const rows = breakRows(units, 0, units.length, { max: 4, maxRows: 6, width: (idx) => idx.length });
    for (const row of rows) {
      const first = units[row[0]].text;
      const last = units[row[row.length - 1]].text;
      expect("，。」』）！？、").not.toContain(first);
      expect("「『（").not.toContain(last);
      expect("，、。").not.toContain(last);
    }
    expect(rows.flat().map((i) => units[i].text).join("")).toBe("我們「一起」唱直到天亮再見！好嗎？");
  });

  it("no orphan: a row of a single character is avoided when the text can balance", () => {
    const units = tokenizeLyric("夜色慢慢落在城市的邊緣");
    const rows = breakRows(units, 0, units.length, { max: 6, maxRows: 3, width: (idx) => idx.length });
    expect(rows.every((r) => r.length >= 2)).toBe(true);
  });

  it("Latin-only lines are never set vertically", () => {
    for (const recipe of ["vertical-column", "brush-write", "cross", "giant-word"] as const) {
      const c = compose("Tonight we sing", recipe, CANVASES["16:9"], { orientation: "v" });
      expect(c.pieces.some((p) => p.readable && p.vertical), recipe).toBe(false);
    }
  });
});

describe("type engine: the demo song", () => {
  it("composes every line of every voice on every canvas", () => {
    for (const voice of TYPE_VOICE_IDS) {
      const { plan, lines, duration } = demo(voice);
      for (const canvas of Object.values(CANVASES)) {
        lines.forEach((_, i) => {
          const r = composeProjectLine(plan, lines, i, canvas, approxMeasure, { duration, songTitle: "示範之歌" });
          expect(r, `${voice} line ${i}`).not.toBeNull();
          expect(r!.comp.minReadable).toBeGreaterThanOrEqual(makeFrame(canvas, plan.typeSystem.params).minRead - 0.5);
        });
      }
    }
  });
});
