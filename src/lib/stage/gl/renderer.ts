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
import { COMPOSITE_FRAGMENT, COMPOSITE_UNIFORMS, TRANSITION_CODE } from "../scenes/composite";
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
import { TYPE_FRAGMENT, TYPE_TARGETS, TYPE_UNIFORMS } from "../scenes/type";
import { UNIFORM_NAMES, buildFragmentWithHeader, buildSceneFragment, buildVertex } from "../scenes/common";
import { SCENE_SHADERS } from "../scenes";
import { PROGRAM_UNIFORMS, buildProgramFragment, tidyCompileLog } from "../program/contract";

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

/**
 * 專屬畫面 (phase 7): the song's scene program for this slot (see src/lib/stage/program/contract.ts).
 * Drawn instead of `scene` once compiled; while it compiles, or when it failed, `scene` is drawn.
 */
export interface ProgramDraw {
  /** cache key of the validated code */
  key: string;
  /** validated program body */
  code: string;
  songTime: number;
  songProgress: number;
  bar: number;
  tempo: number;
  master: number;
  section: number;
  sectionKind: number;
  sectionEnergy: number;
  sectionProgress: number;
  mode: number;
  params: [number, number, number, number];
  ink: RGB;
  palette: [RGB, RGB, RGB, RGB, RGB, RGB];
  /** text zone in uv (x0, y0, x1, y1; y up) */
  zone: [number, number, number, number];
  relation: number;
  /** the lyric's bounds in uv (x0, y0, x1, y1; y up), zeros when none */
  typeBox: [number, number, number, number];
  typeAmt: number;
}

export interface SceneDraw {
  scene: SceneId;
  lookKey: string;
  uniforms: SceneUniformValues;
  program?: ProgramDraw | null;
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
  /**
   * The low-pass feedback chain (0 = the output; 1 = a second, independent picture: the export's
   * background-only variant of a frame whose full version carries the type).
   */
  chain?: 0 | 1;
}

/** Grid readbacks in flight at once. A fence signals a frame or two later on a real GPU, but several
 *  frames later on a slow or shared one (two windows on a software GPU: 3 slots let the limiter see
 *  only every third frame, and a 4 Hz strobe sampled that rarely can slip by unmeasured). Each slot
 *  is a tiny pixel-pack buffer (cols × rows × 4 bytes). */
const READ_RING = 8;

/** A luminance grid read back from the GPU: RGBA8, bottom row first (GL order). */
export interface GridReadback {
  /** the render serial it belongs to */
  serial: number;
  cols: number;
  rows: number;
  data: Uint8Array;
}

