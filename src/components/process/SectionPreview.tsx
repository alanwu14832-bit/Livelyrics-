"use client";

import { useEffect, useState } from "react";
import { StageView } from "@/components/stage/StageView";
import { createStageStore, initialStageState } from "@/lib/stage/protocol";
import { lineIndexAt } from "@/lib/timeline";
import type { Project } from "@/lib/types";

/**
 * Silent, looping preview of one plan section through the real stage renderer
 * (scene + lyric presentation), driven by a virtual clock.
 */
export function SectionPreview({ project, sectionIndex, className }: { project: Project; sectionIndex: number; className?: string }) {
  const [store] = useState(() => createStageStore(initialStageState(project.id)));

  useEffect(() => {
    const section = project.plan?.sections[sectionIndex];
    if (!section) return;
    const duration = project.meta.duration || project.analysis?.duration || section.end;
    const length = Math.max(1, section.end - section.start);
    const began = Date.now();
    let lastLine: number | null = null;
    let lineStartedAt = began;
    const tick = () => {
      const now = Date.now();
      const t = section.start + (((now - began) / 1000) % length);
      const lineIndex = lineIndexAt(project.lyrics, t, duration);
      if (lineIndex !== lastLine) {
        const start = lineIndex != null ? project.lyrics.lines[lineIndex]?.start : null;
        lineStartedAt = start != null ? now - Math.max(0, t - start) * 1000 : now;
        lastLine = lineIndex;
      }
      store.set({ ...store.get(), projectId: project.id, t, playing: true, sentAt: now, lineIndex, lineStartedAt, sectionIndex });
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [project, sectionIndex, store]);

  return <StageView project={project} store={store} renderScale={0.6} className={className} />;
}
