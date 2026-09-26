"use client";
// STUB — owned by the STAGE module. Replace the implementation, keep the exports.
import type { Project } from "@/lib/types";
import type { StageStore } from "@/lib/stage/protocol";

export interface StageViewProps {
  project: Project;
  store: StageStore;
  className?: string;
  /** draw safe-area / title-safe guides (console preview only) */
  showGuides?: boolean;
  /** 0.25..1 internal WebGL render scale (preview can render cheaper) */
  renderScale?: number;
}

/** Renders scene + lyrics for the given project, reading StageState from `store` every frame. */
export function StageView({ className }: StageViewProps) {
  return <div className={className} style={{ background: "#000" }} />;
}
