// 免費研究: the public facts about a song and its artist, from MusicBrainz and Wikipedia at once,
// inside one time budget (15 s; each request about 6 s), cached on the project's research
// (`Research.publicInfo`) so a re-run of the research step does not ask again. Every source may
// fail or know nothing (an obscure indie band): the result then says so and the brief falls back
// to the lyrics and the audio.

import type { MbArtistInfo, MbRecordingInfo, MbTag, PublicInfo, SourceStatus, WikiPage } from "@/lib/types";
import { nameKey } from "@/lib/zh-variants";
import { sourceConfig, type FetchLike, type RateGate } from "./http";
import { lookupMusicBrainz } from "./musicbrainz";
import { lookupWikipedia } from "./wikipedia";

/** The whole lookup (both sources in parallel) gets at most this long. */
export const FREE_LOOKUP_BUDGET_MS = 15_000;
/** A cached lookup is reused this long (a failed source is always asked again). */
export const PUBLIC_INFO_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export type LookupSource = "musicbrainz" | "wikipedia";

export type LookupEvent =
  | { kind: "start"; source: LookupSource; query: string }
  | { kind: "done"; source: LookupSource; status: SourceStatus; summary: string };

export interface LookupOptions {
  fetch?: FetchLike;
  /** cancellation (the pipeline step) */
  signal?: AbortSignal;
  now?: () => Date;
  budgetMs?: number;
  timeoutMs?: number;
  /** MusicBrainz spacing override (tests) */
  musicbrainzGapMs?: number;
  musicbrainzGate?: RateGate;
  env?: Record<string, string | undefined>;
  onEvent?: (e: LookupEvent) => void;
}

export function publicQuery(meta: { title?: string; artist?: string } | null | undefined): { title: string; artist: string } {
  return { title: (meta?.title ?? "").trim().slice(0, 200), artist: (meta?.artist ?? "").trim().slice(0, 200) };
}

/** The cached lookup still answers this query (same names, recent, no source failed). */
export function isFreshPublicInfo(info: PublicInfo | null | undefined, q: { title: string; artist: string }, now = new Date(), maxAgeMs = PUBLIC_INFO_MAX_AGE_MS): boolean {
  if (!info) return false;
  if (nameKey(info.query.title) !== nameKey(q.title) || nameKey(info.query.artist) !== nameKey(q.artist)) return false;
  if (info.status.musicbrainz === "failed" || info.status.wikipedia === "failed") return false;
  if (info.status.musicbrainz === "skipped" && info.status.wikipedia === "skipped") return false;
  const at = Date.parse(info.fetchedAt);
  return Number.isFinite(at) && now.getTime() - at < maxAgeMs && now.getTime() >= at - 60_000;
}

function describeMb(r: { recording: MbRecordingInfo | null; artist: MbArtistInfo | null }): string {
  const parts: string[] = [];
  if (r.recording) parts.push(`〈${r.recording.title}〉${r.recording.year ? `（${r.recording.year}` : ""}${r.recording.releaseGroup ? `${r.recording.year ? "，" : "（"}《${r.recording.releaseGroup.title}》` : ""}${r.recording.year || r.recording.releaseGroup ? "）" : ""}`);
  if (r.artist) {
    const tags = [...r.artist.genres, ...r.artist.tags].map((t) => t.name).filter((n, i, a) => a.indexOf(n) === i).slice(0, 3);
    parts.push(`${r.artist.name}${tags.length ? `（${tags.join("、")}）` : ""}`);
  }
  return parts.join("、");
}

/**
 * Ask MusicBrainz and Wikipedia about the song (in parallel, inside the budget). Never throws for
 * network problems; a cancelled caller gets whatever finished (the caller checks its signal).
 */
export async function lookupPublicInfo(q: { title: string; artist: string }, opts: LookupOptions = {}): Promise<PublicInfo> {
  const now = opts.now ?? (() => new Date());
  const cfg = sourceConfig(opts.env);
  const base: PublicInfo = {
    version: 1,
    query: q,
    fetchedAt: now().toISOString(),
    musicbrainz: null,
    wikipedia: null,
    status: { musicbrainz: "skipped", wikipedia: "skipped" },
    notes: [],
  };
  if (!cfg.enabled) return { ...base, notes: ["公開資料查詢已關閉（LIVELYRICS_FREE_SOURCES=off），只分析歌詞與音訊。"] };
  if (!q.title || !q.artist) return { ...base, notes: [`${!q.artist ? "沒有樂團名稱" : "沒有歌名"}，無法確認公開資料說的是同一首歌，已略過 MusicBrainz 與維基百科。`] };
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const budget = AbortSignal.timeout(opts.budgetMs ?? FREE_LOOKUP_BUDGET_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, budget]) : budget;
  const emit = (e: LookupEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      /* a UI callback never breaks the lookup */
    }
  };
  const common = { fetch: fetchImpl, signal, timeoutMs: opts.timeoutMs };

  emit({ kind: "start", source: "musicbrainz", query: `${q.title} ${q.artist}` });
  emit({ kind: "start", source: "wikipedia", query: `${q.artist}〈${q.title}〉` });
  const [mb, wp] = await Promise.all([
    lookupMusicBrainz(q, { ...common, base: cfg.musicbrainzUrl, gapMs: opts.musicbrainzGapMs, gate: opts.musicbrainzGate }).then((r) => {
      emit({ kind: "done", source: "musicbrainz", status: r.status, summary: r.status === "ok" ? describeMb(r) : r.notes[0] ?? "沒有資料" });
      return r;
    }),
    lookupWikipedia(q, { ...common, base: cfg.wikipediaUrl }).then((r) => {
      emit({ kind: "done", source: "wikipedia", status: r.status, summary: r.status === "ok" ? [r.artist?.title, r.song?.title].filter(Boolean).join("、") : r.notes[0] ?? "沒有條目" });
      return r;
    }),
  ]);
  const timedOut = budget.aborted && !opts.signal?.aborted;
  return {
    ...base,
    musicbrainz: mb.status === "ok" ? { recording: mb.recording, artist: mb.artist } : null,
    wikipedia: wp.status === "ok" ? { artist: wp.artist, song: wp.song } : null,
    status: { musicbrainz: mb.status, wikipedia: wp.status },
    notes: [...(timedOut ? [`公開資料查詢超過 ${Math.round((opts.budgetMs ?? FREE_LOOKUP_BUDGET_MS) / 1000)} 秒，只用已經拿到的部分。`] : []), ...mb.notes, ...wp.notes].slice(0, 8),
  };
}

