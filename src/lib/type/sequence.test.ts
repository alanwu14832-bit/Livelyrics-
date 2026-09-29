import { describe, expect, it } from "vitest";
import { TYPE_VOICE_IDS } from "../schema";
import { createDemoProject } from "../stage/demo";
import { resolveLineDesign } from "../stage/resolve";
import { sectionIndexForLine } from "../timeline";
import type { DesignPlan, LyricLine, SectionDesign, TypeSystem } from "../types";
import * as E from "./edit";
import { normalizeTypeSystem } from "./normalize";
import { composeProjectLine } from "./prepare";
import { hasTypeSystem, resolveLine, typeModeActive } from "./resolve";
import { sequenceTypeLines, textKey } from "./sequence";
import { approxMeasure } from "./text";
import { VOICES } from "./vocab";

const SAFE = { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 };
const CANVAS = { width: 1920, height: 1080, safe: SAFE };

/** A song with two choruses (the second the last), a verse, a bridge and repeated hooks. */
function song() {
  const lines: LyricLine[] = [
    { id: "l0", text: "夜色慢慢落在城市的邊緣", start: 8, end: 12 },
    { id: "l1", text: "我們把名字寫進風裡面", start: 12, end: 16 },
    { id: "l2", text: "燈火一盞一盞亮起來", start: 16, end: 20 },
    { id: "l3", text: "腳步聲裡藏著誓言", start: 20, end: 24 },
    { id: "l4", text: "Hey 跟著我唱", start: 24, end: 28 },
    { id: "l5", text: "把心跳交給這個晚上", start: 28, end: 32 },
    { id: "l6", text: "Hey 跟著我唱", start: 32, end: 36 },
    { id: "l7", text: "我們的歌會找到方向", start: 36, end: 40 },
    { id: "l8", text: "雨停了你還在嗎", start: 40, end: 44 },
    { id: "l9", text: "Hey 跟著我唱", start: 48, end: 52 },
    { id: "l10", text: "把心跳交給這個晚上", start: 52, end: 56 },
    { id: "l11", text: "Hey 跟著我唱", start: 56, end: 60 },
    { id: "l12", text: "我們的歌會找到方向", start: 60, end: 64 },
    { id: "l13", text: "直到天亮", start: 64, end: 70 },
  ];
  const sec = (id: string, kind: SectionDesign["kind"], start: number, end: number, energy: number): SectionDesign => ({
    id,
    kind,
    label: id,
    start,
    end,
    energy,
    scene: "nebula",
    sceneParams: { speed: 0.5, density: 0.5, intensity: 0.5, audioReactivity: 0.5 },
    colorway: ["#05060a", "#35507a", "#e0a458"],
    lyricStyle: "line-fade",
    lyricPlacement: "center",
    lyricScale: 1,
    lyricColor: "#f4f1ea",
    transitionIn: "fade",
    media: null,
    rationale: "",
  });
  const sections = [sec("s0", "intro", 0, 8, 0.2), sec("s1", "verse", 8, 24, 0.45), sec("s2", "chorus", 24, 40, 0.85), sec("s3", "bridge", 40, 48, 0.4), sec("s4", "chorus", 48, 64, 0.92), sec("s5", "outro", 64, 73, 0.3)];
  return { lines, sections, duration: 73 };
}

function planWith(ts: TypeSystem, sections: SectionDesign[]): DesignPlan & { typeSystem: TypeSystem } {
  const base = createDemoProject().plan!;
  return { ...base, sections, typeSystem: ts };
}

