// Per-browser MIDI preferences (phase 5a, 控制器): whether MIDI is on, which input, SysEx for MTC
// locate, and the controller mapping. The same controllers serve every song and show on this
// computer, so this lives in localStorage (best effort: a private window or blocked storage just
// starts from the defaults), not on a project. The mapping also moves by JSON export / import.

import { defaultMidiMap, parseMidiMap, type MidiMap } from "./mapping";

export interface MidiPrefs {
  /** the operator turned MIDI on (the console asks for access again on the next visit) */
  enabled: boolean;
  /** an input id, or "all" */
  input: string;
  /** MTC locate: request SysEx (a second permission) */
  sysex: boolean;
  map: MidiMap;
}

export const MIDI_PREFS_KEY = "livelyrics:midi";

export function defaultMidiPrefs(): MidiPrefs {
  return { enabled: false, input: "all", sysex: false, map: defaultMidiMap() };
}

export function parseMidiPrefs(raw: string | null | undefined): MidiPrefs {
  if (!raw) return defaultMidiPrefs();
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return defaultMidiPrefs();
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return defaultMidiPrefs();
  const r = d as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    input: typeof r.input === "string" && r.input.length > 0 && r.input.length < 512 ? r.input : "all",
    sysex: r.sysex === true,
    map: parseMidiMap(r.map),
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

export function loadMidiPrefs(store: StorageLike | null = storage()): MidiPrefs {
  try {
    return parseMidiPrefs(store?.getItem(MIDI_PREFS_KEY));
  } catch {
    return defaultMidiPrefs();
  }
}

export function saveMidiPrefs(prefs: MidiPrefs, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(MIDI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / blocked: the mapping is also in the exported file */
  }
}
