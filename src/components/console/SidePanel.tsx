"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { cx } from "@/components/ui";
import type { ConsoleController, ConsoleSnapshot } from "@/lib/console/controller";
import { useStageValue } from "@/lib/console/hooks";
import type { StageState } from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";
import { ControlTab } from "./ControlTab";
import { DesignTab } from "./DesignTab";
import { ResearchTab } from "./ResearchTab";
import { SyncTab } from "./SyncTab";

type TabId = "design" | "research" | "control" | "sync";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "design", label: "設計" },
  { id: "research", label: "研究" },
  { id: "control", label: "控制" },
  { id: "sync", label: "同步" },
];

const TAB_KEY = "livelyrics:console:tab";

function readTab(): TabId {
  if (typeof window === "undefined") return "design";
  try {
    const v = window.localStorage.getItem(TAB_KEY);
    if (v && TABS.some((t) => t.id === v)) return v as TabId;
  } catch {
    /* storage blocked */
  }
  return "design";
}

export function SidePanel({
  controller,
  snap,
  project,
  onRedesign,
}: {
  controller: ConsoleController;
  snap: ConsoleSnapshot;
  project: Project;
  onRedesign: () => void;
}) {
  // only rendered on the client once the project has loaded, so reading storage here is safe
  const [tab, setTab] = useState<TabId>(readTab);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ design: null, research: null, control: null, sync: null });

  const choose = (id: TabId) => {
    setTab(id);
    try {
      window.localStorage.setItem(TAB_KEY, id);
    } catch {
      /* storage blocked */
    }
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    e.stopPropagation();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    choose(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel" style={{ gridArea: "panel" }} aria-label="設計與控制">
      <div role="tablist" aria-label="面板" className="flex h-10 shrink-0 items-stretch gap-1 border-b border-line px-2" onKeyDown={onTabKey}>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`console-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`console-tabpanel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => choose(t.id)}
              className={cx(
                "relative px-3 text-xs font-semibold tracking-wide transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                active ? "text-fg" : "text-faint hover:text-muted",
              )}
            >
              {t.label}
              {t.id === "control" && snap.project && <ControlDot controller={controller} />}
              <span className={cx("absolute inset-x-2 bottom-0 h-0.5 rounded-full", active ? "bg-accent" : "bg-transparent")} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`console-tabpanel-${tab}`}
        aria-labelledby={`console-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {tab === "design" && <DesignTab controller={controller} project={project} redesigning={snap.redesign.running} onRedesign={onRedesign} />}
        {tab === "research" && <ResearchTab project={project} />}
        {tab === "control" && <ControlTab controller={controller} project={project} />}
        {tab === "sync" && <SyncTab controller={controller} snap={snap} project={project} />}
      </div>
    </section>
  );
}

/** A small red dot on the 控制 tab while any override is active (so it is never forgotten). */
const selectAnyOverride = (s: StageState) => {
  const o = s.overrides;
  return o.blackout || !o.lyricsVisible || o.freeze || o.scene != null || o.lyricStyle != null || o.testPattern || o.intensity !== 1 || o.lyricScale !== 1;
};

function ControlDot({ controller }: { controller: ConsoleController }) {
  const active = useStageValue(controller.store, selectAnyOverride);
  if (!active) return null;
  return <span className="absolute top-2 right-1 size-1.5 rounded-full bg-danger" aria-label="有覆寫生效中" />;
}
