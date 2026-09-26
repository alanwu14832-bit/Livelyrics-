import { describe, expect, it } from "vitest";
import { DEFAULT_OVERRIDES } from "@/lib/stage/protocol";
import { loadSession, parseOverrides, parseSession, saveSession } from "./session";

describe("console session", () => {
  it("round-trips overrides and audio time", () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    const session = { overrides: { ...DEFAULT_OVERRIDES, blackout: true, scene: "tunnel" as const, intensity: 0.7 }, audioTime: 42.5 };
    saveSession("p", session, store);
    expect(loadSession("p", store)).toEqual(session);
    expect(loadSession("other", store)).toBeNull();
  });

  it("sanitizes stored overrides", () => {
    expect(parseOverrides({ blackout: "yes", scene: "lasers", lyricStyle: "karaoke", intensity: 9, lyricScale: -1 })).toEqual({
      ...DEFAULT_OVERRIDES,
      lyricStyle: "karaoke",
      intensity: 1.5,
      lyricScale: 0.5,
    });
    expect(parseOverrides(null)).toEqual(DEFAULT_OVERRIDES);
  });

  it("rejects garbage", () => {
    expect(parseSession("{nope")).toBeNull();
    expect(parseSession("[]")).toBeNull();
    expect(parseSession(null)).toBeNull();
    expect(parseSession(JSON.stringify({ audioTime: "x" }))).toEqual({ overrides: DEFAULT_OVERRIDES, audioTime: 0 });
    expect(loadSession("p", null)).toBeNull();
  });
});
