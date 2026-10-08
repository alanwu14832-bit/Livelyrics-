// Lyrics parsing, serialization and timing helpers — owned by the SERVER module,
// shared with the browser (the lyrics editor imports it), so no Node APIs here.

import type { AudioAnalysis, LyricLine, LyricWord, Lyrics, LyricsSource } from "../types";
import { alignRun, DEFAULT_ALIGN, sungSeconds, type AlignParams } from "./align";

/** A derived line end (from the next line's start) never lingers longer than this; matches timeline.lineSpan. */
const MAX_DERIVED_LINE_SECONDS = 10;
const MAX_LINE_CHARS = 500;
const MAX_LINES = 5000;
const TIME_EPSILON = 0.001;

const VALID_SOURCES: readonly LyricsSource[] = ["lrclib-synced", "lrclib-plain", "user", "embedded", "none"];

// [mm:ss] [mm:ss.x] [mm:ss.xx] [mm:ss.xxx] [mm:ss:xx]
const LINE_TAG_RE = /\[\s*(\d{1,3})\s*:\s*(\d{1,2})(?:[.:](\d{1,3}))?\s*\]/y;
const LINE_TAG_ANY_RE = /\[\s*\d{1,3}\s*:\s*\d{1,2}(?:[.:]\d{1,3})?\s*\]/g;
const LINE_TAG_START_RE = /^\s*\[\s*\d{1,3}\s*:\s*\d{1,2}(?:[.:]\d{1,3})?\s*\]/;
// <mm:ss.xx> enhanced (A2) word tags
const WORD_TAG_RE = /<\s*(\d{1,3})\s*:\s*(\d{1,2})(?:[.:](\d{1,3}))?\s*>/g;
// [ti:...] [ar:...] [offset:+250] [#:...]
const META_TAG_RE = /^\[\s*([a-zA-Z#]{1,12})\s*:([^\]]*)\]$/;

// Credit lines ("作詞：…", "Composer: …") are not lyrics; they would pollute the stage.
const CREDIT_RE = new RegExp(
  "^\\s*(?:" +
    [
      "作詞", "作词", "作曲", "詞曲", "词曲", "編曲", "编曲", "詞", "词", "曲", "填詞", "填词",
      "監製", "监制", "製作", "制作", "製作人", "制作人", "製作統籌", "制作统筹", "演唱", "原唱", "翻唱",
      "混音", "混音師", "混音师", "母帶", "母带", "母帶後期", "母带后期", "錄音", "录音", "錄音師", "录音师",
      "和聲", "和声", "和音", "吉他", "電吉他", "电吉他", "木吉他", "貝斯", "贝斯", "鼓", "爵士鼓", "鍵盤", "键盘",
      "弦樂", "弦乐", "出品", "發行", "发行", "企劃", "企划", "統籌", "统筹", "OP", "SP", "ISRC",
      "Lyricist", "Lyrics", "Lyrics by", "Composer", "Composed by", "Music", "Music by",
      "Arranger", "Arranged by", "Producer", "Produced by", "Written by", "Mixed by", "Mastered by",
    ]
      .map((s) => s.replace(/ /g, "\\s*"))
      .join("|") +
    ")\\s*[:：]",
  "i",
);

const SECTION_WORDS =
  "verse|chorus|pre-?chorus|post-?chorus|bridge|intro|outro|hook|refrain|interlude|instrumental|solo|breakdown|rap|repeat|" +
  "主歌|副歌|導歌|导歌|預副歌|预副歌|橋段|桥段|前奏|間奏|间奏|尾奏|獨白|独白|口白|重複|重复";
const PAREN_SECTION_RE = new RegExp(`^[(（]\\s*(?:${SECTION_WORDS})[^)）]{0,20}[)）]$`, "i");

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function round3(t: number): number {
  return Math.round(t * 1000) / 1000;
}

function isTime(t: unknown): t is number {
  return typeof t === "number" && Number.isFinite(t) && t >= 0;
}

function tagSeconds(mm: string, ss: string, frac: string | undefined): number {
  const f = frac ? Number(`0.${frac}`) : 0;
  return Number(mm) * 60 + Number(ss) + f;
}

function splitLines(text: string): string[] {
  return String(text ?? "")
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/);
}

/** Collapse ASCII whitespace / control characters, keep CJK spaces (U+3000) intact. */
function cleanText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t\r\n\f\v]+/g, " ")
    .trim()
    .slice(0, MAX_LINE_CHARS);
}

