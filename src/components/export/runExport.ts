// Runs one export: prepares the offline stage, opens one muxer per variant (streaming into the
// chosen folder, or into memory), renders every frame of the range once and composes each
// variant from the same scene / lyric canvases, then writes the cue sheet and README.

import { api } from "@/lib/api-client";
import { buildCueSheet, buildReadme, type ReadmeFile } from "@/lib/export/cuesheet";
import { ClipWriter, decodeSongAudio, planAudioCodec, planVideoCodec, sliceAudio, type AudioCodecChoice, type VideoPlan } from "@/lib/export/encode";
import { FRAME_RATES, frameCount, frameTime, fpsOf, type FrameRateId } from "@/lib/export/frames";
import { VARIANT_INFO, exportBaseName, songDuration, targetBitrate, variantFileName, type ExportSettings, type ExportVariant, type VideoCodecChoice } from "@/lib/export/settings";
import type { Project } from "@/lib/types";
import { OfflineStage, RenderCanceled } from "@/components/stage/export/OfflineStage";

export interface ExportProgress {
  phase: "prepare" | "render" | "finalize";
  frame: number;
  total: number;
  /** rendered frames per second (recent) */
  fps: number;
  /** seconds left, null until measurable */
  eta: number | null;
  /** song time of the last frame */
  t: number;
}

export interface ExportedFile {
  name: string;
  /** null when it was written straight into the folder */
  blob: Blob | null;
  kind: "video" | "text";
  label: string;
  bytes: number;
}

export interface ExportResult {
  files: ExportedFile[];
  frames: number;
  seconds: number;
  warnings: string[];
  elapsed: number;
}

export interface ExportJob {
  project: Project;
  settings: ExportSettings;
  /** one plan per selected variant (resolved against the browser beforehand) */
  plans: Partial<Record<ExportVariant, VideoPlan>>;
  audioCodec: Partial<Record<"mp4" | "webm", AudioCodecChoice | null>>;
  /** folder picked with showDirectoryPicker, or null for downloads */
  dir: FileSystemDirectoryHandle | null;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
  onWarning?: (message: string) => void;
}

export class ExportCanceled extends Error {
  constructor() {
    super("已取消匯出");
  }
}

/** A macrotask yield that background-tab timer throttling does not stretch to 1 s. */
function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

/**
 * Create `name` in the folder; some file systems refuse non-ASCII names, so fall back to an
 * ASCII-only version of the name (the song title part becomes the project id).
 */
async function createFile(dir: FileSystemDirectoryHandle, name: string, projectId: string): Promise<{ handle: FileSystemFileHandle; name: string }> {
  try {
    return { handle: await dir.getFileHandle(name, { create: true }), name };
  } catch (e) {
    const ascii = name.replace(/^[^_]*/, (title) => (/^[\x20-\x7e]+$/.test(title) ? title : `livelyrics-${projectId}`)).replace(/[^\x20-\x7e]/g, "_");
    if (ascii === name) throw e;
    return { handle: await dir.getFileHandle(ascii, { create: true }), name: ascii };
  }
}

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string, projectId: string): Promise<string> {
  const f = await createFile(dir, name, projectId);
  const w = await f.handle.createWritable();
  await w.write(new Blob([text], { type: "text/plain;charset=utf-8" }));
  await w.close();
  return f.name;
}

