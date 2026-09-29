// 設計方向提案 (phase 4): the pure side of design directions, shared by the server routes and
// the browser. Coercion of stored sets, the select / undo / comment transforms on a project
// draft, the style-frame moments of a plan and the data of the band sign-off sheet (一頁提案).

import { DesignPlanSchema } from "./schema";
import type {
  DesignDirection,
  DesignPlan,
  DirectionComment,
  DirectionEngine,
  DirectionReference,
  DirectionSet,
  DirectionStatus,
  Lyrics,
  MoodImage,
  PlanSnapshot,
  PlanSource,
  Project,
} from "./types";

export const DIRECTION_LETTERS = ["A", "B", "C"] as const;
export const MIN_DIRECTIONS = 2;
export const MAX_DIRECTIONS = 3;
export const MAX_COMMENT = 600;
export const MAX_COMMENTS = 30;

export const DIRECTION_STATUS_LABEL: Record<DirectionStatus, string> = { proposed: "提案中", selected: "已選定", rejected: "已退回" };

const ID_RE = /^d[a-f0-9]{8}$/;
const STATUSES: readonly DirectionStatus[] = ["proposed", "selected", "rejected"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number, fallback = ""): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

/** Comment text: control characters dropped (line breaks kept), trimmed, at most MAX_COMMENT. */
export function sanitizeComment(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_COMMENT);
}

function coerceComments(v: unknown): DirectionComment[] {
  if (!Array.isArray(v)) return [];
  const out: DirectionComment[] = [];
  for (const c of v) {
    if (!isRecord(c)) continue;
    const text = sanitizeComment(c.text);
    if (!text) continue;
    out.push({ id: str(c.id, 40) || `c${out.length}`, text, at: str(c.at, 40), kind: c.kind === "revision" ? "revision" : "comment" });
  }
  return out.slice(-MAX_COMMENTS);
}

function coerceReferences(v: unknown): DirectionReference[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isRecord)
    .map((r) => ({ imageId: str(r.imageId, 40), cue: str(r.cue, 300) }))
    .filter((r) => r.imageId)
    .slice(0, 12);
}

const ENGINES: readonly DirectionEngine[] = ["claude", "offline", "manual-claude"];
const engineOf = (v: unknown): DirectionEngine => (ENGINES.includes(v as DirectionEngine) ? (v as DirectionEngine) : "offline");

/** One stored direction, or null when its plan no longer validates. */
export function coerceDirection(raw: unknown, index: number): DesignDirection | null {
  if (!isRecord(raw)) return null;
  const checked = DesignPlanSchema.safeParse(raw.plan);
  if (!checked.success || !checked.data.sections.length) return null;
  const id = typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : `d${(index + 1).toString(16).padStart(8, "0")}`;
  const d: DesignDirection = {
    id,
    letter: typeof raw.letter === "string" && /^[A-Z]$/.test(raw.letter) ? raw.letter : DIRECTION_LETTERS[index] ?? String.fromCharCode(65 + index),
    name: str(raw.name, 60) || checked.data.keyVisual.title,
    pitch: str(raw.pitch, 300),
    rationale: str(raw.rationale, 4000),
    references: coerceReferences(raw.references),
    sceneTendency: str(raw.sceneTendency, 600),
    lyricTreatment: str(raw.lyricTreatment, 600),
    plan: checked.data,
    status: STATUSES.includes(raw.status as DirectionStatus) ? (raw.status as DirectionStatus) : "proposed",
    comments: coerceComments(raw.comments),
    engine: engineOf(raw.engine),
    createdAt: str(raw.createdAt, 40),
    updatedAt: str(raw.updatedAt, 40),
  };
  if (typeof raw.model === "string" && raw.model) d.model = raw.model.slice(0, 80);
  return d;
}

/** The stored direction set, or undefined when missing / nothing usable is left. */
export function coerceDirectionSet(raw: unknown): DirectionSet | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.directions)) return undefined;
  const directions = raw.directions
    .slice(0, MAX_DIRECTIONS)
    .map((d, i) => coerceDirection(d, i))
    .filter((d): d is DesignDirection => d != null);
  if (!directions.length) return undefined;
  // at most one selected
  let seen = false;
  for (const d of directions) {
    if (d.status !== "selected") continue;
    if (seen) d.status = "proposed";
    seen = true;
  }
  const set: DirectionSet = { engine: engineOf(raw.engine), createdAt: str(raw.createdAt, 40), directions };
  if (typeof raw.model === "string" && raw.model) set.model = raw.model.slice(0, 80);
  return set;
}

