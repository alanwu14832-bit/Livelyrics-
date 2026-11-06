// Round 22 (m4 / m5): rows keep noun phrases and particles with their head — 「river stones」 and
// 「Midnight avenida」 stay together, no row starts with 上／裡／的／了／著／過, 「那一年夏天」 is one phrase.

import { describe, expect, it } from "vitest";
import { offlineDesign } from "../server/designer/offline";
import { AUDIT_SONGS, auditInput } from "../server/designer/testing/audit-songs";
import { tokenizeLyric } from "../stage/lyrics/tokenize";
import type { CanvasSpec, Composition } from "./model";
import { composeProjectLine } from "./prepare";
import { approxMeasure, breakRows, cutsMeasureFromHead, latinBreakCost, splitLongLine, startsOnLeaner } from "./text";

const latinWidth = (units: ReturnType<typeof tokenizeLyric>) => (idx: number[]) => idx.reduce((w, i) => w + (units[i].kind === "cjk" ? 1 : Math.max(0.3, units[i].text.length * 0.55)), 0);
const rowsOf = (text: string, max: number, maxRows = 3) => {
  const units = tokenizeLyric(text);
  return breakRows(units, 0, units.length, { max, maxRows, width: latinWidth(units) }).map((r) => r.map((i) => units[i].text).join("").trim());
};

const LEANERS = /^[上裡的了著過]/;

describe("round 22: Latin rows keep their phrases", () => {
  it("「I carried river stones in both my coat pockets」 never splits river / stones", () => {
    // (the widths a row can hold the phrase in: the composer sets the type smaller before it overflows)
    for (const max of [8, 10, 12, 14, 16]) {
      const rows = rowsOf("I carried river stones in both my coat pockets", max, 4);
      expect(rows.join(" / "), `max ${max}`).not.toMatch(/river \/ stones|coat \/ pockets/);
    }
    expect(rowsOf("I carried river stones in both my coat pockets", 14, 2)).toEqual(["I carried river stones", "in both my coat pockets"]);
  });

  it("「Midnight avenida, llévame contigo」 breaks at the comma, the name whole", () => {
    for (const max of [10, 12, 14]) {
      const rows = rowsOf("Midnight avenida, llévame contigo", max);
      expect(rows.join(" / "), `max ${max}`).not.toMatch(/Midnight \/ avenida/);
    }
    expect(rowsOf("Midnight avenida, llévame contigo", 10, 2)).toEqual(["Midnight avenida", "llévame contigo"]);
  });

  it("the cost table: comma free, before a preposition good, content words and names held", () => {
    const u = tokenizeLyric("Midnight Avenida, river stones in both");
    const at = (w: string) => u.findIndex((x) => x.text === w);
    expect(latinBreakCost(u, at("Avenida"))).toBeGreaterThan(latinBreakCost(u, at("stones"))!);
    expect(latinBreakCost(u, at("stones"))).toBeGreaterThan(0);
    expect(latinBreakCost(u, at("in"))).toBeLessThan(0);
    expect(latinBreakCost(u, at("river"))).toBeLessThan(latinBreakCost(u, at("in"))!);
  });
});

describe("round 22: CJK rows keep particles and measure words with their head", () => {
  it("「高速公路上」: no row starts with 上", () => {
    const text = "我們曾經在午夜的高速公路上追逐一盞永遠不會熄滅的燈";
    for (const max of [5, 6, 7, 8, 9, 10, 12]) {
      const rows = rowsOf(text, max);
      for (const r of rows.slice(1)) expect(r, `max ${max}: ${rows.join("／")}`).not.toMatch(LEANERS);
    }
    const u = tokenizeLyric("高速公路上追逐");
    expect(startsOnLeaner(u, 3)).toBe(true);
    // 過去 begins a word of its own: a row may start with it
    const v = tokenizeLyric("回不去 過去的夏天");
    expect(startsOnLeaner(v, v.findIndex((x) => x.text === "過") - 1)).toBe(false);
  });

  it("「那一年夏天」 stays one phrase", () => {
    const text = "如果你還記得那一年夏天我們在加油站買的兩罐冰汽水";
    for (const max of [6, 7, 8, 9, 10, 12]) {
      const rows = rowsOf(text, max);
      expect(rows.join("／"), `max ${max}`).not.toMatch(/那一年／夏天|一年／夏天/);
      for (const r of rows.slice(1)) expect(r, `max ${max}: ${rows.join("／")}`).not.toMatch(LEANERS);
    }
    const u = tokenizeLyric("那一年夏天");
    expect(cutsMeasureFromHead(u, 2)).toBe(true);
  });

  it("the long lines' phrase cuts never start on a leaner", () => {
    for (const text of ["我們曾經在午夜的高速公路上追逐一盞永遠不會熄滅的燈，以為那就是遠方", "如果你還記得那一年夏天我們在加油站買的兩罐冰汽水，那就不要忘記我", "收音機裡那首歌唱到一半就斷了訊號，像我們沒有說完的所有的話"]) {
      const u = tokenizeLyric(text);
      const cut = splitLongLine(u);
      expect(cut, text).not.toBeNull();
      const second = u.slice(cut![1][0], cut![1][1]).map((x) => x.text).join("");
      expect(second, text).not.toMatch(LEANERS);
    }
  });
});

// through the real compositions of the audit songs (every recipe the plan chose, 16:9 and 9:16)
const SAFE = { top: 0.05, right: 0.05, bottom: 0.08, left: 0.05 };
const CANVASES: CanvasSpec[] = [
  { width: 1920, height: 1080, safe: SAFE },
  { width: 1080, height: 1920, safe: SAFE },
];

/** The rows of a composition's readable text, top to bottom, left to right (horizontal pieces only). */
function rowsOfComp(c: Composition): string[] {
  const glyphs = c.pieces.filter((p) => p.readable && !p.vertical && !p.echo).flatMap((p) => p.glyphs);
  const rows = new Map<number, typeof glyphs>();
  for (const g of glyphs) {
    const key = [...rows.keys()].find((y) => Math.abs(y - g.y) < g.h * 0.4) ?? g.y;
    rows.set(key, [...(rows.get(key) ?? []), g]);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, gs]) => gs.sort((a, b) => a.x - b.x).map((g) => g.ch).join(" ").replace(/\s+/g, " "));
}

describe("round 22: the audit songs' lines on the wall", () => {
  for (const key of ["folk", "citypop", "longlines"]) {
    it(`${key}: no row breaks a name, an adjective + noun, or starts with a leaner`, () => {
      const input = auditInput(AUDIT_SONGS.find((s) => s.key === key)!);
      const plan = offlineDesign(input);
      const lines = input.lyrics.lines;
      for (const canvas of CANVASES) {
        lines.forEach((l, i) => {
          const r = composeProjectLine({ ...plan, typeSystem: plan.typeSystem! }, lines, i, canvas, approxMeasure, { duration: input.meta.duration });
          if (!r) return;
          const rows = rowsOfComp(r.comp);
          const joined = rows.join(" / ");
          expect(joined, `${l.text}`).not.toMatch(/river \/ stones|Midnight \/ avenida|MIDNIGHT \/ AVENIDA/i);
          for (const row of rows.slice(1)) expect(row.replace(/\s/g, ""), `${canvas.width} 「${l.text}」: ${joined}`).not.toMatch(LEANERS);
          expect(joined.replace(/\s/g, ""), l.text).not.toMatch(/那一年\/夏天/);
        });
      }
    });
  }
});
