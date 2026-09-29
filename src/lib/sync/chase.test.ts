import { describe, expect, it } from "vitest";
import type { SetItem } from "@/lib/types";
import { TimecodeChase, setlistSlots, slotAt, slotStart, songTimeAt, startSeconds, type ChaseFrame } from "./chase";
import { frameSeconds, tcToSeconds, type FrameRate } from "./timecode";

const H1 = 3600;

/** Frames every `every` frames of `rate` from position p0 at t0 (ms), optionally jittered. */
function frames(p0: number, t0: number, count: number, rate: FrameRate = 25, every = 1, jitterMs = 0): ChaseFrame[] {
  const step = frameSeconds(rate) * every;
  return Array.from({ length: count }, (_, i) => {
    const j = jitterMs ? Math.sin(i * 12.9898) * jitterMs : 0;
    return { position: p0 + i * step, at: t0 + i * step * 1000 + j, rate };
  });
}

describe("TimecodeChase", () => {
  it("locks after three agreeing frames, never on one", () => {
    const c = new TimecodeChase();
    const f = frames(H1 + 10, 1000, 3);
    c.push(f[0]);
    expect(c.status(f[0].at)).toBe("waiting");
    c.push(f[1]);
    expect(c.status(f[1].at)).toBe("waiting");
    c.push(f[2]);
    expect(c.status(f[2].at)).toBe("locked");
    const s = c.state(f[2].at + 100);
    expect(s.running).toBe(true);
    expect(s.position).toBeCloseTo(H1 + 10 + 2 / 25 + 0.1, 6);
  });

  it("rejects single glitches of any size, and follows jitter smoothly", () => {
    const c = new TimecodeChase();
    const good = frames(H1 + 10, 1000, 60, 25, 1, 6);
    good.forEach((f, i) => {
      if (i === 20) c.push({ ...f, position: f.position + 37 }); // a bit error: 37 s off
      else if (i === 30) c.push({ ...f, position: f.position + 0.6 }); // a small glitch
      else if (i === 40) c.push({ ...f, position: f.position - 5000 }); // garbage
      else c.push(f);
      // the position never jumps: always within a frame of the truth
      const truth = H1 + 10 + (f.at - 1000) / 1000;
      if (i >= 3) expect(Math.abs(c.state(f.at).position! - truth)).toBeLessThan(frameSeconds(25));
    });
    expect(c.status(good.at(-1)!.at)).toBe("locked");
  });

  it("relocates after three consistent frames more than a second away", () => {
    const c = new TimecodeChase();
    for (const f of frames(H1 + 10, 1000, 10)) c.push(f);
    // the rig jumps to 01:02:00:00
    const jump = frames(H1 + 120, 1400, 3);
    c.push(jump[0]);
    c.push(jump[1]);
    expect(c.state(jump[1].at).position!).toBeLessThan(H1 + 12);
    c.push(jump[2]);
    expect(c.state(jump[2].at).position!).toBeCloseTo(H1 + 120 + 2 / 25, 6);
    expect(c.status(jump[2].at)).toBe("locked");
  });

  it("freewheels on a dropout, then reports it lost and holds the position", () => {
    const c = new TimecodeChase({ freewheelMs: 2000 });
    const f = frames(H1 + 10, 1000, 25);
    for (const x of f) c.push(x);
    const last = f.at(-1)!;
    expect(c.status(last.at + 200)).toBe("locked");
    expect(c.status(last.at + 400)).toBe("freewheel");
    const mid = c.state(last.at + 1500);
    expect(mid).toMatchObject({ status: "freewheel", running: true });
    expect(mid.position!).toBeCloseTo(last.position + 1.5, 6);
    const lost = c.state(last.at + 3000);
    expect(lost).toMatchObject({ status: "lost", running: false });
    // frozen where the freewheel ended
    expect(lost.position!).toBeCloseTo(last.position + 2, 6);
    expect(c.state(last.at + 9000).position!).toBeCloseTo(last.position + 2, 6);
    expect(c.wasLost).toBe(true);
    // valid frames lock again
    for (const x of frames(H1 + 20, last.at + 10000, 3)) c.push(x);
    expect(c.status(last.at + 10000 + 80)).toBe("locked");
  });

  it("a configurable freewheel", () => {
    const c = new TimecodeChase({ freewheelMs: 500 });
    const f = frames(H1, 0, 5);
    for (const x of f) c.push(x);
    expect(c.status(f.at(-1)!.at + 600)).toBe("lost");
    c.setFreewheel(5000);
    expect(c.status(f.at(-1)!.at + 600)).toBe("freewheel");
  });

  it("a line full of garbage is not a lock", () => {
    const c = new TimecodeChase();
    for (const x of frames(H1, 0, 10)) c.push(x);
    // afterwards only random positions arrive: freewheel, then lost
    for (let i = 0; i < 100; i++) c.push({ position: H1 + ((i * 7919) % 3000), at: 400 + i * 40, rate: 25 });
    expect(c.status(400 + 100 * 40)).toBe("lost");
  });

  it("an MTC locate stops the transport where it says; playback continues from there", () => {
    const c = new TimecodeChase();
    c.locate(H1 + 30, 1000, 25);
    expect(c.state(5000)).toMatchObject({ status: "stopped", running: false, position: H1 + 30 });
    // quarter frames start (every other frame) from about the located position
    const f = frames(H1 + 30 + 0.07, 6000, 3, 25, 2);
    c.push(f[0]);
    expect(c.status(f[0].at)).toBe("locked");
    expect(c.state(f[0].at + 1000).position!).toBeCloseTo(H1 + 30 + 0.07 + 1, 6);
  });

  it("follows a transport running backwards", () => {
    const c = new TimecodeChase();
    for (let i = 0; i < 5; i++) c.push({ position: H1 + 10 - i * 0.08, at: 1000 + i * 80, rate: 25, direction: -1 });
    const s = c.state(1000 + 4 * 80 + 100);
    expect(s).toMatchObject({ status: "locked", direction: -1, running: true });
    expect(s.position!).toBeCloseTo(H1 + 10 - 0.32 - 0.1, 6);
  });

  it("a frame-rate change needs confirmation too", () => {
    const c = new TimecodeChase();
    for (const x of frames(H1, 0, 5, 25)) c.push(x);
    c.push({ position: H1 + 0.2, at: 200, rate: 30 });
    expect(c.state(200).rate).toBe(25);
  });
});

