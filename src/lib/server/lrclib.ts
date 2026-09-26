// LRCLIB client (https://lrclib.net/docs): search + exact lookup, mapped to parsed Lyrics.

import type { LyricsSearchResult } from "@/lib/api-client";
import { parseLrc, parsePlainLyrics } from "@/lib/lyrics/lrc";
import type { Lyrics, SongMeta } from "@/lib/types";

const API_BASE = "https://lrclib.net/api";
const USER_AGENT = "Livelyrics/0.1 (+https://github.com/alanwu14832-bit/Livelyrics-)";
const TIMEOUT_MS = 8000;
/** synced timings are only trusted when the recording length matches within this many seconds */
const DURATION_TOLERANCE = 3;

/** pause before the single retry of a transient failure */
const RETRY_DELAY_MS = 600;

export class LrclibError extends Error {
  constructor(
    message: string,
    /** a transient failure (connection reset, 429, 5xx) worth one more try */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LrclibError";
  }
}

export interface LrclibQuery {
  title: string;
  artist?: string;
  album?: string;
  /** seconds; 0 / undefined when unknown */
  duration?: number;
}

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

interface Candidate {
  record: LrclibRecord;
  /** parsed synced lyrics when the record has usable timings */
  synced: Lyrics | null;
  /** plain text version (from plainLyrics, or the synced text without timings) */
  plain: Lyrics | null;
  /** came from the exact-signature /get endpoint */
  exact: boolean;
}

interface RequestOptions {
  signal?: AbortSignal;
}

function toRecord(raw: unknown): LrclibRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number" || !Number.isFinite(r.id)) return null;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id: r.id,
    trackName: s(r.trackName) || s(r.name),
    artistName: s(r.artistName),
    albumName: s(r.albumName),
    duration: typeof r.duration === "number" && Number.isFinite(r.duration) ? r.duration : 0,
    instrumental: r.instrumental === true,
    plainLyrics: typeof r.plainLyrics === "string" ? r.plainLyrics : null,
    syncedLyrics: typeof r.syncedLyrics === "string" ? r.syncedLyrics : null,
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** One request, retried once after a short pause when LRCLIB fails transiently. */
async function request(pathAndQuery: string, opts: RequestOptions = {}): Promise<unknown | null> {
  try {
    return await requestOnce(pathAndQuery, opts);
  } catch (err) {
    if (!(err instanceof LrclibError) || !err.retryable || opts.signal?.aborted) throw err;
    await delay(RETRY_DELAY_MS, opts.signal);
    return requestOnce(pathAndQuery, opts);
  }
}

