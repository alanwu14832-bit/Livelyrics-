"use client";

// Operator console (/p/[id]): everything the visual operator needs during the show.
// The projection window (/p/[id]/output) mirrors only the stage.
//
// Pro-app dark layout (UI-AUDIT §3.5): #000 page, --surface panes 6 px apart with radius 12 and no
// borders, a solid 52 px top bar. Keyboard first: every hotkey acts in the same frame and answers
// with the HUD over the preview (0 ms in, 900 ms hold, 250 ms fade) plus the top bar's status
// capsules. None of that feedback ever reaches the projection window.
//
// The same song console runs inside the show console (/s/[id]/live, phase 2b): SongConsole takes
// an existing controller (the show owns its lifecycle) and `show` slots — the GO / standby keys,
// the show's key group in the help sheet, a top bar without 「‹ 作品庫」 beside the setlist rail.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Banner, Button, EmptyState, Spinner, ToastStack, type HudHandle, type ToastItem } from "@/components/ui";
import { MusicNotesIcon, WarningCircleIcon, type UiIcon } from "@/components/ui/Icon";
import type { ConsoleController } from "@/lib/console/controller";
import { useConsoleController, useConsoleSnapshot } from "@/lib/console/hooks";
import { hotkeyAction, type HotkeyAction, type HotkeyHelpGroup } from "@/lib/console/hotkeys";
import { CuePanel } from "./CuePanel";
import { hudForAction } from "./feedback";
import { HelpOverlay } from "./HelpOverlay";
import { LyricsList } from "./LyricsList";
import { PanelBoundary } from "./PanelBoundary";
import { PreviewPanel, StageReadout } from "./Preview";
import { RedesignDialog } from "./RedesignDialog";
import { SectionStrip } from "./SectionStrip";
import type { SharedStage } from "./SharedStage";
import { SidePanel } from "./SidePanel";
import { ConsoleSkeleton, LoadErrorState, NotFoundState, NotReadyState } from "./States";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";
import { useConsoleHotkeys } from "./useConsoleHotkeys";

/** What the server already knows about the song, so the loading state shows its title and art. */
export interface ConsoleIntro {
  title: string;
  artist: string;
  palette: string[];
}

/** The show console's hooks into the song console. */
export interface ShowSlots {
  /** GO and standby (the show console's keys); true when handled */
  onAction: (action: HotkeyAction) => boolean;
  /** the show's key group, first in the help sheet */
  help: HotkeyHelpGroup;
  /** the show console's one preview stage (kept across takes) */
  stage?: SharedStage | null;
}

/** Hotkeys that also work while the shortcut help sheet is open (it only explains them). */
const HELP_PASSTHROUGH = new Set<HotkeyAction["type"]>(["blackout", "lyrics", "freeze", "scene", "followPlan", "offset", "tap", "mode", "hold", "loop"]);

export function ConsoleApp({ id, intro }: { id: string; intro?: ConsoleIntro | null }) {
  const controller = useConsoleController(id);
  return <SongConsole controller={controller} intro={intro} />;
}

