// Phase 7 review: CJK rows and featured words break between words, never inside one (開往, 潮汐之間),
// and never leave a one-character fragment of a phrase behind.

import { describe, expect, it } from "vitest";
import { offlineDesign } from "../server/designer";
import { SONG_FIXTURES, fixtureInput } from "../server/designer/testing/songs";
import { tokenizeLyric } from "../stage/lyrics/tokenize";
import type { CanvasSpec, Composition } from "./model";
import { composeProjectLine } from "./prepare";
import { TYPE_RECIPE_IDS } from "../schema";
import { approxMeasure, breakRows, keySpan, leavesFragment, lineText, splitLongLine, splitsWord } from "./text";

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

// Round 17 (M4): the round-16 audit's torn lines — words the lexicon did not list (睡著了, 其實, 血滴),
// a motion word cut from its word (醒｜來), a phrase left as a fragment (我不要 我｜不要), and English
// rows ending on a function word (light hums a / song it). Intl.Segmenter (ICU) finds the words.
describe("round 17: Intl.Segmenter word boundaries", () => {
  const torn: Array<[string, RegExp]> = [
    ["就算整個世界都睡著了，我們還醒著", /睡／著/],
    ["後來才知道所有的遠方其實都只是另一個人的家門口", /其／實/],
    ["刀片劃過手腕 我數著血滴", /血／滴/],
    ["我不想再醒來", /醒／來/],
    ["把藥全部吞下去", /全／部/],
  ];

  it("rows never break inside those words, at any width", () => {
    for (const [text, bad] of torn) {
      for (const max of [3, 4, 5, 6, 7, 8, 9, 10, 12]) {
        const rows = rowsOf(text, max, 3);
        expect(rows.join("／"), `${text} @${max}`).not.toMatch(bad);
      }
    }
  });

  it("the featured word is a whole word: 「醒來」 not 「醒」, 「我不要」 not 「我不要 我」+「不要」", () => {
    const wake = lt("我不想再醒來");
    const k = keySpan(wake, "醒", 3)!;
    expect(wake.units.slice(k[0], k[1]).map((u) => u.text).join("")).toBe("醒來");
    const emph = lt("我不想再醒來", "醒");
    const ke = keySpan(emph, "", 3)!;
    expect(emph.units.slice(ke[0], ke[1]).map((u) => u.text).join("")).toBe("醒來");
    const no = lt("我不要 我不要");
    const kn = keySpan(no, "", 3)!;
    expect(no.units.slice(kn[0], kn[1]).map((u) => u.text).join("")).toBe("我不要");
  });

  it("every recipe sets those lines without tearing a word (rows and pieces)", () => {
    for (const text of [...torn.map(([t]) => t), "我不要 我不要"]) {
      const lines = [{ id: "l0", text, start: 10, end: 14 }];
      const units = tokenizeLyric(text);
      // (散字 throws single characters around on purpose: its glyphs are not rows)
      for (const recipe of TYPE_RECIPE_IDS.filter((id) => id !== "scatter")) {
        for (const voice of ["mv-card", "glitch"] as const) {
          const plan = { ...offlineDesign(fixtureInput(SONG_FIXTURES[0])), sections: [], typeSystem: { voice, params: {}, color: "auto", fonts: {}, weight: 800, ornaments: [], seal: "", rationale: "", lines: [{ lineId: "l0", recipe, emphasis: [], orientation: "h", energy: 0.8, motionWord: "", seed: 11 }] } } as unknown as Parameters<typeof composeProjectLine>[0];
          const r = composeProjectLine(plan, lines, 0, CANVASES[0], approxMeasure, { duration: 60 });
          if (!r) continue;
          for (const pair of boundaries(r.comp, text)) {
            const at = units.findIndex((u, k) => u.text === pair[0] && units[k + 1]?.text === pair[1]);
            if (at < 0) continue;
            expect(splitsWord(units, at), `${recipe}/${voice}: 「${text}」 breaks ${pair}`).toBe(false);
          }
        }
      }
    }
  });

  it("English rows and phrases never end on a / the / and / of / to / it / in / my", () => {
    const text = "The porch light hums a song it half remembers";
    const units = tokenizeLyric(text);
    const END = /\b(a|the|and|of|to|it|in|my)$/i;
    for (const max of [6, 8, 10, 12, 14, 16, 18, 20]) {
      const rows = breakRows(units, 0, units.length, { max, maxRows: 3, width: (idx) => idx.reduce((w, i) => w + Math.max(0.3, units[i].text.length * 0.55), 0) }).map((r) => r.map((i) => units[i].text).join(""));
      for (const row of rows.slice(0, -1)) expect(row.trim(), `${max}: ${rows.join(" / ")}`).not.toMatch(END);
    }
    const cut = splitLongLine(units);
    if (cut) expect(units.slice(cut[0][0], cut[0][1]).map((u) => u.text).join("").trim()).not.toMatch(END);
    for (const t of ["Oh, lay me down where the water's slow", "Where the stones forget the weight they used to know", "I carried river stones in both my coat pockets"]) {
      const u = tokenizeLyric(t);
      for (const max of [8, 10, 12, 14]) {
        const rows = breakRows(u, 0, u.length, { max, maxRows: 3, width: (idx) => idx.reduce((w, i) => w + Math.max(0.3, u[i].text.length * 0.55), 0) }).map((r) => r.map((i) => u[i].text).join(""));
        for (const row of rows.slice(0, -1)) expect(row.trim(), `${t} @${max}: ${rows.join(" / ")}`).not.toMatch(END);
      }
    }
  });
});
