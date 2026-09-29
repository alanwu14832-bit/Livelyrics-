import { describe, expect, it } from "vitest";
import { impactChunks, chunkIndexAt } from "./chunks";
import { emphasisMask, unitEmphasis } from "./emphasis";
import { lineElapsed, prepareLine } from "./model";
import { estimateSungDuration, synthesizeTiming, timingFromWords, unitProgress, unitWeight } from "./timing";
import { tokenizeLyric } from "./tokenize";
import type { LyricLine } from "../../types";

describe("timing", () => {
  it("weights CJK per char and Latin by length", () => {
    const [hey, , ...rest] = tokenizeLyric("Hey 跟著");
    expect(unitWeight(rest[0])).toBe(1);
    expect(unitWeight(hey)).toBeGreaterThan(0.6);
    expect(unitWeight(tokenizeLyric("tonight")[0])).toBeGreaterThan(unitWeight(hey));
  });

  it("synthesizes monotonic timing that fills the duration", () => {
    const units = synthesizeTiming(tokenizeLyric("夜色慢慢落在城市的邊緣。"), 4);
    for (let i = 1; i < units.length; i++) expect(units[i].t0).toBeGreaterThanOrEqual(units[i - 1].t0);
    const last = units[units.length - 1];
    expect(last.text).toBe("。");
    expect(last.t0).toBeCloseTo(4, 5); // trailing punctuation takes no time
    expect(units[units.length - 2].t1).toBeCloseTo(4, 5);
    expect(units[0].t0).toBe(0);
  });

  it("keeps the sung part inside the span", () => {
    const u = tokenizeLyric("夜色慢慢落在城市的邊緣");
    const d = estimateSungDuration(u, 4);
    expect(d).toBeLessThanOrEqual(4 * 0.92 + 1e-9);
    expect(d).toBeGreaterThanOrEqual(2);
    expect(estimateSungDuration(tokenizeLyric("直到天亮"), 7)).toBeCloseTo(3.5, 5);
    const untimed = estimateSungDuration(u, null);
    expect(untimed).toBeGreaterThan(1.2);
    expect(untimed).toBeLessThanOrEqual(8);
  });

  it("aligns word timing onto units", () => {
    const text = "Hey 跟著我唱";
    const units = timingFromWords(
      text,
      tokenizeLyric(text),
      [
        { text: "Hey", start: 24, end: 24.5 },
        { text: "跟著", start: 25, end: 26 },
        { text: "我唱", start: 26, end: 27 },
      ],
      24,
    )!;
    expect(units).not.toBeNull();
    expect(units[0]).toMatchObject({ text: "Hey", t0: 0, t1: 0.5 });
    expect(units[2].t0).toBeCloseTo(1);
    expect(units[3].t0).toBeCloseTo(1.5);
    expect(units[5].t1).toBeCloseTo(3);
    // the space inherits the previous time
    expect(units[1].t0).toBeCloseTo(0.5);
  });

  it("rejects words that don't match the text", () => {
    const text = "完全不同";
    expect(timingFromWords(text, tokenizeLyric(text), [{ text: "abc", start: 0, end: 1 }], 0)).toBeNull();
  });

  it("computes unit progress", () => {
    const u = { text: "a", kind: "cjk" as const, from: 0, to: 1, t0: 1, t1: 2 };
    expect(unitProgress(u, 0.5)).toBe(0);
    expect(unitProgress(u, 1.5)).toBeCloseTo(0.5);
    expect(unitProgress(u, 3)).toBe(1);
    expect(unitProgress({ ...u, t1: 1 }, 1)).toBe(1);
  });
});

describe("emphasis", () => {
  it("marks every occurrence", () => {
    const text = "心跳 心跳 把心跳交給";
    const units = tokenizeLyric(text);
    const em = unitEmphasis(units, emphasisMask(text, ["心跳", ""]));
    const marked = units.filter((_, i) => em[i]).map((u) => u.text).join("");
    expect(marked).toBe("心跳心跳心跳");
  });
});

describe("impact chunks", () => {
  it("splits phrases into short chunks with time ranges", () => {
    const units = synthesizeTiming(tokenizeLyric("Hey 跟著我唱 把心跳交給這個晚上"), 5);
    const chunks = impactChunks(units, 4);
    const texts = chunks.map((c) => units.slice(c.from, c.to).map((u) => u.text).join(""));
    expect(texts).toEqual(["Hey", "跟著我唱", "把心跳", "交給這", "個晚上"]);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].t0).toBeGreaterThanOrEqual(chunks[i - 1].t0);
    expect(chunkIndexAt(chunks, -1)).toBe(0);
    expect(chunkIndexAt(chunks, 5)).toBe(chunks.length - 1);
  });

  it("merges short Latin words", () => {
    const units = synthesizeTiming(tokenizeLyric("Hey you 一起"), 2);
    const chunks = impactChunks(units);
    expect(units.slice(chunks[0].from, chunks[0].to).map((u) => u.text).join("")).toBe("Hey you");
  });
});

describe("prepareLine", () => {
  const lines: LyricLine[] = [
    { id: "l0", text: "夜色慢慢落在城市的邊緣", start: 8, end: null },
    { id: "l1", text: "就算世界再大再遠，我們的歌會找到方向，直到天亮", translation: "No matter how far", start: 12, end: null },
    { id: "l2", text: "未定時的歌詞", start: null, end: null },
  ];

  it("builds rows, timing and span", () => {
    const p = prepareLine(lines, 1, { maxChars: 16, maxLines: 2, songDuration: 73, emphasis: ["方向"] })!;
    expect(p.span).toEqual([12, 18]); // next timed line unknown -> start + 6
    expect(p.rows.length).toBe(2);
    expect(p.rows.flat().length).toBeGreaterThan(10);
    expect(p.translationRows).toEqual(["No matter how far"]);
    expect(p.emphasis.filter(Boolean).length).toBe(2);
    expect(lineElapsed(p, 13.5, 0, 0)).toBeCloseTo(1.5);
  });

  it("uses lineStartedAt for untimed lines", () => {
    const p = prepareLine(lines, 2, { maxChars: 16, maxLines: 2, songDuration: 73, emphasis: [] })!;
    expect(p.span).toBeNull();
    expect(lineElapsed(p, 99, 1000, 3500)).toBeCloseTo(2.5);
  });

  it("returns null for missing lines", () => {
    expect(prepareLine(lines, 9, { maxChars: 16, maxLines: 2, songDuration: 73, emphasis: [] })).toBeNull();
  });
});
