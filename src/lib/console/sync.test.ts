// The console controller with the sync layer (phase 5a) in Node: MTC quarter frames and MIDI clocks
// go in through SyncEngine.handle (the hook a MIDI input calls), a fake <audio> and a BroadcastChannel
// spy stand in for the browser. No device, no permission, no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quarterFrames } from "@/lib/midi/mtc";
import { defaultOutput } from "@/lib/output";
import { channelName, type StageMessage, type StageState } from "@/lib/stage/protocol";
import { SyncEngine } from "@/lib/sync/engine";
import { framesToTc, tcToFrames, type FrameRate, type Timecode } from "@/lib/sync/timecode";
import type { Project } from "@/lib/types";
import { ConsoleController } from "./controller";
import { FakeAudio, flush, stubBrowser } from "./test-env";
import { testLyrics, testPlan } from "./test-fixtures";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "synctest",
    createdAt: "",
    updatedAt: "",
    status: "ready",
    meta: { title: "同步", artist: "樂團", duration: 40, fileName: "a.wav", mimeType: "audio/wav" },
    audioFile: "audio.wav",
    analysis: null,
    lyrics: testLyrics(),
    research: null,
    plan: testPlan(),
    assets: [],
    output: defaultOutput(),
    ...over,
  };
}

let serve: () => Project = () => project();
let received: StageMessage[] = [];
let listener: BroadcastChannel;
let fetchMock: ReturnType<typeof stubBrowser>["fetchMock"];
const timers: Array<ReturnType<typeof setInterval>> = [];

beforeEach(() => {
  ({ fetchMock } = stubBrowser((url, init) => {
    if (init?.method === "PATCH") return serve();
    return url.startsWith("/api/projects/synctest") ? serve() : null;
  }));
  received = [];
  listener = new BroadcastChannel(channelName("synctest"));
  listener.onmessage = (ev: MessageEvent<StageMessage>) => received.push(ev.data);
});

afterEach(() => {
  for (const t of timers.splice(0)) clearInterval(t);
  listener.close();
  vi.unstubAllGlobals();
  serve = () => project();
});

function lastState(): StageState {
  const s = received.filter((m): m is Extract<StageMessage, { type: "state" }> => m.type === "state");
  return s[s.length - 1].state;
}

/** One quarter-frame sequence (a timecode every two frames) ending now. */
function sendSequence(engine: SyncEngine, tc: Timecode, rate: FrameRate) {
  const qf = 1000 / (rate === 29.97 ? 30000 / 1001 : rate) / 4;
  const now = Date.now();
  quarterFrames(tc, rate).forEach((b, k) => engine.handle({ type: "mtcQuarterFrame", piece: b >> 4, value: b & 0x0f }, now - (7 - k) * qf));
}

