// 專屬畫面 (round 12): the luminance probe. A program is rendered on the CPU (glsl-eval.ts) at a
// low resolution for every section state it will run in — the plan's palette, the section's
// colourway, the mode and parameters, no lyric on screen — and measured: the mean luminance and
// the lit-area fraction (pixels above mid luminance). A program that whites out the wall (the
// instrumental's full-frame god rays of the audit) fails like any other validation failure: the
// Claude step gets a repair turn with the numbers, the design step falls back to the composer.
// Thresholds follow the design system's restraint rule (「亮部只佔畫面的一小部分」) and the LED
// safety intent (a wall at 70 % is already bright).

import type { DesignPlan, SceneProgram, SceneProgramSection, SectionDesign } from "../../types";
import { parseHex } from "../color";
import { rgbToOklch } from "../oklch";
import { compileForCpu, isGlslError, type Uniforms } from "./glsl-eval";
import { RELATION_CODE, SECTION_KIND_CODE } from "./contract";
import { canvasZone, KIND_DEFAULTS, normalizeZone } from "./model";
import { validateProgram } from "./validate";

/** Lit-area fraction (luma > PROBE_MID) a section state may reach. */
export const PROBE_LIT_MAX = 0.35;
/** Mean luminance a section state may reach. */
export const PROBE_MEAN_MAX = 0.42;
/** Below this mean luminance a state is 「幾乎全黑」 (a warning: an intro may want it). */
export const PROBE_BLACK_MEAN = 0.012;
/** Mid luminance: the lit-area threshold (sRGB luma of the displayed colour). */
export const PROBE_MID = 0.5;
/**
 * Round 23: the coverage threshold — what reads as "something lit" on a dark LED wall (sRGB luma
 * 0.2). A verse keeps under 10 % of the frame above it, a chorus opens to 25–45 % (`cover`).
 */
export const PROBE_COVER = 0.2;
/**
 * Round 13: a chorus must reach a visible protagonist. Measured with the words on screen (the type
 * box over the section's zone, so the form gives way under them as it does live), over the picture
 * around the words: its mean luminance may not fall below this floor, nor below the brightest verse
 * of the song (a chorus darker than its verse is a failure: the audit's dim orbits behind the giant word).
 */
export const PROBE_CHORUS_FLOOR = 0.08;
/** a chorus may be this much darker than the verse before it fails (measurement noise) */
export const PROBE_CHORUS_TOLERANCE = 0.003;

/** Default sample grid (columns × rows): enough for area fractions, cheap on the server. */
export const PROBE_GRID: [number, number] = [32, 18];

export interface ProbeSample {
  sectionId: string;
  kind: string;
  mode: number;
  /** mean sRGB luma 0–1 */
  mean: number;
  /** fraction of samples above PROBE_MID */
  lit: number;
  /** fraction of samples below 0.04 */
  dark: number;
  /** mean sRGB luma of the picture around the words, with the words on screen (the type box over the zone) */
  around: number;
  /** round 23: fraction of samples above PROBE_COVER (how much of the wall the picture covers) */
  cover: number;
  /** round 23: the horizontal centre (0–1) of the samples above PROBE_COVER — where the subject stands; null when none */
  cx: number | null;
  /** round 25: the vertical centre (0–1, from the top) of the samples above PROBE_COVER; null when none */
  cy?: number | null;
  /** round 25: the brightest sample's sRGB luma */
  max?: number;
  /** round 25: separate lit shapes (4-connected groups of ≥ 2 samples above PROBE_COVER) */
  subjects?: number;
  /** round 25: the largest lit shape's share of the lit samples (0–1; one focal subject reads near 1) */
  focus?: number;
  /** round 25: samples that came out NaN / infinite */
  nan?: number;
  /** round 25: fraction of samples pushed to (near) white — sRGB luma above PROBE_WHITE */
  white?: number;
  /**
   * Round 27 (N1/N6): what the eye sees behind the words. With the words on screen (uTypeBox over the
   * text box, uTypeAmt 1 — the program's wordsMask clears what it clears), sampled on a finer grid
   * inside the padded box: the fraction of it lit above PROBE_BOX_LIT (light ink loses contrast there)…
   */
  boxLit?: number;
  /** …and how busy it is: the fraction of neighbouring sample pairs whose luma differs by more than PROBE_EDGE */
  boxEdge?: number;
  /**
   * Round 28 (N2): the colour of what is lit — the mean OKLCH lightness and chroma of the samples above
   * PROBE_COVER. A subject that reads near-white (L above PROBE_SUBJECT_L_MAX, chroma under
   * PROBE_SUBJECT_C_MIN) has lost the palette's hue.
   */
  subjectL?: number;
  subjectC?: number;
}

