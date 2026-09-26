"use client";

// Operator console (/p/[id]): everything the visual operator needs during the show.
// The projection window (/p/[id]/output) mirrors only the stage.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useConsoleController, useConsoleSnapshot } from "@/lib/console/hooks";
import { hotkeyAction, targetOwnsKey, type TargetLike } from "@/lib/console/hotkeys";
import { CuePanel } from "./CuePanel";
import { HelpOverlay } from "./HelpOverlay";
import { IconWarning } from "./icons";
import { LyricsList } from "./LyricsList";
import { Notices } from "./Notices";
import { PanelBoundary } from "./PanelBoundary";
import { PreviewPanel, StageReadout } from "./Preview";
import { RedesignDialog } from "./RedesignDialog";
import { SidePanel } from "./SidePanel";
import { ConsoleSkeleton, LoadErrorState, NotFoundState, NotReadyState } from "./States";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";

function asTarget(t: EventTarget | null): TargetLike | null {
  if (!t || typeof (t as Element).tagName !== "string") return null;
  const el = t as HTMLElement;
  return { tagName: el.tagName, type: (el as HTMLInputElement).type, isContentEditable: el.isContentEditable, role: el.getAttribute("role") };
}

export function ConsoleApp({ id }: { id: string }) {
  const controller = useConsoleController(id);
  const snap = useConsoleSnapshot(controller);
  const [helpOpen, setHelpOpen] = useState(false);
  const [redesignOpen, setRedesignOpen] = useState(false);
  const [openAnyway, setOpenAnyway] = useState(false);

  const project = snap.project;
  const notReady = !!project && !project.plan && (project.status === "new" || project.status === "processing") && !openAnyway;
  const active = snap.load.status === "ready" && !!project && !notReady;

  useEffect(() => {
    const title = project?.meta?.title;
    document.title = title ? `${title} — 控制台 · Livelyrics` : "控制台 · Livelyrics";
  }, [project?.meta?.title]);

  // keyboard-first operation
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (redesignOpen) return; // the dialog is modal and handles its own keys
      const target = asTarget(e.target);
      if (targetOwnsKey(target, e.code)) return;
      const action = hotkeyAction(e);
      if (!action) return;
      switch (action.type) {
        case "togglePlay":
          controller.spaceAction();
          break;
        case "next":
          controller.next();
          break;
        case "prev":
          controller.prev();
          break;
        case "cueSelected":
          controller.cueSelected();
          break;
        case "select":
          controller.moveSelection(action.delta);
          break;
        case "blackout":
          controller.toggleBlackout();
          break;
        case "lyrics":
          controller.toggleLyrics();
          break;
        case "freeze":
          controller.toggleFreeze();
          break;
        case "scene":
          controller.sceneSlot(action.slot);
          break;
        case "followPlan":
          controller.setSceneOverride(null);
          break;
        case "offset":
          controller.nudgeOffset(action.delta);
          break;
        case "tap":
          controller.tap();
          break;
        case "openOutput":
          controller.openOutput();
          break;
        case "mode":
          controller.toggleMode();
          break;
        case "help":
          setHelpOpen((v) => !v);
          break;
        case "escape":
          if (helpOpen) setHelpOpen(false);
          else controller.clearLine();
          break;
      }
      e.preventDefault();
    };
    // Space on a focused button would also "click" it on keyup: Space belongs to the transport
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || redesignOpen) return;
      if (!targetOwnsKey(asTarget(e.target), e.code)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active, controller, helpOpen, redesignOpen]);

  // A mouse click must not leave focus on a control: Enter (cue) or arrows (next line) would
  // otherwise re-trigger that button / move that slider. Keyboard (Tab) focus is kept.
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return; // keyboard activation
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body || el.closest('[role="dialog"]')) return;
      const tag = el.tagName;
      if (tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable) return;
      if (tag === "INPUT" && !["range", "checkbox", "radio", "button"].includes((el as HTMLInputElement).type)) return;
      el.blur();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [active]);

  if (snap.load.status === "not-found") return <NotFoundState id={id} />;
  if (snap.load.status === "error" && !project) return <LoadErrorState message={snap.load.message} onRetry={() => void controller.reload()} />;
  if (!project) return <ConsoleSkeleton />;
  if (notReady) return <NotReadyState project={project} onOpenAnyway={() => setOpenAnyway(true)} />;

  const openRedesign = () => setRedesignOpen(true);

  return (
    <div className="flex h-screen min-w-[1280px] flex-col overflow-hidden bg-bg text-fg">
      <TopBar controller={controller} snap={snap} onRedesign={openRedesign} onHelp={() => setHelpOpen(true)} />
      <main
        className="grid min-h-0 flex-1 gap-2 p-2"
        style={{
          gridTemplateAreas: '"lyrics center panel" "timeline timeline cues"',
          gridTemplateColumns: "clamp(280px, 20vw, 340px) minmax(0, 1fr) clamp(340px, 24vw, 400px)",
          gridTemplateRows: "minmax(0, 1fr) clamp(150px, 21vh, 210px)",
        }}
      >
        <PanelBoundary area="lyrics" label="歌詞">
          <LyricsList controller={controller} project={project} mode={snap.mode} selectedIndex={snap.selectedIndex} duration={snap.duration} />
        </PanelBoundary>
        <PanelBoundary area="center" label="預覽">
          <section className="flex min-h-0 min-w-0 flex-col gap-2" style={{ gridArea: "center" }} aria-label="投影預覽">
            {snap.mode === "track" && snap.audio.status === "error" && (
              <div className="flex shrink-0 items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-fg" role="alert">
                <IconWarning className="shrink-0 text-danger" />
                <span className="flex-1">{snap.audio.error ?? "音檔無法載入。"} 仍可切到 LIVE 模式手動送出歌詞。</span>
                <Button size="sm" variant="secondary" onClick={() => controller.retryAudio()}>
                  重新載入音檔
                </Button>
                <Button size="sm" variant="ghost" onClick={() => controller.setMode("live")}>
                  切到 LIVE
                </Button>
              </div>
            )}
            <PreviewPanel controller={controller} project={project} output={snap.output} />
            <StageReadout controller={controller} project={project} mode={snap.mode} />
          </section>
        </PanelBoundary>
        <PanelBoundary area="panel" label="設計與控制">
          <SidePanel controller={controller} snap={snap} project={project} onRedesign={openRedesign} />
        </PanelBoundary>
        <PanelBoundary area="timeline" label="時間軸">
          <Timeline controller={controller} project={project} duration={snap.duration} fallbackPeaks={snap.fallbackPeaks} mode={snap.mode} />
        </PanelBoundary>
        <PanelBoundary area="cues" label="現場提示">
          <CuePanel controller={controller} project={project} />
        </PanelBoundary>
      </main>
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      {redesignOpen && <RedesignDialog controller={controller} redesign={snap.redesign} hasPlan={!!project.plan} hasResearch={!!project.research} onClose={() => setRedesignOpen(false)} />}
      <Notices controller={controller} notices={snap.notices} />
    </div>
  );
}
