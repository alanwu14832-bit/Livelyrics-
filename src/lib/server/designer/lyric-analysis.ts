// Lyric analysis for the free research (Traditional Chinese + English), deterministic and local:
//
//   tokenize     CJK runs by forward maximum matching over the lexicons (imagery, sentiment, stop
//                words, pronouns), leftovers as single characters; English words lowercased
//   imagery      the image families the words belong to (lexicon/imagery.ts), with counts
//   emotion      valence / arousal from the sentiment lexicon (negation, intensifiers, chants),
//                the hook weighted in, and a 繁中 reading of the quadrant
//   point of view 我／你／我們 (I, you, we): who sings to whom
//   sing-along   the short repeated phrases (and chants) of the chorus that a crowd would sing,
//                snapped to phrase boundaries (punctuation, spaces, 了著嗎呢 particles, dictionary
//                words); a short line sung more than once is quoted whole, a long one never is
//
// Simplified lyrics are matched through a char-by-char traditional mapping (the same code point
// positions), so every phrase and word reported is an exact substring of the original line.

import { toTraditional } from "@/lib/zh-variants";
import { IMAGERY_FAMILIES, SENSITIVE_WORDS, STOP_WORDS, type ImageryFamily } from "./lexicon/imagery";
import { CHANTS, INTENSIFIERS, NEGATORS, SENTIMENT } from "./lexicon/sentiment";
import type { SongStructure } from "./structure";

const CJK_RE = /[㐀-鿿豈-﫿]/u;
const LATIN_RE = /[A-Za-z]/;

type Voice = "we" | "i" | "you" | "they";
const POV_WORDS: Record<Voice, string[]> = {
  we: ["我們", "咱們", "we", "us", "our", "ours", "we're", "we'll"],
  you: ["你們", "妳們", "你", "妳", "您", "you", "your", "yours", "you're", "you'll", "ya"],
  i: ["我", "i", "me", "my", "mine", "i'm", "i've", "i'll", "i'd", "myself"],
  they: ["他們", "她們", "它們", "他", "她", "they", "them", "their", "he", "she", "him", "her"],
};

const IMAGERY_INDEX: ReadonlyMap<string, ImageryFamily> = (() => {
  const m = new Map<string, ImageryFamily>();
  for (const f of IMAGERY_FAMILIES) for (const w of f.words) if (!m.has(w.toLowerCase())) m.set(w.toLowerCase(), f);
  return m;
})();

const SENTIMENT_INDEX: ReadonlyMap<string, readonly [number, number]> = new Map(SENTIMENT.map(([w, v, a]) => [w.toLowerCase(), [v, a] as const]));
const NEGATOR_SET = new Set(NEGATORS.map((w) => w.toLowerCase()));
const INTENSIFIER_SET = new Set(INTENSIFIERS.map((w) => w.toLowerCase()));
const CHANT_SET = new Set(CHANTS.map((w) => w.toLowerCase()));
const POV_INDEX: ReadonlyMap<string, Voice> = new Map((Object.keys(POV_WORDS) as Voice[]).flatMap((v) => POV_WORDS[v].map((w) => [w, v] as const)));

/** Multi-character CJK words the tokenizer knows (longest match first). */
const DICT: ReadonlySet<string> = new Set(
  [...IMAGERY_INDEX.keys(), ...SENTIMENT_INDEX.keys(), ...STOP_WORDS, ...NEGATOR_SET, ...INTENSIFIER_SET, ...POV_INDEX.keys()].filter((w) => CJK_RE.test(w) && Array.from(w).length >= 2),
);
const MAX_WORD = Math.max(2, ...[...DICT].map((w) => Array.from(w).length));

export interface Token {
  /** the dictionary form (traditional, lowercase for Latin) */
  key: string;
  /** exactly as written in the line */
  surface: string;
  latin: boolean;
  /** code point offset in the line */
  start: number;
  /** code point length */
  length: number;
}

