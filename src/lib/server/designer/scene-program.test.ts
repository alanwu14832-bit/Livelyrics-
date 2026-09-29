import { describe, expect, it } from "vitest";
import { chooseComposition, composeSceneProgram, FORM_IDS } from "@/lib/stage/program/composer";
import { EXAMPLE_PROGRAMS } from "@/lib/stage/program/examples";
import { validateProgram } from "@/lib/stage/program/validate";
import { designSceneProgram, offlineDesign } from "./index";
import { analyzeFindings } from "./findings";
import { jsonOutputFormat } from "./output-schema";
import { buildScenePrompt, composerSalt, ensureSceneProgram, offlineSceneProgram, SceneProgramDraftSchema, sceneForms } from "./scene-program";
import { PROGRAM_CONTRACT_DOC } from "@/lib/stage/program/contract";
import { fakeTransport, message, text } from "./testing/fake-claude";
import { SONG_FIXTURES, fixtureInput } from "./testing/songs";
import { demoInput } from "./testing/fixtures";

const req = (i = 0) => ({ ...fixtureInput(SONG_FIXTURES[i]), research: null });

describe("offline composer", () => {
  it("every form × texture × motion composes a program the validator accepts", () => {
    const sections = [
      { id: "s0", kind: "verse" as const, energy: 0.4 },
      { id: "s1", kind: "chorus" as const, energy: 0.9 },
      { id: "s2", kind: "bridge" as const, energy: 0.5 },
    ];
    for (const form of FORM_IDS) {
      for (const voice of ["mv-card", "title-sequence", "ink", "glitch"] as const) {
        for (let seed = 1; seed < 4; seed++) {
          const p = composeSceneProgram({ seed: seed * 7919, forms: [form], sections, voice });
          const v = validateProgram(p.source);
          expect(v.ok ? [] : v.errors, `${form}/${voice}/${seed}`).toEqual([]);
          expect(p.recipe?.startsWith(form)).toBe(true);
        }
      }
    }
  });

  it("is deterministic; a salt draws another composition", () => {
    const input = { seed: 12345, forms: ["horizon", "strata", "ribbons"] as const, sections: [{ id: "s0", kind: "chorus" as const, energy: 0.8 }] };
    expect(composeSceneProgram({ ...input, forms: [...input.forms] })).toEqual(composeSceneProgram({ ...input, forms: [...input.forms] }));
    const salted = new Set([0, 1, 2, 3, 4, 5].map((salt) => composeSceneProgram({ ...input, forms: [...input.forms], salt }).source));
    expect(salted.size).toBeGreaterThan(3);
  });

  it("zones alternate across the song and the chorus gets the form's relation", () => {
    const p = composeSceneProgram({
      seed: 99,
      forms: ["bars"],
      sections: ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"].map((kind, i) => ({ id: `s${i}`, kind: kind as never, energy: 0.5 })),
    });
    const side = (x: number, w: number) => (x + w / 2 < 0.5 ? "L" : "R");
    const sides = p.sections.map((s) => side(s.zone.x, s.zone.w));
    expect(new Set(sides).size).toBe(2);
    expect(p.sections[2].relation).toBe("knockout");
    expect(p.sections[2].mode).toBe(2);
    expect(p.sections[5].mode).toBe(3);
    for (const s of p.sections) {
      expect(s.zone.x).toBeGreaterThanOrEqual(0.04);
      expect(s.zone.x + s.zone.w).toBeLessThanOrEqual(0.96);
    }
  });
});

describe("offline designer: songs differ structurally", () => {
  const plans = SONG_FIXTURES.map((f) => offlineDesign(fixtureInput(f)));

  it("every plan carries a valid program", () => {
    for (const plan of plans) {
      expect(plan.sceneProgram).toBeTruthy();
      expect(validateProgram(plan.sceneProgram!.source).ok).toBe(true);
      expect(plan.sceneProgram!.sections.map((s) => s.sectionId)).toEqual(plan.sections.map((s) => s.id));
    }
  });

  it("five contrasting songs get at least four different forms and five different programs", () => {
    const forms = plans.map((p) => p.sceneProgram!.recipe!.split("/")[0]);
    expect(new Set(forms).size, forms.join(",")).toBeGreaterThanOrEqual(4);
    expect(new Set(plans.map((p) => p.sceneProgram!.source)).size).toBe(5);
  });

  it("the form follows the song: post-rock stands pillars, punk prints bars, folk lays strata", () => {
    const byId = Object.fromEntries(SONG_FIXTURES.map((f, i) => [f.id, sceneForms(analyzeFindings(fixtureInput(f)))[0]]));
    expect(byId["last-light"]).toBe("pillars");
    expect(byId["static-youth"]).toBe("bars");
    expect(byId.tide).toBe("strata");
  });

  it("a regenerate without Claude draws another composition (salt + 1)", () => {
    const plan = plans[0];
    const next = offlineSceneProgram(req(0), plan, composerSalt(plan.sceneProgram) + 1);
    expect(composerSalt(next)).toBe(1);
    expect(next.source).not.toBe(plan.sceneProgram!.source);
  });

  it("ensureSceneProgram carries a Claude program across a re-design and keeps the switch", () => {
    const plan = plans[1];
    const claude = { ...plan.sceneProgram!, engine: "claude" as const, title: "Claude 的畫面", enabled: false };
    const redesigned = offlineDesign(fixtureInput(SONG_FIXTURES[1]));
    const out = ensureSceneProgram({ ...fixtureInput(SONG_FIXTURES[1]), previous: { ...plan, sceneProgram: claude } }, redesigned);
    expect(out.sceneProgram?.title).toBe("Claude 的畫面");
    expect(out.sceneProgram?.enabled).toBe(false);
  });
});

