// Round 11 — the designer sounds like a designer: concept skeletons chosen from the findings, titles
// unique in the library, palette colour names that never collide, evidence-gated cues, the lexicon
// reading 牆 as a wall and one 「安靜」 as no emotion, sing-along phrases snapped to phrase boundaries,
// 歌手 vs 樂團 from the MusicBrainz artist type, one scene label source, and the 強調 chips from the
// type system. The seven audit songs are the fixtures (testing/audit-songs.ts).

import { describe, expect, it } from "vitest";
import { DesignPlanSchema } from "@/lib/schema";
import { SCENE_LABELS } from "@/lib/stage/scenes/labels";
import { SCENE_LABELS as CONSOLE_SCENE_LABELS } from "@/lib/console/labels";
import { SCENE_LABEL as PROCESS_SCENE_LABEL } from "@/components/process/labels";
import { shownEmphasis } from "@/lib/type/resolve";
import type { Lyrics, SectionDesign } from "@/lib/types";
import { artistKindLabel } from "@/lib/server/research/musicbrainz";
import { SCENES } from "./catalog";
import { colorName, colorNames } from "./color";
import { buildConcept, chooseSkeleton, makeTitle, titleCandidates, SHORT_SONG_SECONDS, type ConceptContext } from "./concept";
import { CHECK_MIN_DURATION, genericCues, suggestCues, transitionWording } from "./cues";
import { analyzeFindings } from "./findings";
import { freeBrief } from "./free-research";
import { IMAGERY_FAMILIES } from "./lexicon/imagery";
import { estimateEmotion, findImageryFamilies, singalongPhrases } from "./lyric-analysis";
import { buildPalette } from "./palette";
import { isCalmSong, offlineDesign, offlineResearch } from "./offline";
import { sceneForms } from "./scene-program";
import { analyzeStructure } from "./structure";
import { demoAnalysis, demoInput, demoMeta } from "./testing/fixtures";
import { AUDIT_SONGS, auditInput, auditSong } from "./testing/audit-songs";

const plans = new Map(AUDIT_SONGS.map((s) => [s.key, offlineDesign(auditInput(s))] as const));
const plan = (key: string) => plans.get(key)!;
const opening = (concept: string) => concept.split(/[。：—]/)[0];

describe("M1 · concept skeletons, titles, motifs, colour names", () => {
  it("the seven audit songs get at least five distinct openings and share no motif", () => {
    const openings = new Set(AUDIT_SONGS.map((s) => opening(plan(s.key).keyVisual.concept)));
    expect(openings.size).toBeGreaterThanOrEqual(5);
    const skeletons = new Set(AUDIT_SONGS.map((s) => chooseSkeleton(ctxOf(s.key))));
    expect(skeletons.size).toBeGreaterThanOrEqual(5);
    const shared = plan("demo").keyVisual.motifs.filter((m) => AUDIT_SONGS.every((s) => plan(s.key).keyVisual.motifs.includes(m)));
    expect(shared).toEqual([]);
    for (const s of AUDIT_SONGS) {
      const c = plan(s.key).keyVisual.concept;
      expect(c).not.toContain("視覺始終是配角");
      expect(c).not.toContain("律動的幾何線條");
      expect(c).not.toMatch(/這首約 \d+ BPM、/);
    }
  });

  it("chooses the skeleton from the evidence: chant, ballad, story, groove, two peaks, slow build, instrumental", () => {
    expect(chooseSkeleton(ctxOf("punk"))).toBe("chant");
    expect(chooseSkeleton(ctxOf("ballad"))).toBe("ballad");
    expect(chooseSkeleton(ctxOf("folk"))).toBe("story");
    expect(chooseSkeleton(ctxOf("citypop"))).toBe("groove");
    expect(chooseSkeleton(ctxOf("demo"))).toBe("two-peaks");
    expect(chooseSkeleton(ctxOf("longlines"))).toBe("slow-build");
    expect(chooseSkeleton(ctxOf("instrumental"))).toBe("instrumental");
  });

  it("the concept's words come from the findings, never from a fixed filler", () => {
    expect(plan("punk").keyVisual.concept).toContain("拆掉這面牆");
    expect(plan("punk").keyVisual.concept).toContain("「牆」");
    expect(plan("ballad").keyVisual.concept).toContain("不閃白");
    expect(plan("instrumental").keyVisual.concept).not.toMatch(/主唱把|留給主唱|合唱|歌詞是/);
    expect(plan("demo").keyVisual.concept).toContain("跟著我唱");
    for (const s of AUDIT_SONGS) expect(plan(s.key).keyVisual.motifs.length).toBeGreaterThanOrEqual(2);
    expect(plan("instrumental").keyVisual.motifs).toContain("長曝光的光軌");
  });

  it("the BPM / arc sentence only when the tempo is confident and the song long enough", () => {
    expect(plan("demo").keyVisual.concept).toContain("約 120 BPM");
    const shaky = offlineDesign({ ...auditInput(auditSong("demo")), analysis: { ...demoAnalysis(), bpmConfidence: 0.2 } });
    expect(shaky.keyVisual.concept).not.toContain("BPM");
  });

  it("titles come from imagery and emotion and stay unique in the library", () => {
    const titles = AUDIT_SONGS.map((s) => plan(s.key).keyVisual.title);
    expect(new Set(titles).size).toBe(titles.length);
    const ctx = ctxOf("ballad");
    const first = makeTitle(ctx, "ballad", []);
    const second = makeTitle(ctx, "ballad", [first]);
    expect(second).not.toBe(first);
    expect(titleCandidates(ctx, "ballad")).toContain(first);
    const all = titleCandidates(ctx, "ballad");
    const last = makeTitle(ctx, "ballad", all);
    expect(all).not.toContain(last);
    // the designer input carries the library's titles
    const taken = offlineDesign({ ...auditInput(auditSong("ballad")), takenTitles: [plan("ballad").keyVisual.title] });
    expect(taken.keyVisual.title).not.toBe(plan("ballad").keyVisual.title);
    for (const t of titles) expect(Array.from(t).length).toBeLessThanOrEqual(12);
  });

  it("two palette roles never share a colour name", () => {
    for (const s of AUDIT_SONGS) {
      const names = plan(s.key).keyVisual.palette.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
    }
    // a post-rock palette (two blues) used to read 「湛藍與湛藍」
    const p = buildPalette({ hue: 215, scheme: "analogous", saturation: 0.55, brightness: 0.3, hues: [200, 35] });
    expect(new Set(p.map((c) => c.name)).size).toBe(p.length);
    expect(colorName("#3a6fb0", ["湛藍光"])).not.toBe("湛藍光");
    expect(colorNames("#3a6fb0")[0]).toBe(colorName("#3a6fb0"));
    expect(colorNames("#3a6fb0").length).toBeGreaterThanOrEqual(4);
  });
});

