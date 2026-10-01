// Integration test of the console controller in Node with a fake <audio>, fake window /
// storage and mocked fetch. Node's global BroadcastChannel carries the real messages.

import { defaultOutput } from "@/lib/output";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelName, type StageMessage, type StageState } from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";
import { ConsoleController } from "./controller";
import { section, testLyrics, testPlan } from "./test-fixtures";

class FakeAudio {
  static last: FakeAudio | null = null;
  preload = "";
  src = "";
  currentTime = 0;
  duration = 40;
  paused = true;
  ended = false;
  readyState = 4;
  volume = 1;
  muted = false;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  private listeners = new Map<string, Set<() => void>>();
  constructor() {
    FakeAudio.last = this;
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  load() {}
  removeAttribute() {}
  play() {
    this.paused = false;
    this.emit("play");
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit("pause");
  }
}

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

function makeProject(): Project {
  return {
    id: "ctrltest",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "ready",
    meta: { title: "測試", artist: "樂團", duration: 40, fileName: "a.wav", mimeType: "audio/wav" },
    audioFile: "audio.wav",
    analysis: null,
    lyrics: testLyrics(),
    research: null,
    plan: testPlan(),
    assets: [],
    output: defaultOutput(),
  };
}

const fetchMock = vi.fn();
let listener: BroadcastChannel;
let received: StageMessage[] = [];
/** a test may serve another project (e.g. a different plan) */
let serve: () => Project = makeProject;

async function flush(ms = 20) {
  await new Promise((r) => setTimeout(r, ms));
}

function lastState(): StageState {
  const states = received.filter((m): m is Extract<StageMessage, { type: "state" }> => m.type === "state");
  if (states.length === 0) throw new Error("no state message");
  return states[states.length - 1].state;
}

beforeEach(() => {
  const win = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    open: vi.fn(() => null),
    confirm: vi.fn(() => true),
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    devicePixelRatio: 1,
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return new Response(JSON.stringify({ ...makeProject(), updatedAt: "2026-02-02T00:00:00.000Z" }), { status: 200 });
    if (String(url).startsWith("/api/projects/ctrltest")) return new Response(JSON.stringify(serve()), { status: 200 });
    return new Response(JSON.stringify({ error: "找不到專案" }), { status: 404 });
  });
  received = [];
  listener = new BroadcastChannel(channelName("ctrltest"));
  listener.onmessage = (ev: MessageEvent<StageMessage>) => received.push(ev.data);
});

afterEach(() => {
  listener.close();
  vi.unstubAllGlobals();
  serve = makeProject;
});

async function ready(): Promise<ConsoleController> {
  const c = new ConsoleController("ctrltest");
  c.attach();
  await flush();
  expect(c.getSnapshot().load.status).toBe("ready");
  return c;
}