export async function runExport(job: ExportJob): Promise<ExportResult> {
  const started = performance.now();
  const { project, settings, dir, signal } = job;
  const rate = settings.rate;
  const fps = fpsOf(rate);
  const range = settings.range;
  const total = frameCount(range.end - range.start, rate);
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    job.onWarning?.(m);
  };
  const check = () => {
    if (signal.aborted) throw new ExportCanceled();
  };

  job.onProgress({ phase: "prepare", frame: 0, total, fps: 0, eta: null, t: range.start });
  const stage = new OfflineStage(project);
  const writers: Array<{ variant: ExportVariant; name: string; writer: ClipWriter; plan: VideoPlan; audio: AudioCodecChoice | null }> = [];
  const created: string[] = [];
  try {
    const report = await stage.prepare();
    for (const w of report.warnings) warn(w);
    if (!stage.webgl && settings.variants.some((v) => v !== "lyrics")) throw new Error("這台電腦無法使用 WebGL，無法算出場景畫面。");
    check();

    const base = exportBaseName(project.meta?.title || project.meta?.fileName || "livelyrics", stage.width, stage.height, rate, range, songDuration(project));
    for (const variant of settings.variants) {
      const plan = job.plans[variant];
      if (!plan) continue;
      let name = variantFileName(base, variant, plan.alpha ? "alpha" : "matte", plan.container);
      const audio = settings.audio ? (job.audioCodec[plan.container] ?? null) : null;
      let sink: ConstructorParameters<typeof ClipWriter>[0]["sink"] = { kind: "buffer" };
      if (dir) {
        const file = await createFile(dir, name, project.id);
        name = file.name;
        created.push(name);
        sink = { kind: "stream", writable: await file.handle.createWritable() };
      }
      const writer = new ClipWriter({ width: stage.width, height: stage.height, rate, plan, audio, sink, keyFrameInterval: 1, title: project.meta?.title });
      writers.push({ variant, name, writer, plan, audio });
    }
    if (!writers.length) throw new Error("沒有可以匯出的版本。");
    for (const w of writers) await w.writer.start();

    // song audio (rehearsal previews): muxed in one-second pieces alongside the frames
    let audio: AudioBuffer | null = null;
    let audioPos = 0;
    if (writers.some((w) => w.audio)) {
      audio = await decodeSongAudio(api.audioUrl(project.id), range.start, range.end);
      if (!audio) warn("無法解碼歌曲音訊，影片將不含聲音。");
    }
    const pushAudio = async (untilSeconds: number) => {
      if (!audio) return;
      const until = Math.min(audio.length, Math.round(untilSeconds * audio.sampleRate));
      if (until <= audioPos) return;
      const piece = sliceAudio(audio, audioPos, until);
      audioPos = until;
      if (piece) for (const w of writers) if (w.audio) await w.writer.addAudio(piece);
    };

    const wantsFull = settings.variants.includes("full");
    const wantsBg = settings.variants.includes("background");
    const wantsColor = writers.some((w) => w.variant === "full" || (w.variant === "lyrics" && w.plan.alpha));
    const wantsMatte = writers.some((w) => w.variant === "lyrics" && !w.plan.alpha);

    const times: number[] = [];
    let lastYield = performance.now();
    for (let i = 0; i < total; i++) {
      check();
      const t = frameTime(range.start, i, rate);
      await stage.renderFrame(t, fps, { scene: wantsFull, background: wantsBg, lyrics: wantsColor, matte: wantsMatte });
      for (const w of writers) {
        const ctx = w.writer.ctx;
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        if (w.variant === "full") {
          stage.drawFull(ctx);
        } else if (w.variant === "background") {
          ctx.drawImage(stage.sceneCanvas, 0, 0);
        } else if (w.plan.alpha) {
          ctx.clearRect(0, 0, stage.width, stage.height);
          ctx.drawImage(stage.lyricCanvas, 0, 0);
        } else {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, stage.width, stage.height);
          ctx.drawImage(stage.matteCanvas, 0, 0);
        }
        await w.writer.addFrame(i);
      }
      await pushAudio((i + 1) / fps + 1);

      const now = performance.now();
      times.push(now);
      while (times.length > 1 && now - times[0] > 2000) times.shift();
      const rfps = times.length > 1 ? ((times.length - 1) * 1000) / (now - times[0]) : 0;
      if (i === total - 1 || now - lastYield > 120) {
        job.onProgress({ phase: "render", frame: i + 1, total, fps: rfps, eta: rfps > 0 ? (total - i - 1) / rfps : null, t });
        await yieldTask();
        lastYield = performance.now();
      }
    }
    await pushAudio(range.end - range.start + 1);

    job.onProgress({ phase: "finalize", frame: total, total, fps: 0, eta: 0, t: range.end });
    const files: ExportedFile[] = [];
    for (const w of writers) {
      check();
      const blob = await w.writer.finish();
      let bytes = blob?.size ?? 0;
      if (!blob && dir) {
        try {
          bytes = (await (await dir.getFileHandle(w.name)).getFile()).size;
        } catch {
          /* size unknown */
        }
      }
      files.push({ name: w.name, blob, kind: "video", label: VARIANT_INFO[w.variant].label, bytes });
    }

    // sidecars
    // the folder may have refused the title's characters: name the sidecars like the clips
    const sideBase = writers[0] && !writers[0].name.startsWith(base) ? writers[0].name.replace(/_[^_]+\.(mp4|webm)$/, "") : base;
    const cueName = `${sideBase}_cues.csv`;
    const readmeName = `${sideBase}_README.txt`;
    const cue = buildCueSheet(project, range, rate, project.output?.safety ?? null);
    const readmeFiles: ReadmeFile[] = writers.map((w) => ({
      name: w.name,
      variant: w.variant === "lyrics" ? (w.plan.alpha ? "歌詞層（透明）" : "歌詞層（黑底白字 luma matte）") : `${VARIANT_INFO[w.variant].label}（${VARIANT_INFO[w.variant].detail}）`,
      codec: w.plan.label,
      container: w.plan.container.toUpperCase(),
      bitrate: w.plan.bitrate,
      audio: w.audio && audio ? (w.audio === "aac" ? "AAC 192 kbps" : "Opus 192 kbps") : null,
      alpha: w.plan.alpha,
    }));
    const readme = buildReadme({
      project,
      range,
      rate,
      width: stage.width,
      height: stage.height,
      files: readmeFiles,
      cueSheetName: cueName,
      createdAt: new Date().toLocaleString("zh-TW", { hour12: false }),
      safety: project.output?.safety ?? null,
      limiterEngaged: stage.limiterEngaged,
    });
    if (dir) {
      files.push({ name: await writeText(dir, cueName, cue, project.id), blob: null, kind: "text", label: "時間表", bytes: new Blob([cue]).size });
      files.push({ name: await writeText(dir, readmeName, readme, project.id), blob: null, kind: "text", label: "說明", bytes: new Blob([readme]).size });
    } else {
      files.push({ name: cueName, blob: new Blob([cue], { type: "text/csv;charset=utf-8" }), kind: "text", label: "時間表", bytes: new Blob([cue]).size });
      files.push({ name: readmeName, blob: new Blob([readme], { type: "text/plain;charset=utf-8" }), kind: "text", label: "說明", bytes: new Blob([readme]).size });
    }
    return { files, frames: total, seconds: range.end - range.start, warnings, elapsed: (performance.now() - started) / 1000 };
  } catch (e) {
    for (const w of writers) await w.writer.cancel();
    if (dir) for (const name of created) await dir.removeEntry(name).catch(() => {});
    throw e;
  } finally {
    stage.destroy();
  }
}

