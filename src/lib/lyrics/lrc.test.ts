import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AudioAnalysis, Lyrics } from "../types";
import {
  detectLanguage,
  distributeLines,
  formatLrcTime,
  lineWeight,
  looksLikeLrc,
  normalizeLyrics,
  parseLrc,
  parseLyricsText,
  parsePlainLyrics,
  toLrc,
  vocalRegions,
} from "./lrc";

const demoLrc = readFileSync(path.join(__dirname, "../../../fixtures/demo-lyrics.lrc"), "utf8");

function texts(l: Lyrics) {
  return l.lines.map((x) => x.text);
}

function makeAnalysis(duration: number, energyAt: (t: number) => number, sections: AudioAnalysis["sections"] = []): AudioAnalysis {
  const rate = 20;
  const n = Math.round(duration * rate);
  const energy = Array.from({ length: n }, (_, i) => energyAt(i / rate));
  return {
    duration,
    sampleRate: 44100,
    bpm: 120,
    bpmConfidence: 0.9,
    beats: [],
    envelopeRate: rate,
    energy,
    onset: energy.map(() => 0),
    brightness: energy.map(() => 0),
    bass: energy.map(() => 0),
    peaks: [],
    sections,
  };
}

/** demo song shape: intro 0-8 quiet, verse 8-24, chorus 24-40, breakdown 40-48, chorus 48-64, outro 64-73 */
const demoEnergy = (t: number) => (t < 8 ? 0.12 : t < 24 ? 0.55 : t < 40 ? 0.9 : t < 48 ? 0.35 : t < 64 ? 0.92 : 0.1);
const demoSections: AudioAnalysis["sections"] = [
  { start: 0, end: 8, energy: 0.12 },
  { start: 8, end: 24, energy: 0.55 },
  { start: 24, end: 40, energy: 0.9 },
  { start: 40, end: 48, energy: 0.35 },
  { start: 48, end: 64, energy: 0.92 },
  { start: 64, end: 73, energy: 0.1 },
];

