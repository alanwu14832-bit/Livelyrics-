// 用 claude.ai 研究: the prompt (what it carries, 精簡版, the schema and templates matching the API's
// zod schemas) and reading pasted replies (messy JSON, validation errors, the fix prompt, the brief).

import { describe, expect, it } from "vitest";
import { MANUAL_REPLY_MAX_BYTES } from "@/lib/api-client";
import { DesignPlanSchema } from "@/lib/schema";
import { activeSafety, DEFAULT_SAFETY } from "@/lib/stage/safety";
import type { Asset, MoodImage } from "@/lib/types";
import { DirectionDraftSchema } from "./directions";
import { buildManualPrompt, compactJson, directionsTemplate, fieldReference, planTemplate, withoutMediaRules } from "./manual";
import { briefSources, extractBrief, findJson, fixPrompt, MAX_REPLY_BYTES, parseReply, readManualReply, repairJson } from "./manual-reply";
import { offlineDesign } from "./offline";
import { designPlanJsonSchema } from "./output-schema";
import { DESIGN_SYSTEM, RESEARCH_HEADINGS } from "./prompts";
import { analyzeStructure } from "./structure";
import { demoInput } from "./testing/fixtures";
import { publicInfoWith } from "./testing/public-sources";
import type { DesignRequest } from "./types";

const NOW = "2026-09-29T08:00:00.000Z";
const SAFE = { safety: activeSafety(DEFAULT_SAFETY), now: NOW };

function req(overrides: Partial<DesignRequest> = {}): DesignRequest {
  return { ...demoInput(), research: null, ...overrides };
}

const MOOD: MoodImage[] = [
  {
    id: "m1",
    kind: "image",
    name: "海報.png",
    file: "m1.png",
    mimeType: "image/png",
    bytes: 1000,
    width: 800,
    height: 600,
    createdAt: NOW,
    note: "喜歡這個橘紅",
    stats: { palette: ["#e8452c", "#101018"], weights: [0.7, 0.3], luma: 0.3, saturation: 0.7, warmth: 0.5 },
  } as MoodImage,
];

const BRIEF = [
  "我先搜尋了樂團的資料。",
  "",
  "## 樂團視覺識別",
  "- 公開資料有限；[官方網站](https://example.com/band) 用深藍與琥珀色。",
  "## 歌曲意象與情緒",
  "- 夜色、遠方，副歌是一起唱的歌。",
  "## 現場表演觀察",
  "- 副歌大合唱，參考 https://example.org/live 的現場影片。",
  "## 設計方向建議",
  "- 深藍夜色、琥珀燈光，最後一次副歌全開。",
  "## 參考來源",
  "- [樂評](https://example.net/review)",
  "- [這個對話](https://claude.ai/chat/abc)",
].join("\n");

function goodPlanJson(): string {
  const plan = offlineDesign(req());
  plan.keyVisual.title = "港口的夜燈";
  return JSON.stringify(plan, null, 2);
}

