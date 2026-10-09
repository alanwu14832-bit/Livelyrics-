// Round 15 「AI 自動對時」 in the editor: the AI's starts are estimated (「估」) and flagged
// `aligned`; real lines never move; after a tap the aligned lines stay unless a real line now
// contradicts them; 確認全部時間 turns every estimated line real; the flags survive saving,
// drafts and undo.

import { describe, expect, it } from "vitest";
import { parseDraft, saveDraft } from "@/components/lyrics-editor/draft";
import {
  alignedCount,
  applyAsrTiming,
  confirmAllTimes,
  contentKey,
  estimatedCount,
  fromLyrics,
  mergeWithNext,
  reestimate,
  setStart,
  splitLine,
  toLyrics,
  type EditorLine,
} from "@/components/lyrics-editor/editor-model";
import { editorReducer, initialEditorState } from "@/components/lyrics-editor/editor-state";
import { parseLyricsPatch } from "@/lib/server/validate";
import type { AudioAnalysis, Lyrics } from "@/lib/types";
import { DEFAULT_ASR_ALIGN, alignTranscript, type AsrWord } from "./asr-align";
import { distributeLines, normalizeLyrics, reestimateLines } from "./lrc";

/** a 20 Hz 人聲 curve: phrases of 4 s every 6 s from 4 s */
function vocalAnalysis(duration = 80): AudioAnalysis {
  const n = duration * 20;
  const vocal = Array.from({ length: n }, (_, i) => {
    const t = i / 20;
    return t >= 4 && (t - 4) % 6 < 4 ? 0.9 : 0.05;
  });
  const flat = (v: number) => new Array(n).fill(v);
  return { duration, sampleRate: 44100, bpm: 0, bpmConfidence: 0, beats: [], envelopeRate: 20, energy: flat(0.6), onset: flat(0.2), brightness: flat(0.5), bass: flat(0.4), vocal, peaks: [], sections: [] };
}

const TEXTS = ["hey on your heart", "you are involved in the fight", "feeling far above the sky", "my heart is feeling dark", "overland no land", "i cannot hold it down"];

function rows(starts: Array<number | null> = TEXTS.map(() => null), estimated = false): EditorLine[] {
  return TEXTS.map((text, i) => {
    const l: EditorLine = { key: `k${i}`, text, translation: "", start: starts[i], end: null };
    if (estimated && starts[i] != null) l.estimated = true;
    return l;
  });
}

/** Whisper heard lines 0, 1, 3 and 5 at 4, 10, 22 and 34 s (2 and 4 were not understood). */
function words(): AsrWord[] {
  const at = [4, 10, null, 22, null, 34];
  return TEXTS.flatMap((t, i) => {
    const s = at[i];
    if (s == null) return [{ text: " mumble", start: 16 + (i - 2) * 3, end: 16.5 + (i - 2) * 3 }];
    return t.split(" ").map((w, k) => ({ text: ` ${w}`, start: s + k * 0.4, end: s + k * 0.4 + 0.3 }));
  });
}

/** where the AI puts a line Whisper heard at t (its timestamp calibration) */
const at = (t: number) => t + DEFAULT_ASR_ALIGN.offset;

function aiRun(current: EditorLine[], analysis = vocalAnalysis()): EditorLine[] {
  const fixed = current.map((l) => (l.start != null && !l.estimated ? l.start : null));
  const r = alignTranscript({ lines: current.map((l) => l.text), words: words(), fixed, vocal: analysis.vocal ? { curve: analysis.vocal, rate: analysis.envelopeRate } : null });
  return applyAsrTiming(current, r.anchors, analysis, analysis.duration);
}

