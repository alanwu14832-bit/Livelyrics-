// 免費研究 end to end, without the network: the brief from the saved MusicBrainz / Wikipedia responses
// (and when every source fails), the progress it streams, determinism, the cache, and how the
// findings change the offline plan and the offline directions (by genre and by lyrics).

import { describe, expect, it } from "vitest";
import type { Lyrics, Research } from "@/lib/types";
import { researchSong } from ".";
import { offlineDirectionSpecs } from "./directions";
import { analyzeFindings } from "./findings";
import { freeResearch } from "./free-research";
import { offlineDesign } from "./offline";
import { RESEARCH_HEADINGS } from "./prompts";
import { demoInput, demoMeta } from "./testing/fixtures";
import { caodongFetch, downFetch, publicInfoWith, TEST_LOOKUP } from "./testing/public-sources";
import type { DesignerInput } from "./types";

const NOW = () => new Date("2026-09-29T08:00:00.000Z");

function callbacks() {
  const logs: string[] = [];
  const searches: string[] = [];
  let text = "";
  return {
    logs,
    searches,
    text: () => text,
    cb: { onLog: (m: string) => logs.push(m), onDelta: (t: string) => (text += t), onSearch: (q: string) => searches.push(q) },
  };
}

/** 〈大風吹〉 by 草東沒有派對, with the demo song's lyrics and analysis. */
function caodongInput(overrides: Partial<DesignerInput> = {}): DesignerInput {
  return demoInput({ meta: demoMeta({ title: "大風吹", artist: "草東沒有派對" }), ...overrides });
}

function withLyrics(input: DesignerInput, texts: string[]): DesignerInput {
  const lyrics: Lyrics = { ...input.lyrics, lines: input.lyrics.lines.map((l, i) => ({ ...l, text: texts[i] ?? l.text })) };
  return { ...input, lyrics };
}

const SEA_LYRICS = [
  "海浪拍打著沉默的礁石",
  "潮水帶走了我們的名字",
  "浪花在月光下碎成星星",
  "我們在海邊等待天亮",
  "Hey 跟著我唱",
  "把心跳交給這片海洋",
  "就算潮水再大再遠",
  "我們的歌會找到方向",
  "安靜一下 聽見了嗎",
  "Hey 跟著我唱",
  "把心跳交給這片海洋",
  "就算潮水再大再遠",
  "我們的歌會找到方向",
  "直到天亮",
];