describe("parseLrc", () => {
  it("parses the demo fixture, ignoring metadata tags", () => {
    const l = parseLrc(demoLrc);
    expect(l.synced).toBe(true);
    expect(l.lines).toHaveLength(14);
    expect(l.lines[0]).toMatchObject({ id: "l0", text: "夜色慢慢落在城市的邊緣", start: 8, end: 12 });
    expect(l.lines.map((x) => x.id)).toEqual(l.lines.map((_, i) => `l${i}`));
    expect(texts(l)).not.toContain("示範之歌");
    expect(l.lines[8]).toMatchObject({ text: "安靜一下 聽見了嗎", start: 42, end: 48 });
    // last line has no following line: end stays open
    expect(l.lines[13]).toMatchObject({ text: "直到天亮", start: 66, end: null });
    expect(l.language).toBe("zh-Hant");
  });

  it("supports [mm:ss], [mm:ss.x], [mm:ss.xxx] and [mm:ss:xx] tags", () => {
    const l = parseLrc("[00:01]a\n[00:02.5]b\n[00:03.250]c\n[00:04:50]d\n[1:05.00]e\n[100:00.00]f");
    expect(l.lines.map((x) => x.start)).toEqual([1, 2.5, 3.25, 4.5, 65, 6000]);
  });

  it("expands lines with several time tags and sorts by time", () => {
    const l = parseLrc("[00:30.00]second\n[00:10.00][00:50.00]chorus\n[00:20.00]first");
    expect(texts(l)).toEqual(["chorus", "first", "second", "chorus"]);
    expect(l.lines.map((x) => x.start)).toEqual([10, 20, 30, 50]);
    expect(l.lines.map((x) => x.end)).toEqual([20, 30, 40, null]);
  });

  it("caps a derived end so a line does not linger over a long instrumental gap", () => {
    const l = parseLrc("[00:10.00]before solo\n[00:45.00]after solo");
    expect(l.lines[0].end).toBe(20);
  });

  it("uses blank timed lines as end markers and keeps them out of the lines", () => {
    const l = parseLrc("[00:10.00]one\n[00:13.50]\n[00:20.00]two\n[00:24.00]");
    expect(texts(l)).toEqual(["one", "two"]);
    expect(l.lines[0].end).toBe(13.5);
    expect(l.lines[1].end).toBe(24);
  });

  it("parses enhanced <mm:ss.xx> word tags", () => {
    const l = parseLrc("[00:12.00]<00:12.00>I <00:12.50>love <00:13.00>you<00:13.80>\n[00:15.00]next");
    const line = l.lines[0];
    expect(line.text).toBe("I love you");
    expect(line.words).toEqual([
      { text: "I ", start: 12, end: 12.5 },
      { text: "love ", start: 12.5, end: 13 },
      { text: "you", start: 13, end: 13.8 },
    ]);
    expect(line.words!.map((w) => w.text).join("")).toBe(line.text);
    expect(line.end).toBe(13.8);
  });

  it("parses CJK word tags and word tags without a line tag", () => {
    const l = parseLrc("<00:05.00>夜<00:05.40>色<00:05.80>慢<00:06.20>\n[00:08.00]下一句");
    expect(l.lines[0]).toMatchObject({ text: "夜色慢", start: 5, end: 6.2 });
    expect(l.lines[0].words).toHaveLength(3);
    expect(l.lines[0].words![1]).toEqual({ text: "色", start: 5.4, end: 5.8 });
  });

  it("text before the first word tag starts at the line tag", () => {
    const l = parseLrc("[00:10.00]Hey <00:10.60>you");
    expect(l.lines[0].words).toEqual([
      { text: "Hey ", start: 10, end: 10.6 },
      { text: "you", start: 10.6, end: 10.9 },
    ]);
  });

  it("shifts word times of duplicate-tag lines", () => {
    const l = parseLrc("[00:10.00][00:30.00]<00:10.00>a<00:10.50>b<00:11.00>");
    expect(l.lines[1].words).toEqual([
      { text: "a", start: 30, end: 30.5 },
      { text: "b", start: 30.5, end: 31 },
    ]);
  });

  it("applies the [offset:] tag (positive = earlier)", () => {
    const l = parseLrc("[offset:+500]\n[00:10.00]a\n[00:00.20]b");
    expect(l.lines.map((x) => x.start)).toEqual([0, 9.5]);
  });

  it("merges same-timestamp lines as translations and drops exact duplicates", () => {
    const l = parseLrc("[00:10.00]我們的歌\n[00:10.00]Our song\n[00:14.00]再唱一次\n[00:14.00]再唱一次");
    expect(l.lines).toHaveLength(2);
    expect(l.lines[0]).toMatchObject({ text: "我們的歌", translation: "Our song" });
    expect(l.lines[1].translation).toBeUndefined();
  });

  it("drops credit lines, section markers and handles messy input", () => {
    const messy =
      "﻿[ti:Song]\r\n[ar:Band]\r\n[00:00.00] 作词 : 某人\r\n[00:00.50]作曲：另一人\r\n\r\n" +
      "[00:05.00]   第一句\t  有空白   \r\n[Chorus]\r\n[00:09.00]【副歌】\r\n  [00:10.00]  第二句  \r\n" +
      "garbage [not a tag\r\n[00:12.00]Lyrics by: nobody\r\n[00:12.50]Music by the fire\r\n[00:13.00](Verse 2)\r\n[00:14.00]第三句";
    const l = parseLrc(messy);
    expect(texts(l)).toEqual(["第一句 有空白", "第二句", "garbage [not a tag", "Music by the fire", "第三句"]);
    expect(l.lines[0].start).toBe(5);
    // the stray untimed line stays where it was, after "第二句"
    expect(l.lines[2].start).toBeNull();
    expect(l.synced).toBe(false);
    // untimed next line leaves the previous end open
    expect(l.lines[1].end).toBeNull();
  });

  it("keeps a CJK full-width space inside the text", () => {
    expect(parseLrc("[00:01.00]你好　世界").lines[0].text).toBe("你好　世界");
  });

  it("returns empty lyrics for empty or metadata-only input", () => {
    for (const input of ["", "   \n\n", "[ti:x]\n[ar:y]\n[length:03:20]"]) {
      const l = parseLrc(input);
      expect(l.lines).toEqual([]);
      expect(l.synced).toBe(false);
    }
  });
});