/** One frame at song time t (the 單格預覽): scene, lyric layer and matte as PNG data. */
export async function renderPreview(
  project: Project,
  t: number,
  fps: number,
  signal?: AbortSignal,
): Promise<{ full: string; background: string; matte: string; warnings: string[]; width: number; height: number }> {
  const stage = new OfflineStage(project);
  try {
    const { warnings } = await stage.prepare();
    if (signal?.aborted) throw new RenderCanceled();
    // the stage needs the page's DOM (the lyric layer, next/font faces, media elements), so it
    // cannot move to a worker; with a signal it yields between pre-roll frames and can be cancelled
    await stage.renderFrame(t, fps, { scene: true, background: true, lyrics: true, matte: true }, { signal });
    if (signal?.aborted) throw new RenderCanceled();
    const out = document.createElement("canvas");
    out.width = stage.width;
    out.height = stage.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(stage.sceneCanvas, 0, 0);
    const background = out.toDataURL("image/png");
    ctx.clearRect(0, 0, out.width, out.height);
    stage.drawFull(ctx);
    const full = out.toDataURL("image/png");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(stage.matteCanvas, 0, 0);
    const matte = out.toDataURL("image/png");
    return { full, background, matte, warnings, width: stage.width, height: stage.height };
  } finally {
    stage.destroy();
  }
}

