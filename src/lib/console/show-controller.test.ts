// The show console's engine in Node: a show of walk-in, two songs, an interlude and a walk-out,
// served by a mocked API; a BroadcastChannel spy stands in for the show's projection window.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBible } from "@/lib/band";
import { defaultOutput } from "@/lib/output";
import { showChannelName, type StageMessage } from "@/lib/stage/protocol";
import type { Band, Project, ProjectSummary, Show } from "@/lib/types";
import { quarterFrames } from "@/lib/midi/mtc";
import { framesToTc, tcToFrames } from "@/lib/sync/timecode";
import { ShowLiveController } from "./show-controller";
import { AUTO_STANDBY_ID, loadShowLiveSession } from "./show-live";
import { FakeAudio, flush, stubBrowser } from "./test-env";
import { testLyrics, testPlan } from "./test-fixtures";

const look = { scene: "gradient" as const, colorway: ["#000000", "#224488", "#ff5577"] as [string, string, string], media: null };

function makeShow(): Show {
  return {
    id: "show1",
    bandId: "band1",
    name: "夏日場",
    output: defaultOutput(),
    items: [
      { id: "walkin", kind: "walk-in", title: "進場", look: { ...look, text: "示範樂團", durationHint: 300 } },
      { id: "song1", kind: "song", projectId: "p1" },
      { id: "mc", kind: "interlude", title: "串場", look: { ...look, text: "稍等一下" } },
      { id: "song2", kind: "song", projectId: "p2" },
      { id: "walkout", kind: "walk-out", title: "散場", look: { ...look, text: "謝謝大家" } },
    ],
    notes: "",
    arc: null,
    createdAt: "",
    updatedAt: "",
  };
}

const band: Band = { id: "band1", name: "示範樂團", createdAt: "", updatedAt: "", bible: defaultBible(), assets: [] };

function project(id: string): Project {
  return {
    id,
    createdAt: "",
    updatedAt: "",
    status: "ready",
    meta: { title: id === "p1" ? "第一首" : "第二首", artist: "示範樂團", duration: 40, fileName: "a.wav", mimeType: "audio/wav" },
    audioFile: "audio.wav",
    analysis: null,
    lyrics: testLyrics(),
    research: null,
    plan: testPlan(),
    assets: [],
    output: defaultOutput(),
    bandId: "band1",
  };
}

const summary = (id: string): ProjectSummary => ({ id, title: project(id).meta.title, artist: "", duration: 40, status: "ready", updatedAt: "", bandId: "band1", lyricLines: 5, hasPlan: true });

let show: Show;
let listener: BroadcastChannel;
let received: StageMessage[] = [];

function serve(url: string): unknown | null {
  if (url === "/api/shows/show1") return show;
  if (url === "/api/bands/band1") return band;
  if (url === "/api/projects") return [summary("p1"), summary("p2")];
  const m = /^\/api\/projects\/(p1|p2)$/.exec(url);
  if (m) return project(m[1]);
  return null;
}

beforeEach(() => {
  show = makeShow();
  stubBrowser(serve);
  received = [];
  listener = new BroadcastChannel(showChannelName("show1"));
  listener.onmessage = (ev: MessageEvent<StageMessage>) => received.push(ev.data);
});

afterEach(() => {
  listener.close();
  vi.unstubAllGlobals();
});

const of = <T extends StageMessage["type"]>(type: T) => received.filter((m): m is Extract<StageMessage, { type: T }> => m.type === type);
const lastState = () => of("state").at(-1)?.state;

async function started(): Promise<ShowLiveController> {
  const ctl = new ShowLiveController("show1");
  ctl.attach();
  await flush(60);
  expect(ctl.getSnapshot().load.status).toBe("ready");
  return ctl;
}

/** GO as if the double-GO protection had run out. */
function goLater(ctl: ShowLiveController): boolean {
  return ctl.go(ctl.getSnapshot().goLockedUntil + 1);
}

