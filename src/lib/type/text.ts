// Text preparation for compositions: the line's units (tokenized, timed, emphasized), phrases,
// the key span a display recipe features, CJK typesetting rules (禁則 atoms, no orphan
// punctuation, vertical forms: rotated brackets and dashes, sideways Latin, upright short
// numbers) and a row / column breaker that balances rows by measured width.

import { DROP_AT_ROW_END, NO_LINE_END, NO_LINE_START, isCjkChar, type TextUnit } from "../stage/lyrics/tokenize";
import type { TimedUnit } from "../stage/lyrics/timing";
import type { FontRole, Measure } from "./model";

export interface LineText {
  text: string;
  units: TimedUnit[];
  /** per unit: part of an emphasized substring */
  emph: boolean[];
  /** mostly CJK (vertical recipes allowed) */
  cjk: boolean;
  /** no CJK character at all */
  latinOnly: boolean;
  /** unit ranges [from, to) between spaces and punctuation, trimmed */
  phrases: Array<[number, number]>;
  translation: string | null;
}

const isWordUnit = (u: TextUnit) => u.kind === "cjk" || u.kind === "latin";

export function lineText(text: string, units: TimedUnit[], emph: boolean[], translation: string | null = null): LineText {
  let cjk = 0;
  let latin = 0;
  for (const u of units) {
    if (u.kind === "cjk") cjk++;
    else if (u.kind === "latin") latin += Math.max(1, Math.round(u.text.length / 4));
  }
  const phrases: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const breaker = u.kind === "space" || (u.kind === "punct" && !NO_LINE_END.has(u.text) && !isClosingQuote(u.text));
    if (breaker) {
      if (start >= 0) phrases.push([start, i]);
      start = -1;
    } else if (start < 0) start = i;
  }
  if (start >= 0) phrases.push([start, units.length]);
  return { text, units, emph, cjk: cjk > 0 && cjk >= latin, latinOnly: cjk === 0, phrases: phrases.filter(([a, b]) => units.slice(a, b).some(isWordUnit)), translation };
}

function isClosingQuote(ch: string): boolean {
  return "」』）》〉】〕”’)]".includes(ch);
}

/** Characters that carry little meaning on their own (never the featured word). */
const FUNCTION_CHARS = new Set([..."的了著嗎呢吧啊呀喔哦嘛是在把就都也還和與跟及或而且但卻又很太最這那個們我你他她它自己一不沒有要會能可以被讓給向從到對為於之其此裡中來去過得地啦嗎吶哪誰什麼怎樣"]);
const LATIN_STOP = new Set(["the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "at", "for", "with", "my", "your", "i", "you", "me", "we", "it", "is", "are", "be", "so", "oh", "yeah"]);

function unitRangeOf(lt: LineText, needle: string): [number, number] | null {
  const n = needle.trim();
  if (!n) return null;
  const at = lt.text.indexOf(n);
  if (at < 0) return null;
  let from = -1;
  let to = -1;
  lt.units.forEach((u, i) => {
    if (u.to > at && u.from < at + n.length) {
      if (from < 0) from = i;
      to = i + 1;
    }
  });
  return from >= 0 ? [from, to] : null;
}

function cjkCount(lt: LineText, a: number, b: number): number {
  let n = 0;
  for (let i = a; i < b; i++) if (lt.units[i].kind === "cjk") n++;
  return n;
}

/** Trim a range to at most `max` CJK characters (keeping the start). */
function clipRange(lt: LineText, [a, b]: [number, number], max: number): [number, number] {
  let n = 0;
  for (let i = a; i < b; i++) {
    if (lt.units[i].kind === "cjk") n++;
    if (n > max) return [a, i];
  }
  return [a, b];
}

/**
 * The span a display recipe features (the giant / bled / window word): the first emphasized run,
 * else the motion word, else the most meaningful short word of the line (for CJK the best two
 * characters near the end of the longest phrase, for Latin the longest content word). Null for
 * an empty line.
 */
export function keySpan(lt: LineText, motionWord: string, maxCjk = 4): [number, number] | null {
  const units = lt.units;
  // 1. an emphasized run
  for (let i = 0; i < units.length; i++) {
    if (!lt.emph[i] || !isWordUnit(units[i])) continue;
    let j = i;
    while (j < units.length && lt.emph[j] && units[j].kind !== "space") j++;
    return clipRange(lt, [i, j], maxCjk);
  }
  // 2. the motion word
  const mw = unitRangeOf(lt, motionWord);
  if (mw && cjkCount(lt, mw[0], mw[1]) <= maxCjk) return mw;
  if (!lt.phrases.length) return null;
  // 3. Latin: the longest content word
  if (lt.latinOnly) {
    let best = -1;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.kind !== "latin" || LATIN_STOP.has(u.text.toLowerCase())) continue;
      if (best < 0 || u.text.length > units[best].text.length) best = i;
    }
    if (best < 0) best = units.findIndex((u) => u.kind === "latin");
    return best >= 0 ? [best, best + 1] : null;
  }
  // 4. CJK: a short line is its own key; else the best 2-character window
  const total = cjkCount(lt, 0, units.length);
  if (total <= 2) {
    const [a] = lt.phrases[0];
    const [, b] = lt.phrases[lt.phrases.length - 1];
    return clipRange(lt, [a, b], maxCjk);
  }
  let best: { a: number; b: number; score: number } | null = null;
  lt.phrases.forEach(([pa, pb], pi) => {
    const len = cjkCount(lt, pa, pb);
    for (let i = pa; i < pb - 1; i++) {
      const u0 = units[i];
      const u1 = units[i + 1];
      if (u0.kind !== "cjk" || u1.kind !== "cjk") continue;
      let score = 0;
      if (FUNCTION_CHARS.has(u0.text)) score -= 2.2;
      if (FUNCTION_CHARS.has(u1.text)) score -= 2.2;
      if (i + 2 === pb) score += 1.4; // phrase-final nouns carry the image (城市的「邊緣」)
      score += 0.35 * (pi / Math.max(1, lt.phrases.length - 1)); // later phrases a little
      score += 0.12 * len; // in a longer phrase
      if (!best || score > best.score) best = { a: i, b: i + 2, score };
    }
  });
  if (best) return [(best as { a: number }).a, (best as { b: number }).b];
  const first = units.findIndex((u) => u.kind === "cjk");
  return first >= 0 ? [first, first + 1] : null;
}

