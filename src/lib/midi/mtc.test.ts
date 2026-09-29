import { describe, expect, it } from "vitest";
import { framesToTc, frameSeconds, tcToFrames, tcToSeconds, type FrameRate } from "@/lib/sync/timecode";
import { MtcAssembler, fullFrameBytes, parseMtcFullFrame, quarterFrames, type MtcFrame } from "./mtc";
import { parseMidi } from "./parser";

const tc = (hours: number, minutes: number, seconds: number, frames: number) => ({ hours, minutes, seconds, frames });

/** Quarter frames of consecutive timecodes (every other frame), timestamped at a quarter frame each. */
function run(rate: FrameRate, start: ReturnType<typeof tc>, sequences: number, opts: { reverse?: boolean; t0?: number } = {}) {
  const qf = (frameSeconds(rate) * 1000) / 4;
  const out: Array<{ piece: number; value: number; at: number }> = [];
  const first = tcToFrames(start, rate);
  let at = opts.t0 ?? 1000;
  for (let s = 0; s < sequences; s++) {
    const label = framesToTc(first + (opts.reverse ? -2 * s : 2 * s), rate);
    const bytes = quarterFrames(label, rate);
    const order = opts.reverse ? [...bytes].reverse() : bytes;
    for (const b of order) {
      out.push({ piece: b >> 4, value: b & 0x0f, at });
      at += qf;
    }
  }
  return out;
}

function feed(asm: MtcAssembler, pieces: ReturnType<typeof run>): MtcFrame[] {
  const frames: MtcFrame[] = [];
  for (const p of pieces) {
    const f = asm.quarterFrame(p.piece, p.value, p.at);
    if (f) frames.push(f);
  }
  return frames;
}

describe("MTC quarter-frame assembly", () => {
  it("assembles every rate from the rate bits, with the latency added", () => {
    for (const rate of [24, 25, 29.97, 30] as FrameRate[]) {
      const asm = new MtcAssembler();
      const pieces = run(rate, tc(1, 0, 10, 0), 5);
      const frames = feed(asm, pieces);
      expect(frames.length).toBe(5);
      expect(frames[0].rate).toBe(rate);
      expect(frames[0].timecode).toEqual(tc(1, 0, 10, 0));
      expect(frames[1].timecode).toEqual(framesToTc(tcToFrames(tc(1, 0, 10, 0), rate) + 2, rate));
      // at piece 7 the transport is 1.75 frames past the label
      expect(frames[0].position).toBeCloseTo(tcToSeconds(tc(1, 0, 10, 0), rate) + 1.75 * frameSeconds(rate), 9);
      expect(frames[0].direction).toBe(1);
      // positions advance with real time (one frame = two labels later, two frames of time)
      const dt = (frames[1].at - frames[0].at) / 1000;
      expect(frames[1].position - frames[0].position).toBeCloseTo(dt, 6);
    }
  });

  it("starts mid-sequence and only completes on a whole sequence", () => {
    const asm = new MtcAssembler();
    const pieces = run(25, tc(2, 30, 0, 0), 3).slice(3);
    const frames = feed(asm, pieces);
    // the first partial sequence (pieces 3..7) cannot complete
    expect(frames.map((f) => f.timecode)).toEqual([tc(2, 30, 0, 2), tc(2, 30, 0, 4)]);
  });

  it("drops a sequence with a gap or out-of-order pieces", () => {
    const asm = new MtcAssembler();
    const pieces = run(25, tc(1, 0, 0, 0), 3);
    pieces.splice(4, 1); // lose piece 4 of the first sequence: only the next two complete
    const frames = feed(asm, pieces);
    expect(frames.map((f) => f.timecode)).toEqual([tc(1, 0, 0, 2), tc(1, 0, 0, 4)]);
    const late = run(25, tc(1, 0, 0, 0), 2);
    for (let i = 12; i < late.length; i++) late[i].at += 500; // a pause in the middle of the second sequence
    expect(feed(new MtcAssembler(), late).length).toBe(1);
  });

  it("follows the transport backwards (pieces 7 … 0)", () => {
    const asm = new MtcAssembler();
    const frames = feed(asm, run(30, tc(1, 0, 10, 0), 4, { reverse: true }));
    expect(frames.length).toBe(4);
    expect(frames.every((f) => f.direction === -1)).toBe(true);
    expect(frames[0].timecode).toEqual(tc(1, 0, 10, 0));
    expect(frames[1].timecode).toEqual(tc(1, 0, 9, 28));
    expect(frames[0].position).toBeCloseTo(tcToSeconds(tc(1, 0, 10, 0), 30), 9);
    // a change of direction starts a new run: the first reversed sequence needs all its eight pieces
    const both = [...run(25, tc(1, 0, 0, 0), 2), ...run(25, tc(1, 0, 0, 2), 2, { reverse: true, t0: 1000 + 16 * 10 }).slice(2)];
    const mixed = feed(new MtcAssembler(), both);
    expect(mixed.map((f) => f.direction)).toEqual([1, 1, -1]);
    expect(mixed[2].timecode).toEqual(tc(1, 0, 0, 0));
  });

  it("reads the full-frame SysEx (locate) at every rate", () => {
    for (const rate of [24, 25, 29.97, 30] as FrameRate[]) {
      const bytes = fullFrameBytes(tc(1, 2, 3, 4), rate);
      const [msg] = parseMidi(bytes);
      expect(msg.type).toBe("sysex");
      const parsed = parseMtcFullFrame((msg as { data: Uint8Array }).data);
      expect(parsed).toEqual({ timecode: tc(1, 2, 3, 4), rate });
      const asm = new MtcAssembler();
      const f = asm.fullFrame((msg as { data: Uint8Array }).data, 500);
      expect(f).toMatchObject({ kind: "locate", timecode: tc(1, 2, 3, 4), rate, at: 500 });
      expect(f!.position).toBeCloseTo(tcToSeconds(tc(1, 2, 3, 4), rate), 9);
    }
    // any device id; other SysEx are not full frames
    expect(parseMtcFullFrame([0xf0, 0x7f, 0x05, 0x01, 0x01, 0x21, 0, 0, 0, 0xf7])).toEqual({ timecode: tc(1, 0, 0, 0), rate: 25 });
    expect(parseMtcFullFrame([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7])).toBeNull();
    expect(parseMtcFullFrame([0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x21, 70, 0, 0, 0xf7])).toBeNull(); // minute 70
  });

  it("works through the byte parser with clocks interleaved", () => {
    const bytes: number[] = [];
    for (const b of quarterFrames(tc(1, 0, 10, 0), 25)) bytes.push(0xf8, 0xf1, b);
    const asm = new MtcAssembler();
    let at = 0;
    const frames = parseMidi(bytes)
      .filter((m) => m.type === "mtcQuarterFrame")
      .map((m) => asm.quarterFrame((m as { piece: number }).piece, (m as { value: number }).value, (at += 10)))
      .filter(Boolean);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.timecode).toEqual(tc(1, 0, 10, 0));
  });
});
