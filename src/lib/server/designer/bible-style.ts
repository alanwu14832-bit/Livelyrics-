// Offline designer: how the band's visual bible (視覺聖經) constrains a heuristic plan. The bible
// palette replaces the generated one (roles by lightness and contrast), its fonts replace the
// mood fonts, avoided scenes are never picked and preferred ones win ties, the lyric policy
// decides which sections show lyrics, and preferred treatments replace the default media looks.
// Pure; every function returns new objects.

import { paletteRoles } from "@/lib/show";
import type { BandBible, LyricPlacement, LyricStyleId, MediaTreatment, SceneId, SectionDesign } from "@/lib/types";
import { colorName } from "./color";
import type { PaletteEntry } from "./palette";

/** The bible only constrains what it actually decides. */
export function activeBible(bible: BandBible | null | undefined): BandBible | null {
  if (!bible) return null;
  const decided = bible.palette.length || bible.sceneAffinity.length || bible.sceneAvoid.length || bible.treatments.length || bible.source || bible.summary.trim() || bible.motifs.length;
  return decided ? bible : null;
}

export interface BiblePalette {
  entries: PaletteEntry[];
  bg: string;
  primary: string;
  accent: string;
  lyric: string;
  highlight: string;
  bg2: string;
}

/** The bible palette in stage roles; null when it has fewer than 3 colours. */
export function biblePalette(bible: BandBible | null | undefined): BiblePalette | null {
  const list = bible?.palette ?? [];
  if (list.length < 3) return null;
  const r = paletteRoles(list.map((c) => c.hex));
  // background first (the key-visual contract), the rest in the band's own order
  const entries: PaletteEntry[] = [];
  const push = (hex: string, fallbackRole: string) => {
    if (entries.some((e) => e.hex === hex)) return;
    const own = list.find((c) => c.hex === hex);
    entries.push({ hex, role: own?.role || fallbackRole, name: own?.name || colorName(hex) });
  };
  push(r.bg, "背景");
  for (const c of list) push(c.hex, "色彩");
  if (!entries.some((e) => e.hex === r.lyric)) push(r.lyric, "歌詞");
  return { entries: entries.slice(0, 8), ...r };
}

/** Scene candidates with avoided scenes removed and preferred ones first (order kept otherwise). */
export function biasScenes(list: readonly SceneId[], bible: BandBible | null | undefined): SceneId[] {
  if (!bible) return [...list];
  const avoid = new Set(bible.sceneAvoid);
  const kept = list.filter((s) => !avoid.has(s));
  const preferred = kept.filter((s) => bible.sceneAffinity.includes(s));
  const rest = kept.filter((s) => !bible.sceneAffinity.includes(s));
  const out = [...preferred, ...rest];
  return out.length ? out : bible.sceneAffinity.length ? [...bible.sceneAffinity] : (["gradient"] as SceneId[]);
}

/** Replace an avoided scene by the first preferred (else neutral) one that is not the neighbour's. */
export function avoidScene(scene: SceneId, bible: BandBible | null | undefined, prev: SceneId | null, fallback: readonly SceneId[]): SceneId {
  if (!bible || !bible.sceneAvoid.includes(scene)) return scene;
  const pool = biasScenes([...bible.sceneAffinity, ...fallback, "nebula", "gradient", "particles", "waves"], bible);
  return pool.find((s) => s !== prev) ?? pool[0] ?? "gradient";
}

type LyricPick = { style: LyricStyleId; placement: LyricPlacement; scale: number };

/**
 * The lyric policy on top of the per-section choice:
 *   chorus-only  lyrics only in choruses (the loudest section when no chorus was found)
 *   minimal      only the last chorus (or the loudest section), as a hook
 *   full         every section with lyrics shows them; verses that would hide get a subtitle
 */
export function applyLyricPolicy(
  pick: LyricPick,
  s: { kind: SectionDesign["kind"]; energy: number; hasLines: boolean },
  ctx: { bible: BandBible | null; isLastChorus: boolean; isLoudest: boolean; hasChorus: boolean },
): LyricPick {
  const b = ctx.bible;
  if (!b || !s.hasLines) return pick;
  const mode = b.lyricPolicy.mode;
  if (mode === "full") {
    if (pick.style === "hidden" && s.kind !== "solo" && s.kind !== "interlude") return { style: "subtitle", placement: "lower-third", scale: 0.9 };
    return pick;
  }
  const keep = mode === "chorus-only" ? (ctx.hasChorus ? s.kind === "chorus" : ctx.isLoudest) : ctx.hasChorus ? ctx.isLastChorus : ctx.isLoudest;
  if (!keep) return { style: "hidden", placement: pick.placement, scale: pick.scale };
  if (mode === "minimal" && pick.style !== "impact") return { style: "impact", placement: "center", scale: Math.max(pick.scale, 1.2) };
  return pick;
}

const BEAT_OK = 0.55;

/** Swap media treatments for the bible's preferred ones where they fit (beat-cut only when loud). */
export function applyTreatments(sections: readonly SectionDesign[], bible: BandBible | null | undefined): SectionDesign[] {
  const pref = bible?.treatments ?? [];
  if (!pref.length) return sections.map((s) => ({ ...s }));
  let turn = 0;
  return sections.map((s) => {
    if (!s.media || pref.includes(s.media.treatment)) return { ...s };
    const fits = (t: MediaTreatment) => (t === "beat-cut" ? s.energy >= BEAT_OK : true) && !(t === "mask-lyrics" && s.lyricStyle === "hidden");
    const options = pref.filter(fits);
    if (!options.length) return { ...s };
    const treatment = options[turn++ % options.length];
    return { ...s, media: { ...s.media, treatment } };
  });
}
