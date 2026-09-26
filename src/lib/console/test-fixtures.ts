// Small hand-made plan / lyrics used by the console unit tests.

import type { DesignPlan, Lyrics, SectionDesign } from "@/lib/types";

export function section(id: string, start: number, end: number, over: Partial<SectionDesign> = {}): SectionDesign {
  return {
    id,
    kind: "verse",
    label: id,
    start,
    end,
    energy: 0.5,
    scene: "nebula",
    sceneParams: { speed: 0.5, density: 0.5, intensity: 0.5, audioReactivity: 0.5 },
    colorway: ["#101018", "#4455cc", "#ff5a36"],
    lyricStyle: "line-fade",
    lyricPlacement: "center",
    lyricScale: 1,
    lyricColor: "#ffffff",
    transitionIn: "fade",
    rationale: "",
    ...over,
  };
}

export function testPlan(sections: SectionDesign[] = [section("s0", 0, 8), section("s1", 8, 24), section("s2", 24, 40)]): DesignPlan {
  return {
    version: 1,
    keyVisual: {
      title: "測試",
      concept: "",
      moodKeywords: [],
      palette: [
        { hex: "#101018", role: "背景", name: "夜" },
        { hex: "#4455cc", role: "主色", name: "藍" },
      ],
      motifs: [],
      motifSvg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="currentColor"/></svg>',
      typography: { cjkFont: "noto-sans-tc", latinFont: "space-grotesk", weight: 700, letterSpacing: 0.02, rationale: "" },
    },
    sections,
    lines: [],
    cues: [
      { time: 24, title: "副歌", detail: "", kind: "drop" },
      { time: 8, title: "主歌", detail: "", kind: "transition" },
    ],
    designerNotes: "",
  };
}

/** l0 8s, l1 12s, l2 untimed, l3 16s, l4 26s */
export function testLyrics(): Lyrics {
  return {
    source: "user",
    synced: false,
    lines: [
      { id: "l0", text: "第一句", start: 8, end: 11 },
      { id: "l1", text: "第二句", start: 12, end: null },
      { id: "l2", text: "沒有時間", start: null, end: null },
      { id: "l3", text: "第四句", start: 16, end: 20 },
      { id: "l4", text: "副歌", start: 26, end: 30 },
    ],
  };
}
