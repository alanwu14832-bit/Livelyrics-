// 字體藝術 across the designers: every engine (Claude, free/offline, directions, the claude.ai
// manual prompt and reply) designs a type system with a composition for every sung line and never
// picks karaoke or subtitle; normalizePlan repairs and completes the new fields; the structured
// output schema accepts a full plan.

import { describe, expect, it } from "vitest";
import { defaultBible } from "@/lib/band";
import { DesignPlanDraftSchema, DesignPlanSchema, TYPE_RECIPE_IDS, type DesignPlan } from "@/lib/schema";
import { activeSafety, DEFAULT_SAFETY } from "@/lib/stage/safety";
import { textKey } from "@/lib/type/sequence";
import type { BandBible, LyricLine } from "@/lib/types";
import { buildDirections, normalizeDirectionDrafts, offlineDirectionSpecs } from "./directions";
import { designSong } from "./index";
import { buildManualPrompt, planTemplate } from "./manual";
import { readManualReply } from "./manual-reply";
import { normalizePlan, normalizePlanWithReport } from "./normalize";
import { offlineDesign } from "./offline";
import { designPlanJsonSchema } from "./output-schema";
import { analyzeStructure } from "./structure";
import { fakeTransport, message, text } from "./testing/fake-claude";
import { demoInput, demoLyrics } from "./testing/fixtures";
import { publicInfoWith } from "./testing/public-sources";
import { chooseVoice } from "./type-design";
import { analyzeFindings } from "./findings";
import type { DesignRequest } from "./types";

const NOW = "2026-09-29T08:00:00.000Z";
const SAFE = { safety: activeSafety(DEFAULT_SAFETY), now: NOW };
const req = (over: Partial<DesignRequest> = {}): DesignRequest => ({ ...demoInput(), research: null, ...over });

const LEGACY = new Set(["karaoke", "subtitle"]);

/** No automatic choice of karaoke / subtitle; a type system with a hint for every sung line. */
function expectComposed(plan: DesignPlan, lines: readonly LyricLine[], label: string) {
  for (const s of plan.sections) expect(LEGACY.has(s.lyricStyle), `${label}: ${s.label} ${s.lyricStyle}`).toBe(false);
  for (const l of plan.lines) expect(l.styleOverride && LEGACY.has(l.styleOverride), `${label}: ${l.lineId}`).toBeFalsy();
  expect(plan.typeSystem, label).toBeTruthy();
  const ids = new Set(plan.typeSystem!.lines.map((l) => l.lineId));
  for (const l of lines) if (l.text.trim()) expect(ids.has(l.id), `${label}: ${l.id}`).toBe(true);
  for (const l of plan.typeSystem!.lines) {
    expect(TYPE_RECIPE_IDS).toContain(l.recipe);
    const text = lines.find((x) => x.id === l.lineId)!.text;
    for (const e of l.emphasis) expect(text).toContain(e);
    if (l.motionWord) expect(text).toContain(l.motionWord);
  }
  expect(DesignPlanSchema.safeParse(plan).success, label).toBe(true);
}

const BIBLE = (mode: BandBible["lyricPolicy"]["mode"]): BandBible => ({
  ...defaultBible(),
  summary: "港口的夜",
  palette: [
    { hex: "#0a1020", role: "背景", name: "港夜" },
    { hex: "#2f6fd6", role: "主色", name: "港藍" },
    { hex: "#f2b233", role: "點綴", name: "燈" },
    { hex: "#f4f4f0", role: "歌詞", name: "白" },
  ],
  fonts: { cjkFont: "noto-serif-tc", latinFont: "playfair-display", weight: 800 },
  lyricPolicy: { mode, note: "" },
  source: { engine: "manual", updatedAt: NOW },
});