describe("free research brief", () => {
  it("cites MusicBrainz and Wikipedia, names the genre and album, and streams its progress", async () => {
    const f = caodongFetch();
    const c = callbacks();
    const r = await freeResearch(caodongInput(), { ...c.cb, onLog: c.cb.onLog }, { fetch: f.fn, now: NOW, lookup: TEST_LOOKUP });
    expect(r.engine).toBe("free");
    expect(r.createdAt).toBe("2026-09-29T08:00:00.000Z");
    for (const h of RESEARCH_HEADINGS) expect(r.brief).toContain(`## ${h}`);
    expect(r.brief).toContain("免費研究（公開資料＋歌詞與音訊分析）");
    expect(r.brief).toContain("草東沒有派對");
    expect(r.brief).toContain("醜奴兒");
    expect(r.brief).toContain("獨立搖滾");
    // MusicBrainz's English area names read in Chinese
    expect(r.brief).toContain("**草東沒有派對**：臺灣臺北的樂團");
    expect(r.brief).toMatch(/大合唱重點：「Hey」/);
    // the sources are the public pages it used
    const urls = r.sources.map((s) => s.url);
    expect(urls.some((u) => u.startsWith("https://musicbrainz.org/artist/1636f82a"))).toBe(true);
    expect(urls.some((u) => u.startsWith("https://zh.wikipedia.org/"))).toBe(true);
    expect(r.publicInfo?.status).toEqual({ musicbrainz: "ok", wikipedia: "ok" });
    // the stream the process page shows
    const text = c.text();
    expect(text).toContain("查詢 MusicBrainz…");
    expect(text).toContain("讀取維基百科…");
    expect(text).toContain("分析歌詞意象…");
    expect(text.indexOf("查詢 MusicBrainz…")).toBeLessThan(text.indexOf("分析歌詞意象…"));
    expect(c.searches.some((q) => q.startsWith("MusicBrainz"))).toBe(true);
    expect(c.logs.at(-1)).toMatch(/免費研究完成：曲風「獨立搖滾」/);
    // every request carried the app's User-Agent host list only (no other hosts)
    expect(f.calls.every((u) => /musicbrainz\.org|wikipedia\.org/.test(u))).toBe(true);
  });

  it("still writes a brief from the lyrics and the audio when every source is down", async () => {
    const f = downFetch();
    const c = callbacks();
    const r = await freeResearch(caodongInput(), c.cb, { fetch: f.fn, now: NOW, lookup: TEST_LOOKUP });
    expect(f.calls.length).toBeGreaterThan(0);
    for (const h of RESEARCH_HEADINGS) expect(r.brief).toContain(`## ${h}`);
    expect(r.brief).toContain("公開資料查不到");
    expect(r.brief).toContain("這次連不上");
    expect(r.brief).toContain("爆發釋放");
    expect(r.brief).toContain("夜色");
    // the emotion reads as two plain measures (not 「正負 0.26、激昂 0.69」)
    expect(r.brief).toMatch(/情緒：\*\*[^*]+\*\*（正向程度 -?\d\.\d\d、激昂程度 \d\.\d\d/);
    expect(r.brief).not.toContain("正負");
    expect(r.sources).toEqual([]);
    expect(r.publicInfo?.status.musicbrainz).toBe("failed");
  });

  it("is deterministic, and reuses fresh public facts without asking again", async () => {
    const one = await freeResearch(caodongInput(), callbacks().cb, { fetch: caodongFetch().fn, now: NOW, lookup: TEST_LOOKUP });
    const two = await freeResearch(caodongInput(), callbacks().cb, { fetch: caodongFetch().fn, now: NOW, lookup: TEST_LOOKUP });
    expect(two).toEqual(one);
    const again = caodongFetch();
    const c = callbacks();
    const cached = await freeResearch(caodongInput({ publicInfo: one.publicInfo }), c.cb, { fetch: again.fn, now: NOW, lookup: TEST_LOOKUP });
    expect(again.calls).toEqual([]);
    expect(c.text()).toContain("沿用先前查到的公開資料");
    expect(cached.brief).toBe(one.brief);
  });

  it("a malformed cached lookup (a hand-edited project file) is ignored, not trusted", async () => {
    const f = caodongFetch();
    const r = await freeResearch(caodongInput({ publicInfo: { version: 1, status: "ok" } as never }), callbacks().cb, { fetch: f.fn, now: NOW, lookup: TEST_LOOKUP });
    expect(f.calls.length).toBeGreaterThan(0);
    expect(r.brief).toContain("醜奴兒");
  });

  it("researchSong without a key is the free research (the pipeline's research step)", async () => {
    const c = callbacks();
    const r: Research = await researchSong(caodongInput(), c.cb, { configured: false, fetch: caodongFetch().fn, now: NOW, lookup: TEST_LOOKUP });
    expect(r.engine).toBe("free");
    expect(c.logs[0]).toContain("改用免費研究");
    expect(r.brief).toContain("獨立搖滾");
  });

  it("turning the sources off (LIVELYRICS_FREE_SOURCES=off) skips the network", async () => {
    const f = caodongFetch();
    const r = await freeResearch(caodongInput(), callbacks().cb, { fetch: f.fn, now: NOW, lookup: { ...TEST_LOOKUP, env: { LIVELYRICS_FREE_SOURCES: "off" } } });
    expect(f.calls).toEqual([]);
    expect(r.publicInfo?.status).toEqual({ musicbrainz: "skipped", wikipedia: "skipped" });
    expect(r.brief).toContain("## 歌曲意象與情緒");
  });
});

