import { describe, expect, it } from "vitest";
import {
  BUTTON_DEBOUNCE_MS,
  MidiMapper,
  SHOW_DEBOUNCE_MS,
  TARGETS,
  bindingFor,
  clearBinding,
  conflictText,
  conflicts,
  defaultMidiMap,
  exportMidiMap,
  importMidiMap,
  lineNotesCaption,
  parseMidiMap,
  triggerLabel,
  type MidiCommand,
  type MidiMap,
} from "./mapping";
import type { MidiMessage } from "./parser";

const noteOn = (note: number, channel = 0, velocity = 100): MidiMessage => ({ type: "noteOn", channel, note, velocity });
const noteOff = (note: number, channel = 0): MidiMessage => ({ type: "noteOff", channel, note, velocity: 0 });
const cc = (controller: number, value: number, channel = 0): MidiMessage => ({ type: "cc", channel, controller, value });

function learn(m: MidiMapper, target: Parameters<MidiMapper["learn"]>[0], msg: MidiMessage, at = 0) {
  m.learn(target);
  return m.handle(msg, at);
}

describe("MIDI learn", () => {
  it("binds the next pad or controller, without firing it", () => {
    const m = new MidiMapper();
    const r = learn(m, "go", noteOn(36, 9));
    expect(r.commands).toEqual([]);
    expect(r.learned?.binding).toEqual({ target: "go", kind: "note", channel: 9, number: 36 });
    expect(m.learning).toBeNull();
    expect(m.handle(noteOn(36, 9), 1000).commands).toEqual([{ kind: "button", target: "go" }]);
    // another channel is another control
    expect(m.handle(noteOn(36, 0), 2000).commands).toEqual([]);
  });

  it("a continuous control only learns a CC", () => {
    const m = new MidiMapper();
    m.learn("intensity");
    expect(m.handle(noteOn(40), 0).learned).toBeUndefined();
    expect(m.learning).toBe("intensity");
    const r = m.handle(cc(7, 20), 0);
    expect(r.learned?.binding).toMatchObject({ target: "intensity", kind: "cc", number: 7 });
  });

  it("moves a control taken by another action and reports it", () => {
    const m = new MidiMapper();
    learn(m, "blackout", noteOn(60));
    const r = learn(m, "go", noteOn(60), 10);
    expect(r.learned?.replaced).toEqual(["blackout"]);
    expect(bindingFor(m.current, "blackout")).toBeUndefined();
    expect(m.handle(noteOn(60), 1000).commands).toEqual([{ kind: "button", target: "go" }]);
    // learning again replaces the action's own binding
    learn(m, "go", noteOn(61), 2000);
    expect(m.current.bindings.filter((b) => b.target === "go")).toHaveLength(1);
  });
});

describe("MIDI mapping safety", () => {
  it("never fires a button on note off", () => {
    const m = new MidiMapper();
    learn(m, "blackout", noteOn(60));
    expect(m.handle(noteOff(60), 1000).commands).toEqual([]);
    expect(m.handle({ type: "noteOn", channel: 0, note: 60, velocity: 0 } as MidiMessage, 1000).commands).toEqual([]);
    expect(m.handle(noteOn(60), 1000).commands).toEqual([{ kind: "button", target: "blackout" }]);
  });

  it("CC buttons fire at ≥ 64 and re-arm below 40 (hysteresis)", () => {
    const m = new MidiMapper();
    learn(m, "next", cc(20, 0));
    const fired = (v: number, at: number) => m.handle(cc(20, v), at).commands.length;
    expect(fired(63, 100)).toBe(0);
    expect(fired(64, 200)).toBe(1);
    expect(fired(127, 300)).toBe(0); // still pressed
    expect(fired(50, 400)).toBe(0); // not below 40: still armed off
    expect(fired(90, 500)).toBe(0);
    expect(fired(39, 600)).toBe(0); // released
    expect(fired(100, 700)).toBe(1);
  });

  it("debounces buttons (60 ms) and GO / standby (150 ms), never tap", () => {
    const m = new MidiMapper();
    learn(m, "next", noteOn(1));
    learn(m, "go", noteOn(2));
    learn(m, "tap", noteOn(3));
    const n = (note: number, at: number) => m.handle(noteOn(note), at).commands.length;
    expect(n(1, 1000)).toBe(1);
    expect(n(1, 1000 + BUTTON_DEBOUNCE_MS - 1)).toBe(0);
    expect(n(1, 1000 + BUTTON_DEBOUNCE_MS + 1)).toBe(1);
    expect(n(2, 2000)).toBe(1);
    expect(n(2, 2000 + 100)).toBe(0);
    expect(n(2, 2000 + SHOW_DEBOUNCE_MS - 1)).toBe(0);
    expect(n(2, 2000 + SHOW_DEBOUNCE_MS + 60)).toBe(1);
    expect(n(3, 3000)).toBe(1);
    expect(n(3, 3005)).toBe(1);
  });

  it("continuous CCs give 0..1 and skip repeats", () => {
    const m = new MidiMapper();
    learn(m, "intensity", cc(7, 0, 2));
    const values = [0, 64, 64, 127].map((v, i) => m.handle(cc(7, v, 2), 100 * i).commands);
    expect(values).toEqual([[{ kind: "value", target: "intensity", value: 0 }], [{ kind: "value", target: "intensity", value: 64 / 127 }], [], [{ kind: "value", target: "intensity", value: 1 }]]);
  });
});

