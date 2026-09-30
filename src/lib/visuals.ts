// 研究找到的素材 (phase 8): the band's real visual material collected during research — album /
// single cover (Cover Art Archive), official MV stills, key visual / tour poster, logo, past
// live-show photos. Pure (no DOM, no Node): limits, labels, the coercion of stored lists, the
// log line, the authorization note and the merge of a refreshed collection. Shared by the
// collector, the storage, the routes, the designer and the UI.

import { coerceAssets } from "./assets";
import { sanitizeMoodStats } from "./moodboard";
import type {
  Asset,
  CollectedVisual,
  MaterialAuthorization,
  VisualCandidate,
  VisualFinder,
  VisualKind,
  VisualProvenance,
} from "./types";

/** At most this many collected images per song. */
export const MAX_COLLECTED = 8;
/** A collected image file may be at most this large. */
export const MAX_COLLECTED_BYTES = 8 * 1024 * 1024;
/** Dismissed keys kept per song. */
export const MAX_DISMISSED = 64;
/** Candidates kept from Claude's list. */
export const MAX_CANDIDATES = 12;

export const VISUAL_KINDS: readonly VisualKind[] = ["cover", "mv", "keyvisual", "logo", "live"];

export const VISUAL_KIND_LABEL: Record<VisualKind, string> = {
  cover: "專輯封面",
  mv: "MV 畫面",
  keyvisual: "主視覺",
  logo: "標誌",
  live: "現場照片",
};

export const VISUAL_FINDER_LABEL: Record<VisualFinder, string> = {
  "cover-art-archive": "Cover Art Archive",
  claude: "Claude 搜尋",
  youtube: "YouTube",
  page: "官方頁面",
};

/** Words of other languages / spellings that name a kind (Claude's list, loose input). */
const KIND_ALIASES: Array<[RegExp, VisualKind]> = [
  [/^(cover|album|single|artwork|jacket|封面|專輯)/i, "cover"],
  [/^(mv|music ?video|video|youtube|影片)/i, "mv"],
  [/^(key ?visual|keyvisual|kv|poster|tour|海報|主視覺)/i, "keyvisual"],
  [/^(logo|標誌|字標)/i, "logo"],
  [/^(live|concert|stage|photo|現場|演出)/i, "live"],
];

export function visualKind(v: unknown): VisualKind | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if ((VISUAL_KINDS as readonly string[]).includes(t)) return t as VisualKind;
  for (const [re, kind] of KIND_ALIASES) if (re.test(t)) return kind;
  return null;
}

// ---------------------------------------------------------------------------
// authorization
// ---------------------------------------------------------------------------

export const AUTHORIZATION_NOTE = "樂團已授權使用自己的專輯封面、MV 畫面、主視覺、標誌與現場照片做為舞台素材。";

export function authorizationText(auth: MaterialAuthorization | null | undefined): string {
  if (!auth) return "尚未確認樂團授權：只當設計參考，不上台";
  const day = auth.at.slice(0, 10);
  return `${auth.note || AUTHORIZATION_NOTE}（${day} 確認）`;
}

export function coerceAuthorization(raw: unknown): MaterialAuthorization | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.at !== "string" || !Number.isFinite(Date.parse(o.at))) return undefined;
  return { at: o.at.slice(0, 40), note: typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 300) : AUTHORIZATION_NOTE };
}

// ---------------------------------------------------------------------------
// stored lists (project files are untrusted input)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const FINDERS: readonly VisualFinder[] = ["cover-art-archive", "claude", "youtube", "page"];

/** An http(s) URL (kept as text, ≤ 1000 chars), or "" */
export function httpUrl(v: unknown): string {
  const s = str(v, 1000);
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    return new URL(s).href.slice(0, 1000);
  } catch {
    return "";
  }
}

function provenance(v: unknown): VisualProvenance | null {
  if (!isObj(v)) return null;
  const kind = visualKind(v.kind);
  const imageUrl = httpUrl(v.imageUrl);
  if (!kind || !imageUrl) return null;
  const p: VisualProvenance = {
    kind,
    imageUrl,
    foundBy: FINDERS.includes(v.foundBy as VisualFinder) ? (v.foundBy as VisualFinder) : "claude",
    fetchedAt: str(v.fetchedAt, 40),
    authorization: str(v.authorization, 300) || authorizationText(null),
  };
  const sourceUrl = httpUrl(v.sourceUrl);
  if (sourceUrl) p.sourceUrl = sourceUrl;
  const why = str(v.why, 300);
  if (why) p.why = why;
  const title = str(v.title, 200);
  if (title) p.title = title;
  return p;
}

/** The stored collection, repaired item by item (images only, ≤ MAX_COLLECTED). */
export function coerceCollected(raw: unknown): CollectedVisual[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, Obj>();
  for (const item of raw) if (isObj(item) && typeof item.id === "string") byId.set(item.id, item);
  const out: CollectedVisual[] = [];
  for (const a of coerceAssets(raw)) {
    const src = byId.get(a.id);
    const prov = provenance(src?.provenance);
    if (!src || !prov || a.kind === "video" || !a.mimeType.startsWith("image/")) continue;
    const item: CollectedVisual = {
      ...a,
      kind: prov.kind === "logo" ? "logo" : "image",
      provenance: prov,
      use: src.use === "stage" ? "stage" : "reference",
      useSetBy: src.useSetBy === "user" ? "user" : "auto",
      hash: /^[0-9a-f]{8,64}$/.test(String(src.hash)) ? String(src.hash) : a.id,
    };
    delete item.scope;
    delete item.tags;
    const stats = sanitizeMoodStats(src.stats);
    if (stats) item.stats = stats;
    else delete item.stats;
    out.push(item);
    if (out.length >= MAX_COLLECTED) break;
  }
  return out;
}

