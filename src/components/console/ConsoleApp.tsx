"use client";

// Operator console (/p/[id]): everything the visual operator needs during the show.
// The projection window (/p/[id]/output) mirrors only the stage.
//
// Pro-app dark layout (UI-AUDIT §3.5): #000 page, --surface panes 6 px apart with radius 12 and no
// borders, a solid 52 px top bar. Keyboard first: every hotkey acts in the same frame and answers
// with the HUD over the preview (0 ms in, 900 ms hold, 250 ms fade) plus the top bar's status
// capsules. None of that feedback ever reaches the projection window.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Banner, Button, ToastStack, type HudHandle, type ToastItem } from "@/components/ui";
import { useConsoleController, useConsoleSnapshot } from "@/lib/console/hooks";
import { hotkeyAction, targetOwnsKey, type HotkeyAction, type TargetLike } from "@/lib/console/hotkeys";
import { CuePanel } from "./CuePanel";
import { hudForAction } from "./feedback";
import { HelpOverlay } from "./HelpOverlay";
import { LyricsList } from "./LyricsList";
import { PanelBoundary } from "./PanelBoundary";
import { PreviewPanel, StageReadout } from "./Preview";
import { RedesignDialog } from "./RedesignDialog";
import { SidePanel } from "./SidePanel";
import { ConsoleSkeleton, LoadErrorState, NotFoundState, NotReadyState } from "./States";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";

/** What the server already knows about the song, so the loading state shows its title and art. */
export interface ConsoleIntro {
  title: string;
  artist: string;
  palette: string[];
}

function asTarget(t: EventTarget | null): TargetLike | null {
  if (!t || typeof (t as Element).tagName !== "string") return null;
  const el = t as HTMLElement;
  return { tagName: el.tagName, type: (el as HTMLInputElement).type, isContentEditable: el.isContentEditable, role: el.getAttribute("role") };
}

/** Hotkeys that also work while the shortcut help sheet is open (it only explains them). */
const HELP_PASSTHROUGH = new Set<HotkeyAction["type"]>(["blackout", "lyrics", "freeze", "scene", "followPlan", "offset", "tap", "mode"]);

export function ConsoleApp({ id, intro }: { id: string; intro?: ConsoleIntro | null }) {
  const controller = useConsoleController(id);
  const snap = useConsoleSnapshot(controller);
  const [helpOpen, setHelpOpen] = useState(false);
  const [redesignOpen, setRedesignOpen] = useState(false);
  const [openAnyway, setOpenAnyway] = useState(false);
  const hud = useRef<HudHandle>(null);

  const project = snap.project;
  const notReady = !!project && !project.plan && (project.status === "new" || project.status === "processing") && !openAnyway;
  const active = snap.load.status === "ready" && !!project && !notReady;

  useEffect(() => {
    const title = project?.meta?.title;
    document.title = title ? `${title}｜控制台` : "控制台｜Livelyrics";
  }, [project?.meta?.title]);

  // the toast stack owns notice lifetimes (it pauses while hovered, focused or hidden)
  useEffect(() => {
    controller.setNoticeAutoDismiss(false);
    return () => controller.setNoticeAutoDismiss(true);
  }, [controller]);
  const toasts = useMemo<ToastItem[]>(() => snap.notices.map((n) => ({ id: String(n.id), tone: n.tone, message: n.message })), [snap.notices]);
  const dismissToast = useCallback((toastId: string) => controller.dismissNotice(Number(toastId)), [controller]);

  /** Run a hotkey action and answer with the HUD in the same frame. */
  const dispatch = useCallback(
    (action: HotkeyAction) => {
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
        case "help":
          setHelpOpen((v) => !v);
          return;
        case "escape":
          controller.clearLine();
          return;
      }
      // a blocked popup already explains itself in a notice: no 「已開啟」 HUD then
      const after = controller.getSnapshot().notices;
      if (action.type === "openOutput" && after.length > noticesBefore && after[after.length - 1]?.tone === "error") return;
      const content = hudForAction(action, controller);
      if (content) hud.current?.show(content);
    },
    [controller],
  );

  // keyboard-first operation
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (redesignOpen || helpOpen) return; // the sheets are modal and pass through their own keys
      const target = asTarget(e.target);
      if (targetOwnsKey(target, e.code)) return;
      const action = hotkeyAction(e);
      if (!action) return;
      dispatch(action);
      e.preventDefault();
      // a hotkey answers with the HUD: dismiss the focused control's tooltip (e.g. the one shown
      // when a sheet returned focus to its opener). Non-bubbling, so no hotkey handler sees it.
      if (e.target instanceof HTMLElement && e.target !== document.body) e.target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: false }));
    };
    // Space on a focused button would also "click" it on keyup: Space belongs to the transport
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || redesignOpen || helpOpen) return;
      if (!targetOwnsKey(asTarget(e.target), e.code)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active, dispatch, helpOpen, redesignOpen]);

  // A mouse click must not leave focus on a control: Enter (cue) or arrows (next line) would
  // otherwise re-trigger that button / move that slider. Keyboard (Tab) focus is kept.
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return; // keyboard activation
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body || el.closest('dialog, [role="dialog"]')) return;
      const tag = el.tagName;
      if (tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable) return;
      if (tag === "INPUT" && !["range", "checkbox", "radio", "button"].includes((el as HTMLInputElement).type)) return;
      el.blur();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [active]);

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
      } else if (HELP_PASSTHROUGH.has(action.type)) {
        e.preventDefault();
        dispatch(action);
      }
    },
    [dispatch],
  );

  if (snap.load.status === "not-found") return <NotFoundState />;
  if (snap.load.status === "error" && !project) return <LoadErrorState message={snap.load.message} onRetry={() => void controller.reload()} />;
  if (!project) return <ConsoleSkeleton id={id} intro={intro ?? null} />;
  if (notReady) return <NotReadyState project={project} onOpenAnyway={() => setOpenAnyway(true)} />;

  const openRedesign = () => setRedesignOpen(true);

  return (
    <div className="flex h-screen min-w-[1280px] flex-col overflow-hidden bg-bg text-label">
      <TopBar controller={controller} snap={snap} onRedesign={openRedesign} onHelp={() => setHelpOpen(true)} />
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
            <PreviewPanel controller={controller} project={project} output={snap.output} hudRef={hud} />
            <StageReadout controller={controller} project={project} mode={snap.mode} />
          </div>
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
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} onKeyDown={helpKey} />
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
