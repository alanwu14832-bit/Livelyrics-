// Wikipedia (REST, no key): the lead summary of the artist's page and, when one exists, the song's.
// Chinese first — zh.wikipedia with `Accept-Language: zh-TW`, which the REST API answers in the
// Taiwan variant — then English when zh has no page for the artist.
//
// Per language: one full-text search (`/w/rest.php/v1/search/page`, "title artist"), whose results
// usually hold both pages; the artist's page is taken from it or read directly by its name; the
// song's page must mention the artist. At most four requests a language. A page has to look like
// a musician's (樂團, 歌手, band, singer…) so a same-named person or place is never used.

import type { SourceStatus, WikiPage } from "@/lib/types";
import { nameKey, toTraditional } from "@/lib/zh-variants";
import { getJson, type RequestContext } from "./http";
import { namesMatch } from "./musicbrainz";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export type WikiLang = "zh" | "en";

/** Stored extracts are the lead paragraph, clipped. */
export const MAX_EXTRACT = 700;

function host(base: string, lang: WikiLang): string {
  return base.replace("{lang}", lang);
}

function headers(lang: WikiLang): Record<string, string> {
  return lang === "zh" ? { "Accept-Language": "zh-TW" } : { "Accept-Language": "en" };
}

export function summaryUrl(base: string, lang: WikiLang, title: string): string {
  return `${host(base, lang)}/api/rest_v1/page/summary/${encodeURIComponent(title.trim().replace(/ /g, "_"))}`;
}

export function searchUrl(base: string, lang: WikiLang, q: string, limit = 8): string {
  return `${host(base, lang)}/w/rest.php/v1/search/page?${new URLSearchParams({ q, limit: String(limit) })}`;
}

export interface SearchHit {
  key: string;
  title: string;
  description: string;
  excerpt: string;
}

export function parseSearch(data: unknown): SearchHit[] {
  if (!isObj(data) || !Array.isArray(data.pages)) return [];
  const out: SearchHit[] = [];
  for (const p of data.pages) {
    if (!isObj(p)) continue;
    const key = str(p.key, 300);
    const title = str(p.title, 300);
    if (!key || !title) continue;
    out.push({ key, title, description: str(p.description, 300), excerpt: str(p.excerpt, 600).replace(/<[^>]*>/g, "") });
  }
  return out;
}

export type SummaryResult = { kind: "page"; page: WikiPage } | { kind: "disambiguation" } | { kind: "none" };

