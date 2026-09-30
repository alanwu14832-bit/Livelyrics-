// 專屬畫面 (phase 7): the scene program's validator. A program is untrusted text (Claude wrote it,
// or someone pasted it) that will run on the venue's GPU, so it is checked on the server before it
// is stored and again in the browser before it is compiled. Pure, deterministic, never throws.
//
// What it guarantees (the renderer's prelude supplies everything else):
//   - bounded size; ASCII outside comments; comments stripped before compiling;
//   - no preprocessor at all (#extension, #define, #version, #pragma, #line…);
//   - no declarations that change the interface: uniform / attribute / varying / in / out at global
//     scope / precision / sampler types / layout; no main(); no gl_ names; no discard;
//   - no texture lookups except through the prelude's helpers (typeMask, typeGlow, motifMask);
//   - loops are `for` only, with an int index, literal bounds and a literal step, at most
//     MAX_LOOP_ITERATIONS each and MAX_LOOP_PRODUCT nested; no while / do / switch;
//   - nothing outside the GLSL ES 1.00 / 3.00 common subset that would break the WebGL1 fallback
//     (ES 3.00-only builtins, uint, bit operations, %);
//   - exactly one `vec3 scene(vec2 …)` and no redefinition of a prelude name;
//   - balanced braces and parentheses.
// What it cannot know (type errors, a slow program): the browser compiles it and falls back to the
// section's built-in scene on failure or a sustained over-budget frame time.

import { PRELUDE_NAMES } from "./contract";

export const MAX_SOURCE_CHARS = 24_000;
export const MAX_CODE_CHARS = 16_000;
export const MAX_LOOP_ITERATIONS = 48;
export const MAX_LOOP_PRODUCT = 256;
export const MAX_LOOP_DEPTH = 3;

export type ValidationResult = { ok: true; code: string; warnings: string[] } | { ok: false; errors: string[] };

const FORBIDDEN: Record<string, string> = {
  uniform: "不能宣告 uniform（只能用系統提供的）",
  attribute: "不能宣告 attribute",
  varying: "不能宣告 varying",
  precision: "不能改精度（系統已設定）",
  highp: "不能指定精度",
  mediump: "不能指定精度",
  lowp: "不能指定精度",
  invariant: "不能用 invariant",
  layout: "不能用 layout",
  centroid: "不能用 centroid",
  flat: "不能用 flat",
  smooth: "不能用 smooth",
  sampler2D: "不能宣告取樣器（只能用 typeMask／typeGlow／motifMask）",
  samplerCube: "不能宣告取樣器",
  sampler3D: "不能宣告取樣器",
  sampler2DShadow: "不能宣告取樣器",
  sampler2DArray: "不能宣告取樣器",
  isampler2D: "不能宣告取樣器",
  usampler2D: "不能宣告取樣器",
  texture: "不能直接取樣貼圖（用 typeMask／typeGlow／motifMask）",
  texture2D: "不能直接取樣貼圖",
  texture2DLod: "不能直接取樣貼圖",
  texture2DProj: "不能直接取樣貼圖",
  texture2DProjLod: "不能直接取樣貼圖",
  textureCube: "不能直接取樣貼圖",
  textureCubeLod: "不能直接取樣貼圖",
  textureLod: "不能直接取樣貼圖",
  textureProj: "不能直接取樣貼圖",
  textureProjLod: "不能直接取樣貼圖",
  textureGrad: "不能直接取樣貼圖",
  textureOffset: "不能直接取樣貼圖",
  texelFetch: "不能直接取樣貼圖",
  texelFetchOffset: "不能直接取樣貼圖",
  textureSize: "不能查詢貼圖",
  TEX: "不能直接取樣貼圖",
  FRAG: "不能直接寫輸出（回傳 scene() 的顏色即可）",
  outColor: "不能直接寫輸出",
  main: "不能定義 main（系統會加上）",
  discard: "不能用 discard",
  while: "不能用 while 迴圈（只能用常數次數的 for）",
  do: "不能用 do 迴圈",
  switch: "不能用 switch（WebGL1 不支援）",
  case: "不能用 switch／case",
  default: "不能用 switch／default",
  goto: "不能用 goto",
  asm: "保留字",
  class: "保留字",
  union: "保留字",
  enum: "保留字",
  typedef: "保留字",
  template: "保留字",
  this: "保留字",
  packed: "保留字",
  inline: "保留字",
  noinline: "保留字",
  volatile: "保留字",
  public: "保留字",
  static: "保留字",
  extern: "保留字",
  external: "保留字",
  interface: "保留字",
  long: "保留字",
  short: "保留字",
  double: "保留字",
  half: "保留字",
  fixed: "保留字",
  unsigned: "保留字",
  superp: "保留字",
  input: "保留字",
  output: "保留字",
  hvec2: "保留字",
  hvec3: "保留字",
  hvec4: "保留字",
  dvec2: "保留字",
  dvec3: "保留字",
  dvec4: "保留字",
  fvec2: "保留字",
  fvec3: "保留字",
  fvec4: "保留字",
  sizeof: "保留字",
  cast: "保留字",
  namespace: "保留字",
  using: "保留字",
  uint: "WebGL1 不支援 uint",
  uvec2: "WebGL1 不支援 uvec",
  uvec3: "WebGL1 不支援 uvec",
  uvec4: "WebGL1 不支援 uvec",
  round: "WebGL1 沒有 round()（用 floor(x + 0.5)）",
  roundEven: "WebGL1 沒有 roundEven()",
  trunc: "WebGL1 沒有 trunc()",
  tanh: "WebGL1 沒有 tanh()",
  sinh: "WebGL1 沒有 sinh()",
  cosh: "WebGL1 沒有 cosh()",
  asinh: "WebGL1 沒有 asinh()",
  acosh: "WebGL1 沒有 acosh()",
  atanh: "WebGL1 沒有 atanh()",
  modf: "WebGL1 沒有 modf()",
  isnan: "WebGL1 沒有 isnan()",
  isinf: "WebGL1 沒有 isinf()",
  inverse: "WebGL1 沒有 inverse()",
  transpose: "WebGL1 沒有 transpose()",
  determinant: "WebGL1 沒有 determinant()",
  outerProduct: "WebGL1 沒有 outerProduct()",
  floatBitsToInt: "WebGL1 沒有位元轉換",
  floatBitsToUint: "WebGL1 沒有位元轉換",
  intBitsToFloat: "WebGL1 沒有位元轉換",
  uintBitsToFloat: "WebGL1 沒有位元轉換",
  packHalf2x16: "WebGL1 沒有 pack 函式",
  unpackHalf2x16: "WebGL1 沒有 unpack 函式",
  packSnorm2x16: "WebGL1 沒有 pack 函式",
  unpackSnorm2x16: "WebGL1 沒有 unpack 函式",
  packUnorm2x16: "WebGL1 沒有 pack 函式",
  unpackUnorm2x16: "WebGL1 沒有 unpack 函式",
  dFdx: "不能用導數（WebGL1 需要擴充）",
  dFdy: "不能用導數（WebGL1 需要擴充）",
  fwidth: "不能用導數（WebGL1 需要擴充）",
};

