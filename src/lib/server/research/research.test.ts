// The free public sources (免費研究) against real responses saved in fixtures/research/ (fetched once
// from MusicBrainz and Wikipedia with the app's User-Agent). Nothing here reaches the network: every
// lookup gets a fake fetch that serves those files.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getJson, RateGate, RESEARCH_USER_AGENT, sourceConfig, type FetchLike } from "./http";
import { artistLookupUrl, lookupMusicBrainz, namesMatch, parseArtistLookup, parseArtistSearch, parseRecordingSearch, pickArtist, pickRecording, recordingInfo, recordingSearchUrl } from "./musicbrainz";
import { coercePublicInfo, isFreshPublicInfo, lookupPublicInfo } from "./public-info";
import { looksMusical, lookupWikipedia, parseSearch, parseSummary, pickArtistHit, pickSongHit, summaryUrl } from "./wikipedia";

const FIX = path.resolve(__dirname, "../../../../fixtures/research");
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(FIX, name), "utf8"));
const text = (name: string): string => readFileSync(path.join(FIX, name), "utf8");

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

interface Call {
  url: string;
  headers: Headers;
}

/** A fake fetch serving the fixtures by URL, recording every call. */
function fakeFetch(route: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn: FetchLike = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return route(new URL(String(input)));
  };
  return { fn, calls };
}

const MB = "https://musicbrainz.org/ws/2";
const WP = "https://{lang}.wikipedia.org";

function caodongRoute(url: URL): Response {
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
}

describe("MusicBrainz parsers (real responses)", () => {
  it("finds 〈大風吹〉 by 草東沒有派對 with its year, album and artist", () => {
    const cands = parseRecordingSearch(fixture("musicbrainz-recording-caodong.json"));
    expect(cands).toHaveLength(1);
    const picked = pickRecording(cands, "大風吹", "草東沒有派對");
    expect(picked?.artist.id).toBe("1636f82a-b541-4867-9eb7-e4b224552eef");
    const info = recordingInfo(picked!.recording);
    expect(info).toMatchObject({ title: "大風吹", firstReleaseDate: "2016-02-19", year: 2016, releaseGroup: { title: "醜奴兒", type: "Album" } });
    // the English credit and the simplified alias name the same band
    expect(pickRecording(cands, "大風吹", "No Party For Cao Dong")?.artist.name).toBe("草東沒有派對");
    expect(pickRecording(cands, "大风吹", "草东没有派对")).not.toBeNull();
    // another band's song of the same name is not this one
    expect(pickRecording(cands, "大風吹", "另一個樂團")).toBeNull();
  });

  it("prefers the studio recording over live takes and keeps its tags", () => {
    const cands = parseRecordingSearch(fixture("musicbrainz-recording-explosions.json"));
    expect(cands.length).toBeGreaterThan(3);
    const picked = pickRecording(cands, "Your Hand in Mine", "Explosions in the Sky")!;
    expect(picked.recording.firstReleaseDate).toBe("2003-11-03");
    expect(picked.recording.disambiguation).not.toMatch(/live/i);
    expect(picked.recording.tags).toEqual([{ name: "post rock", count: 2 }]);
    expect(recordingInfo(picked.recording).releaseGroup?.title).toBe("The Earth Is Not a Cold Dead Place");
  });

  it("reads the artist lookup: type, country, area, genres and useful links", () => {
    const cao = parseArtistLookup(fixture("musicbrainz-artist-caodong.json"))!;
    expect(cao).toMatchObject({ name: "草東沒有派對", type: "Group", country: "TW", area: "Taipei", genres: [{ name: "indie rock", count: 1 }] });
    expect(cao.links.map((l) => l.type)).toEqual(["youtube", "social network", "free streaming"]);
    const eits = parseArtistLookup(fixture("musicbrainz-artist-explosions.json"))!;
    expect(eits.genres.map((g) => g.name)).toEqual(["post-rock", "instrumental", "ambient"]);
    expect(eits).toMatchObject({ type: "Group", country: "US", area: "Austin", beginYear: 1999, disambiguation: "Texas post-rock" });
    expect(eits.links[0]).toEqual({ type: "official homepage", url: "https://explosionsinthesky.com/" });
    expect(eits.links.map((l) => l.type)).toContain("setlistfm");
    expect(eits.links.length).toBeLessThanOrEqual(6);
  });

  it("reads an artist search and ignores names that only look alike", () => {
    const cands = parseArtistSearch(fixture("musicbrainz-artist-search-explosions.json"));
    expect(pickArtist(cands, "explosions in the sky")?.tags[0]).toEqual({ name: "post-rock", count: 12 });
    expect(pickArtist(cands, "Explosions")).toBeNull();
    expect(parseArtistSearch(fixture("musicbrainz-artist-search-empty.json"))).toEqual([]);
    expect(parseRecordingSearch(fixture("musicbrainz-recording-empty.json"))).toEqual([]);
    expect(parseRecordingSearch("garbage")).toEqual([]);
    expect(parseArtistLookup({ id: "" })).toBeNull();
  });

  it("matches names across scripts and spacing, never short fragments", () => {
    expect(namesMatch("草東沒有派對", "草东没有派对")).toBe(true);
    expect(namesMatch("Explosions in the Sky", "explosions  in the sky!")).toBe(true);
    expect(namesMatch("五月天", "五月天 Mayday")).toBe(false);
    expect(namesMatch("AB", "ABBA")).toBe(false);
  });
});

