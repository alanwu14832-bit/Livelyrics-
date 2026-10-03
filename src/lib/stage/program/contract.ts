// 專屬畫面 (phase 7): the fixed contract between a song's scene program and the renderer.
//
// A program is only a function body: helper functions plus `vec3 scene(vec2 fc)` (fc =
// gl_FragCoord.xy, returns display-referred sRGB 0..1). The renderer wraps it between its own
// prelude (version / precision header, every uniform of the contract, a helper library, the type
// mask and emblem samplers behind helper functions) and epilogue (main(): master intensity,
// dither, clamp, the foreground mask in alpha). Everything the program draws then goes through the
// same media, type and LED 安全模式 passes as a built-in scene: it cannot reach the screen any
// other way. The same text is shown to Claude verbatim (PROGRAM_CONTRACT_DOC) and in
// docs/ARCHITECTURE.md.
//
// GLSL ES 1.00 / 3.00 common subset (WebGL2 with the WebGL1 fallback): constant loop bounds, no
// arrays of uniforms, no round() / tanh(), no bit operations, no derivatives.

import { SECTION_KINDS, TYPE_RELATIONS } from "../../schema";
import type { SectionKind, TypeRelation } from "../../types";

export const PROGRAM_UNIFORMS = [
  "uRes",
  "uTime",
  "uClock",
  "uSongTime",
  "uSongProgress",
  "uSeed",
  "uBeat",
  "uBeatN",
  "uBar",
  "uTempo",
  "uPulse",
  "uEnergy",
  "uLevel",
  "uBass",
  "uOnset",
  "uIntensity",
  "uMaster",
  "uReact",
  "uSection",
  "uSectionKind",
  "uSectionEnergy",
  "uSectionProgress",
  "uMode",
  "uParams",
  "uBg",
  "uPri",
  "uAcc",
  "uInk",
  "uPal0",
  "uPal1",
  "uPal2",
  "uPal3",
  "uPal4",
  "uPal5",
  "uZone",
  "uRelation",
  "uTypeBox",
  "uTypeAmt",
  "uType",
  "uMotif",
] as const;
export type ProgramUniform = (typeof PROGRAM_UNIFORMS)[number];

/** uSectionKind codes (the order of SECTION_KINDS). */
export const SECTION_KIND_CODE: Record<SectionKind, number> = Object.fromEntries(SECTION_KINDS.map((k, i) => [k, i])) as Record<SectionKind, number>;
/** uRelation codes (the order of TYPE_RELATIONS). */
export const RELATION_CODE: Record<TypeRelation, number> = Object.fromEntries(TYPE_RELATIONS.map((k, i) => [k, i])) as Record<TypeRelation, number>;

/** Helper and uniform names the prelude defines (a program may use them, never redefine them). */
export const PRELUDE_NAMES = [
  ...PROGRAM_UNIFORMS,
  "gFront",
  "PI",
  "TAU",
  "sat",
  "rot",
  "hash11",
  "hash12",
  "hash22",
  "vnoise",
  "fbm",
  "fbm3",
  "centered",
  "aspect",
  "luma",
  "ramp",
  "palette",
  "px",
  "fill",
  "stroke",
  "sdCircle",
  "sdBox",
  "sdSegment",
  "grain",
  "zoneMask",
  "zoneCenter",
  "wordsMask",
  "typeMask",
  "typeGlow",
  "motifMask",
  "kick",
  "isSection",
] as const;

/**
 * The contract as text: what the prelude declares and what the program must write. Shown to
 * Claude verbatim and copied into docs/ARCHITECTURE.md.
 */