/** A running MTC transport from `start`, a sequence every two frames, until stopped. */
function runMtc(engine: SyncEngine, start: Timecode, rate: FrameRate = 25) {
  const t0 = Date.now();
  const first = tcToFrames(start, rate);
  const fps = rate === 29.97 ? 30000 / 1001 : rate;
  let stopped = false;
  const send = () => {
    if (stopped) return;
    // the sequence that completes now started 1.75 frames ago
    const elapsed = (Date.now() - t0) / 1000;
    const frame = first + Math.max(0, Math.floor((elapsed * fps - 1.75) / 2) * 2);
    sendSequence(engine, framesToTc(frame, rate), rate);
  };
  send();
  const timer = setInterval(send, 80);
  timers.push(timer);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function ready(opts: ConstructorParameters<typeof ConsoleController>[1] = {}) {
  const c = new ConsoleController("synctest", opts);
  c.attach();
  await flush(30);
  expect(c.getSnapshot().load.status).toBe("ready");
  return c;
}

describe("ConsoleController × timecode (phase 5a)", () => {
  it("TRACK: MTC becomes the song clock and the audio follows it", async () => {
    const c = await ready();
    c.sync.setSource("mtc");
    const stop = runMtc(c.sync, { hours: 1, minutes: 0, seconds: 10, frames: 0 });
    await flush(400);
    expect(c.isFollowingTimecode()).toBe(true);
    expect(c.getSnapshot().timecode).toMatchObject({ start: "01:00:00:00", from: "default", following: true });
    const t = c.songTime();
    expect(t).toBeGreaterThan(10.2);
    expect(t).toBeLessThan(10.8);
    const el = FakeAudio.last!;
    expect(el.paused).toBe(false);
    expect(Math.abs(el.currentTime - t)).toBeLessThan(0.2);
    expect(lastState()).toMatchObject({ mode: "track", playing: true, lineIndex: 0 });
    // manual navigation waits for 回到手動
    c.next();
    expect(c.getSnapshot().notices.at(-1)?.message).toContain("回到手動");
    expect(Math.abs(c.songTime() - t)).toBeLessThan(0.5);
    stop();
    c.detach();
  });

  it("freewheels on a dropout, then falls back to manual on the same line", async () => {
    const c = await ready();
    c.sync.setSource("mtc");
    c.sync.setFreewheel(0.5);
    const stop = runMtc(c.sync, { hours: 1, minutes: 0, seconds: 13, frames: 0 });
    await flush(400);
    expect(c.isFollowingTimecode()).toBe(true);
    stop();
    await flush(300);
    // freewheel: still following, the clock keeps running
    expect(c.sync.getSnapshot().lock).toBe("freewheel");
    expect(c.isFollowingTimecode()).toBe(true);
    await flush(500);
    expect(c.sync.getSnapshot().lock).toBe("lost");
    expect(c.isFollowingTimecode()).toBe(false);
    expect(c.getSnapshot().notices.some((n) => n.message === "時間碼中斷，已切回手動")).toBe(true);
    // TRACK: no auto-advance without the timecode
    expect(FakeAudio.last!.paused).toBe(true);
    await flush(60);
    expect(lastState()).toMatchObject({ playing: false, lineIndex: 1 });
    // manual works again
    c.next();
    await flush();
    expect(lastState().lineIndex).toBe(3);
    // the timecode comes back: locked again, with a notice
    const again = runMtc(c.sync, { hours: 1, minutes: 0, seconds: 26, frames: 0 });
    await flush(400);
    expect(c.isFollowingTimecode()).toBe(true);
    expect(c.getSnapshot().notices.some((n) => n.message === "時間碼恢復，已重新鎖定")).toBe(true);
    expect(lastState().lineIndex).toBe(4);
    again();
    c.detach();
  });

  it("another source locking is not a 「恢復」", async () => {
    const c = await ready();
    c.sync.setSource("mtc");
    c.sync.setFreewheel(0.5);
    const stop = runMtc(c.sync, { hours: 1, minutes: 0, seconds: 13, frames: 0 });
    await flush(400);
    stop();
    await flush(900);
    expect(c.sync.getSnapshot().lock).toBe("lost");
    // the operator goes to manual, then back to MTC: a new lock, no 「時間碼恢復」
    c.backToManual();
    c.sync.setSource("mtc");
    const again = runMtc(c.sync, { hours: 1, minutes: 0, seconds: 20, frames: 0 });
    await flush(400);
    expect(c.isFollowingTimecode()).toBe(true);
    expect(c.getSnapshot().notices.some((n) => n.message === "時間碼恢復，已重新鎖定")).toBe(false);
    again();
    c.detach();
  });

  it("LIVE: the timecode cues the timed lines; 回到手動 keeps the line and waits for a cue", async () => {
    const c = await ready();
    c.setMode("live");
    c.sync.setSource("mtc");
    const stop = runMtc(c.sync, { hours: 1, minutes: 0, seconds: 16, frames: 5 });
    await flush(400);
    expect(lastState()).toMatchObject({ mode: "live", lineIndex: 3, playing: true });
    expect(FakeAudio.last!.paused).toBe(true); // LIVE never plays the audio
    expect(c.backToManual()).toBe(true);
    stop();
    expect(c.sync.source).toBe("manual");
    expect(c.isFollowingTimecode()).toBe(false);
    await flush(60);
    expect(lastState()).toMatchObject({ lineIndex: 3 });
    // LIVE manual: the clock runs to the next line's start (26 s) and holds there
    expect(c.songTime(Date.now() + 60000)).toBeCloseTo(26, 1);
    c.next();
    await flush();
    expect(lastState().lineIndex).toBe(4);
    c.detach();
  });

  it("relocates after three consistent frames, never on a single glitch", async () => {
    const c = await ready();
    c.sync.setSource("mtc");
    const stop = runMtc(c.sync, { hours: 1, minutes: 0, seconds: 8, frames: 0 });
    await flush(300);
    const before = c.songTime();
    // one stray sequence 20 s later
    sendSequence(c.sync, { hours: 1, minutes: 0, seconds: 30, frames: 0 }, 25);
    await flush(40);
    expect(Math.abs(c.songTime() - before)).toBeLessThan(0.5);
    stop();
    // the rig jumps: 30 s, three sequences in a row
    const jump = runMtc(c.sync, { hours: 1, minutes: 0, seconds: 30, frames: 0 });
    await flush(400);
    expect(c.songTime()).toBeGreaterThan(30);
    expect(c.songTime()).toBeLessThan(31);
    jump();
    c.detach();
  });

  it("a song's own start timecode moves it to another hour (saved on the project)", async () => {
    const c = await ready();
    expect(c.setTimecodeStart("2")).toBe(true);
    expect(c.getSnapshot().timecode).toMatchObject({ start: "02:00:00:00", from: "project" });
    await flush();
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ timecode: { start: "02:00:00:00" } });
    expect(c.setTimecodeStart("25:00")).toBe(false);
    c.sync.setSource("mtc");
    const stop = runMtc(c.sync, { hours: 2, minutes: 0, seconds: 5, frames: 0 });
    await flush(400);
    expect(c.songTime()).toBeGreaterThan(5);
    expect(c.songTime()).toBeLessThan(5.8);
    stop();
    c.detach();
  });

  it("a silent (preloaded) show song never follows: its audio stays quiet", async () => {
    const engine = new SyncEngine({ settings: { source: "mtc" } });
    engine.attach();
    const c = await ready({ channel: null, sync: engine, timecodeStart: "01:00:00:00" });
    const stop = runMtc(engine, { hours: 1, minutes: 0, seconds: 10, frames: 0 });
    await flush(400);
    expect(c.isFollowingTimecode()).toBe(false);
    expect(FakeAudio.last!.paused).toBe(true);
    // on air it follows at once
    c.setChannel(channelName("synctest"));
    await flush(80);
    expect(c.isFollowingTimecode()).toBe(true);
    expect(c.getSnapshot().timecode.from).toBe("setlist");
    expect(c.setTimecodeStart("03:00:00:00")).toBe(false); // the setlist decides
    stop();
    c.detach();
    engine.detach();
  });
});