describe("karaoke and subtitle are never chosen automatically", () => {
  const genres = [null, "post-rock", "shoegaze", "city pop", "indie rock", "folk", "metal", "punk", "hip hop", "electronic", "pop", "math rock", "ambient", "emo", "rnb"];
  it("the free / offline designer, for every genre rule and every lyric policy", () => {
    for (const g of genres) {
      const input = req(g ? { publicInfo: publicInfoWith({ genres: [g] }) } : {});
      expectComposed(offlineDesign(input), input.lyrics.lines, `offline ${g}`);
    }
    for (const mode of ["chorus-only", "full", "minimal"] as const) {
      const input = req({ bible: BIBLE(mode), bandName: "港口" });
      const plan = offlineDesign(input);
      expectComposed(plan, input.lyrics.lines, `bible ${mode}`);
      // the bible's fonts are the type system's fonts
      expect(plan.typeSystem!.fonts).toEqual({ cjk: "noto-serif-tc", latin: "playfair-display" });
      // every sung line appears: no section with lines hides them
      for (const s of plan.sections) {
        const sung = input.lyrics.lines.some((l) => l.start != null && l.start >= s.start && l.start < s.end && l.text.trim());
        if (sung) expect(s.lyricStyle, `${mode} ${s.label}`).not.toBe("hidden");
      }
    }
    // a dense, long song (rap-like verses) and an English song
    const lines = Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, text: i % 5 === 0 ? "Hey hey 一起唱" : `第${i}句很長很長很長很長的歌詞在這裡快速唱過`, start: 4 + i * 1.5, end: null }));
    const dense = req({ lyrics: { source: "user", synced: true, lines } });
    expectComposed(offlineDesign(dense), lines, "dense");
    const english = demoInput();
    english.lyrics.lines = english.lyrics.lines.map((l, i) => ({ ...l, text: i % 2 ? "Sing along tonight" : "Walking down the empty street" }));
    const en = offlineDesign(english);
    expectComposed(en, english.lyrics.lines, "english");
    expect(en.typeSystem!.lines.every((l) => l.orientation === "h")).toBe(true);
  });

  it("the offline directions: three different voices, compositions in every plan", () => {
    for (const g of [null, "punk", "folk", "city pop"]) {
      const r = req(g ? { publicInfo: publicInfoWith({ genres: [g] }) } : {});
      const dirs = buildDirections(offlineDirectionSpecs(r), r, { engine: "offline", now: NOW });
      expect(new Set(dirs.map((d) => d.plan.typeSystem!.voice)).size, `${g}`).toBe(dirs.length);
      for (const d of dirs) expectComposed(d.plan, r.lyrics.lines, `direction ${g} ${d.letter}`);
    }
    // the song's own voice is one of the three (punk → glitch, folk → ink)
    const punk = req({ publicInfo: publicInfoWith({ genres: ["punk"] }) });
    expect(buildDirections(offlineDirectionSpecs(punk), punk, { engine: "offline", now: NOW }).map((d) => d.plan.typeSystem!.voice)).toContain("glitch");
    const folk = req({ publicInfo: publicInfoWith({ genres: ["folk"] }) });
    expect(buildDirections(offlineDirectionSpecs(folk), folk, { engine: "offline", now: NOW }).map((d) => d.plan.typeSystem!.voice)).toContain("ink");
  });

  it("Claude's directions: karaoke rows dropped, a repeated voice moved to a free one", () => {
    const r = req();
    const offline = offlineDirectionSpecs(r);
    const draft = (name: string, hex: string) => ({
      name,
      pitch: "p",
      rationale: "r",
      references: [],
      moodKeywords: [],
      palette: [
        { hex: "#05060a", role: "背景", name: "夜" },
        { hex, role: "主色", name: "c" },
        { hex: "#29e0ff", role: "點綴", name: "青" },
        { hex: "#f5f5f5", role: "歌詞", name: "白" },
      ],
      typography: { cjkFont: "noto-sans-tc", latinFont: "anton", weight: 800, letterSpacing: 0.02, rationale: "粗" },
      motifs: ["雨"],
      emblem: "wave",
      scenes: [{ kind: "chorus", scenes: ["rain"] }],
      sceneTendency: "雨",
      lyrics: [{ kind: "chorus", style: "karaoke", placement: "center" }, { kind: "verse", style: "subtitle", placement: "lower-third" }],
      typeVoice: "glitch",
      lyricTreatment: "t",
      treatments: [],
      energy: 0.6,
      motion: "punchy",
    });
    const specs = normalizeDirectionDrafts({ directions: [draft("甲", "#e8452c"), draft("乙", "#2fd65a")] }, r, offline);
    for (const s of specs) for (const l of Object.values(s.lyrics)) expect(LEGACY.has(l!.style)).toBe(false);
    const dirs = buildDirections(specs, r, { engine: "claude", now: NOW });
    expect(dirs.map((d) => d.plan.typeSystem!.voice)).toEqual(["glitch", "mv-card"]);
    for (const d of dirs) expectComposed(d.plan, r.lyrics.lines, `claude direction ${d.letter}`);
  });

  it("Claude's plan: a reply that still says karaoke (or has no type system) is repaired into compositions", async () => {
    const base = offlineDesign(req());
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { sections: Array<Record<string, unknown>>; lines: Array<Record<string, unknown>> };
    raw.sections = raw.sections.map((s) => ({ ...s, lyricStyle: s.kind === "chorus" ? "karaoke" : s.lyricStyle === "hidden" ? "hidden" : "subtitle" }));
    raw.lines = [{ lineId: "l4", emphasis: ["Hey"], styleOverride: "karaoke", note: "" }];
    delete raw.typeSystem;
    const t = fakeTransport([message([text(JSON.stringify(raw))], "end_turn")]);
    const plan = await designSong(req(), {}, { transport: t, configured: true });
    expectComposed(plan, demoLyrics().lines, "claude");
    // the structured output asked for the type system
    const schema = t.calls[0].output_config?.format as { schema: { properties: Record<string, unknown> } } | undefined;
    expect(Object.keys(schema!.schema.properties)).toContain("typeSystem");
  });

  it("the claude.ai prompt and its reply: the template composes, a karaoke reply is repaired", () => {
    const r = req();
    const p = buildManualPrompt(r, { target: "plan" });
    expect(p.prompt).toContain("typeSystem");
    expect(p.prompt).toContain("字體藝術");
    const st = analyzeStructure(r);
    const template = JSON.parse(planTemplate(r, st, false).json);
    expect(JSON.stringify(template)).not.toMatch(/karaoke|subtitle/);
    expect(template.typeSystem.lines.length).toBeGreaterThan(0);
    const plan = offlineDesign(r);
    const reply = JSON.parse(JSON.stringify(plan));
    reply.sections[2].lyricStyle = "karaoke";
    reply.typeSystem.lines[0].recipe = "karaoke-sweep";
    reply.typeSystem.params.density = 7;
    const out = readManualReply("```json\n" + JSON.stringify(reply) + "\n```", "plan", r, SAFE);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expectComposed(out.plan!, r.lyrics.lines, "manual");
    expect(out.plan!.typeSystem!.params.density).toBe(1);
    expect(out.notes.join("\n")).toMatch(/字體藝術|構圖/);
  });
});

