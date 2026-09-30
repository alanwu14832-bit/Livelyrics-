import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractMoodStats } from "@/lib/moodboard";
import { collectedSummary, coerceCandidates, coerceCollected, mergeCollection } from "@/lib/visuals";
import type { CollectedVisual } from "@/lib/types";
import { decodeSample, imageSize, sniffImage } from "./image-decode";
import { checkUrl, isBlockedHostname, isPrivateAddress, isPrivateV4, isPrivateV6, safeGet, v6Groups, type RawResponse, type ResolvedAddress, type SafeNet } from "./safe-fetch";
import { collectVisuals, coverArtUrl, pageImage, parseCoverArt, planJobs, visualsConfig, youtubeId, youtubeStills } from "./visuals";

const FIX = path.resolve(__dirname, "../../../../fixtures/visuals");
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(FIX, name)));
const COVER_JPG = bytes("cover.jpg");
const COVER_PNG = bytes("cover.png");
const COVER_WEBP = bytes("cover.webp");
const STILL_JPG = bytes("still.jpg");
const SVG = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// ---------------------------------------------------------------------------
// a fake network: hosts → addresses, URLs → responses
// ---------------------------------------------------------------------------

interface Route {
  status?: number;
  type?: string;
  body?: Uint8Array | string;
  location?: string;
  length?: number;
}

