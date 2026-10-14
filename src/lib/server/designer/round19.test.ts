// Round 19: real songs, real structure — the designer side of the silence guard and the energy floor.

import { describe, expect, it } from "vitest";
import { isNearlySilent } from "@/lib/silence";
import type { AudioAnalysis } from "@/lib/types";
import type { ClaudeTransport } from "./claude";
import { designSong } from "./index";
import { offlineDesign } from "./offline";
import { analyzeStructure } from "./structure";
import { demoAnalysis, demoInput, demoMeta } from "./testing/fixtures";

/** A 25-minute file of (almost) nothing: dither-level peaks, every frame under the silence floor. */
function silentAnalysis(duration = 1500, peak = 0.0003): AudioAnalysis {
  const n = duration * 20 + 1;
  return {
    duration,
    sampleRate: 44100,
    bpm: 0,
    bpmConfidence: 0,
    beats: [],
    envelopeRate: 20,
    energy: new Array(n).fill(0),
    onset: new Array(n).fill(0),
    brightness: new Array(n).fill(0),
    bass: new Array(n).fill(0),
    vocal: new Array(n).fill(0),
    peaks: new Array(2000).fill(peak),
    sections: [{ start: 0, end: duration, energy: 0 }],
  };
}

describe("round 19 · silence guard", () => {
  it("near silence is RMS under about −60 dBFS over most of the file", () => {
    expect(isNearlySilent(silentAnalysis())).toBe(true);
    expect(isNearlySilent(demoAnalysis())).toBe(false);
    expect(isNearlySilent(null)).toBe(false);
    // a song with a long quiet intro is not silent
    const a = silentAnalysis(200);
    a.peaks = a.peaks.map((p, i) => (i > 1000 ? 0.5 : p));
    expect(isNearlySilent(a)).toBe(false);
    // no waveform: an all-zero energy envelope
    expect(isNearlySilent({ peaks: [], energy: [0, 0, 0] })).toBe(true);
  });

  it("the designer invents no sections, choruses or climaxes for a silent file", () => {
    const input = { ...demoInput(), meta: demoMeta({ duration: 1500 }), analysis: silentAnalysis() };
    const st = analyzeStructure(input);
    expect(st.silent).toBe(true);
    expect(st.sections).toHaveLength(1);
    const plan = offlineDesign(input);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections.some((s) => s.kind === "chorus")).toBe(false);
    const text = [plan.keyVisual.concept, plan.designerNotes, ...plan.cues.map((c) => `${c.title} ${c.detail}`)].join("\n");
    expect(text).not.toMatch(/最高點|副歌|爆點/);
    expect(plan.keyVisual.concept).toContain("這個音檔幾乎沒有聲音");
    expect(plan.designerNotes).toContain("這個音檔幾乎沒有聲音");
  });

  it("does not ask Claude to design a silent file", async () => {
    const transport: ClaudeTransport = {
      stream: () => {
        throw new Error("Claude must not be called for a silent file");
      },
    };
    const logs: string[] = [];
    const plan = await designSong({ ...demoInput(), meta: demoMeta({ duration: 1500 }), analysis: silentAnalysis(), research: null }, { onLog: (m) => logs.push(m) }, { transport, configured: true });
    expect(plan.sections).toHaveLength(1);
    expect(logs.join("\n")).toContain("這個音檔幾乎沒有聲音");
  });
});

describe("round 19 · the energy floor in the designer's words", () => {
  it("a song whose level never rises gets no 最高點", () => {
    const analysis = demoAnalysis();
    // every section at about the same level
    analysis.energy = analysis.energy.map(() => 0.75);
    analysis.sections = analysis.sections.map((s) => ({ ...s, energy: 0.75 }));
    const input = { ...demoInput(), analysis };
    expect(analyzeStructure(input).flat).toBe(true);
    const plan = offlineDesign(input);
    expect(`${plan.keyVisual.concept}\n${plan.designerNotes}`).not.toContain("最高點");
    expect(plan.designerNotes).toContain("沒有真正的高潮");
  });
});
