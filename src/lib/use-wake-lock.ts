"use client";

// Keep the screen awake while the page is open (best effort): the projection windows and the
// show console. The lock is released by the browser whenever the page is hidden, so it is taken
// again each time the page becomes visible.

import { useEffect } from "react";

export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible" && "wakeLock" in navigator) {
          lock = await navigator.wakeLock.request("screen");
          if (disposed) void lock.release();
        }
      } catch {
        /* not supported / denied: harmless */
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [enabled]);
}