function fakeNet(dns: Record<string, string[]>, routes: Record<string, Route>, trustedOrigins: string[] = []) {
  const requests: Array<{ url: string; addresses: ResolvedAddress[] }> = [];
  const lookups: string[] = [];
  const net: SafeNet = {
    trustedOrigins,
    async lookup(host) {
      lookups.push(host);
      const list = dns[host];
      if (!list) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
    async request(url, init) {
      requests.push({ url: url.href, addresses: init.addresses });
      const r = routes[url.href];
      if (!r) return response({ status: 404, type: "text/plain", body: "not found" });
      return response(r);
    },
  };
  return { net, requests, lookups };
}

function response(r: Route): RawResponse {
  const body = typeof r.body === "string" ? new TextEncoder().encode(r.body) : (r.body ?? new Uint8Array());
  const headers: Record<string, string> = {};
  if (r.type) headers["content-type"] = r.type;
  if (r.location) headers.location = r.location;
  headers["content-length"] = String(r.length ?? body.length);
  let destroyed = false;
  return {
    status: r.status ?? 200,
    header: (n) => headers[n.toLowerCase()] ?? null,
    body: (async function* () {
      // in chunks, so the streaming cap is exercised
      for (let i = 0; i < body.length && !destroyed; i += 4096) yield body.subarray(i, i + 4096);
    })(),
    destroy: () => {
      destroyed = true;
    },
  };
}

const PUBLIC = "93.184.216.34";

// ---------------------------------------------------------------------------

describe("addresses and URLs", () => {
  it("refuses private, loopback, link-local, CGNAT, multicast and documentation IPv4", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "127.8.9.10", "0.0.0.0", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.1.1", "192.0.2.5", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255", "240.1.2.3"]) {
      expect(isPrivateV4(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "192.169.0.1", "1.1.1.1"]) expect(isPrivateV4(ip), ip).toBe(false);
  });

  it("parses IPv6 forms and refuses loopback, ULA, link-local, mapped and embedded private IPv4", () => {
    expect(v6Groups("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(v6Groups("2001:db8::8:800:200c:417a")).toEqual([0x2001, 0xdb8, 0, 0, 0x8, 0x800, 0x200c, 0x417a]);
    expect(v6Groups("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
    for (const ip of ["::", "::1", "[::1]", "fe80::1%eth0", "fc00::1", "fd00:ec2::254", "fec0::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "::127.0.0.1", "64:ff9b::a9fe:a9fe", "2002:c0a8:0101::1", "2001::1", "2001:db8::1", "100::1"]) {
      expect(isPrivateV6(ip), ip).toBe(true);
    }
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:0808:0808::1"]) expect(isPrivateV6(ip), ip).toBe(false);
    expect(isPrivateAddress("not an ip")).toBe(true);
  });

  it("checks the URL itself before any lookup", () => {
    expect(checkUrl("https://coverartarchive.org/release-group/x").ok).toBe(true);
    const refused = (u: string) => {
      const r = checkUrl(u);
      return r.ok ? "ok" : r.error;
    };
    expect(refused("http://coverartarchive.org/x")).toMatch(/https/);
    expect(refused("https://user:pw@example.com/a.jpg")).toMatch(/帳號密碼/);
    expect(refused("https://example.com:8443/a.jpg")).toMatch(/443/);
    expect(refused("https://localhost/a.jpg")).toMatch(/內部/);
    expect(refused("https://metadata.google.internal/computeMetadata/v1/")).toMatch(/內部/);
    expect(refused("https://printer.local/a.jpg")).toMatch(/內部/);
    expect(refused("https://intranet/a.jpg")).toMatch(/內部/);
    expect(refused("https://127.0.0.1/a.jpg")).toMatch(/內部或保留/);
    expect(refused("https://[::1]/a.jpg")).toMatch(/內部或保留/);
    // the WHATWG parser turns decimal / hex / short IPv4 forms into dotted quads first
    expect(refused("https://2130706433/a.jpg")).toMatch(/內部或保留/);
    expect(refused("https://0x7f.1/a.jpg")).toMatch(/內部或保留/);
    expect(refused("https://169.254.169.254/latest/meta-data/")).toMatch(/內部或保留/);
    expect(refused("javascript:alert(1)")).toMatch(/https/);
    expect(isBlockedHostname("example.com")).toBe(false);
    // a configured test endpoint may be http and loopback, and only that origin
    expect(checkUrl("http://127.0.0.1:3199/coverart/x", ["http://127.0.0.1:3199"]).ok).toBe(true);
    expect(checkUrl("http://127.0.0.1:3200/x", ["http://127.0.0.1:3199"]).ok).toBe(false);
  });
});

describe("safeGet", () => {
  it("downloads an image over the checked, pinned addresses", async () => {
    const { net, requests } = fakeNet({ "img.example.com": [PUBLIC] }, { "https://img.example.com/a.jpg": { type: "image/jpeg", body: COVER_JPG } });
    const r = await safeGet("https://img.example.com/a.jpg", { accept: "image", maxBytes: 8 << 20, net });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes.length).toBe(COVER_JPG.length);
    expect(requests[0].addresses).toEqual([{ address: PUBLIC, family: 4 }]);
  });

  it("refuses a name whose answers include an internal address (rebinding-style), before connecting", async () => {
    const { net, requests } = fakeNet({ "rebind.example.com": [PUBLIC, "127.0.0.1"] }, { "https://rebind.example.com/a.jpg": { type: "image/jpeg", body: COVER_JPG } });
    const r = await safeGet("https://rebind.example.com/a.jpg", { accept: "image", maxBytes: 8 << 20, net });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/內部/);
    expect(requests).toHaveLength(0);
    const v6 = fakeNet({ "six.example.com": ["::ffff:10.1.2.3"] }, {});
    expect((await safeGet("https://six.example.com/a.jpg", { accept: "image", maxBytes: 1000, net: v6.net })).ok).toBe(false);
  });

  it("checks every redirect hop again (a public host redirecting to the metadata service or to a name inside)", async () => {
    const a = fakeNet({ "cdn.example.com": [PUBLIC] }, { "https://cdn.example.com/a.jpg": { status: 302, location: "http://169.254.169.254/latest/meta-data/" } });
    const r1 = await safeGet("https://cdn.example.com/a.jpg", { accept: "image", maxBytes: 1000, net: a.net });
    expect(r1.ok).toBe(false);
    const b = fakeNet(
      { "cdn.example.com": [PUBLIC], "inside.example.com": ["192.168.0.10"] },
      { "https://cdn.example.com/a.jpg": { status: 301, location: "https://inside.example.com/secret.jpg" } },
    );
    const r2 = await safeGet("https://cdn.example.com/a.jpg", { accept: "image", maxBytes: 1000, net: b.net });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/內部/);
    expect(b.requests.map((x) => x.url)).toEqual(["https://cdn.example.com/a.jpg"]);
  });

  it("follows at most 3 redirects (relative Location too)", async () => {
    const dns = { "r.example.com": [PUBLIC] };
    const ok = fakeNet(dns, {
      "https://r.example.com/1": { status: 302, location: "/2" },
      "https://r.example.com/2": { status: 302, location: "https://r.example.com/3" },
      "https://r.example.com/3": { status: 307, location: "4" },
      "https://r.example.com/4": { type: "image/png", body: COVER_PNG },
    });
    const r = await safeGet("https://r.example.com/1", { accept: "image", maxBytes: 1 << 20, net: ok.net });
    expect(r.ok && r.redirects).toBe(3);
    const tooMany = fakeNet(dns, {
      "https://r.example.com/1": { status: 302, location: "/2" },
      "https://r.example.com/2": { status: 302, location: "/3" },
      "https://r.example.com/3": { status: 302, location: "/4" },
      "https://r.example.com/4": { status: 302, location: "/5" },
      "https://r.example.com/5": { type: "image/png", body: COVER_PNG },
    });
    const r2 = await safeGet("https://r.example.com/1", { accept: "image", maxBytes: 1 << 20, net: tooMany.net });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/3 次/);
  });

  it("requires an image content type (never SVG) and caps the size, declared or streamed", async () => {
    const dns = { "x.example.com": [PUBLIC] };
    const { net } = fakeNet(dns, {
      "https://x.example.com/page": { type: "text/html", body: "<html></html>" },
      "https://x.example.com/logo.svg": { type: "image/svg+xml", body: SVG },
      "https://x.example.com/big.jpg": { type: "image/jpeg", body: COVER_JPG, length: 20 << 20 },
      "https://x.example.com/liar.jpg": { type: "image/jpeg", body: STILL_JPG, length: 10 },
    });
    const get = (u: string, maxBytes = 8 << 20) => safeGet(u, { accept: "image", maxBytes, net });
    expect((await get("https://x.example.com/page")).ok).toBe(false);
    expect((await get("https://x.example.com/logo.svg")).ok).toBe(false);
    const big = await get("https://x.example.com/big.jpg");
    expect(!big.ok && big.error).toMatch(/太大/);
    // a Content-Length that lies is caught while streaming
    const liar = await get("https://x.example.com/liar.jpg", 8000);
    expect(!liar.ok && liar.error).toMatch(/太大/);
  });

  it("times out and reports unknown hosts in 繁中", async () => {
    const slow: SafeNet = {
      lookup: async () => [{ address: PUBLIC, family: 4 }],
      request: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    const r = await safeGet("https://slow.example.com/a.jpg", { accept: "image", maxBytes: 1000, timeoutMs: 50, net: slow });
    expect(!r.ok && r.error).toMatch(/逾時/);
    const { net } = fakeNet({}, {});
    const r2 = await safeGet("https://nowhere.example.com/a.jpg", { accept: "image", maxBytes: 1000, net });
    expect(!r2.ok && r2.error).toMatch(/找不到主機/);
  });
});

describe("image bytes", () => {
  it("sniffs JPEG / PNG / WebP by magic bytes and refuses SVG, HTML and anything else", () => {
    expect(sniffImage(COVER_JPG)).toBe("jpeg");
    expect(sniffImage(COVER_PNG)).toBe("png");
    expect(sniffImage(COVER_WEBP)).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a\x01\x00\x01\x00\x00\x00\x00"))).toBe("gif");
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<!doctype html><html>"))).toBeNull();
    expect(sniffImage(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]))).toBeNull();
  });

  it("reads the pixel size of each format", () => {
    expect(imageSize(COVER_JPG, "jpeg")).toEqual({ width: 600, height: 600 });
    expect(imageSize(STILL_JPG, "jpeg")).toEqual({ width: 1280, height: 720 });
    expect(imageSize(COVER_PNG, "png")).toEqual({ width: 64, height: 64 });
    expect(imageSize(COVER_WEBP, "webp")).toEqual({ width: 64, height: 64 });
  });

  it("extracts the cover's palette on the server (JPEG DC decode, PNG) — teal, orange, magenta", () => {
    const near = (hex: string, target: [number, number, number]) => {
      const v = parseInt(hex.slice(1), 16);
      const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
      return rgb.every((c, i) => Math.abs(c - target[i]) < 28);
    };
    for (const [file, fam] of [
      [COVER_JPG, "jpeg"],
      [COVER_PNG, "png"],
    ] as const) {
      const sample = decodeSample(file, fam);
      expect(sample).not.toBeNull();
      const stats = extractMoodStats(sample!.data);
      expect(near(stats.palette[0], [0x0b, 0x3b, 0x3f])).toBe(true);
      expect(stats.palette.some((h) => near(h, [0xff, 0x7a, 0x1a]))).toBe(true);
      expect(stats.palette.some((h) => near(h, [0xe0, 0x19, 0x7a]))).toBe(true);
      expect(stats.saturation).toBeGreaterThan(0.6);
    }
    // WebP: the size only (the browser measures its colours)
    expect(decodeSample(COVER_WEBP, "webp")).toBeNull();
    // garbage never throws
    expect(decodeSample(COVER_JPG.subarray(0, 300), "jpeg")).toBeNull();
  });
});

