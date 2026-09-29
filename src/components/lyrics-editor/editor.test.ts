import { describe, expect, it } from "vitest";
import { normalizeLyrics } from "@/lib/lyrics/lrc";
import type { Lyrics } from "@/lib/types";
import {
  clearAllTimes,
  contentKey,
  defaultSplitPoint,
  effectiveEnd,
  formatTimeInput,
  fromLyrics,
  insertLine,
  lineAt,
  markStart,
  mergeWithNext,
  nudge,
  outOfOrderFlags,
  parseTimeInput,
  removeLine,
  setStart,
  sortByTime,
  splitLine,
  timedCount,
  toLyrics,
  updateText,
  type EditorLine,
} from "./editor-model";
import { editorReducer, initialEditorState } from "./editor-state";
import { draftToLines, loadDraft, parseDraft, saveDraft } from "./draft";
import { beginTap, preRollTime, tapFinished, tapMark, tapSkip, tapUndo } from "./tap-sync";

function lyrics(lines: Array<[string, number | null, (number | null)?]>): Lyrics {
  return {
    source: "user",
    synced: false,
    lines: lines.map(([text, start, end], i) => ({ id: `l${i}`, text, start, end: end ?? null })),
  };
}

function lines(spec: Array<[string, number | null]>): EditorLine[] {
  return spec.map(([text, start], i) => ({ key: `t${i}`, text, translation: "", start, end: null }));
}

describe("time input", () => {
  it("formats with rounding (no floating-point truncation)", () => {
    expect(formatTimeInput(0.29)).toBe("0:00.29");
    expect(formatTimeInput(83.456)).toBe("1:23.46");
    expect(formatTimeInput(59.999)).toBe("1:00.00");
    expect(formatTimeInput(null)).toBe("");
  });

  it("parses the common spellings", () => {
    expect(parseTimeInput("1:23.45")).toBe(83.45);
    expect(parseTimeInput("01:23.450")).toBe(83.45);
    expect(parseTimeInput("83.5")).toBe(83.5);
    expect(parseTimeInput("1:23")).toBe(83);
    expect(parseTimeInput("１：２３．４")).toBe(83.4);
    expect(parseTimeInput("0:01:23.5")).toBe(83.5);
    expect(parseTimeInput(".5")).toBe(0.5);
    expect(parseTimeInput("1,5")).toBe(1.5);
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput(" - ")).toBeNull();
    expect(parseTimeInput("1:75")).toBeUndefined();
    expect(parseTimeInput("abc")).toBeUndefined();
    expect(parseTimeInput("-3")).toBeUndefined();
  });
});

describe("conversion", () => {
  it("keeps explicit gap ends only", () => {
    const ed = fromLyrics(lyrics([["a", 1, 3], ["b", 5, 7], ["c", 7, 12]]));
    expect(ed.map((l) => l.end)).toEqual([3, null, 12]);
    expect(new Set(ed.map((l) => l.key)).size).toBe(3);
  });

  it("round-trips through normalizeLyrics", () => {
    const src = normalizeLyrics({ ...lyrics([["a", 1, 3], ["b", 5, null], ["c", 9, 12]]), lines: [...lyrics([["a", 1, 3], ["b", 5, null], ["c", 9, 12]]).lines] });
    src.lines[1].translation = "B";
    const back = normalizeLyrics(toLyrics(fromLyrics(src), { source: "user" }));
    expect(back.lines.map((l) => [l.text, l.start, l.end, l.translation])).toEqual([
      ["a", 1, 3, undefined],
      ["b", 5, 9, "B"],
      ["c", 9, 12, undefined],
    ]);
    expect(back.synced).toBe(true);
  });

  it("content key ignores surrounding whitespace but sees timing", () => {
    const a = lines([["x", 1]]);
    const b = [{ ...a[0], text: " x " }];
    expect(contentKey(a, "user")).toBe(contentKey(b, "user"));
    expect(contentKey(a, "user")).not.toBe(contentKey(setStart(a, 0, 2), "user"));
  });
});