/** Round 28: a lit area's mean OKLCH chroma below this reads as grey or white, not as the palette's colour. */
export const PROBE_SUBJECT_C_MIN = 0.03;
/** Round 28: …and its mean OKLCH lightness above this is a white subject. */
export const PROBE_SUBJECT_L_MAX = 0.9;

/**
 * Round 27: the text boxes a state is measured in — the section's zone, and in a chorus (where a line
 * that cannot reach its floor becomes a poster across the readable width, type/compose.ts) the band
 * x 0.06–0.94 at the zone's height. uv, y up: [x0, y0, x1, y1].
 */
export function textBoxes(zone: readonly number[], kind: string): Array<[number, number, number, number]> {
  const z: [number, number, number, number] = [zone[0], zone[1], zone[2], zone[3]];
  return kind === "chorus" ? [z, [0.06, zone[1], 0.94, zone[3]]] : [z];
}
/** Round 27: behind light ink, picture above this sRGB luma costs the line its contrast (≈ 4.5:1 against ink at 0.9). */
export const PROBE_BOX_LIT = 0.4;
/** Round 27: a luma step between neighbouring box samples that reads as an edge (a stripe, a ring, a disc's rim). */
export const PROBE_EDGE = 0.12;
/** Round 27: the sample grid inside a text box (finer than the frame grid: thin stripes must be seen). */
export const PROBE_BOX_GRID: [number, number] = [28, 16];
/** Round 27: the box is padded by this much (uv) on every side, as the type layer's glow and pocket reach. */
export const PROBE_BOX_PAD = 0.02;

/** Round 25: what reads as white on the wall (sRGB luma); a highlight may touch it, an area may not. */
export const PROBE_WHITE = 0.95;

/**
 * Round 25: the lit shapes of a coverage mask (cols × rows, row-major) as the eye groups them — the
 * squint test: lit cells one cell apart (a row of printed bars, ribbons side by side) read as one
 * shape. Returns the count of groups of ≥ 2 lit cells and the largest group's share of the lit cells.
 */
export function litShapes(lit: readonly boolean[], cols: number, rows: number): { subjects: number; focus: number } {
  // dilate by one cell (8-neighbourhood) to group, then count only the lit cells of each group
  const mask: boolean[] = new Array(cols * rows).fill(false);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (!lit[j * cols + i]) continue;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < cols && nj < rows) mask[nj * cols + ni] = true;
        }
    }
  const seen = new Uint8Array(cols * rows);
  let subjects = 0;
  let largest = 0;
  let total = 0;
  const stack: number[] = [];
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k] || seen[k]) continue;
    let size = 0;
    stack.push(k);
    seen[k] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      if (lit[c]) size++;
      const i = c % cols;
      const j = (c - i) / cols;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = nj * cols + ni;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (!size) continue;
    total += size;
    if (size >= 2) subjects++;
    largest = Math.max(largest, size);
  }
  return { subjects, focus: total ? largest / total : 0 };
}

export interface ProbeResult {
  /** false when a state breaks the thresholds (errors say which) */
  ok: boolean;
  errors: string[];
  warnings: string[];
  samples: ProbeSample[];
  /** the evaluator could not run the program (unsupported syntax): ok stays true, warnings say so */
  unsupported?: string;
}

export interface ProbeOptions {
  /** the plan's sections (kinds, colourways, lyric colours); the program's own states otherwise */
  sections?: readonly SectionDesign[];
  /** the key visual palette (hex), uPal0… */
  palette?: readonly string[];
  grid?: [number, number];
  /** output size the zones are written for */
  res?: [number, number];
  /** song time of the probe (the section's middle by default) */
  time?: number;
}

