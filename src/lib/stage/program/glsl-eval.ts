// 專屬畫面 (round 12): a CPU evaluator for the scene-program subset of GLSL ES 1.00, so the server
// (which has no GL) can look at what a program paints — the luminance probe (probe.ts) renders a
// low-resolution frame per section state through it. Pure, deterministic, no allocation outside
// the frame being evaluated.
//
// Supported: float / int / bool scalars, vec2–4, mat2–4; const and global declarations; functions
// with in / out / inout parameters; if / else, the validator's `for` loops with break / continue,
// return; swizzles (read and write), indexing, constructors with GLSL's flattening rules, the
// common built-ins (trig, exp, common, geometric, mix / step / smoothstep, matrixCompMult), the
// prelude's helpers natively (hash, noise, fbm, sdf, zone and type masks: the type and motif
// samplers read as empty, as they do with no lyric on screen). Numbers are doubles, so hashes
// and noise differ in detail from the GPU's floats; the statistics a probe needs do not.
//
// What it refuses (an exception with a 繁中 message, which the probe reports as 「無法評估」, never
// as a failure of the program): structs, arrays, matrices of other sizes, unknown functions.

import { PRELUDE_NAMES } from "./contract";

// ---------------------------------------------------------------------------
// values
// ---------------------------------------------------------------------------

/** A matrix: n × n, column-major like GLSL. */
export class Mat {
  constructor(
    public readonly n: number,
    public readonly a: number[],
  ) {}
}
export type Value = number | boolean | number[] | Mat;

export interface Uniforms {
  uRes: [number, number];
  uTime: number;
  uClock: number;
  uSongTime: number;
  uSongProgress: number;
  uSeed: number;
  uBeat: number;
  uBeatN: number;
  uBar: number;
  uTempo: number;
  uPulse: number;
  uEnergy: number;
  uLevel: number;
  uBass: number;
  uOnset: number;
  uIntensity: number;
  uMaster: number;
  uReact: number;
  uSection: number;
  uSectionKind: number;
  uSectionEnergy: number;
  uSectionProgress: number;
  uMode: number;
  uParams: [number, number, number, number];
  uBg: [number, number, number];
  uPri: [number, number, number];
  uAcc: [number, number, number];
  uInk: [number, number, number];
  uPal: Array<[number, number, number]>;
  uZone: [number, number, number, number];
  uRelation: number;
  uTypeBox: [number, number, number, number];
  uTypeAmt: number;
}

class GlslError extends Error {}
function fail(msg: string): never {
  throw new GlslError(msg);
}

// ---------------------------------------------------------------------------
// tokenizer
// ---------------------------------------------------------------------------

type Tok = { k: "id" | "num" | "op"; v: string; line: number };

const OPS2 = ["++", "--", "+=", "-=", "*=", "/=", "==", "!=", "<=", ">=", "&&", "||", "^^"];
const OPS1 = "{}()[];,.+-*/<>=!?:";

function tokenize(code: string): Tok[] {
  const toks: Tok[] = [];
  let line = 1;
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < code.length && /[A-Za-z0-9_]/.test(code[j])) j++;
      toks.push({ k: "id", v: code.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(code[i + 1] ?? ""))) {
      const m = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(code.slice(i));
      const v = m ? m[0] : c;
      toks.push({ k: "num", v, line });
      i += v.length;
      continue;
    }
    const two = code.slice(i, i + 2);
    const op = OPS2.includes(two) ? two : OPS1.includes(c) ? c : null;
    if (!op) fail(`第 ${line} 行：無法評估的字元「${c}」`);
    toks.push({ k: "op", v: op as string, line });
    i += (op as string).length;
  }
  return toks;
}

// ---------------------------------------------------------------------------
// parser → closures
// ---------------------------------------------------------------------------

type Frame = Value[] & { ret?: Value };
type Expr = (f: Frame) => Value;
type LValue = { get: Expr; set: (f: Frame, v: Value) => void };
/** 0 normal, 1 break, 2 continue, 3 return */
type Stmt = (f: Frame) => number;

interface FnDef {
  params: Array<{ slot: number; qual: "in" | "out" | "inout" }>;
  body: Stmt | null;
  nslots: number;
}

const TYPES = new Set(["void", "bool", "int", "float", "vec2", "vec3", "vec4", "bvec2", "bvec3", "bvec4", "ivec2", "ivec3", "ivec4", "mat2", "mat3", "mat4"]);
const SWZ: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };

const isVec = (v: Value): v is number[] => Array.isArray(v);
const num = (v: Value, what = "數值"): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return fail(`需要${what}，拿到向量或矩陣`);
};
const bool = (v: Value): boolean => (typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : fail("條件必須是 bool"));
const clone = (v: Value): Value => (isVec(v) ? v.slice() : v instanceof Mat ? new Mat(v.n, v.a.slice()) : v);

