// WebGL2 (fallback WebGL1) renderer for the stage scenes.
//
// - One program per SceneId, compiled lazily; `prewarm()` queues programs and
//   compiles them one per frame (or in parallel with KHR_parallel_shader_compile)
//   so section changes never stall the show.
// - Section transitions render the outgoing and incoming scenes into two
//   framebuffers and composite them.
// - Context loss is survivable: `lost` goes true, everything is recreated on
//   restore (the motif source is kept so the texture can be re-uploaded).
// - Nothing here throws to the caller after construction; failures degrade to a
//   plain background clear and are reported once through `onError`.

import type { SceneId } from "../../types";
import type { RGB } from "../color";
import type { ActiveTransitionKind } from "../director";
import { COMPOSITE_FRAGMENT, COMPOSITE_UNIFORMS } from "../scenes/composite";
import { MEDIA_FRAGMENT, MEDIA_UNIFORMS } from "../scenes/media";
import {
  DOWNSAMPLE_FACTOR,
  SAFETY_DOWN1_FRAGMENT,
  SAFETY_DOWN1_UNIFORMS,
  SAFETY_DOWN2_FRAGMENT,
  SAFETY_DOWN2_UNIFORMS,
  SAFETY_LOWPASS_FRAGMENT,
  SAFETY_LOWPASS_UNIFORMS,
  SAFETY_PRESENT_FRAGMENT,
  SAFETY_PRESENT_UNIFORMS,
} from "../scenes/safety";
import { UNIFORM_NAMES, buildFragmentWithHeader, buildSceneFragment, buildVertex } from "../scenes/common";
import { SCENE_SHADERS } from "../scenes";

type GL = WebGL2RenderingContext | WebGLRenderingContext;

export interface SceneUniformValues {
  time: number;
  clock: number;
  bg: RGB;
  primary: RGB;
  accent: RGB;
  speed: number;
  density: number;
  intensity: number;
  reactivity: number;
  level: number;
  bass: number;
  onset: number;
  beat: number;
  beatIndex: number;
  energy: number;
  pulse: number;
  seed: number;
}

export interface SceneDraw {
  scene: SceneId;
  lookKey: string;
  uniforms: SceneUniformValues;
}

/** One band-media layer (see src/lib/stage/scenes/media.ts). */
export interface MediaLayerDraw {
  /** texture cache key (asset id) */
  key: string;
  /** decoded image / canvas / video; null = not ready (layer skipped) */
  source: TexImageSource | null;
  /** re-upload when this changes (video: current frame time); images: constant */
  version: number;
  /** draw the texture uploaded earlier without refreshing it (video seeking) */
  hold?: boolean;
  width: number;
  height: number;
  /** opacity x cross-fade weight, 0..1 */
  weight: number;
  treatment: number;
  blend: number;
  contain: boolean;
  /** texUV = (screenUV - 0.5) * scale + 0.5 + offset */
  uv: { sx: number; sy: number; ox: number; oy: number };
  colorway: [RGB, RGB, RGB];
  /** 0..1 beat punch */
  punch: number;
  seed: number;
}

export interface MediaDraw {
  /** [current, previous]; at most two are drawn */
  layers: MediaLayerDraw[];
  /** song time, for grain / weave */
  time: number;
  /** lyric area in screen uv (x0, y0, x1, y1; y up) */
  lyricBox: [number, number, number, number];
  /** 0..1 a lyric line is on screen */
  lyricAmount: number;
}

/** LED 安全模式 (phase 3): the final safety pass of the frame (see src/lib/stage/scenes/safety.ts). */
export interface SafetyDraw {
  /** 0..1 highlight soften */
  soften: number;
  /** encoded brightness multiplier (the cap) */
  gain: number;
  /** temporal low-pass factor for this frame (1 = pass-through); null = decide after the readback (composeSafety) */
  alpha: number | null;
  /** read back the luminance grid of this frame (cols × rows) */
  measure: { cols: number; rows: number; sync: boolean } | null;
}

/** A luminance grid read back from the GPU: RGBA8, bottom row first (GL order). */
export interface GridReadback {
  /** the render serial it belongs to */
  serial: number;
  cols: number;
  rows: number;
  data: Uint8Array;
}

export interface RenderRequest {
  current: SceneDraw;
  previous: SceneDraw | null;
  transition: { kind: ActiveTransitionKind; progress: number } | null;
  clock: number;
  /** band media over the scene (null / no layers = scene only) */
  media?: MediaDraw | null;
  /** LED 安全模式: soften, flash low-pass and brightness cap as a final pass (null = off) */
  safety?: SafetyDraw | null;
}