describe("ShowLiveController", () => {
  it("before the first GO: the first item is armed and preloaded, the output is answered", async () => {
    const ctl = await started();
    const snap = ctl.getSnapshot();
    expect(snap.live).toEqual({ current: null, armed: "walkin", takenAt: null });
    expect(snap.onAir).toBeNull();
    expect(snap.next).toMatchObject({ kind: "look", itemId: "walkin" });
    expect(snap.rail.map((r) => r.id)).toEqual(["walkin", "song1", "mc", "song2", "walkout"]);
    expect(snap.standby?.id).toBe(AUTO_STANDBY_ID);
    // the idle link pings (so 「投影已連線」 shows before the show) and warms the first item
    expect(of("ping").length).toBeGreaterThan(0);
    expect(of("preload").at(-1)?.project.id).toBe("look-walkin");
    expect(of("state")).toEqual([]); // nothing is on stage yet
    listener.postMessage({ type: "pong", outputId: "o1", at: Date.now(), width: 1920, height: 1080, fullscreen: true } satisfies StageMessage);
    await flush();
    expect(ctl.getSnapshot().output).toMatchObject({ connected: true, width: 1920 });
    ctl.detach();
  });

  it("GO takes the items in order; only the item on air talks on the show channel", async () => {
    const ctl = await started();
    received = [];
    expect(ctl.go()).toBe(true);
    await flush();
    let snap = ctl.getSnapshot();
    expect(snap.live).toMatchObject({ current: "walkin", armed: "song1" });
    expect(snap.onAir?.kind).toBe("look");
    const take = of("project")[0];
    expect(take).toMatchObject({ project: { id: "look-walkin" }, transition: { kind: "fade", ms: 800 } });
    expect(lastState()).toMatchObject({ projectId: "look-walkin", lineIndex: 0, sectionIndex: 0, playing: true });
    // double-GO protection
    expect(ctl.go()).toBe(false);
    await flush(60);
    // the armed song is loading silently beside it, and the output warms it
    snap = ctl.getSnapshot();
    expect(snap.next).toMatchObject({ kind: "song", itemId: "song1" });
    expect(snap.nextReady).toBe(true);
    expect(of("preload").at(-1)?.project.id).toBe("p1");
    expect(of("state").every((m) => m.state.projectId === "look-walkin")).toBe(true);

    received = [];
    expect(goLater(ctl)).toBe(true);
    await flush(60);
    snap = ctl.getSnapshot();
    expect(snap.live).toMatchObject({ current: "song1", armed: "mc" });
    expect(snap.onAir?.kind).toBe("song");
    expect(of("project")[0]).toMatchObject({ project: { id: "p1" }, transition: { kind: "fade" } });
    // armed at its start, paused
    expect(lastState()).toMatchObject({ projectId: "p1", t: 0, playing: false, lineIndex: null });
    const songAudio = FakeAudio.all.find((a) => a.src.endsWith("/api/projects/p1/audio"));
    expect(songAudio?.paused).toBe(true);
    // the walk-in went quiet: no state of it after the take's project
    const after = received.slice(received.indexOf(of("project")[0]));
    expect(after.filter((m) => m.type === "state").every((m) => (m as Extract<StageMessage, { type: "state" }>).state.projectId === "p1")).toBe(true);
    // and the interlude is armed and warmed next
    expect(of("preload").at(-1)?.project.id).toBe("look-mc");

    // on to the end of the setlist, then GO does nothing
    expect(goLater(ctl)).toBe(true);
    expect(goLater(ctl)).toBe(true);
    expect(goLater(ctl)).toBe(true);
    expect(ctl.getSnapshot().live).toMatchObject({ current: "walkout", armed: null });
    expect(goLater(ctl)).toBe(false);
    ctl.detach();
  });

  it("stops a song's audio when the next item is taken", async () => {
    const ctl = await started();
    goLater(ctl);
    goLater(ctl);
    await flush(60);
    const onAir = ctl.getSnapshot().onAir;
    expect(onAir?.kind).toBe("song");
    if (onAir?.kind !== "song") return;
    await onAir.controller.play();
    const el = FakeAudio.all.find((a) => a.src.endsWith("/p1/audio"))!;
    expect(el.paused).toBe(false);
    goLater(ctl);
    expect(el.paused).toBe(true);
    ctl.detach();
  });

  it("a blackout carries across GO (the show's master), and GO under black stays black", async () => {
    const ctl = await started();
    goLater(ctl);
    await flush();
    ctl.getSnapshot().onAir!.controller.toggleBlackout();
    goLater(ctl);
    await flush(60);
    expect(ctl.getSnapshot().onAir?.itemId).toBe("song1");
    expect(lastState()).toMatchObject({ projectId: "p1", overrides: { blackout: true } });
    ctl.detach();
  });

  it("standby takes the band's safe look at any time and keeps the next song armed", async () => {
    const ctl = await started();
    goLater(ctl);
    goLater(ctl); // song 1 on air, the interlude armed
    await flush(60);
    received = [];
    expect(ctl.standby()).toBe(true); // no double-GO lock for the panic key
    await flush();
    const snap = ctl.getSnapshot();
    expect(snap.live).toMatchObject({ current: AUTO_STANDBY_ID, armed: "mc" });
    expect(snap.onAir).toMatchObject({ kind: "look", itemId: AUTO_STANDBY_ID });
    expect(of("project")[0].project.id).toBe(`look-${AUTO_STANDBY_ID}`);
    expect(lastState()).toMatchObject({ projectId: `look-${AUTO_STANDBY_ID}`, lineIndex: null });
    expect(ctl.standby()).toBe(false); // already on air

    // the song that fell apart can be re-taken from the rail: fresh, at its start
    ctl.arm("song1");
    await flush(60);
    expect(goLater(ctl)).toBe(true);
    await flush(60);
    expect(ctl.getSnapshot().live).toMatchObject({ current: "song1", armed: "mc" });
    expect(lastState()).toMatchObject({ projectId: "p1", t: 0 });
    ctl.detach();
  });

  it("uses the show's own standby look when it has one", async () => {
    show = { ...makeShow(), items: [...makeShow().items, { id: "wait", kind: "standby", title: "技術暫停", look: { ...look, text: "馬上回來" } }] };
    const ctl = await started();
    expect(ctl.getSnapshot().standby?.id).toBe("wait");
    ctl.standby();
    await flush();
    expect(lastState()).toMatchObject({ projectId: "look-wait", lineIndex: 0 });
    ctl.detach();
  });

  it("cut and autoplay toggles are remembered per show", async () => {
    const ctl = await started();
    ctl.setTransition("cut");
    ctl.setAutoPlay(true);
    goLater(ctl);
    await flush(60);
    expect(of("project").at(-1)).toMatchObject({ project: { id: "look-walkin" }, transition: { kind: "cut", ms: 0 } });
    goLater(ctl); // the song starts playing on the take
    await flush(60);
    const el = FakeAudio.all.find((a) => a.src.endsWith("/p1/audio"))!;
    expect(el.paused).toBe(false);
    ctl.detach();
    const again = new ShowLiveController("show1");
    expect(window.localStorage.getItem("livelyrics:show-live-prefs:show1")).toContain('"transition":"cut"');
    again.attach();
    await flush(60);
    expect(again.getSnapshot()).toMatchObject({ transition: "cut", autoPlay: true });
    again.detach();
  });

  it("a reloaded console tab comes back to the item on air (no transition, same take time)", async () => {
    const ctl = await started();
    goLater(ctl);
    await flush();
    const takenAt = ctl.getSnapshot().live.takenAt;
    ctl.getSnapshot().onAir!.controller.toggleFreeze();
    await flush();
    ctl.detach();
    expect(loadShowLiveSession("show1")).toMatchObject({ current: "walkin", armed: "song1", takenAt });
    // a look's overrides are kept under the show's own key (two shows' looks never share one)
    expect(window.sessionStorage.getItem("livelyrics:console-session:show-show1-walkin")).toContain('"freeze":true');
    expect(window.sessionStorage.getItem("livelyrics:console-session:look-walkin")).toBeNull();

    received = [];
    const again = new ShowLiveController("show1");
    again.attach();
    await flush(60);
    const snap = again.getSnapshot();
    expect(snap.live).toMatchObject({ current: "walkin", armed: "song1", takenAt });
    expect(snap.onAir).toMatchObject({ kind: "look", itemId: "walkin" });
    const first = of("project")[0];
    expect(first.project.id).toBe("look-walkin");
    expect(first.transition).toBeUndefined();
    // the look keeps its overrides and its clock
    expect(lastState()).toMatchObject({ projectId: "look-walkin", overrides: { freeze: true } });
    expect(lastState()!.t).toBeGreaterThan(0);
    again.detach();
  });

  it("a reload during a song restores the song where it was", async () => {
    const ctl = await started();
    goLater(ctl);
    goLater(ctl);
    await flush(60);
    const onAir = ctl.getSnapshot().onAir;
    if (onAir?.kind !== "song") throw new Error("song expected");
    onAir.controller.seek(12.5);
    onAir.controller.toggleHold();
    await flush();
    ctl.detach();
    const again = new ShowLiveController("show1");
    again.attach();
    await flush(60);
    const restored = again.getSnapshot().onAir;
    expect(restored).toMatchObject({ kind: "song", itemId: "song1" });
    if (restored?.kind !== "song") return;
    const el = FakeAudio.last!;
    expect(el.src.endsWith("/p1/audio")).toBe(true);
    el.emit("loadedmetadata");
    expect(restored.controller.getSnapshot().sectionHold).toBe(1);
    expect(el.currentTime).toBeCloseTo(12.5, 1);
    again.detach();
  });

  it("reports a missing show", async () => {
    show = { ...makeShow(), id: "gone" };
    const ctl = new ShowLiveController("nope");
    ctl.attach();
    await flush(60);
    expect(ctl.getSnapshot().load.status).toBe("not-found");
    ctl.detach();
  });
});

