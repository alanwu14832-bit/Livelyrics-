import { describe, expect, it } from "vitest";
import { DesignPlanSchema, SectionDesignSchema } from "@/lib/schema";
import { parsePlanPatch } from "@/lib/server/validate";
import type { Asset } from "@/lib/types";
import { buildDesignPrompt } from "./prompts";
import { normalizeMedia, normalizePlan, normalizePlanWithReport } from "./normalize";
import { offlineDesign } from "./offline";
import { analyzeStructure } from "./structure";
import { demoInput } from "./testing/fixtures";

function asset(id: string, kind: Asset["kind"], over: Partial<Asset> = {}): Asset {
  const video = kind === "video";
  return {
    id,
    kind,
    name: id,
    mimeType: video ? "video/mp4" : "image/png",
    file: `${id}.${video ? "mp4" : "png"}`,
    width: 1920,
    height: 1080,
    bytes: 1000,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...(video ? { duration: 12 } : {}),
    ...over,
  };
}

const LOGO = asset("aaaaaaaaaaaa", "logo", { name: "樂團 logo" });
const COVER = asset("bbbbbbbbbbbb", "image", { name: "二專封面", note: "第二張專輯封面" });
const PHOTO = asset("cccccccccccc", "image", { name: "排練照" });
const CLIP = asset("dddddddddddd", "video", { name: "MV 片段" });
const ASSETS = [LOGO, COVER, PHOTO, CLIP];

describe("SectionDesignSchema.media", () => {
  it("defaults a missing media key to null (plans saved before media existed)", () => {
    const plan = offlineDesign(demoInput());
    const old = JSON.parse(JSON.stringify(plan)) as Record<string, unknown> & { sections: Array<Record<string, unknown>> };
    for (const s of old.sections) delete s.media;
    const parsed = DesignPlanSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    if (parsed.success) for (const s of parsed.data.sections) expect(s.media).toBeNull();
    // the PATCH validation path accepts it too
    expect(parsePlanPatch(old).sections.every((s) => s.media === null)).toBe(true);
  });

  it("validates a media value and rejects unknown treatments", () => {
    const base = offlineDesign(demoInput()).sections[0];
    const media = { assetId: "x", treatment: "duotone", fit: "cover", opacity: 0.5, blend: "screen" };
    expect(SectionDesignSchema.safeParse({ ...base, media }).success).toBe(true);
    expect(SectionDesignSchema.safeParse({ ...base, media: { ...media, treatment: "sepia" } }).success).toBe(false);
  });
});

describe("normalizeMedia / normalizePlan", () => {
  const map = new Map(ASSETS.map((a) => [a.id, a]));

  it("drops unknown asset ids and fills defaults", () => {
    expect(normalizeMedia({ assetId: "zzzzzzzzzzzz", treatment: "full" }, map)).toBeNull();
    expect(normalizeMedia("x", map)).toBeNull();
    expect(normalizeMedia({ assetId: CLIP.id }, map)).toEqual({ assetId: CLIP.id, treatment: "beat-cut", fit: "cover", opacity: 0.85, blend: "normal" });
    expect(normalizeMedia({ assetId: LOGO.id, opacity: 3, treatment: "nope" }, map)).toEqual({ assetId: LOGO.id, treatment: "full", fit: "contain", opacity: 1, blend: "screen" });
  });

  it("keeps valid media, removes media pointing at deleted assets, and reports it", () => {
    const plan = offlineDesign({ ...demoInput(), assets: ASSETS });
    const withMedia = plan.sections.filter((s) => s.media).length;
    expect(withMedia).toBeGreaterThan(0);
    const kept = normalizePlan(plan, { ...demoInput(), assets: ASSETS });
    expect(kept.sections.filter((s) => s.media).length).toBe(withMedia);
    const { plan: stripped, repairs } = normalizePlanWithReport(plan, { ...demoInput(), assets: [COVER] });
    for (const s of stripped.sections) if (s.media) expect(s.media.assetId).toBe(COVER.id);
    expect(repairs.some((r) => r.includes("素材"))).toBe(true);
  });
});

describe("offline designer: band material", () => {
  const plan = offlineDesign({ ...demoInput(), assets: ASSETS });
  const [intro, verse, chorus1, breakdown, chorus2, outro] = plan.sections;

  it("passes the schema", () => {
    expect(DesignPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("uses the logo at the opening and the ending, whole and screened", () => {
    expect(intro.media).toMatchObject({ assetId: LOGO.id, fit: "contain", blend: "screen" });
    expect(outro.media?.assetId).toBe(LOGO.id);
    expect(plan.sections.filter((s) => s.media?.assetId === LOGO.id)).toHaveLength(2);
  });

  it("cuts the MV clip on the beat in the choruses", () => {
    for (const c of [chorus1, chorus2]) expect(c.media).toMatchObject({ assetId: CLIP.id, treatment: "beat-cut" });
  });

  it("treats photos in the palette in the verses and the cover in the breakdown", () => {
    expect(verse.media?.assetId).toBe(PHOTO.id);
    expect(["duotone", "grain-film", "mask-lyrics"]).toContain(verse.media?.treatment);
    expect(breakdown.media?.assetId).toBe(COVER.id);
  });

  it("never lets material compete with lyrics", () => {
    for (const s of plan.sections) {
      if (!s.media || s.lyricStyle === "hidden") continue;
      expect(s.media.treatment === "mask-lyrics" || s.media.treatment === "blur-glow" || s.media.opacity <= 0.65).toBe(true);
    }
  });

  it("is deterministic and leaves plans without assets unchanged", () => {
    expect(offlineDesign({ ...demoInput(), assets: ASSETS })).toEqual(plan);
    expect(offlineDesign(demoInput()).sections.every((s) => s.media === null)).toBe(true);
  });
});

describe("design prompt", () => {
  it("lists the assets with their notes, and says media is null without any", () => {
    const req = { ...demoInput(), research: null, assets: ASSETS };
    const prompt = buildDesignPrompt(req, analyzeStructure(req));
    expect(prompt).toContain(CLIP.id);
    expect(prompt).toContain("第二張專輯封面");
    expect(prompt).toContain("長度 0:12");
    const bare = buildDesignPrompt({ ...demoInput(), research: null }, analyzeStructure(demoInput()));
    expect(bare).toContain("media 一律填 null");
  });
});