interface PendingRead {
  buf: WebGLBuffer;
  sync: WebGLSync | null;
  serial: number;
  cols: number;
  rows: number;
  bytes: number;
  busy: boolean;
}

const SAFETY_PROGRAMS = ["safety-lowpass", "safety-present", "safety-down1", "safety-down2"] as const;

interface MediaTexture {
  tex: WebGLTexture;
  w: number;
  h: number;
  source: TexImageSource | null;
  version: number;
  mips: boolean;
}

interface ProgramEntry {
  program: WebGLProgram | null;
  vs: WebGLShader | null;
  fs: WebGLShader | null;
  state: "pending" | "ready" | "failed";
  names: readonly string[];
  locations: Map<string, WebGLUniformLocation | null>;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

const TRANSITION_CODE: Record<ActiveTransitionKind, number> = { fade: 1, flash: 2, wipe: 3, bloom: 4 };
const COMPLETION_STATUS_KHR = 0x91b1;

export interface RendererOptions {
  /** force the WebGL1 path (testing) */
  forceWebGL1?: boolean;
  onError?: (message: string) => void;
  onContextChange?: (lost: boolean) => void;
  /** keep the drawing buffer after compositing (offline export reads it back with drawImage) */
  preserveDrawingBuffer?: boolean;
}

export class StageRenderer {
  readonly kind: "webgl2" | "webgl1";
  lost = false;
  private gl: GL;
  private gl2: boolean;
  private programs = new Map<string, ProgramEntry>();
  private queue: string[] = [];
  /** everything ever prewarmed, re-queued after a context restore */
  private warm = new Set<string>();
  private parallel: boolean;
  private quad: WebGLBuffer | null = null;
  private motifTex: WebGLTexture | null = null;
  private motifSource: TexImageSource | null = null;
  /** 0, 1: transition scenes; 2: scene under the media; 3: safety source S; 4, 5: safety low-pass ping-pong */
  private targets: Array<Target | null> = [null, null, null, null, null, null];
  /** safety grid targets (their own small sizes) */
  private gridTargets: { mid: Target | null; grid: Target | null } = { mid: null, grid: null };
  private feedbackIndex: 4 | 5 = 4;
  private feedbackValid = false;
  private serial = 0;
  private reads: PendingRead[] = [];
  private completed: GridReadback[] = [];
  private pendingCompose: { soften: number; gain: number } | null = null;
  /** the last synchronous grid readback (offline export) */
  lastGrid: GridReadback | null = null;
  private mediaTex = new Map<string, MediaTexture>();
  private width = 1;
  private height = 1;
  private reported = new Set<string>();
  private disposed = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    gl: GL,
    private readonly opts: RendererOptions,
  ) {
    this.gl = gl;
    this.gl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    this.kind = this.gl2 ? "webgl2" : "webgl1";
    this.parallel = false;
    canvas.addEventListener("webglcontextlost", this.handleLost, false);
    canvas.addEventListener("webglcontextrestored", this.handleRestored, false);
    this.init();
  }

