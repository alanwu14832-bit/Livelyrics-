// 整場弧線: a 40-minute set has an arc, not twelve peaks. Given the ordered setlist (each song's
// own energy and tempo) and the band's bible, the designer proposes per-song energy, palette
// emphasis and a note; a song re-designed with its note (SongArcDirective) follows it.
//
// Offline heuristic: open strong but not at full size, build, give the room a breather past the
// middle, climb to the peak, and hold the biggest looks (tunnel, full intensity, the brightest
// palette) for the finale. `applyArc` shifts an existing plan the same way (intensity, the big
// scenes, colorway emphasis).

import { z } from "zod";
import { ARC_ROLE_INFO, PALETTE_EMPHASIS_INFO, colorwayFor } from "@/lib/show";
import type { ArcRole, BandBible, DesignPlan, PaletteEmphasis, SceneId, ShowArc, SongArcDirective, SongArcNote } from "@/lib/types";
import { SCENES } from "./catalog";
import { normalizePlan } from "./normalize";
import type { DesignerInput } from "./types";

export interface ArcSong {
  itemId: string;
  projectId: string;
  title: string;
  /** 0..1 mean energy of the recording (null when unknown) */
  energy: number | null;
  bpm: number | null;
  duration: number;
}

export interface ArcInput {
  showName: string;
  bandName: string;
  bible: BandBible | null;
  songs: ArcSong[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The show's energy shape at position p (0 = first song, 1 = last). */
export function arcCurve(p: number): number {
  const x = clamp(p, 0, 1);
  // rise from a confident opener, a dip around 55 to 65 %, then the climb to the finale
  const rise = 0.62 + 0.3 * x;
  const dip = 0.2 * Math.exp(-Math.pow((x - 0.6) / 0.09, 2));
  const open = x < 0.12 ? 0.08 * (1 - x / 0.12) : 0;
  return clamp(rise - dip + open, 0, 1);
}

const EMPHASIS: Record<ArcRole, PaletteEmphasis> = { opener: "primary", build: "primary", peak: "accent", breather: "shadow", finale: "highlight", encore: "highlight" };

function noteFor(role: ArcRole, song: ArcSong, energy: number, position: number, total: number): string {
  switch (role) {
    case "opener":
      return `開場第一首：先把樂團的世界亮出來，用主色與主視覺符號建立識別；強度約 ${Math.round(energy * 100)}%，最大的畫面先收著。`;
    case "breather":
      return `整場的喘息點（第 ${position + 1} 首）：以暗部為主、畫面留白，讓觀眾和樂團都換一口氣，為後段的爬升蓄力。`;
    case "peak":
      return `後段的高峰：點綴色帶頭、對比拉高、副歌加速；仍比壓軸收斂一點，把最大的畫面留到最後。`;
    case "finale":
      return `壓軸（第 ${total} 首）：整場最亮、最滿的一首，最後一次副歌可以用隧道與全強度，高光色帶頭。`;
    case "encore":
      return "安可：回到樂團最有代表性的畫面，高光色，全場一起唱。";
    default:
      return `推進（第 ${position + 1} 首）：在樂團色盤裡穩定地往上堆，${song.energy != null && song.energy > 0.6 ? "副歌可以更亮" : "主歌保持低調"}，不搶後面的高峰。`;
  }
}

/** Heuristic arc for the setlist's songs (in order). */
export function offlineArc(input: ArcInput, now = new Date()): ShowArc {
  const n = input.songs.length;
  const songs: SongArcNote[] = [];
  const own = input.songs.map((s) => (s.energy != null && Number.isFinite(s.energy) ? clamp(s.energy, 0, 1) : 0.55));
  // the breather: the calmest song between 40 % and 80 % of the set (only in sets of 5+)
  let breather = -1;
  if (n >= 5) {
    for (let i = Math.floor(n * 0.4); i <= Math.min(n - 2, Math.ceil(n * 0.8)); i++) if (breather < 0 || own[i] < own[breather]) breather = i;
  }
  // the peak: the loudest song after the breather (or after the middle), before the finale
  let peak = -1;
  if (n >= 4) {
    const from = breather >= 0 ? breather + 1 : Math.floor(n / 2);
    for (let i = from; i <= n - 2; i++) if (peak < 0 || own[i] > own[peak]) peak = i;
  }
  input.songs.forEach((s, i) => {
    const p = n > 1 ? i / (n - 1) : 1;
    let role: ArcRole = "build";
    if (n === 1) role = "finale";
    else if (i === 0) role = "opener";
    else if (i === n - 1) role = "finale";
    else if (i === breather) role = "breather";
    else if (i === peak) role = "peak";
    let energy = 0.65 * arcCurve(p) + 0.35 * own[i];
    if (role === "breather") energy = Math.min(energy, 0.45);
    if (role === "finale") energy = 1;
    if (role !== "finale") energy = Math.min(energy, 0.9);
    energy = r2(clamp(energy, 0.2, 1));
    songs.push({ itemId: s.itemId, projectId: s.projectId, position: i, role, energy, emphasis: EMPHASIS[role], note: noteFor(role, s, energy, i, n) });
  });
  const minutes = Math.round(input.songs.reduce((a, s) => a + (s.duration || 0), 0) / 60);
  const avoid = input.bible?.sceneAvoid.length ? `整場都不用${input.bible.sceneAvoid.map((x) => SCENES[x].label).join("、")}。` : "";
  const overview = n
    ? [
        `「${input.showName}」共 ${n} 首歌${minutes ? `、約 ${minutes} 分鐘` : ""}。開場先亮出${input.bandName || "樂團"}的世界，${breather >= 0 ? `第 ${breather + 1} 首讓全場喘一口氣，` : ""}${peak >= 0 ? `第 ${peak + 1} 首是後段的高峰，` : ""}最大的畫面留給最後一首。`,
        "",
        "## 配色的走向",
        `前段以主色建立識別，${breather >= 0 ? "喘息段退到暗部，" : ""}高峰由點綴色帶頭，壓軸才讓高光色佔滿畫面。所有顏色都在樂團色盤之內。${avoid}`,
        "",
        "> 由**離線設計師**依每首歌的能量與順序排出，沒有經過 Claude。可以逐首或一次依弧線重新設計。",
      ].join("\n")
    : "演出清單裡還沒有歌。";
  return { engine: "offline", createdAt: now.toISOString(), overview, songs };
}

// ---------------------------------------------------------------------------
// apply to a plan (offline re-design)
// ---------------------------------------------------------------------------

const BIG: readonly SceneId[] = ["tunnel"];
const BIG_FALLBACK: readonly SceneId[] = ["shards", "particles", "grid"];

/** Shift a plan to its place in the show; the result is normalized again. */
export function applyArc(plan: DesignPlan, arc: SongArcDirective, input: DesignerInput): DesignPlan {
  const hexes = plan.keyVisual.palette.map((c) => c.hex);
  const avoid = new Set(input.bible?.sceneAvoid ?? []);
  const factor = 0.7 + 0.6 * clamp(arc.energy, 0, 1);
  const grand = arc.role === "finale" || arc.role === "encore";
  let loudest = 0;
  plan.sections.forEach((s, i) => {
    if (s.energy > plan.sections[loudest].energy) loudest = i;
  });
  const lastChorus = plan.sections.map((s, i) => (s.kind === "chorus" ? i : -1)).filter((i) => i >= 0).pop() ?? loudest;
  const lead = colorwayFor(hexes, arc.emphasis);
  const sections = plan.sections.map((s, i) => {
    const p = s.sceneParams;
    let intensity = clamp(p.intensity * factor, 0, 1);
    let scene = s.scene;
    let transitionIn = s.transitionIn;
    let audioReactivity = clamp(p.audioReactivity * factor, 0, 1);
    if (!grand) {
      intensity = Math.min(intensity, arc.role === "breather" ? 0.6 : 0.88);
      if (BIG.includes(scene)) scene = BIG_FALLBACK.find((x) => !avoid.has(x) && x !== plan.sections[i - 1]?.scene) ?? "particles";
    } else if (i === lastChorus) {
      if (!avoid.has("tunnel")) scene = "tunnel";
      intensity = 1;
      audioReactivity = Math.max(audioReactivity, 0.9);
      transitionIn = "flash";
    }
    let colorway = s.colorway;
    if (s.kind === "chorus" || s.kind === "solo" || arc.emphasis === "shadow") colorway = [...lead];
    return {
      ...s,
      scene,
      transitionIn,
      colorway,
      sceneParams: {
        speed: r2(clamp(p.speed * (0.85 + 0.3 * arc.energy), 0, 1)),
        density: r2(clamp(p.density * factor, 0, 1)),
        intensity: r2(intensity),
        audioReactivity: r2(audioReactivity),
      },
    };
  });
  const note = `## 整場弧線\n「${arc.showName}」第 ${arc.position + 1} 首（共 ${arc.total} 首），角色：${ARC_ROLE_INFO[arc.role].label}；配色重心：${PALETTE_EMPHASIS_INFO[arc.emphasis].label}。${arc.note}`;
  const designerNotes = plan.designerNotes.includes("## 整場弧線") ? plan.designerNotes.replace(/## 整場弧線[\s\S]*?(?=\n## |\n> |$)/, `${note}\n`) : `${note}\n\n${plan.designerNotes}`;
  return normalizePlan({ ...plan, sections, designerNotes }, input, { typeSystem: "keep" });
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

export const ArcDraftSchema = z.object({
  overview: z.string().describe("整場弧線的說明，繁體中文 Markdown，150 到 350 字"),
  songs: z
    .array(
      z.object({
        itemId: z.string().describe("the song's item id, exactly as given"),
        role: z.enum(["opener", "build", "peak", "breather", "finale", "encore"]),
        energy: z.number().describe("0 to 1 target visual energy within the show"),
        emphasis: z.enum(["shadow", "primary", "accent", "highlight"]).describe("which palette role leads this song"),
        note: z.string().describe("給設計師的一到兩句說明（繁中）：這首歌在弧線中的任務"),
      }),
    )
    .describe("one entry per song, in setlist order"),
});

export const ARC_SYSTEM = `你是這個樂團的專職舞台視覺總監，正在為一整場演出（約 40 分鐘、十首上下）規劃視覺的弧線。一場好的演出不是十二個高潮：開場建立世界，前段推進，中後段給全場一個喘息，再爬到高峰，最大的畫面（隧道、全強度、最亮的顏色）留給壓軸。

依歌曲順序、每首歌本身的能量與速度，以及樂團的視覺聖經，為每首歌訂出：角色（opener／build／peak／breather／finale／encore）、目標能量（0 到 1）、配色重心（shadow 暗部／primary 主色／accent 點綴／highlight 高光，都在樂團色盤內）與一到兩句說明。所有文字用繁體中文。`;

export function buildArcPrompt(input: ArcInput, bibleText: string | null): string {
  return [
    `# 演出：${input.showName}`,
    `# 樂團：${input.bandName}`,
    "",
    "# 演出清單（依順序）",
    ...input.songs.map(
      (s, i) =>
        `- ${i + 1}. itemId=${s.itemId}｜〈${s.title}〉｜${s.duration ? `${Math.round(s.duration / 60)} 分` : "長度未知"}｜能量 ${s.energy != null ? s.energy.toFixed(2) : "未知"}｜${s.bpm ? `${Math.round(s.bpm)} BPM` : "速度未知"}`,
    ),
    "",
    "# 樂團視覺聖經",
    bibleText ?? "（尚未建立）",
    "",
    "請輸出整場弧線。",
  ].join("\n");
}

/** Validate Claude's draft against the setlist; songs it skipped get the heuristic note. */
export function normalizeArc(raw: unknown, input: ArcInput, fallback: ShowArc, model: string, now = new Date()): ShowArc {
  const parsed = ArcDraftSchema.safeParse(raw);
  const drafts = parsed.success ? parsed.data.songs : [];
  const songs = fallback.songs.map((f) => {
    const d = drafts.find((x) => x.itemId === f.itemId);
    if (!d) return f;
    return { ...f, role: d.role, energy: r2(clamp(d.energy, 0, 1)), emphasis: d.emphasis, note: d.note.trim().slice(0, 400) || f.note };
  });
  return { engine: "claude", model, createdAt: now.toISOString(), overview: parsed.success && parsed.data.overview.trim() ? parsed.data.overview.trim().slice(0, 4000) : fallback.overview, songs };
}