describe("ConsoleController", () => {
  it("lets the UI own notice lifetimes (no auto-dismiss, three at most)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const c = new ConsoleController("ctrltest");
      c.notify("a");
      c.setNoticeAutoDismiss(false);
      c.notify("b");
      c.notify("c");
      c.notify("d");
      vi.advanceTimersByTime(20000);
      expect(c.getSnapshot().notices.map((n) => n.message)).toEqual(["b", "c", "d"]);
      c.dismissNotice(c.getSnapshot().notices[0].id);
      expect(c.getSnapshot().notices.map((n) => n.message)).toEqual(["c", "d"]);
      c.setNoticeAutoDismiss(true);
      c.notify("e");
      vi.advanceTimersByTime(5000);
      expect(c.getSnapshot().notices.map((n) => n.message)).toEqual(["c", "d"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads the project and announces project + state on the channel", async () => {
    const c = await ready();
    expect(received.some((m) => m.type === "project" && m.project.id === "ctrltest")).toBe(true);
    expect(lastState().projectId).toBe("ctrltest");
    expect(c.getSnapshot().mode).toBe("track"); // most lines are timed
    c.detach();
  });

  it("re-sends the project when an output says hello and tracks pong status", async () => {
    const c = await ready();
    received = [];
    listener.postMessage({ type: "hello", from: "output", outputId: "o1" } satisfies StageMessage);
    await flush();
    expect(received.some((m) => m.type === "project")).toBe(true);
    listener.postMessage({ type: "pong", outputId: "o1", at: Date.now(), width: 1920, height: 1080, fullscreen: true } satisfies StageMessage);
    await flush();
    expect(c.getSnapshot().output).toMatchObject({ connected: true, width: 1920, height: 1080, fullscreen: true, count: 1 });
    c.detach();
  });

  it("TRACK: seeking maps song time (with offset) to the active line and section", async () => {
    const c = await ready();
    c.seek(12.5);
    await flush();
    expect(FakeAudio.last!.currentTime).toBeCloseTo(12.5);
    expect(lastState()).toMatchObject({ lineIndex: 1, sectionIndex: 1, mode: "track" });
    c.setOffset(0.5);
    expect(c.songTime()).toBeCloseTo(13);
    c.jumpToLine(3);
    await flush();
    expect(FakeAudio.last!.currentTime).toBeCloseTo(15.501, 2); // line start 16 minus offset
    expect(lastState().lineIndex).toBe(3);
    c.next();
    await flush();
    expect(lastState().lineIndex).toBe(4);
    c.prev();
    await flush();
    expect(lastState().lineIndex).toBe(3);
    // the offset is remembered for this project
    expect(window.localStorage.getItem("livelyrics:console:ctrltest")).toContain('"offset":0.5');
    c.detach();
  });

  it("TRACK: play/pause follow the audio element", async () => {
    const c = await ready();
    await c.play();
    await flush();
    expect(c.getSnapshot().playing).toBe(true);
    expect(lastState().playing).toBe(true);
    c.spaceAction();
    await flush();
    expect(c.getSnapshot().playing).toBe(false);
    expect(lastState().playing).toBe(false);
    c.detach();
  });

  it("LIVE: cueing jumps the virtual clock and next/prev walk the lines", async () => {
    const c = await ready();
    c.setMode("live");
    c.cueLine(3);
    await flush();
    let s = lastState();
    expect(s.mode).toBe("live");
    expect(s.lineIndex).toBe(3);
    expect(s.playing).toBe(true);
    expect(s.t).toBeGreaterThanOrEqual(16);
    expect(s.t).toBeLessThan(16.5);
    c.spaceAction(); // LIVE: Space = next line
    await flush();
    expect(lastState().lineIndex).toBe(4);
    c.prev();
    c.prev();
    await flush();
    s = lastState();
    expect(s.lineIndex).toBe(2); // untimed line: the clock holds where it was
    c.clearLine();
    await flush();
    expect(lastState().lineIndex).toBeNull();
    c.next();
    await flush();
    expect(lastState().lineIndex).toBe(3);
    c.detach();
  });

  it("手動切換: the operator's choice becomes the starting mode of songs opened later", async () => {
    const c = await ready();
    expect(c.getSnapshot().mode).toBe("track");
    c.chooseMode("live");
    expect(c.getSnapshot().mode).toBe("live");
    c.detach();
    // another song opened for the first time (no per-song settings yet) starts by hand
    window.localStorage.removeItem("livelyrics:console:ctrltest");
    const d = await ready();
    expect(d.getSnapshot().mode).toBe("live");
    d.chooseMode("track");
    d.detach();
    window.localStorage.removeItem("livelyrics:console:ctrltest");
    const e = await ready();
    expect(e.getSnapshot().mode).toBe("track");
    e.detach();
  });

  it("hands keys pressed in the projection window (a presentation clicker) to the console view, once each", async () => {
    const c = await ready();
    const keys: string[] = [];
    const off = c.onRemoteKey((k) => keys.push(k.code));
    const output = new BroadcastChannel(channelName("ctrltest"));
    const key = { key: "PageDown", code: "PageDown", shiftKey: false, repeat: false };
    output.postMessage({ type: "key", outputId: "out1", id: "k1", key });
    output.postMessage({ type: "key", outputId: "out1", id: "k1", key }); // the same press twice
    output.postMessage({ type: "key", outputId: "out1", id: "k2", key: { ...key, code: "ArrowLeft", key: "ArrowLeft" } });
    output.postMessage({ type: "key", outputId: "out1", id: "k3", key: { key: 5 } }); // malformed: dropped
    await flush();
    expect(keys).toEqual(["PageDown", "ArrowLeft"]);
    off();
    output.postMessage({ type: "key", outputId: "out1", id: "k4", key });
    await flush();
    expect(keys).toHaveLength(2);
    output.close();
    c.detach();
  });

  it("手動切換 with the track on: the audio plays, the lyrics still wait for cues", async () => {
    const c = await ready();
    c.chooseMode("live");
    const el = FakeAudio.last!;
    expect(el.paused).toBe(true);
    c.setLiveAudio(true);
    await c.play();
    await flush();
    expect(el.paused).toBe(false);
    expect(c.getSnapshot().liveAudio).toBe(true);
    // the track moves on, the line on stage does not
    el.currentTime = 30;
    c.cueLine(1);
    await flush();
    expect(lastState().lineIndex).toBe(1);
    el.currentTime = 35;
    await flush(60);
    expect(lastState().lineIndex).toBe(1);
    // back to a silent 手動切換 (a live band)
    c.setLiveAudio(false);
    await flush();
    expect(el.paused).toBe(true);
    expect(c.getSnapshot().liveAudio).toBe(false);
    // play means the music: it turns the track back on
    await c.play();
    await flush();
    expect(el.paused).toBe(false);
    expect(c.getSnapshot().liveAudio).toBe(true);
    c.detach();
  });

  it("a track playing in 跟音檔 keeps playing when the operator switches to 手動切換", async () => {
    const c = await ready();
    c.chooseMode("track");
    c.setLiveAudio(false);
    await c.play();
    await flush();
    const el = FakeAudio.last!;
    expect(el.paused).toBe(false);
    c.chooseMode("live");
    await flush();
    expect(el.paused).toBe(false);
    expect(c.getSnapshot().liveAudio).toBe(true);
    expect(c.getSnapshot().mode).toBe("live");
    // a paused track stays paused: a silent LIVE for a live band
    c.pause();
    c.setLiveAudio(false);
    c.chooseMode("track");
    c.chooseMode("live");
    await flush();
    expect(el.paused).toBe(true);
    expect(c.getSnapshot().liveAudio).toBe(false);
    c.detach();
  });

  it("overrides are broadcast immediately and survive a re-attach", async () => {
    const c = await ready();
    c.toggleBlackout();
    c.sceneSlot(2);
    await flush();
    expect(lastState().overrides).toMatchObject({ blackout: true, scene: "motif" });
    c.detach();
    const again = new ConsoleController("ctrltest");
    again.attach();
    await flush();
    expect(again.getOverrides().blackout).toBe(true);
    again.setSceneOverride(null);
    again.resetOverrides();
    await flush();
    expect(lastState().overrides.blackout).toBe(false);
    again.detach();
  });

  it("plan edits re-broadcast the project and PATCH the server", async () => {
    const c = await ready();
    received = [];
    c.updateSection(0, { scene: "tunnel" });
    expect(c.getSnapshot().save.status).toBe("pending");
    await c.flushSave();
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(patch).toBeTruthy();
    const body = JSON.parse(String((patch![1] as RequestInit).body));
    expect(body.plan.sections[0].scene).toBe("tunnel");
    expect(c.getSnapshot().save.status).toBe("saved");
    await flush(150);
    expect(received.some((m) => m.type === "project" && m.project.plan?.sections[0].scene === "tunnel")).toBe(true);
    c.detach();
  });

  it("adopts the 排版 editor's type system from the channel and re-broadcasts it, without saving it again", async () => {
    const c = await ready();
    received = [];
    fetchMock.mockClear();
    const plan = c.getSnapshot().project!.plan!;
    const typeSystem = { voice: "ink" as const, params: { scaleContrast: 0.6, density: 0.35, verticalRatio: 0.85, gridColumns: 5, gridMargin: 0.6, motionSpeed: 0.3, motionIntensity: 0.4, texture: 0.65, ornament: 0.5 }, color: "solid" as const, fonts: { cjk: "lxgw-wenkai-tc" as const, latin: "playfair-display" as const }, weight: 700, ornaments: [], seal: "", rationale: "", lines: [] };
    const editor = new BroadcastChannel(channelName("ctrltest"));
    editor.postMessage({ type: "plan", projectId: "ctrltest", plan: { ...plan, typeSystem }, sender: "editor1" });
    await flush(60);
    expect(c.getSnapshot().project!.plan!.typeSystem?.voice).toBe("ink");
    expect(received.some((m) => m.type === "project" && m.project.plan?.typeSystem?.voice === "ink")).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")).toBe(false);
    // a plan for another song is ignored
    editor.postMessage({ type: "plan", projectId: "other", plan: { ...plan, typeSystem: { ...typeSystem, voice: "glitch" } }, sender: "editor1" });
    await flush(40);
    expect(c.getSnapshot().project!.plan!.typeSystem?.voice).toBe("ink");
    // the console's own later edit keeps the adopted type system
    c.updateSection(0, { scene: "tunnel" });
    await c.flushSave();
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse(String((patch![1] as RequestInit).body)).plan.typeSystem.voice).toBe("ink");
    editor.close();
    c.detach();
  });

  it("reports a missing project", async () => {
    const c = new ConsoleController("missing");
    c.attach();
    await flush();
    expect(c.getSnapshot().load.status).toBe("not-found");
    c.detach();
  });
});

