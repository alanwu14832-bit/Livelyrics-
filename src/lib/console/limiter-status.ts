// LED 安全模式 operator feedback: the console preview's stage reports what its flash limiter does
// (once a second, and at once when damping starts or stops); the control tab, the top bar capsule
// and the preview label read it here. One console window has one preview, so a module-level store
// keyed by project id is enough. The projection window's own report (pong `limiter`) wins for the
// "damping now" flag when an output is connected (see `limiterView`).

import { useSyncExternalStore } from "react";
import type { SafetyStats } from "@/components/stage/StageEngine";
import type { OutputStatus } from "./link";

const stats = new Map<string, SafetyStats | null>();
const listeners = new Set<() => void>();

function same(a: SafetyStats | null | undefined, b: SafetyStats | null | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.damping === b.damping &&
    a.engaged === b.engaged &&
    a.brightness === b.brightness &&
    a.flashLimit === b.flashLimit &&
    a.degraded === b.degraded &&
    JSON.stringify(a.bySection) === JSON.stringify(b.bySection)
  );
}

export function publishLimiter(projectId: string, s: SafetyStats | null): void {
  if (same(stats.get(projectId), s)) return;
  stats.set(projectId, s);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLimiterStats(projectId: string | null | undefined): SafetyStats | null {
  const get = () => (projectId ? (stats.get(projectId) ?? null) : null);
  return useSyncExternalStore(subscribe, get, () => null);
}

export interface LimiterView {
  /** damping right now (the projection window's report when connected, else the preview's) */
  damping: boolean;
  /** episodes so far (the larger of the two reports) */
  engaged: number;
  bySection: Record<number, number>;
  degraded: boolean;
}

export function limiterView(preview: SafetyStats | null, output: OutputStatus | null | undefined): LimiterView {
  const out = output?.connected ? output.limiter : undefined;
  return {
    damping: out?.on ? out.damping || !!preview?.damping : !!preview?.damping,
    engaged: Math.max(preview?.engaged ?? 0, out?.engaged ?? 0),
    bySection: preview?.bySection ?? {},
    degraded: !!preview?.degraded,
  };
}
