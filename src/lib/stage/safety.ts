// LED 安全模式 (phase 3): pure, deterministic safety logic shared by the live stage (StageEngine),
// the offline export (OfflineStage) and the console. No DOM, no GL.
//
// Festival LED walls are extremely bright. This module holds four layers of protection:
//
// 1. Settings: OutputSafety presets (室內投影 100 %, LED 牆 70 %, 戶外強光 LED 55 %, custom),
//    normalizing (old files → safe mode on) and patching.
// 2. Colour maths: the brightness cap (a linear-light fraction of full white, applied as an encoded
//    multiplier k = brightness^(1/2.2)) and the soften shoulder (compresses the brightest encoded
//    values). The GL safety pass applies both per pixel to scene + media; the lyric layer gets its
//    colours through the same transform (`transformHex`), so every layer is capped exactly and the
//    export (which paints the same DOM colours) matches.
// 3. Source-level safety: what the director, resolve and the audio mixer stop asking for in safe mode
//    (flash / bloom transitions become fades, audio reactivity clamped, beat pulses rate-limited to
//    ≤ 3 Hz by PulseGate, saturated-red looks pulse less, impact lyrics switch slower), and the
//    pre-show report that lists which sections change.
// 4. The flash limiter (WCAG 2.3.1 / ITU-R BT.1702 / Harding-style): FlashDetector counts general and
//    saturated-red transitions on a small luminance grid of the composited frame; FlashLimiter keeps a
//    model of the displayed grid, and when the rolling one-second count reaches its budget it turns
//    the output into a temporal low-pass (displayed = mix(previous displayed, new frame, α)) until the
//    source calms down. Given the same frames it always produces the same α sequence.

import type { DesignPlan, OutputSafety, SafetyPresetId, SectionDesign } from "../types";
import { parseHex, toHex, type RGB } from "./color";

// ---------------------------------------------------------------------------
// 1. Settings
// ---------------------------------------------------------------------------

export interface SafetyPreset {
  id: Exclude<SafetyPresetId, "custom">;
  label: string;
  /** short form for capsules */
  short: string;
  brightness: number;
  detail: string;
}

export const SAFETY_PRESETS: readonly SafetyPreset[] = [
  { id: "indoor", label: "室內投影", short: "室內", brightness: 1, detail: "投影機或室內螢幕：不降亮度，只限制閃爍" },
  { id: "led", label: "LED 牆", short: "LED 牆", brightness: 0.7, detail: "一般 LED 牆：最高亮度 70%" },
  { id: "outdoor", label: "戶外強光 LED", short: "戶外 LED", brightness: 0.55, detail: "戶外高亮度 LED：最高亮度 55%，保護前排觀眾" },
];

export const SAFETY_MIN_BRIGHTNESS = 0.2;
export const SAFETY_MAX_SOFTEN = 1;

export const DEFAULT_SAFETY: OutputSafety = {
  enabled: true,
  preset: "led",
  brightness: 0.7,
  flashLimit: true,
  redProtect: true,
  soften: 0.25,
};

