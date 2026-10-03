// 專屬畫面 (phase 7): the song's own generative scene program.
//
// Claude path: one structured-output call (claudeStructured: the same transport, continuations,
// server-side fallbacks, adaptive thinking and deadline as the song designer) asks the band's
// stage-visual designer for a designed image — composition, focal point, negative space, restraint,
// texture, a reason rooted in this song — written as a GLSL function body against the fixed uniform
// contract (PROGRAM_CONTRACT_DOC, verbatim), plus a state per section (mode, parameters, the text
// zone and how the words meet the image). The program is validated (validateProgram); a refused
// program gets one repair turn with the validator's errors, then the offline composer takes over.
// Offline path (no key, a free run, any failure or timeout): the layered composer
// (src/lib/stage/program/composer.ts) with forms chosen from the 免費研究 findings.

import { z } from "zod";
import { formatTimeShort } from "@/lib/timeline";
import { TYPE_RELATIONS } from "@/lib/schema";
import { PROGRAM_CONTRACT_DOC } from "@/lib/stage/program/contract";
import { composeSceneProgram, FORM_IDS, type FormId } from "@/lib/stage/program/composer";
import { EXAMPLE_PROGRAMS } from "@/lib/stage/program/examples";
import { normalizeSceneProgram } from "@/lib/stage/program/model";
import { validateProgram } from "@/lib/stage/program/validate";
import type { DesignPlan, SceneId, SceneProgram } from "@/lib/types";
import { hashString } from "./svg";
import { analyzeFindings, type Findings } from "./findings";
import { bibleBlock, energyCurveBlock, songBlock, trimBrief } from "./prompts";
import { collectedBlock, leadPalette, leadTemperature } from "./collected";
import { analyzeStructure } from "./structure";
import type { DesignerInput, DesignRequest } from "./types";

// ---------------------------------------------------------------------------
// offline: the composer, with forms from the findings
// ---------------------------------------------------------------------------

const FORMS_BY_SCENE: Record<SceneId, FormId[]> = {
  waves: ["horizon", "strata"],
  rain: ["threads", "strata"],
  nebula: ["orbits", "ribbons"],
  particles: ["orbits", "pillars"],
  bokeh: ["ribbons", "horizon"],
  grid: ["horizon", "bars"],
  tunnel: ["orbits", "bars"],
  shards: ["bars", "pillars"],
  ink: ["brush", "strata"],
  motif: ["pillars", "orbits"],
  gradient: ["strata", "ribbons"],
  blackout: ["pillars", "strata"],
};

const FORMS_BY_GENRE: Record<string, FormId[]> = {
  "post-rock": ["pillars", "strata"],
  shoegaze: ["ribbons", "threads"],
  "dream-pop": ["ribbons", "horizon"],
  "city-pop": ["horizon", "ribbons"],
  "indie-rock": ["bars", "horizon"],
  "indie-pop": ["ribbons", "horizon"],
  folk: ["strata", "brush"],
  metal: ["pillars", "bars"],
  punk: ["bars", "threads"],
  "post-punk": ["bars", "pillars"],
  electronic: ["orbits", "bars"],
  "hip-hop": ["bars", "pillars"],
  rnb: ["ribbons", "orbits"],
  jazz: ["ribbons", "horizon"],
  "math-rock": ["bars", "orbits"],
  emo: ["threads", "pillars"],
  psychedelic: ["orbits", "ribbons"],
  "alt-rock": ["pillars", "bars"],
  ambient: ["strata", "orbits"],
  pop: ["horizon", "ribbons"],
};

