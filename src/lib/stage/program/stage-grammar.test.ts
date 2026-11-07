// Round 23 (N2): the chorus opens the wall. The round-21 audit saw one small object for the whole
// song — the chorus only got brighter, mode 1 was never used and the words (so the form) kept one
// side. For every form of the offline composer on the audit songs: a verse covers under 10 % of the
// wall, its chorus at least twice the verse (25–45 % by design), the verse that leads into a chorus is
// a build (mode 1), a later chorus grows, and the subject stands in more than one place.

import { describe, expect, it } from "vitest";
import { composeSceneProgram, FORM_IDS, INSTRUMENTAL_TITLES, isBuildSection } from "./composer";
import { compileForCpu } from "./glsl-eval";
import { PROBE_COVER, PROBE_LIT_MAX, probePlanProgram, stateUniforms } from "./probe";
import { validateProgram } from "./validate";

const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
import { offlineDesign } from "@/lib/server/designer/offline";
import { AUDIT_SONGS, auditInput } from "@/lib/server/designer/testing/audit-songs";

const songs = AUDIT_SONGS.filter((s) => ["demo", "citypop", "punk", "folk"].includes(s.key)).map((song) => ({ song, plan: offlineDesign(auditInput(song)) }));

describe("the chorus opens the wall (round 23)", () => {
  it("every form: a chorus covers at least twice its verse, a verse stays sparse, the subject moves", { timeout: 180_000 }, () => {
    const failures: string[] = [];
    for (const { song, plan } of songs) {
      const sections = plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy }));
      for (const form of FORM_IDS) {
        const prog = composeSceneProgram({ seed: 7, forms: [form], sections });
        const r = probePlanProgram(prog, plan);
        const tag = `${song.key}/${form}`;
        if (!r.ok) failures.push(`${tag}: ${r.errors.join("; ")}`);
        const verses = r.samples.filter((s) => s.kind === "verse" && s.mode === 0);
        const choruses = r.samples.filter((s) => s.kind === "chorus");
        const verse = Math.max(...verses.map((s) => s.cover));
        if (verse >= 0.12) failures.push(`${tag}: verse covers ${verse}`);
        for (const c of choruses) {
          if (c.cover < Math.max(2 * verse, 0.15)) failures.push(`${tag}: chorus ${c.sectionId} covers ${c.cover} (verse ${verse})`);
          if (c.lit > PROBE_LIT_MAX) failures.push(`${tag}: chorus ${c.sectionId} lit ${c.lit}`);
        }
        // a later chorus is never smaller than the first
        if (choruses.length > 1 && choruses[choruses.length - 1].cover < choruses[0].cover) failures.push(`${tag}: the last chorus shrinks`);
        const xs = r.samples.map((s) => s.cx).filter((x): x is number => x !== null);
        if (Math.max(...xs) - Math.min(...xs) < 0.15) failures.push(`${tag}: the subject stands still (${xs.join(", ")})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("the verse that leads into a chorus is a build (mode 1); the words change sides section to section", () => {
    for (const { plan } of songs) {
      const sections = plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy }));
      const prog = composeSceneProgram({ seed: 3, forms: ["horizon"], sections });
      prog.sections.forEach((ps, i) => {
        if (isBuildSection(sections, i)) expect(ps.mode).toBe(1);
      });
      expect(prog.sections.some((ps) => ps.mode === 1)).toBe(true);
      const sides = prog.sections.map((ps) => (ps.zone.x + ps.zone.w / 2 < 0.5 ? "L" : "R"));
      expect(new Set(sides).size).toBe(2);
      // consecutive sections between the intro and the outro alternate
      for (let i = 2; i < sections.length; i++) if (sections[i].kind !== "outro") expect(sides[i], sides.join("")).not.toBe(sides[i - 1]);
    }
  });

  it("the program carries the grammar: the chorus scale, the chorus ordinal by section, and later choruses say they grow", () => {
    const { plan } = songs.find((s) => s.song.key === "demo")!;
    const sections = plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy }));
    const prog = composeSceneProgram({ seed: 3, forms: ["orbits"], sections });
    expect(prog.source).toContain("float SC()");
    expect(prog.source).toContain("float ESC()");
    expect(prog.source).toMatch(/K_GROW = 2\.3/);
    const notes = prog.sections.filter((_, i) => sections[i].kind === "chorus").map((s) => s.note);
    expect(notes[0]).toMatch(/越出畫面/);
    if (notes.length > 1) expect(notes[notes.length - 1]).toMatch(/比上一次更大/);
  });
});

// Round 23 (N5): the post-rock instrumental was three descending black slabs for 73 s. An instrumental
// now favours forms that build up, and uSongProgress adds layers (count, height, light) across the song.
describe("the instrumental builds up over the song (round 23)", () => {
  const inst = AUDIT_SONGS.find((s) => s.key === "instrumental")!;
  const plan = offlineDesign(auditInput(inst));

  it("draws a form that builds (ribbons, strata, horizon, threads), named after the picture", () => {
    const form = plan.sceneProgram!.recipe!.split("/")[0];
    expect(["ribbons", "strata", "horizon", "threads"]).toContain(form);
    expect(plan.sceneProgram!.title).toBe(INSTRUMENTAL_TITLES[form as keyof typeof INSTRUMENTAL_TITLES]);
    expect(plan.keyVisual.title).toBe(plan.sceneProgram!.title);
    expect(plan.keyVisual.title).not.toBe("暗處的一道光");
    expect(plan.sceneProgram!.concept).toMatch(/一層一層/);
  });

  it("every form covers more of the wall late in the song than early, in the same section state", { timeout: 60_000 }, () => {
    const sections = plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy }));
    for (const form of ["ribbons", "strata", "horizon", "threads", "pillars", "orbits"] as const) {
      const prog = composeSceneProgram({ seed: 5, forms: [form], sections, lyrics: false });
      const v = validateProgram(prog.source);
      if (!v.ok) throw new Error(`${form}: ${v.errors.join("; ")}`);
      const ps = prog.sections.find((s) => sections.find((x) => x.id === s.sectionId)?.kind === "verse") ?? prog.sections[0];
      const section = plan.sections.find((s) => s.id === ps.sectionId);
      const palette = plan.keyVisual.palette.map((p) => p.hex);
      const cover = (progress: number) => {
        const u = { ...stateUniforms(prog, ps, section, 1, plan.sections.length, { palette }), uSongProgress: progress };
        const c = compileForCpu(v.code, u);
        let n = 0;
        for (let j = 0; j < 18; j++) for (let i = 0; i < 32; i++) if (luma(c.scene([((i + 0.5) / 32) * 1920, ((j + 0.5) / 18) * 1080]).color) > PROBE_COVER) n++;
        return n / (32 * 18);
      };
      const early = cover(0.05);
      const late = cover(0.9);
      expect(late, `${form}: ${early} → ${late}`).toBeGreaterThan(early + 0.02);
    }
  });

  it("pillars stand in a symmetric row, never a descending bar chart", () => {
    const prog = composeSceneProgram({ seed: 5, forms: ["pillars"], sections: [{ id: "a", kind: "chorus", energy: 0.8 }], lyrics: false });
    expect(prog.source).toContain("abs(from)");
    expect(prog.source).not.toMatch(/0\.18 \* fi/);
  });
});