/** 字體藝術 (phase 6): the type layer over scene + media (see src/lib/stage/scenes/type.ts). */
export interface TypeDraw {
  /** TypePainter's plates canvas */
  source: TexImageSource;
  /** re-upload when this changes */
  version: number;
  width: number;
  height: number;
  ink: RGB;
  accent: RGB;
  spot: RGB;
  /** the background tone (knockout fill, halo) */
  fill: RGB;
  /** 0..1 the lyrics-visible ramp */
  alpha: number;
  glitch: number;
  bleed: number;
  dry: number;
  wobble: number;
  rgb: number;
  grain: number;
  eat: number;
  windowFill: number;
  glow: number;
  seal: number;
  overprint: number;
  seed: number;
  vertical: number;
  halo: number;
  /** canvas px per output px */
  px: number;
  time: number;
  /** 專屬畫面: how the words meet the image (0 plain, 1 knockout, 2 behind, 3 lit) */
  relation?: number;
  /** where the type can be (GL uv x0, y0, x1, y1, padded); the legibility taps run only there */
  area?: [number, number, number, number];
  /** round 12: the section transition the words on screen enter with (TRANSITION_CODE, progress 0–1); null = none */
  transition?: { kind: number; progress: number } | null;
  /** the display word's box (GL uv, padded), or null: the full ink colour and the display contrast target there */
  display?: [number, number, number, number] | null;
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
  /** the type layer (字體藝術), composited before the safety pass; null = none */
  type?: TypeDraw | null;
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
  /** the compiler's log when it failed */
  log?: string;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

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
  /**
   * 0, 1: transition scenes; 2: scene under the media; 3: safety source S; 4, 5: safety low-pass
   * ping-pong; 6: scene + media under the type; 7: the type layer alone (export)
   */
  private targets: Array<Target | null> = [null, null, null, null, null, null, null, null, null, null];
  private typeTex: WebGLTexture | null = null;
  /** 1 × 1 transparent texture bound as a program's type mask when no lyric is on screen */
  private emptyTex: WebGLTexture | null = null;
  /** scene programs by key (their code, for compiling after a context restore) */
  private programSources = new Map<string, string>();
  /** the type texture of this frame is uploaded (a program may read it as its mask) */
  private typeReady = false;
  private typeTexState: { source: TexImageSource | null; version: number; w: number; h: number } = { source: null, version: Number.NaN, w: 0, h: 0 };
  /** safety grid targets (their own small sizes) */
  private gridTargets: { mid: Target | null; grid: Target | null } = { mid: null, grid: null };
  /** per safety chain: the ping-pong target that holds F_prev, and whether it is valid */
  private feedbackIndex: [4 | 5, 8 | 9] = [4, 8];
  private feedbackValid: [boolean, boolean] = [false, false];
  private serial = 0;
  /** in-flight grid readbacks (at most READ_RING) */
  private reads: PendingRead[] = [];
  private completed: GridReadback[] = [];
  private pendingCompose: { soften: number; gain: number; chain: 0 | 1 } | null = null;
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
    this.targets = [null, null, null, null, null, null, null, null, null, null];
    this.typeTex = null;
    this.emptyTex = null;
    this.typeTexState = { source: null, version: Number.NaN, w: 0, h: 0 };
    this.gridTargets = { mid: null, grid: null };
    this.reads = [];
    this.completed = [];
    this.feedbackValid = [false, false];
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
        entry.log = tidyCompileLog(log);
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