const RESERVED_PREFIXES: Array<[RegExp, string]> = [
  [/^gl_/, "不能用 gl_ 開頭的名稱"],
  [/^webgl_/, "不能用 webgl_ 開頭的名稱"],
  [/^_webgl_/, "不能用 _webgl_ 開頭的名稱"],
  [/__/, "名稱裡不能有兩個底線（保留）"],
  [/^ll_/, "ll_ 開頭是系統保留的名稱"],
];

const PRELUDE_SET = new Set<string>(PRELUDE_NAMES);
const TYPE_WORDS = new Set(["void", "bool", "int", "float", "vec2", "vec3", "vec4", "bvec2", "bvec3", "bvec4", "ivec2", "ivec3", "ivec4", "mat2", "mat3", "mat4", "struct"]);

type Tok = { k: "id" | "num" | "op"; v: string; line: number };

/** Remove // and /* *\/ comments (keeping line breaks so line numbers stay). */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const OPS3 = ["<<=", ">>="];
const OPS2 = ["++", "--", "+=", "-=", "*=", "/=", "==", "!=", "<=", ">=", "&&", "||", "^^", "<<", ">>", "%=", "&=", "|=", "^="];
const OPS1 = "{}()[];,.+-*/<>=!?:&|^~%";
const ALLOWED_OPS = new Set(["{", "}", "(", ")", "[", "]", ";", ",", ".", "+", "-", "*", "/", "<", ">", "=", "!", "?", ":", "++", "--", "+=", "-=", "*=", "/=", "==", "!=", "<=", ">=", "&&", "||", "^^"]);

