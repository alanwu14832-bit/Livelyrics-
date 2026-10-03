// composeLine: one lyric line + its resolved hint + the song's type system + the canvas → a
// Composition, deterministically (same input, same layout: no clock, no Math.random). The recipe
// places the text; this module adds the ornaments (rules, numbers, labels, 「」, the seal), keeps
// every readable glyph inside the readable area at or above the legibility minimum, applies the
// editor's nudge / scale / rotation, and settles the entrance, exit and motion.

import { DEFAULT_LYRIC_SAFE } from "../output";
import type { TypeEnterId, TypeExitId, TypeOrientation, TypeRecipeId, TypeVoiceId } from "../types";
import { makeFrame, type Frame } from "./frame";
import { EMPTY_BOX, glyphBox, pieceBox, unionBox, type Box, type CanvasSpec, type Composition, type GlyphBox, type LineContext, type Measure, type Piece, type PlateId, type ResolvedHint, type ResolvedTypeSystem } from "./model";
import { motionKindOf } from "./motion-words";
import { RECIPE_FALLBACK, RECIPE_FNS, longLine, piece, translationPiece, zoneFor, type RecipeCtx } from "./recipes";
import { createRng, hash32 } from "./rng";
import { canvasZone } from "../stage/program/model";
import { isLongUnits, type LineText } from "./text";
import { VOICES, type MotionKind } from "./vocab";