  private typeProgram(): ProgramEntry | null {
    return this.entryFor("type", () => this.compile("type", buildFragmentWithHeader(TYPE_FRAGMENT, this.gl2), TYPE_UNIFORMS));
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

  private programEntry(key: string): ProgramEntry | null {
    const code = this.programSources.get(key);
    if (code == null) return null;
    return this.entryFor(`program:${key}`, () => this.compile(`program:${key}`, buildProgramFragment(code, this.gl2), PROGRAM_UNIFORMS));
  }

  /** Queue a scene program (專屬畫面) to compile ahead of the built-in scenes. */
  prewarmProgram(key: string, code: string) {
    this.programSources.set(key, code);
    const k = `program:${key}`;
    this.warm.add(k);
    if (!this.programs.has(k) && !this.queue.includes(k)) this.queue.unshift(k);
  }

  /** A scene program's state and, when it failed, the compiler's log. */
  programState(key: string): { state: "none" | "pending" | "ready" | "failed"; log?: string } {
    const e = this.programs.get(`program:${key}`);
    return e ? { state: e.state, ...(e.log ? { log: e.log } : {}) } : { state: "none" };
  }

  /** Compile a queued program by key. */
  private compileKey(key: string) {
    if (key.startsWith("program:")) this.programEntry(key.slice(8));
    else if (key === "composite") this.compositeProgram();
    else if (key === "media") this.mediaProgram();
    else if (key === "type") this.typeProgram();
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
    this.feedbackValid = [false, false];
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

  /** Queue the type pass (a plan with a type system): ahead of the scenes, lyrics show at once. */
  prewarmType() {
    this.warm.add("type");
    if (!this.queue.includes("type") && !this.programs.has("type")) this.queue.unshift("type");
  }

  /** The type pass: "ready", "pending", "failed" or "none" (never asked for). */
  typeState(): "none" | "pending" | "ready" | "failed" {
    return this.programs.get("type")?.state ?? "none";
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
  async ensureReady(ids: readonly SceneId[], media: boolean, timeoutMs = 20000, safety = false, type = false, program: { key: string; code: string } | null = null): Promise<string[]> {
    this.prewarm(ids);
    if (program) this.prewarmProgram(program.key, program.code);
    if (media) this.prewarmMedia();
    if (safety) this.prewarmSafety();
    if (type) this.prewarmType();
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

  private target(i: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): Target | null {
    const existing = this.targets[i];
    if (existing && existing.w === this.width && existing.h === this.height) return existing;
    if (existing) this.deleteTarget(existing);
    if (i === 4 || i === 5) this.feedbackValid[0] = false;
    if (i === 8 || i === 9) this.feedbackValid[1] = false;
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
    this.targets = [null, null, null, null, null, null, null, null, null, null];
    this.feedbackValid = [false, false];
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

  /** The empty type mask (a 1 × 1 transparent texture). */
  private emptyTexture(): WebGLTexture | null {
    const gl = this.gl;
    if (this.emptyTex) return this.emptyTex;
    const t = gl.createTexture();
    if (!t) return null;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    this.emptyTex = t;
    return t;
  }

  /** 專屬畫面: draw the scene program; false when it is not ready (the built-in scene is drawn instead). */
  private drawProgram(draw: SceneDraw, pd: ProgramDraw): boolean {
    if (!this.programSources.has(pd.key)) this.programSources.set(pd.key, pd.code);
    const entry = this.programEntry(pd.key);
    if (!entry?.program) return false;
    const gl = this.gl;
    gl.useProgram(entry.program);
    this.setSceneUniforms(entry, draw.uniforms);
    const L = entry.locations;
    const f1 = (n: string, v: number) => {
      const l = L.get(n);
      if (l) gl.uniform1f(l, Number.isFinite(v) ? v : 0);
    };
    const f3 = (n: string, v: RGB) => {
      const l = L.get(n);
      if (l) gl.uniform3f(l, v[0], v[1], v[2]);
    };
    const f4 = (n: string, v: readonly number[]) => {
      const l = L.get(n);
      if (l) gl.uniform4f(l, v[0] || 0, v[1] || 0, v[2] || 0, v[3] || 0);
    };
    const typeReady = this.typeReady && !!this.typeTex;
    f1("uSongTime", pd.songTime);
    f1("uSongProgress", pd.songProgress);
    f1("uBar", pd.bar);
    f1("uTempo", pd.tempo);
    f1("uMaster", pd.master);
    f1("uSection", pd.section);
    f1("uSectionKind", pd.sectionKind);
    f1("uSectionEnergy", pd.sectionEnergy);
    f1("uSectionProgress", pd.sectionProgress);
    f1("uMode", pd.mode);
    f4("uParams", pd.params);
    f3("uInk", pd.ink);
    pd.palette.forEach((c, i) => f3(`uPal${i}`, c));
    f4("uZone", pd.zone);
    f1("uRelation", pd.relation);
    f4("uTypeBox", pd.typeBox);
    f1("uTypeAmt", typeReady ? pd.typeAmt : 0);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, typeReady ? this.typeTex : this.emptyTexture());
    const ut = L.get("uType");
    if (ut) gl.uniform1i(ut, 6);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.motifTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }

  private drawScene(draw: SceneDraw, target: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, this.width, this.height);
    if (draw.program && draw.scene !== "blackout" && this.drawProgram(draw, draw.program)) return;
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
        const chain = safety.chain === 1 ? 1 : 0;
        if (safety.alpha == null) this.pendingCompose = { soften: safety.soften, gain: safety.gain, chain };
        else this.compose(dest, safety.alpha, safety.soften, safety.gain, chain);
      }
      return true;
    } catch (e) {
      this.report("render", `繪製失敗：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Scene (+ transition), media and the type layer into `dest` (null = the screen). */
  private renderLayers(req: RenderRequest, dest: Target | null): boolean {
    const layers = (req.media?.layers ?? []).filter((l) => l.weight > 0.001 && l.source).slice(0, 2);
    const mediaProg = layers.length ? this.mediaProgram() : null;
    const type = req.type && req.type.alpha > 0.001 ? req.type : null;
    const typeProg = type ? this.typeProgram() : null;
    const under = typeProg?.program ? this.target(6) : null;
    const out = under ?? dest;
    // a scene program reads the lyric's type mask: upload this frame's plates before the scene
    this.typeReady = false;
    if (req.type && (req.current.program || req.previous?.program)) this.typeReady = this.typeTexture(req.type);
    const sceneTarget = mediaProg?.program ? this.target(2) : null;
    // without the media pass (no layers, still compiling, no FBO) the scene goes straight on
    if (sceneTarget && mediaProg?.program) {
      this.drawSceneLayer(req, sceneTarget);
      this.drawMedia(mediaProg, sceneTarget, layers, req.media!, out);
    } else this.drawSceneLayer(req, out);
    // the legibility guarantee aims at the contrast after the safety pass (its soften and cap)
    if (under && typeProg && type) this.drawType(typeProg, under, type, dest, false, req.safety?.soften ?? 0, req.safety?.gain ?? 1);
    return true;
  }

  /** Upload (or refresh) the type texture on unit 6. */
  private typeTexture(t: TypeDraw): boolean {
    const gl = this.gl;
    if (!this.typeTex) this.typeTex = gl.createTexture();
    if (!this.typeTex) return false;
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.typeTex);
    const st = this.typeTexState;
    if (st.source === t.source && st.version === t.version && st.w === t.width && st.h === t.height) return true;
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      // the painter's plates are coverage values: take the canvas' premultiplied bytes as they are
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      if (st.w === t.width && st.h === t.height && st.source === t.source) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, t.source);
      else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    } catch (e) {
      this.report("type-upload", `歌詞排版貼圖上傳失敗：${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
    this.typeTexState = { source: t.source, version: t.version, w: t.width, h: t.height };
    return true;
  }

  /** The type pass: `scene` (+ media) and the type texture into `dest` (null = the screen). */
  private drawType(entry: ProgramEntry, scene: Target, t: TypeDraw, dest: Target | null, layer: boolean, soften = 0, gain = 1) {
    const gl = this.gl;
    if (!this.typeTexture(t)) {
      // no type texture: pass the scene through
      this.blitScene(scene, dest);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest ? dest.fbo : null);
    gl.viewport(0, 0, this.width, this.height);
    if (layer) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.useProgram(entry.program);
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
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    const us = L.get("uScene");
    if (us) gl.uniform1i(us, 3);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.typeTex);
    const ut = L.get("uType");
    if (ut) gl.uniform1i(ut, 6);
    f3("uInk", t.ink);
    f3("uAccent", t.accent);
    f3("uSpot", t.spot);
    f3("uFill", t.fill);
    f1("uAlpha", t.alpha);
    f1("uLayer", layer ? 1 : 0);
    f1("uTime", t.time);
    f1("uSeed", t.seed % 997);
    f1("uGlitch", t.glitch);
    f1("uBleed", t.bleed);
    f1("uDry", t.dry);
    f1("uWobble", t.wobble);
    f1("uRgb", t.rgb);
    f1("uGrain", t.grain);
    f1("uEat", t.eat);
    f1("uWindow", t.windowFill);
    f1("uGlow", t.glow);
    f1("uSeal", t.seal);
    f1("uOverprint", t.overprint);
    f1("uVertical", t.vertical);
    f1("uHalo", t.halo);
    f1("uPx", t.px);
    f1("uSoften", soften);
    f1("uGain", gain);
    f1("uRelation", t.relation ?? 0);
    const ua = L.get("uTypeArea");
    const area = t.area ?? [0, 0, 1, 1];
    if (ua) gl.uniform4f(ua, area[0], area[1], area[2], area[3]);
    f1("uTransition", t.transition ? t.transition.kind : 0);
    f1("uTransitionP", t.transition ? t.transition.progress : 1);
    const ud = L.get("uDisplayBox");
    const disp = t.display ?? [0, 0, 0, 0];
    if (ud) gl.uniform4f(ud, disp[0], disp[1], disp[2], disp[3]);
    f1("uTarget", TYPE_TARGETS.readable);
    f1("uDisplayTarget", TYPE_TARGETS.display);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (const unit of [3, 6]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Copy a target to `dest` (the type texture failed: the frame goes out without type). */
  private blitScene(src: Target, dest: Target | null) {
    const gl = this.gl;
    if (this.gl2) {
      const gl2 = gl as WebGL2RenderingContext;
      gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, src.fbo);
      gl2.bindFramebuffer(gl2.DRAW_FRAMEBUFFER, dest ? dest.fbo : null);
      gl2.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl2.COLOR_BUFFER_BIT, gl2.NEAREST);
      gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }
    const present = this.safetyProgram("safety-present");
    if (!present?.program) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest ? dest.fbo : null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(present.program);
    const P = present.locations;
    const pr = P.get("uRes");
    if (pr) gl.uniform2f(pr, this.width, this.height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    const ut = P.get("uTex");
    if (ut) gl.uniform1i(ut, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * The export's lyric layer: the type alone over transparent (premultiplied RGBA, bottom row
   * first), with the safety soften and cap applied to its colours. Null when the pass is not ready.
   */
  renderTypeLayer(t: TypeDraw, soften: number, gain: number): Uint8Array | null {
    if (this.lost || this.disposed) return null;
    const entry = this.typeProgram();
    if (!entry?.program) return null;
    const gl = this.gl;
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      const out = this.target(7);
      const scene = this.target(6);
      if (!out || !scene) return null;
      this.drawType(entry, scene, t, out, true, soften, gain);
      const data = new Uint8Array(this.width * this.height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return data;
    } catch (e) {
      this.report("type-layer", `歌詞層算圖失敗：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
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
      this.compose(src, alpha, p.soften, p.gain, p.chain);
      return true;
    } catch (e) {
      this.report("render", `繪製失敗：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Low-pass S into the feedback target, then present it to the screen with the brightness cap. */
  private compose(src: Target, alpha: number, soften: number, gain: number, chain: 0 | 1 = 0) {
    const gl = this.gl;
    const lowpass = this.safetyProgram("safety-lowpass");
    const present = this.safetyProgram("safety-present");
    if (!lowpass?.program || !present?.program) return;
    const prevIndex = this.feedbackIndex[chain];
    const nextIndex = (chain === 0 ? (prevIndex === 4 ? 5 : 4) : prevIndex === 8 ? 9 : 8) as 4 | 5 | 8 | 9;
    const prev = this.target(prevIndex);
    const next = this.target(nextIndex);
    if (!prev || !next) return;
    const first = !this.feedbackValid[chain];

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
    set1("uGain", Number.isFinite(gain) ? gain : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (this.gl2) {
      // WebGL2: a straight copy to the screen
      const gl2 = gl as WebGL2RenderingContext;
      gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, next.fbo);
      gl2.bindFramebuffer(gl2.DRAW_FRAMEBUFFER, null);
      gl2.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl2.COLOR_BUFFER_BIT, gl2.NEAREST);
      gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
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
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    if (chain === 0) this.feedbackIndex[0] = nextIndex as 4 | 5;
    else this.feedbackIndex[1] = nextIndex as 8 | 9;
    this.feedbackValid[chain] = true;
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
      if (this.reads.length >= READ_RING) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return; // all in flight: skip this frame's measurement
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
    if (this.completed.length > 2 * READ_RING) this.completed.splice(0, this.completed.length - 2 * READ_RING);
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
        if (this.typeTex) gl.deleteTexture(this.typeTex);
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
