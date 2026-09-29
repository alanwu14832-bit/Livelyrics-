"use client";

// Side panel: a full-width SegmentedControl (tabs) over one scroll container per view (UI-16):
// only the active view is mounted (the 同步 meters run rAF loops), each view remembers its own
// scroll position, and 控制 always opens at the top so the safety controls are in view. A pointer
// switch cross-fades the new view in with a 12 px drift from the side it came from; keyboard
// switches are instant.

import { useLayoutEffect, useRef, useState } from "react";
import { SegmentedControl, cx } from "@/components/ui";
import type { ConsoleController, ConsoleSnapshot } from "@/lib/console/controller";
import { useStageValue } from "@/lib/console/hooks";
import type { StageState } from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";
import { ControlTab } from "./ControlTab";
import { DesignTab } from "./DesignTab";
import { ResearchTab } from "./ResearchTab";
import { SyncTab } from "./SyncTab";
import { Dot, Pane, useScrollEdge } from "./ui";

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

/** Any override is active: a 6 px red dot on 控制 (so it is never forgotten). */
const selectAnyOverride = (s: StageState) => {
  const o = s.overrides;
  return o.blackout || !o.lyricsVisible || o.freeze || o.scene != null || o.lyricStyle != null || o.testPattern || o.intensity !== 1 || o.lyricScale !== 1;
};

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
  const [enter, setEnter] = useState<"none" | "forward" | "back">("none");
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollTops = useRef<Record<TabId, number>>({ design: 0, research: 0, control: 0, sync: 0 });
  const anyOverride = useStageValue(controller.store, selectAnyOverride);
  const scrolled = useScrollEdge(panelRef, [tab]);
  const lastPointer = useRef(0);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (el) el.scrollTop = tab === "control" ? 0 : scrollTops.current[tab];
  }, [tab]);

  const choose = (id: TabId) => {
    if (id === tab) return;
    if (panelRef.current) scrollTops.current[tab] = panelRef.current.scrollTop;
    const from = TABS.findIndex((t) => t.id === tab);
    const to = TABS.findIndex((t) => t.id === id);
    // only a pointer pick animates (keyboard-initiated changes never do)
    const byPointer = performance.now() - lastPointer.current < 800;
    setEnter(byPointer ? (to > from ? "forward" : "back") : "none");
    setTab(id);
    try {
      window.localStorage.setItem(TAB_KEY, id);
    } catch {
      /* storage blocked */
    }
  };

  return (
    <Pane area="panel" label="設計與控制" order={3}>
      <div
        className={cx("relative z-20 shrink-0 p-2 transition-shadow duration-(--dur-fast) ease-[ease]", scrolled && "scroll-edge")}
        onPointerDown={() => {
          lastPointer.current = performance.now();
        }}
      >
        <SegmentedControl
          kind="tabs"
          fullWidth
          blurOnPointer
          label="面板"
          value={tab}
          onChange={choose}
          getTabId={(v) => `console-tab-${v}`}
          getPanelId={(v) => `console-tabpanel-${v}`}
          options={TABS.map((t) => ({
            value: t.id,
            ariaLabel: t.id === "control" && anyOverride ? "控制（有覆寫生效中）" : undefined,
            label:
              t.id === "control" && anyOverride ? (
                <span className="inline-flex items-start gap-1">
                  {t.label}
                  <Dot className="mt-px bg-red" />
                </span>
              ) : (
                t.label
              ),
          }))}
        />
      </div>
      <div
        key={tab}
        ref={panelRef}
        role="tabpanel"
        id={`console-tabpanel-${tab}`}
        aria-labelledby={`console-tab-${tab}`}
        data-motion={enter !== "none" ? "move" : undefined}
        className={cx(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain",
          enter !== "none" && "transition-[opacity,translate] duration-(--dur-base) ease-out starting:opacity-0",
          enter === "forward" && "starting:translate-x-3",
          enter === "back" && "starting:-translate-x-3",
        )}
      >
        {tab === "design" && <DesignTab controller={controller} project={project} redesigning={snap.redesign.running} onRedesign={onRedesign} />}
        {tab === "research" && <ResearchTab project={project} />}
        {tab === "control" && <ControlTab controller={controller} project={project} output={snap.output} />}
        {tab === "sync" && <SyncTab controller={controller} snap={snap} project={project} />}
      </div>
    </Pane>
  );
}
