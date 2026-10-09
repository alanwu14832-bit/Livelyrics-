// 「AI 自動對時」 (round 15): line the user's lyrics up with what a speech recogniser (Whisper, run in
// the browser) heard. Pure; shared by the lyric editor and the local evaluation harness.
//
// 1. Tokens: Latin-like scripts become words (NFKD, marks stripped, lowercase, punctuation and
//    apostrophes dropped); Han, kana and hangul become one token per character. Chinese is compared
//    through a Traditional → Simplified table (Whisper often writes Simplified for Mandarin while
//    lyrics are usually Traditional) and earns partial credit for the same toneless pinyin (a
//    homophone sung or misheard); the tables come from Unicode's Unihan data (han-data.json,
//    scripts/build-han-data.mjs) and are loaded only for lyrics with Han characters.
// 2. The recognised words are cleaned first: long runs of one repeated token or phrase (Whisper's
//    hallucination loops, "oh, oh, oh…") keep only their first few repeats, and with a usable 人聲
//    curve, text where the voice is near zero for a while (an instrumental stretch) is dropped.
// 3. A semi-global, order-preserving alignment (free leading / trailing recogniser tokens, cheap
//    gaps) maps lyric tokens to recognised tokens.
// 4. A line is anchored at its first (or second / third) matched token's time when enough of its
//    tokens matched (the confidence); a longest increasing subsequence keeps the anchors in order
//    and at least 0.3 s apart, and anchors that contradict the operator's real (tapped) lines are
//    dropped. `distributeLines`' placement (the round-14 aligner) fills the lines in between.

import type { AudioAnalysis, LyricLine } from "../types";
import { placeUntimed, type DistributeOptions } from "./lrc";

/** One recognised word (transformers.js `chunks` with word timestamps). */
export interface AsrWord {
  text: string;
  start: number | null;
  end: number | null;
}

// ---------------------------------------------------------------------------
// Han tables (lazy)
// ---------------------------------------------------------------------------

/** The generated data file (src/lib/lyrics/han-data.json). */
export interface HanData {
  /** Traditional characters… */
  trad: string;
  /** …and their Simplified forms, position by position */
  simp: string;
  /** toneless pinyin syllable ("lv" for lǜ) → the characters read that way */
  pinyin: Record<string, string>;
}

export interface HanTables {
  /** Traditional → Simplified */
  canon: Map<string, string>;
  /** character (either form) → toneless readings */
  readings: Map<string, string[]>;
}

export function hanTables(data: HanData): HanTables {
  const canon = new Map<string, string>();
  const trad = Array.from(data.trad);
  const simp = Array.from(data.simp);
  for (let i = 0; i < trad.length && i < simp.length; i++) canon.set(trad[i], simp[i]);
  const readings = new Map<string, string[]>();
  for (const [syllable, chars] of Object.entries(data.pinyin)) {
    for (const c of chars) {
      const list = readings.get(c);
      if (list) list.push(syllable);
      else readings.set(c, [syllable]);
    }
  }
  return { canon, readings };
}

let hanLoad: Promise<HanTables> | null = null;

/** The Han tables, loaded once (a separate chunk in the browser; only lyrics with Han characters need it). */
export function loadHanTables(): Promise<HanTables> {
  hanLoad ??= import("./han-data.json").then((m) => hanTables(((m as { default?: HanData }).default ?? m) as HanData));
  return hanLoad;
}

const HAN_RE = /\p{Script=Han}/u;

/** Do these lyrics need the Han tables? */
export function hasHan(texts: readonly string[]): boolean {
  return texts.some((t) => HAN_RE.test(t));
}

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

export type TokenKind = "word" | "han" | "kana" | "hangul";

export interface Token {
  /** normalized form (a Latin word, a Simplified Han character, a hiragana character, a hangul syllable) */
  s: string;
  kind: TokenKind;
}

const LATIN_FOLD: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ı: "i", ð: "d", þ: "th" };

function foldWord(w: string): string {
  return w
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[ßæœøłđıðþ]/g, (c) => LATIN_FOLD[c] ?? c);
}

/** Katakana → hiragana (so either spelling of a kana word matches). */
function hira(c: string): string {
  const cp = c.codePointAt(0) ?? 0;
  return cp >= 0x30a1 && cp <= 0x30f6 ? String.fromCodePoint(cp - 0x60) : c;
}