export const PROGRAM_CONTRACT_DOC = `你寫的是一段 GLSL 函式本體（GLSL ES 1.00 與 3.00 的共同子集），必須定義：

  vec3 scene(vec2 fc)   // fc = gl_FragCoord.xy（像素，左下為原點），回傳 0–1 的顯示色（sRGB）

可以另外寫輔助函式與 const 常數。系統會在前面加上版本、精度、下列所有 uniform 與輔助函式，在後面加上 main()（總亮度、抖色、限制在 0–1），之後畫面還會經過素材層、歌詞排版層與 LED 安全模式（亮度上限、柔化、閃爍限制器、紅閃保護），所以你不需要、也不能自己處理安全。

uniform（全部由系統提供，不能自己宣告）：
  vec2  uRes              畫布像素（寬, 高）
  float uTime             場景時鐘（秒，依段落速度與能量累積，凍結時停止）
  float uClock            牆上時鐘（秒，給顆粒用）
  float uSongTime         歌曲時間（秒）
  float uSongProgress     整首歌進度 0–1
  float uSeed             這首歌固定的種子 0–1000
  float uBeat             拍內相位 0–1（拍點時歸零）
  float uBeatN            拍數計數（每拍 +1）
  float uBar              小節內相位 0–1（四拍一小節）
  float uTempo            每秒幾拍（BPM / 60；未知時 2.0）
  float uPulse            拍點衝擊 0–1（已經過 LED 安全的速率限制）
  float uEnergy           分析出的此刻能量 0–1
  float uLevel, uBass, uOnset   即時音訊：音量、低頻、起音 0–1
  float uIntensity        段落強度 × 操作員總強度（0–1.5，供參考；總強度會在 main() 再乘一次 uMaster）
  float uMaster           操作員總強度（0–1.5）
  float uReact            音樂反應程度 0–1（安全模式會壓低）
  float uSection          目前段落索引（0, 1, 2…）
  float uSectionKind      段落種類：0 intro 1 verse 2 pre-chorus 3 chorus 4 bridge 5 solo 6 breakdown 7 outro 8 interlude
  float uSectionEnergy    段落能量 0–1
  float uSectionProgress  段落內進度 0–1
  float uMode             這一段的模式（整數 0–3，由你在 sections 裡指定）
  vec4  uParams           這一段的四個參數 0–1（由你在 sections 裡指定）
  vec3  uBg, uPri, uAcc   這一段的配色：背景、主色、點綴
  vec3  uInk              這一段的歌詞色
  vec3  uPal0, uPal1, uPal2, uPal3, uPal4, uPal5   整首歌的色票（uPal0 最深；不足六色時重複）
  vec4  uZone             這一段的文字區（uv：x0, y0, x1, y1，y 向上，0–1）
  float uRelation         字與畫面的關係：0 plain 1 knockout 2 behind 3 lit
  vec4  uTypeBox          目前歌詞實際的範圍（uv：x0, y0, x1, y1；沒有歌詞時全為 0）
  float uTypeAmt          歌詞可見程度 0–1
  sampler2D uType, uMotif 歌詞字形與主視覺符號的貼圖：只能透過下面的 typeMask／typeGlow／motifMask 讀

輔助（已定義，直接用，不能重新定義）：
  PI, TAU; sat(x); rot(a) → mat2; hash11(p), hash12(p), hash22(p); vnoise(p); fbm(p)（5 階）; fbm3(p)（3 階）
  centered(fc) → 以短邊為 1、中心為原點的座標; aspect() → 寬/高; luma(c); ramp(t) → uBg→uPri→uAcc
  palette(t) → 沿 uPal0…uPal5 的漸層; px() → 一個像素在 centered 座標裡的大小（抗鋸齒）
  fill(d) / stroke(d, w) → 由距離場得到覆蓋率; sdCircle(p, r), sdBox(p, b), sdSegment(p, a, b)
  grain(fc, amount) → 顆粒; kick() → uPulse × uReact; isSection(k) → 目前段落種類是否為 k（1 或 0）
  zoneMask(uv, soft) → 文字區的柔和遮罩 0–1（只拿來決定形狀站哪裡、密度往哪邊變稀；不要用它把畫面乘暗：沒有歌詞時那會是一塊黑方塊）
  zoneCenter() → 文字區中心（uv）
  wordsMask(uv, soft) → 此刻螢幕上那一句字塊周圍的柔和遮罩 0–1，隨歌詞淡入淡出、沒有歌詞時為 0（要讓位給字就用這個）
  typeMask(uv) → 此刻歌詞字形的覆蓋率 0–1（字的形狀）; typeGlow(uv, r) → 字形周圍 r（uv）內的柔光 0–1
  motifMask(uv, bias) → 主視覺符號（白底透明）的覆蓋率

全域變數：
  float gFront            前景遮擋 0–1：你在 scene() 裡把它設成前景形狀的覆蓋率，
                          關係是 behind 的段落，字會從這個形狀後面經過（其他關係不影響）

規則（驗證器會拒絕違反的程式）：
  - 不能有 # 開頭的任何前處理指令（#extension、#define、#version…）
  - 不能宣告 uniform / attribute / varying / in / out / precision / sampler，不能用 texture 系列函式（只能用上面的輔助）
  - 不能定義 main，不能用 gl_ 開頭的名稱、discard、while、do、switch
  - 只能用 for 迴圈，而且必須是 for (int i = 常數; i < 常數; i++) 的形式，每個迴圈最多 48 次、巢狀相乘最多 256 次
  - 不能用 ES 3.00 才有的函式（round、trunc、tanh、sinh、cosh、inverse、transpose、determinant、isnan、isinf…）、uint、位元運算或 %
  - 整段程式不超過 16000 字元（不含註解），註解以外只能有 ASCII
  - 每個畫素的成本要合理：避免在迴圈裡再疊 fbm，5 階 fbm 一個畫面最多用六、七次`;

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

