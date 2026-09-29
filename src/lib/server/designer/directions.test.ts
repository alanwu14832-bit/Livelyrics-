import { describe, expect, it } from "vitest";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { defaultBible } from "@/lib/band";
import { DesignPlanSchema } from "@/lib/schema";
import type { BandBible, MoodImage } from "@/lib/types";
import { designParams, userContent } from "./claude";
import { hexToHsl, hueDistance } from "./color";
import { buildDirections, DirectionDraftSchema, expandDirection, normalizeDirectionDrafts, offlineDirectionSpecs } from "./directions";
import { proposeDirections } from "./index";
import { moodPalette, visionContent } from "./moodboard";
import { jsonOutputFormat } from "./output-schema";
import { offlineDesign } from "./offline";
import { fakeTransport, message, text } from "./testing/fake-claude";
import { demoInput } from "./testing/fixtures";
import type { DesignRequest } from "./types";
import { moodSummary } from "@/lib/moodboard";

const req = (over: Partial<DesignRequest> = {}): DesignRequest => ({ ...demoInput(), research: null, ...over });

const mood = (id: string, palette: string[], note?: string, sat = 0.6): MoodImage => ({
  id,
  kind: "image",
  name: id,
  mimeType: "image/webp",
  file: `${id}.webp`,
  width: 1024,
  height: 768,
  bytes: 5000,
  createdAt: "2026-09-01T00:00:00Z",
  stats: { palette, weights: palette.map(() => 1 / palette.length), luma: 0.4, saturation: sat, warmth: 0.3 },
  ...(note ? { note } : {}),
});

const BOARD = [mood("a00000000001", ["#e8452c", "#1a1a22"], "喜歡這個顏色"), mood("a00000000002", ["#1fa3a8", "#f2efe8"], "這種顆粒感")];

function hues(hexes: string[]) {
  return hexes.map((h) => hexToHsl(h)).filter((c) => c.s > 0.2 && c.l > 0.12 && c.l < 0.92);
}