describe("Claude scene step", () => {
  const plan = offlineDesign(fixtureInput(SONG_FIXTURES[2]));
  const draft = (source: string) =>
    JSON.stringify({
      title: "碑",
      concept: "霧裡的一塊碑。",
      rationale: "後搖滾的沉默與爆發。",
      source,
      keyMoment: 65,
      sections: plan.sections.map((s) => ({ sectionId: s.id, mode: s.kind === "chorus" ? 2 : 0, params: [0.5, 0.5, 0.5, 0.5], zone: { x: 0.08, y: 0.14, w: 0.4, h: 0.5 }, relation: s.kind === "chorus" ? "lit" : "plain", note: "測試" })),
    });

  it("the output schema converts for structured outputs", () => {
    const fmt = jsonOutputFormat(SceneProgramDraftSchema) as { type: string; schema: Record<string, unknown> };
    expect(fmt.type).toBe("json_schema");
    expect(JSON.stringify(fmt.schema)).toContain("sectionId");
  });

  it("the prompt carries the contract verbatim, the plan's sections, an example and the instruction", () => {
    const prompt = buildScenePrompt({ ...req(2), instruction: "更安靜" }, plan);
    expect(prompt).toContain(PROGRAM_CONTRACT_DOC);
    for (const s of plan.sections) expect(prompt).toContain(`- ${s.id} `);
    expect(prompt).toContain(EXAMPLE_PROGRAMS.find((e) => e.id === "monolith")!.source.trim().slice(0, 60));
    expect(prompt).toContain("更安靜");
  });

  it("a valid program is kept with Claude's engine and model", async () => {
    const t = fakeTransport([message([text(draft(EXAMPLE_PROGRAMS[2].source))], "end_turn")]);
    const r = await designSceneProgram(req(2), plan, {}, { transport: t, configured: true, model: "m1" });
    expect(r.engine).toBe("claude");
    expect(r.program.engine).toBe("claude");
    expect(r.program.keyMoment).toBe(65);
    expect(r.program.sections).toHaveLength(plan.sections.length);
    const call = t.calls[0] as unknown as { output_config: { effort: string; format: unknown }; fallbacks: string; thinking: { type: string } };
    expect(call.output_config.format).toBeTruthy();
    expect(call.fallbacks).toBe("default");
    expect(call.thinking.type).toBe("adaptive");
  });

  it("a refused program gets one repair turn with the validator's errors, then the offline composer", async () => {
    const bad = "#extension GL_OES_standard_derivatives : enable\nvec3 scene(vec2 fc) { return uBg; }";
    const t = fakeTransport([message([text(draft(bad))], "end_turn"), message([text(draft(EXAMPLE_PROGRAMS[0].source))], "end_turn")]);
    const logs: string[] = [];
    const r = await designSceneProgram(req(2), plan, { onLog: (m) => logs.push(m) }, { transport: t, configured: true, model: "m1" });
    expect(t.calls).toHaveLength(2);
    const second = JSON.stringify(t.calls[1].messages);
    expect(second).toContain("前處理");
    expect(r.engine).toBe("claude");
    const t2 = fakeTransport([message([text(draft(bad))], "end_turn"), message([text(draft(bad))], "end_turn")]);
    const r2 = await designSceneProgram(req(2), plan, {}, { transport: t2, configured: true, model: "m1" });
    expect(r2.engine).toBe("offline");
    expect(validateProgram(r2.program.source).ok).toBe(true);
    expect(logs.join()).toMatch(/修正/);
  });

  it("without a key the composer answers; a Claude failure falls back to it", async () => {
    const r = await designSceneProgram(req(2), plan, {}, { configured: false });
    expect(r.engine).toBe("offline");
    const t = fakeTransport([new Error("boom")]);
    const r2 = await designSceneProgram(req(2), plan, {}, { transport: t, configured: true, model: "m" });
    expect(r2.engine).toBe("offline");
  });

  it("the composition picks the same form for the same song", () => {
    const f = analyzeFindings(demoInput());
    const a = chooseComposition({ seed: 1, forms: sceneForms(f), sections: [] });
    const b = chooseComposition({ seed: 1, forms: sceneForms(f), sections: [] });
    expect(a).toEqual(b);
  });
});