describe("findings drive the offline designer", () => {
  const plan = (genre: string | null, input = demoInput()) => offlineDesign(genre ? { ...input, publicInfo: publicInfoWith({ genres: [genre] }) } : input);
  const palette = (p: ReturnType<typeof offlineDesign>) => p.keyVisual.palette.map((c) => c.hex).join(" ");

  it("is deterministic for the same findings", () => {
    expect(plan("post-rock")).toEqual(plan("post-rock"));
    expect(analyzeFindings(demoInput())).toEqual(analyzeFindings(demoInput()));
  });

  it("differs by genre: palette, fonts, scenes, lyric styles and transitions follow the genre's grammar", () => {
    const post = plan("post-rock");
    const punk = plan("punk");
    const city = plan("city pop");
    const none = plan(null);
    expect(new Set([palette(post), palette(punk), palette(city), palette(none)]).size).toBe(4);
    expect(punk.keyVisual.typography.weight).toBe(900);
    expect(post.keyVisual.typography.cjkFont).toBe("noto-serif-tc");
    // post-rock: sparse lyrics, soft transitions; punk: word-pop verses and impact choruses
    const verse = (p: typeof post) => p.sections.find((s) => s.kind === "verse")!;
    expect(verse(post).lyricStyle).toBe("hidden");
    expect(verse(punk).lyricStyle).toBe("word-pop");
    expect(post.sections.some((s) => s.transitionIn === "flash")).toBe(false);
    expect(punk.sections.some((s) => s.kind === "chorus" && s.lyricStyle === "impact")).toBe(true);
    // the genre's scene family (city pop's grid) and the avoided ones (post-rock avoids the grid)
    expect(city.sections.some((s) => s.scene === "grid")).toBe(true);
    expect(post.sections.some((s) => s.scene === "grid")).toBe(false);
    // the concept and the notes say why
    expect(post.keyVisual.concept).toContain("後搖滾");
    expect(post.designerNotes).toContain("## 免費研究的發現");
    expect(post.designerNotes).toContain("曲風「後搖滾」");
    expect(post.keyVisual.concept).toContain("公開資料說 Livelyrics Band 是");
  });

  it("differs by lyrics: the sea song gets the sea's colours, scenes and motifs", () => {
    const night = plan(null);
    const sea = plan(null, withLyrics(demoInput(), SEA_LYRICS));
    expect(palette(sea)).not.toBe(palette(night));
    expect(sea.keyVisual.motifs.join()).toContain("潮汐");
    expect(sea.sections.some((s) => s.scene === "waves")).toBe(true);
    expect(sea.keyVisual.concept).toContain("海浪");
    expect(night.keyVisual.concept).toContain("夜色");
  });

  it("the 世界觀 says when the words and the sound pull apart", () => {
    const calm = demoInput();
    const slow = { ...calm.analysis!, bpm: 70, energy: calm.analysis!.energy.map(() => 0.25), brightness: calm.analysis!.brightness.map(() => 0.2), sections: calm.analysis!.sections.map((x) => ({ ...x, energy: 0.25 })) };
    const f = analyzeFindings({ ...calm, analysis: slow });
    expect(f.audio.label).toBe("陰鬱緩慢");
    expect(f.lyrics.emotion.label).toBe("明亮激昂");
    expect(f.hints.world).toContain("歌詞明亮而激昂、聲音卻陰鬱緩慢的世界");
    expect(analyzeFindings(calm).hints.world).toBe("一個明亮而激昂的世界：「夜色」與「遠方」從安靜一路爆開。");
  });

  it("the sing-along phrase becomes an emphasis and a cue", () => {
    const p = plan(null);
    // a line with a chant keeps the chant as its emphasis; the other phrase is emphasized where it is sung
    expect(p.lines.filter((l) => l.emphasis.includes("我們的歌")).map((l) => l.lineId)).toEqual(["l7", "l12"]);
    expect(p.cues.some((c) => c.kind === "singalong" && c.detail.includes("跟著我唱"))).toBe(true);
  });

  it("the bible still wins over the genre", () => {
    const bible = {
      summary: "港口的夜",
      palette: [
        { hex: "#0a1020", role: "背景", name: "港夜" },
        { hex: "#2f6fd6", role: "主色", name: "港藍" },
        { hex: "#f2b233", role: "點綴", name: "燈" },
        { hex: "#f4f4f0", role: "歌詞", name: "白" },
      ],
      fonts: { cjkFont: "noto-serif-tc" as const, latinFont: "playfair-display" as const, weight: 700 },
      motifs: ["燈塔"],
      sceneAffinity: [],
      sceneAvoid: ["tunnel" as const],
      treatments: [],
      lyricPolicy: { mode: "full" as const, note: "" },
      dos: [],
      donts: [],
      source: { engine: "manual" as const, updatedAt: "2026-01-01T00:00:00.000Z" },
    };
    const p = offlineDesign({ ...demoInput(), bible, publicInfo: publicInfoWith({ genres: ["punk"] }) });
    expect(p.keyVisual.typography.cjkFont).toBe("noto-serif-tc");
    expect(p.sections.some((s) => s.scene === "tunnel")).toBe(false);
    const bibleHexes = new Set(bible.palette.map((c) => c.hex));
    expect(p.keyVisual.palette.some((c) => bibleHexes.has(c.hex))).toBe(true);
  });
});

describe("findings drive the offline directions", () => {
  const specs = (genre: string | null, input = demoInput()) => offlineDirectionSpecs({ ...(genre ? { ...input, publicInfo: publicInfoWith({ genres: [genre] }) } : input), research: null });

  it("three clearly different directions, made for this song", () => {
    const s = specs(null);
    expect(s.map((d) => d.name)).toEqual(["冷調膠片感", "飽和拼貼", "黑白極簡"]);
    expect(new Set(s.map((d) => d.palette[1].hex)).size).toBe(3);
    // the song's images and sing-along phrase are in the pitches and treatments
    expect(s[0].pitch).toContain("夜色");
    expect(s[1].pitch).toContain("跟著我唱");
    expect(s[0].rationale).toContain("免費研究");
  });

  it("the genre takes its own axis: folk a warm earth-toned film, punk the collage, post-rock a cool film", () => {
    const folk = specs("folk");
    expect(folk[0].name).toBe("暖調膠片感");
    expect(folk[0].typography.cjkFont).toBe("lxgw-wenkai-tc");
    expect(folk[0].rationale).toContain("最貼近民謠");
    expect(folk[0].lyricTreatment).toContain("民謠");
    const punk = specs("punk");
    expect(punk[1].rationale).toContain("最貼近龐克");
    expect(punk[1].lyricTreatment).toContain("龐克");
    expect(punk[1].palette[1].hex).not.toBe(specs(null)[1].palette[1].hex);
    const post = specs("post-rock");
    expect(post[0].name).toBe("冷調膠片感");
    expect(post[0].motifs).toContain("長曝光的光軌");
    expect(post[0].palette.map((p) => p.hex)).not.toEqual(specs(null)[0].palette.map((p) => p.hex));
  });

  it("and the lyrics change them too", () => {
    const sea = specs(null, withLyrics(demoInput(), SEA_LYRICS));
    expect(sea[0].pitch).toContain("海浪");
    expect(sea.map((d) => d.palette[1].hex)).not.toEqual(specs(null).map((d) => d.palette[1].hex));
  });
});
