"use client";

// A show look on air (進場 / 串場 / 待機 / 散場, phase 2b): the stage preview of lookToProject()
// (exactly what the projection shows), how long it has been up and — when the look has a planned
// length — a countdown against it (a look never ends on its own: it loops until the next GO), the
// text on screen, what GO takes next, and the song console's safety controls (blackout, text on /
// off, freeze, intensity, scene and style overrides) driving the look's own controller.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Button, StatusCapsules, ToastStack, Tooltip, cx, type HudContent, type HudHandle, type ToastItem } from "@/components/ui";
import {
  ArrowCounterClockwiseIcon,
  FilmSlateIcon,
  MoonIcon,
  ProjectorScreenIcon,
  QuestionIcon,
  SnowflakeIcon,
  SubtitlesIcon,
  SubtitlesSlashIcon,
  type UiIcon,
} from "@/components/ui/Icon";
import { ControlTab } from "@/components/console/ControlTab";
import { capsuleItems } from "@/components/console/feedback";
import { HelpOverlay } from "@/components/console/HelpOverlay";
import { PanelBoundary } from "@/components/console/PanelBoundary";
import { PreviewPanel } from "@/components/console/Preview";
import type { SharedStage } from "@/components/console/SharedStage";
import { OutputControl } from "@/components/console/TopBar";
import { SafetyCapsule } from "@/components/console/SafetyControls";
import { Pane, PaneHeader } from "@/components/console/ui";
import { useConsoleHotkeys } from "@/components/console/useConsoleHotkeys";
import { useRafLoop } from "@/components/console/useRaf";
import { LookThumb } from "@/components/show/SetlistRow";
import { hotkeyAction, HOTKEY_HELP, SHOW_HOTKEY_HELP, type HotkeyAction } from "@/lib/console/hotkeys";
import { selectOverrides, useStageValue } from "@/lib/console/hooks";
import { countdownText, formatElapsed } from "@/lib/console/format";
import { SCENE_LABELS } from "@/lib/console/labels";
import type { LookController } from "@/lib/console/look-controller";
import { sceneBank } from "@/lib/console/plan-edit";
import { AUTO_STANDBY_ID, type RailItem } from "@/lib/console/show-live";
import { LOOK_KIND_INFO, formatRunningTime } from "@/lib/show";
import type { LookItemKind, SetItem } from "@/lib/types";
import { KIND_ICONS, itemFacts } from "./SetlistRail";

type LookItem = Extract<SetItem, { kind: LookItemKind }>;

/** The keys a look answers (the song-only ones do nothing here). */
const LOOK_HELP = HOTKEY_HELP.filter((g) => g.title === "畫面控制");
const HELP_PASSTHROUGH = new Set<HotkeyAction["type"]>(["blackout", "lyrics", "freeze", "scene", "followPlan", "standby"]);

function lookHud(action: HotkeyAction, controller: LookController): HudContent | null {
  const ov = controller.getOverrides();
  switch (action.type) {
    case "blackout":
      return { icon: MoonIcon, label: "黑場", value: ov.blackout ? "開" : "關", tone: ov.blackout ? "red" : "default" };
    case "lyrics":
      return { icon: ov.lyricsVisible ? SubtitlesIcon : SubtitlesSlashIcon, label: "文字", value: ov.lyricsVisible ? "顯示" : "隱藏" };
    case "freeze":
      return { icon: SnowflakeIcon, label: "凍結", value: ov.freeze ? "開" : "關" };
    case "scene": {
      const scene = sceneBank(controller.getSnapshot().project.plan)[action.slot - 1];
      return { icon: FilmSlateIcon, label: `場景 ${action.slot}`, value: scene ? SCENE_LABELS[scene] : "沒有這一格" };
    }
    case "followPlan":
      return { icon: ArrowCounterClockwiseIcon, label: "回到設計的場景" };
    case "openOutput":
      return { icon: ProjectorScreenIcon, label: controller.getSnapshot().output.connected ? "已聚焦投影視窗" : "已開啟投影視窗" };
    default:
      return null;
  }
}