describe("parsePlainLyrics", () => {
  it("one line per lyric, blank lines and annotations dropped", () => {
    const l = parsePlainLyrics("[Verse 1]\n第一句\n\n  第二句  \n(Chorus)\n作詞：某人\nHey (hey!)\n");
    expect(texts(l)).toEqual(["第一句", "第二句", "Hey (hey!)"]);
    expect(l.lines.every((x) => x.start === null && x.end === null)).toBe(true);
    expect(l.synced).toBe(false);
    expect(l.lines.map((x) => x.id)).toEqual(["l0", "l1", "l2"]);
  });

  it("strips stray time tags", () => {
    expect(texts(parsePlainLyrics("[00:01.00]a\n<00:02.00>b"))).toEqual(["a", "b"]);
  });
});

describe("parseLyricsText", () => {
  it("detects LRC vs plain and applies the source", () => {
    expect(looksLikeLrc(demoLrc)).toBe(true);
    expect(looksLikeLrc("hello\nworld")).toBe(false);
    const a = parseLyricsText(demoLrc, "lrclib-synced");
    expect(a.synced).toBe(true);
    expect(a.source).toBe("lrclib-synced");
    const b = parseLyricsText("第一句\n第二句");
    expect(b.synced).toBe(false);
    expect(b.source).toBe("user");
    expect(b.lines).toHaveLength(2);
  });
});

describe("toLrc", () => {
  it("round-trips the demo fixture", () => {
    const a = parseLrc(demoLrc);
    const b = parseLrc(toLrc(a));
    expect(b).toEqual(a);
  });

  it("round-trips words, translations, gaps and untimed lines", () => {
    const src =
      "[00:01.00]<00:01.00>夜<00:01.50>色<00:02.00>\n[00:05.00]雙語\n[00:05.00]Bilingual\n[00:08.00]gap before next\n" +
      "[00:09.00]\n[00:20.00]then untimed follows\nuntimed line\n[00:30.00]last\n[00:33.00]";
    const a = parseLrc(src);
    const out = toLrc(a);
    expect(out).toContain("[00:05.00]Bilingual");
    expect(out).toContain("\nuntimed line\n");
    expect(out).toContain("[00:09.00]\n");
    const b = parseLrc(out);
    expect(b).toEqual(a);
  });

  it("formats times with centiseconds and minute rollover", () => {
    expect(formatLrcTime(0)).toBe("00:00.00");
    expect(formatLrcTime(59.999)).toBe("01:00.00");
    expect(formatLrcTime(61.234)).toBe("01:01.23");
    expect(formatLrcTime(6000)).toBe("100:00.00");
    expect(formatLrcTime(-3)).toBe("00:00.00");
    expect(formatLrcTime(Number.NaN)).toBe("00:00.00");
  });

  it("emits untimed lines without a tag", () => {
    expect(toLrc(parsePlainLyrics("a\nb"))).toBe("a\nb\n");
    expect(toLrc({ source: "none", synced: false, lines: [] })).toBe("");
  });
});

