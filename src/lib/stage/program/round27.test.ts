// Round 27 — nothing fights the words. The round-26 audit: threads flooded the emo chorus with
// near-white stripes over the lyric (N1), and in the last chorus the grown form ran straight through
// the text (demo's rings through the vertical line, folk's 「Oh,」 on the moon: N6). The probe now
// measures what the eye sees behind the words (the padded text box with the words on screen: lit
// fraction and edge density), the critique checks it, and every composer form knocks itself out
// under the line on screen.

import { describe, expect, it } from "vitest";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import { offlineDesign } from "@/lib/server/designer/offline";
import { genreMotion, isDarkSong, offlineSceneProgram } from "@/lib/server/designer/scene-program";
import { analyzeFindings } from "@/lib/server/designer/findings";
import { AUDIT_SONGS, auditInput, EMO_LRC } from "@/lib/server/designer/testing/audit-songs";
import { demoInput } from "@/lib/server/designer/testing/fixtures";
import { COMPOSITE_FRAGMENT } from "../scenes/composite";
import { composeSceneProgram, FORM_IDS } from "./composer";
import { CRITIQUE_TARGETS, critiqueProgram, critiqueStates } from "./critique";
import { compileForCpu } from "./glsl-eval";
import { PROBE_COVER, probePlanProgram, stateUniforms } from "./probe";
import { validateProgram } from "./validate";

const songs = [
  ...AUDIT_SONGS.filter((s) => ["demo", "citypop", "punk", "folk"].includes(s.key)).map((s) => ({ key: s.key, input: auditInput(s) })),
  { key: "emo", input: { ...demoInput(), lyrics: parseLyricsText(EMO_LRC, "user") } },
].map(({ key, input }) => ({ key, input, plan: offlineDesign(input) }));

const sectionsOf = (plan: (typeof songs)[number]["plan"]) => plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy }));

