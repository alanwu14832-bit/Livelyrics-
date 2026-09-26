// Song structure inference shared by the offline designer, the Claude prompts and
// normalizePlan: effective duration, lyric repetition clusters (chorus detection),
// section boundaries (audio novelty sections, refined by lyric structure; lyric gaps
// or an even split without analysis) and a section-kind guess per section.

import { lineSpan } from "@/lib/timeline";
import type { AudioAnalysis, Lyrics, SectionKind, SongMeta } from "@/lib/types";

export interface StructureInput {
  meta: Pick<SongMeta, "duration" | "title" | "artist">;
  lyrics: Lyrics;
  analysis: AudioAnalysis | null;
}

export interface LineInfo {
  index: number;
  id: string;
  text: string;
  /** effective span in seconds, null when untimed */
  start: number | null;
  end: number | null;
  /** cluster id = index of the first line of its repetition cluster */
  cluster: number;
  /** how many lines share this cluster (1 = unique) */
  repeats: number;
  /** number of distinct sections the cluster appears in (filled after segmentation) */
  sectionSpread: number;
}

export interface StructSection {
  start: number;
  end: number;
  /** 0..1 */
  energy: number;
  kind: SectionKind;
  lineIds: string[];
  /** 0..1 share of lines that belong to clusters repeated elsewhere in the song */
  repeatedRatio: number;
  /** CJK characters (or Latin words) per second of sung time; 0 without lines */
  density: number;
}

export interface SongStructure {
  duration: number;
  lines: LineInfo[];
  sections: StructSection[];
  /** most repeated cluster (the hook), or null */
  hookCluster: number | null;
  /** lyrics are predominantly CJK */
  cjk: boolean;
  /** mean section energy */
  meanEnergy: number;
  /** where the boundaries came from */
  source: "audio" | "lyrics" | "even";
}

const DEFAULT_DURATION = 180;
const MIN_SECTION = 4;
const MIN_SPLIT_PART = 6;
const LYRIC_GAP = 5;
const MAX_SIMILARITY_LINES = 600;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Effective song duration in seconds (analysis > meta > lyrics > default). */
export function resolveDuration(input: StructureInput): number {
  const a = input.analysis?.duration;
  if (isFiniteNumber(a) && a > 1) return a;
  const m = input.meta?.duration;
  if (isFiniteNumber(m) && m > 1) return m;
  let last = 0;
  for (const l of input.lyrics?.lines ?? []) {
    if (isFiniteNumber(l.end)) last = Math.max(last, l.end);
    if (isFiniteNumber(l.start)) last = Math.max(last, l.start + 6);
  }
  return last > 0 ? last + 4 : DEFAULT_DURATION;
}

