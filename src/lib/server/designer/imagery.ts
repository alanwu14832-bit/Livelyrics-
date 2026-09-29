// Lyric imagery -> visual vocabulary, for the offline designer (hue, scene and emblem biases, motif
// names) and the Claude research prompt (the imagery words). Backed by the curated imagery lexicon
// (lexicon/imagery.ts) and the lyric tokenizer (lyric-analysis.ts); this module keeps the original
// small API: one Imagery per family, hits ranked by how visual and how frequent they are.

import type { SceneId } from "@/lib/types";
import { IMAGERY_FAMILIES, type ImageryFamily } from "./lexicon/imagery";
import { findImageryFamilies } from "./lyric-analysis";
import type { EmblemStyle } from "./svg";

export interface Imagery {
  /** mood keyword / short motif name (繁中) */
  name: string;
  /** motif phrase for the key visual */
  motif: string;
  words: string[];
  hue: number;
  scene: SceneId;
  emblem: EmblemStyle;
  /** saturation multiplier (snow / ink are muted) */
  saturation?: number;
  /** the lexicon family (scene family, colours, motion, temperature) */
  family: ImageryFamily;
}

function toImagery(f: ImageryFamily): Imagery {
  return { name: f.name, motif: f.motif, words: f.words, hue: f.hues[0], scene: f.scenes[0], emblem: f.emblem, saturation: f.saturation, family: f };
}

export const IMAGERY: Imagery[] = IMAGERY_FAMILIES.map(toImagery);
const BY_ID = new Map(IMAGERY.map((i) => [i.family.id, i]));

export interface ImageryHit {
  imagery: Imagery;
  count: number;
  /** the matched words as written in the lyrics (exact substrings), longest first */
  words: string[];
}

/** Imagery found in the lyrics (+ title, weighted double): the most visual and frequent first. */
export function findImagery(lines: readonly string[], title = ""): ImageryHit[] {
  return findImageryFamilies(lines, title)
    .sort((a, b) => b.weight - a.weight || b.count - a.count)
    .map((h) => ({ imagery: BY_ID.get(h.family.id)!, count: h.count, words: h.surfaces.length ? h.surfaces : h.words }));
}