describe("timing ops", () => {
  it("setStart shifts explicit end and words with the line", () => {
    const base: EditorLine[] = [{ key: "a", text: "ab", translation: "", start: 1, end: 3, words: [{ text: "a", start: 1, end: 2 }, { text: "b", start: 2, end: 3 }] }];
    const moved = setStart(base, 0, 2);
    expect(moved[0].start).toBe(2);
    expect(moved[0].end).toBe(4);
    expect(moved[0].words?.map((w) => w.start)).toEqual([2, 3]);
    const cleared = setStart(base, 0, null);
    expect(cleared[0]).toMatchObject({ start: null, end: null });
    expect(cleared[0].words).toBeUndefined();
    expect(setStart(base, 0, 1)).toBe(base);
    expect(setStart(base, 5, 1)).toBe(base);
  });

  it("clamps to 0..duration", () => {
    const base = lines([["a", 1]]);
    expect(setStart(base, 0, -2)[0].start).toBe(0);
    expect(setStart(base, 0, 99, 60)[0].start).toBe(60);
  });

  it("nudges timed lines only", () => {
    const base = lines([["a", 1], ["b", null]]);
    expect(nudge(base, 0, 0.1)[0].start).toBe(1.1);
    expect(nudge(base, 0, -0.1)[0].start).toBe(0.9);
    expect(nudge(base, 1, 0.1)).toBe(base);
  });

  it("markStart makes the previous line contiguous", () => {
    const base: EditorLine[] = [
      { key: "a", text: "a", translation: "", start: 1, end: 2 },
      { key: "b", text: "b", translation: "", start: null, end: null },
    ];
    const out = markStart(base, 1, 4);
    expect(out[0].end).toBeNull();
    expect(out[1].start).toBe(4);
  });

  it("flags out-of-order lines and sorts like normalizeLyrics", () => {
    const base = lines([["a", 5], ["b", 2], ["c", null], ["d", 8]]);
    expect(outOfOrderFlags(base)).toEqual([false, true, false, false]);
    expect(sortByTime(base).map((l) => l.text)).toEqual(["b", "c", "a", "d"]);
    expect(timedCount(base)).toBe(3);
    expect(timedCount(clearAllTimes(base))).toBe(0);
  });

  it("computes effective ends", () => {
    const base = lines([["a", 1], ["b", 4], ["c", 30]]);
    expect(effectiveEnd(base, 0)).toBe(4);
    expect(effectiveEnd(base, 1)).toBe(14);
    expect(effectiveEnd(base, 2, 33)).toBe(33);
    expect(effectiveEnd(lines([["x", null]]), 0)).toBeNull();
  });
});