/** Component-wise map with scalar broadcasting over one or two arguments. */
function map1(a: Value, fn: (x: number) => number): Value {
  if (isVec(a)) {
    const o = new Array<number>(a.length);
    for (let i = 0; i < a.length; i++) o[i] = fn(a[i]);
    return o;
  }
  if (a instanceof Mat) return new Mat(a.n, a.a.map(fn));
  return fn(num(a));
}
function map2(a: Value, b: Value, fn: (x: number, y: number) => number): Value {
  if (isVec(a)) {
    const o = new Array<number>(a.length);
    if (isVec(b)) {
      if (b.length !== a.length) fail("向量長度不一致");
      for (let i = 0; i < a.length; i++) o[i] = fn(a[i], b[i]);
    } else {
      const s = num(b);
      for (let i = 0; i < a.length; i++) o[i] = fn(a[i], s);
    }
    return o;
  }
  if (isVec(b)) {
    const s = num(a);
    const o = new Array<number>(b.length);
    for (let i = 0; i < b.length; i++) o[i] = fn(s, b[i]);
    return o;
  }
  if (a instanceof Mat) {
    if (b instanceof Mat) return new Mat(a.n, a.a.map((x, i) => fn(x, b.a[i])));
    const s = num(b);
    return new Mat(a.n, a.a.map((x) => fn(x, s)));
  }
  if (b instanceof Mat) {
    const s = num(a);
    return new Mat(b.n, b.a.map((x) => fn(s, x)));
  }
  return fn(num(a), num(b));
}
function map3(a: Value, b: Value, c: Value, fn: (x: number, y: number, z: number) => number): Value {
  const n = isVec(a) ? a.length : isVec(b) ? b.length : isVec(c) ? c.length : 0;
  if (!n) return fn(num(a), num(b), num(c));
  const o = new Array<number>(n);
  for (let i = 0; i < n; i++) o[i] = fn(isVec(a) ? a[i] : num(a), isVec(b) ? b[i] : num(b), isVec(c) ? c[i] : num(c));
  return o;
}

function mul(a: Value, b: Value): Value {
  if (a instanceof Mat && isVec(b)) {
    const n = a.n;
    if (b.length !== n) fail("矩陣與向量大小不符");
    const o = new Array<number>(n).fill(0);
    for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) o[r] += a.a[c * n + r] * b[c];
    return o;
  }
  if (isVec(a) && b instanceof Mat) {
    const n = b.n;
    if (a.length !== n) fail("矩陣與向量大小不符");
    const o = new Array<number>(n).fill(0);
    for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) o[c] += a[r] * b.a[c * n + r];
    return o;
  }
  if (a instanceof Mat && b instanceof Mat) {
    const n = a.n;
    const o = new Array<number>(n * n).fill(0);
    for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) o[c * n + r] += a.a[k * n + r] * b.a[c * n + k];
    return new Mat(n, o);
  }
  return map2(a, b, (x, y) => x * y);
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mod = (x: number, y: number): number => x - y * Math.floor(x / y);
const vlen = (v: number[]): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const vdot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0);
const asVec = (v: Value, what: string): number[] => (isVec(v) ? v : fail(`${what} 需要向量`));

/** Flatten constructor arguments to scalars. */
function flat(args: Value[]): number[] {
  const o: number[] = [];
  for (const a of args) {
    if (isVec(a)) o.push(...a);
    else if (a instanceof Mat) o.push(...a.a);
    else o.push(num(a));
  }
  return o;
}

function construct(type: string, args: Value[]): Value {
  switch (type) {
    case "float":
      return num(args[0] ?? 0);
    case "int": {
      const x = num(args[0] ?? 0);
      return x < 0 ? Math.ceil(x) : Math.floor(x);
    }
    case "bool":
      return bool(args[0] ?? false);
    case "vec2":
    case "vec3":
    case "vec4":
    case "ivec2":
    case "ivec3":
    case "ivec4":
    case "bvec2":
    case "bvec3":
    case "bvec4": {
      const n = Number(type[type.length - 1]);
      if (args.length === 1 && !isVec(args[0]) && !(args[0] instanceof Mat)) return new Array<number>(n).fill(num(args[0]));
      const s = flat(args);
      if (s.length < n) fail(`${type} 的參數不夠`);
      return s.slice(0, n);
    }
    case "mat2":
    case "mat3":
    case "mat4": {
      const n = Number(type[3]);
      const o = new Array<number>(n * n).fill(0);
      if (args.length === 1 && args[0] instanceof Mat) {
        const m = args[0];
        for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) o[c * n + r] = c < m.n && r < m.n ? m.a[c * m.n + r] : c === r ? 1 : 0;
        return new Mat(n, o);
      }
      if (args.length === 1 && !isVec(args[0])) {
        const d = num(args[0]);
        for (let i = 0; i < n; i++) o[i * n + i] = d;
        return new Mat(n, o);
      }
      const s = flat(args);
      if (s.length < n * n) fail(`${type} 的參數不夠`);
      for (let i = 0; i < n * n; i++) o[i] = s[i];
      return new Mat(n, o);
    }
    default:
      return fail(`無法評估的型別 ${type}`);
  }
}

type Builtin = (args: Value[]) => Value;

