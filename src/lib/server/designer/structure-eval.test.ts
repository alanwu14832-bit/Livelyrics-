// Song-structure evaluation (round 19), local only: skipped unless LIVELYRICS_TIMING_EVAL_DIR points at a
// JamendoLyrics MultiLang copy and the WAV / analysis cache of `scripts/timing-eval/decode.cjs` exists
// (LIVELYRICS_TIMING_EVAL_CACHE, default scratch/round14/wav):
//
//   LIVELYRICS_TIMING_EVAL_DIR=<dataset> LIVELYRICS_TIMING_EVAL_CACHE=<wav cache> \
//     npx vitest run src/lib/server/designer/structure-eval.test.ts
//
// The reference structure per song comes from the human annotation: the intro ends at the first sung
// line, a paragraph (blank-line block of the lyrics file) spans its first line's start to its last
// line's end, and a chorus is a paragraph whose normalised text repeats (≥ 2 occurrences, Dice ≥ 0.8).
// `analyzeStructure` (what every designer path labels sections with) is scored with the lyrics as the
// upload leaves them (estimated over the 人聲 curve) and once timed (annotated starts, as after
// 「AI 自動對時」 / 確認全部時間): intro-end error, songs whose first section is not a mislabelled chorus,
// chorus precision / recall per paragraph and the longest chorus. Report: scratch/round19/structure-eval.md
// (LIVELYRICS_STRUCTURE_EVAL_OUT). Never commit dataset audio, lyrics or annotations.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, analyse, analysisCodeKey } from "@/lib/lyrics/eval-io";
import { distributeLines, normalizeLyrics } from "@/lib/lyrics/lrc";
import { evalSplit, lyricParagraphs, parseLineAnnotations, type AnnotatedLine } from "@/lib/lyrics/timing-eval";
import type { AudioAnalysis, Lyrics } from "@/lib/types";
import { analyzeStructure, lineKey, similarity, type SongStructure } from "./structure";

const DIR = process.env.LIVELYRICS_TIMING_EVAL_DIR ?? "";
const CACHE = process.env.LIVELYRICS_TIMING_EVAL_CACHE ?? path.join(REPO, "scratch/round14/wav");
const OUT = process.env.LIVELYRICS_STRUCTURE_EVAL_OUT ?? path.join(REPO, "scratch/round19/structure-eval.md");
const LABEL = process.env.LIVELYRICS_STRUCTURE_EVAL_LABEL ?? "run";
const ENABLED = !!DIR && fs.existsSync(path.join(DIR, "annotations", "lines")) && fs.existsSync(CACHE);

interface Paragraph {
  start: number;
  end: number;
  chorus: boolean;
}

function reference(texts: string[], starts: number[], ann: AnnotatedLine[]): { introEnd: number; paragraphs: Paragraph[] } {
  const keys: string[] = [];
  const spans: Array<[number, number]> = [];
  starts.forEach((s, k) => {
    const e = (starts[k + 1] ?? texts.length) - 1;
    keys.push(texts.slice(s, e + 1).map(lineKey).join(""));
    spans.push([ann[s].start, Math.max(ann[s].end, ...ann.slice(s, e + 1).map((a) => a.end))]);
  });
  const paragraphs = spans.map(([start, end], k) => ({
    start,
    end,
    chorus: keys.some((other, j) => j !== k && other.length > 0 && similarity(keys[k], other) >= 0.8),
  }));
  return { introEnd: ann[0]?.start ?? 0, paragraphs };
}

interface StructScore {
  introErr: number;
  firstChorusWrong: boolean;
  tp: number;
  fp: number;
  fn: number;
  longestChorus: number;
  sections: number;
  choruses: number;
}

