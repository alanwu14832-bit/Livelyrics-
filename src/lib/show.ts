// Show / setlist (演出): vocabularies, tolerant coercion of stored files, validation of operator
// edits, running time and per-song readiness, and the synthetic one-section plan that lets the
// existing StageView render a non-song moment (walk-in, walk-out, interlude, standby).
// Pure (no Node or DOM APIs).

import { z } from "zod";
import { contrastRatio, ensureContrast, luminance } from "./server/designer/color";
import { generateMotifSvg, hashString } from "./server/designer/svg";
import { coerceJob, defaultBible, normalizeBibleHex } from "./band";
import { isAssetId } from "./assets";
import { normalizeOutput, patchOutput } from "./output";
import { MEDIA_BLENDS, MEDIA_FITS, MEDIA_TREATMENTS, SCENE_IDS, type SceneId } from "./schema";
import type {
  ArcRole,
  Asset,
  Band,
  BandBible,
  DesignPlan,
  LookItemKind,
  PaletteEmphasis,
  Project,
  ProjectOutput,
  ProjectSummary,
  SectionMedia,
  SetItem,
  SetItemKind,
  SetLook,
  Show,
  ShowArc,
  SongArcDirective,
  SongArcNote,
} from "./types";

export const SHOW_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const SET_ITEM_ID_RE = /^[a-z0-9]{1,24}$/;
export const MAX_SET_ITEMS = 80;
export const MAX_SHOW_NAME = 80;
export const MAX_SHOW_NOTES = 4000;
export const MAX_LOOK_TEXT = 60;
export const MAX_LOOK_SECONDS = 4 * 3600;

export const LOOK_KINDS: readonly LookItemKind[] = ["walk-in", "walk-out", "interlude", "standby"];
export const SET_ITEM_KINDS: readonly SetItemKind[] = ["song", ...LOOK_KINDS];

export const LOOK_KIND_INFO: Record<LookItemKind, { label: string; description: string; defaultTitle: string; defaultSeconds: number }> = {
  "walk-in": { label: "進場", description: "開演前觀眾進場到樂團上台：主視覺慢慢呼吸，放樂團名。", defaultTitle: "進場", defaultSeconds: 300 },
  "walk-out": { label: "散場", description: "最後一首結束後：安靜收尾、謝幕文字。", defaultTitle: "散場", defaultSeconds: 180 },
  interlude: { label: "串場", description: "歌與歌之間、MC 或換樂器：低調的過場畫面。", defaultTitle: "串場", defaultSeconds: 60 },
  standby: { label: "待機", description: "技術問題或等待時的安全畫面，隨時可切。", defaultTitle: "待機", defaultSeconds: 0 },
};

export const ARC_ROLES: readonly ArcRole[] = ["opener", "build", "peak", "breather", "finale", "encore"];
export const ARC_ROLE_INFO: Record<ArcRole, { label: string }> = {
  opener: { label: "開場" },
  build: { label: "推進" },
  peak: { label: "高峰" },
  breather: { label: "喘息" },
  finale: { label: "壓軸" },
  encore: { label: "安可" },
};
export const PALETTE_EMPHASES: readonly PaletteEmphasis[] = ["shadow", "primary", "accent", "highlight"];
export const PALETTE_EMPHASIS_INFO: Record<PaletteEmphasis, { label: string; description: string }> = {
  shadow: { label: "暗部", description: "以深色與背景色為主，留白多、亮部少" },
  primary: { label: "主色", description: "以樂團主色為主，穩定的識別" },
  accent: { label: "點綴", description: "點綴色帶頭，對比拉高" },
  highlight: { label: "高光", description: "最亮的顏色帶頭，全場最耀眼" },
};

// ---------------------------------------------------------------------------
// ids and small helpers
// ---------------------------------------------------------------------------

export function isValidShowId(id: unknown): id is string {
  return typeof id === "string" && SHOW_ID_RE.test(id);
}