/** The look clock, written per frame (no React re-render): elapsed, and the countdown when planned. */
function LookClock({ controller, big = false }: { controller: LookController; big?: boolean }) {
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  const hint = controller.durationHint;
  useRafLoop(() => {
    const e = controller.elapsed();
    const text = formatElapsed(e);
    const cd = hint ? countdownText(e, hint) : null;
    const key = `${text}|${cd?.text ?? ""}`;
    if (key !== last.current) {
      last.current = key;
      if (elapsedRef.current) elapsedRef.current.textContent = text;
      if (leftRef.current && cd) {
        leftRef.current.textContent = cd.text;
        leftRef.current.dataset.over = cd.over ? "1" : "0";
      }
    }
    if (barRef.current && hint) {
      const p = Math.min(1, e / hint);
      barRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      barRef.current.dataset.over = e > hint ? "1" : "0";
    }
  });
  if (!big) {
    return (
      <div className="flex flex-col justify-center" role="timer" aria-label="播出時間">
        <span className="flex items-baseline gap-1.5">
          <span ref={elapsedRef} className="font-numeric text-c-clock text-label">
            0:00
          </span>
          {hint != null && <span className="font-numeric text-c-footnote text-label-2">/ {formatElapsed(hint)}</span>}
        </span>
        <span ref={leftRef} className="truncate text-c-footnote text-label-2 data-[over=1]:text-orange-text">
          {hint != null ? "" : "循環播放，直到下一個 GO"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col" role="timer" aria-label="播出時間">
      <span className="text-c-footnote font-semibold text-label-2">已播出</span>
      <span ref={elapsedRef} className="font-numeric text-[34px] leading-10 font-semibold text-label tabular">
        0:00
      </span>
      {hint != null ? (
        <>
          <span ref={leftRef} className="text-c-body font-medium text-label-2 tabular data-[over=1]:text-orange-text" />
          <span aria-hidden="true" className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-fill-3">
            <span ref={barRef} className="block h-full origin-left rounded-full bg-tint data-[over=1]:bg-orange" style={{ transform: "scaleX(0)" }} />
          </span>
          <span className="mt-1 text-c-footnote text-label-2">預計 {formatRunningTime(hint)}，時間到不會自動結束</span>
        </>
      ) : (
        <span className="text-c-body text-label-2">循環播放，直到下一個 GO</span>
      )}
    </div>
  );
}

function LookTopBar({ controller, item, onHelp }: { controller: LookController; item: LookItem; onHelp: () => void }) {
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const ov = useStageValue(controller.store, selectOverrides);
  const capsules = capsuleItems(ov, { mode: "track", liveHeld: false, muted: false, offset: 0, project: snap.project });
  const auto = item.id === AUTO_STANDBY_ID;
  return (
    <header className="relative z-20 grid h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-center gap-4 bg-surface px-(--header-gutter) border-b-hairline">
      <div className="flex min-w-0 items-center gap-3">
        <LookThumb look={item.look} kind={item.kind} className="size-9 shrink-0 rounded-[8px]" />
        <div className="min-w-0">
          <p className="truncate text-c-headline text-label">{item.title}</p>
          <p className="truncate text-c-footnote text-label-2">
            {snap.otherConsole ? (
              <span className="font-semibold text-red-text">另一個控制台也在控制</span>
            ) : (
              [item.title !== LOOK_KIND_INFO[item.kind].label ? LOOK_KIND_INFO[item.kind].label : "", auto ? "樂團配色的安全畫面" : SCENE_LABELS[item.look.scene]].filter(Boolean).join("・")
            )}
          </p>
        </div>
        <StatusCapsules items={capsules} className="ml-auto shrink-0" aria-label="目前狀態" />
      </div>
      <div className="flex w-[180px] items-center">
        <LookClock controller={controller} />
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <SafetyCapsule project={snap.project} output={snap.output} />
        <OutputControl output={snap.output} onOpen={() => controller.openOutput()} />
        <Tooltip content="快捷鍵說明" shortcut="?" placement="bottom-end">
          <Button variant="quiet" size="icon" aria-label="快捷鍵說明" icon={QuestionIcon} onClick={onHelp} />
        </Tooltip>
      </div>
    </header>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <dt className="w-16 shrink-0 text-c-footnote text-label-2">{label}</dt>
      <dd className="min-w-0 flex-1 text-c-body text-label">{children}</dd>
    </div>
  );
}

function LookReadout({ controller, item, next }: { controller: LookController; item: LookItem; next: RailItem | null }) {
  const ov = useStageValue(controller.store, selectOverrides);
  const text = item.look.text?.trim();
  const scene = ov.scene ?? item.look.scene;
  const NextIcon: UiIcon | null = next ? KIND_ICONS[next.kind] : null;
  const hidden = !ov.lyricsVisible || ov.blackout;
  return (
    <Pane label="播出中的畫面" order={2} className="shrink-0">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(200px,260px)] gap-x-6 px-4 py-3">
        <dl className="flex min-w-0 flex-col gap-1.5">
          <Detail label="畫面文字">
            {text ? <span className={cx("font-semibold", hidden && "text-label-2 line-through decoration-label-3")}>「{text}」</span> : <span className="text-label-2">無（只有畫面）</span>}
          </Detail>
          <Detail label="場景">
            {SCENE_LABELS[scene] ?? scene}
            {ov.scene && <span className="text-label-2">（覆寫）</span>}
          </Detail>
          <Detail label="配色">
            <span className="inline-flex items-center gap-1.5 align-middle">
              {item.look.colorway.map((c, i) => (
                <span key={i} aria-hidden="true" className="size-3.5 rounded-full shadow-[0_0_0_0.5px_rgba(255,255,255,0.25)]" style={{ background: c }} />
              ))}
            </span>
          </Detail>
          <Detail label="下一個">
            {next && NextIcon ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <NextIcon size={14} className="shrink-0 text-label-2" />
                <span className="truncate">{next.title}</span>
                {itemFacts(next) && <span className="shrink-0 text-label-2">{itemFacts(next)}</span>}
              </span>
            ) : (
              <span className="text-label-2">演出清單已播完</span>
            )}
          </Detail>
        </dl>
        <LookClock controller={controller} big />
      </div>
    </Pane>
  );
}

