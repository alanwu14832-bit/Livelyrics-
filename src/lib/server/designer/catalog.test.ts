import { describe, expect, it } from "vitest";
import { FONTS } from "@/lib/font-meta";
import { FONT_IDS, LYRIC_STYLE_IDS, SCENE_IDS } from "@/lib/schema";
import { FONT_CATALOG, LYRIC_STYLES, SCENES } from "./catalog";

describe("catalog", () => {
  it("describes every vocabulary id", () => {
    for (const id of SCENE_IDS) expect(SCENES[id].description.length).toBeGreaterThan(5);
    for (const id of LYRIC_STYLE_IDS) expect(LYRIC_STYLES[id].description.length).toBeGreaterThan(5);
    for (const id of FONT_IDS) expect(FONT_CATALOG[id].label.length).toBeGreaterThan(0);
  });

  it("takes script and family from the shared font registry", () => {
    for (const id of FONT_IDS) {
      expect(FONT_CATALOG[id].cjk, id).toBe(FONTS[id].cjk);
      expect(FONT_CATALOG[id].generic, id).toBe(FONTS[id].generic);
      expect(FONT_CATALOG[id].description.length, id).toBeGreaterThan(5);
    }
  });
});
