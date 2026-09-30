// 研究找到的素材 (phase 8): collect the band's real visual material for a song during research.
//
//   cover       MusicBrainz release group → Cover Art Archive front image (免費研究 and Claude)
//   Claude      the candidates Claude listed after its web research (official cover, MV links, key
//               visual / tour poster, logo, live photos): a direct image URL, a YouTube MV link →
//               i.ytimg.com/vi/<id>/maxresdefault.jpg (hqdefault.jpg when there is none), or a page →
//               its og:image
//
// Every download goes through safe-fetch (https, public addresses only, redirects re-checked, a
// timeout, a size cap, an image content type) and the magic bytes must say JPEG / PNG / WebP / GIF;
// SVG is never accepted. Duplicates (same URL, same bytes) are dropped, at most MAX_COLLECTED a song,
// and the whole collection has a time budget inside the research step. Nothing here throws for a
// network problem: a collection that finds nothing leaves the research as it was.

import { createHash } from "node:crypto";
import { extractMoodStats } from "@/lib/moodboard";
import type { CollectedVisual, MaterialAuthorization, MbRecordingInfo, MoodStats, VisualCandidate, VisualFinder, VisualKind } from "@/lib/types";
import { authorizationText, collectedName, httpUrl, MAX_COLLECTED, MAX_COLLECTED_BYTES, VISUAL_KIND_LABEL } from "@/lib/visuals";
import { sourceConfig, type RateGate } from "./http";
import { decodeSample, IMAGE_MIME, imageSize, sniffImage, type ImageFamily } from "./image-decode";
import { lookupMusicBrainz } from "./musicbrainz";
import { originOf, safeGet, type SafeNet } from "./safe-fetch";

export const DEFAULT_COVERART_URL = "https://coverartarchive.org";
/** The whole collection (all downloads) gets at most this long. */
export const VISUALS_BUDGET_MS = 30_000;
/** Pages opened to find an og:image (Claude gave a page but no image). */
const MAX_PAGES = 4;
const MAX_HTML_BYTES = 1_500_000;
const PARALLEL = 3;
/** Smaller than this is an icon or a placeholder, not material. */
const MIN_EDGE: Record<VisualKind, number> = { cover: 200, mv: 320, keyvisual: 240, logo: 64, live: 320 };

type Env = Record<string, string | undefined>;

export interface VisualsConfig {
  /** false: LIVELYRICS_VISUALS=off */
  enabled: boolean;
  /** false: LIVELYRICS_FREE_SOURCES=off (no MusicBrainz / Cover Art Archive) */
  coverArt: boolean;
  coverArtUrl: string;
  /** origins configured explicitly (a mirror, the e2e stub): http / loopback allowed there */
  trustedOrigins: string[];
}