export function LookConsole({
  controller,
  item,
  next,
  onShowAction,
  shared,
}: {
  controller: LookController;
  item: LookItem;
  /** what GO takes next */
  next: RailItem | null;
  onShowAction: (action: HotkeyAction) => boolean;
  /** the show console's one preview stage */
  shared?: SharedStage | null;
}) {
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [helpOpen, setHelpOpen] = useState(false);
  const hud = useRef<HudHandle>(null);

  useEffect(() => {
    controller.setNoticeAutoDismiss(false);
    return () => controller.setNoticeAutoDismiss(true);
  }, [controller]);
  const toasts = useMemo<ToastItem[]>(() => snap.notices.map((n) => ({ id: String(n.id), tone: n.tone, message: n.message })), [snap.notices]);
  const dismissToast = useCallback((toastId: string) => controller.dismissNotice(Number(toastId)), [controller]);

  const dispatch = useCallback(
    (action: HotkeyAction): boolean => {
      switch (action.type) {
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
        case "openOutput":
          controller.openOutput();
          break;
        case "go":
        case "standby":
          return onShowAction(action);
        case "help":
          setHelpOpen((v) => !v);
          return true;
        default:
          // the song keys (transport, lyrics, sections) mean nothing for a look
          return false;
      }
      const content = lookHud(action, controller);
      if (content) hud.current?.show(content);
      return true;
    },
    [controller, onShowAction],
  );
  useConsoleHotkeys({ active: true, paused: helpOpen, onAction: dispatch });

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

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-bg text-label">
      <LookTopBar controller={controller} item={item} onHelp={() => setHelpOpen(true)} />
      <main className="grid min-h-0 flex-1 gap-1.5 p-1.5" style={{ gridTemplateColumns: "minmax(0, 1fr) clamp(340px, 24vw, 400px)" }}>
        <PanelBoundary area="center" label="預覽">
          <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
            <PreviewPanel controller={controller} project={snap.project} output={snap.output} hudRef={hud} label="播出中" shared={shared} />
            <LookReadout controller={controller} item={item} next={next} />
          </div>
        </PanelBoundary>
        <PanelBoundary area="panel" label="安全控制">
          <Pane label="安全控制" order={3}>
            <PaneHeader title="控制" meta={<span>{LOOK_KIND_INFO[item.kind].label}畫面</span>} />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <ControlTab controller={controller} project={snap.project} noun="文字" output={snap.output} />
            </div>
          </Pane>
        </PanelBoundary>
      </main>
      <HelpOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onKeyDown={helpKey}
        lead={SHOW_HOTKEY_HELP}
        groups={LOOK_HELP}
        footer={
          <>
            <p>進場、串場、待機與散場畫面會一直循環，直到下一個 GO；預計長度只用來倒數，時間到不會自動換場。</p>
            <p>任何時候按 B 都能立刻淡出為全黑，按 S 切到待機畫面。</p>
          </>
        }
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} className="top-[70px]! right-[calc(clamp(340px,24vw,400px)+24px)]! w-[340px]!" />
    </div>
  );
}
