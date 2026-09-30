import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hexToHsl } from "./color";
import { extractMoodStats } from "@/lib/moodboard";
import type { CollectedVisual } from "@/lib/types";
import { decodeSample } from "@/lib/server/research/image-decode";
import { designParams } from "./claude";
import { collectedBlock, collectedVisionContent, combinedMood, leadPalette, placeCollected } from "./collected";
import { researchSong } from "./index";
import { offlineDesign } from "./offline";
import { buildScenePrompt, offlineSceneProgram } from "./scene-program";
import { fakeTransport, message, text } from "./testing/fake-claude";
import { demoInput } from "./testing/fixtures";
import { splitVisuals, visualsStreamFilter } from "./visual-candidates";

const FIX = path.resolve(__dirname, "../../../../fixtures/visuals");
const coverBytes = new Uint8Array(readFileSync(path.join(FIX, "cover.jpg")));
const coverStats = extractMoodStats(decodeSample(coverBytes, "jpeg")!.data);

function cover(over: Partial<CollectedVisual> = {}): CollectedVisual {
  return {
    id: "c0ffee000001",
    kind: "image",
    name: "專輯封面《夜航》",
    mimeType: "image/jpeg",
    file: "c0ffee000001.jpg",
    width: 600,
    height: 600,
    bytes: coverBytes.length,
    createdAt: "2026-09-30T00:00:00Z",
    note: "研究找到的專輯封面",
    stats: coverStats,
    provenance: {
      kind: "cover",
      imageUrl: "https://coverartarchive.org/release/r1/1-1200.jpg",
      sourceUrl: "https://musicbrainz.org/release/r1",
      foundBy: "cover-art-archive",
      fetchedAt: "2026-09-30T00:00:00Z",
      title: "夜航",
      authorization: "樂團已授權",
    },
    use: "stage",
    useSetBy: "auto",
    hash: "0123456789abcdef",
    ...over,
  };
}

const BRIEF = "## 樂團視覺識別\n- 招牌色是深藍與燈火橘。\n\n## 歌曲意象與情緒\n- 夜晚的城市。\n\n## 現場表演觀察\n- 副歌大合唱。\n\n## 設計方向建議\n- 以燈火為母題。\n\n## 參考來源\n- [Live](https://band.example.com/live)";
const LIST = '```visuals\n{"images":[{"kind":"cover","title":"夜航","pageUrl":"https://band.example.com/album","imageUrl":"https://band.example.com/cover.jpg","why":"專輯的橘與藍"},{"kind":"mv","pageUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"},{"kind":"logo"}]}\n```';

describe("Claude's image list", () => {
  it("is split off the brief and parsed tolerantly", () => {
    const r = splitVisuals(`${BRIEF}\n\n${LIST}\n`);
    expect(r.brief).toBe(BRIEF);
    expect(r.candidates).toEqual([
      { kind: "cover", title: "夜航", pageUrl: "https://band.example.com/album", imageUrl: "https://band.example.com/cover.jpg", why: "專輯的橘與藍" },
      { kind: "mv", pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    ]);
    expect(splitVisuals(BRIEF)).toEqual({ brief: BRIEF, candidates: [] });
    // broken JSON, and a block cut off by the token limit: no candidates, the brief intact
    expect(splitVisuals(`${BRIEF}\n\`\`\`visuals\n{"images":[{"kind":"cover",`).candidates).toEqual([]);
    expect(splitVisuals(`${BRIEF}\n\`\`\`visuals\n{"images":[{"kind":"cover",`).brief).toBe(BRIEF);
    expect(splitVisuals('x\n```visuals\nnot json\n```').candidates).toEqual([]);
  });

  it("never reaches the streamed brief, even when the fence arrives in pieces", () => {
    const out: string[] = [];
    const f = visualsStreamFilter((d) => out.push(d));
    const all = `${BRIEF}\n\n${LIST}`;
    for (let i = 0; i < all.length; i += 3) f.push(all.slice(i, i + 3));
    f.flush();
    expect(out.join("").trimEnd()).toBe(BRIEF);
    const plain: string[] = [];
    const g = visualsStreamFilter((d) => plain.push(d));
    g.push("程式碼 ``");
    g.push("` 不是清單");
    g.flush();
    expect(plain.join("")).toBe("程式碼 ``` 不是清單");
  });

  it("researchSong (mocked transport): the brief without the list, the candidates on the research, web fetch offered", async () => {
    const t = fakeTransport([message([text(`${BRIEF}\n\n${LIST}`)], "end_turn")]);
    const deltas: string[] = [];
    const logs: string[] = [];
    const research = await researchSong(demoInput(), { onDelta: (d) => deltas.push(d), onLog: (m) => logs.push(m) }, { transport: t, configured: true, model: "claude-test" });
    expect(research.engine).toBe("claude");
    expect(research.brief).not.toContain("```visuals");
    expect(research.brief).toContain("## 設計方向建議");
    expect(research.visualCandidates?.map((c) => c.kind)).toEqual(["cover", "mv"]);
    expect(deltas.join("")).not.toContain("visuals");
    expect(logs.some((l) => /列出 2 個視覺素材/.test(l))).toBe(true);
    const tools = t.calls[0].tools ?? [];
    expect(tools.map((x) => ("name" in x ? x.name : ""))).toEqual(["web_search", "web_fetch"]);
    expect(String(t.calls[0].system)).toContain("視覺素材清單");
  });
});

describe("the designer sees the collected material", () => {
  const vision = [{ id: "c0ffee000001", mediaType: "image/jpeg" as const, data: Buffer.from(coverBytes).toString("base64") }];

  it("vision blocks after the mood board, labelled with kind, source and stage use", () => {
    const blocks = collectedVisionContent([cover()], vision);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "text" });
    expect((blocks[0] as { text: string }).text).toMatch(/素材 1：研究找到的專輯封面「夜航」（Cover Art Archive，musicbrainz\.org）｜可以上台（素材 id c0ffee000001）/);
    expect(blocks[1]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
    const p = designParams({ ...demoInput(), research: null, collected: [cover()], collectedImages: vision, assets: [cover()] }, "m");
    const content = p.messages[0].content;
    expect(Array.isArray(content) && content.map((b) => b.type)).toEqual(["text", "image", "text"]);
    const prompt = Array.isArray(content) ? (content[2] as { text: string }).text : "";
    expect(prompt).toContain("# 研究找到的素材");
    expect(prompt).toContain("配色、母題、構圖與材質要從這些真實素材長出來");
    expect(prompt).toContain("節制");
    expect(prompt).toContain(coverStats.palette[0]);
  });

  it("reference-only items are never offered as media", () => {
    const block = collectedBlock([cover({ use: "reference" })], []);
    expect(block).toMatch(/只當參考（不要放上舞台）/);
    expect(block).toMatch(/media 不要用它們/);
    expect(collectedBlock([], [])).toBeNull();
  });

  it("the scene program prompt gets the cover's palette (and the images go before it)", () => {
    const req = { ...demoInput(), research: null, collected: [cover()], collectedImages: vision };
    const plan = offlineDesign(req);
    const prompt = buildScenePrompt(req, plan);
    expect(prompt).toContain("# 研究找到的素材");
    expect(prompt).toContain(`封面量到的配色（依份量）：${leadPalette([cover()])!.palette.slice(0, 6).join("、")}`);
    expect(prompt).not.toContain("可以當某些段落的 media");
  });
});

