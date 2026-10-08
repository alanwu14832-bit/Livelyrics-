// Lyric-timing evaluation (round 14). Two parts:
//  - unit tests of the metric helpers (synthetic, always on);
//  - the measurement harness, skipped unless LIVELYRICS_TIMING_EVAL_DIR points at a JamendoLyrics
//    MultiLang copy (mp3/, lyrics/*.txt, annotations/lines/*.csv, JamendoLyrics.csv) and the WAV
//    cache written by `node scripts/timing-eval/decode.cjs <dataset> <cache>` exists:
//
//      LIVELYRICS_TIMING_EVAL_DIR=<dataset> LIVELYRICS_TIMING_EVAL_CACHE=<wav cache> \
//        npx vitest run src/lib/lyrics/timing-eval.test.ts
//
//    It runs the repo's real analysis (analyzeSamples) on every song and the timing estimators,
//    prints the summary and writes the full report (default scratch/round14/timing-eval.md).
//    Local measurement only: never commit dataset audio, lyrics or annotations.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSIS_RATE, analyzeSamples } from "../audio/analysis";
import { downsample, removeDc } from "../audio/resample";
import { analyzeVocal, sideRateFor, sideSignal } from "../audio/vocal";
import type { AudioAnalysis, LyricLine, Lyrics } from "../types";
import { distributeLines, normalizeLyrics } from "./lrc";
import {
  SUMMARY_HEADER,
  evalSplit,
  lyricParagraphs,
  oracleVocal,
  parseLineAnnotations,
  scoreSong,
  songMedian,
  summarize,
  summaryRow,
  vocalAuc,
  type AnnotatedLine,
  type SongScore,
} from "./timing-eval";

// ---------------------------------------------------------------------------
// helpers (always on)
// ---------------------------------------------------------------------------

