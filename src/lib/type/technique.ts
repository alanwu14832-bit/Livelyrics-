// Round 24: a line's text technique chosen by what the words *do*, not by rotation. A condensed,
// Livelyrics-only reading of the kinetic-type / kinetic-type-director skills (MIT, see
// .claude/skills/SOURCES.md): ask what the line is doing, then reach for the technique whose
// meaning matches — words that break get the slice, a shout gets the stomp, words that vanish
// scatter and fade, a name is written stroke by stroke. Each meaning maps only onto recipes the
// type engine renders (vocab.ts RECIPES); the voice's palette still decides among them, so the
// song keeps one motion language and the meanings are its accents.

import type { TypeRecipeId } from "../types";

export type LineMeaningId = "break" | "shout" | "vanish" | "write" | "vast" | "list" | "intimate";

export interface LineMeaning {
  id: LineMeaningId;
  /** 繁中, for notes and the prompt */
  label: string;
  /** the recipes that say it, best first (all rendered by the type engine) */
  recipes: readonly TypeRecipeId[];
  /** the kinetic-type technique this stands for (for docs and the prompt) */
  technique: string;
  /** a few trigger words (for the prompt) */
  cue: string;
}

export const LINE_MEANINGS: Record<LineMeaningId, LineMeaning> = {
  break: { id: "break", label: "斷裂、拆開", recipes: ["split", "echo", "poster"], technique: "slice／shatter", cue: "拆、碎、撕、break" },
  shout: { id: "shout", label: "口號、喊出來", recipes: ["giant-word", "poster", "echo"], technique: "stomp", cue: "Hey、帶驚嘆號的短句" },
  vanish: { id: "vanish", label: "消失、遠去", recipes: ["scatter", "whisper", "vertical-column"], technique: "disintegrate／smoke", cue: "消失、忘記、再見" },
  write: { id: "write", label: "寫下、名字", recipes: ["brush-write", "title-card", "vertical-column"], technique: "stroke write-on", cue: "寫、名字、信" },
  vast: { id: "vast", label: "遼闊、整個世界", recipes: ["bleed", "giant-word", "poster"], technique: "oversized bleed", cue: "世界、天空、遠方" },
  list: { id: "list", label: "並列、一條一條", recipes: ["grid-poem", "cross", "poster"], technique: "grid／list reveal", cue: "他們說…他們說…" },
  intimate: { id: "intimate", label: "低聲、對一個人說", recipes: ["whisper", "vertical-column", "title-card"], technique: "tracking-in", cue: "問句、輕輕、一個人" },
};

const BREAK = /拆|撕|碎|裂|破|崩|斷|砸|摔|燒掉|推倒|break|broken|shatter|tear|crack|smash/i;
const VANISH = /消失|不見|散去|散了|飄散|淡去|淡出|忘記|忘了|遺忘|再見|離開|走遠|遠去|告別|熄滅|融化|gone|fade|vanish|disappear|goodbye|forget|melt/i;
const WRITE = /寫|名字|簽|信紙|一字一字|筆|書|字跡|write|written|name|letter|sign/i;
const VAST = /世界|宇宙|天空|整片|整個|全部|所有的?人|遠方|無邊|地平線|海洋|world|universe|sky|everything|everyone|horizon/i;
const INTIMATE = /嗎[？?]?$|呢[？?]?$|[？?]$|悄悄|輕輕|小聲|低聲|一個人|只有你|晚安|whisper|quietly|softly|alone/i;
const CHANT = /^(?:\s*(?:hey|oh+|yeah|woah|whoa|la+|na+|go|嘿|喔|哦|啦+)[\s!,.！]*)+$/i;

function units(text: string): number {
  let n = 0;
  for (const ch of text) if (/\p{Script=Han}/u.test(ch)) n++;
  n += (text.match(/[A-Za-z0-9']+/g) ?? []).length;
  return n;
}

/** Parallel clauses: two or more space-separated chunks that share a head or a tail (他們說…他們說…, 撕掉…燒掉…). */
function isList(text: string): boolean {
  const parts = text.trim().split(/[\s，,、]+/).filter(Boolean);
  // Latin words are space-separated by nature: only Chinese clauses make a list
  if (parts.length < 2 || parts.some((p) => units(p) > 8 || !/\p{Script=Han}/u.test(p))) return false;
  const heads = new Set(parts.map((p) => Array.from(p).slice(0, 2).join("")));
  const tails = new Set(parts.map((p) => Array.from(p).slice(-1).join("")));
  return heads.size < parts.length || (parts.length >= 2 && tails.size === 1 && parts.every((p) => units(p) >= 2)) || (parts.length >= 3 && parts.every((p) => units(p) <= 3));
}

/** A vanishing word that is not negated (「不會熄滅」「不要忘記」 hold on, they do not vanish). */
function vanishes(t: string): boolean {
  const m = VANISH.exec(t);
  if (!m) return false;
  return !/[不沒別未]$|不會$|不要$|never $|not $|don't $/i.test(t.slice(Math.max(0, m.index - 6), m.index));
}

/** Meanings that ask for loud type: a quiet line (low energy) keeps its quiet recipe instead. */
export const LOUD_MEANINGS: ReadonlySet<LineMeaningId> = new Set(["break", "shout", "vast", "list"]);

/**
 * What the line is doing, or null when it is an ordinary line (the house style carries it). The
 * order is from the clearest evidence: a bare chant or a short exclamation shouts, parallel
 * clauses list, then the words' own verbs.
 */
export function lineMeaning(text: string): LineMeaning | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const n = units(t);
  if (CHANT.test(t) || (n <= 5 && /[!！]$/.test(t))) return LINE_MEANINGS.shout;
  if (BREAK.test(t)) return LINE_MEANINGS.break;
  if (isList(t)) return LINE_MEANINGS.list;
  if (vanishes(t)) return LINE_MEANINGS.vanish;
  if (WRITE.test(t)) return LINE_MEANINGS.write;
  if (VAST.test(t)) return LINE_MEANINGS.vast;
  if (INTIMATE.test(t)) return LINE_MEANINGS.intimate;
  return null;
}
