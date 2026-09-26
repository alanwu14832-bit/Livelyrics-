"use client";

// React bindings for the ConsoleController and the StageStore.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { StageState, StageStore } from "@/lib/stage/protocol";
import { ConsoleController, type ConsoleSnapshot } from "./controller";

/** One controller per mounted console; attach/detach follow the component lifecycle. */
export function useConsoleController(id: string): ConsoleController {
  const [controller] = useState(() => new ConsoleController(id));
  useEffect(() => {
    controller.attach();
    return () => controller.detach();
  }, [controller]);
  return controller;
}

export function useConsoleSnapshot(controller: ConsoleController): ConsoleSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

/** getSnapshot for useSyncExternalStore that returns the previous value while it is still equal. */
function cachedSelector<T>(store: StageStore, select: (s: StageState) => T, isEqual: (a: T, b: T) => boolean): () => T {
  let has = false;
  let last: T;
  return () => {
    const next = select(store.get());
    if (has && isEqual(last, next)) return last;
    has = true;
    last = next;
    return next;
  };
}

/**
 * Subscribe to a derived value of the stage state; re-renders only when the selected
 * value changes (per `isEqual`). `select` should be stable (module level or memoized).
 */
export function useStageValue<T>(store: StageStore, select: (s: StageState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const getSnapshot = useMemo(() => cachedSelector(store, select, isEqual), [store, select, isEqual]);
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      const off = store.subscribe(() => onChange());
      return () => {
        off();
      };
    },
    [store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const selectLineIndex = (s: StageState) => s.lineIndex;
export const selectSectionIndex = (s: StageState) => s.sectionIndex;
export const selectOverrides = (s: StageState) => s.overrides;
/** song time rounded to 0.1 s (for UI that does not need every frame) */
export const selectTimeDecis = (s: StageState) => Math.floor(s.t * 10) / 10;
