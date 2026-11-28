// Round 28 — colour comes from the song, and the app's own pictures pass its own checks.
// N2: genre palette targets in OKLCH (distinct, in the family's range, a subject that is never near-white,
// a stable subject hue, a concept that describes the palette that was built); N3: the five examples and
// the offline composer pass the same critique Claude's programs get, and the offline program records it;
// m2 / m3 / m4 / m5 / m7: copy and structure fixes.

import { describe, expect, it } from "vitest";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import type { AudioAnalysis } from "@/lib/types";
import { tokenizeLyric } from "@/lib/stage/lyrics/tokenize";
import { composeSceneProgram, FORM_IDS } from "@/lib/stage/program/composer";
import { checkLine, critiqueProgram, critiqueStates } from "@/lib/stage/program/critique";
import { EXAMPLE_PROGRAMS, instantiateExample } from "@/lib/stage/program/examples";
import { hexToOklch } from "@/lib/stage/oklch";
import { PROBE_SUBJECT_C_MIN, PROBE_SUBJECT_L_MAX, probePlanProgram } from "@/lib/stage/program/probe";
import { selfCheck } from "@/lib/stage/program/self-check";
import { breakRows } from "@/lib/type/text";
import { offlineContext, offlineDesign } from "./offline";
import { colourWord, familyFor, outOfFamily, PALETTE_FAMILIES, PALETTE_FAMILY_IDS, PALETTE_TEACHING, palettesDistinct, paletteWords } from "./palette-targets";
import { isDarkSong } from "./scene-program";
import { AUDIT_SONGS, auditInput, EMO_LRC } from "./testing/audit-songs";
import { demoAnalysis, demoInput, demoMeta } from "./testing/fixtures";

const songs = [
  ...AUDIT_SONGS.map((s) => ({ key: s.key, input: auditInput(s) })),
  { key: "emo", input: { ...demoInput(), lyrics: parseLyricsText(EMO_LRC, "user") } },
];
const plans = new Map(songs.map((s) => [s.key, offlineDesign(s.input)]));
const planOf = (key: string) => plans.get(key)!;
const sectionsOf = (key: string) => planOf(key).sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy }));
const FAMILY_BY_KEY: Record<string, string> = { demo: "indie", ballad: "pastel", punk: "punk", citypop: "citypop", folk: "folk", instrumental: "steel", longlines: "indie", emo: "emo" };