// ---------------------------------------------------------------- phase 5a: 跟隨時間碼換歌

/** A running MTC transport (25 fps) from `start` on the show's engine, a sequence every 80 ms. */
function runMtc(ctl: ShowLiveController, start: { hours: number; minutes: number; seconds: number; frames: number }) {
  const t0 = Date.now();
  const first = tcToFrames(start, 25);
  const send = () => {
    const frame = first + Math.max(0, Math.floor((((Date.now() - t0) / 1000) * 25 - 1.75) / 2) * 2);
    const now = Date.now();
    quarterFrames(framesToTc(frame, 25), 25).forEach((b, k) => ctl.sync.handle({ type: "mtcQuarterFrame", piece: b >> 4, value: b & 0x0f }, now - (7 - k) * 10));
  };
  send();
  const timer = setInterval(send, 80);
  return () => clearInterval(timer);
}

describe("ShowLiveController × timecode (phase 5a)", () => {
  it("跟隨時間碼換歌 takes the song whose hour the timecode enters, and leaves looks to the operator", async () => {
    const ctl = await started();
    ctl.sync.setSource("mtc");
    ctl.setFollowTimecode(true);
    expect(ctl.getSnapshot().followTimecode).toBe(true);
    // song 2 is the setlist's second song: hour 2
    let stop = runMtc(ctl, { hours: 2, minutes: 0, seconds: 5, frames: 0 });
    await flush(400);
    let snap = ctl.getSnapshot();
    expect(snap.live.current).toBe("song2");
    expect(snap.onAir).toMatchObject({ kind: "song", itemId: "song2" });
    // the taken song follows the timecode from its own hour
    if (snap.onAir?.kind !== "song") throw new Error("song expected");
    await flush(100);
    expect(snap.onAir.controller.getSnapshot().timecode).toMatchObject({ start: "02:00:00:00", from: "setlist", following: true });
    expect(snap.onAir.controller.songTime()).toBeGreaterThan(5);
    expect(of("project").some((m) => m.project.id === "p2" && m.transition?.kind === "fade")).toBe(true);
    // the operator takes the interlude: the timecode is still in song 2's hour, nothing is re-taken
    ctl.arm("mc");
    expect(ctl.go(Date.now() + 1000)).toBe(true);
    await flush(300);
    expect(ctl.getSnapshot().live.current).toBe("mc");
    stop();
    // the rig moves on to song 1's hour: taken
    stop = runMtc(ctl, { hours: 1, minutes: 0, seconds: 2, frames: 0 });
    await flush(400);
    snap = ctl.getSnapshot();
    expect(snap.live.current).toBe("song1");
    stop();
    ctl.detach();
  });

  it("stays manual with the toggle off, and between songs", async () => {
    const ctl = await started();
    ctl.sync.setSource("mtc");
    let stop = runMtc(ctl, { hours: 2, minutes: 0, seconds: 5, frames: 0 });
    await flush(300);
    expect(ctl.getSnapshot().live.current).toBeNull();
    stop();
    // (turned on while the timecode is inside a song's hour it would take that song at once)
    ctl.sync.setSource("manual");
    ctl.sync.setSource("mtc");
    ctl.setFollowTimecode(true);
    // 00:30:00:00: before the first song's hour
    stop = runMtc(ctl, { hours: 0, minutes: 30, seconds: 0, frames: 0 });
    await flush(300);
    expect(ctl.getSnapshot().live.current).toBeNull();
    stop();
    ctl.detach();
  });

  it("an item's own start timecode decides its range", async () => {
    show = makeShow();
    show.items = show.items.map((it) => (it.id === "song1" ? { ...it, timecode: "05:00:00:00" } : it));
    const ctl = await started();
    ctl.sync.setSource("mtc");
    ctl.setFollowTimecode(true);
    const stop = runMtc(ctl, { hours: 5, minutes: 0, seconds: 1, frames: 0 });
    await flush(400);
    expect(ctl.getSnapshot().live.current).toBe("song1");
    stop();
    ctl.detach();
  });
});
