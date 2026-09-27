// Pure helpers for the console's quick plan edits and the 1–9 scene bank.

import { LYRIC_PLACEMENTS, LYRIC_STYLE_IDS, MEDIA_BLENDS, MEDIA_FITS, MEDIA_TREATMENTS, SCENE_IDS } from "@/lib/schema";
import type { DesignPlan, LyricPlacement, LyricStyleId, SceneId, SectionDesign, SectionMedia } from "@/lib/types";

export type SectionPatch = Partial<Pick<SectionDesign, "scene" | "lyricStyle" | "lyricPlacement" | "lyricScale" | "transitionIn" | "media">>;

const TREATMENT_SET = new Set<string>(MEDIA_TREATMENTS);
const FIT_SET = new Set<string>(MEDIA_FITS);
const BLEND_SET = new Set<string>(MEDIA_BLENDS);

/** A well-formed media value (opacity clamped and rounded), or undefined when invalid. */
export function cleanMedia(m: SectionMedia | null): SectionMedia | null | undefined {
  if (m === null) return null;
  if (!m || typeof m.assetId !== "string" || !m.assetId) return undefined;
  if (!TREATMENT_SET.has(m.treatment) || !FIT_SET.has(m.fit) || !BLEND_SET.has(m.blend) || !Number.isFinite(m.opacity)) return undefined;
  return { assetId: m.assetId, treatment: m.treatment, fit: m.fit, opacity: Math.round(Math.min(1, Math.max(0, m.opacity)) * 100) / 100, blend: m.blend };
}

export const LYRIC_SCALE_MIN = 0.6;
export const LYRIC_SCALE_MAX = 1.8;

const SCENES = new Set<string>(SCENE_IDS);
const STYLES = new Set<string>(LYRIC_STYLE_IDS);
const PLACEMENTS = new Set<string>(LYRIC_PLACEMENTS);
const TRANSITIONS = new Set<string>(["cut", "fade", "flash", "wipe", "bloom"]);

export const isSceneId = (x: unknown): x is SceneId => typeof x === "string" && SCENES.has(x);
export const isLyricStyleId = (x: unknown): x is LyricStyleId => typeof x === "string" && STYLES.has(x);
export const isPlacement = (x: unknown): x is LyricPlacement => typeof x === "string" && PLACEMENTS.has(x);

/**
 * Returns a new plan with section `index` patched (invalid values are ignored), or the
 * same plan object when nothing changed.
 */
export function patchSection(plan: DesignPlan, index: number, patch: SectionPatch): DesignPlan {
  const section = plan.sections[index];
  if (!section) return plan;
  const next: SectionDesign = { ...section };
  let changed = false;
  if (patch.scene !== undefined && isSceneId(patch.scene) && patch.scene !== section.scene) {
    next.scene = patch.scene;
    changed = true;
  }
  if (patch.lyricStyle !== undefined && isLyricStyleId(patch.lyricStyle) && patch.lyricStyle !== section.lyricStyle) {
    next.lyricStyle = patch.lyricStyle;
    changed = true;
  }
  if (patch.lyricPlacement !== undefined && isPlacement(patch.lyricPlacement) && patch.lyricPlacement !== section.lyricPlacement) {
    next.lyricPlacement = patch.lyricPlacement;
    changed = true;
  }
  if (patch.lyricScale !== undefined && Number.isFinite(patch.lyricScale)) {
    const scale = Math.round(Math.min(LYRIC_SCALE_MAX, Math.max(LYRIC_SCALE_MIN, patch.lyricScale)) * 100) / 100;
    if (scale !== section.lyricScale) {
      next.lyricScale = scale;
      changed = true;
    }
  }
  if (patch.transitionIn !== undefined && TRANSITIONS.has(patch.transitionIn) && patch.transitionIn !== section.transitionIn) {
    next.transitionIn = patch.transitionIn;
    changed = true;
  }
  if (patch.media !== undefined) {
    const media = cleanMedia(patch.media);
    if (media !== undefined && JSON.stringify(media) !== JSON.stringify(section.media ?? null)) {
      next.media = media;
      changed = true;
    }
  }
  if (!changed) return plan;
  const sections = plan.sections.slice();
  sections[index] = next;
  return { ...plan, sections };
}

/** Scenes that fill the bank after the song's own scenes, most useful first. */
const BANK_FILL: SceneId[] = ["motif", "gradient", "nebula", "particles", "waves", "bokeh", "rain", "ink", "shards", "grid", "tunnel"];

export const SCENE_BANK_SIZE = 9;

/**
 * The 9 scenes on keys 1–9: the scenes this song's plan uses (in order of first
 * appearance, "blackout" excluded — B is the blackout key), then the rest by usefulness.
 */
export function sceneBank(plan: DesignPlan | null): SceneId[] {
  const bank: SceneId[] = [];
  const add = (s: SceneId) => {
    if (s !== "blackout" && !bank.includes(s) && bank.length < SCENE_BANK_SIZE) bank.push(s);
  };
  for (const section of plan?.sections ?? []) if (isSceneId(section.scene)) add(section.scene);
  for (const s of BANK_FILL) add(s);
  return bank;
}