const FALLBACK_PALETTE = ["#0b0d11", "#2a3b57", "#567aab", "#68a2c0", "#d7dee8", "#141a24"];
const rgb = (hex: string | undefined, fb: string): [number, number, number] => {
  const c = parseHex(typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fb);
  return [c[0], c[1], c[2]];
};
const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function stateUniforms(program: SceneProgram, ps: SceneProgramSection, section: SectionDesign | undefined, index: number, total: number, opts: ProbeOptions): Uniforms {
  const res = opts.res ?? [1920, 1080];
  const pal = (opts.palette?.length ? [...opts.palette] : FALLBACK_PALETTE).filter((h) => typeof h === "string");
  const kind = section?.kind ?? "verse";
  const d = KIND_DEFAULTS[kind] ?? KIND_DEFAULTS.verse;
  const cw = section?.colorway ?? [];
  const z = canvasZone(normalizeZone(ps.zone), res[0] / res[1]);
  const energy = typeof section?.energy === "number" ? Math.min(1, Math.max(0, section.energy)) : d.params[2];
  const mid = section ? (section.start + section.end) / 2 : 20 + index * 16;
  const t = opts.time ?? mid;
  const uPal = [0, 1, 2, 3, 4, 5].map((i) => rgb(pal[Math.min(i, pal.length - 1)], FALLBACK_PALETTE[i]));
  return {
    uRes: res,
    uTime: 12 + index * 7.3,
    uClock: 40 + index * 3.1,
    uSongTime: t,
    uSongProgress: total > 0 ? Math.min(1, (index + 0.5) / total) : 0.5,
    uSeed: 137,
    uBeat: 0.35,
    uBeatN: 40 + index,
    uBar: 0.34,
    uTempo: 2,
    uPulse: 0,
    uEnergy: energy,
    uLevel: 0.35 * energy,
    uBass: 0.3 * energy,
    uOnset: 0,
    uIntensity: 0.5 + 0.5 * energy,
    uMaster: 1,
    uReact: 0.5,
    uSection: index,
    uSectionKind: SECTION_KIND_CODE[kind] ?? 1,
    uSectionEnergy: energy,
    uSectionProgress: 0.5,
    uMode: ps.mode,
    uParams: [ps.params[0] ?? d.params[0], ps.params[1] ?? d.params[1], ps.params[2] ?? d.params[2], ps.params[3] ?? d.params[3]],
    uBg: rgb(cw[0], pal[0] ?? FALLBACK_PALETTE[0]),
    uPri: rgb(cw[1], pal[1] ?? FALLBACK_PALETTE[1]),
    uAcc: rgb(cw[2], pal[2] ?? FALLBACK_PALETTE[2]),
    uInk: rgb(section?.lyricColor, "#f2f2f2"),
    uPal,
    uZone: [z.x, 1 - (z.y + z.h), z.x + z.w, 1 - z.y],
    uRelation: RELATION_CODE[ps.relation] ?? 0,
    uTypeBox: [0, 0, 0, 0],
    uTypeAmt: 0,
  };
}

const cache = new WeakMap<object, ProbeResult>();

/**
 * Measure a program in every section state. Deterministic. Never throws: a program the evaluator
 * cannot run is reported as `unsupported` (ok: true, one warning).
 */