function isCreditLine(text: string): boolean {
  return CREDIT_RE.test(text);
}

/** "[Chorus]", "【副歌】", "(Verse 2)" — annotations, not singable text. */
function isSectionMarker(text: string): boolean {
  const t = text.trim();
  if (t.length > 40) return false;
  if (/^\[[^\]]*\]$/.test(t) || /^【[^】]*】$/.test(t)) return true;
  return PAREN_SECTION_RE.test(t);
}

function isNoiseLine(text: string): boolean {
  return !text || isCreditLine(text) || isSectionMarker(text) || /^\/\/+$/.test(text);
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER_RE = /[\p{L}\p{N}]/u;

/** Rough "how long does this take to sing" weight used for distributing untimed lines. */
export function lineWeight(text: string): number {
  let units = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) units += 1;
    else if (LETTER_RE.test(ch)) units += 0.4;
  }
  return 1.5 + units;
}

// Characters that only appear in one of the two Chinese scripts (small, high-frequency sample).
const TRAD_ONLY = "們這個說時對會過還為東樣邊經發問開門見長馬鳥書車愛讓聽夢裡來與無麼點頭嗎誰覺氣處實現電話離歲總從應當歡樂動風飛雲燈顏體記憶淚戀寫慢邊聲燈滿遠讀讓";
const SIMP_ONLY = "们这个说时对会过还为东样边经发问开门见长马鸟书车爱让听梦来与无么点头吗谁觉气处实现电话离岁总从应当欢乐动风飞云灯颜体记忆泪恋写慢边声灯满远读让";

/** Best-effort BCP-47-ish language guess from lyric text. */
export function detectLanguage(texts: string[]): string | undefined {
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;
  let trad = 0;
  let simp = 0;
  for (const text of texts) {
    for (const ch of text) {
      if (/\p{Script=Han}/u.test(ch)) {
        han++;
        if (TRAD_ONLY.includes(ch)) trad++;
        else if (SIMP_ONLY.includes(ch)) simp++;
      } else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) kana++;
      else if (/\p{Script=Hangul}/u.test(ch)) hangul++;
      else if (/[A-Za-z]/.test(ch)) latin++;
    }
  }
  const cjk = han + kana + hangul;
  if (cjk === 0) return latin > 0 ? "en" : undefined;
  if (kana >= Math.max(2, 0.05 * cjk)) return "ja";
  if (hangul >= Math.max(2, 0.3 * cjk)) return "ko";
  if (han * 3 < latin / 2.5) return "en";
  if (trad > simp) return "zh-Hant";
  if (simp > trad) return "zh-Hans";
  return "zh";
}

// ---------------------------------------------------------------------------
// LRC parsing
// ---------------------------------------------------------------------------

interface RawEntry {
  /** null = untimed line */
  time: number | null;
  /** timed line with no text: marks the end of the previous line */
  marker: boolean;
  text: string;
  words?: LyricWord[];
  /** end time of the last word from a trailing word tag */
  wordsEnd?: number;
  order: number;
  sortKey: number;
}

interface ParsedWords {
  text: string;
  words?: LyricWord[];
  wordsEnd?: number;
  firstWordTime?: number;
}

