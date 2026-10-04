// The imperative core behind <StageView>: owns the canvas, the WebGL renderer,
// the lyric layer and the overlays, and runs one requestAnimationFrame loop that
// reads store.get() and derives everything from StageState + project.
// It never throws to its caller: every frame is guarded, GL failures fall back to
// a CSS gradient, and a broken lyric layer disables itself instead of the output.

import { stageAssets } from "@/lib/asset-scope";
import { SCENE_IDS } from "@/lib/schema";
import { parseHex, rgba, type RGB } from "@/lib/stage/color";
import { SceneDirector, TRANSITION_SECONDS, type SceneSlot, type SceneTarget } from "@/lib/stage/director";
import { TRANSITION_CODE } from "@/lib/stage/scenes/composite";
import { AudioFeatureMixer, type StageAudioFrame } from "@/lib/stage/features";
import { StageRenderer, type GridReadback, type MediaDraw, type MediaLayerDraw, type SceneDraw, type TypeDraw } from "@/lib/stage/gl/renderer";
import { FlashLimiter, LYRIC_INK, SAFETY_OFF, gridSize, projectSafety, transformRgb, type ActiveSafety, type LyricEstimate } from "@/lib/stage/safety";
import { placementBox, writingModeFor } from "@/lib/stage/lyrics/layout";
import { TREATMENT_CODE, beatAt, resolveMediaFrame, type BeatInfo, type MediaLayerState } from "@/lib/stage/media/model";
import { isVideoAsset, mediaLayerDraw, mediaLyricBox, mediaVideoTime } from "@/lib/stage/media/draw";
import { DEFAULT_OUTPUT, outputAspect, renderSize } from "@/lib/output";
import { hashString, rasterizeMotif } from "@/lib/stage/motif";
import { stageTime, type StageState, type StageStore } from "@/lib/stage/protocol";
import { clamp, lyricLookAt, resolveLineDesign, resolveLook, type StageLook } from "@/lib/stage/resolve";
import { resolveTypography, type StageTypography } from "@/lib/stage/typography";
import { hasTypeSystem, typeModeActive } from "@/lib/type/resolve";
import { activeProgram, programCode } from "@/lib/stage/program/model";
import { programFrame, programLookKey } from "@/lib/stage/program/runtime";
import type { ProgramDraw } from "@/lib/stage/gl/renderer";
import type { Asset, LyricStyleId, Project, ProjectOutput, SceneId } from "@/lib/types";
import { LyricLayer } from "./lyrics/LyricLayer";
import { TypeLayer } from "./type/TypeLayer";
import { MediaSources } from "./MediaSources";
import { buildGuides, buildTestPattern, type GuidesHandle, type TestPatternHandle } from "./overlays";

export interface StageStats {
  /** frames per second over the last second */
  fps: number;
  /** "webgl2" | "webgl1" | "fallback" (CSS gradient) | "lost" */
  backend: "webgl2" | "webgl1" | "fallback" | "lost";
  /** drawing buffer size in pixels */
  width: number;
  height: number;
  /** adaptive resolution factor currently applied (0.5..1) */
  quality: number;
  scene: SceneId;
  sectionIndex: number | null;
  /** LED 安全模式 (phase 3): what the limiter is doing; null when safe mode is off */
  safety: SafetyStats | null;
  /** 專屬畫面 (phase 7): the song's scene program on this stage; null when the plan has none */
  program: ProgramStatus | null;
}

/**
 * 專屬畫面 on a stage: compiling, drawing, or switched off with the reason (the section's built-in
 * scene is drawn instead: a compile failure, or frames over budget for a sustained period).
 */
export interface ProgramStatus {
  state: "pending" | "ready" | "failed" | "slow" | "override";
  title: string;
  /** the compiler's log (failed) */
  log?: string;
}

/** A program is switched off after this long with frames over PROGRAM_SLOW_DT at the lowest render quality. */
export const PROGRAM_SLOW_SECONDS = 5;
export const PROGRAM_SLOW_DT = 1 / 18;
/** …then the built-in scene draws for this long; the program is switched off only if that is clearly faster */
export const PROGRAM_PROBE_MS = 2500;
export const PROGRAM_SLOW_GAIN = 0.5;
/** a probe that cleared the program waits this long before the next one */
export const PROGRAM_PROBE_COOLDOWN_MS = 30_000;

export interface SafetyStats {
  /** brightness cap (linear, 0.2..1) */
  brightness: number;
  flashLimit: boolean;
  /** the flash limiter is damping right now */
  damping: boolean;
  /** damping episodes since this project went on stage */
  engaged: number;
  /** damping episodes per plan section index */
  bySection: Record<number, number>;
  /** displayed / source transitions in the last second (source = what the design asked for) */
  transitions: number;
  sourceTransitions: number;
  /** the GL safety passes failed to compile: CSS brightness cap only, no flash limiting */
  degraded: boolean;
}

export interface StageEngineOptions {
  forceWebGL1?: boolean;
}

/**
 * Keep the internal render size within ~QHD; lyrics are DOM and stay crisp regardless. A larger
 * output canvas (4K, a 3840 × 1080 wall) raises the cap up to that canvas so the projection
 * window can render it 1:1; adaptive quality still steps down when frames drop.
 */
const MAX_PIXELS = 2560 * 1440;
const MAX_OUTPUT_PIXELS = 3840 * 2160;
const BLACKOUT_SECONDS = 0.4;

