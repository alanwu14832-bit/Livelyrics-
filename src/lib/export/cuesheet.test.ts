import { describe, expect, it } from "vitest";
import { buildCueSheet, buildReadme, csvField, cueRows } from "./cuesheet";
import { FRAME_RATES } from "./frames";
import { section, testLyrics, testPlan } from "../console/test-fixtures";
import type { Project } from "../types";

function project(): Project {
  return {
    id: "p1",
    meta: { title: "示範之歌", artist: "示範樂團", duration: 40, fileName: "a.wav", mimeType: "audio/wav" },
    analysis: null,
    lyrics: testLyrics(),
    plan: testPlan([section("s0", 0, 8, { label: "前奏" }), section("s1", 8, 24, { label: "主歌" }), section("s2", 24, 40, { label: "副歌" })]),
    assets: [],
    output: { width: 1920, height: 1080, preset: "1080p", lyricSafe: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 } },
  } as unknown as Project;
}

describe("cue sheet", () => {
  it("lists sections, timed lines and cues relative to the first frame", () => {
    const rows = cueRows(project(), { start: 0, end: 40 }, FRAME_RATES["30"]);
    expect(rows.filter((r) => r.type === "section").map((r) => [r.name, r.start, r.timecode])).toEqual([
      ["前奏", 0, "00:00:00:00"],
      ["主歌", 8, "00:00:08:00"],
      ["副歌", 24, "00:00:24:00"],
    ]);
    const lines = rows.filter((r) => r.type === "line");
    // the untimed line is not listed
    expect(lines.map((l) => l.name)).toEqual(["l0", "l1", "l3", "l4"]);
    expect(lines[0]).toMatchObject({ start: 8, end: 11, frame: 240 });
    const cues = rows.filter((r) => r.type === "cue");
    expect(cues.map((c) => c.start)).toEqual([8, 24]);
    // sorted, sections before lines at the same instant
    expect(rows[1].type).toBe("section");
    expect(rows[2].type).toBe("line");
  });

  it("shifts a partial range to start at 0 and marks carried-over items", () => {
    const rows = cueRows(project(), { start: 10, end: 20 }, FRAME_RATES["29.97"]);
    const s = rows.find((r) => r.type === "section")!;
    expect(s).toMatchObject({ name: "主歌", start: 0, end: 10, songTime: 10 });
    expect(s.note).toContain("接續");
    const l0 = rows.find((r) => r.name === "l0")!;
    expect(l0.start).toBe(0);
    expect(l0.end).toBe(1);
    const l1 = rows.find((r) => r.name === "l1")!;
    expect(l1.start).toBe(2);
    // 2 s at 29.97 = frame 59.94 -> the first frame showing it is 60
    expect(l1.frame).toBe(60);
    expect(rows.some((r) => r.type === "cue")).toBe(false);
  });

  it("writes CSV with a BOM, CRLF and quoting", () => {
    const csv = buildCueSheet(project(), { start: 0, end: 40 }, FRAME_RATES["30"]);
    expect(csv.startsWith("﻿type,index,start_s")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("section,2,8.000,24.000,16.000,00:00:08:00,240,8.000,主歌,");
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
    expect(csvField("plain")).toBe("plain");
  });

  it("README states the delivery spec", () => {
    const text = buildReadme({
      project: project(),
      range: { start: 0, end: 40 },
      rate: FRAME_RATES["29.97"],
      width: 1920,
      height: 1080,
      files: [{ name: "x_full.mp4", variant: "完整", codec: "H.264 High 4.0", container: "MP4", bitrate: 10e6, audio: null, alpha: false }],
      cueSheetName: "x_cues.csv",
      createdAt: "2026-09-27",
    });
    expect(text).toContain("1920 x 1080");
    expect(text).toContain("30000/1001");
    expect(text).toContain("drop-frame");
    expect(text).toContain("共 1199 格");
    expect(text).toContain("x_full.mp4");
    expect(text).not.toMatch(/[–—]/);
  });
});