describe("the claude.ai prompt", () => {
  it("carries the song, sectioned lyrics, audio, findings, safety, rules and the exact schema", () => {
    const p = buildManualPrompt(req({ publicInfo: publicInfoWith({ genres: ["post-rock"] }) }), { target: "plan" });
    const t = p.prompt;
    expect(t).toContain("〈示範之歌〉");
    expect(t).toContain("Livelyrics Band");
    expect(t).toContain("約 120 BPM");
    expect(t).toMatch(/【a1 主歌（verse）0:08–0:24｜能量 0\.\d\d】/);
    expect(t).toContain("l0 [8.00–12.00] 夜色慢慢落在城市的邊緣");
    expect(t).toContain("## 能量曲線");
    expect(t).toContain("# 免費研究的發現");
    expect(t).toContain("後搖滾");
    expect(t).toContain("LED 安全模式：開");
    expect(t).toContain("1920×1080");
    for (const h of RESEARCH_HEADINGS) expect(t).toContain(`## ${h}`);
    expect(t).toContain("恰好一個** ```json");
    expect(t).toContain("先上網研究");
    // the same design rules as the API path, and the field list of its structured-output schema
    expect(t).toContain(DESIGN_SYSTEM.slice(0, 40));
    expect(t).toContain("- keyVisual：物件");
    expect(t).toMatch(/- scene：其中之一："nebula"、"particles"/);
    expect(t).toContain("duration：73.000 秒");
    expect(p.findings).toBe(true);
    expect(p.images).toEqual([]);
    // deterministic
    expect(buildManualPrompt(req({ publicInfo: publicInfoWith({ genres: ["post-rock"] }) }), { target: "plan" }).prompt).toBe(t);
  });

  it("精簡版 abbreviates lyrics, findings and the catalogue", () => {
    const full = buildManualPrompt(req(), { target: "plan" });
    const compact = buildManualPrompt(req(), { target: "plan", compact: true });
    expect(compact.compact).toBe(true);
    expect(compact.chars).toBeLessThan(full.chars * 0.85);
    expect(compact.prompt).toContain("（這是精簡版");
    expect(compact.prompt).toContain("…（另 2 行：l2–l3）");
    expect(compact.prompt).toContain("（歌詞同 a2：l9–l12）");
    expect(compact.prompt).not.toContain("## 能量曲線");
    expect(compact.prompt).toMatch(/# 場景 scene：nebula（星雲/);
  });

  it("names the bible, the mood board images to attach, the band's material and the instruction", () => {
    const bible = {
      summary: "港口的夜",
      palette: [
        { hex: "#0a1020", role: "背景", name: "港夜" },
        { hex: "#2f6fd6", role: "主色", name: "港藍" },
        { hex: "#f4f4f0", role: "歌詞", name: "白" },
      ],
      fonts: { cjkFont: "noto-serif-tc" as const, latinFont: "playfair-display" as const, weight: 700 },
      motifs: ["燈塔"],
      sceneAffinity: [],
      sceneAvoid: ["tunnel" as const],
      treatments: [],
      lyricPolicy: { mode: "full" as const, note: "" },
      dos: [],
      donts: ["不要用紅色"],
      source: { engine: "manual" as const, updatedAt: NOW },
    };
    const asset: Asset = { id: "a1b2c3d4", kind: "image", name: "專輯封面.jpg", file: "a1b2c3d4.jpg", mimeType: "image/jpeg", bytes: 2000, width: 1000, height: 1000, createdAt: NOW, note: "第一張專輯" };
    const p = buildManualPrompt(req({ bible, bandName: "港口", moodboard: MOOD, assets: [asset], instruction: "副歌更熱血" }), { target: "plan" });
    expect(p.prompt).toContain("# 樂團視覺聖經（硬性規範）");
    expect(p.prompt).toContain("#2f6fd6");
    expect(p.prompt).toContain("不要用紅色");
    expect(p.prompt).toContain("圖 1（這首歌的參考）「海報.png」");
    expect(p.prompt).toContain("喜歡這個橘紅");
    expect(p.prompt).toContain("使用者會在這則訊息附上 1 張參考圖");
    expect(p.prompt).toContain("a1b2c3d4｜圖片｜「專輯封面.jpg」");
    expect(p.prompt).toContain("6. 樂團自己的素材是最強的識別");
    expect(p.prompt).toContain("「副歌更熱血」");
    expect(p.images).toEqual([{ n: 1, name: "海報.png", note: "喜歡這個橘紅" }]);
    // without material the media rules are left out
    expect(buildManualPrompt(req(), { target: "plan" }).prompt).toContain("6. 這首歌沒有提供樂團素材");
    expect(withoutMediaRules(DESIGN_SYSTEM)).not.toContain("# 素材混合 media.blend");
  });

  it("the directions prompt asks for 2–3 directions with the directions schema", () => {
    const p = buildManualPrompt(req({ moodboard: MOOD }), { target: "directions" });
    expect(p.prompt).toContain("提出設計方向");
    expect(p.prompt).toContain("- directions：陣列，每一項是物件");
    expect(p.prompt).toContain("請輸出 3 個（至少 2 個）");
    expect(p.prompt).toContain('"references": [{"image":1');
  });

  it("the templates are valid against the API's zod schemas (only the （…） texts are to be replaced)", () => {
    const r = req();
    const st = analyzeStructure(r);
    const plan = JSON.parse(planTemplate(r, st, false).json);
    expect(DesignPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.sections.map((s: { start: number }) => s.start)).toEqual([0, 8, 24]);
    const compact = planTemplate(r, st, true);
    expect(compact.shown).toBe(2);
    expect(DirectionDraftSchema.safeParse(JSON.parse(directionsTemplate(req({ moodboard: MOOD })))).success).toBe(true);
    expect(JSON.parse(compactJson({ a: [1, 2], b: { c: "x".repeat(100) } }))).toEqual({ a: [1, 2], b: { c: "x".repeat(100) } });
  });

  it("the field reference lists every property of the structured-output schema", () => {
    const ref = fieldReference(designPlanJsonSchema());
    const names = new Set<string>();
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      if (o.properties && typeof o.properties === "object") {
        for (const [k, v] of Object.entries(o.properties as Record<string, unknown>)) {
          names.add(k);
          visit(v);
        }
      }
      if (o.items) visit(o.items);
      if (Array.isArray(o.anyOf)) o.anyOf.forEach(visit);
    };
    visit(designPlanJsonSchema());
    for (const k of names) expect(ref, k).toMatch(new RegExp(`- ${k}：`));
    expect(ref).toContain("- media：物件或 null");
  });
});

