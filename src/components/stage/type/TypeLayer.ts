// The stage's type layer (字體藝術): which lines are on screen (the current one entering or
// holding, the previous ones still leaving — lines overlap briefly for continuity), their
// compositions (cached per layout key), the clock of each (entrances land on the line start,
// snapped to the beat for voices that cut on it; live-cued untimed lines play from the cue),
// painting them into the plates canvas and the TypeDraw for the GL type pass. Without WebGL it
// paints real colours into a canvas of its own in the DOM.
//
// The same class runs in the live StageEngine (now = performance.now()) and in the export's
// OfflineStage (now = song time), so a frame depends only on what the clock says.
//
// The type is pixels, so the current line's text is also kept in a visually hidden element of the
// stage (screen readers, and a test reading the page): data-recipe / data-voice say how it is set.

import { beatAt } from "@/lib/stage/media/model";
import { parseHex, type RGB } from "@/lib/stage/color";
import type { TypeDraw } from "@/lib/stage/gl/renderer";
import type { StageState } from "@/lib/stage/protocol";
import { resolveLineDesign, type StageLook } from "@/lib/stage/resolve";
import { transformHex, type ActiveSafety } from "@/lib/stage/safety";
import { lineSpan } from "@/lib/timeline";
import { compositionUniforms, mergeUniforms, type TypeClock } from "@/lib/type/animate";
import { ORNAMENT_CHARS } from "@/lib/type/compose";
import { EMPTY_BOX, pieceBox, unionBox, type Box, type CanvasSpec, type Composition } from "@/lib/type/model";
import { composeProjectLine } from "@/lib/type/prepare";
import { hasTypeSystem, resolveSystem } from "@/lib/type/resolve";
import { SEAL_COLOR } from "@/lib/type/vocab";
import type { AudioAnalysis, Project, ProjectOutput } from "@/lib/types";
import { loadFaces, resolveFamilies, type TypeFamilies } from "./fonts";
import { TypePainter, type PaintItem } from "./TypePainter";

export interface TypeLayerFrame {
  project: Project;
  state: StageState;
  /** song time, seconds */
  t: number;
  /** Date.now() (live) or song time in ms (export) */
  nowEpoch: number;
  /** performance.now() (live) or song time in ms (export) */
  now: number;
  look: StageLook;
  visible: boolean;
  safety: ActiveSafety;
  /** the live beat when the song has no analysis grid */
  liveBeat?: { phase: number; index: number } | null;
  /** canvas px of the drawing buffer */
  width: number;
  height: number;
  output: ProjectOutput;
  /** compose without the editor's edits (A/B) */
  generated?: boolean;
}

interface Active {
  index: number;
  key: string;
  comp: Composition;
  /** song time of the entrance (timed lines), or null: the cue clock */
  enterAt: number | null;
  cueAt: number;
  exitAt: number | null;
  /** seconds the entrance waits for an outgoing line it would overlap (M6: no line drawn over another) */
  delay: number;
}

/** Two compositions' drawn bounds overlap (more than a touch). */
export function boundsOverlap(a: Composition, b: Composition): boolean {
  const p = a.bounds;
  const q = b.bounds;
  if (!(p.w > 0 && p.h > 0 && q.w > 0 && q.h > 0)) return false;
  const w = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
  const h = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
  if (w <= 0 || h <= 0) return false;
  return w * h > 0.04 * Math.min(p.w * p.h, q.w * q.h);
}

/**
 * How long an incoming line waits when the line it replaces is still leaving over the same part
 * of the frame: the rest of that exit (at most 0.6 s), nothing when the exit is a cut or the two
 * do not meet.
 */
