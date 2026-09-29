// 專屬畫面 (phase 7): the scene program as data. Normalization (any stored or generated value → a
// usable program or null), what a section of the song asks of it (mode, parameters, the text zone
// and how the words meet the image), defaults by section kind when a section is missing (a plan
// re-designed after the program was written keeps working), and the key still's moment.
// Pure, shared by the server (normalizePlan, the designers) and the browser (renderer, type engine).

import { SCENE_PROGRAM_ENGINES, TYPE_RELATIONS } from "../../schema";
import type { DesignPlan, SceneProgram, SceneProgramSection, SectionDesign, SectionKind, TypeRelation, Zone } from "../../types";
import { programKey, validateProgram } from "./validate";

const clamp = (x: unknown, lo: number, hi: number, fb: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fb);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Smallest text zone (fractions of the canvas): a line must still fit at a readable size. */
export const MIN_ZONE_W = 0.3;
export const MIN_ZONE_H = 0.24;

/** A section's program state when nothing was written for it (by kind: verse sparse, chorus open…). */
export const KIND_DEFAULTS: Record<SectionKind, { mode: number; params: [number, number, number, number] }> = {
  intro: { mode: 0, params: [0.15, 0.2, 0.3, 0.3] },
  verse: { mode: 0, params: [0.3, 0.35, 0.4, 0.4] },
  "pre-chorus": { mode: 1, params: [0.55, 0.5, 0.55, 0.55] },
  chorus: { mode: 2, params: [0.85, 0.7, 0.8, 0.7] },
  bridge: { mode: 3, params: [0.5, 0.45, 0.5, 0.5] },
  solo: { mode: 2, params: [0.75, 0.8, 0.7, 0.85] },
  breakdown: { mode: 3, params: [0.25, 0.3, 0.3, 0.3] },
  outro: { mode: 0, params: [0.15, 0.25, 0.25, 0.2] },
  interlude: { mode: 1, params: [0.35, 0.4, 0.45, 0.45] },
};

export const DEFAULT_ZONE: Zone = { x: 0.08, y: 0.12, w: 0.44, h: 0.62 };

export function normalizeZone(raw: unknown, fallback: Zone = DEFAULT_ZONE): Zone {
  const z = (raw && typeof raw === "object" ? raw : {}) as Partial<Zone>;
  let w = clamp(z.w, MIN_ZONE_W, 0.92, fallback.w);
  let h = clamp(z.h, MIN_ZONE_H, 0.9, fallback.h);
  const x = clamp(z.x, 0.04, 0.96 - w, fallback.x);
  const y = clamp(z.y, 0.04, 0.94 - h, fallback.y);
  w = Math.min(w, 0.96 - x);
  h = Math.min(h, 0.94 - y);
  return { x: r3(x), y: r3(y), w: r3(w), h: r3(h) };
}

/**
 * The zone on a real canvas. Zones are written for a landscape frame; on a tall canvas (9:16) a
 * side zone becomes a band across the frame — a left zone the upper band, a right zone the lower
 * one — so the words alternate between the top and the bottom of the picture across the song and
 * the program's focal form (placed opposite uZone) takes the other half. Wide zones keep their
 * height and span the frame.
 */
export function canvasZone(zone: Zone, aspect: number): Zone {
  if (!(aspect < 0.8)) return zone;
  const cx = zone.x + zone.w / 2;
  if (zone.w > 0.62) return { x: 0.07, y: zone.y, w: 0.86, h: zone.h };
  if (cx < 0.45) return { x: 0.07, y: 0.1, w: 0.86, h: 0.36 };
  if (cx > 0.55) return { x: 0.07, y: 0.5, w: 0.86, h: 0.34 };
  return { x: 0.07, y: Math.max(0.1, Math.min(0.5, zone.y)), w: 0.86, h: Math.min(0.4, zone.h) };
}

function relationOf(v: unknown, fallback: TypeRelation = "plain"): TypeRelation {
  return typeof v === "string" && (TYPE_RELATIONS as readonly string[]).includes(v) ? (v as TypeRelation) : fallback;
}

export interface NormalizeProgramOptions {
  /** the plan's sections (ids and kinds); sections of the program for other ids are dropped */
  sections?: readonly Pick<SectionDesign, "id" | "kind">[];
  /** repairs in 繁中 */
  repairs?: string[];
}

/**
 * A usable program from any value, or null (not an object, or code the validator refuses). Missing
 * sections get their kind's defaults; values are clamped; unknown fields are dropped.
 */
