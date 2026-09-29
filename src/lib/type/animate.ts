// How a composition moves at a moment: per glyph (opacity, offset, scale, rotation, how much of it
// is revealed), per piece (echo spread, slice amount) and the type pass' effect amounts. A pure
// function of the composition and a clock, so the live stage and the export (clock = song time)
// draw the same frame. Nothing here flashes: flicker stays under 3 Hz in LED 安全模式 and every
// large change is a ramp, and the GL flash limiter still measures the composited type.

import type { Composition, GlyphBox, Piece } from "./model";
import { hashUnit } from "./rng";
import { VOICES } from "./vocab";

export interface TypeClock {
  /** seconds since the entrance began (negative before it) */
  since: number;
  /** 0..1 exit progress, null while the line is not leaving */
  exit: number | null;
  /** song time (continuous motion phase) */
  t: number;
  beat: { phase: number; index: number; known: boolean };
  /** LED 安全模式 */
  safe: boolean;
  /** 0..1 motion amplitude for this line (the system's, or the section override) */
  intensity: number;
  /** 0..1 motion speed */
  speed: number;
}

export interface GlyphFrame {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  /** 0..1 of the glyph revealed along the reading direction (wipe / write) */
  reveal: number;
  /** reveal from the far end (an exit wipe erases in reading order) */
  revealFromEnd: boolean;
}

export interface PieceFrame {
  alpha: number;
  /** echo spread multiplier */
  spread: number;
  /** 0..1 slice displacement (撕裂, glitch) */
  slice: number;
  /** changes when the slices jump */
  sliceSeed: number;
}

export interface TypeUniforms {
  /** 0..1 glitch slices across the type */
  glitch: number;
  /** 0..1 ink bleed */
  bleed: number;
  /** 0..1 dry brush (飛白) */
  dry: number;
  /** 0..1 wobble */
  wobble: number;
  /** 0..1 RGB split */
  rgb: number;
  /** 0..1 grain */
  grain: number;
  /** 0..1 erosion by the scene */
  eat: number;
  /** 0..1 how much of the frame outside the window glyphs is filled */
  windowFill: number;
  /** 0..1 glow */
  glow: number;
  /** the spot plate is the seal colour (1) or a window mask (0) */
  seal: number;
  /** misregistered accent plate */
  overprint: number;
  /** changes when the glitch slices jump */
  seed: number;
  /** 0..1 vertical text dominates (dry-brush streak direction) */
  vertical: number;
}