function tokenize(code: string, errors: string[]): Tok[] {
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
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < code.length && /[A-Za-z0-9_]/.test(code[j])) j++;
      toks.push({ k: "id", v: code.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(code[i + 1] ?? ""))) {
      const m = /^(?:0[xX][0-9a-fA-F]+|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)[uU]?/.exec(code.slice(i));
      const v = m ? m[0] : c;
      if (/[uU]$/.test(v)) errors.push(`第 ${line} 行：WebGL1 不支援無號整數常數（${v}）`);
      if (/^0[xX]/.test(v)) errors.push(`第 ${line} 行：請不要用十六進位常數（${v}）`);
      toks.push({ k: "num", v, line });
      i += v.length;
      continue;
    }
    const three = code.slice(i, i + 3);
    const two = code.slice(i, i + 2);
    const op = OPS3.includes(three) ? three : OPS2.includes(two) ? two : OPS1.includes(c) ? c : null;
    if (!op) {
      errors.push(`第 ${line} 行：不允許的字元「${c}」`);
      i++;
      continue;
    }
    if (!ALLOWED_OPS.has(op)) errors.push(`第 ${line} 行：不能用運算子「${op}」（WebGL1 不支援位元運算與 %）`);
    toks.push({ k: "op", v: op, line });
    i += op.length;
  }
  return toks;
}

/** Iterations of a `for` header, or an error message. Tokens start after `for (`. */
function loopCount(t: Tok[], at: number): { count: number; end: number } | { error: string } {
  // for ( [int] i = A ; i OP B ; STEP )
  let k = at;
  const next = () => t[k++];
  let tok = next();
  if (tok?.v === "int") tok = next();
  else if (tok?.v === "float") return { error: "迴圈的索引必須是 int" };
  if (tok?.k !== "id") return { error: "迴圈標頭必須是 for (int i = 常數; i < 常數; i++)" };
  const name = tok.v;
  if (next()?.v !== "=") return { error: "迴圈索引必須用常數初始化" };
  const sign = (): number => {
    if (t[k]?.v === "-") {
      k++;
      return -1;
    }
    return 1;
  };
  let s = sign();
  tok = next();
  if (tok?.k !== "num" || !/^[0-9]+$/.test(tok.v)) return { error: "迴圈起點必須是整數常數" };
  const a = s * Number(tok.v);
  if (next()?.v !== ";") return { error: "迴圈標頭格式不正確" };
  if (next()?.v !== name) return { error: "迴圈條件必須比較同一個索引" };
  const cmp = next()?.v;
  if (!cmp || !["<", "<=", ">", ">="].includes(cmp)) return { error: "迴圈條件必須是 < <= > >=" };
  s = sign();
  tok = next();
  if (tok?.k !== "num" || !/^[0-9]+$/.test(tok.v)) return { error: "迴圈終點必須是整數常數（不能用變數或 uniform）" };
  const b = s * Number(tok.v);
  if (next()?.v !== ";") return { error: "迴圈標頭格式不正確" };
  let step = 0;
  const s1 = next();
  if (s1?.v === "++" || s1?.v === "--") {
    if (next()?.v !== name) return { error: "迴圈遞增必須是同一個索引" };
    step = s1.v === "++" ? 1 : -1;
  } else if (s1?.v === name) {
    const s2 = next();
    if (s2?.v === "++") step = 1;
    else if (s2?.v === "--") step = -1;
    else if (s2?.v === "+=" || s2?.v === "-=") {
      const n = next();
      if (n?.k !== "num" || !/^[0-9]+$/.test(n.v) || Number(n.v) <= 0) return { error: "迴圈步長必須是正整數常數" };
      step = s2.v === "+=" ? Number(n.v) : -Number(n.v);
    } else return { error: "迴圈遞增必須是 i++、i--、i += 常數" };
  } else return { error: "迴圈遞增必須是 i++、i--、i += 常數" };
  if (next()?.v !== ")") return { error: "迴圈標頭格式不正確" };
  let count: number;
  if (step > 0 && (cmp === "<" || cmp === "<=")) count = Math.max(0, Math.ceil((b - a + (cmp === "<=" ? 1 : 0)) / step));
  else if (step < 0 && (cmp === ">" || cmp === ">=")) count = Math.max(0, Math.ceil((a - b + (cmp === ">=" ? 1 : 0)) / -step));
  else return { error: "迴圈方向與條件不一致（可能無限迴圈）" };
  return { count, end: k };
}

/**
 * Check a program body. `code` in the result is what gets compiled: comments stripped (GLSL ES
 * 1.00 allows only ASCII, even in comments), trimmed.
 */