// ---------------------------------------------------------------------------
// vertical forms
// ---------------------------------------------------------------------------

/** Punctuation set rotated 90° in vertical text (brackets, dashes, ellipses, colons, tildes). */
export const ROTATE_IN_VERTICAL = new Set([..."「」『』（）()《》〈〉【】〔〕｛｝［］[]{}—─–―…‥～~：；:;-_|/＿"]);

export interface VerticalForm {
  /** radians to rotate the glyph (π/2 = sideways, clockwise) */
  rotate: number;
  /** sideways runs advance by their width; upright glyphs by the em */
  sideways: boolean;
}

/**
 * How a unit sits in a vertical column: CJK and fullwidth punctuation upright (Taiwan-standard
 * ，。、 are centred, so they need no vertical forms), brackets / dashes / ellipses rotated,
 * Latin words sideways, numbers of one or two digits upright (縱中橫).
 */
export function verticalForm(u: TextUnit): VerticalForm {
  if (u.kind === "cjk") return { rotate: 0, sideways: false };
  if (u.kind === "latin") return /^\d{1,2}$/.test(u.text) ? { rotate: 0, sideways: false } : { rotate: Math.PI / 2, sideways: true };
  if (u.kind === "punct") {
    if (ROTATE_IN_VERTICAL.has(u.text)) return { rotate: Math.PI / 2, sideways: false };
    const code = u.text.codePointAt(0) ?? 0;
    const fullwidth = (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef) || code === 0x2026;
    return fullwidth || u.text === "!" || u.text === "?" ? { rotate: 0, sideways: false } : { rotate: Math.PI / 2, sideways: true };
  }
  return { rotate: 0, sideways: false };
}

// ---------------------------------------------------------------------------
// measuring
// ---------------------------------------------------------------------------