export class StageEngine {
  private canvas: HTMLCanvasElement;
  private fallback: HTMLDivElement;
  private overlay: HTMLDivElement;
  private guides: GuidesHandle;
  private testPattern: TestPatternHandle;
  private lyrics: LyricLayer;
  /** 字體藝術 (phase 6): plans with a type system draw their lyrics through the GL type pass */
  private type: TypeLayer;
  private typeMode = false;
  private renderer: StageRenderer | null;
  private director = new SceneDirector();
  private mixer = new AudioFeatureMixer();
  private resizeObserver: ResizeObserver | null = null;

  private project: Project | null = null;
  private store: StageStore | null = null;
  private showGuides = false;
  private renderScale = 1;
  private adaptive = true;
  private transitionScale = 1;
  /** an inspection stage (the lab): anchored transitions hold their moment while paused */
  private inspect = false;
  private quality = 1;
  private onStats: ((s: StageStats) => void) | null = null;

  private raf = 0;
  private last = 0;
  private clock = 0;
  private blackAmt = 0;
  private masterIntensity = 1;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private sizeDirty = true;
  private destroyed = false;
  private errors = 0;
  private motifKey: string | null = null;
  private motifToken = 0;
  private prewarmKey = "";
  private fallbackKey = "";
  private colorCache = new Map<string, RGB>();
  private typography: StageTypography;
  private typographyPlan: unknown = undefined;
  private seed = 0;
  private frameTimes: number[] = [];
  private slowSince = 0;
  private fastSince = 0;
  private statsAt = 0;
  private frames = 0;
  private dprRaw = 0;
  private audio: StageAudioFrame | null = null;
  private beatN = 0;
  private lastBeat = 0;
  private media = new MediaSources();
  private assetMap = new Map<string, Asset>();
  private assetsRef: unknown = undefined;
  private bandAssetsRef: unknown = undefined;
  private assets: Asset[] = [];
  private mediaKey = "";
  private lyricAmt = 0;
  private frozenAt: number | null = null;
  private lastMediaT: number | null = null;
  private lastMediaSection: number | null = null;
  private fadeOk = false;
  private mediaLayers = 0;
  private textBox: [number, number, number, number] | null = null;
  private textBoxAt = 0;
  private output: ProjectOutput = DEFAULT_OUTPUT;
  // LED 安全模式 (phase 3)
  private safety: ActiveSafety = SAFETY_OFF;
  private limiter: FlashLimiter | null = null;
  /** α of every rendered frame whose grid has not been observed yet, by render serial */
  private pendingAlpha = new Map<number, { t: number; alpha: number; lyric: LyricEstimate | null }>();
  private gridBuf: Float32Array | null = null;
  private engagedBySection: Record<number, number> = {};
  private engagedTotal = 0;
  private lastDamping = false;
  private lastFps = 0;
  private cssCapKey = "";
  private lyricBoxAt = 0;
  private lyricBox: [number, number, number, number] | null = null;
  // 專屬畫面 (phase 7)
  /** program keys switched off on this stage, with why */
  private programOff = new Map<string, { state: "failed" | "slow"; log?: string }>();
  private programOffKeys = new Set<string>();
  private programStatus: ProgramStatus | null = null;
  private programStatusKey = "";
  private slowFor = 0;
  /** smoothed frame time while the program draws */
  private programDt = 1 / 60;
  /** the built-in scene stands in for a moment to see whether the program is the slow part */
  private probe: { key: string; until: number; sum: number; n: number; programDt: number } | null = null;
  private probeAfter = 0;
  private statsDirty = false;

