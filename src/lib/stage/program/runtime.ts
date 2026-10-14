// 專屬畫面 (phase 7): the per-frame values of the uniform contract for the live stage (StageEngine)
// and the export (OfflineStage), from the project, the resolved look and the song clock. Pure.

import { parseHex, type RGB } from "../color";
import type { ProgramDraw } from "../gl/renderer";
import type { StageLook } from "../resolve";
import type { Project } from "../../types";
import { RELATION_CODE, SECTION_KIND_CODE } from "./contract";
import { activeProgram, canvasZone, planSection, programCode } from "./model";

export interface ProgramFrameInput {
  project: Project;
  look: StageLook;
  /** song time, seconds */
  t: number;
  /** 0..1 phase inside the beat and the beat counter */
  beat: number;
  beatIndex: number;
  /** the operator's master intensity (0..1.5) */
  master: number;
  /** the lyric's bounds (fractions of the canvas, x0, y0, x1, y1; y down) or null */
  typeBox: [number, number, number, number] | null;
  typeAmt: number;
  /** program keys this stage switched off (compile failure, over budget) */
  disabled?: ReadonlySet<string>;
  color?: (hex: string) => RGB;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * The program draw for this frame, or null: no active program, the operator forced a built-in
 * scene (overrides.scene), or this stage switched the program off.
 */
export function programFrame(f: ProgramFrameInput): ProgramDraw | null {
  const plan = f.project.plan;
  const program = activeProgram(plan);
  if (!program || !plan) return null;
  // an operator scene override (1–9) shows that built-in scene
  const planScene = f.look.section?.scene;
  if (f.look.section && planScene && f.look.scene !== planScene) return null;
  if (f.look.scene === "blackout") return null;
  const code = programCode(program);
  if (!code || f.disabled?.has(code.key)) return null;
  const color = f.color ?? parseHex;
  const s = planSection(plan, program, f.look.section, f.look.sectionIndex);
  const duration = f.project.meta?.duration || f.project.analysis?.duration || plan.sections[plan.sections.length - 1]?.end || 1;
  const sec = f.look.section;
  const progress = sec ? clamp01((f.t - sec.start) / Math.max(0.001, sec.end - sec.start)) : clamp01(f.t / duration);
  const hexes = (plan.keyVisual?.palette ?? []).map((p) => p?.hex).filter((h): h is string => typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h));
  const pal = hexes.length ? hexes : [...f.look.colorway];
  const palette = [0, 1, 2, 3, 4, 5].map((i) => color(pal[Math.min(i, pal.length - 1)])) as ProgramDraw["palette"];
  const bpm = f.project.analysis?.bpm;
  const out = f.project.output;
  const z = canvasZone(s.zone, out && out.width > 0 && out.height > 0 ? out.width / out.height : 16 / 9);
  const tb = f.typeBox;
  return {
    key: code.key,
    code: code.code,
    songTime: f.t,
    songProgress: clamp01(f.t / Math.max(1, duration)),
    bar: ((((f.beatIndex % 4) + 4) % 4) + clamp01(f.beat)) / 4,
    tempo: typeof bpm === "number" && bpm > 0 ? bpm / 60 : 2,
    master: f.master,
    section: f.look.sectionIndex ?? 0,
    sectionKind: sec ? (SECTION_KIND_CODE[sec.kind] ?? 1) : 1,
    sectionEnergy: clamp01(sec?.energy ?? 0.5),
    sectionProgress: progress,
    mode: s.mode,
    params: s.params,
    ink: color(f.look.lyricColor),
    palette,
    zone: [z.x, 1 - (z.y + z.h), z.x + z.w, 1 - z.y],
    relation: RELATION_CODE[s.relation] ?? 0,
    typeBox: tb ? [tb[0], 1 - tb[3], tb[2], 1 - tb[1]] : [0, 0, 0, 0],
    typeAmt: clamp01(f.typeAmt),
  };
}

/** The lookKey of a slot drawn with a program (the mode and parameters are part of the look). */
export function programLookKey(base: string, pd: ProgramDraw | null): string {
  return pd ? `${base}|p:${pd.key}:${pd.mode}:${pd.params.map((v) => v.toFixed(2)).join(",")}` : base;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const lerp4 = (a: readonly number[], b: readonly number[], t: number): [number, number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];

/** Where in a transition a mode that cannot be tweened switches: behind the flash's peak, else mid-sweep. */
export const MODE_CUT: Record<number, number> = { 1: 0.5, 2: 0.12, 3: 0.5, 4: 0.5 };

/**
 * Round 18 (M1): a section change between two states of the *same* program is one render, not a
 * cross-fade of two (which showed the planet / sun / slab twice where the composition has one).
 * The zone, the parameters, the section energy and the colours tween (eased) from the outgoing state
 * to the incoming one; the mode tweens between the open-ended modes 0–2 and otherwise switches at
 * `cut` (behind the transition's flash / sweep); the clocks and the words are the incoming state's.
 */
export function blendProgramDraw(prev: ProgramDraw, cur: ProgramDraw, progress: number, cut = 0.5): ProgramDraw {
  const p = clamp01(progress);
  const e = p * p * (3 - 2 * p);
  const tweenMode = prev.mode <= 2 && cur.mode <= 2;
  return {
    ...cur,
    sectionEnergy: lerp(prev.sectionEnergy, cur.sectionEnergy, e),
    mode: tweenMode ? lerp(prev.mode, cur.mode, e) : p < cut ? prev.mode : cur.mode,
    params: lerp4(prev.params, cur.params, e),
    ink: lerpRgb(prev.ink, cur.ink, e),
    palette: cur.palette.map((c, i) => lerpRgb(prev.palette[i] ?? c, c, e)) as ProgramDraw["palette"],
    zone: lerp4(prev.zone, cur.zone, e),
  };
}

/** Both slots of a transition draw the same program (the case `blendProgramDraw` merges). */
export function sameProgram(prev: { program?: ProgramDraw | null } | null | undefined, cur: { program?: ProgramDraw | null }): boolean {
  return !!prev?.program && !!cur.program && prev.program.key === cur.program.key;
}

/** The colours of a merged slot: the scene uniforms tween like the program's. */
export function blendSlotColors<T extends { bg: RGB; primary: RGB; accent: RGB }>(prev: T, cur: T, progress: number): T {
  const p = clamp01(progress);
  const e = p * p * (3 - 2 * p);
  return { ...cur, bg: lerpRgb(prev.bg, cur.bg, e), primary: lerpRgb(prev.primary, cur.primary, e), accent: lerpRgb(prev.accent, cur.accent, e) };
}