describe("finding the JSON in a reply", () => {
  it("a ```json block inside prose, with the brief around it", () => {
    const reply = `${BRIEF}\n\n以下是設計方案：\n\n\`\`\`json\n${goodPlanJson()}\n\`\`\`\n\n希望有幫助！`;
    const r = readManualReply(reply, "plan", req(), SAFE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan!.keyVisual.title).toBe("港口的夜燈");
    expect(DesignPlanSchema.safeParse(r.plan).success).toBe(true);
    expect(r.brief?.brief.startsWith("## 樂團視覺識別")).toBe(true);
    expect(r.brief?.brief).not.toContain("```");
    expect(r.brief?.brief).not.toContain("希望有幫助") ;
  });

  it("the biggest json block wins over a small example; ~~~ fences and bare JSON work too", () => {
    const reply = `例如 \`\`\`json\n{"version": 1}\n\`\`\`\n\n~~~json\n${goodPlanJson()}\n~~~`;
    expect(readManualReply(reply, "plan", req(), SAFE).ok).toBe(true);
    const bare = `好的，這是方案：\njson\n${goodPlanJson()}\n以上。`;
    const r = readManualReply(bare, "plan", req(), SAFE);
    expect(r.ok).toBe(true);
    // an unclosed fence around a complete JSON (the last line was not copied)
    expect(readManualReply(`\`\`\`json\n${goodPlanJson()}\n`, "plan", req(), SAFE).ok).toBe(true);
    // {"plan": {...}} is unwrapped
    expect(readManualReply(`\`\`\`json\n{"plan": ${goodPlanJson()}}\n\`\`\``, "plan", req(), SAFE).ok).toBe(true);
  });

  it("repairs smart quotes, trailing commas, comments, fullwidth punctuation, unquoted keys, raw newlines and Python literals", () => {
    const messy = goodPlanJson()
      .replace('"keyVisual"', "“keyVisual”")
      .replace('"version": 1,', '"version": 1, // 版本')
      .replace(/\n {2}\]/, ",\n  ]")
      .replace('"designerNotes":', "designerNotes：");
    const r = readManualReply(`﻿\`\`\`json\n${messy}\n\`\`\``, "plan", req(), SAFE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notes[0]).toMatch(/JSON 有小問題，已自動修正：.*智慧引號.*結尾多餘的逗號/);
    const fixed = repairJson(`{title: 'It\\'s 夜', "a": "他說"好"然後", b: True, c: None, d: "x\ny" "e": [1,2,],}`);
    expect(JSON.parse(fixed.text)).toEqual({ title: "It's 夜", a: '他說"好"然後', b: true, c: null, d: "x\ny", e: [1, 2] });
  });

  it("finds nothing in a reply without JSON", () => {
    expect(findJson("只有文字，沒有程式碼。", "plan")).toBeNull();
    const r = readManualReply("只有文字，沒有程式碼。", "plan", req(), SAFE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("找不到 JSON");
      expect(r.issues[0].message).toContain("找不到 JSON");
    }
  });
});

