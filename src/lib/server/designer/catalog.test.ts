import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_IDS, LYRIC_STYLE_IDS, SCENE_IDS } from "@/lib/schema";
import { FONT_CATALOG, LYRIC_STYLES, SCENES } from "./catalog";

describe("catalog", () => {
  it("describes every vocabulary id", () => {
    for (const id of SCENE_IDS) expect(SCENES[id].description.length).toBeGreaterThan(5);
    for (const id of LYRIC_STYLE_IDS) expect(LYRIC_STYLES[id].description.length).toBeGreaterThan(5);
    for (const id of FONT_IDS) expect(FONT_CATALOG[id].label.length).toBeGreaterThan(0);
  });

  it("mirrors the cjk flags of src/lib/fonts.ts", () => {
    // fonts.ts imports next/font, so compare against its source text
    const src = readFileSync(path.resolve(__dirname, "../../fonts.ts"), "utf8");
    for (const id of FONT_IDS) {
      const re = new RegExp(`"?${id}"?\\s*:\\s*\\{[^}]*cjk:\\s*(true|false)`);
      const m = re.exec(src);
      expect(m, id).not.toBeNull();
      expect(FONT_CATALOG[id].cjk, id).toBe(m?.[1] === "true");
    }
  });
});
