// Round 14 / 17 — dark words (violence, weapons, blood, death, self-harm, drugs, sex). They may
// colour the world through symbolic imagery (the designer's lexicon), but they are never emphasis:
// never the display word, never a motion word (no drip, no splatter, no echo), never the crowd's
// chant, never the key moment. This module is the shared, dependency-free matcher the type engine
// (in the browser) and the designers (on the server) both use.

import { toTraditional } from "../zh-variants";

/** The dark words, traditional spellings (simplified lyrics are matched after `toTraditional`). */
export const SENSITIVE_WORDS: readonly string[] = [
  "鮮血", "血液", "流血", "血滴", "血", "死亡", "死去", "死掉", "想死", "去死", "尋死", "屍體", "墳墓", "墓碑", "骷髏", "葬禮", "自殺", "割腕", "自殘", "輕生",
  "傷口", "傷痕", "刀子", "刀鋒", "刀片", "匕首", "殺死", "殺人", "謀殺", "暴力", "開槍", "槍口", "子彈", "槍", "刀", "殺", "炸彈",
  "毒品", "嗑藥", "吸毒", "藥丸", "大麻", "做愛", "上床", "赤裸", "裸體", "情慾",
  "blood", "bloody", "bleed", "bleeding", "dying", "dead", "death", "corpse", "corpses", "grave", "graves", "coffin", "skull", "skulls", "suicide", "suicidal",
  "wound", "wounds", "kill", "kills", "killing", "killer", "murder", "knife", "knives", "blade", "blades", "gun", "guns", "bullet", "bullets", "shoot", "violence", "violent", "bomb",
  "drug", "drugs", "pill", "pills", "cocaine", "heroin", "sex", "naked", "nude", "lust",
];

/** Everyday compounds that hold a dark character but are not dark (熱血 is passion, 血拼 shopping). */
const NOT_DARK: readonly string[] = ["熱血", "血拼", "殺價", "心血", "血汗", "血緣", "血型", "殺青", "抹殺"];

const CJK_WORDS = SENSITIVE_WORDS.filter((w) => /\p{Script=Han}/u.test(w)).sort((a, b) => b.length - a.length);
const LATIN_WORDS = new Set(SENSITIVE_WORDS.filter((w) => !/\p{Script=Han}/u.test(w)));

/**
 * The dark words of a text as code-point ranges [from, to) (longest match first, the everyday
 * compounds of NOT_DARK left alone). Latin words match whole, case-insensitively.
 */
export function darkRanges(text: string): Array<[number, number]> {
  const chars = Array.from(toTraditional(String(text ?? "")));
  const out: Array<[number, number]> = [];
  const taken = new Uint8Array(chars.length);
  // the everyday compounds first: their characters are not dark
  const joined = chars.join("");
  const cpIndex = (utf16: number) => Array.from(joined.slice(0, utf16)).length;
  for (const w of NOT_DARK) {
    for (let at = joined.indexOf(w); at >= 0; at = joined.indexOf(w, at + 1)) {
      const a = cpIndex(at);
      for (let k = a; k < a + Array.from(w).length; k++) taken[k] = 2;
    }
  }
  for (const w of CJK_WORDS) {
    const n = Array.from(w).length;
    for (let at = joined.indexOf(w); at >= 0; at = joined.indexOf(w, at + 1)) {
      const a = cpIndex(at);
      let free = true;
      for (let k = a; k < a + n; k++) if (taken[k]) free = false;
      if (!free) continue;
      for (let k = a; k < a + n; k++) taken[k] = 1;
      out.push([a, a + n]);
    }
  }
  for (let i = 0; i < chars.length; ) {
    if (!/[A-Za-z]/.test(chars[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && /[A-Za-z]/.test(chars[j])) j++;
    if (LATIN_WORDS.has(chars.slice(i, j).join("").toLowerCase())) out.push([i, j]);
    i = j;
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** The text holds a dark word. */
export function hasDarkWord(text: string): boolean {
  return darkRanges(text).length > 0;
}

/** The dark words of a text, as written. */
export function darkWords(text: string): string[] {
  const chars = Array.from(String(text ?? ""));
  return darkRanges(text).map(([a, b]) => chars.slice(a, b).join(""));
}

/** `word` is or holds a dark word, or is part of one in `text` (the 血 of 血滴, the 殺 of 殺了我). */
export function touchesDark(word: string, text = word): boolean {
  const w = String(word ?? "").trim();
  if (!w) return false;
  if (hasDarkWord(w)) return true;
  const dark = darkWords(text);
  return dark.some((d) => d.includes(w) || w.includes(d));
}
