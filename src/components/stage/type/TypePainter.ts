// Canvas-2D painter of compositions: draws what is on screen at a moment into one canvas that the
// GL type pass uses as a texture (src/lib/stage/scenes/type.ts). In "plates" mode each colour
// channel is a plate — red the ink (lyric colour), green the accent, blue the spot (a knockout
// window mask or the seal) — and alpha carries a soft halo around readable glyphs, so the shader
// colours, blends and textures the type itself. "color" mode paints real colours (no WebGL).
//
// Glyphs are rasterized once into a sprite cache (per face, weight, size step and plate) and only
// composited per frame with their transform, opacity and reveal, so animating a line costs a few
// dozen drawImage calls, not re-rasterizing text.

import { glyphFrame, pieceFrame, type GlyphFrame, type TypeClock } from "@/lib/type/animate";
import type { Composition, FontRole, GlyphBox, Measure, Piece, PlateId } from "@/lib/type/model";
import { hashUnit } from "@/lib/type/rng";
import { drawnWeight, type TypeFamilies } from "./fonts";

export type PaintMode = "plates" | "color";

export interface PaintColors {
  ink: string;
  accent: string;
  spot: string;
}

export interface PaintItem {
  comp: Composition;
  clock: TypeClock;
  /** 0..1 (the lyrics-visible ramp) */
  alpha: number;
}

interface Sprite {
  canvas: HTMLCanvasElement;
  /** the glyph cell's centre inside the sprite (px) */
  cx: number;
  cy: number;
  /** the cell size inside the sprite (px) */
  cw: number;
  ch: number;
  pixels: number;
  used: number;
}

const PLATE_COLOR: Record<PlateId, string> = { ink: "#ff0000", accent: "#00ff00", spot: "#0000ff" };
const MAX_SPRITE_PIXELS = 48_000_000;

