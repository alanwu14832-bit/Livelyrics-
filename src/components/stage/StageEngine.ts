// The imperative core behind <StageView>: owns the canvas, the WebGL renderer,
// the lyric layer and the overlays, and runs one requestAnimationFrame loop that
// reads store.get() and derives everything from StageState + project.
// It never throws to its caller: every frame is guarded, GL failures fall back to
// a CSS gradient, and a broken lyric layer disables itself instead of the output.

import { stageAssets } from "@/lib/asset-scope";
import { SCENE_IDS } from "@/lib/schema";
import { parseHex, rgba, type RGB } from "@/lib/stage/color";
import { SceneDirector, type SceneSlot } from "@/lib/stage/director";
import { AudioFeatureMixer, type StageAudioFrame } from "@/lib/stage/features";
import { StageRenderer, type MediaDraw, type MediaLayerDraw, type SceneDraw } from "@/lib/stage/gl/renderer";
import { placementBox, writingModeFor } from "@/lib/stage/lyrics/layout";
import { TREATMENT_CODE, beatAt, resolveMediaFrame, type BeatInfo, type MediaLayerState } from "@/lib/stage/media/model";
import { isVideoAsset, mediaLayerDraw, mediaLyricBox, mediaVideoTime } from "@/lib/stage/media/draw";
import { DEFAULT_OUTPUT, outputAspect, renderSize } from "@/lib/output";
import { hashString, rasterizeMotif } from "@/lib/stage/motif";
import { stageTime, type StageState, type StageStore } from "@/lib/stage/protocol";
import { clamp, lyricLookAt, resolveLineDesign, resolveLook, type StageLook } from "@/lib/stage/resolve";
import { resolveTypography, type StageTypography } from "@/lib/stage/typography";
import type { Asset, Project, ProjectOutput, SceneId } from "@/lib/types";
import { LyricLayer } from "./lyrics/LyricLayer";
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
  setTransitionScale(scale: number) {
    this.transitionScale = clamp(scale, 0.1, 50, 1);
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

  private mediaDraw(project: Project, state: StageState, t: number, look: StageLook, lyricLook: StageLook, audio: StageAudioFrame, now: number, dt: number): MediaDraw | null {
    const frozen = !!state.overrides?.freeze;
    if (frozen && this.frozenAt == null) this.frozenAt = t;
    if (!frozen) this.frozenAt = null;
    const mt = frozen && this.frozenAt != null ? this.frozenAt : t;
    // lyric presence for mask-lyrics: a line on screen that is not hidden
    const lines = project.lyrics?.lines ?? [];
    const idx = state.lineIndex;
    const line = typeof idx === "number" ? lines[idx] : undefined;
    const style = line ? resolveLineDesign(project.plan, line.id, lyricLook.lyricStyle, state.overrides?.lyricStyle).style : "hidden";
    const showing = !!line && !!line.text?.trim() && style !== "hidden" && state.overrides?.lyricsVisible !== false;
    const target = showing ? 1 : 0;
    this.lyricAmt += (target - this.lyricAmt) * (dt > 0 ? 1 - Math.exp(-dt / 0.25) : 1);

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
      const b = this.lyrics.textBounds();
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

    // a freeze is a true still frame: audio-reactive uniforms hold as well
    if (!frozen || !this.audio) this.audio = { ...this.mixer.update(project.analysis, state, t, dt) };
    const audio = this.audio;
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
      durationScale: this.transitionScale,
    });

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

    // scene + band media
    let backend: StageStats["backend"] = "fallback";
    const r = this.renderer;
    if (r && !r.lost) {
      backend = r.kind;
      r.idle();
      if (this.blackAmt < 1) {
        let media: MediaDraw | null = null;
        try {
          media = this.mediaDraw(project, state, t, look, lyricLook, audio, now, dt);
        } catch (e) {
          // a media problem never takes the scene down
          this.errors++;
          if (this.errors <= 3) console.error("[Livelyrics] 素材圖層錯誤：", e);
        }
        const ok = r.render({
          current: this.slotDraw(df.current, audio),
          previous: df.previous ? this.slotDraw(df.previous, audio) : null,
          transition: df.transition,
          clock: this.clock,
          media,
        });
        if (!ok) backend = "lost";
      }
    } else if (r?.lost) backend = "lost";
    this.updateFallback(look, backend === "fallback" || backend === "lost");
    this.canvas.style.visibility = backend === "fallback" || backend === "lost" ? "hidden" : "visible";

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
    if (now - this.statsAt >= 1000) {
      const fps = (this.frames * 1000) / (now - this.statsAt);
      this.frames = 0;
      this.statsAt = now;
      const [w, h] = r?.size ?? [0, 0];
      this.root.dataset.stageBackend = backend;
      // diagnostics (e2e): how many media layers the last frame drew
      this.root.dataset.stageMedia = String(this.mediaLayers);
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
    this.media.destroy();
    this.lyrics.destroy();
    this.canvas.remove();
    this.fallback.remove();
    this.overlay.remove();
    this.guides.root.remove();
    this.testPattern.root.remove();
  }
}
