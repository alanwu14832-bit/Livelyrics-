// Round 13 (M7): untimed lyrics spread over the song are "estimated", not synced, until 對拍.

import { describe, expect, it } from "vitest";
import { editorReducer, initialEditorState } from "@/components/lyrics-editor/editor-state";
import { contentKey, fromLyrics, toLyrics } from "@/components/lyrics-editor/editor-model";
import { parseDraft } from "@/components/lyrics-editor/draft";
import { beginTap, tapMark } from "@/components/lyrics-editor/tap-sync";
import { parseLyricsPatch } from "@/lib/server/validate";
import type { Lyrics } from "@/lib/types";
import { allLinesTimed, distributeLines, normalizeLyrics, parseLyricsText, timingEstimated } from "./lrc";

const TEXT = ["第一句歌詞", "第二句歌詞", "第三句歌詞", "第四句歌詞", "第五句歌詞", "第六句歌詞"].join("\n");

function spread(): Lyrics {
  return distributeLines(parseLyricsText(TEXT, "user"), null, 73);
}

describe("estimated lyric timing", () => {
  it("distributeLines marks the spread times as estimated and not synced", () => {
    const l = spread();
    expect(allLinesTimed(l)).toBe(true);
    expect(l.timing).toBe("estimated");
    expect(l.synced).toBe(false);
    expect(timingEstimated(l)).toBe(true);
  });

  it("real timings (LRC) are synced and carry no flag", () => {
    const l = parseLyricsText("[00:01.00]一\n[00:03.00]二", "user");
    expect(l.synced).toBe(true);
    expect(l.timing).toBeUndefined();
    // already timed: distributing again changes nothing and adds no flag
    const again = distributeLines(l, null, 10);
    expect(again.timing).toBeUndefined();
    expect(again.synced).toBe(true);
  });

  it("normalizeLyrics keeps the flag while every line is timed and drops it otherwise", () => {
    const l = spread();
    expect(normalizeLyrics(l).timing).toBe("estimated");
    const untimed = normalizeLyrics({ ...l, lines: [...l.lines, { id: "x", text: "多一句", start: null, end: null }] });
    expect(untimed.timing).toBeUndefined();
    expect(untimed.synced).toBe(false);
  });

  it("survives a PATCH round trip (the lyric editor's save)", () => {
    const patched = parseLyricsPatch(JSON.parse(JSON.stringify(spread())));
    expect(patched.timing).toBe("estimated");
    expect(patched.synced).toBe(false);
    const cleared = parseLyricsPatch({ ...JSON.parse(JSON.stringify(spread())), timing: null });
    expect(cleared.timing).toBeUndefined();
    expect(cleared.synced).toBe(true);
  });

  it("the editor: load keeps it, a tap clears it, undo brings it back, save writes what is left", () => {
    const l = spread();
    let s = editorReducer(initialEditorState(), { type: "load", lines: fromLyrics(l), source: l.source, estimated: l.timing === "estimated" });
    expect(s.estimated).toBe(true);
    const keyBefore = contentKey(s.lines, s.source, s.estimated);
    expect(normalizeLyrics(toLyrics(s.lines, { source: s.source, estimated: s.estimated })).timing).toBe("estimated");

    // 對拍: the client dispatches the tapped lines with estimated: false
    s = editorReducer(s, { type: "checkpoint" });
    const r = tapMark(s.lines, beginTap(s.lines, 0), 2.5, 0);
    s = editorReducer(s, { type: "edit", lines: r.lines, record: false, source: "user", estimated: false });
    expect(s.estimated).toBe(false);
    expect(contentKey(s.lines, s.source, s.estimated)).not.toBe(keyBefore);
    const saved = normalizeLyrics(toLyrics(s.lines, { source: s.source, estimated: s.estimated }));
    expect(saved.timing).toBeUndefined();
    expect(saved.synced).toBe(true);

    s = editorReducer(s, { type: "undo" });
    expect(s.estimated).toBe(true);
  });

  it("the flag alone makes the editor dirty (a tap that lands on the same time still counts)", () => {
    const lines = fromLyrics(spread());
    expect(contentKey(lines, "user", true)).not.toBe(contentKey(lines, "user", false));
  });

  it("drafts remember the flag", () => {
    const d = parseDraft({ v: 1, savedAt: 1, baseUpdatedAt: "x", source: "user", estimated: true, lines: [{ text: "a", start: 1, end: null }] });
    expect(d?.estimated).toBe(true);
    expect(parseDraft({ v: 1, savedAt: 1, baseUpdatedAt: "x", source: "user", lines: [] })?.estimated).toBeUndefined();
  });
});
