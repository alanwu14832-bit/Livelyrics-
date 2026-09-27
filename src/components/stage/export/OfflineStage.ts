// Offline, deterministic stage renderer for the video export: renders the frame at an arbitrary
// song time t into canvases of exactly output.width × output.height, with no requestAnimationFrame
// and no wall clock. It drives the same pieces as the live StageEngine:
//
// - scene: StageRenderer (same shaders, transitions, media compositor) with the scene clock,
//   section transitions and beat index derived from song time (src/lib/stage/offline.ts);
//   audio uniforms come from the analysis envelopes through the live AudioFeatureMixer, stepped
//   at the export frame rate;
// - band media: the same media model and draw helper, with images decoded up front and videos
//   seeked to the exact frame time (ExactMedia);
// - lyrics: the live LyricLayer, laid out in a hidden host at the export size and stepped with
//   now = song time, then painted into a canvas by LyricPainter (coloured, or as a luma matte).
//
// Stateful parts (the audio mixer's smoothing, lyric enter / exit animations, the stack style's
// drift) are advanced frame by frame; a jump (the first frame of a range, a single-frame preview,
// going backwards) re-runs the preceding PREROLL_SECONDS at the frame rate first, so a frame
// looks the same however the export reached it.

import { stageAssets } from "@/lib/asset-scope";
import { SCENE_IDS } from "@/lib/schema";
import { parseHex, type RGB } from "@/lib/stage/color";
import type { SceneSlot } from "@/lib/stage/director";
import { AudioFeatureMixer, type StageAudioFrame } from "@/lib/stage/features";
import { StageRenderer, type MediaDraw, type MediaLayerDraw, type SceneDraw } from "@/lib/stage/gl/renderer";
import { mediaLayerDraw, mediaLyricBox, mediaVideoTime } from "@/lib/stage/media/draw";
import { TREATMENT_CODE, beatAt, resolveMediaFrame, type BeatInfo } from "@/lib/stage/media/model";
import { hashString, rasterizeMotif } from "@/lib/stage/motif";
import { beatIndexAt, buildSceneClock, offlineSceneFrame, type OfflineSceneFrame, type SceneClock } from "@/lib/stage/offline";
import { clampWeight } from "@/lib/stage/lyrics/layout";
import { resolveLineDesign } from "@/lib/stage/resolve";
import { resolveTypography, type StageTypography } from "@/lib/stage/typography";
import { FONTS } from "@/lib/font-meta";
import { DEFAULT_OUTPUT, outputAspect } from "@/lib/output";
import type { Asset, Project, ProjectOutput, SceneId } from "@/lib/types";
import { LyricLayer } from "../lyrics/LyricLayer";
import { ExactMedia } from "./ExactMedia";
import { LyricPainter } from "./LyricPainter";

/** Seconds re-run before a jump so smoothing and lyric animations are settled. */
export const PREROLL_SECONDS = 3;

export interface OfflineFrameRequest {
  /** render scene + media into `sceneCanvas` */
  scene: boolean;
  /** paint the coloured lyric layer into `lyricCanvas` */
  lyrics: boolean;
  /** paint the white luma matte into `matteCanvas` */
  matte: boolean;
}

