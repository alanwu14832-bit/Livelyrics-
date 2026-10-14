// Round 18 (M1): a section change between two states of the same program is one render with its
// uniforms tweened — never a cross-fade of two renders, which showed the planet / sun / slab twice
// (the round 16 audit: punk, city-pop, long-lines and the instrumental at their section starts).

import { describe, expect, it } from "vitest";
import type { RGB } from "../color";
import type { ProgramDraw } from "../gl/renderer";
import { composeSceneProgram, type FormId } from "./composer";
import { compileForCpu, type Uniforms } from "./glsl-eval";
import { validateProgram } from "./validate";
import { blendProgramDraw, sameProgram } from "./runtime";

const COLS = 64;
const ROWS = 36;
const RES: [number, number] = [1920, 1080];
const PAL: RGB[] = [
  [0.03, 0.04, 0.06],
  [0.2, 0.45, 0.7],
  [0.95, 0.55, 0.2],
  [0.95, 0.95, 0.95],
  [0.7, 0.6, 0.5],
  [0.08, 0.08, 0.12],
];

const draw = (over: Partial<ProgramDraw>): ProgramDraw => ({
  key: "k",
  code: "",
  songTime: 30,
  songProgress: 0.4,
  bar: 0.3,
  tempo: 2,
  master: 1,
  section: 2,
  sectionKind: 3,
  sectionEnergy: 0.8,
  sectionProgress: 0.02,
  mode: 2,
  params: [0.7, 0.6, 0.7, 0.5],
  ink: [0.95, 0.95, 0.95],
  palette: PAL as ProgramDraw["palette"],
  zone: [0.08, 0.3, 0.46, 0.8],
  relation: 0,
  typeBox: [0, 0, 0, 0],
  typeAmt: 0,
  ...over,
});

const uniforms = (pd: ProgramDraw): Uniforms => ({
  uRes: RES,
  uTime: 14,
  uClock: 14,
  uSongTime: pd.songTime,
  uSongProgress: pd.songProgress,
  uSeed: 137,
  uBeat: 0.3,
  uBeatN: 40,
  uBar: pd.bar,
  uTempo: pd.tempo,
  uPulse: 0,
  uEnergy: pd.sectionEnergy,
  uLevel: 0.3,
  uBass: 0.3,
  uOnset: 0,
  uIntensity: 0.9,
  uMaster: 1,
  uReact: 0.5,
  uSection: pd.section,
  uSectionKind: pd.sectionKind,
  uSectionEnergy: pd.sectionEnergy,
  uSectionProgress: pd.sectionProgress,
  uMode: pd.mode,
  uParams: pd.params,
  uBg: PAL[0],
  uPri: PAL[1],
  uAcc: PAL[2],
  uInk: pd.ink,
  uPal: PAL,
  uZone: pd.zone,
  uRelation: pd.relation,
  uTypeBox: pd.typeBox,
  uTypeAmt: 0,
});

type Frame = Float64Array;

function render(code: string, pd: ProgramDraw): Frame {
  const c = compileForCpu(code, uniforms(pd));
  const out = new Float64Array(COLS * ROWS);
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i < COLS; i++) {
      const [r, g, b] = c.scene([((i + 0.5) / COLS) * RES[0], ((j + 0.5) / ROWS) * RES[1]]).color as number[];
      out[j * COLS + i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  return out;
}

const mix = (a: Frame, b: Frame, t: number): Frame => a.map((v, i) => v + (b[i] - v) * t);

/** Bright subjects: 4-connected regions above half-way between the frame's median and its peak (specks ignored). */
function blobs(fr: Frame): number {
  const sorted = [...fr].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)];
  const peak = sorted[Math.floor(sorted.length * 0.995)];
  const th = med + (peak - med) * 0.5;
  const seen = new Uint8Array(fr.length);
  let n = 0;
  for (let k = 0; k < fr.length; k++) {
    if (seen[k] || fr[k] < th) continue;
    let size = 0;
    const stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      size++;
      const x = q % COLS;
      const y = (q - x) / COLS;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const m = ny * COLS + nx;
        if (!seen[m] && fr[m] >= th) {
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
    if (size >= 4) n++;
  }
  return n;
}

const program = (form: FormId) => {
  const p = composeSceneProgram({ seed: 4242, forms: [form], weights: { [form]: 1 }, sections: [{ id: "a", kind: "verse", energy: 0.4 }, { id: "b", kind: "chorus", energy: 0.8 }], title: "t" });
  const v = validateProgram(p.source);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return v.code;
};

describe("same-program section transitions (round 18)", () => {
  // the words move from the left to the right: the focal form moves from the right to the left
  const prev = draw({ section: 1, sectionKind: 1, sectionEnergy: 0.45, sectionProgress: 0.98, mode: 0, params: [0.4, 0.4, 0.45, 0.4], zone: [0.08, 0.3, 0.46, 0.8] });
  const cur = draw({ zone: [0.54, 0.3, 0.92, 0.8] });

  it("merges only two states of one program", () => {
    expect(sameProgram({ program: prev }, { program: cur })).toBe(true);
    expect(sameProgram({ program: prev }, { program: { ...cur, key: "other" } })).toBe(false);
    expect(sameProgram(null, { program: cur })).toBe(false);
    const mid = blendProgramDraw(prev, cur, 0.5);
    expect(mid.zone[0]).toBeCloseTo(0.31, 2);
    expect(mid.mode).toBeCloseTo(1, 5);
    expect(blendProgramDraw(prev, { ...cur, mode: 3 }, 0.4).mode).toBe(0);
    expect(blendProgramDraw(prev, { ...cur, mode: 3 }, 0.6).mode).toBe(3);
    expect(blendProgramDraw(prev, cur, 1)).toEqual(cur);
  });

  // the forms with one subject (a disc, a planet): the old cross-fade showed it twice
  for (const form of ["horizon", "orbits"] as FormId[]) {
    it(`${form}: the subject is never shown twice mid-transition`, () => {
      const code = program(form);
      const a = render(code, prev);
      const b = render(code, cur);
      const most = Math.max(blobs(a), blobs(b));
      expect(blobs(mix(a, b, 0.5))).toBeGreaterThan(most);
      for (const p of [0.25, 0.5, 0.75]) {
        const one = blobs(render(code, blendProgramDraw(prev, cur, p)));
        expect(one).toBeLessThanOrEqual(most);
      }
    });
  }
});