describe("normalizeLyrics", () => {
  it("reassigns ids, sorts, fixes ends and synced flag", () => {
    const l = normalizeLyrics({
      source: "user",
      synced: false,
      lines: [
        { id: "x", text: "  b ", start: 20, end: 25 },
        { id: "y", text: "a", start: 10, end: 99 },
        { id: "z", text: "", start: 5, end: null },
        { id: "w", text: "c", start: 30, end: 29 },
      ],
    });
    expect(l.lines.map((x) => [x.id, x.text, x.start, x.end])).toEqual([
      ["l0", "a", 10, 20],
      ["l1", "b", 20, 25],
      ["l2", "c", 30, null],
    ]);
    expect(l.synced).toBe(true);
  });

  it("keeps untimed lines after the line they followed and clears their times/words", () => {
    const l = normalizeLyrics({
      source: "user",
      synced: true,
      lines: [
        { id: "a", text: "t2", start: 20, end: null },
        { id: "b", text: "u", start: null, end: 5, words: [{ text: "u", start: 1, end: 2 }] },
        { id: "c", text: "t1", start: 10, end: null },
      ],
    });
    expect(texts(l)).toEqual(["t1", "t2", "u"]);
    expect(l.lines[2]).toEqual({ id: "l2", text: "u", start: null, end: null });
    expect(l.synced).toBe(false);
  });

  it("rejects invalid numbers and unknown sources", () => {
    const l = normalizeLyrics({
      source: "bogus" as Lyrics["source"],
      synced: true,
      lines: [
        { id: "a", text: "x", start: Number.NaN, end: 3 },
        { id: "b", text: "y", start: -1, end: null },
        { id: "c", text: "z", start: 1.23456, end: Infinity },
      ],
    });
    expect(l.source).toBe("user");
    // untimed lines that came first stay first
    expect(l.lines.map((x) => x.start)).toEqual([null, null, 1.235]);
    expect(l.lines[2].end).toBeNull();
  });

  it("sanitizes word timings", () => {
    const l = normalizeLyrics({
      source: "user",
      synced: true,
      lines: [
        {
          id: "a",
          text: "ab",
          start: 10,
          end: null,
          words: [
            { text: "b", start: 11, end: 10 },
            { text: "a", start: 9, end: 10.5 },
          ],
        },
        { id: "b", text: "next", start: 12, end: null },
      ],
    });
    expect(l.lines[0].words).toEqual([
      { text: "a", start: 10, end: 10.5 },
      { text: "b", start: 11, end: 11.3 },
    ]);
    expect(l.lines[0].end).toBe(11.3);
  });

  it("empty lyrics are not synced", () => {
    expect(normalizeLyrics({ source: "none", synced: true, lines: [] }).synced).toBe(false);
  });
});

