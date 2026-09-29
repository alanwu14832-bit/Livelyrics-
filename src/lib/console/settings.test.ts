import { describe, expect, it } from "vitest";
import { clampOffset, defaultSettings, hasStoredSettings, loadPreferredMode, loadSettings, parseSettings, PREFERRED_MODE_KEY, savePreferredMode, saveSettings, settingsKey } from "./settings";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe("console settings", () => {
  it("round-trips through storage", () => {
    const store = memoryStorage();
    const s = { ...defaultSettings(), mode: "live" as const, offset: 0.25, volume: 0.5, muted: true, micDeviceId: "abc", playbackRate: 0.75, sync: { source: "ltc" as const, ltcDeviceId: "dev1", freewheelSeconds: 3.5 } };
    saveSettings("p1", s, store);
    expect(store.map.has(settingsKey("p1"))).toBe(true);
    expect(loadSettings("p1", defaultSettings(), store)).toEqual(s);
    expect(hasStoredSettings("p1", store)).toBe(true);
    expect(hasStoredSettings("p2", store)).toBe(false);
  });

  it("falls back to defaults for garbage", () => {
    const d = defaultSettings("live");
    expect(parseSettings(null, d)).toEqual(d);
    expect(parseSettings("{not json", d)).toEqual(d);
    expect(parseSettings("[1,2]", d)).toEqual(d);
    expect(parseSettings(JSON.stringify({ mode: "karaoke", offset: "x", volume: 7, playbackRate: 3 }), d)).toEqual({
      ...d,
      volume: 1,
    });
  });

  it("keeps the sync settings per song, repaired", () => {
    const d = defaultSettings();
    expect(d.sync).toEqual({ source: "manual", ltcDeviceId: "", freewheelSeconds: 2 });
    expect(parseSettings(JSON.stringify({ sync: { source: "mtc", freewheelSeconds: 99, ltcDeviceId: 5 } }), d).sync).toEqual({ source: "mtc", ltcDeviceId: "", freewheelSeconds: 10 });
    expect(parseSettings(JSON.stringify({ sync: { source: "osc" } }), d).sync.source).toBe("manual");
    // older settings without sync: manual
    expect(parseSettings(JSON.stringify({ offset: 0.1 }), d).sync.source).toBe("manual");
  });

  it("clamps offsets and snaps them to milliseconds", () => {
    expect(clampOffset(0.1 + 0.2)).toBe(0.3);
    expect(clampOffset(99)).toBe(10);
    expect(clampOffset(-99)).toBe(-10);
    expect(clampOffset(Number.NaN)).toBe(0);
  });

  it("survives a throwing storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSettings("p", defaultSettings(), broken)).toEqual(defaultSettings());
    expect(() => saveSettings("p", defaultSettings(), broken)).not.toThrow();
    expect(hasStoredSettings("p", broken)).toBe(false);
    expect(loadSettings("p", defaultSettings(), null)).toEqual(defaultSettings());
  });
});

describe("preferred mode (手動切換 across songs)", () => {
  it("remembers the last mode chosen by hand and ignores junk", () => {
    const store = memoryStorage();
    expect(loadPreferredMode(store)).toBeNull();
    savePreferredMode("live", store);
    expect(loadPreferredMode(store)).toBe("live");
    store.setItem(PREFERRED_MODE_KEY, "karaoke");
    expect(loadPreferredMode(store)).toBeNull();
    expect(loadPreferredMode(null)).toBeNull();
  });
});