export function coerceDismissed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 1000).slice(-MAX_DISMISSED);
}

/** Claude's candidate list (from the research reply), repaired; unusable entries dropped. */
export function coerceCandidates(raw: unknown): VisualCandidate[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.images) ? raw.images : isObj(raw) && Array.isArray(raw.candidates) ? raw.candidates : [];
  const out: VisualCandidate[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!isObj(item)) continue;
    const kind = visualKind(item.kind ?? item.type);
    const pageUrl = httpUrl(item.pageUrl ?? item.page ?? item.url);
    const imageUrl = httpUrl(item.imageUrl ?? item.image ?? item.img);
    if (!kind || (!pageUrl && !imageUrl)) continue;
    const key = imageUrl || pageUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    const c: VisualCandidate = { kind };
    if (pageUrl) c.pageUrl = pageUrl;
    if (imageUrl) c.imageUrl = imageUrl;
    const why = str(item.why ?? item.reason, 300);
    if (why) c.why = why;
    const title = str(item.title ?? item.name, 200);
    if (title) c.title = title;
    out.push(c);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

/** Collected items that may appear on stage (as project-scope assets). */
export function stageCollected(list: readonly CollectedVisual[] | null | undefined): Asset[] {
  return (list ?? []).filter((c) => c && c.use === "stage");
}

export function isCollected(a: unknown): a is CollectedVisual {
  return isObj(a) && isObj(a.provenance) && typeof a.provenance.imageUrl === "string";
}

/** 「找到專輯封面、2 張 MV 畫面、1 張主視覺」 (null when the list is empty). */
export function collectedSummary(list: ReadonlyArray<{ provenance: { kind: VisualKind } } | { kind: VisualKind }>): string | null {
  const counts = new Map<VisualKind, number>();
  for (const item of list) {
    const kind = "provenance" in item ? item.provenance.kind : item.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const parts = VISUAL_KINDS.filter((k) => counts.has(k)).map((k) => {
    const n = counts.get(k)!;
    const unit = k === "logo" ? "個" : "張";
    const label = VISUAL_KIND_LABEL[k];
    return n === 1 && (k === "cover" || k === "logo") ? label : `${n} ${unit}${/^[A-Za-z]/.test(label) ? " " : ""}${label}`;
  });
  return `找到${parts.join("、")}`;
}

/** A display name for a collected image, e.g. 「專輯封面《醜奴兒》」 */
export function collectedName(kind: VisualKind, title?: string): string {
  const t = title?.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!t) return VISUAL_KIND_LABEL[kind];
  return kind === "cover" ? `${VISUAL_KIND_LABEL[kind]}《${t}》` : `${VISUAL_KIND_LABEL[kind]}：${t}`;
}

/** The keys that stop a removed item from coming back (its hash and its image URL). */
export function dismissKeys(item: Pick<CollectedVisual, "hash" | "provenance">): string[] {
  return [item.hash, item.provenance.imageUrl];
}

/**
 * A refreshed collection merged into the stored one: an item already stored (same hash or image
 * URL) keeps its id, file and the operator's choice; new items are appended (auto default); items
 * the operator removed stay out. Returns the next list, the items to keep and the stored items no
 * longer referenced (none: refreshing never drops what is there — only the operator removes).
 */
export function mergeCollection(current: readonly CollectedVisual[], incoming: readonly CollectedVisual[], dismissed: readonly string[]): { list: CollectedVisual[]; added: CollectedVisual[]; duplicates: CollectedVisual[] } {
  const list = [...current];
  const added: CollectedVisual[] = [];
  const duplicates: CollectedVisual[] = [];
  const gone = new Set(dismissed);
  for (const item of incoming) {
    const same = list.find((c) => c.hash === item.hash || c.provenance.imageUrl === item.provenance.imageUrl);
    if (same || gone.has(item.hash) || gone.has(item.provenance.imageUrl) || list.length >= MAX_COLLECTED) {
      duplicates.push(item);
      if (same) {
        // a refresh may bring better provenance (why / title) and a measured palette
        const at = list.indexOf(same);
        list[at] = {
          ...same,
          provenance: { ...same.provenance, why: same.provenance.why ?? item.provenance.why, title: same.provenance.title ?? item.provenance.title, sourceUrl: same.provenance.sourceUrl ?? item.provenance.sourceUrl },
          ...(same.stats ? {} : item.stats ? { stats: item.stats } : {}),
        };
      }
      continue;
    }
    list.push(item);
    added.push(item);
  }
  return { list, added, duplicates };
}

/** After the band authorized: items still on their automatic default go on stage. */
export function applyAuthorization(list: readonly CollectedVisual[]): CollectedVisual[] {
  return list.map((c) => (c.useSetBy === "auto" && c.use === "reference" ? { ...c, use: "stage" as const } : c));
}