describe("type sequencing", () => {
  const { lines, sections, duration } = song();
  for (const voice of TYPE_VOICE_IDS) {
    it(`${voice}: one hint per sung line, consecutive lines vary, repeats reuse their composition`, () => {
      const out = sequenceTypeLines({ lines, sections, duration, voice, params: VOICES[voice].params });
      expect(out.map((l) => l.lineId)).toEqual(lines.map((l) => l.id));
      // consecutive different lyrics never share a recipe and side of the frame at once
      for (let i = 1; i < out.length; i++) {
        if (textKey(lines[i].text) === textKey(lines[i - 1].text)) continue;
        const same = out[i].recipe === out[i - 1].recipe && out[i].seed === out[i - 1].seed;
        expect(same, `${lines[i - 1].text} → ${lines[i].text}`).toBe(false);
      }
      expect(out.slice(1).filter((l, i) => l.recipe !== out[i].recipe).length).toBeGreaterThanOrEqual(Math.floor(out.length / 2));
      // every "Hey 跟著我唱" is the same composition (recipe, orientation, seed)
      const hooks = out.filter((l, i) => lines[i].text === "Hey 跟著我唱");
      expect(hooks.length).toBe(4);
      for (const h of hooks) expect([h.recipe, h.orientation, h.seed]).toEqual([hooks[0].recipe, hooks[0].orientation, hooks[0].seed]);
      // only the voice's palette is used
      for (const l of out) expect(Object.keys(VOICES[voice].recipes).concat("whisper")).toContain(l.recipe);
    });
  }

  it("verses are calmer, choruses bigger, the last chorus escalates", () => {
    const out = sequenceTypeLines({ lines, sections, duration, voice: "mv-card", params: VOICES["mv-card"].params });
    const energy = (i: number) => out[i].energy;
    const verse = [0, 1, 2, 3].map(energy);
    const chorus1 = [4, 5, 6, 7].map(energy);
    const chorus2 = [9, 10, 11, 12].map(energy);
    expect(Math.max(...verse)).toBeLessThan(Math.min(...chorus1));
    chorus2.forEach((e, k) => expect(e).toBeGreaterThan(chorus1[k]));
    // the resolver marks the last chorus's repeats as escalated (bigger); the first chorus not
    const { system } = normalizeTypeSystem({ voice: "mv-card" }, { lines, sections, duration, voice: "mv-card" });
    const plan = planWith(system, sections);
    expect(resolveLine(plan, lines, 4, { duration })!.hint.escalate).toBe(false);
    expect(resolveLine(plan, lines, 9, { duration })!.hint.escalate).toBe(true);
    const first = composeProjectLine(plan, lines, 4, CANVAS, approxMeasure, { duration })!;
    const last = composeProjectLine(plan, lines, 9, CANVAS, approxMeasure, { duration })!;
    expect(last.comp.recipe).toBe(first.comp.recipe);
    const area = (b: { w: number; h: number }) => b.w * b.h;
    expect(area(last.comp.bounds)).toBeGreaterThanOrEqual(area(first.comp.bounds) * 0.999);
  });

  it("quiet lines whisper and the bridge brings recipes the song has not used", () => {
    const out = sequenceTypeLines({ lines, sections, duration, voice: "title-sequence", params: VOICES["title-sequence"].params, policy: "minimal", hookKey: textKey("Hey 跟著我唱") });
    // the minimal policy: only the hook is loud, everything else is small type
    lines.forEach((l, i) => {
      if (textKey(l.text) !== textKey("Hey 跟著我唱")) expect(out[i].energy, l.text).toBeLessThanOrEqual(0.26);
    });
    const earlier = new Set(out.slice(0, 8).map((l) => l.recipe));
    const bridge = out[8];
    expect(bridge.energy).toBeLessThanOrEqual(0.26);
    expect(earlier.has(bridge.recipe) && bridge.recipe !== "whisper").toBe(false);
  });

  it("is deterministic, and 重新生成 is another draw of the same rules", () => {
    const input = { lines, sections, duration, voice: "ink" as const, params: VOICES.ink.params };
    expect(sequenceTypeLines(input)).toEqual(sequenceTypeLines(input));
    const other = sequenceTypeLines({ ...input, salt: 3 });
    expect(other).not.toEqual(sequenceTypeLines(input));
    expect(other.map((l) => l.lineId)).toEqual(lines.map((l) => l.id));
  });
});

