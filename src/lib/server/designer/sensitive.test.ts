// Round 14 — sensitive lyrics become symbolic visuals (after chrimage/ai-lyric-video-generator, MIT):
// the Claude rules (design, directions, 專屬畫面, the claude.ai prompt) say so, and the offline
// designer's lexicon maps dark words to symbolic images (withered petals, broken glass, a storm,
// chains, haze, candlelight) without ever enlarging or animating the dark word itself.

import { describe, expect, it } from "vitest";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import { DIRECTIONS_SYSTEM } from "./directions";
import { IMAGERY_FAMILIES, SENSITIVE_WORDS } from "./lexicon/imagery";
import { analyzeLyrics, findImageryFamilies, sensitiveWords } from "./lyric-analysis";
import { buildManualPrompt } from "./manual";
import { offlineDesign } from "./offline";
import { DESIGN_SYSTEM, SENSITIVE_LYRICS_RULE } from "./prompts";
import { SCENE_SYSTEM } from "./scene-program";
import { analyzeStructure } from "./structure";
import { demoInput } from "./testing/fixtures";
import { keyMomentOf } from "@/lib/stage/program/model";
import { tokenizeLyric } from "@/lib/stage/lyrics/tokenize";
import type { Composition } from "@/lib/type/model";
import { composeProjectLine } from "@/lib/type/prepare";
import { darkWords, hasDarkWord, touchesDark } from "@/lib/type/sensitive";
import { approxMeasure, keySpan, lineText } from "@/lib/type/text";
import type { TypeRecipeId } from "@/lib/types";

const DARK_LRC = [
  "[00:08.00]刀子劃開黑夜",
  "[00:12.00]鮮血染紅了整條街",
  "[00:16.00]子彈穿過寂靜的窗",
  "[00:20.00]死亡在門外等我",
  "[00:24.00]I see blood on the floor",
  "[00:28.00]the gun in my hand is cold",
  "[00:32.00]pills and smoke until I'm numb",
  "[00:36.00]dead and buried in the dark",
  "[00:48.00]我想割腕 讓痛停下來",
  "[00:52.00]鮮血染紅了整條街",
  "[00:56.00]I see blood on the floor",
  "[01:00.00]死亡在門外等我",
].join("\n");

/** Literal gore / weapons / self-harm that must never be the picture (titles, motifs, colours, keywords). */
const LITERAL = /血|屍|骷髏|骨頭|槍|刀|子彈|傷口|自殺|割腕|blood|gore|corpse|skull|gun|knife|bullet|wound|suicide/i;

describe("sensitive lyrics in the Claude rules", () => {
  it("the design, directions and 專屬畫面 rules carry the symbolic-imagery guideline", () => {
    for (const system of [DESIGN_SYSTEM, DIRECTIONS_SYSTEM, SCENE_SYSTEM]) expect(system).toContain(SENSITIVE_LYRICS_RULE);
    for (const word of ["暴力", "自傷", "毒品", "隱喻", "暴風雨", "碎玻璃", "凋零的花", "斷裂的鎖鏈", "血腥", "屍體", "骷髏", "武器", "未成年"]) {
      expect(SENSITIVE_LYRICS_RULE).toContain(word);
    }
  });

  it("the claude.ai prompt has it in its rules and in the last check, for a plan and for directions", () => {
    for (const target of ["plan", "directions"] as const) {
      const { prompt } = buildManualPrompt({ ...demoInput(), research: null }, { target });
      expect(prompt).toContain(SENSITIVE_LYRICS_RULE);
      const checks = prompt.slice(prompt.indexOf("# 送出前檢查"));
      expect(checks).toMatch(/暴力、自傷、毒品或性.*象徵/);
    }
  });
});

