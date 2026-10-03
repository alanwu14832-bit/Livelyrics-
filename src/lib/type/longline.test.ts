// B4 (round 10): the line-length policy. Long lines are split into two phrases at a sensible
// cut and set staggered; no column is taller than 70 % of the frame; nothing drawn leaves the
// lyric safe area.
import { describe, expect, it } from "vitest";
import { TYPE_RECIPE_IDS, type TypeRecipeId } from "../schema";
import { tokenizeLyric } from "../stage/lyrics/tokenize";
import type { LyricLine } from "../types";
import { composeLine } from "./compose";
import { glyphBox, pieceBox, type Box, type CanvasSpec, type Composition, type ResolvedHint } from "./model";
import { normalizeTypeSystem } from "./normalize";
import { prepareLineText } from "./prepare";
import { MAX_COLUMN_FRACTION } from "./recipes";
import { resolveSystem } from "./resolve";
import { approxMeasure, isLongLine, isLongUnits, lineLoad, LONG_LINE_CJK, splitLongLine } from "./text";

const SAFE = { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 };
const C169: CanvasSpec = { width: 1920, height: 1080, safe: SAFE };
const C916: CanvasSpec = { width: 1080, height: 1920, safe: SAFE };

// the audit's long-line song: 27 to 30 CJK characters per line, a comma in most, none in one
const LONG = [
  "我們曾經在午夜的高速公路上追逐一盞永遠不會熄滅的燈，以為那就是遠方",
  "後來才知道所有的遠方其實都只是另一個人的家門口，亮著等誰回來",
  "如果你還記得那一年夏天我們在加油站買的兩罐冰汽水，那就不要忘記我",
  "就算整個世界都睡著了，我們還醒著，在這條路上一直開一直開",
  "收音機裡那首歌唱到一半就斷了訊號，像我們沒有說完的所有的話",
  "就算整個世界都睡著了我們還醒著在這條路上一直開一直開",
  "I carried river stones in both my coat pockets so the wind would not take me",
];
const SHORT = ["夜色慢慢落在城市的邊緣", "直到天亮", "Hey 跟著我唱", "Tonight we sing until the morning light"];

function hint(recipe: TypeRecipeId, over: Partial<ResolvedHint> = {}): ResolvedHint {
  return { recipe, emphasis: [], orientation: "h", energy: 0.8, motionWord: "", seed: 11, dx: 0, dy: 0, scale: 1, rotate: 0, enter: "auto", exit: "auto", color: "auto", escalate: false, motion: null, key: true, ...over };
}

function compose(text: string, recipe: TypeRecipeId, canvas: CanvasSpec, over: Partial<ResolvedHint> = {}): Composition {
  const lines: LyricLine[] = [{ id: "l0", text, start: 10, end: 16 }];
  const h = hint(recipe, over);
  const lt = prepareLineText(lines, 0, h.emphasis, 60)!;
  const { system } = normalizeTypeSystem({ voice: "mv-card", ornaments: ["bracket", "number", "rule", "section"], params: { ornament: 0.8 } }, { lines, sections: [], duration: 60, voice: "mv-card" });
  return composeLine({ lt, lineId: "l0", hint: h, system: resolveSystem(system), canvas, ctx: { lineIndex: 2, lineCount: 10, sectionIndex: 2, sectionKind: "chorus", sectionLabel: "副歌一", songTitle: "午夜高速公路上那盞不會熄滅的燈", first: true }, measure: approxMeasure });
}

const safeBox = (c: CanvasSpec): Box => ({ x: c.width * SAFE.left, y: c.height * SAFE.top, w: c.width * (1 - SAFE.left - SAFE.right), h: c.height * (1 - SAFE.top - SAFE.bottom) });
const insideSafe = (comp: Composition, c: CanvasSpec) => {
  const s = safeBox(c);
  return comp.pieces.filter((p) => !p.bleed).every((p) => {
    const b = pieceBox(p);
    return b.w <= 0 || (b.x >= s.x - 1.5 && b.y >= s.y - 1.5 && b.x + b.w <= s.x + s.w + 1.5 && b.y + b.h <= s.y + s.h + 1.5);
  });
};
const tallestColumn = (comp: Composition) => {
  let h = 0;
  for (const p of comp.pieces) {
    if (!p.readable || !p.vertical) continue;
    // a column: glyphs sharing one x
    const byX = new Map<number, number[]>();
    for (const g of p.glyphs) {
      const k = Math.round(g.x);
      const b = glyphBox(g);
      byX.set(k, [...(byX.get(k) ?? []), b.y, b.y + b.h]);
    }
    for (const ys of byX.values()) h = Math.max(h, Math.max(...ys) - Math.min(...ys));
  }
  return h;
};

