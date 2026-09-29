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
//   A plan with a type system (字體藝術) instead runs the live TypeLayer: its plates go through the
//   same GL type pass as the projection, so the full frame carries the type before the LED safety
//   pass; the background variant is a second render without the type on its own safety chain, and
//   the lyric layer is the type pass rendered alone over transparent.
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
import { StageRenderer, type MediaDraw, type MediaLayerDraw, type SceneDraw, type TypeDraw } from "@/lib/stage/gl/renderer";
import { FlashLimiter, LYRIC_INK, gridSize, projectSafety, transformRgb, type ActiveSafety, type LyricEstimate } from "@/lib/stage/safety";
import { mediaLayerDraw, mediaLyricBox, mediaVideoTime } from "@/lib/stage/media/draw";
import { TREATMENT_CODE, beatAt, resolveMediaFrame, type BeatInfo } from "@/lib/stage/media/model";
import { hashString, rasterizeMotif } from "@/lib/stage/motif";
import { beatIndexAt, buildSceneClock, offlineSceneFrame, type OfflineSceneFrame, type SceneClock } from "@/lib/stage/offline";
import { clampWeight } from "@/lib/stage/lyrics/layout";
import { resolveLineDesign } from "@/lib/stage/resolve";
import { resolveTypography, type StageTypography } from "@/lib/stage/typography";
import { FONTS } from "@/lib/font-meta";
import { hasTypeSystem } from "@/lib/type/resolve";
import { DEFAULT_OUTPUT, outputAspect } from "@/lib/output";
import type { Asset, Project, ProjectOutput, SceneId } from "@/lib/types";
import { LyricLayer } from "../lyrics/LyricLayer";
import { TypeLayer } from "../type/TypeLayer";
import { ExactMedia } from "./ExactMedia";
import { LyricPainter } from "./LyricPainter";

/** Seconds re-run before a jump so smoothing and lyric animations are settled. */
export const PREROLL_SECONDS = 3;
/**
 * LED 安全模式: the last part of the pre-roll also renders the scene through the flash limiter, so
 * its one-second history and the low-pass are settled (covers the detection window and the hold).
 */
export const LIMITER_PREROLL_SECONDS = 1.5;

export interface OfflineFrameRequest {
  /** the complete frame (scene, media and lyrics): read it with `drawFull` */
  scene: boolean;
  /**
   * the background-only picture (scene + media, no lyrics) in `sceneCanvas`; default = `scene`.
   * Legacy plans render one picture for both; a plan with a type system renders the background
   * separately (its full frame carries the type).
   */
  background?: boolean;
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
  /** 字體藝術: the complete frame (scene, media and the type pass); legacy plans compose it in drawFull */
  readonly fullCanvas: HTMLCanvasElement;

  private renderer: StageRenderer | null;
  private wrap: HTMLDivElement;
  private host: HTMLDivElement;
  private lyrics: LyricLayer;
  private painter: LyricPainter | null = null;
  /** 字體藝術: the type layer (plans with a type system) */
  private type: TypeLayer;
  private readonly typeMode: boolean;
  private typeDraw: TypeDraw | null = null;
  /** the background chain's own limiter (type mode: the background is a second picture) */
  private bgLimiter: FlashLimiter | null = null;
  private wantBackground = false;
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
  /** LED 安全模式 of this export (the project's output settings; the export page may turn it off) */
  readonly safety: ActiveSafety;
  private limiter: FlashLimiter | null = null;
  private grid: { cols: number; rows: number };
  private gridBuf: Float32Array;
  /** damping episodes during the export (for the operator note) */
  limiterEngaged = 0;

  constructor(private readonly project: Project) {
    const out = project.output && project.output.width > 0 && project.output.height > 0 ? project.output : DEFAULT_OUTPUT;
    this.output = out;
    this.width = out.width;
    this.height = out.height;
    this.sceneCanvas = makeCanvas(this.width, this.height);
    this.lyricCanvas = makeCanvas(this.width, this.height);
    this.matteCanvas = makeCanvas(this.width, this.height);
    this.fullCanvas = makeCanvas(this.width, this.height);
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
    this.type = new TypeLayer(this.host);
    this.typeMode = hasTypeSystem(project.plan);
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
    this.safety = projectSafety(project);
    this.grid = gridSize(outputAspect(out));
    this.gridBuf = new Float32Array(this.grid.cols * this.grid.rows * 3);
    this.resetLimiter();
  }