export interface PrepareReport {
  /** Traditional-Chinese notes for the operator (fonts that did not load, broken media) */
  warnings: string[];
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function uniqueChars(project: Project): string {
  const set = new Set<string>();
  for (const l of project.lyrics?.lines ?? []) {
    for (const ch of `${l.text ?? ""}${l.translation ?? ""}`) set.add(ch);
  }
  set.delete(" ");
  return [...set].join("") || "永";
}

/** The resolved font-family of the plan's CJK font (its CSS variable, as the lyric layer uses it). */
function resolveCjkFamily(project: Project, host: HTMLElement): string | null {
  const id = project.plan?.keyVisual?.typography?.cjkFont ?? "noto-sans-tc";
  const info = FONTS[id] ?? FONTS["noto-sans-tc"];
  const f = info.cjk ? info : FONTS["noto-sans-tc"];
  const probe = document.createElement("span");
  probe.style.fontFamily = `var(${f.cssVar}), ${f.generic}`;
  host.append(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || null;
}

export class OfflineStage {
  readonly width: number;
  readonly height: number;
  readonly output: ProjectOutput;
  /** WebGL scene + media (opaque) */
  readonly sceneCanvas: HTMLCanvasElement;
  /** coloured lyric layer on transparent */
  readonly lyricCanvas: HTMLCanvasElement;
  /** white-on-transparent lyric matte */
  readonly matteCanvas: HTMLCanvasElement;

  private renderer: StageRenderer | null;
  private wrap: HTMLDivElement;
  private host: HTMLDivElement;
  private lyrics: LyricLayer;
  private painter: LyricPainter | null = null;
  private media: ExactMedia;
  private mixer = new AudioFeatureMixer();
  private clock: SceneClock;
  private typography: StageTypography;
  private assetMap: Map<string, Asset>;
  private colorCache = new Map<string, RGB>();
  private seed: number;
  private lastT: number | null = null;
  private lyricAmt = 0;
  private destroyed = false;
  private rendererError: string | null = null;
  private cjkFamily: string | null = null;

  constructor(private readonly project: Project) {
    const out = project.output && project.output.width > 0 && project.output.height > 0 ? project.output : DEFAULT_OUTPUT;
    this.output = out;
    this.width = out.width;
    this.height = out.height;
    this.sceneCanvas = makeCanvas(this.width, this.height);
    this.lyricCanvas = makeCanvas(this.width, this.height);
    this.matteCanvas = makeCanvas(this.width, this.height);
    this.renderer = StageRenderer.create(this.sceneCanvas, {
      preserveDrawingBuffer: true,
      onError: (m) => {
        this.rendererError = m;
        console.error(`[Livelyrics] ${m}`);
      },
    });
    this.renderer?.setSize(this.width, this.height);

    // hidden host at the export size (1 CSS px = 1 output px): the lyric DOM is laid out exactly as
    // it would be in a projection window of that size, but clipped away by a 0 × 0 wrapper
    this.wrap = document.createElement("div");
    Object.assign(this.wrap.style, { position: "fixed", left: "0", top: "0", width: "0", height: "0", overflow: "hidden", pointerEvents: "none", zIndex: "-1" });
    this.wrap.setAttribute("aria-hidden", "true");
    this.host = document.createElement("div");
    Object.assign(this.host.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: `${this.width}px`,
      height: `${this.height}px`,
      overflow: "hidden",
      containerType: "size",
      isolation: "isolate",
      background: "transparent",
    });
    this.wrap.append(this.host);
    document.body.append(this.wrap);
    this.lyrics = new LyricLayer(this.host);
    this.typography = resolveTypography(project.plan);
    this.cjkFamily = resolveCjkFamily(project, this.host);
    this.painter = new LyricPainter(this.lyrics.root, this.cjkFamily);

    this.assetMap = new Map(stageAssets(project).map((a) => [a.id, a]));
    this.seed = (hashString(project.id || "stage") % 1000) / 37;
    this.clock = buildSceneClock(project);
    let maxTex = 4096;
    try {
      const gl = this.sceneCanvas.getContext("webgl2") ?? this.sceneCanvas.getContext("webgl");
      if (gl) maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    } catch {
      /* keep the default */
    }
    this.media = new ExactMedia(maxTex);
  }

  get webgl(): boolean {
    return !!this.renderer && !this.renderer.lost;
  }

  get error(): string | null {
    return this.rendererError;
  }

  /** Fonts, motif texture, every shader the plan uses and the band media. */
  async prepare(): Promise<PrepareReport> {
    const warnings: string[] = [];
    const project = this.project;
    if (!this.renderer) warnings.push("這台電腦無法使用 WebGL，無法算出場景畫面。");

    // fonts: every weight the lyric styles use, for the characters actually sung
    const probe = document.createElement("span");
    probe.style.fontFamily = this.typography.family;
    this.host.append(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    const text = uniqueChars(project);
    const weights = new Set<number>();
    for (const d of [-300, -200, -100, 0, 100, 200, 300]) weights.add(clampWeight(this.typography.weight + d));
    // the web fonts of the stack, one by one (next/font's "… Fallback" faces are local() metric
    // shims, generic families have no files)
    const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/i;
    const families = family
      .split(",")
      .map((f) => f.trim().replace(/^["']|["']$/g, ""))
      .filter((f) => f && !GENERIC.test(f) && !/ Fallback$/.test(f));
    const loads: Promise<unknown>[] = [];
    for (const f of families) for (const w of weights) loads.push(document.fonts.load(`${w} 64px "${f}"`, text).catch(() => []));
    await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 20000))]);
    const missing = families.filter((f) => ![...weights].every((w) => document.fonts.check(`${w} 64px "${f}"`, text)));
    if (missing.length) warnings.push(`字型「${missing.join("、")}」沒有載入完成，匯出的字形可能和投影不同。請先連上網路開一次投影視窗。`);
    this.lyrics.invalidateFit();

    // motif texture
    const svg = project.plan?.keyVisual?.motifSvg ?? "";
    const { canvas } = await rasterizeMotif(svg, `${project.meta?.title ?? ""}${project.id}`);
    this.renderer?.setMotif(canvas);

    // media
    const used = new Set<string>();
    for (const s of project.plan?.sections ?? []) if (s?.media?.assetId && this.assetMap.has(s.media.assetId)) used.add(s.media.assetId);
    const failed = await this.media.load(project, [...this.assetMap.values()], used);
    if (failed.length) warnings.push(`素材無法解碼，將不會出現在影片中：${failed.join("、")}`);

    // shaders: compile everything the plan needs now (the live stage compiles lazily)
    if (this.renderer) {
      const scenes = new Set<SceneId>(["gradient"]);
      for (const s of project.plan?.sections ?? []) if ((SCENE_IDS as readonly string[]).includes(s.scene)) scenes.add(s.scene);
      const bad = await this.renderer.ensureReady([...scenes], used.size > 0);
      if (bad.length) warnings.push(`有 ${bad.length} 個著色器無法編譯，該段會改用漸層場景。`);
    }
    return { warnings };
  }

  private color(hex: string): RGB {
    let c = this.colorCache.get(hex);
    if (!c) {
      c = parseHex(hex);
      this.colorCache.set(hex, c);
    }
    return c;
  }

  /** Advance the stateful parts to song time t (dt seconds since the previous step). */
  private step(t: number, dt: number): { frame: OfflineSceneFrame; audio: StageAudioFrame } {
    const project = this.project;
    const frame = offlineSceneFrame(project, t, this.clock);
    const audio = { ...this.mixer.update(project.analysis, frame.state, t, dt) };
    const { state, lyricLook } = frame;
    const lines = project.lyrics?.lines ?? [];
    const line = typeof state.lineIndex === "number" ? lines[state.lineIndex] : undefined;
    const style = line ? resolveLineDesign(project.plan, line.id, lyricLook.lyricStyle, null).style : "hidden";
    const showing = !!line && !!line.text?.trim() && style !== "hidden";
    this.lyricAmt += ((showing ? 1 : 0) - this.lyricAmt) * (dt > 0 ? 1 - Math.exp(-dt / 0.25) : 1);
    // lyric animations run on "now" = song time in ms (live: performance.now())
    this.lyrics.update({
      project,
      state,
      t,
      nowEpoch: t * 1000,
      now: t * 1000,
      look: lyricLook,
      typography: this.typography,
      pulse: audio.pulse * frame.look.params.reactivity,
      visible: true,
      aspect: outputAspect(this.output),
      safe: this.output.lyricSafe,
    });
    this.lastT = t;
    return { frame, audio };
  }

  /** Reset the stateful parts and replay the PREROLL_SECONDS before t at the frame rate. */
  private preroll(t: number, fps: number) {
    this.mixer = new AudioFeatureMixer();
    this.painter = null;
    this.lyrics.destroy();
    this.lyrics = new LyricLayer(this.host);
    this.painter = new LyricPainter(this.lyrics.root, this.cjkFamily);
    this.lyricAmt = 0;
    this.lastT = null;
    const dt = 1 / fps;
    const start = Math.max(0, t - PREROLL_SECONDS);
    const n = Math.floor((t - start) / dt + 1e-6);
    // same grid as the export (t − k·dt), so the first real frame steps exactly one frame on
    for (let k = n; k >= 1; k--) {
      const tk = t - k * dt;
      this.step(tk, this.lastT == null ? 0 : tk - this.lastT);
    }
  }

  private slotDraw(slot: SceneSlot, audio: StageAudioFrame, t: number, beatIndex: number): SceneDraw {
    const target = slot.target;
    return {
      scene: target.scene,
      lookKey: target.lookKey,
      uniforms: {
        time: slot.clock,
        clock: t % 3600,
        bg: this.color(target.colorway[0]),
        primary: this.color(target.colorway[1]),
        accent: this.color(target.colorway[2]),
        speed: target.params.speed,
        density: target.params.density,
        intensity: target.params.intensity,
        reactivity: target.params.reactivity,
        level: audio.level,
        bass: audio.bass,
        onset: audio.onset,
        beat: audio.beat,
        beatIndex,
        energy: audio.energy,
        pulse: audio.pulse,
        seed: this.seed,
      },
    };
  }

  private async mediaDraw(frame: OfflineSceneFrame, audio: StageAudioFrame, t: number): Promise<MediaDraw | null> {
    const project = this.project;
    const { look, lyricLook, state } = frame;
    const m = resolveMediaFrame(project.plan, this.assetMap, look.sectionIndex, t, look.colorway, true);
    if (!m.current && !m.previous) return null;
    const beat: BeatInfo = beatAt(project.analysis, t) ?? { index: 0, phase: audio.beat, start: t - audio.beat * 0.5 };
    const layers: MediaLayerDraw[] = [];
    for (const l of [m.current, m.previous]) {
      if (!l) continue;
      const src = await this.media.frame(l.asset, mediaVideoTime(l, t, beat));
      const d = mediaLayerDraw(l, t, beat, src, outputAspect(this.output), (hex) => this.color(hex));
      if (d) layers.push(d);
    }
    if (!layers.length) return null;
    const lines = project.lyrics?.lines ?? [];
    const line = typeof state.lineIndex === "number" ? lines[state.lineIndex] : undefined;
    const style = line ? resolveLineDesign(project.plan, line.id, lyricLook.lyricStyle, null).style : "hidden";
    const showing = !!line && !!line.text?.trim() && style !== "hidden";
    const textBox = layers.some((l) => l.treatment === TREATMENT_CODE["mask-lyrics"]) ? this.lyrics.textBounds() : null;
    const lyricBox = mediaLyricBox(textBox, showing, style, lyricLook, this.output.lyricSafe, outputAspect(this.output));
    return { layers, time: t, lyricBox, lyricAmount: this.lyricAmt };
  }

  /**
   * Render song time t. Consecutive calls one frame apart step the animations by exactly one
   * frame; anything else pre-rolls first. `fps` is the export frame rate.
   */
  async renderFrame(t: number, fps: number, req: OfflineFrameRequest): Promise<void> {
    if (this.destroyed) throw new Error("renderer destroyed");
    const dt = 1 / fps;
    const last = this.lastT;
    if (last == null || t < last - 1e-9 || t - last > dt * 1.5) this.preroll(t, fps);
    const { frame, audio } = this.step(t, this.lastT == null ? 0 : t - this.lastT);

    if (req.scene) {
      const r = this.renderer;
      if (r && !r.lost) {
        let media: MediaDraw | null = null;
        try {
          media = await this.mediaDraw(frame, audio, t);
        } catch (e) {
          console.error("[Livelyrics] 素材圖層錯誤：", e);
        }
        const beatIndex = beatIndexAt(this.project, t);
        const ok = r.render({
          current: this.slotDraw(frame.current, audio, t, beatIndex),
          previous: frame.previous ? this.slotDraw(frame.previous, audio, t, beatIndex) : null,
          transition: frame.transition,
          clock: t % 3600,
          media,
        });
        if (!ok) throw new Error(this.rendererError ?? "WebGL 繪製失敗");
      } else throw new Error(this.rendererError ?? "無法使用 WebGL");
    }
    if (req.lyrics) {
      const ctx = this.lyricCanvas.getContext("2d");
      if (ctx && this.painter) this.painter.paint(ctx, { t, matte: false });
    }
    if (req.matte) {
      const ctx = this.matteCanvas.getContext("2d");
      if (ctx && this.painter) this.painter.paint(ctx, { t, matte: true });
    }
  }

  /** Show the hidden lyric DOM (diagnostics: compare the DOM rendering with the painted canvas). */
  setDomVisible(on: boolean, style: Partial<CSSStyleDeclaration> = {}) {
    Object.assign(this.wrap.style, on ? { width: `${this.width}px`, height: `${this.height}px`, zIndex: "9999", background: "#000", ...style } : { width: "0", height: "0", zIndex: "-1" });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.lyrics.destroy();
    this.wrap.remove();
    this.media.destroy();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