const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const HANGUL_RE = /\p{Script=Hangul}/u;
const WORD_CHAR_RE = /[\p{L}\p{N}\p{M}]/u;
const APOSTROPHE_RE = /['’`´ʼ]/;

/** Tokens of one text (a lyric line or a recognised word). */
export function tokenize(text: string, han: HanTables | null = null): Token[] {
  const out: Token[] = [];
  let word = "";
  const flush = () => {
    if (!word) return;
    const w = foldWord(word);
    if (w) out.push({ s: w, kind: "word" });
    word = "";
  };
  for (const c of String(text ?? "").normalize("NFKC")) {
    if (HAN_RE.test(c)) {
      flush();
      out.push({ s: han?.canon.get(c) ?? c, kind: "han" });
    } else if (KANA_RE.test(c)) {
      flush();
      out.push({ s: hira(c), kind: "kana" });
    } else if (HANGUL_RE.test(c)) {
      flush();
      out.push({ s: c, kind: "hangul" });
    } else if (APOSTROPHE_RE.test(c)) {
      // "don't" → "dont", "l'abandon" → "labandon": apostrophes never split a word
    } else if (WORD_CHAR_RE.test(c)) {
      word += c;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

/** A recognised token with its time (a Han word's characters share its span). */
export interface TimedToken extends Token {
  start: number;
  end: number;
  /** index of the recognised word it came from */
  word: number;
}

/** Tokens of the recognised words, each with a time; words without a start time are skipped. */
export function recognisedTokens(words: readonly AsrWord[], han: HanTables | null = null): TimedToken[] {
  const out: TimedToken[] = [];
  words.forEach((w, index) => {
    if (w == null || typeof w.start !== "number" || !Number.isFinite(w.start)) return;
    const toks = tokenize(w.text, han);
    if (!toks.length) return;
    const start = Math.max(0, w.start);
    const end = typeof w.end === "number" && Number.isFinite(w.end) && w.end > start ? w.end : start + 0.3 * toks.length;
    const step = (end - start) / toks.length;
    toks.forEach((t, k) => out.push({ ...t, start: start + k * step, end: start + (k + 1) * step, word: index }));
  });
  return out;
}

// ---------------------------------------------------------------------------
// similarity
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** "zh"/"z", "ch"/"c", "sh"/"s", "n"/"l" initials and "-ng"/"-n" finals merge (sung, or a Taiwanese accent). */
function fuzzyPinyin(s: string): string {
  return s.replace(/^([zcs])h/, "$1").replace(/^l/, "n").replace(/ng$/, "n");
}

function hangulParts(c: string): [number, number, number] | null {
  const cp = (c.codePointAt(0) ?? 0) - 0xac00;
  if (cp < 0 || cp > 11171) return null;
  return [Math.floor(cp / 588), Math.floor((cp % 588) / 28), cp % 28];
}

/** 0..1: how alike a lyric token and a recognised token are. */
export function similarity(a: Token, b: Token, han: HanTables | null, params: Pick<AsrAlignParams, "homophone" | "nearHomophone"> = DEFAULT_ASR_ALIGN): number {
  if (a.kind !== b.kind) return 0;
  if (a.s === b.s) return 1;
  switch (a.kind) {
    case "word": {
      const len = Math.max(a.s.length, b.s.length);
      return len ? 1 - levenshtein(a.s, b.s) / len : 0;
    }
    case "han": {
      const ra = han?.readings.get(a.s);
      const rb = han?.readings.get(b.s);
      if (!ra || !rb) return 0;
      if (ra.some((x) => rb.includes(x))) return params.homophone;
      const fb = rb.map(fuzzyPinyin);
      return ra.some((x) => fb.includes(fuzzyPinyin(x))) ? params.nearHomophone : 0;
    }
    case "hangul": {
      const pa = hangulParts(a.s);
      const pb = hangulParts(b.s);
      // same initial consonant and vowel: a final consonant misheard
      return pa && pb && pa[0] === pb[0] && pa[1] === pb[1] ? 0.6 : 0;
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// parameters
// ---------------------------------------------------------------------------

export interface AsrAlignParams {
  /** a similarity at or above `exact` scores 2 × s in the alignment; at or above `partial` it scores s; below, `mismatch` */
  exact: number;
  partial: number;
  mismatch: number;
  /** skipping a lyric token / a recognised token (inside the matched stretch) */
  gapLyric: number;
  gapRecognised: number;
  /** Han partial credit: the same toneless pinyin / a near reading (zh~z, n~l, -ng~-n) */
  homophone: number;
  nearHomophone: number;
  /** a line is anchored when at least this share of its tokens matched */
  minConfidence: number;
  /** …and at least this many of them (a one-word line needs its word) */
  minMatched: number;
  /** a line may be anchored on its 2nd / 3rd token when the first did not match (minus this many seconds per skipped word / Han character) */
  backoffWord: number;
  backoffChar: number;
  /** the anchors keep this far apart (seconds) */
  minGap: number;
  /** a repeated token (period 1) keeps at most this many repeats; a repeated phrase (period 2–8 tokens) this many */
  maxRepeat: number;
  maxPhraseRepeat: number;
  /** with a usable 人聲 curve: drop recognised text where the curve stays below `silence` within ±`silenceWindow` s */
  silence: number;
  silenceWindow: number;
  /** anchored lines also take an end from their last matched token (+ endPad s); applyAnchors keeps it only when a real gap follows */
  ends: boolean;
  endPad: number;
}

export const DEFAULT_ASR_ALIGN: AsrAlignParams = {
  exact: 0.8,
  partial: 0.5,
  mismatch: -1,
  gapLyric: -0.6,
  gapRecognised: -0.4,
  homophone: 0.7,
  nearHomophone: 0.5,
  minConfidence: 0.5,
  minMatched: 1,
  backoffWord: 0.06,
  backoffChar: 0.25,
  minGap: 0.3,
  maxRepeat: 4,
  maxPhraseRepeat: 3,
  silence: 0.05,
  silenceWindow: 1.5,
  ends: false,
  endPad: 0.3,
};

// ---------------------------------------------------------------------------
// cleaning the recognised text
// ---------------------------------------------------------------------------

/**
 * Indices of tokens inside hallucination loops: a token repeated more than `maxRepeat` times in a
 * row, or a phrase of 2–8 tokens repeated more than `maxPhraseRepeat` times; the first repeats stay.
 */
export function loopTokens(tokens: readonly Token[], params: Pick<AsrAlignParams, "maxRepeat" | "maxPhraseRepeat"> = DEFAULT_ASR_ALIGN): Set<number> {
  const drop = new Set<number>();
  const n = tokens.length;
  for (let p = 1; p <= 8; p++) {
    const keep = p === 1 ? params.maxRepeat : params.maxPhraseRepeat;
    let i = p;
    while (i < n) {
      if (tokens[i].s !== tokens[i - p].s) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && tokens[j].s === tokens[j - p].s) j++;
      // tokens [i − p, j) repeat a period of p tokens (j − i + p) / p times
      const runStart = i - p;
      const repeats = (j - runStart) / p;
      if (repeats > keep) for (let k = runStart + keep * p; k < j; k++) drop.add(k);
      i = j + 1;
    }
  }
  return drop;
}

export interface VocalCurve {
  curve: ArrayLike<number>;
  /** frames per second */
  rate: number;
}

/** The curve says something about where the voice is (not flat, some confident voice). */
function informative(v: VocalCurve | null | undefined): v is VocalCurve {
  if (!v || !v.curve || v.curve.length < 10 || !(v.rate > 0)) return false;
  let high = 0;
  for (let i = 0; i < v.curve.length; i++) if (Number(v.curve[i]) >= 0.5) high++;
  return high / v.curve.length >= 0.05;
}

/** The highest curve value within ±window s of [start, end]. */
function curveMax(v: VocalCurve, start: number, end: number, window: number): number {
  const i0 = Math.max(0, Math.floor((start - window) * v.rate));
  const i1 = Math.min(v.curve.length - 1, Math.ceil((end + window) * v.rate));
  let m = 0;
  for (let i = i0; i <= i1; i++) m = Math.max(m, Number(v.curve[i]) || 0);
  return m;
}

// ---------------------------------------------------------------------------
// the alignment
// ---------------------------------------------------------------------------

/** Above this many cells the alignment is not attempted (memory: one byte per cell). */
const MAX_CELLS = 24_000_000;

/**
 * Semi-global, order-preserving alignment of lyric tokens to recognised tokens: recogniser tokens
 * before the first and after the last match are free. Returns, per lyric token, the recognised
 * token it matched and the similarity (null = unmatched).
 */
export function alignTokens(lyric: readonly Token[], rec: readonly Token[], han: HanTables | null, params: AsrAlignParams = DEFAULT_ASR_ALIGN): Array<{ j: number; s: number } | null> {
  const n = lyric.length;
  const m = rec.length;
  const out: Array<{ j: number; s: number } | null> = new Array(n).fill(null);
  if (!n || !m || n * m > MAX_CELLS) return out;
  const W = m + 1;
  // backpointers: 1 diagonal, 2 up (skip a lyric token), 3 left (skip a recognised token)
  const B = new Uint8Array((n + 1) * W);
  let prev = new Float64Array(W); // row 0: free leading recogniser tokens
  let cur = new Float64Array(W);
  for (let j = 1; j <= m; j++) B[j] = 3;
  const score = (s: number) => (s >= params.exact ? 2 * s : s >= params.partial ? s : params.mismatch);
  for (let i = 1; i <= n; i++) {
    cur[0] = prev[0] + params.gapLyric;
    B[i * W] = 2;
    const a = lyric[i - 1];
    for (let j = 1; j <= m; j++) {
      const d = prev[j - 1] + score(similarity(a, rec[j - 1], han, params));
      const u = prev[j] + params.gapLyric;
      const l = cur[j - 1] + params.gapRecognised;
      if (d >= u && d >= l) {
        cur[j] = d;
        B[i * W + j] = 1;
      } else if (u >= l) {
        cur[j] = u;
        B[i * W + j] = 2;
      } else {
        cur[j] = l;
        B[i * W + j] = 3;
      }
    }
    [prev, cur] = [cur, prev];
  }
  // free trailing recogniser tokens: end at the best cell of the last row
  let j = 0;
  for (let k = 1; k <= m; k++) if (prev[k] > prev[j]) j = k;
  let i = n;
  while (i > 0 && j > 0) {
    const b = B[i * W + j];
    if (b === 1) {
      const s = similarity(lyric[i - 1], rec[j - 1], han, params);
      if (s >= params.partial) out[i - 1] = { j: j - 1, s };
      i--;
      j--;
    } else if (b === 2) i--;
    else j--;
  }
  return out;
}

export interface LineAnchor {
  /** line index */
  line: number;
  start: number;
  /** the sung end (its last matched token + endPad) when `params.ends`, else null */
  end: number | null;
  /** share of the line's tokens that matched (0..1) */
  confidence: number;
}

export interface AsrAlignResult {
  /** the kept anchors, in line order */
  anchors: LineAnchor[];
  /** lines with tokens to match (the rest — empty or symbol-only lines — cannot be anchored) */
  scorable: number;
  /** recognised tokens used / dropped as hallucination loops / dropped in instrumental stretches */
  tokens: number;
  loops: number;
  silent: number;
  /** anchors dropped because they fell out of order, too close, or against a real line */
  rejected: number;
}

export interface AsrAlignInput {
  /** the lyric lines, in order */
  lines: readonly string[];
  words: readonly AsrWord[];
  /** needed for Han lyrics (loadHanTables) */
  han?: HanTables | null;
  /** the song's 人聲 curve (AudioAnalysis.vocal at envelopeRate) */
  vocal?: VocalCurve | null;
  /** per line: the operator's real start (taps, typed, LRC), else null — real lines are never moved and AI anchors may not contradict them */
  fixed?: ReadonlyArray<number | null>;
  params?: Partial<AsrAlignParams>;
}

/** Anchors for the lines the recogniser heard (see the module comment). */
export function alignTranscript(input: AsrAlignInput): AsrAlignResult {
  const params: AsrAlignParams = { ...DEFAULT_ASR_ALIGN, ...input.params };
  const han = input.han ?? null;
  const lines = input.lines;
  const fixed = input.fixed ?? [];

  // the recognised tokens, cleaned
  const all = recognisedTokens(input.words, han);
  const loops = loopTokens(all, params);
  const vocal = informative(input.vocal) ? input.vocal : null;
  let silent = 0;
  const rec: TimedToken[] = [];
  all.forEach((t, k) => {
    if (loops.has(k)) return;
    if (vocal && curveMax(vocal, t.start, t.end, params.silenceWindow) < params.silence) {
      silent++;
      return;
    }
    rec.push(t);
  });

  // the lyric tokens, line by line
  const lyric: Token[] = [];
  const firstToken: number[] = [];
  for (const text of lines) {
    firstToken.push(lyric.length);
    for (const t of tokenize(text, han)) lyric.push(t);
  }
  firstToken.push(lyric.length);
  const map = alignTokens(lyric, rec, han, params);

  // a guess per line
  type Guess = { start: number; end: number | null; confidence: number };
  const guesses: Array<Guess | null> = lines.map((_, li) => {
    const a = firstToken[li];
    const b = firstToken[li + 1];
    const count = b - a;
    if (count <= 0 || fixed[li] != null) return null;
    let matched = 0;
    for (let k = a; k < b; k++) if (map[k]) matched++;
    const confidence = matched / count;
    if (confidence < params.minConfidence || matched < params.minMatched) return null;
    // the first matched token among the line's first ones (one for a short line, up to three for a long one)
    const reach = count <= 2 ? 1 : count <= 4 ? 2 : 3;
    let k = a;
    while (k < a + reach && !map[k]) k++;
    if (k >= a + reach || !map[k]) return null;
    let start = rec[map[k]!.j].start;
    for (let q = a; q < k; q++) start -= lyric[q].kind === "word" ? params.backoffWord * (lyric[q].s.length + 1) : params.backoffChar;
    // the sung end: the last matched token among the line's last ones
    let end: number | null = null;
    if (params.ends) {
      let e = b - 1;
      while (e >= Math.max(a, b - reach) && !map[e]) e--;
      if (e >= a && map[e]) end = rec[map[e]!.j].end + params.endPad;
    }
    start = Math.max(0, start);
    return { start, end: end != null && end > start + 0.2 ? end : null, confidence };
  });

  // anchors may not contradict the real lines around them
  let rejected = 0;
  let prevFixed = -Infinity;
  const nextFixed: number[] = new Array(lines.length).fill(Infinity);
  for (let i = lines.length - 2; i >= 0; i--) nextFixed[i] = fixed[i + 1] != null ? (fixed[i + 1] as number) : nextFixed[i + 1];
  for (let i = 0; i < lines.length; i++) {
    const g = guesses[i];
    if (g && (g.start < prevFixed + params.minGap || g.start > nextFixed[i] - params.minGap)) {
      guesses[i] = null;
      rejected++;
    }
    if (fixed[i] != null) prevFixed = fixed[i] as number;
  }

  // keep the anchors in order: the longest increasing subsequence by start (≥ minGap apart)
  const idx = guesses.flatMap((g, i) => (g ? [i] : []));
  const best = new Array<number>(idx.length).fill(1);
  const back = new Array<number>(idx.length).fill(-1);
  for (let x = 0; x < idx.length; x++) {
    const sx = (guesses[idx[x]] as Guess).start;
    for (let y = 0; y < x; y++) {
      if ((guesses[idx[y]] as Guess).start + params.minGap <= sx && best[y] + 1 > best[x]) {
        best[x] = best[y] + 1;
        back[x] = y;
      }
    }
  }
  let top = -1;
  for (let x = 0; x < idx.length; x++) if (top < 0 || best[x] > best[top]) top = x;
  const keep = new Set<number>();
  for (let x = top; x >= 0; x = back[x]) keep.add(idx[x]);
  rejected += idx.length - keep.size;

  const anchors: LineAnchor[] = [];
  for (const i of [...keep].sort((p, q) => p - q)) {
    const g = guesses[i] as Guess;
    anchors.push({ line: i, start: round3(g.start), end: g.end != null ? round3(g.end) : null, confidence: g.confidence });
  }
  const scorable = lines.filter((_, li) => firstToken[li + 1] > firstToken[li]).length;
  return { anchors, scorable, tokens: rec.length, loops: loops.size, silent, rejected };
}

function round3(t: number): number {
  return Math.round(t * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// applying the anchors
// ---------------------------------------------------------------------------

/** An anchored line keeps its sung end only when the next line starts at least this much later (no flicker on stage). */
const ANCHOR_END_GAP = 2;

/**
 * The lines with the AI anchors applied: real lines (timed, not estimated) keep their times; the
 * anchored lines take the AI's start (and end) and stay estimated; every other line is laid out
 * again by `placeUntimed` (the 人聲 aligner) between the real lines and the anchors, estimated too.
 * Returns the lines in the same order (not normalized) and which ones the AI matched.
 */
export function applyAnchors(
  input: readonly LyricLine[],
  anchors: readonly LineAnchor[],
  analysis: AudioAnalysis | null,
  duration: number,
  options: DistributeOptions = {},
): { lines: LyricLine[]; matched: boolean[] } {
  const byLine = new Map(anchors.map((a) => [a.line, a]));
  const matched = input.map((_, i) => byLine.has(i));
  const prepared: LyricLine[] = input.map((l, i) => {
    const real = l.start != null && !l.estimated;
    if (real) return { ...l };
    const a = byLine.get(i);
    const copy: LyricLine = { ...l, start: a ? a.start : null, end: a ? a.end : null };
    delete copy.words;
    delete copy.estimated;
    if (a) copy.estimated = true;
    return copy;
  });
  const placed = placeUntimed(prepared, analysis, duration, options);
  for (let i = 0; i < placed.length; i++) {
    const l = placed[i];
    if (!matched[i] || l.end == null || l.start == null) continue;
    const next = placed.slice(i + 1).find((x) => x.start != null)?.start ?? null;
    if (next != null && next - l.end < ANCHOR_END_GAP) placed[i] = { ...l, end: null };
  }
  return { lines: placed, matched };
}

// ---------------------------------------------------------------------------
// the recogniser's language
// ---------------------------------------------------------------------------

const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "you", "i", "to", "a", "me", "my", "it", "is", "in", "of", "your", "that", "we", "dont", "all", "on", "be", "love", "im", "for", "with", "this", "so", "can", "what", "know"],
  es: ["que", "de", "y", "la", "el", "en", "no", "me", "te", "mi", "tu", "lo", "un", "una", "es", "por", "con", "se", "los", "las", "yo", "amor", "para", "como", "si", "mas"],
  fr: ["je", "de", "la", "le", "et", "les", "tu", "des", "un", "une", "est", "pas", "que", "qui", "en", "dans", "mon", "ma", "on", "moi", "toi", "pour", "nous", "vous", "sur", "plus", "ne", "il"],
  de: ["ich", "und", "die", "der", "du", "das", "nicht", "ist", "in", "zu", "mich", "mir", "ein", "es", "wir", "sie", "dich", "mit", "auf", "den", "dir", "so", "auch", "eine", "nur", "was", "wie", "noch"],
  it: ["che", "di", "e", "il", "la", "non", "un", "per", "mi", "ti", "sei", "una", "le", "con", "io", "tu", "ma", "del", "piu", "lo", "cosa", "sono", "come", "amore"],
  pt: ["que", "de", "e", "o", "a", "nao", "eu", "um", "uma", "voce", "me", "te", "meu", "minha", "do", "da", "em", "com", "para", "por", "se", "mais", "os", "as", "tudo", "amor"],
  nl: ["ik", "je", "de", "het", "een", "en", "niet", "van", "is", "dat", "in", "mijn", "jij", "wat", "op", "met", "voor", "maar", "zijn", "we", "die", "er", "nog", "ook"],
};

/**
 * The language to tell Whisper (ISO 639-1), from the lyric text: Chinese / Japanese / Korean by
 * script, a Latin-script language by its most common little words; null = let Whisper detect it.
 * (detectLanguage in lrc.ts stays the lyrics' own label; this is only what the recogniser needs.)
 */
export function asrLanguage(texts: readonly string[]): string | null {
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let cyrillic = 0;
  let thai = 0;
  let latin = 0;
  const words = new Map<string, number>();
  for (const text of texts) {
    for (const c of text) {
      if (HAN_RE.test(c)) han++;
      else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c)) kana++;
      else if (HANGUL_RE.test(c)) hangul++;
      else if (/\p{Script=Cyrillic}/u.test(c)) cyrillic++;
      else if (/\p{Script=Thai}/u.test(c)) thai++;
      else if (/\p{Script=Latin}/u.test(c)) latin++;
    }
    for (const t of tokenize(text)) if (t.kind === "word") words.set(t.s, (words.get(t.s) ?? 0) + 1);
  }
  const cjk = han + kana + hangul;
  if (kana >= Math.max(2, 0.05 * cjk) && kana + han > latin / 3) return "ja";
  if (hangul >= Math.max(2, 0.3 * cjk) && hangul > latin / 3) return "ko";
  if (han > 0 && han * 2.5 >= latin / 2) return "zh";
  if (cyrillic > latin) return "ru";
  if (thai > latin) return "th";
  if (latin === 0) return null;
  let bestLang: string | null = null;
  let bestScore = 0;
  let bestDistinct = 0;
  let total = 0;
  for (const n of words.values()) total += n;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    let score = 0;
    let distinct = 0;
    for (const w of list) {
      const n = words.get(w) ?? 0;
      score += n;
      if (n) distinct++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDistinct = distinct;
      bestLang = lang;
    }
  }
  // too few (or too few different) function words to tell — "la la la" is no language: Whisper decides
  return bestLang && bestDistinct >= 3 && bestScore >= Math.max(3, 0.08 * total) ? bestLang : null;
}