export function defaultSafety(): OutputSafety {
  return { ...DEFAULT_SAFETY };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round2 = (x: number) => Math.round(x * 100) / 100;

export function safetyPresetById(id: unknown): SafetyPreset | undefined {
  return SAFETY_PRESETS.find((p) => p.id === id);
}

/** The preset whose brightness matches, or "custom". */
export function safetyPresetFor(brightness: number): SafetyPresetId {
  return SAFETY_PRESETS.find((p) => Math.abs(p.brightness - brightness) < 0.005)?.id ?? "custom";
}

export function clampBrightness(v: unknown, fallback = DEFAULT_SAFETY.brightness): number {
  if (!finite(v)) return fallback;
  return round2(Math.min(1, Math.max(SAFETY_MIN_BRIGHTNESS, v)));
}

export function clampSoften(v: unknown, fallback = DEFAULT_SAFETY.soften): number {
  if (!finite(v)) return fallback;
  return round2(Math.min(SAFETY_MAX_SOFTEN, Math.max(0, v)));
}

/**
 * Any stored, patched or received value → valid settings. Missing (old projects, old consoles) →
 * safe mode on with the LED 牆 preset. A known preset id wins over a mismatching brightness.
 */
export function normalizeSafety(raw: unknown, base: OutputSafety = DEFAULT_SAFETY): OutputSafety {
  if (!isRecord(raw)) return { ...base };
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : base.enabled;
  const preset = safetyPresetById(raw.preset);
  const brightness = preset ? preset.brightness : clampBrightness(raw.brightness, base.brightness);
  return {
    enabled,
    preset: preset ? preset.id : raw.preset === "custom" ? "custom" : safetyPresetFor(brightness),
    brightness,
    flashLimit: typeof raw.flashLimit === "boolean" ? raw.flashLimit : base.flashLimit,
    redProtect: typeof raw.redProtect === "boolean" ? raw.redProtect : base.redProtect,
    soften: clampSoften(raw.soften, base.soften),
  };
}

export type SafetyPatch = Partial<OutputSafety>;

/**
 * The next settings after an operator edit. A preset replaces the brightness; a brightness alone
 * becomes "custom" unless it matches a preset; turning safe mode on turns the flash limiter on too
 * (unless the same patch says otherwise).
 */
export function patchSafety(current: OutputSafety, patch: SafetyPatch | null | undefined): OutputSafety {
  const p = isRecord(patch) ? patch : {};
  const next: Record<string, unknown> = { ...current, ...p };
  if (p.preset === undefined && p.brightness !== undefined) {
    const b = clampBrightness(p.brightness, current.brightness);
    next.brightness = b;
    next.preset = safetyPresetFor(b);
  }
  if (p.preset === "custom" && p.brightness === undefined) next.brightness = current.brightness;
  if (p.enabled === true && !current.enabled && p.flashLimit === undefined) next.flashLimit = true;
  return normalizeSafety(next, current);
}

/** What the renderer actually applies this frame (all neutral when safe mode is off). */
export interface ActiveSafety {
  on: boolean;
  /** linear-light brightness cap, 0.2..1 */
  brightness: number;
  /** encoded (gamma) multiplier: brightness^(1/2.2) */
  gain: number;
  soften: number;
  flashLimit: boolean;
  redProtect: boolean;
}

export const SAFETY_OFF: ActiveSafety = { on: false, brightness: 1, gain: 1, soften: 0, flashLimit: false, redProtect: false };

/** Display gamma used to turn the linear brightness cap into an encoded multiplier. */
export const DISPLAY_GAMMA = 2.2;

export function capGain(brightness: number): number {
  const b = Math.min(1, Math.max(SAFETY_MIN_BRIGHTNESS, finite(brightness) ? brightness : 1));
  return Math.pow(b, 1 / DISPLAY_GAMMA);
}

export function activeSafety(s: OutputSafety | null | undefined): ActiveSafety {
  const v = normalizeSafety(s ?? undefined);
  if (!v.enabled) return SAFETY_OFF;
  return { on: true, brightness: v.brightness, gain: capGain(v.brightness), soften: v.soften, flashLimit: v.flashLimit, redProtect: v.redProtect };
}

const activeCache = new WeakMap<object, ActiveSafety>();

/** activeSafety of a project's output, cached per output object (called every frame). */
export function projectSafety(project: { output?: { safety?: OutputSafety } | null } | null | undefined): ActiveSafety {
  const out = project?.output;
  if (!out || typeof out !== "object") return activeSafety(undefined);
  let a = activeCache.get(out);
  if (!a) {
    a = activeSafety(out.safety);
    activeCache.set(out, a);
  }
  return a;
}

/** 「LED 安全 70%」 / 「LED 安全已關閉」 */
export function safetyCapsuleLabel(s: OutputSafety): string {
  return s.enabled ? `LED 安全 ${Math.round(s.brightness * 100)}%` : "LED 安全已關閉";
}

/** The preset's name, or 「自訂 62%」. */
export function safetyPresetLabel(s: OutputSafety): string {
  const p = safetyPresetById(s.preset);
  return p ? `${p.label} ${Math.round(p.brightness * 100)}%` : `自訂 ${Math.round(s.brightness * 100)}%`;
}

/** One line describing the settings (cue sheet, README, tooltips). */
export function safetySummary(s: OutputSafety): string {
  if (!s.enabled) return "LED 安全模式：關閉（未限制亮度與閃爍）";
  const parts = [
    `最高亮度 ${Math.round(s.brightness * 100)}%（${safetyPresetById(s.preset)?.label ?? "自訂"}）`,
    s.flashLimit ? "閃爍限制開（每秒最多 3 次，WCAG 2.3.1）" : "閃爍限制關",
    s.redProtect ? "紅閃保護開" : "紅閃保護關",
    `柔化 ${Math.round(s.soften * 100)}%`,
  ];
  return `LED 安全模式：開，${parts.join("，")}`;
}

// ---------------------------------------------------------------------------
// 2. Colour maths
// ---------------------------------------------------------------------------

export function srgbToLinear(c: number): number {
  const v = c < 0 ? 0 : c > 1 ? 1 : c;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const LIN_STEPS = 1024;
let linTable: Float32Array | null = null;

/** srgbToLinear through a 1025-entry table with linear interpolation (per-frame grid work). */
export function fastLinear(c: number): number {
  if (!linTable) {
    linTable = new Float32Array(LIN_STEPS + 1);
    for (let i = 0; i <= LIN_STEPS; i++) linTable[i] = srgbToLinear(i / LIN_STEPS);
  }
  const x = (c < 0 ? 0 : c > 1 ? 1 : c || 0) * LIN_STEPS;
  const i = Math.min(LIN_STEPS - 1, Math.floor(x));
  const f = x - i;
  return linTable[i] + (linTable[i + 1] - linTable[i]) * f;
}

/** WCAG relative luminance of encoded sRGB values (0..1). */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Soften shoulder on one encoded channel: values up to the knee pass unchanged, the rest roll off
 * smoothly towards `top`. s = 0 is the identity; s = 1 lowers full white to 0.75.
 * Mirrored exactly by the GLSL in src/lib/stage/scenes/safety.ts.
 */
export function softenChannel(x: number, s: number): number {
  const v = x < 0 ? 0 : x > 1 ? 1 : x;
  if (!(s > 0)) return v;
  const k = 1 - 0.55 * s;
  const top = 1 - 0.25 * s;
  if (v <= k) return v;
  const span = top - k;
  return k + span * (1 - Math.exp(-(v - k) / span));
}

/** The colour the viewer gets for an encoded colour: soften, then the brightness cap. */
export function transformRgb(rgb: RGB, safety: ActiveSafety): RGB {
  if (!safety.on) return [rgb[0], rgb[1], rgb[2]];
  return [softenChannel(rgb[0], safety.soften) * safety.gain, softenChannel(rgb[1], safety.soften) * safety.gain, softenChannel(rgb[2], safety.soften) * safety.gain];
}

/** transformRgb on a hex colour (lyric colours, shadows, scrims). */
export function transformHex(hex: string, safety: ActiveSafety): string {
  if (!safety.on) return hex;
  return toHex(transformRgb(parseHex(hex), safety));
}

/** Peak relative luminance the output can reach (full white after soften and cap). */
export function peakLuminance(safety: ActiveSafety): number {
  const w = transformRgb([1, 1, 1], safety);
  return luminance(w[0], w[1], w[2]);
}

/** WCAG saturated red: R / (R + G + B) ≥ 0.8 (linear) and (R − G − B) × 320 > 20. */
export function redness(r: number, g: number, b: number): { ratio: number; q: number } {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const sum = R + G + B;
  return { ratio: sum > 1e-6 ? R / sum : 0, q: Math.max(0, R - G - B) * 320 };
}

export function isSaturatedRedHex(hex: string): boolean {
  const [r, g, b] = parseHex(hex);
  const { ratio, q } = redness(r, g, b);
  return ratio >= 0.8 && q > 20;
}

// ---------------------------------------------------------------------------
// 3. Source-level safety
// ---------------------------------------------------------------------------

/** Audio reactivity ceiling in safe mode (beat flares, pulses). */
export const SAFE_MAX_REACTIVITY = 0.5;
/** …and for looks whose background or primary colour is a saturated red. */
export const SAFE_RED_REACTIVITY = 0.25;
/** Beat / onset pulses: at most this many a second in safe mode. */
export const SAFE_PULSE_HZ = 3;

export type TransitionKind = SectionDesign["transitionIn"];

/** flash and bloom (full-field white / bloom peaks) become fades in safe mode. */
export function safeTransition(kind: TransitionKind, safety: ActiveSafety): TransitionKind {
  if (!safety.on) return kind;
  return kind === "flash" || kind === "bloom" ? "fade" : kind;
}

/** The section's reactivity after the safe-mode clamp. */
export function safeReactivity(reactivity: number, colorway: readonly string[], safety: ActiveSafety): number {
  if (!safety.on) return reactivity;
  const red = safety.redProtect && colorway.slice(0, 2).some((c) => typeof c === "string" && isSaturatedRedHex(c));
  return Math.min(reactivity, red ? SAFE_RED_REACTIVITY : SAFE_MAX_REACTIVITY);
}

const TRANSITION_NAMES: Record<TransitionKind, string> = { cut: "硬切", fade: "淡入", flash: "閃白", wipe: "擦除", bloom: "光暈綻放" };

export interface SafetyChange {
  kind: "transition" | "reactivity" | "red" | "impact";
  text: string;
}

export interface SafetySectionReport {
  index: number;
  label: string;
  start: number;
  end: number;
  changes: SafetyChange[];
}

export interface SafetyReport {
  sections: SafetySectionReport[];
  /** song-wide notes (tempo) */
  notes: string[];
}

/**
 * Pre-show check: which sections safe mode changes, and how (the operator sees it in the design tab
 * and on the export page before the show). Uses the same rules as resolveLook / the lyric layer.
 */
export function safetyReport(plan: DesignPlan | null | undefined, safety: ActiveSafety, opts: { bpm?: number | null } = {}): SafetyReport {
  const sections: SafetySectionReport[] = [];
  const notes: string[] = [];
  if (!safety.on || !plan || !Array.isArray(plan.sections)) return { sections, notes };
  const impactLines = new Set((plan.lines ?? []).filter((l) => l?.styleOverride === "impact").map((l) => l.lineId));
  plan.sections.forEach((s, index) => {
    if (!s) return;
    const changes: SafetyChange[] = [];
    const t = safeTransition(s.transitionIn, safety);
    if (t !== s.transitionIn && index > 0) changes.push({ kind: "transition", text: `${TRANSITION_NAMES[s.transitionIn]}轉場改為${TRANSITION_NAMES[t]}` });
    const react = Number.isFinite(s.sceneParams?.audioReactivity) ? s.sceneParams.audioReactivity : 0.4;
    const colorway = Array.isArray(s.colorway) ? s.colorway : [];
    const safe = safeReactivity(react, colorway, safety);
    const red = safety.redProtect && colorway.slice(0, 2).some((c) => typeof c === "string" && isSaturatedRedHex(c));
    if (red) changes.push({ kind: "red", text: "大面積飽和紅色：減弱脈動，紅色閃爍另外計數" });
    if (safe < react - 1e-6) changes.push({ kind: "reactivity", text: `音樂反應 ${Math.round(react * 100)}% 降到 ${Math.round(safe * 100)}%，拍點脈動每秒最多 ${SAFE_PULSE_HZ} 次` });
    if (s.lyricStyle === "impact") changes.push({ kind: "impact", text: "巨字衝擊：字卡切換放慢，不隨拍點縮放" });
    if (changes.length) sections.push({ index, label: s.label || s.kind, start: s.start, end: s.end, changes });
  });
  if (impactLines.size && !plan.sections.some((s) => s?.lyricStyle === "impact")) notes.push(`有 ${impactLines.size} 行歌詞使用巨字衝擊：字卡切換放慢`);
  const bpm = opts.bpm ?? 0;
  if (bpm > SAFE_PULSE_HZ * 60) notes.push(`拍速 ${Math.round(bpm)} BPM 超過每秒 ${SAFE_PULSE_HZ} 拍：拍點脈動會隔拍觸發`);
  return { sections, notes };
}

/**
 * Rate-limits the beat pulse to SAFE_PULSE_HZ: a new rise may only start 1 / hz seconds after the
 * previous one began; a blocked rise holds the current level (it then decays). Deterministic in dt.
 */
export class PulseGate {
  private time = 0;
  private lastRiseAt = -Infinity;
  private rising = false;

  constructor(private readonly hz = SAFE_PULSE_HZ) {}

  reset() {
    this.time = 0;
    this.lastRiseAt = -Infinity;
    this.rising = false;
  }

  /** The target the pulse may follow this step, given its current value. `hold` forces it down. */
  gate(target: number, current: number, dt: number, hold = false): number {
    this.time += Math.max(0, Number.isFinite(dt) ? dt : 0);
    if (hold) {
      this.rising = false;
      return 0;
    }
    const wantsRise = target > current + 0.02;
    if (!wantsRise) {
      this.rising = false;
      return target;
    }
    if (this.rising) return target;
    if (this.time - this.lastRiseAt >= 1 / this.hz - 1e-9) {
      this.rising = true;
      this.lastRiseAt = this.time;
      return target;
    }
    return current;
  }
}

// ---------------------------------------------------------------------------
// 4. Flash detection and limiting
// ---------------------------------------------------------------------------

/** Thresholds (WCAG 2.3.1 general and red flash definitions, ITU-R BT.1702, Harding-style rules). */
export const FLASH = {
  /** a transition is a change of ≥ 10 % of the maximum relative luminance … */
  DELTA: 0.1,
  /** … where the darker state is below 0.80 */
  DARK_MAX: 0.8,
  /** red: (R − G − B) × 320 changes by more than 20 … */
  RED_Q: 20,
  /** … with R / (R + G + B) ≥ 0.8 in either state */
  RED_RATIO: 0.8,
  /** the "10° field of view": a window of 1/3 × 1/3 of the canvas (WCAG's 341 × 256 on 1024 × 768) */
  FIELD: 1 / 3,
  /** a flash needs ≥ 25 % of such a window changing together */
  AREA: 0.25,
  /** cells whose transitions fall within this time count as simultaneous */
  AGGREGATE_S: 0.1,
  /** the rolling window */
  WINDOW_S: 1,
  /** ≤ 3 flashes a second = ≤ 6 opposing transitions */
  MAX_TRANSITIONS: 6,
  /** the limiter engages at 4 displayed transitions (2 flashes), leaving margin for measurement lag */
  ENGAGE_TRANSITIONS: 4,
  /** every saturated-red transition counts as a red flash: ≤ 3 a second, engage at 2 */
  MAX_RED: 3,
  ENGAGE_RED: 2,
  /** temporal low-pass time constant while damping (a 10 Hz full-field strobe ripples < 0.08) */
  TAU_S: 1,
  /** damping holds this long after the last trigger, then releases over RELEASE_S */
  HOLD_S: 0.3,
  RELEASE_S: 0.6,
} as const;

/** The limiter's luminance grid for a canvas aspect: ~32 cells on the long side, square-ish cells. */
export function gridSize(aspect: number): { cols: number; rows: number } {
  const a = finite(aspect) && aspect > 0 ? aspect : 16 / 9;
  if (a >= 1) return { cols: 32, rows: Math.max(4, Math.min(32, Math.round(32 / a))) };
  return { cols: Math.max(4, Math.min(32, Math.round(32 * a))), rows: 32 };
}

export interface DetectorResult {
  /** a general transition registered this frame: +1 up, −1 down, 0 none */
  general: -1 | 0 | 1;
  /** a saturated-red transition registered this frame */
  red: boolean;
  /** largest fraction of a field window that changed together this frame (0..1) */
  area: number;
}

/**
 * Counts flashes over a grid of cells (relative luminance, and red measures). Each cell runs a
 * hysteresis extreme tracker; cells that complete a transition in the same direction within
 * AGGREGATE_S are summed over every FIELD × FIELD window (summed-area table); ≥ AREA of a window
 * registers one transition. Consecutive general transitions alternate (a flash = a pair).
 */
export class FlashDetector {
  readonly cols: number;
  readonly rows: number;
  private readonly n: number;
  private readonly winW: number;
  private readonly winH: number;
  private readonly dir: Int8Array;
  private readonly ext: Float32Array;
  private readonly lo: Float32Array;
  private readonly hi: Float32Array;
  private readonly upAt: Float64Array;
  private readonly downAt: Float64Array;
  private readonly rDir: Int8Array;
  private readonly rExt: Float32Array;
  private readonly rExtRatio: Float32Array;
  private readonly rLo: Float32Array;
  private readonly rHi: Float32Array;
  private readonly rLoRatio: Float32Array;
  private readonly rHiRatio: Float32Array;
  private readonly redUpAt: Float64Array;
  private readonly redDownAt: Float64Array;
  private readonly sat: Float32Array;
  private readonly mark: Float32Array;
  private primed = false;
  private lastDir: -1 | 0 | 1 = 0;
  private lastRedDir: -1 | 0 | 1 = 0;
  private events: number[] = [];
  private redEvents: number[] = [];

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
    this.n = this.cols * this.rows;
    this.winW = Math.max(1, Math.round(this.cols * FLASH.FIELD));
    this.winH = Math.max(1, Math.round(this.rows * FLASH.FIELD));
    const n = this.n;
    this.dir = new Int8Array(n);
    this.ext = new Float32Array(n);
    this.lo = new Float32Array(n);
    this.hi = new Float32Array(n);
    this.upAt = new Float64Array(n).fill(-Infinity);
    this.downAt = new Float64Array(n).fill(-Infinity);
    this.rDir = new Int8Array(n);
    this.rExt = new Float32Array(n);
    this.rExtRatio = new Float32Array(n);
    this.rLo = new Float32Array(n);
    this.rHi = new Float32Array(n);
    this.rLoRatio = new Float32Array(n);
    this.rHiRatio = new Float32Array(n);
    this.redUpAt = new Float64Array(n).fill(-Infinity);
    this.redDownAt = new Float64Array(n).fill(-Infinity);
    this.sat = new Float32Array((this.cols + 1) * (this.rows + 1));
    this.mark = new Float32Array(n);
  }

  /** General transitions within (t − WINDOW_S, t]. */
  transitions(t: number): number {
    this.prune(t);
    return this.events.length;
  }

  /** Saturated-red transitions within (t − WINDOW_S, t] (each one a red flash). */
  redTransitions(t: number): number {
    this.prune(t);
    return this.redEvents.length;
  }

  /** General flashes (pairs of opposing transitions) within the window. */
  flashes(t: number): number {
    return this.transitions(t) / 2;
  }

  private prune(t: number) {
    const from = t - FLASH.WINDOW_S;
    while (this.events.length && this.events[0] <= from + 1e-9) this.events.shift();
    while (this.redEvents.length && this.redEvents[0] <= from + 1e-9) this.redEvents.shift();
  }

  /** Largest share of any field window whose cells are marked (mark = 0 / 1). */
  private maxWindowShare(): number {
    const { cols, rows, winW, winH, sat, mark } = this;
    const w = cols + 1;
    for (let y = 0; y < rows; y++) {
      let rowSum = 0;
      for (let x = 0; x < cols; x++) {
        rowSum += mark[y * cols + x];
        sat[(y + 1) * w + (x + 1)] = sat[y * w + (x + 1)] + rowSum;
      }
    }
    let best = 0;
    for (let y = 0; y + winH <= rows; y++) {
      for (let x = 0; x + winW <= cols; x++) {
        const s = sat[(y + winH) * w + (x + winW)] - sat[y * w + (x + winW)] - sat[(y + winH) * w + x] + sat[y * w + x];
        if (s > best) best = s;
      }
    }
    return best / (winW * winH);
  }

  /**
   * One frame: `lum` = relative luminance per cell (row-major, top row first), `red` (optional) the
   * WCAG red measure q and ratio per cell.
   */
  push(t: number, lum: ArrayLike<number>, red?: { q: ArrayLike<number>; ratio: ArrayLike<number> } | null): DetectorResult {
    const n = this.n;
    const { DELTA, DARK_MAX, RED_Q, RED_RATIO, AGGREGATE_S, AREA } = FLASH;
    if (!this.primed) {
      this.primed = true;
      for (let i = 0; i < n; i++) {
        const L = lum[i] ?? 0;
        this.dir[i] = 0;
        this.lo[i] = L;
        this.hi[i] = L;
        this.ext[i] = L;
        if (red) {
          const q = red.q[i] ?? 0;
          const ratio = red.ratio[i] ?? 0;
          this.rDir[i] = 0;
          this.rLo[i] = q;
          this.rHi[i] = q;
          this.rLoRatio[i] = ratio;
          this.rHiRatio[i] = ratio;
        }
      }
      return { general: 0, red: false, area: 0 };
    }
    for (let i = 0; i < n; i++) {
      const L = lum[i] ?? 0;
      const d = this.dir[i];
      if (d === 0) {
        if (L < this.lo[i]) this.lo[i] = L;
        if (L > this.hi[i]) this.hi[i] = L;
        if (L - this.lo[i] >= DELTA && this.lo[i] < DARK_MAX) {
          this.dir[i] = 1;
          this.ext[i] = L;
          this.upAt[i] = t;
        } else if (this.hi[i] - L >= DELTA && L < DARK_MAX) {
          this.dir[i] = -1;
          this.ext[i] = L;
          this.downAt[i] = t;
        }
      } else if (d === 1) {
        if (L > this.ext[i]) this.ext[i] = L;
        else if (this.ext[i] - L >= DELTA && L < DARK_MAX) {
          this.dir[i] = -1;
          this.ext[i] = L;
          this.downAt[i] = t;
        }
      } else {
        if (L < this.ext[i]) this.ext[i] = L;
        else if (L - this.ext[i] >= DELTA && this.ext[i] < DARK_MAX) {
          this.dir[i] = 1;
          this.ext[i] = L;
          this.upAt[i] = t;
        }
      }
      if (red) {
        const q = red.q[i] ?? 0;
        const ratio = red.ratio[i] ?? 0;
        const rd = this.rDir[i];
        let fired = false;
        if (rd === 0) {
          if (q < this.rLo[i]) {
            this.rLo[i] = q;
            this.rLoRatio[i] = ratio;
          }
          if (q > this.rHi[i]) {
            this.rHi[i] = q;
            this.rHiRatio[i] = ratio;
          }
          if (q - this.rLo[i] > RED_Q && (ratio >= RED_RATIO || this.rLoRatio[i] >= RED_RATIO)) {
            this.rDir[i] = 1;
            fired = true;
          } else if (this.rHi[i] - q > RED_Q && (ratio >= RED_RATIO || this.rHiRatio[i] >= RED_RATIO)) {
            this.rDir[i] = -1;
            fired = true;
          }
        } else if (rd === 1) {
          if (q > this.rExt[i]) {
            this.rExt[i] = q;
            this.rExtRatio[i] = ratio;
          } else if (this.rExt[i] - q > RED_Q && (ratio >= RED_RATIO || this.rExtRatio[i] >= RED_RATIO)) {
            this.rDir[i] = -1;
            fired = true;
          }
        } else {
          if (q < this.rExt[i]) {
            this.rExt[i] = q;
            this.rExtRatio[i] = ratio;
          } else if (q - this.rExt[i] > RED_Q && (ratio >= RED_RATIO || this.rExtRatio[i] >= RED_RATIO)) {
            this.rDir[i] = 1;
            fired = true;
          }
        }
        if (fired) {
          this.rExt[i] = q;
          this.rExtRatio[i] = ratio;
          if (this.rDir[i] === 1) this.redUpAt[i] = t;
          else this.redDownAt[i] = t;
        }
      }
    }

    // area of simultaneous transitions per direction
    const recent = t - AGGREGATE_S - 1e-9;
    for (let i = 0; i < n; i++) this.mark[i] = this.upAt[i] > recent && this.upAt[i] >= this.downAt[i] ? 1 : 0;
    const upArea = this.maxWindowShare();
    for (let i = 0; i < n; i++) this.mark[i] = this.downAt[i] > recent && this.downAt[i] > this.upAt[i] ? 1 : 0;
    const downArea = this.maxWindowShare();
    let general: -1 | 0 | 1 = 0;
    const upOk = upArea >= AREA && this.lastDir !== 1;
    const downOk = downArea >= AREA && this.lastDir !== -1;
    if (upOk && downOk) general = upArea >= downArea ? 1 : -1;
    else if (upOk) general = 1;
    else if (downOk) general = -1;
    if (general !== 0) {
      this.lastDir = general;
      this.events.push(t);
    }

    let redEvent = false;
    let redArea = 0;
    if (red) {
      for (let i = 0; i < n; i++) this.mark[i] = this.redUpAt[i] > recent && this.redUpAt[i] >= this.redDownAt[i] ? 1 : 0;
      const rUp = this.maxWindowShare();
      for (let i = 0; i < n; i++) this.mark[i] = this.redDownAt[i] > recent && this.redDownAt[i] > this.redUpAt[i] ? 1 : 0;
      const rDown = this.maxWindowShare();
      redArea = Math.max(rUp, rDown);
      const upOkR = rUp >= AREA && this.lastRedDir !== 1;
      const downOkR = rDown >= AREA && this.lastRedDir !== -1;
      const dir: -1 | 0 | 1 = upOkR && downOkR ? (rUp >= rDown ? 1 : -1) : upOkR ? 1 : downOkR ? -1 : 0;
      if (dir !== 0) {
        this.lastRedDir = dir;
        this.redEvents.push(t);
        redEvent = true;
      }
    }
    this.prune(t);
    return { general, red: redEvent, area: Math.max(upArea, downArea, redArea) };
  }
}

/** The lyric layer's estimated contribution to the grid (the DOM text is not in the GL readback). */
export interface LyricEstimate {
  /** text bounds as fractions of the canvas, y down: x0, y0, x1, y1 */
  box: [number, number, number, number];
  /** displayed text colour, encoded 0..1 (already through transformRgb) */
  rgb: RGB;
  /** 0..1 share of the box covered by lit glyphs (ink density × visibility) */
  amount: number;
}

export interface LimiterStep {
  /** α used for this frame (1 = pass-through) */
  alpha: number;
  /** the limiter is damping */
  damping: boolean;
  /** displayed transitions / red transitions in the last second */
  transitions: number;
  redTransitions: number;
  /** source (what the design asked for) transitions / red in the last second */
  sourceTransitions: number;
  sourceRed: number;
  /** a new damping episode started with this frame */
  engaged: boolean;
}

export interface LimiterOptions {
  cols: number;
  rows: number;
  flashLimit: boolean;
  redProtect: boolean;
  /** encoded brightness multiplier the display applies after the low-pass */
  gain: number;
}

/** Lyric ink density assumed inside the measured text box. */
export const LYRIC_INK = 0.35;

/**
 * The flash limiter. `grid` values are the (softened) source frame per cell, encoded RGB 0..1, row
 * major with the top row first. The limiter keeps its own model of the displayed grid
 * (displayed = mix(displayed, source, α), exactly what the GL pass does per pixel), counts
 * transitions on the source and on the displayed grid, and decides α.
 *
 * - `step()` (zero lag: the frame's own grid is known before α is chosen): the offline export and
 *   the tests. Same frames in, same α out.
 * - `alphaFor()` + `observe()` (live: α must be chosen before the frame renders; its grid arrives
 *   1–2 frames later from an asynchronous readback). ENGAGE_TRANSITIONS leaves margin for that lag.
 */
export class FlashLimiter {
  readonly cols: number;
  readonly rows: number;
  private opts: LimiterOptions;
  private src: FlashDetector;
  private disp: FlashDetector;
  private model: Float32Array | null = null;
  private damp = 0;
  private lastTrig = -Infinity;
  private lastT: number | null = null;
  private episode = false;
  private readonly lum: Float32Array;
  private readonly q: Float32Array;
  private readonly ratio: Float32Array;
  private readonly eff: Float32Array;
  private lastStep: LimiterStep = { alpha: 1, damping: false, transitions: 0, redTransitions: 0, sourceTransitions: 0, sourceRed: 0, engaged: false };
  /** damping episodes so far */
  engagedCount = 0;

  constructor(opts: LimiterOptions) {
    this.opts = { ...opts };
    this.cols = Math.max(1, Math.floor(opts.cols));
    this.rows = Math.max(1, Math.floor(opts.rows));
    this.src = new FlashDetector(this.cols, this.rows);
    this.disp = new FlashDetector(this.cols, this.rows);
    const n = this.cols * this.rows;
    this.lum = new Float32Array(n);
    this.q = new Float32Array(n);
    this.ratio = new Float32Array(n);
    this.eff = new Float32Array(n * 3);
  }

  /** New settings (cap / switches) without forgetting the history. */
  configure(opts: Partial<Omit<LimiterOptions, "cols" | "rows">>) {
    this.opts = { ...this.opts, ...opts };
  }

  get damping(): boolean {
    return this.damp > 0;
  }

  get status(): LimiterStep {
    return this.lastStep;
  }

  /** The modelled displayed grid (encoded, before the cap), null before the first frame. */
  displayedGrid(): Float32Array | null {
    return this.model;
  }

  /** Forget the history (another project, a jump in the export). */
  reset() {
    this.src = new FlashDetector(this.cols, this.rows);
    this.disp = new FlashDetector(this.cols, this.rows);
    this.model = null;
    this.damp = 0;
    this.lastTrig = -Infinity;
    this.lastT = null;
    this.episode = false;
  }

  private get active(): boolean {
    return this.opts.flashLimit || this.opts.redProtect;
  }

  /** α for a frame of length dt (seconds) from the current state. */
  alphaFor(dt: number): number {
    if (!this.active || !this.model || this.damp <= 0) return 1;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (step <= 0) return 0;
    const tau = FLASH.TAU_S * this.damp;
    return 1 - Math.exp(-step / tau);
  }

  /** Per-cell luminance / red measures of an encoded grid after the cap, with the lyric estimate. */
  private measure(grid: ArrayLike<number>, lyric: LyricEstimate | null | undefined) {
    const { cols, rows } = this;
    const n = cols * rows;
    const gain = this.opts.gain;
    const eff = this.eff;
    for (let i = 0; i < n * 3; i++) eff[i] = grid[i] ?? 0;
    if (lyric && lyric.amount > 0.001) {
      const [x0, y0, x1, y1] = lyric.box;
      const cx0 = Math.max(0, Math.floor(x0 * cols));
      const cx1 = Math.min(cols - 1, Math.ceil(x1 * cols) - 1);
      const cy0 = Math.max(0, Math.floor(y0 * rows));
      const cy1 = Math.min(rows - 1, Math.ceil(y1 * rows) - 1);
      for (let y = cy0; y <= cy1; y++) {
        const oy = Math.max(0, Math.min(y1, (y + 1) / rows) - Math.max(y0, y / rows)) * rows;
        for (let x = cx0; x <= cx1; x++) {
          const ox = Math.max(0, Math.min(x1, (x + 1) / cols) - Math.max(x0, x / cols)) * cols;
          const c = Math.min(1, ox * oy * lyric.amount);
          if (c <= 0) continue;
          const i = (y * cols + x) * 3;
          // the lyric colour is already capped: undo the cap here, it is re-applied below
          eff[i] += (lyric.rgb[0] / gain - eff[i]) * c;
          eff[i + 1] += (lyric.rgb[1] / gain - eff[i + 1]) * c;
          eff[i + 2] += (lyric.rgb[2] / gain - eff[i + 2]) * c;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const r = eff[i * 3] * gain;
      const g = eff[i * 3 + 1] * gain;
      const b = eff[i * 3 + 2] * gain;
      const R = fastLinear(r);
      const G = fastLinear(g);
      const B = fastLinear(b);
      this.lum[i] = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      if (this.opts.redProtect) {
        const sum = R + G + B;
        this.q[i] = Math.max(0, R - G - B) * 320;
        this.ratio[i] = sum > 1e-6 ? R / sum : 0;
      }
    }
  }

  private pushSource(t: number, grid: ArrayLike<number>, lyric: LyricEstimate | null | undefined) {
    this.measure(grid, lyric);
    this.src.push(t, this.lum, this.opts.redProtect ? { q: this.q, ratio: this.ratio } : null);
  }

  private pushDisplayed(t: number, grid: ArrayLike<number>, alpha: number, lyric: LyricEstimate | null | undefined) {
    const n3 = this.cols * this.rows * 3;
    if (!this.model) {
      this.model = new Float32Array(n3);
      for (let i = 0; i < n3; i++) this.model[i] = grid[i] ?? 0;
    } else {
      const a = Math.min(1, Math.max(0, alpha));
      for (let i = 0; i < n3; i++) this.model[i] += ((grid[i] ?? 0) - this.model[i]) * a;
    }
    this.measure(this.model, lyric);
    this.disp.push(t, this.lum, this.opts.redProtect ? { q: this.q, ratio: this.ratio } : null);
  }

  private updateDamp(t: number): boolean {
    const o = this.opts;
    const trig =
      (o.flashLimit && (this.disp.transitions(t) >= FLASH.ENGAGE_TRANSITIONS || this.src.transitions(t) > FLASH.MAX_TRANSITIONS)) ||
      (o.redProtect && (this.disp.redTransitions(t) >= FLASH.ENGAGE_RED || this.src.redTransitions(t) > FLASH.MAX_RED));
    const dt = this.lastT == null ? 0 : Math.max(0, t - this.lastT);
    let engaged = false;
    if (trig) {
      if (!this.episode) {
        this.episode = true;
        this.engagedCount++;
        engaged = true;
      }
      this.damp = 1;
      this.lastTrig = t;
    } else if (t - this.lastTrig > FLASH.HOLD_S) {
      this.damp = Math.max(0, this.damp - dt / FLASH.RELEASE_S);
      if (this.damp <= 0) this.episode = false;
    }
    return engaged;
  }

  private finish(t: number, alpha: number, engaged: boolean): LimiterStep {
    this.lastT = t;
    this.lastStep = {
      alpha,
      damping: this.damp > 0,
      transitions: this.disp.transitions(t),
      redTransitions: this.disp.redTransitions(t),
      sourceTransitions: this.src.transitions(t),
      sourceRed: this.src.redTransitions(t),
      engaged,
    };
    return this.lastStep;
  }

  private passThrough(t: number, grid: ArrayLike<number>): LimiterStep {
    const n3 = this.cols * this.rows * 3;
    if (!this.model) this.model = new Float32Array(n3);
    for (let i = 0; i < n3; i++) this.model[i] = grid[i] ?? 0;
    this.damp = 0;
    return this.finish(t, 1, false);
  }

  /** Zero-lag frame (export, tests): measure the source, decide α, update the displayed model. */
  step(t: number, dt: number, grid: ArrayLike<number>, lyric?: LyricEstimate | null): LimiterStep {
    if (!this.active) return this.passThrough(t, grid);
    this.pushSource(t, grid, lyric);
    let engaged = this.updateDamp(t);
    const alpha = this.alphaFor(dt);
    this.pushDisplayed(t, grid, alpha, lyric);
    engaged = this.updateDamp(t) || engaged;
    return this.finish(t, alpha, engaged);
  }

  /** Live: the grid of a frame that was rendered with `alpha` (arrives after a readback lag). */
  observe(t: number, grid: ArrayLike<number>, alpha: number, lyric?: LyricEstimate | null): LimiterStep {
    if (!this.active) return this.passThrough(t, grid);
    if (this.lastT != null && t < this.lastT) return this.lastStep;
    this.pushSource(t, grid, lyric);
    this.pushDisplayed(t, grid, alpha, lyric);
    const engaged = this.updateDamp(t);
    return this.finish(t, alpha, engaged);
  }
}

/** Mean relative luminance of a grid (tests, diagnostics). */
export function meanLuminance(grid: ArrayLike<number>, cells: number, gain = 1): number {
  let s = 0;
  for (let i = 0; i < cells; i++) s += luminance(grid[i * 3] * gain, grid[i * 3 + 1] * gain, grid[i * 3 + 2] * gain);
  return cells > 0 ? s / cells : 0;
}

/**
 * Counts general flashes in a series of full-frame luminance samples (WCAG rule on one value per
 * frame): transitions of ≥ DELTA between extremes with the darker state below DARK_MAX; returns
 * the largest number of transitions in any WINDOW_S window, halved (= flashes). Used by the tests
 * and mirrored by the LED-safety e2e script.
 */
export function maxFlashesPerSecond(samples: ReadonlyArray<{ t: number; l: number }>): number {
  const events: number[] = [];
  let dir = 0;
  let lo = Infinity;
  let hi = -Infinity;
  let ext = 0;
  for (const { t, l } of samples) {
    if (dir === 0) {
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
      if (l - lo >= FLASH.DELTA && lo < FLASH.DARK_MAX) {
        dir = 1;
        ext = l;
        events.push(t);
      } else if (hi - l >= FLASH.DELTA && l < FLASH.DARK_MAX) {
        dir = -1;
        ext = l;
        events.push(t);
      }
    } else if (dir === 1) {
      if (l > ext) ext = l;
      else if (ext - l >= FLASH.DELTA && l < FLASH.DARK_MAX) {
        dir = -1;
        ext = l;
        events.push(t);
      }
    } else {
      if (l < ext) ext = l;
      else if (l - ext >= FLASH.DELTA && ext < FLASH.DARK_MAX) {
        dir = 1;
        ext = l;
        events.push(t);
      }
    }
  }
  let best = 0;
  let j = 0;
  for (let i = 0; i < events.length; i++) {
    while (events[i] - events[j] >= FLASH.WINDOW_S) j++;
    best = Math.max(best, i - j + 1);
  }
  return best / 2;
}