describe("timecode → song, timecode → setlist", () => {
  it("maps timecode to song time (one song per hour by default)", () => {
    expect(songTimeAt(tcToSeconds({ hours: 1, minutes: 0, seconds: 10, frames: 0 }, 25), null, 25)).toBeCloseTo(10, 9);
    expect(songTimeAt(tcToSeconds({ hours: 2, minutes: 0, seconds: 3, frames: 12 }, 25), "02:00:00:00", 25)).toBeCloseTo(3.48, 9);
    // drop-frame: ten labelled seconds are 10.01 s
    expect(songTimeAt(tcToSeconds({ hours: 1, minutes: 0, seconds: 10, frames: 0 }, 29.97), "01:00:00:00", 29.97)).toBeCloseTo(10.01, 3);
    // before the start: negative (the console holds the first frame)
    expect(songTimeAt(H1 - 2, null, 25)).toBeCloseTo(-2, 9);
    expect(startSeconds("garbage", 25)).toBe(H1);
  });

  const song = (id: string, projectId: string, timecode?: string): SetItem => ({ id, kind: "song", projectId, ...(timecode ? { timecode } : {}) });
  const look: SetItem = { id: "mc", kind: "interlude", title: "串場", look: { scene: "gradient", colorway: ["#000000", "#111111", "#222222"], media: null } };

  it("gives every song its hour, or its own start timecode", () => {
    const items = [look, song("a", "pa"), look, song("b", "pb"), song("c", "pc", "05:00:00:00")];
    const slots = setlistSlots(items.map((x, i) => (x.kind === "song" ? x : { ...x, id: `mc${i}` })));
    expect(slots.map((s) => [s.itemId, s.start, s.explicit, s.songNumber])).toEqual([
      ["a", "01:00:00:00", false, 1],
      ["b", "02:00:00:00", false, 2],
      ["c", "05:00:00:00", true, 3],
    ]);
    expect(slotStart(items, "b")).toBe("02:00:00:00");
    expect(slotStart(items, "mc")).toBeNull();
  });

  it("finds the song whose hour the timecode is in", () => {
    const slots = setlistSlots([song("a", "pa"), song("b", "pb"), song("c", "pc", "02:30:00:00")]);
    const at = (h: number, m: number, s = 0) => slotAt(h * 3600 + m * 60 + s, slots, 25)?.itemId ?? null;
    expect(at(0, 59, 59)).toBeNull();
    expect(at(1, 0)).toBe("a");
    expect(at(1, 59, 59)).toBe("a");
    expect(at(2, 0, 5)).toBe("b");
    // an explicit start inside hour 2 ends song b's range
    expect(at(2, 30)).toBe("c");
    expect(at(3, 29, 59)).toBe("c");
    // an hour after the last start: nothing
    expect(at(3, 30, 1)).toBeNull();
    // songs past hour 23 have no default
    const many = setlistSlots(Array.from({ length: 25 }, (_, i) => song(`s${i}`, `p${i}`)));
    expect(many).toHaveLength(23);
  });
});
