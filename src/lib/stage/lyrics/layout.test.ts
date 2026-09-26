import { describe, expect, it } from "vitest";
import { SCENE_IDS } from "@/lib/schema";
import { STYLE_METRICS, scrimAlpha } from "./layout";

describe("scrimAlpha", () => {
  it("strengthens the backdrop over scenes with a bright centre", () => {
    expect(scrimAlpha("karaoke", "grid")).toBeGreaterThan(scrimAlpha("karaoke", "nebula"));
    expect(scrimAlpha("line-fade", "motif")).toBeGreaterThan(scrimAlpha("line-fade", "gradient"));
  });

  it("keeps the style's base strength on calm scenes and never goes opaque", () => {
    expect(scrimAlpha("line-fade", "gradient")).toBeCloseTo(STYLE_METRICS["line-fade"].scrim * 0.62);
    for (const scene of SCENE_IDS) {
      const a = scrimAlpha("subtitle", scene);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThanOrEqual(0.85);
    }
    expect(scrimAlpha("hidden", "grid")).toBe(0);
  });
});
