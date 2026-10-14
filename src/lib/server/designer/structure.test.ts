import { describe, expect, it } from "vitest";
import type { AudioAnalysis, Lyrics } from "@/lib/types";
import { analyzeStructure, coverSpans, energyCurve, lineKey, MAX_CHORUS_SECONDS, resolveDuration, similarity } from "./structure";
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

// ---------------------------------------------------------------------------
// round 19: structure that follows the singing
// ---------------------------------------------------------------------------

function synthAnalysis(duration: number, sections: Array<[number, number, number]>, opts: { vocal?: (t: number) => number; peak?: number } = {}): AudioAnalysis {
  const rate = 20;
  const n = Math.floor(duration * rate) + 1;
  const energyAt = (t: number) => sections.find(([a, b]) => t >= a && t < b)?.[2] ?? 0;
  return {
    duration,
    sampleRate: 44100,
    bpm: 0,
    bpmConfidence: 0,
    beats: [],
    envelopeRate: rate,
    energy: Array.from({ length: n }, (_, i) => energyAt(i / rate)),
    onset: new Array(n).fill(0.3),
    brightness: new Array(n).fill(0.5),
    bass: new Array(n).fill(0.4),
    vocal: Array.from({ length: n }, (_, i) => opts.vocal?.(i / rate) ?? 0.1),
    peaks: new Array(400).fill(opts.peak ?? 0.6),
    sections: sections.map(([start, end, energy]) => ({ start, end, energy })),
  };
}

const CHORUS = ["我們一起唱到天亮", "把燈全部都打開"];
function timedLyrics(rows: Array<[number, string]>, estimated = false): Lyrics {
  return { source: "user", synced: !estimated, lines: rows.map(([start, text], i) => ({ id: `l${i}`, text, start, end: start + 3, ...(estimated ? { estimated: true as const } : {}) })) };
}