/** A BroadcastChannel spy (like the output window) on any channel. */
function spy(name: string) {
  const ch = new BroadcastChannel(name);
  const messages: StageMessage[] = [];
  ch.onmessage = (ev: MessageEvent<StageMessage>) => messages.push(ev.data);
  return { ch, messages, of: <T extends StageMessage["type"]>(type: T) => messages.filter((m): m is Extract<StageMessage, { type: T }> => m.type === type) };
}

describe("ConsoleController in the show console (phase 2b)", () => {
  it("drives an injected channel and stays silent (no channel, no heartbeat, no session) while preloaded", async () => {
    const show = spy("livelyrics:show:s1");
    try {
      const c = new ConsoleController("ctrltest", { channel: null, consoleId: "console-a" });
      c.attach();
      await flush(1150); // past a heartbeat
      expect(c.getSnapshot().load.status).toBe("ready");
      expect(FakeAudio.last!.preload).toBe("auto"); // the audio is preloaded, not played
      expect(FakeAudio.last!.paused).toBe(true);
      expect(received).toEqual([]);
      expect(show.messages).toEqual([]);
      expect(window.sessionStorage.getItem("livelyrics:console-session:ctrltest")).toBeNull();
      show.ch.postMessage({ type: "hello", from: "output", outputId: "o1" } satisfies StageMessage);
      await flush();
      expect(show.messages).toEqual([]); // nobody answers from a silent controller

      c.setChannel("livelyrics:show:s1", { transition: { kind: "fade", ms: 800 } });
      await flush();
      const [take] = show.of("project");
      expect(take).toMatchObject({ project: { id: "ctrltest" }, transition: { kind: "fade", ms: 800 }, sender: "console-a" });
      expect(show.of("state").at(-1)).toMatchObject({ sender: "console-a", state: { projectId: "ctrltest", t: 0, playing: false } });
      expect(received).toEqual([]); // never on the song's own channel

      // later broadcasts (an edit, a hello) carry no transition
      show.ch.postMessage({ type: "hello", from: "output", outputId: "o1" } satisfies StageMessage);
      await flush();
      expect(show.of("project")).toHaveLength(2);
      expect(show.of("project")[1].transition).toBeUndefined();
      c.detach();
    } finally {
      show.ch.close();
    }
  });

  it("defaults to the per-song channel and opens a given output target", async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal("window", { ...window, open });
    const c = new ConsoleController("ctrltest", { output: { url: "/s/show1/output", name: "livelyrics-output-show-show1" } });
    c.attach();
    await flush();
    expect(received.some((m) => m.type === "project")).toBe(true);
    c.openOutput();
    expect(open).toHaveBeenCalledWith("", "livelyrics-output-show-show1", expect.any(String));
    c.detach();
  });

  it("announces the preload on air and again after a hello", async () => {
    const show = spy("livelyrics:show:s2");
    try {
      const c = new ConsoleController("ctrltest", { channel: "livelyrics:show:s2", consoleId: "k" });
      c.attach();
      await flush();
      const next = { ...makeProject(), id: "nextsong" };
      c.setPreload(next);
      await flush();
      expect(show.of("preload")).toHaveLength(1);
      expect(show.of("preload")[0]).toMatchObject({ project: { id: "nextsong" }, sender: "k" });
      show.ch.postMessage({ type: "hello", from: "output", outputId: "o2" } satisfies StageMessage);
      await flush();
      expect(show.of("preload")).toHaveLength(2);
      c.detach();
    } finally {
      show.ch.close();
    }
  });

  it("counts another console only when it is another console window", async () => {
    const name = "livelyrics:show:s3";
    const a = new ConsoleController("ctrltest", { channel: name, consoleId: "same" });
    const b = new ConsoleController("ctrltest", { channel: name, consoleId: "same" });
    a.attach();
    b.attach();
    await flush(60);
    b.seek(12);
    await flush(60);
    expect(a.getSnapshot().otherConsole).toBe(false);
    expect(b.getSnapshot().otherConsole).toBe(false);
    const c = new ConsoleController("ctrltest", { channel: name, consoleId: "other" });
    c.attach();
    await flush(60);
    expect(a.getSnapshot().otherConsole).toBe(true); // c's state reached a
    a.seek(5);
    await flush(60);
    expect(c.getSnapshot().otherConsole).toBe(true); // and a's reached c
    for (const x of [a, b, c]) x.detach();
  });

  it("detaching stops its audio and goes quiet", async () => {
    const c = await ready();
    await c.play();
    const el = FakeAudio.last!;
    expect(el.paused).toBe(false);
    c.detach();
    expect(el.paused).toBe(true);
    await flush(); // what was posted before the detach (its last, held frame) arrives
    expect(lastState().playing).toBe(false);
    received = [];
    await flush(1150); // past a heartbeat
    expect(received).toEqual([]);
  });

  it("a show take starts clean; a reload restores overrides, position, hold and loop", async () => {
    const c = await ready();
    c.seek(10);
    c.toggleBlackout();
    c.toggleHold();
    c.toggleLoop();
    await flush();
    c.detach();
    const again = new ConsoleController("ctrltest");
    again.attach();
    await flush();
    FakeAudio.last!.emit("loadedmetadata");
    expect(again.getSnapshot()).toMatchObject({ sectionHold: 1, sectionLoop: 1 });
    expect(again.getOverrides().blackout).toBe(true);
    expect(FakeAudio.last!.currentTime).toBeCloseTo(10, 1);
    again.detach();
    const take = new ConsoleController("ctrltest", { resume: false });
    take.attach();
    await flush();
    FakeAudio.last!.emit("loadedmetadata");
    expect(take.getSnapshot()).toMatchObject({ sectionHold: null, sectionLoop: null });
    expect(take.getOverrides().blackout).toBe(false);
    expect(FakeAudio.last!.currentTime).toBe(0);
    take.detach();
  });
});