describe("the line-length policy (text.ts)", () => {
  it("knows a long line from a short one", () => {
    for (const t of LONG) expect(isLongLine(t), t).toBe(true);
    for (const t of SHORT) expect(isLongLine(t), t).toBe(false);
    expect(isLongLine("一二三四五六七八九十一二三四")).toBe(false);
    expect(isLongLine("一二三四五六七八九十一二三四五")).toBe(true);
    expect(lineLoad(tokenizeLyric("Hey 跟著我唱"))).toEqual({ cjk: 4, latin: 3 });
  });

  it("splits at the punctuation nearest the middle, each half a readable phrase", () => {
    const u = tokenizeLyric(LONG[3]);
    const cut = splitLongLine(u)!;
    expect(cut).not.toBeNull();
    const text = (r: [number, number]) => u.slice(r[0], r[1]).map((x) => x.text).join("");
    expect(text(cut[0])).toBe("就算整個世界都睡著了，我們還醒著");
    expect(text(cut[1])).toBe("在這條路上一直開一直開");
    const a = tokenizeLyric(LONG[0]);
    const ca = splitLongLine(a)!;
    expect(text.call(null, ca[0]).length).toBeGreaterThan(0);
    expect(a.slice(ca[1][0], ca[1][1]).map((x) => x.text).join("")).toBe("以為那就是遠方");
  });

  it("without punctuation it cuts after a particle or between words, never inside a compound, never a fragment", () => {
    const u = tokenizeLyric(LONG[5]);
    const cut = splitLongLine(u)!;
    expect(cut).not.toBeNull();
    const first = u.slice(cut[0][0], cut[0][1]).map((x) => x.text).join("");
    const second = u.slice(cut[1][0], cut[1][1]).map((x) => x.text).join("");
    expect(first + second).toBe(LONG[5]);
    expect(lineLoad(u.slice(cut[0][0], cut[0][1])).cjk).toBeGreaterThanOrEqual(6);
    expect(lineLoad(u.slice(cut[1][0], cut[1][1])).cjk).toBeGreaterThanOrEqual(6);
    // 世界, 醒著, 路上, 一直 stay whole
    for (const w of ["世界", "醒著", "路上", "一直"]) expect(first.endsWith(w[0]) && second.startsWith(w[1]), w).toBe(false);
    expect(lineLoad(u.slice(cut[0][0], cut[0][1])).cjk).toBeLessThanOrEqual(LONG_LINE_CJK + 2);
  });

  it("splits a long Latin line at a space near the middle, and leaves short lines alone", () => {
    const u = tokenizeLyric(LONG[6]);
    const cut = splitLongLine(u)!;
    expect(cut).not.toBeNull();
    expect(u[cut[0][1] - 1].kind).not.toBe("space");
    expect(u[cut[1][0]].kind).toBe("latin");
    for (const t of SHORT) expect(splitLongLine(tokenizeLyric(t))).toBeNull();
    expect(isLongUnits(tokenizeLyric(SHORT[0]))).toBe(false);
  });
});

describe("the line-length policy (compose.ts)", () => {
  it("a long line is set as two staggered phrases, whatever its recipe, on both canvases", () => {
    for (const text of LONG.slice(0, 6)) {
      for (const recipe of TYPE_RECIPE_IDS) {
        for (const [canvas, name] of [
          [C169, "16:9"],
          [C916, "9:16"],
        ] as const) {
          for (const orientation of ["h", "v"] as const) {
            const c = compose(text, recipe, canvas, { orientation });
            const main = c.pieces.filter((p) => p.readable && p.role !== "translation");
            expect(main.length, `${recipe} ${name} ${orientation} ${text}`).toBe(2);
            expect(c.pieces.some((p) => p.role === "giant" || p.window), `${recipe}: no display word on a long line`).toBe(false);
            // staggered: the second phrase starts lower (rows) or further left (columns) than the first
            const [a, b] = main.map(pieceBox);
            if (orientation === "v" && main[0].vertical) expect(b.x + b.w).toBeLessThanOrEqual(a.x + 1);
            else expect(b.y).toBeGreaterThan(a.y);
          }
        }
      }
    }
  });

  it("no column is taller than 70 % of the frame, for long lines and for every vertical recipe", () => {
    for (const text of [...LONG.slice(0, 6), ...SHORT.slice(0, 2)]) {
      for (const recipe of TYPE_RECIPE_IDS) {
        const c = compose(text, recipe, C169, { orientation: "v" });
        expect(tallestColumn(c), `${recipe} ${text}`).toBeLessThanOrEqual(1080 * MAX_COLUMN_FRACTION + 1);
        const t = compose(text, recipe, C916, { orientation: "v" });
        expect(tallestColumn(t), `${recipe} 9:16 ${text}`).toBeLessThanOrEqual(1920 * MAX_COLUMN_FRACTION + 1);
      }
    }
  });

  it("every glyph box and ornament stays inside the lyric safe area (the hard clamp)", () => {
    for (const text of [...LONG, ...SHORT]) {
      for (const recipe of TYPE_RECIPE_IDS) {
        for (const canvas of [C169, C916]) {
          for (const orientation of ["h", "v", "mixed"] as const) {
            for (const key of [true, false]) {
              const c = compose(text, recipe, canvas, { orientation, key });
              expect(insideSafe(c, canvas), `${recipe} ${canvas.width}x${canvas.height} ${orientation} ${key ? "key" : "body"} ${text}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("a Latin display word is never stood up sideways, even on a tall canvas (the 9:16 「Hey」)", () => {
    for (const recipe of ["window", "giant-word", "bleed"] as const) {
      for (const canvas of [C169, C916]) {
        for (const orientation of ["h", "v", "mixed"] as const) {
          const c = compose("Hey 跟著我唱", recipe, canvas, { orientation, emphasis: ["Hey"] });
          const hey = c.pieces.flatMap((p) => p.glyphs).filter((g) => g.ch === "Hey");
          expect(hey.length, `${recipe} ${canvas.width} ${orientation}`).toBeGreaterThan(0);
          for (const g of hey) expect(Math.abs(g.rotate), `${recipe} ${canvas.width} ${orientation}`).toBeLessThan(0.01);
        }
      }
    }
  });

  it("the section label on a Mandarin line is the plan's own, not English chrome", () => {
    const c = compose(SHORT[0], "giant-word", C169, { key: false });
    const labels = c.pieces.filter((p) => p.role === "label").flatMap((p) => p.glyphs.map((g) => g.ch));
    expect(labels.some((t) => /副歌一/.test(t))).toBe(true);
    expect(labels.some((t) => /CHORUS|VERSE/.test(t))).toBe(false);
  });
});