describe("the voice follows the song", () => {
  it("genre rules and the audio mood pick the voice", () => {
    const voice = (g: string | null, input = demoInput()) => chooseVoice(analyzeFindings(g ? { ...input, publicInfo: publicInfoWith({ genres: [g] }) } : input), true).voice;
    expect(voice("punk")).toBe("glitch");
    expect(voice("math rock")).toBe("glitch");
    expect(voice("folk")).toBe("ink");
    expect(voice("city pop")).toBe("title-sequence");
    expect(voice("post-rock")).toBe("mv-card");
    expect(voice("shoegaze")).toBe("mv-card");
    // post-rock / shoegaze: big whitespace
    const post = offlineDesign(req({ publicInfo: publicInfoWith({ genres: ["post-rock"] }) }));
    expect(post.typeSystem!.params.density).toBeLessThanOrEqual(0.2);
    // no genre: a slow dark song is ink, the demo (quiet → explosive) the MV card
    const calm = demoInput();
    const slow = { ...calm.analysis!, bpm: 70, energy: calm.analysis!.energy.map(() => 0.25), brightness: calm.analysis!.brightness.map(() => 0.2), sections: calm.analysis!.sections.map((x) => ({ ...x, energy: 0.25 })) };
    expect(voice(null, { ...calm, analysis: slow })).toBe("ink");
    expect(voice(null)).toBe("mv-card");
    // Latin lyrics never get the brush
    expect(chooseVoice(analyzeFindings({ ...calm, publicInfo: publicInfoWith({ genres: ["folk"] }) }), false).voice).toBe("mv-card");
  });

  it("per line: sing-along phrases and imagery become emphasis, images become motion words", () => {
    const plan = offlineDesign(req());
    const ts = plan.typeSystem!;
    const byId = new Map(ts.lines.map((l) => [l.lineId, l]));
    const lines = demoLyrics().lines;
    const hey = lines.find((l) => l.text.startsWith("Hey"))!;
    expect(byId.get(hey.id)!.emphasis).toContain("Hey");
    // a repeated lyric reuses its first composition
    const groups = new Map<string, string[]>();
    for (const l of lines) groups.set(textKey(l.text), [...(groups.get(textKey(l.text)) ?? []), l.id]);
    for (const ids of groups.values()) {
      const hints = ids.map((id) => byId.get(id)!);
      for (const h of hints) expect([h.recipe, h.seed]).toEqual([hints[0].recipe, hints[0].seed]);
    }
    expect(ts.lines.some((l) => l.motionWord)).toBe(true);
    expect(plan.designerNotes).toContain("## 字體語言");
  });
});

