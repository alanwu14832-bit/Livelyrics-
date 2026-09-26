"use client";

// The editor's 外觀 menu (UI-AUDIT §3.1): 跟隨系統 / 淺色 / 深色, kept in localStorage and applied as
// data-theme on the editor's root and on <html> (rehearsals happen in the dark). Server render and
// hydration use "system"; a pre-paint script in src/app/layout.tsx (appearance-script.ts) already put the
// stored choice on <html>, so the first paint is in the chosen appearance, not the system one.

import { useCallback, useSyncExternalStore } from "react";
import { APPEARANCE_KEY as KEY } from "./appearance-script";

export type Appearance = "system" | "light" | "dark";

const EVENT = "livelyrics:editor-appearance";

export function readAppearance(): Appearance {
  return read();
}

function read(): Appearance {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onChange);
  };
}

export function useAppearance(): [Appearance, (next: Appearance) => void] {
  const value = useSyncExternalStore(subscribe, read, () => "system" as const);
  const set = useCallback((next: Appearance) => {
    try {
      if (next === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice lasts until reload */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [value, set];
}