/** Forms that suit the song, best first: the genre's, the strongest image's own form, then the scene family's and the audio mood's. */
export function sceneForms(findings: Findings): FormId[] {
  const out: FormId[] = [];
  const add = (list: readonly FormId[] | undefined) => {
    for (const f of list ?? []) if (!out.includes(f)) out.push(f);
  };
  if (findings.genre) add(FORMS_BY_GENRE[findings.genre.id]);
  // the strongest lyric image with a form of its own (牆 → pillars / strata) speaks before the scene family
  for (const h of findings.imagery.slice(0, 2)) add(h.family.forms?.filter((f): f is FormId => (FORM_IDS as readonly string[]).includes(f)));
  for (const s of findings.hints.scenes.slice(0, 2)) add(FORMS_BY_SCENE[s]);
  const q = findings.audio.quadrant;
  add(findings.audio.arousal > 0.62 ? ["bars", "pillars"] : findings.audio.light > 0.55 ? ["horizon", "ribbons"] : q ? ["strata", "orbits"] : []);
  add(FORM_IDS);
  return out;
}

/** The offline composer's program for a request (salt: 「重新產生畫面」 without Claude draws another). */
export function offlineSceneProgram(req: DesignerInput, plan: DesignPlan, salt = 0, findings?: Findings): SceneProgram {
  const f = findings ?? analyzeFindings(req);
  const program = composeSceneProgram({
    seed: hashString(`${req.meta?.title ?? ""}|${req.meta?.artist ?? ""}`),
    forms: sceneForms(f),
    sections: plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy })),
    voice: plan.typeSystem?.voice ?? null,
    // phase 8: the band's real cover sets the temperature of the picture when it has one
    temperature: leadTemperature(req.collected) ?? f.hints.temperature,
    arousal: f.audio.arousal,
    title: req.meta?.title,
    salt,
  });
  const tagged = { ...program, recipe: `${program.recipe ?? ""}#${salt}` };
  return normalizeSceneProgram(tagged, { sections: plan.sections }) ?? tagged;
}

/**
 * A design direction's own program (phase 4 directions × phase 7): forms from the direction's scene
 * families, seeded by its letter, so the three directions' style frames show three different worlds.
 */
export function directionSceneProgram(req: DesignerInput, plan: DesignPlan, scenes: readonly SceneId[], letter: string): SceneProgram {
  const forms: FormId[] = [];
  for (const s of scenes) for (const f of FORMS_BY_SCENE[s] ?? []) if (!forms.includes(f)) forms.push(f);
  const f = analyzeFindings(req);
  for (const x of sceneForms(f)) if (!forms.includes(x)) forms.push(x);
  const program = composeSceneProgram({
    seed: hashString(`${req.meta?.title ?? ""}|${req.meta?.artist ?? ""}|${letter}`),
    forms,
    sections: plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy })),
    voice: plan.typeSystem?.voice ?? null,
    arousal: f.audio.arousal,
    title: req.meta?.title,
  });
  return normalizeSceneProgram({ ...program, recipe: `${program.recipe}#0` }, { sections: plan.sections }) ?? program;
}

/** The composer's salt of an offline program (「重新產生畫面」 without Claude draws salt + 1). */
export function composerSalt(program: SceneProgram | null | undefined): number {
  const m = /#(\d+)$/.exec(program?.recipe ?? "");
  return m ? Number(m[1]) : 0;
}

/**
 * Every designed plan carries a program: its own (Claude's or claude.ai's), the previous plan's
 * Claude / claude.ai program carried over (it adapts to new sections by kind), else the offline
 * composer's. The operator's choice to switch it off is kept.
 */
export function ensureSceneProgram(req: DesignerInput & { previous?: DesignPlan | null }, plan: DesignPlan): DesignPlan {
  const own = plan.sceneProgram;
  const prev = req.previous?.sceneProgram ?? null;
  let program: SceneProgram | null = null;
  if (own && (own.engine === "claude" || own.engine === "manual")) program = normalizeSceneProgram(own, { sections: plan.sections });
  if (!program && prev && (prev.engine === "claude" || prev.engine === "manual")) program = normalizeSceneProgram(prev, { sections: plan.sections });
  if (!program && own) program = normalizeSceneProgram(own, { sections: plan.sections });
  if (!program) program = offlineSceneProgram(req, plan, composerSalt(prev));
  if (prev && prev.enabled === false) program = { ...program, enabled: false };
  return { ...plan, sceneProgram: program };
}

