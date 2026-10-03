// MusicBrainz (https://musicbrainz.org/doc/MusicBrainz_API, fmt=json, no key): the recording and
// the artist of a song by title + artist — tags / genres, first release year, release group,
// country, area and artist type, plus the artist's official links.
//
// Lookup: a recording search (title AND artist); its best non-live match gives the artist id, else
// an artist search by name; then an artist lookup (inc=genres+tags+url-rels). At most three
// requests, spaced one second apart by the shared gate. A match must agree on the names, so an
// obscure band that is not in the database comes back as "nothing found", never as a stranger.

import { cleanTitle } from "@/lib/server/lrclib";
import type { MbArtistInfo, MbRecordingInfo, MbTag, SourceStatus } from "@/lib/types";
import { nameKey } from "@/lib/zh-variants";
import { getJson, musicBrainzGate, type RateGate, type RequestContext } from "./http";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Canonical page links (the source list cites these, whatever API mirror was asked). */
export const MUSICBRAINZ_SITE = "https://musicbrainz.org";

// ---------------------------------------------------------------------------
// query URLs
// ---------------------------------------------------------------------------

/** Inside a Lucene phrase only the quote and the backslash need escaping. */
function phrase(s: string): string {
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

export function recordingSearchUrl(base: string, title: string, artist: string): string {
  const query = `recording:${phrase(title)} AND artist:${phrase(artist)}`;
  return `${base}/recording?${new URLSearchParams({ query, fmt: "json", limit: "8" })}`;
}

export function artistSearchUrl(base: string, artist: string): string {
  return `${base}/artist?${new URLSearchParams({ query: `artist:${phrase(artist)}`, fmt: "json", limit: "5" })}`;
}

export function artistLookupUrl(base: string, id: string): string {
  return `${base}/artist/${encodeURIComponent(id)}?${new URLSearchParams({ inc: "genres+tags+url-rels", fmt: "json" })}`;
}

// ---------------------------------------------------------------------------
// parsers (real responses are the fixtures in fixtures/research/)
// ---------------------------------------------------------------------------

/** Tags / genres: hyphen-like characters normalized, non-positive votes dropped, most votes first. */
export function parseTags(v: unknown, max = 12): MbTag[] {
  const out: MbTag[] = [];
  for (const t of arr(v)) {
    if (!isObj(t)) continue;
    const name = str(t.name, 60)
      .toLowerCase()
      .replace(/[‐-―−_]/g, "-")
      .replace(/\s+/g, " ");
    const count = typeof t.count === "number" && Number.isFinite(t.count) ? t.count : 0;
    if (!name || count <= 0 || out.some((x) => x.name === name)) continue;
    out.push({ name, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, max);
}

export interface CreditArtist {
  id: string;
  name: string;
  sortName: string;
  aliases: string[];
}

export interface RecordingCandidate {
  id: string;
  title: string;
  score: number;
  artists: CreditArtist[];
  firstReleaseDate: string;
  disambiguation: string;
  releases: Array<{ title: string; status: string; date: string; releaseGroup: { id: string; title: string; type: string; secondary: string[] } | null }>;
  tags: MbTag[];
  length: number | null;
}

function creditArtists(v: unknown): CreditArtist[] {
  const out: CreditArtist[] = [];
  for (const c of arr(v)) {
    if (!isObj(c) || !isObj(c.artist)) continue;
    const a = c.artist;
    const id = str(a.id, 64);
    if (!id) continue;
    const aliases = arr(a.aliases)
      .map((x) => (isObj(x) ? str(x.name, 120) : ""))
      .filter(Boolean);
    const credited = str(c.name, 120);
    out.push({ id, name: str(a.name, 120) || credited, sortName: str(a["sort-name"], 120), aliases: credited && credited !== str(a.name, 120) ? [...aliases, credited] : aliases });
  }
  return out;
}

export function parseRecordingSearch(data: unknown): RecordingCandidate[] {
  if (!isObj(data)) return [];
  const out: RecordingCandidate[] = [];
  for (const r of arr(data.recordings)) {
    if (!isObj(r)) continue;
    const id = str(r.id, 64);
    const title = str(r.title, 200);
    if (!id || !title) continue;
    out.push({
      id,
      title,
      score: typeof r.score === "number" ? r.score : Number(r.score) || 0,
      artists: creditArtists(r["artist-credit"]),
      firstReleaseDate: str(r["first-release-date"], 10),
      disambiguation: str(r.disambiguation, 200),
      releases: arr(r.releases)
        .filter(isObj)
        .slice(0, 12)
        .map((rel) => {
          const g = isObj(rel["release-group"]) ? rel["release-group"] : null;
          return {
            title: str(rel.title, 200),
            status: str(rel.status, 40),
            date: str(rel.date, 10),
            releaseGroup: g ? { id: str(g.id, 64), title: str(g.title, 200), type: str(g["primary-type"], 40), secondary: arr(g["secondary-types"]).map((x) => str(x, 40)).filter(Boolean) } : null,
          };
        }),
      tags: parseTags(r.tags),
      length: typeof r.length === "number" && Number.isFinite(r.length) ? r.length : null,
    });
  }
  return out;
}

export interface ArtistCandidate {
  id: string;
  name: string;
  sortName: string;
  score: number;
  aliases: string[];
  type?: string;
  country?: string;
  area?: string;
  beginYear?: number;
  disambiguation?: string;
  tags: MbTag[];
}

function yearOf(v: unknown): number | undefined {
  const m = /^(\d{4})/.exec(str(v, 10));
  const y = m ? Number(m[1]) : NaN;
  return Number.isInteger(y) && y > 1800 && y < 2200 ? y : undefined;
}

function artistBasics(a: Obj): Omit<ArtistCandidate, "score" | "aliases"> {
  const out: Omit<ArtistCandidate, "score" | "aliases"> = { id: str(a.id, 64), name: str(a.name, 120), sortName: str(a["sort-name"], 120), tags: parseTags(a.tags) };
  const type = str(a.type, 40);
  if (type) out.type = type;
  const country = str(a.country, 4);
  if (country) out.country = country;
  const area = isObj(a.area) ? str(a.area.name, 80) : "";
  const beginArea = isObj(a["begin-area"]) ? str(a["begin-area"].name, 80) : "";
  if (beginArea || area) out.area = beginArea || area;
  const begin = yearOf(isObj(a["life-span"]) ? a["life-span"].begin : undefined);
  if (begin) out.beginYear = begin;
  const dis = str(a.disambiguation, 200).replace(/[‐-―]/g, "-");
  if (dis) out.disambiguation = dis;
  return out;
}

export function parseArtistSearch(data: unknown): ArtistCandidate[] {
  if (!isObj(data)) return [];
  const out: ArtistCandidate[] = [];
  for (const a of arr(data.artists)) {
    if (!isObj(a)) continue;
    const basics = artistBasics(a);
    if (!basics.id || !basics.name) continue;
    const aliases = arr(a.aliases)
      .map((x) => (isObj(x) ? str(x.name, 120) : ""))
      .filter(Boolean);
    out.push({ ...basics, score: typeof a.score === "number" ? a.score : Number(a.score) || 0, aliases });
  }
  return out;
}

/** Link types worth citing for a stage designer (MVs, live photos, official art), in order. */
const LINK_ORDER = ["official homepage", "youtube", "video channel", "bandcamp", "setlistfm", "soundcloud", "social network", "free streaming", "streaming"];

export function parseArtistLookup(data: unknown): MbArtistInfo | null {
  if (!isObj(data)) return null;
  const basics = artistBasics(data);
  if (!basics.id || !basics.name) return null;
  const links: Array<{ type: string; url: string }> = [];
  for (const r of arr(data.relations)) {
    if (!isObj(r) || !isObj(r.url)) continue;
    const type = str(r.type, 40).toLowerCase();
    const url = str(r.url.resource, 400);
    if (!/^https?:\/\//.test(url) || !LINK_ORDER.includes(type) || links.some((l) => l.url === url)) continue;
    links.push({ type, url });
  }
  links.sort((a, b) => LINK_ORDER.indexOf(a.type) - LINK_ORDER.indexOf(b.type));
  // at most two social / streaming links: the designer wants the MVs and the official site
  const kept: typeof links = [];
  for (const l of links) {
    const same = kept.filter((k) => k.type === l.type).length;
    if ((l.type === "social network" || l.type.includes("streaming")) && same >= 1) continue;
    kept.push(l);
    if (kept.length >= 6) break;
  }
  const info: MbArtistInfo = { id: basics.id, name: basics.name, genres: parseTags(data.genres), tags: basics.tags, links: kept };
  if (basics.sortName && basics.sortName !== basics.name) info.sortName = basics.sortName;
  if (basics.type) info.type = basics.type;
  if (basics.country) info.country = basics.country;
  if (basics.area) info.area = basics.area;
  if (basics.beginYear) info.beginYear = basics.beginYear;
  if (basics.disambiguation) info.disambiguation = basics.disambiguation;
  return info;
}

// ---------------------------------------------------------------------------
// artist kind
// ---------------------------------------------------------------------------

export type ArtistKind = "group" | "person" | "orchestra" | "choir" | "other" | "unknown";

/** MusicBrainz artist `type` → what kind of act this is (a solo singer is never 「樂團」). */
export function artistKind(type: string | null | undefined): ArtistKind {
  const t = (type ?? "").trim().toLowerCase();
  if (!t) return "unknown";
  if (t === "group") return "group";
  if (t === "person") return "person";
  if (t === "orchestra") return "orchestra";
  if (t === "choir") return "choir";
  return "other";
}

/** 繁中 noun for the kind: 樂團 / 歌手 / 管弦樂團 / 合唱團; 音樂人 when the type is unknown or a character / other. */
export const ARTIST_KIND_LABEL: Record<ArtistKind, string> = { group: "樂團", person: "歌手", orchestra: "管弦樂團", choir: "合唱團", other: "音樂人", unknown: "音樂人" };

export function artistKindLabel(type: string | null | undefined): string {
  return ARTIST_KIND_LABEL[artistKind(type)];
}

// ---------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------

/** Two names are the same when their keys are equal, or one contains the other and is most of it. */
export function namesMatch(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.includes(short) && short.length / long.length >= 0.6;
}

function titleMatches(candidate: string, title: string): boolean {
  if (namesMatch(candidate, title)) return true;
  const simple = cleanTitle(title);
  return simple !== title && namesMatch(cleanTitle(candidate), simple);
}

function artistNames(a: { name: string; sortName: string; aliases: string[] }): string[] {
  return [a.name, a.sortName, ...a.aliases].filter(Boolean);
}

const LIVE_RE = /\blive\b|現場|现场|演唱會|演唱会|remix|demo|instrumental|karaoke|伴奏|acoustic/i;

function isLive(r: RecordingCandidate): boolean {
  if (LIVE_RE.test(r.disambiguation)) return true;
  const groups = r.releases.map((x) => x.releaseGroup).filter((g) => g != null);
  return groups.length > 0 && groups.every((g) => g!.secondary.some((s) => /live|compilation|remix/i.test(s)));
}

/** The recording of this song by this artist: the names agree, studio before live, earliest first. */
export function pickRecording(cands: readonly RecordingCandidate[], title: string, artist: string): { recording: RecordingCandidate; artist: CreditArtist } | null {
  const ok = cands
    .filter((c) => c.score >= 70 && titleMatches(c.title, title))
    .map((c) => ({ c, a: c.artists.find((x) => artistNames(x).some((n) => namesMatch(n, artist))) }))
    .filter((x): x is { c: RecordingCandidate; a: CreditArtist } => x.a != null);
  if (!ok.length) return null;
  ok.sort((p, q) => {
    const live = Number(isLive(p.c)) - Number(isLive(q.c));
    if (live) return live;
    const pd = p.c.firstReleaseDate || "9999";
    const qd = q.c.firstReleaseDate || "9999";
    if (pd !== qd) return pd < qd ? -1 : 1;
    return q.c.score - p.c.score;
  });
  return { recording: ok[0].c, artist: ok[0].a };
}

export function pickArtist(cands: readonly ArtistCandidate[], artist: string): ArtistCandidate | null {
  return cands.filter((c) => c.score >= 85 && artistNames(c).some((n) => namesMatch(n, artist))).sort((a, b) => b.score - a.score)[0] ?? null;
}

/** The stored recording facts (release group of the first release, its year). */
export function recordingInfo(r: RecordingCandidate): MbRecordingInfo {
  const first = r.releases.find((x) => x.date && x.date === r.firstReleaseDate && x.status === "Official") ?? r.releases.find((x) => x.status === "Official") ?? r.releases[0];
  const info: MbRecordingInfo = { id: r.id, title: r.title, tags: r.tags };
  if (r.firstReleaseDate) {
    info.firstReleaseDate = r.firstReleaseDate;
    const y = yearOf(r.firstReleaseDate);
    if (y) info.year = y;
  }
  if (first?.releaseGroup?.id) info.releaseGroup = { id: first.releaseGroup.id, title: first.releaseGroup.title, ...(first.releaseGroup.type ? { type: first.releaseGroup.type } : {}) };
  if (r.length) info.length = r.length;
  return info;
}

function fromCandidate(c: ArtistCandidate): MbArtistInfo {
  const info: MbArtistInfo = { id: c.id, name: c.name, genres: [], tags: c.tags, links: [] };
  if (c.sortName && c.sortName !== c.name) info.sortName = c.sortName;
  if (c.type) info.type = c.type;
  if (c.country) info.country = c.country;
  if (c.area) info.area = c.area;
  if (c.beginYear) info.beginYear = c.beginYear;
  if (c.disambiguation) info.disambiguation = c.disambiguation;
  return info;
}

// ---------------------------------------------------------------------------
// lookup
// ---------------------------------------------------------------------------

export interface MusicBrainzResult {
  status: SourceStatus;
  recording: MbRecordingInfo | null;
  artist: MbArtistInfo | null;
  notes: string[];
}

export interface MusicBrainzContext extends RequestContext {
  base: string;
  gate?: RateGate;
  /** spacing override for tests (the real gate spaces requests 1.1 s apart) */
  gapMs?: number;
}

export async function lookupMusicBrainz(q: { title: string; artist: string }, ctx: MusicBrainzContext): Promise<MusicBrainzResult> {
  const gate = ctx.gate ?? musicBrainzGate;
  const get = async (url: string) => {
    await gate.wait(ctx.signal, ctx.gapMs);
    return getJson(url, ctx);
  };
  const notes: string[] = [];
  let recording: MbRecordingInfo | null = null;
  let artist: MbArtistInfo | null = null;
  let artistId: string | null = null;
  let candidate: ArtistCandidate | null = null;

  const rec = await get(recordingSearchUrl(ctx.base, q.title, q.artist));
  if (!rec.ok) return { status: "failed", recording: null, artist: null, notes: [`MusicBrainz 查詢失敗：${rec.error}`] };
  const picked = pickRecording(parseRecordingSearch(rec.data), q.title, q.artist);
  if (picked) {
    recording = recordingInfo(picked.recording);
    artistId = picked.artist.id;
  } else {
    notes.push("MusicBrainz 沒有這首歌的錄音資料");
    const search = await get(artistSearchUrl(ctx.base, q.artist));
    if (!search.ok) notes.push(`MusicBrainz 樂團查詢失敗：${search.error}`);
    else {
      candidate = pickArtist(parseArtistSearch(search.data), q.artist);
      artistId = candidate?.id ?? null;
      if (!candidate) notes.push("MusicBrainz 也查不到這個樂團");
    }
  }
  if (artistId) {
    const lookup = await get(artistLookupUrl(ctx.base, artistId));
    if (lookup.ok) artist = parseArtistLookup(lookup.data);
    else notes.push(`MusicBrainz 樂團資料讀取失敗：${lookup.error}`);
    // the search result still says who they are
    if (!artist && candidate) artist = fromCandidate(candidate);
  }
  return { status: recording || artist ? "ok" : "none", recording, artist, notes };
}

export function musicBrainzUrl(kind: "recording" | "artist" | "release-group", id: string): string {
  return `${MUSICBRAINZ_SITE}/${kind}/${encodeURIComponent(id)}`;
}
