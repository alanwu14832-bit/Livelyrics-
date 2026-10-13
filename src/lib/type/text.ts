// Text preparation for compositions: the line's units (tokenized, timed, emphasized), phrases,
// the key span a display recipe features, CJK typesetting rules (禁則 atoms, no orphan
// punctuation, vertical forms: rotated brackets and dashes, sideways Latin, upright short
// numbers) and a row / column breaker that balances rows by measured width.

import { DROP_AT_ROW_END, NO_LINE_END, NO_LINE_START, isCjkChar, tokenizeLyric, type TextUnit } from "../stage/lyrics/tokenize";
import type { TimedUnit } from "../stage/lyrics/timing";
import type { FontRole, Measure } from "./model";
import { darkRanges } from "./sensitive";

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
  /** units that begin a word of the line's word timing (empty without word timing): rows break there */
  wordStarts: ReadonlySet<number>;
  translation: string | null;
  /** per unit: part of a dark word (blood, a weapon, death…): never the featured word (round 17) */
  dark: boolean[];
}

/** Per unit: inside one of the text's dark words (sensitive.ts). */
export function darkUnits(text: string, units: readonly TextUnit[]): boolean[] {
  const ranges = darkRanges(text);
  if (!ranges.length) return units.map(() => false);
  // code points → UTF-16 offsets (the units' from / to)
  const offs: number[] = [0];
  for (const ch of text) offs.push(offs[offs.length - 1] + ch.length);
  const spans = ranges.map(([a, b]) => [offs[a] ?? 0, offs[b] ?? text.length] as const);
  return units.map((u) => spans.some(([a, b]) => u.from < b && u.to > a));
}

const isWordUnit = (u: TextUnit) => u.kind === "cjk" || u.kind === "latin";

/** The units that begin a word of `words` (the lyric's word timing), matched in order in `text`. */
export function wordStartsOf(text: string, units: readonly TextUnit[], words: ReadonlyArray<{ text: string }> | undefined): Set<number> {
  const out = new Set<number>();
  if (!words?.length) return out;
  let cursor = 0;
  for (const w of words) {
    const t = (w?.text ?? "").trim();
    if (!t) continue;
    const at = text.indexOf(t, cursor);
    if (at < 0) continue;
    cursor = at + t.length;
    const i = units.findIndex((u) => u.from >= at && u.kind !== "space");
    if (i > 0) out.add(i);
  }
  return out;
}

export function lineText(text: string, units: TimedUnit[], emph: boolean[], translation: string | null = null, wordStarts: ReadonlySet<number> = new Set()): LineText {
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
  return { text, units, emph, cjk: cjk > 0 && cjk >= latin, latinOnly: cjk === 0, phrases: phrases.filter(([a, b]) => units.slice(a, b).some(isWordUnit)), wordStarts, translation, dark: darkUnits(text, units) };
}

function isClosingQuote(ch: string): boolean {
  return "」』）》〉】〕”’)]".includes(ch);
}

/** Particles that lean on the word before them: a row never starts with one (「城市 / 的邊緣」). */
const ATTACH_LEFT = new Set([..."的了著嗎呢吧啊呀喔哦嘛們得地啦吶"]);

/**
 * Common two-character words of lyrics (a line without word timing): a row never breaks inside
 * one, and a content word among them may be featured though it holds a function character (方向).
 */