describe("sensitive lyrics in the offline designer", () => {
  it("dark words find symbolic families whose names, motifs and colours are not literal", () => {
    const zh = findImageryFamilies(["刀子劃開黑夜", "鮮血染紅了整條街", "子彈穿過寂靜", "死亡在門外等我", "我想割腕"]);
    const en = findImageryFamilies(["I see blood on the floor", "the gun in my hand is cold", "pills and smoke until I'm numb", "dead and buried in the chains"]);
    const ids = [...zh, ...en].map((h) => h.family.id);
    expect(ids).toEqual(expect.arrayContaining(["wither", "glass", "smoke", "chains"]));
    // round 17: a weapon or a killing is broken glass, never the storm (「把凋零留在雷電」 made a spectacle of it)
    expect(findImageryFamilies(["他拿著刀 對準我的喉嚨", "殺了我 殺了我", "槍口對著你們每一個人"]).map((h) => h.family.id)).not.toContain("storm");
    for (const h of [...zh, ...en]) {
      expect(h.family.name, h.family.id).not.toMatch(LITERAL);
      expect(h.family.motif, h.family.id).not.toMatch(LITERAL);
      expect(h.family.colors, h.family.id).not.toMatch(LITERAL);
    }
    // no family anywhere in the lexicon is named or drawn as the literal thing
    for (const f of IMAGERY_FAMILIES) expect(`${f.name} ${f.motif} ${f.colors}`, f.id).not.toMatch(/血|屍|骷髏|槍|刀|blood|skull|gun/i);
  });

  it("熱血 is passion (fire), not blood; 血拼 is shopping", () => {
    expect(findImageryFamilies(["熱血沸騰的夜"]).map((h) => h.family.id)).toContain("fire");
    expect(findImageryFamilies(["熱血沸騰的夜"]).map((h) => h.family.id)).not.toContain("wither");
    expect(findImageryFamilies(["週末去血拼"]).map((h) => h.family.id)).not.toContain("wither");
    expect(sensitiveWords("熱血沸騰")).toEqual([]);
    expect(sensitiveWords("鮮血染紅了街 子彈")).toEqual(["鮮血", "子彈"]);
    expect(sensitiveWords("The GUN is cold")).toEqual(["GUN"]);
  });

  it("every sensitive word is a lexicon word, so it is read as one token", () => {
    const words = new Set(IMAGERY_FAMILIES.flatMap((f) => f.words.map((w) => w.toLowerCase())));
    for (const w of SENSITIVE_WORDS) expect(words.has(w.toLowerCase()), w).toBe(true);
  });

  it("a dark song's plan: a symbolic key visual, no dark word enlarged or animated", () => {
    const plan = offlineDesign({ ...demoInput(), lyrics: parseLyricsText(DARK_LRC, "user") });
    const kv = plan.keyVisual;
    expect(kv.title).not.toMatch(LITERAL);
    for (const m of kv.motifs) expect(m).not.toMatch(LITERAL);
    expect(kv.motifs.join("")).toMatch(/凋零|閃電|煙霧|破碎|鎖鏈/);
    for (const k of kv.moodKeywords) expect(k).not.toMatch(LITERAL);
    for (const c of kv.palette) expect(c.name ?? "").not.toMatch(LITERAL);
    for (const l of plan.lines) for (const e of l.emphasis) expect(sensitiveWords(e), `${l.lineId}: ${e}`).toEqual([]);
    const ts = plan.typeSystem;
    expect(ts).toBeTruthy();
    for (const tl of ts!.lines) for (const e of tl.emphasis ?? []) expect(sensitiveWords(e), `${tl.lineId}: ${e}`).toEqual([]);
    const lyricLines = parseLyricsText(DARK_LRC, "user").lines;
    for (const tl of ts!.lines) {
      const line = lyricLines.find((l) => l.id === tl.lineId);
      if (line && sensitiveWords(line.text).length) expect(tl.motionWord ?? "", line.text).toBe("");
    }
  });
});

// Round 17 — the round-16 audit's emo song: the dark words leaked into the wall (a giant 「殺」, a
// bled 「BLEED」, 「滴」 as the display word, an echoing key still, 「殺了我」 as the crowd's chant).
const EMO_LRC = [
  "[00:05.00]刀片劃過手腕 我數著血滴",
  "[00:11.00]浴室的燈太亮 我想死在今晚",
  "[00:17.00]他拿著刀 對準我的喉嚨",
  "[00:24.00]殺了我 殺了我",
  "[00:28.00]鮮血染紅這面牆",
  "[00:33.00]Cut me open, let me bleed",
  "[00:40.00]槍口對著你們每一個人",
  "[00:48.00]殺了我 殺了我",
  "[00:52.00]鮮血染紅這面牆",
  "[00:58.00]我不想再醒來",
  "[01:05.00]把藥全部吞下去",
].join("\n");

const CANVAS = { width: 1920, height: 1080, safe: { top: 0.05, right: 0.05, bottom: 0.08, left: 0.05 } };
const QUIET = new Set(["whisper", "title-card"]);

/** Every glyph a composition sets large or animated apart (the display word, echoes, bled or window words). */
function loudText(c: Composition): string {
  return c.pieces
    .filter((p) => p.role === "giant" || p.window || p.echo || p.bleed)
    .flatMap((p) => p.glyphs.map((g) => g.ch))
    .join("");
}

const units = (text: string) => tokenizeLyric(text).map((u) => ({ ...u, t0: 0, t1: 0 }));