function header(gl2: boolean): string {
  return gl2
    ? `#version 300 es
precision highp float;
precision highp int;
out vec4 outColor;
#define FRAG outColor
#define TEX texture
`
    : `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define FRAG gl_FragColor
#define TEX texture2D
`;
}

export const PROGRAM_PRELUDE = /* glsl */ `
uniform vec2 uRes;
uniform float uTime;
uniform float uClock;
uniform float uSongTime;
uniform float uSongProgress;
uniform float uSeed;
uniform float uBeat;
uniform float uBeatN;
uniform float uBar;
uniform float uTempo;
uniform float uPulse;
uniform float uEnergy;
uniform float uLevel;
uniform float uBass;
uniform float uOnset;
uniform float uIntensity;
uniform float uMaster;
uniform float uReact;
uniform float uSection;
uniform float uSectionKind;
uniform float uSectionEnergy;
uniform float uSectionProgress;
uniform float uMode;
uniform vec4 uParams;
uniform vec3 uBg;
uniform vec3 uPri;
uniform vec3 uAcc;
uniform vec3 uInk;
uniform vec3 uPal0;
uniform vec3 uPal1;
uniform vec3 uPal2;
uniform vec3 uPal3;
uniform vec3 uPal4;
uniform vec3 uPal5;
uniform vec4 uZone;
uniform float uRelation;
uniform vec4 uTypeBox;
uniform float uTypeAmt;
uniform sampler2D uType;
uniform sampler2D uMotif;

float gFront;

#define PI 3.14159265
#define TAU 6.28318531

float sat(float x) { return clamp(x, 0.0, 1.0); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p + 3.7; a *= 0.5; }
  return v / 0.96875;
}
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = m * p + 3.7; a *= 0.5; }
  return v / 0.875;
}
vec2 centered(vec2 fc) { return (fc - 0.5 * uRes) / min(uRes.x, uRes.y); }
float aspect() { return uRes.x / uRes.y; }
float px() { return 1.5 / min(uRes.x, uRes.y); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 ramp(float t) {
  t = sat(t);
  vec3 c = mix(uBg, uPri, smoothstep(0.0, 0.62, t));
  return mix(c, uAcc, smoothstep(0.58, 1.0, t));
}
vec3 palette(float t) {
  t = sat(t) * 5.0;
  vec3 c = mix(uPal0, uPal1, sat(t));
  c = mix(c, uPal2, sat(t - 1.0));
  c = mix(c, uPal3, sat(t - 2.0));
  c = mix(c, uPal4, sat(t - 3.0));
  return mix(c, uPal5, sat(t - 4.0));
}
float fill(float d) { return 1.0 - smoothstep(-px(), px(), d); }
float stroke(float d, float w) { return 1.0 - smoothstep(w - px(), w + px(), abs(d)); }
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSegment(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a; vec2 ba = b - a; float h = sat(dot(pa, ba) / max(dot(ba, ba), 1e-6)); return length(pa - ba * h); }
float grain(vec2 fc, float amount) { return (hash12(fc * 0.9173 + vec2(fract(uClock * 7.13) * 517.0, fract(uClock * 3.71) * 389.0)) - 0.5) * amount; }
float kick() { return uPulse * uReact; }
float isSection(float k) { return 1.0 - step(0.5, abs(uSectionKind - k)); }
float zoneMask(vec2 uv, float soft) {
  vec2 a = smoothstep(uZone.xy - soft, uZone.xy + soft, uv);
  vec2 b = 1.0 - smoothstep(uZone.zw - soft, uZone.zw + soft, uv);
  return a.x * a.y * b.x * b.y;
}
vec2 zoneCenter() { return 0.5 * (uZone.xy + uZone.zw); }
float wordsMask(vec2 uv, float soft) {
  if (uTypeAmt < 0.002 || uTypeBox.z <= uTypeBox.x || uTypeBox.w <= uTypeBox.y) return 0.0;
  vec2 lo = uTypeBox.xy - 0.02;
  vec2 hi = uTypeBox.zw + 0.02;
  vec2 a = smoothstep(lo - soft, lo + soft, uv);
  vec2 b = 1.0 - smoothstep(hi - soft, hi + soft, uv);
  return a.x * a.y * b.x * b.y * uTypeAmt;
}
float typeMask(vec2 uv) {
  vec4 t = TEX(uType, clamp(uv, 0.0, 1.0));
  return max(max(t.r, t.g), t.b) * uTypeAmt;
}
float typeGlow(vec2 uv, float r) {
  float g = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.39;
    vec2 o = vec2(cos(a), sin(a) * aspect()) * r;
    vec4 t = TEX(uType, clamp(uv + o, 0.0, 1.0));
    g += t.a;
  }
  vec4 c = TEX(uType, clamp(uv, 0.0, 1.0));
  return sat((g / 8.0) * 0.8 + c.a * 0.2) * uTypeAmt;
}
float motifMask(vec2 uv, float bias) {
  vec2 e = smoothstep(vec2(0.0), vec2(0.06), uv) * smoothstep(vec2(1.0), vec2(0.94), uv);
  return TEX(uMotif, clamp(uv, 0.0, 1.0), bias).a * e.x * e.y;
}

#line 1
`;

export const PROGRAM_EPILOGUE = /* glsl */ `

void main() {
  gFront = 0.0;
  vec2 fc = gl_FragCoord.xy;
  vec3 col = scene(fc);
  col = max(col, 0.0) * clamp(uMaster, 0.0, 1.5);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float ign = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  col += (ign - 0.5) * (1.5 / 255.0) * step(0.003, l);
  // alpha carries 1 - the foreground: the type pass hides words behind it (relation "behind")
  FRAG = vec4(clamp(col, 0.0, 1.0), 1.0 - clamp(gFront, 0.0, 1.0));
}
`;

/** The complete fragment shader for a validated program body. */
export function buildProgramFragment(body: string, gl2: boolean): string {
  // "#line 1" keeps compile errors pointing at the program's own lines (GLSL ES 1.00 and 3.00)
  return header(gl2) + PROGRAM_PRELUDE + body + PROGRAM_EPILOGUE;
}

/** Map a compiler log's line numbers (after #line 1) to the program's lines, trimmed for the operator. */
export function tidyCompileLog(log: string): string {
  return String(log ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("\n")
    .slice(0, 600);
}
