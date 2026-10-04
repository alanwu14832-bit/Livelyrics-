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
import { composeSceneProgram, FORM_IDS, TEXTURE_IDS, type ComposerPair, type FormId, type MotionId, type TextureId } from "@/lib/stage/program/composer";
import { EXAMPLE_PROGRAMS } from "@/lib/stage/program/examples";
import { normalizeSceneProgram } from "@/lib/stage/program/model";
import { probePlanProgram, type ProbeResult } from "@/lib/stage/program/probe";
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


/**
 * Round 12: the form table as weights. The genre family sets the base (every form keeps a small
 * weight, so a song is never locked to one shape; the ones that look worse than the genre's own
 * stay low rather than forbidden), the imagery families add theirs (雨 → threads, 河／路 →
 * ribbons, 牆 → pillars / strata, 光 → orbits / horizon, 手寫 → brush, 城市 → bars…), the energy
 * shape bends it, and an instrumental leans to shapes that hold a frame without words.
 */
const FORM_WEIGHTS_BY_GENRE: Record<string, Partial<Record<FormId, number>>> = {
  "post-rock": { pillars: 3.2, strata: 2, horizon: 1.2, orbits: 1, threads: 0.8, ribbons: 0.5, bars: 0.4, brush: 0.3 },
  shoegaze: { ribbons: 3, threads: 2, orbits: 1.2, horizon: 1, strata: 0.8, brush: 0.5, pillars: 0.4, bars: 0.2 },
  "dream-pop": { ribbons: 3, horizon: 2, orbits: 1.5, threads: 1, strata: 0.6, brush: 0.5, pillars: 0.3, bars: 0.15 },
  "city-pop": { horizon: 3, ribbons: 2, bars: 1.5, orbits: 1.2, threads: 0.6, pillars: 0.5, strata: 0.5, brush: 0.2 },
  "indie-rock": { bars: 2.2, horizon: 1.6, pillars: 1.4, threads: 1.2, orbits: 1.2, strata: 1, ribbons: 0.8, brush: 0.6 },
  "indie-pop": { ribbons: 2.5, horizon: 2, orbits: 1.5, threads: 1, bars: 0.8, strata: 0.6, brush: 0.6, pillars: 0.3 },
  folk: { strata: 3.2, brush: 2.2, horizon: 1.5, threads: 0.9, ribbons: 0.8, orbits: 0.6, pillars: 0.5, bars: 0.25 },
  metal: { pillars: 3, bars: 2.2, threads: 1, strata: 0.8, orbits: 0.5, horizon: 0.4, brush: 0.15, ribbons: 0.15 },
  punk: { bars: 3.2, threads: 1.6, pillars: 1.4, orbits: 0.7, strata: 0.5, horizon: 0.4, brush: 0.35, ribbons: 0.2 },
  "post-punk": { bars: 2.5, pillars: 2, threads: 1.2, orbits: 1, strata: 0.6, horizon: 0.5, ribbons: 0.3, brush: 0.3 },
  electronic: { orbits: 2.5, bars: 2, threads: 1.2, ribbons: 1, horizon: 0.9, pillars: 0.8, strata: 0.4, brush: 0.2 },
  "hip-hop": { bars: 2.5, pillars: 2, orbits: 1, threads: 0.8, horizon: 0.6, ribbons: 0.5, brush: 0.5, strata: 0.4 },
  rnb: { ribbons: 2.5, orbits: 2, horizon: 1.5, threads: 0.8, brush: 0.6, pillars: 0.5, strata: 0.4, bars: 0.4 },
  jazz: { ribbons: 2.5, horizon: 1.8, brush: 1.5, orbits: 1.2, strata: 0.6, threads: 0.5, pillars: 0.5, bars: 0.4 },
  "math-rock": { bars: 2.5, orbits: 2.2, threads: 1, pillars: 0.8, ribbons: 0.6, strata: 0.4, horizon: 0.4, brush: 0.3 },
  emo: { threads: 2.5, pillars: 1.8, bars: 1.2, horizon: 1, orbits: 0.8, ribbons: 0.6, strata: 0.5, brush: 0.4 },
  psychedelic: { orbits: 3, ribbons: 2.2, brush: 1, horizon: 1, threads: 0.6, strata: 0.6, bars: 0.5, pillars: 0.4 },
  "alt-rock": { pillars: 2.4, bars: 2, horizon: 1.2, threads: 1, orbits: 0.9, strata: 0.8, ribbons: 0.5, brush: 0.4 },
  ambient: { strata: 2.5, orbits: 2, horizon: 1.5, ribbons: 1.2, threads: 0.8, brush: 0.6, pillars: 0.6, bars: 0.1 },
  pop: { horizon: 2.5, ribbons: 2, orbits: 1.4, threads: 0.9, bars: 0.8, strata: 0.7, brush: 0.5, pillars: 0.5 },
};

