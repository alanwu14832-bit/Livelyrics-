// The SyncEngine in Node (phase 5a): no Web MIDI, no microphone — messages go in through handle(),
// the hook every MIDI input calls, and localStorage is a memory stub.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullFrameBytes, quarterFrames } from "@/lib/midi/mtc";
import { parseMidi } from "@/lib/midi/parser";
import { MIDI_PREFS_KEY, loadMidiPrefs } from "@/lib/midi/prefs";
import { memoryStorage } from "@/lib/console/test-env";
import type { MidiCommand } from "@/lib/midi/mapping";
import { SyncEngine, parseSyncSettings } from "./engine";

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage, sessionStorage: memoryStorage(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function engine(settings: ConstructorParameters<typeof SyncEngine>[0] = {}) {
  const e = new SyncEngine(settings);
  e.attach();
  return e;
}

describe("SyncEngine", () => {
  it("starts manual and never asks for MIDI or audio", () => {
    const e = engine();
    const s = e.getSnapshot();
    expect(s.settings).toEqual({ source: "manual", ltcDeviceId: "", freewheelSeconds: 2 });
    expect(s.lock).toBe("off");
    expect(s.midi.status).toBe("off");
    expect(s.ltc.status).toBe("off");
    expect(e.timecode()).toBeNull();
    e.detach();
  });

  it("explains a browser without Web MIDI in Chinese", async () => {
    const e = engine();
    await e.enableMidi();
    expect(e.getSnapshot().midi).toMatchObject({ status: "error", supported: false, enabled: true });
    expect(e.getSnapshot().midi.message).toContain("Chrome 或 Edge");
    e.detach();
  });

  it("MTC: waiting, locked on quarter frames, then freewheel", () => {
    const e = engine({ settings: { source: "mtc" } });
    const onSettings = vi.fn();
    e.configure({}, onSettings);
    expect(e.getSnapshot().lock).toBe("waiting");
    const t0 = Date.now();
    for (let seq = 0; seq < 3; seq++) {
      quarterFrames({ hours: 1, minutes: 0, seconds: 10, frames: seq * 2 }, 25).forEach((b, k) => e.handle({ type: "mtcQuarterFrame", piece: b >> 4, value: b & 0x0f }, t0 + seq * 80 + k * 10));
    }
    const r = e.timecode(t0 + 3 * 80);
    expect(r).toMatchObject({ status: "locked", rate: 25, running: true });
    expect(r!.label).toMatchObject({ hours: 1, minutes: 0, seconds: 10 });
    expect(e.timecode(t0 + 3 * 80 + 1000)!.status).toBe("freewheel");
    e.setFreewheel(20);
    expect(e.getSnapshot().settings.freewheelSeconds).toBe(10);
    expect(onSettings).toHaveBeenLastCalledWith({ source: "mtc", ltcDeviceId: "", freewheelSeconds: 10 });
    e.detach();
  });

  it("MTC full frame locates (stopped) at once", () => {
    const e = engine({ settings: { source: "mtc" } });
    const [msg] = parseMidi(fullFrameBytes({ hours: 2, minutes: 0, seconds: 30, frames: 0 }, 30));
    e.handle(msg, Date.now());
    expect(e.getSnapshot().lock).toBe("stopped");
    expect(e.timecode()).toMatchObject({ status: "stopped", running: false, label: { hours: 2, minutes: 0, seconds: 30, frames: 0 } });
    e.detach();
  });

  it("quarter frames are ignored unless MTC is the source", () => {
    const e = engine({ settings: { source: "clock" } });
    quarterFrames({ hours: 1, minutes: 0, seconds: 0, frames: 0 }, 25).forEach((b, k) => e.handle({ type: "mtcQuarterFrame", piece: b >> 4, value: b & 0x0f }, 1000 + k * 10));
    expect(e.timecode()).toBeNull();
    e.detach();
  });

  it("MIDI clock: waiting, locked, then lost", () => {
    const e = engine({ settings: { source: "clock" } });
    const t0 = Date.now() - 1000;
    for (let i = 0; i <= 48; i++) e.handle({ type: "clock" }, t0 + i * (60000 / (120 * 24)));
    expect(e.beat(t0 + 1000)).toMatchObject({ locked: true });
    expect(Math.abs(e.beat(t0 + 1000).bpm! - 120)).toBeLessThan(0.5);
    expect(e.beat(t0 + 3000).locked).toBe(false);
    e.detach();
  });

  it("learns a pad, runs its command, and remembers the map in this browser", () => {
    const e = engine();
    const got: MidiCommand[] = [];
    e.onCommand((c) => got.push(c));
    e.learn("blackout");
    expect(e.getSnapshot().learning).toBe("blackout");
    const at = Date.now();
    e.handle({ type: "noteOn", channel: 0, note: 40, velocity: 90 }, at);
    expect(got).toEqual([]);
    expect(e.getSnapshot()).toMatchObject({ learning: null, learned: { binding: { target: "blackout", kind: "note", number: 40 } } });
    e.handle({ type: "noteOn", channel: 0, note: 40, velocity: 90 }, at + 500);
    expect(got).toEqual([{ kind: "button", target: "blackout" }]);
    expect(e.activity()?.text).toContain("音符 E1（40）");
    expect(storage.map.has(MIDI_PREFS_KEY)).toBe(true);
    expect(loadMidiPrefs(storage).map.bindings).toEqual([{ target: "blackout", kind: "note", channel: 0, number: 40 }]);
    // a new engine (the next visit, the other console) has the same map
    const other = engine();
    expect(other.getSnapshot().map.bindings).toHaveLength(1);
    e.clearBinding("blackout");
    expect(e.getSnapshot().map.bindings).toEqual([]);
    e.setLineNotes({ enabled: true, offset: -36 });
    expect(e.getSnapshot().map.lineNotes).toMatchObject({ enabled: true, offset: -36 });
    e.detach();
    other.detach();
  });

  it("setting the source back to manual resets the chase", () => {
    const e = engine({ settings: { source: "mtc" } });
    const [msg] = parseMidi(fullFrameBytes({ hours: 1, minutes: 0, seconds: 0, frames: 0 }, 25));
    e.handle(msg, Date.now());
    e.setSource("manual");
    expect(e.getSnapshot().lock).toBe("off");
    e.setSource("mtc");
    expect(e.getSnapshot().lock).toBe("waiting");
    e.detach();
  });

  it("repairs stored settings", () => {
    expect(parseSyncSettings({ source: "ltc", freewheelSeconds: 0.1, ltcDeviceId: "x" })).toEqual({ source: "ltc", ltcDeviceId: "x", freewheelSeconds: 0.5 });
    expect(parseSyncSettings("junk")).toEqual({ source: "manual", ltcDeviceId: "", freewheelSeconds: 2 });
  });
});