/** Split a line body containing <mm:ss.xx> word tags into timed words. */
function parseWordTags(body: string, lineStart: number | null, offset: number): ParsedWords {
  WORD_TAG_RE.lastIndex = 0;
  if (!WORD_TAG_RE.test(body)) return { text: cleanText(body) };
  WORD_TAG_RE.lastIndex = 0;

  const segments: Array<{ time: number | null; text: string }> = [];
  let cursor = 0;
  let currentTime: number | null = lineStart;
  let m: RegExpExecArray | null;
  while ((m = WORD_TAG_RE.exec(body))) {
    const before = body.slice(cursor, m.index);
    if (before) segments.push({ time: currentTime, text: before });
    currentTime = Math.max(0, tagSeconds(m[1], m[2], m[3]) - offset);
    cursor = m.index + m[0].length;
  }
  const tail = body.slice(cursor);
  let wordsEnd: number | undefined;
  if (tail.trim()) segments.push({ time: currentTime, text: tail });
  else if (currentTime != null) wordsEnd = currentTime;

  const words: Array<{ text: string; start: number | null }> = [];
  for (const seg of segments) {
    const text = seg.text.replace(/[\t\r\n\f\v]+/g, " ");
    if (!text.trim()) {
      // pure spacing: keep it attached to the previous word so the words still spell the line
      if (words.length) words[words.length - 1].text += text.replace(/ +/g, " ");
      continue;
    }
    words.push({ text, start: seg.time });
  }
  const joined = cleanText(words.map((w) => w.text).join(""));
  const firstWordTime = words.find((w) => w.start != null)?.start ?? undefined;
  if (words.length === 0 || words.some((w) => w.start == null)) return { text: joined, firstWordTime };

  words[0].text = words[0].text.replace(/^\s+/, "");
  words[words.length - 1].text = words[words.length - 1].text.replace(/\s+$/, "");
  const timed: LyricWord[] = words.map((w, i) => {
    const start = w.start as number;
    const next = i + 1 < words.length ? (words[i + 1].start as number) : wordsEnd;
    return { text: w.text, start: round3(start), end: round3(next != null && next > start ? next : start) };
  });
  return { text: joined, words: timed, wordsEnd, firstWordTime };
}

/** Parse LRC ([mm:ss.xx] tags, multiple tags per line, optional <mm:ss.xx> word tags). */
export function parseLrc(text: string): Lyrics {
  const rawLines = splitLines(text);
  let offset = 0;
  for (const raw of rawLines) {
    const meta = raw.trim().match(META_TAG_RE);
    if (meta && meta[1].toLowerCase() === "offset") {
      const ms = Number(meta[2].trim());
      // positive offset = lyrics appear sooner
      if (Number.isFinite(ms)) offset = ms / 1000;
    }
  }

  const entries: RawEntry[] = [];
  let order = 0;
  let lastKey = -1;
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    if (META_TAG_RE.test(line) && !LINE_TAG_START_RE.test(line)) continue;

    const times: number[] = [];
    let pos = 0;
    for (;;) {
      while (pos < line.length && /\s/.test(line[pos])) pos++;
      LINE_TAG_RE.lastIndex = pos;
      const m = LINE_TAG_RE.exec(line);
      if (!m) break;
      times.push(Math.max(0, tagSeconds(m[1], m[2], m[3]) - offset));
      pos = LINE_TAG_RE.lastIndex;
    }
    const body = line.slice(pos);
    const firstTime = times.length ? times[0] : null;
    const parsed = parseWordTags(body, firstTime, offset);

    if (times.length === 0 && parsed.firstWordTime != null && parsed.words) {
      // word tags without a line tag: the first word starts the line
      times.push(parsed.firstWordTime);
    }

    const textOk = !isNoiseLine(parsed.text);
    if (times.length === 0) {
      if (!textOk) continue;
      entries.push({ time: null, marker: false, text: parsed.text, order: order++, sortKey: lastKey });
      continue;
    }

    const base = times[0];
    for (const t of times) {
      const shift = t - base;
      const marker = !parsed.text;
      if (!marker && !textOk) continue; // credit lines etc. are dropped, but don't become end markers
      entries.push({
        time: round3(t),
        marker,
        text: parsed.text,
        words: parsed.words?.map((w) => ({ text: w.text, start: round3(w.start + shift), end: round3(w.end + shift) })),
        wordsEnd: parsed.wordsEnd != null ? round3(parsed.wordsEnd + shift) : undefined,
        order: order++,
        sortKey: t,
      });
    }
    lastKey = base;
  }

  // Timed lines sort by time; untimed lines stay right after the timed line they followed.
  entries.sort((a, b) => a.sortKey - b.sortKey || (a.time == null ? 1 : 0) - (b.time == null ? 1 : 0) || a.order - b.order);

  // Same timestamp + different text = a translation line (common bilingual LRC convention).
  const merged: Array<RawEntry & { translation?: string }> = [];
  for (const e of entries) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      e.time != null &&
      prev.time != null &&
      !e.marker &&
      !prev.marker &&
      Math.abs(prev.time - e.time) < TIME_EPSILON
    ) {
      if (prev.text === e.text) continue;
      if (!prev.translation && !e.words) {
        prev.translation = e.text;
        continue;
      }
    }
    merged.push(e);
  }

  const lines: LyricLine[] = [];
  for (let i = 0; i < merged.length; i++) {
    const e = merged[i];
    if (e.marker) continue;
    let end: number | null = null;
    if (e.time != null) {
      // the next item after this line's start: a timed line / blank end-marker gives the end,
      // an untimed line leaves it open
      let nextTime: number | null = null;
      for (let k = i + 1; k < merged.length; k++) {
        const n = merged[k];
        if (n.time == null) break;
        if (n.time > e.time + TIME_EPSILON) {
          nextTime = n.time;
          break;
        }
      }
      if (nextTime != null) end = Math.min(nextTime, e.time + MAX_DERIVED_LINE_SECONDS);
      if (e.wordsEnd != null && e.wordsEnd > e.time) end = nextTime != null ? Math.min(e.wordsEnd, nextTime) : e.wordsEnd;
    }
    const line: LyricLine = { id: "", text: e.text, start: e.time, end: end == null ? null : round3(end) };
    if (e.translation) line.translation = e.translation;
    if (e.words && e.words.length && e.time != null) line.words = e.words;
    lines.push(line);
  }

  return normalizeLyrics({ source: "user", synced: false, lines, language: detectLanguage(lines.map((l) => l.text)) });
}