describe("ConsoleController × MIDI clock (節拍模式)", () => {
  it("TRACK, paused: a locked clock still beats the stage, and lets go when it stops", async () => {
    const c = await ready();
    c.sync.setSource("clock");
    const period = 60000 / (120 * 24);
    const t0 = Date.now();
    let n = 0;
    const timer = setInterval(() => {
      while (t0 + n * period <= Date.now()) {
        c.sync.handle({ type: "clock" }, t0 + n * period);
        n++;
      }
    }, 5);
    timers.push(timer);
    await flush(600);
    expect(c.getSnapshot().playing).toBe(false);
    const phases = new Set<number>();
    for (let i = 0; i < 5; i++) {
      await flush(40);
      const s = lastState();
      expect(s).toMatchObject({ mode: "track", playing: false, audio: { clock: true } });
      phases.add(Math.round(s.audio.beatPhase * 100));
    }
    expect(phases.size).toBeGreaterThan(3);
    clearInterval(timer);
    await flush(800);
    expect(c.sync.getSnapshot().lock).toBe("lost");
    expect(lastState().audio.clock).toBeUndefined();
    c.detach();
  });

  it("a locked clock gives the beat phase, before tap tempo", async () => {
    const c = await ready();
    c.setMode("live");
    c.tap();
    c.sync.setSource("clock");
    const period = 60000 / (128 * 24);
    c.sync.handle({ type: "start" }, Date.now());
    const t0 = Date.now();
    let n = 0;
    const timer = setInterval(() => {
      while (t0 + n * period <= Date.now()) {
        c.sync.handle({ type: "clock" }, t0 + n * period);
        n++;
      }
    }, 5);
    timers.push(timer);
    await flush(700);
    const beat = c.sync.beat();
    expect(beat.locked).toBe(true);
    expect(Math.abs((beat.bpm ?? 0) - 128)).toBeLessThan(1);
    const phases = new Set<number>();
    for (let i = 0; i < 6; i++) {
      await flush(40);
      const s = lastState();
      expect(s.audio.clock).toBe(true);
      phases.add(Math.round(s.audio.beatPhase * 100));
    }
    expect(phases.size).toBeGreaterThan(3);
    clearInterval(timer);
    // the clock stops: lost after half a second, the beat goes back to tap tempo
    await flush(700);
    expect(c.sync.getSnapshot().lock).toBe("lost");
    await flush(60);
    expect(lastState().audio.clock).toBeUndefined();
    c.detach();
  });
});
