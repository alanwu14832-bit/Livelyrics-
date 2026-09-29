// Offline designer: place the band's own material (album art, photos, MV clips, logo) on the
// sections the way a stage-visual designer would, deterministically:
//   logo   -> the opening and the ending, whole (contain) and screened over the scene
//   videos -> choruses / solos / drops, cut on the beat
//   images -> verses, bridge, breakdown, treated in the section colorway (duotone / grain /
//             slow drift); the album cover (by note / tag / name) is the world of the intro
// Sections that show lyrics keep the material low (mask-lyrics or reduced opacity), and the
// pre-chorus is left to the scene so the material has weight when it comes back.

import type { Asset, MediaTreatment, SectionDesign, SectionMedia } from "@/lib/types";
import { MEDIA_TREATMENT_INFO } from "./catalog";

const COVER_RE = /封面|專輯|album|cover|artwork|jacket|ジャケ/i;

function isCover(a: Asset): boolean {
  return COVER_RE.test(`${a.name} ${a.note ?? ""} ${(a.tags ?? []).join(" ")}`);
}

function media(asset: Asset, treatment: MediaTreatment, opacity: number, over: Partial<SectionMedia> = {}): SectionMedia {
  return {
    assetId: asset.id,
    treatment,
    fit: asset.kind === "logo" ? "contain" : "cover",
    opacity: Math.round(opacity * 100) / 100,
    blend: asset.kind === "logo" ? "screen" : "normal",
    ...over,
  };
}

function rotate<T>(list: readonly T[]) {
  let i = 0;
  return () => list[i++ % list.length];
}

const lyricsShown = (s: SectionDesign) => s.lyricStyle !== "hidden";

/** Returns new sections with `media` filled in (and a sentence about it in the rationale). Pure. */
export function assignMedia(sections: readonly SectionDesign[], assets: readonly Asset[] | undefined): SectionDesign[] {
  const list = (assets ?? []).filter((a) => a && typeof a.id === "string");
  if (!list.length || !sections.length) return sections.map((s) => ({ ...s, media: s.media ?? null }));

  const logos = list.filter((a) => a.kind === "logo");
  const videos = list.filter((a) => a.kind === "video");
  const images = list.filter((a) => a.kind === "image");
  const covers = images.filter(isCover);
  const photos = images.filter((a) => !isCover(a));
  const nextVideo = videos.length ? rotate(videos) : null;
  const nextPhoto = photos.length ? rotate(photos) : images.length ? rotate(images) : null;
  const cover = covers[0] ?? null;
  const logo = logos[0] ?? null;
  const last = sections.length - 1;
  let photoTurn = 0;

  const out = sections.map((s, i): SectionDesign => {
    let m: SectionMedia | null = null;
    const lyric = lyricsShown(s);
    const opening = i === 0 || (s.kind === "intro" && i <= 1);
    const ending = i === last && sections.length > 1;
    switch (s.kind) {
      case "intro":
      case "outro":
        if (logo && (opening || ending)) m = media(logo, "full", lyric ? 0.55 : 0.9);
        else if (cover) m = media(cover, "slow-drift", lyric ? 0.5 : 0.85);
        else if (nextPhoto) m = media(nextPhoto(), "slow-drift", lyric ? 0.45 : 0.75);
        break;
      case "chorus":
      case "solo":
        if (nextVideo) m = media(nextVideo(), "beat-cut", lyric ? 0.55 : 0.9, lyric ? { blend: "overlay" } : {});
        else if (cover && s.kind === "chorus") m = media(cover, "beat-cut", lyric ? 0.45 : 0.8, { blend: "overlay" });
        else if (nextPhoto) m = media(nextPhoto(), "beat-cut", lyric ? 0.4 : 0.75, { blend: "overlay" });
        break;
      case "verse":
      case "interlude":
        if (nextPhoto) {
          const treatment: MediaTreatment = lyric ? (photoTurn++ % 2 === 0 ? "mask-lyrics" : "grain-film") : "duotone";
          m = media(nextPhoto(), treatment, lyric ? 0.6 : 0.85);
        } else if (nextVideo && !lyric) m = media(nextVideo(), "blur-glow", 0.7);
        break;
      case "bridge":
      case "breakdown":
        if (cover) m = media(cover, lyric ? "blur-glow" : "slow-drift", lyric ? 0.55 : 0.85);
        else if (nextPhoto) m = media(nextPhoto(), lyric ? "blur-glow" : "halftone", lyric ? 0.5 : 0.8);
        else if (nextVideo) m = media(nextVideo(), "blur-glow", lyric ? 0.45 : 0.75);
        break;
      case "pre-chorus":
        // left to the scene: the material lands harder when the chorus brings it back
        break;
    }
    // a logo-only band still gets its logo at both ends even when those sections are not intro / outro
    if (!m && logo && (i === 0 || ending) && !videos.length && !images.length) m = media(logo, "full", lyric ? 0.5 : 0.85);
    if (!m) return { ...s, media: null };
    const asset = list.find((a) => a.id === m.assetId)!;
    const how = MEDIA_TREATMENT_INFO[m.treatment].label;
    const note = `素材「${asset.name}」以${how}呈現${lyric && m.opacity < 0.7 ? "，降低存在感讓歌詞清楚" : ""}。`;
    return { ...s, media: m, rationale: s.rationale ? `${s.rationale}${note}` : note };
  });
  return out;
}