describe("normalizePlan on the type system", () => {
  const input = req();
  const base = offlineDesign(input);

  it("clamps numbers, fixes fonts, drops unknown recipes / ids / emphasis and fills the missing lines", () => {
    const raw = JSON.parse(JSON.stringify(base));
    raw.typeSystem.params = { ...raw.typeSystem.params, scaleContrast: 4, density: -2, gridColumns: 40, motionSpeed: "0.5" };
    raw.typeSystem.fonts = { cjk: "anton", latin: "noto-sans-tc" };
    raw.typeSystem.weight = 300;
    raw.typeSystem.voice = "vaporwave";
    raw.typeSystem.ornaments = ["seal", "confetti", "rule", "rule"];
    raw.typeSystem.lines = [
      { lineId: "l0", recipe: "giant-word", emphasis: ["夜色", "不存在的字"], orientation: "v", energy: 9, motionWord: "夜", seed: -5 },
      { lineId: "l1", recipe: "karaoke", emphasis: [], orientation: "h", energy: 0.3, motionWord: "", seed: 1 },
      { lineId: "l999", recipe: "poster", emphasis: [], orientation: "h", energy: 0.5, motionWord: "", seed: 2 },
    ];
    const { plan, repairs } = normalizePlanWithReport(raw, input);
    const ts = plan.typeSystem!;
    expect(ts.params.scaleContrast).toBe(1);
    expect(ts.params.density).toBe(0);
    expect(ts.params.gridColumns).toBe(12);
    expect(ts.params.motionSpeed).toBe(0.5);
    expect(ts.voice).toBe(chooseVoice(analyzeFindings(input), true).voice);
    expect(ts.weight).toBe(600);
    expect(ts.ornaments).toEqual(["seal", "rule"]);
    expect(ts.fonts.cjk).not.toBe("anton");
    const l0 = ts.lines.find((l) => l.lineId === "l0")!;
    expect(l0.emphasis).toEqual(["夜色"]);
    expect(l0.energy).toBe(1);
    expect(l0.seed).toBe(5);
    // the unknown recipe is re-drawn, the unknown id dropped, every sung line covered
    expect(TYPE_RECIPE_IDS).toContain(ts.lines.find((l) => l.lineId === "l1")!.recipe);
    expect(ts.lines.some((l) => l.lineId === "l999")).toBe(false);
    expect(ts.lines.length).toBe(input.lyrics.lines.filter((l) => l.text.trim()).length);
    expect(repairs.join("\n")).toMatch(/構圖/);
  });

  it("keeps the editor's edits and locks (the save path and a re-normalized stored plan)", () => {
    const raw = JSON.parse(JSON.stringify(base));
    raw.typeSystem.lines[0].edit = { dx: 0.9, seed: 42, recipe: "window", emphasis: ["夜"], enter: "rise" };
    raw.typeSystem.lines[0].locked = true;
    raw.typeSystem.sections = [{ sectionId: "s1", recipe: "poster", scale: 3 }, { sectionId: "nope", recipe: "poster" }];
    const ts = normalizePlan(raw, input).typeSystem!;
    expect(ts.lines[0].edit).toEqual({ dx: 0.5, seed: 42, recipe: "window", emphasis: ["夜"], enter: "rise" });
    expect(ts.lines[0].locked).toBe(true);
    expect(ts.sections).toEqual([{ sectionId: "s1", recipe: "poster", scale: 1.6 }]);
  });

  it("an old plan stays old when it is only shifted or kept; a design output always gets compositions", () => {
    const legacy = JSON.parse(JSON.stringify(base));
    delete legacy.typeSystem;
    legacy.sections[2].lyricStyle = "karaoke";
    const kept = normalizePlan(legacy, input, { typeSystem: "keep" });
    expect(kept.typeSystem).toBeUndefined();
    expect(kept.sections[2].lyricStyle).toBe("karaoke");
    const designed = normalizePlan(legacy, input);
    expectComposed(designed, input.lyrics.lines, "fill");
  });
});