  /** Returns null when WebGL is unavailable (caller shows the CSS fallback). */
  static create(canvas: HTMLCanvasElement, opts: RendererOptions = {}): StageRenderer | null {
    const attrs: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      powerPreference: "high-performance",
    };
    let gl: GL | null = null;
    try {
      if (!opts.forceWebGL1) gl = canvas.getContext("webgl2", attrs) as WebGL2RenderingContext | null;
      if (!gl) gl = (canvas.getContext("webgl", attrs) ?? canvas.getContext("experimental-webgl", attrs)) as WebGLRenderingContext | null;
    } catch {
      gl = null;
    }
    if (!gl) return null;
    try {
      return new StageRenderer(canvas, gl, opts);
    } catch (e) {
      opts.onError?.(`WebGL 初始化失敗：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private init() {
    const gl = this.gl;
    this.parallel = !!gl.getExtension("KHR_parallel_shader_compile");
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    this.motifTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.motifTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.motifSource) this.uploadMotif(this.motifSource);
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.programs.clear();
    this.targets = [null, null, null, null, null, null];
    this.gridTargets = { mid: null, grid: null };
    this.reads = [];
    this.completed = [];
    this.feedbackValid = false;
    this.mediaTex.clear();
    this.quad = null;
    this.motifTex = null;
    this.opts.onContextChange?.(true);
  };

  private handleRestored = () => {
    if (this.disposed) return;
    try {
      this.lost = false;
      this.init();
      this.queue = [...this.warm];
      this.opts.onContextChange?.(false);
    } catch (e) {
      this.report("restore", `WebGL 還原失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  private report(key: string, message: string) {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.opts.onError?.(message);
  }

  // -------------------------------------------------------------------------
  // programs

  private compile(key: string, fragment: string, uniforms: readonly string[]): ProgramEntry {
    const gl = this.gl;
    const entry: ProgramEntry = { program: null, vs: null, fs: null, state: "pending", names: uniforms, locations: new Map() };
    this.programs.set(key, entry);
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      entry.state = "failed";
      return entry;
    }
    gl.shaderSource(vs, buildVertex(this.gl2));
    gl.compileShader(vs);
    gl.shaderSource(fs, fragment);
    gl.compileShader(fs);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    entry.program = program;
    entry.vs = vs;
    entry.fs = fs;
    if (!this.parallel) this.finalize(key, entry);
    return entry;
  }

  private finalize(key: string, entry: ProgramEntry): boolean {
    const gl = this.gl;
    const { program, vs, fs } = entry;
    if (!program || !vs || !fs) {
      entry.state = "failed";
      return false;
    }
    if (this.parallel && !gl.getProgramParameter(program, COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) {
        const log = gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program) || "unknown";
        this.report(`compile:${key}`, `場景著色器「${key}」編譯失敗：${log}`);
        entry.state = "failed";
      }
      gl.deleteProgram(program);
      entry.program = null;
      return false;
    }
    gl.detachShader(program, vs);
    gl.detachShader(program, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    entry.vs = null;
    entry.fs = null;
    entry.locations.clear();
    for (const name of entry.names) entry.locations.set(name, gl.getUniformLocation(program, name));
    entry.state = "ready";
    return true;
  }

  private sceneFragment(id: SceneId): string {
    return buildSceneFragment(SCENE_SHADERS[id] ?? SCENE_SHADERS.gradient, this.gl2);
  }

  private entryFor(key: string, create: () => ProgramEntry): ProgramEntry | null {
    let entry = this.programs.get(key);
    if (!entry) entry = create();
    if (entry.state === "pending") this.finalize(key, entry);
    return entry.state === "ready" ? entry : null;
  }

  private sceneProgram(id: SceneId): ProgramEntry | null {
    return this.entryFor(`scene:${id}`, () => this.compile(`scene:${id}`, this.sceneFragment(id), UNIFORM_NAMES));
  }

  private compositeProgram(): ProgramEntry | null {
    return this.entryFor("composite", () =>
      this.compile("composite", buildFragmentWithHeader(COMPOSITE_FRAGMENT, this.gl2), COMPOSITE_UNIFORMS),
    );
  }

  private mediaProgram(): ProgramEntry | null {
    return this.entryFor("media", () => this.compile("media", buildFragmentWithHeader(MEDIA_FRAGMENT, this.gl2), MEDIA_UNIFORMS));
  }

  private safetyProgram(key: (typeof SAFETY_PROGRAMS)[number]): ProgramEntry | null {
    const src: Record<(typeof SAFETY_PROGRAMS)[number], [string, readonly string[]]> = {
      "safety-lowpass": [SAFETY_LOWPASS_FRAGMENT, SAFETY_LOWPASS_UNIFORMS],
      "safety-present": [SAFETY_PRESENT_FRAGMENT, SAFETY_PRESENT_UNIFORMS],
      "safety-down1": [SAFETY_DOWN1_FRAGMENT, SAFETY_DOWN1_UNIFORMS],
      "safety-down2": [SAFETY_DOWN2_FRAGMENT, SAFETY_DOWN2_UNIFORMS],
    };
    const [frag, names] = src[key];
    return this.entryFor(key, () => this.compile(key, buildFragmentWithHeader(frag, this.gl2), names));
  }

  /** Compile a queued program by key. */
  private compileKey(key: string) {
    if (key === "composite") this.compositeProgram();
    else if (key === "media") this.mediaProgram();
    else if ((SAFETY_PROGRAMS as readonly string[]).includes(key)) this.safetyProgram(key as (typeof SAFETY_PROGRAMS)[number]);
    else this.sceneProgram(key.slice(6) as SceneId);
  }

  /** Queue the LED-safety passes ahead of everything (safe mode is on by default). */
  prewarmSafety() {
    for (const key of [...SAFETY_PROGRAMS].reverse()) {
      this.warm.add(key);
      if (!this.queue.includes(key) && !this.programs.has(key)) this.queue.unshift(key);
    }
  }

  /**
   * The safety passes: "ready", "pending" (still compiling: the frame must not go out unsafe) or
   * "failed" (the caller falls back to a CSS brightness cap without flash limiting).
   */
  safetyState(): "ready" | "pending" | "failed" {
    let pending = false;
    for (const key of SAFETY_PROGRAMS) {
      const e = this.programs.get(key);
      if (e?.state === "failed") return "failed";
      if (!e || e.state !== "ready") pending = true;
    }
    return pending ? "pending" : "ready";
  }

  /** Forget the low-pass history (another project, safe mode just turned on, a jump in the export). */
  resetSafetyFeedback() {
    this.feedbackValid = false;
  }

  /** Grid readbacks that completed since the last call (WebGL2 async path), oldest first. */
  takeGrids(): GridReadback[] {
    this.pollReads();
    const out = this.completed;
    this.completed = [];
    return out;
  }

  /** Serial of the last rendered frame (matches GridReadback.serial). */
  get frameSerial(): number {
    return this.serial;
  }

  /** Status of a scene program (for diagnostics / the stage lab). */
  sceneState(id: SceneId): "none" | "pending" | "ready" | "failed" {
    return this.programs.get(`scene:${id}`)?.state ?? "none";
  }

  /** Queue scene programs to compile ahead of time. */
  prewarm(ids: readonly SceneId[]) {
    for (const id of ids) {
      if (id === "blackout") continue;
      const key = `scene:${id}`;
      this.warm.add(key);
      if (!this.programs.has(key) && !this.queue.includes(key)) this.queue.push(key);
    }
    this.warm.add("composite");
    if (!this.queue.includes("composite") && !this.programs.has("composite")) this.queue.push("composite");
  }

  /** Queue the media compositor (called once a project has band material). */
  prewarmMedia() {
    this.warm.add("media");
    // ahead of the scene prewarm queue: the plan's media shows on the very first frames
    if (!this.queue.includes("media") && !this.programs.has("media")) this.queue.unshift("media");
  }

  /** Background work: compile queued programs (one per call without the parallel extension). */
  idle() {
    if (this.lost || this.disposed) return;
    try {
      if (this.parallel) {
        while (this.queue.length) {
          const key = this.queue.shift()!;
          if (this.programs.has(key)) continue;
          this.compileKey(key);
        }
        for (const [key, entry] of this.programs) if (entry.state === "pending") this.finalize(key, entry);
      } else if (this.queue.length) {
        const key = this.queue.shift()!;
        if (!this.programs.has(key)) this.compileKey(key);
        // the safety passes are tiny: compile them together so safe output starts sooner
        while (this.queue.length && (SAFETY_PROGRAMS as readonly string[]).includes(this.queue[0]) && (SAFETY_PROGRAMS as readonly string[]).includes(key)) {
          const k = this.queue.shift()!;
          if (!this.programs.has(k)) this.compileKey(k);
        }
      }
    } catch (e) {
      this.report("idle", `著色器預先編譯失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Compile the given scenes (plus the compositor, and the media pass when asked) now and wait
   * until every program is linked. The offline export calls this before its first frame so no
   * frame falls back to a plain background while a shader compiles. Resolves with the ids that
   * failed (they render the gradient scene, as live).
   */
  async ensureReady(ids: readonly SceneId[], media: boolean, timeoutMs = 20000, safety = false): Promise<string[]> {
    this.prewarm(ids);
    if (media) this.prewarmMedia();
    if (safety) this.prewarmSafety();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.lost || this.disposed) return [...this.warm];
      this.idle();
      const pending = [...this.programs.values()].some((e) => e.state === "pending");
      if (!this.queue.length && !pending) break;
      if (Date.now() > deadline) break;
      if (this.parallel && !this.queue.length) await new Promise((r) => setTimeout(r, 8));
    }
    return [...this.programs.entries()].filter(([, e]) => e.state !== "ready").map(([k]) => k);
  }

  // -------------------------------------------------------------------------
  // resources

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height && this.canvas.width === w && this.canvas.height === h) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    // targets are reallocated lazily at the new size
    this.freeTargets();
  }

  get size(): [number, number] {
    return [this.width, this.height];
  }

  setMotif(source: TexImageSource | null) {
    this.motifSource = source;
    if (source && !this.lost) this.uploadMotif(source);
  }

  private uploadMotif(source: TexImageSource) {
    const gl = this.gl;
    if (!this.motifTex) return;
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.motifTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } catch (e) {
      this.report("motif", `主視覺符號貼圖上傳失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Drop media textures whose asset is gone (keys = the assets still in the project). */
  pruneMedia(keep: ReadonlySet<string>) {
    for (const [key, t] of this.mediaTex) {
      if (keep.has(key)) continue;
      if (!this.lost) this.gl.deleteTexture(t.tex);
      this.mediaTex.delete(key);
    }
  }

  /** Upload (or refresh) a media layer's texture; null when it cannot be used this frame. */
  private mediaTexture(layer: MediaLayerDraw, unit: number): MediaTexture | null {
    const gl = this.gl;
    const src = layer.source;
    if (!src || !(layer.width > 0) || !(layer.height > 0)) return null;
    let t = this.mediaTex.get(layer.key);
    if (layer.hold) {
      if (!t || !t.source) return null;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      return t;
    }
    if (!t) {
      const tex = gl.createTexture();
      if (!tex) return null;
      t = { tex, w: 0, h: 0, source: null, version: Number.NaN, mips: false };
      this.mediaTex.set(layer.key, t);
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (t.source !== src || t.version !== layer.version) {
      try {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      } catch (e) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        this.report(`media:${layer.key}`, `素材貼圖上傳失敗：${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
      const video = typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement;
      const pot = (n: number) => (n & (n - 1)) === 0;
      const mips = !video && (this.gl2 || (pot(layer.width) && pot(layer.height)));
      if (mips) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t.source = src;
      t.version = layer.version;
      t.w = layer.width;
      t.h = layer.height;
      t.mips = mips;
    }
    return t;
  }

  private target(i: 0 | 1 | 2 | 3 | 4 | 5): Target | null {
    const existing = this.targets[i];
    if (existing && existing.w === this.width && existing.h === this.height) return existing;
    if (existing) this.deleteTarget(existing);
    if (i === 4 || i === 5) this.feedbackValid = false;
    const t = this.makeTarget(this.width, this.height);
    if (t) this.targets[i] = t;
    return t;
  }

  private makeTarget(width: number, height: number): Target | null {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t: Target = { fbo, tex, w: width, h: height };
    if (!ok) {
      this.deleteTarget(t);
      this.report("fbo", "無法建立轉場用的影格緩衝區，將改用直接切換。");
      return null;
    }
    return t;
  }

  /** The safety grid targets at their sizes (reallocated when the grid changes). */
  private gridTarget(which: "mid" | "grid", w: number, h: number): Target | null {
    const existing = this.gridTargets[which];
    if (existing && existing.w === w && existing.h === h) return existing;
    if (existing) this.deleteTarget(existing);
    const t = this.makeTarget(w, h);
    this.gridTargets[which] = t;
    return t;
  }

  private deleteTarget(t: Target) {
    if (this.lost) return;
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  private freeTargets() {
    for (const t of this.targets) if (t) this.deleteTarget(t);
    this.targets = [null, null, null, null, null, null];
    this.feedbackValid = false;
  }

  // -------------------------------------------------------------------------
  // drawing

  private setSceneUniforms(entry: ProgramEntry, u: SceneUniformValues) {
    const gl = this.gl;
    const L = entry.locations;
    const f1 = (n: string, v: number) => {
      const l = L.get(n);
      if (l) gl.uniform1f(l, Number.isFinite(v) ? v : 0);
    };
    const f3 = (n: string, v: RGB) => {
      const l = L.get(n);
      if (l) gl.uniform3f(l, v[0], v[1], v[2]);
    };
    const res = L.get("uRes");
    if (res) gl.uniform2f(res, this.width, this.height);
    f1("uTime", u.time);
    f1("uClock", u.clock);
    f3("uBg", u.bg);
    f3("uPri", u.primary);
    f3("uAcc", u.accent);
    f1("uSpeed", u.speed);
    f1("uDensity", u.density);
    f1("uIntensity", u.intensity);
    f1("uReact", u.reactivity);
    f1("uLevel", u.level);
    f1("uBass", u.bass);
    f1("uOnset", u.onset);
    f1("uBeat", u.beat);
    f1("uBeatN", u.beatIndex);
    f1("uEnergy", u.energy);
    f1("uPulse", u.pulse);
    f1("uSeed", u.seed);
    const motif = L.get("uMotif");
    if (motif) gl.uniform1i(motif, 0);
  }

  private drawScene(draw: SceneDraw, target: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, this.width, this.height);
    if (draw.scene === "blackout") {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const entry = this.sceneProgram(draw.scene) ?? (this.sceneState(draw.scene) === "failed" ? this.sceneProgram("gradient") : null);
    if (!entry || !entry.program) {
      // still compiling (parallel) or failed: plain background tone
      const [r, g, b] = draw.uniforms.bg;
      gl.clearColor(r, g, b, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    gl.useProgram(entry.program);
    this.setSceneUniforms(entry, draw.uniforms);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.motifTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draw one frame. Returns false when nothing could be drawn (context lost). */
  render(req: RenderRequest): boolean {
    if (this.lost || this.disposed || this.gl.isContextLost()) return false;
    const gl = this.gl;
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      this.serial++;
      this.pendingCompose = null;
      const safety = req.safety ?? null;
      // LED 安全模式: everything renders into S first; until the safety passes are compiled the
      // frame is black rather than unsafe
      let dest: Target | null = null;
      if (safety) {
        const state = this.safetyState();
        if (state === "pending") {
          for (const key of SAFETY_PROGRAMS) this.safetyProgram(key);
        }
        if (this.safetyState() !== "ready") {
          if (this.safetyState() === "failed") return this.renderLayers(req, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, this.width, this.height);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          return true;
        }
        dest = this.target(3);
        if (!dest) return this.renderLayers(req, null);
      }
      this.renderLayers(req, dest);
      if (safety && dest) {
        if (safety.measure) this.measureGrid(dest, safety.soften, safety.measure.cols, safety.measure.rows, safety.measure.sync);
        if (safety.alpha == null) this.pendingCompose = { soften: safety.soften, gain: safety.gain };
        else this.compose(dest, safety.alpha, safety.soften, safety.gain);
      }
      return true;
    } catch (e) {
      this.report("render", `繪製失敗：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Scene (+ transition) and media into `dest` (null = the screen). */
  private renderLayers(req: RenderRequest, dest: Target | null): boolean {
    const layers = (req.media?.layers ?? []).filter((l) => l.weight > 0.001 && l.source).slice(0, 2);
    const mediaProg = layers.length ? this.mediaProgram() : null;
    const sceneTarget = mediaProg?.program ? this.target(2) : null;
    // without the media pass (no layers, still compiling, no FBO) the scene goes straight to dest
    if (sceneTarget && mediaProg?.program) {
      this.drawSceneLayer(req, sceneTarget);
      this.drawMedia(mediaProg, sceneTarget, layers, req.media!, dest);
    } else this.drawSceneLayer(req, dest);
    return true;
  }

  /**
   * Finish a frame rendered with `safety.alpha = null` (the offline export: α is decided after the
   * synchronous grid readback of the same frame).
   */
  composeSafety(alpha: number): boolean {
    const p = this.pendingCompose;
    const src = this.targets[3];
    this.pendingCompose = null;
    if (!p || !src || this.lost) return false;
    try {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quad);
      this.compose(src, alpha, p.soften, p.gain);
      return true;
    } catch (e) {
      this.report("render", `繪製失敗：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Low-pass S into the feedback target, then present it to the screen with the brightness cap. */
  private compose(src: Target, alpha: number, soften: number, gain: number) {
    const gl = this.gl;
    const lowpass = this.safetyProgram("safety-lowpass");
    const present = this.safetyProgram("safety-present");
    if (!lowpass?.program || !present?.program) return;
    const prevIndex = this.feedbackIndex;
    const nextIndex: 4 | 5 = prevIndex === 4 ? 5 : 4;
    const prev = this.target(prevIndex);
    const next = this.target(nextIndex);
    if (!prev || !next) return;
    const first = !this.feedbackValid;

    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(lowpass.program);
    const L = lowpass.locations;
    const set1 = (n: string, v: number) => {
      const l = L.get(n);
      if (l) gl.uniform1f(l, v);
    };
    const res = L.get("uRes");
    if (res) gl.uniform2f(res, this.width, this.height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    const us = L.get("uSrc");
    if (us) gl.uniform1i(us, 1);
    const up = L.get("uPrev");
    if (up) gl.uniform1i(up, 2);
    set1("uAlpha", Number.isFinite(alpha) ? alpha : 1);
    set1("uSoften", soften);
    set1("uFirst", first ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(present.program);
    const P = present.locations;
    const pr = P.get("uRes");
    if (pr) gl.uniform2f(pr, this.width, this.height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, next.tex);
    const ut = P.get("uTex");
    if (ut) gl.uniform1i(ut, 1);
    const ug = P.get("uGain");
    if (ug) gl.uniform1f(ug, gain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    this.feedbackIndex = nextIndex;
    this.feedbackValid = true;
  }

  /** Downsample S to the luminance grid and read it back (sync, or through a PBO + fence). */
  private measureGrid(src: Target, soften: number, cols: number, rows: number, sync: boolean) {
    const gl = this.gl;
    const down1 = this.safetyProgram("safety-down1");
    const down2 = this.safetyProgram("safety-down2");
    if (!down1?.program || !down2?.program) return;
    const mw = cols * DOWNSAMPLE_FACTOR;
    const mh = rows * DOWNSAMPLE_FACTOR;
    const mid = this.gridTarget("mid", mw, mh);
    const grid = this.gridTarget("grid", cols, rows);
    if (!mid || !grid) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, mid.fbo);
    gl.viewport(0, 0, mw, mh);
    gl.useProgram(down1.program);
    let L = down1.locations;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    let l = L.get("uSrc");
    if (l) gl.uniform1i(l, 1);
    l = L.get("uSrcRes");
    if (l) gl.uniform2f(l, src.w, src.h);
    l = L.get("uDst");
    if (l) gl.uniform2f(l, mw, mh);
    l = L.get("uSoften");
    if (l) gl.uniform1f(l, soften);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, grid.fbo);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(down2.program);
    L = down2.locations;
    gl.bindTexture(gl.TEXTURE_2D, mid.tex);
    l = L.get("uSrc");
    if (l) gl.uniform1i(l, 1);
    l = L.get("uSrcRes");
    if (l) gl.uniform2f(l, mw, mh);
    l = L.get("uDst");
    if (l) gl.uniform2f(l, cols, rows);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);

    const bytes = cols * rows * 4;
    const gl2 = this.gl2 ? (gl as WebGL2RenderingContext) : null;
    if (sync || !gl2) {
      // WebGL1 / the offline export: a synchronous read of the tiny target (it waits for the GPU)
      const data = new Uint8Array(bytes);
      gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const g: GridReadback = { serial: this.serial, cols, rows, data };
      this.lastGrid = g;
      if (!sync) this.completed.push(g);
      return;
    }
    // WebGL2: into a pixel-pack buffer, fenced; collected a frame or two later (no GPU stall)
    let slot = this.reads.find((r) => !r.busy);
    if (!slot) {
      if (this.reads.length >= 3) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return; // all three in flight: skip this frame's measurement
      }
      const buf = gl2.createBuffer();
      if (!buf) return;
      slot = { buf, sync: null, serial: 0, cols, rows, bytes: 0, busy: false };
      this.reads.push(slot);
    }
    gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, slot.buf);
    if (slot.bytes !== bytes) {
      gl2.bufferData(gl2.PIXEL_PACK_BUFFER, bytes, gl2.STREAM_READ);
      slot.bytes = bytes;
    }
    gl2.readPixels(0, 0, cols, rows, gl2.RGBA, gl2.UNSIGNED_BYTE, 0);
    gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    slot.sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
    slot.serial = this.serial;
    slot.cols = cols;
    slot.rows = rows;
    slot.busy = true;
  }

  private pollReads() {
    if (!this.gl2 || this.lost || !this.reads.length) return;
    const gl2 = this.gl as WebGL2RenderingContext;
    const busy = this.reads.filter((r) => r.busy).sort((a, b) => a.serial - b.serial);
    for (const r of busy) {
      if (!r.sync) {
        r.busy = false;
        continue;
      }
      const status = gl2.getSyncParameter(r.sync, gl2.SYNC_STATUS);
      if (status !== gl2.SIGNALED) break; // keep the order: later reads wait for this one
      const data = new Uint8Array(r.cols * r.rows * 4);
      gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, r.buf);
      gl2.getBufferSubData(gl2.PIXEL_PACK_BUFFER, 0, data);
      gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
      gl2.deleteSync(r.sync);
      r.sync = null;
      r.busy = false;
      this.completed.push({ serial: r.serial, cols: r.cols, rows: r.rows, data });
    }
    if (this.completed.length > 8) this.completed.splice(0, this.completed.length - 8);
  }

  /** The scene (with its section transition) into `out` (null = the screen). */
  private drawSceneLayer(req: RenderRequest, out: Target | null) {
    const gl = this.gl;
    const tr = req.transition;
    const prev = req.previous;
    const composite = tr && prev ? this.compositeProgram() : null;
    const a = composite ? this.target(0) : null;
    const b = composite ? this.target(1) : null;
    if (!tr || !prev || !composite || !composite.program || !a || !b) {
      this.drawScene(req.current, out);
      return;
    }
    this.drawScene(req.current, a);
    const sameLook = prev.lookKey === req.current.lookKey && prev.scene === req.current.scene;
    if (!sameLook) this.drawScene(prev, b);

    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(composite.program);
    const L = composite.locations;
    const res = L.get("uRes");
    if (res) gl.uniform2f(res, this.width, this.height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, sameLook ? a.tex : b.tex);
    const ua = L.get("uA");
    const ub = L.get("uB");
    if (ua) gl.uniform1i(ua, 1);
    if (ub) gl.uniform1i(ub, 2);
    const up = L.get("uP");
    if (up) gl.uniform1f(up, tr.progress);
    const uk = L.get("uKind");
    if (uk) gl.uniform1f(uk, TRANSITION_CODE[tr.kind]);
    const acc = L.get("uAcc");
    if (acc) gl.uniform3f(acc, req.current.uniforms.accent[0], req.current.uniforms.accent[1], req.current.uniforms.accent[2]);
    const uc = L.get("uClock");
    if (uc) gl.uniform1f(uc, req.clock);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // unbind so the next frame can render into these textures without a feedback loop
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  private drawMedia(entry: ProgramEntry, scene: Target, layers: MediaLayerDraw[], media: MediaDraw, dest: Target | null = null) {
    const gl = this.gl;
    const texA = layers[0] ? this.mediaTexture(layers[0], 4) : null;
    const texB = layers[1] ? this.mediaTexture(layers[1], 5) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest ? dest.fbo : null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(entry.program);
    const L = entry.locations;
    const f1 = (n: string, v: number) => {
      const l = L.get(n);
      if (l) gl.uniform1f(l, Number.isFinite(v) ? v : 0);
    };
    const f2 = (n: string, x: number, y: number) => {
      const l = L.get(n);
      if (l) gl.uniform2f(l, x, y);
    };
    const f3 = (n: string, v: RGB) => {
      const l = L.get(n);
      if (l) gl.uniform3f(l, v[0], v[1], v[2]);
    };
    const f4 = (n: string, a: number, b: number, c: number, d: number) => {
      const l = L.get(n);
      if (l) gl.uniform4f(l, a, b, c, d);
    };
    const i1 = (n: string, v: number) => {
      const l = L.get(n);
      if (l) gl.uniform1i(l, v);
    };
    f2("uRes", this.width, this.height);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    i1("uScene", 3);
    f1("uTime", media.time);
    const box = media.lyricBox;
    f4("uLyricBox", box[0], box[1], box[2], box[3]);
    f1("uLyricAmt", media.lyricAmount);
    const set = (suffix: "A" | "B", layer: MediaLayerDraw | undefined, tex: MediaTexture | null, unit: number) => {
      i1(`uTex${suffix}`, unit);
      if (!layer || !tex) {
        f1(`uW${suffix}`, 0);
        // a valid texture must still be bound to the sampler: reuse the scene
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, scene.tex);
        return;
      }
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex.tex);
      f1(`uW${suffix}`, layer.weight);
      f4(`uMode${suffix}`, layer.treatment, layer.blend, layer.contain ? 1 : 0, tex.mips ? 1 : 0);
      f4(`uUv${suffix}`, layer.uv.sx, layer.uv.sy, layer.uv.ox, layer.uv.oy);
      f2(`uSize${suffix}`, tex.w, tex.h);
      f3(`uC0${suffix}`, layer.colorway[0]);
      f3(`uC1${suffix}`, layer.colorway[1]);
      f3(`uC2${suffix}`, layer.colorway[2]);
      f1(`uPunch${suffix}`, layer.punch);
      f1(`uSeed${suffix}`, layer.seed);
    };
    set("A", layers[0], texA, 4);
    set("B", layers[1], texB, 5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (const unit of [3, 4, 5]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    const gl = this.gl;
    try {
      if (!gl.isContextLost()) {
        for (const e of this.programs.values()) {
          if (e.program) gl.deleteProgram(e.program);
          if (e.vs) gl.deleteShader(e.vs);
          if (e.fs) gl.deleteShader(e.fs);
        }
        this.freeTargets();
        for (const t of Object.values(this.gridTargets)) if (t) this.deleteTarget(t);
        for (const r of this.reads) {
          if (r.sync) (gl as WebGL2RenderingContext).deleteSync(r.sync);
          gl.deleteBuffer(r.buf);
        }
        this.reads = [];
        for (const t of this.mediaTex.values()) gl.deleteTexture(t.tex);
        if (this.quad) gl.deleteBuffer(this.quad);
        if (this.motifTex) gl.deleteTexture(this.motifTex);
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* already gone */
    }
    this.programs.clear();
    this.mediaTex.clear();
    this.motifSource = null;
  }
}