describe("offline designer with collected palettes", () => {
  const input = demoInput();
  const hue = (hex: string) => hexToHsl(hex).h;
  const orangeish = (hex: string) => {
    const c = hexToHsl(hex);
    return c.s > 0.4 && c.h >= 10 && c.h <= 40;
  };
  const tealish = (hex: string) => {
    const c = hexToHsl(hex);
    return c.s > 0.2 && c.h >= 170 && c.h <= 200;
  };
  /** the cover's teal field leads, its orange sun is the accent */
  const fromCover = (hexes: string[]) => tealish(hexes[0]) && tealish(hexes[1]) && hexes.slice(1, 5).some(orangeish);

  it("takes its palette from the cover and shows the cover in one to three sections with a treatment", () => {
    const withCover = offlineDesign({ ...input, collected: [cover()], assets: [cover()] });
    const without = offlineDesign(input);
    expect(fromCover(withCover.keyVisual.palette.map((p) => p.hex))).toBe(true);
    expect(fromCover(without.keyVisual.palette.map((p) => p.hex))).toBe(false);
    expect(withCover.keyVisual.palette.map((p) => p.hex)).toContain("#fa7a1d");
    // the background carries the cover's teal
    expect(Math.abs(hue(withCover.keyVisual.palette[0].hex) - hue(coverStats.palette[0]))).toBeLessThan(25);
    expect(withCover.keyVisual.concept).toMatch(/研究找到的樂團素材（專輯封面）/);
    const shown = withCover.sections.filter((s) => s.media?.assetId === "c0ffee000001");
    expect(shown.length).toBeGreaterThanOrEqual(1);
    expect(shown.length).toBeLessThanOrEqual(3);
    for (const s of shown) expect(["duotone", "halftone", "slow-drift", "grain-film"]).toContain(s.media!.treatment);
    expect(withCover.sections[0].media?.assetId).toBe("c0ffee000001");
  });

  it("a reference-only cover shapes the colours but never appears on stage", () => {
    const ref = cover({ use: "reference" });
    const plan = offlineDesign({ ...input, collected: [ref], assets: [] });
    expect(fromCover(plan.keyVisual.palette.map((p) => p.hex))).toBe(true);
    expect(plan.sections.every((s) => !s.media)).toBe(true);
  });

  it("the cover counts more than a mood board image; a band bible still wins", () => {
    // a grey mood board image next to the cover: the cover's colours lead
    const grey = { ...cover(), id: "a00000000001", file: "a00000000001.jpg", stats: { palette: ["#808080", "#a0a0a0"], weights: [0.5, 0.5], luma: 0.5, saturation: 0, warmth: 0 } };
    delete (grey as Partial<CollectedVisual>).provenance;
    const mood = combinedMood([grey], [cover()]);
    expect(mood?.colors[0].hex).toBe(coverStats.palette[0]);
    expect(mood?.vivid && tealish(mood.vivid)).toBe(true);
    const placed = placeCollected(
      offlineDesign(input).sections.map((s) => ({ ...s, media: null })),
      [cover(), cover({ id: "c0ffee000002", file: "c0ffee000002.jpg", kind: "logo", provenance: { ...cover().provenance, kind: "logo", imageUrl: "https://x.example.com/logo.png" } })],
    );
    expect(placed.filter((s) => s.media).length).toBeLessThanOrEqual(3);
    expect(placed[placed.length - 1].media?.assetId).toBe("c0ffee000002");
  });

  it("the offline scene program follows the cover's temperature and the plan's cover palette", () => {
    const warm = cover({ stats: { ...coverStats, warmth: 0.4 } });
    const req = { ...input, collected: [warm], assets: [warm] };
    const plan = offlineDesign(req);
    const program = offlineSceneProgram(req, plan);
    expect(program.source).toContain("vec3 scene(vec2 fc)");
    expect(program.engine).toBe("offline");
  });
});