const NON_WORD = new RegExp("[^\\p{L}\\p{N}]+", "gu");
const CJK_CHAR = new RegExp("[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]", "gu");
const LATIN_WORD = /[A-Za-zÀ-ɏ']+/g;

/** Comparison key for repetition detection: case/width-folded letters and digits only. */
export function lineKey(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(NON_WORD, "");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity of character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** Count of CJK characters plus Latin words (a "reading unit" count). */
export function readingUnits(text: string): number {
  const cjk = text.match(CJK_CHAR)?.length ?? 0;
  const latin = text.replace(CJK_CHAR, " ").match(LATIN_WORD)?.length ?? 0;
  return cjk + latin;
}

export function cjkShare(texts: readonly string[]): number {
  let cjk = 0;
  let letters = 0;
  for (const t of texts) {
    cjk += t.match(CJK_CHAR)?.length ?? 0;
    letters += t.replace(NON_WORD, "").length;
  }
  return letters ? cjk / letters : 0;
}

/** Mean of an analysis envelope over [start, end). */
export function meanEnvelope(analysis: AudioAnalysis | null, key: "energy" | "brightness" | "bass" | "onset", start: number, end: number): number | null {
  const arr = analysis?.[key];
  const rate = analysis?.envelopeRate;
  if (!arr || !arr.length || !isFiniteNumber(rate) || rate <= 0) return null;
  const i0 = clamp(Math.floor(start * rate), 0, arr.length - 1);
  const i1 = clamp(Math.ceil(end * rate), i0 + 1, arr.length);
  let sum = 0;
  let n = 0;
  for (let i = i0; i < i1; i++) {
    const v = arr[i];
    if (isFiniteNumber(v)) {
      sum += v;
      n++;
    }
  }
  return n ? clamp(sum / n, 0, 1) : null;
}

/** Coarse energy curve: one 0..1 value per `step` seconds. */
export function energyCurve(analysis: AudioAnalysis | null, duration: number, step = 2): number[] {
  if (!analysis?.energy?.length) return [];
  const out: number[] = [];
  for (let t = 0; t < duration; t += step) {
    const v = meanEnvelope(analysis, "energy", t, Math.min(duration, t + step));
    out.push(v == null ? 0 : Math.round(v * 100) / 100);
  }
  return out;
}

// ---------------------------------------------------------------------------
// repetition clusters
// ---------------------------------------------------------------------------

function clusterLines(keys: string[]): number[] {
  const parent = keys.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const byKey = new Map<string, number>();
  keys.forEach((k, i) => {
    if (k.length < 2) return;
    const prev = byKey.get(k);
    if (prev != null) union(prev, i);
    else byKey.set(k, i);
  });
  if (keys.length <= MAX_SIMILARITY_LINES) {
    const uniq = [...byKey.entries()];
    for (let a = 0; a < uniq.length; a++) {
      const [ka, ia] = uniq[a];
      if (ka.length < 4) continue;
      for (let b = a + 1; b < uniq.length; b++) {
        const [kb, ib] = uniq[b];
        if (kb.length < 4 || Math.abs(ka.length - kb.length) > Math.max(ka.length, kb.length) * 0.35) continue;
        if (similarity(ka, kb) >= 0.78) union(ia, ib);
      }
    }
  }
  return keys.map((_, i) => find(i));
}

// ---------------------------------------------------------------------------
// segmentation
// ---------------------------------------------------------------------------

interface Span {
  start: number;
  end: number;
  energy: number | null;
}

/** Sort, clamp and make spans cover [0, duration] contiguously. */
export function coverSpans<T extends { start: number; end: number }>(spans: T[], duration: number): T[] {
  const valid = spans
    .filter((s) => isFiniteNumber(s.start) && isFiniteNumber(s.end))
    .map((s) => ({ ...s, start: clamp(Math.min(s.start, s.end), 0, duration), end: clamp(Math.max(s.start, s.end), 0, duration) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: T[] = [];
  for (const s of valid) {
    const prev = out[out.length - 1];
    if (prev && s.start - prev.start < 1e-6) continue; // duplicate start
    out.push(s);
  }
  if (!out.length) return out;
  out[0].start = 0;
  for (let i = 0; i < out.length - 1; i++) out[i].end = out[i + 1].start;
  out[out.length - 1].end = duration;
  return out.filter((s) => s.end - s.start > 1e-6);
}

/** Merge spans shorter than `min` seconds into their closer-energy neighbour. */
function mergeShort(spans: Span[], min: number): Span[] {
  const out = spans.map((s) => ({ ...s }));
  for (let guard = 0; guard < 1000 && out.length > 1; guard++) {
    let idx = -1;
    let shortest = min;
    out.forEach((s, i) => {
      const d = s.end - s.start;
      if (d < shortest) {
        shortest = d;
        idx = i;
      }
    });
    if (idx < 0) break;
    const s = out[idx];
    const prev = out[idx - 1];
    const next = out[idx + 1];
    const energyGap = (o: Span | undefined) => (o ? Math.abs((o.energy ?? 0.5) - (s.energy ?? 0.5)) : Infinity);
    const into = !prev ? idx + 1 : !next ? idx - 1 : energyGap(prev) <= energyGap(next) ? idx - 1 : idx + 1;
    const target = out[into];
    const total = target.end - target.start + (s.end - s.start);
    const energy =
      target.energy == null || s.energy == null
        ? (target.energy ?? s.energy)
        : (target.energy * (target.end - target.start) + s.energy * (s.end - s.start)) / Math.max(1e-6, total);
    target.start = Math.min(target.start, s.start);
    target.end = Math.max(target.end, s.end);
    target.energy = energy;
    out.splice(idx, 1);
  }
  return out;
}

function audioSpans(analysis: AudioAnalysis, duration: number): Span[] {
  const raw = (analysis.sections ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    energy: isFiniteNumber(s.energy) ? clamp(s.energy, 0, 1) : null,
  }));
  return mergeShort(coverSpans(raw, duration), MIN_SECTION);
}

function isChorusLine(l: LineInfo): boolean {
  return l.repeats >= 2;
}

/** Split spans where lyrics switch between unique and repeated lines (a missed verse/chorus boundary). */
function splitByRepetition(spans: Span[], lines: LineInfo[], depth = 0): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const inside = lines.filter((l) => l.start != null && l.start >= span.start && l.start < span.end);
    let cut: number | null = null;
    let best = 0.75;
    for (let i = 1; i < inside.length; i++) {
      const t = inside[i].start as number;
      if (t - span.start < MIN_SPLIT_PART || span.end - t < MIN_SPLIT_PART) continue;
      const a = inside.slice(0, i);
      const b = inside.slice(i);
      const score = Math.abs(a.filter(isChorusLine).length / a.length - b.filter(isChorusLine).length / b.length);
      if (score >= best) {
        best = score;
        cut = t;
      }
    }
    if (cut == null) out.push(span);
    else {
      const parts = [
        { start: span.start, end: cut, energy: span.energy },
        { start: cut, end: span.end, energy: span.energy },
      ];
      out.push(...(depth < 3 ? splitByRepetition(parts, lines, depth + 1) : parts));
    }
  }
  return out;
}

function lyricSpans(lines: LineInfo[], duration: number): Span[] {
  const timed = lines.filter((l) => l.start != null && l.end != null);
  if (!timed.length) return [];
  const blocks: LineInfo[][] = [];
  for (const l of timed) {
    const block = blocks[blocks.length - 1];
    const prev = block?.[block.length - 1];
    const gap = prev ? (l.start as number) - (prev.end as number) : Infinity;
    const repeatSwitch = prev && block.length >= 2 && isChorusLine(l) !== isChorusLine(prev) && isChorusLine(l) === isChorusLine(timed[timed.indexOf(l) + 1] ?? l);
    if (!block || gap >= LYRIC_GAP || repeatSwitch) blocks.push([l]);
    else block.push(l);
  }
  const spans: Span[] = [];
  let cursor = 0;
  for (const block of blocks) {
    const bs = block[0].start as number;
    const be = block[block.length - 1].end as number;
    if (bs - cursor >= 2) spans.push({ start: cursor, end: bs, energy: null });
    spans.push({ start: Math.max(cursor, bs), end: be, energy: null });
    cursor = be;
  }
  if (duration - cursor >= 2) spans.push({ start: cursor, end: duration, energy: null });
  return mergeShort(coverSpans(spans, duration), MIN_SECTION);
}

function evenSpans(duration: number): Span[] {
  const n = clamp(Math.round(duration / 22), 3, 12);
  const step = duration / n;
  return Array.from({ length: n }, (_, i) => ({ start: i * step, end: (i + 1) * step, energy: null }));
}

/** Typical pop form resampled to n sections (used when nothing is timed). */
function formTemplate(n: number): SectionKind[] {
  if (n <= 3) return (["intro", "chorus", "outro"] as SectionKind[]).slice(0, n);
  const body: SectionKind[] = ["verse", "pre-chorus", "chorus", "verse", "chorus", "bridge", "chorus", "chorus", "verse", "chorus"];
  return ["intro", ...body.slice(0, n - 2), "outro"];
}

const KIND_ENERGY: Record<SectionKind, number> = {
  intro: 0.3,
  verse: 0.48,
  "pre-chorus": 0.62,
  chorus: 0.85,
  bridge: 0.5,
  solo: 0.78,
  breakdown: 0.3,
  outro: 0.32,
  interlude: 0.45,
};

export function defaultKindEnergy(kind: SectionKind): number {
  return KIND_ENERGY[kind];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function analyzeStructure(input: StructureInput): SongStructure {
  const duration = resolveDuration(input);
  const rawLines = Array.isArray(input.lyrics?.lines) ? input.lyrics.lines : [];
  const keys = rawLines.map((l) => lineKey(l.text));
  const clusters = clusterLines(keys);
  const clusterSize = new Map<number, number>();
  clusters.forEach((c, i) => {
    if (keys[i].length >= 2) clusterSize.set(c, (clusterSize.get(c) ?? 0) + 1);
  });

  const lines: LineInfo[] = rawLines.map((l, i) => {
    const span = lineSpan(rawLines, i, duration);
    return {
      index: i,
      id: l.id,
      text: l.text,
      start: span ? span[0] : null,
      end: span ? Math.min(span[1], duration) : null,
      cluster: clusters[i],
      repeats: keys[i].length >= 2 ? (clusterSize.get(clusters[i]) ?? 1) : 1,
      sectionSpread: 0,
    };
  });

  const hasTiming = lines.some((l) => l.start != null);
  let source: SongStructure["source"];
  let spans: Span[];
  const audio = input.analysis && input.analysis.sections?.length ? audioSpans(input.analysis, duration) : [];
  if (audio.length >= 2) {
    source = "audio";
    spans = mergeShort(splitByRepetition(audio, lines), MIN_SECTION);
  } else if (hasTiming) {
    source = "lyrics";
    spans = lyricSpans(lines, duration);
  } else {
    source = "even";
    spans = evenSpans(duration);
  }
  if (!spans.length) spans = [{ start: 0, end: duration, energy: null }];

  // energy per span: analysis envelope > section guess > filled later from kind
  for (const s of spans) {
    const env = meanEnvelope(input.analysis, "energy", s.start, s.end);
    if (env != null) s.energy = s.energy == null ? env : (s.energy + env) / 2;
  }

  const inSpan = (l: LineInfo, s: Span) => l.start != null && l.start >= s.start && l.start < s.end;
  const spanLines = spans.map((s) => lines.filter((l) => inSpan(l, s)));
  const clusterSpans = new Map<number, Set<number>>();
  spanLines.forEach((ls, si) =>
    ls.forEach((l) => {
      const set = clusterSpans.get(l.cluster) ?? new Set<number>();
      set.add(si);
      clusterSpans.set(l.cluster, set);
    }),
  );
  for (const l of lines) l.sectionSpread = clusterSpans.get(l.cluster)?.size ?? 0;

  const repeatedElsewhere = (l: LineInfo) => l.repeats >= 2 && (l.sectionSpread >= 2 || l.repeats >= 3);
  const known = spans.map((s) => s.energy).filter(isFiniteNumber);
  const meanEnergy = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0.5;

  const sections: StructSection[] = spans.map((s, i) => {
    const ls = spanLines[i];
    const repeatedRatio = ls.length ? ls.filter(repeatedElsewhere).length / ls.length : 0;
    let sung = 0;
    let units = 0;
    for (const l of ls) {
      units += readingUnits(l.text);
      if (l.start != null && l.end != null) sung += Math.max(0.5, l.end - l.start);
    }
    return {
      start: s.start,
      end: s.end,
      energy: s.energy ?? NaN,
      kind: "verse",
      lineIds: ls.map((l) => l.id),
      repeatedRatio,
      density: sung > 0 ? units / sung : 0,
    };
  });

  assignKinds(sections, source, meanEnergy);
  for (const s of sections) {
    if (!isFiniteNumber(s.energy)) s.energy = KIND_ENERGY[s.kind];
    s.energy = Math.round(clamp(s.energy, 0, 1) * 100) / 100;
    s.start = round3(s.start);
    s.end = round3(s.end);
  }

  let hookCluster: number | null = null;
  let hookCount = 1;
  for (const l of lines) {
    if (l.repeats > hookCount) {
      hookCount = l.repeats;
      hookCluster = l.cluster;
    }
  }

  return {
    duration,
    lines,
    sections,
    hookCluster,
    cjk: cjkShare(rawLines.map((l) => l.text)) >= 0.3,
    meanEnergy: sections.reduce((a, s) => a + s.energy, 0) / sections.length,
    source,
  };
}

function assignKinds(sections: StructSection[], source: SongStructure["source"], meanEnergy: number) {
  const n = sections.length;
  const anyLyrics = sections.some((s) => s.lineIds.length > 0);

  if (source === "even" || !anyLyrics) {
    if (source === "even") {
      const form = formTemplate(n);
      sections.forEach((s, i) => (s.kind = form[i]));
      return;
    }
    // audio only (untimed lyrics): rank by energy
    const sorted = sections.map((s) => s.energy).filter(isFiniteNumber).sort((a, b) => b - a);
    const hot = sorted[Math.max(0, Math.floor(sorted.length * 0.35) - 1)] ?? 1;
    sections.forEach((s, i) => {
      const e = isFiniteNumber(s.energy) ? s.energy : meanEnergy;
      if (i === 0 && n > 2 && e <= meanEnergy) s.kind = "intro";
      else if (i === n - 1 && n > 2 && e <= meanEnergy + 0.05) s.kind = "outro";
      else if (e >= hot && e >= meanEnergy) s.kind = "chorus";
      else if (e < meanEnergy - 0.15) s.kind = "breakdown";
      else s.kind = "verse";
    });
    return;
  }

  let chorusFound = false;
  sections.forEach((s) => {
    if (s.lineIds.length && s.repeatedRatio >= 0.5) {
      s.kind = "chorus";
      chorusFound = true;
    }
  });
  if (!chorusFound) {
    // through-composed song: the most energetic sung sections carry the hook
    const sung = sections.filter((s) => s.lineIds.length && isFiniteNumber(s.energy));
    const top = Math.max(...sung.map((s) => s.energy), -1);
    for (const s of sung) if (s.energy >= Math.max(meanEnergy + 0.1, top - 0.08)) s.kind = "chorus";
  }

  sections.forEach((s, i) => {
    if (s.lineIds.length) return;
    const e = isFiniteNumber(s.energy) ? s.energy : meanEnergy;
    if (i === 0) s.kind = "intro";
    else if (i === n - 1) s.kind = "outro";
    else if (e >= Math.max(0.6, meanEnergy + 0.15)) s.kind = "solo";
    else if (e <= meanEnergy - 0.12) s.kind = "breakdown";
    else s.kind = "interlude";
  });

  let chorusesSeen = 0;
  sections.forEach((s, i) => {
    if (s.kind === "chorus") {
      chorusesSeen++;
      return;
    }
    if (!s.lineIds.length || s.kind !== "verse") return;
    const next = sections[i + 1];
    const prev = sections[i - 1];
    const dur = s.end - s.start;
    const quiet = isFiniteNumber(s.energy) && s.energy <= meanEnergy - 0.12;
    if (i > 0 && i < n - 1 && quiet && s.lineIds.length <= 2 && chorusesSeen >= 1) s.kind = "breakdown";
    else if (next?.kind === "chorus" && prev?.kind === "verse" && dur <= 16) s.kind = "pre-chorus";
    else if (chorusesSeen >= 1 && s.repeatedRatio === 0 && s.start >= sections[n - 1].end * 0.55 && sections.slice(i + 1).some((x) => x.kind === "chorus"))
      s.kind = "bridge";
    else if (i === n - 1 && chorusesSeen >= 1 && isFiniteNumber(s.energy) && s.energy <= meanEnergy) s.kind = "outro";
  });
}
