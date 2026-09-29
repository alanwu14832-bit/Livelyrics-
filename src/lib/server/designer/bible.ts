// 從作品產生視覺聖經: derive a band's visual bible from the songs it already has (their key
// visuals, section plans and research briefs) plus its shared material. Claude writes it when a
// credential is configured; the offline heuristic reads what the plans have in common: the
// palette colours that recur (by hue family), the fonts most songs use, the scenes that fill the
// most stage time, the treatments given to band material, and how much of each song shows lyrics.

import { z } from "zod";
import { coerceBible, defaultBible, sanitizePalette } from "@/lib/band";
import { FONT_IDS, MEDIA_TREATMENTS, SCENE_IDS } from "@/lib/schema";
import type { Asset, BandBible, DesignPlan, FontId, LyricPolicyMode, MediaTreatment, Research, SceneId } from "@/lib/types";
import { FONT_CATALOG, MEDIA_TREATMENT_INFO, SCENES } from "./catalog";
import { colorName, contrastRatio, hexToHsl, luminance, normalizeHex } from "./color";
import { assetsBlock } from "./prompts";

export interface BibleSong {
  title: string;
  plan: DesignPlan | null;
  research: Research | null;
  /** 0..1 mean energy of the song (analysis), when known */
  energy?: number | null;
}

export interface BibleInput {
  bandName: string;
  songs: BibleSong[];
  assets: Asset[];
  /** the current bible (kept where the songs say nothing) */
  current?: BandBible | null;
}

// ---------------------------------------------------------------------------
// offline heuristic
// ---------------------------------------------------------------------------

function tally<T>(items: Iterable<T>, weight: (t: T) => number = () => 1): Map<T, number> {
  const m = new Map<T, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + weight(it));
  return m;
}

function top<T>(m: Map<T, number>, n: number): T[] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/** Recurring colours: the darkest background, one representative per frequent hue family, and the most readable light. */
export function derivePalette(plans: readonly DesignPlan[]): BandBible["palette"] {
  const colors: Array<{ hex: string; role: string; name: string }> = [];
  for (const p of plans) for (const c of p.keyVisual?.palette ?? []) {
    const hex = normalizeHex(c.hex);
    if (hex) colors.push({ hex, role: c.role || "", name: c.name || "" });
  }
  if (!colors.length) return [];
  const byLum = [...colors].sort((a, b) => luminance(a.hex) - luminance(b.hex));
  const bg = byLum[0];
  const light = [...colors].sort((a, b) => contrastRatio(b.hex, bg.hex) - contrastRatio(a.hex, bg.hex))[0];
  // hue families (30°) of the chromatic mid tones, weighted by how many songs use them
  const mids = colors.filter((c) => {
    const { s, l } = hexToHsl(c.hex);
    return s >= 0.18 && l >= 0.18 && l <= 0.82 && c.hex !== bg.hex && c.hex !== light.hex;
  });
  const family = (hex: string) => Math.floor(((hexToHsl(hex).h % 360) + 360) % 360 / 30);
  const families = tally(mids.map((c) => family(c.hex)));
  const picks: Array<{ hex: string; role: string; name: string }> = [];
  // two neighbouring families can land on nearly the same colour: keep only distinct ones
  const tooClose = (a: string, b: string) => {
    const x = hexToHsl(a);
    const y = hexToHsl(b);
    const dh = Math.abs(((x.h - y.h + 540) % 360) - 180);
    return dh < 24 && Math.abs(x.l - y.l) < 0.14;
  };
  for (const f of top(families, 6)) {
    const inFam = mids.filter((c) => family(c.hex) === f).sort((a, b) => hexToHsl(b.hex).s - hexToHsl(a.hex).s);
    const rep = inFam[Math.floor(inFam.length / 2)] ?? inFam[0];
    if (rep && !picks.some((p) => p.hex === rep.hex || tooClose(p.hex, rep.hex))) picks.push(rep);
    if (picks.length >= 5) break;
  }
  const roles = ["主色", "點綴", "高光", "輔色", "輔色"];
  const out = [
    { hex: bg.hex, role: "背景", name: bg.name || colorName(bg.hex) },
    ...picks.map((c, i) => ({ hex: c.hex, role: roles[i] ?? "輔色", name: c.name || colorName(c.hex) })),
    { hex: light.hex, role: "歌詞", name: light.name || colorName(light.hex) },
  ];
  // at least four colours: add the second darkest tone as a second background
  if (out.length < 4) {
    const second = byLum.find((c) => !out.some((o) => o.hex === c.hex));
    if (second) out.splice(1, 0, { hex: second.hex, role: "對比背景", name: second.name || colorName(second.hex) });
  }
  return sanitizePalette(out).slice(0, 8);
}