/** Forms an imagery family calls for (most typical first) when the lexicon entry names none. */
const FORMS_BY_IMAGERY: Record<string, FormId[]> = {
  rain: ["threads", "strata"],
  tears: ["threads", "horizon"],
  snow: ["threads", "strata"],
  storm: ["threads", "pillars"],
  fire: ["threads", "pillars"],
  sea: ["horizon", "ribbons"],
  river: ["ribbons", "strata"],
  wind: ["ribbons", "threads"],
  road: ["ribbons", "horizon"],
  harbor: ["horizon", "ribbons"],
  wings: ["ribbons", "orbits"],
  freedom: ["ribbons", "orbits"],
  dream: ["ribbons", "orbits"],
  smoke: ["ribbons", "strata"],
  breath: ["ribbons", "brush"],
  wall: ["pillars", "strata"],
  door: ["pillars", "horizon"],
  window: ["horizon", "pillars"],
  home: ["strata", "horizon"],
  light: ["orbits", "horizon"],
  moon: ["horizon", "orbits"],
  dawn: ["horizon", "strata"],
  dusk: ["horizon", "strata"],
  summer: ["horizon", "orbits"],
  heaven: ["orbits", "horizon"],
  stars: ["orbits", "threads"],
  universe: ["orbits", "horizon"],
  night: ["orbits", "horizon"],
  writing: ["brush", "strata"],
  memory: ["brush", "strata"],
  autumn: ["brush", "threads"],
  flower: ["brush", "orbits"],
  spring: ["brush", "ribbons"],
  city: ["bars", "pillars"],
  neon: ["bars", "orbits"],
  train: ["bars", "ribbons"],
  signal: ["bars", "orbits"],
  screen: ["bars", "pillars"],
  dance: ["orbits", "bars"],
  metal: ["bars", "pillars"],
  glass: ["bars", "pillars"],
  forest: ["strata", "pillars"],
  desert: ["strata", "horizon"],
  world: ["strata", "horizon"],
  blood: ["pillars", "threads"],
  war: ["pillars", "bars"],
  heart: ["orbits", "brush"],
  voice: ["orbits", "ribbons"],
  eyes: ["orbits", "horizon"],
  embrace: ["brush", "ribbons"],
  lonely: ["pillars", "horizon"],
  youth: ["bars", "threads"],
  dark: ["pillars", "strata"],
  ash: ["threads", "strata"],
  mirror: ["pillars", "horizon"],
};

/** What the strongest image adds to its first and second form (the genre family sets 2–3.2 for its own). */
export const IMAGERY_LEAD = 3.0;
export const IMAGERY_SECOND = 1.5;

export interface FormWeightOptions {
  /** the song has lyrics (false: an instrumental) */
  lyrics?: boolean;
  /** the library's most recent forms (most recent first): the latest weigh RECENT_FORM_FACTORS, a repeat RECENT_REPEAT_FACTOR more */
  recentForms?: readonly string[];
}

/** How much the forms the library's last songs wear are weighed down, by recency (a nudge, never a ban). */
export const RECENT_FORM_FACTORS = [0.55, 0.55, 0.8, 0.8] as const;
/** …and once more when a form was worn twice among the last five songs. */
export const RECENT_REPEAT_FACTOR = 0.5;

