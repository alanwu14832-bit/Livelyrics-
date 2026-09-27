import { describe, expect, it } from "vitest";
import { defaultBible } from "@/lib/band";
import type { BandBible, DesignPlan, SongArcDirective } from "@/lib/types";
import { applyArc, arcCurve, offlineArc, type ArcSong } from "./arc";
import { derivePalette, offlineBible } from "./bible";
import { applyLyricPolicy, biasScenes } from "./bible-style";
import { designSong, generateBible, planShowArc } from "./index";
import { offlineDesign } from "./offline";
import { buildDesignPrompt, buildResearchPrompt } from "./prompts";
import { analyzeStructure } from "./structure";
import { demoInput } from "./testing/fixtures";
import { fakeTransport, message, text } from "./testing/fake-claude";

const bible: BandBible = {
  ...defaultBible(),
  summary: "## 世界觀\n霧中的港口，一盞燈。",
  palette: [
    { hex: "#08121a", role: "背景", name: "深港" },
    { hex: "#1f6f8b", role: "主色", name: "潮藍" },
    { hex: "#e8a33d", role: "點綴", name: "燈火" },
    { hex: "#f3efe6", role: "歌詞", name: "霧白" },
    { hex: "#9fd8cb", role: "高光", name: "海光" },
  ],
  fonts: { cjkFont: "noto-serif-tc", latinFont: "playfair-display", weight: 800 },
  motifs: ["燈塔", "潮汐"],
  sceneAffinity: ["ink", "rain"],
  sceneAvoid: ["tunnel", "grid"],
  lyricPolicy: { mode: "chorus-only", note: "" },
  treatments: ["grain-film"],
  source: { engine: "manual", updatedAt: "2026-01-01T00:00:00.000Z" },
};

describe("offline design with a band bible", () => {
  it("uses the bible palette, fonts, scene affinity / avoid and lyric policy", () => {
    const plan = offlineDesign(demoInput({ bible, bandName: "港口" }));
    const hexes = bible.palette.map((c) => c.hex);
    for (const c of plan.keyVisual.palette) expect(hexes).toContain(c.hex);
    for (const s of plan.sections) for (const c of s.colorway) expect(hexes).toContain(c);
    expect(plan.keyVisual.typography.cjkFont).toBe("noto-serif-tc");
    expect(plan.keyVisual.typography.latinFont).toBe("playfair-display");
    expect(plan.keyVisual.typography.weight).toBe(800);
    expect(plan.sections.some((s) => s.scene === "tunnel" || s.scene === "grid")).toBe(false);
    expect(plan.sections.some((s) => s.scene === "ink" || s.scene === "rain")).toBe(true);
    // chorus-only: every non-chorus section hides lyrics
    for (const s of plan.sections) if (s.kind !== "chorus") expect(s.lyricStyle).toBe("hidden");
    expect(plan.sections.some((s) => s.kind === "chorus" && s.lyricStyle !== "hidden")).toBe(true);
    expect(plan.keyVisual.motifs.slice(0, 2)).toEqual(["燈塔", "潮汐"]);
  });

  it("without a bible the plan is unchanged", () => {
    expect(offlineDesign(demoInput({ bible: defaultBible() }))).toEqual(offlineDesign(demoInput()));
  });

  it("lyric policy full shows every vocal section; minimal keeps only the hook", () => {
    const pick = { style: "hidden" as const, placement: "center" as const, scale: 1 };
    const full = { ...bible, lyricPolicy: { mode: "full" as const, note: "" } };
    expect(applyLyricPolicy(pick, { kind: "verse", energy: 0.4, hasLines: true }, { bible: full, isLastChorus: false, isLoudest: false, hasChorus: true }).style).toBe("subtitle");
    const minimal = { ...bible, lyricPolicy: { mode: "minimal" as const, note: "" } };
    const karaoke = { style: "karaoke" as const, placement: "center" as const, scale: 1.1 };
    expect(applyLyricPolicy(karaoke, { kind: "chorus", energy: 0.9, hasLines: true }, { bible: minimal, isLastChorus: false, isLoudest: false, hasChorus: true }).style).toBe("hidden");
    expect(applyLyricPolicy(karaoke, { kind: "chorus", energy: 0.9, hasLines: true }, { bible: minimal, isLastChorus: true, isLoudest: true, hasChorus: true }).style).toBe("impact");
    expect(biasScenes(["particles", "ink", "tunnel"], bible)).toEqual(["ink", "particles"]);
  });

  it("preferred treatments replace the defaults, but the logo stays whole", () => {
    const logo = { id: "aaaaaaaaaaaa", kind: "logo" as const, name: "logo", mimeType: "image/png", file: "aaaaaaaaaaaa.png", width: 1, height: 1, bytes: 1, createdAt: "" };
    const photo = { ...logo, id: "bbbbbbbbbbbb", kind: "image" as const, name: "live photo", file: "bbbbbbbbbbbb.png" };
    const plan = offlineDesign(demoInput({ bible, assets: [logo, photo] }));
    const media = plan.sections.map((s) => s.media).filter((m) => m != null);
    expect(media.length).toBeGreaterThan(0);
    for (const m of media) {
      if (m!.assetId === logo.id) expect(m!.treatment).toBe("full");
      else expect(m!.treatment).toBe("grain-film");
    }
  });

  it("puts the bible into both prompts as a hard constraint, and the arc into the design prompt", () => {
    const input = demoInput({ bible, bandName: "港口" });
    const st = analyzeStructure(input);
    const research = buildResearchPrompt(input, st);
    expect(research).toContain("樂團視覺聖經");
    expect(research).toContain("#1f6f8b");
    const arc: SongArcDirective = { showName: "港口巡演", position: 2, total: 8, role: "breather", energy: 0.4, emphasis: "shadow", note: "喘一口氣" };
    const design = buildDesignPrompt({ ...input, research: null, arc }, st);
    expect(design).toContain("硬性規範");
    expect(design).toContain("避免場景");
    expect(design).toContain("第 3 首（共 8 首）");
    expect(buildDesignPrompt({ ...demoInput(), research: null }, st)).not.toContain("樂團視覺聖經（硬性規範）");
  });
});

