"use client";

// 作品庫 (m7): a designed song without a saved key still (Project.thumb: songs designed before the
// design overview saved one, or never opened there) gets one rendered here, quietly, after the page
// settled — newest first, one at a time (the key still shares the style frames' WebGL queue), a few
// per visit. The renderer is loaded on demand so the home page stays light; the card shows the drawn
// palette artwork until the still is ready.

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { ProjectSummary } from "@/lib/types";

/** at most this many stills per page visit */
export const BACKFILL_MAX = 4;
const START_DELAY_MS = 1200;

/** The cards that need a still: designed, settled, no thumbnail yet (newest first). */
export function thumbCandidates(projects: readonly ProjectSummary[], done: ReadonlySet<string>, max = BACKFILL_MAX): string[] {
  return projects
    .filter((p) => p.hasPlan && !p.thumb && p.status === "ready" && !done.has(p.id))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, max)
    .map((p) => p.id);
}

/** tried this session (rendered, or failed: not retried until the next visit) */
const tried = new Set<string>();

/** React: thumbnails rendered on this page, by project id (data URLs). */
export function useThumbBackfill(projects: readonly ProjectSummary[] | null): Record<string, string> {
  const [made, setMade] = useState<Record<string, string>>({});
  const ids = projects ? thumbCandidates(projects, tried).join(",") : "";
  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { keyStill, saveThumb } = await import("@/components/process/key-still");
      for (const id of ids.split(",")) {
        if (cancelled || document.visibilityState !== "visible") return;
        if (tried.has(id)) continue;
        tried.add(id);
        try {
          const project = await api.getProject(id);
          if (cancelled || !project.plan) continue;
          const still = await keyStill(project);
          if (cancelled || still.program.state === "failed") continue;
          const url = await saveThumb(project, still);
          if (url && !cancelled) setMade((m) => ({ ...m, [id]: url }));
        } catch (err) {
          console.info("[Livelyrics] 作品庫縮圖沒有產生：", err);
        }
      }
    }, START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ids]);
  return made;
}
