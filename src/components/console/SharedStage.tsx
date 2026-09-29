"use client";

// The show console's one preview stage (phase 2b). A take swaps the whole console view (song
// console ↔ look console), but the preview must not start from scratch each time: a new
// StageView means a new WebGL context and every scene shader compiled again, on the same main
// thread as the projection window (a popup of this tab), right when GO should feel instant. So the
// show console renders ONE StageView into a detached host element through a portal, feeds it the
// item on air (project + store), and each console view's preview frame adopts that host
// (StageSlot). The canvas moves between frames with its context and warm shaders intact.

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { StageView, type StageStats } from "@/components/stage/StageView";
import { publishLimiter } from "@/lib/console/limiter-status";
import type { StageStore } from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";

export interface StatsSource {
  get: () => StageStats | null;
  subscribe: (listener: () => void) => () => void;
}

export interface SharedStage {
  /** the element the StageView lives in; a preview frame appends it (StageSlot) */
  host: HTMLElement;
  stats: StatsSource;
  /** internal: the StageView reports here */
  report: (stats: StageStats) => void;
}

function createSharedStage(): SharedStage {
  const host = document.createElement("div");
  Object.assign(host.style, { position: "absolute", inset: "0" });
  let current: StageStats | null = null;
  const listeners = new Set<() => void>();
  return {
    host,
    stats: {
      get: () => current,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    report: (s) => {
      if (current && current.backend === s.backend && Math.round(current.fps) === Math.round(s.fps)) return;
      current = s;
      for (const l of listeners) l();
    },
  };
}

/** One shared stage per show console (client only). */
export function useSharedStage(): SharedStage | null {
  const [stage] = useState<SharedStage | null>(() => (typeof document === "undefined" ? null : createSharedStage()));
  return stage;
}

/** The single preview StageView, portaled into the shared host (render it once, at a stable place). */
export function SharedStageView({ stage, project, store }: { stage: SharedStage; project: Project; store: StageStore }) {
  const id = project.id;
  const report = stage.report;
  const onStats = useCallback(
    (s: StageStats) => {
      // LED 安全模式: the item on air's limiter state for the control tab and the capsule
      publishLimiter(id, s.safety);
      report(s);
    },
    [id, report],
  );
  return createPortal(
    <StageView project={project} store={store} showGuides renderScale={0.5} onStats={onStats} className="h-full w-full" style={{ aspectRatio: "auto", width: "100%", height: "100%" }} />,
    stage.host,
  );
}

/** Where a console view shows the shared preview: it adopts the host element while mounted. */
export function StageSlot({ stage }: { stage: SharedStage }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = ref.current;
    if (!slot) return;
    slot.appendChild(stage.host);
    return () => {
      if (stage.host.parentNode === slot) slot.removeChild(stage.host);
    };
  }, [stage]);
  return <div ref={ref} className="absolute inset-0" />;
}

const NO_STATS: StatsSource = { get: () => null, subscribe: () => () => {} };

/** The shared stage's renderer statistics (null without a shared stage). */
export function useSharedStats(stage: SharedStage | null | undefined): StageStats | null {
  const source = stage?.stats ?? NO_STATS;
  return useSyncExternalStore(source.subscribe, source.get, source.get);
}
