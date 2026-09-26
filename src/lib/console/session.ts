// Show state that must survive a console reload in the same tab (sessionStorage): the
// operator's overrides — a reload during a blackout must not light the stage back up —
// and the TRACK playback position. Best effort; storage may be unavailable.

import { LYRIC_STYLE_IDS, SCENE_IDS } from "@/lib/schema";
import { DEFAULT_OVERRIDES, type StageOverrides } from "@/lib/stage/protocol";
import type { LyricStyleId, SceneId } from "@/lib/types";

export interface ConsoleSession {
  overrides: StageOverrides;
  /** audio element time (s) in TRACK mode */
  audioTime: number;
}

export function sessionKey(projectId: string): string {
  return `livelyrics:console-session:${projectId}`;
}

const SCENES = new Set<string>(SCENE_IDS);
const STYLES = new Set<string>(LYRIC_STYLE_IDS);

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function parseOverrides(raw: unknown): StageOverrides {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    blackout: bool(d.blackout, DEFAULT_OVERRIDES.blackout),
    lyricsVisible: bool(d.lyricsVisible, DEFAULT_OVERRIDES.lyricsVisible),
    freeze: bool(d.freeze, DEFAULT_OVERRIDES.freeze),
    scene: typeof d.scene === "string" && SCENES.has(d.scene) ? (d.scene as SceneId) : null,
    lyricStyle: typeof d.lyricStyle === "string" && STYLES.has(d.lyricStyle) ? (d.lyricStyle as LyricStyleId) : null,
    intensity: clampNum(d.intensity, 0, 1.5, DEFAULT_OVERRIDES.intensity),
    lyricScale: clampNum(d.lyricScale, 0.5, 2, DEFAULT_OVERRIDES.lyricScale),
    testPattern: bool(d.testPattern, DEFAULT_OVERRIDES.testPattern),
  };
}

export function parseSession(raw: string | null | undefined): ConsoleSession | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown> | null;
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    return { overrides: parseOverrides(d.overrides), audioTime: clampNum(d.audioTime, 0, 24 * 3600, 0) };
  } catch {
    return null;
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function loadSession(projectId: string, store: StorageLike | null = storage()): ConsoleSession | null {
  if (!store) return null;
  try {
    return parseSession(store.getItem(sessionKey(projectId)));
  } catch {
    return null;
  }
}

export function saveSession(projectId: string, session: ConsoleSession, store: StorageLike | null = storage()): void {
  if (!store) return;
  try {
    store.setItem(sessionKey(projectId), JSON.stringify(session));
  } catch {
    /* quota / blocked */
  }
}
