import { describe, expect, it } from "vitest";
import { MidiParser, describeMidi, noteName, parseMidi, type MidiMessage } from "./parser";

describe("MIDI parser", () => {
  it("reads channel messages and note on with velocity 0 as note off", () => {
    expect(parseMidi([0x90, 60, 100, 0x80, 60, 0, 0x91, 61, 0, 0xb2, 7, 99, 0xc3, 5, 0xe0, 0, 0x40])).toEqual([
      { type: "noteOn", channel: 0, note: 60, velocity: 100 },
      { type: "noteOff", channel: 0, note: 60, velocity: 0 },
      { type: "noteOff", channel: 1, note: 61, velocity: 0 },
      { type: "cc", channel: 2, controller: 7, value: 99 },
      { type: "programChange", channel: 3, program: 5 },
      { type: "pitchBend", channel: 0, value: 0 },
    ]);
  });

  it("keeps running status until another status byte", () => {
    expect(parseMidi([0x90, 60, 100, 62, 90, 64, 0, 0xb0, 1, 10, 1, 20])).toEqual([
      { type: "noteOn", channel: 0, note: 60, velocity: 100 },
      { type: "noteOn", channel: 0, note: 62, velocity: 90 },
      { type: "noteOff", channel: 0, note: 64, velocity: 0 },
      { type: "cc", channel: 0, controller: 1, value: 10 },
      { type: "cc", channel: 0, controller: 1, value: 20 },
    ]);
  });

  it("passes real-time bytes through the middle of other messages", () => {
    const out = parseMidi([0x90, 0xf8, 60, 0xfe, 0xfa, 100, 0xf8, 62, 0xfc, 70]);
    expect(out).toEqual([
      { type: "clock" },
      { type: "start" },
      { type: "noteOn", channel: 0, note: 60, velocity: 100 },
      { type: "clock" },
      { type: "stop" },
      { type: "noteOn", channel: 0, note: 62, velocity: 70 },
    ]);
    // active sensing (FE) never appears
    expect(out.some((m) => (m as { type: string }).type === "activeSensing")).toBe(false);
  });

  it("reads system common messages, which cancel running status", () => {
    expect(parseMidi([0x90, 60, 100, 0xf1, 0x25, 62, 90, 0xf2, 0x10, 0x02, 0xf3, 4, 0xf6])).toEqual([
      { type: "noteOn", channel: 0, note: 60, velocity: 100 },
      { type: "mtcQuarterFrame", piece: 2, value: 5 },
      // 62 90 after F1: no running status any more, dropped
      { type: "songPosition", beats: 0x10 | (0x02 << 7) },
      { type: "songSelect", song: 4 },
      { type: "tuneRequest" },
    ]);
  });

  it("collects SysEx whole, with real-time bytes inside it, across chunks", () => {
    const p = new MidiParser();
    const out: MidiMessage[] = [];
    p.feed([0xf0, 0x7f, 0x7f, 0x01], (m) => out.push(m));
    p.feed([0xf8, 0x01, 0x21, 0x02, 0x03, 0x04, 0xf7], (m) => out.push(m));
    expect(out[0]).toEqual({ type: "clock" });
    expect(out[1].type).toBe("sysex");
    expect(Array.from((out[1] as { data: Uint8Array }).data)).toEqual([0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x21, 0x02, 0x03, 0x04, 0xf7]);
  });

  it("drops an unterminated SysEx when a status byte arrives", () => {
    expect(parseMidi([0xf0, 0x7e, 0x01, 0x90, 60, 100])).toEqual([{ type: "noteOn", channel: 0, note: 60, velocity: 100 }]);
  });

  it("ignores stray data bytes and undefined status bytes", () => {
    expect(parseMidi([60, 100, 0xf4, 1, 0xfd, 0x90, 60, 1])).toEqual([{ type: "noteOn", channel: 0, note: 60, velocity: 1 }]);
  });

  it("names notes with middle C = C3 and describes messages in Chinese", () => {
    expect(noteName(60)).toBe("C3");
    expect(noteName(36)).toBe("C1");
    expect(noteName(61)).toBe("C#3");
    expect(describeMidi({ type: "noteOn", channel: 0, note: 60, velocity: 100 })).toContain("聲道 1");
    expect(describeMidi({ type: "cc", channel: 9, controller: 7, value: 64 })).toBe("CC 7 = 64・聲道 10");
  });
});
