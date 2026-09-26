import { describe, expect, it } from "vitest";
import type { LineDesign, Lyrics } from "@/lib/types";
import { remapLineDesigns } from "./remap";

function lyrics(lines: Array<[string, number | null]>): Lyrics {
  return {
    source: "user",
    synced: lines.every(([, s]) => s != null),
    lines: lines.map(([text, start], i) => ({ id: `l${i}`, text, start, end: null })),
  };
}

const design = (lineId: string, note = ""): LineDesign => ({ lineId, emphasis: [], styleOverride: null, note });

describe("remapLineDesigns", () => {
  it("follows a line whose id shifted after an insert above it", () => {
    const before = lyrics([["夜色落下", 8], ["燈火亮起", 12], ["把心跳交給這個晚上", 24]]);
    const after = lyrics([["新的一句", 4], ["夜色落下", 8], ["燈火亮起", 12], ["把心跳交給這個晚上", 24]]);
    const r = remapLineDesigns([design("l2", "hook")], before, after);
    expect(r.lines).toEqual([design("l3", "hook")]);
    expect(r.moved).toBe(1);
    expect(r.dropped).toBe(0);
  });

  it("drops designs for lines that were deleted or rewritten", () => {
    const before = lyrics([["夜色落下", 8], ["燈火亮起", 12]]);
    const after = lyrics([["夜色落下", 8], ["燈火熄滅", 12]]);
    const r = remapLineDesigns([design("l0"), design("l1")], before, after);
    expect(r.lines.map((l) => l.lineId)).toEqual(["l0"]);
    expect(r.dropped).toBe(1);
  });

  it("maps repeated chorus lines to the nearest occurrence in time, one design per line", () => {
    const before = lyrics([["副歌", 24], ["主歌", 30], ["副歌", 48]]);
    const after = lyrics([["前奏", 2], ["副歌", 24.5], ["主歌", 30], ["副歌", 48.2]]);
    const r = remapLineDesigns([design("l2", "second"), design("l0", "first")], before, after);
    expect(r.lines).toEqual([design("l3", "second"), design("l1", "first")]);
  });

  it("ignores whitespace and width differences in the text", () => {
    const before = lyrics([["Hello  World", 1]]);
    const after = lyrics([["ｈｅｌｌｏ world ", 1.2]]);
    expect(remapLineDesigns([design("l0")], before, after).lines).toEqual([design("l0")]);
  });

  it("drops designs whose line id does not exist", () => {
    const l = lyrics([["a", 1]]);
    expect(remapLineDesigns([design("l9")], l, l)).toMatchObject({ lines: [], dropped: 1 });
  });
});