/** A REST page summary: standard pages only (disambiguation and empty pages are "no page"). */
export function parseSummary(data: unknown, lang: WikiLang): SummaryResult {
  if (!isObj(data)) return { kind: "none" };
  const type = str(data.type, 40);
  if (type === "disambiguation") return { kind: "disambiguation" };
  if (type && type !== "standard") return { kind: "none" };
  const title = str(data.title, 300);
  const extract = str(data.extract, 4000).replace(/\s+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
  const urls = isObj(data.content_urls) && isObj(data.content_urls.desktop) ? data.content_urls.desktop : null;
  const url = str(urls?.page, 600);
  if (!title || !extract || !/^https?:\/\//.test(url)) return { kind: "none" };
  const page: WikiPage = { lang, title, extract: extract.length > MAX_EXTRACT ? `${extract.slice(0, MAX_EXTRACT - 1)}…` : extract, url };
  const description = str(data.description, 200);
  if (description) page.description = description;
  return { kind: "page", page };
}

const MUSICIAN_RE = /樂團|樂隊|乐队|乐团|歌手|音樂人|音乐人|音樂家|組合|组合|樂手|唱作|饒舌|說唱|嘻哈歌手|製作人|團體|女團|男團|偶像|band|singer|musician|rapper|songwriter|composer|duo|trio|group|orchestra|dj\b|producer|vocalist/i;
const SONG_RE = /歌曲|單曲|单曲|專輯|专辑|主題曲|主题曲|插曲|song|single|track|album/i;

function plainTitle(title: string): string {
  return title.replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
}

function textOf(p: { description?: string; extract?: string; excerpt?: string }): string {
  return toTraditional(`${p.description ?? ""} ${p.extract ?? p.excerpt ?? ""}`);
}

/** The page is about a musician or a band. */
export function looksMusical(p: { description?: string; extract?: string; excerpt?: string }): boolean {
  return MUSICIAN_RE.test(textOf(p).slice(0, 400));
}

/** The page's text names this artist. */
export function mentionsArtist(p: { description?: string; extract?: string; excerpt?: string; title?: string }, artist: string): boolean {
  const key = nameKey(artist);
  return key.length >= 2 && nameKey(`${p.title ?? ""} ${textOf(p)}`).includes(key);
}

/** The artist's page among search hits: its title (without "(樂團)") is the artist's name. */
export function pickArtistHit(hits: readonly SearchHit[], artist: string): SearchHit | null {
  return hits.find((h) => namesMatch(plainTitle(h.title), artist) && (looksMusical(h) || !h.description)) ?? null;
}

/** The song's page among search hits: titled like the song, a song, and naming this artist. */
export function pickSongHit(hits: readonly SearchHit[], title: string, artist: string): SearchHit | null {
  return hits.find((h) => namesMatch(plainTitle(h.title), title) && !namesMatch(plainTitle(h.title), artist) && SONG_RE.test(textOf(h)) && mentionsArtist(h, artist)) ?? null;
}

export interface WikipediaResult {
  status: SourceStatus;
  artist: WikiPage | null;
  song: WikiPage | null;
  notes: string[];
}

export interface WikipediaContext extends RequestContext {
  base: string;
  langs?: readonly WikiLang[];
}

async function summary(ctx: WikipediaContext, lang: WikiLang, title: string): Promise<{ result: SummaryResult; error?: string }> {
  const r = await getJson(summaryUrl(ctx.base, lang, title), ctx, headers(lang));
  if (r.ok) return { result: parseSummary(r.data, lang) };
  return r.status === 404 ? { result: { kind: "none" } } : { result: { kind: "none" }, error: r.error };
}

export async function lookupWikipedia(q: { title: string; artist: string }, ctx: WikipediaContext): Promise<WikipediaResult> {
  const notes: string[] = [];
  let failures = 0;
  let asked = 0;
  for (const lang of ctx.langs ?? (["zh", "en"] as const)) {
    const label = lang === "zh" ? "中文維基百科" : "英文維基百科";
    asked++;
    const search = await getJson(searchUrl(ctx.base, lang, `${q.title} ${q.artist}`.trim()), ctx, headers(lang));
    const hits = search.ok ? parseSearch(search.data) : [];
    if (!search.ok) notes.push(`${label}搜尋失敗：${search.error}`);

    let artist: WikiPage | null = null;
    const artistHit = pickArtistHit(hits, q.artist);
    const songHit = pickSongHit(hits, q.title, q.artist);
    const [a, s] = await Promise.all([summary(ctx, lang, artistHit?.key ?? q.artist), songHit ? summary(ctx, lang, songHit.key) : Promise.resolve(null)]);
    if (a.error) notes.push(`${label}讀取失敗：${a.error}`);
    // a page read by the artist's name may be a redirect target (an alias, the other script): the
    // exact-title lookup is the match, as long as the page is about a musician
    if (a.result.kind === "page" && looksMusical(a.result.page) && (!artistHit || namesMatch(plainTitle(a.result.page.title), q.artist))) artist = a.result.page;
    let song: WikiPage | null = null;
    const names = [q.artist, ...(artist ? [plainTitle(artist.title)] : [])];
    const songPage = s?.result.kind === "page" ? s.result.page : null;
    if (songPage && names.some((n) => mentionsArtist(songPage, n))) song = songPage;
    if (!search.ok && a.error) failures++;
    if (artist || song) return { status: "ok", artist, song, notes };
  }
  return { status: failures >= asked ? "failed" : "none", artist: null, song: null, notes };
}
