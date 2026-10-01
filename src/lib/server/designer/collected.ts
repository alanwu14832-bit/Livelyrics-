// The designer's view of 研究找到的素材 (phase 8): the band's real album / single cover, MV stills,
// key visual / poster, logo and live photos the research collected.
//
// Claude (design, directions and the scene program): each image the server could read goes into the
// user turn after the mood board (a label with its kind, source and whether it may be on stage, then
// the image), and the prompt tells the designer to derive palette, motifs, composition and texture
// from this real material, and that the items marked 可以上台 may be a section's `media` with a
// suitable treatment — where it serves the song, not everywhere.
// Offline: the colours measured on the server at download time (the cover counts most) join the mood
// board's palette, and a cover / key visual / MV still may appear in one or two sections.

import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { hexRgb, moodSummary, type MoodSummary } from "@/lib/moodboard";
import type { CollectedVisual, MediaTreatment, MoodImage, SectionDesign, SectionMedia } from "@/lib/types";
import { VISUAL_FINDER_LABEL, VISUAL_KIND_LABEL } from "@/lib/visuals";
import type { VisionImage } from "./moodboard";

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function host(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 「素材 n：研究找到的專輯封面「…」（Cover Art Archive，host）｜可以上台（素材 id …）」 */
export function collectedLabel(c: CollectedVisual, n: number): string {
  return label(c, n);
}

function label(c: CollectedVisual, n: number): string {
  const src = host(c.provenance.sourceUrl) || host(c.provenance.imageUrl);
  const title = c.provenance.title ? `「${clip(c.provenance.title, 60)}」` : "";
  const stage = c.use === "stage" ? `可以上台（素材 id ${c.id}）` : "只當參考（不要放上舞台）";
  return `素材 ${n}：研究找到的${VISUAL_KIND_LABEL[c.provenance.kind]}${title}（${VISUAL_FINDER_LABEL[c.provenance.foundBy]}${src ? `，${src}` : ""}）｜${stage}`;
}

/** The image blocks for the user turn (after the mood board's), numbered like `collectedBlock`. */
export function collectedVisionContent(collected: readonly CollectedVisual[] | undefined, images: readonly VisionImage[] | undefined): BetaContentBlockParam[] {
  const loaded = new Map((images ?? []).map((v) => [v.id, v]));
  const out: BetaContentBlockParam[] = [];
  (collected ?? []).forEach((c, i) => {
    const v = loaded.get(c.id);
    if (!v) return;
    out.push({ type: "text", text: label(c, i + 1) });
    out.push({ type: "image", source: { type: "base64", media_type: v.mediaType, data: v.data } });
  });
  return out;
}

/** The collection in the prompt text (null without one): what each item is, its colours, the rules. */
export function collectedBlock(collected: readonly CollectedVisual[] | undefined, images: readonly VisionImage[] | undefined, opts: { media?: boolean } = {}): string | null {
  const list = collected ?? [];
  if (!list.length) return null;
  const loaded = new Set((images ?? []).map((v) => v.id));
  const rows = list.map((c, i) => {
    const parts = [label(c, i + 1)];
    if (c.provenance.why) parts.push(`為什麼重要：${clip(c.provenance.why, 160)}`);
    if (c.stats?.palette.length) parts.push(`量到的主色：${c.stats.palette.slice(0, 5).join("、")}（亮度 ${c.stats.luma.toFixed(2)}、飽和度 ${c.stats.saturation.toFixed(2)}）`);
    if (!loaded.has(c.id)) parts.push("（圖沒有附上，只能依種類與色票判斷）");
    return `- ${parts.join("｜")}`;
  });
  const onStage = list.filter((c) => c.use === "stage");
  return [
    "研究時找到的樂團真實視覺素材（上方附上的圖片，編號相同；樂團已授權的才標「可以上台」）。這是這首歌真正的樣子，請真的看圖：",
    "- 配色、母題、構圖與材質要從這些真實素材長出來：封面的主色與明暗、MV 的場景與光線、主視覺的構圖與字體、現場照片的燈光。設計要一眼看得出和這張專輯、這支 MV、這個主視覺是同一個世界。",
    "- 在 keyVisual.concept 與相關段落的 rationale 寫明哪個素材啟發了什麼（例如「素材 1 封面的橘紅 → 副歌主色」）。",
    ...(opts.media !== false
      ? onStage.length
        ? [
            `- 標「可以上台」的素材已經列在「樂團素材」清單裡（同一個 id），可以當某些段落的 media：用適合的處理（封面用 duotone／halftone／grain-film／slow-drift，MV 畫面用 blur-glow／grain-film，標誌用 full 置中），和場景、歌詞一起構圖。`,
            "- 節制：只放在真正需要的一兩個段落（例如開場讓封面慢慢浮現、橋段回到封面），不要每段都放，也不要讓素材和歌詞搶。",
          ]
        : ["- 這些素材目前都只當參考，不能放上舞台：每段的 media 不要用它們。"]
      : []),
    ...rows,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// offline
// ---------------------------------------------------------------------------

const KIND_WEIGHT: Record<CollectedVisual["provenance"]["kind"], number> = { cover: 3, keyvisual: 2, mv: 1.5, live: 1, logo: 0.5 };

/**
 * One colour reading of the mood board and the collection together: the operator's mood board as
 * before, the collected images weighted by kind (the cover counts most). Null without colours.
 */
export function combinedMood(moodboard: readonly MoodImage[] | undefined, collected: readonly CollectedVisual[] | undefined): MoodSummary | null {
  const list: MoodImage[] = [...(moodboard ?? []), ...(collected ?? [])];
  const kinds = new Map((collected ?? []).map((c) => [c.id, c.provenance.kind]));
  return moodSummary(list, (m) => {
    const kind = kinds.get(m.id);
    return kind ? KIND_WEIGHT[kind] : null;
  });
}

/** The cover's (else the key visual's) own palette, most weight first (for the scene program prompt). */
export function leadPalette(collected: readonly CollectedVisual[] | undefined): { item: CollectedVisual; palette: string[] } | null {
  const measured = (collected ?? []).filter((c) => c.stats?.palette.length);
  const lead = measured.find((c) => c.provenance.kind === "cover") ?? measured.find((c) => c.provenance.kind === "keyvisual") ?? measured[0];
  return lead ? { item: lead, palette: lead.stats!.palette.filter((h) => hexRgb(h)) } : null;
}

/** "warm" / "cool" from the lead image's balance (null when neutral or unknown). */
export function leadTemperature(collected: readonly CollectedVisual[] | undefined): "warm" | "cool" | null {
  const lead = leadPalette(collected)?.item;
  const w = lead?.stats?.warmth;
  if (w == null) return null;
  return w > 0.08 ? "warm" : w < -0.08 ? "cool" : null;
}

function media(assetId: string, treatment: MediaTreatment, opacity: number, over: Partial<SectionMedia> = {}): SectionMedia {
  return { assetId, treatment, fit: "cover", opacity: Math.round(opacity * 100) / 100, blend: "normal", ...over };
}

/**
 * Offline restraint for collected material that may be on stage: the cover opens the song (slowly
 * surfacing, duotone in the section's colourway) and returns once in the bridge / breakdown as a
 * halftone print; a key visual or MV still takes one quiet section when there is no cover; a logo
 * closes an ending that has nothing. Only sections that have no media yet; at most three sections.
 */
export function placeCollected(sections: readonly SectionDesign[], collected: readonly CollectedVisual[] | undefined): SectionDesign[] {
  const onStage = (collected ?? []).filter((c) => c.use === "stage");
  if (!onStage.length || !sections.length) return [...sections];
  const cover = onStage.find((c) => c.provenance.kind === "cover");
  const still = onStage.find((c) => c.provenance.kind === "keyvisual") ?? onStage.find((c) => c.provenance.kind === "mv") ?? onStage.find((c) => c.provenance.kind === "live");
  const logo = onStage.find((c) => c.provenance.kind === "logo");
  const out = sections.map((s) => ({ ...s }));
  const free = (i: number) => i >= 0 && i < out.length && !out[i].media;
  const lyric = (s: SectionDesign) => s.lyricStyle !== "hidden";
  let placed = 0;
  const put = (i: number, item: CollectedVisual, treatment: MediaTreatment, opacity: number, why: string, over: Partial<SectionMedia> = {}) => {
    if (!free(i) || placed >= 3) return;
    const s = out[i];
    const m = media(item.id, treatment, lyric(s) ? Math.min(opacity, 0.5) : opacity, item.kind === "logo" ? { fit: "contain", blend: "screen", ...over } : over);
    out[i] = { ...s, media: m, rationale: `${s.rationale ? `${s.rationale}` : ""}${why}` };
    placed++;
  };
  const first = out.findIndex((s) => s.kind === "intro");
  const opening = first >= 0 ? first : 0;
  const bridge = out.findIndex((s, i) => i > opening && (s.kind === "bridge" || s.kind === "breakdown" || s.kind === "interlude"));
  const quiet = out.findIndex((s, i) => i > opening && s.kind === "verse" && s.energy <= 0.5);
  const lead = cover ?? still;
  if (lead) {
    const name = VISUAL_KIND_LABEL[lead.provenance.kind];
    put(opening, lead, cover ? "duotone" : "slow-drift", 0.75, `開場讓研究找到的${name}以${cover ? "雙色調" : "緩慢漂移"}浮現：一開始就認得出是這張作品的世界。`);
    if (bridge >= 0) put(bridge, lead, "halftone", 0.62, `橋段回到${name}，用印刷網點處理，和開場呼應。`);
    else if (quiet >= 0 && still && still !== lead) put(quiet, still, "grain-film", 0.5, `主歌放${VISUAL_KIND_LABEL[still.provenance.kind]}的畫面，壓低存在感讓歌詞清楚。`);
  }
  if (still && lead === cover && bridge >= 0 && quiet >= 0) put(quiet, still, "grain-film", 0.45, `主歌放${VISUAL_KIND_LABEL[still.provenance.kind]}的顆粒畫面，壓低存在感讓歌詞清楚。`);
  const last = out.length - 1;
  if (logo && last > 0) put(last, logo, "full", 0.8, "結尾放樂團標誌。");
  return out;
}
