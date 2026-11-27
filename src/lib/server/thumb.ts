// 作品庫 (round 25, m2): every designed song gets a real picture on its library card as soon as its
// plan is saved — one frame of its scene program at the key moment, rendered on the CPU (the probe's
// GLSL evaluator) at card size and stored as a small PNG (Project.thumb, kind "frame"). The design
// overview later replaces it with the full key still (lyrics composed, kind absent) when it renders
// one in the browser. No program (switched off, refused by the evaluator): no frame, the card keeps
// its drawn palette artwork.

import { deflateSync } from "node:zlib";
import { planHash } from "@/lib/plan-hash";
import { compileForCpu } from "@/lib/stage/program/glsl-eval";
import { keyMomentOf } from "@/lib/stage/program/model";
import { stateUniforms } from "@/lib/stage/program/probe";
import { validateProgram } from "@/lib/stage/program/validate";
import { THUMB_MAX_CHARS, type Project, type ProjectThumb } from "@/lib/types";

/** Card frame width in pixels (height from the output's aspect). */
export const FRAME_THUMB_WIDTH = 128;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An 8-bit RGB PNG of `rgb` (width × height × 3, rows top to bottom). */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    // filter "sub": smooth gradients deflate far better than raw rows
    raw[row] = 1;
    for (let x = 0; x < width * 3; x++) {
      const v = rgb[y * width * 3 + x];
      const left = x >= 3 ? rgb[y * width * 3 + x - 3] : 0;
      raw[row + 1 + x] = (v - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

/**
 * One frame of the project's scene program at its key moment, as a card thumbnail. Null when the
 * plan has no enabled program or the CPU evaluator cannot run it. Never throws.
 */
export function frameThumb(project: Pick<Project, "plan" | "meta" | "analysis" | "lyrics" | "output">): ProjectThumb | null {
  const plan = project.plan;
  const program = plan?.sceneProgram;
  if (!plan || !program || program.enabled === false || !plan.sections.length) return null;
  try {
    const checked = validateProgram(program.source);
    if (!checked.ok) return null;
    const out = project.output;
    const aspect = out && out.width > 0 && out.height > 0 ? Math.min(2.4, Math.max(0.5, out.width / out.height)) : 16 / 9;
    const w = aspect >= 1 ? FRAME_THUMB_WIDTH : Math.round(FRAME_THUMB_WIDTH * aspect);
    const h = aspect >= 1 ? Math.round(FRAME_THUMB_WIDTH / aspect) : FRAME_THUMB_WIDTH;
    const res: [number, number] = aspect >= 1 ? [1920, Math.round(1920 / aspect)] : [Math.round(1920 * aspect), 1920];
    const duration = project.meta?.duration || project.analysis?.duration || plan.sections[plan.sections.length - 1].end;
    const t = keyMomentOf(plan, duration, project.lyrics?.lines ?? []);
    const index = Math.max(0, plan.sections.findIndex((s) => t >= s.start && t < s.end));
    const section = plan.sections[index];
    const ps = program.sections.find((s) => s.sectionId === section.id) ?? program.sections[0];
    if (!ps) return null;
    const palette = (plan.keyVisual?.palette ?? []).map((p) => p?.hex).filter((x): x is string => typeof x === "string");
    const u = stateUniforms(program, ps, section, index, plan.sections.length, { palette, res, time: t });
    const compiled = compileForCpu(checked.code, u);
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // fc has its origin at the bottom left; the PNG's rows run top to bottom
        const c = compiled.scene([((x + 0.5) / w) * res[0], (1 - (y + 0.5) / h) * res[1]]).color;
        const o = (y * w + x) * 3;
        for (let k = 0; k < 3; k++) rgb[o + k] = Math.round(Math.min(1, Math.max(0, Number.isFinite(c[k]) ? c[k] : 0)) * 255);
      }
    }
    const url = `data:image/png;base64,${encodePng(w, h, rgb).toString("base64")}`;
    if (url.length > THUMB_MAX_CHARS) return null;
    return { url, plan: planHash(plan), kind: "frame" };
  } catch {
    return null;
  }
}
