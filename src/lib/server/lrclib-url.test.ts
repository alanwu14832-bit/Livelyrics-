import { afterEach, describe, expect, it, vi } from "vitest";
import { lrclibBase, searchLyrics } from "./lrclib";

describe("round 20 · LIVELYRICS_LRCLIB_URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("points the client at another base (the e2e stub), else lrclib.net", () => {
    expect(lrclibBase({})).toBe("https://lrclib.net/api");
    expect(lrclibBase({ LIVELYRICS_LRCLIB_URL: "http://127.0.0.1:3428/lrclib/api/" })).toBe("http://127.0.0.1:3428/lrclib/api");
    expect(lrclibBase({ LIVELYRICS_LRCLIB_URL: "not a url" })).toBe("https://lrclib.net/api");
  });

  it("every request goes to the override", async () => {
    vi.stubEnv("LIVELYRICS_LRCLIB_URL", "http://127.0.0.1:3428/lrclib/api");
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      return Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    });
    await searchLyrics({ title: "大風吹", artist: "草東沒有派對" });
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith("http://127.0.0.1:3428/lrclib/api/")).toBe(true);
  });
});
