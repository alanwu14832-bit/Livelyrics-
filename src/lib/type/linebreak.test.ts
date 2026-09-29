// Phase 7 review: CJK rows and featured words break between words, never inside one (開往, 潮汐之間),
// and never leave a one-character fragment of a phrase behind.

import { describe, expect, it } from "vitest";
import { offlineDesign } from "../server/designer";
import { SONG_FIXTURES, fixtureInput } from "../server/designer/testing/songs";
import { tokenizeLyric } from "../stage/lyrics/tokenize";
import type { CanvasSpec, Composition } from "./model";
import { composeProjectLine } from "./prepare";
import { approxMeasure, breakRows, keySpan, leavesFragment, lineText, splitsWord } from "./text";

const SAFE = { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 };
const CANVASES: CanvasSpec[] = [
  { width: 1920, height: 1080, safe: SAFE },
  { width: 1080, height: 1920, safe: SAFE },
];

const rowsOf = (text: string, max: number, maxRows = 3) => {
  const units = tokenizeLyric(text);
  return breakRows(units, 0, units.length, { max, maxRows, width: (idx) => idx.length }).map((r) => r.map((i) => units[i].text).join(""));
};

const lt = (text: string, emph?: string) => {
  const units = tokenizeLyric(text);
  const at = emph ? text.indexOf(emph) : -1;
  const flags = units.map((u) => at >= 0 && u.from >= at && u.to <= at + (emph?.length ?? 0));
  return lineText(text, units.map((u) => ({ ...u, t0: 0, t1: 0 })), flags);
};

describe("CJK breaks fall between words", () => {
  it("夜行巴士 開往海的方向: never 「開｜往」", () => {
    for (const max of [5, 5.3, 6, 7, 8]) {
      const rows = rowsOf("夜行巴士 開往海的方向", max);
      expect(rows.join("／"), `max ${max}`).not.toMatch(/開／往/);
      expect(rows.some((r) => r.length === 1), `max ${max}: ${rows.join("／")}`).toBe(false);
    }
    expect(rowsOf("夜行巴士 開往海的方向", 5.3, 2)).toEqual(["夜行巴士", "開往海的方向"]);
  });

  it("潮汐之間 我還在等: never 「潮汐之｜間」 (之 is bound to both sides)", () => {
    for (const max of [3, 4, 5, 6]) {
      const rows = rowsOf("潮汐之間 我還在等", max);
      expect(rows.join("／"), `max ${max}`).not.toMatch(/之／間|汐／之/);
    }
    expect(rowsOf("潮汐之間 我還在等", 4, 2)).toEqual(["潮汐之間", "我還在等"]);
  });

  it("the featured (giant) word is a whole word: 潮汐之間, not 潮汐之", () => {
    const t = lt("潮汐之間 我還在等", "潮汐之間");
    const k = keySpan(t, "", 3)!;
    expect(t.units.slice(k[0], k[1]).map((u) => u.text).join("")).toBe("潮汐之間");
    // a tighter limit cuts at the word boundary instead (潮汐), never inside 之間
    const k2 = keySpan(t, "", 2)!;
    expect(t.units.slice(k2[0], k2[1]).map((u) => u.text).join("")).toBe("潮汐");
    // without emphasis, the best pair is never half of a compound
    const t3 = lt("夜行巴士 開往海的方向");
    const k3 = keySpan(t3, "", 3)!;
    expect(["往海", "開往"].includes(t3.units.slice(k3[0], k3[1]).map((u) => u.text).join(""))).toBe(false);
  });

  it("the rules behind it: compounds and bound characters, one-character fragments", () => {
    const u = tokenizeLyric("夜行巴士 開往海的方向");
    const i = u.findIndex((x) => x.text === "開");
    expect(splitsWord(u, i)).toBe(true);
    expect(leavesFragment(u, i)).toBe(true);
    const v = tokenizeLyric("潮汐之間");
    expect(splitsWord(v, 1)).toBe(true);
    expect(splitsWord(v, 2)).toBe(true);
    expect(splitsWord(v, 0)).toBe(true);
  });
});

/** The row boundaries a composition sets: a|b pairs of characters that are adjacent in the text. */
function boundaries(c: Composition, text: string): string[] {
  const out: string[] = [];
  const flat = text.replace(/\s+/g, "");
  for (const p of c.pieces) {
    if (!p.readable || p.glyphs.length < 2) continue;
    const g = p.glyphs.filter((x) => x.unit >= 0);
    for (let k = 1; k < g.length; k++) {
      const a = g[k - 1];
      const b = g[k];
      const newRow = p.vertical ? Math.abs(a.x - b.x) > a.size * 0.5 : Math.abs(a.y - b.y) > a.size * 0.5;
      if (newRow && flat.includes(a.ch + b.ch)) out.push(a.ch + b.ch);
    }
  }
  // a piece that ends inside a word the next piece continues (the giant 潮汐之 + the small 間…)
  const readable = c.pieces.filter((p) => p.readable && p.glyphs.length);
  for (let k = 1; k < readable.length; k++) {
    const a = readable[k - 1].glyphs.filter((x) => x.unit >= 0).at(-1);
    const b = readable[k].glyphs.filter((x) => x.unit >= 0)[0];
    if (a && b && flat.includes(a.ch + b.ch)) out.push(a.ch + b.ch);
  }
  return out;
}

describe("the five song fixtures: no row or featured word tears a word", () => {
  it("every line, both canvases", () => {
    let checked = 0;
    for (const f of SONG_FIXTURES) {
      const input = fixtureInput(f);
      const designed = offlineDesign(input);
      const plan = { ...designed, typeSystem: designed.typeSystem! };
      const lines = input.lyrics.lines;
      lines.forEach((l, i) => {
        if (!/[一-鿿]/.test(l.text)) return;
        const units = tokenizeLyric(l.text);
        for (const canvas of CANVASES) {
          const r = composeProjectLine(plan, lines, i, canvas, approxMeasure, { duration: input.meta.duration, songTitle: input.meta.title });
          if (!r) continue;
          for (const pair of boundaries(r.comp, l.text)) {
            const at = units.findIndex((u, k) => u.text === pair[0] && units[k + 1]?.text === pair[1]);
            if (at < 0) continue;
            expect(splitsWord(units, at), `${f.id} ${canvas.width}: 「${l.text}」 breaks ${pair}`).toBe(false);
          }
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(60);
  });
});