export function normalizeSceneProgram(raw: unknown, opts: NormalizeProgramOptions = {}): SceneProgram | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const checked = validateProgram(r.source);
  if (!checked.ok) {
    opts.repairs?.push(`專屬畫面的程式沒有通過檢查，改用內建場景：${checked.errors.slice(0, 3).join("；")}`);
    return null;
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    if (s && typeof s === "object" && typeof (s as { sectionId?: unknown }).sectionId === "string") byId.set((s as { sectionId: string }).sectionId, s as Record<string, unknown>);
  }
  const plan = opts.sections ?? [...byId.keys()].map((id) => ({ id, kind: "verse" as SectionKind }));
  let filled = 0;
  const sections: SceneProgramSection[] = plan.map((ps) => {
    const s = byId.get(ps.id);
    const d = KIND_DEFAULTS[ps.kind] ?? KIND_DEFAULTS.verse;
    if (!s) filled++;
    const params = Array.isArray(s?.params) ? (s!.params as unknown[]) : [];
    return {
      sectionId: ps.id,
      mode: Math.round(clamp(s?.mode, 0, 3, d.mode)),
      params: [0, 1, 2, 3].map((i) => r3(clamp(params[i], 0, 1, d.params[i]))),
      zone: normalizeZone(s?.zone),
      relation: relationOf(s?.relation),
      note: typeof s?.note === "string" ? s.note.slice(0, 200) : "",
    };
  });
  if (filled && opts.sections && byId.size) opts.repairs?.push(`專屬畫面補上 ${filled} 個段落的預設狀態`);
  const engine = typeof r.engine === "string" && (SCENE_PROGRAM_ENGINES as readonly string[]).includes(r.engine) ? (r.engine as SceneProgram["engine"]) : "manual";
  const out: SceneProgram = {
    version: 1,
    engine,
    title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 40) : "專屬畫面",
    concept: typeof r.concept === "string" ? r.concept.trim().slice(0, 400) : "",
    source: String(r.source),
    sections,
    keyMoment: typeof r.keyMoment === "number" && Number.isFinite(r.keyMoment) && r.keyMoment >= 0 ? r3(r.keyMoment) : null,
    enabled: r.enabled !== false,
  };
  if (typeof r.model === "string" && r.model) out.model = r.model.slice(0, 80);
  if (typeof r.createdAt === "string") out.createdAt = r.createdAt;
  if (typeof r.instruction === "string" && r.instruction.trim()) out.instruction = r.instruction.trim().slice(0, 500);
  if (typeof r.recipe === "string" && r.recipe) out.recipe = r.recipe.slice(0, 200);
  return out;
}

/** The plan's program when it is switched on (the renderer and the type engine follow it). */
export function activeProgram(plan: DesignPlan | null | undefined): SceneProgram | null {
  const p = plan?.sceneProgram;
  if (!p || typeof p !== "object" || p.enabled === false || typeof p.source !== "string" || !Array.isArray(p.sections)) return null;
  return p;
}

/** What one section asks of the program (defaults by kind when the program has no entry). */
export interface ProgramSectionState {
  mode: number;
  params: [number, number, number, number];
  zone: Zone;
  relation: TypeRelation;
}

export function programSection(program: SceneProgram, section: Pick<SectionDesign, "id" | "kind"> | null | undefined, index: number | null): ProgramSectionState {
  const s = (section ? program.sections.find((x) => x?.sectionId === section.id) : undefined) ?? (index != null ? program.sections[index] : undefined);
  const d = KIND_DEFAULTS[section?.kind ?? "verse"] ?? KIND_DEFAULTS.verse;
  const params = Array.isArray(s?.params) ? s!.params : d.params;
  return {
    mode: Math.round(clamp(s?.mode, 0, 3, d.mode)),
    params: [0, 1, 2, 3].map((i) => clamp(params[i], 0, 1, d.params[i])) as [number, number, number, number],
    zone: normalizeZone(s?.zone),
    relation: relationOf(s?.relation),
  };
}

/** A section's program state as a key ("" without an active program): two sections with the same key look alike. */
export function programModeKey(plan: DesignPlan | null | undefined, section: Pick<SectionDesign, "id" | "kind"> | null | undefined, index: number | null): string {
  const program = activeProgram(plan);
  if (!program) return "";
  const s = programSection(program, section, index);
  return `${s.mode}:${s.params.map((v) => v.toFixed(2)).join(",")}`;
}

const compiled = new WeakMap<object, { code: string; key: string } | null>();

/** The program's compilable code and its cache key (validated again: it came over a channel), or null. */
export function programCode(program: SceneProgram): { code: string; key: string } | null {
  if (compiled.has(program)) return compiled.get(program) ?? null;
  const v = validateProgram(program.source);
  const out = v.ok ? { code: v.code, key: programKey(v.code) } : null;
  compiled.set(program, out);
  return out;
}

/**
 * The text zone and relation of section `index` for the type engine (null without an active
 * program: the type uses the whole readable area, as before).
 */
export function sectionComposition(plan: DesignPlan | null | undefined, index: number | null, aspect = 16 / 9): { zone: Zone; relation: TypeRelation } | null {
  const program = activeProgram(plan);
  if (!program || index == null) return null;
  const section = plan?.sections?.[index];
  if (!section) return null;
  const s = programSection(program, section, index);
  return { zone: canvasZone(s.zone, aspect), relation: s.relation };
}

/** The key still's song time: the program's own moment, else 60 % into the first chorus (or the loudest section). */
export function keyMomentOf(plan: DesignPlan, duration: number): number {
  const own = plan.sceneProgram?.keyMoment;
  if (typeof own === "number" && Number.isFinite(own) && own >= 0 && (!duration || own <= duration)) return own;
  const sections = plan.sections ?? [];
  let s = sections.find((x) => x.kind === "chorus");
  if (!s) s = [...sections].sort((a, b) => b.energy - a.energy)[0];
  if (!s) return Math.max(0, duration * 0.4);
  return s.start + (s.end - s.start) * 0.6;
}