  private resetLimiter() {
    const s = this.safety;
    const make = () => (s.on && (s.flashLimit || s.redProtect) ? new FlashLimiter({ ...this.grid, flashLimit: s.flashLimit, redProtect: s.redProtect, gain: s.gain }) : null);
    this.limiter = make();
    this.bgLimiter = this.typeMode ? make() : null;
    this.renderer?.resetSafetyFeedback();
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
    if (this.typeMode && !(await this.type.prepare(project))) warnings.push("排版用的字型沒有全部載入完成，匯出的字形可能和投影不同。請先連上網路開一次投影視窗。");

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
      const bad = await this.renderer.ensureReady([...scenes], used.size > 0, 20000, this.safety.on, this.typeMode);
      if (this.typeMode && this.renderer.typeState() !== "ready") warnings.push("歌詞排版的著色器無法在這台電腦編譯：影片裡不會有排版的歌詞，請換一台電腦匯出。");
      if (this.safety.on && this.renderer.safetyState() !== "ready") warnings.push("LED 安全模式的著色器無法在這台電腦編譯：影片不會套用場景的亮度上限與閃爍限制，請換一台電腦匯出。");
      const sceneBad = bad.filter((k) => !k.startsWith("safety-"));
      if (sceneBad.length) warnings.push(`有 ${sceneBad.length} 個著色器無法編譯，該段會改用漸層場景。`);
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
    const audio = { ...this.mixer.update(project.analysis, frame.state, t, dt, { safe: this.safety.on, hold: !!this.limiter?.damping }) };
    const { state, lyricLook } = frame;
    const lines = project.lyrics?.lines ?? [];
    const line = typeof state.lineIndex === "number" ? lines[state.lineIndex] : undefined;
    const style = line ? resolveLineDesign(project.plan, line.id, lyricLook.lyricStyle, null).style : "hidden";
    const showing = !!line && !!line.text?.trim() && style !== "hidden";
    this.lyricAmt += ((showing ? 1 : 0) - this.lyricAmt) * (dt > 0 ? 1 - Math.exp(-dt / 0.25) : 1);
    if (this.typeMode) {
      // the type layer runs on the same clock (now = song time)
      this.typeDraw = this.type.update({
        project,
        state,
        t,
        nowEpoch: t * 1000,
        now: t * 1000,
        look: lyricLook,
        visible: true,
        safety: this.safety,
        width: this.width,
        height: this.height,
        output: this.output,
      });
      this.lastT = t;
      return { frame, audio };
    }
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
      safety: this.safety,
    });
    this.lastT = t;
    return { frame, audio };
  }

  /** Reset the stateful parts and replay the PREROLL_SECONDS before t at the frame rate. */
  private async preroll(t: number, fps: number) {
    this.mixer = new AudioFeatureMixer();
    this.painter = null;
    this.lyrics.destroy();
    this.lyrics = new LyricLayer(this.host);
    this.painter = new LyricPainter(this.lyrics.root, this.cjkFamily);
    this.type.clear();
    this.lyricAmt = 0;
    this.lastT = null;
    this.resetLimiter();
    const dt = 1 / fps;
    const start = Math.max(0, t - PREROLL_SECONDS);
    const n = Math.floor((t - start) / dt + 1e-6);
    const limiterFrames = this.limiter ? Math.round(LIMITER_PREROLL_SECONDS * fps) : 0;
    // same grid as the export (t − k·dt), so the first real frame steps exactly one frame on
    for (let k = n; k >= 1; k--) {
      const tk = t - k * dt;
      const d = this.lastT == null ? 0 : tk - this.lastT;
      const stepped = this.step(tk, d);
      if (k <= limiterFrames && this.renderer && !this.renderer.lost) {
        await this.renderScene(stepped.frame, stepped.audio, tk, d);
        if (this.typeMode && this.wantBackground) await this.renderScene(stepped.frame, stepped.audio, tk, d, 1);
      }
    }
  }

  /**
   * Scene + media (+ the type pass on chain 0 in type mode) through the LED-safety pass (the
   * zero-lag limiter: this frame's own grid). Chain 1 is the background-only picture.
   */
  private async renderScene(frame: OfflineSceneFrame, audio: StageAudioFrame, t: number, dt: number, chain: 0 | 1 = 0) {
    const r = this.renderer;
    if (!r || r.lost) throw new Error(this.rendererError ?? "無法使用 WebGL");
    let media: MediaDraw | null = null;
    try {
      media = await this.mediaDraw(frame, audio, t);
    } catch (e) {
      console.error("[Livelyrics] 素材圖層錯誤：", e);
    }
    const beatIndex = beatIndexAt(this.project, t);
    const s = this.safety;
    const limiter = chain === 1 ? this.bgLimiter : this.limiter;
    const ok = r.render({
      current: this.slotDraw(frame.current, audio, t, beatIndex),
      previous: frame.previous ? this.slotDraw(frame.previous, audio, t, beatIndex) : null,
      transition: frame.transition,
      clock: t % 3600,
      media,
      safety: s.on ? { soften: s.soften, gain: s.gain, alpha: limiter ? null : 1, measure: limiter ? { ...this.grid, sync: true } : null, chain } : null,
      type: this.typeMode && chain === 0 ? this.typeDraw : null,
    });
    if (!ok) throw new Error(this.rendererError ?? "WebGL 繪製失敗");
    if (limiter) {
      const g = r.lastGrid;
      let alpha = 1;
      if (g && g.cols === this.grid.cols && g.rows === this.grid.rows) {
        const buf = this.gridBuf;
        for (let y = 0; y < g.rows; y++) {
          const src = (g.rows - 1 - y) * g.cols * 4;
          const dst = y * g.cols * 3;
          for (let x = 0; x < g.cols; x++) {
            buf[dst + x * 3] = g.data[src + x * 4] / 255;
            buf[dst + x * 3 + 1] = g.data[src + x * 4 + 1] / 255;
            buf[dst + x * 3 + 2] = g.data[src + x * 4 + 2] / 255;
          }
        }
        const step = limiter.step(t, dt, buf, this.typeMode ? null : this.lyricEstimate(frame));
        alpha = step.alpha;
        if (step.engaged && chain === 0) this.limiterEngaged++;
      }
      r.composeSafety(alpha);
    }
  }

  private lyricEstimate(frame: OfflineSceneFrame): LyricEstimate | null {
    if (this.lyricAmt < 0.02) return null;
    const box = this.lyrics.textBounds();
    if (!box) return null;
    return { box, rgb: transformRgb(this.color(frame.lyricLook.lyricColor), this.safety), amount: this.lyricAmt * LYRIC_INK };
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
    const textBox = layers.some((l) => l.treatment === TREATMENT_CODE["mask-lyrics"]) ? (this.typeMode ? this.type.textBounds(this.output) : this.lyrics.textBounds()) : null;
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
    this.wantBackground = req.background ?? req.scene;
    if (last == null || t < last - 1e-9 || t - last > dt * 1.5) await this.preroll(t, fps);
    const d = this.lastT == null ? 0 : t - this.lastT;
    const { frame, audio } = this.step(t, d);

    if (this.typeMode) {
      await this.renderTypeFrame(frame, audio, t, d, req);
      return;
    }
    if (req.scene || this.wantBackground) await this.renderScene(frame, audio, t, d);
    if (req.lyrics) {
      const ctx = this.lyricCanvas.getContext("2d");
      if (ctx && this.painter) this.painter.paint(ctx, { t, matte: false });
    }
    if (req.matte) {
      const ctx = this.matteCanvas.getContext("2d");
      if (ctx && this.painter) this.painter.paint(ctx, { t, matte: true });
    }
  }

  /** Type mode: the full frame (chain 0), the background (chain 1) and the type layer alone. */
  private async renderTypeFrame(frame: OfflineSceneFrame, audio: StageAudioFrame, t: number, d: number, req: OfflineFrameRequest) {
    const wantFull = req.scene;
    const wantBg = req.background ?? req.scene;
    if (wantFull || req.lyrics || req.matte) {
      await this.renderScene(frame, audio, t, d, 0);
      const ctx = this.fullCanvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.drawImage(this.sceneCanvas, 0, 0);
      }
    }
    if (req.lyrics || req.matte) this.paintTypeLayer(req.lyrics, req.matte);
    if (wantBg) await this.renderScene(frame, audio, t, d, 1);
  }

  /** The type pass alone over transparent into the lyric canvas (coloured) and the matte (white at its alpha). */
  private paintTypeLayer(color: boolean, matte: boolean) {
    const r = this.renderer;
    const W = this.width;
    const H = this.height;
    const lctx = this.lyricCanvas.getContext("2d");
    const mctx = this.matteCanvas.getContext("2d");
    lctx?.clearRect(0, 0, W, H);
    mctx?.clearRect(0, 0, W, H);
    const draw = this.typeDraw;
    if (!r || !draw) return;
    const s = this.safety;
    const data = r.renderTypeLayer(draw, s.on ? s.soften : 0, s.on ? s.gain : 1);
    if (!data) return;
    const col = color && lctx ? lctx.createImageData(W, H) : null;
    const mat = matte && mctx ? mctx.createImageData(W, H) : null;
    // GL rows are bottom-up and premultiplied; canvas image data is top-down and straight
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      const dst = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        const a = data[src + x + 3];
        if (!a) continue;
        if (col) {
          const k = 255 / a;
          col.data[dst + x] = Math.min(255, data[src + x] * k);
          col.data[dst + x + 1] = Math.min(255, data[src + x + 1] * k);
          col.data[dst + x + 2] = Math.min(255, data[src + x + 2] * k);
          col.data[dst + x + 3] = a;
        }
        if (mat) {
          mat.data[dst + x] = 255;
          mat.data[dst + x + 1] = 255;
          mat.data[dst + x + 2] = 255;
          mat.data[dst + x + 3] = a;
        }
      }
    }
    if (col) lctx!.putImageData(col, 0, 0);
    if (mat) mctx!.putImageData(mat, 0, 0);
  }

  /** The complete frame into `ctx` (scene, media and lyrics). */
  drawFull(ctx: CanvasRenderingContext2D) {
    if (this.typeMode) ctx.drawImage(this.fullCanvas, 0, 0);
    else {
      ctx.drawImage(this.sceneCanvas, 0, 0);
      ctx.drawImage(this.lyricCanvas, 0, 0);
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
    this.type.destroy();
    this.wrap.remove();
    this.media.destroy();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