  constructor(
    private readonly root: HTMLElement,
    opts: StageEngineOptions = {},
  ) {
    this.fallback = document.createElement("div");
    Object.assign(this.fallback.style, { position: "absolute", inset: "0", transition: "background 1s ease", display: "none" });
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
    this.canvas.setAttribute("aria-hidden", "true");
    root.append(this.fallback, this.canvas);

    this.lyrics = new LyricLayer(root);
    this.type = new TypeLayer(root, this.lyrics.root);
    this.testPattern = buildTestPattern();
    this.overlay = document.createElement("div");
    Object.assign(this.overlay.style, { position: "absolute", inset: "0", background: "#000", opacity: "0", pointerEvents: "none" });
    this.guides = buildGuides();
    root.append(this.testPattern.root, this.overlay, this.guides.root);

    this.renderer = StageRenderer.create(this.canvas, {
      forceWebGL1: opts.forceWebGL1,
      onError: (m) => console.error(`[Livelyrics] ${m}`),
      onContextChange: (lost) => {
        this.sizeDirty = true;
        if (!lost) this.prewarmKey = "";
      },
    });
    if (!this.renderer) {
      this.canvas.style.display = "none";
      console.warn("[Livelyrics] 無法使用 WebGL，舞台改用 CSS 漸層背景。");
    }
    this.typography = resolveTypography(null);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.sizeDirty = true;
      });
      this.resizeObserver.observe(root);
    }
    document.fonts?.addEventListener?.("loadingdone", this.onFontsLoaded);
    document.fonts?.ready?.then(this.onFontsLoaded).catch(() => {});
    this.raf = requestAnimationFrame(this.tick);
  }

  // -------------------------------------------------------------------------
  // inputs

  setProject(project: Project | null) {
    const previousId = this.project?.id ?? null;
    this.project = project;
    if (!project) return;
    if (previousId != null && project.id !== previousId) this.startOver();
    this.seed = (hashString(project.id || "stage") % 1000) / 37;
    const plan = project.plan;
    if (plan !== this.typographyPlan) {
      this.typographyPlan = plan;
      this.typography = resolveTypography(plan);
    }
    // the type pass compiles ahead of the scenes: the first line must not wait for it
    if (hasTypeSystem(plan)) this.renderer?.prewarmType();
    const output = project.output && project.output.width > 0 && project.output.height > 0 ? project.output : DEFAULT_OUTPUT;
    if (output.width !== this.output.width || output.height !== this.output.height) this.sizeDirty = true;
    this.output = output;
    this.syncMedia(project);
    const svg = plan?.keyVisual?.motifSvg ?? "";
    const motifKey = `${project.id}|${svg}`;
    if (motifKey !== this.motifKey) {
      this.motifKey = motifKey;
      const token = ++this.motifToken;
      void rasterizeMotif(svg, `${project.meta?.title ?? ""}${project.id}`).then(({ canvas }) => {
        if (token === this.motifToken && !this.destroyed) this.renderer?.setMotif(canvas);
      });
    }
  }

  /**
   * Another project replaced the one on stage (the show output's next item): its first frame is
   * its own look, without a section cross-fade from the previous item (the take's fade through
   * black, or a deliberate cut, is the transition) and without the old media / freeze state.
   */
  private startOver() {
    this.director.reset();
    this.lastMediaT = null;
    this.lastMediaSection = null;
    this.fadeOk = false;
    this.frozenAt = null;
    this.lyricAmt = 0;
    this.textBox = null;
    this.audio = null;
    this.resetLimiter();
    this.slowFor = 0;
  }

  /** A new project (or safe mode turned on): the limiter and the low-pass start from scratch. */
  private resetLimiter() {
    this.limiter?.reset();
    this.pendingAlpha.clear();
    this.renderer?.resetSafetyFeedback();
    this.engagedBySection = {};
    this.engagedTotal = 0;
    this.lastDamping = false;
    this.lyricBox = null;
  }

  /** Load the band media the plan uses (and keep the asset lookup current). */
  private syncMedia(project: Project) {
    const raw = Array.isArray(project.assets) ? project.assets : [];
    const used = new Set<string>();
    for (const s of project.plan?.sections ?? []) if (s?.media?.assetId) used.add(s.media.assetId);
    if (raw !== this.assetsRef || project.bandAssets !== this.bandAssetsRef) {
      this.assetsRef = raw;
      this.bandAssetsRef = project.bandAssets;
      this.assets = stageAssets(project);
      this.assetMap = new Map(this.assets.map((a) => [a.id, a]));
    }
    const assets = this.assets;
    const key = `${project.id}|${project.bandId ?? ""}|${assets.map((a) => `${a.id}:${a.file}:${a.scope ?? ""}`).join(",")}|${[...used].sort().join(",")}`;
    if (key === this.mediaKey) return;
    this.mediaKey = key;
    this.media.setAssets(project, assets, used);
    this.renderer?.pruneMedia(new Set(assets.map((a) => a.id)));
    if (used.size) this.renderer?.prewarmMedia();
  }

  setStore(store: StageStore) {
    this.store = store;
  }

  setShowGuides(on: boolean) {
    this.showGuides = on;
  }

  setRenderScale(scale: number) {
    const s = clamp(scale, 0.25, 1, 1);
    if (s !== this.renderScale) {
      this.renderScale = s;
      this.sizeDirty = true;
    }
  }

  setAdaptive(on: boolean) {
    this.adaptive = on;
    if (!on && this.quality !== 1) {
      this.quality = 1;
      this.sizeDirty = true;
    }
  }

  /** slow down section transitions (stage lab inspection); 1 = normal */
  /** The stage lab: a paused song holds a section transition at its anchored moment (frame captures). */
  setInspect(on: boolean) {
    this.inspect = on;
  }

  setTransitionScale(scale: number) {
    this.transitionScale = clamp(scale, 0.1, 50, 1);
  }

  setOnStats(cb: ((s: StageStats) => void) | null) {
    this.onStats = cb;
  }

  private onFontsLoaded = () => {
    if (this.destroyed) return;
    this.lyrics.invalidateFit();
    this.type.invalidate();
  };

  // -------------------------------------------------------------------------
  // frame loop

  private tick = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
    try {
      this.frame(now);
    } catch (e) {
      this.errors++;
      if (this.errors <= 3) console.error("[Livelyrics] 舞台繪製錯誤：", e);
    }
  };

  private color(hex: string): RGB {
    let c = this.colorCache.get(hex);
    if (!c) {
      c = parseHex(hex);
      if (this.colorCache.size > 64) this.colorCache.clear();
      this.colorCache.set(hex, c);
    }
    return c;
  }

  private resize() {
    this.sizeDirty = false;
    const rect = this.root.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const out = this.output;
    const cap = Math.min(MAX_OUTPUT_PIXELS, Math.max(MAX_PIXELS, out.width * out.height));
    const [w, h] = renderSize(this.cssW, this.cssH, this.dpr * this.renderScale * this.quality, out, cap);
    this.renderer?.setSize(w, h);
    this.testPattern.setSize(out.width, out.height);
    this.guides.setCanvas(out.lyricSafe, out.width, out.height);
    this.lyrics.invalidateFit();
  }

  private prewarm(project: Project | null) {
    if (!this.renderer) return;
    const planScenes = (project?.plan?.sections ?? []).map((s) => s.scene);
    const program = activeProgram(project?.plan);
    const code = program ? programCode(program) : null;
    const key = `${planScenes.join(",")}|${hasTypeSystem(project?.plan) ? "type" : ""}|${code?.key ?? ""}`;
    if (key === this.prewarmKey) return;
    this.prewarmKey = key;
    if (hasTypeSystem(project?.plan)) this.renderer.prewarmType();
    // 專屬畫面: the song's own program compiles first (the built-in scenes cover it until then)
    if (code) this.renderer.prewarmProgram(code.key, code.code);
    // the plan's scenes first, then the rest so operator overrides never stall
    this.renderer.prewarm([...new Set<SceneId>([...planScenes, "gradient", ...SCENE_IDS])]);
    // LED 安全模式 is on by default: its passes go first (a safe frame needs them)
    this.renderer.prewarmSafety();
  }

  private adapt(now: number, dt: number) {
    if (!this.adaptive || !this.renderer || dt <= 0 || dt > 0.25) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    if (this.frameTimes.length < 20) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    if (avg > 0.024) {
      this.fastSince = 0;
      if (!this.slowSince) this.slowSince = now;
      if (now - this.slowSince > 1500 && this.quality > 0.5) {
        this.quality = Math.max(0.5, this.quality * 0.85);
        this.slowSince = now;
        this.frameTimes = [];
        this.sizeDirty = true;
      }
    } else if (avg < 0.0185) {
      this.slowSince = 0;
      if (!this.fastSince) this.fastSince = now;
      if (now - this.fastSince > 4000 && this.quality < 1) {
        this.quality = Math.min(1, this.quality * 1.12);
        this.fastSince = now;
        this.frameTimes = [];
        this.sizeDirty = true;
      }
    } else {
      this.slowSince = 0;
      this.fastSince = 0;
    }
  }

  /** The deterministic beat grid, or the live/tap beat when the song has no analysis grid. */
  private beatFor(project: Project, t: number, audio: StageAudioFrame): BeatInfo {
    const b = beatAt(project.analysis, t);
    if (b) return b;
    return { index: this.beatN, phase: audio.beat, start: t - audio.beat * 0.5 };
  }

  private mediaLayer(layer: MediaLayerState, t: number, beat: BeatInfo, playing: boolean, now: number): MediaLayerDraw | null {
    const isVideo = isVideoAsset(layer);
    const wanted = mediaVideoTime(layer, t, beat);
    const src = this.media.frame(layer.asset, now, isVideo ? { wanted, playing } : undefined);
    return mediaLayerDraw(layer, t, beat, src, outputAspect(this.output), (hex) => this.color(hex));
  }

  private presence: { showing: boolean; style: LyricStyleId } = { showing: false, style: "hidden" };

  /** Is a lyric line on screen (not hidden)? Updates the smoothed lyric amount. */
  private updatePresence(project: Project, state: StageState, lyricLook: StageLook, dt: number) {
    const lines = project.lyrics?.lines ?? [];
    const idx = state.lineIndex;
    const line = typeof idx === "number" ? lines[idx] : undefined;
    const style = line ? resolveLineDesign(project.plan, line.id, lyricLook.lyricStyle, this.typeMode ? null : state.overrides?.lyricStyle).style : "hidden";
    const showing = !!line && !!line.text?.trim() && style !== "hidden" && state.overrides?.lyricsVisible !== false;
    this.lyricAmt += ((showing ? 1 : 0) - this.lyricAmt) * (dt > 0 ? 1 - Math.exp(-dt / 0.25) : 1);
    this.presence = { showing, style };
  }

  private mediaDraw(project: Project, state: StageState, t: number, look: StageLook, lyricLook: StageLook, audio: StageAudioFrame, now: number): MediaDraw | null {
    const frozen = !!state.overrides?.freeze;
    if (frozen && this.frozenAt == null) this.frozenAt = t;
    if (!frozen) this.frozenAt = null;
    const mt = frozen && this.frozenAt != null ? this.frozenAt : t;
    // lyric presence for mask-lyrics (computed once per frame in frame())
    const { showing, style } = this.presence;

    // cross-fade only while the song plays continuously through a boundary; a paused stage or a
    // jump (seek, cue, section click) shows the section's media at once
    const continuous = !!state.playing && !frozen && this.lastMediaT != null && mt >= this.lastMediaT - 0.05 && mt - this.lastMediaT < 0.5;
    if (!continuous) this.fadeOk = false;
    if (look.sectionIndex !== this.lastMediaSection) {
      this.lastMediaSection = look.sectionIndex;
      this.fadeOk = continuous;
    }
    this.lastMediaT = mt;
    const frame = resolveMediaFrame(project.plan, this.assetMap, look.sectionIndex, mt, look.colorway, this.fadeOk);
    if (!frame.current && !frame.previous) {
      this.mediaLayers = 0;
      this.media.idle(now);
      return null;
    }
    const beat = this.beatFor(project, mt, audio);
    const playing = !!state.playing && !frozen;
    const layers: MediaLayerDraw[] = [];
    for (const l of [frame.current, frame.previous]) {
      if (!l) continue;
      const d = this.mediaLayer(l, mt, beat, playing, now);
      if (d) layers.push(d);
    }
    this.media.idle(now);
    this.mediaLayers = layers.length;
    if (!layers.length) return null;
    // the measured text (5 times a second) for mask-lyrics, else the placement box
    if (layers.some((l) => l.treatment === TREATMENT_CODE["mask-lyrics"]) && now - this.textBoxAt > 200) {
      this.textBoxAt = now;
      const b = this.typeMode ? this.type.textBounds(this.output) : this.lyrics.textBounds();
      if (b) this.textBox = b;
    }
    const lyricBox = mediaLyricBox(this.textBox, showing, style, lyricLook, this.output.lyricSafe, outputAspect(this.output));
    return { layers, time: mt, lyricBox, lyricAmount: this.lyricAmt };
  }

  private slotDraw(slot: SceneSlot, audio: StageAudioFrame): SceneDraw {
    const t = slot.target;
    return {
      scene: t.scene,
      lookKey: t.lookKey,
      uniforms: {
        time: slot.clock,
        clock: this.clock,
        bg: this.color(t.colorway[0]),
        primary: this.color(t.colorway[1]),
        accent: this.color(t.colorway[2]),
        speed: t.params.speed,
        density: t.params.density,
        intensity: t.params.intensity * this.masterIntensity,
        reactivity: t.params.reactivity,
        level: audio.level,
        bass: audio.bass,
        onset: audio.onset,
        beat: audio.beat,
        beatIndex: this.beatN,
        energy: audio.energy,
        pulse: audio.pulse,
        seed: this.seed,
      },
      program: (t.program as ProgramDraw | null | undefined) ?? null,
    };
  }

  /** 專屬畫面: this frame's program values (null = the built-in scene). */
  private programDraw(project: Project, look: StageLook, t: number, audio: StageAudioFrame): ProgramDraw | null {
    if (!activeProgram(project.plan)) return null;
    return programFrame({
      project,
      look,
      t,
      beat: audio.beat,
      beatIndex: this.beatN,
      master: this.masterIntensity,
      typeBox: this.typeMode ? this.type.textBounds(this.output) : null,
      typeAmt: this.typeMode ? this.lyricAmt : 0,
      disabled: this.programOffKeys,
      color: (hex) => this.color(hex),
    });
  }

  /** After a render: a program that failed to compile, or runs over budget, is switched off here. */
  private checkProgram(project: Project, look: StageLook, pd: ProgramDraw | null, dt: number) {
    const r = this.renderer;
    const program = activeProgram(project.plan);
    if (!program || !r) {
      this.setProgramStatus(null);
      return;
    }
    const code = programCode(program);
    const off = code ? this.programOff.get(code.key) : undefined;
    if (!code) {
      this.setProgramStatus({ state: "failed", title: program.title, log: "程式沒有通過檢查" });
      return;
    }
    if (off) {
      this.setProgramStatus({ state: off.state, title: program.title, ...(off.log ? { log: off.log } : {}) });
      return;
    }
    const st = r.programState(code.key);
    if (st.state === "failed") {
      this.programOff.set(code.key, { state: "failed", log: st.log });
      this.programOffKeys.add(code.key);
      console.warn(`[Livelyrics] 專屬畫面「${program.title}」無法編譯，已改用內建場景。`);
      this.setProgramStatus({ state: "failed", title: program.title, ...(st.log ? { log: st.log } : {}) });
      return;
    }
    const now = performance.now();
    // a probe runs: the built-in scene for a moment, to see whether the program is what is slow
    const probe = this.probe;
    if (probe && probe.key === code.key) {
      if (dt > 0 && dt < 0.25) {
        probe.sum += dt;
        probe.n++;
      }
      if (now >= probe.until && probe.n >= 10) {
        this.probe = null;
        const builtIn = probe.sum / probe.n;
        if (builtIn < probe.programDt * PROGRAM_SLOW_GAIN) {
          // the built-in scene is clearly faster: the program is over budget here
          this.programOff.set(code.key, { state: "slow" });
          // a handled fallback (the operator sees it on the preview): informational
          console.info(`[Livelyrics] 專屬畫面「${program.title}」太耗效能，已改用內建場景。`);
          this.quality = 1;
          this.sizeDirty = true;
          this.setProgramStatus({ state: "slow", title: program.title });
          return;
        }
        // the whole machine is slow, not the program: back to it, and no new probe for a while
        this.programOffKeys.delete(code.key);
        this.probeAfter = now + PROGRAM_PROBE_COOLDOWN_MS;
        this.slowFor = 0;
      }
      this.setProgramStatus({ state: "ready", title: program.title });
      return;
    }
    if (!pd) {
      // the operator forced a built-in scene (or a blackout scene): the program waits
      this.slowFor = 0;
      this.setProgramStatus({ state: look.scene === "blackout" ? "ready" : "override", title: program.title });
      return;
    }
    // the frame budget: already at the lowest adaptive quality and still slow for a sustained period
    // then a short probe with the built-in scene decides whether the program is the cause
    if (st.state === "ready" && this.adaptive && this.quality <= 0.51 && dt > 0 && dt < 0.25) {
      this.programDt += (dt - this.programDt) * 0.05;
      this.slowFor = dt > PROGRAM_SLOW_DT ? this.slowFor + dt : Math.max(0, this.slowFor - dt * 0.5);
      if (this.slowFor > PROGRAM_SLOW_SECONDS && now >= this.probeAfter) {
        this.probe = { key: code.key, until: now + PROGRAM_PROBE_MS, sum: 0, n: 0, programDt: this.programDt };
        this.programOffKeys.add(code.key);
        this.slowFor = 0;
      }
    } else this.slowFor = Math.max(0, this.slowFor - dt);
    this.setProgramStatus({ state: st.state === "ready" ? "ready" : "pending", title: program.title });
  }

  private setProgramStatus(s: ProgramStatus | null) {
    const key = s ? `${s.state}|${s.title}|${s.log ?? ""}` : "";
    if (key === this.programStatusKey) return;
    this.programStatusKey = key;
    this.programStatus = s;
    this.statsDirty = true;
    if (s) this.root.dataset.sceneProgram = s.state;
    else delete this.root.dataset.sceneProgram;
  }

  private updateFallback(look: StageLook, visible: boolean) {
    const [bg, pri, acc] = look.colorway;
    const key = visible ? `${look.scene}|${bg}|${pri}|${acc}` : "hidden";
    if (key === this.fallbackKey) return;
    this.fallbackKey = key;
    this.fallback.style.display = visible ? "block" : "none";
    if (!visible) return;
    this.fallback.style.background =
      look.scene === "blackout"
        ? "#000"
        : `radial-gradient(120% 90% at 22% 18%, ${rgba(pri, 0.55)} 0%, transparent 60%), radial-gradient(100% 80% at 82% 88%, ${rgba(acc, 0.4)} 0%, transparent 58%), ${bg}`;
  }

  private frame(now: number) {
    const store = this.store;
    const project = this.project;
    if (!store || !project) return;
    // animation steps are capped so a stall does not jump the scene; the blackout uses real time
    const elapsed = this.last ? Math.max(0, (now - this.last) / 1000) : 0;
    const dt = Math.min(0.1, elapsed);
    this.last = now;
    this.adapt(now, dt);
    if ((window.devicePixelRatio || 1) !== this.dprRaw) {
      this.dprRaw = window.devicePixelRatio || 1;
      this.sizeDirty = true;
    }
    if (this.sizeDirty) this.resize();
    this.prewarm(project);

    const state: StageState = store.get();
    const nowEpoch = Date.now();
    let t = stageTime(state, nowEpoch);
    if (!Number.isFinite(t)) t = 0;
    const look = resolveLook(project, state, t);
    const ov = state.overrides;
    const frozen = !!ov?.freeze;
    if (!frozen) this.clock = (this.clock + dt) % 3600;

    // LED 安全模式: settings come with the project (project.output.safety; missing = on)
    const safety = projectSafety(project);
    if (safety.on !== this.safety.on) {
      this.resetLimiter();
      if (safety.on) this.renderer?.prewarmSafety();
    }
    this.safety = safety;
    const limiting = safety.on && (safety.flashLimit || safety.redProtect);
    const grid = gridSize(outputAspect(this.output));
    if (limiting) {
      if (!this.limiter || this.limiter.cols !== grid.cols || this.limiter.rows !== grid.rows) {
        this.limiter = new FlashLimiter({ ...grid, flashLimit: safety.flashLimit, redProtect: safety.redProtect, gain: safety.gain });
        this.pendingAlpha.clear();
      } else this.limiter.configure({ flashLimit: safety.flashLimit, redProtect: safety.redProtect, gain: safety.gain });
    }
    const limiter = limiting ? this.limiter : null;

    // a freeze is a true still frame: audio-reactive uniforms hold as well
    if (!frozen || !this.audio) this.audio = { ...this.mixer.update(project.analysis, state, t, dt, { safe: safety.on, hold: !!limiter?.damping }) };
    const audio = this.audio;
    if (audio.beat < this.lastBeat - 0.5) this.beatN++;
    this.lastBeat = audio.beat;
    const targetIntensity = clamp(ov?.intensity ?? 1, 0, 1.5, 1);
    this.masterIntensity += (targetIntensity - this.masterIntensity) * (1 - Math.exp(-dt / 0.15));
    if (dt === 0) this.masterIntensity = targetIntensity;

    // 專屬畫面: the song's program for this frame (null = the section's built-in scene)
    const pd = this.renderer && !this.renderer.lost ? this.programDraw(project, look, t, audio) : null;
    // round 12: in track playback the section transition follows the song clock (a seek into the
    // first second of a section, a frame capture and the export show the same moment of it); a
    // stage that opens inside the window gets the previous section as its outgoing slot
    let anchor: number | null = null;
    let previousTarget: SceneTarget | null = null;
    const sec = look.section;
    if (state.mode === "track" && sec && look.sectionIndex != null && look.sectionIndex > 0 && look.transitionIn !== "cut") {
      const elapsed = t - sec.start;
      if (elapsed >= 0 && elapsed < TRANSITION_SECONDS[look.transitionIn] * this.transitionScale + 0.05) {
        anchor = elapsed;
        if (!this.director.started) {
          const prevLook = resolveLook(project, { ...state, sectionIndex: look.sectionIndex - 1 }, t);
          const ppd = this.renderer && !this.renderer.lost ? this.programDraw(project, prevLook, t, audio) : null;
          previousTarget = { scene: prevLook.scene, params: prevLook.params, colorway: prevLook.colorway, lookKey: programLookKey(prevLook.lookKey, ppd), program: ppd };
        }
      }
    }
    const df = this.director.update({
      target: { scene: look.scene, params: look.params, colorway: look.colorway, lookKey: programLookKey(look.lookKey, pd), program: pd },
      sectionKey: look.sectionIndex == null ? null : String(look.sectionIndex),
      transitionIn: look.transitionIn,
      now,
      dt,
      frozen,
      energy: audio.energy,
      durationScale: this.transitionScale,
      anchor,
      previousTarget,
      hold: this.inspect && !state.playing,
    });
    // the current slot always carries this frame's program values (an outgoing slot keeps its last)
    df.current.target.program = pd;

    // blackout ramp (smooth ~0.4 s, eased), timed by the wall clock: even a struggling GPU
    // at a few fps reaches full black 0.4 s after B is pressed
    const bTarget = ov?.blackout ? 1 : 0;
    const bStep = elapsed / BLACKOUT_SECONDS;
    this.blackAmt = bTarget > this.blackAmt ? Math.min(1, this.blackAmt + bStep) : Math.max(0, this.blackAmt - bStep);
    if (elapsed === 0) this.blackAmt = bTarget;
    const b = this.blackAmt;
    this.overlay.style.opacity = String(Math.round(b * b * (3 - 2 * b) * 1000) / 1000);

    // lyrics: styled by the section the line is sung in (a pickup keeps its style across the boundary)
    const lyricLook = lyricLookAt(project, state, t, look);
    // 字體藝術: a plan with a type system composes every line (unless the operator forces a legacy style)
    const typeMode = typeModeActive(project.plan, ov);
    if (typeMode !== this.typeMode) {
      this.typeMode = typeMode;
      if (typeMode) this.lyrics.clear();
      else this.type.clear();
    }
    this.updatePresence(project, state, lyricLook, dt);

    // the type layer (its texture goes into the GL pass; without WebGL it paints into the DOM)
    const r = this.renderer;
    let typeDraw: TypeDraw | null = null;
    if (typeMode) {
      this.type.setDomMode(!r || r.lost);
      const [bw, bh] = r && !r.lost ? r.size : [Math.round(this.cssW * this.dpr), Math.round(this.cssH * this.dpr)];
      typeDraw = this.type.update({
        project,
        state,
        t,
        nowEpoch,
        now,
        look: lyricLook,
        visible: ov?.lyricsVisible !== false,
        safety,
        liveBeat: project.analysis?.beats?.length ? null : { phase: audio.beat, index: 0 },
        width: bw,
        height: bh,
        output: this.output,
        // the section transition reaches the words that enter with it
        transition: df.transition && sec ? { kind: TRANSITION_CODE[df.transition.kind], progress: df.transition.progress, sectionStart: sec.start, seconds: TRANSITION_SECONDS[df.transition.kind] * this.transitionScale } : null,
      });
    }

    // scene + band media
    let backend: StageStats["backend"] = "fallback";
    if (r && !r.lost) {
      backend = r.kind;
      r.idle();
      if (this.blackAmt < 1) {
        let media: MediaDraw | null = null;
        try {
          media = this.mediaDraw(project, state, t, look, lyricLook, audio, now);
        } catch (e) {
          // a media problem never takes the scene down
          this.errors++;
          if (this.errors <= 3) console.error("[Livelyrics] 素材圖層錯誤：", e);
        }
        const alpha = limiter ? limiter.alphaFor(dt) : 1;
        const ok = r.render({
          current: this.slotDraw(df.current, audio),
          previous: df.previous ? this.slotDraw(df.previous, audio) : null,
          transition: df.transition,
          clock: this.clock,
          media,
          safety: safety.on ? { soften: safety.soften, gain: safety.gain, alpha, measure: limiter ? { ...grid, sync: false } : null } : null,
          type: typeDraw ? { ...typeDraw, relation: pd ? pd.relation : 0 } : null,
        });
        this.checkProgram(project, look, pd, dt);
        if (!ok) backend = "lost";
        else if (limiter) {
          this.pendingAlpha.set(r.frameSerial, { t: now / 1000, alpha, lyric: this.lyricEstimate(lyricLook, now) });
          this.observeGrids(limiter, r.takeGrids(), look.sectionIndex);
        }
      }
    } else if (r?.lost) backend = "lost";
    this.applyCssCap(safety, r != null && !r.lost && safety.on && r.safetyState() === "failed");
    this.updateFallback(look, backend === "fallback" || backend === "lost");
    this.canvas.style.visibility = backend === "fallback" || backend === "lost" ? "hidden" : "visible";

    if (!typeMode)
      this.lyrics.update({
        project,
        state,
        t,
        nowEpoch,
        now,
        look: lyricLook,
        typography: this.typography,
        pulse: audio.pulse * look.params.reactivity,
        visible: ov?.lyricsVisible !== false,
        aspect: outputAspect(this.output),
        safe: this.output.lyricSafe,
        safety,
      });

    // overlays
    const test = !!ov?.testPattern;
    this.testPattern.root.style.display = test ? "block" : "none";
    const guides = this.showGuides || test;
    this.guides.root.style.display = guides ? "block" : "none";
    if (guides) {
      const lines = project.lyrics?.lines ?? [];
      const idx = state.lineIndex;
      const line = typeof idx === "number" ? lines[idx] : undefined;
      const style = line ? resolveLineDesign(project.plan, line.id, lyricLook.lyricStyle, ov?.lyricStyle).style : lyricLook.lyricStyle;
      this.guides.setPlacement(
        style === "hidden" ? null : placementBox(lyricLook.placement, writingModeFor(style, lyricLook.placement), this.output.lyricSafe, outputAspect(this.output)),
      );
    }

    // stats
    this.frames++;
    if (!this.statsAt) this.statsAt = now;
    const damping = !!limiter?.damping;
    const dampingChanged = damping !== this.lastDamping;
    this.lastDamping = damping;
    if (now - this.statsAt >= 1000 || dampingChanged || this.statsDirty) {
      this.statsDirty = false;
      if (now - this.statsAt >= 1000) {
        this.lastFps = (this.frames * 1000) / (now - this.statsAt);
        this.frames = 0;
        this.statsAt = now;
      }
      const [w, h] = r?.size ?? [0, 0];
      this.root.dataset.stageBackend = backend;
      // diagnostics (e2e): how many media layers the last frame drew, and the LED-safety state
      this.root.dataset.stageMedia = String(this.mediaLayers);
      this.root.dataset.safety = safety.on ? String(Math.round(safety.brightness * 100)) : "off";
      this.root.dataset.transition = df.transition ? `${df.transition.kind}:${df.transition.progress.toFixed(2)}` : "none";
      this.root.dataset.limiter = damping ? "damping" : limiter ? "idle" : "off";
      this.root.dataset.limiterEngaged = String(this.engagedTotal);
      const st = limiter?.status;
      const safetyStats: SafetyStats | null = safety.on
        ? {
            brightness: safety.brightness,
            flashLimit: safety.flashLimit,
            damping,
            engaged: this.engagedTotal,
            bySection: { ...this.engagedBySection },
            transitions: st?.transitions ?? 0,
            sourceTransitions: st?.sourceTransitions ?? 0,
            degraded: !!r && !r.lost && r.safetyState() === "failed",
          }
        : null;
      try {
        this.onStats?.({ fps: this.lastFps, backend, width: w, height: h, quality: this.quality, scene: look.scene, sectionIndex: look.sectionIndex, safety: safetyStats, program: this.programStatus });
      } catch {
        /* consumer errors must not break the stage */
      }
    }
  }

  /** The lyric layer's estimated share of the luminance grid (the text is DOM, not in the readback). */
  private lyricEstimate(lyricLook: StageLook, now: number): LyricEstimate | null {
    // the type pass draws the lyrics into the measured frame: nothing to estimate
    if (this.typeMode || this.lyricAmt < 0.02) return null;
    // the measured text box, 5 times a second (reads layout)
    if (now - this.lyricBoxAt > 200) {
      this.lyricBoxAt = now;
      this.lyricBox = this.lyrics.textBounds();
    }
    if (!this.lyricBox) return null;
    return { box: this.lyricBox, rgb: transformRgb(this.color(lyricLook.lyricColor), this.safety), amount: this.lyricAmt * LYRIC_INK };
  }

  /** Feed completed grid readbacks to the limiter (frames without a readback fold their α in). */
  private observeGrids(limiter: FlashLimiter, grids: GridReadback[], sectionIndex: number | null) {
    for (const g of grids) {
      let keep = 1;
      let meta: { t: number; alpha: number; lyric: LyricEstimate | null } | null = null;
      for (const [serial, m] of this.pendingAlpha) {
        if (serial > g.serial) break;
        keep *= 1 - m.alpha;
        meta = m;
        this.pendingAlpha.delete(serial);
      }
      if (!meta || g.cols !== limiter.cols || g.rows !== limiter.rows) continue;
      const n = g.cols * g.rows;
      if (!this.gridBuf || this.gridBuf.length !== n * 3) this.gridBuf = new Float32Array(n * 3);
      const buf = this.gridBuf;
      // GL rows are bottom-up; the limiter wants the top row first
      for (let y = 0; y < g.rows; y++) {
        const src = (g.rows - 1 - y) * g.cols * 4;
        const dst = y * g.cols * 3;
        for (let x = 0; x < g.cols; x++) {
          buf[dst + x * 3] = g.data[src + x * 4] / 255;
          buf[dst + x * 3 + 1] = g.data[src + x * 4 + 1] / 255;
          buf[dst + x * 3 + 2] = g.data[src + x * 4 + 2] / 255;
        }
      }
      const step = limiter.observe(meta.t, buf, 1 - keep, meta.lyric);
      if (step.engaged) {
        this.engagedTotal++;
        if (sectionIndex != null) this.engagedBySection[sectionIndex] = (this.engagedBySection[sectionIndex] ?? 0) + 1;
      }
    }
    // readbacks that never came back (context trouble) must not pile up
    if (this.pendingAlpha.size > 12) {
      const drop = [...this.pendingAlpha.keys()].slice(0, this.pendingAlpha.size - 12);
      for (const k of drop) this.pendingAlpha.delete(k);
    }
  }

  /**
   * Layers outside the GL pass: the CSS fallback background, the test pattern, and the scene canvas
   * itself when the safety shaders failed to compile, get the brightness cap as a CSS filter.
   */
  private applyCssCap(safety: ActiveSafety, glFailed: boolean) {
    const key = `${safety.on ? safety.gain.toFixed(4) : "off"}|${glFailed}`;
    if (key === this.cssCapKey) return;
    this.cssCapKey = key;
    const f = safety.on && safety.gain < 0.999 ? `brightness(${safety.gain.toFixed(4)})` : "";
    this.fallback.style.filter = f;
    this.testPattern.root.style.filter = f;
    this.type.setDomFilter(f);
    this.canvas.style.filter = glFailed ? f : "";
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    document.fonts?.removeEventListener?.("loadingdone", this.onFontsLoaded);
    this.renderer?.dispose();
    this.renderer = null;
    this.media.destroy();
    this.lyrics.destroy();
    this.type.destroy();
    this.canvas.remove();
    this.fallback.remove();
    this.overlay.remove();
    this.guides.root.remove();
    this.testPattern.root.remove();
  }
}