function score(st: SongStructure, ref: { introEnd: number; paragraphs: Paragraph[] }): StructScore {
  const secs = st.sections;
  const introEnd = secs[0]?.kind === "intro" ? secs[0].end : 0;
  const firstParaChorus = ref.paragraphs[0]?.chorus ?? false;
  const firstChorusWrong = secs[0]?.kind === "chorus" && (ref.introEnd > 3 || !firstParaChorus);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const p of ref.paragraphs) {
    let inChorus = 0;
    for (const s of secs) if (s.kind === "chorus") inChorus += Math.max(0, Math.min(s.end, p.end) - Math.max(s.start, p.start));
    const pred = inChorus > 0.5 * (p.end - p.start);
    if (pred && p.chorus) tp++;
    else if (pred) fp++;
    else if (p.chorus) fn++;
  }
  const choruses = secs.filter((s) => s.kind === "chorus");
  return {
    introErr: Math.abs(introEnd - ref.introEnd),
    firstChorusWrong,
    tp,
    fp,
    fn,
    longestChorus: Math.max(0, ...choruses.map((s) => s.end - s.start)),
    sections: secs.length,
    choruses: choruses.length,
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

function summaryRow(name: string, rows: StructScore[]): string {
  const tp = rows.reduce((a, r) => a + r.tp, 0);
  const fp = rows.reduce((a, r) => a + r.fp, 0);
  const fn = rows.reduce((a, r) => a + r.fn, 0);
  const longest = rows.map((r) => r.longestChorus);
  const cells = [
    name,
    String(rows.length),
    median(rows.map((r) => r.introErr)).toFixed(1),
    `${((100 * rows.filter((r) => !r.firstChorusWrong).length) / Math.max(1, rows.length)).toFixed(0)} %`,
    `${((100 * tp) / Math.max(1, tp + fp)).toFixed(0)} %`,
    `${((100 * tp) / Math.max(1, tp + fn)).toFixed(0)} %`,
    median(longest).toFixed(0),
    Math.max(0, ...longest).toFixed(0),
    `${((100 * longest.filter((x) => x > 45.5).length) / Math.max(1, rows.length)).toFixed(0)} %`,
  ];
  return `| ${cells.join(" | ")} |`;
}

const HEADER =
  "| set | songs | intro-end err (median s) | first section not a wrong chorus | chorus precision | chorus recall | longest chorus (median s) | longest chorus (max s) | songs with a chorus > 45 s |\n|---|---|---|---|---|---|---|---|---|";

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
function sectionMap(st: SongStructure): string {
  return st.sections.map((s) => `${s.kind} ${fmtTime(s.start)}–${fmtTime(s.end)} (e ${s.energy.toFixed(2)}, ${s.lineIds.length} lines)`).join("\n");
}

describe.skipIf(!ENABLED)("song structure evaluation (JamendoLyrics, local only)", () => {
  it("scores the section labels against the annotated paragraphs", async () => {
    const stems = fs
      .readdirSync(path.join(DIR, "annotations", "lines"))
      .filter((f) => f.endsWith(".csv"))
      .map((f) => f.replace(/\.csv$/, ""))
      .filter((s) => fs.existsSync(path.join(CACHE, `${s}.wav`)))
      .sort();
    expect(stems.length).toBeGreaterThan(0);
    const key = analysisCodeKey();
    const rows: Array<{ stem: string; split: string; estimated: StructScore; timed: StructScore }> = [];
    const maps: string[] = [];
    for (const stem of stems) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const ann = parseLineAnnotations(fs.readFileSync(path.join(DIR, "annotations", "lines", `${stem}.csv`), "utf8"));
      const { lines: texts, paragraphStarts } = lyricParagraphs(fs.readFileSync(path.join(DIR, "lyrics", `${stem}.txt`), "utf8"));
      if (texts.length !== ann.length || !ann.length) continue;
      const { analysis } = analyse(CACHE, stem, key);
      const duration = analysis.duration;
      const ref = reference(texts, paragraphStarts, ann);
      const untimed: Lyrics = { source: "user", synced: false, lines: texts.map((text, i) => ({ id: `l${i}`, text, start: null, end: null })) };
      const estimated = distributeLines(untimed, analysis, duration);
      const timed = normalizeLyrics({ source: "user", synced: true, lines: texts.map((text, i) => ({ id: `l${i}`, text, start: ann[i].start, end: null })) });
      const meta = { duration, title: stem, artist: "" };
      const run = (lyrics: Lyrics, a: AudioAnalysis) => analyzeStructure({ meta, lyrics, analysis: a });
      const stE = run(estimated, analysis);
      const stT = run(timed, analysis);
      rows.push({ stem, split: evalSplit(stem), estimated: score(stE, ref), timed: score(stT, ref) });
      if (stem.includes("Keep_On")) {
        maps.push(`### ${stem} (${LABEL})\n\nreference: intro ends ${fmtTime(ref.introEnd)}; paragraphs ${ref.paragraphs.map((p) => `${p.chorus ? "C" : "v"} ${fmtTime(p.start)}–${fmtTime(p.end)}`).join(", ")}\n\nestimated timing:\n\n\`\`\`\n${sectionMap(stE)}\n\`\`\`\n\ntimed:\n\n\`\`\`\n${sectionMap(stT)}\n\`\`\`\n`);
      }
    }
    const lines: string[] = [`## ${LABEL}`, ""];
    for (const mode of ["estimated", "timed"] as const) {
      lines.push(`### lyrics ${mode === "estimated" ? "estimated (as uploaded, 人聲 curve)" : "timed (annotated starts, as after AI 自動對時 / 確認全部時間)"}`, "", HEADER);
      for (const [name, set] of [
        ["dev", rows.filter((r) => r.split === "dev")],
        ["held-out", rows.filter((r) => r.split === "held-out")],
        ["all", rows],
      ] as const)
        lines.push(summaryRow(name, set.map((r) => r[mode])));
      lines.push("");
    }
    lines.push(...maps);
    const report = lines.join("\n");
    console.log(report);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.appendFileSync(OUT, `${report}\n\n`);
  }, 3_600_000);
});
