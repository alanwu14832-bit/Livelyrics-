// Test helpers for 免費研究: a fake fetch that serves the real MusicBrainz / Wikipedia responses saved
// in fixtures/research/ (or fails like an unreachable network), and PublicInfo builders for the
// genre rules. Nothing here reaches the network.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { FetchLike } from "@/lib/server/research/http";
import type { PublicInfo, WikiPage } from "@/lib/types";

const FIX = path.resolve(__dirname, "../../../../../fixtures/research");
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(FIX, name), "utf8"));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export interface FakeFetch {
  fn: FetchLike;
  calls: string[];
}

/** 〈大風吹〉 by 草東沒有派對: MusicBrainz (recording + artist) and zh.wikipedia (artist + song). */
export function caodongFetch(): FakeFetch {
  const calls: string[] = [];
  const fn: FetchLike = async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.hostname === "musicbrainz.org") {
      if (url.pathname.endsWith("/recording")) return json(fixture("musicbrainz-recording-caodong.json"));
      if (url.pathname.includes("/artist/1636f82a")) return json(fixture("musicbrainz-artist-caodong.json"));
      return json({ artists: [] });
    }
    if (url.hostname === "zh.wikipedia.org") {
      if (url.pathname.includes("/search/page")) return json(fixture("wikipedia-zh-search-caodong.json"));
      const title = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (title === "草東沒有派對") return json(fixture("wikipedia-zh-summary-caodong.json"));
      if (title === "大風吹_(歌曲)") return json(fixture("wikipedia-zh-summary-song-caodong.json"));
    }
    return new Response("not found", { status: 404 });
  };
  return { fn, calls };
}

/** Every request fails like an unreachable network. */
export function downFetch(): FakeFetch {
  const calls: string[] = [];
  const fn: FetchLike = async (input) => {
    calls.push(String(input));
    throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
  };
  return { fn, calls };
}

/** Lookup options for tests: no MusicBrainz spacing, a short budget, sources on. */
export const TEST_LOOKUP = { env: { LIVELYRICS_FREE_SOURCES: "on" }, musicbrainzGapMs: 0, budgetMs: 2000 } as const;

/** Public facts naming a genre, the way MusicBrainz / Wikipedia would. */
export function publicInfoWith(opts: { title?: string; artist?: string; genres?: string[]; tags?: string[]; wiki?: Partial<WikiPage> & { extract: string } } = {}): PublicInfo {
  const title = opts.title ?? "示範之歌";
  const artist = opts.artist ?? "Livelyrics Band";
  return {
    version: 1,
    query: { title, artist },
    fetchedAt: "2026-09-01T00:00:00.000Z",
    musicbrainz:
      opts.genres || opts.tags
        ? {
            recording: null,
            artist: {
              id: "00000000-0000-4000-8000-000000000001",
              name: artist,
              genres: (opts.genres ?? []).map((name) => ({ name, count: 3 })),
              tags: (opts.tags ?? []).map((name) => ({ name, count: 2 })),
              links: [],
            },
          }
        : null,
    wikipedia: opts.wiki ? { artist: { lang: "zh", title: artist, url: "https://zh.wikipedia.org/wiki/x", ...opts.wiki }, song: null } : null,
    status: { musicbrainz: opts.genres || opts.tags ? "ok" : "none", wikipedia: opts.wiki ? "ok" : "none" },
    notes: [],
  };
}
