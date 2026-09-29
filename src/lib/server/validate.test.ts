import { describe, expect, it } from "vitest";
import type { SongMeta } from "@/lib/types";
import { HttpError } from "./http";
import { applyMetaPatch, parseAnalysis, parseCreateMeta, parseLyricsPatch, parsePlanPatch, parseProcessRequest, parseTimecodePatch, sanitizeAnalysis } from "./validate";

const file = { fileName: "告五人 - 愛人錯過.mp3", mimeType: "audio/mpeg" };

describe("parseCreateMeta", () => {
  it("cleans fields and takes duration from meta, then analysis", () => {
    const meta = parseCreateMeta(JSON.stringify({ title: "  愛人錯過 ", artist: "告五人\n", album: "", year: 2018, duration: 292.1234 }), file, null);
    expect(meta).toEqual({ title: "愛人錯過", artist: "告五人", year: 2018, duration: 292.123, fileName: file.fileName, mimeType: "audio/mpeg" });
    const analysis = sanitizeAnalysis({ duration: 100 });
    expect(parseCreateMeta(JSON.stringify({ title: "x", artist: "y", duration: 0 }), file, analysis).duration).toBe(100);
  });

  it("falls back to the file name and rejects bad JSON / types", () => {
    expect(parseCreateMeta(undefined, file, null).title).toBe("告五人 - 愛人錯過");
    expect(parseCreateMeta(JSON.stringify({ year: 12 }), file, null).year).toBeUndefined();
    expect(() => parseCreateMeta("{bad", file, null)).toThrow(HttpError);
    expect(() => parseCreateMeta(JSON.stringify({ title: 5 }), file, null)).toThrow(HttpError);
  });
});

describe("applyMetaPatch", () => {
  const current: SongMeta = { title: "a", artist: "b", album: "c", year: 2000, duration: 10, fileName: "f.mp3", mimeType: "audio/mpeg" };
  it("updates editable fields and ignores server-owned ones", () => {
    const next = applyMetaPatch(current, { title: " new ", album: null, year: null, fileName: "evil", mimeType: "text/html" });
    expect(next).toEqual({ title: "new", artist: "b", duration: 10, fileName: "f.mp3", mimeType: "audio/mpeg" });
  });
  it("rejects an empty title and invalid values", () => {
    expect(() => applyMetaPatch(current, { title: "  " })).toThrow(/歌名/);
    expect(() => applyMetaPatch(current, { year: 2000.5 })).toThrow(HttpError);
    expect(() => applyMetaPatch(current, { duration: -1 })).toThrow(HttpError);
  });
});

describe("analysis", () => {
  it("accepts null and sanitizes values", () => {
    expect(parseAnalysis(undefined)).toBeNull();
    expect(parseAnalysis("null")).toBeNull();
    expect(() => parseAnalysis("{x")).toThrow(HttpError);
    const a = sanitizeAnalysis({
      duration: 73,
      sampleRate: 44100,
      bpm: 120.004,
      bpmConfidence: 3,
      beats: [1, 0.5, -1, "x", 1000],
      envelopeRate: 20,
      energy: [0.123456789, 2, -1, null],
      sections: [{ start: 8, end: 24, energy: 0.5 }, { start: 0, end: 8, energy: 0.1 }, { start: 5, end: 2 }],
    })!;
    expect(a.bpm).toBe(120);
    expect(a.bpmConfidence).toBe(1);
    expect(a.beats).toEqual([0, 0.5, 1]);
    expect(a.energy).toEqual([0.1235, 1, 0, 0]);
    expect(a.onset).toEqual([]);
    expect(a.sections.map((s) => s.start)).toEqual([0, 8]);
    expect(sanitizeAnalysis({ duration: 0 })).toBeNull();
    expect(sanitizeAnalysis([1, 2])).toBeNull();
  });
});

describe("parseLyricsPatch", () => {
  it("validates shape and normalizes", () => {
    const l = parseLyricsPatch({
      source: "user",
      lines: [
        { id: "x", text: "b", start: 5, end: null },
        { text: "a", start: 1 },
        { text: "untimed", translation: null },
      ],
    });
    // sorted by time; the untimed line stays right after "a", the line it followed
    expect(l.lines.map((x) => [x.id, x.text, x.start])).toEqual([
      ["l0", "a", 1],
      ["l1", "untimed", null],
      ["l2", "b", 5],
    ]);
    expect(l.synced).toBe(false);
    expect(() => parseLyricsPatch({ lines: "nope" })).toThrow(HttpError);
    expect(() => parseLyricsPatch({ lines: [{ text: 1 }] })).toThrow(HttpError);
    expect(() => parseLyricsPatch({ source: "hacker", lines: [] })).toThrow(HttpError);
  });
});

describe("parsePlanPatch", () => {
  it("rejects invalid plans with a readable message", () => {
    expect(() => parsePlanPatch({ version: 2 })).toThrow(/設計方案格式錯誤/);
  });
});

describe("parseProcessRequest", () => {
  it("defaults, dedupes and validates", () => {
    expect(parseProcessRequest({})).toEqual({});
    expect(parseProcessRequest({ steps: ["design", "design"], instruction: "  更熱血 ", lyricsText: "  " })).toEqual({ steps: ["design"], instruction: "更熱血" });
    expect(() => parseProcessRequest({ steps: ["analyze"] })).toThrow(HttpError);
    expect(() => parseProcessRequest({ instruction: 5 })).toThrow(HttpError);
  });

  it("keeps the free option only when set", () => {
    expect(parseProcessRequest({ steps: ["research"], free: true })).toEqual({ steps: ["research"], free: true });
    expect(parseProcessRequest({ free: false })).toEqual({});
    expect(() => parseProcessRequest({ free: "yes" })).toThrow(HttpError);
  });
});

describe("parseTimecodePatch (phase 5a)", () => {
  it("accepts a start timecode or null (the default)", () => {
    expect(parseTimecodePatch({ start: "02:00:00:00" })).toEqual({ start: "02:00:00:00" });
    // a drop-frame label is stored with ":" (the incoming timecode says whether it drops)
    expect(parseTimecodePatch({ start: "01:00:10;05" })).toEqual({ start: "01:00:10:05" });
    expect(parseTimecodePatch(null)).toBeNull();
  });

  it("rejects anything that is not HH:MM:SS:FF", () => {
    for (const bad of [{ start: "2" }, { start: "24:00:00:00" }, { start: "01:00:00:30" }, { start: 5 }, "01:00:00:00", { start: "01:00:00:00", extra: 1 }, {}]) {
      expect(() => parseTimecodePatch(bad), JSON.stringify(bad)).toThrow(HttpError);
    }
  });
});