export interface ComposeInput {
  lt: LineText;
  lineId: string;
  hint: ResolvedHint;
  system: ResolvedTypeSystem;
  canvas: CanvasSpec;
  ctx: LineContext;
  measure: Measure;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

const SECTION_LATIN: Record<string, string> = {
  intro: "INTRO",
  verse: "VERSE",
  "pre-chorus": "PRE-CHORUS",
  chorus: "CHORUS",
  bridge: "BRIDGE",
  solo: "SOLO",
  breakdown: "BREAKDOWN",
  outro: "OUTRO",
  interlude: "INTERLUDE",
};

/**
 * Every character an ornament may draw besides the sung text: section labels, brackets, rules,
 * numbers, Latin. Fonts are loaded for these too, so a first frame never falls back for one.
 */
export const ORNAMENT_CHARS = [
  ...new Set(`${Object.values(SECTION_LATIN).join("")}「」﹁﹂『』《》—–…|·・×/:：-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`),
].join("");

/** The knockout treatment opens the display word of lines at least this strong (choruses, peaks). */
const KNOCK_ENERGY = 0.6;

function recipeCtx(input: ComposeInput, frame: Frame, recipe: TypeRecipeId): RecipeCtx {
  const { hint, system: sys } = input;
  const p = sys.params;
  const e = clamp(hint.energy + (hint.escalate ? 0.14 : 0), 0, 1);
  const c = clamp(p.scaleContrast, 0, 1);
  const d = clamp(p.density, 0, 1);
  const ref = frame.ref;
  const esc = hint.escalate ? 1.08 : 1;
  const role = hint.color;
  const mainPlate: PlateId = role === "accent" ? "accent" : "ink";
  // 鏤空 always opens the display word; the knockout treatment opens it on strong lines only (a
  // whole song of filled frames would hide the stage); 主字色 / 點綴色 / 反白 never do
  const displayWindow = role === "window" || (role === "auto" && sys.color === "knockout" && e >= KNOCK_ENERGY);
  // the display word is set in the full ink colour (B3): a colour accent is the overprint's offset
  // copy or an emphasized run, never the fill of the word the crowd must read; only 點綴色 asks for it
  const displayPlate: PlateId = displayWindow ? "spot" : role === "accent" ? "accent" : "ink";
  // restraint: most lines are small-to-medium; the few key lines keep the full display scale
  const restrained = hint.key === false;
  const body = Math.max(frame.minRead, ref * (restrained ? lerp(0.052, 0.078, e) * lerp(0.95, 1.05, d) : lerp(0.068, 0.11, e) * lerp(0.92, 1.1, d)) * esc);
  const giantFull = ref * lerp(0.34, 0.66, c) * lerp(0.86, 1.06, e) * esc;
  return {
    lt: input.lt,
    hint,
    sys,
    frame,
    ctx: input.ctx,
    measure: input.measure,
    rng: createRng(`${recipe}|${Math.round(hint.seed)}|${sys.voice}`),
    zone: zoneFor(hint.seed),
    e,
    c,
    d,
    body,
    small: Math.max(frame.minRead, ref * (restrained ? lerp(0.046, 0.056, e) : lerp(0.05, 0.064, e)) * esc),
    // a key line may be set huge; every other line's display word stays a step or two above the body
    giant: restrained ? Math.min(giantFull, body * lerp(1.6, 2.3, c) * lerp(0.95, 1.08, e)) : giantFull,
    cap: restrained ? body * 1.7 : Infinity,
    weight: sys.weight,
    displayPlate,
    displayWindow,
    mainPlate,
  };
}

function readableBox(pieces: readonly Piece[]): Box {
  let b: Box = { ...EMPTY_BOX };
  for (const p of pieces) if (p.readable) b = unionBox(b, pieceBox(p));
  return b;
}

function allBox(pieces: readonly Piece[]): Box {
  let b: Box = { ...EMPTY_BOX };
  for (const p of pieces) b = unionBox(b, pieceBox(p));
  return b;
}

function minReadable(pieces: readonly Piece[]): number {
  let m = Infinity;
  for (const p of pieces) if (p.readable && p.role !== "translation") for (const g of p.glyphs) if (g.unit >= 0) m = Math.min(m, g.size);
  return Number.isFinite(m) ? m : 0;
}

/** Scale every piece around (cx, cy). */
function scaleAll(pieces: Piece[], k: number, cx: number, cy: number) {
  if (Math.abs(k - 1) < 1e-6) return;
  for (const p of pieces) {
    for (const g of p.glyphs) {
      g.x = cx + (g.x - cx) * k;
      g.y = cy + (g.y - cy) * k;
      g.size *= k;
      g.w *= k;
      g.h *= k;
      g.tracking *= k;
    }
    if (p.rect) p.rect = { x: cx + (p.rect.x - cx) * k, y: cy + (p.rect.y - cy) * k, w: p.rect.w * k, h: p.rect.h * k };
    if (p.echo) p.echo = { ...p.echo, dx: p.echo.dx * k, dy: p.echo.dy * k };
  }
}

function moveAll(pieces: Piece[], dx: number, dy: number, only?: (p: Piece) => boolean) {
  if (!dx && !dy) return;
  for (const p of pieces) {
    if (only && !only(p)) continue;
    for (const g of p.glyphs) {
      g.x += dx;
      g.y += dy;
    }
    if (p.rect) p.rect = { ...p.rect, x: p.rect.x + dx, y: p.rect.y + dy };
  }
}

function rotateAll(pieces: Piece[], rad: number, cx: number, cy: number) {
  if (Math.abs(rad) < 1e-6) return;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  for (const p of pieces) {
    for (const g of p.glyphs) {
      const x = g.x - cx;
      const y = g.y - cy;
      g.x = cx + x * c - y * s;
      g.y = cy + x * s + y * c;
      g.rotate += rad;
    }
    if (p.rect) {
      // rules and chips turn with the text: approximated by moving their centre (they stay axis-aligned)
      const rx = p.rect.x + p.rect.w / 2 - cx;
      const ry = p.rect.y + p.rect.h / 2 - cy;
      const nx = cx + rx * c - ry * s;
      const ny = cy + rx * s + ry * c;
      p.rect = { ...p.rect, x: nx - p.rect.w / 2, y: ny - p.rect.h / 2 };
    }
  }
}

/**
 * 反白: the display text (the giant word, else the main text) is cut out of blocks of the ink
 * colour, one block per row (per column in vertical text); the stage shows through the letters.
 */
function invertDisplay(pieces: Piece[]): Piece[] {
  const hasGiant = pieces.some((p) => p.role === "giant" && p.glyphs.length > 0);
  const target = (p: Piece) => !p.echo && p.glyphs.length > 0 && (hasGiant ? p.role === "giant" : p.role === "main");
  const out: Piece[] = [];
  for (const p of pieces) {
    if (!target(p)) {
      out.push(p);
      continue;
    }
    // runs along the reading direction: glyphs whose cross-axis centres lie close together
    const across = (g: GlyphBox) => (p.vertical ? g.x : g.y);
    const sorted = [...p.glyphs].sort((a, b) => across(a) - across(b));
    const groups: GlyphBox[][] = [];
    for (const g of sorted) {
      const last = groups[groups.length - 1];
      const ref = last?.[last.length - 1];
      if (ref && Math.abs(across(g) - across(ref)) <= Math.max(ref.size, g.size) * 0.5) last.push(g);
      else groups.push([g]);
    }
    groups.forEach((gs, i) => {
      gs.sort((a, b) => a.order - b.order);
      let b: Box = { ...EMPTY_BOX };
      for (const g of gs) b = unionBox(b, glyphBox(g));
      const size = Math.max(...gs.map((g) => g.size));
      const padAlong = size * 0.24;
      const padAcross = size * 0.14;
      const rect = p.vertical ? { x: b.x - padAcross, y: b.y - padAlong, w: b.w + padAcross * 2, h: b.h + padAlong * 2 } : { x: b.x - padAlong, y: b.y - padAcross, w: b.w + padAlong * 2, h: b.h + padAcross * 2 };
      out.push({ ...p, glyphs: gs, plate: "ink", window: false, rect, knockout: true, delay: p.delay + i * 0.06 });
    });
  }
  return out;
}

/**
 * A place for the translation where it touches nothing (a seal, an echo, the small text): the
 * recipe's own when that is free, else under the text block, beside its foot or over it, flush
 * with the block's edges and re-set for the measure, inside the readable area. Null: nowhere.
 */
function translationSpot(pieces: readonly Piece[], at: number, frame: Frame, r: RecipeCtx): Piece | null {
  const tp = pieces[at];
  const others = pieces.filter((p, k) => k !== at && p.role !== "grid" && !p.bleed);
  const boxes = others.map(pieceBox).filter((b) => b.w > 0 && b.h > 0);
  const size = Math.max(...tp.glyphs.map((g) => g.size));
  const pad = size * 0.4;
  const hits = (b: Box) => boxes.some((o) => b.x < o.x + o.w + pad && b.x + b.w + pad > o.x && b.y < o.y + o.h + pad && b.y + b.h + pad > o.y);
  const rd = frame.read;
  const inside = (b: Box) => b.x >= rd.x - 0.5 && b.y >= rd.y - 0.5 && b.x + b.w <= rd.x + rd.w + 0.5 && b.y + b.h <= rd.y + rd.h + 0.5;
  const tb = pieceBox(tp);
  if (!hits(tb) && inside(tb)) return tp;
  const text = readableBox(others);
  const block = text.w > 0 ? text : allBox(others);
  if (block.w <= 0) return null;
  const gap = size * 0.7;
  // a candidate: the translation re-set for a measure, then moved to its row
  const tryAt = (x: number, maxW: number, align: "left" | "right", yOf: (h: number) => number): Piece | null => {
    if (maxW < size * 5) return null;
    const probe = translationPiece(r, x, rd.y, maxW, align);
    if (!probe) return null;
    const pb = pieceBox(probe);
    if (pb.w > maxW + 1) return null;
    moveAll([probe], 0, yOf(pb.h) - pb.y);
    const b = pieceBox(probe);
    return inside(b) && !hits(b) ? probe : null;
  };
  const wide = Math.max(block.w, rd.w * 0.3);
  const right = block.x + block.w + gap;
  // everything drawn (echo trails, labels) for the rows past the whole composition
  const full = allBox(others);
  const fullW = Math.max(full.w, rd.w * 0.3);
  // under the text first (it reads after it), then beside its foot, under everything, then over it
  const cands = [
    () => tryAt(block.x, wide, "left", () => block.y + block.h + gap),
    () => tryAt(block.x + block.w - wide, wide, "right", () => block.y + block.h + gap),
    () => tryAt(right, rd.x + rd.w - right, "left", (h) => block.y + block.h - h),
    () => tryAt(rd.x, block.x - gap - rd.x, "right", (h) => block.y + block.h - h),
    () => tryAt(block.x, fullW, "left", () => full.y + full.h + gap),
    () => tryAt(full.x + full.w - fullW, fullW, "right", () => full.y + full.h + gap),
    () => tryAt(block.x, wide, "left", (h) => block.y - gap - h),
    () => tryAt(block.x + block.w - wide, wide, "right", (h) => block.y - gap - h),
    () => tryAt(right, rd.x + rd.w - right, "left", () => block.y),
    () => tryAt(rd.x, block.x - gap - rd.x, "right", () => block.y),
  ];
  for (const c of cands) {
    const p = c();
    if (p) return p;
  }
  return null;
}

/**
 * The translation never sits on the composition. Where no place is free, the composition first
 * moves up to leave it its rows (a word anchored to the frame edge stays), then shrinks (never
 * below the minimum size); when even that finds no place, the layout is left as the recipe made it.
 */
function placeTranslation(pieces: Piece[], frame: Frame, r: RecipeCtx): Piece[] {
  const at = pieces.findIndex((p) => p.role === "translation");
  if (at < 0 || !pieces[at].glyphs.length) return pieces;
  const tp = pieces[at];
  const put = (spot: Piece) => pieces.map((p, k) => (k === at ? spot : p));
  let spot = translationSpot(pieces, at, frame, r);
  if (spot) return put(spot);
  const rd = frame.read;
  const rest = pieces.filter((_, k) => k !== at);
  const text = readableBox(rest.filter((p) => p.role !== "grid" && !p.bleed));
  if (text.w <= 0) return pieces;
  const size = Math.max(...tp.glyphs.map((g) => g.size));
  const gap = size * 0.7;
  const probe = translationPiece(r, text.x, rd.y, Math.max(text.w, rd.w * 0.3), "left");
  const th = probe ? pieceBox(probe).h : pieceBox(tp).h;
  // 1. the text moves up
  const deficit = text.y + text.h + gap + th - (rd.y + rd.h);
  // the whole composition moves together, except a word anchored to the frame edge (出血)
  const movable = (p: Piece) => !p.bleed;
  if (deficit > 0 && text.y - deficit >= rd.y) {
    moveAll(rest, 0, -deficit, movable);
    spot = translationSpot(pieces, at, frame, r);
    if (spot) return put(spot);
    moveAll(rest, 0, deficit, movable);
  }
  // 2. the composition shrinks
  const need = th + gap * 1.5;
  const smallest = minReadable(rest);
  const kMin = smallest > 0 ? frame.minRead / smallest : 1;
  const k = Math.min(1, (rd.h - need) / Math.max(1, text.h));
  if (k < kMin || k < 0.55) return pieces;
  const cx = text.x + text.w / 2;
  scaleAll(rest, k, cx, text.y);
  const nb = readableBox(rest);
  const dy = Math.max(rd.y - nb.y, Math.min(0, rd.y + rd.h - need - (nb.y + nb.h)));
  moveAll(rest, 0, dy, movable);
  spot = translationSpot(pieces, at, frame, r);
  if (spot) return put(spot);
  moveAll(rest, 0, -dy, movable);
  scaleAll(rest, 1 / k, cx, text.y);
  return pieces;
}

/**
 * The hard clamp (B4): nothing drawn — glyphs, labels, rules, brackets, the seal — leaves the
 * lyric safe area (a bled display word excepted: it is meant to run off the frame). Ornaments
 * that fall outside are dropped first; then the composition moves in; when it is still larger
 * than the safe area it shrinks as a last resort, below the readable minimum if it must (a
 * clipped line is worse than a small one).
 */
function clampToSafe(pieces: Piece[], safe: Box): Piece[] {
  const tol = 1;
  const inside = (b: Box) => b.w <= 0 || (b.x >= safe.x - tol && b.y >= safe.y - tol && b.x + b.w <= safe.x + safe.w + tol && b.y + b.h <= safe.y + safe.h + tol);
  const movable = (p: Piece) => !p.bleed;
  const boxOf = () => {
    let b: Box = { ...EMPTY_BOX };
    for (const p of pieces) if (movable(p)) b = unionBox(b, pieceBox(p));
    return b;
  };
  let b = boxOf();
  if (b.w <= 0 || inside(b)) return pieces;
  // 1. move in
  let dx = 0;
  let dy = 0;
  if (b.x < safe.x) dx = safe.x - b.x;
  else if (b.x + b.w > safe.x + safe.w) dx = safe.x + safe.w - (b.x + b.w);
  if (b.y < safe.y) dy = safe.y - b.y;
  else if (b.y + b.h > safe.y + safe.h) dy = safe.y + safe.h - (b.y + b.h);
  moveAll(pieces, dx, dy, movable);
  b = boxOf();
  if (inside(b)) return pieces;
  // 2. ornaments outside the safe area go (the text matters more than its chrome)
  const kept = pieces.filter((p) => p.readable || p.bleed || p.role === "translation" || inside(pieceBox(p)));
  if (kept.length !== pieces.length) {
    pieces = kept;
    b = boxOf();
    if (inside(b)) return pieces;
  }
  // 3. shrink around the centre of what is drawn, then move in
  const k = Math.min(1, safe.w / b.w, safe.h / b.h);
  if (k < 1) scaleAll(pieces.filter(movable), k, b.x + b.w / 2, b.y + b.h / 2);
  b = boxOf();
  dx = 0;
  dy = 0;
  if (b.x < safe.x) dx = safe.x - b.x;
  else if (b.x + b.w > safe.x + safe.w) dx = safe.x + safe.w - (b.x + b.w);
  if (b.y < safe.y) dy = safe.y - b.y;
  else if (b.y + b.h > safe.y + safe.h) dy = safe.y + safe.h - (b.y + b.h);
  moveAll(pieces, dx, dy, movable);
  return pieces;
}

/** Keep the readable text inside `area`: move it in, and shrink it (never below `min`) when it is larger. */
function fitInto(pieces: Piece[], area: Box, min: number) {
  let b = readableBox(pieces);
  if (b.w <= 0 || b.h <= 0) return;
  const k = Math.min(1, area.w / b.w, area.h / b.h);
  if (k < 1) {
    const smallest = minReadable(pieces);
    const kk = smallest > 0 ? Math.max(k, Math.min(1, min / smallest)) : k;
    scaleAll(pieces, kk, b.x + b.w / 2, b.y + b.h / 2);
    b = readableBox(pieces);
  }
  let dx = 0;
  let dy = 0;
  if (b.x < area.x) dx = area.x - b.x;
  else if (b.x + b.w > area.x + area.w) dx = area.x + area.w - (b.x + b.w);
  if (b.y < area.y) dy = area.y - b.y;
  else if (b.y + b.h > area.y + area.h) dy = area.y + area.h - (b.y + b.h);
  // bled display words stay where their recipe put them (they are meant to run off the frame)
  moveAll(pieces, dx, dy, (p) => !p.bleed);
}

function label(text: string, x: number, y: number, size: number, sys: ResolvedTypeSystem, measure: Measure, align: "left" | "right" | "center" = "left", tracking = 0.18): GlyphBox {
  // a label with CJK characters (the plan's section label) is set in the CJK face, tracked less
  const cjk = /\p{Script=Han}/u.test(text);
  const font = cjk ? "cjk" : "latin";
  const tr = cjk ? Math.min(tracking, 0.1) : tracking;
  const chars = [...text].length;
  const w = (measure(text, font, sys.weight) + tr * Math.max(0, chars - 1)) * size;
  const left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  return { ch: text, font, weight: Math.min(900, Math.max(500, sys.weight - 100)), size, x: left + w / 2, y: y + size / 2, w, h: size, rotate: 0, plate: "ink", order: 950, unit: -1, t0: 0, tracking: tr * size };
}

/** The ornaments a line carries: numbers, a section label, the title, 「」, a seal, a rule. */
function ornaments(r: RecipeCtx, pieces: Piece[], input: ComposeInput): Piece[] {
  const sys = r.sys;
  const level = sys.params.ornament;
  const on = new Set(sys.ornaments);
  if (level < 0.12 || !on.size) return pieces;
  const f = r.frame;
  let b = readableBox(pieces);
  if (b.w <= 0) return pieces;
  const ctx = input.ctx;
  const out = [...pieces];
  const labelSize = Math.max(f.minRead * 0.5, Math.min(f.minRead * 0.78, f.ref * 0.024));
  const sectionHead = ctx.first;
  const ornamentSeed = hash32(`orn|${input.lineId}|${Math.round(input.hint.seed)}`) / 4294967296;
  const vertical = pieces.some((p) => p.readable && p.vertical && p.role === "main");
  // 「」 hang outside the text block (MV cards): the block steps in from the frame edge to make room
  const wantBracket = on.has("bracket") && level >= 0.3 && ornamentSeed > 0.45 && ["giant-word", "vertical-column", "cross", "title-card", "whisper"].includes(input.hint.recipe);
  const bs = clamp(Math.min(b.h, b.w) * 0.34, f.minRead * 0.9, f.ref * 0.16);
  let bracketFits = false;
  if (wantBracket) {
    const need = bs * 1.14;
    const leftRoom = b.x - need - f.safe.x;
    const rightRoom = f.safe.x + f.safe.w - (b.x + b.w + need);
    let shift = 0;
    if (leftRoom < 0 && rightRoom >= -leftRoom) shift = -leftRoom;
    else if (rightRoom < 0 && leftRoom >= -rightRoom) shift = rightRoom;
    bracketFits = leftRoom + shift >= -1 && rightRoom - shift >= -1 && b.y - bs * 0.72 >= 0 && b.y + b.h + bs * 0.72 <= f.H;
    if (bracketFits && shift) {
      moveAll(out, shift, 0, (p) => !p.bleed);
      b = readableBox(out);
    }
  }
  const gap = labelSize * 0.9;
  const above = b.y - gap - labelSize >= f.safe.y;
  const ly = above ? b.y - gap - labelSize : b.y + b.h + gap;

  // section label and number: once per section (the first line), or a line number when the seed says so
  const wantNumber = on.has("number") && level >= 0.3 && (sectionHead || ornamentSeed < 0.28 * level);
  const wantSection = on.has("section") && level >= 0.5 && sectionHead && ctx.sectionKind != null;
  if (wantNumber || wantSection) {
    const num = sectionHead && ctx.sectionIndex != null ? String(ctx.sectionIndex + 1).padStart(2, "0") : String(ctx.lineIndex + 1).padStart(2, "0");
    // the section label is the plan's own (副歌一); the English chrome ("02 — CHORUS") is off by
    // default and only stands in when the plan has no label (M6: no English labels on the wall)
    const sectionText = wantSection ? ctx.sectionLabel.trim() || SECTION_LATIN[ctx.sectionKind ?? "verse"] || "" : "";
    const text = [wantNumber ? num : "", sectionText].filter(Boolean).join(wantNumber && sectionText ? "  —  " : "");
    const g = label(text, b.x, ly, labelSize, sys, input.measure);
    out.push(piece("label", [g], { plate: "ink", alpha: 0.78, readable: false, delay: 0.05 }));
    if (on.has("rule") && level >= 0.55 && above) {
      out.push(piece("rule", [], { plate: "ink", alpha: 0.6, readable: false, rect: { x: b.x + g.w + labelSize * 0.8, y: ly + labelSize / 2 - 1, w: Math.max(labelSize * 2, Math.min(b.w * 0.5, f.W * 0.18)), h: Math.max(2, labelSize * 0.07) }, delay: 0.08 }));
    }
  }
  // the song title: on the first line and the last one, quietly
  if (on.has("title") && level >= 0.7 && ctx.songTitle && (ctx.lineIndex === 0 || ctx.lineIndex === ctx.lineCount - 1)) {
    const g = label(ctx.songTitle.toUpperCase(), b.x + b.w, b.y + b.h + gap, labelSize * 0.9, sys, input.measure, "right", 0.22);
    if (g.y + g.h / 2 < f.safe.y + f.safe.h) out.push(piece("label", [g], { plate: "ink", alpha: 0.66, readable: false, delay: 0.15 }));
  }
  // 「」 as graphics around the text block (MV cards)
  if (wantBracket && bracketFits) {
    const open = vertical ? "﹁" : "「";
    const close = vertical ? "﹂" : "」";
    const og: GlyphBox = { ch: open, font: "cjk", weight: sys.weight, size: bs, x: b.x - bs * 0.62, y: b.y - bs * 0.2, w: bs, h: bs, rotate: 0, plate: "accent", order: 960, unit: -1, t0: 0, tracking: 0 };
    const cg: GlyphBox = { ...og, ch: close, x: b.x + b.w + bs * 0.62, y: b.y + b.h + bs * 0.2, order: 961 };
    if (og.x - bs / 2 >= f.safe.x - 1 && cg.x + bs / 2 <= f.safe.x + f.safe.w + 1 && og.y - bs / 2 >= 0 && cg.y + bs / 2 <= f.H) {
      out.push(piece("bracket", [og], { plate: "accent", alpha: 0.9, readable: false }), piece("bracket", [cg], { plate: "accent", alpha: 0.9, readable: false, delay: 0.12 }));
    }
  }
  // the seal (印章) at the end of the text: vertical columns end at their foot, rows at their end
  const sealText = [...(sys.seal ?? "").replace(/\s+/g, "")].slice(0, 4).join("");
  const sealLine = input.hint.recipe === "brush-write" || sectionHead || ornamentSeed < 0.2;
  if (on.has("seal") && sealText && level >= 0.25 && sealLine) {
    const ss = Math.max(f.minRead * 1.05, Math.min(f.ref * 0.085, r.body * 0.62));
    const main = pieces.filter((p) => p.readable && p.role !== "translation");
    const last = main.flatMap((p) => p.glyphs).filter((g) => g.unit >= 0).sort((a, b2) => a.order - b2.order).pop();
    if (last) {
      let sx: number;
      let sy: number;
      if (vertical) {
        sx = last.x - ss / 2;
        sy = last.y + last.h / 2 + ss * 0.35;
        if (sy + ss > f.read.y + f.read.h) {
          sx = last.x - last.w / 2 - ss * 1.25;
          sy = last.y + last.h / 2 - ss;
        }
      } else {
        sx = last.x + last.w / 2 + ss * 0.4;
        sy = last.y - ss / 2;
        if (sx + ss > f.safe.x + f.safe.w) {
          sx = last.x + last.w / 2 - ss;
          sy = last.y + last.h / 2 + ss * 0.3;
        }
      }
      const n = [...sealText].length;
      // one character fills the seal; two stack; three or four read in columns right to left
      const cs = ss * (n <= 1 ? 0.7 : n === 2 ? 0.46 : 0.42);
      const glyphs: GlyphBox[] = [...sealText].map((ch, i) => {
        const col = n <= 2 ? 0 : Math.floor(i / 2);
        const row = n <= 1 ? 0 : i % 2;
        const cx = n <= 2 ? sx + ss / 2 : sx + ss * (col === 0 ? 0.73 : 0.27);
        const cy = n <= 1 ? sy + ss / 2 : sy + ss * (row === 0 ? 0.28 : 0.72);
        return { ch, font: "cjk" as const, weight: 700, size: cs, x: cx, y: cy, w: cs, h: cs, rotate: 0, plate: "spot" as PlateId, order: 970 + i, unit: -1, t0: 0, tracking: 0 };
      });
      out.push(piece("seal", glyphs, { plate: "spot", alpha: 0.96, readable: false, rect: { x: sx, y: sy, w: ss, h: ss }, delay: 0.3 }));
    }
  }
  return out;
}

function autoEnter(voice: TypeVoiceId, recipe: TypeRecipeId, motion: MotionKind): Exclude<TypeEnterId, "auto"> {
  if (recipe === "whisper") return "fade";
  if (recipe === "brush-write") return "write";
  const v = VOICES[voice].enter;
  if (v === "cut" || v === "glitch") return recipe === "window" && voice === "mv-card" ? "fade" : (v as "cut" | "glitch");
  if (voice === "ink") return recipe === "scatter" ? (motion === "fall" ? "fall" : "fade") : recipe === "vertical-column" || recipe === "cross" ? "write" : motion === "bloom" ? "bloom" : "fade";
  if (motion === "fall") return "fall";
  if (motion === "rise") return "rise";
  if (motion === "bloom") return recipe === "window" ? "wipe" : "bloom";
  return v === "auto" ? "fade" : (v as Exclude<TypeEnterId, "auto">);
}

function autoExit(voice: TypeVoiceId, recipe: TypeRecipeId, motion: MotionKind): Exclude<TypeExitId, "auto"> {
  if (recipe === "whisper") return "fade";
  const v = VOICES[voice].exit;
  if (v === "cut" || v === "glitch" || v === "dissolve") return v;
  if (motion === "fall") return "sink";
  return v === "auto" ? "fade" : (v as Exclude<TypeExitId, "auto">);
}

const ENTER_SECONDS: Record<Exclude<TypeEnterId, "auto">, number> = { cut: 0.05, fade: 0.55, rise: 0.75, fall: 0.8, wipe: 0.6, write: 0.9, scale: 0.4, glitch: 0.34, bloom: 0.85 };
const EXIT_SECONDS: Record<Exclude<TypeExitId, "auto">, number> = { cut: 0.05, fade: 0.45, sink: 0.55, wipe: 0.45, dissolve: 0.85, scale: 0.32, glitch: 0.28, blur: 0.5 };

/**
 * Restraint: a line that is not one of the song's key lines never gets a display recipe that only
 * works large (出血 runs off the frame, 鏤空窗 fills it): it becomes 巨字＋小字 at a modest scale.
 * A recipe the editor set is kept. Hints without the flag (older callers) are left as they are.
 */
function restrain(hint: ResolvedHint): ResolvedHint {
  if (hint.key !== false || hint.recipeFixed) return hint;
  if (hint.recipe === "bleed" || hint.recipe === "window") return { ...hint, recipe: "giant-word" };
  return hint;
}

/** A stable key for a composition input (the layout cache). */
export function composeKey(input: Omit<ComposeInput, "measure">): string {
  const h = input.hint;
  const s = input.system;
  const c = input.canvas;
  return [
    input.lineId,
    input.lt.text,
    input.lt.translation ?? "",
    h.recipe,
    Math.round(h.seed),
    h.orientation,
    h.energy.toFixed(3),
    h.emphasis.join("\u0001"),
    h.motionWord,
    h.dx.toFixed(4),
    h.dy.toFixed(4),
    h.scale.toFixed(3),
    h.rotate.toFixed(2),
    h.enter,
    h.exit,
    h.color,
    h.escalate ? 1 : 0,
    h.key == null ? "" : h.key ? "k" : "n",
    h.recipeFixed ? 1 : 0,
    h.motion ?? "",
    s.voice,
    Object.values(s.params)
      .map((v) => Number(v).toFixed(3))
      .join(","),
    s.color,
    s.fonts.cjk,
    s.fonts.latin,
    s.weight,
    s.ornaments.join(","),
    s.seal,
    c.width,
    c.height,
    `${c.safe.top},${c.safe.right},${c.safe.bottom},${c.safe.left}`,
    input.ctx.lineIndex,
    input.ctx.sectionIndex ?? "",
    input.ctx.sectionLabel,
    input.ctx.songTitle,
    input.ctx.first ? 1 : 0,
    input.ctx.zone ? `${input.ctx.zone.x},${input.ctx.zone.y},${input.ctx.zone.w},${input.ctx.zone.h}` : "",
  ].join("|");
}

/**
 * The canvas decides an automatic orientation too: on a tall frame (9:16) a display word stands up
 * (巨字 becomes a column beside horizontal small text, 出血 and 鏤空窗 run vertically). An
 * orientation set in the editor is kept.
 */
export function effectiveOrientation(hint: Pick<ResolvedHint, "recipe" | "orientation" | "orientationFixed">, cjk: boolean, aspect: number): TypeOrientation {
  if (!cjk || hint.orientationFixed || !(aspect < 0.8) || hint.orientation !== "h") return hint.orientation;
  switch (hint.recipe) {
    case "giant-word":
      return "mixed";
    case "bleed":
    case "window":
      return "v";
    default:
      return hint.orientation;
  }
}

/**
 * An ultra-wide canvas (a 32:9 LED wall) is not one composition from end to end: a line is laid
 * out in a 16:9-and-a-bit view that slides to the side its seed leans to (a bled word's view sits
 * on the edge it bleeds from), then moved into place. Null on every other canvas.
 */
function compositionView(canvas: CanvasSpec, hint: ResolvedHint): { canvas: CanvasSpec; x0: number } | null {
  const W = canvas.width || 1920;
  const H = canvas.height || 1080;
  if (!(W / H > 2.4)) return null;
  const Ws = Math.min(W, Math.round(H * (16 / 9) * 1.2));
  const zone = zoneFor(hint.seed);
  const side = hint.recipe === "bleed" ? (zone.side === "right" ? "right" : "left") : zone.side;
  const x0 = side === "left" ? 0 : side === "right" ? W - Ws : Math.round((W - Ws) / 2);
  const s = canvas.safe ?? DEFAULT_LYRIC_SAFE;
  const inner = 0.03;
  const left = x0 <= 0 ? ((s.left ?? DEFAULT_LYRIC_SAFE.left) * W) / Ws : inner;
  const right = x0 + Ws >= W ? ((s.right ?? DEFAULT_LYRIC_SAFE.right) * W) / Ws : inner;
  return { canvas: { width: Ws, height: H, safe: { top: s.top, bottom: s.bottom, left: Math.min(0.3, left), right: Math.min(0.3, right) } }, x0 };
}

/** Lay one line out (never throws; an empty line gives an empty composition). */
export function composeLine(given: ComposeInput): Composition {
  const full = makeFrame(given.canvas, given.system.params);
  // 專屬畫面: the section's text zone (the image's negative space) narrows the readable area
  const zone = given.ctx.zone ? canvasZone(given.ctx.zone, full.aspect) : null;
  const hint0: ResolvedHint = restrain(given.hint);
  const hint: ResolvedHint = { ...hint0, orientation: effectiveOrientation(hint0, given.lt.cjk, full.aspect) };
  const view = zone ? null : compositionView(given.canvas, hint);
  const input: ComposeInput = { ...given, hint, canvas: view ? view.canvas : given.canvas };
  const frame = view ? makeFrame(view.canvas, given.system.params) : zone ? makeFrame(given.canvas, given.system.params, zone) : full;
  let recipe = hint.recipe;
  let pieces: Piece[] | null = null;
  // the line-length policy (B4): a long line is two staggered phrases, whatever its recipe says
  const long = isLongUnits(given.lt.units);
  if (long) {
    try {
      pieces = longLine(recipeCtx(input, frame, recipe));
    } catch {
      pieces = null;
    }
    if (pieces && !pieces.some((p) => p.glyphs.length)) pieces = null;
  }
  const tried = new Set<TypeRecipeId>();
  for (let guard = 0; guard < 4 && !pieces; guard++) {
    tried.add(recipe);
    try {
      pieces = RECIPE_FNS[recipe](recipeCtx(input, frame, recipe));
    } catch {
      pieces = null;
    }
    if (!pieces || !pieces.some((p) => p.glyphs.length)) {
      pieces = null;
      const next = RECIPE_FALLBACK[recipe];
      if (tried.has(next)) break;
      recipe = next;
    }
  }
  const r = recipeCtx(input, frame, recipe);
  pieces = pieces ?? [];
  if (hint.color === "invert") pieces = invertDisplay(pieces);
  // legibility: the readable text stays in the readable area before anything else is added
  fitInto(pieces, frame.read, frame.minRead);
  pieces = ornaments(r, pieces, input);
  pieces = placeTranslation(pieces, frame, r);
  // an ultra-wide canvas: the view slides into place
  if (view) moveAll(pieces, view.x0, 0);

  // the editor's changes, around the readable block's centre (fractions of the whole canvas)
  const b0 = readableBox(pieces);
  const cx = b0.x + b0.w / 2;
  const cy = b0.y + b0.h / 2;
  const smallest = minReadable(pieces);
  const minScale = smallest > 0 ? full.minRead / smallest : 0.5;
  const scale = clamp(hint.scale, Math.max(0.5, minScale), 2);
  scaleAll(pieces, scale, cx, cy);
  rotateAll(pieces, (clamp(hint.rotate, -30, 30) * Math.PI) / 180, cx, cy);
  moveAll(pieces, clamp(hint.dx, -0.5, 0.5) * full.W, clamp(hint.dy, -0.5, 0.5) * full.H);
  const edited = scale !== 1 || hint.rotate !== 0 || hint.dx !== 0 || hint.dy !== 0;
  // nudged text may leave the readable band but never the canvas
  fitInto(pieces, edited ? { x: 0, y: 0, w: full.W, h: full.H } : zone ? frame.read : full.read, full.minRead);
  // the hard clamp: every glyph box and ornament inside the lyric safe area (the whole canvas for a nudged line)
  pieces = clampToSafe(pieces, edited ? { x: 0, y: 0, w: full.W, h: full.H } : full.safe);

  const voice = input.system.voice;
  const motion: MotionKind = recipe === "whisper" && hint.motionWord === "" ? "still" : motionKindOf(hint.motionWord);
  const enter = hint.enter !== "auto" ? hint.enter : autoEnter(voice, recipe, motion);
  const exit = hint.exit !== "auto" ? hint.exit : autoExit(voice, recipe, motion);
  const speed = lerp(1.45, 0.7, clamp(input.system.params.motionSpeed, 0, 1)) / VOICES[voice].speedScale;
  const readBounds = readableBox(pieces);
  const bounds = allBox(pieces);
  const window = pieces.some((p) => p.window);
  // 鏤空窗 and the 鏤空 role fill the frame; a display word the knockout treatment opens leaves the stage half seen
  const windowFill = !window ? 0 : recipe === "window" || hint.color === "window" ? 1 : clamp(lerp(0.52, 0.84, (r.e - KNOCK_ENERGY) / (1 - KNOCK_ENERGY)), 0.52, 0.84);
  return {
    lineIndex: input.ctx.lineIndex,
    lineId: input.lineId,
    recipe,
    voice,
    orientation: hint.orientation,
    motion,
    motionAmount: clamp(hint.motion ?? input.system.params.motionIntensity, 0, 1),
    energy: r.e,
    enter,
    exit,
    enterDur: ENTER_SECONDS[enter] * (enter === "cut" ? 1 : speed),
    exitDur: EXIT_SECONDS[exit] * (exit === "cut" ? 1 : speed),
    snap: VOICES[voice].snap,
    pieces,
    readBounds,
    bounds,
    window,
    windowFill,
    seal: pieces.some((p) => p.role === "seal"),
    minReadable: minReadable(pieces),
    key: String(hash32(composeKey(given))),
  };
}

export { glyphBox, pieceBox };