describe("MIDI presets", () => {
  it("ProPresenter 式: note n cues lyric line n + offset on its channel", () => {
    const map: MidiMap = { ...defaultMidiMap(), lineNotes: { enabled: true, channel: 15, offset: -36 } };
    const m = new MidiMapper(map);
    const run = (msg: MidiMessage, at: number) => m.handle(msg, at).commands;
    expect(run(noteOn(36, 15), 0)).toEqual([{ kind: "line", index: 0 }]);
    expect(run(noteOn(40, 15), 100)).toEqual([{ kind: "line", index: 4 }]);
    expect(run(noteOn(35, 15), 200)).toEqual([]); // below the first line
    expect(run(noteOn(40, 0), 300)).toEqual([]); // another channel
    expect(run(noteOff(40, 15), 400)).toEqual([]);
    expect(lineNotesCaption(map.lineNotes)).toContain("音符 36（C1）→ 第 1 句");
  });

  it("段落音符: notes jump to plan sections", () => {
    const m = new MidiMapper({ ...defaultMidiMap(), sectionNotes: { enabled: true, channel: -1, base: 48 } });
    expect(m.handle(noteOn(48, 3), 0).commands).toEqual([{ kind: "section", index: 0 }]);
    expect(m.handle(noteOn(50, 9), 100).commands).toEqual([{ kind: "section", index: 2 }]);
  });

  it("explicit bindings win over the presets, and the conflict is listed", () => {
    const m = new MidiMapper({ ...defaultMidiMap(), lineNotes: { enabled: true, channel: 0, offset: 0 } });
    learn(m, "blackout", noteOn(5));
    expect(m.handle(noteOn(5), 1000).commands).toEqual([{ kind: "button", target: "blackout" }]);
    expect(m.handle(noteOn(6), 1100).commands).toEqual([{ kind: "line", index: 6 }]);
    const c = conflicts(m.current);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ targets: ["blackout"], presets: ["lineNotes"] });
    expect(conflictText(m.current, "blackout")).toContain("ProPresenter 式");
  });

  it("lists presets that shadow each other on one channel", () => {
    const shadow = { ...defaultMidiMap(), lineNotes: { enabled: true, channel: 0, offset: 0 }, sectionNotes: { enabled: true, channel: 0, base: 10 } };
    expect(conflicts(shadow).some((c) => c.presets.length === 2)).toBe(true);
    // sections below the lyric notes on the same channel are fine
    const split = { ...shadow, lineNotes: { enabled: true, channel: 0, offset: -36 }, sectionNotes: { enabled: true, channel: 0, base: 24 } };
    expect(conflicts(split)).toEqual([]);
  });
});