describe("distributeLines", () => {
  const plain = parsePlainLyrics(texts(parseLrc(demoLrc)).join("\n"));

  it("without analysis spreads lines over 8%..92% of the song", () => {
    const l = distributeLines(plain, null, 100);
    expect(l.synced).toBe(true);
    expect(l.lines[0].start).toBeCloseTo(8, 5);
    const last = l.lines[l.lines.length - 1];
    expect(last.end).toBeCloseTo(92, 5);
    for (let i = 1; i < l.lines.length; i++) {
      expect(l.lines[i].start!).toBeGreaterThan(l.lines[i - 1].start!);
      expect(l.lines[i - 1].end!).toBeLessThanOrEqual(l.lines[i].start! + 1e-9);
    }
    // longer text gets more time
    const dur = (i: number) => l.lines[i].end! - l.lines[i].start!;
    expect(dur(0)).toBeGreaterThan(dur(4));
  });

  it("with analysis skips the quiet intro and outro", () => {
    const analysis = makeAnalysis(73, demoEnergy, demoSections);
    const regions = vocalRegions(analysis, 73);
    expect(regions[0].start).toBeGreaterThanOrEqual(7.5);
    expect(regions[regions.length - 1].end).toBeLessThanOrEqual(64.5);
    const l = distributeLines(plain, analysis, 73);
    expect(l.lines[0].start!).toBeGreaterThanOrEqual(7.5);
    expect(l.lines[l.lines.length - 1].end!).toBeLessThanOrEqual(64.5);
  });

  it("skips long near-silent stretches in the middle", () => {
    // loud 0-30, silence 30-45, loud 45-90
    const analysis = makeAnalysis(90, (t) => (t >= 30 && t < 45 ? 0.02 : 0.8));
    const regions = vocalRegions(analysis, 90);
    expect(regions.length).toBe(2);
    const l = distributeLines(parsePlainLyrics(Array.from({ length: 12 }, (_, i) => `第${i}句歌詞`).join("\n")), analysis, 90);
    for (const line of l.lines) {
      const inGap = line.start! > 31 && line.start! < 44;
      expect(inGap).toBe(false);
      // no line spans the silent gap
      expect(line.start! < 30 && line.end! > 31).toBe(false);
    }
  });

  it("fills only untimed lines between timed anchors", () => {
    const lyrics = normalizeLyrics({
      source: "user",
      synced: false,
      lines: [
        { id: "", text: "anchor one", start: 10, end: null },
        { id: "", text: "u1", start: null, end: null },
        { id: "", text: "u2", start: null, end: null },
        { id: "", text: "anchor two", start: 20, end: null },
        { id: "", text: "tail", start: null, end: null },
      ],
    });
    const l = distributeLines(lyrics, null, 40);
    expect(l.lines[0].start).toBe(10);
    expect(l.lines[3].start).toBe(20);
    expect(l.lines[1].start!).toBeGreaterThan(10);
    expect(l.lines[2].start!).toBeGreaterThan(l.lines[1].start!);
    expect(l.lines[2].start!).toBeLessThan(20);
    expect(l.lines[4].start!).toBeGreaterThan(20);
    expect(l.lines[4].start!).toBeLessThan(40);
    expect(l.synced).toBe(true);
    expect(texts(l)).toEqual(["anchor one", "u1", "u2", "anchor two", "tail"]);
  });

  it("handles leading untimed lines before an early anchor", () => {
    const lyrics = normalizeLyrics({
      source: "user",
      synced: false,
      lines: [
        { id: "", text: "a", start: null, end: null },
        { id: "", text: "b", start: null, end: null },
        { id: "", text: "anchor", start: 2, end: null },
      ],
    });
    const l = distributeLines(lyrics, null, 100);
    expect(l.lines[0].start!).toBeGreaterThanOrEqual(0);
    expect(l.lines[1].start!).toBeLessThan(2);
    expect(texts(l)).toEqual(["a", "b", "anchor"]);
  });

  it("returns already synced lyrics unchanged and survives zero duration", () => {
    const synced = parseLrc(demoLrc);
    expect(distributeLines(synced, null, 73)).toEqual(synced);
    const l = distributeLines(parsePlainLyrics("a\nb\nc"), null, 0);
    expect(l.synced).toBe(true);
    expect(l.lines.every((x) => Number.isFinite(x.start!))).toBe(true);
    expect(distributeLines({ source: "none", synced: false, lines: [] }, null, 60).lines).toEqual([]);
  });
});

describe("helpers", () => {
  it("lineWeight counts CJK characters more than Latin letters", () => {
    expect(lineWeight("我們的歌")).toBeGreaterThan(lineWeight("song"));
    expect(lineWeight("")).toBeGreaterThan(0);
  });

  it("detectLanguage", () => {
    expect(detectLanguage(["我們的歌會找到方向"])).toBe("zh-Hant");
    expect(detectLanguage(["我们的歌会找到方向"])).toBe("zh-Hans");
    expect(detectLanguage(["君の名前を呼んでいる"])).toBe("ja");
    expect(detectLanguage(["사랑해 너를"])).toBe("ko");
    expect(detectLanguage(["We will rock you"])).toBe("en");
    expect(detectLanguage(["...", "123"])).toBeUndefined();
  });
});