/** Parse untimed plain lyrics, one line per lyric line; blank lines dropped. */
export function parsePlainLyrics(text: string): Lyrics {
  const lines: LyricLine[] = [];
  for (const raw of splitLines(text)) {
    let t = raw.trim();
    if (!t) continue;
    if (META_TAG_RE.test(t) && !LINE_TAG_START_RE.test(t)) continue;
    t = cleanText(t.replace(LINE_TAG_ANY_RE, "").replace(WORD_TAG_RE, ""));
    if (isNoiseLine(t)) continue;
    lines.push({ id: "", text: t, start: null, end: null });
  }
  return normalizeLyrics({ source: "user", synced: false, lines, language: detectLanguage(lines.map((l) => l.text)) });
}

/** true when the text contains at least one LRC line time tag at a line start. */
export function looksLikeLrc(text: string): boolean {
  return splitLines(text).some((l) => LINE_TAG_START_RE.test(l));
}

/** Detect LRC vs plain text and parse accordingly. */
export function parseLyricsText(text: string, source: Lyrics["source"] = "user"): Lyrics {
  const parsed = looksLikeLrc(text) ? parseLrc(text) : parsePlainLyrics(text);
  return { ...parsed, source: VALID_SOURCES.includes(source) ? source : "user" };
}

// ---------------------------------------------------------------------------
// LRC serialization
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** mm:ss.xx (minutes may exceed 59). */
export function formatLrcTime(seconds: number): string {
  const cs = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  return `${pad2(m)}:${pad2(s)}.${pad2(cs % 100)}`;
}

/** Serialize to LRC (untimed lines are emitted without a tag). */
export function toLrc(lyrics: Lyrics): string {
  const lines = lyrics?.lines ?? [];
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.start == null || !isTime(line.start)) {
      // LRC has no convention for untimed translations; emitting them would turn them into lyric lines
      out.push(line.text);
      continue;
    }
    const tag = `[${formatLrcTime(line.start)}]`;
    let body = line.text;
    let wordsCoverEnd = false;
    if (line.words && line.words.length) {
      body = line.words.map((w) => `<${formatLrcTime(w.start)}>${w.text}`).join("");
      const last = line.words[line.words.length - 1];
      body += `<${formatLrcTime(last.end)}>`;
      wordsCoverEnd = line.end != null && Math.abs(last.end - line.end) < 0.01;
    }
    out.push(tag + body);
    if (line.translation) out.push(tag + line.translation);

    // A real gap before the next line (or an explicit end on the last line) becomes a blank end marker.
    if (line.end != null && line.end > line.start && !wordsCoverEnd) {
      const next = lines[i + 1];
      const nextStart = next && next.start != null ? next.start : null;
      if (nextStart == null ? next == null : line.end < nextStart - 0.01) out.push(`[${formatLrcTime(line.end)}]`);
    }
  }
  return out.join("\n") + (out.length ? "\n" : "");
}

