"use client";

// Round 25 (m1), shared since round 27 (m6): the stage preview is never a black box while the stage
// starts (the scene program's GL compile takes seconds on a slow GPU). The song's still (its library
// picture of the current plan) or its palette artwork shows at once, labelled, and fades to the live
// stage once it draws. The console's preview and the process page's section preview both use it.

import { useEffect, useState, type ReactNode } from "react";
import type { StageStats } from "@/components/stage/StageView";
import { ProjectArt } from "@/components/home/ProjectArt";
import { cx } from "@/components/ui";
import { stageLive } from "@/lib/console/format";
import { planHash } from "@/lib/plan-hash";
import type { Project } from "@/lib/types";

/** How long the poster may cover a stage that never reports its program ready. */
export const POSTER_MAX_MS = 20_000;

/** A small label over a stage frame. */
export function FrameLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex h-6 items-center rounded-pill bg-black/60 px-2.5 text-c-footnote font-medium whitespace-nowrap text-label-2-on-material", className)}>{children}</span>;
}

export function PreviewPoster({ project, stats }: { project: Project; stats: StageStats | null }) {
  const program = project.plan?.sceneProgram;
  const hasProgram = !!program && program.enabled !== false;
  const live = stageLive(stats, hasProgram);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setExpired(true), POSTER_MAX_MS);
    return () => window.clearTimeout(t);
  }, []);
  const [gone, setGone] = useState(false);
  const hidden = live || expired;
  useEffect(() => {
    if (!hidden) return;
    const t = window.setTimeout(() => setGone(true), 600);
    return () => window.clearTimeout(t);
  }, [hidden]);
  if (gone || !project.plan) return null;
  const thumb = project.thumb && project.thumb.plan === planHash(project.plan) ? project.thumb.url : undefined;
  return (
    <div
      aria-hidden="true"
      data-preview-poster={hidden ? "fading" : "on"}
      className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-none"
      style={{ opacity: hidden ? 0 : 1 }}
    >
      <ProjectArt id={project.id} palette={project.plan.keyVisual.palette.map((c) => c.hex)} thumb={thumb} placeholderIconSize={0} className="absolute inset-0 size-full" />
      <FrameLabel className="absolute top-2 left-2">正在載入畫面…</FrameLabel>
    </div>
  );
}
