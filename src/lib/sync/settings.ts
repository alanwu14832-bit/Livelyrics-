// Sync settings (phase 5a, 同步): which source drives the console, the LTC input and the freewheel
// time. Stored per song (the console's settings, src/lib/console/settings.ts) and per show (the show
// console's preferences, src/lib/console/show-live.ts). Pure.

export type SyncSource = "manual" | "clock" | "mtc" | "ltc";
export const SYNC_SOURCES: readonly SyncSource[] = ["manual", "clock", "mtc", "ltc"];

export const SYNC_SOURCE_LABELS: Record<SyncSource, string> = { manual: "手動", clock: "MIDI clock", mtc: "MTC", ltc: "LTC" };

export interface SyncSettings {
  source: SyncSource;
  /** the LTC audio input ("" = the default input) */
  ltcDeviceId: string;
  /** keep running this long after the timecode stops, then fall back to manual */
  freewheelSeconds: number;
}

export const FREEWHEEL_MIN_SECONDS = 0.5;
export const FREEWHEEL_MAX_SECONDS = 10;
export const DEFAULT_SYNC_SETTINGS: SyncSettings = { source: "manual", ltcDeviceId: "", freewheelSeconds: 2 };

/** Stored settings, repaired (anything unknown falls back to the defaults). */
export function parseSyncSettings(raw: unknown): SyncSettings {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const fw = typeof d.freewheelSeconds === "number" && Number.isFinite(d.freewheelSeconds) ? d.freewheelSeconds : DEFAULT_SYNC_SETTINGS.freewheelSeconds;
  return {
    source: SYNC_SOURCES.includes(d.source as SyncSource) ? (d.source as SyncSource) : DEFAULT_SYNC_SETTINGS.source,
    ltcDeviceId: typeof d.ltcDeviceId === "string" && d.ltcDeviceId.length < 512 ? d.ltcDeviceId : "",
    freewheelSeconds: Math.round(Math.min(FREEWHEEL_MAX_SECONDS, Math.max(FREEWHEEL_MIN_SECONDS, fw)) * 10) / 10,
  };
}