// ---------------------------------------------------------------------------
// reading a stored lookup (project files are untrusted input)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const STATUSES: readonly SourceStatus[] = ["ok", "none", "failed", "skipped"];

function tags(v: unknown): MbTag[] {
  return (Array.isArray(v) ? v : [])
    .filter(isObj)
    .map((t) => ({ name: s(t.name, 60), count: typeof t.count === "number" && Number.isFinite(t.count) ? t.count : 0 }))
    .filter((t) => t.name && t.count > 0)
    .slice(0, 12);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function page(v: unknown): WikiPage | null {
  if (!isObj(v)) return null;
  const url = s(v.url, 600);
  const title = s(v.title, 300);
  if (!title || !/^https?:\/\//.test(url)) return null;
  const p: WikiPage = { lang: v.lang === "en" ? "en" : "zh", title, extract: s(v.extract, 1200), url };
  const d = s(v.description, 200);
  if (d) p.description = d;
  return p;
}

function recording(v: unknown): MbRecordingInfo | null {
  if (!isObj(v) || !s(v.id, 64) || !s(v.title, 200)) return null;
  const r: MbRecordingInfo = { id: s(v.id, 64), title: s(v.title, 200), tags: tags(v.tags) };
  const date = s(v.firstReleaseDate, 10);
  if (date) r.firstReleaseDate = date;
  const year = num(v.year);
  if (year) r.year = year;
  if (isObj(v.releaseGroup) && s(v.releaseGroup.id, 64)) r.releaseGroup = { id: s(v.releaseGroup.id, 64), title: s(v.releaseGroup.title, 200), ...(s(v.releaseGroup.type, 40) ? { type: s(v.releaseGroup.type, 40) } : {}) };
  const length = num(v.length);
  if (length) r.length = length;
  return r;
}

function artist(v: unknown): MbArtistInfo | null {
  if (!isObj(v) || !s(v.id, 64) || !s(v.name, 120)) return null;
  const a: MbArtistInfo = {
    id: s(v.id, 64),
    name: s(v.name, 120),
    genres: tags(v.genres),
    tags: tags(v.tags),
    links: (Array.isArray(v.links) ? v.links : [])
      .filter(isObj)
      .map((l) => ({ type: s(l.type, 40), url: s(l.url, 400) }))
      .filter((l) => l.type && /^https?:\/\//.test(l.url))
      .slice(0, 8),
  };
  for (const k of ["sortName", "type", "country", "area", "disambiguation"] as const) {
    const val = s(v[k], 200);
    if (val) a[k] = val;
  }
  const begin = num(v.beginYear);
  if (begin) a.beginYear = begin;
  return a;
}

/** A stored lookup, repaired field by field; null when it is not one. */
export function coercePublicInfo(raw: unknown): PublicInfo | null {
  if (!isObj(raw) || !isObj(raw.query) || !isObj(raw.status)) return null;
  const st = (v: unknown): SourceStatus => (STATUSES.includes(v as SourceStatus) ? (v as SourceStatus) : "skipped");
  const mb = isObj(raw.musicbrainz) ? { recording: recording(raw.musicbrainz.recording), artist: artist(raw.musicbrainz.artist) } : null;
  const wp = isObj(raw.wikipedia) ? { artist: page(raw.wikipedia.artist), song: page(raw.wikipedia.song) } : null;
  return {
    version: 1,
    query: { title: s(raw.query.title, 200), artist: s(raw.query.artist, 200) },
    fetchedAt: s(raw.fetchedAt, 40),
    musicbrainz: mb && (mb.recording || mb.artist) ? mb : null,
    wikipedia: wp && (wp.artist || wp.song) ? wp : null,
    status: { musicbrainz: st(raw.status.musicbrainz), wikipedia: st(raw.status.wikipedia) },
    notes: (Array.isArray(raw.notes) ? raw.notes : []).filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 300)).slice(0, 8),
  };
}