export function probeSceneProgram(program: SceneProgram, opts: ProbeOptions = {}): ProbeResult {
  const key = opts.sections ?? program;
  const hit = !opts.grid && !opts.time ? cache.get(program) : undefined;
  if (hit && hit.samples.length && (hit as { sectionsKey?: object }).sectionsKey === key) return hit;
  const checked = validateProgram(program.source);
  if (!checked.ok) return { ok: false, errors: checked.errors, warnings: [], samples: [] };
  const [cols, rows] = opts.grid ?? PROBE_GRID;
  const res = opts.res ?? [1920, 1080];
  const states: Array<{ ps: SceneProgramSection; section?: SectionDesign }> = [];
  if (opts.sections?.length) {
    for (const s of opts.sections) {
      const ps = program.sections.find((x) => x.sectionId === s.id);
      const d = KIND_DEFAULTS[s.kind] ?? KIND_DEFAULTS.verse;
      states.push({ ps: ps ?? { sectionId: s.id, mode: d.mode, params: [...d.params], zone: normalizeZone(null), relation: "plain", note: "" }, section: s });
    }
  } else for (const ps of program.sections) states.push({ ps });
  // the same state twice (two choruses with the same mode and parameters) is measured once
  const seen = new Map<string, ProbeSample>();
  const samples: ProbeSample[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let compiled: ReturnType<typeof compileForCpu> | null = null;
  try {
    states.forEach(({ ps, section }, index) => {
      const u = stateUniforms(program, ps, section, index, states.length, opts);
      const sig = `${ps.mode}|${u.uParams.join(",")}|${u.uBg.join(",")}|${u.uPri.join(",")}|${u.uAcc.join(",")}|${u.uZone.join(",")}|${u.uSectionKind}`;
      const kind = section?.kind ?? "verse";
      const prev = seen.get(sig);
      if (prev) {
        samples.push({ ...prev, sectionId: ps.sectionId, kind });
        return;
      }
      if (!compiled) compiled = compileForCpu(checked.code, u);
      else compiled.setUniforms(u);
      let sum = 0;
      let lit = 0;
      let dark = 0;
      let cover = 0;
      let cxSum = 0;
      let cySum = 0;
      let max = 0;
      let nan = 0;
      let white = 0;
      let subL = 0;
      let subC = 0;
      const mask: boolean[] = new Array(cols * rows).fill(false);
      const n = cols * rows;
      const at = (i: number, j: number): [number, number] => [((i + 0.5) / cols) * res[0], ((j + 0.5) / rows) * res[1]];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const col = compiled.scene(at(i, j)).color;
          const raw = luma(col);
          if (!Number.isFinite(raw)) nan++;
          const l = Number.isFinite(raw) ? raw : 0;
          sum += l;
          if (l > max) max = l;
          if (l > PROBE_WHITE) white++;
          if (l > PROBE_MID) lit++;
          if (l < 0.04) dark++;
          if (l > PROBE_COVER) {
            cover++;
            const ok = rgbToOklch([Math.max(0, Math.min(1, col[0])), Math.max(0, Math.min(1, col[1])), Math.max(0, Math.min(1, col[2]))]);
            subL += ok.L;
            subC += ok.C;
            cxSum += (i + 0.5) / cols;
            // fc has its origin at the bottom: row j counts up, cy reads from the top
            cySum += 1 - (j + 0.5) / rows;
            mask[j * cols + i] = true;
          }
        }
      }
      // round 27: the text boxes with the words on screen — lit and busy picture behind the words
      let boxLit = 0;
      let boxEdge = 0;
      for (const tb of textBoxes(u.uZone, kind)) {
        compiled.setUniforms({ ...u, uTypeBox: tb, uTypeAmt: 1 });
        const [bc, br] = PROBE_BOX_GRID;
        const x0 = Math.max(0, tb[0] - PROBE_BOX_PAD);
        const y0 = Math.max(0, tb[1] - PROBE_BOX_PAD);
        const x1 = Math.min(1, tb[2] + PROBE_BOX_PAD);
        const y1 = Math.min(1, tb[3] + PROBE_BOX_PAD);
        if (x1 <= x0 || y1 <= y0) continue;
        const L = new Float64Array(bc * br);
        let litN = 0;
        for (let j = 0; j < br; j++)
          for (let i = 0; i < bc; i++) {
            const raw = luma(compiled.scene([(x0 + ((i + 0.5) / bc) * (x1 - x0)) * res[0], (y0 + ((j + 0.5) / br) * (y1 - y0)) * res[1]]).color);
            const l = Number.isFinite(raw) ? raw : 0;
            L[j * bc + i] = l;
            if (l > PROBE_BOX_LIT) litN++;
          }
        let edges = 0;
        let pairs = 0;
        for (let j = 0; j < br; j++)
          for (let i = 0; i < bc; i++) {
            const l = L[j * bc + i];
            if (i + 1 < bc) {
              pairs++;
              if (Math.abs(L[j * bc + i + 1] - l) > PROBE_EDGE) edges++;
            }
            if (j + 1 < br) {
              pairs++;
              if (Math.abs(L[(j + 1) * bc + i] - l) > PROBE_EDGE) edges++;
            }
          }
        boxLit = Math.max(boxLit, litN / (bc * br));
        boxEdge = Math.max(boxEdge, pairs ? edges / pairs : 0);
      }
      // the same state with the words on screen: the type box over the zone, measured around it
      const box = u.uZone;
      compiled.setUniforms({ ...u, uTypeBox: box, uTypeAmt: 1 });
      let aroundSum = 0;
      let aroundN = 0;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const fc = at(i, j);
          const x = fc[0] / res[0];
          const y = fc[1] / res[1];
          if (x > box[0] - 0.02 && x < box[2] + 0.02 && y > box[1] - 0.02 && y < box[3] + 0.02) continue;
          aroundSum += luma(compiled.scene(fc).color);
          aroundN++;
        }
      }
      compiled.setUniforms(u);
      const r3 = (x: number) => Math.round(x * 1000) / 1000;
      const sample: ProbeSample = { sectionId: ps.sectionId, kind, mode: ps.mode, mean: r3(sum / n), lit: r3(lit / n), dark: r3(dark / n), around: r3(aroundN ? aroundSum / aroundN : sum / n), cover: r3(cover / n), cx: cover ? r3(cxSum / cover) : null, cy: cover ? r3(cySum / cover) : null, max: r3(max), ...((({ subjects, focus }) => ({ subjects, focus: r3(focus) }))(litShapes(mask, cols, rows))), nan, white: r3(white / n), boxLit: r3(boxLit), boxEdge: r3(boxEdge), subjectL: cover ? r3(subL / cover) : 0, subjectC: cover ? r3(subC / cover) : 0 };
      seen.set(sig, sample);
      samples.push(sample);
    });
  } catch (e) {
    const msg = isGlslError(e) ? e.message : e instanceof Error ? e.message : String(e);
    const out: ProbeResult = { ok: true, errors: [], warnings: [`亮度探針無法評估這支程式（${msg}），略過亮度檢查`], samples, unsupported: msg };
    return out;
  }
  const label = (s: ProbeSample) => `${s.sectionId}（${s.kind}，mode ${s.mode}）`;
  for (const s of samples) {
    if (s.lit > PROBE_LIT_MAX) errors.push(`${label(s)}：亮部佔畫面 ${Math.round(s.lit * 100)}%，上限 ${Math.round(PROBE_LIT_MAX * 100)}%——把亮的形狀縮小、光暈收短，大部分畫面留暗`);
    else if (s.mean > PROBE_MEAN_MAX) errors.push(`${label(s)}：平均亮度 ${s.mean.toFixed(2)}，上限 ${PROBE_MEAN_MAX}——整體壓暗，亮只留給主角形狀`);
    if (s.mean < PROBE_BLACK_MEAN && s.lit === 0) warnings.push(`${label(s)}：畫面幾乎全黑（平均亮度 ${s.mean.toFixed(3)}），這一段沒有東西可看`);
  }
  // the chorus is where the picture opens: with the words on screen it must stay visible and never
  // be darker than the song's verse
  const verseAround = Math.max(0, ...samples.filter((s) => s.kind === "verse").map((s) => s.around));
  for (const s of samples) {
    if (s.kind !== "chorus") continue;
    if (s.around < PROBE_CHORUS_FLOOR) errors.push(`${label(s)}：副歌字的周圍平均亮度只有 ${s.around.toFixed(3)}，下限 ${PROBE_CHORUS_FLOOR}——副歌要有看得見的主角（用 uPri／uAcc 的形狀、亮的核心或軌跡）`);
    else if (s.around < verseAround - PROBE_CHORUS_TOLERANCE) errors.push(`${label(s)}：副歌（${s.around.toFixed(3)}）比主歌（${verseAround.toFixed(3)}）還暗——副歌應該打開畫面`);
  }
  const uniq = (xs: string[]) => [...new Set(xs)];
  const out: ProbeResult & { sectionsKey?: object } = { ok: errors.length === 0, errors: uniq(errors).slice(0, 8), warnings: uniq(warnings).slice(0, 8), samples };
  out.sectionsKey = key;
  if (!opts.grid && !opts.time) cache.set(program, out);
  return out;
}

/** The probe over a plan's sections and palette (what the designer checks before keeping a program). */
export function probePlanProgram(program: SceneProgram, plan: Pick<DesignPlan, "sections" | "keyVisual">, opts: Omit<ProbeOptions, "sections" | "palette"> = {}): ProbeResult {
  return probeSceneProgram(program, { ...opts, sections: plan.sections, palette: (plan.keyVisual?.palette ?? []).map((p) => p?.hex).filter((h): h is string => typeof h === "string") });
}
