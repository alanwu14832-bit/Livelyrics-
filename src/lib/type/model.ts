// The type engine's data model: a line's resolved hint, the canvas frame it is composed for, and
// the composition itself (pieces of positioned glyphs, rules and stamps). Pure data, no DOM:
// `composeLine` (compose.ts) derives it deterministically, the painter
// (src/components/stage/type/TypePainter.ts) draws it, and the tests measure it.

import type { LyricSafeArea, TypeColorRole, TypeColorTreatment, TypeEnterId, TypeExitId, TypeOrientation, TypeOrnamentId, TypeParams, TypeRecipeId, TypeVoiceId, FontId, SectionKind, Zone } from "../types";
import type { MotionKind } from "./vocab";

/**
 * The three plates of the type texture (one colour channel each): ink = the lyric colour, accent =
 * the section's accent, spot = the knockout window mask or the seal's vermilion.
 */
export type PlateId = "ink" | "accent" | "spot";

/** Which font of the system draws a glyph. */
export type FontRole = "cjk" | "latin";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Advance of `text` in ems (width / font size) for a font role and weight. */
export type Measure = (text: string, font: FontRole, weight: number) => number;

/** The song-level system after normalization (what composeLine reads). */
export interface ResolvedTypeSystem {
  voice: TypeVoiceId;
  params: TypeParams;
  color: TypeColorTreatment;
  fonts: { cjk: FontId; latin: FontId };
  weight: number;
  ornaments: TypeOrnamentId[];
  seal: string;
}

/** A line's effective hint: the generated one, a section override and the editor's edit merged. */
export interface ResolvedHint {
  recipe: TypeRecipeId;
  emphasis: string[];
  orientation: TypeOrientation;
  energy: number;
  motionWord: string;
  seed: number;
  /** nudge (fractions of the canvas), size multiplier and rotation (degrees) from the editor */
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  enter: TypeEnterId;
  exit: TypeExitId;
  /** the line's colour role; "auto" = what the system's colour treatment gives it */
  color: TypeColorRole | "auto";
  /** the last chorus escalates the composition every earlier chorus showed */
  escalate: boolean;
  /**
   * one of the song's few key lines (the title line, the chorus hook): only these may be set large
   * (巨字, 出血, 鏤空窗 at full scale); every other line is small-to-medium on the grid
   */
  key?: boolean;
  /** the section's motion override (0..1), null = the system's */
  motion: number | null;
  /** the orientation was set in the editor (line or section): the canvas may not adapt it */
  orientationFixed?: boolean;
  /** the recipe was set in the editor (line or section): restraint keeps it */
  recipeFixed?: boolean;
}

/** Where the line sits in the song (ornaments: numbers, section label, title). */
export interface LineContext {
  lineIndex: number;
  lineCount: number;
  sectionIndex: number | null;
  sectionKind: SectionKind | null;
  sectionLabel: string;
  songTitle: string;
  /** the first line of its section (section labels and numbers go here) */
  first: boolean;
  /**
   * 專屬畫面 (phase 7): the section's text zone — the scene program's negative space, fractions of
   * a landscape canvas (compose adapts it to the real canvas); null = the whole readable area
   */
  zone?: Zone | null;
}

/** The canvas a composition is laid out for (pixels, y down). */
export interface CanvasSpec {
  width: number;
  height: number;
  safe: LyricSafeArea;
}

/** One positioned glyph (a CJK character or punctuation mark) or Latin run. */
export interface GlyphBox {
  /** the text drawn (a character, or a whole Latin word) */
  ch: string;
  font: FontRole;
  weight: number;
  /** font size in px */
  size: number;
  /** centre of the glyph's cell (px) */
  x: number;
  y: number;
  /** cell size (px): the advance box */
  w: number;
  h: number;
  /** radians: sideways Latin and rotated punctuation in vertical text, scatter angles */
  rotate: number;
  plate: PlateId;
  /** reading order within the composition (0 = first) */
  order: number;
  /** the line's text unit it shows (-1 for ornaments) */
  unit: number;
  /** sung time of the unit relative to the line start (seconds) */
  t0: number;
  /** extra letter spacing in px applied when drawing a Latin run */
  tracking: number;
}

