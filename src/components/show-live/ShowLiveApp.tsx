"use client";

// 演出控制台 /s/[id]/live (phase 2b): the setlist rail on the left (GO, the items, standby) and, to
// its right, the console of whatever is on air — the song console (SongConsole, the same one as
// /p/[id], driven by the show's controller for that song) or the look console — or, before the
// first GO, the pre-show view. The ShowLiveController owns every item controller; this component
// only binds to it. The console tab keeps the screen awake, and a reload of the tab comes back to
// the item that was on air.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AppHeader, Button, EmptyState, Kbd, Skeleton, SkeletonGroup, Tooltip } from "@/components/ui";
import { ProjectorScreenIcon, QuestionIcon, TicketIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { SongConsole, type ShowSlots } from "@/components/console/ConsoleApp";
import { HelpOverlay } from "@/components/console/HelpOverlay";
import { SharedStageView, useSharedStage } from "@/components/console/SharedStage";
import { OutputControl } from "@/components/console/TopBar";
import { Pane } from "@/components/console/ui";
import { useConsoleHotkeys } from "@/components/console/useConsoleHotkeys";
import { HOTKEY_HELP, SHOW_HOTKEY_HELP, hotkeyAction, type HotkeyAction } from "@/lib/console/hotkeys";
import { ShowLiveController, type ItemControl, type ShowLiveSnapshot } from "@/lib/console/show-controller";
import type { StageStore } from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";
import { AUTO_STANDBY_ID, type RailItem } from "@/lib/console/show-live";
import { SONG_STATUS_INFO, formatRunningTime } from "@/lib/show";
import { useWakeLock } from "@/lib/use-wake-lock";
import { LookConsole } from "./LookConsole";
import { SetlistRail, itemLength, lookMeta } from "./SetlistRail";

const PRESHOW_HELP = HOTKEY_HELP.filter((g) => g.title === "畫面控制");

function nextRow(snap: ShowLiveSnapshot): RailItem | null {
  const id = snap.live.armed;
  if (!id) return null;
  const row = snap.rail.find((r) => r.id === id);
  if (row) return row;
  const s = snap.standby;
  return s && id === AUTO_STANDBY_ID ? { id: s.id, kind: "standby", title: s.title, songNumber: null, seconds: null, status: null, arcRole: null, swatch: [...s.look.colorway] } : null;
}

/** 「第 1 首「示範之歌」・3:45」, 「進場・「示範樂團」・5 分」 (a look's kind only when its title is not it). */
function describeItem(item: RailItem): string {
  const length = itemLength(item);
  if (item.kind === "song") return [item.songNumber != null ? `第 ${item.songNumber} 首「${item.title}」` : `「${item.title}」`, length].filter(Boolean).join("・");
  const meta = lookMeta(item);
  return [item.title, meta !== item.title ? meta : "", length].filter(Boolean).join("・");
}

/** Nothing on air yet: open the projection, check the setlist, GO. */
function PreShow({ ctl, snap, onShowAction }: { ctl: ShowLiveController; snap: ShowLiveSnapshot; onShowAction: (a: HotkeyAction) => boolean }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const openOutput = useCallback(() => setBlocked(!ctl.openOutput()), [ctl]);
  const armed = nextRow(snap);
  // the rail rows carry each song's readiness already
  const issues = useMemo(() => snap.rail.filter((r) => r.kind === "song" && r.status != null && r.status !== "ready"), [snap.rail]);
  const total = snap.rail.reduce((n, r) => n + (r.seconds ?? 0), 0);

  const dispatch = useCallback(
    (action: HotkeyAction): boolean => {
      switch (action.type) {
        case "go":
        case "standby":
          return onShowAction(action);
        case "openOutput":
          openOutput();
          return true;
        case "help":
          setHelpOpen((v) => !v);
          return true;
        default:
          return false;
      }
    },
    [openOutput, onShowAction],
  );
  useConsoleHotkeys({ active: true, paused: helpOpen, onAction: dispatch });
  // the help sheet only explains: ? closes it, S (the panic key) still works through it
  const helpKey = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;
      const action = hotkeyAction(e);
      if (action?.type === "help") {
        e.preventDefault();
        setHelpOpen(false);
      } else if (action?.type === "standby") {
        e.preventDefault();
        setHelpOpen(false);
        onShowAction(action);
      }
    },
    [onShowAction],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-bg text-label">
      <header className="relative z-20 flex h-[52px] shrink-0 items-center justify-between gap-4 bg-surface px-(--header-gutter) border-b-hairline">
        <div className="min-w-0">
          <p className="truncate text-c-headline text-label">{snap.otherConsole ? "另一個控制台也在控制這場演出" : "演出尚未開始"}</p>
          <p className="truncate text-c-footnote text-label-2">{[snap.band?.name, `${snap.rail.length} 個項目`, total > 0 ? `約 ${formatRunningTime(total)}` : ""].filter(Boolean).join("・")}</p>
        </div>
        <div className="flex items-center gap-2">
          <OutputControl output={snap.output} onOpen={openOutput} />
          <Tooltip content="快捷鍵說明" shortcut="?" placement="bottom-end">
            <Button variant="quiet" size="icon" aria-label="快捷鍵說明" icon={QuestionIcon} onClick={() => setHelpOpen(true)} />
          </Tooltip>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 p-1.5">
        <Pane label="準備開演" className="flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="flex w-full max-w-[520px] flex-col items-center text-center">
            <TicketIcon size={44} className="text-label-2" />
            <h1 className="mt-3 text-c-title text-label">準備開演</h1>
            <p className="mt-2 text-c-body text-balance text-label-2">先開啟投影視窗，拖到投影機或 LED 螢幕後，在那個視窗按 F 進入全螢幕。</p>
            <p className="mt-1 text-c-body text-balance text-label-2">
              準備好時按 <Kbd>G</Kbd> 或左側的 GO，播出{armed ? `「${armed.title}」` : "第一個項目"}。
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button variant={snap.output.connected ? "gray" : "tinted"} icon={ProjectorScreenIcon} onClick={openOutput}>
                {snap.output.connected ? "聚焦投影視窗" : "開啟投影視窗"}
              </Button>
            </div>
            {blocked && !snap.output.connected && (
              <p role="alert" className="mt-2 text-c-footnote font-medium text-red-text">
                瀏覽器封鎖了彈出視窗。請允許此網站開啟彈出視窗後再試一次。
              </p>
            )}
            {armed && <p className="mt-4 text-c-footnote text-label-2">{snap.live.current == null ? "第一個" : "待命"}：{describeItem(armed)}</p>}
            {issues.length > 0 && (
              <div className="mt-6 w-full rounded-md bg-surface-2 px-4 py-3 text-left">
                <p className="flex items-center gap-1.5 text-c-body font-semibold text-label">
                  <WarningCircleIcon size={16} className="text-orange" />
                  {issues.length} 首歌還沒準備好
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {issues.map((i) => (
                    <li key={i.id} className="flex items-baseline justify-between gap-3 text-c-footnote">
                      <span className="min-w-0 truncate text-label">{i.title}</span>
                      <span className="shrink-0 text-orange-text">{i.status ? SONG_STATUS_INFO[i.status].label : ""}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-c-footnote text-label-2">仍可以播出：沒有設計的歌用預設畫面，缺歌詞的歌只有畫面。</p>
              </div>
            )}
          </div>
        </Pane>
      </main>
      <HelpOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onKeyDown={helpKey}
        lead={SHOW_HOTKEY_HELP}
        groups={PRESHOW_HELP}
        footer={<p>GO 之後，這裡會換成播出中項目的控制台：歌曲是完整的歌曲控制台，進場、串場、待機與散場是畫面控制台。</p>}
      />
    </div>
  );
}

/** The project of the item on air (a song's arrives when its controller has loaded it). */
function useOnAirProject(onAir: ItemControl | null): Project | null {
  const subscribe = useCallback((listener: () => void) => (onAir ? onAir.controller.subscribe(listener) : () => {}), [onAir]);
  const get = useCallback(() => onAir?.controller.getSnapshot().project ?? null, [onAir]);
  return useSyncExternalStore(subscribe, get, get);
}

function ShowLiveSkeleton() {
  return (
    <SkeletonGroup label="載入演出控制台" className="flex h-screen min-w-[1280px] overflow-hidden bg-bg">
      <div className="flex h-full w-[272px] shrink-0 flex-col gap-3 bg-surface p-3 border-r-hairline">
        <Skeleton className="h-7 w-32 rounded-sm" />
        <Skeleton className="h-24 w-full rounded-lg" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-[52px] shrink-0 bg-surface border-b-hairline" />
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <Skeleton className="aspect-video w-[60%] rounded-md" />
        </div>
      </div>
    </SkeletonGroup>
  );
}

export function ShowLiveApp({ id, initialName }: { id: string; initialName?: string }) {
  const [ctl] = useState(() => new ShowLiveController(id));
  useEffect(() => {
    ctl.attach();
    return () => ctl.detach();
  }, [ctl]);
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);
  // the console laptop must not sleep in the middle of a set
  useWakeLock();

  const name = snap.show?.name ?? initialName;
  useEffect(() => {
    document.title = name ? `${name}｜演出控制台` : "演出控制台｜Livelyrics";
  }, [name]);

  const onShowAction = useCallback(
    (action: HotkeyAction): boolean => {
      if (action.type === "go") {
        ctl.go();
        return true;
      }
      if (action.type === "standby") {
        ctl.standby();
        return true;
      }
      return false;
    },
    [ctl],
  );
  // one preview stage for the whole show: a take re-points it instead of building a new one
  const shared = useSharedStage();
  const slots = useMemo<ShowSlots>(() => ({ onAction: onShowAction, help: SHOW_HOTKEY_HELP, stage: shared }), [onShowAction, shared]);
  const onAirProject = useOnAirProject(snap.onAir);
  // until the taken song has loaded, the preview keeps the last frame (as the projection does)
  const [staged, setStaged] = useState<{ project: Project; store: StageStore } | null>(null);
  const onAirStore = snap.onAir?.controller.store ?? null;
  if (onAirStore && onAirProject && (staged?.project !== onAirProject || staged.store !== onAirStore)) setStaged({ project: onAirProject, store: onAirStore });

  if (snap.load.status === "not-found" || snap.load.status === "error") {
    const missing = snap.load.status === "not-found";
    return (
      <div className="flex h-screen min-w-0 flex-col bg-bg text-label">
        <AppHeader variant="console" back={{ href: `/s/${encodeURIComponent(id)}`, label: "演出" }} title={name ?? "演出控制台"} />
        <div className="flex min-h-0 flex-1 items-center justify-center pb-[52px]">
          <EmptyState
            icon={missing ? TicketIcon : <WarningCircleIcon size={44} className="text-red" />}
            title={missing ? "找不到這場演出" : "無法載入演出"}
            description={missing ? "它可能已被刪除。" : snap.load.status === "error" ? snap.load.message : undefined}
            action={
              missing ? (
                <Button variant="gray" href="/" transitionTypes={["pop"]}>
                  回到作品庫
                </Button>
              ) : (
                <Button variant="filled" onClick={() => ctl.reload()}>
                  重試
                </Button>
              )
            }
          />
        </div>
      </div>
    );
  }
  if (snap.load.status === "loading" || !snap.show) return <ShowLiveSkeleton />;

  const onAir = snap.onAir;
  return (
    <div className="flex h-screen min-w-[1280px] overflow-hidden bg-bg text-label">
      <SetlistRail ctl={ctl} snap={snap} />
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {onAir?.kind === "song" ? (
          <SongConsole key={onAir.seq} controller={onAir.controller} show={slots} />
        ) : onAir?.kind === "look" ? (
          <LookConsole key={onAir.seq} controller={onAir.controller} item={onAir.item} next={nextRow(snap)} onShowAction={onShowAction} shared={shared} />
        ) : (
          <PreShow ctl={ctl} snap={snap} onShowAction={onShowAction} />
        )}
      </div>
      {shared && staged && <SharedStageView stage={shared} project={staged.project} store={staged.store} />}
    </div>
  );
}