describe("the structured output schema", () => {
  /** A validator for the strict subset the schema uses (type, enum, properties, required, items, anyOf). */
  function validate(schema: Record<string, unknown>, value: unknown, path = "$"): string[] {
    const errs: string[] = [];
    if (Array.isArray(schema.anyOf)) {
      const ok = (schema.anyOf as Record<string, unknown>[]).some((s) => validate(s, value, path).length === 0);
      return ok ? [] : [`${path}: no anyOf branch matches`];
    }
    if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in enum`);
    const type = schema.type;
    const is = (t: unknown) =>
      t === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) : t === "array" ? Array.isArray(value) : t === "number" ? typeof value === "number" : t === "integer" ? Number.isInteger(value) : t === "string" ? typeof value === "string" : t === "boolean" ? typeof value === "boolean" : t === "null" ? value === null : true;
    if (type && !is(type)) return [...errs, `${path}: expected ${String(type)}`];
    if (type === "object") {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const k of (schema.required as string[]) ?? []) if (!(k in (value as object))) errs.push(`${path}.${k}: missing`);
      if (schema.additionalProperties === false) for (const k of Object.keys(value as object)) if (!(k in props)) errs.push(`${path}.${k}: not allowed`);
      for (const [k, s] of Object.entries(props)) if (k in (value as object)) errs.push(...validate(s, (value as Record<string, unknown>)[k], `${path}.${k}`));
    }
    if (type === "array" && schema.items) (value as unknown[]).forEach((v, i) => errs.push(...validate(schema.items as Record<string, unknown>, v, `${path}[${i}]`)));
    return errs;
  }

  it("accepts a full plan with its type system (what Claude is asked to write)", () => {
    const plan = offlineDesign(req());
    // the draft Claude writes: the plan without editor-only fields
    const draft = JSON.parse(JSON.stringify(plan));
    for (const l of draft.typeSystem.lines) {
      delete l.locked;
      delete l.edit;
    }
    delete draft.typeSystem.sections;
    delete draft.typeSystem.generation;
    expect(DesignPlanDraftSchema.safeParse(draft).success).toBe(true);
    expect(validate(designPlanJsonSchema(), draft)).toEqual([]);
    // and rejects karaoke in a section
    const bad = JSON.parse(JSON.stringify(draft));
    bad.sections[2].lyricStyle = "karaoke";
    expect(validate(designPlanJsonSchema(), bad).some((e) => e.includes("lyricStyle"))).toBe(true);
  });

  it("stays compact for a long song: repeats may be left out, the budget holds", () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ id: `l${i}`, text: i % 4 === 0 ? "副歌的那一句一起唱" : `敘事的第${i}句歌詞`, start: 2 + i * 1.2, end: null }));
    const plan = offlineDesign(req({ lyrics: { source: "user", synced: true, lines } }));
    const unique = plan.typeSystem!.lines.filter((l, i, a) => a.findIndex((x) => textKey(lines.find((y) => y.id === x.lineId)!.text) === textKey(lines.find((y) => y.id === l.lineId)!.text)) === i);
    // ~45 tokens per hint: the unique lines fit well inside DESIGN_MAX_TOKENS (48k) with the rest of the plan
    const chars = JSON.stringify(unique.map(({ lineId, recipe, emphasis, orientation, energy, motionWord, seed }) => ({ lineId, recipe, emphasis, orientation, energy, motionWord, seed }))).length;
    expect(chars / 2.2).toBeLessThan(20_000);
  });
});
