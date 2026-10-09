// Round 14 — sensitive lyrics become symbolic visuals (after chrimage/ai-lyric-video-generator, MIT):
// the Claude rules (design, directions, 專屬畫面, the claude.ai prompt) say so, and the offline
// designer's lexicon maps dark words to symbolic images (withered petals, broken glass, a storm,
// chains, haze, candlelight) without ever enlarging or animating the dark word itself.

import { describe, expect, it } from "vitest";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import { DIRECTIONS_SYSTEM } from "./directions";
import { IMAGERY_FAMILIES, SENSITIVE_WORDS } from "./lexicon/imagery";
import { findImageryFamilies, sensitiveWords } from "./lyric-analysis";
import { buildManualPrompt } from "./manual";
import { offlineDesign } from "./offline";
import { DESIGN_SYSTEM, SENSITIVE_LYRICS_RULE } from "./prompts";
import { SCENE_SYSTEM } from "./scene-program";
import { demoInput } from "./testing/fixtures";

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
    expect(ids).toEqual(expect.arrayContaining(["wither", "storm", "smoke", "chains"]));
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