async function requestOnce(pathAndQuery: string, opts: RequestOptions = {}): Promise<unknown | null> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${pathAndQuery}`, {
      headers: { "User-Agent": USER_AGENT, "Lrclib-Client": USER_AGENT, Accept: "application/json" },
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (timeout.aborted) throw new LrclibError(`LRCLIB 沒有回應（逾時 ${TIMEOUT_MS / 1000} 秒）`);
    const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
    throw new LrclibError(`無法連線到 LRCLIB（${cause}）`, true);
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new LrclibError(`LRCLIB 回傳錯誤 ${res.status}`, res.status === 429 || res.status >= 500);
  }
  try {
    return await res.json();
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (timeout.aborted) throw new LrclibError(`LRCLIB 沒有回應（逾時 ${TIMEOUT_MS / 1000} 秒）`);
    throw new LrclibError("LRCLIB 回傳了無法解析的資料");
  }
}

function toCandidate(record: LrclibRecord, exact: boolean): Candidate {
  let synced: Lyrics | null = null;
  if (record.syncedLyrics && record.syncedLyrics.trim()) {
    const parsed = parseLrc(record.syncedLyrics);
    if (parsed.synced && parsed.lines.length > 0) synced = { ...parsed, source: "lrclib-synced" };
  }
  let plain: Lyrics | null = null;
  const plainText = record.plainLyrics && record.plainLyrics.trim() ? record.plainLyrics : record.syncedLyrics;
  if (plainText && plainText.trim()) {
    const parsed = parsePlainLyrics(plainText);
    if (parsed.lines.length > 0) plain = { ...parsed, source: "lrclib-plain" };
  }
  return { record, synced, plain, exact };
}

function toResult(c: Candidate): LyricsSearchResult | null {
  const lyrics = c.synced ?? c.plain;
  if (c.record.instrumental || !lyrics) return null;
  return {
    id: c.record.id,
    trackName: c.record.trackName,
    artistName: c.record.artistName,
    albumName: c.record.albumName,
    duration: c.record.duration,
    synced: c.synced != null,
    lyrics,
  };
}

function durationDiff(recordDuration: number, duration: number | undefined): number | null {
  return duration && duration > 0 && recordDuration > 0 ? Math.abs(recordDuration - duration) : null;
}

/**
 * Search order: synced & duration within ±3 s, plain & within ±3 s, synced but a different
 * length, plain & different length; ties by |duration diff|, then LRCLIB relevance.
 */
export function rankResults(results: LyricsSearchResult[], duration?: number): LyricsSearchResult[] {
  return results
    .map((r, index) => {
      const diff = durationDiff(r.duration, duration);
      const near = diff == null || diff <= DURATION_TOLERANCE;
      return { r, index, tier: (r.synced ? 0 : 1) + (near ? 0 : 2), diff: diff ?? 0 };
    })
    .sort((a, b) => a.tier - b.tier || a.diff - b.diff || a.index - b.index)
    .map((x) => x.r);
}

async function searchRecords(params: Record<string, string>, opts: RequestOptions): Promise<LrclibRecord[]> {
  const data = await request(`/search?${new URLSearchParams(params)}`, opts);
  if (!Array.isArray(data)) return [];
  return data.map(toRecord).filter((r): r is LrclibRecord => r !== null);
}

/** Title without decorations like "(Live)", "【MV】", " - Remastered", "feat. X". */
export function cleanTitle(title: string): string {
  return title
    .replace(/[(（\[【「『][^)）\]】」』]*[)）\]】」』]/g, " ")
    .replace(/\s+[-–—]\s+.*$/, "")
    .replace(/\s+(?:feat\.?|ft\.?)\s.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchCandidates(q: LrclibQuery, opts: RequestOptions): Promise<Candidate[]> {
  const title = q.title.trim();
  const artist = (q.artist ?? "").trim();
  const seen = new Set<number>();
  const out: Candidate[] = [];
  const add = (records: LrclibRecord[]) => {
    for (const r of records) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(toCandidate(r, false));
    }
  };

  const params: Record<string, string> = { track_name: title };
  if (artist) params.artist_name = artist;
  add(await searchRecords(params, opts));
  if (out.length === 0) {
    const simpler = cleanTitle(title);
    if (simpler && simpler !== title) add(await searchRecords({ ...params, track_name: simpler }, opts));
  }
  if (out.length === 0 && artist) add(await searchRecords({ q: `${artist} ${cleanTitle(title) || title}` }, opts));
  return out;
}

/** GET /api/lyrics/search: ranked results, instrumental tracks excluded. */
export async function searchLyrics(q: LrclibQuery, opts: RequestOptions = {}): Promise<LyricsSearchResult[]> {
  if (!q.title.trim()) return [];
  const candidates = await searchCandidates(q, opts);
  const results = candidates.map(toResult).filter((r): r is LyricsSearchResult => r !== null);
  return rankResults(results, q.duration);
}

/** Exact lookup by signature (LRCLIB matches duration within ±2 s). null when not found. */
export async function getLyrics(q: LrclibQuery & { duration: number }, opts: RequestOptions = {}): Promise<LyricsSearchResult | null> {
  const record = await getRecord(q, opts);
  return record ? toResult(toCandidate(record, true)) : null;
}

async function getRecord(q: LrclibQuery & { duration: number }, opts: RequestOptions): Promise<LrclibRecord | null> {
  const params = new URLSearchParams({
    track_name: q.title.trim(),
    artist_name: (q.artist ?? "").trim(),
    duration: String(Math.round(q.duration)),
  });
  if (q.album && q.album.trim()) params.set("album_name", q.album.trim());
  return toRecord(await request(`/get?${params}`, opts));
}

function normalizeName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

export type BestLyrics =
  | { kind: "synced" | "plain"; result: LyricsSearchResult; lyrics: Lyrics }
  | { kind: "instrumental"; trackName: string; artistName: string };

/**
 * Pick lyrics for the pipeline. Synced timings are used only when the recording length
 * matches (or is unknown and title+artist match); otherwise the best matching text is
 * returned as plain lyrics to be distributed. Network failures throw LrclibError.
 */
export async function findBestLyrics(
  meta: Pick<SongMeta, "title" | "artist" | "duration"> & { album?: string },
  opts: RequestOptions & { onLog?: (message: string) => void } = {},
): Promise<BestLyrics | null> {
  const title = meta.title.trim();
  const artist = meta.artist.trim();
  if (!title) return null;
  const duration = meta.duration > 0 ? meta.duration : 0;
  const candidates: Candidate[] = [];

  if (duration > 0 && artist) {
    try {
      const exact = await getRecord({ title, artist, album: meta.album, duration }, opts);
      if (exact) candidates.push(toCandidate(exact, true));
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      opts.onLog?.(`LRCLIB 精確查詢失敗，改用搜尋：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const known = new Set(candidates.map((c) => c.record.id));
  for (const c of await searchCandidates({ title, artist, duration }, opts)) {
    if (!known.has(c.record.id)) candidates.push(c);
  }
  if (candidates.length === 0) return null;

  const scored = candidates.map((c) => {
    const diff = durationDiff(c.record.duration, duration);
    const titleMatch = namesMatch(c.record.trackName, title) || namesMatch(c.record.trackName, cleanTitle(title));
    const artistMatch = !artist || namesMatch(c.record.artistName, artist);
    const score = (c.exact ? 4 : 0) + (titleMatch ? 2 : 0) + (artistMatch ? 1 : 0);
    return { c, diff, near: diff == null ? null : diff <= DURATION_TOLERANCE, titleMatch, artistMatch, score };
  });
  const byQuality = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    b.score - a.score || (a.diff ?? 0) - (b.diff ?? 0);

  const instrumental = scored.find((s) => s.c.record.instrumental && (s.c.exact || (s.titleMatch && s.artistMatch)) && s.near !== false);
  const withText = scored.filter((s) => !s.c.record.instrumental);
  if (instrumental && !withText.some((s) => s.c.exact || (s.titleMatch && s.artistMatch && s.near !== false))) {
    return { kind: "instrumental", trackName: instrumental.c.record.trackName, artistName: instrumental.c.record.artistName };
  }

  const syncedOk = withText
    .filter((s) => s.c.synced)
    .filter((s) => (s.near == null ? s.titleMatch && s.artistMatch : s.near && (s.c.exact || s.titleMatch || s.artistMatch)))
    .sort(byQuality);
  if (syncedOk.length) {
    const best = syncedOk[0].c;
    return { kind: "synced", result: toResult(best)!, lyrics: best.synced! };
  }

  const plainOk = withText
    .filter((s) => s.c.plain)
    .filter((s) => s.c.exact || (s.titleMatch && s.artistMatch) || (s.near === true && (s.titleMatch || s.artistMatch)))
    .sort(byQuality);
  if (plainOk.length) {
    const best = plainOk[0];
    if (best.c.synced && best.diff != null) {
      opts.onLog?.(`LRCLIB 的同步歌詞長度（${Math.round(best.c.record.duration)} 秒）與音檔（${Math.round(duration)} 秒）不符，只採用歌詞文字`);
    }
    const result = toResult(best.c)!;
    return { kind: "plain", result: { ...result, synced: false, lyrics: best.c.plain! }, lyrics: best.c.plain! };
  }
  return null;
}
