"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PreviewPoster } from "@/components/stage/PreviewPoster";
import { StageView, type StageStats } from "@/components/stage/StageView";
import { createStageStore, initialStageState } from "@/lib/stage/protocol";
import { lineIndexAt } from "@/lib/timeline";
import type { Project } from "@/lib/types";

/**
 * Silent, looping preview of one plan section through the real stage renderer
 * (scene + lyric presentation), driven by a virtual clock. Round 27 (m6): the song's still or palette
 * artwork with 「正在載入畫面…」 covers it until the stage draws (never a black box), as in the console.
 */
export function SectionPreview({ project, sectionIndex, className }: { project: Project; sectionIndex: number; className?: string }) {
  const [store] = useState(() => createStageStore(initialStageState(project.id)));
  const holder = useRef<HTMLDivElement>(null);
  // the WebGL renderer only runs while the preview is on screen
  const [visible, setVisible] = useState(false);
  const [stats, setStats] = useState<StageStats | null>(null);
  const onStats = useCallback((s: StageStats) => setStats((prev) => (prev && prev.backend === s.backend && prev.program?.state === s.program?.state ? prev : s)), []);

  useEffect(() => {
    const el = holder.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

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

  return (
    <div ref={holder} className={className} style={{ aspectRatio: "16 / 9", background: "#000", position: "relative" }}>
      {visible && <StageView project={project} store={store} renderScale={0.6} onStats={onStats} className="h-full w-full" />}
      <PreviewPoster project={project} stats={stats} />
    </div>
  );
}