describe("M2 · evidence-gated cues", () => {
  const cues = (key: string) => plan(key).cues;
  const text = (key: string) => cues(key).map((c) => `${c.title} ${c.detail}`).join("\n");

  it("a calm song (the ballad, the folk) never gets a flash cue or 「推到 1.2」", () => {
    for (const key of ["ballad", "folk", "instrumental"]) {
      expect(isCalmSong(analyzeFindings(auditInput(auditSong(key))))).toBe(true);
      expect(text(key)).not.toMatch(/閃白進|推到 1\.2/);
      expect(plan(key).sections.every((s) => s.transitionIn !== "flash")).toBe(true);
    }
    expect(text("punk")).toContain("推到 1.2");
  });

  it("names the section's actual transition: 淡入 when LED 安全模式 converts a flash", () => {
    expect(transitionWording("flash")).toContain("淡入");
    expect(transitionWording("flash")).toContain("閃白");
    expect(transitionWording("flash", false)).toBe("閃白");
    expect(transitionWording("wipe")).toBe("擦除");
    const drop = cues("demo").find((c) => c.kind === "drop")!;
    expect(drop.detail).toMatch(/^淡入/);
    expect(drop.detail).toContain(SCENE_LABELS[plan("demo").sections.find((s) => s.label === drop.title.replace("爆點", ""))!.scene]);
  });

  it("a 爆點 needs an energy rise of 0.25, a 合唱 two choruses and lyrics", () => {
    const sections = plan("demo").sections;
    const flat = sections.map((s) => ({ ...s, energy: 0.5 }));
    expect(suggestCues(flat, 73, auditInput(auditSong("demo")).lyrics.lines).some((c) => c.kind === "drop")).toBe(false);
    const oneChorus = sections.map((s, i): SectionDesign => (s.kind === "chorus" && i > 2 ? { ...s, kind: "bridge" } : s));
    expect(suggestCues(oneChorus, 73, auditInput(auditSong("demo")).lyrics.lines).some((c) => c.kind === "singalong")).toBe(false);
    expect(cues("demo").filter((c) => c.kind === "singalong").length).toBe(2);
  });

  it("an instrumental gets no cue about a singer", () => {
    expect(text("instrumental")).not.toMatch(/主唱|合唱|歌詞|口號/);
    expect(cues("instrumental").some((c) => c.kind === "singalong")).toBe(false);
    for (const s of plan("instrumental").sections) expect(s.rationale).not.toMatch(/主唱|合唱/);
  });

  it("a 3 s clip gets no 開場, no 中段檢查, no 結束 and one minimal section with a warning", () => {
    const clip = offlineDesign(clipInput());
    expect(DesignPlanSchema.safeParse(clip).success).toBe(true);
    expect(clip.sections.length).toBe(1);
    expect(clip.cues.map((c) => c.title)).not.toContain("中段檢查");
    expect(clip.cues.map((c) => c.title)).not.toContain("開場");
    expect(clip.keyVisual.concept).toContain("分析不可靠");
    expect(clip.keyVisual.concept).not.toContain("BPM");
    expect(clip.designerNotes).toContain("音檔太短，分析不可靠");
    expect(clip.designerNotes).not.toContain("副歌一次比一次");
    expect(genericCues(3)).toEqual([]);
    expect(genericCues(CHECK_MIN_DURATION).map((c) => c.title)).toEqual(["開場", "中段檢查"]);
    expect(SHORT_SONG_SECONDS).toBeGreaterThan(3);
  });
});