const PLAN_ENGINES: readonly PlanSource["engine"][] = ["claude", "offline", "free", "manual-claude"];

/** Who made a plan (Project.planSource, PlanSnapshot.source), or undefined when unknown / malformed. */
export function coercePlanSource(raw: unknown): PlanSource | undefined {
  if (!isRecord(raw) || !PLAN_ENGINES.includes(raw.engine as PlanSource["engine"])) return undefined;
  const source: PlanSource = { engine: raw.engine as PlanSource["engine"], at: str(raw.at, 40) };
  if (typeof raw.model === "string" && raw.model) source.model = raw.model.slice(0, 120);
  return source;
}

export function coercePlanSnapshot(raw: unknown): PlanSnapshot | undefined {
  if (!isRecord(raw)) return undefined;
  const checked = DesignPlanSchema.safeParse(raw.plan);
  if (!checked.success || !checked.data.sections.length) return undefined;
  const source = coercePlanSource(raw.source);
  return { plan: checked.data, at: str(raw.at, 40), reason: str(raw.reason, 200), ...(source ? { source } : {}) };
}

export function findDirection(project: Pick<Project, "directions">, id: string): DesignDirection | undefined {
  return project.directions?.directions.find((d) => d.id === id);
}

export function selectedDirection(project: Pick<Project, "directions">): DesignDirection | undefined {
  return project.directions?.directions.find((d) => d.status === "selected");
}

// ---------------------------------------------------------------------------
// transforms on a project draft (the server runs them inside updateProject)
// ---------------------------------------------------------------------------

/**
 * 「採用這個方向」: `plan` (the direction's plan, re-aligned to the song by the caller) becomes the
 * project's plan; the replaced plan is kept for 復原; the direction is 已選定, a previously
 * selected one goes back to 提案中. Throws when the direction is unknown.
 */
export function applySelection(draft: Project, directionId: string, plan: DesignPlan, now: string): DesignDirection {
  const set = draft.directions;
  const chosen = set?.directions.find((d) => d.id === directionId);
  if (!set || !chosen) throw new Error("找不到這個設計方向");
  if (draft.plan) {
    draft.previousPlan = { plan: draft.plan, at: now, reason: `採用方向 ${chosen.letter}「${chosen.name}」`, ...(draft.planSource ? { source: draft.planSource } : {}) };
  } else delete draft.previousPlan;
  draft.plan = plan;
  draft.planSource = { engine: chosen.engine, ...(chosen.model ? { model: chosen.model } : {}), at: now };
  for (const d of set.directions) {
    if (d.id === directionId) {
      d.status = "selected";
      d.updatedAt = now;
    } else if (d.status === "selected") d.status = "proposed";
  }
  return chosen;
}

/** 復原: the plan before the last selection comes back; no direction stays 已選定. False when there is nothing to undo. */
export function applyUndo(draft: Project): boolean {
  const prev = draft.previousPlan;
  if (!prev) return false;
  draft.plan = prev.plan;
  if (prev.source) draft.planSource = prev.source;
  else delete draft.planSource;
  delete draft.previousPlan;
  for (const d of draft.directions?.directions ?? []) if (d.status === "selected") d.status = "proposed";
  return true;
}

/** Status change (退回 / 重新提案). Selecting goes through applySelection. */
export function applyStatus(draft: Project, directionId: string, status: "proposed" | "rejected", now: string): DesignDirection {
  const d = draft.directions?.directions.find((x) => x.id === directionId);
  if (!d) throw new Error("找不到這個設計方向");
  if (d.status === "selected" && status === "rejected") throw new Error("這個方向目前被採用中，請先復原或採用其他方向");
  d.status = status;
  d.updatedAt = now;
  return d;
}

export function applyComment(draft: Project, directionId: string, text: string, now: string, kind: DirectionComment["kind"] = "comment", id?: string): DirectionComment {
  const d = draft.directions?.directions.find((x) => x.id === directionId);
  if (!d) throw new Error("找不到這個設計方向");
  const clean = sanitizeComment(text);
  if (!clean) throw new Error("意見不能是空的");
  const comment: DirectionComment = { id: id ?? `c${Date.parse(now).toString(36)}${d.comments.length}`, text: clean, at: now, kind };
  d.comments = [...d.comments, comment].slice(-MAX_COMMENTS);
  d.updatedAt = now;
  return comment;
}