const LEXICON = new Set(
  (
    "世界 時間 未來 夢想 自由 青春 城市 天空 方向 故事 回憶 眼淚 黑夜 夜晚 晚上 夜色 明天 昨天 今天 永遠 一起 離開 想念 喜歡 孤單 寂寞 溫柔 名字 心跳 天亮 " +
    "邊緣 誓言 點燃 等待 聲音 歌聲 聽見 看見 遇見 相信 希望 勇氣 快樂 悲傷 眼睛 雙手 身體 靈魂 生命 愛情 記憶 距離 地方 遠方 海洋 大海 星星 月亮 太陽 " +
    "陽光 雨水 風雨 春天 夏天 秋天 冬天 早晨 黃昏 凌晨 午夜 房間 街道 路口 車站 窗外 屋頂 燈火 煙火 火花 宇宙 銀河 夢境 現實 真相 謊言 秘密 答案 問題 " +
    "理由 意義 朋友 家人 情人 陌生 少年 少女 孩子 大人 時代 世代 焦慮 憤怒 吶喊 呼吸 心臟 胸口 淚水 微笑 擁抱 告別 再見 回家 流浪 旅行 奔跑 飛翔 墜落 " +
    "燃燒 發光 閃耀 沉默 安靜 喧囂 孤獨 瘋狂 清醒 迷失 尋找 找到 放手 抓住 忘記 記得 原諒 後悔 承諾 盡頭 開始 結束 最後 最初 從前 以後 現在 此刻 瞬間 " +
    "一生 交給 寫進 直到 就算 如果 雖然 但是 因為 所以 還是 已經 終於 突然 可是 然後 只是 就是 還有 不是 沒有 可以 應該 慢慢 輕輕 靜靜 深深 大聲 這個 那個 " +
    "每一 我們 你們 他們 她們 自己 大家 一下 一點 一個 一次 一樣 一直 起來 下去 出來 回來 過去 不要 不會 不能 不再 " +
    // compounds with a bound character: 之間／時間, 開往／前往 (a row never breaks before 間 or 往 here)
    "之間 之中 之後 之前 之外 之上 之下 時間 空間 人間 世間 中間 夜間 瞬間 房間 開往 前往 通往 飛往 駛往 去往 嚮往 以往 往事 " +
    "巴士 潮汐 霓虹 公路 海邊 海岸 岸邊 海浪 浪花 沙灘 月光 星光 燈光 街燈 路燈 車窗 夜行 雨夜 下雨 大雨 雨傘 月台 車廂 列車 火車 公車 電車 " +
    "耳機 螢幕 訊號 噪音 天際 光線 影子 黎明 日落 日出 夕陽 霧氣 石碑 紀念 失去 沉睡 醒來 燈塔 遠處 深處 身邊 心裡 夢裡 風中 雨中 光芒"
  ).split(" "),
);
/** Characters bound to both neighbours (潮汐「之」間, 夢想之城): a row never breaks on either side. */
const BOUND = new Set([..."之"]);

/** Length of the run of CJK units through index `i`, going backwards (dir −1) or forwards (+1). */
function cjkRun(units: readonly TextUnit[], i: number, dir: 1 | -1): number {
  let n = 0;
  for (let k = i; k >= 0 && k < units.length && units[k].kind === "cjk"; k += dir) n++;
  return n;
}

