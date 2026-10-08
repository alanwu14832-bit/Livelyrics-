// Round 13 (M7) made untimed lyrics spread over the song "estimated", not synced, until 對拍.
// Round 14: the flag is per line (LyricLine.estimated) — a tap makes that line real and only that
// line; Lyrics.timing "estimated" means "at least one line is estimated"; data from round 13 (the
// song-wide flag without per-line flags) counts every timed line as estimated.

import { describe, expect, it } from "vitest";
import { editorReducer, initialEditorState } from "@/components/lyrics-editor/editor-state";
import { contentKey, estimatedCount as editorEstimated, fromLyrics, insertLine, mergeWithNext, reestimate, setStart, splitLine, toLyrics } from "@/components/lyrics-editor/editor-model";
import { parseDraft, saveDraft } from "@/components/lyrics-editor/draft";
import { beginTap, tapMark } from "@/components/lyrics-editor/tap-sync";
import { parseLyricsPatch } from "@/lib/server/validate";
import type { AudioAnalysis, LyricLine, Lyrics } from "@/lib/types";
import { allLinesTimed, distributeLines, estimatedCount, estimatedFlags, normalizeLyrics, parseLyricsText, reestimateLines, timingEstimated } from "./lrc";

const TEXT = ["第一句歌詞", "第二句歌詞", "第三句歌詞", "第四句歌詞", "第五句歌詞", "第六句歌詞"].join("\n");

function spread(): Lyrics {
  return distributeLines(parseLyricsText(TEXT, "user"), null, 73);
}

/** a line without its estimated flag */
function unflagged(l: LyricLine): LyricLine {
  const copy = { ...l };
  delete copy.estimated;
  return copy;
}

/** what normalizeLyrics makes of the editor's rows (the save path) */
function saved(lines: ReturnType<typeof fromLyrics>): Lyrics {
  return normalizeLyrics(toLyrics(lines, { source: "user" }));
}

/** a 20 Hz 人聲 curve with six phrases (9 s apart, 4 s long) */
function vocalAnalysis(duration = 73): AudioAnalysis {
  const n = duration * 20;
  const vocal = Array.from({ length: n }, (_, i) => {
    const t = i / 20;
    return t >= 8 && t < 62 && (t - 8) % 9 < 4 ? 0.9 : 0.05;
  });
  const flat = (v: number) => new Array(n).fill(v);
  return { duration, sampleRate: 44100, bpm: 0, bpmConfidence: 0, beats: [], envelopeRate: 20, energy: flat(0.6), onset: flat(0.2), brightness: flat(0.5), bass: flat(0.4), vocal, peaks: [], sections: [] };
}