export function removeComment(draft: Project, directionId: string, commentId: string): boolean {
  const d = draft.directions?.directions.find((x) => x.id === directionId);
  if (!d) return false;
  const before = d.comments.length;
  d.comments = d.comments.filter((c) => c.id !== commentId);
  return d.comments.length !== before;
}

// ---------------------------------------------------------------------------
// style frames: the 3–4 moments a direction is shown with
// ---------------------------------------------------------------------------

export interface StyleFrameMoment {
  /** 前奏 / 第一次副歌 / 橋段 / 最後副歌 … */
  label: string;
  /** song time, seconds */
  t: number;
  sectionIndex: number;
}

/** A time inside [start, end) where a lyric line of the section is on screen (60 % into the first line), else the middle. */
function momentIn(start: number, end: number, lyrics: Lyrics | null | undefined, withLyrics: boolean): number {
  const mid = start + (end - start) * 0.5;
  if (!withLyrics) return mid;
  const lines = (lyrics?.lines ?? []).filter((l) => typeof l.start === "number" && l.start >= start - 0.01 && l.start < end && l.text.trim());
  const line = lines[Math.min(1, lines.length - 1)] ?? lines[0];
  if (!line || line.start == null) return mid;
  const next = (lyrics?.lines ?? []).find((l) => typeof l.start === "number" && l.start > line.start!);
  const lineEnd = Math.min(end, line.end ?? next?.start ?? line.start + 4, line.start + 6);
  return Math.min(end - 0.05, line.start + Math.max(0.3, (lineEnd - line.start) * 0.6));
}

/**
 * The key stills of a plan: the intro, the first chorus with lyrics, the bridge (or the quietest
 * section after the first chorus) and the final chorus; missing ones are filled with other
 * sections spread over the song. 3 or 4 moments in time order (fewer only for tiny plans).
 */
export function styleFrameMoments(plan: DesignPlan, lyrics: Lyrics | null | undefined, max = 4): StyleFrameMoment[] {
  const secs = plan.sections;
  if (!secs.length) return [];
  const picks: Array<{ i: number; label: string; lyrics: boolean }> = [];
  const add = (i: number, label: string, withLyrics: boolean) => {
    if (i < 0 || i >= secs.length || picks.some((p) => p.i === i)) return;
    picks.push({ i, label, lyrics: withLyrics });
  };
  const shows = (i: number) => secs[i].lyricStyle !== "hidden";
  add(0, secs[0].kind === "intro" ? "前奏" : "開場", false);
  const choruses = secs.map((s, i) => (s.kind === "chorus" ? i : -1)).filter((i) => i >= 0);
  const firstChorus = choruses.find(shows) ?? choruses[0] ?? -1;
  add(firstChorus, "第一次副歌", true);
  let bridge = secs.findIndex((s) => s.kind === "bridge" || s.kind === "breakdown");
  if (bridge < 0) {
    let q = -1;
    secs.forEach((s, i) => {
      if (i <= Math.max(0, firstChorus) || i === secs.length - 1) return;
      if (q < 0 || s.energy < secs[q].energy) q = i;
    });
    bridge = q;
  }
  add(bridge, secs[bridge]?.kind === "bridge" ? "橋段" : "轉折", true);
  const lastChorus = [...choruses].reverse().find((i) => i !== firstChorus && shows(i)) ?? [...choruses].reverse().find((i) => i !== firstChorus) ?? -1;
  add(lastChorus, "最後副歌", true);
  // fill up: the most energetic, then spread
  if (picks.length < Math.min(max, 3)) {
    const byEnergy = secs.map((s, i) => ({ i, e: s.energy })).sort((a, b) => b.e - a.e);
    for (const { i } of byEnergy) {
      if (picks.length >= Math.min(max, 3)) break;
      add(i, secs[i].label || "高潮", shows(i));
    }
  }
  return picks
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((p) => {
      const s = secs[p.i];
      return { label: p.label, t: Math.round(momentIn(s.start, s.end, lyrics, p.lyrics && shows(p.i)) * 1000) / 1000, sectionIndex: p.i };
    });
}

// ---------------------------------------------------------------------------
// the band sign-off sheet (一頁提案)
// ---------------------------------------------------------------------------