/** Tokens of one line (CJK: dictionary words, else single characters; Latin: words). */
export function tokenize(text: string): Token[] {
  const orig = Array.from(String(text ?? ""));
  const trad = Array.from(toTraditional(orig.join("")));
  const out: Token[] = [];
  let i = 0;
  while (i < orig.length) {
    const ch = trad[i];
    if (CJK_RE.test(ch)) {
      let len = 1;
      for (let n = Math.min(MAX_WORD, orig.length - i); n >= 2; n--) {
        if (DICT.has(trad.slice(i, i + n).join(""))) {
          len = n;
          break;
        }
      }
      out.push({ key: trad.slice(i, i + len).join(""), surface: orig.slice(i, i + len).join(""), latin: false, start: i, length: len });
      i += len;
    } else if (LATIN_RE.test(ch)) {
      let j = i;
      while (j < orig.length && /[A-Za-z']/.test(orig[j])) j++;
      const surface = orig.slice(i, j).join("").replace(/^'+|'+$/g, "");
      if (surface) out.push({ key: surface.toLowerCase(), surface, latin: true, start: i, length: j - i });
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// imagery
// ---------------------------------------------------------------------------

export interface ImageryMatch {
  family: ImageryFamily;
  /** occurrences in the lyrics (the title counts double) */
  count: number;
  /** count × how visual the family is (colours and scenes follow this ranking) */
  weight: number;
  /** lexicon forms, most frequent first */
  words: string[];
  /** as written in the lyrics (for emphasis, exact substrings) */
  surfaces: string[];
  /** lines it appears in */
  lines: number;
}

const SENSITIVE_SET: ReadonlySet<string> = new Set(SENSITIVE_WORDS.map((w) => w.toLowerCase()));

/** The dark words of a line, as written (see SENSITIVE_WORDS): never an emphasis, never a motion word. */
export function sensitiveWords(text: string): string[] {
  return tokenize(text)
    .filter((t) => SENSITIVE_SET.has(t.key))
    .map((t) => t.surface);
}

export function findImageryFamilies(lines: readonly string[], title = ""): ImageryMatch[] {
  const acc = new Map<string, { family: ImageryFamily; count: number; words: Map<string, number>; surfaces: Set<string>; lines: Set<number> }>();
  const visit = (text: string, weight: number, lineIndex: number) => {
    for (const t of tokenize(text)) {
      const family = IMAGERY_INDEX.get(t.key);
      if (!family) continue;
      const a = acc.get(family.id) ?? { family, count: 0, words: new Map(), surfaces: new Set(), lines: new Set() };
      a.count += weight;
      a.words.set(t.key, (a.words.get(t.key) ?? 0) + weight);
      if (lineIndex >= 0) {
        a.surfaces.add(t.surface);
        a.lines.add(lineIndex);
      }
      acc.set(family.id, a);
    }
  };
  lines.forEach((l, i) => visit(l, 1, i));
  if (title.trim()) visit(title, 2, -1);
  return [...acc.values()]
    .map((a) => ({
      family: a.family,
      count: a.count,
      weight: Math.round(a.count * (a.family.visual ?? 1) * 100) / 100,
      words: [...a.words.entries()].sort((x, y) => y[1] - x[1] || Array.from(y[0]).length - Array.from(x[0]).length).map(([w]) => w),
      surfaces: [...a.surfaces].sort((x, y) => Array.from(y).length - Array.from(x).length),
      lines: a.lines.size,
    }))
    .sort((a, b) => b.count - a.count || b.lines - a.lines || IMAGERY_FAMILIES.indexOf(a.family) - IMAGERY_FAMILIES.indexOf(b.family));
}

// ---------------------------------------------------------------------------
// emotion
// ---------------------------------------------------------------------------

export interface Emotion {
  /** -1 (sad, hurt, angry) .. 1 (happy, loving) */
  valence: number;
  /** 0 calm .. 1 wild */
  arousal: number;
  /** sentiment words found */
  hits: number;
  /** distinct sentiment words: an emotion is named only from two independent ones */
  distinct: number;
  label: string;
  confidence: "low" | "mid" | "high";
  positive: string[];
  negative: string[];
  /** the hook's own reading, when it has sentiment words */
  hook: { valence: number; arousal: number } | null;
}

interface Tally {
  v: number;
  a: number;
  n: number;
  pos: Map<string, number>;
  neg: Map<string, number>;
  /** distinct sentiment words (chants and punctuation do not count) */
  words: Set<string>;
}

/** Two independent sentiment words before an emotion is named: one 「安靜」 is not 矛盾拉扯. */
export const MIN_EMOTION_WORDS = 2;

function tally(lines: readonly string[]): Tally {
  const t: Tally = { v: 0, a: 0, n: 0, pos: new Map(), neg: new Map(), words: new Set() };
  for (const line of lines) {
    let negate = 0;
    let boost = 1;
    for (const tok of tokenize(line)) {
      if (NEGATOR_SET.has(tok.key)) {
        negate = 2;
        continue;
      }
      if (INTENSIFIER_SET.has(tok.key)) {
        boost = 1.3;
        continue;
      }
      if (CHANT_SET.has(tok.key)) {
        t.a += 0.8;
        t.n += 0.5;
        continue;
      }
      const s = SENTIMENT_INDEX.get(tok.key);
      if (s) {
        const v = Math.max(-1, Math.min(1, s[0] * (negate > 0 ? -0.6 : 1) * boost));
        const a = Math.min(1, s[1] * (boost > 1 ? 1.1 : 1));
        t.v += v;
        t.a += a;
        t.n += 1;
        t.words.add(tok.key);
        const bucket = v >= 0 ? t.pos : t.neg;
        bucket.set(tok.key, (bucket.get(tok.key) ?? 0) + 1);
        negate = 0;
        boost = 1;
        continue;
      }
      if (negate > 0) negate--;
      boost = 1;
    }
    const bangs = (line.match(/[!！]/g) ?? []).length;
    if (bangs) {
      t.a += 0.7 * bangs;
      t.n += 0.5 * bangs;
    }
  }
  return t;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function emotionLabel(valence: number, arousal: number): string {
  if (valence >= 0.15) return arousal >= 0.5 ? "明亮激昂" : "溫柔明亮";
  if (valence <= -0.15) return arousal >= 0.5 ? "痛苦掙扎" : "憂傷低迴";
  return arousal >= 0.5 ? "矛盾拉扯" : "平靜內斂";
}

export function estimateEmotion(lines: readonly string[], hookLines: readonly string[] = []): Emotion {
  const all = tally(lines);
  const hook = hookLines.length ? tally(hookLines) : null;
  const mean = (x: Tally) => ({ v: x.n ? x.v / x.n : 0, a: x.n ? x.a / x.n : 0.4 });
  const m = mean(all);
  const h = hook && hook.n >= 1 ? mean(hook) : null;
  // the hook is what the crowd takes home: it weighs 40 %
  const valence = r2(h ? 0.6 * m.v + 0.4 * h.v : m.v);
  const arousal = r2(Math.max(0, Math.min(1, h ? 0.6 * m.a + 0.4 * h.a : m.a)));
  const top = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
  const named = all.words.size >= MIN_EMOTION_WORDS;
  return {
    valence,
    arousal,
    hits: Math.round(all.n),
    distinct: all.words.size,
    label: named ? emotionLabel(valence, arousal) : "情緒不明顯",
    confidence: all.n >= 6 && all.words.size >= 4 ? "high" : named ? "mid" : "low",
    positive: top(all.pos),
    negative: top(all.neg),
    hook: h ? { valence: r2(h.v), arousal: r2(h.a) } : null,
  };
}

// ---------------------------------------------------------------------------
// point of view
// ---------------------------------------------------------------------------

export interface PointOfView {
  voice: "we" | "i" | "you" | "i-you" | "they" | "none";
  counts: Record<Voice, number>;
  /** 繁中, e.g. 「我們（集體）」 */
  label: string;
  /** what it means on stage */
  note: string;
}

export function pointOfView(lines: readonly string[]): PointOfView {
  const counts: Record<Voice, number> = { we: 0, i: 0, you: 0, they: 0 };
  for (const line of lines) for (const t of tokenize(line)) {
    const v = POV_INDEX.get(t.key);
    if (v) counts[v]++;
  }
  const total = counts.we + counts.i + counts.you + counts.they;
  let voice: PointOfView["voice"] = "none";
  if (total >= 2) {
    if (counts.we >= 2 && counts.we >= total * 0.3) voice = "we";
    else if (counts.i >= 2 && counts.you >= 2 && Math.min(counts.i, counts.you) >= Math.max(counts.i, counts.you) * 0.4) voice = "i-you";
    else if (counts.you > counts.i && counts.you >= counts.they) voice = "you";
    else if (counts.i >= counts.they) voice = "i";
    else voice = "they";
  }
  const info: Record<PointOfView["voice"], [string, string]> = {
    we: ["「我們」（集體）", "唱的是一群人：適合讓全場一起唱，副歌的字要大、要提早出現。"],
    "i-you": ["「我」對「你」（傾訴）", "像一封信或一段對話：歌詞可以親密地慢慢出現，副歌才放大。"],
    you: ["對「你」說（呼喚）", "一直在呼喚一個人：畫面可以留一個空位或一道光給「你」。"],
    i: ["「我」（內心獨白）", "內心獨白：主歌讓字安靜地出現，畫面內斂。"],
    they: ["「他／她」（旁觀敘事）", "像在說別人的故事：畫面是敘事的場景，歌詞當旁白。"],
    none: ["不明顯", "沒有明顯的人稱：以意象與能量為主。"],
  };
  return { voice, counts, label: info[voice][0], note: info[voice][1] };
}

// ---------------------------------------------------------------------------
// sing-along phrases
// ---------------------------------------------------------------------------

export interface SingalongPhrase {
  /** exact substring of every line listed */
  text: string;
  /** the phrase is a whole line of the song (a short line sung more than once) */
  whole?: boolean;
  lineIds: string[];
  /** first time it is sung (seconds), when timed */
  start: number | null;
  /** lines that contain it */
  count: number;
  chant: boolean;
}

/** Function words a sung phrase should not start / end with (「的歌會」「心跳交給這」). */
const BAD_START = new Set(Array.from("的了著是和與就也都又還很太啊呀吧嗎呢而且但卻個們到給裡上下過"));
const BAD_END = new Set(Array.from("的是在和與就也都把被讓給又還很太而且但卻這那個一再會從向對跟交找"));
/** Phrase-final particles: a sung phrase ends on them (「睡著了」), never continues through them. */
const CJK_PARTICLES = new Set(Array.from("了著嗎呢吧啊呀嘛囉哦喔"));
const LATIN_STOP = new Set(["the", "a", "an", "to", "of", "and", "in", "on", "at", "is", "it", "my", "your", "i", "you", "we", "me", "be", "so", "for", "with", "that", "this", "but", "or", "if", "as", "by", "from", "are", "was"]);
const CJK_LEN_FACTOR: Record<number, number> = { 2: 0.45, 3: 0.8, 4: 1, 5: 1, 6: 0.85, 7: 0.75, 8: 0.7 };
const LATIN_LEN_FACTOR: Record<number, number> = { 1: 0.5, 2: 0.9, 3: 1, 4: 0.9, 5: 0.8, 6: 0.7 };
/** The longest repeated whole line still quoted as a phrase (reading units: CJK characters + Latin words). */
export const MAX_WHOLE_LINE_UNITS = 12;

/** Punctuation splits a line into the chunks a crowd sings as one breath (a space does too, between CJK runs). */
const CHUNK_SPLIT = /[,.;:!?，。；：！？、「」『』（）()[\]【】《》〈〉—–…~～"“”]+/u;
/** A Latin word, accents included (llévame), apostrophes kept (water's). */
const LATIN_WORD = /[^\s\p{P}\p{S}\p{Script=Han}]+(?:['’][^\s\p{P}\p{S}\p{Script=Han}]+)*/gu;
const REPEATED_CHAR = /^(.)\1+$/u;

interface Gram {
  text: string;
  cjk: boolean;
  chant: boolean;
  units: number;
  /** the gram is a whole line of the song, sung more than once */
  whole: boolean;
  /** the gram is a complete breath: a whole chunk / sub-phrase, not a piece cut out of one */
  complete: boolean;
}

/** Reading units of a chunk: CJK characters plus Latin words. */
function unitsOf(text: string): number {
  const cjk = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latin = (text.match(LATIN_WORD) ?? []).length;
  return cjk + latin;
}

/** A CJK run's sub-phrases: cut after a phrase-final particle (「睡著了」｜「我們還醒著」). */
function subPhrases(run: string): string[] {
  const chars = Array.from(run);
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < chars.length; i++) {
    // cut after the last particle of a run of them (「睡著了」 stays whole)
    if (CJK_PARTICLES.has(chars[i]) && i > from && i < chars.length - 1 && !CJK_PARTICLES.has(chars[i + 1])) {
      out.push(chars.slice(from, i + 1).join(""));
      from = i + 1;
    }
  }
  if (from < chars.length) out.push(chars.slice(from).join(""));
  return out;
}

/**
 * Code point offsets inside a CJK run where a lexicon word starts or ends: dictionary words of any
 * length (我們, 歌, 牆), never the gaps between unknown single characters (拆｜掉｜這｜面).
 */
function wordEdges(run: string): Set<number> {
  const out = new Set<number>();
  for (const t of tokenize(run)) {
    if (t.latin || !(t.length >= 2 || IMAGERY_INDEX.has(t.key) || SENTIMENT_INDEX.has(t.key) || POV_INDEX.has(t.key))) continue;
    out.add(t.start);
    out.add(t.start + t.length);
  }
  return out;
}

function isCjkChant(text: string): boolean {
  return REPEATED_CHAR.test(text) && CHANT_SET.has(Array.from(text)[0]);
}

function cjkOk(text: string): boolean {
  const g = Array.from(text);
  if (g.length < 2 || g.length > MAX_WHOLE_LINE_UNITS) return false;
  if (isCjkChant(text)) return true;
  return !BAD_START.has(g[0]) && !BAD_END.has(g[g.length - 1]);
}

/**
 * The candidate phrases of one line, every one snapped to a phrase boundary: the whole line when it
 * is short; for CJK the runs between punctuation / spaces, their particle-bounded sub-phrases and
 * runs of those, plus grams that start and end on a dictionary word (never 「掉這面牆」, cut inside a
 * run of single characters); for Latin the chunks and the word runs inside them that neither start
 * nor end on a stop word.
 */
function gramsOf(line: string, wholeLines: ReadonlySet<string>): Gram[] {
  const out: Gram[] = [];
  const seen = new Map<string, Gram>();
  const push = (text: string, cjk: boolean, chant: boolean, whole = false, complete = true) => {
    const key = cjk ? text : text.toLowerCase();
    if (!text) return;
    const had = seen.get(key);
    if (had) {
      // the same words as a complete breath somewhere else in the line: it counts as one
      had.complete ||= complete;
      had.whole ||= whole;
      return;
    }
    const gram: Gram = { text, cjk, chant, units: unitsOf(text), whole, complete };
    seen.set(key, gram);
    out.push(gram);
  };
  const trimmed = line.trim();
  const cjk = CJK_RE.test(trimmed);
  const mixed = cjk && LATIN_WORD.test(trimmed);
  LATIN_WORD.lastIndex = 0;
  // a short single-script line is a candidate as a whole; sung more than once it is the phrase
  // itself (「拆掉這面牆」, "Lay me down"); a mixed line (「Hey 跟著我唱」) is its chunks
  if (trimmed && !mixed && unitsOf(trimmed) <= MAX_WHOLE_LINE_UNITS) {
    const chant = isCjkChant(trimmed) || (!cjk && (trimmed.match(LATIN_WORD) ?? []).every((w) => CHANT_SET.has(w.toLowerCase())));
    if (!cjk || cjkOk(trimmed)) push(trimmed, cjk, chant, wholeLines.has(trimmed) && unitsOf(trimmed) <= 6);
  }
  for (const chunk of trimmed.split(CHUNK_SPLIT).filter(Boolean)) {
    // a chunk is CJK runs (a space between them is a phrase boundary) and Latin runs (words across spaces)
    for (const run of chunk.match(/\p{Script=Han}+|[^\p{Script=Han}]+/gu) ?? []) {
      if (CJK_RE.test(run)) {
        const subs = subPhrases(run);
        for (let a = 0; a < subs.length; a++) {
          let text = "";
          for (let b = a; b < subs.length; b++) {
            text += subs[b];
            if (cjkOk(text)) push(text, true, isCjkChant(text));
          }
        }
        // grams anchored to one end of a sub-phrase and cut on a lexicon word's edge at the other
        // (「我們的青春」 → 「青春」, 「我們的歌會找到方向」 → 「我們的歌」; never 「的青春」, never a piece
        // floating in the middle like 「世界都睡著」)
        for (const sub of subs) {
          const chars = Array.from(sub);
          const edges = [...wordEdges(sub)].filter((e) => e > 0 && e < chars.length).sort((x, y) => x - y);
          for (const e of edges) {
            for (const [a, b] of [
              [0, e],
              [e, chars.length],
            ]) {
              const text = chars.slice(a, b).join("");
              if (Array.from(text).length <= 6 && cjkOk(text)) push(text, true, isCjkChant(text), false, false);
            }
          }
        }
        continue;
      }
      const words = run.match(LATIN_WORD) ?? [];
      if (!words.length) continue;
      const keys = words.map((w) => w.toLowerCase());
      // a chant is all chant words ("Oh oh oh"); a phrase with one chant word in it is a phrase
      const chant = keys.every((k) => CHANT_SET.has(k));
      if (chant || !keys.every((k) => LATIN_STOP.has(k))) push(words.join(" "), false, chant);
      for (let a = 0; a < words.length; a++) {
        for (let n = 1; n <= 6 && a + n <= words.length; n++) {
          const seq = keys.slice(a, a + n);
          const isChant = seq.every((k) => CHANT_SET.has(k));
          if (!isChant) {
            if (seq.some((k) => CHANT_SET.has(k)) && n === 1) continue;
            if (LATIN_STOP.has(seq[0]) || LATIN_STOP.has(seq[n - 1])) continue;
            // a single word only when it carries weight on its own
            if (n === 1 && seq[0].length < 6) continue;
          }
          push(words.slice(a, a + n).join(" "), false, isChant, false, n === words.length);
        }
      }
    }
  }
  return out;
}

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function containsGram(line: string, gram: Gram): boolean {
  if (gram.cjk) return line.includes(gram.text);
  const words = gram.text.split(" ").map(escapeRe);
  const re = new RegExp(`(^|[^\\p{L}'’])${words.join("[\\s\\p{P}]+")}($|[^\\p{L}'’])`, "iu");
  return re.test(line);
}

/**
 * The phrases a crowd sings back: short, repeated, from the chorus / hook (chants always count).
 * Each is strictly shorter than every line it comes from.
 */
export function singalongPhrases(lines: ReadonlyArray<{ id: string; text: string; start?: number | null }>, st: SongStructure | null, max = 3): SingalongPhrase[] {
  const texts = lines.map((l) => l.text ?? "");
  const hookIds = new Set(st && st.hookCluster != null ? st.lines.filter((l) => l.cluster === st.hookCluster).map((l) => l.id) : []);
  const chorusIds = new Set(st ? st.sections.filter((s) => s.kind === "chorus").flatMap((s) => s.lineIds) : []);
  const repeated = new Set(st ? st.lines.filter((l) => l.repeats >= 2).map((l) => l.id) : []);
  const candidateLines = lines.filter((l) => chorusIds.has(l.id) || hookIds.has(l.id) || repeated.has(l.id));
  const pool = candidateLines.length ? candidateLines : lines;
  // whole lines sung more than once: the crowd sings the whole line, so the phrase is the whole line
  const lineCount = new Map<string, number>();
  for (const t of texts) {
    const k = t.trim();
    if (k) lineCount.set(k, (lineCount.get(k) ?? 0) + 1);
  }
  const wholeLines = new Set([...lineCount.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
  // every complete breath of the song (a whole line, a chunk, a sub-phrase), wherever it is sung
  const breaths = new Set<string>();
  for (const t of texts) for (const g of gramsOf(t, wholeLines)) if (g.complete) breaths.add(g.cjk ? g.text : g.text.toLowerCase());
  const seen = new Map<string, { gram: Gram; score: number; lines: number[] }>();
  for (const l of pool) {
    for (const g of gramsOf(l.text ?? "", wholeLines)) {
      const key = g.cjk ? g.text : g.text.toLowerCase();
      if (seen.has(key)) continue;
      if (breaths.has(key)) g.complete = true;
      const containing = texts.map((t, i) => (containsGram(t, g) ? i : -1)).filter((i) => i >= 0);
      if (containing.length < 2 && !g.chant) continue;
      const factor = g.cjk ? (CJK_LEN_FACTOR[g.units] ?? 0.6) : (LATIN_LEN_FACTOR[g.units] ?? 0.6);
      const inHook = containing.some((i) => hookIds.has(lines[i].id));
      // a phrase with an image or a feeling in it, or 「我們」, is what a crowd shouts back
      const toks = tokenize(g.text);
      const meaning = toks.some((t) => IMAGERY_INDEX.has(t.key) || SENTIMENT_INDEX.has(t.key)) ? 0.5 : 0;
      const collective = toks.some((t) => POV_INDEX.get(t.key) === "we") ? 0.5 : 0;
      // a complete breath (a chunk, a sub-phrase) over a piece of one; a repeated whole line over its pieces
      const score = containing.length * factor + (g.chant ? 2 : 0) + (inHook ? 1.5 : 0) + meaning + collective + (g.complete ? 0.75 : 0) + (g.whole ? 1 : 0);
      seen.set(key, { gram: g, score, lines: containing });
    }
  }
  const ranked = [...seen.values()].sort((a, b) => b.score - a.score || b.gram.units - a.gram.units || a.lines[0] - b.lines[0]);
  const picked: typeof ranked = [];
  for (const c of ranked) {
    if (picked.length >= max) break;
    const t = c.gram.text.toLowerCase();
    if (picked.some((p) => p.gram.text.toLowerCase().includes(t) || t.includes(p.gram.text.toLowerCase()))) continue;
    picked.push(c);
  }
  return picked.map((c) => {
    const starts = c.lines.map((i) => lines[i].start).filter((s): s is number => typeof s === "number" && Number.isFinite(s));
    return { text: c.gram.text, ...(c.gram.whole ? { whole: true } : {}), lineIds: c.lines.map((i) => lines[i].id), start: starts.length ? Math.min(...starts) : null, count: c.lines.length, chant: c.gram.chant };
  });
}

// ---------------------------------------------------------------------------
// all together
// ---------------------------------------------------------------------------

export interface LyricAnalysis {
  lineCount: number;
  imagery: ImageryMatch[];
  emotion: Emotion;
  pov: PointOfView;
  singalong: SingalongPhrase[];
  /** chant words found (hey, oh, 啦…) */
  chants: string[];
}

export function analyzeLyrics(lines: ReadonlyArray<{ id: string; text: string; start?: number | null }>, title: string, st: SongStructure | null): LyricAnalysis {
  const texts = lines.map((l) => l.text ?? "").filter((t) => t.trim());
  const hookLines = st && st.hookCluster != null ? st.lines.filter((l) => l.cluster === st.hookCluster).map((l) => l.text) : [];
  const chants = new Set<string>();
  for (const t of texts) for (const tok of tokenize(t)) if (CHANT_SET.has(tok.key) && tok.latin) chants.add(tok.surface);
  return {
    lineCount: texts.length,
    imagery: findImageryFamilies(texts, title),
    emotion: estimateEmotion(texts, hookLines),
    pov: pointOfView(texts),
    singalong: texts.length ? singalongPhrases(lines, st) : [],
    chants: [...chants].slice(0, 4),
  };
}
