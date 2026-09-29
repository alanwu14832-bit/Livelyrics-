import { describe, expect, it } from "vitest";
import type { Lyrics } from "@/lib/types";
import { analyzeStructure, coverSpans, energyCurve, lineKey, resolveDuration, similarity } from "./structure";
import { demoAnalysis, demoInput, demoLyrics, demoMeta } from "./testing/fixtures";

describe("repetition helpers", () => {
  it("folds case, width and punctuation", () => {
    expect(lineKey("Hey, 跟著我唱！")).toBe(lineKey("hey 跟著我唱"));
    expect(lineKey("ＡＢＣ")).toBe("abc");
  });
  it("scores near-duplicates high and unrelated lines low", () => {
    expect(similarity(lineKey("我們的歌會找到方向"), lineKey("我們的歌終會找到方向"))).toBeGreaterThan(0.78);
    expect(similarity(lineKey("夜色慢慢落在城市的邊緣"), lineKey("等待有人把它點燃"))).toBeLessThan(0.3);
  });
});

describe("coverSpans", () => {
  it("sorts, closes gaps and overlaps, and pins 0..duration", () => {
    const out = coverSpans(
      [
        { start: 30, end: 50 },
        { start: 2, end: 10 },
        { start: 8, end: 31 },
        { start: 55, end: 200 },
      ],
      60,
    );
    expect(out.map((s) => [s.start, s.end])).toEqual([
      [0, 8],
      [8, 30],
      [30, 55],
      [55, 60],
    ]);
  });
});

describe("analyzeStructure", () => {
  it("labels the demo song from audio sections + lyric repetition", () => {
    const st = analyzeStructure(demoInput());
    expect(st.source).toBe("audio");
    expect(st.duration).toBe(73);
    expect(st.sections.map((s) => s.kind)).toEqual(["intro", "verse", "chorus", "breakdown", "chorus", "outro"]);
    expect(st.sections[0].start).toBe(0);
    expect(st.sections[st.sections.length - 1].end).toBe(73);
    expect(st.cjk).toBe(true);
    // "Hey 跟著我唱" and the other chorus lines repeat
    const hook = st.lines.find((l) => l.cluster === st.hookCluster);
    expect(hook?.repeats).toBe(2);
    expect(st.sections[2].lineIds).toEqual(["l4", "l5", "l6", "l7"]);
  });

  it("keeps the labels when boundaries are snapped a hair after the lyric times (real browser analysis)", () => {
    // AUDIO reports 8.001 / 24.003 / 40.008 / 48.002 / 63.999 for the demo song while the LRC says 8.00, 24.00, 48.00
    const analysis = demoAnalysis();
    const snapped = [0, 8.001, 24.003, 40.008, 48.002, 63.999, 73];
    // and the energies it measures (the breakdown is only a moderate dip below the song mean)
    const energies = [0.2664, 0.5653, 0.768, 0.3919, 0.768, 0.2146];
    analysis.sections = analysis.sections.map((s, i) => ({ ...s, start: snapped[i], end: snapped[i + 1], energy: energies[i] }));
    const rate = analysis.envelopeRate;
    analysis.energy = analysis.energy.map((_, f) => energies[Math.max(0, snapped.findIndex((b, i) => f / rate >= b && f / rate < snapped[i + 1]))]);
    const st = analyzeStructure({ ...demoInput(), analysis });
    expect(st.sections.map((s) => s.kind)).toEqual(["intro", "verse", "chorus", "breakdown", "chorus", "outro"]);
    expect(st.sections[0].lineIds).toEqual([]);
    expect(st.sections[1].lineIds[0]).toBe("l0");
    expect(st.sections[4].lineIds[0]).toBe("l9");
  });

  it("falls back to lyric blocks without analysis", () => {
    const st = analyzeStructure({ meta: demoMeta(), lyrics: demoLyrics(), analysis: null });
    expect(st.source).toBe("lyrics");
    expect(st.sections[0].kind).toBe("intro");
    expect(st.sections.some((s) => s.kind === "chorus")).toBe(true);
    for (let i = 1; i < st.sections.length; i++) expect(st.sections[i].start).toBe(st.sections[i - 1].end);
    expect(st.sections[st.sections.length - 1].end).toBe(73);
  });

  it("splits evenly with a pop form when nothing is timed", () => {
    const lyrics: Lyrics = { source: "user", synced: false, lines: [{ id: "l0", text: "沒有時間", start: null, end: null }] };
    const st = analyzeStructure({ meta: demoMeta({ duration: 200 }), lyrics, analysis: null });
    expect(st.source).toBe("even");
    expect(st.sections.length).toBe(9);
    expect(st.sections[0].kind).toBe("intro");
    expect(st.sections[st.sections.length - 1].kind).toBe("outro");
    expect(st.sections.some((s) => s.kind === "chorus")).toBe(true);
  });

  it("uses energy ranking when lyrics are untimed but audio exists", () => {
    const lyrics: Lyrics = { source: "user", synced: false, lines: [{ id: "l0", text: "沒有時間", start: null, end: null }] };
    const st = analyzeStructure({ meta: demoMeta(), lyrics, analysis: demoAnalysis() });
    expect(st.sections.map((s) => s.kind)).toEqual(["intro", "verse", "chorus", "breakdown", "chorus", "outro"]);
  });

  it("splits an audio section that hides a verse→chorus boundary", () => {
    const analysis = demoAnalysis();
    analysis.sections = [
      { start: 0, end: 8, energy: 0.2 },
      { start: 8, end: 40, energy: 0.6 },
      { start: 40, end: 73, energy: 0.6 },
    ];
    const st = analyzeStructure({ meta: demoMeta(), lyrics: demoLyrics(), analysis });
    expect(st.sections.some((s) => s.start === 24)).toBe(true);
    expect(st.sections.find((s) => s.start === 24)?.kind).toBe("chorus");
  });

  it("survives garbage input", () => {
    const st = analyzeStructure({
      meta: { title: "", artist: "", duration: NaN },
      lyrics: { source: "none", synced: false, lines: [] },
      analysis: null,
    });
    expect(st.duration).toBe(180);
    expect(st.sections.length).toBeGreaterThan(0);
  });
});

describe("duration + energy curve", () => {
  it("prefers the analysis duration", () => {
    expect(resolveDuration({ ...demoInput(), meta: demoMeta({ duration: 99 }) })).toBe(73);
    expect(resolveDuration({ ...demoInput(), analysis: null, meta: demoMeta({ duration: 99 }) })).toBe(99);
  });
  it("returns one value per step", () => {
    const curve = energyCurve(demoAnalysis(), 73, 2);
    expect(curve.length).toBe(37);
    expect(curve[14]).toBeGreaterThan(curve[2]);
  });
});
