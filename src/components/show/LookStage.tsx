"use client";

// A silent, looping preview of a synthetic project (a show look, a bible preview) through the real
// stage renderer, driven by a virtual clock. The WebGL renderer only runs while it is on screen, and
// the frame keeps the project's canvas aspect (the show's output).

import { useEffect, useRef, useState } from "react";
import { StageView } from "@/components/stage/StageView";
import { cx } from "@/components/ui";
import { createStageStore, initialStageState } from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";

export function LookStage({ project, className }: { project: Project; className?: string }) {
  const [store] = useState(() => createStageStore(initialStageState(project.id)));
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

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
    const began = Date.now();
    const length = Math.max(4, project.meta.duration || 60);
    const hasLine = project.lyrics.lines.length > 0;
    const tick = () => {
      const now = Date.now();
      const t = ((now - began) / 1000) % length;
      store.set({ ...store.get(), projectId: project.id, t, playing: true, sentAt: now, lineIndex: hasLine ? 0 : null, lineStartedAt: began, sectionIndex: project.plan ? 0 : null });
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [project, store]);

  const aspect = `${project.output?.width ?? 16} / ${project.output?.height ?? 9}`;
  return (
    <div ref={holder} className={cx("overflow-hidden bg-black", className)} style={{ aspectRatio: aspect }}>
      {visible && <StageView project={project} store={store} renderScale={0.6} className="h-full w-full" />}
    </div>
  );
}
