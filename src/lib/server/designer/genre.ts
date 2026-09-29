// Genre matching for the free research: the MusicBrainz genres / tags of the artist and the
// recording, the artist's disambiguation ("Texas post-rock"), and the genre words of the Wikipedia
// summaries (「臺灣的獨立搖滾樂團」, "American post-rock band") become scored GenreRule matches,
// each with the evidence that decided it. Deterministic; general words ("rock", 「搖滾」) only count
// a little, so a specific genre wins whenever the sources name one.

import type { MbTag, PublicInfo } from "@/lib/types";
import { toTraditional } from "@/lib/zh-variants";
import { GENERAL_TAGS, GENRE_RULES, type GenreRule } from "./lexicon/genres";

export interface GenreMatch {
  rule: GenreRule;
  score: number;
  /** what decided it, for the brief, e.g. 「MusicBrainz 曲風：indie rock」 */
  evidence: string[];
}

/** Case-, space- and hyphen-insensitive key of a tag. */
export function tagKey(tag: string): string {
  return tag
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010-\u2015_]/g, "-")
    .replace(/[^a-z0-9&\u3400-\u9fff]+/g, "");
}

interface TagEntry {
  key: string;
  rule: GenreRule;
  general: boolean;
}

const TAG_INDEX: ReadonlyMap<string, TagEntry[]> = (() => {
  const map = new Map<string, TagEntry[]>();
  for (const rule of GENRE_RULES) {
    for (const t of rule.tags) {
      const key = tagKey(t);
      const list = map.get(key) ?? [];
      if (!list.some((e) => e.rule === rule)) list.push({ key, rule, general: GENERAL_TAGS.has(t) });
      map.set(key, list);
    }
  }
  return map;
})();

const ZH_KEYWORDS: ReadonlyArray<{ word: string; rule: GenreRule; general: boolean }> = GENRE_RULES.flatMap((rule) => rule.zh.map((word) => ({ word, rule, general: GENERAL_TAGS.has(word) }))).sort(
  (a, b) => b.word.length - a.word.length || Number(a.general) - Number(b.general),
);

const EN_PHRASES: ReadonlyArray<{ phrase: string; rule: GenreRule }> = GENRE_RULES.flatMap((rule) => rule.tags.filter((t) => !GENERAL_TAGS.has(t) && t.length >= 4).map((phrase) => ({ phrase: phrase.toLowerCase(), rule })));

const GENERAL_WEIGHT = 0.35;

class Scores {
  private readonly map = new Map<GenreRule, GenreMatch>();
  add(rule: GenreRule, score: number, evidence: string) {
    const m = this.map.get(rule) ?? { rule, score: 0, evidence: [] };
    m.score += score;
    if (!m.evidence.includes(evidence) && m.evidence.length < 4) m.evidence.push(evidence);
    this.map.set(rule, m);
  }
  list(): GenreMatch[] {
    return [...this.map.values()].sort((a, b) => b.score - a.score || GENRE_RULES.indexOf(a.rule) - GENRE_RULES.indexOf(b.rule));
  }
}

function addTags(scores: Scores, tags: readonly MbTag[], weight: number, label: string) {
  for (const t of tags) {
    const entries = TAG_INDEX.get(tagKey(t.name));
    if (!entries) continue;
    const w = weight * (1 + Math.log2(Math.max(1, t.count)));
    for (const e of entries) scores.add(e.rule, e.general ? w * GENERAL_WEIGHT : w, `${label}：${t.name}`);
  }
}

/** Genre words in a Chinese text, longest first; a word inside a longer match does not count again. */
function zhMatches(text: string): Array<{ word: string; rule: GenreRule; general: boolean }> {
  const t = toTraditional(text);
  const taken: Array<[number, number]> = [];
  const out: Array<{ word: string; rule: GenreRule; general: boolean }> = [];
  for (const k of ZH_KEYWORDS) {
    let at = t.indexOf(k.word);
    while (at >= 0) {
      const end = at + k.word.length;
      if (!taken.some(([a, b]) => at < b && end > a)) {
        taken.push([at, end]);
        if (!out.some((o) => o.rule === k.rule)) out.push(k);
      }
      at = t.indexOf(k.word, at + 1);
    }
  }
  return out;
}

function enMatches(text: string): Array<{ phrase: string; rule: GenreRule }> {
  const t = ` ${text.toLowerCase().replace(/[\u2010-\u2015]/g, "-")} `;
  const out: Array<{ phrase: string; rule: GenreRule }> = [];
  for (const p of EN_PHRASES) {
    const re = new RegExp(`[^a-z]${p.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ -]/g, "[ -]?")}[^a-z]`);
    if (re.test(t) && !out.some((o) => o.rule === p.rule)) out.push(p);
  }
  return out;
}

/** Scored genre matches from the public facts (strongest first; [] when nothing names a genre). */
export function matchGenres(info: PublicInfo | null | undefined): GenreMatch[] {
  if (!info) return [];
  const scores = new Scores();
  const artist = info.musicbrainz?.artist;
  if (artist) {
    addTags(scores, artist.genres, 1.5, "MusicBrainz 曲風");
    addTags(scores, artist.tags.filter((t) => !artist.genres.some((g) => g.name === t.name)), 1, "MusicBrainz 標籤");
    if (artist.disambiguation) {
      const d = tagKey(artist.disambiguation);
      for (const [key, entries] of TAG_INDEX) {
        if (key.length < 5 || !d.includes(key)) continue;
        for (const e of entries) if (!e.general) scores.add(e.rule, 1.5, `MusicBrainz 說明：${artist.disambiguation}`);
      }
    }
  }
  const rec = info.musicbrainz?.recording;
  if (rec) addTags(scores, rec.tags, 1, "MusicBrainz 歌曲標籤");
  const pages = [info.wikipedia?.artist, info.wikipedia?.song].filter((p) => p != null);
  for (const p of pages) {
    const where = `維基百科〈${p!.title}〉`;
    const desc = p!.description ?? "";
    const lead = p!.extract.slice(0, 260);
    if (p!.lang === "zh") {
      for (const m of zhMatches(desc)) scores.add(m.rule, m.general ? 1.5 * GENERAL_WEIGHT : 1.5, `${where}：${m.word}`);
      for (const m of zhMatches(lead)) scores.add(m.rule, m.general ? GENERAL_WEIGHT : 1, `${where}：${m.word}`);
    } else {
      for (const m of enMatches(desc)) scores.add(m.rule, 1.5, `${where}：${m.phrase}`);
      for (const m of enMatches(lead)) scores.add(m.rule, 1, `${where}：${m.phrase}`);
    }
  }
  return scores
    .list()
    .filter((m) => m.score >= 0.9)
    .slice(0, 3);
}
