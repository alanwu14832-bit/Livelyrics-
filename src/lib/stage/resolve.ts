// Pure derivation of "what should the stage look like right now" from the
// project (plan + lyrics) and a StageState snapshot. No DOM, no GL.

import { LYRIC_PLACEMENTS, LYRIC_STYLE_IDS, SCENE_IDS } from "../schema";
import { sectionIndexAt, sectionIndexForLine } from "../timeline";
import type { DesignPlan, LyricPlacement, LyricStyleId, Project, SceneId, SectionDesign } from "../types";
import { ensureContrast, isHex } from "./color";
import type { StageOverrides, StageState } from "./protocol";

export type TransitionKind = SectionDesign["transitionIn"];

export interface SceneParams {
  speed: number;
  density: number;
  intensity: number;
  reactivity: number;
}

export interface StageLook {
  sectionIndex: number | null;
  section: SectionDesign | null;
  scene: SceneId;
  params: SceneParams;
  /** [background, primary, accent] */
  colorway: [string, string, string];
  /** section lyric style (before per-line overrides) */
  lyricStyle: LyricStyleId;
  placement: LyricPlacement;
  /** section lyricScale × overrides.lyricScale */
  lyricScale: number;
  lyricColor: string;
  /** emphasis / highlight color, legible against the background */
  accentColor: string;
  transitionIn: TransitionKind;
  /** identifies scene + colors + params; equal keys look identical */
  lookKey: string;
}

export const DEFAULT_COLORWAY: [string, string, string] = ["#07080d", "#4b5bd6", "#ff5a36"];

const SCENE_SET = new Set<string>(SCENE_IDS);
const STYLE_SET = new Set<string>(LYRIC_STYLE_IDS);
const PLACEMENT_SET = new Set<string>(LYRIC_PLACEMENTS);
const TRANSITIONS = new Set<string>(["cut", "fade", "flash", "wipe", "bloom"]);

export function isSceneId(x: unknown): x is SceneId {
  return typeof x === "string" && SCENE_SET.has(x);
}
export function isLyricStyleId(x: unknown): x is LyricStyleId {
  return typeof x === "string" && STYLE_SET.has(x);
}
export function isPlacement(x: unknown): x is LyricPlacement {
  return typeof x === "string" && PLACEMENT_SET.has(x);
}

export function clamp(x: number, lo: number, hi: number, fallback = lo): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return fallback;
  return x < lo ? lo : x > hi ? hi : x;
}

/** Section index to display: the console's choice when valid, otherwise derived from t. */
export function resolveSectionIndex(plan: DesignPlan | null, state: StageState, t: number): number | null {
  if (!plan || !Array.isArray(plan.sections) || plan.sections.length === 0) return null;
  const idx = state.sectionIndex;
  if (typeof idx === "number" && Number.isInteger(idx) && idx >= 0 && idx < plan.sections.length) return idx;
  return sectionIndexAt(plan, t);
}

function resolveColorway(plan: DesignPlan | null, section: SectionDesign | null): [string, string, string] {
  const palette = (plan?.keyVisual?.palette ?? []).map((p) => p?.hex).filter(isHex);
  const cw = Array.isArray(section?.colorway) ? section.colorway : [];
  const pick = (i: number, fallback: string) => (isHex(cw[i]) ? cw[i] : isHex(palette[i]) ? palette[i] : fallback);
  return [pick(0, DEFAULT_COLORWAY[0]), pick(1, DEFAULT_COLORWAY[1]), pick(2, DEFAULT_COLORWAY[2])].map((c) =>
    c.toLowerCase(),
  ) as [string, string, string];
}

export function resolveLook(project: Project | null, state: StageState, t: number): StageLook {
  const plan = project?.plan ?? null;
  const overrides: StageOverrides = state.overrides;
  const sectionIndex = resolveSectionIndex(plan, state, t);
  const section = sectionIndex != null && plan ? (plan.sections[sectionIndex] ?? null) : null;

  const planScene: SceneId = section && isSceneId(section.scene) ? section.scene : "gradient";
  const scene: SceneId = isSceneId(overrides?.scene) ? overrides.scene : planScene;
  const sp = section?.sceneParams;
  const params: SceneParams = {
    speed: clamp(sp?.speed ?? 0.35, 0, 1, 0.35),
    density: clamp(sp?.density ?? 0.5, 0, 1, 0.5),
    intensity: clamp(sp?.intensity ?? 0.6, 0, 1, 0.6),
    reactivity: clamp(sp?.audioReactivity ?? 0.4, 0, 1, 0.4),
  };
  const colorway = resolveColorway(plan, section);
  const lyricColor = ensureContrast(isHex(section?.lyricColor) ? section.lyricColor : "#f5f3ef", colorway[0], 4.5);
  const accentColor = ensureContrast(colorway[2], colorway[0], 3);
  const lyricStyle: LyricStyleId = isLyricStyleId(section?.lyricStyle) ? section.lyricStyle : "line-fade";
  const placement: LyricPlacement = isPlacement(section?.lyricPlacement) ? section.lyricPlacement : "center";
  const lyricScale = clamp(section?.lyricScale ?? 1, 0.6, 1.8, 1) * clamp(overrides?.lyricScale ?? 1, 0.5, 2, 1);
  const transitionIn: TransitionKind = section && TRANSITIONS.has(section.transitionIn) ? section.transitionIn : "fade";
  const lookKey = [
    scene,
    colorway.join(","),
    params.speed.toFixed(3),
    params.density.toFixed(3),
    params.intensity.toFixed(3),
    params.reactivity.toFixed(3),
  ].join("|");

  return {
    sectionIndex,
    section,
    scene,
    params,
    colorway,
    lyricStyle,
    placement,
    lyricScale,
    lyricColor,
    accentColor,
    transitionIn,
    lookKey,
  };
}

export interface LineDesignResolved {
  style: LyricStyleId;
  emphasis: string[];
}

/** Operator override > per-line plan override > section style. */
export function resolveLineDesign(
  plan: DesignPlan | null,
  lineId: string | undefined,
  sectionStyle: LyricStyleId,
  overrideStyle: LyricStyleId | null | undefined,
): LineDesignResolved {
  const ld = lineId && plan?.lines ? plan.lines.find((l) => l.lineId === lineId) : undefined;
  const style = isLyricStyleId(overrideStyle)
    ? overrideStyle
    : isLyricStyleId(ld?.styleOverride)
      ? ld.styleOverride
      : sectionStyle;
  const emphasis = Array.isArray(ld?.emphasis) ? ld.emphasis.filter((e): e is string => typeof e === "string" && e.trim().length > 0) : [];
  return { style, emphasis };
}

/**
 * The look for the lyric layer: the current line's own section when it differs from the
 * playhead's (a pickup line keeps its section's style across the boundary). While the console
 * holds a section (保持段落) every line takes the held section's look.
 */
export function lyricLookAt(project: Project, state: StageState, t: number, look: StageLook): StageLook {
  const lines = project.lyrics?.lines;
  const idx = state.lineIndex;
  if (state.sectionHeld === true) return look;
  if (!project.plan || !Array.isArray(lines) || typeof idx !== "number" || !lines[idx]) return look;
  const duration = project.meta?.duration || project.analysis?.duration || 0;
  const own = sectionIndexForLine(project.plan, lines, idx, duration);
  if (own == null || own === look.sectionIndex) return look;
  return resolveLook(project, { ...state, sectionIndex: own }, t);
}