// Round 17: the browser's own word segmenter (Intl.Segmenter, ICU's dictionary — built into Node and
// Chromium, not a dependency) finds the words LEXICON does not list (睡著了, 其實, 血滴, 數著): a row,
// a phrase cut or a featured word never falls inside one. Without Intl.Segmenter nothing changes.
type WordSegmenter = { segment(text: string): Iterable<{ index: number; segment: string; isWordLike?: boolean }> };
let segmenter: WordSegmenter | null | undefined;
function wordSegmenter(): WordSegmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    const Seg = (Intl as unknown as { Segmenter?: new (locale: string, o: { granularity: "word" }) => WordSegmenter }).Segmenter;
    segmenter = Seg ? new Seg("zh-Hant", { granularity: "word" }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/** Adverbs and negators that lean on the next word (不, 再, 都…): an ICU word ending on one is not trusted. */
const LEAN_RIGHT = new Set([..."不再都也就還很最太又才"]);

const icuCache = new WeakMap<readonly TextUnit[], { inside: Uint8Array; words: Array<[number, number]> }>();

/**
 * The ICU words of a unit list: `inside[i]` = 1 when the boundary between units i and i + 1 lies
 * inside a word (both CJK); `words` = unit ranges [from, to) of the multi-character CJK words.
 */
export function icuWords(units: readonly TextUnit[]): { inside: Uint8Array; words: Array<[number, number]> } {
  const hit = icuCache.get(units);
  if (hit) return hit;
  const inside = new Uint8Array(Math.max(0, units.length));
  const words: Array<[number, number]> = [];
  const seg = wordSegmenter();
  if (seg && units.length > 1) {
    // the source text as the units saw it (offsets kept)
    const end = units.reduce((m, u) => Math.max(m, u.to), 0);
    const chars = new Array<string>(end).fill(" ");
    for (const u of units) for (let k = 0; k < u.text.length && u.from + k < end; k++) chars[u.from + k] = u.text[k];
    const text = chars.join("");
    const unitAt = new Int32Array(end + 1).fill(-1);
    units.forEach((u, i) => {
      unitAt[u.from] = i;
    });
    for (const sg of seg.segment(text)) {
      const a = sg.index;
      const b = a + sg.segment.length;
      const ua = unitAt[a];
      if (ua < 0) continue;
      let ub = ua;
      while (ub + 1 < units.length && units[ub + 1].from < b) ub++;
      // ICU joins a leaning adverb or a trailing particle into odd pairs (「我不｜想再｜醒來」): those
      // edges stay breakable (the particles have their own rule, ATTACH_LEFT)
      if (ub > ua && units.slice(ua, ub + 1).every((u) => u.kind === "cjk") && !LEAN_RIGHT.has(units[ub].text) && !ATTACH_LEFT.has(units[ua].text)) {
        for (let k = ua; k < ub; k++) inside[k] = 1;
        words.push([ua, ub + 1]);
      }
    }
  }
  const out = { inside, words };
  icuCache.set(units, out);
  return out;
}

/** Breaking between units i and i + 1 would split a word (a known compound, a bound character, an ICU word). */
export function splitsWord(units: readonly TextUnit[], i: number): boolean {
  const a = units[i];
  const b = units[i + 1];
  if (!a || !b || a.kind !== "cjk" || b.kind !== "cjk") return false;
  if (BOUND.has(a.text) || BOUND.has(b.text)) return true;
  if (LEXICON.has(a.text + b.text)) return true;
  return icuWords(units).inside[i] === 1;
}

/** Latin words a row (or a phrase of a long line) never ends on: 「light hums a / song it」. */
const LATIN_NO_END = new Set(["a", "an", "the", "and", "or", "of", "to", "it", "in", "on", "at", "for", "with", "my", "your", "our"]);

/** The row would end on a Latin function word (the last word unit at or before `i`, spaces skipped). */
export function endsOnFunctionWord(units: readonly TextUnit[], i: number): boolean {
  let j = i;
  while (j >= 0 && units[j].kind === "space") j--;
  const u = units[j];
  return !!u && u.kind === "latin" && LATIN_NO_END.has(u.text.toLowerCase());
}

/** Breaking between units i and i + 1 would leave a one-character fragment of a run (夜行巴士 開｜往海). */
export function leavesFragment(units: readonly TextUnit[], i: number): boolean {
  const a = units[i];
  const b = units[i + 1];
  if (!a || !b || a.kind !== "cjk" || b.kind !== "cjk") return false;
  return cjkRun(units, i, -1) === 1 || cjkRun(units, i + 1, 1) === 1;
}
/** Words that never become the featured word (conjunctions, adverbs, pronouns, measure words). */
const NOT_KEY = new Set(
  "直到 就算 如果 雖然 但是 因為 所以 還是 已經 終於 突然 可是 然後 只是 就是 還有 不是 沒有 可以 應該 慢慢 輕輕 靜靜 深深 這個 那個 每一 我們 你們 他們 她們 自己 大家 一下 一點 一個 一次 一樣 一直 起來 下去 出來 回來 過去 不要 不會 不能 不再".split(" "),
);
/** A row may well start with these (a demonstrative opens a noun phrase: 交給 /「這個晚上」). */
const BREAK_BEFORE = new Set([..."這那每"]);

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

/** A range grown to the ICU / lexicon word it cuts into at either edge (when the whole stays within `max` CJK). */
function wholeWord(lt: LineText, [a, b]: [number, number], max: number): [number, number] {
  const units = lt.units;
  let x = a;
  let y = b;
  while (x > 0 && splitsWord(units, x - 1)) x--;
  while (y < units.length && splitsWord(units, y - 1)) y++;
  return cjkCount(lt, x, y) <= max + 1 ? [x, y] : [a, b];
}

function cjkCount(lt: LineText, a: number, b: number): number {
  let n = 0;
  for (let i = a; i < b; i++) if (lt.units[i].kind === "cjk") n++;
  return n;
}

/** Trim a range to at most `max` CJK characters (keeping the start). */
function clipRange(lt: LineText, [a, b]: [number, number], max: number): [number, number] {
  const units = lt.units;
  const total = cjkCount(lt, a, b);
  if (total <= max) return [a, b];
  // a word one character over the limit stays whole (潮汐之間 is the featured word, not 潮汐之)
  const spaced = units.slice(a, b).some((u) => u.kind !== "cjk");
  if (!spaced && total <= max + 1) return [a, b];
  // else the longest start of at most `max` characters that ends between words
  let n = 0;
  let cut = -1;
  let hard = -1;
  for (let i = a; i < b; i++) {
    if (units[i].kind === "cjk") n++;
    if (n > max) break;
    hard = i + 1;
    if (i + 1 < b && !splitsWord(units, i) && !(n === 1 && units[i + 1]?.kind === "cjk")) cut = i + 1;
  }
  if (cut > a) return [a, cut];
  return [a, hard > a ? hard : a + 1];
}

/**
 * The span a display recipe features (the giant / bled / window word): the first emphasized run,
 * else the motion word, else the most meaningful short word of the line (for CJK the best two
 * characters near the end of the longest phrase, for Latin the longest content word). Null for
 * an empty line.
 */
export function keySpan(lt: LineText, motionWord: string, maxCjk = 4): [number, number] | null {
  const units = lt.units;
  // round 17: a dark word (blood, a weapon, death…) is never the featured word
  const dark = lt.dark ?? [];
  const darkIn = (a: number, b: number) => dark.slice(a, b).some(Boolean);
  // 1. an emphasized run
  for (let i = 0; i < units.length; i++) {
    if (!lt.emph[i] || !isWordUnit(units[i])) continue;
    let j = i;
    while (j < units.length && lt.emph[j] && units[j].kind !== "space") j++;
    // (grown to the whole word it cuts into: an emphasized 「醒」 of 醒來 features 醒來)
    const g = wholeWord(lt, [i, j], maxCjk);
    if (darkIn(g[0], g[1])) {
      i = j;
      continue;
    }
    return clipRange(lt, g, maxCjk);
  }
  // 2. the motion word (grown to the whole word it is part of: 「醒」 of 醒來 is 醒來)
  const mw0 = unitRangeOf(lt, motionWord);
  const mw = mw0 ? wholeWord(lt, mw0, maxCjk) : null;
  if (mw && cjkCount(lt, mw[0], mw[1]) <= maxCjk && !darkIn(mw[0], mw[1])) return mw;
  if (!lt.phrases.length) return null;
  // 3. Latin: the longest content word
  if (lt.latinOnly) {
    let best = -1;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.kind !== "latin" || LATIN_STOP.has(u.text.toLowerCase()) || dark[i]) continue;
      if (best < 0 || u.text.length > units[best].text.length) best = i;
    }
    if (best < 0) best = units.findIndex((u, i) => u.kind === "latin" && !dark[i]);
    return best >= 0 ? [best, best + 1] : null;
  }
  // 4. CJK: a short line is its own key; a line that repeats one phrase (「我不要 我不要」, 「殺了我
  // 殺了我」) features that phrase whole; else the best 2-character window
  const total = cjkCount(lt, 0, units.length);
  if (lt.phrases.length >= 2) {
    const texts = lt.phrases.map(([a, b]) => units.slice(a, b).map((u) => u.text).join(""));
    const [la, lb] = lt.phrases[lt.phrases.length - 1];
    if (texts.every((t) => t === texts[0]) && cjkCount(lt, la, lb) <= maxCjk && cjkCount(lt, la, lb) === lb - la && !darkIn(la, lb)) return [la, lb];
  }
  if (total <= 2) {
    const [a] = lt.phrases[0];
    const [, b] = lt.phrases[lt.phrases.length - 1];
    return darkIn(a, b) ? null : clipRange(lt, [a, b], maxCjk);
  }
  let best: { a: number; b: number; score: number } | null = null;
  let clean = false;
  let single: { a: number; b: number; score: number } | null = null;
  const words = lt.wordStarts;
  const wordEdge = (i: number, pa: number, pb: number) => i === pa || i === pb || words.has(i);
  lt.phrases.forEach(([pa, pb], pi) => {
    const len = cjkCount(lt, pa, pb);
    const place = 0.35 * (pi / Math.max(1, lt.phrases.length - 1)) + 0.12 * len; // later, longer phrases a little
    for (let i = pa; i < pb - 1; i++) {
      const u0 = units[i];
      const u1 = units[i + 1];
      if (u0.kind !== "cjk" || u1.kind !== "cjk" || dark[i] || dark[i + 1]) continue;
      let score = place;
      const pair = u0.text + u1.text;
      const known = LEXICON.has(pair) && !NOT_KEY.has(pair);
      const f0 = FUNCTION_CHARS.has(u0.text) && !known;
      const f1 = FUNCTION_CHARS.has(u1.text) && !known;
      if (f0) score -= 2.2;
      if (f1) score -= 2.2;
      if (NOT_KEY.has(pair)) score -= 3;
      else if (known) score += 0.4;
      if (!f0 && !f1 && !NOT_KEY.has(pair)) clean = true;
      if (i + 2 === pb) score += 1.4; // phrase-final nouns carry the image (城市的「邊緣」)
      // never half of a compound (開「往海」, 潮汐「之間」 cut from its 潮汐)
      if (i > pa && splitsWord(units, i - 1)) score -= 2.5;
      if (i + 2 < pb && splitsWord(units, i + 1)) score -= 2.5;
      // round 17: never a one-character fragment of the phrase left behind (「我不要 我」+「不要」)
      if (i - pa === 1 || pb - (i + 2) === 1) score -= 1.6;
      if (BOUND.has(u0.text) || BOUND.has(u1.text)) score -= 2.5;
      // with word timing: a whole word beats two halves of two words
      if (words.size) score += wordEdge(i, pa, pb) && wordEdge(i + 2, pa, pb) ? 0.9 : words.has(i + 1) ? -0.9 : 0;
      if (!best || score > best.score) best = { a: i, b: i + 2, score };
    }
    // a short phrase whole (「我不要」), when every pair of it would leave a fragment behind
    const plen = pb - pa;
    if (len === plen && len >= 3 && len <= maxCjk && !darkIn(pa, pb) && !(FUNCTION_CHARS.has(units[pa].text) && FUNCTION_CHARS.has(units[pb - 1].text))) {
      const icu = icuWords(units).words.some(([a, b]) => a >= pa && b <= pb);
      const score = place + 0.6 + (icu ? 0.3 : 0);
      if (!best || score > best.score) best = { a: pa, b: pb, score };
      clean = true;
    }
    // one strong character (跟著我「唱」), for a line whose every pair leans on a function word
    for (let i = pa; i < pb; i++) {
      const u = units[i];
      if (u.kind !== "cjk" || FUNCTION_CHARS.has(u.text) || dark[i]) continue;
      let score = place + (i + 1 === pb ? 0.8 : 0);
      if (words.size && wordEdge(i, pa, pb) && wordEdge(i + 1, pa, pb)) score += 0.6;
      if (!single || score > single.score) single = { a: i, b: i + 1, score };
    }
  });
  if (!clean && single) best = single;
  if (best) return [(best as { a: number }).a, (best as { b: number }).b];
  const first = units.findIndex((u, i) => u.kind === "cjk" && !dark[i]);
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
  // a row (or a part of the line) never opens with a space or a soft mark (「再遠」｜「，我們的歌」)
  while (a < b && (units[idx[a]].kind === "space" || (units[idx[a]].kind === "punct" && DROP_AT_ROW_END.has(units[idx[a]].text)))) a++;
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
  /** units that begin a word (the line's word timing): breaks prefer them, and avoid the inside of a word */
  wordStarts?: ReadonlySet<number>;
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
    // round 17: a row never ends on 「a」「the」「and」「of」「to」「it」「in」「my」…
    if (endsOnFunctionWord(units, atoms[k - 1][atoms[k - 1].length - 1])) return 300;
    if (before.kind === "space" || after.kind === "space") return -2.4;
    if (before.kind === "punct") return -2;
    if ((before.kind === "latin") !== (after.kind === "latin")) return -0.8;
    // a known word or a bound character stays whole (潮汐之間, 開往, 睡著了) whatever the word timing
    // says (it may be per character), a particle stays with the word it follows
    // (both cost more than an overflowing row: the caller then sets the type a little smaller)
    const at = atoms[k - 1][atoms[k - 1].length - 1];
    if (splitsWord(units, at)) return 2000;
    if (after.kind === "cjk" && ATTACH_LEFT.has(after.text)) return 4.5;
    // a one-character fragment of a phrase is left behind (夜行巴士 開｜往海的方向)
    const frag = leavesFragment(units, at) ? 60 : 0;
    const ws = o.wordStarts;
    if (ws && ws.size) return (ws.has(atoms[k][0]) ? -1.3 : 4.5) + frag;
    if (before.kind === "cjk" && after.kind === "cjk" && BREAK_BEFORE.has(after.text)) return -0.6 + frag;
    return 0.6 + frag;
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
    let torn = false;
    for (let r = rows; r >= 1; r--) {
      const j = back[r][k];
      splits.unshift(rowOf(j, k));
      if (j > 0) {
        const at = atoms[j - 1][atoms[j - 1].length - 1];
        if (splitsWord(units, at) || leavesFragment(units, at)) torn = true;
      }
      k = j;
    }
    const fits = splits.every((row) => o.width(row) <= o.max + 1e-6);
    // fewer rows are better when they fit; a split that overflows (or tears a word) only wins when
    // nothing fits cleanly — between those, a slightly overflowing row beats a torn word
    const scored = dp[rows][n] + (rows - 2) * 2.5 + (fits && !torn ? 0 : 1000);
    if (!best || scored < best.cost) best = { cost: scored, rows: splits.filter((r) => r.length) };
  }
  return best ? best.rows : [whole];
}