describe("the 排版 editor's operations", () => {
  const { lines, sections, duration } = song();
  const ctx: E.EditContext = { lines, sections, duration };
  const base = E.createTypeSystem("mv-card", ctx);
  const plan = (ts: TypeSystem) => planWith(ts, sections);

  it("換一個構圖 walks a fixed seed sequence; the line's layout changes, the rest stays", () => {
    const a = E.reroll(base, "l1", ctx);
    const b = E.reroll(a, "l1", ctx);
    expect(E.currentSeed(a, "l1")).not.toBe(E.currentSeed(base, "l1"));
    expect(E.currentSeed(b, "l1")).not.toBe(E.currentSeed(a, "l1"));
    expect(E.reroll(base, "l1", ctx)).toEqual(a);
    expect(a.lines.filter((l) => l.lineId !== "l1")).toEqual(base.lines.filter((l) => l.lineId !== "l1"));
  });

  it("tapping characters builds exact-substring emphasis; adjacent characters join", () => {
    let ts = E.toggleEmphasisUnit(base, "l0", 0, [], ctx); // 夜
    let emph = resolveLine(plan(ts), lines, 0, { duration })!.hint.emphasis;
    ts = E.toggleEmphasisUnit(ts, "l0", 1, emph, ctx); // 色
    emph = resolveLine(plan(ts), lines, 0, { duration })!.hint.emphasis;
    expect(emph).toEqual(["夜色"]);
    ts = E.toggleEmphasisUnit(ts, "l0", 7, emph, ctx); // 的? (城 市 的 …) the 8th unit
    emph = resolveLine(plan(ts), lines, 0, { duration })!.hint.emphasis;
    expect(emph.length).toBe(2);
    for (const e of emph) expect(lines[0].text).toContain(e);
    // Latin words are one unit each
    expect(E.tapUnits("Hey 跟著我唱").map((u) => u.text)).toEqual(["Hey", "跟", "著", "我", "唱"]);
  });

  it("nudge, size and rotation are clamped edits that compose; reset returns the generated line", () => {
    let ts = E.nudgeTo(base, "l2", 0.9, -0.1, ctx);
    ts = E.setScale(ts, "l2", 5, ctx);
    ts = E.setRotate(ts, "l2", -45, ctx);
    const h = resolveLine(plan(ts), lines, 2, { duration })!.hint;
    expect([h.dx, h.dy, h.scale, h.rotate]).toEqual([0.5, -0.1, 2, -30]);
    const moved = composeProjectLine(plan(ts), lines, 2, CANVAS, approxMeasure, { duration })!;
    const orig = composeProjectLine(plan(base), lines, 2, CANVAS, approxMeasure, { duration })!;
    expect(moved.key).not.toBe(orig.key);
    // an edited composition still stays inside the canvas
    expect(moved.comp.readBounds.x).toBeGreaterThanOrEqual(-0.5);
    expect(moved.comp.readBounds.x + moved.comp.readBounds.w).toBeLessThanOrEqual(CANVAS.width + 0.5);
    expect(E.resetLine(ts, "l2")).toEqual(base);
  });

  it("a lock survives 「重新生成全部構圖」 and a voice switch; everything else is redrawn", () => {
    let ts = E.setRecipe(base, "l1", "grid-poem", ctx);
    ts = E.setLocked(ts, "l1", true, ctx);
    const again = E.regenerateAll(ts, ctx);
    const l1 = again.lines.find((l) => l.lineId === "l1")!;
    expect(l1.locked).toBe(true);
    expect(l1.edit?.recipe).toBe("grid-poem");
    expect(again.generation).toBe((ts.generation ?? 0) + 1);
    expect(again.lines.filter((l) => l.lineId !== "l1")).not.toEqual(ts.lines.filter((l) => l.lineId !== "l1"));
    const ink = E.setVoice(ts, "ink", ctx);
    expect(ink.voice).toBe("ink");
    expect(ink.params).toEqual(VOICES.ink.params);
    expect(ink.lines.find((l) => l.lineId === "l1")!.edit?.recipe).toBe("grid-poem");
    for (const l of ink.lines) if (l.lineId !== "l1") expect(Object.keys(VOICES.ink.recipes).concat("whisper")).toContain(l.recipe);
  });

  it("editing a repeat keeps what the first occurrence's edit gave every chorus", () => {
    let ts = E.nudgeTo(base, "l4", 0.1, 0, ctx);
    // the repeats follow the first occurrence
    expect(resolveLine(plan(ts), lines, 6, { duration })!.hint.dx).toBe(0.1);
    ts = E.setColorRole(ts, "l6", "accent", ctx);
    const h6 = resolveLine(plan(ts), lines, 6, { duration })!.hint;
    expect([h6.dx, h6.color]).toEqual([0.1, "accent"]);
    expect(resolveLine(plan(ts), lines, 4, { duration })!.hint.color).toBe("auto");
  });

  it("sections take overrides; the A/B version has no edits; history undoes and redoes, drags merge", () => {
    let ts = E.setSection(base, "s2", { recipe: "poster", scale: 1.3 });
    expect(E.sectionOverride(ts, "s2")).toEqual({ sectionId: "s2", recipe: "poster", scale: 1.3 });
    expect(resolveLine(plan(ts), lines, 5, { duration })!.hint.recipe).toBe("poster");
    ts = E.setSection(ts, "s2", { recipe: null, scale: null });
    expect(ts.sections).toBeUndefined();
    const edited = E.setSection(E.reroll(base, "l3", ctx), "s1", { orientation: "v" });
    const gen = E.generatedVersion(edited);
    expect(gen.lines.every((l) => !l.edit)).toBe(true);
    expect(gen.sections).toBeUndefined();

    let h = E.historyOf(base);
    h = E.commit(h, E.nudgeTo(h.present, "l0", 0.01, 0, ctx), "drag");
    h = E.commit(h, E.nudgeTo(h.present, "l0", 0.02, 0, ctx), "drag");
    h = E.commit(h, E.nudgeTo(h.present, "l0", 0.03, 0, ctx), "drag");
    expect(h.past.length).toBe(1);
    h = E.commit(h, E.reroll(h.present, "l0", ctx));
    expect(h.past.length).toBe(2);
    h = E.undo(h);
    expect(E.currentSeed(h.present, "l0")).toBe(E.currentSeed(base, "l0"));
    h = E.undo(h);
    expect(h.present).toBe(base);
    h = E.redo(E.redo(h));
    expect(E.currentSeed(h.present, "l0")).not.toBe(E.currentSeed(base, "l0"));
  });

  it("the stored edits survive normalization (the save path) and stay valid", () => {
    let ts = E.nudgeTo(base, "l2", 0.12, 0.05, ctx);
    ts = E.setLocked(E.setEnter(ts, "l2", "rise", ctx), "l2", true, ctx);
    ts = E.setSection(ts, "s1", { motion: 0.2 });
    const again = normalizeTypeSystem(JSON.parse(JSON.stringify(ts)), { lines, sections, duration, voice: "mv-card", keepEdits: true }).system;
    expect(again).toEqual(ts);
  });
});

