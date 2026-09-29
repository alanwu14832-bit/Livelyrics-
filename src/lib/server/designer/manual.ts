// 用 claude.ai 研究 (manual Claude mode, no API cost): the one complete prompt a user pastes into
// their own claude.ai chat. It asks Claude to research the band and the song on the web first,
// write the brief with the same five headings as the API path, then answer with exactly one
// ```json block — a DesignPlan, or 2–3 design directions — following the same rules and the same
// JSON schema the Claude API path uses (DESIGN_SYSTEM / DIRECTIONS_SYSTEM, designPlanJsonSchema(),
// DirectionDraftSchema), written out as a field reference plus a JSON template shaped by this
// song. Everything the app knows goes in: song meta, the lyrics marked by section, the audio
// summary, the free research findings as a head start, the band bible, the mood board (the user
// attaches the images in claude.ai), the band's material, the output canvas and LED 安全模式.
// 字體藝術: the plan asks for the type system (the song's typographic voice) and a composition hint
// for every distinct sung line, like the API path; no template shows karaoke or subtitle.
// 精簡版 (compact) abbreviates the lyrics, the findings and the catalogue for the free tier.
// Pure and deterministic; the reply comes back through manual-reply.ts.

import { formatTimeShort } from "@/lib/timeline";
import { aspectLabel, DEFAULT_OUTPUT } from "@/lib/output";
import { activeSafety, SAFE_MAX_REACTIVITY, SAFE_PULSE_HZ, SAFE_RED_REACTIVITY, safetySummary } from "@/lib/stage/safety";
import { AUTO_LYRIC_STYLE_IDS, FONT_IDS, LYRIC_PLACEMENTS, MEDIA_TREATMENTS, SCENE_IDS, SECTION_KINDS, TYPE_RECIPE_IDS, TYPE_VOICE_IDS } from "@/lib/schema";
import { RECIPES, VOICES } from "@/lib/type/vocab";
import { findMotionWord } from "@/lib/type/motion-words";
import type { MoodImage, ProjectOutput } from "@/lib/types";
import { FONT_CATALOG, LYRIC_STYLES, SCENES, SECTION_KIND_LABELS, TRANSITIONS } from "./catalog";
import { DirectionDraftSchema, DIRECTIONS_SYSTEM } from "./directions";
import { analyzeFindings, type Findings } from "./findings";
import { freeBrief } from "./free-research";
import { designPlanJsonSchema, jsonOutputFormat } from "./output-schema";
import {
  analysisSummary,
  assetsBlock,
  BIBLE_RULE,
  bibleBlock,
  catalogBlock,
  DESIGN_SYSTEM,
  energyCurveBlock,
  repetitionBlock,
  RESEARCH_HEADINGS,
  songBlock,
  trimBrief,
  typeCatalogBlock,
  typeReminder,
} from "./prompts";
import { analyzeStructure, type SongStructure } from "./structure";
import type { DesignRequest } from "./types";

export type ManualTarget = "plan" | "directions";

export interface ManualPromptOptions {
  target: ManualTarget;
  /** 精簡版: lyrics abbreviated, shorter findings and catalogue, shorter answers asked for */
  compact?: boolean;
  /** the project's output canvas (size, lyric safe area, LED 安全模式) */
  output?: ProjectOutput | null;
}

export interface ManualPrompt {
  prompt: string;
  chars: number;
  compact: boolean;
  /** long enough that the free claude.ai tier may cut the answer: offer 精簡版 */
  long: boolean;
  /** mood board images to attach, numbered like the prompt (圖 1…) */
  images: Array<{ n: number; name: string; note?: string }>;
  /** the free research findings are included */
  findings: boolean;
}

/** Above this many characters the UI suggests 精簡版. */
export const LONG_PROMPT_CHARS = 18_000;
/** Placeholders in the JSON templates look like （…）: the reply check counts the ones left in. */
export const PLACEHOLDER_RE = /^（[^（）]{0,80}）$/;
export const MANUAL_BRIEF_HEADINGS = RESEARCH_HEADINGS;

const MAX_FULL_LYRIC_LINES = 400;
const MAX_PREVIOUS_BRIEF = 6000;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return Array.from(t).length > n ? `${Array.from(t).slice(0, n).join("")}…` : t;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function sectionLabel(kind: (typeof SECTION_KINDS)[number], n: number, total: number): string {
  const base = SECTION_KIND_LABELS[kind];
  if (total <= 1) return base;
  const nums = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  return `${base}${nums[n] ?? String(n + 1)}`;
}

function sectionLabels(st: SongStructure): string[] {
  const totals = new Map<string, number>();
  for (const s of st.sections) totals.set(s.kind, (totals.get(s.kind) ?? 0) + 1);
  const seen = new Map<string, number>();
  return st.sections.map((s) => {
    const n = seen.get(s.kind) ?? 0;
    seen.set(s.kind, n + 1);
    return sectionLabel(s.kind, n, totals.get(s.kind) ?? 1);
  });
}