// ---------------------------------------------------------------------------
// Claude: the prompt and the structured output
// ---------------------------------------------------------------------------

export const SceneProgramDraftSchema = z.object({
  title: z.string().describe("這個畫面的名字（繁體中文，2–8 字）"),
  concept: z.string().describe("畫面概念：一到兩句，這首歌在舞台上是什麼樣的一個畫面、為什麼（繁體中文）"),
  rationale: z.string().describe("設計理由：構圖、焦點、留白、質地與節制，從這首歌與這個樂團來（繁體中文，2–4 句）"),
  source: z.string().describe("GLSL 函式本體：輔助函式加上 vec3 scene(vec2 fc)，依照 uniform 合約，只用 ASCII（註解可以中文）"),
  keyMoment: z.number().nullable().describe("主視覺靜止畫面的歌曲時間（秒），挑最能代表這首歌的一刻（通常是第一次副歌裡）；null = 系統挑"),
  sections: z
    .array(
      z.object({
        sectionId: z.string().describe("段落 id（s0, s1, …，必須是方案裡的段落）"),
        mode: z.number().describe("整數 0–3：這段的世界狀態（uMode）"),
        params: z.array(z.number()).describe("四個 0–1 的數字（uParams.xyzw）"),
        zone: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe("文字區：畫面上的留白，歌詞排在這裡（0–1 的比例，x、y 是左上角，y 向下）"),
        relation: z.enum(TYPE_RELATIONS).describe("字與畫面的關係：plain 放在留白裡、knockout 字切開畫面的亮形、behind 字從前景形狀後面經過（程式要設定 gFront）、lit 畫面的光照亮字"),
        note: z.string().describe("這一段的畫面與字（繁體中文，一句）"),
      }),
    )
    .describe("每一個段落一筆，依時間順序"),
});
export type SceneProgramDraft = z.infer<typeof SceneProgramDraftSchema>;

export const SCENE_SYSTEM = `你是這個樂團的專職舞台視覺總監，也是會寫 GLSL 的動態設計師。這一次你要為一首歌寫它自己的「專屬畫面」：一支片段著色器程式，在音樂祭／演唱會的 LED 大螢幕上跑整首歌，歌詞由字體引擎排在你指定的留白裡，和畫面構成一張完整的海報。

你要設計的是一張「被設計過的畫面」，不是特效展示：
1. 構圖先於效果：一個主角形狀（焦點），明確的留白（文字區），前景／中景／背景的層次；寧可少，不要滿。好的畫面在靜止的一格裡也成立。
2. 節制：大部分時間畫面是安靜的，副歌才打開；亮部只佔畫面的一小部分（LED 牆很亮，全畫面高亮會刺眼）；避免全畫面閃爍、快速明暗交替與大面積純紅（LED 安全模式也會限制它們）。音樂反應用在位置、形狀、層次，而不是亮度的閃動。
3. 從這首歌來：主角形狀、質地、動態都要能說出為什麼——來自歌詞的意象、樂團的視覺聖經、參考圖、研究簡報、曲風與音訊的能量。不要做一個換顏色就能套到任何一首歌的背景。
4. 一個世界、隨歌曲演變：用 uMode 與 uParams 讓同一個世界沿著歌曲的弧線變化——主歌稀疏、副歌打開、橋段換一個規則（例如形狀裂開、倒過來、靜止、反轉）、尾奏收回。
5. 字與畫面一起構圖：為每一段指定文字區（畫面的留白），主角形狀放在文字區的另一側或圍著它；用 uZone 在程式裡避開或框住文字區；需要時用 typeMask／typeGlow 讓畫面回應字（字後面的光、被字切開的形狀）。關係選一種：plain、knockout、behind（程式要把前景形狀的覆蓋率寫進 gFront）、lit。
6. 直式畫面（aspect() < 0.8）也要成立：系統會把左右的文字區改成上下的帶狀區（左→上、右→下），你的主角形狀放在 uZone 的另一半。
7. 顏色只用 uniform 提供的配色（uBg、uPri、uAcc、uInk、uPal0…uPal5），不要寫死色相，這樣樂團的色盤與 LED 安全的調整才會生效。
8. 效能：這支程式每一格、每個像素都要跑，大螢幕是 1920×1080 以上。保持簡單：幾個距離場、兩三層雜訊就夠了。

用繁體中文寫 title、concept、rationale 與每段的 note；程式碼只用 ASCII（註解可以中文）。`;