// ---------------------------------------------------------------------------
// line length (B4): long lines are set as two staggered phrases
// ---------------------------------------------------------------------------

/** A line with more CJK characters than this is long (industry practice: ~16 per row, two rows at most). */
export const LONG_LINE_CJK = 14;
/** …or more Latin letters than this (about seven words). */
export const LONG_LINE_LATIN = 40;

/** How much text a line carries: CJK characters and Latin letters (spaces and marks not counted). */
export function lineLoad(units: readonly TextUnit[]): { cjk: number; latin: number } {
  let cjk = 0;
  let latin = 0;
  for (const u of units) {
    if (u.kind === "cjk") cjk++;
    else if (u.kind === "latin") latin += [...u.text].length;
  }
  return { cjk, latin };
}

/** The line-length policy: a line this long is split into two phrases (`splitLongLine`). */
export function isLongUnits(units: readonly TextUnit[]): boolean {
  const { cjk, latin } = lineLoad(units);
  return cjk > LONG_LINE_CJK || latin > LONG_LINE_LATIN || cjk + latin / 2.6 > LONG_LINE_CJK;
}

/** `isLongUnits` on raw text (the lyrics editor's 「這句太長」 flag). */
export function isLongLine(text: string): boolean {
  return isLongUnits(tokenizeLyric(text));
}