describe("MIDI map files", () => {
  it("round-trips through export / import and repairs bad entries", () => {
    const m = new MidiMapper();
    learn(m, "blackout", noteOn(60, 3));
    learn(m, "ledCap", cc(9, 0, 1));
    const text = exportMidiMap({ ...m.current, lineNotes: { enabled: true, channel: 2, offset: -24 } });
    const back = importMidiMap(text);
    expect(back.bindings).toEqual(m.current.bindings);
    expect(back.lineNotes).toEqual({ enabled: true, channel: 2, offset: -24 });
    expect(() => importMidiMap("{nope")).toThrow("不是有效的 JSON");
    expect(() => importMidiMap(JSON.stringify({ kind: "other" }))).toThrow("不是 Livelyrics");
    const repaired = parseMidiMap({ bindings: [{ target: "fly", kind: "note", number: 1 }, { target: "intensity", kind: "note", number: 1 }, { target: "go", kind: "cc", channel: 99, number: 500 }] });
    expect(repaired.bindings).toEqual([{ target: "go", kind: "cc", channel: 15, number: 127 }]);
    expect(clearBinding(back, "blackout").bindings.map((b) => b.target)).toEqual(["ledCap"]);
  });

  it("labels triggers in Chinese and lists every hotkey action", () => {
    expect(triggerLabel({ kind: "note", channel: 0, number: 60 })).toBe("音符 C3（60）・聲道 1");
    expect(triggerLabel({ kind: "cc", channel: -1, number: 7 })).toBe("CC 7・任何聲道");
    const targets = new Set(TARGETS.map((t) => t.target));
    for (const t of ["go", "standby", "next", "prev", "cueSelected", "sectionNext", "sectionPrev", "hold", "loop", "blackout", "lyrics", "freeze", "testPattern", "scene1", "scene9", "togglePlay", "mode", "tap", "manual", "intensity", "ledCap"]) {
      expect(targets.has(t as never)).toBe(true);
    }
    expect(TARGETS.filter((t) => t.showOnly).map((t) => t.target)).toEqual(["go", "standby"]);
  });

  it("commands are plain data", () => {
    const cmds: MidiCommand[] = [{ kind: "button", target: "go" }, { kind: "value", target: "intensity", value: 0.5 }, { kind: "line", index: 2 }, { kind: "section", index: 1 }];
    expect(JSON.parse(JSON.stringify(cmds))).toEqual(cmds);
  });
});

describe("MIDI commands run the hotkeys' actions", () => {
  it("maps every button to its console action", async () => {
    const { buttonAction, commandAction } = await import("./actions");
    const { BUTTON_TARGETS } = await import("./mapping");
    for (const t of BUTTON_TARGETS) expect(buttonAction(t).type).toBeTruthy();
    expect(buttonAction("scene7")).toEqual({ type: "scene", slot: 7 });
    expect(buttonAction("sectionPrev")).toEqual({ type: "section", delta: -1 });
    expect(buttonAction("offsetUp")).toEqual({ type: "offset", delta: 0.05 });
    expect(buttonAction("clearLine")).toEqual({ type: "escape" });
    expect(buttonAction("go")).toEqual({ type: "go" });
    expect(buttonAction("manual")).toEqual({ type: "manual" });
    expect(commandAction({ kind: "line", index: 3 })).toEqual({ type: "cueLine", index: 3 });
    expect(commandAction({ kind: "section", index: 1 })).toEqual({ type: "jumpSection", index: 1 });
    expect(commandAction({ kind: "value", target: "ledCap", value: 0.5 })).toEqual({ type: "control", target: "ledCap", value: 0.5 });
  });
});

describe("continuous controls", () => {
  it("the LED cap fader never goes above the preset it started under", async () => {
    const { LedCapFader, intensityFromControl, lyricScaleFromControl } = await import("./controls");
    const led = { enabled: true, preset: "led" as const, brightness: 0.7, flashLimit: true, redProtect: true, soften: 0.25 };
    const f = new LedCapFader();
    expect(f.brightnessFor(led, 1)).toBe(0.7);
    expect(f.brightnessFor(led, 0)).toBe(0.2);
    // passing 55 % (the outdoor preset's value) does not lower the ceiling
    expect(f.brightnessFor({ ...led, preset: "outdoor", brightness: 0.55 }, 1)).toBe(0.7);
    f.reset();
    expect(f.brightnessFor({ ...led, preset: "outdoor", brightness: 0.55 }, 1)).toBe(0.55);
    f.reset();
    expect(f.brightnessFor({ ...led, preset: "custom", brightness: 0.82 }, 1)).toBe(0.8);
    expect(f.brightnessFor({ ...led, enabled: false }, 1)).toBeNull();
    expect(intensityFromControl(85 / 127)).toBe(1);
    expect(intensityFromControl(1)).toBe(1.5);
    expect(lyricScaleFromControl(0)).toBe(0.5);
    expect(lyricScaleFromControl(1)).toBe(2);
  });
});