// ---------------------------------------------------------------------------
// Rough timing for untimed lines
// ---------------------------------------------------------------------------

interface Region {
  start: number;
  end: number;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

function median(values: number[]): number {
  return quantile(values, 0.5);
}

/**
 * Parts of the song that look like they carry vocals: skips a quiet intro/outro
 * and long near-silent stretches in the middle. Falls back to 8%..92% of the song.
 */
export function vocalRegions(analysis: AudioAnalysis | null, duration: number): Region[] {
  const fallback: Region[] = [{ start: duration * 0.08, end: duration * 0.92 }];
  if (!analysis || !Array.isArray(analysis.energy) || analysis.energy.length < 4) return fallback;
  const rate = analysis.envelopeRate;
  if (!(rate > 0) || !Number.isFinite(rate)) return fallback;

  const raw = analysis.energy.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const n = Math.min(raw.length, Math.ceil(duration * rate) || raw.length);
  if (n < 4) return fallback;
  // ~1.5 s moving average
  const half = Math.max(1, Math.round(rate * 0.75));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + raw[i];
  const smooth: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    smooth[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  const peak = quantile(smooth, 0.95);
  if (!(peak > 1e-6)) return fallback;

  const edgeThr = 0.3 * peak;
  const gapThr = 0.18 * peak;
  const first = smooth.findIndex((v) => v >= edgeThr);
  let last = n - 1;
  while (last >= 0 && smooth[last] < edgeThr) last--;
  if (first < 0 || last <= first) return fallback;

  let vocalStart = first / rate;
  let vocalEnd = Math.min(duration, (last + 1) / rate);

  // A clearly quieter first/last section is treated as instrumental intro/outro.
  const sections = (analysis.sections ?? []).filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  if (sections.length >= 3) {
    const med = median(sections.map((s) => s.energy));
    const head = sections[0];
    const tail = sections[sections.length - 1];
    if (head.energy < 0.75 * med && head.end - head.start < 30 && head.end < vocalEnd - 5) vocalStart = Math.max(vocalStart, head.end);
    if (tail.energy < 0.75 * med && tail.end - tail.start < 30 && tail.start > vocalStart + 5) vocalEnd = Math.min(vocalEnd, tail.start);
  }

  // Remove long (≥ 4 s) near-silent stretches inside [vocalStart, vocalEnd].
  const regions: Region[] = [];
  let regionStart = vocalStart;
  let quietFrom: number | null = null;
  const i0 = Math.floor(vocalStart * rate);
  const i1 = Math.min(n, Math.ceil(vocalEnd * rate));
  for (let i = i0; i <= i1; i++) {
    const quiet = i < i1 && smooth[i] < gapThr;
    if (quiet && quietFrom == null) quietFrom = i;
    if (!quiet && quietFrom != null) {
      const qs = quietFrom / rate;
      const qe = i / rate;
      if (qe - qs >= 4 && qs > regionStart) {
        regions.push({ start: regionStart, end: qs });
        regionStart = qe;
      }
      quietFrom = null;
    }
  }
  if (vocalEnd > regionStart) regions.push({ start: regionStart, end: vocalEnd });

  const total = regions.reduce((sum, r) => sum + (r.end - r.start), 0);
  if (total < duration * 0.25) return fallback;
  return regions.filter((r) => r.end - r.start >= 0.5);
}

/** Clip regions to [from, to]; when too little vocal area remains, use the plain window. */
function clipRegions(regions: Region[], from: number, to: number, count: number): Region[] {
  const clipped = regions
    .map((r) => ({ start: Math.max(r.start, from), end: Math.min(r.end, to) }))
    .filter((r) => r.end - r.start > 0.25);
  const active = clipped.reduce((s, r) => s + (r.end - r.start), 0);
  if (active < Math.max(0.35 * (to - from), count * 1.0)) return [{ start: from, end: to }];
  return clipped;
}

/** Map a position along the concatenated regions to song time. */
function mapPosition(regions: Region[], pos: number, bias: "start" | "end"): { time: number; region: number } {
  let acc = 0;
  for (let r = 0; r < regions.length; r++) {
    const len = regions[r].end - regions[r].start;
    const isLast = r === regions.length - 1;
    if (pos < acc + len || (bias === "end" && pos <= acc + len) || isLast) {
      return { time: regions[r].start + Math.min(len, Math.max(0, pos - acc)), region: r };
    }
    acc += len;
  }
  return { time: regions[regions.length - 1]?.end ?? 0, region: regions.length - 1 };
}

/** Assign start/end to consecutive lines inside [from, to], proportional to text length. */
function placeRun(lines: LyricLine[], regions: Region[], from: number, to: number): void {
  if (lines.length === 0) return;
  if (!(to > from)) {
    for (const l of lines) {
      l.start = round3(Math.max(0, from));
      l.end = null;
    }
    return;
  }
  const clipped = clipRegions(regions, from, to, lines.length);
  const total = clipped.reduce((s, r) => s + (r.end - r.start), 0);
  const weights = lines.map((l) => lineWeight(l.text));
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let k = 0; k < lines.length; k++) {
    const s = mapPosition(clipped, (acc / sum) * total, "start");
    acc += weights[k];
    const e = mapPosition(clipped, (acc / sum) * total, "end");
    const end = e.region === s.region ? e.time : clipped[s.region].end;
    lines[k].start = round3(s.time);
    lines[k].end = round3(Math.max(end, s.time + 0.2));
    delete lines[k].words;
  }
}

export interface DistributeOptions {
  /** the aligner's parameters (the evaluation harness tunes them) */
  align?: Partial<AlignParams>;
}

/** The analysis's 人聲 curve when it can carry an alignment, else null. */
function usableVocal(analysis: AudioAnalysis | null, duration: number): { curve: number[]; rate: number } | null {
  const curve = analysis?.vocal;
  const rate = analysis?.envelopeRate ?? 0;
  if (!Array.isArray(curve) || !(rate > 0) || curve.length < Math.min(duration * rate * 0.5, rate * 8)) return null;
  return { curve, rate };
}

/** Give untimed lines rough start/end times spread across the vocal-looking parts of the song. */
export function distributeLines(lyrics: Lyrics, analysis: AudioAnalysis | null, duration: number, options: DistributeOptions = {}): Lyrics {
  const lines: LyricLine[] = (lyrics?.lines ?? []).map((l) => ({ ...l, words: l.words?.map((w) => ({ ...w })) }));
  if (!lines.some((l) => l.start == null)) return normalizeLyrics({ ...lyrics, lines });

  let dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (!dur && analysis && analysis.duration > 0) dur = analysis.duration;
  const lastTimed = Math.max(0, ...lines.map((l) => (l.start == null ? 0 : l.end ?? l.start)));
  if (!dur) dur = Math.max(lastTimed + 10, (lines.length * 4) / 0.84);

  // today's proportional spread: the result without a 人聲 curve, and with one the aligner's prior
  // (a misleading curve never moves a whole song) and its fallback for a run it cannot carry
  const spread = lines.map((l) => ({ ...l, words: l.words?.map((w) => ({ ...w })) }));
  spreadRuns(spread, analysis, dur);
  const vocal = usableVocal(analysis, dur);
  if (!vocal) return normalizeLyrics({ ...lyrics, lines: spread, timing: "estimated" });

  const alignParams: AlignParams = { ...DEFAULT_ALIGN, ...options.align };
  // the song's singing rate (sung seconds per weight unit) over every line, timed or not
  const allWeight = lines.reduce((s, l) => s + lineWeight(l.text), 0);
  const songRate = allWeight > 0 ? sungSeconds(vocal.curve, vocal.rate, 0, dur, alignParams) / allWeight : 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].start != null) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].start == null) j++;
    const run = lines.slice(i, j + 1);
    const prev = i > 0 ? lines[i - 1] : null;
    const next = j + 1 < lines.length ? lines[j + 1] : null;
    // the 人聲 curve: lay the run over the phrases between its timed neighbours, in order
    const ps = prev ? (prev.start as number) : 0;
    const to = next ? (next.start as number) : dur;
    const prevEnds = prev != null && prev.end != null && prev.end > ps && prev.end < to;
    const res =
      to > ps
        ? alignRun(
            {
              curve: vocal.curve,
              rate: vocal.rate,
              from: prevEnds ? (prev.end as number) : ps,
              to,
              prev: prev && !prevEnds ? { weight: lineWeight(prev.text) } : null,
              hasNext: next != null,
              // an open run (no timed line on one side) keeps near the proportional spread; between
              // two timed lines the window itself bounds it
              lines: run.map((l, k) => ({ weight: lineWeight(l.text), prior: prev && next ? undefined : (spread[i + k].start ?? undefined) })),
              songRate: songRate > 0 ? songRate : undefined,
            },
            alignParams,
          )
        : null;
    run.forEach((l, k) => {
      l.start = res ? res.starts[k] : spread[i + k].start;
      l.end = res ? res.ends[k] : spread[i + k].end;
      delete l.words;
    });
    if (prev && !prevEnds) {
      if (res && res.prevEnd != null) prev.end = res.prevEnd;
      else if (!res) prev.end = spread[i - 1].end;
    }
    i = j + 1;
  }

  // the times are a guess: the song is not synced until the operator taps it (對拍)
  return normalizeLyrics({ ...lyrics, lines, timing: "estimated" });
}