/** Hard phrase boundaries: a row of a long line ends here first. */
const PHRASE_PUNCT = new Set([..."，。、；：！？,.;:!?…—"]);
/** Particles a phrase may end after (的了著 close a noun phrase or a verb phrase). */
const PHRASE_PARTICLE = new Set([..."的了著嗎呢吧啊呀喔哦嘛啦"]);

/**
 * Split a long line into two phrases, [from, to) unit ranges, each trimmed of spaces and soft
 * marks: at the punctuation or space nearest the middle, else after a particle (的了著) or before
 * a demonstrative (這那每), else between words — never inside a compound, never leaving a
 * one-character fragment. Null when the line is not long or has no acceptable cut.
 */
export function splitLongLine(units: readonly TextUnit[], wordStarts: ReadonlySet<number> = new Set()): [[number, number], [number, number]] | null {
  if (!isLongUnits(units)) return null;
  const load = (a: number, b: number) => {
    const l = lineLoad(units.slice(a, b));
    return l.cjk + l.latin / 2.6;
  };
  const total = load(0, units.length);
  let best: { cut: number; cost: number } | null = null;
  for (let k = 1; k < units.length; k++) {
    const before = units[k - 1];
    const after = units[k];
    let cost: number;
    if (before.kind === "space" || after.kind === "space") cost = 0;
    else if (before.kind === "punct" && PHRASE_PUNCT.has(before.text)) cost = 0;
    else if (after.kind === "punct" && NO_LINE_END.has(after.text)) cost = 0.6;
    else if (before.kind === "punct" || after.kind === "punct") continue;
    else if (before.kind === "latin" && after.kind === "latin") continue;
    else if (before.kind === "cjk" && after.kind === "cjk") {
      if (splitsWord(units, k - 1) || leavesFragment(units, k - 1)) continue;
      if (ATTACH_LEFT.has(after.text)) continue;
      if (wordStarts.size && !wordStarts.has(k)) cost = 2.4;
      else if (PHRASE_PARTICLE.has(before.text)) cost = 0.9;
      else if (BREAK_BEFORE.has(after.text)) cost = 1.1;
      else cost = 1.8;
    } else cost = 1.2;
    // round 17: the first phrase never ends on a Latin function word (「light hums a」)
    if (endsOnFunctionWord(units, k - 1)) cost += 6;
    const a = load(0, k);
    const b = total - a;
    // both halves readable on their own; the cut as near the middle as the words allow
    if (Math.min(a, b) < 2) continue;
    cost += (Math.abs(a - b) / total) * 3;
    if (!best || cost < best.cost) best = { cut: k, cost };
  }
  if (!best) return null;
  const first = trimIndices(units, unitRange(0, best.cut));
  const second = trimIndices(units, unitRange(best.cut, units.length));
  if (!first.length || !second.length) return null;
  return [
    [first[0], first[first.length - 1] + 1],
    [second[0], second[second.length - 1] + 1],
  ];
}

function unitRange(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}
