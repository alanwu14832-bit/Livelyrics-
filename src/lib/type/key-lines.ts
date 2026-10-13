// 字體藝術, phase 7: the song's key lines — the small budget of lines allowed to be set large. Chosen
// for meaning, not for loudness: the line that names the song, the chorus hook (the line the crowd
// sings back: repeated in the choruses, or the first line of the first chorus). Every other line is
// small-to-medium on the grid. The 排版 editor can mark or unmark a line (TypeLineEdit.key).

import { sectionIndexForLine } from "../timeline";
import type { DesignPlan, LyricLine } from "../types";
import { hasDarkWord } from "./sensitive";
import { textKey } from "./sequence";

/** At most this many distinct lyric texts are key lines, and about one in ten. */
export const MAX_KEY_LINES = 3;

export function keyLineBudget(distinct: number): number {
  return Math.max(1, Math.min(MAX_KEY_LINES, Math.round(distinct * 0.1)));
}

/** A hook sung at least this many times is the crowd's line (set large every time). */
export const CHANT_REPEATS = 4;
const CHANT_WORD = /^(?:hey|oh+|yeah|woah|whoa|la+|na+|go|嘿|喔|哦|啦)+$/i;
/** Voices whose genres shout (punk, hardcore, metal, noise: the glitch voice). */
const SHOUT_VOICES = new Set(["glitch"]);

/**
 * Round 17: the text keys of the crowd's lines — the hook sung ≥ CHANT_REPEATS times (a short line
 * that is, or is contained in, that many sung lines: 「拆掉這面牆」, 「Lay me down」 in 「Lay me down,
 * lay me down」) and the lines that carry it without much else, plus, in a shouting voice, a chant
 * (「Hey Hey Hey」). Never a line with a dark word. Outside the key-line budget: they are set large
 * every time they come back.
 */
export function chantLineKeys(plan: Pick<DesignPlan, "typeSystem">, lines: readonly LyricLine[]): Set<string> {
  const out = new Set<string>();
  const keys = lines.map((l) => ({ k: textKey(l?.text ?? ""), text: l?.text ?? "" })).filter((x) => x.k);
  const distinct = [...new Set(keys.map((x) => x.k))];
  const dark = new Set(keys.filter((x) => hasDarkWord(x.text)).map((x) => x.k));
  const hooks: string[] = [];
  for (const k of distinct) {
    if (dark.has(k) || Array.from(k).length > 14 || Array.from(k).length < 2) continue;
    const sung = keys.filter((x) => x.k.includes(k)).length;
    if (sung >= CHANT_REPEATS) hooks.push(k);
  }
  for (const k of distinct) {
    if (dark.has(k)) continue;
    // the hook itself, or a line that is mostly the hook (its repeats, a chant word around it)
    if (hooks.some((h) => k === h || (k.includes(h) && Array.from(k).length <= Array.from(h).length * 2.2))) out.add(k);
  }
  if (SHOUT_VOICES.has(plan.typeSystem?.voice ?? "")) {
    for (const x of keys) {
      if (dark.has(x.k)) continue;
      const words = x.text.split(/[\s,，、!！?？.。~～]+/).filter(Boolean);
      if (words.length && words.every((w) => CHANT_WORD.test(w))) out.add(x.k);
    }
  }
  return out;
}

/** The text keys (sequence.textKey) of the song's key lines. */
export function keyLineKeys(plan: Pick<DesignPlan, "sections" | "typeSystem">, lines: readonly LyricLine[], duration: number, title = ""): Set<string> {
  const score = new Map<string, number>();
  const add = (k: string, v: number) => score.set(k, (score.get(k) ?? 0) + v);
  const titleKey = textKey(title);
  const chorusCount = new Map<string, number>();
  let firstChorus: number | null = null;
  let firstChorusLine: string | null = null;
  const distinct = new Set<string>();
  const energy = new Map<string, number>();
  for (const h of plan.typeSystem?.lines ?? []) if (h && typeof h.lineId === "string" && typeof h.energy === "number") energy.set(h.lineId, h.energy);
  lines.forEach((l, i) => {
    const k = textKey(l?.text ?? "");
    if (!k) return;
    distinct.add(k);
    const si = sectionIndexForLine(plan as DesignPlan, lines as LyricLine[], i, duration);
    const kind = si != null ? plan.sections[si]?.kind : undefined;
    if (kind === "chorus") {
      chorusCount.set(k, (chorusCount.get(k) ?? 0) + 1);
      if (firstChorus == null) firstChorus = si;
      if (si === firstChorus && firstChorusLine == null) firstChorusLine = k;
    }
    if (titleKey.length >= 2 && k.includes(titleKey)) add(k, 3);
    if ((energy.get(l.id) ?? 0) >= 0.85) add(k, 0.8);
  });
  for (const [k, n] of chorusCount) if (n >= 2) add(k, 1.2 + 0.5 * Math.min(4, n));
  if (firstChorusLine) add(firstChorusLine, 2);
  const budget = keyLineBudget(distinct.size);
  const ranked = [...score.entries()].filter(([, s]) => s >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return new Set(ranked.slice(0, budget).map(([k]) => k));
}