export interface ProposalDirection {
  id: string;
  letter: string;
  name: string;
  pitch: string;
  rationale: string;
  status: DirectionStatus;
  statusLabel: string;
  palette: Array<{ hex: string; name: string; role: string }>;
  fonts: { cjk: string; latin: string; weight: number; sample: string };
  /** 字體藝術: the direction's typographic voice (its label), when its plan has one */
  typeVoice: string | null;
  sceneTendency: string;
  lyricTreatment: string;
  moments: StyleFrameMoment[];
  /** mood board images this direction cites, with the cue */
  references: Array<{ imageId: string; cue: string; index: number }>;
  comments: string[];
}

export interface ProposalSheet {
  title: string;
  artist: string;
  band: string;
  /** YYYY-MM-DD of the proposal */
  date: string;
  engine: DirectionEngine | null;
  directions: ProposalDirection[];
  /** every mood board image, numbered like the prompt (圖 1…) */
  references: Array<{ id: string; index: number; name: string; note: string; palette: string[]; scope: "band" | "project" }>;
  selectedLetter: string | null;
  /** 選擇方向 A／B／C */
  choices: string[];
}

/** A sample line for the typography specimen: the first short sung line, else the title. */
export function specimenLine(project: Pick<Project, "lyrics" | "meta">): string {
  const line = project.lyrics.lines.map((l) => l.text.trim()).find((t) => t.length >= 2 && t.length <= 16);
  return line ?? (project.meta.title.trim() || "夜色正要開始");
}

/**
 * The sign-off sheet's content, shaped for one A4 landscape page: text is clipped so the layout
 * never overflows (pitch 80, rationale 220, tendencies 90 characters), at most 12 references.
 */
export function proposalSheet(
  project: Pick<Project, "meta" | "lyrics" | "directions">,
  opts: { bandName?: string; moodboard?: readonly MoodImage[]; fontLabel?: (id: string) => string; voiceLabel?: (id: string) => string; now?: Date } = {},
): ProposalSheet {
  const clip = (s: string, n: number) => {
    // Markdown headings and emphasis go; a colour code keeps its "#"
    const t = s
      .replace(/(^|\n)\s*#{1,6}\s+/g, "$1")
      .replace(/[*_>`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const label = opts.fontLabel ?? ((id: string) => id);
  const images = (opts.moodboard ?? []).slice(0, 12);
  const indexOf = new Map(images.map((m, i) => [m.id, i + 1]));
  const sample = specimenLine(project as Pick<Project, "lyrics" | "meta">);
  const dirs = project.directions?.directions ?? [];
  const directions: ProposalDirection[] = dirs.map((d) => {
    const kv = d.plan.keyVisual;
    // 字體藝術: the lyrics are set in the type system's fonts
    const ts = d.plan.typeSystem;
    const fonts = ts ? { cjk: label(ts.fonts.cjk), latin: label(ts.fonts.latin), weight: ts.weight, sample } : { cjk: label(kv.typography.cjkFont), latin: label(kv.typography.latinFont), weight: kv.typography.weight, sample };
    return {
      id: d.id,
      letter: d.letter,
      name: d.name,
      pitch: clip(d.pitch, 80),
      rationale: clip(d.rationale, 220),
      status: d.status,
      statusLabel: DIRECTION_STATUS_LABEL[d.status],
      palette: kv.palette.slice(0, 6).map((c) => ({ hex: c.hex, name: c.name, role: c.role })),
      fonts,
      typeVoice: ts ? (opts.voiceLabel?.(ts.voice) ?? ts.voice) : null,
      sceneTendency: clip(d.sceneTendency, 90),
      lyricTreatment: clip(d.lyricTreatment, 90),
      moments: styleFrameMoments(d.plan, project.lyrics),
      references: d.references.flatMap((r) => (indexOf.has(r.imageId) ? [{ imageId: r.imageId, cue: clip(r.cue, 40), index: indexOf.get(r.imageId)! }] : [])),
      comments: d.comments.filter((c) => c.kind === "comment").slice(-2).map((c) => clip(c.text, 80)),
    };
  });
  const selected = dirs.find((d) => d.status === "selected");
  const now = opts.now ?? new Date();
  return {
    title: project.meta.title || "未命名歌曲",
    artist: project.meta.artist,
    band: opts.bandName ?? project.meta.artist,
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    engine: project.directions?.engine ?? null,
    directions,
    references: images.map((m, i) => ({ id: m.id, index: i + 1, name: m.name, note: clip(m.note ?? "", 40), palette: (m.stats?.palette ?? []).slice(0, 5), scope: m.scope === "band" ? "band" : "project" })),
    selectedLetter: selected?.letter ?? null,
    choices: directions.map((d) => d.letter),
  };
}