describe("offline directions", () => {
  it("are three valid, clearly different plans (palette, scenes, lyric styles, type)", () => {
    const r = req();
    const specs = offlineDirectionSpecs(r);
    expect(specs.map((s) => s.name)).toEqual(["冷調膠片感", "飽和拼貼", "黑白極簡"]);
    const dirs = buildDirections(specs, r, { engine: "offline", now: "2026-09-29T00:00:00.000Z" });
    expect(dirs.map((d) => d.letter)).toEqual(["A", "B", "C"]);
    expect(new Set(dirs.map((d) => d.id)).size).toBe(3);
    for (const d of dirs) {
      expect(DesignPlanSchema.safeParse(d.plan).success).toBe(true);
      expect(d.plan.sections[0].start).toBe(0);
      expect(d.plan.sections.at(-1)!.end).toBeCloseTo(73, 1);
      expect(d.plan.keyVisual.title).toBe(d.name);
      expect(d.status).toBe("proposed");
    }
    const [a, b, c] = dirs.map((d) => d.plan);
    // palettes: film is cool and muted, collage saturated, minimal nearly grey
    const sat = (p: typeof a) => {
      const s = p.keyVisual.palette.slice(1).map((x) => hexToHsl(x.hex).s);
      return s.reduce((x, y) => x + y, 0) / s.length;
    };
    expect(sat(b)).toBeGreaterThan(sat(a));
    expect(sat(a)).toBeGreaterThan(sat(c));
    expect(new Set([a, b, c].map((p) => p.keyVisual.palette.map((x) => x.hex).join())).size).toBe(3);
    // scenes: different families on the choruses
    const chorusScenes = (p: typeof a) => new Set(p.sections.filter((s) => s.kind === "chorus").map((s) => s.scene));
    const overlap = [...chorusScenes(a)].filter((s) => chorusScenes(b).has(s) && chorusScenes(c).has(s));
    expect(overlap).toEqual([]);
    // lyric treatment: karaoke vs impact vs a poem stack on the chorus
    const chorusStyle = (p: typeof a) => p.sections.find((s) => s.kind === "chorus")!.lyricStyle;
    expect(new Set([chorusStyle(a), chorusStyle(b), chorusStyle(c)]).size).toBe(3);
    // typography differs
    expect(new Set([a, b, c].map((p) => p.keyVisual.typography.cjkFont)).size).toBe(3);
    // soft looks never flash; the collage keeps its hard cuts
    expect(a.sections.some((s) => s.transitionIn === "flash")).toBe(false);
  });

  it("is deterministic", () => {
    const now = "2026-09-29T00:00:00.000Z";
    const one = buildDirections(offlineDirectionSpecs(req()), req(), { engine: "offline", now });
    const two = buildDirections(offlineDirectionSpecs(req()), req(), { engine: "offline", now });
    expect(two).toEqual(one);
  });

  it("take their palettes from the mood board and cite the images", () => {
    const r = req({ moodboard: BOARD });
    const specs = offlineDirectionSpecs(r);
    const summary = moodSummary(BOARD)!;
    expect(summary.vivid).toBe("#e8452c");
    for (const s of specs) {
      // every direction carries the mood board's vivid hue (red-orange) somewhere
      const has = hues(s.palette.map((p) => p.hex)).some((c) => hueDistance(c.h, hexToHsl("#e8452c").h) < 25);
      expect(has, `${s.name}: ${s.palette.map((p) => p.hex).join(" ")}`).toBe(true);
      expect(s.references.length).toBeGreaterThan(0);
      expect(s.rationale).toMatch(/圖 1/);
    }
    // the film direction uses the mood board colours as they are
    expect(specs[0].palette.map((p) => p.hex)).toContain("#e8452c");
    // warm mood board: warm film
    expect(specs[0].name).toBe("暖調膠片感");
  });

  it("respect the band bible: its palette, fonts, avoided scenes and lyric policy", () => {
    const bible: BandBible = {
      ...defaultBible(),
      summary: "港口的夜，霧與燈塔。",
      palette: [
        { hex: "#0b1020", role: "背景", name: "深港" },
        { hex: "#2d6cdf", role: "主色", name: "燈塔藍" },
        { hex: "#f0b429", role: "點綴", name: "燈火" },
        { hex: "#f5f5f0", role: "歌詞", name: "霧白" },
      ],
      fonts: { cjkFont: "lxgw-wenkai-tc", latinFont: "playfair-display", weight: 700 },
      sceneAvoid: ["tunnel", "shards", "grid"],
      lyricPolicy: { mode: "chorus-only", note: "" },
      source: { engine: "manual", updatedAt: "2026-01-01T00:00:00Z" },
    };
    const r = req({ bible, bandName: "港口" });
    const dirs = buildDirections(offlineDirectionSpecs(r), r, { engine: "offline", now: "2026-09-29T00:00:00.000Z" });
    const bibleHex = new Set(bible.palette.map((p) => p.hex));
    for (const d of dirs) {
      const kv = d.plan.keyVisual;
      expect(kv.palette.every((p) => bibleHex.has(p.hex)), kv.palette.map((p) => p.hex).join()).toBe(true);
      expect(kv.typography.cjkFont).toBe("lxgw-wenkai-tc");
      expect(kv.typography.latinFont).toBe("playfair-display");
      for (const s of d.plan.sections) {
        expect(["tunnel", "shards", "grid"]).not.toContain(s.scene);
        if (s.kind !== "chorus") expect(s.lyricStyle).toBe("hidden");
      }
    }
    // still distinct: different chorus looks
    expect(new Set(dirs.map((d) => d.plan.sections.find((s) => s.kind === "chorus")!.lyricStyle)).size).toBeGreaterThan(1);
  });

  it("the single-plan offline designer uses the mood board palette too", () => {
    const plain = offlineDesign(req());
    const withBoard = offlineDesign(req({ moodboard: BOARD }));
    expect(withBoard.keyVisual.palette.map((p) => p.hex)).toContain("#e8452c");
    expect(plain.keyVisual.palette.map((p) => p.hex)).not.toContain("#e8452c");
    expect(withBoard.keyVisual.concept).toMatch(/參考圖/);
    expect(moodPalette(null)).toBeNull();
  });
});

