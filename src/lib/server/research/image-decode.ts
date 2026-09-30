// Just enough image decoding on the server to measure a collected image's colours (研究找到的素材,
// phase 8) without a dependency: the kind, the pixel size, and a small RGBA sample for
// `extractMoodStats` (the same palette code the browser runs on uploaded mood board images).
//
//   JPEG  the DC coefficients only (baseline and progressive): a 1/8-scale picture, no IDCT
//   PNG   zlib (node:zlib) + the five row filters; 1/2/4/8/16-bit, grey / RGB / palette / alpha;
//         interlaced files and images over MAX_PIXELS are not decoded
//   GIF   the first frame's LZW indices through its colour table (pixel order does not matter for
//         a palette)
//   WebP  size only (no palette: the browser measures it when the item is shown)
//
// Everything is bounded (pixel counts, output sizes) and returns null on anything unexpected.

import zlib from "node:zlib";
import { sniffMedia } from "@/lib/server/asset-files";

export type ImageFamily = "png" | "jpeg" | "webp" | "gif";

export const IMAGE_MIME: Record<ImageFamily, { mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; ext: string }> = {
  png: { mimeType: "image/png", ext: "png" },
  jpeg: { mimeType: "image/jpeg", ext: "jpg" },
  webp: { mimeType: "image/webp", ext: "webp" },
  gif: { mimeType: "image/gif", ext: "gif" },
};

/** Images larger than this (width × height) are not decoded for colour. */
export const MAX_PIXELS = 40_000_000;
/** The RGBA sample handed to the palette code: at most this many pixels. */
const SAMPLE_PIXELS = 96 * 96;