describe("Wikipedia parsers (real responses)", () => {
  it("reads a zh summary in the Taiwan variant", () => {
    const r = parseSummary(fixture("wikipedia-zh-summary-caodong.json"), "zh");
    expect(r.kind).toBe("page");
    if (r.kind !== "page") return;
    expect(r.page).toMatchObject({ lang: "zh", title: "草東沒有派對", description: "搖滾樂團" });
    expect(r.page.extract).toContain("獨立搖滾樂團");
    expect(r.page.url).toBe("https://zh.wikipedia.org/wiki/%E8%8D%89%E6%9D%B1%E6%B2%92%E6%9C%89%E6%B4%BE%E5%B0%8D");
    expect(looksMusical(r.page)).toBe(true);
    // a page written in simplified characters comes back converted
    const v = parseSummary(fixture("wikipedia-zh-summary-variant.json"), "zh");
    expect(v.kind === "page" && v.page.title).toBe("逃跑計劃");
    expect(v.kind === "page" && v.page.extract).toContain("中國流行搖滾樂隊");
  });

  it("picks the artist and the song from one search", () => {
    const hits = parseSearch(fixture("wikipedia-zh-search-caodong.json"));
    expect(hits.map((h) => h.key)).toContain("大風吹_(歌曲)");
    expect(hits[0].excerpt).not.toMatch(/<span/);
    expect(pickArtistHit(hits, "草東沒有派對")?.key).toBe("草東沒有派對");
    expect(pickSongHit(hits, "大風吹", "草東沒有派對")?.key).toBe("大風吹_(歌曲)");
    expect(pickSongHit(hits, "大風吹", "別的樂團")).toBeNull();
    const en = parseSummary(fixture("wikipedia-en-summary-explosions.json"), "en");
    expect(en.kind === "page" && en.page.description).toBe("American post-rock band");
    expect(parseSummary({ type: "disambiguation", title: "x" }, "zh").kind).toBe("disambiguation");
    expect(summaryUrl(WP, "zh", "大風吹 (歌曲)")).toBe("https://zh.wikipedia.org/api/rest_v1/page/summary/%E5%A4%A7%E9%A2%A8%E5%90%B9_(%E6%AD%8C%E6%9B%B2)");
  });
});