/** Approximate advances (ems) for tests and before fonts load: CJK 1, Latin by letter class. */
export const approxMeasure: Measure = (text: string, font: FontRole) => {
  let w = 0;
  for (const ch of text) {
    if (isCjkChar(ch)) w += 1;
    else if (/\s/.test(ch)) w += 0.28;
    else {
      const code = ch.codePointAt(0) ?? 0;
      if ((code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef) || code === 0x2026 || code === 0x2014) w += 1;
      else if (/[A-Z0-9MW@]/.test(ch)) w += font === "latin" ? 0.62 : 0.64;
      else if (/[iljtf'’.,:;!|]/.test(ch)) w += 0.28;
      else w += 0.52;
    }
  }
  return w;
};

/** Advance (ems) of one unit in a horizontal row (tracking not included). */
export function unitAdvance(u: TextUnit, measure: Measure, weight: number): number {
  if (u.kind === "cjk") return 1;
  if (u.kind === "space") return 0.3;
  if (u.kind === "punct") {
    const code = u.text.codePointAt(0) ?? 0;
    const fullwidth = (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef) || code === 0x2026 || code === 0x2014;
    return fullwidth ? 1 : measure(u.text, "latin", weight);
  }
  return measure(u.text, "latin", weight);
}

/** Advance (ems) of one unit down a vertical column. */
export function unitColumnAdvance(u: TextUnit, measure: Measure, weight: number): number {
  const f = verticalForm(u);
  if (u.kind === "space") return 0.35;
  if (f.sideways) return unitAdvance(u, measure, weight);
  return 1;
}

// ---------------------------------------------------------------------------
// breaking rows and columns (禁則, balance, no orphans)
// ---------------------------------------------------------------------------

/** Unbreakable groups of unit indices: opening punctuation glued forward, closing glued back. */
export function atomsOf(units: readonly TextUnit[], from: number, to: number): number[][] {
  const atoms: number[][] = [];
  let pending: number[] = [];
  for (let i = from; i < to; i++) {
    const u = units[i];
    if (u.kind === "punct" && NO_LINE_END.has(u.text)) {
      pending.push(i);
      continue;
    }
    const glue = atoms.length > 0 && pending.length === 0 && u.kind === "punct" && (NO_LINE_START.has(u.text) || units[i - 1]?.text === u.text);
    if (glue) {
      atoms[atoms.length - 1].push(i);
      continue;
    }
    atoms.push([...pending, i]);
    pending = [];
  }
  if (pending.length) {
    if (atoms.length) atoms[atoms.length - 1].push(...pending);
    else atoms.push(pending);
  }
  return atoms;
}

/** Row units without leading / trailing spaces and without soft punctuation at the end (行尾不放「、，。」). */
export function trimIndices(units: readonly TextUnit[], idx: number[]): number[] {
  let a = 0;
  let b = idx.length;
  while (a < b && units[idx[a]].kind === "space") a++;
  for (;;) {
    while (b > a && units[idx[b - 1]].kind === "space") b--;
    if (b > a && units[idx[b - 1]].kind === "punct" && DROP_AT_ROW_END.has(units[idx[b - 1]].text)) {
      b--;
      continue;
    }
    break;
  }
  return idx.slice(a, b);
}

export interface BreakOptions {
  /** max advance per row / column, in ems (tracking included by the caller's width function) */
  max: number;
  maxRows: number;
  /** width of a list of unit indices in ems */
  width: (idx: number[]) => number;
  /** prefer an uneven split with a lighter first row (下重上輕) */
  pyramid?: boolean;
}

/**
 * Break units [from, to) into at most `maxRows` rows of at most `max` ems, balanced, never
 * starting a row with closing punctuation or ending one with opening punctuation, never inside a
 * Latin word, preferring breaks at spaces and punctuation, avoiding one-character rows. Rows are
 * trimmed. When nothing fits, the best split into `maxRows` rows is returned (the caller
 * shrinks). Deterministic dynamic programming over the atoms.
 */
export function breakRows(units: readonly TextUnit[], from: number, to: number, o: BreakOptions): number[][] {
  const all: number[] = [];
  for (let i = from; i < to; i++) all.push(i);
  const whole = trimIndices(units, all);
  if (!whole.length) return [];
  if (o.maxRows <= 1 || o.width(whole) <= o.max) return [whole];
  const atoms = atomsOf(units, from, to);
  const n = atoms.length;
  if (n < 2) return [whole];
  const rowOf = (a: number, b: number) => trimIndices(units, atoms.slice(a, b).flat());
  const breakPenalty = (k: number) => {
    // between atom k-1 and k
    const before = units[atoms[k - 1][atoms[k - 1].length - 1]];
    const after = units[atoms[k][0]];
    if (before.kind === "space" || after.kind === "space") return -2.4;
    if (before.kind === "punct") return -2;
    if ((before.kind === "latin") !== (after.kind === "latin")) return -0.8;
    return 0.6;
  };
  const cjkIn = (idx: number[]) => idx.filter((i) => units[i].kind === "cjk" || units[i].kind === "latin").length;
  let best: { cost: number; rows: number[][] } | null = null;
  for (let rows = 2; rows <= Math.min(o.maxRows, n); rows++) {
    // dp[r][k]: best cost of splitting atoms[0..k) into r rows
    const INF = Number.POSITIVE_INFINITY;
    const dp: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(n + 1).fill(INF));
    const back: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(n + 1).fill(-1));
    dp[0][0] = 0;
    const target = o.width(whole) / rows;
    for (let r = 1; r <= rows; r++) {
      for (let k = r; k <= n; k++) {
        for (let j = r - 1; j < k; j++) {
          if (dp[r - 1][j] === INF) continue;
          const row = rowOf(j, k);
          if (!row.length) continue;
          const w = o.width(row);
          let cost = dp[r - 1][j];
          const over = Math.max(0, w - o.max);
          cost += over * over * 40 + over * 20;
          const aim = o.pyramid && r === 1 && rows > 1 ? target * 0.9 : target;
          cost += ((w - aim) / Math.max(1, o.max)) ** 2 * 6;
          if (cjkIn(row) < 2 && cjkIn(whole) > 3) cost += 7; // an orphan row
          if (j > 0) cost += breakPenalty(j);
          if (cost < dp[r][k]) {
            dp[r][k] = cost;
            back[r][k] = j;
          }
        }
      }
    }
    if (dp[rows][n] === INF) continue;
    const splits: number[][] = [];
    let k = n;
    for (let r = rows; r >= 1; r--) {
      const j = back[r][k];
      splits.unshift(rowOf(j, k));
      k = j;
    }
    const fits = splits.every((row) => o.width(row) <= o.max + 1e-6);
    // fewer rows are better when they fit; a split that overflows only wins when nothing fits
    const scored = dp[rows][n] + (rows - 2) * 2.5 + (fits ? 0 : 1000);
    if (!best || scored < best.cost) best = { cost: scored, rows: splits.filter((r) => r.length) };
  }
  return best ? best.rows : [whole];
}