describe("round 27: nothing fights the words", () => {
  it("every form on every audit song: the box behind the words stays dark and calm in every arc state (incl. the last chorus)", { timeout: 300_000 }, () => {
    const failures: string[] = [];
    for (const { key, plan } of songs) {
      for (const form of FORM_IDS) {
        const prog = composeSceneProgram({ seed: 7, forms: [form], sections: sectionsOf(plan) });
        const r = probePlanProgram(prog, plan);
        for (const { state, index } of critiqueStates(plan.sections)) {
          const s = r.samples[index];
          if ((s.boxLit ?? 1) > CRITIQUE_TARGETS.boxLitMax) failures.push(`${key}/${form} ${state}: lit behind the words ${s.boxLit}`);
          if ((s.boxEdge ?? 1) > CRITIQUE_TARGETS.boxEdgeMax) failures.push(`${key}/${form} ${state}: edges behind the words ${s.boxEdge}`);
        }
        const c = critiqueProgram(prog, plan)!;
        for (const id of ["words-dark", "words-calm"]) if (!c.check.checks.find((x) => x.id === id)?.ok) failures.push(`${key}/${form}: ${id}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("the critique fails a form that runs through the text zone (the round-26 threads / rings), and passes the knocked-out one", () => {
    const { plan } = songs.find((s) => s.key === "demo")!;
    const src = composeSceneProgram({ seed: 7, forms: ["orbits"], sections: sectionsOf(plan) });
    // the same program without its knockout: the last chorus' rings cross the words
    const bare = { ...src, source: src.source.replace(/float ko = koMask\(uv\)[^;]*;/, "float ko = 0.0;") };
    expect(bare.source).not.toBe(src.source);
    const b = critiqueProgram(bare, plan)!;
    const k = critiqueProgram(src, plan)!;
    expect(b.check.checks.find((c) => c.id === "words-calm")!.ok).toBe(false);
    expect(k.check.checks.find((c) => c.id === "words-calm")!.ok).toBe(true);
    expect(b.failed.join("\n")).toMatch(/wordsMask/);
  });

  it("threads passes the whole critique on every audit song (near-white ≤ 3 %), a dark song too", { timeout: 120_000 }, () => {
    const failures: string[] = [];
    for (const { key, plan } of songs) {
      for (const dark of [false, true]) {
        const prog = composeSceneProgram({ seed: 7, forms: ["threads"], sections: sectionsOf(plan), dark });
        const c = critiqueProgram(prog, plan)!;
        if (c.check.passed !== c.check.total) failures.push(`${key}${dark ? " (dark)" : ""}: ${c.failed.join(" | ")}`);
        const white = Math.max(...probePlanProgram(prog, plan).samples.map((s) => s.white ?? 0));
        if (white > CRITIQUE_TARGETS.whiteMax) failures.push(`${key}: near-white ${white}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("threads pours in a band on the form's side, not across the whole frame; a dark song's chorus stays dimmer", () => {
    const { plan } = songs.find((s) => s.key === "demo")!;
    const sections = sectionsOf(plan);
    const ci = sections.findIndex((s) => s.kind === "chorus");
    const meanOf = (dark: boolean) => {
      const prog = composeSceneProgram({ seed: 7, forms: ["threads"], sections, dark });
      const checked = validateProgram(prog.source);
      if (!checked.ok) throw new Error(checked.errors.join("; "));
      const u = stateUniforms(prog, prog.sections[ci], plan.sections[ci], ci, sections.length, { palette: plan.keyVisual.palette.map((p) => p.hex) });
      const run = compileForCpu(checked.code, u);
      const zone = u.uZone;
      const wordsSide = (zone[0] + zone[2]) / 2 < 0.5 ? [0.04, 0.3] : [0.7, 0.96];
      let words = 0;
      let all = 0;
      let n = 0;
      let m = 0;
      for (let j = 0; j < 18; j++)
        for (let i = 0; i < 32; i++) {
          const x = (i + 0.5) / 32;
          const c = run.scene([x * 1920, ((j + 0.5) / 18) * 1080]).color;
          const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
          all += l;
          m++;
          if (x > wordsSide[0] && x < wordsSide[1]) {
            words += l > PROBE_COVER ? 1 : 0;
            n++;
          }
        }
      return { wordsSideCover: words / n, mean: all / m };
    };
    const lit = meanOf(false);
    expect(lit.wordsSideCover).toBeLessThan(0.08);
    expect(meanOf(true).mean).toBeLessThan(lit.mean);
  });

  it("the emo song is a dark song and its program says so; the genre's motion leads (punk sweeps)", () => {
    const emo = songs.find((s) => s.key === "emo")!;
    expect(isDarkSong(emo.input)).toBe(true);
    expect(isDarkSong(songs.find((s) => s.key === "folk")!.input)).toBe(false);
    expect(offlineSceneProgram(emo.input, emo.plan).source).toContain("const float K_DARK = 1.0;");
    const punk = songs.find((s) => s.key === "punk")!;
    expect(genreMotion(analyzeFindings(punk.input))).toBe("sweep");
    expect(offlineSceneProgram(punk.input, punk.plan).recipe).toMatch(/^[a-z]+\/[a-z]+\/sweep#/);
    for (const salt of [1, 2, 3]) expect(offlineSceneProgram(punk.input, punk.plan, salt).recipe).toMatch(/\/sweep#/);
    for (const seed of [1, 2, 3, 4, 5]) expect(composeSceneProgram({ seed, forms: ["orbits"], sections: sectionsOf(punk.plan), motionLead: "sweep" }).recipe).toMatch(/\/sweep$/);
  });

  it("m1: the brush keeps its verse stroke inside the safe area and draws no stray accent dot", () => {
    const { plan } = songs.find((s) => s.key === "punk")!;
    const sections = sectionsOf(plan);
    const failures: string[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const prog = composeSceneProgram({ seed, forms: ["brush"], sections });
      expect(prog.source).not.toMatch(/vec2 sun\b/);
      const checked = validateProgram(prog.source);
      if (!checked.ok) throw new Error(checked.errors.join("; "));
      const vi = sections.findIndex((s) => s.kind === "verse");
      const u = stateUniforms(prog, prog.sections[vi], plan.sections[vi], vi, sections.length, { palette: plan.keyVisual.palette.map((p) => p.hex) });
      const run = compileForCpu(checked.code, { ...u, uSectionProgress: 0.95 });
      // the outer 6 % band at the top and bottom carries no stroke
      for (let i = 0; i < 64; i++)
        for (const y of [0.015, 0.035, 0.055, 0.945, 0.965, 0.985]) {
          const c = run.scene([((i + 0.5) / 64) * 1920, y * 1080]).color;
          if (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > PROBE_COVER) failures.push(`seed ${seed}: lit at (${((i + 0.5) / 64).toFixed(2)}, ${y})`);
        }
    }
    expect(failures).toEqual([]);
  });

  it("m9: the scan transition is one continuous beam, not a staircase of row blocks", () => {
    expect(COMPOSITE_FRAGMENT).not.toMatch(/floor\(uv\.y \* rows\)/);
    expect(COMPOSITE_FRAGMENT).toMatch(/scan beam/);
  });
});