export function validateProgram(source: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof source !== "string" || !source.trim()) return { ok: false, errors: ["沒有程式碼"] };
  if (source.length > MAX_SOURCE_CHARS) return { ok: false, errors: [`程式太長（${source.length} 字元，上限 ${MAX_SOURCE_CHARS}）`] };
  const code = stripComments(source).replace(/\r\n?/g, "\n").trim();
  if (code.length > MAX_CODE_CHARS) errors.push(`程式太長（不含註解 ${code.length} 字元，上限 ${MAX_CODE_CHARS}）`);
  const lines = code.split("\n");
  lines.forEach((l, i) => {
    if (/[^\x20-\x7e\t]/.test(l)) errors.push(`第 ${i + 1} 行：註解以外只能有 ASCII 字元`);
    if (/^\s*#/.test(l) || l.includes("#")) errors.push(`第 ${i + 1} 行：不能有前處理指令（#）`);
    if (l.includes("\\")) errors.push(`第 ${i + 1} 行：不能有反斜線`);
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 12) };

  const toks = tokenize(code, errors);
  // braces / parens, loops, scope
  let brace = 0;
  let paren = 0;
  const loops: Array<{ depth: number; count: number }> = [];
  let sceneDefs = 0;
  const defined = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === "op") {
      if (t.v === "{") brace++;
      else if (t.v === "}") {
        brace--;
        while (loops.length && loops[loops.length - 1].depth > brace) loops.pop();
        if (brace < 0) {
          errors.push(`第 ${t.line} 行：多了一個 }`);
          brace = 0;
        }
      } else if (t.v === "(") paren++;
      else if (t.v === ")") {
        paren--;
        if (paren < 0) {
          errors.push(`第 ${t.line} 行：多了一個 )`);
          paren = 0;
        }
      }
      continue;
    }
    if (t.k !== "id") continue;
    const why = FORBIDDEN[t.v];
    if (why) {
      errors.push(`第 ${t.line} 行：${why}（${t.v}）`);
      continue;
    }
    const pre = RESERVED_PREFIXES.find(([re]) => re.test(t.v));
    if (pre) {
      errors.push(`第 ${t.line} 行：${pre[1]}（${t.v}）`);
      continue;
    }
    if (t.v.length > 64) errors.push(`第 ${t.line} 行：名稱太長`);
    if ((t.v === "in" || t.v === "out" || t.v === "inout") && paren === 0) errors.push(`第 ${t.line} 行：in／out 只能用在函式參數`);
    // a definition: TYPE NAME ( … at global scope, or TYPE NAME [=;,[] anywhere
    const prev = toks[i - 1];
    const nextTok = toks[i + 1];
    if (prev && prev.k === "id" && (TYPE_WORDS.has(prev.v) || defined.has(prev.v)) && nextTok && ["(", "=", ";", ",", "["].includes(nextTok.v)) {
      if (PRELUDE_SET.has(t.v)) errors.push(`第 ${t.line} 行：「${t.v}」是系統提供的名稱，不能重新定義`);
      if (nextTok.v === "(" && brace === 0) {
        if (t.v === "scene") {
          sceneDefs++;
          const a = toks[i + 2];
          const b = toks[i + 3];
          const c = toks[i + 4];
          if (prev.v !== "vec3" || a?.v !== "vec2" || b?.k !== "id" || c?.v !== ")") errors.push(`第 ${t.line} 行：scene 必須是 vec3 scene(vec2 fc)`);
        }
      }
    }
    if (prev?.v === "struct" && t.k === "id") defined.add(t.v);
    if (t.v === "for") {
      if (toks[i + 1]?.v !== "(") {
        errors.push(`第 ${t.line} 行：for 格式不正確`);
        continue;
      }
      const r = loopCount(toks, i + 2);
      if ("error" in r) {
        errors.push(`第 ${t.line} 行：${r.error}`);
        continue;
      }
      if (r.count > MAX_LOOP_ITERATIONS) errors.push(`第 ${t.line} 行：迴圈 ${r.count} 次，上限 ${MAX_LOOP_ITERATIONS}`);
      // the loop's body opens at the next "{" (a body without braces is one statement: treat as nested anyway)
      const open = toks[r.end];
      const depth = open?.v === "{" ? brace + 1 : brace + 1;
      const outer = loops.reduce((a, l) => a * l.count, 1);
      if (loops.length + 1 > MAX_LOOP_DEPTH) errors.push(`第 ${t.line} 行：迴圈巢狀超過 ${MAX_LOOP_DEPTH} 層`);
      if (outer * r.count > MAX_LOOP_PRODUCT) errors.push(`第 ${t.line} 行：巢狀迴圈共 ${outer * r.count} 次，上限 ${MAX_LOOP_PRODUCT}`);
      if (open?.v === "{") loops.push({ depth, count: r.count });
      else warnings.push(`第 ${t.line} 行：迴圈沒有大括號`);
    }
  }
  if (brace !== 0) errors.push("大括號 { } 沒有成對");
  if (paren !== 0) errors.push("小括號 ( ) 沒有成對");
  if (sceneDefs === 0) errors.push("缺少 vec3 scene(vec2 fc)");
  if (sceneDefs > 1) errors.push("scene 定義了不只一次");
  if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 12) };
  return { ok: true, code, warnings };
}

/** A stable short key for a program's code (renderer cache, program state). */
export function programKey(code: string): string {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