/** Weights over the forms for a song (exported for the tests and the stage lab). */
export function formWeights(findings: Findings, opts: FormWeightOptions = {}): Record<FormId, number> {
  const w = Object.fromEntries(FORM_IDS.map((f) => [f, 1])) as Record<FormId, number>;
  const genre = findings.genre ? FORM_WEIGHTS_BY_GENRE[findings.genre.id] : null;
  if (genre) for (const f of FORM_IDS) w[f] = genre[f] ?? 0.3;
  // the imagery families, by their share of the strongest
  const top = findings.imagery.slice(0, 4);
  const max = top[0]?.weight || 1;
  for (const h of top) {
    const share = Math.min(1, h.weight / max);
    const forms = (h.family.forms?.filter((f): f is FormId => (FORM_IDS as readonly string[]).includes(f)) ?? []).concat(FORMS_BY_IMAGERY[h.family.id] ?? []);
    if (forms[0]) w[forms[0]] += IMAGERY_LEAD * share;
    if (forms[1]) w[forms[1]] += IMAGERY_SECOND * share;
  }
  // the energy shape
  const a = findings.audio;
  if (a.arousal > 0.62) {
    w.bars += 0.8;
    w.pillars += 0.6;
    w.threads += 0.4;
  }
  if (a.light > 0.55) {
    w.horizon += 0.8;
    w.ribbons += 0.5;
    w.orbits += 0.4;
  }
  if (a.quadrant === "dark-slow" || a.quadrant === "gentle-float") {
    w.strata += 0.6;
    w.brush += 0.5;
    w.orbits += 0.4;
  }
  if (a.quadrant === "release") {
    w.pillars += 0.5;
    w.horizon += 0.3;
  }
  // an instrumental: shapes that hold a frame without words (bars are a backdrop for type)
  if (opts.lyrics === false) {
    w.pillars += 0.5;
    w.strata += 0.4;
    w.orbits += 0.3;
    w.bars *= 0.6;
  }
  const recent = (opts.recentForms ?? []).slice(0, 5).filter((f): f is FormId => (FORM_IDS as readonly string[]).includes(f));
  recent.forEach((f, i) => {
    if (i < RECENT_FORM_FACTORS.length) w[f] *= RECENT_FORM_FACTORS[i];
  });
  for (const f of new Set(recent)) if (recent.filter((x) => x === f).length >= 2) w[f] *= RECENT_REPEAT_FACTOR;
  for (const f of FORM_IDS) w[f] = Math.round(Math.max(0.05, w[f]) * 1000) / 1000;
  return w;
}

/** Forms that suit the song, best first (the weights' order; what the directions and the stage lab list). */
export function sceneForms(findings: Findings, opts: FormWeightOptions = {}): FormId[] {
  const w = formWeights(findings, opts);
  return [...FORM_IDS].sort((a, b) => w[b] - w[a] || FORM_IDS.indexOf(a) - FORM_IDS.indexOf(b));
}

const SURFACE_BY_GENRE: Record<string, Partial<Record<TextureId, number>>> = {
  punk: { halftone: 2.2, scan: 1.2, paper: 0.5 },
  "post-punk": { halftone: 1.6, scan: 1.6 },
  "hip-hop": { halftone: 1.8 },
  metal: { halftone: 1.4, scan: 1.2, paper: 0.4 },
  electronic: { scan: 2.4, halftone: 1.2, paper: 0.3 },
  "math-rock": { scan: 1.6, halftone: 1.2 },
  "city-pop": { scan: 1.8, halftone: 1.2 },
  folk: { paper: 2.4, film: 1.2, scan: 0.3, halftone: 0.4 },
  jazz: { paper: 1.6, film: 1.3 },
  ambient: { paper: 1.5, film: 1.3, halftone: 0.4 },
  "dream-pop": { film: 1.4, paper: 1.2, halftone: 0.5 },
  shoegaze: { film: 1.5, scan: 1.1 },
  pop: { film: 1.3 },
};
const SURFACE_BY_IMAGERY: Record<string, Partial<Record<TextureId, number>>> = {
  writing: { paper: 2 },
  memory: { paper: 1.6, film: 1.3 },
  neon: { scan: 1.8 },
  signal: { scan: 2 },
  screen: { scan: 2 },
  city: { scan: 1.3, halftone: 1.2 },
  rain: { scan: 1.3 },
  wall: { halftone: 1.5, paper: 1.2 },
  dark: { film: 1.3 },
};

/** Texture weights the song suggests (the composer multiplies the voice's surfaces by these). */
export function surfaceWeights(findings: Findings): Partial<Record<TextureId, number>> {
  const w: Partial<Record<TextureId, number>> = Object.fromEntries(TEXTURE_IDS.map((t) => [t, 1]));
  const g = findings.genre ? SURFACE_BY_GENRE[findings.genre.id] : null;
  if (g) for (const [t, k] of Object.entries(g) as Array<[TextureId, number]>) w[t] = (w[t] ?? 1) * k;
  const top = findings.imagery.slice(0, 2);
  const max = top[0]?.weight || 1;
  for (const h of top) {
    const sw = SURFACE_BY_IMAGERY[h.family.id];
    if (!sw) continue;
    const share = Math.min(1, h.weight / max);
    for (const [t, k] of Object.entries(sw) as Array<[TextureId, number]>) w[t] = (w[t] ?? 1) * (1 + (k - 1) * share);
  }
  return w;
}

