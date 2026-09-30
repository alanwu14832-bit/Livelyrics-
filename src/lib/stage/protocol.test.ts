import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERRIDES,
  MAX_TRANSITION_MS,
  TAKE_FADE_MS,
  channelName,
  parseStageMessage,
  sanitizeStageState,
  sanitizeTransition,
  showChannelName,
} from "./protocol";

const project = { id: "p1", meta: { title: "歌" }, plan: null, lyrics: { source: "none", synced: false, lines: [] } };

describe("channels", () => {
  it("names the per-song and the show channel apart", () => {
    expect(channelName("abc")).toBe("livelyrics:abc");
    expect(showChannelName("abc")).toBe("livelyrics:show:abc");
    expect(showChannelName("abc")).not.toBe(channelName("abc"));
  });
});

describe("sanitizeTransition", () => {
  it("keeps a known kind with a bounded length", () => {
    expect(sanitizeTransition({ kind: "fade", ms: 800 })).toEqual({ kind: "fade", ms: 800 });
    expect(sanitizeTransition({ kind: "cut", ms: 0 })).toEqual({ kind: "cut", ms: 0 });
    expect(sanitizeTransition({ kind: "fade", ms: 99999 })).toEqual({ kind: "fade", ms: MAX_TRANSITION_MS });
    expect(sanitizeTransition({ kind: "fade", ms: -5 })).toEqual({ kind: "fade", ms: 0 });
    expect(sanitizeTransition({ kind: "fade" })).toEqual({ kind: "fade", ms: TAKE_FADE_MS });
    expect(sanitizeTransition({ kind: "fade", ms: Number.NaN })).toEqual({ kind: "fade", ms: TAKE_FADE_MS });
  });

  it("drops anything else", () => {
    expect(sanitizeTransition({ kind: "wipe", ms: 300 })).toBeNull();
    expect(sanitizeTransition("fade")).toBeNull();
    expect(sanitizeTransition(null)).toBeNull();
    expect(sanitizeTransition(undefined)).toBeNull();
  });
});

describe("sanitizeStageState", () => {
  it("repairs every field and keeps a held section", () => {
    const s = sanitizeStageState(
      { projectId: "p1", mode: "karaoke", t: -3, playing: "yes", lineIndex: 2.5, sectionIndex: 3, sectionHeld: true, overrides: { blackout: 1, intensity: 9, scene: 7 }, audio: { level: 4, beatPhase: -1 } },
      undefined,
      1000,
    )!;
    expect(s).toMatchObject({ projectId: "p1", mode: "track", t: 0, playing: false, sentAt: 1000, lineIndex: null, lineStartedAt: 1000, sectionIndex: 3, sectionHeld: true });
    expect(s.overrides).toEqual({ ...DEFAULT_OVERRIDES, intensity: 1.5, scene: null });
    expect(s.audio).toEqual({ level: 1, bass: 0, onset: 0, beatPhase: 0 });
  });

  it("keeps the MIDI clock flag of the beat only when it is exactly true (phase 5a)", () => {
    expect(sanitizeStageState({ projectId: "p1", audio: { beatPhase: 0.4, clock: true } })!.audio).toEqual({ level: 0, bass: 0, onset: 0, beatPhase: 0.4, clock: true });
    expect(sanitizeStageState({ projectId: "p1", audio: { beatPhase: 0.4, clock: "yes" } })!.audio.clock).toBeUndefined();
  });

  it("only marks a hold when it is exactly true (older consoles never send it)", () => {
    expect(sanitizeStageState({ projectId: "p1" })!.sectionHeld).toBeUndefined();
    expect(sanitizeStageState({ projectId: "p1", sectionHeld: "true" })!.sectionHeld).toBeUndefined();
  });

  it("needs a project id, or takes the fixed one", () => {
    expect(sanitizeStageState({ t: 1 })).toBeNull();
    expect(sanitizeStageState("state")).toBeNull();
    expect(sanitizeStageState({ projectId: "other", t: 2 }, "fixed")!.projectId).toBe("fixed");
  });
});