describe("normalizeDirectionDrafts", () => {
  const offline = offlineDirectionSpecs(req({ moodboard: BOARD }));
  const draft = (over: Record<string, unknown> = {}) => ({
    name: "霓虹雨夜",
    pitch: "雨裡的霓虹招牌",
    rationale: "研究提到 MV 在雨夜拍攝；圖 2 的顆粒感。",
    references: [
      { image: 2, cue: "顆粒感" },
      { image: 9, cue: "不存在" },
    ],
    moodKeywords: ["雨", "霓虹"],
    palette: [
      { hex: "#FF2E88", role: "主色", name: "霓虹粉" },
      { hex: "#05060a", role: "背景", name: "夜" },
      { hex: "#29e0ff", role: "點綴", name: "青光" },
      { hex: "not a color", role: "?", name: "?" },
    ],
    typography: { cjkFont: "anton", latinFont: "noto-sans-tc", weight: 400, letterSpacing: 2, rationale: "粗" },
    motifs: ["雨"],
    emblem: "wave",
    scenes: [
      { kind: "chorus", scenes: ["rain", "tunnel", "bogus"] },
      { kind: "verse", scenes: ["nebula"] },
    ],
    sceneTendency: "雨絲",
    lyrics: [
      { kind: "chorus", style: "karaoke", placement: "center" },
      { kind: "verse", style: "nope", placement: "center" },
    ],
    lyricTreatment: "副歌 karaoke",
    treatments: ["grain-film", "zzz"],
    energy: 3,
    motion: "punchy",
    ...over,
  });

  it("repairs fields against the vocabularies and maps image numbers to ids", () => {
    const [s] = normalizeDirectionDrafts({ directions: [draft()] }, req({ moodboard: BOARD }), offline);
    expect(s.name).toBe("霓虹雨夜");
    expect(s.palette[0].hex).toBe("#05060a"); // darkest first
    expect(s.palette.map((p) => p.hex)).toEqual(expect.arrayContaining(["#ff2e88", "#29e0ff"]));
    expect(s.typography.cjkFont).toBe(offline[0].typography.cjkFont); // anton is not CJK
    expect(s.typography.latinFont).toBe(offline[0].typography.latinFont); // noto-sans-tc is not Latin
    expect(s.typography.weight).toBe(600);
    expect(s.typography.letterSpacing).toBe(0.2);
    expect(s.scenes.chorus).toEqual(["rain", "tunnel"]);
    expect(s.scenes.bridge).toEqual(offline[0].scenes.bridge);
    expect(s.lyrics.chorus).toEqual({ style: "karaoke", placement: "center" });
    expect(s.lyrics.verse).toEqual(offline[0].lyrics.verse);
    expect(s.references).toEqual([{ imageId: "a00000000002", cue: "顆粒感" }]);
    expect(s.treatments).toEqual(["grain-film"]);
    expect(s.energy).toBe(1);
    expect(s.motion).toBe("punchy");
  });

  it("drops duplicates and tops up with offline directions to at least two", () => {
    const out = normalizeDirectionDrafts({ directions: [draft(), draft({ pitch: "重複" }), { name: "" }] }, req(), offline);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("霓虹雨夜");
    expect(out[1].name).toBe(offline[0].name);
    expect(normalizeDirectionDrafts(null, req(), offline).map((s) => s.name)).toEqual(offline.slice(0, 2).map((s) => s.name));
  });

  it("a palette outside the bible's hues falls back to the bible", () => {
    const bible: BandBible = {
      ...defaultBible(),
      palette: [
        { hex: "#0b1020", role: "背景", name: "深港" },
        { hex: "#2d6cdf", role: "主色", name: "燈塔藍" },
        { hex: "#f0b429", role: "點綴", name: "燈火" },
        { hex: "#f5f5f0", role: "歌詞", name: "霧白" },
      ],
      sceneAvoid: ["rain"],
      source: { engine: "manual", updatedAt: "" },
    };
    const r = req({ bible });
    const off = offlineDirectionSpecs(r);
    const [s] = normalizeDirectionDrafts({ directions: [draft()] }, r, off);
    expect(s.palette.map((p) => p.hex)).toEqual(off[0].palette.map((p) => p.hex));
    expect(s.scenes.chorus).toEqual(["tunnel"]);
    expect(s.typography.cjkFont).toBe(bible.fonts.cjkFont);
    const plan = expandDirection(s, r, "A");
    expect(plan.sections.some((x) => x.scene === "rain")).toBe(false);
  });

  it("the structured-output schema is strict and keeps the closed vocabularies as enums", () => {
    const format = jsonOutputFormat(DirectionDraftSchema);
    const item = (format.schema as { properties: { directions: { items: Record<string, unknown> } } }).properties.directions.items as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { items?: { properties?: Record<string, { enum?: unknown[] }> } }>;
    };
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(expect.arrayContaining(["name", "pitch", "rationale", "palette", "typography", "scenes", "lyrics", "references"]));
    expect(item.properties.scenes.items?.properties?.kind.enum).toContain("chorus");
    expect(item.properties.lyrics.items?.properties?.style.enum).toContain("karaoke");
    // a draft with an unknown scene is not a valid draft (the normalizer repairs it anyway)
    expect(DirectionDraftSchema.safeParse({ directions: [draft({ energy: 0.5 })] }).success).toBe(false);
  });
});

