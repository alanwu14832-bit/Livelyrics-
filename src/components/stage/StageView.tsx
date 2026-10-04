"use client";

// <StageView> renders scene + lyrics for a project, reading StageState from
// `store` every animation frame (no React re-render per frame). The same
// component drives the console's live preview and the projection window.

import { useEffect, useRef, type CSSProperties } from "react";
import type { StageStore } from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";
import { StageEngine, type StageStats } from "./StageEngine";

export type { StageStats } from "./StageEngine";

export interface StageViewProps {
  project: Project;
  store: StageStore;
  className?: string;
  /** draw safe-area / title-safe guides (console preview only) */
  showGuides?: boolean;
  /** 0.25..1 internal WebGL render scale (preview can render cheaper) */
  renderScale?: number;
  /** lower the internal resolution automatically when frames drop (default true) */
  adaptiveQuality?: boolean;
  /** force the WebGL1 code path (diagnostics) */
  forceWebGL1?: boolean;
  /** multiplies section-transition durations (slow motion for inspection); default 1 */
  transitionScale?: number;
  /** an inspection stage (the lab): a paused song holds a section transition at its moment */
  inspect?: boolean;
  /** called about once per second with renderer statistics */
  onStats?: (stats: StageStats) => void;
  style?: CSSProperties;
}

/** Renders scene + lyrics for the given project, reading StageState from `store` every frame. */
export function StageView({
  project,
  store,
  className,
  showGuides = false,
  renderScale = 1,
  adaptiveQuality = true,
  forceWebGL1 = false,
  transitionScale = 1,
  inspect = false,
  onStats,
  style,
}: StageViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StageEngine | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let engine: StageEngine | null = null;
    // layers are absolutely positioned; respect a consumer's `absolute`/`fixed` class
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    try {
      engine = new StageEngine(root, { forceWebGL1 });
    } catch (e) {
      console.error("[Livelyrics] 舞台初始化失敗：", e);
    }
    engineRef.current = engine;
    return () => {
      engineRef.current = null;
      try {
        engine?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [forceWebGL1]);

  useEffect(() => {
    engineRef.current?.setProject(project);
  }, [project, forceWebGL1]);

  useEffect(() => {
    engineRef.current?.setStore(store);
  }, [store, forceWebGL1]);

  useEffect(() => {
    engineRef.current?.setShowGuides(showGuides);
  }, [showGuides, forceWebGL1]);

  useEffect(() => {
    engineRef.current?.setRenderScale(renderScale);
  }, [renderScale, forceWebGL1]);

  useEffect(() => {
    engineRef.current?.setAdaptive(adaptiveQuality);
  }, [adaptiveQuality, forceWebGL1]);

  useEffect(() => {
    engineRef.current?.setTransitionScale(transitionScale);
  }, [transitionScale, forceWebGL1]);

  useEffect(() => {
    engineRef.current?.setInspect(inspect);
  }, [inspect, forceWebGL1]);

  useEffect(() => {
    engineRef.current?.setOnStats(onStats ?? null);
  }, [onStats, forceWebGL1]);

  return (
    <div
      ref={rootRef}
      className={className}
      role="img"
      aria-label={`舞台畫面：${project.meta?.title ?? ""}`}
      style={{
        overflow: "hidden",
        background: "#000",
        containerType: "size",
        // the project's output canvas (1920 × 1080 unless the show is for another wall)
        aspectRatio: `${project.output?.width ?? 16} / ${project.output?.height ?? 9}`,
        isolation: "isolate",
        ...style,
      }}
    />
  );
}