describe("old plans", () => {
  it("resolve to their legacy lyric styles (no type system, the DOM lyric layer)", () => {
    const p = createDemoProject();
    expect(hasTypeSystem(p.plan)).toBe(false);
    expect(typeModeActive(p.plan, null)).toBe(false);
    const lines = p.lyrics.lines;
    const idx = lines.findIndex((l) => l.text.trim());
    const si = sectionIndexForLine(p.plan, lines, idx, p.meta.duration)!;
    const section = p.plan!.sections[si];
    expect(resolveLineDesign(p.plan, lines[idx].id, section.lyricStyle, null).style).toBe(section.lyricStyle);
    // karaoke stays a valid style for them
    const karaoke = { ...p.plan!, sections: p.plan!.sections.map((s) => ({ ...s, lyricStyle: "karaoke" as const })) };
    expect(resolveLineDesign(karaoke, lines[idx].id, "karaoke", null).style).toBe("karaoke");
  });

  it("a type system switches the stage to compositions, and an operator style override back to legacy", () => {
    const p = createDemoProject();
    const { system } = normalizeTypeSystem({ voice: "glitch" }, { lines: p.lyrics.lines, sections: p.plan!.sections, duration: p.meta.duration, voice: "glitch" });
    const plan = { ...p.plan!, typeSystem: system };
    expect(typeModeActive(plan, null)).toBe(true);
    expect(typeModeActive(plan, { lyricStyle: null })).toBe(true);
    expect(typeModeActive(plan, { lyricStyle: "subtitle" })).toBe(false);
    // a broken type system never throws: it renders with repaired values
    const broken = { ...plan, typeSystem: { ...system, params: { ...system.params, density: 99 }, lines: [{ lineId: "l0", recipe: "nope" }] } } as unknown as DesignPlan & { typeSystem: TypeSystem };
    const r = composeProjectLine(broken, p.lyrics.lines, p.lyrics.lines.findIndex((l) => l.text.trim()), CANVAS, approxMeasure, { duration: p.meta.duration });
    expect(r).not.toBeNull();
  });
});
