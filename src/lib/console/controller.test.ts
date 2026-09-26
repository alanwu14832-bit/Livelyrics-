// Integration test of the console controller in Node with a fake <audio>, fake window /
// storage and mocked fetch. Node's global BroadcastChannel carries the real messages.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelName, type StageMessage, type StageState } from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";
import { ConsoleController } from "./controller";
import { testLyrics, testPlan } from "./test-fixtures";

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
  };
}

const fetchMock = vi.fn();
let listener: BroadcastChannel;
let received: StageMessage[] = [];

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
    if (String(url).startsWith("/api/projects/ctrltest")) return new Response(JSON.stringify(makeProject()), { status: 200 });
    return new Response(JSON.stringify({ error: "找不到專案" }), { status: 404 });
  });
  received = [];
  listener = new BroadcastChannel(channelName("ctrltest"));
  listener.onmessage = (ev: MessageEvent<StageMessage>) => received.push(ev.data);
});

afterEach(() => {
  listener.close();
  vi.unstubAllGlobals();
});

async function ready(): Promise<ConsoleController> {
  const c = new ConsoleController("ctrltest");
  c.attach();
  await flush();
  expect(c.getSnapshot().load.status).toBe("ready");
  return c;
}

describe("ConsoleController", () => {
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

  it("reports a missing project", async () => {
    const c = new ConsoleController("missing");
    c.attach();
    await flush();
    expect(c.getSnapshot().load.status).toBe("not-found");
    c.detach();
  });
});