export function entranceDelay(incoming: Composition, leaving: Composition, exitElapsed: number): number {
  if (!boundsOverlap(incoming, leaving)) return 0;
  const left = leaving.exitDur - exitElapsed;
  return left > 0.08 ? Math.min(0.6, left) : 0;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
const ease = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/** The nearest beat to t within the window a card may snap to (a little early rather than late). */
export function snapToBeat(analysis: AudioAnalysis | null, t: number): number {
  const beats = analysis?.beats;
  if (!beats || beats.length < 2) return t;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  let best = t;
  let bestD = Infinity;
  for (const k of [lo - 1, lo]) {
    const b = beats[k];
    if (b == null) continue;
    const d = b - t;
    if (d >= -0.14 && d <= 0.08 && Math.abs(d) < bestD) {
      bestD = Math.abs(d);
      best = b;
    }
  }
  return best;
}

/** The box (canvas px) of the display words of these compositions — giant, bled and window pieces — or null. */
export function displayBox(comps: readonly Composition[]): Box | null {
  let b: Box = { ...EMPTY_BOX };
  for (const c of comps) {
    for (const p of c.pieces) {
      if (!p.glyphs.length || p.echo) continue;
      if (p.role !== "giant" && !p.window) continue;
      b = unionBox(b, pieceBox(p));
    }
  }
  return b.w > 0 && b.h > 0 ? b : null;
}

export class TypeLayer {
  private painter: TypePainter;
  private current: Active | null = null;
  private leaving: Active[] = [];
  private cache = new Map<string, Composition>();
  private visibleAmt = 1;
  private lastNow = 0;
  private familiesKey = "";
  private families: TypeFamilies | null = null;
  private fontToken = 0;
  private version = 0;
  private domMode = false;
  private dom: HTMLCanvasElement | null = null;
  private failed = false;
  private staticKey = "";
  private liveBeatN = 0;
  private lastLivePhase = 0;
  private charsKey = "";
  /** the current line's text, visually hidden */
  private text: HTMLElement | null = null;
  private textKey = "";
  /** the output canvas the compositions are laid out for (the hidden text's display box is in its fractions) */
  private canvasSize = { width: 1920, height: 1080 };

  constructor(
    private readonly host: HTMLElement,
    private readonly before: Element | null = null,
  ) {
    this.painter = new TypePainter();
    if (typeof document !== "undefined") {
      const el = document.createElement("div");
      el.className = "type-layer-text";
      Object.assign(el.style, { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap", pointerEvents: "none", margin: "-1px", padding: "0", border: "0" });
      el.setAttribute("data-type-layer", "");
      host.append(el);
      this.text = el;
    }
  }

  /** Mirror the current composition's line in the hidden text element. */
  private syncText(project: Project) {
    const el = this.text;
    if (!el) return;
    const cur = this.visibleAmt > 0.02 ? this.current : null;
    const line = cur ? project.lyrics?.lines?.[cur.index] : undefined;
    const key = cur && line ? `${cur.index}|${cur.comp.recipe}|${cur.comp.voice}|${line.text}` : "";
    if (key === this.textKey) return;
    this.textKey = key;
    el.textContent = line?.text ?? "";
    if (cur) {
      el.dataset.recipe = cur.comp.recipe;
      el.dataset.voice = cur.comp.voice;
      el.dataset.line = String(cur.index);
      // the display word's box as fractions of the canvas (x0, y0, x1, y1; y down): the legibility check measures it apart
      const db = displayBox([cur.comp]);
      const W = this.canvasSize.width || 1920;
      const H = this.canvasSize.height || 1080;
      if (db) el.dataset.display = [db.x / W, db.y / H, (db.x + db.w) / W, (db.y + db.h) / H].map((v) => Math.min(1.2, Math.max(-0.2, v)).toFixed(4)).join(",");
      else delete el.dataset.display;
    } else {
      delete el.dataset.recipe;
      delete el.dataset.voice;
      delete el.dataset.line;
      delete el.dataset.display;
    }
  }

  /** WebGL is missing or lost: paint real colours into a canvas in the DOM instead. */
  setDomMode(on: boolean) {
    if (on === this.domMode) return;
    this.domMode = on;
    this.staticKey = "";
    if (on && !this.dom) {
      const c = document.createElement("canvas");
      Object.assign(c.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
      c.setAttribute("aria-hidden", "true");
      if (this.before && this.before.parentNode === this.host) this.host.insertBefore(c, this.before);
      else this.host.append(c);
      this.dom = c;
    }
    if (this.dom) this.dom.style.display = on ? "block" : "none";
  }

  /** CSS filter for the DOM fallback (the LED safety cap without the GL pass). */
  setDomFilter(filter: string) {
    if (this.dom) this.dom.style.filter = filter;
  }

  /** Fonts finished loading: measurements and sprites are stale. */
  invalidate() {
    this.cache.clear();
    this.painter.invalidate();
    this.staticKey = "";
    if (this.current) this.current.key = "";
  }

  /** Nothing on screen (another lyric mode took over). */
  clear() {
    this.current = null;
    this.leaving = [];
    this.staticKey = "";
    this.textKey = "";
    if (this.text) {
      this.text.textContent = "";
      delete this.text.dataset.recipe;
      delete this.text.dataset.voice;
      delete this.text.dataset.line;
    }
    if (this.dom) this.dom.getContext("2d")?.clearRect(0, 0, this.dom.width, this.dom.height);
  }

  /** The current line's readable text as fractions of the canvas (x0, y0, x1, y1; y down). */
  textBounds(output: ProjectOutput): [number, number, number, number] | null {
    const c = this.current?.comp;
    if (!c || c.readBounds.w <= 0) return null;
    const W = output.width || 1920;
    const H = output.height || 1080;
    const b = c.readBounds;
    return [Math.max(0, b.x / W), Math.max(0, b.y / H), Math.min(1, (b.x + b.w) / W), Math.min(1, (b.y + b.h) / H)];
  }

  /** The composition currently entering or holding (diagnostics, the editor). */
  get composition(): Composition | null {
    return this.current?.comp ?? null;
  }

  private syncFonts(project: Project) {
    const ts = project.plan?.typeSystem;
    if (!ts) return;
    const sys = resolveSystem(ts);
    const fam = resolveFamilies(this.host, sys.fonts);
    if (fam.key !== this.familiesKey) {
      this.familiesKey = fam.key;
      this.families = fam;
      this.painter.setFamilies(fam);
      this.cache.clear();
      this.charsKey = "";
    }
    // load the faces for the characters this song shows (once per lyric set and system)
    const chars = new Set<string>();
    for (const l of project.lyrics?.lines ?? []) for (const ch of `${l.text ?? ""}${l.translation ?? ""}`) chars.add(ch);
    for (const ch of `${ts.seal ?? ""}${project.meta?.title ?? ""}0123456789「」﹁﹂—CHORUSVERSEBRIDGEINTROUTLPEAKDWN`) chars.add(ch);
    // the plan's section labels (副歌一) are drawn as ornaments
    for (const s of project.plan?.sections ?? []) for (const ch of s.label ?? "") chars.add(ch);
    chars.delete(" ");
    const text = [...chars].join("");
    const key = `${fam.key}|${sys.weight}|${text}`;
    if (key === this.charsKey || !this.families) return;
    this.charsKey = key;
    const token = ++this.fontToken;
    const weights = [...new Set([sys.weight, Math.max(500, sys.weight - 100), Math.max(500, sys.weight - 200), 700])];
    void loadFaces(this.families, weights, text).then(() => {
      if (token === this.fontToken) this.invalidate();
    });
  }

  /** Wait (bounded) for the faces of this project: the export calls it before its first frame. */
  async prepare(project: Project): Promise<boolean> {
    this.syncFonts(project);
    if (!this.families || !project.plan?.typeSystem) return true;
    const sys = resolveSystem(project.plan.typeSystem);
    const chars = new Set<string>();
    for (const l of project.lyrics?.lines ?? []) for (const ch of `${l.text ?? ""}${l.translation ?? ""}`) chars.add(ch);
    for (const ch of `${project.plan.typeSystem.seal ?? ""}${project.meta?.title ?? ""}${ORNAMENT_CHARS}`) chars.add(ch);
    for (const s of project.plan.sections ?? []) for (const ch of s.label ?? "") chars.add(ch);
    chars.delete(" ");
    const ok = await loadFaces(this.families, [...new Set([sys.weight, Math.max(500, sys.weight - 100), Math.max(500, sys.weight - 200), 700])], [...chars].join(""), 20000);
    this.fontToken++;
    this.invalidate();
    return ok;
  }

  private compose(project: Project, index: number, canvas: CanvasSpec, generated: boolean): { comp: Composition; key: string } | null {
    const plan = project.plan;
    if (!hasTypeSystem(plan)) return null;
    const lines = project.lyrics?.lines ?? [];
    const duration = project.meta?.duration || project.analysis?.duration || 0;
    const r = composeProjectLine(plan, lines, index, canvas, this.painter.measure, { duration, songTitle: project.meta?.title ?? "", generated });
    if (!r) return null;
    const key = `${r.key}|${this.familiesKey}`;
    const hit = this.cache.get(key);
    if (hit) return { comp: hit, key };
    if (this.cache.size > 96) this.cache.clear();
    this.cache.set(key, r.comp);
    return { comp: r.comp, key };
  }

  update(f: TypeLayerFrame): TypeDraw | null {
    if (this.failed) return null;
    try {
      return this.frame(f);
    } catch (e) {
      // the output must never go down because of one line: log once and stop the layer
      this.failed = true;
      console.error("[Livelyrics] 歌詞排版圖層發生錯誤，已停用：", e);
      return null;
    }
  }

  private frame(f: TypeLayerFrame): TypeDraw | null {
    const { project, state, now } = f;
    const plan = project.plan;
    if (!hasTypeSystem(plan)) return null;
    this.syncFonts(project);
    const elapsed = Math.max(0, (now - (this.lastNow || now)) / 1000);
    this.lastNow = now;
    const target = f.visible ? 1 : 0;
    const step = elapsed / 0.3;
    this.visibleAmt = target > this.visibleAmt ? Math.min(target, this.visibleAmt + step) : Math.max(target, this.visibleAmt - step);

    const output = f.output;
    const canvas: CanvasSpec = { width: output.width || 1920, height: output.height || 1080, safe: output.lyricSafe };
    this.canvasSize = { width: canvas.width, height: canvas.height };
    const lines = project.lyrics?.lines ?? [];
    const idx = state.lineIndex;
    let valid = typeof idx === "number" && Number.isInteger(idx) && idx >= 0 && idx < lines.length && !!lines[idx]?.text?.trim() ? idx : null;
    if (valid != null && resolveLineDesign(plan, lines[valid].id, f.look.lyricStyle, null).style === "hidden") valid = null;

    // the current line: a new line enters (the old one leaves); a changed layout of the same line swaps in place
    const next = valid != null ? this.compose(project, valid, canvas, !!f.generated) : null;
    const cur = this.current;
    if (!next || !cur || cur.index !== valid) {
      // a cut exit is gone at once (never drawn under the incoming line, not even for the one
      // frame a throttled tab renders); the other exits leave over their duration
      if (cur && cur.comp.exit !== "cut") {
        cur.exitAt = now;
        this.leaving.push(cur);
      }
      this.current = null;
      if (next && valid != null) {
        const span = lineSpan(lines, valid, project.meta?.duration || project.analysis?.duration || 0);
        const enterAt = span ? (next.comp.snap ? snapToBeat(project.analysis, span[0]) : span[0]) : null;
        // the incoming line waits for an outgoing one it would be drawn over
        let delay = 0;
        for (const a of this.leaving) if (a.exitAt != null) delay = Math.max(delay, entranceDelay(next.comp, a.comp, (now - a.exitAt) / 1000));
        this.current = { index: valid, key: next.key, comp: next.comp, enterAt, cueAt: Number.isFinite(state.lineStartedAt) ? state.lineStartedAt : f.nowEpoch, exitAt: null, delay };
      }
    } else if (cur.key !== next.key) {
      cur.key = next.key;
      cur.comp = next.comp;
    }
    // at most three lines leaving (fast cueing)
    while (this.leaving.length > 3) this.leaving.shift();
    this.syncText(project);

    const beatInfo = beatAt(project.analysis, f.t);
    let beat: TypeClock["beat"];
    if (beatInfo) beat = { phase: beatInfo.phase, index: beatInfo.index, known: true };
    else if (f.liveBeat) {
      if (f.liveBeat.phase < this.lastLivePhase - 0.5) this.liveBeatN++;
      this.lastLivePhase = f.liveBeat.phase;
      beat = { phase: f.liveBeat.phase, index: this.liveBeatN, known: true };
    } else beat = { phase: 0, index: 0, known: false };

    const sys = resolveSystem(plan.typeSystem);
    const items: PaintItem[] = [];
    const uniforms = [];
    const clockOf = (a: Active, leaving: boolean): TypeClock => {
      let since = (a.enterAt != null ? f.t - a.enterAt : (f.nowEpoch - a.cueAt) / 1000) - a.delay;
      // a leaving line has entered, whatever the clock did since (a seek back must not hide it)
      if (leaving) since = Math.max(since, a.comp.enterDur + 0.6);
      const exit = a.exitAt != null ? clamp01((now - a.exitAt) / 1000 / Math.max(0.05, a.comp.exitDur)) : null;
      return { since, exit, t: f.t, beat, safe: f.safety.on, intensity: a.comp.motionAmount, speed: sys.params.motionSpeed };
    };
    this.leaving = this.leaving.filter((a) => a.exitAt == null || (now - a.exitAt) / 1000 < a.comp.exitDur + 0.02);
    for (const a of this.leaving) {
      const clock = clockOf(a, true);
      items.push({ comp: a.comp, clock, alpha: ease(this.visibleAmt) });
      uniforms.push(compositionUniforms(a.comp, clock, sys.params.texture, sys.color === "overprint"));
    }
    if (this.current) {
      const clock = clockOf(this.current, false);
      items.push({ comp: this.current.comp, clock, alpha: ease(this.visibleAmt) });
      uniforms.push(compositionUniforms(this.current.comp, clock, sys.params.texture, sys.color === "overprint"));
    }

    const W = Math.max(1, Math.round(f.width));
    const H = Math.max(1, Math.round(f.height));
    const scale = W / canvas.width;
    const look = f.look;
    // LED 安全模式 in the DOM fallback only: in GL the safety pass caps the composited type
    const T = (hex: string) => (this.domMode && f.safety.on ? transformHex(hex, f.safety) : hex);
    if (this.domMode && this.dom) {
      if (this.dom.width !== W || this.dom.height !== H) {
        this.dom.width = W;
        this.dom.height = H;
      }
      this.painter.resize(W, H);
      this.painter.paint(items, scale, "color", { ink: T(look.lyricColor), accent: T(look.accentColor), spot: T(SEAL_COLOR) });
      const ctx = this.dom.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(this.painter.canvas, 0, 0);
      }
      return null;
    }
    if (!items.length) {
      this.staticKey = "";
      return null;
    }
    const staticKey = this.isStatic(items) ? `${items.map((i) => i.comp.key).join(",")}|${W}x${H}|${this.visibleAmt.toFixed(3)}` : "";
    if (!staticKey || staticKey !== this.staticKey) {
      this.painter.resize(W, H);
      this.painter.paint(items, scale, "plates");
      this.version++;
    }
    this.staticKey = staticKey;
    const u = mergeUniforms(uniforms);
    const rgb = (hex: string): RGB => parseHex(hex);
    // where the type can be this frame (GL uv, y up), padded for motion, echoes and glitch slices:
    // the legibility guarantee's taps run only there
    let x0 = 1;
    let y0 = 1;
    let x1 = 0;
    let y1 = 0;
    for (const it of items) {
      const b = it.comp.bounds;
      if (!(b.w > 0 && b.h > 0)) continue;
      x0 = Math.min(x0, b.x / canvas.width);
      x1 = Math.max(x1, (b.x + b.w) / canvas.width);
      y0 = Math.min(y0, 1 - (b.y + b.h) / canvas.height);
      y1 = Math.max(y1, 1 - b.y / canvas.height);
    }
    const pad = 0.08;
    const area: [number, number, number, number] = x1 > x0 ? [x0 - pad, y0 - pad * (W / H), x1 + pad, y1 + pad * (W / H)] : [0, 0, 1, 1];
    // the display words on screen (B3): the full ink colour and the higher contrast target there
    const db = displayBox(items.map((it) => it.comp));
    const dpad = 0.02;
    const display: [number, number, number, number] | null = db ? [db.x / canvas.width - dpad, 1 - (db.y + db.h) / canvas.height - dpad * (W / H), (db.x + db.w) / canvas.width + dpad, 1 - db.y / canvas.height + dpad * (W / H)] : null;
    return {
      area,
      display,
      source: this.painter.canvas,
      version: this.version,
      width: W,
      height: H,
      ink: rgb(look.lyricColor),
      accent: rgb(look.accentColor),
      spot: rgb(SEAL_COLOR),
      fill: rgb(look.colorway[0]),
      alpha: 1,
      ...u,
      halo: 0.62,
      px: scale,
      time: f.t,
    };
  }

  /** Nothing moves: the painted texture can be reused (no hold motion, no entrance or exit running). */
  private isStatic(items: readonly PaintItem[]): boolean {
    return items.every((it) => {
      const c = it.clock;
      const comp = it.comp;
      if (c.exit != null || comp.voice === "glitch" || comp.motion !== "still") return false;
      const settle = comp.enterDur + Math.max(0, ...comp.pieces.map((p) => p.delay)) * 2 + (comp.enter === "write" ? 6 : 1.2);
      return c.since > settle;
    });
  }

  destroy() {
    this.current = null;
    this.leaving = [];
    this.cache.clear();
    this.dom?.remove();
    this.dom = null;
    this.text?.remove();
    this.text = null;
  }
}