export const ZERO_UNIFORMS: TypeUniforms = { glitch: 0, bleed: 0, dry: 0, wobble: 0, rgb: 0, grain: 0, eat: 0, windowFill: 0, glow: 0, seal: 0, overprint: 0, seed: 0, vertical: 0 };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x: number) => Math.pow(clamp01(x), 2);
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOutBack = (x: number) => {
  const t = clamp01(x);
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const TAU = Math.PI * 2;

/** Smooth value noise in [-1, 1] at time x (for flicker and wobble), deterministic per key. */
function smoothNoise(x: number, key: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashUnit(`${key}|${i}`) * 2 - 1;
  const b = hashUnit(`${key}|${i + 1}`) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

/** A glitch stutter lands on this beat (seeded, never on two beats in a row; rarer in safe mode). */
export function stutterOn(comp: Composition, beatIndex: number, safe: boolean): boolean {
  if (comp.voice !== "glitch") return false;
  const every = safe ? 4 : 2;
  if (beatIndex % every !== 0) return false;
  return hashUnit(`stutter|${comp.key}|${beatIndex}`) < (safe ? 0.5 : 0.62);
}

function stutterAmount(comp: Composition, c: TypeClock): number {
  if (!c.beat.known || c.since < 0) return 0;
  if (!stutterOn(comp, c.beat.index, c.safe)) return 0;
  const window = 0.14;
  return c.beat.phase < window ? 1 - c.beat.phase / window : 0;
}

/** Entrance start of glyph `i` of `piece` (seconds after the composition's entrance). */
function glyphStart(comp: Composition, piece: Piece, g: GlyphBox, i: number, n: number): number {
  const dur = comp.enterDur;
  const base = piece.delay * Math.max(0.4, dur / 0.6);
  switch (comp.enter) {
    case "cut":
      return 0;
    case "write":
      // writing order follows the singing, a little ahead of it
      return g.unit >= 0 ? Math.max(0, g.t0 * 0.85) + base * 0.3 : base;
    case "wipe":
      return base + (n > 1 ? (i / n) * dur * 0.55 : 0);
    case "fall":
    case "rise":
      return base + i * Math.min(0.07, (dur * 0.6) / Math.max(1, n));
    case "scale":
    case "glitch":
      return base + i * 0.012;
    default:
      return base + i * Math.min(0.03, (dur * 0.4) / Math.max(1, n));
  }
}

function glyphDuration(comp: Composition): number {
  switch (comp.enter) {
    case "cut":
      return 0.001;
    case "write":
      return comp.voice === "ink" ? 0.32 : 0.22;
    case "wipe":
      return comp.enterDur * 0.45;
    default:
      return comp.enterDur;
  }
}

/** The whole-piece state at this moment. */
export function pieceFrame(comp: Composition, piece: Piece, c: TypeClock): PieceFrame {
  const enter = clamp01((c.since - piece.delay) / Math.max(0.05, comp.enterDur));
  const x = c.exit ?? 0;
  const st = stutterAmount(comp, c);
  let spread = 1;
  if (piece.echo) {
    spread = easeOut(enter) * (1 + 0.1 * Math.sin(TAU * c.t * 0.45)) * (1 + x * 0.7) * (1 + st * 0.35);
  }
  let slice = 0;
  if (piece.slices) {
    const idle = Math.max(0.08 + 0.05 * Math.sin(TAU * c.t * 0.21), piece.tear ?? 0);
    slice = clamp01(idle + (1 - enter) * 0.9 + st * 0.45 + x * 0.8) * (c.safe ? 0.7 : 1);
  }
  return { alpha: piece.alpha, spread, slice, sliceSeed: c.beat.known ? c.beat.index : Math.floor(c.t * 2) };
}

/** One glyph's state at this moment (writes into `out`). */
export function glyphFrame(comp: Composition, piece: Piece, g: GlyphBox, i: number, c: TypeClock, out: GlyphFrame): GlyphFrame {
  const n = piece.glyphs.length;
  const size = g.size;
  out.alpha = 1;
  out.dx = 0;
  out.dy = 0;
  out.scale = 1;
  out.rotate = 0;
  out.reveal = 1;
  out.revealFromEnd = false;
  const start = glyphStart(comp, piece, g, i, n);
  const p = clamp01((c.since - start) / glyphDuration(comp));
  if (c.since < start) {
    out.alpha = 0;
    out.reveal = 0;
    return out;
  }
  switch (comp.enter) {
    case "cut":
      break;
    case "fade":
      out.alpha = easeOut(p);
      break;
    case "rise":
      out.alpha = easeOut(p);
      out.dy = (1 - easeOut(p)) * 0.42 * size;
      break;
    case "fall":
      out.alpha = clamp01(p * 2.4);
      out.dy = -(1 - easeOutBack(p)) * 0.9 * size;
      break;
    case "wipe":
    case "write":
      out.reveal = comp.enter === "write" ? easeOut(p) : easeInOut(p);
      break;
    case "scale":
      out.alpha = easeOut(p);
      out.scale = 1 + 0.32 * (1 - easeOut(p));
      break;
    case "glitch": {
      out.alpha = 0.4 + 0.6 * easeOut(p);
      const step = Math.floor(c.since * 18);
      out.dx = (hashUnit(`gx|${comp.key}|${g.order}|${step}`) - 0.5) * 0.5 * size * (1 - p);
      break;
    }
    case "bloom":
      out.alpha = easeOut(p);
      out.scale = 1 + 0.07 * (1 - easeOut(p));
      break;
  }

  // hold motion, ramping in with the entrance
  const v = VOICES[comp.voice];
  const amp = clamp01(c.intensity) * v.motionScale * (0.6 + 0.6 * comp.energy) * easeOut(p);
  const sp = (0.55 + 0.95 * clamp01(c.speed)) * v.speedScale;
  const hold = Math.max(0, c.since - comp.enterDur);
  const k = g.order;
  if (amp > 0) {
    switch (comp.motion) {
      case "drift":
        out.dx += amp * 0.16 * size * Math.sin(TAU * (c.t * 0.11 * sp + k * 0.07));
        out.dy += amp * 0.07 * size * Math.sin(TAU * (c.t * 0.07 * sp + k * 0.11) + 1);
        out.rotate += amp * 0.035 * Math.sin(TAU * (c.t * 0.09 * sp + k * 0.13));
        break;
      case "fall":
        out.dy += amp * size * Math.min(0.32, 0.05 * hold * sp);
        break;
      case "flicker": {
        const hz = c.safe ? 1.6 : 3.2;
        out.alpha *= 1 - amp * (c.safe ? 0.16 : 0.3) * (0.5 + 0.5 * smoothNoise(c.t * hz * sp, k + 17));
        break;
      }
      case "pulse": {
        const beat = c.beat.known ? Math.exp(-c.beat.phase * 7) : 0.5 + 0.5 * Math.sin(TAU * c.t * 1.6);
        out.scale *= 1 + amp * (c.safe ? 0.035 : 0.065) * beat;
        break;
      }
      case "wave":
        out.dy += amp * 0.17 * size * Math.sin(TAU * (c.t * 0.38 * sp - k * 0.09));
        break;
      case "rise":
        out.dy -= amp * size * Math.min(0.28, 0.04 * hold * sp);
        out.alpha *= Math.min(1, 0.62 + 0.38 * Math.min(1, hold / 1.3));
        break;
      case "bloom":
        out.scale *= 1 + amp * 0.018 * Math.sin(TAU * c.t * 0.3 * sp);
        break;
      case "shatter":
        out.rotate += amp * 0.06 * Math.sin(TAU * (c.t * 0.3 * sp + k * 0.37));
        out.dx += amp * 0.05 * size * Math.sin(TAU * (c.t * 0.23 * sp + k * 0.19));
        break;
      case "rush":
        out.dx += amp * 0.09 * size * Math.sin(TAU * c.t * 0.25 * sp);
        out.scale *= 1 + amp * Math.min(0.05, 0.012 * hold);
        break;
      case "spin":
        out.rotate += amp * 0.08 * Math.sin(TAU * (c.t * 0.08 * sp + k * 0.05));
        break;
      default:
        break;
    }
  }
  const st = stutterAmount(comp, c);
  if (st > 0) {
    const q = hashUnit(`st|${comp.key}|${c.beat.index}|${k}`) - 0.5;
    out.dx += q * (c.safe ? 0.08 : 0.16) * size * st;
  }

  // the exit
  const x = c.exit;
  if (x != null && x > 0) {
    switch (comp.exit) {
      case "cut":
        out.alpha = 0;
        break;
      case "fade":
        out.alpha *= Math.pow(1 - clamp01(x), 1.6);
        break;
      case "sink":
        out.alpha *= Math.pow(1 - clamp01(x), 1.4);
        out.dy += easeIn(x) * (comp.motion === "fall" ? 0.9 : 0.45) * size;
        break;
      case "wipe": {
        const xi = clamp01(x * 1.6 - (n > 1 ? (i / n) * 0.6 : 0));
        out.reveal = Math.min(out.reveal, 1 - easeInOut(xi));
        out.revealFromEnd = true;
        break;
      }
      case "dissolve":
        out.alpha *= Math.pow(1 - clamp01(x), 1.2);
        out.scale *= 1 + 0.04 * x;
        break;
      case "scale":
        out.alpha *= 1 - easeOut(x);
        out.scale *= 1 - 0.18 * x;
        break;
      case "glitch": {
        out.alpha *= 1 - easeOut(x);
        const step = Math.floor(x * 12);
        out.dx += (hashUnit(`gxo|${comp.key}|${k}|${step}`) - 0.5) * 0.5 * size * x;
        break;
      }
      case "blur":
        out.alpha *= Math.pow(1 - clamp01(x), 1.4);
        out.scale *= 1 + 0.05 * x;
        break;
    }
  }
  return out;
}

/** The type pass amounts one composition asks for (the layer takes the max over what is on screen). */
export function compositionUniforms(comp: Composition, c: TypeClock, texture: number, overprint: boolean): TypeUniforms {
  const tex = clamp01(texture);
  const enter = clamp01(c.since / Math.max(0.05, comp.enterDur));
  const x = clamp01(c.exit ?? 0);
  const present = c.since >= 0 ? easeOut(enter) * (1 - x) : 0;
  const st = stutterAmount(comp, c);
  const u: TypeUniforms = { ...ZERO_UNIFORMS };
  u.grain = tex * 0.45 * present;
  u.vertical = comp.pieces.some((p) => p.readable && p.vertical) ? 1 : 0;
  switch (comp.voice) {
    case "ink":
      u.bleed = (0.25 + 0.75 * tex) * present;
      u.dry = tex * 0.85 * present;
      u.wobble = tex * 0.55 * present;
      u.eat = comp.exit === "dissolve" ? x : 0;
      break;
    case "glitch": {
      // the entrance and the exit may tear the line apart; a stutter while it holds only shakes it (it must still read)
      const spike = Math.max(comp.enter === "glitch" ? 1 - enter : 0, comp.exit === "glitch" ? x : 0, st * 0.5);
      u.glitch = clamp01(tex * 0.18 + spike * 0.85) * (c.safe ? 0.75 : 1) * (c.since >= 0 ? 1 : 0);
      u.rgb = clamp01(0.25 + tex * 0.35 + spike * 0.5) * present;
      u.eat = clamp01(tex * 0.08 + spike * 0.24) * present;
      break;
    }
    case "title-sequence":
      u.wobble = 0;
      break;
    default:
      u.bleed = tex * 0.2 * present;
      break;
  }
  if (overprint) {
    u.overprint = present;
    u.rgb = Math.max(u.rgb, 0.12 * present);
  }
  if (comp.enter === "bloom") u.glow = (1 - enter) * 0.9 * (c.since >= 0 ? 1 : 0);
  if (comp.motion === "bloom") u.glow = Math.max(u.glow, (0.22 + 0.08 * Math.sin(TAU * c.t * 0.3)) * present);
  if (comp.window) u.windowFill = c.since >= 0 ? clamp01(comp.windowFill ?? 1) * easeInOut(clamp01(c.since / Math.max(0.3, comp.enterDur))) * (1 - easeInOut(x)) : 0;
  if (comp.seal) u.seal = 1;
  u.seed = c.beat.known ? c.beat.index : Math.floor(c.t * 3);
  return u;
}

/** Combine the amounts of everything on screen (strongest wins; the seal only when no window shows). */
export function mergeUniforms(list: readonly TypeUniforms[]): TypeUniforms {
  if (!list.length) return { ...ZERO_UNIFORMS };
  const out: TypeUniforms = { ...ZERO_UNIFORMS };
  for (const u of list) {
    for (const k of Object.keys(out) as Array<keyof TypeUniforms>) out[k] = Math.max(out[k], u[k]);
  }
  if (out.windowFill > 0.001) out.seal = 0;
  return out;
}