describe("Cover Art Archive, YouTube, pages", () => {
  it("parses the release-group listing: the front image's 1200 px thumbnail, upgraded to https", () => {
    const data = {
      images: [
        { front: false, types: ["Back"], image: "http://coverartarchive.org/release/r1/2.jpg", thumbnails: {} },
        { front: true, approved: true, types: ["Front"], image: "http://coverartarchive.org/release/r1/1.jpg", thumbnails: { "250": "http://coverartarchive.org/release/r1/1-250.jpg", "500": "http://coverartarchive.org/release/r1/1-500.jpg", "1200": "http://coverartarchive.org/release/r1/1-1200.jpg" } },
      ],
      release: "https://musicbrainz.org/release/r1",
    };
    expect(parseCoverArt(data)).toEqual({ imageUrl: "https://coverartarchive.org/release/r1/1-1200.jpg", releaseUrl: "https://musicbrainz.org/release/r1" });
    expect(parseCoverArt({ images: [{ types: ["Front"], image: "https://ia800.us.archive.org/x/1.jpg", thumbnails: { large: "http://ia800.us.archive.org/x/1-500.jpg" } }] })?.imageUrl).toBe("https://ia800.us.archive.org/x/1-500.jpg");
    expect(parseCoverArt({ images: [{ front: false, image: "https://x/1.jpg" }] })).toBeNull();
    expect(parseCoverArt(null)).toBeNull();
    expect(coverArtUrl("https://coverartarchive.org", "0436f306-0993-4e12-acfa-4b725163b9bd")).toBe("https://coverartarchive.org/release-group/0436f306-0993-4e12-acfa-4b725163b9bd");
  });

  it("extracts YouTube ids from every link form", () => {
    const id = "dQw4w9WgXcQ";
    for (const u of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=42s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}&list=x`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
    ]) {
      expect(youtubeId(u), u).toBe(id);
    }
    for (const u of ["https://www.youtube.com/channel/UCabc", "https://youtube.com/watch?v=short", "https://evil.com/watch?v=dQw4w9WgXcQ", "ftp://youtu.be/dQw4w9WgXcQ", "not a url"]) expect(youtubeId(u), u).toBeNull();
    expect(youtubeStills(id)).toEqual([`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`]);
  });

  it("finds a page's share image (og:image first, relative URLs resolved)", () => {
    const html = `<html><head><meta name="twitter:image" content="https://band.example.com/tw.jpg"><meta content="/img/kv.jpg?x=1&amp;y=2" property="og:image"></head></html>`;
    expect(pageImage(html, "https://band.example.com/tour/")).toBe("https://band.example.com/img/kv.jpg?x=1&y=2");
    expect(pageImage("<meta name='twitter:image' content='https://cdn.example/a.png'>", "https://band.example.com/")).toBe("https://cdn.example/a.png");
    expect(pageImage("<html></html>", "https://band.example.com/")).toBeNull();
  });

  it("turns Claude's list into download jobs (YouTube pages become stills, pages without an image are read)", () => {
    const jobs = planJobs({
      candidates: coerceCandidates({
        images: [
          { kind: "live", pageUrl: "https://news.example/live-report" },
          { kind: "mv", pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", why: "官方 MV" },
          { kind: "poster", imageUrl: "https://band.example.com/kv.jpg" },
          { kind: "nonsense", imageUrl: "https://x.example/a.jpg" },
        ],
      }),
    });
    expect(jobs.map((j) => [j.kind, j.foundBy])).toEqual([
      ["keyvisual", "claude"],
      ["mv", "youtube"],
      ["live", "page"],
    ]);
    expect(jobs[1].urls[0]).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
  });
});

describe("collectVisuals", () => {
  const RG = { id: "0436f306-0993-4e12-acfa-4b725163b9bd", title: "醜奴兒" };
  const listing = JSON.stringify({ images: [{ front: true, types: ["Front"], image: "https://coverartarchive.org/release/r1/1.jpg", thumbnails: { "1200": "https://coverartarchive.org/release/r1/1-1200.jpg" } }], release: "https://musicbrainz.org/release/r1" });
  const env = { LIVELYRICS_VISUALS: "on" };

  it("collects the cover and Claude's list, measured, with provenance, deduped and in priority order", async () => {
    const { net, requests } = fakeNet(
      { "coverartarchive.org": [PUBLIC], "i.ytimg.com": [PUBLIC], "band.example.com": [PUBLIC], "mirror.example.com": [PUBLIC] },
      {
        [coverArtUrl("https://coverartarchive.org", RG.id)]: { type: "application/json", body: listing },
        "https://coverartarchive.org/release/r1/1-1200.jpg": { type: "image/jpeg", body: COVER_JPG },
        // maxresdefault is missing for this video: hqdefault is the fallback
        "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg": { type: "image/jpeg", body: STILL_JPG },
        "https://band.example.com/tour": { type: "text/html; charset=utf-8", body: '<meta property="og:image" content="https://band.example.com/poster.png">' },
        "https://band.example.com/poster.png": { type: "image/png", body: new Uint8Array(0) },
        // the same bytes as the cover under another URL: a duplicate
        "https://mirror.example.com/cover.jpg": { type: "image/jpeg", body: COVER_JPG },
        "https://band.example.com/logo.svg": { type: "image/png", body: SVG },
      },
    );
    const logs: string[] = [];
    const r = await collectVisuals(
      {
        meta: { title: "大風吹", artist: "草東沒有派對" },
        releaseGroup: RG,
        candidates: coerceCandidates([
          { kind: "mv", pageUrl: "https://youtu.be/dQw4w9WgXcQ", why: "官方 MV 的黑白畫面" },
          { kind: "keyvisual", pageUrl: "https://band.example.com/tour" },
          { kind: "cover", imageUrl: "https://mirror.example.com/cover.jpg" },
          { kind: "logo", imageUrl: "https://band.example.com/logo.svg" },
        ]),
        authorization: null,
      },
      { net, env, now: () => new Date("2026-09-30T00:00:00Z"), onLog: (m) => logs.push(m) },
    );
    expect(r.downloads.map((d) => d.item.provenance.kind)).toEqual(["cover", "mv"]);
    const [cover, still] = r.downloads;
    expect(cover.item.provenance).toMatchObject({ foundBy: "cover-art-archive", imageUrl: "https://coverartarchive.org/release/r1/1-1200.jpg", sourceUrl: "https://musicbrainz.org/release/r1", title: "醜奴兒" });
    expect(cover.item.name).toBe("專輯封面《醜奴兒》");
    expect(cover.item).toMatchObject({ width: 600, height: 600, mimeType: "image/jpeg", use: "reference", useSetBy: "auto" });
    expect(cover.item.provenance.authorization).toMatch(/尚未確認/);
    expect(cover.item.stats?.palette.length).toBeGreaterThanOrEqual(3);
    expect(cover.ext).toBe("jpg");
    expect(still.item.provenance).toMatchObject({ foundBy: "youtube", sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", why: "官方 MV 的黑白畫面" });
    expect(still.item.provenance.imageUrl).toMatch(/hqdefault/);
    // the SVG served as image/png is refused by its bytes; the empty poster too
    expect(r.notes.some((n) => /標誌/.test(n) && /不是 JPEG/.test(n))).toBe(true);
    expect(requests.some((q) => q.url === "https://mirror.example.com/cover.jpg")).toBe(true);
    expect(collectedSummary(r.downloads.map((d) => d.item))).toBe("找到專輯封面、1 張 MV 畫面");
  });

  it("authorized: items go on stage; the skip list, the room and the switch are honoured", async () => {
    const { net } = fakeNet(
      { "coverartarchive.org": [PUBLIC] },
      {
        [coverArtUrl("https://coverartarchive.org", RG.id)]: { type: "application/json", body: listing },
        "https://coverartarchive.org/release/r1/1-1200.jpg": { type: "image/jpeg", body: COVER_JPG },
      },
    );
    const auth = { at: "2026-09-01T00:00:00Z", note: "樂團已授權" };
    const on = await collectVisuals({ meta: {}, releaseGroup: RG, authorization: auth }, { net, env });
    expect(on.downloads[0].item.use).toBe("stage");
    expect(on.downloads[0].item.provenance.authorization).toBe("樂團已授權（2026-09-01 確認）");
    const skipped = await collectVisuals({ meta: {}, releaseGroup: RG, authorization: auth, skip: { urls: new Set(["https://coverartarchive.org/release/r1/1-1200.jpg"]), hashes: new Set() } }, { net, env });
    expect(skipped.downloads).toHaveLength(0);
    expect((await collectVisuals({ meta: {}, releaseGroup: RG, authorization: auth, room: 0 }, { net, env })).downloads).toHaveLength(0);
    expect((await collectVisuals({ meta: {}, releaseGroup: RG, authorization: auth }, { net, env: { LIVELYRICS_VISUALS: "off" } })).downloads).toHaveLength(0);
    // LIVELYRICS_FREE_SOURCES=off: no Cover Art Archive
    expect((await collectVisuals({ meta: {}, releaseGroup: RG, authorization: auth }, { net, env: { ...env, LIVELYRICS_FREE_SOURCES: "off" } })).downloads).toHaveLength(0);
  });

  it("a missing cover and unreachable hosts are notes, never errors", async () => {
    const { net } = fakeNet({ "coverartarchive.org": [PUBLIC] }, { [coverArtUrl("https://coverartarchive.org", RG.id)]: { status: 404, type: "text/plain", body: "" } });
    const r = await collectVisuals({ meta: {}, releaseGroup: RG, candidates: [{ kind: "cover", imageUrl: "https://gone.example.com/a.jpg" }], authorization: null }, { net, env });
    expect(r.downloads).toHaveLength(0);
    expect(r.notes.join("\n")).toMatch(/沒有《醜奴兒》的封面/);
    expect(r.notes.join("\n")).toMatch(/找不到主機/);
  });

  it("LIVELYRICS_COVERART_URL points the lookup elsewhere and trusts only that origin", () => {
    const cfg = visualsConfig({ LIVELYRICS_COVERART_URL: "http://127.0.0.1:3199/coverart/" });
    expect(cfg.coverArtUrl).toBe("http://127.0.0.1:3199/coverart");
    expect(cfg.trustedOrigins).toEqual(["http://127.0.0.1:3199"]);
    expect(visualsConfig({}).trustedOrigins).toEqual([]);
  });
});

describe("stored collection", () => {
  const item = (over: Partial<CollectedVisual> = {}): CollectedVisual => ({
    id: "a1b2c3d4e5f6",
    kind: "image",
    name: "專輯封面",
    mimeType: "image/jpeg",
    file: "a1b2c3d4e5f6.jpg",
    width: 600,
    height: 600,
    bytes: 1000,
    createdAt: "2026-09-30T00:00:00Z",
    provenance: { kind: "cover", imageUrl: "https://coverartarchive.org/1.jpg", foundBy: "cover-art-archive", fetchedAt: "2026-09-30T00:00:00Z", authorization: "x" },
    use: "reference",
    useSetBy: "auto",
    hash: "0123456789abcdef",
    ...over,
  });

  it("coerces stored items and drops broken ones", () => {
    const list = coerceCollected([item(), { ...item({ id: "bbbbbbbbbbbb", file: "bbbbbbbbbbbb.jpg" }), provenance: { kind: "?", imageUrl: "x" } }, { id: "../x" }, "junk"]);
    expect(list).toHaveLength(1);
    expect(list[0].provenance.kind).toBe("cover");
  });

  it("merges a refresh by hash and URL, keeping the operator's choice and leaving removed items out", () => {
    const current = [item({ use: "stage", useSetBy: "user" })];
    const again = item({ id: "", file: "", provenance: { ...item().provenance, why: "新的說明" } });
    const fresh = item({ id: "cccccccccccc", file: "cccccccccccc.jpg", hash: "fedcba9876543210", provenance: { ...item().provenance, imageUrl: "https://i.ytimg.com/vi/x/hqdefault.jpg", kind: "mv" } });
    const gone = item({ id: "dddddddddddd", file: "dddddddddddd.jpg", hash: "1111111111111111", provenance: { ...item().provenance, imageUrl: "https://gone.example.com/a.jpg" } });
    const r = mergeCollection(current, [again, fresh, gone], ["1111111111111111"]);
    expect(r.list.map((c) => c.id)).toEqual(["a1b2c3d4e5f6", "cccccccccccc"]);
    expect(r.list[0]).toMatchObject({ use: "stage", useSetBy: "user" });
    expect(r.list[0].provenance.why).toBe("新的說明");
    expect(r.added.map((c) => c.id)).toEqual(["cccccccccccc"]);
  });
});
