"use client";

import { useEffect, useRef } from "react";

/** Run `frame` every animation frame while mounted (latest callback, no re-subscribe). */
export function useRafLoop(frame: (now: number) => void, enabled = true): void {
  const ref = useRef(frame);
  useEffect(() => {
    ref.current = frame;
  });
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const loop = (now: number) => {
      try {
        ref.current(now);
      } catch (err) {
        console.error("[Livelyrics] 畫面更新錯誤：", err);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}
