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

export interface RenderRequest {
  current: SceneDraw;
  previous: SceneDraw | null;
  transition: { kind: ActiveTransitionKind; progress: number } | null;
  clock: number;
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
  private targets: [Target | null, Target | null] = [null, null];
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
      preserveDrawingBuffer: false,
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
    this.targets = [null, null];
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

  /** Background work: compile queued programs (one per call without the parallel extension). */
  idle() {
    if (this.lost || this.disposed) return;
    try {
      if (this.parallel) {
        while (this.queue.length) {
          const key = this.queue.shift()!;
          if (this.programs.has(key)) continue;
          if (key === "composite") this.compositeProgram();
          else this.sceneProgram(key.slice(6) as SceneId);
        }
        for (const [key, entry] of this.programs) if (entry.state === "pending") this.finalize(key, entry);
      } else if (this.queue.length) {
        const key = this.queue.shift()!;
        if (!this.programs.has(key)) {
          if (key === "composite") this.compositeProgram();
          else this.sceneProgram(key.slice(6) as SceneId);
        }
      }
    } catch (e) {
      this.report("idle", `著色器預先編譯失敗：${e instanceof Error ? e.message : String(e)}`);
    }
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

  private target(i: 0 | 1): Target | null {
    const existing = this.targets[i];
    if (existing && existing.w === this.width && existing.h === this.height) return existing;
    if (existing) this.deleteTarget(existing);
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t: Target = { fbo, tex, w: this.width, h: this.height };
    if (!ok) {
      this.deleteTarget(t);
      this.report("fbo", "無法建立轉場用的影格緩衝區，將改用直接切換。");
      return null;
    }
    this.targets[i] = t;
    return t;
  }

  private deleteTarget(t: Target) {
    if (this.lost) return;
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  private freeTargets() {
    for (const t of this.targets) if (t) this.deleteTarget(t);
    this.targets = [null, null];
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
      const tr = req.transition;
      const prev = req.previous;
      const composite = tr && prev ? this.compositeProgram() : null;
      const a = composite ? this.target(0) : null;
      const b = composite ? this.target(1) : null;
      if (!tr || !prev || !composite || !composite.program || !a || !b) {
        this.drawScene(req.current, null);
        return true;
      }
      this.drawScene(req.current, a);
      const sameLook = prev.lookKey === req.current.lookKey && prev.scene === req.current.scene;
      if (!sameLook) this.drawScene(prev, b);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
      return true;
    } catch (e) {
      this.report("render", `繪製失敗：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
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
        if (this.quad) gl.deleteBuffer(this.quad);
        if (this.motifTex) gl.deleteTexture(this.motifTex);
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* already gone */
    }
    this.programs.clear();
    this.motifSource = null;
  }
}