describe("timing-eval helpers", () => {
  it("parses line annotations (header, commas in the text)", () => {
    const rows = parseLineAnnotations("start_time,end_time,lyrics_line\n1.5,2.25,hello, world\n\n3,4,again\n");
    expect(rows).toEqual([
      { start: 1.5, end: 2.25, text: "hello, world" },
      { start: 3, end: 4, text: "again" },
    ]);
  });

  it("finds paragraph starts from blank lines, and from double blanks in a double-spaced file", () => {
    expect(lyricParagraphs("a\nb\n\nc\nd\n\n\ne\n").paragraphStarts).toEqual([0, 2, 4]);
    const spaced = "a\n\nb\n\nc\n\n\n\nd\n\ne\n\nf\n";
    expect(lyricParagraphs(spaced)).toEqual({ lines: ["a", "b", "c", "d", "e", "f"], paragraphStarts: [0, 3] });
  });

  it("splits by a stable hash", () => {
    expect(evalSplit("song-a")).toBe(evalSplit("song-a"));
    const names = Array.from({ length: 200 }, (_, i) => `song ${i}`);
    const dev = names.filter((n) => evalSplit(n) === "dev").length;
    expect(dev).toBeGreaterThan(70);
    expect(dev).toBeLessThan(130);
  });

  it("scores start errors and the time the right line is on screen", () => {
    const ann: AnnotatedLine[] = [
      { start: 10, end: 12, text: "a" },
      { start: 14, end: 16, text: "b" },
    ];
    const est: Lyrics = normalizeLyrics({
      source: "user",
      synced: false,
      lines: [
        { id: "", text: "a", start: 10.5, end: 13 },
        { id: "", text: "b", start: 15, end: 16 },
      ],
    });
    const s = scoreSong(est, ann, 30);
    expect(s.errors).toEqual([0.5, 1]);
    // line a: 10.5–12 of 10–12 right; line b: 15–16 of 14–16 right
    expect(s.rightSeconds / s.sungSeconds).toBeCloseTo(2.5 / 4, 1);
    const sum = summarize([s]);
    expect(sum.within05).toBe(0.5);
    expect(sum.within1).toBe(1);
    expect(songMedian(s)).toBeCloseTo(0.75);
    // anchors are left out
    expect(scoreSong(est, ann, 30, new Set([0])).errors).toEqual([1]);
  });

  it("the oracle curve is the annotated sung time; a perfect curve has AUC 1, a flat one 0.5", () => {
    const ann: AnnotatedLine[] = [{ start: 1, end: 2, text: "a" }];
    const curve = oracleVocal(ann, 4, 10);
    expect(curve.length).toBe(41);
    expect(curve[15]).toBe(1);
    expect(curve[30]).toBe(0);
    expect(vocalAuc(curve, ann, 10)).toBe(1);
    expect(vocalAuc(curve.map(() => 0.3), ann, 10)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// the harness (local only)
// ---------------------------------------------------------------------------

const DIR = process.env.LIVELYRICS_TIMING_EVAL_DIR ?? "";
const REPO = path.resolve(__dirname, "../../..");
const CACHE = process.env.LIVELYRICS_TIMING_EVAL_CACHE ?? path.join(REPO, "scratch/round14/wav");
const OUT = process.env.LIVELYRICS_TIMING_EVAL_OUT ?? path.join(REPO, "scratch/round14/timing-eval.md");
const ONLY = process.env.LIVELYRICS_TIMING_EVAL_ONLY ?? "";
const ENABLED = !!DIR && fs.existsSync(path.join(DIR, "annotations", "lines")) && fs.existsSync(CACHE);

interface Wav {
  rate: number;
  left: Float32Array;
  right: Float32Array | null;
}

function readWav(file: string): Wav {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${file}: not a WAV file`);
  let pos = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16 || channels < 1 || channels > 2) throw new Error(`${file}: expected 16-bit mono / stereo PCM`);
      const n = Math.floor(Math.min(size, buf.length - body) / (2 * channels));
      const bytes = buf.subarray(body, body + n * 2 * channels);
      // little-endian hosts only (every machine this runs on); copy when the view would be unaligned
      const pcm = (bytes.byteOffset & 1) === 0 ? new Int16Array(bytes.buffer, bytes.byteOffset, n * channels) : new Int16Array(Uint8Array.from(bytes).buffer);
      const left = new Float32Array(n);
      const right = channels === 2 ? new Float32Array(n) : null;
      for (let i = 0; i < n; i++) {
        left[i] = pcm[i * channels] / 32768;
        if (right) right[i] = pcm[i * 2 + 1] / 32768;
      }
      return { rate, left, right };
    }
    pos = body + size + (size & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

/** The analysis cache key: the analysis code itself (any change re-analyses every song). */
function analysisCodeKey(): string {
  const dir = path.join(REPO, "src/lib/audio");
  const h = createHash("sha1");
  for (const f of fs.readdirSync(dir).sort()) {
    if (f.endsWith(".ts") && !f.endsWith(".test.ts")) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  }
  return h.digest("hex").slice(0, 10);
}

function analyse(stem: string, key: string): { analysis: AudioAnalysis; seconds: number; cached: boolean } {
  const cacheFile = path.join(CACHE, `${stem}.analysis-${key}.json`);
  if (fs.existsSync(cacheFile)) return { analysis: JSON.parse(fs.readFileSync(cacheFile, "utf8")) as AudioAnalysis, seconds: 0, cached: true };
  const wav = readWav(path.join(CACHE, `${stem}.wav`));
  const mono = monoOf(wav);
  const t0 = performance.now();
  // the upload's own path: the mono downmix, and the side signal of a stereo file (analyzeFile)
  const side = wav.right ? sideSignal(wav.left, wav.right, wav.rate) : null;
  const analysis = analyzeSamples(mono, wav.rate, { side, sideRate: sideRateFor(wav.rate) });
  const seconds = (performance.now() - t0) / 1000;
  fs.writeFileSync(cacheFile, JSON.stringify(analysis));
  return { analysis, seconds, cached: false };
}

function monoOf(wav: Wav): Float32Array {
  const mono = new Float32Array(wav.left.length);
  if (wav.right) for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (wav.left[i] + wav.right[i]);
  else mono.set(wav.left);
  return mono;
}

/** The same song's curve without the side signal (what a mono upload gets), reusing its envelopes. */
function monoCurve(stem: string, a: AudioAnalysis): number[] {
  const wav = readWav(path.join(CACHE, `${stem}.wav`));
  const mono = monoOf(wav);
  const x = wav.rate > ANALYSIS_RATE ? downsample(mono, wav.rate, ANALYSIS_RATE) : mono;
  const sr = Math.min(wav.rate, ANALYSIS_RATE);
  const n = a.energy.length;
  return Array.from(analyzeVocal(removeDc(x, sr), sr, null, sr, a, n, a.envelopeRate), (v) => Math.round(v * 10000) / 10000);
}

/** The input of an estimator: untimed lines, or the anchors' annotated starts with the rest untimed. */
function inputLyrics(texts: readonly string[], ann: readonly AnnotatedLine[], anchors: ReadonlySet<number>): Lyrics {
  const lines: LyricLine[] = texts.map((text, i) => ({ id: `l${i}`, text, start: anchors.has(i) ? ann[i].start : null, end: null }));
  return { source: "user", synced: false, lines };
}

/** No audio at all: the untimed lines of each run share its window equally. */
function uniform(lyrics: Lyrics, duration: number): Lyrics {
  const lines = lyrics.lines.map((l) => ({ ...l }));
  let i = 0;
  while (i < lines.length) {
    if (lines[i].start != null) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].start == null) j++;
    const prev = i > 0 ? (lines[i - 1].start as number) : null;
    const next = j + 1 < lines.length ? (lines[j + 1].start as number) : duration;
    const k = j - i + 1;
    // a run after a timed line leaves it its share; a leading run starts at 0
    const from = prev ?? 0;
    const step = (next - from) / (k + (prev != null ? 1 : 0));
    for (let m = 0; m < k; m++) lines[i + m].start = Math.round((from + step * (m + (prev != null ? 1 : 0))) * 1000) / 1000;
    i = j + 1;
  }
  return normalizeLyrics({ ...lyrics, lines });
}

type EstimatorId = "uniform" | "current" | "new" | "newMono" | "oracle";
const ESTIMATOR_LABEL: Record<EstimatorId, string> = {
  uniform: "uniform (no audio)",
  current: "current distributeLines (loudness)",
  new: "new (人聲 curve + phrase alignment)",
  newMono: "new, mono model (no side signal)",
  oracle: "oracle (annotated sung spans as the curve)",
};

interface SongResult {
  stem: string;
  split: "dev" | "held-out";
  language: string;
  polyphonic: boolean;
  duration: number;
  lines: number;
  anchors: number;
  auc: number;
  scores: Partial<Record<EstimatorId, { plain: SongScore; anchored: SongScore }>>;
}

const fmtS = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const fmtP = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(0)} %` : "–");

describe.skipIf(!ENABLED)("lyric timing evaluation (JamendoLyrics, local only)", () => {
  it("measures every estimator on every song", async () => {
    const meta = new Map<string, { language: string; polyphonic: boolean }>();
    const csv = fs.readFileSync(path.join(DIR, "JamendoLyrics.csv"), "utf8").split(/\r?\n/);
    const header = csv[0].split(",");
    const col = (name: string) => header.indexOf(name);
    for (const row of csv.slice(1)) {
      if (!row.trim()) continue;
      const f = row.split(",");
      meta.set(f[col("Filepath")].replace(/\.mp3$/i, ""), { language: f[col("Language")], polyphonic: f[col("Polyphonic")] === "true" });
    }
    const stems = fs
      .readdirSync(path.join(DIR, "annotations", "lines"))
      .filter((f) => f.endsWith(".csv"))
      .map((f) => f.replace(/\.csv$/, ""))
      .filter((s) => (!ONLY || s.includes(ONLY)) && fs.existsSync(path.join(CACHE, `${s}.wav`)))
      .sort();
    expect(stems.length).toBeGreaterThan(0);

    const key = analysisCodeKey();
    const results: SongResult[] = [];
    let analysisSeconds = 0;
    let estimateSeconds = 0;
    for (const stem of stems) {
      // a long synchronous run starves the test worker's RPC: yield between songs
      await new Promise((resolve) => setTimeout(resolve, 0));
      const ann = parseLineAnnotations(fs.readFileSync(path.join(DIR, "annotations", "lines", `${stem}.csv`), "utf8"));
      const { lines: texts, paragraphStarts } = lyricParagraphs(fs.readFileSync(path.join(DIR, "lyrics", `${stem}.txt`), "utf8"));
      expect(texts.length, stem).toBe(ann.length);
      const { analysis, seconds } = analyse(stem, key);
      analysisSeconds += seconds;
      const duration = analysis.duration;
      const anchors = new Set(paragraphStarts);
      const vocal = (analysis as AudioAnalysis & { vocal?: number[] }).vocal;
      const withoutVocal: AudioAnalysis = { ...analysis };
      delete (withoutVocal as { vocal?: number[] }).vocal;

      const estimators: Partial<Record<EstimatorId, (l: Lyrics) => Lyrics>> = {
        uniform: (l) => uniform(l, duration),
        current: (l) => distributeLines(l, withoutVocal, duration),
      };
      if (vocal) {
        estimators.new = (l) => distributeLines(l, analysis, duration);
        if (process.env.LIVELYRICS_TIMING_EVAL_MONO !== "off") {
          const mono = { ...analysis, vocal: monoCurve(stem, analysis) };
          estimators.newMono = (l) => distributeLines(l, mono, duration);
        }
        estimators.oracle = (l) => distributeLines(l, { ...analysis, vocal: oracleVocal(ann, duration, analysis.envelopeRate) } as AudioAnalysis, duration);
      }
      const m = meta.get(stem) ?? { language: "?", polyphonic: false };
      const result: SongResult = {
        stem,
        split: evalSplit(stem),
        language: m.language,
        polyphonic: m.polyphonic,
        duration,
        lines: texts.length,
        anchors: anchors.size,
        auc: vocal ? vocalAuc(vocal, ann, analysis.envelopeRate) : NaN,
        scores: {},
      };
      const t0 = performance.now();
      for (const [id, run] of Object.entries(estimators) as [EstimatorId, (l: Lyrics) => Lyrics][]) {
        const plain = run(inputLyrics(texts, ann, new Set()));
        const anchored = run(inputLyrics(texts, ann, anchors));
        expect(plain.lines.length, `${stem} ${id}`).toBe(ann.length);
        result.scores[id] = { plain: scoreSong(plain, ann, duration), anchored: scoreSong(anchored, ann, duration, anchors) };
      }
      estimateSeconds += (performance.now() - t0) / 1000;
      results.push(result);
    }

    const ids = (Object.keys(ESTIMATOR_LABEL) as EstimatorId[]).filter((id) => results.some((r) => r.scores[id]));
    const groups: Array<[string, SongResult[]]> = [
      ["all songs", results],
      ["dev half (tuning)", results.filter((r) => r.split === "dev")],
      ["held-out half", results.filter((r) => r.split === "held-out")],
    ];
    const byFacet: Array<[string, SongResult[]]> = [
      ...["English", "German", "Spanish", "French"].map((lang) => [lang, results.filter((r) => r.language === lang)] as [string, SongResult[]]),
      ["Polyphonic", results.filter((r) => r.polyphonic)],
      ["not polyphonic", results.filter((r) => !r.polyphonic)],
    ];
    const table = (rows: Array<[string, SongResult[]]>, mode: "plain" | "anchored") => {
      const out = [SUMMARY_HEADER];
      for (const [label, songs] of rows) {
        if (!songs.length) continue;
        for (const id of ids) {
          const scores = songs.flatMap((r) => (r.scores[id] ? [r.scores[id]![mode]] : []));
          out.push(summaryRow(`${label} · ${ESTIMATOR_LABEL[id]}`, summarize(scores)));
        }
      }
      return out.join("\n");
    };

    // a song is "catastrophically worse" when its median error grows by more than max(5 s, the
    // current median) untimed, or by more than max(1 s, the current median) with anchors
    const catastrophes = (songs: SongResult[], mode: "plain" | "anchored") =>
      songs.flatMap((r) => {
        const cur = r.scores.current?.[mode];
        const nw = r.scores.new?.[mode];
        if (!cur || !nw) return [];
        const c = songMedian(cur);
        const n = songMedian(nw);
        return n > c + Math.max(mode === "plain" ? 5 : 1, c) ? [`${r.stem} (${c.toFixed(2)} → ${n.toFixed(2)} s)`] : [];
      });
    const catLines = ids.includes("new")
      ? (["dev", "held-out"] as const).flatMap((split) =>
          (["plain", "anchored"] as const).map((mode) => {
            const list = catastrophes(results.filter((r) => r.split === split), mode);
            return `- ${split}, ${mode === "plain" ? "untimed" : "anchors"}: ${list.length}${list.length ? ` — ${list.join("; ")}` : ""}`;
          }),
        )
      : [];

    const aucs = results.map((r) => r.auc).filter(Number.isFinite);
    const md: string[] = [
      "# Lyric timing evaluation (JamendoLyrics MultiLang)",
      "",
      `${results.length} songs (${results.filter((r) => r.split === "dev").length} dev / ${results.filter((r) => r.split === "held-out").length} held-out by file-name hash), ` +
        `${results.reduce((a, r) => a + r.lines, 0)} lines; analysis code ${key}; analysis ${analysisSeconds.toFixed(0)} s, estimators ${estimateSeconds.toFixed(1)} s.`,
      "",
      "Errors are |estimated start − annotated start| over every line (pooled); “right line on screen” is the share of annotated sung time during which the stage's current line (`lineIndexAt`) is the annotated one.",
      "",
      ...(aucs.length
        ? [
            `人聲 curve vs annotated sung time, frame ROC AUC: mean ${(aucs.reduce((a, b) => a + b, 0) / aucs.length).toFixed(3)} ` +
              `(dev ${mean(results.filter((r) => r.split === "dev").map((r) => r.auc)).toFixed(3)}, held-out ${mean(results.filter((r) => r.split === "held-out").map((r) => r.auc)).toFixed(3)}).`,
            "",
          ]
        : []),
      "## Untimed lyrics (no anchors)",
      "",
      table(groups, "plain"),
      "",
      "## Partial 對拍 (anchors = the first line of every paragraph, scored on the other lines)",
      "",
      table(groups, "anchored"),
      "",
      ...(catLines.length
        ? ["## Songs catastrophically worse with the new estimator", "", "Median error grown by more than max(5 s, the current median) untimed, or by more than max(1 s, the current median) with anchors.", "", ...catLines, ""]
        : []),
      "## By language and Polyphonic (no anchors)",
      "",
      table(byFacet, "plain"),
      "",
      "## By language and Polyphonic (anchors)",
      "",
      table(byFacet, "anchored"),
      "",
      "## Per song (median |Δstart| in seconds / right line on screen; no anchors | anchors)",
      "",
      `| song | split | lang | poly | lines | AUC | ${ids.map((id) => `${id}`).join(" | ")} | ${ids.map((id) => `${id} ⚓`).join(" | ")} |`,
      `|---|---|---|---|---:|---:|${ids.map(() => "---:").join("|")}|${ids.map(() => "---:").join("|")}|`,
      ...results.map((r) => {
        const cell = (id: EstimatorId, mode: "plain" | "anchored") => {
          const s = r.scores[id]?.[mode];
          return s ? `${fmtS(songMedian(s))} / ${fmtP(s.rightSeconds / Math.max(1e-9, s.sungSeconds))}` : "–";
        };
        return `| ${r.stem} | ${r.split} | ${r.language.slice(0, 2)} | ${r.polyphonic ? "y" : ""} | ${r.lines} | ${Number.isFinite(r.auc) ? r.auc.toFixed(2) : "–"} | ${ids.map((id) => cell(id, "plain")).join(" | ")} | ${ids.map((id) => cell(id, "anchored")).join(" | ")} |`;
      }),
      "",
    ];
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, md.join("\n"));
    console.log(`\n${table(groups, "plain")}\n\nanchors:\n${table(groups, "anchored")}\n\ncatastrophically worse:\n${catLines.join("\n")}\n\nreport: ${OUT}`);
  }, 3_600_000);
});

function mean(values: number[]): number {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}