describe("ConsoleController section hold / loop / jumps (phase 2b)", () => {
  it("TRACK hold keeps the section while the lyrics follow time", async () => {
    const c = await ready();
    c.seek(8.5);
    await flush();
    expect(lastState()).toMatchObject({ sectionIndex: 1, lineIndex: 0 });
    expect(lastState().sectionHeld).toBeUndefined();
    c.toggleHold();
    await flush();
    expect(c.getSnapshot().sectionHold).toBe(1);
    c.seek(26.5);
    await flush();
    expect(lastState()).toMatchObject({ sectionIndex: 1, lineIndex: 4, sectionHeld: true });
    // release: the section at the current time
    c.toggleHold();
    await flush();
    expect(c.getSnapshot().sectionHold).toBeNull();
    expect(lastState().sectionIndex).toBe(2);
    expect(lastState().sectionHeld).toBeUndefined();
    c.detach();
  });

  it("LIVE hold follows cues; jumping to another section releases it", async () => {
    const c = await ready();
    c.setMode("live");
    c.cueLine(0);
    c.toggleHold();
    c.cueLine(4);
    await flush();
    expect(lastState()).toMatchObject({ mode: "live", lineIndex: 4, sectionIndex: 1, sectionHeld: true });
    c.jumpToSection(2);
    await flush();
    expect(c.getSnapshot().sectionHold).toBeNull();
    expect(lastState()).toMatchObject({ lineIndex: 4, sectionIndex: 2 });
    c.detach();
  });

  it("TRACK loop seeks back to the section start at its end; seeking out ends it", async () => {
    const c = await ready();
    c.seek(10);
    c.toggleLoop();
    expect(c.getSnapshot().sectionLoop).toBe(1);
    await c.play();
    const el = FakeAudio.last!;
    el.currentTime = 23.995; // the playhead reaches the end of section 1 (8-24)
    await flush(80);
    expect(el.currentTime).toBeCloseTo(8.001, 2);
    expect(c.getSnapshot().sectionLoop).toBe(1);
    // the 下一句 marker already shows the loop's first line near the end
    el.currentTime = 20.5;
    expect(c.upcomingLine()).toBe(0);
    c.seek(30);
    expect(c.getSnapshot().sectionLoop).toBeNull();
    c.detach();
  });

  it("TRACK loop on the last section plays on after the song ends", async () => {
    const c = await ready();
    c.seek(30);
    c.toggleLoop();
    await c.play();
    const el = FakeAudio.last!;
    el.currentTime = 40;
    el.paused = true;
    el.emit("ended");
    await flush();
    expect(el.currentTime).toBeCloseTo(24.001, 2);
    expect(el.paused).toBe(false);
    c.detach();
  });

  it("LIVE loop wraps from the section's last line to its first", async () => {
    const c = await ready();
    c.setMode("live");
    c.cueLine(1);
    c.toggleLoop(); // section 1: lines 0..3
    expect(c.getSnapshot().sectionLoop).toBe(1);
    c.cueLine(3);
    expect(c.upcomingLine()).toBe(0);
    c.next();
    await flush();
    expect(lastState().lineIndex).toBe(0);
    c.next();
    await flush();
    expect(lastState().lineIndex).toBe(1);
    // a cue outside the section ends the loop
    c.cueLine(4);
    expect(c.getSnapshot().sectionLoop).toBeNull();
    c.detach();
  });

  it("LIVE loop parks the clock before the section's end", async () => {
    // section 1 is 8-15; after l1 (12) the next timed line is l3 at 16, in section 2
    const plan = testPlan([section("s0", 0, 8), section("s1", 8, 15), section("s2", 15, 40)]);
    serve = () => ({ ...makeProject(), plan });
    const c = await ready();
    c.setMode("live");
    c.cueLine(1);
    expect(c.songTime(Date.now() + 10000)).toBeCloseTo(16, 2); // it would run into section 2
    c.toggleLoop();
    expect(c.getSnapshot().sectionLoop).toBe(1);
    expect(c.songTime(Date.now() + 10000)).toBeCloseTo(14.95, 2); // parked inside section 1
    c.cueLine(1);
    expect(c.songTime(Date.now() + 10000)).toBeCloseTo(14.95, 2);
    c.toggleLoop();
    c.cueLine(1);
    expect(c.songTime(Date.now() + 10000)).toBeCloseTo(16, 2);
    c.detach();
  });

  it("section jumps: TRACK seeks, LIVE cues the first line and shows the section at once", async () => {
    // section 2 starts at 26.5: l4 (26) is a pickup sung into it
    const plan = testPlan([section("s0", 0, 8), section("s1", 8, 26.5), section("s2", 26.5, 40)]);
    serve = () => ({ ...makeProject(), plan });
    const c = await ready();
    c.jumpToSection(2);
    await flush();
    expect(FakeAudio.last!.currentTime).toBeCloseTo(26.501, 2);
    expect(lastState().sectionIndex).toBe(2);
    c.setMode("live");
    c.jumpToSection(2);
    await flush();
    let s = lastState();
    expect(s.lineIndex).toBe(4);
    expect(s.t).toBeLessThan(26.5); // the clock sits on the pickup line...
    expect(s.sectionIndex).toBe(2); // ...and the section shows anyway
    c.jumpToSection(0); // an instrumental intro: no line, the clock from its start
    await flush();
    s = lastState();
    expect(s).toMatchObject({ lineIndex: null, sectionIndex: 0 });
    expect(s.t).toBeLessThan(0.5);
    c.stepSection(1);
    await flush();
    expect(lastState()).toMatchObject({ lineIndex: 0, sectionIndex: 1 });
    c.stepSection(-1);
    c.stepSection(-1); // already at the first: stays
    await flush();
    expect(lastState().sectionIndex).toBe(0);
    c.detach();
  });
});