function planWith(palette: string[], over: Partial<DesignPlan["keyVisual"]["typography"]> = {}, scenes: DesignPlan["sections"][number]["scene"][] = ["ink"]): DesignPlan {
  const base = offlineDesign(demoInput());
  return {
    ...base,
    keyVisual: { ...base.keyVisual, palette: palette.map((hex) => ({ hex, role: "r", name: "n" })), typography: { ...base.keyVisual.typography, ...over }, motifs: ["燈塔", "海"] },
    sections: base.sections.map((s, i) => ({ ...s, scene: scenes[i % scenes.length] })),
  };
}

describe("bible derivation (offline)", () => {
  it("finds the recurring palette, fonts, scenes and motifs", () => {
    const a = planWith(["#050a10", "#1f6f8b", "#e8a33d", "#f5f5f0"], { cjkFont: "noto-serif-tc", latinFont: "playfair-display", weight: 800 }, ["ink", "rain"]);
    const b = planWith(["#070b12", "#22708f", "#eaa53f", "#fafaf5"], { cjkFont: "noto-serif-tc", latinFont: "bebas-neue", weight: 700 }, ["ink"]);
    const c = planWith(["#0a0a0a", "#1d6e8a", "#ff0077", "#ffffff"], { cjkFont: "huninn", latinFont: "playfair-display", weight: 900 }, ["ink", "nebula"]);
    const pal = derivePalette([a, b, c]);
    expect(pal[0].hex).toBe("#050a10");
    expect(pal.length).toBeGreaterThanOrEqual(4);
    expect(pal.length).toBeLessThanOrEqual(8);
    expect(pal.some((p) => p.hex === "#ffffff")).toBe(true);

    const bible = offlineBible({ bandName: "港口", songs: [a, b, c].map((plan, i) => ({ title: `歌${i}`, plan, research: null, energy: 0.5 })), assets: [] }, new Date("2026-09-01T00:00:00Z"));
    expect(bible.fonts.cjkFont).toBe("noto-serif-tc");
    expect(bible.fonts.latinFont).toBe("playfair-display");
    expect(bible.fonts.weight).toBe(800);
    expect(bible.sceneAffinity[0]).toBe("ink");
    expect(bible.motifs.slice(0, 2)).toEqual(["燈塔", "海"]);
    expect(bible.summary).toContain("## 世界觀");
    expect(bible.summary).toContain("## 禁忌");
    expect(bible.source?.engine).toBe("offline");
    expect(bible.dos.length).toBeGreaterThan(0);
  });

  it("with no songs writes a starting point and keeps what exists", () => {
    const b = offlineBible({ bandName: "新團", songs: [], assets: [{ id: "abcdefabcdef", kind: "video", name: "mv", mimeType: "video/mp4", file: "abcdefabcdef.mp4", width: 1, height: 1, bytes: 1, createdAt: "", duration: 3 }] });
    expect(b.palette).toEqual([]);
    expect(b.summary).toContain("新團");
    expect(b.treatments).toContain("beat-cut");
  });

  it("generateBible uses Claude's structured draft when configured", async () => {
    const draft = {
      summary: "## 世界觀\n霧港\n## 氣質\n冷\n## 禁忌\n不要霓虹",
      palette: [{ hex: "#000000", role: "背景", name: "黑" }, { hex: "#123456", role: "主色", name: "藍" }, { hex: "#abcdef", role: "高光", name: "光" }, { hex: "#ffffff", role: "歌詞", name: "白" }],
      fonts: { cjkFont: "anton", latinFont: "bebas-neue", weight: 800 },
      motifs: ["霧"],
      treatments: ["duotone"],
      sceneAffinity: ["ink"],
      sceneAvoid: ["grid"],
      lyricPolicy: { mode: "minimal", note: "" },
      dos: ["a"],
      donts: ["b"],
    };
    const t = fakeTransport([message([text(JSON.stringify(draft))], "end_turn", { model: "claude-test" })]);
    const b = await generateBible({ bandName: "港口", songs: [], assets: [] }, {}, { configured: true, transport: t, model: "claude-test" });
    expect(b.source?.engine).toBe("claude");
    expect(b.lyricPolicy.mode).toBe("minimal");
    // a Latin font offered as CJK falls back to a CJK one
    expect(b.fonts.cjkFont).not.toBe("anton");
    expect(t.calls[0].output_config?.format?.type).toBe("json_schema");
    // failure -> offline heuristic
    const failing = fakeTransport([new Error("boom")]);
    expect((await generateBible({ bandName: "x", songs: [], assets: [] }, {}, { configured: true, transport: failing })).source?.engine).toBe("offline");
  });
});