describe("clear errors and the fix prompt", () => {
  it("a syntax error names the line and shows where", () => {
    const broken = goodPlanJson().replace('"lines": [', '"lines": [ @@@ ');
    const r = readManualReply(`\`\`\`json\n${broken}\n\`\`\``, "plan", req(), SAFE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("JSON 格式有錯");
    expect(r.issues[0].message).toMatch(/^JSON 第 \d+ 行第 \d+ 個字：這裡有無法辨識的字元。附近的內容：.*⟪這裡⟫@@@/);
    expect(r.fixPrompt).toContain(r.issues[0].message);
    expect(r.fixPrompt).toContain("```json");
    expect(r.fixPrompt).toContain("完整的設計方案（DesignPlan） JSON");
  });

  it("an elided JSON (「...」 in place of sections) says what Claude left out", () => {
    const elided = goodPlanJson().replace(/("sections": \[\n\s*\{)/, "$1 ...").replace('"cues": [', '"cues": [ …');
    const r = readManualReply(`\`\`\`json\n${elided}\n\`\`\``, "plan", req(), SAFE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0].message).toContain("省略了一部分內容");
    expect(r.issues[0].message).toMatch(/在第 \d+ 行第 \d+ 個字（.*⟪這裡⟫…?\.\.\./);
    expect(r.fixPrompt).toContain("不能用 ... 代替");
    expect(repairJson('[1, ..., 3]').ellipsis).toBe(true);
  });

  it("a cut-off reply is called truncated, with a shorter-answer fix prompt; a missing brace is not", () => {
    const cut = readManualReply(`\`\`\`json\n${goodPlanJson().slice(0, 4000)}`, "plan", req(), SAFE);
    expect(cut.ok).toBe(false);
    if (!cut.ok) {
      expect(cut.error).toBe("回覆被截斷了");
      expect(cut.fixPrompt).toContain("被截斷");
      expect(cut.fixPrompt).toContain("designerNotes 150 字內");
    }
    const brace = readManualReply(`\`\`\`json\n${goodPlanJson().replace(/("audioReactivity": [0-9.]+)\n {6}\},/, "$1\n      ,")}\n\`\`\``, "plan", req(), SAFE);
    expect(brace.ok).toBe(false);
    if (!brace.ok) {
      expect(brace.error).toBe("JSON 格式有錯");
      expect(brace.issues.some((i) => i.message.includes("左右括號的數量對不上"))).toBe(true);
    }
  });

  it("refuses what cannot become this song's plan, saying why", () => {
    const plan = JSON.parse(goodPlanJson());
    const cases: Array<[unknown, RegExp]> = [
      [{ ...plan, sections: [] }, /sections 裡沒有任何有數字 start／end/],
      [{ ...plan, keyVisual: null }, /缺少 keyVisual/],
      [{ ...plan, sections: plan.sections.slice(0, 2) }, /只有 2 個段落，但這首歌大約有 6 段/],
      [{ ...plan, keyVisual: { ...plan.keyVisual, title: "（主視覺概念名稱，4–12 字）", concept: "（3–6 句）", motifs: ["（視覺母題）"] } }, /還有 3 個欄位是範本裡的（…）文字/],
      [{ directions: [{ name: "A" }] }, /這是「設計方向」的 JSON/],
      [[1, 2, 3], /最外層應該是一個物件/],
    ];
    for (const [value, re] of cases) {
      const r = readManualReply(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``, "plan", req(), SAFE);
      expect(r.ok, String(re)).toBe(false);
      if (!r.ok) expect(r.issues.map((i) => i.message).join("\n")).toMatch(re);
    }
  });

  it("repairs what normalizePlan can repair, and says so (unknown ids, contrast, timing)", () => {
    const plan = JSON.parse(goodPlanJson());
    plan.sections[1].scene = "sparkle";
    plan.sections[2].lyricColor = plan.sections[2].colorway[0];
    plan.sections[plan.sections.length - 1].end = 60;
    const r = readManualReply(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``, "plan", req(), SAFE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.join("\n")).toContain("sections[1].scene 的「sparkle」不是可用的值");
    expect(r.notes.join("\n")).toContain("（已自動修正）");
    expect(r.notes.some((n) => n.includes("4.5:1"))).toBe(true);
    expect(r.notes.some((n) => n.includes("段落時間已對齊"))).toBe(true);
    expect(r.plan!.sections.at(-1)!.end).toBe(73);
    // LED 安全模式 says what changes on stage (flash transitions become fades)
    expect(r.safety.some((s) => s.includes("閃白轉場改為淡入"))).toBe(true);
  });

  it("caps the size of what is pasted, and refuses empty text", () => {
    expect(MAX_REPLY_BYTES).toBe(MANUAL_REPLY_MAX_BYTES);
    const big = readManualReply("字".repeat(Math.ceil(MAX_REPLY_BYTES / 3) + 10), "plan", req(), SAFE);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.issues[0].message).toContain("超過 200 KB");
    expect(readManualReply("   ", "plan", req(), SAFE).ok).toBe(false);
  });

  it("never evaluates the text (a script is just a string)", () => {
    const g = globalThis as { __pwned?: boolean };
    const plan = JSON.parse(goodPlanJson());
    plan.designerNotes = "<script>globalThis.__pwned = true</script>";
    plan.keyVisual.motifSvg = '<svg viewBox="0 0 100 100" onload="alert(1)"><script>alert(1)</script><circle cx="50" cy="50" r="10"/></svg>';
    const r = readManualReply(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`\n(function(){ globalThis.__pwned = true })()`, "plan", req(), SAFE);
    expect(g.__pwned).toBeUndefined();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan!.keyVisual.motifSvg).not.toContain("script");
      expect(r.plan!.keyVisual.motifSvg).not.toContain("onload");
    }
  });
});

