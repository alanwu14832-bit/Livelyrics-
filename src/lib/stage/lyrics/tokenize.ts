// Splits a lyric line into display/timing units:
//   - every CJK character (Han, kana, Hangul, Bopomofo) is its own unit,
//   - a run of Latin letters/digits (incl. apostrophes, hyphens, diacritics — covers
//     English and Tâi-lô romanization) is one unit,
//   - each punctuation mark is a unit,
//   - a whitespace run is one "space" unit.
// Offsets are UTF-16 indices into the source string so they line up with String#indexOf.

export type UnitKind = "cjk" | "latin" | "punct" | "space";

export interface TextUnit {
  text: string;
  kind: UnitKind;
  /** UTF-16 start offset in the source text */
  from: number;
  /** UTF-16 end offset (exclusive) */
  to: number;
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}々〆〻ーｰ]/u;
const WORD_RE = /[\p{L}\p{N}\p{M}]/u;
const WORD_JOINERS = new Set(["'", "’", "-", "‐"]);
const SPACE_RE = /\s/u;

export function isCjkChar(ch: string): boolean {
  return CJK_RE.test(ch);
}

export function tokenizeLyric(text: string): TextUnit[] {
  const units: TextUnit[] = [];
  const chars: Array<{ ch: string; at: number }> = [];
  let offset = 0;
  for (const ch of text) {
    chars.push({ ch, at: offset });
    offset += ch.length;
  }

  let i = 0;
  while (i < chars.length) {
    const { ch, at } = chars[i];
    if (SPACE_RE.test(ch)) {
      let j = i + 1;
      while (j < chars.length && SPACE_RE.test(chars[j].ch)) j++;
      const to = j < chars.length ? chars[j].at : text.length;
      units.push({ text: " ", kind: "space", from: at, to });
      i = j;
      continue;
    }
    if (isCjkChar(ch)) {
      units.push({ text: ch, kind: "cjk", from: at, to: at + ch.length });
      i++;
      continue;
    }
    if (WORD_RE.test(ch)) {
      let j = i + 1;
      while (j < chars.length) {
        const c = chars[j].ch;
        if (isCjkChar(c)) break;
        if (WORD_RE.test(c)) {
          j++;
          continue;
        }
        // apostrophes / hyphens only join when a letter follows (don't / tsa-bóo)
        if (WORD_JOINERS.has(c) && j + 1 < chars.length && WORD_RE.test(chars[j + 1].ch) && !isCjkChar(chars[j + 1].ch)) {
          j += 2;
          continue;
        }
        break;
      }
      const to = j < chars.length ? chars[j].at : text.length;
      units.push({ text: text.slice(at, to), kind: "latin", from: at, to });
      i = j;
      continue;
    }
    units.push({ text: ch, kind: "punct", from: at, to: at + ch.length });
    i++;
  }
  return units;
}

/** Punctuation that must never start a display row (避頭). */
export const NO_LINE_START = new Set([
  ..."，。、！？；：）」』】〉》〕］｝”’…‥・·ー～〜％,.!?;:)]}%",
]);

/** Punctuation that must never end a display row (避尾). */
export const NO_LINE_END = new Set([..."（「『【〈《〔［｛“‘([{"]);

/** Soft punctuation dropped at the end of a display row (行尾不放「、，。」). */
export const DROP_AT_ROW_END = new Set([..."，、。,.;；：:"]);

/** Approximate advance width in "CJK em" units, used for balancing rows. */
export function unitWidth(u: TextUnit): number {
  switch (u.kind) {
    case "cjk":
      return 1;
    case "space":
      return 0.3;
    case "punct": {
      const code = u.text.codePointAt(0) ?? 0;
      const fullWidth = (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef) || code === 0x2026 || code === 0x2014;
      return fullWidth ? 1 : 0.35;
    }
    case "latin": {
      let w = 0;
      for (const ch of u.text) w += /[A-Z0-9MW@]/.test(ch) ? 0.64 : /[iljtf'’.,]/.test(ch) ? 0.3 : 0.52;
      return w;
    }
  }
}

export function textWidth(units: TextUnit[]): number {
  let w = 0;
  for (const u of units) w += unitWidth(u);
  return w;
}