export type PieceRole = "main" | "giant" | "small" | "translation" | "label" | "echo" | "rule" | "seal" | "bracket" | "chip" | "grid";

export interface Piece {
  role: PieceRole;
  glyphs: GlyphBox[];
  /** rules, chips, the seal square (px) */
  rect?: Box;
  plate: PlateId;
  /** base opacity (echo copies and grid lines are lighter) */
  alpha: number;
  /** seconds after the entrance before this piece starts (reading order stagger) */
  delay: number;
  /** vertical text (for reveals and ink streaks) */
  vertical: boolean;
  /** readable lyric text (legibility minimums apply) */
  readable: boolean;
  /** may extend past the canvas edge (the bleed recipe's display word) */
  bleed?: boolean;
  /** the glyphs are a knockout window onto the scene (the spot plate as a mask) */
  window?: boolean;
  /** an echo copy: offset from the main piece, animated apart */
  echo?: { index: number; dx: number; dy: number };
  /** the 網格詩 grid lines over `rect` */
  grid?: { cols: number; rows: number };
  /** 撕裂: the glyphs are drawn as this many horizontal slices that shift apart */
  slices?: number;
  /** 0..1 how far the slices stay apart at rest (a torn row keeps its tear) */
  tear?: number;
  /** 反白: the glyphs are cut out of the chip behind them */
  knockout?: boolean;
}

export interface Composition {
  lineIndex: number;
  lineId: string;
  recipe: TypeRecipeId;
  voice: TypeVoiceId;
  orientation: TypeOrientation;
  motion: MotionKind;
  /** 0..1 motion amplitude (the system's, or the section override) */
  motionAmount: number;
  energy: number;
  enter: Exclude<TypeEnterId, "auto">;
  exit: Exclude<TypeExitId, "auto">;
  /** seconds */
  enterDur: number;
  exitDur: number;
  /** entrances land on the beat when the voice snaps */
  snap: boolean;
  pieces: Piece[];
  /** union of the readable text (px) */
  readBounds: Box;
  /** union of everything drawn (px) */
  bounds: Box;
  /** the composition shows a knockout window (the spot plate is a mask) */
  window: boolean;
  /**
   * 0..1 how much the frame fills around the window glyphs: 1 for 鏤空窗 and the 鏤空 role; less
   * for a display word the knockout treatment opens (the scene stays half seen around it)
   */
  windowFill: number;
  /** the composition carries a seal (the spot plate is vermilion) */
  seal: boolean;
  /** smallest readable glyph size (px) */
  minReadable: number;
  /** stable identity of the layout (same input → same key) */
  key: string;
}

export const EMPTY_BOX: Box = { x: 0, y: 0, w: 0, h: 0 };

export function unionBox(a: Box, b: Box): Box {
  if (a.w <= 0 && a.h <= 0) return { ...b };
  if (b.w <= 0 && b.h <= 0) return { ...a };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The axis-aligned box of a glyph (its rotated cell). */
export function glyphBox(g: GlyphBox): Box {
  const c = Math.abs(Math.cos(g.rotate));
  const s = Math.abs(Math.sin(g.rotate));
  const w = g.w * c + g.h * s;
  const h = g.w * s + g.h * c;
  return { x: g.x - w / 2, y: g.y - h / 2, w, h };
}

export function pieceBox(p: Piece): Box {
  let b: Box = p.rect ? { ...p.rect } : { ...EMPTY_BOX };
  for (const g of p.glyphs) b = unionBox(b, glyphBox(g));
  // an echo copy is drawn at its offset (a little more while it breathes)
  if (p.echo && b.w > 0) b = unionBox(b, { ...b, x: b.x + p.echo.dx * 1.15, y: b.y + p.echo.dy * 1.15 });
  return b;
}
