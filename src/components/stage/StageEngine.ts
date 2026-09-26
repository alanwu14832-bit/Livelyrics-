// The imperative core behind <StageView>: owns the canvas, the WebGL renderer,
// the lyric layer and the overlays, and runs one requestAnimationFrame loop that
// reads store.get() and derives everything from StageState + project.
// It never throws to its caller: every frame is guarded, GL failures fall back to
// a CSS gradient, and a broken lyric layer disables itself instead of the output.

import { SCENE_IDS } from "@/lib/schema";
import { parseHex, rgba, type RGB } from "@/lib/stage/color";
import { SceneDirector, type SceneSlot } from "@/lib/stage/director";
import { AudioFeatureMixer, type StageAudioFrame } from "@/lib/stage/features";
import { StageRenderer, type SceneDraw } from "@/lib/stage/gl/renderer";
import { placementBox, writingModeFor } from "@/lib/stage/lyrics/layout";
import { hashString, rasterizeMotif } from "@/lib/stage/motif";
import { stageTime, type StageState, type StageStore } from "@/lib/stage/protocol";
import { clamp, resolveLineDesign, resolveLook, type StageLook } from "@/lib/stage/resolve";
import { resolveTypography, type StageTypography } from "@/lib/stage/typography";
import type { Project, SceneId } from "@/lib/types";
import { LyricLayer } from "./lyrics/LyricLayer";
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
}

export interface StageEngineOptions {
  forceWebGL1?: boolean;
}

/** Keep the internal render size within ~QHD; lyrics are DOM and stay crisp regardless. */
const MAX_PIXELS = 2560 * 1440;
const BLACKOUT_SECONDS = 0.4;

export class StageEngine {
  private canvas: HTMLCanvasElement;
  private fallback: HTMLDivElement;
  private overlay: HTMLDivElement;
  private guides: GuidesHandle;
  private testPattern: TestPatternHandle;
  private lyrics: LyricLayer;
  private renderer: StageRenderer | null;
  private director = new SceneDirector();
  private mixer = new AudioFeatureMixer();
  private resizeObserver: ResizeObserver | null = null;

  private project: Project | null = null;
  private store: StageStore | null = null;
  private showGuides = false;
  private renderScale = 1;
  private adaptive = true;
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
  private beatN = 0;
  private lastBeat = 0;

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
    this.project = project;
    if (!project) return;
    this.seed = (hashString(project.id || "stage") % 1000) / 37;
    const plan = project.plan;
    if (plan !== this.typographyPlan) {
      this.typographyPlan = plan;
      this.typography = resolveTypography(plan);
    }
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

  setOnStats(cb: ((s: StageStats) => void) | null) {
    this.onStats = cb;
  }

  private onFontsLoaded = () => {
    if (!this.destroyed) this.lyrics.invalidateFit();
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
    let w = this.cssW * this.dpr * this.renderScale * this.quality;
    let h = this.cssH * this.dpr * this.renderScale * this.quality;
    const px = w * h;
    if (px > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / px);
      w *= k;
      h *= k;
    }
    this.renderer?.setSize(Math.round(w), Math.round(h));
    this.testPattern.setSize(Math.round(this.cssW * (window.devicePixelRatio || 1)), Math.round(this.cssH * (window.devicePixelRatio || 1)));
    this.lyrics.invalidateFit();
  }

  private prewarm(project: Project | null) {
    if (!this.renderer) return;
    const planScenes = (project?.plan?.sections ?? []).map((s) => s.scene);
    const key = planScenes.join(",");
    if (key === this.prewarmKey) return;
    this.prewarmKey = key;
    // the plan's scenes first, then the rest so operator overrides never stall
    this.renderer.prewarm([...new Set<SceneId>([...planScenes, "gradient", ...SCENE_IDS])]);
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
    };
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
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
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

    const audio = this.mixer.update(project.analysis, state, t, dt);
    if (audio.beat < this.lastBeat - 0.5) this.beatN++;
    this.lastBeat = audio.beat;
    const targetIntensity = clamp(ov?.intensity ?? 1, 0, 1.5, 1);
    this.masterIntensity += (targetIntensity - this.masterIntensity) * (1 - Math.exp(-dt / 0.15));
    if (dt === 0) this.masterIntensity = targetIntensity;

    const df = this.director.update({
      target: { scene: look.scene, params: look.params, colorway: look.colorway, lookKey: look.lookKey },
      sectionKey: look.sectionIndex == null ? null : String(look.sectionIndex),
      transitionIn: look.transitionIn,
      now,
      dt,
      frozen,
      energy: audio.energy,
    });

    // blackout ramp (smooth ~0.4 s, eased)
    const bTarget = ov?.blackout ? 1 : 0;
    const bStep = dt / BLACKOUT_SECONDS;
    this.blackAmt = bTarget > this.blackAmt ? Math.min(1, this.blackAmt + bStep) : Math.max(0, this.blackAmt - bStep);
    if (dt === 0) this.blackAmt = bTarget;
    const b = this.blackAmt;
    this.overlay.style.opacity = String(Math.round(b * b * (3 - 2 * b) * 1000) / 1000);

    // scene
    let backend: StageStats["backend"] = "fallback";
    const r = this.renderer;
    if (r && !r.lost) {
      backend = r.kind;
      r.idle();
      if (this.blackAmt < 1) {
        const ok = r.render({
          current: this.slotDraw(df.current, audio),
          previous: df.previous ? this.slotDraw(df.previous, audio) : null,
          transition: df.transition,
          clock: this.clock,
        });
        if (!ok) backend = "lost";
      }
    } else if (r?.lost) backend = "lost";
    this.updateFallback(look, backend === "fallback" || backend === "lost");
    this.canvas.style.visibility = backend === "fallback" || backend === "lost" ? "hidden" : "visible";

    // lyrics
    this.lyrics.update({
      project,
      state,
      t,
      nowEpoch,
      now,
      look,
      typography: this.typography,
      pulse: audio.pulse * look.params.reactivity,
      visible: ov?.lyricsVisible !== false,
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
      const style = line ? resolveLineDesign(project.plan, line.id, look.lyricStyle, ov?.lyricStyle).style : look.lyricStyle;
      this.guides.setPlacement(style === "hidden" ? null : placementBox(look.placement, writingModeFor(style, look.placement)));
    }

    // stats
    this.frames++;
    if (!this.statsAt) this.statsAt = now;
    if (now - this.statsAt >= 1000) {
      const fps = (this.frames * 1000) / (now - this.statsAt);
      this.frames = 0;
      this.statsAt = now;
      const [w, h] = r?.size ?? [0, 0];
      this.root.dataset.stageBackend = backend;
      try {
        this.onStats?.({ fps, backend, width: w, height: h, quality: this.quality, scene: look.scene, sectionIndex: look.sectionIndex });
      } catch {
        /* consumer errors must not break the stage */
      }
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    document.fonts?.removeEventListener?.("loadingdone", this.onFontsLoaded);
    this.renderer?.dispose();
    this.renderer = null;
    this.lyrics.destroy();
    this.canvas.remove();
    this.fallback.remove();
    this.overlay.remove();
    this.guides.root.remove();
    this.testPattern.root.remove();
  }
}