// ---------------------------------------------------------------------------
// song blocks
// ---------------------------------------------------------------------------

/** 【a1 主歌一 0:08–0:24｜能量 0.45】 headers with the section's lines (id [start–end] text). */
export function sectionedLyrics(req: DesignRequest, st: SongStructure, compact: boolean): string {
  const lines = Array.isArray(req.lyrics?.lines) ? req.lyrics.lines : [];
  if (!lines.length) return "（沒有歌詞：可能是器樂曲，或歌詞尚未匯入。整首以畫面為主，每段的 lyricStyle 用 hidden，lines 與 typeSystem.lines 用空陣列。）";
  const info = new Map(st.lines.map((l) => [l.id, l]));
  const byId = new Map(lines.map((l) => [l.id, l]));
  const fmt = (t: number | null | undefined) => (typeof t === "number" && Number.isFinite(t) ? t.toFixed(2) : "?");
  const row = (id: string) => {
    const l = byId.get(id);
    if (!l) return null;
    const i = info.get(id);
    const span = i?.start != null ? `[${fmt(i.start)}–${fmt(i.end)}]` : "[未對時]";
    const tr = l.translation && !compact ? ` ／ 譯：${clip(l.translation, 80)}` : "";
    return `${l.id} ${span} ${clip(l.text, compact ? 60 : 120)}${tr}`;
  };
  const placed = new Set(st.sections.flatMap((s) => s.lineIds));
  if (!placed.size) {
    // untimed lyrics: no section can claim them — the plain list, in order
    const list = (compact ? lines.slice(0, 24) : lines.slice(0, MAX_FULL_LYRIC_LINES)).map((l) => row(l.id)).filter((x): x is string => !!x);
    const rest = lines.length - list.length;
    return ["（歌詞還沒有時間碼，無法對到段落：依順序列出，段落請依音訊推測。）", ...list, ...(rest > 0 ? [`…（其餘 ${rest} 行省略）`] : [])].join("\n");
  }
  const labels = sectionLabels(st);
  const seenText = new Map<string, number>();
  const out: string[] = [];
  let shown = 0;
  st.sections.forEach((s, i) => {
    out.push(`【a${i} ${labels[i]}（${s.kind}）${formatTimeShort(s.start)}–${formatTimeShort(s.end)}｜能量 ${s.energy.toFixed(2)}】${s.lineIds.length ? "" : "（沒有歌詞）"}`);
    if (!s.lineIds.length) return;
    const key = s.lineIds.map((id) => byId.get(id)?.text.trim() ?? "").join("\n");
    const same = seenText.get(key);
    if (compact && same != null) {
      out.push(`（歌詞同 a${same}：${s.lineIds[0]}–${s.lineIds[s.lineIds.length - 1]}）`);
      return;
    }
    if (!seenText.has(key)) seenText.set(key, i);
    const ids = compact ? s.lineIds.slice(0, 2) : s.lineIds;
    for (const id of ids) {
      if (!compact && shown >= MAX_FULL_LYRIC_LINES) break;
      const r = row(id);
      if (r) {
        out.push(r);
        shown++;
      }
    }
    if (compact && s.lineIds.length > 2) out.push(`…（另 ${s.lineIds.length - 2} 行：${s.lineIds[2]}–${s.lineIds[s.lineIds.length - 1]}）`);
  });
  const orphans = lines.filter((l) => !placed.has(l.id));
  if (orphans.length && !compact) out.push(`（沒有落在段落裡的歌詞：${orphans.slice(0, 8).map((l) => l.id).join("、")}${orphans.length > 8 ? "…" : ""}）`);
  if (!compact && lines.length > MAX_FULL_LYRIC_LINES) out.push(`…（其餘 ${lines.length - MAX_FULL_LYRIC_LINES} 行省略）`);
  return out.join("\n");
}