const MOTION_BY_IMAGERY: Record<string, Partial<Record<MotionId, number>>> = {
  flow: { drift: 1.5, sweep: 1.2 },
  fall: { drift: 1.4, rise: 0.6 },
  rise: { rise: 1.8 },
  pulse: { breathe: 1.8 },
  spin: { orbit: 1.8 },
  rush: { sweep: 1.8 },
  burst: { sweep: 1.4, breathe: 1.2 },
  flicker: { breathe: 1.2 },
  still: { breathe: 1.3, drift: 0.8 },
  drift: { drift: 1.3 },
};

/** Motion weights the strongest image suggests (rain falls, a river flows, a planet orbits). */
export function motionBias(findings: Findings): Partial<Record<MotionId, number>> {
  const top = findings.imagery[0];
  return top ? { ...(MOTION_BY_IMAGERY[top.family.motion] ?? {}) } : {};
}

/** The form + texture pairs the band's other songs wear (most recent first), from their program recipes. */
export function bandPairs(req: DesignerInput): ComposerPair[] {
  const out: ComposerPair[] = [];
  for (const s of req.bandSongs ?? []) {
    const m = /^([a-z]+)\/([a-z]+)\//.exec(s.recipe ?? "");
    if (m && (FORM_IDS as readonly string[]).includes(m[1]) && (TEXTURE_IDS as readonly string[]).includes(m[2])) out.push({ form: m[1] as FormId, texture: m[2] as TextureId });
  }
  return out;
}

/** The song's seed: the project id when known (two songs with one title and artist still differ), else title | artist. */
export function songSeed(req: Pick<DesignerInput, "meta" | "songId">): number {
  const base = hashString(`${req.meta?.title ?? ""}|${req.meta?.artist ?? ""}`);
  return req.songId ? (base ^ hashString(req.songId)) >>> 0 : base;
}

/** The offline composer's program for a request (salt: 「重新產生畫面」 without Claude draws another). */
export function offlineSceneProgram(req: DesignerInput, plan: DesignPlan, salt = 0, findings?: Findings): SceneProgram {
  const f = findings ?? analyzeFindings(req);
  const lyrics = (req.lyrics?.lines ?? []).some((l) => typeof l?.text === "string" && l.text.trim());
  const wopts: FormWeightOptions = { lyrics, recentForms: req.recentForms };
  const program = composeSceneProgram({
    seed: songSeed(req),
    forms: sceneForms(f, wopts),
    weights: formWeights(f, wopts),
    avoid: bandPairs(req),
    surface: surfaceWeights(f),
    motionBias: motionBias(f),
    lyrics,
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
export function ensureSceneProgram(req: DesignerInput & { previous?: DesignPlan | null }, plan: DesignPlan, repairs: string[] = []): DesignPlan {
  const own = plan.sceneProgram;
  const prev = req.previous?.sceneProgram ?? null;
  let program: SceneProgram | null = null;
  // a written program (Claude's, claude.ai's, a pasted one) must also pass the luminance probe
  const written = (p: SceneProgram | null | undefined): SceneProgram | null => {
    if (!p || !(p.engine === "claude" || p.engine === "manual")) return null;
    const n = normalizeSceneProgram(p, { sections: plan.sections, repairs });
    if (!n) return null;
    const probe = probePlanProgram(n, plan);
    if (probe.ok) return n;
    repairs.push(`專屬畫面「${n.title}」太亮，改用離線作曲器：${probe.errors.slice(0, 2).join("；")}`);
    return null;
  };
  program = written(own) ?? written(prev);
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
  if (!program) return { program: null, errors: ["程式沒有通過檢查"] };
  // the luminance probe: a program that whites out the wall is sent back like any other failure
  const probe: ProbeResult = probePlanProgram(program, plan);
  if (!probe.ok) return { program: null, errors: probe.errors };
  for (const w of probe.warnings) repairs.push(w);
  return { program, errors: [] };
}
