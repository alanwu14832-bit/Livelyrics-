// Band (樂團) and its visual bible (視覺聖經): vocabularies, defaults, tolerant coercion of stored
// files and validation of operator edits. Pure (no Node or DOM APIs): shared by the API routes,
// the designer and the bible editor.

import { z } from "zod";
import { coerceAssets } from "./assets";
import { FONTS } from "./font-meta";
import { coerceMoodboard } from "./moodboard";
import { FONT_IDS, MEDIA_TREATMENTS, SCENE_IDS, type FontId, type MediaTreatment, type SceneId } from "./schema";
import type { Band, BandBible, BandPaletteColor, JobState, LyricPolicyMode } from "./types";

/** Band ids: the same shape as project ids (12 lowercase hex chars when generated). */
export const BAND_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const MAX_BAND_NAME = 80;
export const MAX_BIBLE_SUMMARY = 6000;
export const MAX_PALETTE = 8;
export const MIN_PALETTE = 4;
export const MAX_LIST_ITEMS = 12;
export const MAX_LIST_ITEM = 120;
export const MAX_POLICY_NOTE = 400;
export const MAX_BAND_ASSETS = 400;

export const LYRIC_POLICY_MODES: readonly LyricPolicyMode[] = ["chorus-only", "full", "minimal"];

// 字體藝術: every sung line is set as a composition; the policy decides how loud the lyrics are
export const LYRIC_POLICY_INFO: Record<LyricPolicyMode, { label: string; description: string }> = {
  "chorus-only": { label: "副歌才放大", description: "每一句都排版，但主歌是安靜的小字，讓畫面與主唱說話；大合唱的副歌才讓歌詞成為畫面主角。" },
  full: { label: "每句都是主角", description: "每一段的歌詞都完整排版，主歌也有自己的構圖，副歌放大。適合敘事型、歌詞是重點的樂團。" },
  minimal: { label: "只放大 hook", description: "畫面主導：其他句子都是低語般的小字，只有最關鍵的一兩句 hook 放大。" },
};

const HEX_RE = /^#[0-9a-f]{6}$/;

export function isValidBandId(id: unknown): id is string {
  return typeof id === "string" && BAND_ID_RE.test(id);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneLine(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function multiLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, max);
}

/** "#ABC" / "abc123" -> "#aabbcc"; null when not a colour. */
export function normalizeBibleHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let t = v.trim().toLowerCase();
  if (!t.startsWith("#")) t = `#${t}`;
  if (/^#[0-9a-f]{3}$/.test(t)) t = `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  return HEX_RE.test(t) ? t : null;
}

function uniqueOf<T extends string>(v: unknown, allowed: readonly T[], max = allowed.length): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) if (typeof x === "string" && (allowed as readonly string[]).includes(x) && !out.includes(x as T)) out.push(x as T);
  return out.slice(0, max);
}

