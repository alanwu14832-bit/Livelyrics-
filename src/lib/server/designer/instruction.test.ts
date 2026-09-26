import { describe, expect, it } from "vitest";
import { DesignPlanSchema } from "@/lib/schema";
import { hexToHsl, hueDistance } from "./color";
import { applyInstruction, parseInstruction } from "./instruction";
import { offlineDesign } from "./offline";
import { demoInput } from "./testing/fixtures";

const input = demoInput();
const base = offlineDesign(input);

describe("parseInstruction", () => {
  it("splits clauses and inherits targets", () => {
    const [a, b, c] = parseInstruction("副歌更熱血一點，字大一點。主歌不要歌詞");
    expect(a).toMatchObject({ targets: ["chorus"], energy: 0.25 });
    expect(b).toMatchObject({ targets: ["chorus"], lyricScale: 0.2 });
    expect(c).toMatchObject({ targets: ["verse"], lyrics: "hide" });
  });
  it("understands colors without confusing them with scenes", () => {
    const [c] = parseInstruction("整體藍一點");
    expect(c.targets).toBeNull();
    expect(c.hue).toBe(218);
    expect(c.scene).toBeNull();
  });
  it("returns nothing for instructions it cannot map", () => {
    expect(parseInstruction("讓鼓手開心")).toEqual([]);
  });
});

describe("applyInstruction", () => {
  it("raises chorus energy and keeps everything else", () => {
    const { plan, changes } = applyInstruction(base, "副歌更熱血一點", input);
    expect(changes.length).toBe(1);
    const before = base.sections.filter((s) => s.kind === "chorus");
    const after = plan.sections.filter((s) => s.kind === "chorus");
    after.forEach((s, i) => expect(s.sceneParams.intensity).toBeGreaterThan(before[i].sceneParams.intensity - 1e-9));
    expect(plan.sections.find((s) => s.kind === "verse")).toEqual(base.sections.find((s) => s.kind === "verse"));
    expect(DesignPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("hides lyrics, recolors and changes fonts", () => {
    const { plan } = applyInstruction(base, "主歌不要歌詞；整體改成紫色調；字體用宋體", input);
    expect(plan.sections.filter((s) => s.kind === "verse").every((s) => s.lyricStyle === "hidden")).toBe(true);
    expect(hueDistance(hexToHsl(plan.keyVisual.palette[1].hex).h, 276)).toBeLessThan(6);
    expect(plan.keyVisual.typography.cjkFont).toBe("noto-serif-tc");
    expect(DesignPlanSchema.safeParse(plan).success).toBe(true);
  });

  it("goes monochrome", () => {
    const { plan } = applyInstruction(base, "改成黑白", input);
    for (const p of plan.keyVisual.palette) expect(hexToHsl(p.hex).s).toBeLessThan(0.02);
  });

  it("reports when nothing was understood", () => {
    const { plan, changes } = applyInstruction(base, "讓鼓手開心", input);
    expect(changes).toEqual([]);
    expect(plan).toBe(base);
  });
});
