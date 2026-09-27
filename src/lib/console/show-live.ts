// The show console (演出控制台, /s/[id]/live) without a browser: which item is on air, which one
// is armed for GO (QLab's "standing by"), the standby panic target, the rail rows, the readiness
// summary before a show starts, and the tab-local session that lets a reloaded console tab come
// back to the same item. Pure; the ShowLiveController (show-controller.ts) drives it.

import { ARC_ROLE_INFO, LOOK_KIND_INFO, defaultLook, itemSeconds, songStatus, type SongStatus } from "@/lib/show";
import type { ArcRole, Band, LookItemKind, ProjectSummary, SetItem, SetItemKind, Show } from "@/lib/types";

type LookItem = Extract<SetItem, { kind: LookItemKind }>;

/** The standby look used when the show has none of its own (never a real item id: those are [a-z0-9]). */
export const AUTO_STANDBY_ID = "auto-standby";

/** After a take, GO waits this long (double-GO protection; the fade through black is as long). */
export const GO_LOCK_MS = 800;

export type TakeTransition = "fade" | "cut";

export interface LiveState {
  /** item on air (null before the first GO) */
  current: string | null;
  /** item GO takes next (null at the end of the setlist) */
  armed: string | null;
  /** epoch ms of the current take */
  takenAt: number | null;
}

export function initialLive(items: readonly SetItem[]): LiveState {
  return { current: null, armed: items[0]?.id ?? null, takenAt: null };
}

function indexOfItem(items: readonly SetItem[], id: string | null): number {
  return id == null ? -1 : items.findIndex((i) => i.id === id);
}

/** The item after `id` in the setlist, or null (the last one, or not in the list). */
export function itemAfter(items: readonly SetItem[], id: string | null): string | null {
  const i = indexOfItem(items, id);
  return i >= 0 && i + 1 < items.length ? items[i + 1].id : null;
}

/** Arm an item for GO (a click in the rail). Unknown ids leave the state as it is. */
export function arm(live: LiveState, items: readonly SetItem[], id: string | null): LiveState {
  if (id != null && indexOfItem(items, id) < 0 && id !== AUTO_STANDBY_ID) return live;
  return id === live.armed ? live : { ...live, armed: id };
}

/** Put `id` on air: the item after it is armed next. */
export function take(live: LiveState, items: readonly SetItem[], id: string, now: number): LiveState {
  return { current: id, armed: itemAfter(items, id), takenAt: now };
}

/** GO: take the armed item. Null when nothing is armed (past the end of the setlist). */
export function go(live: LiveState, items: readonly SetItem[], now: number): LiveState | null {
  if (live.armed == null) return null;
  if (live.armed !== AUTO_STANDBY_ID && indexOfItem(items, live.armed) < 0) return null;
  return take(live, items, live.armed, now);
}

/**
 * Standby (S): put the standby look on air. What was armed stays armed (usually the next song:
 * the band may just skip ahead; the song that fell apart is one click away in the rail), unless
 * the standby itself was armed, then the item after it is. Null when standby is already on air.
 */
export function takeStandby(live: LiveState, items: readonly SetItem[], standbyId: string, now: number): LiveState | null {
  if (live.current === standbyId) return null;
  const armed = live.armed != null && live.armed !== standbyId ? live.armed : itemAfter(items, standbyId);
  return { current: standbyId, armed, takenAt: now };
}

/** The show's standby: its first standby item, else a standby look made from the band's bible. */
export function standbyItem(show: Pick<Show, "items">, band: Pick<Band, "name" | "bible" | "assets"> | null): LookItem {
  const own = show.items.find((i): i is LookItem => i.kind === "standby");
  if (own) return own;
  return { id: AUTO_STANDBY_ID, kind: "standby", title: LOOK_KIND_INFO.standby.defaultTitle, look: defaultLook("standby", band?.bible, band?.name ?? "", band?.assets ?? []) };
}

/** A restored state that still fits the setlist (items can change between a reload and now). */
export function reconcileLive(live: LiveState, items: readonly SetItem[]): LiveState {
  const known = (id: string | null) => id != null && (id === AUTO_STANDBY_ID || indexOfItem(items, id) >= 0);
  const current = known(live.current) ? live.current : null;
  const armed = known(live.armed) ? live.armed : current ? itemAfter(items, current) : (items[0]?.id ?? null);
  return { current, armed, takenAt: current ? live.takenAt : null };
}

// ---------------------------------------------------------------------------
// rail rows and readiness
// ---------------------------------------------------------------------------

