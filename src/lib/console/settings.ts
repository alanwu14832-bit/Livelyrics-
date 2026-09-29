// Per-project console preferences persisted in localStorage (best effort: private
// windows / blocked storage just fall back to defaults).

import type { PlaybackMode } from "@/lib/stage/protocol";
import { DEFAULT_SYNC_SETTINGS, parseSyncSettings, type SyncSettings } from "@/lib/sync/settings";

export interface ConsoleSettings {
  mode: PlaybackMode;
  /** seconds added to the audio time (positive = lyrics earlier) */
  offset: number;
  playbackRate: number;
  /** monitor volume 0..1 */
  volume: number;
  muted: boolean;
  /** preferred microphone / line-in for live mode ("" = default device) */
  micDeviceId: string;
  /** 同步 (phase 5a): the sync source, the LTC input and the freewheel time for this song */
  sync: SyncSettings;
}

export const OFFSET_LIMIT = 10;
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25] as const;

export function defaultSettings(mode: PlaybackMode = "track"): ConsoleSettings {
  return { mode, offset: 0, playbackRate: 1, volume: 1, muted: false, micDeviceId: "", sync: { ...DEFAULT_SYNC_SETTINGS } };
}

export function settingsKey(projectId: string): string {
  return `livelyrics:console:${projectId}`;
}

export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  const clamped = Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, offset));
  // keep the value on a 1 ms grid so repeated ±0.05 steps do not accumulate float noise
  return Math.round(clamped * 1000) / 1000;
}

/** Parse stored JSON defensively; anything missing or invalid falls back to `defaults`. */
export function parseSettings(raw: string | null | undefined, defaults: ConsoleSettings): ConsoleSettings {
  if (!raw) return { ...defaults };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...defaults };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ...defaults };
  const d = data as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    mode: d.mode === "live" || d.mode === "track" ? d.mode : defaults.mode,
    offset: typeof d.offset === "number" ? clampOffset(d.offset) : defaults.offset,
    playbackRate: (PLAYBACK_RATES as readonly number[]).includes(d.playbackRate as number)
      ? (d.playbackRate as number)
      : defaults.playbackRate,
    volume: num(d.volume, 0, 1, defaults.volume),
    muted: typeof d.muted === "boolean" ? d.muted : defaults.muted,
    micDeviceId: typeof d.micDeviceId === "string" && d.micDeviceId.length < 512 ? d.micDeviceId : defaults.micDeviceId,
    sync: d.sync !== undefined ? parseSyncSettings(d.sync) : { ...defaults.sync },
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(projectId: string, defaults: ConsoleSettings, store: StorageLike | null = storage()): ConsoleSettings {
  if (!store) return { ...defaults };
  try {
    return parseSettings(store.getItem(settingsKey(projectId)), defaults);
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(projectId: string, settings: ConsoleSettings, store: StorageLike | null = storage()): void {
  if (!store) return;
  try {
    store.setItem(settingsKey(projectId), JSON.stringify(settings));
  } catch {
    /* quota / blocked: preferences are a convenience */
  }
}

/** Whether stored preferences exist (so the default mode can be chosen from the lyrics otherwise). */
export function hasStoredSettings(projectId: string, store: StorageLike | null = storage()): boolean {
  if (!store) return false;
  try {
    return store.getItem(settingsKey(projectId)) != null;
  } catch {
    return false;
  }
}