/** Today's proportional spread of every untimed run over the loudness-based vocal regions (mutates `lines`). */
function spreadRuns(lines: LyricLine[], analysis: AudioAnalysis | null, dur: number): void {
  const regions = vocalRegions(analysis, dur);
  const vocalStart = regions[0].start;
  const vocalEnd = regions[regions.length - 1].end;
  const MIN_PER_LINE = 1.5;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].start != null) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].start == null) j++;
    const run = lines.slice(i, j + 1);
    const prev = i > 0 ? lines[i - 1] : null;
    const next = j + 1 < lines.length ? lines[j + 1] : null;
    const count = run.length;

    let to = next ? (next.start as number) : Math.max(vocalEnd, 0);
    let from: number;
    if (prev) {
      const ps = prev.start as number;
      if (!next && to - ps < (count + 1) * MIN_PER_LINE) to = Math.min(dur, Math.max(to, ps + (count + 1) * 3));
      if (!next && to <= ps) to = Math.max(dur, ps + (count + 1) * 3);
      if (prev.end != null && prev.end > ps && prev.end <= to) {
        from = prev.end;
      } else {
        // the previous line keeps a share of the window proportional to its length
        const wPrev = lineWeight(prev.text);
        const wRun = run.reduce((s, l) => s + lineWeight(l.text), 0);
        from = ps + ((to - ps) * wPrev) / (wPrev + wRun);
        prev.end = round3(from);
      }
    } else {
      from = Math.min(vocalStart, to);
      if (next && to - from < count * MIN_PER_LINE) from = Math.max(0, to - count * MIN_PER_LINE);
    }
    placeRun(run, regions, from, Math.max(from, to));
    i = j + 1;
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function sanitizeWords(words: unknown, start: number): LyricWord[] | undefined {
  if (!Array.isArray(words) || words.length === 0) return undefined;
  const out: LyricWord[] = [];
  for (const w of words as Array<Partial<LyricWord>>) {
    if (!w || typeof w.text !== "string") return undefined;
    if (!isTime(w.start)) return undefined;
    if (!w.text.trim()) {
      if (out.length) out[out.length - 1].text += " ";
      continue;
    }
    out.push({ text: w.text.replace(/[\t\r\n\f\v]+/g, " "), start: round3(Math.max(start, w.start)), end: isTime(w.end) ? round3(w.end) : NaN });
  }
  if (out.length === 0) return undefined;
  out.sort((a, b) => a.start - b.start);
  for (let k = 0; k < out.length; k++) {
    const nextStart = k + 1 < out.length ? out[k + 1].start : Infinity;
    let end = out[k].end;
    if (!(end > out[k].start)) end = Math.min(out[k].start + 0.3, nextStart);
    out[k].end = round3(Math.max(out[k].start, end));
  }
  return out;
}