describe("lookups with a fake network", () => {
  it("MusicBrainz: a recording search, then the artist lookup, with the User-Agent", async () => {
    const f = fakeFetch(caodongRoute);
    const r = await lookupMusicBrainz({ title: "大風吹", artist: "草東沒有派對" }, { fetch: f.fn, base: MB, gate: new RateGate(0) });
    expect(r.status).toBe("ok");
    expect(r.recording?.year).toBe(2016);
    expect(r.artist?.genres[0].name).toBe("indie rock");
    expect(f.calls.map((c) => c.url)).toEqual([recordingSearchUrl(MB, "大風吹", "草東沒有派對"), artistLookupUrl(MB, "1636f82a-b541-4867-9eb7-e4b224552eef")]);
    expect(f.calls[0].url).toContain("fmt=json");
    for (const c of f.calls) expect(c.headers.get("user-agent")).toBe(RESEARCH_USER_AGENT);
    expect(RESEARCH_USER_AGENT).toMatch(/^Livelyrics\/0\.1 \(contact: https:\/\/github\.com\//);
  });

  it("MusicBrainz: an unknown song falls back to the artist search; an unknown band is 'none'", async () => {
    const f = fakeFetch((url) => {
      if (url.pathname.endsWith("/recording")) return json(fixture("musicbrainz-recording-empty.json"));
      if (url.pathname.endsWith("/artist")) return json(fixture("musicbrainz-artist-search-explosions.json"));
      if (url.pathname.includes("/artist/4236acde")) return json(fixture("musicbrainz-artist-explosions.json"));
      return new Response("", { status: 404 });
    });
    const r = await lookupMusicBrainz({ title: "新歌", artist: "Explosions in the Sky" }, { fetch: f.fn, base: MB, gate: new RateGate(0) });
    expect(r.status).toBe("ok");
    expect(r.recording).toBeNull();
    expect(r.artist?.name).toBe("Explosions in the Sky");
    expect(f.calls).toHaveLength(3);
    const none = await lookupMusicBrainz({ title: "示範之歌", artist: "Livelyrics Band" }, { fetch: fakeFetch((url) => json(fixture(url.pathname.endsWith("/recording") ? "musicbrainz-recording-empty.json" : "musicbrainz-artist-search-empty.json"))).fn, base: MB, gate: new RateGate(0) });
    expect(none).toMatchObject({ status: "none", recording: null, artist: null });
  });

  it("MusicBrainz requests are at least the gap apart", async () => {
    const gate = new RateGate(40);
    const t0 = Date.now();
    const stamps: number[] = [];
    await Promise.all([0, 1, 2].map(() => gate.wait().then(() => stamps.push(Date.now() - t0))));
    stamps.sort((a, b) => a - b);
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(35);
    expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(35);
  });

  it("Wikipedia: zh first with Accept-Language zh-TW; the artist and the song", async () => {
    const f = fakeFetch(caodongRoute);
    const r = await lookupWikipedia({ title: "大風吹", artist: "草東沒有派對" }, { fetch: f.fn, base: WP });
    expect(r.status).toBe("ok");
    expect(r.artist?.title).toBe("草東沒有派對");
    expect(r.song?.title).toBe("大風吹 (歌曲)");
    expect(r.song?.extract).toContain("音樂錄影帶");
    expect(f.calls.every((c) => new URL(c.url).hostname === "zh.wikipedia.org")).toBe(true);
    expect(f.calls.every((c) => c.headers.get("accept-language") === "zh-TW")).toBe(true);
  });

  it("Wikipedia: falls back to English, survives a 429, rejects a non-musician page", async () => {
    const f = fakeFetch((url) => {
      if (url.hostname === "zh.wikipedia.org") return new Response(text("wikipedia-429.txt"), { status: 429 });
      if (url.pathname.includes("/search/page")) return json({ pages: [{ id: 1, key: "Explosions_in_the_Sky", title: "Explosions in the Sky", description: "American post-rock band", excerpt: "" }] });
      if (url.pathname.endsWith("/Explosions_in_the_Sky")) return json(fixture("wikipedia-en-summary-explosions.json"));
      return new Response("", { status: 404 });
    });
    const r = await lookupWikipedia({ title: "Your Hand in Mine", artist: "Explosions in the Sky" }, { fetch: f.fn, base: WP });
    expect(r.status).toBe("ok");
    expect(r.artist?.lang).toBe("en");
    expect(r.notes.join()).toContain("429");
    const person = fakeFetch((url) =>
      url.pathname.includes("/search/page") ? json({ pages: [] }) : json({ type: "standard", title: "Rain", extract: "Rain is water droplets that have condensed from atmospheric water vapor.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Rain" } } }),
    );
    expect((await lookupWikipedia({ title: "x", artist: "Rain" }, { fetch: person.fn, base: WP })).status).toBe("none");
  });

  it("lookupPublicInfo: both sources in parallel, summarised as they finish", async () => {
    const f = fakeFetch(caodongRoute);
    const events: string[] = [];
    const info = await lookupPublicInfo(
      { title: "大風吹", artist: "草東沒有派對" },
      { fetch: f.fn, musicbrainzGate: new RateGate(0), now: () => new Date("2026-09-29T00:00:00Z"), env: {}, onEvent: (e) => events.push(`${e.kind}:${e.source}`) },
    );
    expect(info.status).toEqual({ musicbrainz: "ok", wikipedia: "ok" });
    expect(info.musicbrainz?.artist?.country).toBe("TW");
    expect(info.wikipedia?.song?.title).toBe("大風吹 (歌曲)");
    expect(info.fetchedAt).toBe("2026-09-29T00:00:00.000Z");
    expect(events.slice(0, 2)).toEqual(["start:musicbrainz", "start:wikipedia"]);
    expect(events.filter((e) => e.startsWith("done"))).toHaveLength(2);
    // stored and read back, it is the same lookup, and fresh for the same names only
    const back = coercePublicInfo(JSON.parse(JSON.stringify(info)));
    expect(back).toEqual(info);
    expect(isFreshPublicInfo(back, { title: "大風吹", artist: "草東沒有派對" }, new Date("2026-10-01T00:00:00Z"))).toBe(true);
    expect(isFreshPublicInfo(back, { title: "大風吹", artist: "草东没有派对" }, new Date("2026-10-01T00:00:00Z"))).toBe(true);
    expect(isFreshPublicInfo(back, { title: "山海", artist: "草東沒有派對" }, new Date("2026-10-01T00:00:00Z"))).toBe(false);
    expect(isFreshPublicInfo(back, { title: "大風吹", artist: "草東沒有派對" }, new Date("2027-01-01T00:00:00Z"))).toBe(false);
    expect(coercePublicInfo({ nope: 1 })).toBeNull();
  });

  it("lookupPublicInfo: unreachable, too slow, switched off, or without an artist", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:9") });
    };
    const failed = await lookupPublicInfo({ title: "大風吹", artist: "草東沒有派對" }, { fetch: down, musicbrainzGate: new RateGate(0), env: {} });
    expect(failed.status).toEqual({ musicbrainz: "failed", wikipedia: "failed" });
    expect(failed.notes.join()).toContain("ECONNREFUSED");
    expect(isFreshPublicInfo(failed, { title: "大風吹", artist: "草東沒有派對" })).toBe(false);

    const hang: FetchLike = (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const t0 = Date.now();
    const slow = await lookupPublicInfo({ title: "大風吹", artist: "草東沒有派對" }, { fetch: hang, budgetMs: 80, musicbrainzGate: new RateGate(0), env: {} });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(slow.status.musicbrainz).toBe("failed");
    expect(slow.notes[0]).toMatch(/超過/);

    const off = await lookupPublicInfo({ title: "大風吹", artist: "草東沒有派對" }, { fetch: down, env: { LIVELYRICS_FREE_SOURCES: "off" } });
    expect(off.status).toEqual({ musicbrainz: "skipped", wikipedia: "skipped" });
    const noArtist = await lookupPublicInfo({ title: "大風吹", artist: "" }, { fetch: down, env: {} });
    expect(noArtist.notes[0]).toContain("沒有樂團名稱");
  });

  it("getJson never throws and names the failure", async () => {
    expect(await getJson("https://x.test/a", { fetch: async () => new Response("{bad", { status: 200 }) })).toMatchObject({ ok: false, error: expect.stringContaining("無法解析") });
    expect(await getJson("https://x.test/a", { fetch: async () => new Response("", { status: 503 }) })).toMatchObject({ ok: false, status: 503 });
    expect(sourceConfig({ LIVELYRICS_MUSICBRAINZ_URL: "http://127.0.0.1:3199/mb/ws/2/", LIVELYRICS_WIKIPEDIA_URL: "http://127.0.0.1:3199/wp/{lang}" })).toEqual({
      enabled: true,
      musicbrainzUrl: "http://127.0.0.1:3199/mb/ws/2",
      wikipediaUrl: "http://127.0.0.1:3199/wp/{lang}",
    });
    expect(sourceConfig({}).musicbrainzUrl).toBe("https://musicbrainz.org/ws/2");
  });
});
