// Sidecar files for an exported song: a cue sheet (CSV: section starts, lyric line times, the
// designer's operator cues, all relative to the first frame of the file) and a README text with
// the delivery spec, so a festival's house VJ can line the clips up on their media server. Pure.

import { safetySummary } from "../stage/safety";
import { lineSpan } from "../timeline";
import type { OutputSafety, Project } from "../types";
import { type FrameRate, frameAtOrAfter, frameCount, seconds3, timecode } from "./frames";
import { type ExportRange, songDuration } from "./settings";

export type CueRowType = "section" | "line" | "cue";

export interface CueRow {
  type: CueRowType;
  /** 1-based within its type */
  index: number;
  /** seconds from the first frame of the file */
  start: number;
  /** seconds from the first frame of the file (null for point cues) */
  end: number | null;
  /** absolute song time */
  songTime: number;
  frame: number;
  timecode: string;
  name: string;
  text: string;
  note: string;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Everything in `range` that the VJ lines up against, sorted by start (sections before lines
 * before cues at the same instant). A section or line that began before the range starts at 0
 * and is marked 「接續」.
 */
export function cueRows(project: Project, range: ExportRange, rate: FrameRate): CueRow[] {
  const duration = songDuration(project) || range.end;
  const rows: CueRow[] = [];
  // at least half a frame inside the range (a section boundary 1 ms after the range start is not a section)
  const half = rate.den / rate.num / 2;
  const within = (s: number, e: number) => Math.min(e, range.end) - Math.max(s, range.start) >= half;
  const rel = (t: number) => round6(Math.max(0, t - range.start));
  const relEnd = (t: number) => round6(Math.min(range.end, t) - range.start);
  const make = (type: CueRowType, index: number, s: number, e: number | null, name: string, text: string, note: string): CueRow => {
    const start = rel(s);
    const frame = frameAtOrAfter(start, rate);
    return { type, index, start, end: e == null ? null : relEnd(e), songTime: round6(Math.max(s, range.start)), frame, timecode: timecode(frame, rate), name, text, note };
  };

  const sections = project.plan?.sections ?? [];
  let si = 0;
  sections.forEach((s) => {
    if (!within(s.start, s.end)) return;
    si++;
    const cont = s.start < range.start - 1e-6 ? "接續（範圍開始前已進入此段）" : "";
    const parts = [`場景 ${s.scene}`, `歌詞 ${s.lyricStyle}`, `轉場 ${s.transitionIn}`];
    if (s.media) parts.push(`素材 ${s.media.treatment}`);
    rows.push(make("section", si, s.start, s.end, s.label || s.kind, parts.join("，"), cont));
  });

  const lines = project.lyrics?.lines ?? [];
  let li = 0;
  lines.forEach((l, i) => {
    const span = lineSpan(lines, i, duration);
    if (!span || !l.text?.trim() || !within(span[0], span[1])) return;
    li++;
    const cont = span[0] < range.start - 1e-6 ? "接續（範圍開始前已開始）" : "";
    const text = l.translation?.trim() ? `${l.text.trim()} / ${l.translation.trim()}` : l.text.trim();
    rows.push(make("line", li, span[0], span[1], l.id, text, cont));
  });

  let ci = 0;
  for (const c of project.plan?.cues ?? []) {
    if (!(c.time >= range.start - 1e-6 && c.time < range.end)) continue;
    ci++;
    rows.push(make("cue", ci, c.time, null, c.title, c.detail, c.kind));
  }

  const order: Record<CueRowType, number> = { section: 0, line: 1, cue: 2 };
  rows.sort((a, b) => a.start - b.start || order[a.type] - order[b.type] || a.index - b.index);
  return rows;
}

/** RFC 4180 quoting: wrap in quotes when needed, double inner quotes. */
export function csvField(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CUE_HEADER = ["type", "index", "start_s", "end_s", "duration_s", "timecode", "frame", "song_time_s", "name", "text", "note"] as const;

/**
 * The cue sheet as CSV (UTF-8 with BOM so spreadsheet apps read the Chinese text correctly,
 * CRLF line ends). Times are seconds from the first frame of the exported file.
 */
export function buildCueSheet(project: Project, range: ExportRange, rate: FrameRate, safety?: OutputSafety | null): string {
  const rows = cueRows(project, range, rate);
  const lines = [CUE_HEADER.join(",")];
  // LED 安全模式 (phase 3): the settings the clips were rendered with, as the first row
  if (safety) lines.push(["note", 1, seconds3(0), "", "", timecode(0, rate), 0, seconds3(range.start), "LED 安全模式", safetySummary(safety), "safety"].map(csvField).join(","));
  for (const r of rows) {
    lines.push(
      [
        r.type,
        r.index,
        seconds3(r.start),
        r.end == null ? "" : seconds3(r.end),
        r.end == null ? "" : seconds3(r.end - r.start),
        r.timecode,
        r.frame,
        seconds3(r.songTime),
        r.name,
        r.text,
        r.note,
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

export interface ReadmeFile {
  name: string;
  variant: string;
  codec: string;
  container: string;
  bitrate: number;
  audio: string | null;
  alpha: boolean;
}

export interface ReadmeInput {
  project: Project;
  range: ExportRange;
  rate: FrameRate;
  width: number;
  height: number;
  files: ReadmeFile[];
  cueSheetName: string;
  /** ISO time */
  createdAt: string;
  /** LED 安全模式 the clips were rendered with (phase 3) */
  safety?: OutputSafety | null;
  /** how often the flash limiter damped during the export */
  limiterEngaged?: number;
}

/** A plain-text delivery note (Traditional Chinese, with an English summary for international crews). */
export function buildReadme(input: ReadmeInput): string {
  const { project, range, rate, width, height, files } = input;
  const frames = frameCount(range.end - range.start, rate);
  const length = range.end - range.start;
  const duration = songDuration(project);
  const whole = range.start <= 0.01 && (!duration || range.end >= duration - 0.01);
  const title = project.meta?.title || "未命名歌曲";
  const artist = project.meta?.artist || "";
  const lastTc = timecode(Math.max(0, frames - 1), rate);
  const mbps = (b: number) => `${(b / 1e6).toFixed(1)} Mbps`;
  const out: string[] = [];
  out.push(`${title}${artist ? `／${artist}` : ""}`);
  out.push("Livelyrics 預先算圖影片（音樂祭媒體伺服器用）");
  out.push("");
  out.push("規格");
  out.push(`- 畫面尺寸：${width} x ${height} 像素（方形像素，逐行掃描）`);
  out.push(`- 影格率：${rate.label} fps（${rate.num}/${rate.den}）${rate.dropFrame ? "，時間碼為 drop-frame（;）" : ""}`);
  out.push(`- 長度：${seconds3(length)} 秒，共 ${frames} 格（${timecode(0, rate)} 到 ${lastTc}）`);
  out.push(`- 範圍：${whole ? "整首歌" : `歌曲時間 ${seconds3(range.start)} 到 ${seconds3(range.end)} 秒`}；影片第一格 = 歌曲時間 ${seconds3(range.start)} 秒`);
  out.push("- 色彩：Rec.709（sRGB 原色），8 位元 4:2:0，全幅畫面");
  if (input.safety) {
    out.push(`- ${safetySummary(input.safety)}`);
    if (input.safety.enabled) {
      out.push(`  完整與背景版本已套用亮度上限與閃爍限制${input.limiterEngaged ? `（本次匯出抑制閃爍 ${input.limiterEngaged} 次）` : ""}；歌詞層（黑底白字 matte）是鍵控訊號，不降亮度。`);
      out.push("  這能降低風險並依 WCAG 2.3.1 門檻限制閃爍，但不是正式的光敏性癲癇（PSE）檢測；電視播出請另做 Harding 類分析。");
    } else out.push("  注意：這份影片沒有亮度與閃爍保護，LED 牆播放前請確認不會對觀眾造成危險。");
  }
  out.push("");
  out.push("檔案");
  for (const f of files) {
    const extra = [f.codec, f.container, mbps(f.bitrate), f.audio ? `音訊 ${f.audio}` : "無音訊", f.alpha ? "含透明度" : ""].filter(Boolean).join("，");
    out.push(`- ${f.name}：${f.variant}（${extra}）`);
  }
  out.push(`- ${input.cueSheetName}：段落、歌詞行與操作提示的時間表（秒數從影片第一格起算）`);
  out.push("");
  out.push("怎麼用");
  out.push("- 完整：直接播放，場景、樂團素材與歌詞都在畫面裡。");
  out.push("- 背景：同一段畫面但沒有歌詞，可以自己疊字幕或 IMAG。");
  out.push("- 歌詞層（黑底白字）：當作 luma matte / luma key 使用，白色 = 顯示，黑色 = 透明；或直接用 Add / Screen 疊在畫面上。");
  if (files.some((f) => f.alpha)) out.push("- 歌詞層（透明 WebM）：VP9 含 alpha，支援的媒體伺服器可以直接疊。");
  out.push("- 三個版本逐格對齊，同時從第一格開始播放即可同步。影片沒有音訊時，請以樂團的 click 或 timecode 對齊第一格。");
  out.push("");
  out.push("English summary");
  out.push(`- ${width}x${height}, ${rate.label} fps (${rate.num}/${rate.den})${rate.dropFrame ? ", drop-frame timecode" : ""}, ${frames} frames, ${seconds3(length)} s.`);
  out.push(`- Frame 0 = song time ${seconds3(range.start)} s. All clips are frame-aligned; start them together.`);
  out.push(`- full = scene + band media + lyrics; bg = no lyrics; lyrics-matte = white text on black (use as luma matte or add/screen)${files.some((f) => f.alpha) ? "; lyrics-alpha = VP9 WebM with alpha" : ""}.`);
  out.push(`- Cue sheet: ${input.cueSheetName} (CSV, UTF-8, seconds from the first frame).`);
  if (input.safety)
    out.push(
      input.safety.enabled
        ? `- LED safe mode ON: peak brightness ${Math.round(input.safety.brightness * 100)} %, flash limiter ${input.safety.flashLimit ? "on (<= 3 flashes/s, WCAG 2.3.1)" : "off"}, red-flash protection ${input.safety.redProtect ? "on" : "off"}. Not a certified PSE test.`
        : "- LED safe mode OFF: no brightness cap or flash limiting was applied.",
    );
  out.push("");
  out.push(`輸出時間：${input.createdAt}`);
  return out.join("\r\n") + "\r\n";
}