/**
 * Development diagnostics: render song time t (after the usual pre-roll) and keep the stage alive
 * so a test can read every layer and show the hidden lyric DOM next to the painted canvas.
 */
export async function debugStage(project: Project, t: number, fps: number) {
  const stage = new OfflineStage(project);
  const { warnings } = await stage.prepare();
  await stage.renderFrame(t, fps, { scene: true, background: true, lyrics: true, matte: true });
  const png = (draw: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas");
    c.width = stage.width;
    c.height = stage.height;
    const ctx = c.getContext("2d")!;
    draw(ctx);
    return c.toDataURL("image/png");
  };
  return {
    warnings,
    width: stage.width,
    height: stage.height,
    /** advance to another time (one frame on = continuous, anything else pre-rolls) */
    render: (at: number) => stage.renderFrame(at, fps, { scene: true, background: true, lyrics: true, matte: true }),
    scene: () => png((ctx) => ctx.drawImage(stage.sceneCanvas, 0, 0)),
    full: () => png((ctx) => stage.drawFull(ctx)),
    lyricsOnBlack: () =>
      png((ctx) => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, stage.width, stage.height);
        ctx.drawImage(stage.lyricCanvas, 0, 0);
      }),
    matte: () =>
      png((ctx) => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, stage.width, stage.height);
        ctx.drawImage(stage.matteCanvas, 0, 0);
      }),
    /** show the hidden lyric DOM at the top-left of the page, over black */
    showDom: (on: boolean) => stage.setDomVisible(on),
    dispose: () => stage.destroy(),
  };
}

export interface DebugExportOptions {
  start: number;
  end: number;
  rate: FrameRateId;
  variants: ExportVariant[];
  codec: VideoCodecChoice;
  /** mux into MP4 whatever the codec (VP9 in MP4 exercises the MP4 path where H.264 is missing) */
  forceMp4?: boolean;
  audio?: boolean;
}

/**
 * Development diagnostics: run a real export into the origin-private file system (the same
 * streaming FileSystemWritableFileStream path as a picked folder, without the picker) and return
 * the written files' names and sizes.
 */
export async function debugExportToOpfs(project: Project, o: DebugExportOptions) {
  const rate = FRAME_RATES[o.rate];
  const fps = fpsOf(rate);
  const w = project.output.width;
  const h = project.output.height;
  const plan = await planVideoCodec(o.codec, w, h, fps, (c) => targetBitrate(w, h, fps, "high", c));
  if (!plan) throw new Error("no encoder");
  const p: VideoPlan = o.forceMp4 ? { ...plan, container: "mp4" } : plan;
  const plans: Partial<Record<ExportVariant, VideoPlan>> = {};
  for (const v of o.variants) plans[v] = p;
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(`export-${Date.now()}`, { create: true });
  const result = await runExport({
    project,
    settings: { variants: o.variants, lyricFormat: "matte", codec: o.codec, quality: "high", rate, range: { start: o.start, end: o.end }, audio: !!o.audio },
    plans,
    audioCodec: { [p.container]: o.audio ? await planAudioCodec(p.container) : null },
    dir,
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  return { dir: dir.name, plan: p, files: result.files.map((f) => ({ name: f.name, bytes: f.bytes })), frames: result.frames, elapsed: result.elapsed, warnings: result.warnings };
}