export interface RailItem {
  id: string;
  kind: SetItemKind;
  title: string;
  /** songs: the project; looks: undefined */
  projectId?: string;
  /** 1-based number among the songs */
  songNumber: number | null;
  /** planned length (seconds), null when unknown / open-ended */
  seconds: number | null;
  /** songs only */
  status: SongStatus | null;
  arcRole: ArcRole | null;
  /** a few colours: the song's palette or the look's colorway */
  swatch: string[];
  /** looks: the text on screen */
  text?: string;
}

export function railItems(show: Pick<Show, "items" | "arc">, songs: ReadonlyMap<string, ProjectSummary>): RailItem[] {
  let n = 0;
  return show.items.map((item) => {
    if (item.kind === "song") {
      n++;
      const song = songs.get(item.projectId);
      const note = show.arc?.songs.find((s) => s.itemId === item.id);
      return {
        id: item.id,
        kind: "song",
        title: song?.title || "作品已刪除",
        projectId: item.projectId,
        songNumber: n,
        seconds: itemSeconds(item, songs),
        status: songStatus(song),
        arcRole: note?.role ?? null,
        swatch: (song?.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3),
      };
    }
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      songNumber: null,
      seconds: itemSeconds(item, songs),
      status: null,
      arcRole: null,
      swatch: [...item.look.colorway],
      ...(item.look.text ? { text: item.look.text } : {}),
    };
  });
}

export interface ReadinessIssue {
  itemId: string;
  title: string;
  status: SongStatus;
}

/** Songs of the setlist that are not ready for the stage (the 「開始演出」 summary). */
export function readinessIssues(items: readonly SetItem[], songs: ReadonlyMap<string, Pick<ProjectSummary, "title" | "status" | "hasPlan" | "lyricLines">>): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  for (const item of items) {
    if (item.kind !== "song") continue;
    const song = songs.get(item.projectId);
    const status = songStatus(song);
    if (status !== "ready") out.push({ itemId: item.id, title: song?.title || "作品已刪除", status });
  }
  return out;
}

/** 「開場」 etc. for a rail row. */
export function arcRoleLabel(role: ArcRole | null): string | null {
  return role ? ARC_ROLE_INFO[role].label : null;
}

// ---------------------------------------------------------------------------
// the tab session (crash recovery) and per-show preferences
// ---------------------------------------------------------------------------

export interface ShowLivePrefs {
  transition: TakeTransition;
  /** 「GO 後自動播放」: a song taken in TRACK starts playing at once */
  autoPlay: boolean;
}

export const DEFAULT_PREFS: ShowLivePrefs = { transition: "fade", autoPlay: false };

export interface ShowLiveSession extends LiveState, ShowLivePrefs {}

export const showLiveKey = (showId: string) => `livelyrics:show-live:${showId}`;
export const showPrefsKey = (showId: string) => `livelyrics:show-live-prefs:${showId}`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const itemId = (v: unknown): string | null => (typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v) ? v : null);

export function parsePrefs(raw: unknown, fallback: ShowLivePrefs = DEFAULT_PREFS): ShowLivePrefs {
  const d = isRecord(raw) ? raw : {};
  return {
    transition: d.transition === "cut" || d.transition === "fade" ? d.transition : fallback.transition,
    autoPlay: typeof d.autoPlay === "boolean" ? d.autoPlay : fallback.autoPlay,
  };
}

/** A stored session, repaired; null when there is none or it is garbage. */
export function parseShowLiveSession(raw: string | null | undefined): ShowLiveSession | null {
  if (!raw) return null;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(d)) return null;
  const current = itemId(d.current);
  const takenAt = typeof d.takenAt === "number" && Number.isFinite(d.takenAt) && d.takenAt > 0 ? d.takenAt : null;
  return { current, armed: itemId(d.armed), takenAt: current ? takenAt : null, ...parsePrefs(d) };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(kind: "session" | "local"): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function loadShowLiveSession(showId: string, store: StorageLike | null = storage("session")): ShowLiveSession | null {
  try {
    return store ? parseShowLiveSession(store.getItem(showLiveKey(showId))) : null;
  } catch {
    return null;
  }
}

export function saveShowLiveSession(showId: string, session: ShowLiveSession, store: StorageLike | null = storage("session")): void {
  try {
    store?.setItem(showLiveKey(showId), JSON.stringify(session));
  } catch {
    /* quota / blocked: the show goes on */
  }
}

/** The toggles are remembered per show (localStorage) beyond this tab's session. */
export function loadPrefs(showId: string, store: StorageLike | null = storage("local")): ShowLivePrefs {
  try {
    const raw = store?.getItem(showPrefsKey(showId));
    return raw ? parsePrefs(JSON.parse(raw)) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(showId: string, prefs: ShowLivePrefs, store: StorageLike | null = storage("local")): void {
  try {
    store?.setItem(showPrefsKey(showId), JSON.stringify(prefs));
  } catch {
    /* blocked */
  }
}
