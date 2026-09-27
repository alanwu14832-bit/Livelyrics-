"use client";

import { useEffect, useRef } from "react";

/**
 * Cloud mode: while a job recorded on a document runs on the server (started by this page before a
 * refresh, or by another page), check the document every few seconds until it is done.
 */
export function useJobPolling(running: boolean, poll: () => Promise<void>, intervalMs = 3000): void {
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  });
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void pollRef.current().catch(() => {
        /* keep what we have; the next tick tries again */
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [running, intervalMs]);
}
