"use client";

// React bindings for the SyncEngine (phase 5a): its low-frequency snapshot, and the mapped MIDI
// commands for the console view on screen (it runs them like its own hotkeys).

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { MidiCommand } from "@/lib/midi/mapping";
import type { SyncEngine, SyncSnapshot } from "@/lib/sync/engine";

export function useSyncSnapshot(engine: SyncEngine): SyncSnapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
}

/** Run mapped controller commands while mounted (latest handler, one subscription). */
export function useMidiCommands(engine: SyncEngine | null | undefined, handler: (cmd: MidiCommand) => void, active = true): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!engine || !active) return;
    return engine.onCommand((cmd) => ref.current(cmd));
  }, [engine, active]);
}