/** Every line has a start time (real or estimated). */
export function allLinesTimed(lyrics: Pick<Lyrics, "lines"> | null | undefined): boolean {
  const lines = lyrics?.lines ?? [];
  return lines.length > 0 && lines.every((l) => l.start != null);
}

/** The lines' times were spread by `distributeLines` and not yet tapped / imported. */
export function timingEstimated(lyrics: Pick<Lyrics, "timing" | "lines"> | null | undefined): boolean {
  return !!lyrics && lyrics.timing === "estimated" && (lyrics.lines?.length ?? 0) > 0;
}

/**
 * Recompute `synced` and ids ("l0".."lN") after edits. `timing: "estimated"` is kept while every
 * line still has a time (a line without one leaves nothing estimated to flag).
 */
export function normalizeLyrics(lyrics: Lyrics): Lyrics {
  const source: LyricsSource = lyrics && VALID_SOURCES.includes(lyrics.source) ? lyrics.source : "user";
  const input: unknown[] = Array.isArray(lyrics?.lines) ? lyrics.lines.slice(0, MAX_LINES) : [];

  type Work = LyricLine & { order: number; key: number };
  const work: Work[] = [];
  let lastKey = -1;
  input.forEach((raw, order) => {
    if (!raw || typeof raw !== "object") return;
    const l = raw as Partial<LyricLine>;
    const text = typeof l.text === "string" ? cleanText(l.text) : "";
    if (!text) return;
    const start = isTime(l.start) ? round3(l.start) : null;
    const line: Work = { id: "", text, start, end: start != null && isTime(l.end) ? round3(l.end) : null, order, key: start ?? lastKey };
    if (start != null) lastKey = start;
    if (typeof l.translation === "string") {
      const tr = cleanText(l.translation);
      if (tr) line.translation = tr;
    }
    if (start != null) {
      const words = sanitizeWords(l.words, start);
      if (words) line.words = words;
    }
    work.push(line);
  });

  // Timed lines in time order; untimed lines stay after the timed line they followed.
  work.sort((a, b) => a.key - b.key || (a.start == null ? 1 : 0) - (b.start == null ? 1 : 0) || a.order - b.order);

  const lines: LyricLine[] = work.map((w, idx) => {
    const line: LyricLine = { id: `l${idx}`, text: w.text, start: w.start, end: w.end };
    if (w.translation) line.translation = w.translation;
    if (w.words) line.words = w.words;
    return line;
  });

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (line.start == null) {
      line.end = null;
      delete line.words;
      continue;
    }
    const next = lines[k + 1];
    const nextStart = next && next.start != null && next.start > line.start ? next.start : null;
    let end = line.end;
    if (end == null || end <= line.start) {
      const wordsEnd = line.words?.[line.words.length - 1]?.end;
      if (wordsEnd != null && wordsEnd > line.start) end = wordsEnd;
      else if (nextStart != null) end = Math.min(nextStart, line.start + MAX_DERIVED_LINE_SECONDS);
      else end = null;
    }
    if (end != null && nextStart != null && end > nextStart) end = nextStart;
    line.end = end == null ? null : round3(end);
    if (line.words && line.end != null) {
      const limit = line.end;
      for (const w of line.words) {
        if (w.end > limit + 0.5) w.end = round3(Math.max(w.start, limit));
      }
    }
  }

  const language = typeof lyrics?.language === "string" && lyrics.language.trim() ? lyrics.language.trim().slice(0, 20) : detectLanguage(lines.map((l) => l.text));
  const allTimed = lines.length > 0 && lines.every((l) => l.start != null);
  const estimated = allTimed && lyrics?.timing === "estimated";
  const out: Lyrics = { source, synced: allTimed && !estimated, lines };
  if (estimated) out.timing = "estimated";
  if (language) out.language = language;
  return out;
}

/** An empty lyrics object (instrumental / not found). */
export function emptyLyrics(source: LyricsSource = "none"): Lyrics {
  return { source, synced: false, lines: [] };
}