/** JPEG / PNG / WebP / GIF by magic bytes; anything else (SVG, HTML, video…) is null. */
export function sniffImage(bytes: Uint8Array): ImageFamily | null {
  const s = sniffMedia(bytes.subarray(0, 64));
  if (s.kind !== "media") return null;
  return s.family === "png" || s.family === "jpeg" || s.family === "webp" || s.family === "gif" ? s.family : null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

// ---------------------------------------------------------------------------
// size
// ---------------------------------------------------------------------------

export function imageSize(bytes: Uint8Array, family: ImageFamily): { width: number; height: number } | null {
  const ok = (w: number, h: number) => (w > 0 && h > 0 && w <= 65535 && h <= 65535 ? { width: w, height: h } : null);
  try {
    if (family === "png") return bytes.length >= 24 && ascii(bytes, 12, 4) === "IHDR" ? ok(u32be(bytes, 16), u32be(bytes, 20)) : null;
    if (family === "gif") return bytes.length >= 10 ? ok(u16le(bytes, 6), u16le(bytes, 8)) : null;
    if (family === "webp") {
      const chunk = ascii(bytes, 12, 4);
      if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return ok(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
      if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
        const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
        return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      if (chunk === "VP8X" && bytes.length >= 30) return ok(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
      return null;
    }
    // JPEG: walk the markers to the frame header
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = u16be(bytes, i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ok(u16be(bytes, i + 7), u16be(bytes, i + 5));
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// a small RGBA sample
// ---------------------------------------------------------------------------

export interface RgbaSample {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel */
  data: Uint8Array;
}

/** Nearest-neighbour downsample of an RGBA picture to at most SAMPLE_PIXELS. */
function downsample(width: number, height: number, px: (x: number, y: number, out: Uint8Array, at: number) => void): RgbaSample {
  const scale = Math.min(1, Math.sqrt(SAMPLE_PIXELS / (width * height)));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / w));
      px(sx, sy, data, (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

/** A small RGBA sample of the image for its palette, or null (WebP, interlaced PNG, unexpected data). */
export function decodeSample(bytes: Uint8Array, family: ImageFamily): RgbaSample | null {
  try {
    if (family === "png") return decodePng(bytes);
    if (family === "jpeg") return decodeJpegDc(bytes);
    if (family === "gif") return decodeGif(bytes);
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function decodePng(bytes: Uint8Array): RgbaSample | null {
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  const depth = bytes[24];
  const color = bytes[25];
  const interlace = bytes[28];
  if (!width || !height || width * height > MAX_PIXELS || interlace !== 0) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) return null;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len = u32be(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    const data = bytes.subarray(i + 8, i + 8 + len);
    if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    i += 12 + len;
  }
  if (!idat.length || (color === 3 && !palette)) return null;
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const expected = height * (stride + 1);
  if (expected > 256 * 1024 * 1024) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d.buffer, d.byteOffset, d.byteLength))), { maxOutputLength: expected + 1024 });
  if (raw.length < expected) return null;
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= bpp ? rows[dst + x - bpp] : 0;
      const b = y > 0 ? rows[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? rows[dst - stride + x - bpp] : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + a;
          break;
        case 2:
          out = v + b;
          break;
        case 3:
          out = v + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          return null;
      }
      rows[dst + x] = out & 255;
    }
  }
  const sampleAt = (x: number, y: number, ch: number): number => {
    const row = y * stride;
    if (depth === 8) return rows[row + x * channels + ch];
    if (depth === 16) return rows[row + (x * channels + ch) * 2];
    const bit = (x * channels + ch) * depth;
    const v = (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return color === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  return downsample(width, height, (x, y, out, at) => {
    if (color === 3) {
      const idx = sampleAt(x, y, 0);
      out[at] = palette![idx * 3] ?? 0;
      out[at + 1] = palette![idx * 3 + 1] ?? 0;
      out[at + 2] = palette![idx * 3 + 2] ?? 0;
      out[at + 3] = trns && idx < trns.length ? trns[idx] : 255;
    } else if (color === 0 || color === 4) {
      const g = sampleAt(x, y, 0);
      out[at] = out[at + 1] = out[at + 2] = g;
      out[at + 3] = color === 4 ? sampleAt(x, y, 1) : 255;
    } else {
      out[at] = sampleAt(x, y, 0);
      out[at + 1] = sampleAt(x, y, 1);
      out[at + 2] = sampleAt(x, y, 2);
      out[at + 3] = color === 6 ? sampleAt(x, y, 3) : 255;
    }
  });
}

// ---------------------------------------------------------------------------
// JPEG: DC coefficients only
// ---------------------------------------------------------------------------

interface Huffman {
  /** code -> symbol, keyed by (length << 16) | code */
  map: Map<number, number>;
  maxLen: number;
}

function buildHuffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const map = new Map<number, number>();
  let code = 0;
  let k = 0;
  let maxLen = 0;
  for (let len = 1; len <= 16; len++) {
    for (let n = 0; n < counts[len - 1]; n++) {
      map.set((len << 16) | code, symbols[k++]);
      maxLen = len;
      code++;
    }
    code <<= 1;
  }
  return { map, maxLen };
}

interface JpegComponent {
  id: number;
  h: number;
  v: number;
  tq: number;
  /** DC per block on the MCU-padded grid */
  dc: Float32Array;
  done: boolean;
}

class BitReader {
  private bit = 0;
  private cur = 0;
  /** a marker was reached: the scan's data ended */
  marker = false;
  constructor(
    private readonly b: Uint8Array,
    public pos: number,
  ) {}
  private nextByte(): number {
    if (this.marker || this.pos >= this.b.length) return 0;
    const v = this.b[this.pos];
    if (v === 0xff) {
      const n = this.b[this.pos + 1];
      if (n === 0x00) {
        this.pos += 2;
        return 0xff;
      }
      this.marker = true;
      return 0;
    }
    this.pos++;
    return v;
  }
  read1(): number {
    if (this.bit === 0) {
      this.cur = this.nextByte();
      this.bit = 8;
    }
    this.bit--;
    return (this.cur >> this.bit) & 1;
  }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.read1();
    return v;
  }
  decode(t: Huffman): number {
    let code = 0;
    for (let len = 1; len <= t.maxLen; len++) {
      code = (code << 1) | this.read1();
      const s = t.map.get((len << 16) | code);
      if (s !== undefined) return s;
    }
    throw new Error("bad huffman code");
  }
  /** skip to the restart marker (RSTn) and past it */
  restart(): void {
    this.bit = 0;
    this.marker = false;
    while (this.pos + 1 < this.b.length) {
      if (this.b[this.pos] === 0xff && this.b[this.pos + 1] >= 0xd0 && this.b[this.pos + 1] <= 0xd7) {
        this.pos += 2;
        return;
      }
      this.pos++;
    }
  }
  /** the position of the marker that ends the scan */
  end(): number {
    let p = this.pos;
    while (p + 1 < this.b.length) {
      if (this.b[p] === 0xff && this.b[p + 1] !== 0x00 && !(this.b[p + 1] >= 0xd0 && this.b[p + 1] <= 0xd7)) return p;
      p++;
    }
    return this.b.length;
  }
}

function extend(v: number, t: number): number {
  return t === 0 ? 0 : v < 1 << (t - 1) ? v - (1 << t) + 1 : v;
}

function decodeJpegDc(b: Uint8Array): RgbaSample | null {
  const quant: Array<Uint16Array | undefined> = [];
  const dcTables: Array<Huffman | undefined> = [];
  const acTables: Array<Huffman | undefined> = [];
  let comps: JpegComponent[] = [];
  let width = 0;
  let height = 0;
  let progressive = false;
  let restartInterval = 0;
  let hmax = 1;
  let vmax = 1;
  let mcusX = 0;
  let mcusY = 0;
  let adobeTransform = -1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xd8 || marker === 0x01) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    if (marker === 0xd9) break;
    const len = u16be(b, i + 2);
    const seg = b.subarray(i + 4, i + 2 + len);
    const next = i + 2 + len;
    if (marker === 0xdb) {
      let p = 0;
      while (p < seg.length) {
        const pq = seg[p] >> 4;
        const tq = seg[p] & 15;
        const table = new Uint16Array(64);
        for (let k = 0; k < 64; k++) table[k] = pq ? u16be(seg, p + 1 + k * 2) : seg[p + 1 + k];
        quant[tq] = table;
        p += 1 + (pq ? 128 : 64);
      }
    } else if (marker === 0xc4) {
      let p = 0;
      while (p + 17 <= seg.length) {
        const tc = seg[p] >> 4;
        const th = seg[p] & 15;
        const counts = seg.subarray(p + 1, p + 17);
        const total = counts.reduce((a, c) => a + c, 0);
        const table = buildHuffman(counts, seg.subarray(p + 17, p + 17 + total));
        if (tc === 0) dcTables[th] = table;
        else acTables[th] = table;
        p += 17 + total;
      }
    } else if (marker === 0xdd) {
      restartInterval = u16be(seg, 0);
    } else if (marker === 0xee && ascii(seg, 0, 5) === "Adobe") {
      adobeTransform = seg[11];
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      progressive = marker === 0xc2;
      height = u16be(seg, 1);
      width = u16be(seg, 3);
      const n = seg[5];
      if (!width || !height || width * height > MAX_PIXELS || (n !== 1 && n !== 3)) return null;
      comps = [];
      for (let c = 0; c < n; c++) {
        const o = 6 + c * 3;
        comps.push({ id: seg[o], h: Math.max(1, seg[o + 1] >> 4), v: Math.max(1, seg[o + 1] & 15), tq: seg[o + 2], dc: new Float32Array(0), done: false });
      }
      hmax = Math.max(...comps.map((c) => c.h));
      vmax = Math.max(...comps.map((c) => c.v));
      mcusX = Math.ceil(width / (8 * hmax));
      mcusY = Math.ceil(height / (8 * vmax));
      for (const c of comps) c.dc = new Float32Array(mcusX * c.h * mcusY * c.v);
    } else if ((marker >= 0xc3 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return null; // lossless / arithmetic coding
    } else if (marker === 0xda) {
      if (!comps.length) return null;
      const ns = seg[0];
      const scan: Array<{ c: JpegComponent; dc: Huffman | undefined; ac: Huffman | undefined }> = [];
      for (let k = 0; k < ns; k++) {
        const c = comps.find((x) => x.id === seg[1 + k * 2]);
        if (!c) return null;
        scan.push({ c, dc: dcTables[seg[2 + k * 2] >> 4], ac: acTables[seg[2 + k * 2] & 15] });
      }
      const ss = seg[1 + ns * 2];
      const se = seg[2 + ns * 2];
      const ah = seg[3 + ns * 2] >> 4;
      const al = seg[3 + ns * 2] & 15;
      const reader = new BitReader(b, next);
      const firstDc = ss === 0 && ah === 0 && (!progressive || se === 0);
      if (firstDc && scan.every((s) => s.dc && (progressive || s.ac))) {
        const preds = new Float64Array(scan.length);
        const block = (s: (typeof scan)[number], k: number, idx: number) => {
          const t = reader.decode(s.dc!);
          preds[k] += extend(reader.read(t), t);
          s.c.dc[idx] = preds[k] * (progressive ? 1 << al : 1);
          if (!progressive) {
            // skip the AC coefficients
            for (let z = 1; z < 64; ) {
              const rs = reader.decode(s.ac!);
              const r = rs >> 4;
              const size = rs & 15;
              if (size === 0) {
                if (r !== 15) break;
                z += 16;
                continue;
              }
              z += r;
              reader.read(size);
              z++;
            }
          }
        };
        let count = 0;
        const restartCheck = () => {
          if (restartInterval && count > 0 && count % restartInterval === 0) {
            reader.restart();
            preds.fill(0);
          }
        };
        if (scan.length === 1) {
          const s = scan[0];
          const bw = Math.ceil(Math.ceil((width * s.c.h) / hmax) / 8);
          const bh = Math.ceil(Math.ceil((height * s.c.v) / vmax) / 8);
          const gridW = mcusX * s.c.h;
          for (let y = 0; y < bh; y++)
            for (let x = 0; x < bw; x++) {
              restartCheck();
              block(s, 0, y * gridW + x);
              count++;
            }
        } else {
          for (let my = 0; my < mcusY; my++)
            for (let mx = 0; mx < mcusX; mx++) {
              restartCheck();
              scan.forEach((s, k) => {
                const gridW = mcusX * s.c.h;
                for (let v = 0; v < s.c.v; v++) for (let h = 0; h < s.c.h; h++) block(s, k, (my * s.c.v + v) * gridW + mx * s.c.h + h);
              });
              count++;
            }
        }
        for (const s of scan) s.c.done = true;
        if (comps.every((c) => c.done)) break;
      }
      i = reader.end();
      continue;
    }
    i = next;
  }
  if (!comps.length || !comps.every((c) => c.done)) return null;
  const q = comps.map((c) => quant[c.tq]?.[0] ?? 1);
  const bw = Math.ceil(width / 8);
  const bh = Math.ceil(height / 8);
  const value = (ci: number, bx: number, by: number) => {
    const c = comps[ci];
    const gx = Math.floor((bx * c.h) / hmax);
    const gy = Math.floor((by * c.v) / vmax);
    return (c.dc[gy * mcusX * c.h + gx] * q[ci]) / 8 + 128;
  };
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const rgbColour = comps.length === 3 && adobeTransform === 0;
  return downsample(bw, bh, (x, y, out, at) => {
    if (comps.length === 1) {
      const g = clamp(value(0, x, y));
      out[at] = out[at + 1] = out[at + 2] = g;
    } else if (rgbColour) {
      out[at] = clamp(value(0, x, y));
      out[at + 1] = clamp(value(1, x, y));
      out[at + 2] = clamp(value(2, x, y));
    } else {
      const Y = value(0, x, y);
      const cb = value(1, x, y) - 128;
      const cr = value(2, x, y) - 128;
      out[at] = clamp(Y + 1.402 * cr);
      out[at + 1] = clamp(Y - 0.344136 * cb - 0.714136 * cr);
      out[at + 2] = clamp(Y + 1.772 * cb);
    }
    out[at + 3] = 255;
  });
}

// ---------------------------------------------------------------------------
// GIF: the first frame
// ---------------------------------------------------------------------------

function decodeGif(b: Uint8Array): RgbaSample | null {
  if (b.length < 13) return null;
  const packed = b[10];
  let p = 13;
  let table: Uint8Array | null = null;
  if (packed & 0x80) {
    const size = 3 * (1 << ((packed & 7) + 1));
    table = b.subarray(p, p + size);
    p += size;
  }
  let transparent = -1;
  while (p < b.length) {
    const block = b[p++];
    if (block === 0x3b) return null;
    if (block === 0x21) {
      const label = b[p++];
      if (label === 0xf9 && b[p] >= 4 && b[p + 1] & 1) transparent = b[p + 4];
      while (p < b.length && b[p] !== 0) p += b[p] + 1;
      p++;
      continue;
    }
    if (block !== 0x2c) return null;
    const w = u16le(b, p + 4);
    const h = u16le(b, p + 6);
    const flags = b[p + 8];
    p += 9;
    if (flags & 0x80) {
      const size = 3 * (1 << ((flags & 7) + 1));
      table = b.subarray(p, p + size);
      p += size;
    }
    if (!table || !w || !h || w * h > MAX_PIXELS) return null;
    const minCode = b[p++];
    if (minCode < 2 || minCode > 8) return null;
    const data: number[] = [];
    while (p < b.length && b[p] !== 0) {
      for (let k = 1; k <= b[p]; k++) data.push(b[p + k]);
      p += b[p] + 1;
    }
    const indices = lzw(Uint8Array.from(data), minCode, w * h);
    const palette = table;
    return downsample(w, h, (x, y, out, at) => {
      const idx = indices[y * w + x] ?? 0;
      out[at] = palette[idx * 3] ?? 0;
      out[at + 1] = palette[idx * 3 + 1] ?? 0;
      out[at + 2] = palette[idx * 3 + 2] ?? 0;
      out[at + 3] = idx === transparent ? 0 : 255;
    });
  }
  return null;
}

function lzw(data: Uint8Array, minCode: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let k = 0; k < clear; k++) dict[k] = [k];
    dict[clear] = [];
    dict[eoi] = [];
    size = minCode + 1;
  };
  reset();
  let prev: number[] | null = null;
  let bitPos = 0;
  let n = 0;
  while (n < count && bitPos + size <= data.length * 8) {
    let code = 0;
    for (let k = 0; k < size; k++) code |= ((data[(bitPos + k) >> 3] >> ((bitPos + k) & 7)) & 1) << k;
    bitPos += size;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else break;
    for (const v of entry) if (n < count) out[n++] = v;
    if (prev && dict.length < 4096) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return out;
}