describe("design directions replies", () => {
  const draft = (name: string, hexes: string[]) => ({
    name,
    pitch: `${name}的提案`,
    rationale: "引用研究。",
    references: [{ image: 1, cue: "橘紅" }],
    moodKeywords: ["夜", "光", "海"],
    palette: hexes.map((hex, i) => ({ hex, role: ["背景", "主色", "點綴", "歌詞"][i], name: `色${i}` })),
    typography: { cjkFont: "noto-sans-tc", latinFont: "bebas-neue", weight: 800, letterSpacing: 0.04, rationale: "清楚" },
    motifs: ["燈", "海"],
    emblem: "wave",
    scenes: [{ kind: "chorus", scenes: ["particles"] }],
    sceneTendency: "柔和",
    lyrics: [{ kind: "chorus", style: "karaoke", placement: "center" }],
    lyricTreatment: "副歌 karaoke",
    treatments: [],
    energy: 0.6,
    motion: "soft",
  });

  it("2–3 distinct directions are expanded to plans and marked manual-claude", () => {
    const value = { directions: [draft("港口夜色", ["#0a0f1a", "#2f6fd6", "#f2b233", "#f4f4f0"]), draft("霓虹拼貼", ["#12060c", "#e8452c", "#3ce0d0", "#fafafa"]), draft("紙上黑白", ["#060607", "#8a8a8f", "#e5483b", "#f4f4f2"])] };
    const r = readManualReply(`${BRIEF}\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``, "directions", req({ moodboard: MOOD }), SAFE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.directions!.map((d) => [d.letter, d.name, d.engine])).toEqual([
      ["A", "港口夜色", "manual-claude"],
      ["B", "霓虹拼貼", "manual-claude"],
      ["C", "紙上黑白", "manual-claude"],
    ]);
    expect(r.directions![0].references).toEqual([{ imageId: "m1", cue: "橘紅" }]);
    for (const d of r.directions!) expect(DesignPlanSchema.safeParse(d.plan).success).toBe(true);
    expect(r.brief).not.toBeNull();
  });

  it("one usable direction, or repeats, are refused", () => {
    const one = readManualReply(`\`\`\`json\n${JSON.stringify({ directions: [draft("唯一", ["#0a0f1a", "#2f6fd6", "#f2b233", "#f4f4f0"])] })}\n\`\`\``, "directions", req(), SAFE);
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.issues[0].message).toContain("只有 1 個有名稱（name）的方向");
    const same = ["#0a0f1a", "#2f6fd6", "#f2b233", "#f4f4f0"];
    const twins = readManualReply(`\`\`\`json\n${JSON.stringify({ directions: [draft("甲", same), draft("乙", same)] })}\n\`\`\``, "directions", req(), SAFE);
    expect(twins.ok).toBe(false);
    if (!twins.ok) expect(twins.issues[0].message).toContain("重複");
    const plan = readManualReply(`\`\`\`json\n${goodPlanJson()}\n\`\`\``, "directions", req(), SAFE);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.issues[0].message).toContain("這是「設計方案」的 JSON");
  });
});

describe("the research brief of a reply", () => {
  it("keeps the brief without the preamble, the code and the chat links", () => {
    const b = extractBrief(`${BRIEF}\n\n\`\`\`json\n{}\n\`\`\``, null)!;
    expect(b.brief.startsWith("## 樂團視覺識別")).toBe(true);
    expect(b.sources.map((s) => s.url)).toEqual(["https://example.com/band", "https://example.net/review", "https://example.org/live"]);
    expect(b.sources[0].title).toBe("官方網站");
    expect(briefSources("[x](javascript:alert(1)) https://claude.ai/new")).toEqual([]);
  });

  it("no brief when the reply is only JSON (or a line of chat)", () => {
    expect(extractBrief(`\`\`\`json\n${goodPlanJson()}\n\`\`\``, null)).toBeNull();
    expect(extractBrief("好的，這是修正後的 JSON：", null)).toBeNull();
  });

  it("a JSON-only fix keeps the earlier brief: the failure returns it", () => {
    const r = readManualReply(`${BRIEF}\n\`\`\`json\n{"version": 1, "keyVisual": }\n\`\`\``, "plan", req(), SAFE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.brief?.brief).toContain("## 設計方向建議");
    expect(parseReply("```json\n{}\n```", "plan").ok).toBe(true);
    expect(fixPrompt("directions", [{ message: "x", severity: "error" }])).toContain('{ "directions": [...] }');
  });
});