const BUILTINS: Record<string, Builtin> = {
  radians: ([a]) => map1(a, (x) => (x * Math.PI) / 180),
  degrees: ([a]) => map1(a, (x) => (x * 180) / Math.PI),
  sin: ([a]) => map1(a, Math.sin),
  cos: ([a]) => map1(a, Math.cos),
  tan: ([a]) => map1(a, Math.tan),
  asin: ([a]) => map1(a, Math.asin),
  acos: ([a]) => map1(a, Math.acos),
  atan: (args) => (args.length === 2 ? map2(args[0], args[1], Math.atan2) : map1(args[0], Math.atan)),
  pow: ([a, b]) => map2(a, b, (x, y) => Math.pow(x, y)),
  exp: ([a]) => map1(a, Math.exp),
  log: ([a]) => map1(a, Math.log),
  exp2: ([a]) => map1(a, (x) => Math.pow(2, x)),
  log2: ([a]) => map1(a, Math.log2),
  sqrt: ([a]) => map1(a, Math.sqrt),
  inversesqrt: ([a]) => map1(a, (x) => 1 / Math.sqrt(x)),
  abs: ([a]) => map1(a, Math.abs),
  sign: ([a]) => map1(a, Math.sign),
  floor: ([a]) => map1(a, Math.floor),
  ceil: ([a]) => map1(a, Math.ceil),
  fract: ([a]) => map1(a, (x) => x - Math.floor(x)),
  mod: ([a, b]) => map2(a, b, mod),
  min: ([a, b]) => map2(a, b, Math.min),
  max: ([a, b]) => map2(a, b, Math.max),
  clamp: ([a, b, c]) => map3(a, b, c, (x, lo, hi) => Math.min(hi, Math.max(lo, x))),
  mix: ([a, b, c]) => map3(a, b, c, (x, y, t) => x + (y - x) * t),
  step: ([a, b]) => map2(a, b, (e, x) => (x < e ? 0 : 1)),
  smoothstep: ([a, b, c]) => map3(a, b, c, smooth),
  length: ([a]) => (isVec(a) ? vlen(a) : Math.abs(num(a))),
  distance: ([a, b]) => (isVec(a) && isVec(b) ? vlen(a.map((x, i) => x - b[i])) : Math.abs(num(a) - num(b))),
  dot: ([a, b]) => (isVec(a) && isVec(b) ? vdot(a, b) : num(a) * num(b)),
  cross: ([a, b]) => {
    const u = asVec(a, "cross");
    const v = asVec(b, "cross");
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  },
  normalize: ([a]) => {
    if (!isVec(a)) return Math.sign(num(a));
    const l = vlen(a) || 1;
    return a.map((x) => x / l);
  },
  faceforward: ([n, i, nref]) => (vdot(asVec(nref, "faceforward"), asVec(i, "faceforward")) < 0 ? clone(n) : map1(n, (x) => -x)),
  reflect: ([i, n]) => {
    const I = asVec(i, "reflect");
    const N = asVec(n, "reflect");
    const d = 2 * vdot(N, I);
    return I.map((x, k) => x - d * N[k]);
  },
  refract: ([i, n, e]) => {
    const I = asVec(i, "refract");
    const N = asVec(n, "refract");
    const eta = num(e);
    const d = vdot(N, I);
    const k = 1 - eta * eta * (1 - d * d);
    if (k < 0) return I.map(() => 0);
    const s = eta * d + Math.sqrt(k);
    return I.map((x, j) => eta * x - s * N[j]);
  },
  matrixCompMult: ([a, b]) => map2(a, b, (x, y) => x * y),
  lessThan: ([a, b]) => map2(a, b, (x, y) => (x < y ? 1 : 0)),
  lessThanEqual: ([a, b]) => map2(a, b, (x, y) => (x <= y ? 1 : 0)),
  greaterThan: ([a, b]) => map2(a, b, (x, y) => (x > y ? 1 : 0)),
  greaterThanEqual: ([a, b]) => map2(a, b, (x, y) => (x >= y ? 1 : 0)),
  equal: ([a, b]) => map2(a, b, (x, y) => (x === y ? 1 : 0)),
  notEqual: ([a, b]) => map2(a, b, (x, y) => (x !== y ? 1 : 0)),
  any: ([a]) => asVec(a, "any").some((x) => x !== 0),
  all: ([a]) => asVec(a, "all").every((x) => x !== 0),
  not: ([a]) => map1(a, (x) => (x ? 0 : 1)),
};

// ---------------------------------------------------------------------------
// the prelude, natively
// ---------------------------------------------------------------------------

const fract = (x: number) => x - Math.floor(x);
function hash11(p: number): number {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
function hash12(x: number, y: number): number {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}
function hash22(x: number, y: number): number[] {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.103);
  let c = fract(x * 0.0973);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return [fract((a + b) * c), fract((a + c) * b)];
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash12(ix, iy);
  const b = hash12(ix + 1, iy);
  const c = hash12(ix, iy + 1);
  const d = hash12(ix + 1, iy + 1);
  const m1 = a + (b - a) * ux;
  const m2 = c + (d - c) * ux;
  return m1 + (m2 - m1) * uy;
}
function fbmN(x: number, y: number, n: number, norm: number): number {
  let v = 0;
  let a = 0.5;
  for (let i = 0; i < n; i++) {
    v += a * vnoise(x, y);
    const nx = 1.6 * x + -1.2 * y + 3.7;
    const ny = 1.2 * x + 1.6 * y + 3.7;
    x = nx;
    y = ny;
    a *= 0.5;
  }
  return v / norm;
}