const song = (i: number, energy: number): ArcSong => ({ itemId: `i${i}`, projectId: `p${i}`, title: `歌${i}`, energy, bpm: 120, duration: 240 });

describe("show arc", () => {
  it("opens, breathes past the middle, peaks, and saves the biggest for the finale", () => {
    const songs = [0.7, 0.6, 0.65, 0.8, 0.3, 0.75, 0.9, 0.6].map((e, i) => song(i, e));
    const arc = offlineArc({ showName: "巡演", bandName: "港口", bible, songs }, new Date("2026-01-01T00:00:00Z"));
    expect(arc.songs.map((s) => s.role)).toEqual(["opener", "build", "build", "build", "breather", "build", "peak", "finale"]);
    const finale = arc.songs[7];
    expect(finale.energy).toBe(1);
    expect(finale.emphasis).toBe("highlight");
    for (const s of arc.songs.slice(0, 7)) expect(s.energy).toBeLessThan(1);
    expect(arc.songs[4].emphasis).toBe("shadow");
    expect(arc.songs[4].energy).toBeLessThanOrEqual(0.45);
    expect(arc.overview).toContain("配色的走向");
    expect(arcCurve(1)).toBeGreaterThan(arcCurve(0.6));
    expect(offlineArc({ showName: "單曲", bandName: "", bible: null, songs: [song(0, 0.5)] }).songs[0].role).toBe("finale");
  });

  it("applyArc holds the tunnel for the finale and follows the energy", () => {
    const input = demoInput({ bible: { ...bible, sceneAvoid: [] } });
    const base = { ...offlineDesign(input) };
    base.sections = base.sections.map((s) => (s.kind === "chorus" ? { ...s, scene: "tunnel" as const } : s));
    const early: SongArcDirective = { showName: "巡演", position: 1, total: 8, role: "build", energy: 0.5, emphasis: "primary", note: "" };
    const e = applyArc(base, early, input);
    expect(e.sections.some((s) => s.scene === "tunnel")).toBe(false);
    for (const s of e.sections) expect(s.sceneParams.intensity).toBeLessThanOrEqual(0.88);
    const fin = applyArc(base, { ...early, role: "finale", energy: 1, emphasis: "highlight", position: 7 }, input);
    expect(fin.sections.some((s) => s.scene === "tunnel" && s.sceneParams.intensity === 1)).toBe(true);
    expect(fin.designerNotes).toContain("## 整場弧線");
    for (const s of fin.sections) for (const c of s.colorway) expect(fin.keyVisual.palette.map((p) => p.hex)).toContain(c);
  });

  it("designSong offline applies the arc directive", async () => {
    const input = demoInput({ bible });
    const plan = await designSong({ ...input, research: null, arc: { showName: "巡演", position: 0, total: 6, role: "opener", energy: 0.6, emphasis: "primary", note: "開場" } });
    expect(plan.designerNotes).toContain("第 1 首（共 6 首）");
  });

  it("planShowArc takes Claude's notes and fills songs it skipped", async () => {
    const songs = [song(0, 0.5), song(1, 0.6), song(2, 0.9)];
    const t = fakeTransport([message([text(JSON.stringify({ overview: "## 弧線\n好", songs: [{ itemId: "i1", role: "peak", energy: 2, emphasis: "accent", note: "高" }, { itemId: "nope", role: "build", energy: 0.1, emphasis: "primary", note: "" }] }))], "end_turn")]);
    const arc = await planShowArc({ showName: "s", bandName: "b", bible: null, songs }, {}, { configured: true, transport: t });
    expect(arc.engine).toBe("claude");
    expect(arc.songs.map((s) => s.role)).toEqual(["opener", "peak", "finale"]);
    expect(arc.songs[1].energy).toBe(1);
    expect(arc.overview).toBe("## 弧線\n好");
  });
});
