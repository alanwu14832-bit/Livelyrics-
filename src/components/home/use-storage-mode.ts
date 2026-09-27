"use client";

import { useEffect, useState } from "react";
import { storageMode, type StorageModeName } from "@/lib/api-client";

/** The server's storage mode (null until known): copy that differs between local and cloud uses it. */
export function useStorageMode(): StorageModeName | null {
  const [mode, setMode] = useState<StorageModeName | null>(null);
  useEffect(() => {
    let alive = true;
    void storageMode().then((m) => {
      if (alive) setMode(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return mode;
}