describe("M5 · lexicon", () => {
  it("牆 is a wall (water-grey, cracks, pillars / strata), not a window; 門 and 窗 are apart", () => {
    const wall = IMAGERY_FAMILIES.find((f) => f.id === "wall")!;
    expect(wall.name).toBe("牆");
    expect(wall.colors).toContain("水泥灰");
    expect(wall.forms).toEqual(["pillars", "strata"]);
    expect(IMAGERY_FAMILIES.find((f) => f.id === "window")!.words).not.toContain("門");
    expect(IMAGERY_FAMILIES.find((f) => f.id === "door")!.words).not.toContain("窗");
    const punk = findImageryFamilies(auditSong("punk").lines!.map(([, t]) => t), "拆掉這面牆");
    expect(punk[0].family.id).toBe("wall");
    expect(punk[0].count).toBe(14);
    expect(plan("punk").keyVisual.motifs).toContain("水泥牆上的裂縫");
    expect(plan("punk").keyVisual.motifs.join()).not.toContain("窗");
    // the wall's forms enter the composer's form order right after the genre's (the pick itself is round C)
    expect(sceneForms(analyzeFindings(auditInput(auditSong("punk")))).slice(0, 4)).toContain("pillars");
    const ballad = findImageryFamilies(auditSong("ballad").lines!.map(([, t]) => t)).map((h) => h.family.id);
    expect(ballad).toContain("window");
    expect(ballad).toContain("door");
  });

  it("an emotion needs two independent sentiment words", () => {
    expect(estimateEmotion(["他們說安靜 他們說聽話", "拆掉這面牆"]).label).toBe("情緒不明顯");
    expect(estimateEmotion(["安靜的夜", "安靜的你", "安靜地走"]).label).toBe("情緒不明顯");
    expect(estimateEmotion(["安靜的夜", "溫柔的你"]).label).not.toBe("情緒不明顯");
    const f = analyzeFindings(auditInput(auditSong("punk")));
    expect(f.lyrics.emotion.label).toBe("情緒不明顯");
    expect(plan("punk").keyVisual.concept).not.toContain("矛盾拉扯");
  });

  it("sing-along phrases snap to phrase boundaries and prefer the whole line when it repeats", () => {
    const phrasesOf = (key: string) => {
      const input = auditInput(auditSong(key));
      return singalongPhrases(input.lyrics.lines, analyzeStructure(input)).map((p) => p.text);
    };
    expect(phrasesOf("punk")).toEqual(["拆掉這面牆", "讓光進來", "Hey Hey Hey"]);
    expect(phrasesOf("folk")[0]).toBe("lay me down");
    expect(phrasesOf("citypop")[0]).toBe("Midnight avenida");
    expect(phrasesOf("longlines")).toContain("我們還醒著");
    const cut = ["掉這面牆", "拆掉這面", "讓光進", "算整個世界", "Oh, lay me", "me down", "where the", "avenida, llévame"];
    for (const key of ["punk", "folk", "citypop", "longlines"]) for (const p of phrasesOf(key)) expect(cut).not.toContain(p);
    // a whole repeated line is quoted whole, a long one never
    const punkInput = auditInput(auditSong("punk"));
    expect(singalongPhrases(punkInput.lyrics.lines, analyzeStructure(punkInput))[0]).toMatchObject({ text: "拆掉這面牆", whole: true, count: 12 });
    for (const p of phrasesOf("longlines")) expect(Array.from(p).length).toBeLessThanOrEqual(12);
  });

  it("a solo singer is 歌手, a group 樂團, an unknown type 音樂人", () => {
    expect(artistKindLabel("Person")).toBe("歌手");
    expect(artistKindLabel("Group")).toBe("樂團");
    expect(artistKindLabel(undefined)).toBe("音樂人");
    expect(artistKindLabel("Orchestra")).toBe("管弦樂團");
    expect(plan("ballad").keyVisual.concept).toContain("林晚晴是臺灣臺北的流行歌手");
    expect(plan("ballad").keyVisual.concept).not.toContain("流行樂團");
    expect(plan("punk").keyVisual.concept).toContain("龐克樂團");
    const input = auditInput(auditSong("ballad"));
    const brief = freeBrief(input, analyzeFindings(input), analyzeStructure(input));
    expect(brief).toContain("**林晚晴**：臺灣臺北的歌手");
  });
});