/** Short random id for a set item (base 36). */
export function newSetItemId(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 10; i++) out += Math.floor(random() * 36).toString(36);
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneLine(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function multiLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function isScene(v: unknown): v is SceneId {
  return typeof v === "string" && (SCENE_IDS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// palette roles (shared with the offline designer's use of the bible)
// ---------------------------------------------------------------------------

/**
 * The bible palette (or any list of colours) sorted into stage roles: the darkest colour is the
 * background, the most readable one carries lyrics, the rest are primary / accent / highlight by
 * saturation and lightness. Missing roles are derived from the ones present.
 */
export function paletteRoles(hexes: readonly string[]): { bg: string; bg2: string; primary: string; accent: string; highlight: string; lyric: string } {
  const list = hexes.map((h) => normalizeBibleHex(h)).filter((h): h is string => !!h);
  if (!list.length) return { bg: "#07070b", bg2: "#101018", primary: "#3d5afe", accent: "#ff4f8b", highlight: "#ffd166", lyric: "#f5f5f7" };
  const byLum = [...list].sort((a, b) => luminance(a) - luminance(b));
  const bg = byLum[0];
  const bg2 = byLum.length > 4 && luminance(byLum[1]) < 0.06 ? byLum[1] : bg;
  const lyric = [...list].sort((a, b) => contrastRatio(b, bg) - contrastRatio(a, bg))[0];
  const mids = list.filter((h) => h !== bg && h !== bg2 && h !== lyric);
  const pool = mids.length ? mids : list.filter((h) => h !== bg);
  const byLight = [...(pool.length ? pool : list)].sort((a, b) => luminance(a) - luminance(b));
  const primary = byLight[Math.floor((byLight.length - 1) / 2)] ?? lyric;
  const accent = pool.find((h) => h !== primary) ?? primary;
  const highlight = byLight[byLight.length - 1] ?? lyric;
  return { bg, bg2, primary, accent, highlight, lyric: ensureContrast(lyric, bg, list) };
}

/** [background, primary, accent] for a palette emphasis (colours stay inside the palette). */
export function colorwayFor(hexes: readonly string[], emphasis: PaletteEmphasis = "primary"): [string, string, string] {
  const r = paletteRoles(hexes);
  switch (emphasis) {
    case "shadow":
      return [r.bg, r.bg2 !== r.bg ? r.bg2 : r.primary, r.primary];
    case "accent":
      return [r.bg, r.accent, r.highlight];
    case "highlight":
      return [r.bg2, r.highlight, r.accent];
    default:
      return [r.bg, r.primary, r.accent];
  }
}

// ---------------------------------------------------------------------------
// looks
// ---------------------------------------------------------------------------

const LOOK_SCENE: Record<LookItemKind, SceneId[]> = {
  "walk-in": ["motif", "bokeh", "nebula", "gradient"],
  "walk-out": ["gradient", "bokeh", "nebula", "motif"],
  interlude: ["nebula", "waves", "ink", "bokeh", "gradient"],
  standby: ["gradient", "motif", "nebula"],
};

/** A sensible first look for a new non-song item, in the band's world. */
export function defaultLook(kind: LookItemKind, bible: BandBible | null | undefined, bandName = "", assets: readonly Asset[] = []): SetLook {
  const b = bible ?? defaultBible();
  const avoid = new Set(b.sceneAvoid);
  const prefer = LOOK_SCENE[kind].find((s) => b.sceneAffinity.includes(s) && !avoid.has(s));
  const scene = prefer ?? LOOK_SCENE[kind].find((s) => !avoid.has(s)) ?? "gradient";
  const colorway = colorwayFor(b.palette.map((p) => p.hex), kind === "walk-out" || kind === "standby" ? "shadow" : "primary");
  const logo = assets.find((a) => a.kind === "logo");
  const media: SectionMedia | null =
    logo && (kind === "walk-in" || kind === "standby") ? { assetId: logo.id, treatment: "full", fit: "contain", opacity: 0.85, blend: "screen" } : null;
  const text = kind === "walk-in" ? bandName.slice(0, MAX_LOOK_TEXT) : kind === "walk-out" ? "謝謝大家" : "";
  const seconds = LOOK_KIND_INFO[kind].defaultSeconds;
  return { scene, colorway, media, ...(text ? { text } : {}), ...(seconds ? { durationHint: seconds } : {}) };
}

/** Clean a look from storage or a request: valid scene, three colours, media only from `assets` (when given). */
export function coerceLook(raw: unknown, assetIds?: ReadonlySet<string>): SetLook {
  const o = isRecord(raw) ? raw : {};
  const scene = isScene(o.scene) ? o.scene : "gradient";
  const given = Array.isArray(o.colorway) ? o.colorway.map((c) => normalizeBibleHex(c)).filter((c): c is string => !!c) : [];
  const fallback = colorwayFor([]);
  const colorway: [string, string, string] = [given[0] ?? fallback[0], given[1] ?? given[0] ?? fallback[1], given[2] ?? given[1] ?? given[0] ?? fallback[2]];
  let media: SectionMedia | null = null;
  const m = isRecord(o.media) ? o.media : null;
  if (m && isAssetId(m.assetId) && (!assetIds || assetIds.has(m.assetId))) {
    const opacity = typeof m.opacity === "number" && Number.isFinite(m.opacity) ? r2(clamp(m.opacity, 0, 1)) : 0.85;
    media = {
      assetId: m.assetId,
      treatment: (MEDIA_TREATMENTS as readonly string[]).includes(m.treatment as string) ? (m.treatment as SectionMedia["treatment"]) : "full",
      fit: (MEDIA_FITS as readonly string[]).includes(m.fit as string) ? (m.fit as SectionMedia["fit"]) : "cover",
      opacity,
      blend: (MEDIA_BLENDS as readonly string[]).includes(m.blend as string) ? (m.blend as SectionMedia["blend"]) : "normal",
    };
  }
  const look: SetLook = { scene, colorway, media };
  const text = oneLine(o.text, MAX_LOOK_TEXT);
  if (text) look.text = text;
  if (typeof o.durationHint === "number" && Number.isFinite(o.durationHint) && o.durationHint > 0) look.durationHint = Math.round(Math.min(MAX_LOOK_SECONDS, o.durationHint));
  return look;
}

const LOOK_PARAMS: Record<LookItemKind, SectionDesignParams> = {
  "walk-in": { speed: 0.25, density: 0.45, intensity: 0.6, audioReactivity: 0.2 },
  "walk-out": { speed: 0.18, density: 0.35, intensity: 0.45, audioReactivity: 0.15 },
  interlude: { speed: 0.3, density: 0.5, intensity: 0.5, audioReactivity: 0.35 },
  standby: { speed: 0.12, density: 0.3, intensity: 0.35, audioReactivity: 0 },
};
type SectionDesignParams = DesignPlan["sections"][number]["sceneParams"];

export const LOOK_DEFAULT_SECONDS = 600;

/**
 * A look as a synthetic single-section DesignPlan, so the existing StageView (and later the live
 * console) renders a walk-in / walk-out / interlude / standby screen exactly like a song section.
 * The key visual comes from the band's bible (palette, fonts, motifs); the look's text is shown by
 * the lyric layer (lookToProject adds it as the only lyric line).
 */
export function lookToPlan(look: SetLook, bible: BandBible | null | undefined, opts: { kind?: LookItemKind; title?: string; seed?: string; duration?: number } = {}): DesignPlan {
  const b = bible ?? defaultBible();
  const kind = opts.kind ?? "interlude";
  const duration = opts.duration ?? (look.durationHint && look.durationHint > 0 ? look.durationHint : LOOK_DEFAULT_SECONDS);
  const colorway = coerceLook(look).colorway;
  const paletteHexes = b.palette.length ? b.palette.map((p) => p.hex) : colorway;
  const palette = b.palette.length
    ? b.palette.map((p) => ({ hex: p.hex, role: p.role, name: p.name }))
    : colorway.map((hex, i) => ({ hex, role: ["背景", "主色", "點綴"][i] ?? "色彩", name: hex }));
  const lyricColor = ensureContrast(paletteRoles([...paletteHexes, ...colorway]).lyric, colorway[0], [...paletteHexes, ...colorway]);
  const title = opts.title?.trim() || LOOK_KIND_INFO[kind].label;
  const hasText = Boolean(look.text?.trim());
  const seed = opts.seed ?? `${title}|${kind}`;
  return {
    version: 1,
    keyVisual: {
      title: title.slice(0, 12),
      concept: b.summary.trim() ? b.summary.trim().split(/\n/)[0].slice(0, 200) : `${LOOK_KIND_INFO[kind].label}畫面。`,
      moodKeywords: b.motifs.slice(0, 3).length ? b.motifs.slice(0, 3) : [LOOK_KIND_INFO[kind].label],
      palette,
      motifs: b.motifs.length ? b.motifs.slice(0, 5) : ["樂團的光"],
      motifSvg: generateMotifSvg(seed, (["orbit", "bloom", "wave", "sun", "crystal", "shard"] as const)[hashString(seed) % 6]),
      typography: {
        cjkFont: b.fonts.cjkFont,
        latinFont: b.fonts.latinFont,
        weight: b.fonts.weight,
        letterSpacing: 0.04,
        rationale: "沿用樂團視覺聖經的字體。",
      },
    },
    sections: [
      {
        id: "s0",
        kind: "interlude",
        label: title.slice(0, 20),
        start: 0,
        end: duration,
        energy: kind === "walk-in" ? 0.35 : kind === "interlude" ? 0.3 : 0.2,
        scene: look.scene,
        sceneParams: { ...LOOK_PARAMS[kind] },
        colorway,
        lyricStyle: hasText ? "line-fade" : "hidden",
        lyricPlacement: look.media && hasText ? "lower-third" : "center",
        lyricScale: hasText ? (look.media ? 1 : 1.5) : 1,
        lyricColor,
        transitionIn: "fade",
        media: look.media ?? null,
        rationale: LOOK_KIND_INFO[kind].description,
      },
    ],
    lines: [],
    cues: [],
    designerNotes: `${LOOK_KIND_INFO[kind].label}畫面（由演出清單產生）。`,
  };
}

/**
 * A synthetic Project for StageView: the look's plan, the band's library as `bandAssets`, the
 * show's canvas, and the look's text as the only (timed) lyric line.
 */
export function lookToProject(
  item: Extract<SetItem, { kind: LookItemKind }>,
  ctx: { band: Pick<Band, "id" | "name" | "bible" | "assets"> | null; output?: ProjectOutput | Omit<ProjectOutput, "safety"> | null; showId?: string },
): Project {
  const duration = item.look.durationHint && item.look.durationHint > 0 ? item.look.durationHint : LOOK_DEFAULT_SECONDS;
  const plan = lookToPlan(item.look, ctx.band?.bible, { kind: item.kind, title: item.title, seed: `${ctx.showId ?? ""}|${item.id}`, duration });
  const text = item.look.text?.trim();
  const now = new Date(0).toISOString();
  return {
    id: `look-${item.id}`,
    createdAt: now,
    updatedAt: now,
    status: "ready",
    meta: { title: item.title, artist: ctx.band?.name ?? "", duration, fileName: "", mimeType: "" },
    audioFile: "",
    analysis: null,
    lyrics: text ? { source: "user", synced: true, lines: [{ id: "l0", text, start: 0, end: duration }] } : { source: "none", synced: false, lines: [] },
    research: null,
    plan,
    assets: [],
    output: normalizeOutput(ctx.output ?? null),
    ...(ctx.band ? { bandId: ctx.band.id, bandAssets: ctx.band.assets.map((a) => ({ ...a, scope: "band" as const })) } : {}),
  };
}

// ---------------------------------------------------------------------------
// setlist: readiness and running time
// ---------------------------------------------------------------------------

export type SongStatus = "ready" | "needs-design" | "missing-lyrics" | "processing" | "error" | "missing";

export const SONG_STATUS_INFO: Record<SongStatus, { label: string; tone: "green" | "orange" | "red" | "neutral" }> = {
  ready: { label: "可上台", tone: "green" },
  "needs-design": { label: "需要設計", tone: "orange" },
  "missing-lyrics": { label: "缺歌詞", tone: "orange" },
  processing: { label: "處理中", tone: "neutral" },
  error: { label: "處理失敗", tone: "red" },
  missing: { label: "作品已刪除", tone: "red" },
};

/** A song's readiness for the show: designed and with lyrics (or knowingly instrumental). */
export function songStatus(p: Pick<ProjectSummary, "status" | "hasPlan" | "lyricLines"> | null | undefined): SongStatus {
  if (!p) return "missing";
  if (p.status === "processing") return "processing";
  if (p.status === "error") return "error";
  if (!p.hasPlan || p.status === "new") return "needs-design";
  if (!p.lyricLines) return "missing-lyrics";
  return "ready";
}

export function itemSeconds(item: SetItem, songs: ReadonlyMap<string, Pick<ProjectSummary, "duration">>): number | null {
  if (item.kind === "song") {
    const d = songs.get(item.projectId)?.duration;
    return d && d > 0 ? d : null;
  }
  return item.look.durationHint && item.look.durationHint > 0 ? item.look.durationHint : null;
}

export interface SetlistTotals {
  /** seconds of everything with a known length */
  total: number;
  /** seconds of songs only */
  music: number;
  songs: number;
  /** items without a known length (standby, deleted songs) */
  unknown: number;
  ready: number;
}

export function setlistTotals(items: readonly SetItem[], songs: ReadonlyMap<string, Pick<ProjectSummary, "duration" | "status" | "hasPlan" | "lyricLines">>): SetlistTotals {
  const out: SetlistTotals = { total: 0, music: 0, songs: 0, unknown: 0, ready: 0 };
  for (const item of items) {
    const s = itemSeconds(item, songs);
    if (item.kind === "song") {
      out.songs++;
      if (songStatus(songs.get(item.projectId)) === "ready") out.ready++;
      if (s != null) out.music += s;
    }
    if (s == null) {
      if (!(item.kind === "standby")) out.unknown++;
    } else out.total += s;
  }
  return out;
}

/** "42 分" / "1 小時 5 分" / "3 分 20 秒" for the running time. */
export function formatRunningTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
  if (m >= 10 || !sec) return `${m} 分`;
  return m ? `${m} 分 ${sec} 秒` : `${sec} 秒`;
}

/** Move one item (drag or ↑↓ buttons). Out-of-range indexes clamp; same index returns the input. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const target = clamp(to, 0, items.length - 1);
  if (target === from) return [...items];
  const next = [...items];
  const [it] = next.splice(from, 1);
  next.splice(target, 0, it);
  return next;
}

/** The songs of a setlist in order, with their 0-based position among songs. */
export function songItems(items: readonly SetItem[]): Array<Extract<SetItem, { kind: "song" }> & { position: number }> {
  const out: Array<Extract<SetItem, { kind: "song" }> & { position: number }> = [];
  for (const it of items) if (it.kind === "song") out.push({ ...it, position: out.length });
  return out;
}

// ---------------------------------------------------------------------------
// stored file and edits
// ---------------------------------------------------------------------------

export function coerceSetItems(raw: unknown, assetIds?: ReadonlySet<string>): SetItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SetItem[] = [];
  const seen = new Set<string>();
  for (const x of raw.slice(0, MAX_SET_ITEMS)) {
    if (!isRecord(x)) continue;
    let id = typeof x.id === "string" && SET_ITEM_ID_RE.test(x.id) && !seen.has(x.id) ? x.id : "";
    if (!id) {
      id = `i${out.length}${hashString(JSON.stringify(x)).toString(36)}`.slice(0, 24);
      while (seen.has(id)) id = `${id.slice(0, 20)}${out.length}x`;
    }
    const note = oneLine(x.note, 200);
    if (x.kind === "song") {
      if (typeof x.projectId !== "string" || !SHOW_ID_RE.test(x.projectId)) continue;
      out.push({ id, kind: "song", projectId: x.projectId, ...(note ? { note } : {}) });
    } else if ((LOOK_KINDS as readonly unknown[]).includes(x.kind)) {
      const kind = x.kind as LookItemKind;
      out.push({ id, kind, title: oneLine(x.title, 40) || LOOK_KIND_INFO[kind].defaultTitle, look: coerceLook(x.look, assetIds), ...(note ? { note } : {}) });
    } else continue;
    seen.add(id);
  }
  return out;
}

function coerceArc(raw: unknown, items: readonly SetItem[]): ShowArc | null {
  if (!isRecord(raw) || !Array.isArray(raw.songs)) return null;
  const songIds = new Map(songItems(items).map((s) => [s.id, s]));
  const songs: SongArcNote[] = [];
  for (const x of raw.songs) {
    if (!isRecord(x) || typeof x.itemId !== "string") continue;
    const item = songIds.get(x.itemId);
    if (!item || songs.some((s) => s.itemId === x.itemId)) continue;
    songs.push({
      itemId: item.id,
      projectId: item.projectId,
      position: item.position,
      role: (ARC_ROLES as readonly unknown[]).includes(x.role) ? (x.role as ArcRole) : "build",
      energy: typeof x.energy === "number" && Number.isFinite(x.energy) ? r2(clamp(x.energy, 0, 1)) : 0.5,
      emphasis: (PALETTE_EMPHASES as readonly unknown[]).includes(x.emphasis) ? (x.emphasis as PaletteEmphasis) : "primary",
      note: multiLine(x.note, 400),
      ...(typeof x.appliedAt === "string" ? { appliedAt: x.appliedAt } : {}),
    });
  }
  return {
    engine: raw.engine === "claude" ? "claude" : "offline",
    ...(typeof raw.model === "string" && raw.model ? { model: oneLine(raw.model, 80) } : {}),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    overview: multiLine(raw.overview, 4000),
    songs,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function coerceShow(raw: unknown, id: string, fallbackTime: string): Show {
  if (!isRecord(raw)) throw new Error("show.json 不是有效的演出資料");
  const items = coerceSetItems(raw.items);
  const show: Show = {
    id,
    bandId: typeof raw.bandId === "string" && SHOW_ID_RE.test(raw.bandId) ? raw.bandId : "",
    name: oneLine(raw.name, MAX_SHOW_NAME) || "未命名演出",
    output: normalizeOutput(raw.output),
    items,
    notes: multiLine(raw.notes, MAX_SHOW_NOTES),
    arc: coerceArc(raw.arc, items),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : fallbackTime,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : fallbackTime,
  };
  if (typeof raw.date === "string" && DATE_RE.test(raw.date)) show.date = raw.date;
  const venue = oneLine(raw.venue, 80);
  if (venue) show.venue = venue;
  const job = coerceJob(raw.arcJob);
  if (job) show.arcJob = job;
  return show;
}

const ShowPatchSchema = z.object({
  name: z.string().max(MAX_SHOW_NAME * 4).optional(),
  date: z.string().max(20).nullable().optional(),
  venue: z.string().max(400).nullable().optional(),
  notes: z.string().max(MAX_SHOW_NOTES * 2).optional(),
  items: z.array(z.unknown()).max(MAX_SET_ITEMS).optional(),
  output: z
    .object({
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      preset: z.string().max(32).optional(),
      lyricSafe: z.object({ top: z.number().optional(), right: z.number().optional(), bottom: z.number().optional(), left: z.number().optional() }).optional(),
      safety: z
        .object({
          enabled: z.boolean().optional(),
          preset: z.enum(["indoor", "led", "outdoor", "custom"]).optional(),
          brightness: z.number().optional(),
          flashLimit: z.boolean().optional(),
          redProtect: z.boolean().optional(),
          soften: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  /** notes of the arc pass; `appliedAt` updates arrive this way too */
  arc: z.unknown().optional(),
});

export type ShowPatchResult = { ok: true; show: Show } | { ok: false; error: string };

/**
 * Apply an operator edit. `projectIds` are the band's songs (a setlist can only hold those);
 * `assetIds` the band's library (looks can only show those).
 */
export function applyShowPatch(current: Show, raw: unknown, ctx: { projectIds: ReadonlySet<string>; assetIds: ReadonlySet<string> }): ShowPatchResult {
  const parsed = ShowPatchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `演出資料格式錯誤：${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}：${i.message}`).join("；")}` };
  const p = parsed.data;
  const next: Show = { ...current };
  if (p.name !== undefined) {
    const name = oneLine(p.name, MAX_SHOW_NAME);
    if (!name) return { ok: false, error: "演出名稱不能是空的" };
    next.name = name;
  }
  if (p.date !== undefined) {
    if (p.date == null || p.date === "") delete next.date;
    else if (DATE_RE.test(p.date)) next.date = p.date;
    else return { ok: false, error: "日期格式應為 YYYY-MM-DD" };
  }
  if (p.venue !== undefined) {
    const venue = oneLine(p.venue ?? "", 80);
    if (venue) next.venue = venue;
    else delete next.venue;
  }
  if (p.notes !== undefined) next.notes = multiLine(p.notes, MAX_SHOW_NOTES);
  if (p.output !== undefined) next.output = patchOutput(current.output, p.output);
  if (p.items !== undefined) {
    const items = coerceSetItems(p.items, ctx.assetIds);
    const foreign = items.find((it) => it.kind === "song" && !ctx.projectIds.has(it.projectId));
    if (foreign) return { ok: false, error: "演出清單只能放這個樂團的作品" };
    next.items = items;
    // the arc follows the items: notes of removed songs go away, positions are refreshed
    next.arc = coerceArc(current.arc, items);
  }
  if (p.arc !== undefined) next.arc = p.arc === null ? null : coerceArc(p.arc, next.items);
  return { ok: true, show: next };
}

/** The re-design directive for one song of the show, from its arc note (null without one). */
export function arcDirectiveFor(show: Pick<Show, "name" | "items" | "arc">, itemId: string): SongArcDirective | null {
  const note = show.arc?.songs.find((s) => s.itemId === itemId);
  if (!note) return null;
  const songs = songItems(show.items);
  const item = songs.find((s) => s.id === itemId);
  if (!item) return null;
  return { showName: show.name, position: item.position, total: songs.length, role: note.role, energy: note.energy, emphasis: note.emphasis, note: note.note };
}