function preludeBuiltins(u: Uniforms): Record<string, Builtin> {
  const minRes = Math.min(u.uRes[0], u.uRes[1]);
  const pxv = 1.5 / minRes;
  const sat = (x: number) => Math.min(1, Math.max(0, x));
  const mix3 = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
  const zone = (uv: number[], soft: number, lo: number[], hi: number[]): number => {
    const ax = smooth(lo[0] - soft, lo[0] + soft, uv[0]);
    const ay = smooth(lo[1] - soft, lo[1] + soft, uv[1]);
    const bx = 1 - smooth(hi[0] - soft, hi[0] + soft, uv[0]);
    const by = 1 - smooth(hi[1] - soft, hi[1] + soft, uv[1]);
    return ax * ay * bx * by;
  };
  return {
    sat: ([a]) => map1(a, sat),
    rot: ([a]) => {
      const t = num(a);
      const c = Math.cos(t);
      const s = Math.sin(t);
      // mat2(c, -s, s, c): column 0 = (c, -s), column 1 = (s, c)
      return new Mat(2, [c, -s, s, c]);
    },
    hash11: ([a]) => hash11(num(a)),
    hash12: ([a]) => {
      const p = asVec(a, "hash12");
      return hash12(p[0], p[1]);
    },
    hash22: ([a]) => {
      const p = asVec(a, "hash22");
      return hash22(p[0], p[1]);
    },
    vnoise: ([a]) => {
      const p = asVec(a, "vnoise");
      return vnoise(p[0], p[1]);
    },
    fbm: ([a]) => {
      const p = asVec(a, "fbm");
      return fbmN(p[0], p[1], 5, 0.96875);
    },
    fbm3: ([a]) => {
      const p = asVec(a, "fbm3");
      return fbmN(p[0], p[1], 3, 0.875);
    },
    centered: ([a]) => {
      const fc = asVec(a, "centered");
      return [(fc[0] - 0.5 * u.uRes[0]) / minRes, (fc[1] - 0.5 * u.uRes[1]) / minRes];
    },
    aspect: () => u.uRes[0] / u.uRes[1],
    px: () => pxv,
    luma: ([a]) => {
      const c = asVec(a, "luma");
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    },
    ramp: ([a]) => {
      const t = sat(num(a));
      const c = mix3(u.uBg, u.uPri, smooth(0, 0.62, t));
      return mix3(c, u.uAcc, smooth(0.58, 1, t));
    },
    palette: ([a]) => {
      const t = sat(num(a)) * 5;
      let c = mix3(u.uPal[0], u.uPal[1], sat(t));
      c = mix3(c, u.uPal[2], sat(t - 1));
      c = mix3(c, u.uPal[3], sat(t - 2));
      c = mix3(c, u.uPal[4], sat(t - 3));
      return mix3(c, u.uPal[5], sat(t - 4));
    },
    fill: ([a]) => 1 - smooth(-pxv, pxv, num(a)),
    stroke: ([a, b]) => {
      const w = num(b);
      return 1 - smooth(w - pxv, w + pxv, Math.abs(num(a)));
    },
    sdCircle: ([a, b]) => vlen(asVec(a, "sdCircle")) - num(b),
    sdBox: ([a, b]) => {
      const p = asVec(a, "sdBox");
      const bb = asVec(b, "sdBox");
      const dx = Math.abs(p[0]) - bb[0];
      const dy = Math.abs(p[1]) - bb[1];
      return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
    },
    sdSegment: ([p0, a0, b0]) => {
      const p = asVec(p0, "sdSegment");
      const a = asVec(a0, "sdSegment");
      const b = asVec(b0, "sdSegment");
      const pa = [p[0] - a[0], p[1] - a[1]];
      const ba = [b[0] - a[0], b[1] - a[1]];
      const h = sat(vdot(pa, ba) / Math.max(vdot(ba, ba), 1e-6));
      return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h);
    },
    grain: ([a, b]) => {
      const fc = asVec(a, "grain");
      return (hash12(fc[0] * 0.9173 + fract(u.uClock * 7.13) * 517, fc[1] * 0.9173 + fract(u.uClock * 3.71) * 389) - 0.5) * num(b);
    },
    kick: () => u.uPulse * u.uReact,
    isSection: ([a]) => (Math.abs(u.uSectionKind - num(a)) < 0.5 ? 1 : 0),
    zoneMask: ([a, b]) => zone(asVec(a, "zoneMask"), num(b), [u.uZone[0], u.uZone[1]], [u.uZone[2], u.uZone[3]]),
    zoneCenter: () => [0.5 * (u.uZone[0] + u.uZone[2]), 0.5 * (u.uZone[1] + u.uZone[3])],
    wordsMask: ([a, b]) => {
      if (u.uTypeAmt < 0.002 || u.uTypeBox[2] <= u.uTypeBox[0] || u.uTypeBox[3] <= u.uTypeBox[1]) return 0;
      return zone(asVec(a, "wordsMask"), num(b), [u.uTypeBox[0] - 0.02, u.uTypeBox[1] - 0.02], [u.uTypeBox[2] + 0.02, u.uTypeBox[3] + 0.02]) * u.uTypeAmt;
    },
    typeMask: () => 0,
    typeGlow: () => 0,
    motifMask: () => 0,
  };
}

// ---------------------------------------------------------------------------
// compiler
// ---------------------------------------------------------------------------

interface Scope {
  vars: Map<string, { slot: number; global: boolean }>;
}

class Compiler {
  private toks: Tok[];
  private i = 0;
  private scopes: Scope[] = [];
  private fnSlots = 0;
  private inFunction = false;
  readonly globals: Value[] = [];
  private globalNames = new Map<string, number>();
  readonly fns = new Map<string, FnDef>();
  private builtins: Record<string, Builtin>;
  /** operations budget per evaluation (runaway guard) */
  ops = 0;

  constructor(code: string, builtins: Record<string, Builtin>) {
    this.toks = tokenize(code);
    this.builtins = builtins;
  }

  global(name: string, value: Value): number {
    const slot = this.globals.length;
    this.globals.push(value);
    this.globalNames.set(name, slot);
    return slot;
  }