describe("estimated lyric timing (per line)", () => {
  it("distributeLines flags every line it places, and the song is not synced", () => {
    const l = spread();
    expect(allLinesTimed(l)).toBe(true);
    expect(l.lines.every((x) => x.estimated === true)).toBe(true);
    expect(l.timing).toBe("estimated");
    expect(l.synced).toBe(false);
    expect(timingEstimated(l)).toBe(true);
    expect(estimatedCount(l)).toBe(6);
  });

  it("real timings (LRC) are synced and carry no flag; distributing again changes nothing", () => {
    const l = parseLyricsText("[00:01.00]一\n[00:03.00]二", "user");
    expect(l.synced).toBe(true);
    expect(l.timing).toBeUndefined();
    const again = distributeLines(l, null, 10);
    expect(again.timing).toBeUndefined();
    expect(again.synced).toBe(true);
    expect(again.lines.some((x) => x.estimated)).toBe(false);
  });

  it("only the lines distributeLines places are estimated: the timed ones stay real", () => {
    const base = parseLyricsText(TEXT, "user");
    const lines = base.lines.map((l, k) => (k === 0 ? { ...l, start: 5 } : l));
    const out = distributeLines({ ...base, lines }, null, 73);
    expect(estimatedFlags(out)).toEqual([false, true, true, true, true, true]);
    expect(out.lines[0].start).toBe(5);
  });

  it("normalizeLyrics: timing follows the flags; an untimed line has none", () => {
    const l = spread();
    expect(normalizeLyrics(l).timing).toBe("estimated");
    // round 14: an untimed line no longer clears the song's flag — the other lines are still guesses
    const withUntimed = normalizeLyrics({ ...l, lines: [...l.lines, { id: "x", text: "多一句", start: null, end: null, estimated: true }] });
    expect(withUntimed.timing).toBe("estimated");
    expect(withUntimed.lines[6].estimated).toBeUndefined();
    // every flag gone (and the song flag with them): synced, no timing
    const real = normalizeLyrics({ ...l, timing: undefined, lines: l.lines.map(unflagged) });
    expect(real.timing).toBeUndefined();
    expect(real.synced).toBe(true);
    // the song flag alone, without line flags, is round-13 data: every timed line is estimated
    expect(normalizeLyrics({ ...l, lines: l.lines.map(unflagged) }).lines.every((x) => x.estimated)).toBe(true);
  });

  it("legacy data (round 13): the song-wide flag without per-line flags marks every timed line", () => {
    const legacy: Lyrics = { source: "user", synced: false, timing: "estimated", lines: [{ id: "l0", text: "一", start: 1, end: null }, { id: "l1", text: "二", start: 3, end: null }, { id: "l2", text: "三", start: null, end: null }] };
    expect(estimatedFlags(legacy)).toEqual([true, true, false]);
    expect(estimatedCount(legacy)).toBe(2);
    expect(timingEstimated(legacy)).toBe(true);
    const n = normalizeLyrics(legacy);
    expect(n.lines.map((x) => x.estimated)).toEqual([true, true, undefined]);
    expect(n.timing).toBe("estimated");
    // the editor reads it the same way
    expect(fromLyrics(legacy).map((x) => !!x.estimated)).toEqual([true, true, false]);
    // a PATCH from an old client (song flag, no line flags) too
    expect(parseLyricsPatch(JSON.parse(JSON.stringify(legacy))).lines.map((x) => x.estimated)).toEqual([true, true, undefined]);
  });

  it("survives a PATCH round trip; clearing it means dropping the line flags", () => {
    const patched = parseLyricsPatch(JSON.parse(JSON.stringify(spread())));
    expect(patched.timing).toBe("estimated");
    expect(patched.lines.every((l) => l.estimated)).toBe(true);
    const noLineFlags = parseLyricsPatch({ ...JSON.parse(JSON.stringify(spread())), timing: null, lines: spread().lines.map(unflagged) });
    expect(noLineFlags.timing).toBeUndefined();
    expect(noLineFlags.synced).toBe(true);
    // a false flag is real
    expect(parseLyricsPatch({ lines: [{ text: "一", start: 1, estimated: false }] }).timing).toBeUndefined();
  });

  it("the editor: one tap makes only that line real; undo brings its flag back", () => {
    const l = spread();
    let s = editorReducer(initialEditorState(), { type: "load", lines: fromLyrics(l), source: l.source });
    expect(editorEstimated(s.lines)).toBe(6);
    const keyBefore = contentKey(s.lines, s.source);

    s = editorReducer(s, { type: "checkpoint" });
    const r = tapMark(s.lines, beginTap(s.lines, 2), 30, 0);
    s = editorReducer(s, { type: "edit", lines: r.lines, record: false, source: "user" });
    expect(s.lines.map((x) => !!x.estimated)).toEqual([true, true, false, true, true, true]);
    expect(contentKey(s.lines, s.source)).not.toBe(keyBefore);
    const one = saved(s.lines);
    expect(one.timing).toBe("estimated");
    expect(one.synced).toBe(false);
    expect(estimatedCount(one)).toBe(5);

    s = editorReducer(s, { type: "undo" });
    expect(editorEstimated(s.lines)).toBe(6);
  });

  it("the editor: tapping every line clears timing and the song is synced", () => {
    let lines = fromLyrics(spread());
    let session = beginTap(lines, 0);
    for (let k = 0; k < lines.length; k++) {
      const r = tapMark(lines, session, 5 + k * 6, 0);
      lines = r.lines;
      session = r.session;
    }
    expect(editorEstimated(lines)).toBe(0);
    const all = saved(lines);
    expect(all.timing).toBeUndefined();
    expect(all.synced).toBe(true);
    expect(all.lines.some((x) => x.estimated)).toBe(false);
  });

  it("a tap that lands exactly on the estimated time still makes the line real (and the editor dirty)", () => {
    const lines = fromLyrics(spread());
    const t = lines[1].start as number;
    const after = setStart(lines, 1, t);
    expect(after[1].start).toBe(t);
    expect(after[1].estimated).toBeUndefined();
    expect(contentKey(after, "user")).not.toBe(contentKey(lines, "user"));
  });

  it("re-estimation moves only the estimated lines, keeps the order, and never a real one", () => {
    const a = vocalAnalysis();
    let lines = fromLyrics(distributeLines(parseLyricsText(TEXT, "user"), a, 73));
    // the operator taps lines 0 and 3, a little off the curve's phrases
    lines = setStart(setStart(lines, 0, 8.4), 3, 35.3);
    const next = reestimate(lines, a, 73, "estimated");
    expect(next[0].start).toBe(8.4);
    expect(next[3].start).toBe(35.3);
    expect(next[0].estimated).toBeUndefined();
    expect(next[3].estimated).toBeUndefined();
    const starts = next.map((x) => x.start as number);
    for (let k = 1; k < starts.length; k++) expect(starts[k]).toBeGreaterThan(starts[k - 1]);
    // between the taps the estimated lines sit on the curve's phrases (17 s and 26 s)
    expect(Math.abs(starts[1] - 17)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(starts[2] - 26)).toBeLessThanOrEqual(0.2);
    expect(next.filter((x) => x.estimated).length).toBe(4);
    // rows keep their keys (no re-mount, focus stays)
    expect(next.map((x) => x.key)).toEqual(lines.map((x) => x.key));
    // the lrc-level helper does the same on saved lyrics
    const viaLyrics = reestimateLines(saved(lines), a, 73);
    expect(viaLyrics.lines.map((x) => x.start)).toEqual(saved(next).lines.map((x) => x.start));
  });

  it("re-estimation modes: untimed lines stay untimed unless asked; real lines stay unless 'all'", () => {
    const a = vocalAnalysis();
    const base = fromLyrics(distributeLines(parseLyricsText(TEXT, "user"), a, 73));
    const lines = setStart(base, 2, 26.2).map((l, k) => (k === 4 ? { ...l, start: null, end: null, estimated: undefined } : l));
    const est = reestimate(lines, a, 73, "estimated");
    expect(est[4].start).toBeNull();
    expect(est[2].start).toBe(26.2);
    const both = reestimate(lines, a, 73, "estimated+untimed");
    expect(both[4].start).not.toBeNull();
    expect(both[4].estimated).toBe(true);
    expect(both[2].start).toBe(26.2);
    const untimed = reestimate(lines, a, 73, "untimed");
    expect(untimed[1]).toBe(lines[1]);
    expect(untimed[4].estimated).toBe(true);
    const all = reestimate(lines, a, 73, "all");
    expect(all.every((x) => x.estimated)).toBe(true);
  });

  it("structure edits keep provenance honest", () => {
    const lines = fromLyrics(parseLyricsText("[00:01.00]第一句歌詞\n[00:09.00]第二句歌詞", "user"));
    // an inserted line between two timed ones gets a guessed (estimated) start
    const ins = insertLine(lines, 1).lines;
    expect(ins[1].start).toBe(5);
    expect(ins[1].estimated).toBe(true);
    // a proportional split point is a guess; the first half keeps its real start
    const split = splitLine(lines, 0, 3)!.lines;
    expect(split[0].estimated).toBeUndefined();
    expect(split[1].estimated).toBe(true);
    // merging keeps the provenance of the start it keeps
    const est = fromLyrics(spread());
    expect(mergeWithNext(est, 0)[0].estimated).toBe(true);
  });

  it("drafts remember the per-line flags (and read round-13 drafts)", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const lines = setStart(fromLyrics(spread()), 0, 2);
    saveDraft("p1", { lines, source: "user", baseUpdatedAt: "x", savedAt: 1 }, storage);
    const back = parseDraft(JSON.parse(store.get("livelyrics:lyrics-draft:p1")!));
    expect(back?.lines.map((l) => !!l.estimated)).toEqual([false, true, true, true, true, true]);
    // round 13: a song-wide flag, no per-line flags
    const old = parseDraft({ v: 1, savedAt: 1, baseUpdatedAt: "x", source: "user", estimated: true, lines: [{ text: "a", start: 1, end: null }, { text: "b", start: null, end: null }] });
    expect(old?.lines.map((l) => !!l.estimated)).toEqual([true, false]);
    expect(parseDraft({ v: 1, savedAt: 1, baseUpdatedAt: "x", source: "user", lines: [{ text: "a", start: 1, end: null }] })?.lines[0].estimated).toBeUndefined();
  });
});