describe("structure ops", () => {
  it("inserts between timed neighbours", () => {
    const base = lines([["a", 2], ["b", 6]]);
    const r = insertLine(base, 1);
    expect(r.index).toBe(1);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[1].start).toBe(4);
    expect(r.lines[1].text).toBe("");
    expect(insertLine(base, 2).lines[2].start).toBe(8);
    expect(insertLine(base, 0).lines[0].start).toBeNull();
    expect(insertLine([], 0).lines).toHaveLength(1);
  });

  it("removes", () => {
    const base = lines([["a", 2], ["b", 6]]);
    expect(removeLine(base, 0).map((l) => l.text)).toEqual(["b"]);
    expect(removeLine(base, 9)).toBe(base);
  });

  it("merges with the next line", () => {
    const base: EditorLine[] = [
      { key: "a", text: "Hey", translation: "嘿", start: 2, end: null },
      { key: "b", text: "跟著我唱", translation: "", start: 4, end: 7 },
    ];
    const out = mergeWithNext(base, 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "a", text: "Hey 跟著我唱", translation: "嘿", start: 2, end: 7 });
    expect(mergeWithNext(base, 1)).toBe(base);
  });

  it("splits at the caret with a proportional start", () => {
    const base = lines([["abcdef", 10], ["next", 16]]);
    const r = splitLine(base, 0, 2);
    expect(r).not.toBeNull();
    expect(r!.lines.map((l) => l.text)).toEqual(["ab", "cdef", "next"]);
    expect(r!.lines[1].start).toBe(12);
    expect(r!.index).toBe(1);
    expect(splitLine(base, 0, 0)).toBeNull();
    expect(splitLine(base, 0, 6)).toBeNull();
    // untimed lines stay untimed
    expect(splitLine(lines([["ab cd", null]]), 0)!.lines[1].start).toBeNull();
  });

  it("splits on a word boundary using word timings", () => {
    const base: EditorLine[] = [
      {
        key: "a",
        text: "one two",
        translation: "",
        start: 1,
        end: 3,
        words: [
          { text: "one ", start: 1, end: 1.8 },
          { text: "two", start: 2.2, end: 3 },
        ],
      },
    ];
    const r = splitLine(base, 0, 4)!;
    expect(r.lines.map((l) => l.text)).toEqual(["one", "two"]);
    expect(r.lines[1].start).toBe(2.2);
    expect(r.lines[1].end).toBe(3);
    expect(r.lines[0].words?.[0].text).toBe("one");
  });

  it("finds natural split points", () => {
    expect(defaultSplitPoint("把心跳交給 這個晚上")).toBe(5);
    expect(defaultSplitPoint("abcd")).toBe(2);
    expect(defaultSplitPoint("a")).toBe(1);
  });

  it("drops word timings when the text changes", () => {
    const base: EditorLine[] = [{ key: "a", text: "ab", translation: "", start: 1, end: null, words: [{ text: "ab", start: 1, end: 2 }] }];
    expect(updateText(base, 0, "text", "abc")[0].words).toBeUndefined();
    expect(updateText(base, 0, "translation", "x")[0].words).toHaveLength(1);
    expect(updateText(base, 0, "text", "ab")).toBe(base);
  });
});

describe("tap sync", () => {
  it("marks, skips, un-marks and finishes", () => {
    let ls = lines([["a", null], ["b", null], ["c", 20]]);
    let s = beginTap(ls, 0);
    let r = tapMark(ls, s, 1.1, 0.1);
    ls = r.lines;
    s = r.session;
    expect(ls[0].start).toBe(1);
    expect(s.pointer).toBe(1);
    r = tapMark(ls, s, 3.1, 0.1);
    ls = r.lines;
    s = r.session;
    expect(ls[1].start).toBe(3);
    const u = tapUndo(ls, s);
    expect(u.restored).toBe(1);
    expect(u.lines[1].start).toBeNull();
    expect(u.session.pointer).toBe(1);
    s = tapSkip(u.lines, u.session);
    expect(s.pointer).toBe(2);
    s = tapSkip(u.lines, s);
    expect(tapFinished(s, u.lines)).toBe(true);
    // marking after the end is a no-op
    expect(tapMark(u.lines, s, 30).lines).toBe(u.lines);
  });

  it("restores the previous line's explicit end on undo", () => {
    const base: EditorLine[] = [
      { key: "a", text: "a", translation: "", start: 1, end: 2 },
      { key: "b", text: "b", translation: "", start: null, end: null },
    ];
    const s = beginTap(base, 1);
    const r = tapMark(base, s, 5, 0);
    expect(r.lines[0].end).toBeNull();
    const u = tapUndo(r.lines, r.session);
    expect(u.lines[0].end).toBe(2);
    expect(u.lines[1].start).toBeNull();
  });

  it("computes a pre-roll", () => {
    const ls = lines([["a", 4], ["b", null], ["c", 20]]);
    expect(preRollTime(ls, 0)).toBe(0);
    expect(preRollTime(ls, 2)).toBe(3.5);
    expect(preRollTime(lines([["a", null], ["b", 10]]), 1)).toBe(6);
  });
});