  // --- token helpers
  private peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  private next(): Tok {
    const t = this.toks[this.i++];
    if (!t) fail("程式提早結束");
    return t;
  }
  private is(v: string, o = 0): boolean {
    return this.toks[this.i + o]?.v === v;
  }
  private eat(v: string): boolean {
    if (this.is(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(v: string): void {
    const t = this.next();
    if (t.v !== v) fail(`第 ${t.line} 行：預期「${v}」，拿到「${t.v}」`);
  }

  // --- scopes
  private push(): void {
    this.scopes.push({ vars: new Map() });
  }
  private pop(): void {
    this.scopes.pop();
  }
  private declare(name: string): { slot: number; global: boolean } {
    if (!this.inFunction) {
      const slot = this.global(name, 0);
      return { slot, global: true };
    }
    const v = { slot: this.fnSlots++, global: false };
    this.scopes[this.scopes.length - 1].vars.set(name, v);
    return v;
  }
  private lookup(name: string): { slot: number; global: boolean } | null {
    for (let k = this.scopes.length - 1; k >= 0; k--) {
      const v = this.scopes[k].vars.get(name);
      if (v) return v;
    }
    const g = this.globalNames.get(name);
    return g == null ? null : { slot: g, global: true };
  }

  // --- program
  compileProgram(): void {
    while (this.i < this.toks.length) this.topLevel();
  }

  private topLevel(): void {
    const t = this.peek()!;
    if (t.v === "struct") fail(`第 ${t.line} 行：亮度探針不支援 struct`);
    const isConst = this.eat("const");
    const type = this.next();
    if (!TYPES.has(type.v)) fail(`第 ${type.line} 行：無法評估的型別「${type.v}」`);
    const name = this.next();
    if (this.is("(")) {
      if (isConst) fail(`第 ${name.line} 行：函式不能是 const`);
      this.functionDef(name.v);
      return;
    }
    // global declarations (const K = …; float gX;): evaluated now, like the GPU's constant folding
    this.i -= 1;
    this.declaration(type.v, true)(this.globals as Frame);
  }

  private functionDef(name: string): void {
    this.expect("(");
    this.inFunction = true;
    this.fnSlots = 0;
    this.push();
    const params: FnDef["params"] = [];
    if (!this.is(")")) {
      for (;;) {
        let qual: "in" | "out" | "inout" = "in";
        if (this.is("in") || this.is("out") || this.is("inout")) qual = this.next().v as typeof qual;
        if (this.is("const")) this.next();
        const type = this.next();
        if (!TYPES.has(type.v)) fail(`第 ${type.line} 行：無法評估的參數型別「${type.v}」`);
        if (this.is("[", 1) || this.is("[", 0)) fail(`第 ${type.line} 行：亮度探針不支援陣列`);
        const pname = this.next();
        if (pname.k !== "id") fail(`第 ${pname.line} 行：參數需要名稱`);
        const v = this.declare(pname.v);
        params.push({ slot: v.slot, qual });
        if (this.eat(",")) continue;
        break;
      }
    }
    this.expect(")");
    const def: FnDef = { params, body: null, nslots: 0 };
    // a prototype has no body; a redefinition fills it
    const existing = this.fns.get(name);
    if (!existing || existing.body == null) this.fns.set(name, def);
    if (this.eat(";")) {
      this.pop();
      this.inFunction = false;
      return;
    }
    const body = this.block();
    const target = this.fns.get(name)!;
    target.body = body;
    target.params = params;
    target.nslots = this.fnSlots;
    this.pop();
    this.inFunction = false;
  }

  // --- statements
  private block(): Stmt {
    this.expect("{");
    this.push();
    const stmts: Stmt[] = [];
    while (!this.is("}")) stmts.push(this.statement());
    this.expect("}");
    this.pop();
    const n = stmts.length;
    return (f) => {
      for (let k = 0; k < n; k++) {
        const c = stmts[k](f);
        if (c) return c;
      }
      return 0;
    };
  }

  private statement(): Stmt {
    const t = this.peek()!;
    if (t.v === "{") return this.block();
    if (t.v === "if") {
      this.next();
      this.expect("(");
      const cond = this.expr();
      this.expect(")");
      const then = this.statement();
      const els = this.eat("else") ? this.statement() : null;
      return (f) => (bool(cond(f)) ? then(f) : els ? els(f) : 0);
    }
    if (t.v === "for") return this.forLoop();
    if (t.v === "return") {
      this.next();
      if (this.eat(";")) return () => 3;
      const e = this.expr();
      this.expect(";");
      return (f) => {
        f.ret = clone(e(f));
        return 3;
      };
    }
    if (t.v === "break") {
      this.next();
      this.expect(";");
      return () => 1;
    }
    if (t.v === "continue") {
      this.next();
      this.expect(";");
      return () => 2;
    }
    if (t.v === "struct") fail(`第 ${t.line} 行：亮度探針不支援 struct`);
    if (t.v === "const" || (t.k === "id" && TYPES.has(t.v) && this.peek(1)?.k === "id")) {
      const isConst = this.eat("const");
      const type = this.next().v;
      void isConst;
      return this.declaration(type, false);
    }
    const e = this.expr();
    this.expect(";");
    return (f) => {
      e(f);
      return 0;
    };
  }

  /** `TYPE a = e, b;` — the type token already consumed. */
  private declaration(type: string, global: boolean): Stmt {
    const inits: Array<{ slot: number; isGlobal: boolean; init: Expr | null }> = [];
    for (;;) {
      const name = this.next();
      if (name.k !== "id") fail(`第 ${name.line} 行：需要變數名稱`);
      if (this.is("[")) fail(`第 ${name.line} 行：亮度探針不支援陣列`);
      const init = this.eat("=") ? this.assignment() : null;
      const v = global ? { slot: this.global(name.v, 0), global: true } : this.declare(name.v);
      inits.push({ slot: v.slot, isGlobal: v.global, init });
      if (this.eat(",")) continue;
      break;
    }
    this.expect(";");
    const zero = construct(type === "void" ? "float" : type.startsWith("b") && type !== "bool" ? type : type, [0]);
    const G = this.globals;
    return (f) => {
      for (const d of inits) {
        const v = d.init ? clone(d.init(f)) : clone(zero);
        if (d.isGlobal) G[d.slot] = v;
        else f[d.slot] = v;
      }
      return 0;
    };
  }

  private forLoop(): Stmt {
    this.next();
    this.expect("(");
    this.push();
    let init: Stmt;
    if (this.is("int") || this.is("float")) {
      const type = this.next().v;
      init = this.declaration(type, false);
    } else {
      const e = this.expr();
      this.expect(";");
      init = (f) => {
        e(f);
        return 0;
      };
    }
    const cond = this.is(";") ? null : this.expr();
    this.expect(";");
    const step = this.is(")") ? null : this.expr();
    this.expect(")");
    const body = this.statement();
    this.pop();
    return (f) => {
      init(f);
      for (let guard = 0; guard < 4096; guard++) {
        if (cond && !bool(cond(f))) return 0;
        const c = body(f);
        if (c === 1) return 0;
        if (c === 3) return 3;
        if (step) step(f);
        if ((this.ops += 1) > 2_000_000) fail("程式太耗時，亮度探針放棄");
      }
      return 0;
    };
  }

  // --- expressions
  private expr(): Expr {
    let e = this.assignment();
    while (this.eat(",")) {
      const r = this.assignment();
      const l = e;
      e = (f) => {
        l(f);
        return r(f);
      };
    }
    return e;
  }

  private assignment(): Expr {
    const start = this.i;
    const lhs = this.ternary();
    const op = this.peek()?.v;
    if (op === "=" || op === "+=" || op === "-=" || op === "*=" || op === "/=") {
      this.next();
      const end = this.i - 1;
      const lv = this.lvalueFrom(start, end);
      const rhs = this.assignment();
      switch (op) {
        case "=":
          return (f) => {
            const v = clone(rhs(f));
            lv.set(f, v);
            return v;
          };
        case "+=":
          return (f) => {
            const v = map2(lv.get(f), rhs(f), (x, y) => x + y);
            lv.set(f, v);
            return v;
          };
        case "-=":
          return (f) => {
            const v = map2(lv.get(f), rhs(f), (x, y) => x - y);
            lv.set(f, v);
            return v;
          };
        case "*=":
          return (f) => {
            const v = mul(lv.get(f), rhs(f));
            lv.set(f, v);
            return v;
          };
        default:
          return (f) => {
            const v = map2(lv.get(f), rhs(f), (x, y) => x / y);
            lv.set(f, v);
            return v;
          };
      }
    }
    return lhs;
  }

  /** Re-parse tokens [start, end) as an lvalue: NAME (.swizzle | [index])*. */
  private lvalueFrom(start: number, end: number): LValue {
    const save = this.i;
    this.i = start;
    const lv = this.lvalue();
    if (this.i !== end) fail(`第 ${this.toks[start].line} 行：等號左邊不能是這個運算式`);
    this.i = save;
    return lv;
  }

  private lvalue(): LValue {
    const t = this.next();
    if (t.k !== "id") fail(`第 ${t.line} 行：等號左邊需要變數`);
    const v = this.lookup(t.v);
    if (!v) fail(`第 ${t.line} 行：未宣告的變數「${t.v}」`);
    const G = this.globals;
    let lv: LValue = v.global
      ? { get: () => G[v.slot], set: (_f, x) => void (G[v.slot] = x) }
      : { get: (f) => f[v.slot], set: (f, x) => void (f[v.slot] = x) };
    for (;;) {
      if (this.eat(".")) {
        const m = this.next();
        const idx = [...m.v].map((c) => SWZ[c]);
        if (idx.some((k) => k == null)) fail(`第 ${m.line} 行：無法評估的成員「${m.v}」`);
        const parent = lv;
        lv = {
          get: (f) => {
            const p = parent.get(f);
            if (!isVec(p)) fail("swizzle 需要向量");
            return idx.length === 1 ? p[idx[0]] : idx.map((k) => p[k]);
          },
          set: (f, x) => {
            const p = parent.get(f);
            if (!isVec(p)) fail("swizzle 需要向量");
            const o = p.slice();
            if (idx.length === 1) o[idx[0]] = num(x);
            else {
              const xs = asVec(x, "swizzle 指定");
              idx.forEach((k, j) => (o[k] = xs[j]));
            }
            parent.set(f, o);
          },
        };
        continue;
      }
      if (this.eat("[")) {
        const ie = this.expr();
        this.expect("]");
        const parent = lv;
        lv = {
          get: (f) => indexValue(parent.get(f), num(ie(f))),
          set: (f, x) => {
            const p = parent.get(f);
            const k = Math.trunc(num(ie(f)));
            if (isVec(p)) {
              const o = p.slice();
              o[k] = num(x);
              parent.set(f, o);
            } else if (p instanceof Mat) {
              const col = asVec(x, "矩陣欄位");
              const o = p.a.slice();
              for (let r = 0; r < p.n; r++) o[k * p.n + r] = col[r];
              parent.set(f, new Mat(p.n, o));
            } else fail("索引需要向量或矩陣");
          },
        };
        continue;
      }
      break;
    }
    return lv;
  }

  private ternary(): Expr {
    const c = this.logicalOr();
    if (this.eat("?")) {
      const a = this.assignment();
      this.expect(":");
      const b = this.assignment();
      return (f) => (bool(c(f)) ? a(f) : b(f));
    }
    return c;
  }

  private logicalOr(): Expr {
    let l = this.logicalXor();
    while (this.is("||")) {
      this.next();
      const r = this.logicalXor();
      const a = l;
      l = (f) => bool(a(f)) || bool(r(f));
    }
    return l;
  }
  private logicalXor(): Expr {
    let l = this.logicalAnd();
    while (this.is("^^")) {
      this.next();
      const r = this.logicalAnd();
      const a = l;
      l = (f) => bool(a(f)) !== bool(r(f));
    }
    return l;
  }
  private logicalAnd(): Expr {
    let l = this.equality();
    while (this.is("&&")) {
      this.next();
      const r = this.equality();
      const a = l;
      l = (f) => bool(a(f)) && bool(r(f));
    }
    return l;
  }
  private equality(): Expr {
    let l = this.relational();
    for (;;) {
      const op = this.peek()?.v;
      if (op !== "==" && op !== "!=") return l;
      this.next();
      const r = this.relational();
      const a = l;
      const eq = (x: Value, y: Value): boolean => {
        if (isVec(x) && isVec(y)) return x.length === y.length && x.every((v, i) => v === y[i]);
        if (x instanceof Mat && y instanceof Mat) return x.a.every((v, i) => v === y.a[i]);
        return x === y;
      };
      l = op === "==" ? (f) => eq(a(f), r(f)) : (f) => !eq(a(f), r(f));
    }
  }
  private relational(): Expr {
    let l = this.additive();
    for (;;) {
      const op = this.peek()?.v;
      if (op !== "<" && op !== ">" && op !== "<=" && op !== ">=") return l;
      this.next();
      const r = this.additive();
      const a = l;
      switch (op) {
        case "<":
          l = (f) => num(a(f)) < num(r(f));
          break;
        case ">":
          l = (f) => num(a(f)) > num(r(f));
          break;
        case "<=":
          l = (f) => num(a(f)) <= num(r(f));
          break;
        default:
          l = (f) => num(a(f)) >= num(r(f));
      }
    }
  }
  private additive(): Expr {
    let l = this.multiplicative();
    for (;;) {
      const op = this.peek()?.v;
      if (op !== "+" && op !== "-") return l;
      this.next();
      const r = this.multiplicative();
      const a = l;
      l = op === "+" ? (f) => map2(a(f), r(f), (x, y) => x + y) : (f) => map2(a(f), r(f), (x, y) => x - y);
    }
  }
  private multiplicative(): Expr {
    let l = this.unary();
    for (;;) {
      const op = this.peek()?.v;
      if (op !== "*" && op !== "/") return l;
      this.next();
      const r = this.unary();
      const a = l;
      l = op === "*" ? (f) => mul(a(f), r(f)) : (f) => map2(a(f), r(f), (x, y) => x / y);
    }
  }
  private unary(): Expr {
    const t = this.peek()!;
    if (t.v === "-") {
      this.next();
      const e = this.unary();
      return (f) => map1(e(f), (x) => -x);
    }
    if (t.v === "+") {
      this.next();
      return this.unary();
    }
    if (t.v === "!") {
      this.next();
      const e = this.unary();
      return (f) => !bool(e(f));
    }
    if (t.v === "++" || t.v === "--") {
      this.next();
      const start = this.i;
      this.postfix();
      const lv = this.lvalueFrom(start, this.i);
      const d = t.v === "++" ? 1 : -1;
      return (f) => {
        const v = map1(lv.get(f), (x) => x + d);
        lv.set(f, v);
        return v;
      };
    }
    return this.postfix();
  }
  private postfix(): Expr {
    const start = this.i;
    let e = this.primary();
    for (;;) {
      if (this.eat(".")) {
        const m = this.next();
        const idx = [...m.v].map((c) => SWZ[c]);
        if (idx.some((k) => k == null) || idx.length > 4) fail(`第 ${m.line} 行：無法評估的成員「${m.v}」`);
        const p = e;
        if (idx.length === 1) {
          const k = idx[0];
          e = (f) => {
            const v = p(f);
            return isVec(v) ? v[k] : fail(`第 ${m.line} 行：swizzle 需要向量`);
          };
        } else {
          e = (f) => {
            const v = p(f);
            if (!isVec(v)) fail(`第 ${m.line} 行：swizzle 需要向量`);
            const o = new Array<number>(idx.length);
            for (let j = 0; j < idx.length; j++) o[j] = v[idx[j]];
            return o;
          };
        }
        continue;
      }
      if (this.eat("[")) {
        const ie = this.expr();
        this.expect("]");
        const p = e;
        e = (f) => indexValue(p(f), num(ie(f)));
        continue;
      }
      if (this.is("++") || this.is("--")) {
        const d = this.next().v === "++" ? 1 : -1;
        const lv = this.lvalueFrom(start, this.i - 1);
        return (f) => {
          const old = lv.get(f);
          lv.set(f, map1(old, (x) => x + d));
          return old;
        };
      }
      return e;
    }
  }
  private primary(): Expr {
    const t = this.next();
    if (t.k === "num") {
      const v = Number(t.v);
      return () => v;
    }
    if (t.v === "(") {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    if (t.k !== "id") fail(`第 ${t.line} 行：無法評估「${t.v}」`);
    if (t.v === "true") return () => true;
    if (t.v === "false") return () => false;
    if (this.is("(")) return this.call(t);
    const v = this.lookup(t.v);
    if (!v) fail(`第 ${t.line} 行：未宣告的變數「${t.v}」`);
    const G = this.globals;
    return v.global ? () => G[v.slot] : (f) => f[v.slot];
  }

  private call(t: Tok): Expr {
    this.expect("(");
    const args: Expr[] = [];
    const argStarts: Array<[number, number]> = [];
    if (!this.is(")")) {
      for (;;) {
        const s = this.i;
        args.push(this.assignment());
        argStarts.push([s, this.i]);
        if (this.eat(",")) continue;
        break;
      }
    }
    this.expect(")");
    const name = t.v;
    if (TYPES.has(name)) return (f) => construct(name, args.map((a) => a(f)));
    const b = this.builtins[name] ?? BUILTINS[name];
    if (b && !this.fns.has(name)) {
      const n = args.length;
      return (f) => {
        const vals = new Array<Value>(n);
        for (let k = 0; k < n; k++) vals[k] = args[k](f);
        return b(vals);
      };
    }
    const def = this.fns.get(name);
    if (!def) fail(`第 ${t.line} 行：未定義的函式「${name}」`);
    // out / inout arguments write back to their lvalues
    const outs: Array<LValue | null> = def.params.map((p, k) => (p.qual === "in" ? null : argStarts[k] ? this.lvalueFrom(argStarts[k][0], argStarts[k][1]) : null));
    const hasOut = outs.some(Boolean);
    return (f) => {
      if ((this.ops += 1) > 2_000_000) fail("程式太耗時，亮度探針放棄");
      const frame = new Array<Value>(def.nslots) as Frame;
      for (let k = 0; k < def.params.length; k++) frame[def.params[k].slot] = clone(args[k](f));
      if (!def.body) fail(`函式「${name}」沒有定義`);
      def.body(frame);
      if (hasOut) for (let k = 0; k < outs.length; k++) if (outs[k]) outs[k]!.set(f, frame[def.params[k].slot]);
      return frame.ret ?? 0;
    };
  }
}

function indexValue(v: Value, i: number): Value {
  const k = Math.trunc(i);
  if (isVec(v)) return v[k] ?? fail("索引超出向量");
  if (v instanceof Mat) {
    const o = new Array<number>(v.n);
    for (let r = 0; r < v.n; r++) o[r] = v.a[k * v.n + r];
    return o;
  }
  return fail("索引需要向量或矩陣");
}

// ---------------------------------------------------------------------------
// public
// ---------------------------------------------------------------------------

export interface CompiledProgram {
  /** Evaluate scene(fc) → [r, g, b] (clamped 0–1, after the epilogue's master gain) and gFront. */
  scene(fc: [number, number]): { color: [number, number, number]; front: number };
  /** Change the uniforms between evaluations (same program, another section state). */
  setUniforms(u: Uniforms): void;
}

const UNIFORM_SCALARS = ["uTime", "uClock", "uSongTime", "uSongProgress", "uSeed", "uBeat", "uBeatN", "uBar", "uTempo", "uPulse", "uEnergy", "uLevel", "uBass", "uOnset", "uIntensity", "uMaster", "uReact", "uSection", "uSectionKind", "uSectionEnergy", "uSectionProgress", "uMode", "uRelation", "uTypeAmt"] as const;

/**
 * Compile a validated program body (comments stripped is fine, but not required) for CPU
 * evaluation. Throws a GlslError (繁中) for syntax the evaluator does not support.
 */
export function compileForCpu(code: string, uniforms: Uniforms): CompiledProgram {
  let u = uniforms;
  const natives = preludeBuiltins(uniforms);
  // the natives close over `u`: a rebind swaps the whole table through this indirection
  const table: Record<string, Builtin> = {};
  for (const k of Object.keys(natives)) table[k] = (args) => natives[k](args);
  const c = new Compiler(code, table);
  const slots = new Map<string, number>();
  const G = c.globals;
  const put = (name: string, v: Value) => slots.set(name, c.global(name, v));
  for (const k of UNIFORM_SCALARS) put(k, u[k]);
  put("uRes", [...u.uRes]);
  put("uParams", [...u.uParams]);
  put("uBg", [...u.uBg]);
  put("uPri", [...u.uPri]);
  put("uAcc", [...u.uAcc]);
  put("uInk", [...u.uInk]);
  for (let k = 0; k < 6; k++) put(`uPal${k}`, [...(u.uPal[k] ?? u.uPal[u.uPal.length - 1] ?? [0, 0, 0])]);
  put("uZone", [...u.uZone]);
  put("uTypeBox", [...u.uTypeBox]);
  put("PI", 3.14159265);
  put("TAU", 6.28318531);
  const frontSlot = c.global("gFront", 0);
  // every prelude name the program may not redefine is already a native or a uniform here
  void PRELUDE_NAMES;
  c.compileProgram();
  const scene = c.fns.get("scene");
  if (!scene || !scene.body || scene.params.length !== 1) fail("缺少 vec3 scene(vec2 fc)");
  const setUniforms = (nu: Uniforms) => {
    u = nu;
    const nn = preludeBuiltins(nu);
    for (const k of Object.keys(nn)) natives[k] = nn[k];
    for (const k of UNIFORM_SCALARS) G[slots.get(k)!] = nu[k];
    G[slots.get("uRes")!] = [...nu.uRes];
    G[slots.get("uParams")!] = [...nu.uParams];
    G[slots.get("uBg")!] = [...nu.uBg];
    G[slots.get("uPri")!] = [...nu.uPri];
    G[slots.get("uAcc")!] = [...nu.uAcc];
    G[slots.get("uInk")!] = [...nu.uInk];
    for (let k = 0; k < 6; k++) G[slots.get(`uPal${k}`)!] = [...(nu.uPal[k] ?? nu.uPal[nu.uPal.length - 1] ?? [0, 0, 0])];
    G[slots.get("uZone")!] = [...nu.uZone];
    G[slots.get("uTypeBox")!] = [...nu.uTypeBox];
  };
  return {
    setUniforms,
    scene(fc) {
      c.ops = 0;
      G[frontSlot] = 0;
      const frame = new Array<Value>(scene.nslots) as Frame;
      frame[scene.params[0].slot] = [fc[0], fc[1]];
      scene.body!(frame);
      const r = frame.ret ?? 0;
      if (!isVec(r) || r.length !== 3) return fail("scene() 必須回傳 vec3");
      const master = Math.min(1.5, Math.max(0, u.uMaster));
      const col = [0, 1, 2].map((k) => Math.min(1, Math.max(0, r[k]) * master)) as [number, number, number];
      return { color: col, front: Math.min(1, Math.max(0, num(G[frontSlot]))) };
    },
  };
}

export function isGlslError(e: unknown): e is GlslError {
  return e instanceof GlslError;
}