export function visualsConfig(env: Env = process.env): VisualsConfig {
  const off = (v: string | undefined) => /^(off|0|false|no|none)$/i.test(v?.trim() ?? "");
  const caa = env.LIVELYRICS_COVERART_URL?.trim();
  const coverArtUrl = (caa && /^https?:\/\//.test(caa) ? caa : DEFAULT_COVERART_URL).replace(/\/+$/, "");
  const trusted = caa && /^https?:\/\//.test(caa) ? originOf(caa) : null;
  return { enabled: !off(env.LIVELYRICS_VISUALS), coverArt: sourceConfig(env).enabled, coverArtUrl, trustedOrigins: trusted ? [trusted] : [] };
}

// ---------------------------------------------------------------------------
// Cover Art Archive
// ---------------------------------------------------------------------------

export function coverArtUrl(base: string, releaseGroupId: string): string {
  return `${base}/release-group/${encodeURIComponent(releaseGroupId)}`;
}

/** Cover Art Archive answers with http:// links to its own hosts; they serve https too. */
function upgradeArchive(url: string): string {
  return url.replace(/^http:\/\/((?:[a-z0-9-]+\.)*(?:coverartarchive\.org|archive\.org))\//i, "https://$1/");
}

/**
 * The front image of a Cover Art Archive listing (the 1200 px thumbnail when there is one, then
 * large / 500, else the original), with the release page it belongs to. Null when there is none.
 */
export function parseCoverArt(data: unknown): { imageUrl: string; releaseUrl?: string } | null {
  if (!data || typeof data !== "object") return null;
  const o = data as { images?: unknown; release?: unknown };
  const images = Array.isArray(o.images) ? o.images : [];
  const isFront = (img: Record<string, unknown>) => img.front === true || (Array.isArray(img.types) && img.types.includes("Front"));
  const list = images.filter((i): i is Record<string, unknown> => !!i && typeof i === "object");
  const front = list.find((i) => isFront(i) && i.approved !== false) ?? list.find(isFront);
  if (!front) return null;
  const thumbs = front.thumbnails && typeof front.thumbnails === "object" ? (front.thumbnails as Record<string, unknown>) : {};
  const pick = [thumbs["1200"], thumbs.large, thumbs["500"], front.image].map((u) => (typeof u === "string" ? httpUrl(upgradeArchive(u)) : "")).find(Boolean);
  if (!pick) return null;
  const release = typeof o.release === "string" ? httpUrl(o.release) : "";
  return { imageUrl: pick, ...(release ? { releaseUrl: release } : {}) };
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** The video id of a YouTube link (watch, youtu.be, embed, shorts, live, music / mobile / nocookie), or null. */
export function youtubeId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

export function youtubeStills(id: string): string[] {
  return [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`];
}

// ---------------------------------------------------------------------------
// pages: og:image
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;|&#47;/gi, "/");
}

/** The page's share image (og:image, og:image:secure_url, twitter:image), resolved against the page. */
export function pageImage(html: string, pageUrl: string): string | null {
  const head = html.slice(0, 400_000);
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const wanted = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];
  let best: { rank: number; url: string } | null = null;
  for (const tag of metas) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
    const key = (attr("property") ?? attr("name"))?.slice(2).find((v) => v != null)?.toLowerCase();
    const content = attr("content")?.slice(2).find((v) => v != null);
    if (!key || !content) continue;
    const rank = wanted.indexOf(key);
    if (rank < 0 || (best && best.rank <= rank)) continue;
    try {
      const url = new URL(decodeEntities(content.trim()), pageUrl).href;
      if (/^https?:\/\//.test(url)) best = { rank, url };
    } catch {
      /* not a URL */
    }
  }
  return best?.url ?? null;
}

// ---------------------------------------------------------------------------
// the collection
// ---------------------------------------------------------------------------

export interface CollectInput {
  meta: { title?: string; artist?: string };
  /** the song's release group (from 免費研究's MusicBrainz lookup, or `findReleaseGroup`) */
  releaseGroup?: { id: string; title: string } | null;
  /** Claude's list (absent in 免費研究) */
  candidates?: readonly VisualCandidate[];
  authorization: MaterialAuthorization | null;
  /** image URLs / hashes that must not be collected again (stored or removed items) */
  skip?: { urls: ReadonlySet<string>; hashes: ReadonlySet<string> };
  /** how many more items the song may take */
  room?: number;
}

export interface CollectOptions {
  signal?: AbortSignal;
  budgetMs?: number;
  net?: SafeNet;
  env?: Env;
  now?: () => Date;
  onLog?: (message: string) => void;
}

/** A downloaded image ready for storage (collected-storage `IncomingVisual`). */
export interface CollectedDownload {
  item: Omit<CollectedVisual, "id" | "file" | "blob">;
  bytes: Uint8Array;
  ext: string;
}

export interface CollectResult {
  downloads: CollectedDownload[];
  /** 繁中 notes of what failed (for the log) */
  notes: string[];
  tried: number;
}

interface Job {
  kind: VisualKind;
  urls: string[];
  /** a page to read for its og:image when `urls` is empty */
  page?: string;
  sourceUrl?: string;
  foundBy: VisualFinder;
  why?: string;
  title?: string;
}

const KIND_ORDER: VisualKind[] = ["cover", "keyvisual", "mv", "logo", "live"];

/** The palette of an image the server can decode (JPEG / PNG / GIF). */
export function measureImage(bytes: Uint8Array, family: ImageFamily): MoodStats | undefined {
  const sample = decodeSample(bytes, family);
  return sample ? extractMoodStats(sample.data) : undefined;
}

export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** What to try, best first: the Cover Art Archive front, then Claude's list by kind. */
export function planJobs(input: Pick<CollectInput, "candidates">): Job[] {
  const jobs: Job[] = [];
  const seen = new Set<string>();
  const push = (j: Job) => {
    const key = j.urls[0] ?? j.page ?? "";
    if (!key || seen.has(key)) return;
    seen.add(key);
    jobs.push(j);
  };
  const candidates = [...(input.candidates ?? [])].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const c of candidates) {
    const yt = youtubeId(c.imageUrl ?? "") ?? youtubeId(c.pageUrl ?? "");
    if (yt && (c.kind === "mv" || c.kind === "live" || !c.imageUrl)) {
      push({ kind: c.kind === "live" ? "live" : "mv", urls: youtubeStills(yt), sourceUrl: `https://www.youtube.com/watch?v=${yt}`, foundBy: "youtube", why: c.why, title: c.title });
    } else if (c.imageUrl) {
      push({ kind: c.kind, urls: [c.imageUrl], sourceUrl: c.pageUrl, foundBy: "claude", why: c.why, title: c.title });
    } else if (c.pageUrl) {
      push({ kind: c.kind, urls: [], page: c.pageUrl, sourceUrl: c.pageUrl, foundBy: "page", why: c.why, title: c.title });
    }
  }
  return jobs;
}

/**
 * Collect the song's material. Never throws for network problems; a cancelled caller gets whatever
 * finished (it checks its own signal).
 */
export async function collectVisuals(input: CollectInput, opts: CollectOptions = {}): Promise<CollectResult> {
  const cfg = visualsConfig(opts.env);
  const notes: string[] = [];
  const result: CollectResult = { downloads: [], notes, tried: 0 };
  if (!cfg.enabled) return result;
  const room = Math.max(0, Math.min(MAX_COLLECTED, input.room ?? MAX_COLLECTED));
  if (!room) return result;
  const budget = AbortSignal.timeout(Math.max(1000, opts.budgetMs ?? VISUALS_BUDGET_MS));
  const signal = opts.signal ? AbortSignal.any([opts.signal, budget]) : budget;
  const net: SafeNet = { ...opts.net, trustedOrigins: [...(opts.net?.trustedOrigins ?? []), ...cfg.trustedOrigins] };
  const now = opts.now ?? (() => new Date());
  const skipUrls = new Set(input.skip?.urls ?? []);
  const hashes = new Set(input.skip?.hashes ?? []);
  const auth = authorizationText(input.authorization);
  const use = input.authorization ? "stage" : "reference";

  const jobs: Job[] = [];
  // 1. the cover from the Cover Art Archive
  if (cfg.coverArt && input.releaseGroup?.id) {
    const listing = await safeGet(coverArtUrl(cfg.coverArtUrl, input.releaseGroup.id), { accept: "json", maxBytes: 512 * 1024, signal, net });
    if (listing.ok) {
      let data: unknown = null;
      try {
        data = JSON.parse(new TextDecoder().decode(listing.bytes));
      } catch {
        notes.push("Cover Art Archive 回傳了無法解析的資料");
      }
      const front = parseCoverArt(data);
      if (front) {
        jobs.push({
          kind: "cover",
          urls: [front.imageUrl],
          sourceUrl: front.releaseUrl ?? `https://musicbrainz.org/release-group/${input.releaseGroup.id}`,
          foundBy: "cover-art-archive",
          title: input.releaseGroup.title,
          why: `《${input.releaseGroup.title}》的封面：樂團這個時期的顏色與質地`,
        });
      } else if (data) notes.push("Cover Art Archive 沒有這張專輯的正面封面");
    } else if (listing.status === 404) notes.push(`Cover Art Archive 沒有《${input.releaseGroup.title}》的封面`);
    else notes.push(`Cover Art Archive 查詢失敗：${listing.error}`);
  }
  // 2. Claude's list
  jobs.push(...planJobs(input));

  let pages = 0;
  const kept: CollectedDownload[] = [];
  const tryJob = async (job: Job): Promise<void> => {
    if (signal.aborted || kept.length >= room) return;
    let urls = job.urls;
    if (!urls.length && job.page) {
      if (pages >= MAX_PAGES) return;
      pages++;
      const page = await safeGet(job.page, { accept: "html", maxBytes: MAX_HTML_BYTES, signal, net });
      const img = page.ok ? pageImage(new TextDecoder().decode(page.bytes), page.url) : null;
      if (!img) {
        if (!page.ok) notes.push(`無法開啟 ${hostOf(job.page)}：${page.error}`);
        return;
      }
      urls = [img];
    }
    for (const url of urls) {
      if (signal.aborted || kept.length >= room) return;
      if (skipUrls.has(url)) return;
      skipUrls.add(url);
      result.tried++;
      const got = await safeGet(url, { accept: "image", maxBytes: MAX_COLLECTED_BYTES, signal, net });
      if (!got.ok) {
        // maxresdefault is missing for many videos: the next URL is the fallback, not a failure
        if (url !== urls[urls.length - 1] && got.status === 404) continue;
        notes.push(`${VISUAL_KIND_LABEL[job.kind]}下載失敗（${hostOf(url)}）：${got.error}`);
        continue;
      }
      const family = sniffImage(got.bytes);
      if (!family) {
        notes.push(`${VISUAL_KIND_LABEL[job.kind]}（${hostOf(url)}）不是 JPEG／PNG／WebP／GIF 圖片，已略過`);
        continue;
      }
      const size = imageSize(got.bytes, family);
      if (!size || Math.min(size.width, size.height) < MIN_EDGE[job.kind]) {
        if (url !== urls[urls.length - 1]) continue;
        notes.push(`${VISUAL_KIND_LABEL[job.kind]}（${hostOf(url)}）太小，已略過`);
        continue;
      }
      const hash = contentHash(got.bytes);
      if (hashes.has(hash)) return;
      hashes.add(hash);
      if (kept.length >= room) return;
      const { mimeType, ext } = IMAGE_MIME[family];
      const stats = measureImage(got.bytes, family);
      const title = job.title?.trim() || undefined;
      const item: CollectedDownload["item"] = {
        kind: job.kind === "logo" ? "logo" : "image",
        name: collectedName(job.kind, title),
        mimeType,
        width: size.width,
        height: size.height,
        bytes: got.bytes.length,
        createdAt: now().toISOString(),
        note: `研究找到的${VISUAL_KIND_LABEL[job.kind]}${job.why ? `：${job.why.slice(0, 160)}` : ""}`,
        provenance: {
          kind: job.kind,
          imageUrl: url,
          foundBy: job.foundBy,
          fetchedAt: now().toISOString(),
          authorization: auth,
          ...(job.sourceUrl ? { sourceUrl: job.sourceUrl } : {}),
          ...(job.why ? { why: job.why.slice(0, 300) } : {}),
          ...(title ? { title: title.slice(0, 200) } : {}),
        },
        use,
        useSetBy: "auto",
        hash,
        ...(stats ? { stats } : {}),
      };
      kept.push({ item, bytes: got.bytes, ext });
      return;
    }
  };

  // a few at a time, in priority order
  let next = 0;
  const workers = Array.from({ length: Math.min(PARALLEL, jobs.length) }, async () => {
    while (next < jobs.length && !signal.aborted && kept.length < room) {
      const job = jobs[next++];
      try {
        await tryJob(job);
      } catch (err) {
        notes.push(`素材處理失敗：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
  await Promise.all(workers);
  if (budget.aborted && !opts.signal?.aborted) notes.push(`素材收集超過 ${Math.round((opts.budgetMs ?? VISUALS_BUDGET_MS) / 1000)} 秒，只保留已經下載的部分`);
  // priority order regardless of which download finished first
  const rank = (d: CollectedDownload) => KIND_ORDER.indexOf(d.item.provenance.kind) * 100 + jobs.findIndex((j) => j.urls.includes(d.item.provenance.imageUrl) || j.page === d.item.provenance.sourceUrl);
  result.downloads = kept.sort((a, b) => rank(a) - rank(b));
  return result;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

// ---------------------------------------------------------------------------
// the release group when the research had no MusicBrainz lookup (Claude)
// ---------------------------------------------------------------------------

/**
 * The song's release group on MusicBrainz (for its cover). Reuses 免費研究's lookup when there is
 * one; otherwise asks MusicBrainz (the shared one-a-second gate). Null when unknown or disabled.
 */
export async function findReleaseGroup(
  meta: { title?: string; artist?: string },
  known: MbRecordingInfo | null | undefined,
  opts: { signal?: AbortSignal; env?: Env; fetch?: (input: string, init?: RequestInit) => Promise<Response>; gate?: RateGate; gapMs?: number } = {},
): Promise<{ id: string; title: string } | null> {
  if (known?.releaseGroup?.id) return { id: known.releaseGroup.id, title: known.releaseGroup.title };
  const cfg = sourceConfig(opts.env);
  const title = meta.title?.trim() ?? "";
  const artist = meta.artist?.trim() ?? "";
  if (!cfg.enabled || !visualsConfig(opts.env).enabled || !title || !artist) return null;
  const fetchImpl = opts.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
  const r = await lookupMusicBrainz({ title, artist }, { fetch: fetchImpl, signal, base: cfg.musicbrainzUrl, gate: opts.gate, gapMs: opts.gapMs }).catch(() => null);
  const rg = r?.recording?.releaseGroup;
  return rg?.id ? { id: rg.id, title: rg.title } : null;
}