/** The free research findings as a head start: the whole free brief, or a few lines (精簡版). */
export function findingsBlock(req: DesignRequest, f: Findings, st: SongStructure, compact: boolean): string {
  if (!compact) {
    // the free brief without its "this is not Claude" banner and the advice meant for the user
    return freeBrief(req, f, st)
      .split("\n")
      .filter((l) => !l.startsWith(">") && !l.startsWith("- 建議補上") && !l.includes("用 claude.ai 研究"))
      .join("\n")
      .replace(/^## /gm, "### ")
      .trim();
  }
  const rows: string[] = [];
  const a = f.info?.musicbrainz?.artist;
  if (a) rows.push(`- MusicBrainz：${a.name}${a.country ? `（${a.country}）` : ""}${a.beginYear ? `，${a.beginYear} 年起` : ""}${a.genres.length ? `，曲風標籤 ${a.genres.slice(0, 4).map((g) => g.name).join("、")}` : ""}`);
  const rec = f.info?.musicbrainz?.recording;
  if (rec?.releaseGroup) rows.push(`- 收錄於《${rec.releaseGroup.title}》${rec.year ? `（${rec.year}）` : ""}`);
  if (f.info?.wikipedia?.artist) rows.push(`- 維基百科：「${clip(f.info.wikipedia.artist.extract, 60)}」 ${f.info.wikipedia.artist.url}`);
  if (f.genre) rows.push(`- 曲風的視覺語法：${f.genre.label}——${f.genre.palette.note}`);
  rows.push(`- 音訊：${f.audio.label}（${f.audio.bpm ? `約 ${f.audio.bpm} BPM，` : ""}能量${f.audio.shapeLabel}）`);
  if (f.imagery.length) rows.push(`- 歌詞意象：${f.imagery.slice(0, 4).map((h) => `${h.family.name}（${h.words.slice(0, 2).join("、")}）`).join("、")}`);
  if (f.lyrics.lineCount) rows.push(`- 情緒：${f.lyrics.emotion.label}；人稱：${f.lyrics.pov.label}`);
  if (f.hints.singalong.length) rows.push(`- 大合唱重點：${f.hints.singalong.map((p) => `「${p.text}」`).join("、")}`);
  rows.push(`- 世界觀草稿：${f.hints.world}`);
  return rows.join("\n");
}

/** The mood board for claude.ai: the user attaches the images; notes and measured colours are listed. */
export function manualMoodboardBlock(moodboard: readonly MoodImage[]): string | null {
  if (!moodboard.length) return null;
  const rows = moodboard.map((m, i) => {
    const parts = [`圖 ${i + 1}（${m.scope === "band" ? "樂團參考" : "這首歌的參考"}）「${clip(m.name, 40)}」`];
    if (m.note) parts.push(`操作員說明：「${clip(m.note, 200)}」`);
    if (m.stats?.palette.length) parts.push(`量到的主色：${m.stats.palette.slice(0, 5).join("、")}（亮度 ${m.stats.luma.toFixed(2)}、飽和度 ${m.stats.saturation.toFixed(2)}）`);
    return `- ${parts.join("｜")}`;
  });
  return [
    `共 ${moodboard.length} 張。使用者會把這些圖片附在這則訊息裡（依圖號順序）；有附上的圖請真的看圖，沒有附上的只能依說明與色票判斷。`,
    "- 從參考圖萃取配色（主色、點綴、明暗關係）、材質（顆粒、筆觸、印刷網點）、構圖（留白、裁切）與字體線索（粗細、襯線、手寫感）。",
    "- 操作員的說明最重要（「喜歡這個顏色」就取它的顏色，「這種顆粒感」就用 grain-film 或雨絲、水墨的質地）。",
    "- 在理由裡寫明哪張圖啟發了什麼，例如「圖 2 的橘紅 → 副歌主色」。參考圖不會出現在舞台上，不要當成素材（media）。",
    ...rows,
  ].join("\n");
}

/** Canvas, lyric safe area and LED 安全模式 as design constraints. */
export function outputBlock(output: ProjectOutput | null | undefined): string {
  const o = output ?? DEFAULT_OUTPUT;
  const w = o.width || 1920;
  const h = o.height || 1080;
  const ratio = w / Math.max(1, h);
  const safe = o.lyricSafe ?? DEFAULT_OUTPUT.lyricSafe;
  const pct = (x: number) => `${Math.round((x ?? 0) * 100)}%`;
  const rows = [
    `- 畫布：${w}×${h} 像素（${aspectLabel(w, h)}）。${
      ratio < 1 ? "直式畫面：歌詞用 center 或 upper-third，不要用 left／right。" : ratio > 2.4 ? "超寬畫面：重要的字放中央，左右兩端只放場景。" : ""
    }`,
    `- 歌詞安全區：上 ${pct(safe.top)}、右 ${pct(safe.right)}、下 ${pct(safe.bottom)}、左 ${pct(safe.left)} 不放歌詞；畫面最下緣會被觀眾擋住，重要的句子放 center 或 upper-third。`,
  ];
  const s = o.safety ?? DEFAULT_OUTPUT.safety;
  if (activeSafety(s).on) {
    rows.push(
      `- ${safetySummary(s)}。`,
      `- 現場會自動套用：flash 與 bloom 轉場改成淡入（fade）、音樂反應 audioReactivity 最高 ${SAFE_MAX_REACTIVITY}（背景或主色是大面積飽和紅色時 ${SAFE_RED_REACTIVITY}）、拍點脈動每秒最多 ${SAFE_PULSE_HZ} 次、巨字衝擊切換放慢。`,
      "- 所以設計時就：爆點用 cut、wipe 或提高 intensity，而不是全白閃爍；避免大面積飽和紅色的快速明暗變化；audioReactivity 大多在 0.5 以下。",
    );
  } else {
    rows.push("- LED 安全模式：關閉。仍請避免每秒超過 3 次的全畫面閃爍（光敏性癲癇）與大面積飽和紅色的快速閃爍。");
  }
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// the rules and the JSON schema, as text
// ---------------------------------------------------------------------------

/** The vocabularies in one line each (精簡版 in place of the described catalogue). */
export function compactCatalogBlock(): string {
  return [
    `# 場景 scene：${SCENE_IDS.map((id) => `${id}（${SCENES[id].label}，能量 ${SCENES[id].energy[0]}–${SCENES[id].energy[1]}）`).join("、")}`,
    `# 歌詞樣式 lyricStyle（後備樣式；每一句實際依 typeSystem 構圖）：${AUTO_LYRIC_STYLE_IDS.map((id) => `${id}（${LYRIC_STYLES[id].label}）`).join("、")}`,
    `# 歌詞位置 lyricPlacement：${LYRIC_PLACEMENTS.join("、")}`,
    `# 轉場 transitionIn：${(Object.keys(TRANSITIONS) as Array<keyof typeof TRANSITIONS>).join("、")}`,
    `# 中文字體 cjkFont：${FONT_IDS.filter((id) => FONT_CATALOG[id].cjk).map((id) => `${id}（${FONT_CATALOG[id].label}）`).join("、")}`,
    `# 拉丁字體 latinFont：${FONT_IDS.filter((id) => !FONT_CATALOG[id].cjk).map((id) => `${id}（${FONT_CATALOG[id].label}）`).join("、")}`,
    `# 段落種類 kind：${SECTION_KINDS.map((k) => `${k}（${SECTION_KIND_LABELS[k]}）`).join("、")}`,
    `# 素材處理 media.treatment：${MEDIA_TREATMENTS.join("、")}`,
  ].join("\n");
}

/** The type system's vocabularies in one line each (精簡版 in place of the described ones). */
export function compactTypeCatalogBlock(): string {
  return [
    `# 字體語言 typeSystem.voice：${TYPE_VOICE_IDS.map((id) => `${id}（${VOICES[id].label}）`).join("、")}`,
    `# 構圖 recipe：${TYPE_RECIPE_IDS.map((id) => `${id}（${RECIPES[id].label}）`).join("、")}`,
    "# motionWord：風＝飄動、雨＝落下、火＝閃爍、心跳＝隨拍脈動、海／浪＝波浪、夜＝從暗處浮起、光＝綻開",
  ].join("\n");
}

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => x !== null && typeof x === "object" && !Array.isArray(x);

function typeName(node: Json): string {
  if (Array.isArray(node.enum)) {
    const values = node.enum as unknown[];
    return values.length === 1 ? `固定為 ${JSON.stringify(values[0])}` : `其中之一：${values.map((v) => JSON.stringify(v)).join("、")}`;
  }
  switch (node.type) {
    case "string":
      return "字串";
    case "number":
      return "數字";
    case "integer":
      return "整數";
    case "boolean":
      return "true 或 false";
    case "null":
      return "null";
    case "object":
      return "物件";
    case "array":
      return "陣列";
    default:
      return "值";
  }
}

/** JSON with small objects and arrays kept on one line (shorter templates, still valid JSON). */
export function compactJson(v: unknown, indent = 0): string {
  const one = JSON.stringify(v) ?? "null";
  if (v === null || typeof v !== "object" || one.length <= 88) return one;
  const pad = "  ".repeat(indent + 1);
  const end = "  ".repeat(indent);
  if (Array.isArray(v)) return `[\n${v.map((x) => pad + compactJson(x, indent + 1)).join(",\n")}\n${end}]`;
  return `{\n${Object.entries(v as Json)
    .map(([k, x]) => `${pad}${JSON.stringify(k)}: ${compactJson(x, indent + 1)}`)
    .join(",\n")}\n${end}}`;
}

function describe(node: Json): string {
  const d = typeof node.description === "string" ? node.description.replace(/\s+/g, " ").trim() : "";
  return d ? ` — ${d}` : "";
}

function walk(node: Json, name: string, depth: number, rows: string[]): void {
  const pad = "  ".repeat(depth);
  const anyOf = Array.isArray(node.anyOf) ? (node.anyOf as unknown[]).filter(isObj) : null;
  if (anyOf) {
    const obj = anyOf.find((n) => n.type === "object");
    const nullable = anyOf.some((n) => n.type === "null");
    if (obj) {
      rows.push(`${pad}- ${name}：物件${nullable ? "或 null" : ""}${describe(node) || describe(obj)}`);
      for (const [k, v] of Object.entries(isObj(obj.properties) ? obj.properties : {})) if (isObj(v)) walk(v, k, depth + 1, rows);
      return;
    }
    rows.push(`${pad}- ${name}：${anyOf.map(typeName).join(" 或 ")}${describe(node)}`);
    return;
  }
  if (node.type === "object") {
    rows.push(`${pad}- ${name}：物件${describe(node)}`);
    for (const [k, v] of Object.entries(isObj(node.properties) ? node.properties : {})) if (isObj(v)) walk(v, k, depth + 1, rows);
    return;
  }
  if (node.type === "array" && isObj(node.items)) {
    const items = node.items;
    if (items.type === "object" || Array.isArray(items.anyOf)) {
      rows.push(`${pad}- ${name}：陣列，每一項是物件${describe(node)}`);
      for (const [k, v] of Object.entries(isObj(items.properties) ? items.properties : {})) if (isObj(v)) walk(v, k, depth + 1, rows);
      return;
    }
    rows.push(`${pad}- ${name}：陣列，每一項是${typeName(items)}${describe(node) || describe(items)}`);
    return;
  }
  rows.push(`${pad}- ${name}：${typeName(node)}${describe(node)}`);
}

/**
 * A strict JSON schema (the one the API's structured outputs use) as an indented field list: every
 * field is required, enums are listed in full, ranges come from the descriptions.
 */
export function fieldReference(schema: Json): string {
  const rows: string[] = [];
  for (const [k, v] of Object.entries(isObj(schema.properties) ? schema.properties : {})) if (isObj(v)) walk(v, k, 0, rows);
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// JSON templates shaped by the song
// ---------------------------------------------------------------------------

const TEMPLATE_PALETTE = [
  { hex: "#0b0e17", role: "背景", name: "（顏色名稱）" },
  { hex: "#35507a", role: "主色", name: "（顏色名稱）" },
  { hex: "#e0a458", role: "點綴", name: "（顏色名稱）" },
  { hex: "#f4f1ea", role: "歌詞", name: "（顏色名稱）" },
];

function templateSection(st: SongStructure, i: number, label: string): Json {
  const s = st.sections[i];
  const quiet = s.energy < 0.4;
  const sung = s.lineIds.length > 0;
  return {
    id: `s${i}`,
    kind: s.kind,
    label,
    start: r2(s.start),
    end: r2(s.end),
    energy: r2(s.energy),
    scene: quiet ? "gradient" : "particles",
    sceneParams: { speed: quiet ? 0.3 : 0.6, density: quiet ? 0.3 : 0.6, intensity: quiet ? 0.35 : 0.7, audioReactivity: quiet ? 0.25 : 0.45 },
    colorway: [TEMPLATE_PALETTE[0].hex, TEMPLATE_PALETTE[1].hex, TEMPLATE_PALETTE[2].hex],
    lyricStyle: sung ? (s.kind === "chorus" ? "word-pop" : "line-fade") : "hidden",
    lyricPlacement: s.kind === "chorus" ? "center" : "upper-third",
    lyricScale: 1,
    lyricColor: TEMPLATE_PALETTE[3].hex,
    transitionIn: i === 0 ? "fade" : quiet ? "fade" : "wipe",
    media: null,
    rationale: "（為什麼這段用這個場景與歌詞呈現，1–2 句）",
  };
}

/** The DesignPlan template: the real section timings, placeholders （…） for everything to write. */
export function planTemplate(req: DesignRequest, st: SongStructure, compact: boolean): { json: string; shown: number } {
  const labels = sectionLabels(st);
  const n = st.sections.length;
  const chorus = st.sections.findIndex((s) => s.kind === "chorus");
  const pick = compact ? [...new Set([0, chorus > 0 ? chorus : Math.min(1, n - 1)])] : [...new Set([0, Math.min(1, n - 1), chorus > 1 ? chorus : Math.min(2, n - 1)])];
  const hook = st.hookCluster != null ? st.lines.find((l) => l.cluster === st.hookCluster) : st.lines[0];
  const plan = {
    version: 1,
    keyVisual: {
      title: "（主視覺概念名稱，4–12 字）",
      concept: "（3–6 句：這首歌在舞台上是一個什麼樣的世界、為什麼，引用研究與參考圖的發現）",
      moodKeywords: ["（關鍵字）", "（關鍵字）", "（關鍵字）"],
      palette: TEMPLATE_PALETTE,
      motifs: ["（視覺母題）", "（視覺母題）"],
      motifSvg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="4"/></svg>',
      typography: { cjkFont: "noto-sans-tc", latinFont: "bebas-neue", weight: 800, letterSpacing: 0.04, rationale: "（為什麼選這組字體，1 句）" },
    },
    sections: pick.filter((i) => i >= 0 && i < n).map((i) => templateSection(st, i, labels[i])),
    lines: hook ? [{ lineId: hook.id, emphasis: ["（這一行裡逐字相同的幾個字）"], styleOverride: null, note: "" }] : [],
    cues: [{ time: r2(st.sections[Math.min(1, n - 1)]?.start ?? 0), title: "（提示標題）", detail: "（什麼時候、做什麼，例如：最後一拍後按 B 全黑）", kind: "transition" }],
    designerNotes: compact ? "（100–200 字的 Markdown：敘事弧線、現場注意事項）" : "（150–400 字的 Markdown：敘事弧線、歌詞與動畫怎麼搭配、現場注意事項）",
    typeSystem: typeTemplate(req, st, compact),
  };
  return { json: compactJson(plan), shown: plan.sections.length };
}

/** The type-system part of the plan template: the first sung lines as examples of the per-line hints. */
function typeTemplate(req: DesignRequest, st: SongStructure, compact: boolean): Json {
  const v = VOICES["mv-card"];
  const sung = st.lines.filter((l) => l.text.trim());
  const quiet = new Set(st.sections.filter((x) => x.kind !== "chorus").flatMap((x) => x.lineIds));
  const examples = sung.slice(0, compact ? 2 : 3).map((l, i) => {
    const calm = quiet.has(l.id);
    const recipe = calm ? (i % 2 ? "vertical-column" : "whisper") : "giant-word";
    const cjk = /[\p{Script=Han}]/u.test(l.text);
    return {
      lineId: l.id,
      recipe: !cjk && recipe === "vertical-column" ? "title-card" : recipe,
      emphasis: ["（這一行裡逐字相同的一兩個字）"],
      orientation: cjk && recipe === "vertical-column" ? "v" : "h",
      energy: calm ? 0.3 : 0.7,
      motionWord: findMotionWord(l.text),
      seed: (i * 137 + 41) % 1000,
    };
  });
  return {
    voice: "mv-card",
    params: { ...v.params },
    color: v.color,
    fonts: { cjk: v.fonts.cjk, latin: v.fonts.latin },
    weight: v.weight,
    ornaments: [...v.ornaments],
    seal: "",
    rationale: "（為什麼是這個字體語言，1–2 句）",
    lines: examples,
  };
}

/** The directions template: one direction; the reply has 2–3. */
export function directionsTemplate(req: DesignRequest): string {
  const images = (req.moodboard ?? []).length;
  const draft = {
    directions: [
      {
        name: "（方向名稱，4–8 字）",
        pitch: "（一句話的提案，40 字內）",
        rationale: "（2–4 句：引用研究的具體發現；有參考圖時用「圖 n」註明）",
        references: images ? [{ image: 1, cue: "（從這張圖取了什麼，20 字內）" }] : [],
        moodKeywords: ["（關鍵字）", "（關鍵字）", "（關鍵字）"],
        palette: TEMPLATE_PALETTE,
        typography: { cjkFont: "noto-serif-tc", latinFont: "playfair-display", weight: 700, letterSpacing: 0.06, rationale: "（為什麼選這組字體，1 句）" },
        motifs: ["（視覺母題）", "（視覺母題）"],
        emblem: "wave",
        scenes: [
          { kind: "intro", scenes: ["gradient"] },
          { kind: "verse", scenes: ["nebula", "rain"] },
          { kind: "chorus", scenes: ["particles", "bokeh"] },
          { kind: "bridge", scenes: ["ink"] },
          { kind: "outro", scenes: ["gradient"] },
        ],
        sceneTendency: "（場景傾向，1–2 句）",
        lyrics: [
          { kind: "verse", style: "line-fade", placement: "upper-third" },
          { kind: "chorus", style: "impact", placement: "center" },
        ],
        typeVoice: "mv-card",
        lyricTreatment: "（這個字體語言怎麼把每一句排成構圖，1–2 句）",
        treatments: ["grain-film"],
        energy: 0.5,
        motion: "soft",
      },
    ],
  };
  return compactJson(draft);
}

// ---------------------------------------------------------------------------
// the prompt
// ---------------------------------------------------------------------------

function researchSteps(compact: boolean): string[] {
  return [
    "1. **先上網研究**（有網頁搜尋就用）：這個樂團與這首歌的專輯／單曲封面、MV 的色調與剪輯節奏、logo 與字體、過往演唱會與音樂祭的舞台設計和 VJ 影像、現場的大合唱與樂迷習慣。只採用與這個樂團、這首歌有關的資料（排除同名的其他樂團或歌）；查不到就寫「公開資料有限」，改依歌詞、音訊與下方「免費研究的發現」推論，並標示為推論。",
    `2. **寫研究簡報**：繁體中文 Markdown，約 ${compact ? "300–600" : "600–1200"} 字，依序使用這五個二級標題：${RESEARCH_HEADINGS.map((h) => `## ${h}`).join("、")}。查證過的事實在句中附上 Markdown 來源連結；推論寫明「推測」。不要重製歌詞，提到歌詞只用幾個字。`,
  ];
}

function answerFormat(target: ManualTarget): string {
  return `3. **最後輸出${target === "plan" ? "設計方案" : "設計方向"}**：在簡報之後輸出**恰好一個** \`\`\`json 程式碼區塊，內容是符合下方「JSON 規格」的完整 JSON${target === "plan" ? "（DesignPlan）" : "（2 到 3 個設計方向）"}。JSON 必須合法：雙引號、沒有註解、沒有結尾逗號，${target === "plan" ? "不要省略任何段落" : "每個方向的欄位都要寫完"}。不要用 artifact 或檔案，直接寫在回覆裡；JSON 之後不要再寫任何文字。`;
}

function checks(target: ManualTarget, st: SongStructure, lyrics: boolean): string[] {
  if (target === "directions") {
    return [
      "- 只有一個 ```json 區塊，裡面是合法、完整的 JSON，最外層是 { \"directions\": [...] }。",
      "- 2 到 3 個方向，名字與配色彼此明顯不同；每個方向的 palette 4–6 色、第一色是最深的背景色。",
      "- scenes、lyrics 的 kind 與各個 id 都用上面清單裡的值；cjkFont 是中文字體、latinFont 是拉丁字體。",
      "- 每個方向的 typeVoice（字體語言）都不同；lyrics 的 style 不用 karaoke 或 subtitle。",
      "- 所有給人看的文字都是繁體中文，把範本中（…）的內容全部換成你的設計。",
    ];
  }
  return [
    "- 只有一個 ```json 區塊，裡面是合法、完整的 JSON（DesignPlan），version 是 1。",
    `- sections 涵蓋所有段落：從 0 開始、到 ${st.duration.toFixed(2)} 秒結束，前一段的 end 等於下一段的 start；id 依序 s0、s1…`,
    "- 每段 colorway 恰好 3 色、都取自 palette；lyricColor 與 colorway[0] 的對比至少 4.5:1。",
    "- scene、lyricStyle、lyricPlacement、transitionIn、kind 與字體都用上面清單裡的 id；cjkFont 是中文字體、latinFont 是拉丁字體。",
    ...(lyrics
      ? [
          "- lines 的 lineId 是上面歌詞的 id（l0、l1…），emphasis 是該行歌詞中逐字相同的片段。",
          "- typeSystem.lines 為每一句不同的歌詞各寫一筆構圖（完全相同的重複句可以省略）；recipe、orientation、voice 用上面清單裡的 id，emphasis 與 motionWord 是該行歌詞中逐字相同的字。",
          "- 每一句都是一張排好的構圖：不要用 karaoke 或 subtitle。",
        ]
      : ["- 沒有歌詞：每段 lyricStyle 用 hidden，lines 與 typeSystem.lines 用 []。"]),
    "- motifSvg 只用 svg、g、path、circle、rect、polygon、polyline、line、ellipse，fill／stroke 用 currentColor，沒有文字與漸層。",
    "- 所有給人看的文字都是繁體中文，把範本中（…）的內容全部換成你的設計。",
  ];
}

/**
 * The design rules without principle 6 (how to use the band's material) and the material
 * vocabularies, for a song without material. Leaves the text unchanged when the markers moved.
 */
export function withoutMediaRules(system: string): string {
  let out = system;
  const from = out.indexOf("6. 樂團自己的素材是最強的識別。");
  const to = out.indexOf("7. 樂團視覺聖經");
  if (from >= 0 && to > from) out = `${out.slice(0, from)}6. 這首歌沒有提供樂團素材：每段的 media 一律是 null。\n${out.slice(to)}`;
  for (const heading of ["# 樂團素材 media.treatment", "# 素材混合 media.blend"]) {
    const start = out.indexOf(heading);
    if (start < 0) continue;
    const next = out.indexOf("\n\n#", start + heading.length);
    if (next > start) out = out.slice(0, start) + out.slice(next + 2);
  }
  return out;
}

/** The complete claude.ai prompt for a song (plan or directions). */
export function buildManualPrompt(req: DesignRequest, opts: ManualPromptOptions): ManualPrompt {
  const compact = Boolean(opts.compact);
  const st = analyzeStructure(req);
  const findings = analyzeFindings(req, st);
  const artist = req.meta?.artist?.trim();
  const title = req.meta?.title?.trim() || "這首歌";
  const moodboard = req.moodboard ?? [];
  const lyrics = (req.lyrics?.lines ?? []).length > 0;
  const target = opts.target;

  const parts: string[] = [
    `# 用 claude.ai ${target === "plan" ? "設計" : "提出設計方向"}：〈${title}〉${artist ? `（${artist}）` : ""}`,
    "",
    `這是 Livelyrics（樂團演出的舞台視覺工具）產生的提示詞。你是${artist ? `「${artist}」` : "這個樂團"}的專職舞台視覺總監，負責音樂祭與演唱會 LED 大螢幕的主視覺、背景動畫與歌詞呈現。${
      target === "plan"
        ? "這次要為這首歌做出完整的視覺方案：Livelyrics 會把你的 JSON 直接載入即時渲染器與控制台。"
        : `這次要先向樂團提出 2 到 3 個彼此明顯不同的「設計方向」，讓樂團選一個再進入製作；Livelyrics 會把每個方向展開成完整的方案。`
    }`,
    "",
    "## 請依序完成",
    ...researchSteps(compact),
    answerFormat(target),
    ...(moodboard.length ? [`4. 使用者會在這則訊息附上 ${moodboard.length} 張參考圖（圖 1 到圖 ${moodboard.length}，順序同下方「參考圖」）：請真的看圖，並在理由中用「圖 n」註明。`] : []),
    ...(compact ? ["（這是精簡版：歌詞只列每段的開頭，請把研究簡報、rationale 與 designerNotes 寫短一點，避免回覆太長被截斷。）"] : []),
  ];

  const instruction = req.instruction?.trim();
  if (instruction) parts.push("", "## 操作員的指示", `「${clip(instruction, 600)}」——請在${target === "plan" ? "設計" : "每個方向"}中落實這個要求。`);

  parts.push("", "# 歌曲", songBlock(req, st.duration), `- duration：${st.duration.toFixed(3)} 秒${target === "plan" ? "（最後一段的 end 必須剛好是這個值）" : ""}`);
  parts.push("", "# 音訊分析（瀏覽器自動分析，可能有誤差）", analysisSummary(req, st));
  if (!compact) parts.push("", "## 能量曲線（每 2 秒一個值，0–1）", energyCurveBlock(req, st), "", "## 歌詞重複（副歌線索）", repetitionBlock(st));
  parts.push("", `# 歌詞（依段落；${compact ? "精簡版只列每段的開頭" : "id [開始–結束 秒] 文字"}）`, sectionedLyrics(req, st, compact));
  if (target === "plan") parts.push("", "## 字體藝術（typeSystem.lines）", typeReminder(req));
  parts.push("", "# 免費研究的發現（Livelyrics 已先查好的起點：請上網查證、補充或推翻）", findingsBlock(req, findings, st, compact));
  const research = req.research;
  if (!compact && research?.brief?.trim() && (research.engine === "claude" || research.engine === "manual-claude")) {
    parts.push("", "# 先前的研究簡報（參考）", trimBrief(research).slice(0, MAX_PREVIOUS_BRIEF));
  }
  const bible = bibleBlock(req.bible, req.bandName);
  if (bible) parts.push("", "# 樂團視覺聖經（硬性規範）", BIBLE_RULE, bible);
  const mood = manualMoodboardBlock(moodboard);
  if (mood) parts.push("", "# 參考圖（mood board）", mood);
  if (target === "plan") parts.push("", "# 樂團素材（id｜種類｜名稱｜尺寸｜…）", assetsBlock(req.assets));
  else if ((req.assets ?? []).length) parts.push("", `# 樂團素材\n- 有 ${(req.assets ?? []).length} 個素材（專輯封面、照片、MV、logo）；方向可以用 treatments 說明怎麼處理它們。`);
  if (target === "plan" && req.previous && !instruction) {
    parts.push("", "# 目前的方案（參考）", `- 主視覺「${clip(req.previous.keyVisual.title, 30)}」，${req.previous.sections.length} 段。可以沿用仍然成立的想法，但請重新設計。`);
  } else if (target === "directions" && req.previous) {
    parts.push("", `# 目前的方案\n- 主視覺「${clip(req.previous.keyVisual.title, 30)}」，${req.previous.sections.length} 段。新的方向可以有一個延續它，其他要拉開距離。`);
  }
  parts.push("", "# 輸出畫面與 LED 安全", outputBlock(opts.output));

  // the same rules as the API path; 精簡版 lists the vocabularies without their descriptions, and
  // without the band's material the rules about using it are left out
  let system = target === "plan" ? DESIGN_SYSTEM : DIRECTIONS_SYSTEM;
  if (compact) system = system.replace(catalogBlock(), () => compactCatalogBlock()).replace(typeCatalogBlock(), () => compactTypeCatalogBlock());
  if (!(req.assets ?? []).length) system = withoutMediaRules(system);
  parts.push("", "# 設計規範（和 Livelyrics 呼叫 Claude API 時的規範相同）", system);

  if (target === "plan") {
    const template = planTemplate(req, st, compact);
    parts.push(
      "",
      "# JSON 規格（每個欄位都必填；可為 null 的會註明）",
      fieldReference(designPlanJsonSchema()),
      "",
      "# JSON 範本（格式示範：（…）是要換掉的文字，顏色、場景與數值也請依你的設計替換）",
      "```json",
      template.json,
      "```",
      `範本只列出 ${template.shown} 個段落；你的 sections 要包含全部段落（以「音訊分析」的段落推測 a0–a${st.sections.length - 1} 為基礎，可以微調邊界、合併或拆分），一路到 ${st.duration.toFixed(2)} 秒。`,
    );
  } else {
    parts.push(
      "",
      "# JSON 規格（每個欄位都必填）",
      fieldReference(jsonOutputFormat(DirectionDraftSchema).schema as Json),
      "",
      "# JSON 範本（格式示範：（…）是要換掉的文字）",
      "```json",
      directionsTemplate(req),
      "```",
      "範本只列出一個方向；請輸出 3 個（至少 2 個）彼此明顯不同的方向，例如冷調膠片、飽和拼貼、黑白極簡這樣拉開距離。",
    );
  }
  parts.push("", "# 送出前檢查", ...checks(target, st, lyrics), "", `請開始：先上網研究，再寫研究簡報，最後輸出一個 \`\`\`json 區塊。`);

  const prompt = parts.join("\n");
  return {
    prompt,
    chars: prompt.length,
    compact,
    long: !compact && prompt.length > LONG_PROMPT_CHARS,
    images: moodboard.map((m, i) => ({ n: i + 1, name: m.name, ...(m.note ? { note: clip(m.note, 120) } : {}) })),
    findings: true,
  };
}