describe("Claude message construction with mood board images", () => {
  const images = [
    { id: "a00000000001", mediaType: "image/webp" as const, data: "UklGRg==" },
    { id: "a00000000002", mediaType: "image/jpeg" as const, data: "/9j/4A==" },
  ];

  it("puts every loaded image before the prompt, each with its 圖 n label and note", () => {
    const blocks = visionContent(BOARD, images);
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "text", "image"]);
    expect((blocks[0] as { text: string }).text).toBe("圖 1（這首歌的參考）：「喜歡這個顏色」");
    expect(blocks[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/webp", data: "UklGRg==" } });
    // a missing image keeps its number (圖 2 stays 圖 2)
    const partial = visionContent(BOARD, [images[1]]);
    expect((partial[0] as { text: string }).text).toMatch(/^圖 2/);
  });

  it("the design request sends image blocks then the prompt with the mood board instructions", () => {
    const r = req({ moodboard: BOARD, moodboardImages: images });
    const p = designParams(r, "claude-opus-5");
    const content = p.messages[0].content as BetaContentBlockParam[];
    expect(Array.isArray(content)).toBe(true);
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    const last = content.at(-1) as { type: string; text: string };
    expect(last.type).toBe("text");
    expect(last.text).toMatch(/# 參考圖（mood board）/);
    expect(last.text).toMatch(/萃取配色/);
    expect(last.text).toMatch(/圖 1（這首歌的參考）｜操作員說明：「喜歡這個顏色」/);
    // no images: the plain string prompt as before
    expect(typeof userContent(req(), "x")).toBe("string");
    expect(typeof designParams(req(), "m").messages[0].content).toBe("string");
  });

  it("proposeDirections: one structured-output call with the images, then expanded plans", async () => {
    const raw = {
      directions: [
        { ...JSON.parse(JSON.stringify({ name: "霓虹雨夜" })), pitch: "雨夜", rationale: "圖 1", references: [{ image: 1, cue: "紅" }], moodKeywords: [], palette: [{ hex: "#05060a", role: "背景", name: "夜" }, { hex: "#e8452c", role: "主色", name: "紅" }, { hex: "#29e0ff", role: "點綴", name: "青" }, { hex: "#f5f5f5", role: "歌詞", name: "白" }], typography: { cjkFont: "noto-sans-tc", latinFont: "anton", weight: 800, letterSpacing: 0.02, rationale: "粗" }, motifs: ["雨", "霓虹"], emblem: "wave", scenes: [{ kind: "chorus", scenes: ["rain", "tunnel"] }], sceneTendency: "雨絲", lyrics: [{ kind: "chorus", style: "karaoke", placement: "center" }], lyricTreatment: "karaoke", treatments: [], energy: 0.7, motion: "punchy" },
        { name: "白霧留白", pitch: "霧", rationale: "研究", references: [], moodKeywords: [], palette: [{ hex: "#0a0a0a", role: "背景", name: "黑" }, { hex: "#9a9a9a", role: "主色", name: "灰" }, { hex: "#e8452c", role: "點綴", name: "紅" }, { hex: "#f5f5f5", role: "歌詞", name: "白" }], typography: { cjkFont: "noto-serif-tc", latinFont: "playfair-display", weight: 700, letterSpacing: 0.1, rationale: "宋" }, motifs: ["霧", "線"], emblem: "orbit", scenes: [{ kind: "chorus", scenes: ["gradient", "ink"] }], sceneTendency: "漸層", lyrics: [{ kind: "chorus", style: "stack", placement: "center" }], lyricTreatment: "stack", treatments: [], energy: 0.3, motion: "soft" },
      ],
    };
    const t = fakeTransport([message([text(JSON.stringify(raw))], "end_turn")]);
    const logs: string[] = [];
    const r = req({ moodboard: BOARD, moodboardImages: images });
    const set = await proposeDirections(r, { onLog: (m) => logs.push(m) }, { transport: t, configured: true, model: "claude-opus-5", now: () => new Date("2026-09-29T00:00:00Z") });
    expect(t.calls).toHaveLength(1);
    const call = t.calls[0];
    expect(call.model).toBe("claude-opus-5");
    expect(call.output_config?.effort).toBe("medium");
    expect(call.output_config?.format?.type).toBe("json_schema");
    expect(call.fallbacks).toBe("default");
    expect(call.thinking).toEqual({ type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    const content = call.messages[0].content as BetaContentBlockParam[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect((content.at(-1) as { text: string }).text).toMatch(/請提出 3 個（至少 2 個）設計方向/);
    expect(set.engine).toBe("claude");
    expect(set.directions.map((d) => [d.letter, d.name])).toEqual([
      ["A", "霓虹雨夜"],
      ["B", "白霧留白"],
    ]);
    expect(set.directions[0].references).toEqual([{ imageId: "a00000000001", cue: "紅" }]);
    for (const d of set.directions) expect(DesignPlanSchema.safeParse(d.plan).success).toBe(true);
    expect(logs.some((l) => /參考 2 張參考圖/.test(l))).toBe(true);
  });

  it("falls back to the offline directions when Claude fails, and without a key", async () => {
    const t = fakeTransport([new Error("boom")]);
    const logs: string[] = [];
    const set = await proposeDirections(req(), { onLog: (m) => logs.push(m) }, { transport: t, configured: true, model: "m" });
    expect(set.engine).toBe("offline");
    expect(set.directions).toHaveLength(3);
    expect(logs.some((l) => /改用離線設計師/.test(l))).toBe(true);
    const none = await proposeDirections(req(), {}, { configured: false });
    expect(none.engine).toBe("offline");
    expect(none.directions.map((d) => d.name)).toEqual(["冷調膠片感", "飽和拼貼", "黑白極簡"]);
  });
});