describe("round 19 · structure that follows the singing", () => {
  it("an instrumental opening before the first sung line is an intro, never a chorus (Keep On)", () => {
    // the audio heard one opening section 0–19 s; the voice comes in at 10 s with the chorus
    const analysis = synthAnalysis(60, [[0, 19, 0.7], [19, 40, 0.72], [40, 60, 0.75]], { vocal: (t) => (t >= 10 ? 0.8 : 0.2) });
    const lyrics = timedLyrics([[10, CHORUS[0]], [14, CHORUS[1]], [20, "一個人走在雨裡"], [25, "城市的燈慢慢亮起"], [30, "我想起你的樣子"], [41, CHORUS[0]], [45, CHORUS[1]], [50, "天亮以前不要走"]]);
    const st = analyzeStructure({ meta: demoMeta({ duration: 60 }), lyrics, analysis });
    expect(st.sections[0]).toMatchObject({ kind: "intro", start: 0, end: 10 });
    expect(st.sections[0].lineIds).toEqual([]);
    expect(st.sections[1].kind).toBe("chorus");
  });

  it("keeps no intro when the 人聲 curve says the voice is already in", () => {
    const analysis = synthAnalysis(60, [[0, 19, 0.7], [19, 40, 0.72], [40, 60, 0.75]], { vocal: () => 0.8 });
    const lyrics = timedLyrics([[10, CHORUS[0]], [14, CHORUS[1]], [20, "一個人走在雨裡"], [41, CHORUS[0]], [45, CHORUS[1]]]);
    const st = analyzeStructure({ meta: demoMeta({ duration: 60 }), lyrics, analysis });
    expect(st.sections[0].kind).not.toBe("intro");
  });

  it("never opens on a chorus when the first line is only estimated", () => {
    const analysis = synthAnalysis(60, [[0, 19, 0.7], [19, 40, 0.72], [40, 60, 0.75]], { vocal: () => 0.8 });
    const rows: Array<[number, string]> = [[0.5, CHORUS[0]], [5, CHORUS[1]], [20, "一個人走在雨裡"], [41, CHORUS[0]], [45, CHORUS[1]]];
    expect(analyzeStructure({ meta: demoMeta({ duration: 60 }), lyrics: timedLyrics(rows), analysis }).sections[0].kind).toBe("chorus");
    expect(analyzeStructure({ meta: demoMeta({ duration: 60 }), lyrics: timedLyrics(rows, true), analysis }).sections[0].kind).not.toBe("chorus");
  });

  it("caps a chorus at 45 s: a 75 s span is cut at a lyric boundary", () => {
    const analysis = synthAnalysis(120, [[0, 30, 0.5], [30, 105, 0.8], [105, 120, 0.3]]);
    const rows: Array<[number, string]> = [[2, "一個人走在雨裡"], [10, "城市的燈慢慢亮起"], [20, "我想起你的樣子"]];
    for (let t = 31; t < 104; t += 8) rows.push([t, CHORUS[rows.length % 2]]);
    const st = analyzeStructure({ meta: demoMeta({ duration: 120 }), lyrics: timedLyrics(rows), analysis });
    expect(st.sections.filter((s) => s.kind === "chorus").length).toBeGreaterThanOrEqual(2);
    for (const s of st.sections) expect(s.kind === "chorus" ? s.end - s.start : 0).toBeLessThanOrEqual(MAX_CHORUS_SECONDS + 0.5);
  });

  it("labels verse vs chorus by repetition inside one long audio section", () => {
    // the audio heard one section 0–80 s; the lines say verse, chorus, verse, chorus
    const analysis = synthAnalysis(84, [[0, 80, 0.75], [80, 84, 0.2]], { vocal: () => 0.8 });
    const lyrics = timedLyrics([
      [0.5, "一個人走在雨裡"],
      [5, "城市的燈慢慢亮起"],
      [10, "我想起你的樣子"],
      [15, "那年夏天的風"],
      [20, CHORUS[0]],
      [24, CHORUS[1]],
      [28, CHORUS[0]],
      [32, CHORUS[1]],
      [40, "收音機斷了訊號"],
      [45, "像沒說完的話"],
      [50, "車窗外的海"],
      [55, "慢慢退到遠方"],
      [60, CHORUS[0]],
      [64, CHORUS[1]],
      [68, CHORUS[0]],
      [72, CHORUS[1]],
    ]);
    const st = analyzeStructure({ meta: demoMeta({ duration: 84 }), lyrics, analysis });
    const kindAt = (t: number) => st.sections.find((s) => t >= s.start && t < s.end)?.kind;
    expect([kindAt(8), kindAt(25), kindAt(48), kindAt(66)]).toEqual(["verse", "chorus", "verse", "chorus"]);
  });

  it("an absolute energy floor: a song whose level never rises gets no energy chorus and no climax", () => {
    const lyrics: Lyrics = { source: "user", synced: false, lines: [{ id: "l0", text: "沒有時間", start: null, end: null }] };
    // every section at the same level (normalized energies all ≈ 0.75)
    const flatSong = synthAnalysis(120, [[0, 30, 0.74], [30, 60, 0.76], [60, 90, 0.75], [90, 120, 0.76]]);
    const st = analyzeStructure({ meta: demoMeta({ duration: 120 }), lyrics, analysis: flatSong });
    expect(st.flat).toBe(true);
    expect(st.sections.some((s) => s.kind === "chorus" || s.kind === "solo")).toBe(false);
    // the same shape as a song that rises, but never loud in absolute terms (peaks ≈ −40 dBFS)
    const shape: Array<[number, number, number]> = [[0, 30, 0.3], [30, 60, 0.9], [60, 90, 0.4], [90, 120, 0.9]];
    const q = analyzeStructure({ meta: demoMeta({ duration: 120 }), lyrics, analysis: synthAnalysis(120, shape, { peak: 0.01 }) });
    expect(q.flat).toBe(true);
    expect(q.sections.some((s) => s.kind === "chorus")).toBe(false);
    // a song that rises keeps its energy choruses
    const l = analyzeStructure({ meta: demoMeta({ duration: 120 }), lyrics, analysis: synthAnalysis(120, shape) });
    expect(l.flat).toBe(false);
    expect(l.sections.some((s) => s.kind === "chorus")).toBe(true);
  });
});