describe("round 17: dark words are never emphasis on the wall", () => {
  const lyrics = parseLyricsText(EMO_LRC, "user");
  const input = { ...demoInput(), lyrics };
  const plan = offlineDesign(input);
  const lines = lyrics.lines;
  const duration = input.meta.duration;

  it("the line table: no dark word is a display word, an echo, a motion word or a key line", () => {
    let dark = 0;
    lines.forEach((l, i) => {
      const r = composeProjectLine({ ...plan, typeSystem: plan.typeSystem! }, lines, i, CANVAS, approxMeasure, { duration, songTitle: input.meta.title });
      if (!r) return;
      const loud = loudText(r.comp);
      const leaked = darkWords(l.text).some((w) => [...w].some((ch) => loud.includes(ch)));
      expect(leaked, `#${i} 「${l.text}」 sets 「${loud}」 large`).toBe(false);
      if (hasDarkWord(l.text)) {
        dark++;
        expect(QUIET.has(r.comp.recipe), `#${i} 「${l.text}」 is ${r.comp.recipe}`).toBe(true);
        expect(r.res.hint.motionWord, `#${i}`).toBe("");
        expect(r.comp.motion, `#${i}`).toBe("still");
        expect(r.res.hint.key, `#${i}`).toBe(false);
        expect(r.comp.pieces.some((p) => p.echo || p.bleed || p.window), `#${i}`).toBe(false);
        for (const e of r.res.hint.emphasis) expect(touchesDark(e, l.text), `#${i} ${e}`).toBe(false);
      }
    });
    expect(dark).toBeGreaterThanOrEqual(9);
  });

  it("an older or hand-made plan is rendered the same way (a giant 殺, a dripping 滴, a bled BLEED)", () => {
    const ts = plan.typeSystem!;
    const loudPlan = {
      ...plan,
      typeSystem: {
        ...ts,
        lines: ts.lines.map((tl) => ({
          ...tl,
          recipe: (tl.lineId === lines[5].id ? "bleed" : tl.lineId === lines[4].id ? "echo" : "giant-word") as TypeRecipeId,
          emphasis: tl.lineId === lines[3].id ? ["殺"] : tl.emphasis,
          motionWord: tl.lineId === lines[0].id ? "滴" : tl.motionWord,
          energy: 0.9,
        })),
      },
    };
    for (const i of [0, 3, 4, 5, 7]) {
      const r = composeProjectLine(loudPlan, lines, i, CANVAS, approxMeasure, { duration });
      expect(r && QUIET.has(r.comp.recipe), `#${i}`).toBe(true);
      for (const e of r!.res.hint.emphasis) expect(touchesDark(e, lines[i].text), `#${i} ${e}`).toBe(false);
      expect(r!.res.hint.motionWord, `#${i}`).toBe("");
      expect(r!.comp.dark, `#${i}`).toBe(true);
    }
    // the featured word of a line the editor sets large skips the dark words
    const t = lineText("殺了我 殺了我", units("殺了我 殺了我"), units("殺了我 殺了我").map(() => false));
    const k = keySpan(t, "", 3);
    expect(k ? t.units.slice(k[0], k[1]).map((u) => u.text).join("") : "").not.toMatch(/殺/);
    const b = lineText("Cut me open, let me bleed", units("Cut me open, let me bleed"), units("Cut me open, let me bleed").map(() => false));
    const kb = keySpan(b, "", 3)!;
    expect(b.units.slice(kb[0], kb[1]).map((u) => u.text).join("").toLowerCase()).not.toBe("bleed");
  });

  it("the key moment, the crowd's chant, the cues and the findings skip the dark lines", () => {
    const t = keyMomentOf(plan, duration, lines);
    const sung = [...lines].filter((l) => l.start != null && (l.start as number) <= t).pop();
    expect(sung ? hasDarkWord(sung.text) : false, `key still at ${t}s sings 「${sung?.text}」`).toBe(false);
    const analysis = analyzeLyrics(lines, input.meta.title, analyzeStructure(input));
    for (const p of analysis.singalong) expect(hasDarkWord(p.text), p.text).toBe(false);
    for (const c of plan.cues) expect(c.detail, c.title).not.toContain("帶全場一起喊");
    expect(plan.designerNotes).not.toMatch(/大合唱重點：[^\n]*(殺|血|bleed)/);
    for (const l of plan.lines) expect(l.note, l.lineId).not.toBe("口號句：巨字帶動全場");
    expect(plan.keyVisual.title).not.toMatch(/雷電/);
    const { prompt } = buildManualPrompt({ ...input, research: null }, { target: "plan" });
    expect(prompt).not.toMatch(/大合唱重點：[^\n]*(殺了我|鮮血|bleed)/);
    expect(prompt).not.toMatch(/歌詞意象：[^\n]*（[^）]*(鮮血|血滴|刀片|槍口)/);
  });

  it("the shared matcher: dark words as written, everyday compounds left alone", () => {
    expect(darkWords("刀片劃過手腕 我數著血滴")).toEqual(["刀片", "血滴"]);
    expect(darkWords("殺了我 殺了我")).toEqual(["殺", "殺"]);
    expect(darkWords("Cut me open, let me BLEED")).toEqual(["BLEED"]);
    expect(darkWords("热血沸腾 去血拼 杀价")).toEqual([]);
    expect(darkWords("杀了我")).toEqual(["杀"]);
    expect(hasDarkWord("拆掉這面牆")).toBe(false);
  });
});