describe("M9 · one label source, real 強調", () => {
  it("the timeline, the design tab and the designer's catalogue share one scene label", () => {
    for (const id of Object.keys(SCENE_LABELS) as Array<keyof typeof SCENE_LABELS>) {
      expect(CONSOLE_SCENE_LABELS[id]).toBe(SCENE_LABELS[id]);
      expect(PROCESS_SCENE_LABEL[id]).toBe(SCENE_LABELS[id]);
      expect(SCENES[id].label).toBe(SCENE_LABELS[id]);
    }
    expect(plan("demo").sections.some((s) => s.rationale.includes(`「${SCENE_LABELS[s.scene]}」`))).toBe(true);
  });

  it("強調 chips come from the type system's resolved hint, one word for a giant-word line", () => {
    const input = auditInput(auditSong("demo"));
    const p = plan("demo");
    const lines = input.lyrics.lines;
    const idx = lines.findIndex((l) => l.text.startsWith("Hey"));
    const shown = shownEmphasis(p, lines, idx, 73, input.meta.title);
    expect(shown.length).toBeGreaterThan(0);
    const hint = p.typeSystem!.lines.find((l) => l.lineId === lines[idx].id)!;
    for (const e of shown) expect(hint.emphasis).toContain(e);
    if (["giant-word", "bleed", "window"].includes(hint.recipe)) expect(shown).toEqual(hint.emphasis.slice(0, 1));
    // an edit in the type editor wins
    const edited = { ...p, typeSystem: { ...p.typeSystem!, lines: p.typeSystem!.lines.map((l) => (l.lineId === lines[idx].id ? { ...l, edit: { emphasis: ["唱"] } } : l)) } };
    expect(shownEmphasis(edited, lines, idx, 73, input.meta.title)).toEqual(["唱"]);
    // without a type system the plan's line design speaks
    expect(shownEmphasis({ ...p, typeSystem: undefined }, lines, idx, 73)).toEqual(p.lines.find((l) => l.lineId === lines[idx].id)!.emphasis);
  });
});

describe("m9 / m10 · short clip and stub-down wording", () => {
  it("the free brief warns about a short clip and never emits an empty field", () => {
    const input = clipInput();
    const brief = freeBrief(input, analyzeFindings(input), analyzeStructure(input));
    expect(brief).toContain("音檔太短，分析不可靠");
    expect(brief).not.toMatch(/：\s*。/);
    expect(brief).not.toContain("一個簡單的幾何符號");
  });

  it("a stub-down brief (no public facts, no imagery) fills 母題 and 場景 from the mood lexicon", () => {
    const input = { ...demoInput(), meta: demoMeta({ title: "無題", artist: "無名" }), lyrics: { source: "none", synced: false, lines: [] } as Lyrics, publicInfo: null };
    const brief = freeBrief(input, analyzeFindings(input), analyzeStructure(input));
    expect(brief).not.toMatch(/場景：\s*。/);
    expect(brief).not.toMatch(/母題：\s*。/);
    expect(brief).not.toContain("一個簡單的幾何符號");
    expect(brief).toMatch(/場景：.+/);
    const r = offlineResearch(input);
    expect(r.brief).not.toContain("一個簡單的幾何符號");
  });
});

// ---------------------------------------------------------------------------

function ctxOf(key: string): ConceptContext {
  const input = auditInput(auditSong(key));
  const p = plan(key);
  const findings = analyzeFindings(input);
  return {
    title: p.keyVisual.title,
    songTitle: input.meta.title,
    artist: input.meta.artist,
    findings,
    structure: analyzeStructure(input),
    imagery: [],
    palette: p.keyVisual.palette,
    bpm: 120,
    bpmConfidence: 0.9,
    seed: 1,
    hasLyrics: input.lyrics.lines.length > 0,
  };
}

function clipInput() {
  const a = demoAnalysis();
  const n = 3 * a.envelopeRate;
  return {
    meta: demoMeta({ title: "短片段", artist: "測試樂團", duration: 3 }),
    lyrics: { source: "none", synced: false, lines: [] } as Lyrics,
    analysis: { ...a, duration: 3, energy: a.energy.slice(0, n), onset: a.onset.slice(0, n), brightness: a.brightness.slice(0, n), bass: a.bass.slice(0, n), beats: a.beats.filter((b) => b < 3), sections: [{ start: 0, end: 3, energy: 0.6 }] },
  };
}

it("buildConcept is deterministic", () => {
  const c = ctxOf("demo");
  expect(buildConcept(c)).toBe(buildConcept(c));
});
