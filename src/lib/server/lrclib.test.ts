import { afterEach, describe, expect, it, vi } from "vitest";
import type { LyricsSearchResult } from "@/lib/api-client";
import { cleanTitle, findBestLyrics, getLyrics, LrclibError, rankResults, searchLyrics } from "./lrclib";

interface Rec {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const SYNCED = "[00:10.00]第一句\n[00:14.00]第二句\n[00:18.00]第三句";
const PLAIN = "第一句\n第二句\n第三句";

function rec(r: Partial<Rec> & { id: number }): Rec {
  return {
    trackName: "愛人錯過",
    artistName: "告五人",
    albumName: "album",
    duration: 292,
    instrumental: false,
    plainLyrics: PLAIN,
    syncedLyrics: SYNCED,
    ...r,
  };
}

type Route = (url: URL) => { status: number; body?: unknown } | Promise<never>;

function mockFetch(route: Route) {
  const calls: URL[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    expect(new Headers(init?.headers).get("user-agent")).toContain("Livelyrics/0.1");
    const r = await route(url);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rankResults", () => {
  const r = (id: number, synced: boolean, duration: number): LyricsSearchResult => ({
    id,
    trackName: "t",
    artistName: "a",
    albumName: "",
    duration,
    synced,
    lyrics: { source: synced ? "lrclib-synced" : "lrclib-plain", synced, lines: [] },
  });

  it("puts synced near-duration first, then by duration difference", () => {
    const ranked = rankResults([r(1, false, 200), r(2, true, 260), r(3, true, 201), r(4, false, 230), r(5, true, 199.5)], 200);
    expect(ranked.map((x) => x.id)).toEqual([5, 3, 1, 2, 4]);
  });

  it("keeps LRCLIB order among equals when duration is unknown", () => {
    expect(rankResults([r(1, false, 10), r(2, true, 300), r(3, true, 20)]).map((x) => x.id)).toEqual([2, 3, 1]);
  });
});

describe("searchLyrics", () => {
  it("maps results, parses lyrics and excludes instrumentals", async () => {
    const calls = mockFetch((url) => {
      expect(url.pathname).toBe("/api/search");
      return {
        status: 200,
        body: [
          rec({ id: 1, syncedLyrics: null, duration: 292 }),
          rec({ id: 2, duration: 318 }),
          rec({ id: 3, instrumental: true, plainLyrics: null, syncedLyrics: null }),
          rec({ id: 4, duration: 292.5 }),
          { bogus: true },
        ],
      };
    });
    const results = await searchLyrics({ title: "愛人錯過", artist: "告五人", duration: 292 });
    expect(calls[0].searchParams.get("track_name")).toBe("愛人錯過");
    expect(calls[0].searchParams.get("artist_name")).toBe("告五人");
    expect(results.map((x) => x.id)).toEqual([4, 1, 2]);
    expect(results[0].synced).toBe(true);
    expect(results[0].lyrics.source).toBe("lrclib-synced");
    expect(results[0].lyrics.lines[0]).toMatchObject({ id: "l0", text: "第一句", start: 10 });
    expect(results[1].synced).toBe(false);
    expect(results[1].lyrics.lines.every((l) => l.start === null)).toBe(true);
  });

  it("retries with a cleaned title and then a free-text query", async () => {
    const calls = mockFetch((url) => {
      if (url.searchParams.get("q")) return { status: 200, body: [rec({ id: 9 })] };
      return { status: 200, body: [] };
    });
    const results = await searchLyrics({ title: "愛人錯過 (Live)", artist: "告五人" });
    expect(calls.map((c) => c.searchParams.get("track_name") ?? c.searchParams.get("q"))).toEqual(["愛人錯過 (Live)", "愛人錯過", "告五人 愛人錯過"]);
    expect(results.map((x) => x.id)).toEqual([9]);
  });

  it("wraps HTTP and network failures in LrclibError", async () => {
    mockFetch(() => ({ status: 500, body: { message: "oops" } }));
    await expect(searchLyrics({ title: "x" })).rejects.toBeInstanceOf(LrclibError);
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    await expect(searchLyrics({ title: "x" })).rejects.toThrow(/無法連線到 LRCLIB/);
  });

  it("empty title returns nothing without a request", async () => {
    const calls = mockFetch(() => ({ status: 200, body: [] }));
    expect(await searchLyrics({ title: "  " })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("getLyrics", () => {
  it("uses /api/get with a rounded duration and maps 404 to null", async () => {
    const calls = mockFetch((url) => (url.searchParams.get("track_name") === "none" ? { status: 404, body: { name: "TrackNotFound" } } : { status: 200, body: rec({ id: 7 }) }));
    const found = await getLyrics({ title: "愛人錯過", artist: "告五人", album: "A", duration: 291.6 });
    expect(found?.id).toBe(7);
    expect(calls[0].pathname).toBe("/api/get");
    expect(calls[0].searchParams.get("duration")).toBe("292");
    expect(calls[0].searchParams.get("album_name")).toBe("A");
    expect(await getLyrics({ title: "none", artist: "x", duration: 10 })).toBeNull();
  });
});

describe("findBestLyrics", () => {
  const meta = { title: "愛人錯過", artist: "告五人", duration: 292 };

  it("prefers the exact /get match with synced lyrics", async () => {
    mockFetch((url) => (url.pathname === "/api/get" ? { status: 200, body: rec({ id: 1 }) } : { status: 200, body: [rec({ id: 2 })] }));
    const best = await findBestLyrics(meta);
    expect(best?.kind).toBe("synced");
    if (best?.kind === "synced") {
      expect(best.result.id).toBe(1);
      expect(best.lyrics.synced).toBe(true);
    }
  });

  it("uses only the text when synced timings belong to a different length", async () => {
    const logs: string[] = [];
    mockFetch((url) => (url.pathname === "/api/get" ? { status: 404 } : { status: 200, body: [rec({ id: 3, duration: 350 })] }));
    const best = await findBestLyrics(meta, { onLog: (m) => logs.push(m) });
    expect(best?.kind).toBe("plain");
    if (best?.kind === "plain") {
      expect(best.lyrics.synced).toBe(false);
      expect(best.lyrics.source).toBe("lrclib-plain");
      expect(best.result.synced).toBe(false);
    }
    expect(logs.join()).toMatch(/長度/);
  });

  it("accepts a synced near match even with a different script (繁/簡)", async () => {
    mockFetch((url) => (url.pathname === "/api/get" ? { status: 404 } : { status: 200, body: [rec({ id: 4, trackName: "爱人错过", duration: 293 })] }));
    const best = await findBestLyrics(meta);
    expect(best?.kind).toBe("synced");
  });

  it("rejects unrelated songs", async () => {
    mockFetch((url) =>
      url.pathname === "/api/get" ? { status: 404 } : { status: 200, body: [rec({ id: 5, trackName: "別的歌", artistName: "別人", duration: 180 })] },
    );
    expect(await findBestLyrics(meta)).toBeNull();
  });

  it("reports instrumental tracks", async () => {
    mockFetch((url) =>
      url.pathname === "/api/get"
        ? { status: 200, body: rec({ id: 6, instrumental: true, plainLyrics: null, syncedLyrics: null }) }
        : { status: 200, body: [] },
    );
    expect((await findBestLyrics(meta))?.kind).toBe("instrumental");
  });

  it("without a duration only trusts synced lyrics when title and artist match", async () => {
    mockFetch(() => ({ status: 200, body: [rec({ id: 8, artistName: "someone else" }), rec({ id: 9 })] }));
    const best = await findBestLyrics({ ...meta, duration: 0 });
    expect(best?.kind).toBe("synced");
    if (best?.kind === "synced") expect(best.result.id).toBe(9);
  });

  it("falls back to search when /get fails, and throws when everything fails", async () => {
    const logs: string[] = [];
    mockFetch((url) => (url.pathname === "/api/get" ? { status: 503 } : { status: 200, body: [rec({ id: 10 })] }));
    expect((await findBestLyrics(meta, { onLog: (m) => logs.push(m) }))?.kind).toBe("synced");
    expect(logs[0]).toMatch(/精確查詢失敗/);
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    await expect(findBestLyrics(meta)).rejects.toBeInstanceOf(LrclibError);
  });

  it("returns null without a title", async () => {
    expect(await findBestLyrics({ title: "", artist: "a", duration: 1 })).toBeNull();
  });
});

describe("cleanTitle", () => {
  it("removes decorations", () => {
    expect(cleanTitle("愛人錯過 (Live)")).toBe("愛人錯過");
    expect(cleanTitle("【MV】Song - Remastered 2020")).toBe("Song");
    expect(cleanTitle("Song feat. Someone")).toBe("Song");
    expect(cleanTitle("Plain")).toBe("Plain");
  });
});