describe("N2: the palette comes from the song", () => {
  it("the families have real OKLCH targets: every variant builds a palette inside its own ranges", () => {
    expect(PALETTE_FAMILY_IDS).toHaveLength(10);
    for (const id of PALETTE_FAMILY_IDS) expect(PALETTE_FAMILIES[id].variants.length).toBeGreaterThanOrEqual(2);
    expect(PALETTE_TEACHING.length).toBeLessThan(345);
    expect(PALETTE_TEACHING).toContain("原色撞色");
  });

  it("each of the 8 audit songs wears its genre family's colours, and no two palettes look alike", () => {
    for (const { key, input } of songs) {
      const f = offlineContext(input).findings;
      const family = familyFor({ genreId: f.genre?.id ?? null, quadrant: f.audio.quadrant, emotion: f.lyrics.lineCount > 0 ? f.lyrics.emotion.label : null });
      expect(family.id, key).toBe(FAMILY_BY_KEY[key]);
      expect(outOfFamily(planOf(key).keyVisual.palette, family), key).toEqual([]);
    }
    const bad: string[] = [];
    const keys = songs.map((s) => s.key);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (!palettesDistinct(planOf(keys[i]).keyVisual.palette, planOf(keys[j]).keyVisual.palette)) bad.push(`${keys[i]}/${keys[j]}`);
    expect(bad).toEqual([]);
  });

  it("punk is a primary-colour clash, city pop a sunset pink with neon cyan and amber, emo cold with one hot accent", () => {
    const hue = (key: string, i: number) => hexToOklch(planOf(key).keyVisual.palette[i].hex);
    const punk = [1, 2, 4].map((i) => hue("punk", i));
    expect(Math.min(...punk.map((c) => c.C))).toBeGreaterThan(0.15);
    const emo = [hue("emo", 1), hue("emo", 2)];
    expect(emo[0].C).toBeLessThan(0.08);
    expect(emo[1].C).toBeGreaterThan(0.16);
    const city = [1, 2, 4].map((i) => hue("citypop", i).H);
    expect(city.some((h) => h > 320 || h < 30)).toBe(true); // a pink
    expect(city.some((h) => h > 180 && h < 230)).toBe(true); // a cyan
    expect(city.some((h) => h > 55 && h < 100)).toBe(true); // an amber
    // every palette is colourful: the old template's primary chroma was 0.06–0.2 (rose, slate, pale gold)
    for (const key of ["punk", "citypop", "folk"]) expect(hue(key, 1).C, key).toBeGreaterThan(0.07);
  });

  it("the subject keeps one hue through the song: uPri is the primary in every section, only the accent and the ground move", () => {
    for (const { key } of songs) {
      const plan = planOf(key);
      const primary = plan.keyVisual.palette[1].hex;
      for (const s of plan.sections) expect(s.colorway[1], `${key} ${s.id}`).toBe(primary);
      expect(new Set(plan.sections.map((s) => s.colorway[2])).size, key).toBeGreaterThanOrEqual(plan.sections.length > 2 ? 2 : 1);
    }
  });

  it("the offline programs render the subject in the palette: no near-white subject on any audit song (every arc state)", { timeout: 300_000 }, () => {
    const failures: string[] = [];
    for (const { key, input } of songs) {
      const plan = offlineDesign(input, { check: true });
      const probe = probePlanProgram(plan.sceneProgram!, plan);
      for (const { state, index } of critiqueStates(plan.sections)) {
        const s = probe.samples[index];
        if (s.cover < 0.02) continue;
        if ((s.subjectL ?? 0) > PROBE_SUBJECT_L_MAX || (s.subjectC ?? 0) < PROBE_SUBJECT_C_MIN) failures.push(`${key} ${state}: L ${s.subjectL} C ${s.subjectC}`);
        if ((s.white ?? 0) > 0.03) failures.push(`${key} ${state}: near-white area ${s.white}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("the concept describes the palette that was built (colour words from its OKLCH values), and makes no false claim about the band", () => {
    const concepts = songs.map(({ key }) => planOf(key).keyVisual.concept);
    for (const { key } of songs) {
      const plan = planOf(key);
      const words = paletteWords(plan.keyVisual.palette);
      expect(words.length, key).toBeGreaterThan(0);
      expect(plan.keyVisual.concept, key).not.toMatch(/沿用它|視覺語法，我們/);
    }
    // the punk concept names the clash it actually has (a red, a yellow and a blue)
    expect(paletteWords(planOf("punk").keyVisual.palette)).toMatch(/紅/);
    expect(concepts.find((c) => c.includes("配色"))).toBeTruthy();
    expect(colourWord("#ea2e37")).toBe("鮮紅");
    expect(colourWord("#667788")).toMatch(/灰/);
    // m2: the chorus sentence is not the same words in every concept
    expect(concepts.filter((c) => c.includes("放大到越出畫面，一次比一次大")).length).toBeLessThanOrEqual(3);
    expect(new Set(concepts.map((c) => /主歌時它([^，；]+)/.exec(c)?.[1])).size).toBeGreaterThan(1);
  });
});

const failedChecks = (c: NonNullable<ReturnType<typeof critiqueProgram>>) => c.check.checks.filter((x) => !x.ok).map((x) => x.id);

describe("N3: the app's own pictures pass its own self-check", () => {
  it("the five few-shot examples pass the critique on every audit song (at most one miss, never near-white)", { timeout: 300_000 }, () => {
    const failures: string[] = [];
    for (const { key } of songs) {
      for (const ex of EXAMPLE_PROGRAMS) {
        const c = critiqueProgram(instantiateExample(ex, planOf(key)), planOf(key))!;
        const f = failedChecks(c);
        if (f.length > 1 || f.includes("no-white") || f.includes("words-dark") || f.includes("words-calm")) failures.push(`${ex.id}/${key}: ${f.join(",")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("every composer form × the 8 audit songs passes at least 10 of 11 checks after its self-check, with no near-white failure", { timeout: 900_000 }, () => {
    const failures: string[] = [];
    for (const { key, input } of songs) {
      const plan = planOf(key);
      const dark = isDarkSong(input);
      for (const form of FORM_IDS) {
        const { critique: c } = selfCheck((t) => composeSceneProgram({ seed: 7, forms: [form], sections: sectionsOf(key), dark, tune: t, reroll: t.reroll }), plan);
        const f = c ? failedChecks(c) : ["unsupported"];
        if (f.length > 1 || f.includes("no-white")) failures.push(`${key}/${form}: ${f.join(",")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("the instrumental composer (no words, no text zone) passes its checks too — every form", { timeout: 300_000 }, () => {
    const plan = planOf("instrumental");
    const failures: string[] = [];
    for (const form of FORM_IDS) {
      const { critique: c } = selfCheck((t) => composeSceneProgram({ seed: 7, forms: [form], sections: sectionsOf("instrumental"), lyrics: false, tune: t, reroll: t.reroll }), plan);
      const f = c ? failedChecks(c) : ["unsupported"];
      if (f.length) failures.push(`${form}: ${f.join(",")}`);
    }
    expect(failures).toEqual([]);
    // the console's wording follows the song: no 「副歌」 for a song nobody sings
    const check = offlineDesign(songs.find((s) => s.key === "instrumental")!.input, { check: true }).sceneProgram!.check!;
    expect(check.checks.map((x) => x.label).join("")).not.toContain("副歌");
  });

  it("the offline program is measured and re-rolled, and records one honest line for the console", { timeout: 300_000 }, () => {
    for (const key of ["demo", "emo", "punk"]) {
      const plan = offlineDesign(songs.find((s) => s.key === key)!.input, { check: true });
      const check = plan.sceneProgram!.check!;
      expect(check, key).toBeTruthy();
      expect(check.rerolls, key).toBeGreaterThanOrEqual(0);
      expect(check.summary).toMatch(/^畫面自我檢查：/);
      expect(check.summary).toContain("離線作曲器");
      expect(check.summary).toBe(checkLine(check));
      expect(check.passed).toBeGreaterThanOrEqual(check.total - 1);
    }
    // an unchecked program (the unit tests' default) carries no line
    expect(offlineDesign(demoInput()).sceneProgram!.check).toBeUndefined();
  });

  it("the console line says what the composer did, in three honest shapes", () => {
    const base = { passed: 10, total: 10, checks: [], states: [], fixTurn: false, kept: "first" as const, summary: "" };
    expect(checkLine({ ...base, rerolls: 0 })).toContain("第一版就過");
    expect(checkLine({ ...base, rerolls: 3, kept: "fixed", firstPassed: 8 })).toMatch(/第一版只通過 8／10 項，自動調整形狀 3 次/);
    const miss = { ...base, passed: 9, checks: [{ id: "chorus-open", ok: false, label: "副歌亮的面積 20%（目標 25%–45%）" }] };
    expect(checkLine({ ...miss, rerolls: 6 })).toMatch(/仍有 1 項沒達標（副歌亮的面積 20%）/);
  });
});

describe("m3: Latin line breaks follow the phrase", () => {
  const rows = (t: string, max: number) => {
    const u = tokenizeLyric(t);
    return breakRows(u, 0, u.length, { max, maxRows: 3, pyramid: true, width: (idx) => idx.reduce((w, i) => w + Math.max(0.3, u[i].text.length * 0.55), 0) }).map((r) => r.map((i) => u[i].text).join("").trim());
  };
  it("「lay me down」 stays whole and no row ends on 「where」 or starts on a particle", () => {
    for (const max of [8, 10, 12, 14, 16]) {
      const r = rows("Oh, lay me down where the water's slow", max);
      expect(r[0], `${max}: ${r.join(" / ")}`).toBe("Oh, lay me down");
      for (const row of r) expect(row, r.join(" / ")).not.toMatch(/^(down|up|out|away)\b/i);
      for (const row of r.slice(0, -1)) expect(row, r.join(" / ")).not.toMatch(/\b(where|when|that|from)$/i);
    }
  });
});

describe("m4: an unsung climax is not a 「副歌」", () => {
  it("the instrumental's high sections are 「高潮／展開」 in the labels, the notes and the design text; no raw English crescendo", () => {
    const plan = planOf("instrumental");
    const climaxes = plan.sections.filter((s) => s.kind === "chorus");
    expect(climaxes.length).toBeGreaterThan(0);
    for (const s of climaxes) expect(s.label).toContain("高潮／展開");
    const text = [plan.keyVisual.concept, plan.designerNotes, ...plan.sections.map((s) => s.rationale), ...plan.cues.map((c) => `${c.title} ${c.detail}`)].join("\n");
    expect(text).not.toMatch(/副歌/);
    for (const { key } of songs) expect(JSON.stringify(planOf(key)), key).not.toMatch(/crescendo/i);
  });
});

describe("m5: a ballad with nothing repeated still opens at its most intense line", () => {
  it("the ballad gets a climax section (labelled 高潮, not a made-up 副歌) and the copy says what is built", () => {
    // (as the app seeds it: a file with no audio analysis, so nothing in the sound marks a chorus)
    const plan = offlineDesign({ ...songs.find((s) => s.key === "ballad")!.input, analysis: null });
    const climax = plan.sections.filter((s) => s.kind === "chorus");
    expect(climax).toHaveLength(1);
    expect(climax[0].label).toBe("高潮");
    expect(climax[0].start).toBeGreaterThan(plan.sections[0].end - 0.01);
    expect(plan.keyVisual.concept).toContain("整首沒有重複的副歌");
    expect(plan.designerNotes).toContain("沒有重複的副歌，最強烈的一句落在");
    expect(plan.designerNotes).not.toContain("只有一次副歌");
  });
});

describe("m7: a silent file's copy does not reason about audio energy", () => {
  it("no 「以能量為準」 note, and the concept names the form actually on the wall", () => {
    const n = 1500 * 20 + 1;
    const analysis: AudioAnalysis = { ...demoAnalysis(), duration: 1500, bpm: 0, bpmConfidence: 0, beats: [], energy: new Array(n).fill(0), onset: new Array(n).fill(0), brightness: new Array(n).fill(0), bass: new Array(n).fill(0), vocal: new Array(n).fill(0), peaks: new Array(2000).fill(0.0003), sections: [{ start: 0, end: 1500, energy: 0 }] };
    const input = { ...demoInput(), meta: demoMeta({ duration: 1500 }), analysis };
    const plan = offlineDesign(input);
    const f = offlineContext(input).findings;
    expect(f.mood.why).not.toMatch(/能量為準|音訊/);
    expect(JSON.stringify(plan)).not.toContain("以能量為準");
    const recipe = plan.sceneProgram!.recipe!.split("/")[0];
    const thing: Record<string, string> = { horizon: "地平線上的一個圓", pillars: "一排佇立的碑", orbits: "軌道", strata: "一層層的山脈", bars: "一組印刷的斜線", brush: "一筆墨畫成的圓", ribbons: "幾條交錯的光帶", threads: "一片落下的光絲" };
    expect(plan.keyVisual.concept).toContain(thing[recipe]);
    expect(plan.keyVisual.concept).not.toContain("色場");
  });
});