describe("editor reducer", () => {
  it("undoes and redoes edits, coalescing typing", () => {
    let s = editorReducer(initialEditorState(), { type: "load", lines: lines([["a", 1]]), source: "user" });
    const l1 = updateText(s.lines, 0, "text", "ab");
    s = editorReducer(s, { type: "edit", lines: l1, tag: "text:t0", at: 1000 });
    const l2 = updateText(s.lines, 0, "text", "abc");
    s = editorReducer(s, { type: "edit", lines: l2, tag: "text:t0", at: 1500 });
    expect(s.past).toHaveLength(1);
    s = editorReducer(s, { type: "undo" });
    expect(s.lines[0].text).toBe("a");
    s = editorReducer(s, { type: "redo" });
    expect(s.lines[0].text).toBe("abc");
    expect(editorReducer(s, { type: "redo" })).toBe(s);
  });

  it("supports checkpoint + unrecorded edits (tap session = one undo step)", () => {
    let s = editorReducer(initialEditorState(), { type: "load", lines: lines([["a", null], ["b", null]]), source: "lrclib-plain" });
    s = editorReducer(s, { type: "checkpoint" });
    s = editorReducer(s, { type: "edit", lines: setStart(s.lines, 0, 1), record: false });
    s = editorReducer(s, { type: "edit", lines: setStart(s.lines, 1, 2), record: false, source: "user" });
    expect(s.past).toHaveLength(1);
    s = editorReducer(s, { type: "undo" });
    expect(s.lines.map((l) => l.start)).toEqual([null, null]);
    expect(s.source).toBe("lrclib-plain");
  });
});

describe("drafts", () => {
  it("saves, loads and validates", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    const ls = lines([["a", 1], ["b", null]]);
    expect(saveDraft("p", { lines: ls, source: "user", baseUpdatedAt: "2026-01-01T00:00:00Z", savedAt: 5 }, storage)).toBe(true);
    const d = loadDraft("p", storage);
    expect(d?.lines.map((l) => l.text)).toEqual(["a", "b"]);
    expect(draftToLines(d!).every((l) => l.key)).toBe(true);
    expect(parseDraft({ v: 2 })).toBeNull();
    expect(parseDraft({ v: 1, savedAt: 1, baseUpdatedAt: "x", lines: [{ text: 3 }, { text: "ok", start: -1 }], source: "evil" })).toEqual({
      v: 1,
      savedAt: 1,
      baseUpdatedAt: "x",
      source: "user",
      lines: [{ text: "ok", translation: "", start: null, end: null }],
    });
    map.set("livelyrics:lyrics-draft:bad", "{not json");
    expect(loadDraft("bad", storage)).toBeNull();
  });
});

describe("lineAt", () => {
  it("finds the sounding line, tolerating out-of-order lines and gaps", () => {
    const ls: EditorLine[] = [
      { key: "a", text: "a", translation: "", start: 1, end: 3 },
      { key: "b", text: "b", translation: "", start: 5, end: null },
      { key: "c", text: "c", translation: "", start: 4, end: null },
      { key: "d", text: "d", translation: "", start: null, end: null },
    ];
    expect(lineAt(ls, 0.5)).toBeNull();
    expect(lineAt(ls, 2)).toBe(0);
    expect(lineAt(ls, 3.5)).toBeNull();
    expect(lineAt(ls, 4.5)).toBe(2);
    expect(lineAt(ls, 6)).toBe(1);
    expect(lineAt(ls, 60)).toBeNull();
  });

  it("apply action edits from the current lines", () => {
    let s = editorReducer(initialEditorState(), { type: "load", lines: lines([["a", 1]]), source: "user" });
    s = editorReducer(s, { type: "apply", fn: (l) => nudge(l, 0, 1) });
    expect(s.lines[0].start).toBe(2);
    expect(s.past).toHaveLength(1);
  });
});
