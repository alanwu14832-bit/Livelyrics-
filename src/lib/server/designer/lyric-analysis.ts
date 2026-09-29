// Lyric analysis for the free research (Traditional Chinese + English), deterministic and local:
//
//   tokenize     CJK runs by forward maximum matching over the lexicons (imagery, sentiment, stop
//                words, pronouns), leftovers as single characters; English words lowercased
//   imagery      the image families the words belong to (lexicon/imagery.ts), with counts
//   emotion      valence / arousal from the sentiment lexicon (negation, intensifiers, chants),
//                the hook weighted in, and a 繁中 reading of the quadrant
//   point of view 我／你／我們 (I, you, we): who sings to whom
//   sing-along   the short repeated phrases (and chants) of the chorus that a crowd would sing —
//                always shorter than their line, so the brief never reproduces a lyric line
//
// Simplified lyrics are matched through a char-by-char traditional mapping (the same code point
// positions), so every phrase and word reported is an exact substring of the original line.

import { toTraditional } from "@/lib/zh-variants";
import { IMAGERY_FAMILIES, STOP_WORDS, type ImageryFamily } from "./lexicon/imagery";
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
}

function tally(lines: readonly string[]): Tally {
  const t: Tally = { v: 0, a: 0, n: 0, pos: new Map(), neg: new Map() };
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
  return {
    valence,
    arousal,
    hits: Math.round(all.n),
    label: all.n >= 1 ? emotionLabel(valence, arousal) : "情緒不明顯",
    confidence: all.n >= 6 ? "high" : all.n >= 2 ? "mid" : "low",
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
  lineIds: string[];
  /** first time it is sung (seconds), when timed */
  start: number | null;
  /** lines that contain it */
  count: number;
  chant: boolean;
}

/** Function words a sung phrase should not start / end with (「的歌會」「心跳交給這」). */
const BAD_START = new Set(Array.from("的了著是和與就也都又還很太啊呀吧嗎呢而且但卻個們到給裡上下過"));
const BAD_END = new Set(Array.from("的了著是在和與就也都把被讓給又還很太而且但卻這那個一再會從向對跟交找"));
const LATIN_STOP = new Set(["the", "a", "an", "to", "of", "and", "in", "on", "at", "is", "it", "my", "your", "i", "you", "we", "me", "be", "so", "for", "with"]);
const CJK_LEN_FACTOR: Record<number, number> = { 2: 0.45, 3: 0.8, 4: 1, 5: 1, 6: 0.85 };
const LATIN_LEN_FACTOR: Record<number, number> = { 1: 0.55, 2: 0.9, 3: 1, 4: 0.9 };

interface Gram {
  text: string;
  cjk: boolean;
  chant: boolean;
  units: number;
}

/** Code point offsets where a token starts or ends (a phrase never cuts a word like 心跳 in half). */
function boundaries(line: string): Set<number> {
  const out = new Set<number>();
  for (const t of tokenize(line)) {
    out.add(t.start);
    out.add(t.start + t.length);
  }
  return out;
}

function gramsOf(line: string): Gram[] {
  const out: Gram[] = [];
  const chars = Array.from(line);
  const cuts = boundaries(line);
  // CJK runs, cut at word boundaries
  let i = 0;
  while (i < chars.length) {
    if (!CJK_RE.test(chars[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && CJK_RE.test(chars[j])) j++;
    for (let a = i; a < j; a++) {
      if (!cuts.has(a)) continue;
      for (let n = 2; n <= 6 && a + n <= j; n++) {
        if (!cuts.has(a + n)) continue;
        const g = chars.slice(a, a + n);
        const text = g.join("");
        const repeatChant = /^(.)\1+$/u.test(text) && CHANT_SET.has(g[0]);
        if (!repeatChant && (BAD_START.has(g[0]) || BAD_END.has(g[g.length - 1]))) continue;
        out.push({ text, cjk: true, chant: repeatChant, units: n });
      }
    }
    i = j;
  }
  // Latin word sequences, as written
  const words = [...line.matchAll(/[A-Za-z][A-Za-z']*/g)].map((m) => ({ word: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  for (let a = 0; a < words.length; a++) {
    for (let n = 1; n <= 4 && a + n <= words.length; n++) {
      const seq = words.slice(a, a + n);
      const keys = seq.map((w) => w.word.toLowerCase());
      const chant = keys.some((k) => CHANT_SET.has(k));
      if (!chant && keys.every((k) => LATIN_STOP.has(k))) continue;
      out.push({ text: line.slice(seq[0].start, seq[n - 1].end), cjk: false, chant, units: n });
    }
  }
  return out;
}

function containsGram(line: string, gram: Gram): boolean {
  if (gram.cjk) return line.includes(gram.text);
  const re = new RegExp(`(^|[^A-Za-z'])${gram.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z'])`, "i");
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
  const seen = new Map<string, { gram: Gram; score: number; lines: number[] }>();
  for (const l of pool) {
    for (const g of gramsOf(l.text ?? "")) {
      const key = g.cjk ? g.text : g.text.toLowerCase();
      if (seen.has(key)) continue;
      const containing = texts.map((t, i) => (containsGram(t, g) ? i : -1)).filter((i) => i >= 0);
      if (containing.length < 2 && !g.chant) continue;
      // never a whole line: the phrase is strictly shorter than every line holding it
      const shortest = Math.min(...containing.map((i) => Array.from(texts[i].trim()).length));
      if (Array.from(g.text).length >= shortest) continue;
      const factor = g.cjk ? (CJK_LEN_FACTOR[g.units] ?? 0.6) : (LATIN_LEN_FACTOR[g.units] ?? 0.6);
      const inHook = containing.some((i) => hookIds.has(lines[i].id));
      // a phrase with an image or a feeling in it, or 「我們」, is what a crowd shouts back
      const toks = tokenize(g.text);
      const meaning = toks.some((t) => IMAGERY_INDEX.has(t.key) || SENTIMENT_INDEX.has(t.key)) ? 0.5 : 0;
      const collective = toks.some((t) => POV_INDEX.get(t.key) === "we") ? 0.5 : 0;
      const score = containing.length * factor + (g.chant ? 2 : 0) + (inHook ? 1.5 : 0) + meaning + collective;
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
    return { text: c.gram.text, lineIds: c.lines.map((i) => lines[i].id), start: starts.length ? Math.min(...starts) : null, count: c.lines.length, chant: c.gram.chant };
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