/** A load state inside the show console's column (the song console proper has full-page ones). */
function ColumnState({ icon, title, description }: { icon: UiIcon | ReactNode; title: string; description?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-bg p-6 text-label">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}

export function SongConsole({ controller, intro, show }: { controller: ConsoleController; intro?: ConsoleIntro | null; show?: ShowSlots }) {
  const id = controller.id;
  const snap = useConsoleSnapshot(controller);
  const [helpOpen, setHelpOpen] = useState(false);
  const [redesignOpen, setRedesignOpen] = useState(false);
  const [openAnyway, setOpenAnyway] = useState(false);
  const hud = useRef<HudHandle>(null);

  const project = snap.project;
  // the show goes on: a song taken on stage opens even when it is not designed yet
  const notReady = !show && !!project && !project.plan && (project.status === "new" || project.status === "processing") && !openAnyway;
  const active = snap.load.status === "ready" && !!project && !notReady;

  useEffect(() => {
    if (show) return; // the show console names the tab after the show
    const title = project?.meta?.title;
    document.title = title ? `${title}｜控制台` : "控制台｜Livelyrics";
  }, [project?.meta?.title, show]);

  // the toast stack owns notice lifetimes (it pauses while hovered, focused or hidden)
  useEffect(() => {
    controller.setNoticeAutoDismiss(false);
    return () => controller.setNoticeAutoDismiss(true);
  }, [controller]);
  const toasts = useMemo<ToastItem[]>(() => snap.notices.map((n) => ({ id: String(n.id), tone: n.tone, message: n.message })), [snap.notices]);
  const dismissToast = useCallback((toastId: string) => controller.dismissNotice(Number(toastId)), [controller]);

  /** Run a hotkey action and answer with the HUD in the same frame. False: not this console's key. */
  const dispatch = useCallback(
    (action: HotkeyAction): boolean => {
      const noticesBefore = controller.getSnapshot().notices.length;
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
          controller.toggleMode({ announce: false }); // the HUD says 「LIVE 模式」 / 「TRACK 模式」
          break;
        case "hold":
          controller.toggleHold();
          break;
        case "loop":
          controller.toggleLoop();
          break;
        case "section":
          controller.stepSection(action.delta);
          break;
        case "go":
        case "standby":
          return show ? show.onAction(action) : false;
        case "help":
          setHelpOpen((v) => !v);
          return true;
        case "escape":
          controller.clearLine();
          return true;
      }
      // a blocked popup already explains itself in a notice: no 「已開啟」 HUD then
      const after = controller.getSnapshot().notices;
      if (action.type === "openOutput" && after.length > noticesBefore && after[after.length - 1]?.tone === "error") return true;
      const content = hudForAction(action, controller);
      if (content) hud.current?.show(content);
      return true;
    },
    [controller, show],
  );

  // In the show console the show's keys work before the song is on stage too (it is loading, or
  // failed to load): S must always reach the standby look, G the next item.
  const onKey = useCallback(
    (action: HotkeyAction): boolean => {
      if (active) return dispatch(action);
      if (!show) return false;
      if (action.type === "go" || action.type === "standby") return show.onAction(action);
      if (action.type === "openOutput") {
        controller.openOutput();
        return true;
      }
      return false;
    },
    [active, controller, dispatch, show],
  );
  // keyboard-first operation (the sheets are modal and pass through their own keys)
  useConsoleHotkeys({ active: active || !!show, paused: redesignOpen || helpOpen, onAction: onKey });

  // B from inside the re-design sheet (outside its text field): blackout, with the HUD
  const blackoutFromSheet = useCallback(() => dispatch({ type: "blackout" }), [dispatch]);
  const helpKey = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;
      const action = hotkeyAction(e);
      if (!action) return;
      if (action.type === "help") {
        e.preventDefault();
        setHelpOpen(false);
      } else if (HELP_PASSTHROUGH.has(action.type) || (show && action.type === "standby")) {
        e.preventDefault();
        dispatch(action);
      }
    },
    [dispatch, show],
  );

  if (show) {
    if (snap.load.status === "not-found") return <ColumnState icon={MusicNotesIcon} title="找不到這首歌" description="它可能已從作品庫刪除。按 S 切到待機畫面，或在演出清單選下一個項目。" />;
    if (snap.load.status === "error" && !project)
      return (
        <ColumnState
          icon={<WarningCircleIcon size={44} className="text-red" />}
          title="這首歌無法載入"
          description={
            <>
              <p>{snap.load.message}</p>
              <p className="mt-3">
                <Button variant="gray" onClick={() => void controller.reload()}>
                  重試
                </Button>
              </p>
            </>
          }
        />
      );
    if (!project) return <ColumnState icon={<Spinner size={20} />} title="載入這首歌…" />;
  } else {
    if (snap.load.status === "not-found") return <NotFoundState />;
    if (snap.load.status === "error" && !project) return <LoadErrorState message={snap.load.message} onRetry={() => void controller.reload()} />;
    if (!project) return <ConsoleSkeleton id={id} intro={intro ?? null} />;
    if (notReady) return <NotReadyState project={project} onOpenAnyway={() => setOpenAnyway(true)} />;
  }

  const openRedesign = () => setRedesignOpen(true);

  return (
    <div className={show ? "flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-bg text-label" : "flex h-screen min-w-[1280px] flex-col overflow-hidden bg-bg text-label"}>
      <TopBar controller={controller} snap={snap} onRedesign={openRedesign} onHelp={() => setHelpOpen(true)} back={!show} compact={!!show} />
      <main
        className="grid min-h-0 flex-1 gap-1.5 p-1.5"
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
          <div className="flex min-h-0 min-w-0 flex-col gap-1.5" style={{ gridArea: "center" }}>
            {snap.mode === "track" && snap.audio.status === "error" && (
              <Banner
                tone="error"
                className="shrink-0 py-2.5"
                title="音檔無法載入"
                description={`${snap.audio.error ?? "音檔無法載入。"} 仍可切到 LIVE 模式手動送出歌詞。`}
                actions={
                  <>
                    <Button size="sm" variant="gray" onClick={() => controller.retryAudio()}>
                      重新載入音檔
                    </Button>
                    <Button size="sm" variant="plain" onClick={() => controller.setMode("live")}>
                      切到 LIVE
                    </Button>
                  </>
                }
              />
            )}
            <PreviewPanel controller={controller} project={project} output={snap.output} hudRef={hud} shared={show?.stage} />
            <SectionStrip controller={controller} project={project} hold={snap.sectionHold} loop={snap.sectionLoop} />
            <StageReadout controller={controller} project={project} mode={snap.mode} />
          </div>
        </PanelBoundary>
        <PanelBoundary area="panel" label="設計與控制">
          <SidePanel controller={controller} snap={snap} project={project} onRedesign={openRedesign} />
        </PanelBoundary>
        <PanelBoundary area="timeline" label="時間軸">
          <Timeline controller={controller} project={project} duration={snap.duration} fallbackPeaks={snap.fallbackPeaks} mode={snap.mode} hold={snap.sectionHold} loop={snap.sectionLoop} />
        </PanelBoundary>
        <PanelBoundary area="cues" label="現場提示">
          <CuePanel controller={controller} project={project} />
        </PanelBoundary>
      </main>
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} onKeyDown={helpKey} lead={show?.help} />
      <RedesignDialog
        open={redesignOpen}
        controller={controller}
        redesign={snap.redesign}
        hasPlan={!!project.plan}
        hasResearch={!!project.research}
        onBlackout={blackoutFromSheet}
        onClose={() => setRedesignOpen(false)}
      />
      {/* over the preview's top-right corner (solid in the console), never over the side-panel tabs */}
      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        className="top-[70px]! right-[calc(clamp(340px,24vw,400px)+24px)]! w-[340px]!"
      />
    </div>
  );
}