/** Short phrases (motifs, dos, donts): trimmed, de-duplicated, at most MAX_LIST_ITEMS. */
export function sanitizeList(v: unknown, max = MAX_LIST_ITEMS): string[] {
  const raw: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n/) : [];
  const out: string[] = [];
  for (const item of raw) {
    const t = oneLine(item, MAX_LIST_ITEM).replace(/^[-*・•]\s*/, "");
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function sanitizePalette(v: unknown): BandPaletteColor[] {
  if (!Array.isArray(v)) return [];
  const out: BandPaletteColor[] = [];
  for (const item of v) {
    const o = isRecord(item) ? item : typeof item === "string" ? { hex: item } : null;
    const hex = normalizeBibleHex(o?.hex);
    if (!o || !hex || out.some((c) => c.hex === hex)) continue;
    out.push({ hex, role: oneLine(o.role, 20) || "色彩", name: oneLine(o.name, 24) || hex });
    if (out.length >= MAX_PALETTE) break;
  }
  return out;
}

function isCjkFont(id: FontId) {
  return FONTS[id]?.cjk === true;
}

export function sanitizeFonts(v: unknown, fallback: BandBible["fonts"] = DEFAULT_FONTS): BandBible["fonts"] {
  const o = isRecord(v) ? v : {};
  const cjk = typeof o.cjkFont === "string" && (FONT_IDS as readonly string[]).includes(o.cjkFont) && isCjkFont(o.cjkFont as FontId) ? (o.cjkFont as FontId) : fallback.cjkFont;
  const latin = typeof o.latinFont === "string" && (FONT_IDS as readonly string[]).includes(o.latinFont) && !isCjkFont(o.latinFont as FontId) ? (o.latinFont as FontId) : fallback.latinFont;
  const w = typeof o.weight === "number" && Number.isFinite(o.weight) ? Math.round(Math.min(900, Math.max(500, o.weight)) / 100) * 100 : fallback.weight;
  return { cjkFont: cjk, latinFont: latin, weight: w };
}

export const DEFAULT_FONTS: BandBible["fonts"] = { cjkFont: "noto-sans-tc", latinFont: "space-grotesk", weight: 700 };

/** An empty bible: nothing decided yet (the designer works as before). */
export function defaultBible(): BandBible {
  return {
    summary: "",
    palette: [],
    fonts: { ...DEFAULT_FONTS },
    motifs: [],
    treatments: [],
    sceneAffinity: [],
    sceneAvoid: [],
    lyricPolicy: { mode: "chorus-only", note: "" },
    dos: [],
    donts: [],
    source: null,
  };
}

/** true when the operator or the designer has written anything that constrains the designer. */
export function bibleHasContent(b: BandBible | null | undefined): boolean {
  if (!b) return false;
  return Boolean(b.summary.trim() || b.palette.length || b.motifs.length || b.sceneAffinity.length || b.sceneAvoid.length || b.dos.length || b.donts.length || b.treatments.length || b.source);
}

/** Tolerant: anything malformed becomes the default, unknown vocabulary is dropped. */
export function coerceBible(raw: unknown): BandBible {
  const d = defaultBible();
  if (!isRecord(raw)) return d;
  const policy = isRecord(raw.lyricPolicy) ? raw.lyricPolicy : {};
  const mode = LYRIC_POLICY_MODES.includes(policy.mode as LyricPolicyMode) ? (policy.mode as LyricPolicyMode) : d.lyricPolicy.mode;
  const affinity = uniqueOf<SceneId>(raw.sceneAffinity, SCENE_IDS);
  const avoid = uniqueOf<SceneId>(raw.sceneAvoid, SCENE_IDS).filter((s) => !affinity.includes(s));
  const src = isRecord(raw.source) ? raw.source : null;
  const engine = src && (src.engine === "claude" || src.engine === "offline" || src.engine === "manual") ? src.engine : null;
  return {
    summary: multiLine(raw.summary, MAX_BIBLE_SUMMARY),
    palette: sanitizePalette(raw.palette),
    fonts: sanitizeFonts(raw.fonts),
    motifs: sanitizeList(raw.motifs, 8),
    treatments: uniqueOf<MediaTreatment>(raw.treatments, MEDIA_TREATMENTS),
    sceneAffinity: affinity,
    sceneAvoid: avoid,
    lyricPolicy: { mode, note: multiLine(policy.note, MAX_POLICY_NOTE) },
    dos: sanitizeList(raw.dos),
    donts: sanitizeList(raw.donts),
    source: engine
      ? {
          engine,
          ...(typeof src!.model === "string" && src!.model ? { model: oneLine(src!.model, 80) } : {}),
          updatedAt: typeof src!.updatedAt === "string" ? src!.updatedAt : new Date(0).toISOString(),
        }
      : null,
  };
}

export function sanitizeBandName(v: unknown, fallback = "未命名樂團"): string {
  return oneLine(v, MAX_BAND_NAME) || fallback;
}

/** band.json -> Band (the folder name is the id). Throws only when the file is not an object. */
export function coerceBand(raw: unknown, id: string, fallbackTime: string): Band {
  if (!isRecord(raw)) throw new Error("band.json 不是有效的樂團資料");
  const band: Band = {
    id,
    name: sanitizeBandName(raw.name),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : fallbackTime,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : fallbackTime,
    bible: coerceBible(raw.bible),
    assets: coerceAssets(raw.assets).map((a) => ({ ...a, scope: "band" as const })),
  };
  const job = coerceJob(raw.bibleJob);
  if (job) band.bibleJob = job;
  const moodboard = coerceMoodboard(raw.moodboard, "band");
  if (moodboard.length) band.moodboard = moodboard;
  return band;
}

/** A recorded long job (cloud mode: bible / show arc generation), or undefined. */
export function coerceJob(v: unknown): JobState | undefined {
  if (!isRecord(v) || (v.status !== "running" && v.status !== "error") || typeof v.startedAt !== "string") return undefined;
  const job: JobState = { status: v.status, startedAt: v.startedAt };
  if (typeof v.message === "string" && v.message) job.message = v.message.slice(0, 1000);
  return job;
}

// ---------------------------------------------------------------------------
// operator edits (PATCH /api/bands/[id] { name?, bible? })
// ---------------------------------------------------------------------------

const BiblePatchSchema = z.object({
  summary: z.string().max(MAX_BIBLE_SUMMARY * 2).optional(),
  palette: z.array(z.object({ hex: z.string().max(16), role: z.string().max(80).optional(), name: z.string().max(80).optional() })).max(MAX_PALETTE * 2).optional(),
  fonts: z.object({ cjkFont: z.string().optional(), latinFont: z.string().optional(), weight: z.number().optional() }).optional(),
  motifs: z.array(z.string().max(400)).max(40).optional(),
  treatments: z.array(z.string()).max(20).optional(),
  sceneAffinity: z.array(z.string()).max(20).optional(),
  sceneAvoid: z.array(z.string()).max(20).optional(),
  lyricPolicy: z.object({ mode: z.string().optional(), note: z.string().max(MAX_POLICY_NOTE * 2).optional() }).optional(),
  dos: z.array(z.string().max(400)).max(40).optional(),
  donts: z.array(z.string().max(400)).max(40).optional(),
});

export type BiblePatch = z.input<typeof BiblePatchSchema>;

export type BiblePatchResult = { ok: true; bible: BandBible } | { ok: false; error: string };

/** Apply a partial bible edit on top of the current one; marks the source as manual. */
export function applyBiblePatch(current: BandBible, raw: unknown, now = new Date()): BiblePatchResult {
  const parsed = BiblePatchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `視覺聖經格式錯誤：${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}：${i.message}`).join("；")}` };
  const p = parsed.data;
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(p)) if (v !== undefined) merged[k] = v;
  if (p.fonts) merged.fonts = sanitizeFonts({ ...current.fonts, ...p.fonts }, current.fonts);
  if (p.lyricPolicy) merged.lyricPolicy = { ...current.lyricPolicy, ...p.lyricPolicy };
  if (p.palette && p.palette.length > 0 && sanitizePalette(p.palette).length === 0) return { ok: false, error: "色盤裡沒有有效的色碼（#rrggbb）" };
  // a scene is either preferred or avoided: the list the patch names wins
  if (p.sceneAvoid && !p.sceneAffinity) merged.sceneAffinity = current.sceneAffinity.filter((s) => !p.sceneAvoid!.includes(s));
  if (p.sceneAffinity && !p.sceneAvoid) merged.sceneAvoid = current.sceneAvoid.filter((s) => !p.sceneAffinity!.includes(s));
  const next = coerceBible(merged);
  next.source = { engine: "manual", updatedAt: now.toISOString() };
  return { ok: true, bible: next };
}

/** Warnings for the editor (not errors: the bible can be saved half done). */
export function bibleWarnings(b: BandBible): string[] {
  const out: string[] = [];
  if (b.palette.length > 0 && b.palette.length < MIN_PALETTE) out.push(`色盤建議 ${MIN_PALETTE} 到 ${MAX_PALETTE} 色，目前只有 ${b.palette.length} 色。`);
  return out;
}