function sectionSeconds(s: DesignPlan["sections"][number]): number {
  return Math.max(0, (s.end ?? 0) - (s.start ?? 0));
}

export function offlineBible(input: BibleInput, now = new Date()): BandBible {
  const base = input.current ? coerceBible(input.current) : defaultBible();
  const plans = input.songs.map((s) => s.plan).filter((p): p is DesignPlan => !!p && Array.isArray(p.sections));
  const bible: BandBible = { ...base, source: { engine: "offline", updatedAt: now.toISOString() } };

  if (plans.length) {
    const palette = derivePalette(plans);
    if (palette.length >= 3) bible.palette = palette;

    const cjk = top(tally(plans.map((p) => p.keyVisual.typography.cjkFont).filter((f): f is FontId => (FONT_IDS as readonly string[]).includes(f) && FONT_CATALOG[f].cjk)), 1)[0];
    const latin = top(tally(plans.map((p) => p.keyVisual.typography.latinFont).filter((f): f is FontId => (FONT_IDS as readonly string[]).includes(f) && !FONT_CATALOG[f].cjk)), 1)[0];
    const weights = plans.map((p) => p.keyVisual.typography.weight).filter((w) => Number.isFinite(w)).sort((a, b) => a - b);
    const weight = weights.length ? Math.round(Math.min(900, Math.max(600, weights[Math.floor(weights.length / 2)])) / 100) * 100 : base.fonts.weight;
    bible.fonts = { cjkFont: cjk ?? base.fonts.cjkFont, latinFont: latin ?? base.fonts.latinFont, weight };

    const motifs = tally(plans.flatMap((p) => p.keyVisual.motifs ?? []).map((m) => m.trim()).filter(Boolean));
    bible.motifs = top(motifs, 6);

    // scenes by stage time; blackout is a tool, not a taste
    const sceneTime = new Map<SceneId, number>();
    for (const p of plans) for (const s of p.sections) if (s.scene !== "blackout" && (SCENE_IDS as readonly string[]).includes(s.scene)) sceneTime.set(s.scene, (sceneTime.get(s.scene) ?? 0) + sectionSeconds(s));
    bible.sceneAffinity = top(sceneTime, 4);

    const energies = input.songs.map((s) => s.energy).filter((e): e is number => typeof e === "number" && Number.isFinite(e));
    const meanEnergy = energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : plans.flatMap((p) => p.sections.map((s) => s.energy)).reduce((a, b, _i, arr) => a + b / arr.length, 0);
    bible.sceneAvoid = meanEnergy < 0.4 ? (["tunnel", "grid"] as SceneId[]).filter((s) => !bible.sceneAffinity.includes(s)) : meanEnergy > 0.7 ? (["gradient"] as SceneId[]).filter((s) => !bible.sceneAffinity.includes(s)) : [];

    const treatments = tally(plans.flatMap((p) => p.sections.map((s) => s.media?.treatment)).filter((t): t is MediaTreatment => !!t && (MEDIA_TREATMENTS as readonly string[]).includes(t)));
    bible.treatments = top(treatments, 4);

    let lyricTime = 0;
    let vocalTime = 0;
    for (const p of plans) for (const s of p.sections) {
      if (s.kind === "intro" || s.kind === "solo" || s.kind === "interlude") continue;
      vocalTime += sectionSeconds(s);
      if (s.lyricStyle !== "hidden") lyricTime += sectionSeconds(s);
    }
    const share = vocalTime > 0 ? lyricTime / vocalTime : 0.5;
    const mode: LyricPolicyMode = share >= 0.75 ? "full" : share <= 0.3 ? "minimal" : "chorus-only";
    bible.lyricPolicy = { mode, note: `目前的作品約 ${Math.round(share * 100)}% 的人聲段落有顯示歌詞。` };

    const keywords = top(tally(plans.flatMap((p) => p.keyVisual.moodKeywords ?? [])), 5);
    const titles = plans.map((p) => `「${p.keyVisual.title}」`).slice(0, 6).join("、");
    const affinity = bible.sceneAffinity.map((s) => SCENES[s].label).join("、");
    bible.summary = [
      "## 世界觀",
      `${input.bandName || "這個樂團"}的歌在舞台上共用一個世界：${titles}。以${bible.palette.slice(0, 3).map((c) => c.name).join("、") || "深色背景上的光"}為基調，畫面以${affinity || "柔和的場景"}為主。`,
      "",
      "## 氣質",
      keywords.length ? `${keywords.join("、")}。` : "克制、有層次，讓樂團站在光裡。",
      "",
      "## 禁忌",
      bible.sceneAvoid.length ? `不用${bible.sceneAvoid.map((s) => SCENES[s].label).join("、")}這類和樂團氣質不合的畫面。` : "不要每首歌都換一套全新的顏色與字體。",
      "",
      `> 由**離線設計師**依 ${plans.length} 首歌的設計方案整理，沒有經過網路研究。請再依樂團的想法修改。`,
    ].join("\n");
  } else {
    bible.summary = base.summary || `## 世界觀\n${input.bandName || "這個樂團"}還沒有設計好的作品。先上傳幾首歌，或直接在這裡寫下樂團的世界觀、氣質與禁忌。`;
  }

  if (!bible.treatments.length && input.assets.length) {
    const t: MediaTreatment[] = ["duotone", "slow-drift"];
    if (input.assets.some((a) => a.kind === "video")) t.push("beat-cut");
    bible.treatments = t;
  }
  const dos = [
    "每首歌的配色都從樂團色盤取，明暗可以變，色相不變",
    bible.lyricPolicy.mode === "full" ? "主歌用安靜的字幕，副歌才放大歌詞" : "副歌才讓歌詞成為畫面主角",
    input.assets.some((a) => a.kind === "logo") ? "樂團 logo 只在開場與結尾出現" : "開場與結尾回到同一個主視覺符號",
  ];
  const donts = ["不要讓畫面和主唱搶戲", "不要每首歌換一種字體", ...(bible.sceneAvoid.length ? [`不要用${bible.sceneAvoid.map((s) => SCENES[s].label).join("、")}`] : [])];
  bible.dos = base.dos.length && base.source?.engine === "manual" ? base.dos : dos;
  bible.donts = base.donts.length && base.source?.engine === "manual" ? base.donts : donts;
  return coerceBible(bible);
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const hex = z.string().describe("#rrggbb lowercase");

export const BibleDraftSchema = z.object({
  summary: z.string().describe("繁體中文 Markdown，三個二級標題：## 世界觀、## 氣質、## 禁忌；共 150 到 400 字"),
  palette: z.array(z.object({ hex, role: z.string().describe("背景、主色、點綴、歌詞、高光…"), name: z.string().describe("顏色的詩意名稱（繁中）") })).describe("4 到 8 色，第一色是最深的背景色，並包含一個給歌詞的高對比亮色"),
  fonts: z.object({
    cjkFont: z.enum(FONT_IDS).describe("CJK-capable font id"),
    latinFont: z.enum(FONT_IDS).describe("Latin font id"),
    weight: z.number().describe("600 to 900"),
  }),
  motifs: z.array(z.string()).describe("3 到 6 個樂團共用的視覺母題（繁中短語）"),
  treatments: z.array(z.enum(MEDIA_TREATMENTS)).describe("樂團素材偏好的 1 到 4 種處理方式"),
  sceneAffinity: z.array(z.enum(SCENE_IDS)).describe("2 到 5 個最像這個樂團的場景"),
  sceneAvoid: z.array(z.enum(SCENE_IDS)).describe("0 到 4 個不該出現的場景"),
  lyricPolicy: z.object({ mode: z.enum(["chorus-only", "full", "minimal"]), note: z.string().describe("一句補充（繁中）") }),
  dos: z.array(z.string()).describe("3 到 6 條「要」（繁中短句）"),
  donts: z.array(z.string()).describe("3 到 6 條「不要」（繁中短句）"),
});

export const BIBLE_SYSTEM = `你是這個樂團的專職舞台視覺總監。樂團一整場演出有十幾首歌，每首歌都要活在同一個世界裡，而不是每首從零開始。現在的任務是整理樂團的「視覺聖經」：之後每首歌的設計都必須遵守它。

依據提供的作品（每首歌已經有的主視覺、配色、字體、場景與研究簡報）以及樂團素材，找出樂團真正的共同語言，寫成可以執行的規範：
- 世界觀、氣質、禁忌要具體（顏色、材質、光的質感、物件、節奏），不要空泛的形容詞。
- 色盤取自作品中反覆出現、最能代表樂團的顏色；第一色是最深的背景色；一定要有給歌詞用、在背景上對比 4.5:1 以上的亮色。
- 字體從提供的清單選：cjkFont 必須是 CJK 字體、latinFont 必須是拉丁字體，字重 600 以上。
- 場景與素材處理只能用提供的 id。
- 歌詞政策：這個樂團的歌詞在螢幕上該出現多少（chorus-only＝副歌才顯示、full＝全曲字幕、minimal＝盡量不顯示）。
- 所有文字用繁體中文。不要重製歌詞。`;

function vocabBlock(): string {
  return [
    "# 場景 id",
    SCENE_IDS.map((id) => `- ${id}（${SCENES[id].label}）`).join("\n"),
    "# 字體 id",
    FONT_IDS.map((id) => `- ${id}（${FONT_CATALOG[id].label}，${FONT_CATALOG[id].cjk ? "CJK" : "拉丁"}）`).join("\n"),
    "# 素材處理 id",
    MEDIA_TREATMENTS.map((id) => `- ${id}（${MEDIA_TREATMENT_INFO[id].label}）`).join("\n"),
  ].join("\n");
}

export function buildBiblePrompt(input: BibleInput): string {
  const songs = input.songs.slice(0, 24).map((s, i) => {
    const p = s.plan;
    if (!p) return `## ${i + 1}. ${s.title}\n（尚未設計）`;
    const scenes = [...new Set(p.sections.map((x) => x.scene))].join("、");
    const styles = [...new Set(p.sections.map((x) => x.lyricStyle))].join("、");
    const brief = s.research?.brief?.trim() ? s.research.brief.trim().slice(0, 1500) : "（沒有研究簡報）";
    return [
      `## ${i + 1}. ${s.title}`,
      `- 主視覺：「${p.keyVisual.title}」：${p.keyVisual.concept.slice(0, 300)}`,
      `- 色盤：${p.keyVisual.palette.map((c) => `${c.hex}（${c.role}，${c.name}）`).join("、")}`,
      `- 字體：${p.keyVisual.typography.cjkFont}／${p.keyVisual.typography.latinFont}，字重 ${p.keyVisual.typography.weight}`,
      `- 母題：${(p.keyVisual.motifs ?? []).join("、")}`,
      `- 場景：${scenes}；歌詞樣式：${styles}`,
      typeof s.energy === "number" ? `- 平均能量：${s.energy.toFixed(2)}` : "",
      "- 研究簡報摘錄：",
      brief,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `# 樂團：${input.bandName || "（未命名）"}`,
    "",
    "# 作品",
    songs.length ? songs.join("\n\n") : "（還沒有作品：依樂團名稱與素材提出初步的聖經，並在 summary 註明是初稿）",
    "",
    "# 樂團素材",
    assetsBlock(input.assets),
    "",
    vocabBlock(),
    "",
    "請輸出樂團的視覺聖經。",
  ].join("\n");
}