describe("「AI 自動對時」 in the editor", () => {
  it("the heard lines take the AI's start (estimated, aligned); the others are estimated by the 人聲 aligner", () => {
    const out = aiRun(rows());
    expect(out.map((l) => l.start)).toEqual([expect.closeTo(at(4), 2), expect.closeTo(at(10), 2), expect.any(Number), expect.closeTo(at(22), 2), expect.any(Number), expect.closeTo(at(34), 2)]);
    expect(out.map((l) => !!l.aligned)).toEqual([true, true, false, true, false, true]);
    expect(out.every((l) => l.estimated)).toBe(true);
    expect(estimatedCount(out)).toBe(6);
    expect(alignedCount(out)).toBe(4);
    // the filled lines sit between their anchors
    expect(out[2].start!).toBeGreaterThan(10);
    expect(out[2].start!).toBeLessThan(22);
    expect(out[4].start!).toBeGreaterThan(22);
    expect(out[4].start!).toBeLessThan(34);
    // keys and texts stay
    expect(out.map((l) => l.key)).toEqual(rows().map((l) => l.key));
  });

  it("real lines never move, and an AI start that contradicts one is dropped", () => {
    // the operator tapped line 3 at 21 s and line 1 at 12 s (the AI heard line 1 at 10 s: fine, it is real now)
    const tapped = setStart(setStart(rows(), 3, 21), 1, 12);
    const out = aiRun(tapped);
    expect(out[1]).toBe(tapped[1]);
    expect(out[3]).toBe(tapped[3]);
    expect(out[0].aligned).toBe(true);
    expect(out[5].aligned).toBe(true);
    // a tap far from where the AI heard line 0 (at 4 s): line 0 must come before 2 s now
    const clash = aiRun(setStart(rows(), 1, 3.9));
    expect(clash[0].aligned).toBeFalsy();
    expect(clash[0].start!).toBeLessThan(3.9);
  });

  it("after a tap, the AI's lines stay where it put them; only the other estimated lines are re-laid", () => {
    const ai = aiRun(rows());
    const tapped = setStart(ai, 2, 15.5);
    const relaid = reestimate(tapped, vocalAnalysis(), 80, "estimated");
    for (const i of [0, 1, 3, 5]) expect(relaid[i]).toBe(tapped[i]);
    expect(relaid[2].start).toBe(15.5);
    expect(relaid[2].estimated).toBeFalsy();
    expect(relaid[4].estimated).toBe(true);
    // a tap that contradicts an AI line: that line is re-estimated (and no longer "aligned")
    const late = setStart(ai, 2, 23);
    const fixed = reestimate(late, vocalAnalysis(), 80, "estimated");
    expect(fixed[3].aligned).toBeFalsy();
    expect(fixed[3].start!).toBeGreaterThan(23);
    expect(fixed[5]).toBe(late[5]);
    // 重新估算『估的』行 (an explicit re-estimation) re-lays the AI's lines too
    const again = reestimate(ai, vocalAnalysis(), 80, "estimated+untimed");
    expect(alignedCount(again)).toBe(0);
    expect(estimatedCount(again)).toBe(6);
  });

  it("確認全部時間 makes every estimated line real (synced), and undo brings the guesses back", () => {
    const ai = aiRun(rows());
    const confirmed = confirmAllTimes(ai);
    expect(estimatedCount(confirmed)).toBe(0);
    expect(alignedCount(confirmed)).toBe(0);
    expect(confirmed.map((l) => l.start)).toEqual(ai.map((l) => l.start));
    const saved = normalizeLyrics(toLyrics(confirmed, { source: "user" }));
    expect(saved.synced).toBe(true);
    expect(saved.timing).toBeUndefined();
    expect(confirmAllTimes(confirmed)).toBe(confirmed);

    let s = editorReducer(initialEditorState(), { type: "load", lines: ai, source: "user" });
    s = editorReducer(s, { type: "edit", lines: confirmAllTimes(s.lines) });
    expect(estimatedCount(s.lines)).toBe(0);
    s = editorReducer(s, { type: "undo" });
    expect(s.lines).toBe(ai);
    expect(alignedCount(s.lines)).toBe(4);
  });

  it("the flag is saved (only with estimated), read back, validated, drafted and part of the dirty key", () => {
    const ai = aiRun(rows());
    const saved = normalizeLyrics(toLyrics(ai, { source: "user" }));
    expect(saved.lines.filter((l) => l.aligned).length).toBe(4);
    expect(saved.lines.every((l) => !l.aligned || l.estimated)).toBe(true);
    expect(fromLyrics(saved).map((l) => !!l.aligned)).toEqual(ai.map((l) => !!l.aligned));
    // the PATCH validator keeps it with estimated and drops it without
    const patched = parseLyricsPatch({ ...saved, lines: saved.lines.map((l, i) => (i === 0 ? { ...l, estimated: false } : l)) });
    expect(patched.lines[0].aligned).toBeUndefined();
    expect(patched.lines[1].aligned).toBe(true);
    // normalizeLyrics drops an aligned flag without estimated
    const odd: Lyrics = { source: "user", synced: false, lines: [{ id: "a", text: "x", start: 1, end: null, aligned: true }] };
    expect(normalizeLyrics(odd).lines[0].aligned).toBeUndefined();
    // drafts
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    saveDraft("p", { lines: ai, source: "user", baseUpdatedAt: "x", savedAt: 1 }, storage);
    const draft = parseDraft(JSON.parse(store.get("livelyrics:lyrics-draft:p")!));
    expect(draft!.lines.filter((l) => l.aligned).length).toBe(4);
    // the dirty key sees the provenance
    const plain = ai.map((l) => {
      const c = { ...l };
      delete c.aligned;
      return c;
    });
    expect(contentKey(plain, "user")).not.toBe(contentKey(ai, "user"));
  });

  it("merging and splitting keep the provenance of the start they keep", () => {
    const ai = aiRun(rows());
    const merged = mergeWithNext(ai, 0);
    expect(merged[0].aligned).toBe(true);
    const split = splitLine(ai, 1, 7)!;
    expect(split.lines[1].aligned).toBe(true);
    expect(split.lines[2].aligned).toBeFalsy();
    expect(split.lines[2].estimated).toBe(true);
  });

  it("distributeLines and reestimateLines never invent the flag", () => {
    const ai = normalizeLyrics(toLyrics(aiRun(rows()), { source: "user" }));
    const relaid = reestimateLines(ai, vocalAnalysis(), 80);
    expect(relaid.lines.some((l) => l.aligned)).toBe(false);
    const kept = distributeLines(ai, vocalAnalysis(), 80);
    expect(kept.lines.filter((l) => l.aligned).length).toBe(4);
  });
});