function sectionsBlock(plan: DesignPlan): string {
  return plan.sections
    .map((s) => `- ${s.id} ${s.kind}（${s.label}）${formatTimeShort(s.start)}–${formatTimeShort(s.end)}｜能量 ${s.energy.toFixed(2)}｜配色 ${s.colorway.join(" ")}｜歌詞色 ${s.lyricColor}${s.rationale ? `｜${s.rationale.slice(0, 80)}` : ""}`)
    .join("\n");
}

function lyricsBySection(req: DesignRequest, plan: DesignPlan): string {
  const lines = (req.lyrics?.lines ?? []).filter((l) => l.text?.trim());
  if (!lines.length) return "（這首歌沒有歌詞：文字區仍要留，操作員可能會打上歌名或口號）";
  const out: string[] = [];
  let chars = 0;
  for (const s of plan.sections) {
    const own = lines.filter((l) => l.start != null && l.start >= s.start - 0.05 && l.start < s.end);
    if (!own.length) continue;
    const text = own.slice(0, 4).map((l) => l.text.trim()).join("／");
    out.push(`- ${s.id}：${text}${own.length > 4 ? "…" : ""}`);
    chars += text.length;
    if (chars > 1400) break;
  }
  return out.join("\n") || lines.slice(0, 8).map((l) => `- ${l.text}`).join("\n");
}

/** One complete example (source and its section states) as few-shot guidance. */
function exampleBlock(): string {
  const ex = EXAMPLE_PROGRAMS.find((e) => e.id === "monolith") ?? EXAMPLE_PROGRAMS[0];
  const states = Object.entries(ex.byKind)
    .map(([kind, s]) => `  - ${kind}：mode ${s!.mode}，params [${s!.params.join(", ")}]，zone ${JSON.stringify(s!.zone)}，${s!.relation}（${s!.note}）`)
    .join("\n");
  const others = EXAMPLE_PROGRAMS.filter((e) => e.id !== ex.id)
    .map((e) => `- 「${e.title}」（${e.brief}）：${e.concept}`)
    .join("\n");
  return [
    `以下是一個品質參考（不要照抄，這首歌要有它自己的畫面）：「${ex.title}」，為${ex.brief}寫的。`,
    `概念：${ex.concept}`,
    "```glsl",
    ex.source.trim(),
    "```",
    "各段落的狀態：",
    states,
    "",
    "其他幾個參考的概念（說明同一套合約能做出多不同的畫面）：",
    others,
  ].join("\n");
}

