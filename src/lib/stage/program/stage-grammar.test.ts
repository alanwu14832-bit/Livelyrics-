// Round 23 (N2): the chorus opens the wall. The round-21 audit saw one small object for the whole
// song — the chorus only got brighter, mode 1 was never used and the words (so the form) kept one
// side. For every form of the offline composer on the audit songs: a verse covers under 10 % of the
// wall, its chorus at least twice the verse (25–45 % by design), the verse that leads into a chorus is
// a build (mode 1), a later chorus grows, and the subject stands in more than one place.

import { describe, expect, it } from "vitest";
import { composeSceneProgram, FORM_IDS, isBuildSection } from "./composer";
import { PROBE_LIT_MAX, probePlanProgram } from "./probe";
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