describe("parseStageMessage", () => {
  it("accepts a project with an optional transition and sender", () => {
    expect(parseStageMessage({ type: "project", project })).toEqual({ type: "project", project });
    expect(parseStageMessage({ type: "project", project, transition: { kind: "fade", ms: 600 }, sender: "c1" })).toEqual({
      type: "project",
      project,
      transition: { kind: "fade", ms: 600 },
      sender: "c1",
    });
    // a malformed transition is dropped, the project still goes through (older outputs ignore it too)
    expect(parseStageMessage({ type: "project", project, transition: { kind: "spin" } })).toEqual({ type: "project", project });
  });

  it("accepts preload with a project, rejects it without one", () => {
    expect(parseStageMessage({ type: "preload", project, sender: "c1" })).toEqual({ type: "preload", project, sender: "c1" });
    expect(parseStageMessage({ type: "preload" })).toBeNull();
    expect(parseStageMessage({ type: "preload", project: { id: "x" } })).toBeNull();
    expect(parseStageMessage({ type: "project", project: { meta: {} } })).toBeNull();
  });

  it("sanitizes states, pings and pongs", () => {
    const state = parseStageMessage({ type: "state", state: { projectId: "p1", t: 12, playing: true, lineIndex: 3, sectionIndex: 1 }, sender: "c9" });
    expect(state).toMatchObject({ type: "state", sender: "c9", state: { projectId: "p1", t: 12, playing: true, lineIndex: 3, sectionIndex: 1 } });
    expect(parseStageMessage({ type: "state", state: null })).toBeNull();
    expect(parseStageMessage({ type: "ping", at: 5 })).toEqual({ type: "ping", at: 5 });
    expect(parseStageMessage({ type: "ping", at: "x", sender: "c1" })).toMatchObject({ type: "ping", sender: "c1" });
    expect(parseStageMessage({ type: "pong", outputId: "o", at: 1, width: "wide", height: 1080, fullscreen: 1 })).toEqual({ type: "pong", outputId: "o", at: 1, width: 0, height: 1080, fullscreen: false });
    expect(parseStageMessage({ type: "pong" })).toBeNull();
    expect(parseStageMessage({ type: "hello", from: "output", outputId: "o1" })).toEqual({ type: "hello", from: "output", outputId: "o1" });
    expect(parseStageMessage({ type: "hello" })).toBeNull();
  });

  it("drops unknown and malformed messages", () => {
    expect(parseStageMessage(null)).toBeNull();
    expect(parseStageMessage("project")).toBeNull();
    expect(parseStageMessage([])).toBeNull();
    expect(parseStageMessage({ type: 7 })).toBeNull();
    expect(parseStageMessage({ type: "explode" })).toBeNull();
    expect(parseStageMessage({ type: "fullscreen" })).toEqual({ type: "fullscreen" });
    expect(parseStageMessage({ type: "close" })).toEqual({ type: "close" });
  });
});

describe("LED 安全模式 on the wire", () => {
  it("repairs a project's output safety settings and reads the pong's limiter report", () => {
    const project = { id: "p", meta: { title: "歌" }, output: { width: 1920, height: 1080, preset: "1080p", lyricSafe: {}, safety: { enabled: "yes", brightness: 7 } } };
    const msg = parseStageMessage({ type: "project", project });
    expect(msg?.type === "project" && msg.project.output.safety).toMatchObject({ enabled: true, brightness: 1 });
    const old = parseStageMessage({ type: "project", project: { ...project, output: { width: 1920, height: 1080, preset: "1080p", lyricSafe: {} } } });
    expect(old?.type === "project" && old.project.output.safety.enabled).toBe(true);
    const pong = parseStageMessage({ type: "pong", outputId: "o", at: 1, width: 1, height: 1, fullscreen: false, limiter: { on: true, damping: true, engaged: 2.7 } });
    expect(pong).toMatchObject({ limiter: { on: true, damping: true, engaged: 2 } });
    const oldPong = parseStageMessage({ type: "pong", outputId: "o", at: 1, width: 1, height: 1, fullscreen: false });
    expect(oldPong && "limiter" in oldPong).toBe(false);
  });
});

describe("the 排版 editor's plan message (字體藝術)", () => {
  const plan = { version: 1, keyVisual: { title: "t" }, sections: [], lines: [], cues: [], designerNotes: "" };
  it("carries the project id and the plan, stamped by its sender", () => {
    expect(parseStageMessage({ type: "plan", projectId: "p1", plan, sender: "ed1" })).toEqual({ type: "plan", projectId: "p1", plan, sender: "ed1" });
  });
  it("drops a plan message without a usable plan or project id", () => {
    expect(parseStageMessage({ type: "plan", projectId: "p1" })).toBeNull();
    expect(parseStageMessage({ type: "plan", projectId: "", plan })).toBeNull();
    expect(parseStageMessage({ type: "plan", projectId: "p1", plan: { sections: "x" } })).toBeNull();
  });
});

describe("a key pressed in the projection window", () => {
  const key = { key: "PageDown", code: "PageDown", shiftKey: false, repeat: false };
  it("parses the key and nothing else", () => {
    expect(parseStageMessage({ type: "key", outputId: "o", id: "k1", key: { ...key, extra: "x" } })).toEqual({ type: "key", outputId: "o", id: "k1", key });
    expect(parseStageMessage({ type: "key", outputId: "o", id: "k1", key: { key: "b", code: "KeyB", shiftKey: "yes" } })).toEqual({
      type: "key",
      outputId: "o",
      id: "k1",
      key: { key: "b", code: "KeyB", shiftKey: false, repeat: false },
    });
  });
  it("drops malformed keys", () => {
    expect(parseStageMessage({ type: "key", outputId: "o", id: "", key })).toBeNull();
    expect(parseStageMessage({ type: "key", id: "k", key })).toBeNull();
    expect(parseStageMessage({ type: "key", outputId: "o", id: "k", key: { key: 1, code: "KeyB" } })).toBeNull();
    expect(parseStageMessage({ type: "key", outputId: "o", id: "k", key: { key: "x".repeat(40), code: "KeyB" } })).toBeNull();
  });
});