export function buildScenePrompt(req: DesignRequest, plan: DesignPlan, opts: { errors?: string[]; previous?: SceneProgram | null } = {}): string {
  const st = analyzeStructure(req);
  const duration = st.duration;
  const kv = plan.keyVisual;
  const parts = [
    "# 歌曲",
    songBlock(req, duration),
    "",
    "# 研究簡報",
    trimBrief(req.research),
    "",
    "# 已經定好的設計方案（畫面要屬於這個世界）",
    `- 主視覺：「${kv.title}」— ${kv.concept.slice(0, 300)}`,
    `- 情緒：${kv.moodKeywords.join("、")}`,
    `- 色票（依序是 uPal0…）：${kv.palette.map((p) => `${p.hex} ${p.name}（${p.role}）`).join("、")}`,
    `- 母題：${kv.motifs.join("、")}`,
    plan.typeSystem ? `- 字體語言：${plan.typeSystem.voice}（${plan.typeSystem.rationale?.slice(0, 100) ?? ""}）` : "",
    "",
    "# 段落（每一段寫一筆 sections）",
    sectionsBlock(plan),
    "",
    "# 各段的歌詞（節錄）",
    lyricsBySection(req, plan),
    "",
    "# 能量曲線（每 2 秒）",
    energyCurveBlock(req, st),
  ];
  const bible = bibleBlock(req.bible, req.bandName);
  if (bible) parts.push("", "# 樂團視覺聖經（硬性限制：留在這個世界裡）", bible);
  const mood = (req.moodboard ?? []).filter((m) => m.note?.trim() || m.stats?.palette?.length);
  if (mood.length) parts.push("", "# 參考圖（說明與量到的顏色）", ...mood.slice(0, 10).map((m, i) => `- 圖 ${i + 1}：${m.note?.trim() || "（沒有說明）"}${m.stats?.palette?.length ? `｜${m.stats.palette.slice(0, 4).join(" ")}` : ""}`));
  const found = collectedBlock(req.collected, req.collectedImages, { media: false });
  if (found) {
    const lead = leadPalette(req.collected);
    parts.push(
      "",
      "# 研究找到的素材（這首歌真正的封面、MV、主視覺）",
      found,
      "- 專屬畫面要看得出和這些素材是同一個世界：形狀、構圖、光線與材質從它們取（例如封面的大色塊與留白、MV 的光線方向、主視覺的幾何），顏色一律用色票 uniform（uPal0…uPal5、uBg／uPri／uAcc），程式不能讀這些圖片。",
      ...(lead ? [`- ${lead.item.provenance.kind === "cover" ? "封面" : "主視覺"}量到的配色（依份量）：${lead.palette.slice(0, 6).join("、")}；方案的色票已經依它調整，畫面的明暗比例也參考它。`] : []),
    );
  }
  if (req.arc) parts.push("", "# 整場弧線", `- 第 ${req.arc.position + 1}／${req.arc.total} 首，角色 ${req.arc.role}，目標能量 ${req.arc.energy.toFixed(2)}：${req.arc.note}`);
  parts.push("", "# uniform 合約（逐字）", PROGRAM_CONTRACT_DOC, "", "# 參考", exampleBlock());
  if (opts.previous) parts.push("", "# 目前的專屬畫面（要修改它，不是從頭再做，除非指示要求）", `「${opts.previous.title}」：${opts.previous.concept}`, "```glsl", opts.previous.source.slice(0, 9000), "```");
  const instruction = req.instruction?.trim();
  if (instruction) parts.push("", "# 這次的指示（最優先）", instruction);
  if (opts.errors?.length) parts.push("", "# 上一次的程式沒有通過檢查，請修正這些問題後整個重寫", ...opts.errors.map((e) => `- ${e}`));
  parts.push("", "請輸出 JSON：title、concept、rationale、source、keyMoment、sections（每個段落一筆）。");
  return parts.filter((p) => p !== "").join("\n");
}

/** Claude's draft → a stored program (null when the code is refused). */
export function programFromDraft(raw: unknown, plan: DesignPlan, meta: { model: string; instruction?: string; now: Date }, repairs: string[] = []): { program: SceneProgram | null; errors: string[] } {
  const draft = raw && typeof raw === "object" ? (raw as Partial<SceneProgramDraft>) : {};
  const checked = validateProgram(draft.source);
  if (!checked.ok) return { program: null, errors: checked.errors };
  const program = normalizeSceneProgram(
    {
      version: 1,
      engine: "claude",
      model: meta.model,
      title: draft.title,
      concept: [draft.concept, draft.rationale].filter((s) => typeof s === "string" && s.trim()).join(" "),
      source: draft.source,
      sections: draft.sections,
      keyMoment: draft.keyMoment,
      enabled: true,
      createdAt: meta.now.toISOString(),
      ...(meta.instruction ? { instruction: meta.instruction } : {}),
    },
    { sections: plan.sections, repairs },
  );
  return { program, errors: program ? [] : ["程式沒有通過檢查"] };
}
