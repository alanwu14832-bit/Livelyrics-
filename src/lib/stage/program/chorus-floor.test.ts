// Round 13: a chorus reaches a visible protagonist. The round-12 frame review found the orbits form
// rendering near-black rings behind the demo chorus's giant word; the probe now measures every
// section with the words on screen and fails a chorus below PROBE_CHORUS_FLOOR or darker than its
// verse — for every form of the offline composer on every audit song.

import { describe, expect, it } from "vitest";
import { composeSceneProgram, FORM_IDS } from "./composer";
import { PROBE_CHORUS_FLOOR, probePlanProgram, probeSceneProgram } from "./probe";
import { offlineDesign } from "@/lib/server/designer/offline";
import { AUDIT_SONGS, auditInput } from "@/lib/server/designer/testing/audit-songs";
import type { SceneProgram } from "@/lib/types";

const plans = AUDIT_SONGS.map((song) => ({ song, plan: offlineDesign(auditInput(song)) }));

describe("the chorus luminance floor", () => {
  it("the orbits chorus is visible around the giant word and brighter than its verse (demo)", () => {
    const { plan, song } = plans.find((p) => p.song.key === "demo")!;
    const prog = composeSceneProgram({ seed: 1, forms: ["orbits"], sections: plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy })), lyrics: song.key !== "instrumental" });
    expect(prog.recipe?.startsWith("orbits/")).toBe(true);
    const r = probePlanProgram(prog, plan);
    const verse = Math.max(...r.samples.filter((s) => s.kind === "verse").map((s) => s.around));
    for (const c of r.samples.filter((s) => s.kind === "chorus")) {
      expect(c.around).toBeGreaterThanOrEqual(PROBE_CHORUS_FLOOR);
      expect(c.around).toBeGreaterThan(verse * 1.5);
    }
    expect(r.ok, r.errors.join("\n")).toBe(true);
  });

  it("every form passes on every audit song", { timeout: 120_000 }, () => {
    const failures: string[] = [];
    for (const { song, plan } of plans) {
      for (const form of FORM_IDS) {
        const prog = composeSceneProgram({ seed: 7, forms: [form], sections: plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy })), lyrics: song.key !== "instrumental" });
        const r = probePlanProgram(prog, plan);
        if (!r.ok) failures.push(`${song.key}/${form}: ${r.errors.join("; ")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("a written program whose chorus is darker than its verse fails with the reason", () => {
    const { plan } = plans.find((p) => p.song.key === "demo")!;
    const program: SceneProgram = {
      version: 1,
      engine: "claude",
      title: "暗副歌",
      concept: "副歌反而變暗。",
      source: "vec3 scene(vec2 fc) { return uBg + uPri * (uMode > 1.5 && uMode < 2.5 ? 0.02 : 0.25); }",
      sections: plan.sections.map((s) => ({ sectionId: s.id, mode: s.kind === "chorus" ? 2 : 0, params: [0.5, 0.5, 0.5, 0.5], zone: { x: 0.08, y: 0.14, w: 0.4, h: 0.5 }, relation: "plain", note: "" })),
      keyMoment: null,
      enabled: true,
    };
    const r = probeSceneProgram(program, { sections: plan.sections, palette: plan.keyVisual.palette.map((p) => p.hex) });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/副歌/);
  });
});