function bucket(px: number): number {
  if (px <= 10) return Math.max(2, Math.ceil(px));
  return Math.pow(2, Math.ceil(Math.log2(px) * 6) / 6);
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export class TypePainter {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sprites = new Map<string, Sprite>();
  private spritePixels = 0;
  private tick = 0;
  private families: TypeFamilies = { cjk: "sans-serif", latin: "sans-serif", key: "default" };
  private measureCtx: CanvasRenderingContext2D;
  private measured = new Map<string, number>();
  private centers = new Map<string, number>();
  private gf: GlyphFrame = { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0, reveal: 1, revealFromEnd: false };

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? makeCanvas(16, 16);
    const ctx = this.canvas.getContext("2d", { alpha: true, willReadFrequently: false });
    if (!ctx) throw new Error("canvas 2d unavailable");
    this.ctx = ctx;
    const m = makeCanvas(8, 8).getContext("2d");
    if (!m) throw new Error("canvas 2d unavailable");
    this.measureCtx = m;
  }

  setFamilies(f: TypeFamilies) {
    if (f.key === this.families.key) return;
    this.families = f;
    this.invalidate();
  }

  /** Fonts changed (loaded, another system): every sprite and measurement is stale. */
  invalidate() {
    this.sprites.clear();
    this.spritePixels = 0;
    this.measured.clear();
    this.centers.clear();
  }

  resize(w: number, h: number) {
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
  }

  private font(role: FontRole, weight: number, px: number): string {
    // the face's own weight (a canvas asked for a weight the face lacks smears a faux bold)
    return `${drawnWeight(this.families, role, weight)} ${px}px ${role === "latin" ? this.families.latin : this.families.cjk}`;
  }

  /** Advances in ems, measured with the real faces (CJK characters are one em). */
  readonly measure: Measure = (text, role, weight) => {
    const key = `${role}|${weight}|${text}`;
    const hit = this.measured.get(key);
    if (hit != null) return hit;
    const ctx = this.measureCtx;
    ctx.font = this.font(role, weight, 100);
    const w = ctx.measureText(text).width / 100;
    if (this.measured.size > 4000) this.measured.clear();
    this.measured.set(key, w);
    return w;
  };

  /** Offset (ems) from the em box centre to the alphabetic baseline of the CJK face. */
  private center(weight: number): number {
    const key = `${this.families.cjk}|${weight}`;
    let c = this.centers.get(key);
    if (c == null) {
      const ctx = this.measureCtx;
      ctx.font = this.font("cjk", weight, 100);
      const m = ctx.measureText("永");
      const asc = m.emHeightAscent;
      const desc = m.emHeightDescent;
      c = Number.isFinite(asc) && Number.isFinite(desc) && asc + desc > 50 ? (asc - desc) / 2 / 100 : 0.38;
      this.centers.set(key, c);
    }
    return c;
  }

  private sprite(g: GlyphBox, px: number, kind: "plate" | "halo", color: string): Sprite {
    const b = bucket(px);
    const key = `${kind}|${g.font}|${g.weight}|${b}|${g.font === "latin" ? Math.round((g.tracking / Math.max(1, g.size)) * 1000) : 0}|${color}|${g.ch}`;
    const hit = this.sprites.get(key);
    if (hit) {
      hit.used = this.tick;
      return hit;
    }
    const tracking = (g.tracking / Math.max(1, g.size)) * b;
    const cellW = Math.max(1, (g.w / Math.max(1, g.size)) * b);
    const cellH = Math.max(1, (g.h / Math.max(1, g.size)) * b);
    const halo = kind === "halo" ? Math.min(64, Math.max(3, b * 0.16)) : 0;
    // sideways runs are drawn unrotated (the transform turns them): the cell is along the text
    const pad = Math.ceil(b * 0.34 + halo * 2.2);
    const w = cellW + pad * 2;
    const h = Math.max(cellH, b) + pad * 2;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.font = this.font(g.font, g.weight, b);
    if (g.font === "latin" && tracking) ctx.letterSpacing = `${tracking}px`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const cx = w / 2 + (g.font === "latin" && tracking ? tracking / 2 : 0);
    const cy = h / 2;
    // CJK and Latin share the alphabetic baseline under the CJK em box centre (as CSS lays them out)
    const baseline = cy + this.center(g.weight) * b;
    if (kind === "halo") {
      // only the blurred shadow lands in the sprite (the glyph is drawn far off canvas)
      ctx.shadowColor = "rgba(0,0,0,1)";
      ctx.shadowBlur = halo * 2;
      ctx.shadowOffsetX = 100000;
      ctx.fillStyle = "#000";
      ctx.fillText(g.ch, cx - 100000, baseline);
      ctx.shadowColor = "transparent";
      ctx.fillText(g.ch, cx, baseline);
    } else {
      ctx.fillStyle = color;
      ctx.fillText(g.ch, cx, baseline);
    }
    const s: Sprite = { canvas, cx: w / 2, cy, cw: cellW, ch: Math.max(cellH, b), pixels: canvas.width * canvas.height, used: this.tick };
    this.sprites.set(key, s);
    this.spritePixels += s.pixels;
    if (this.spritePixels > MAX_SPRITE_PIXELS) this.evict();
    return s;
  }

  private evict() {
    const list = [...this.sprites.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, s] of list) {
      if (this.spritePixels <= MAX_SPRITE_PIXELS * 0.6) break;
      if (s.used === this.tick) continue;
      this.sprites.delete(key);
      this.spritePixels -= s.pixels;
    }
  }

  /** Clear the canvas and draw every item (output px × `scale` = canvas px). */
  paint(items: readonly PaintItem[], scale: number, mode: PaintMode, colors?: PaintColors) {
    this.tick++;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const plates = mode === "plates";
    const colorOf = (plate: PlateId) => (plates ? PLATE_COLOR[plate] : plate === "ink" ? (colors?.ink ?? "#fff") : plate === "accent" ? (colors?.accent ?? "#fc6") : (colors?.spot ?? "#c8402f"));
    for (const it of items) {
      if (it.alpha <= 0.002) continue;
      const pieces = it.comp.pieces;
      // halos under the readable text, then the plates
      ctx.globalCompositeOperation = plates ? "lighter" : "source-over";
      for (const p of pieces) if (this.wantsHalo(p)) this.drawPiece(it, p, scale, "halo", "#000", plates);
      for (const p of pieces) {
        if (p.rect && p.role !== "seal") this.drawRect(it, p, scale, plates ? PLATE_COLOR[p.plate] : colorOf(p.plate));
        if (p.role === "seal") {
          this.drawSeal(it, p, scale, plates ? PLATE_COLOR.spot : colorOf("spot"), plates);
          continue;
        }
        if (!p.glyphs.length) continue;
        if (p.knockout) {
          ctx.globalCompositeOperation = "destination-out";
          this.drawPiece(it, p, scale, "plate", "#000", plates);
          ctx.globalCompositeOperation = plates ? "lighter" : "source-over";
          continue;
        }
        // without WebGL a window cannot show the scene: it is drawn as ink
        const plate = !plates && p.window ? "ink" : p.plate;
        this.drawPiece(it, p, scale, "plate", colorOf(plate), plates, !plates && p.window ? 0.9 : 1);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private wantsHalo(p: Piece): boolean {
    return p.glyphs.length > 0 && !p.window && !p.echo && !p.knockout && (p.readable || p.role === "label" || p.role === "bracket") && p.role !== "giant";
  }

  private drawRect(it: PaintItem, p: Piece, scale: number, color: string) {
    const r = p.rect!;
    const ctx = this.ctx;
    const pf = pieceFrame(it.comp, p, it.clock);
    // rules draw in with the entrance (a wipe from their start)
    const c = it.clock;
    const enter = Math.min(1, Math.max(0, (c.since - p.delay) / Math.max(0.05, it.comp.enterDur)));
    const reveal = it.comp.enter === "cut" ? (c.since >= 0 ? 1 : 0) : 1 - Math.pow(1 - enter, 3);
    const exit = c.exit ?? 0;
    const alpha = pf.alpha * it.alpha * (it.comp.exit === "cut" && exit > 0 ? 0 : 1 - Math.pow(exit, 1.5));
    if (alpha <= 0.002 || reveal <= 0) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalAlpha = Math.min(1, alpha);
    if (p.grid) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1 / scale, 1.2);
      ctx.beginPath();
      const { cols, rows } = p.grid;
      for (let i = 0; i <= cols; i++) {
        const x = r.x + (r.w * i) / cols;
        ctx.moveTo(x, r.y);
        ctx.lineTo(x, r.y + r.h * reveal);
      }
      for (let j = 0; j <= rows; j++) {
        const y = r.y + (r.h * j) / rows;
        ctx.moveTo(r.x, y);
        ctx.lineTo(r.x + r.w * reveal, y);
      }
      ctx.stroke();
      return;
    }
    ctx.fillStyle = color;
    if (r.w >= r.h) ctx.fillRect(r.x, r.y, r.w * reveal, r.h);
    else ctx.fillRect(r.x, r.y, r.w, r.h * reveal);
  }

  private drawSeal(it: PaintItem, p: Piece, scale: number, color: string, plates: boolean) {
    const r = p.rect;
    if (!r) return;
    const c = it.clock;
    const t = Math.min(1, Math.max(0, (c.since - p.delay * 2) / 0.35));
    const exit = c.exit ?? 0;
    const alpha = p.alpha * it.alpha * t * (1 - exit);
    if (alpha <= 0.002) return;
    const ctx = this.ctx;
    // a stamp lands: slightly large, then pressed (scaled about its centre c, in canvas px)
    const k = 1 + 0.12 * (1 - t);
    const cx = (r.x + r.w / 2) * scale;
    const cy = (r.y + r.h / 2) * scale;
    const ox = cx * (1 - k);
    const oy = cy * (1 - k);
    ctx.setTransform(scale * k, 0, 0, scale * k, ox, oy);
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = color;
    const inset = r.w * 0.04;
    ctx.fillRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
    // the characters are cut out of the stamp (the stage shows through them)
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "destination-out";
    for (const g of p.glyphs) {
      const px = g.size * scale * k;
      const s = this.sprite(g, px, "plate", "#000");
      const f = px / bucket(px);
      ctx.setTransform(f, 0, 0, f, g.x * scale * k + ox, g.y * scale * k + oy);
      ctx.drawImage(s.canvas, -s.cx, -s.cy);
    }
    ctx.globalCompositeOperation = op;
    if (!plates) ctx.globalCompositeOperation = "source-over";
  }

  private drawPiece(it: PaintItem, p: Piece, scale: number, kind: "plate" | "halo", color: string, plates: boolean, alphaMul = 1) {
    const ctx = this.ctx;
    const comp = it.comp;
    const pf = pieceFrame(comp, p, it.clock);
    const pa = pf.alpha * it.alpha * alphaMul * (kind === "halo" ? (plates ? 0.72 : 0.5) : 1);
    if (pa <= 0.002) return;
    const ex = p.echo ? p.echo.dx * pf.spread : 0;
    const ey = p.echo ? p.echo.dy * pf.spread : 0;
    const gf = this.gf;
    for (let i = 0; i < p.glyphs.length; i++) {
      const g = p.glyphs[i];
      glyphFrame(comp, p, g, i, it.clock, gf);
      const alpha = pa * gf.alpha;
      if (alpha <= 0.002 || gf.reveal <= 0.001) continue;
      const px = g.size * scale;
      const s = this.sprite(g, px, kind, color);
      const f = (px / bucket(px)) * gf.scale;
      const x = (g.x + gf.dx + ex) * scale;
      const y = (g.y + gf.dy + ey) * scale;
      const rot = g.rotate + gf.rotate;
      const cos = Math.cos(rot) * f;
      const sin = Math.sin(rot) * f;
      ctx.setTransform(cos, sin, -sin, cos, x, y);
      ctx.globalAlpha = Math.min(1, alpha);
      const revealDown = comp.enter === "write" ? g.font !== "latin" : p.vertical;
      if (p.slices && kind === "plate") {
        this.drawSliced(s, p, g, pf.slice, pf.sliceSeed, gf.reveal);
        continue;
      }
      if (gf.reveal >= 0.999) {
        ctx.drawImage(s.canvas, -s.cx, -s.cy);
        continue;
      }
      // partial reveal along the reading direction (wipe, write, the exit wipe)
      if (revealDown) {
        const y0 = s.cy - s.ch / 2;
        const cut = y0 + s.ch * gf.reveal;
        const from = gf.revealFromEnd ? y0 + s.ch * (1 - gf.reveal) : 0;
        const to = gf.revealFromEnd ? s.canvas.height : cut;
        if (to - from > 0.5) ctx.drawImage(s.canvas, 0, from, s.canvas.width, to - from, -s.cx, from - s.cy, s.canvas.width, to - from);
      } else {
        const x0 = s.cx - s.cw / 2;
        const cut = x0 + s.cw * gf.reveal;
        const from = gf.revealFromEnd ? x0 + s.cw * (1 - gf.reveal) : 0;
        const to = gf.revealFromEnd ? s.canvas.width : cut;
        if (to - from > 0.5) ctx.drawImage(s.canvas, from, 0, to - from, s.canvas.height, from - s.cx, -s.cy, to - from, s.canvas.height);
      }
    }
  }

  /** 撕裂: horizontal slices of the glyph, each shifted by a seeded amount. */
  private drawSliced(s: Sprite, p: Piece, g: GlyphBox, amount: number, seed: number, reveal: number) {
    const ctx = this.ctx;
    const n = Math.max(2, p.slices ?? 5);
    const h = s.canvas.height;
    const w = s.canvas.width * Math.min(1, reveal + 0.001);
    for (let k = 0; k < n; k++) {
      const y0 = Math.floor((h * k) / n);
      const y1 = Math.floor((h * (k + 1)) / n);
      const shiftK = (hashUnit(`sl|${g.order}|${k}|${seed}`) - 0.5) * amount * s.cw * 0.42;
      ctx.drawImage(s.canvas, 0, y0, w, y1 - y0, -s.cx + shiftK, y0 - s.cy, w, y1 - y0);
    }
  }
}
