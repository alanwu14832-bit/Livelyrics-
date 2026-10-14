// Round 20 (m9): 「重新研究並設計」 without an instruction updates the research, the sections and the
// cues, but keeps the song's world — the key visual (title, concept, palette, motifs, symbol, fonts),
// the 字體語言 and the 專屬畫面 — unless the operator asks for a new direction in words.

import type { DesignPlan } from "@/lib/types";

/** An instruction that asks for another world (「換一個新方向」「全新的感覺」). */
const NEW_DIRECTION = /新方向|換(一個|個)?(方向|風格|世界|主視覺|感覺)|全新|重新來過|砍掉重練|完全不同|不一樣的(世界|風格|感覺)|另一個方向|new direction|start over|from scratch/i;

export function asksNewDirection(instruction: string | undefined | null): boolean {
  return !!instruction && NEW_DIRECTION.test(instruction);
}

/**
 * Whether a run keeps the current world: it re-researches and re-designs a song that already has a
 * plan, with no instruction at all (any instruction is handled as an edit of the current plan, and
 * one that asks for a new direction gets a new world).
 */
export function keepsWorld(opts: { research: boolean; design: boolean; instruction?: string | null; hasPlan: boolean }): boolean {
  return opts.research && opts.design && opts.hasPlan && !opts.instruction?.trim();
}

/**
 * The fresh plan in the previous plan's world: its key visual and 字體語言, the sections' colours
 * mapped from the fresh palette onto the previous one (same role, else the same slot), the previous 專屬畫面.
 * The sections, lines, cues and notes stay the fresh ones (they follow the new research and timing).
 */
export function keepWorld(fresh: DesignPlan, previous: DesignPlan): DesignPlan {
  const map = new Map<string, string>();
  fresh.keyVisual.palette.forEach((p, i) => {
    const old = previous.keyVisual.palette.find((q) => q.role === p.role) ?? previous.keyVisual.palette[i];
    if (old) map.set(p.hex.toLowerCase(), old.hex);
  });
  const swap = (hex: string) => map.get(hex.toLowerCase()) ?? hex;
  const sections = fresh.sections.map((s) => ({ ...s, colorway: s.colorway.map(swap) as typeof s.colorway, lyricColor: swap(s.lyricColor) }));
  return {
    ...fresh,
    keyVisual: previous.keyVisual,
    sections,
    // the 字體語言 with the editor's compositions and locks (normalizePlan aligns it to the lyrics)
    ...(previous.typeSystem ? { typeSystem: previous.typeSystem } : {}),
    ...(previous.sceneProgram ? { sceneProgram: previous.sceneProgram } : {}),
  };
}
