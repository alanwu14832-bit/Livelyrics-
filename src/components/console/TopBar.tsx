"use client";

// Console top bar (UI-AUDIT §3.3 Toolbar console variant, §3.5): 52 px solid --surface with a
// bottom hairline, no material (nothing scrolls beneath it). Left: 「‹ 作品庫」, the key-visual
// thumbnail and the title (shared elements with the library card), the status capsules. Centre:
// TRACK / LIVE, the transport (prev 32, play 36 white circle, next 32) and the clock. Right: the
// projection split control, 重新設計, help. The centre stays centred: the left column shrinks (the
// title truncates) instead of pushing the transport around when a capsule appears.

import { useEffect, useRef, useState, ViewTransition, type ReactNode } from "react";
import { BackLink, Button, SegmentedControl, StatusCapsules, Tooltip, cx } from "@/components/ui";
import { PauseIcon, PlayIcon, ProjectorScreenIcon, QuestionIcon, SkipBackIcon, SkipForwardIcon, SparkleIcon } from "@/components/ui/Icon";
import type { ConsoleController, ConsoleSnapshot } from "@/lib/console/controller";
import { selectOverrides, useStageValue } from "@/lib/console/hooks";
import { untimedCount } from "@/lib/console/navigation";
import { formatTime } from "@/lib/timeline";
import { artBackground, projectArtName, projectTitleName } from "./art";
import { capsuleItems } from "./feedback";
import { Dot } from "./ui";
import { useRafLoop } from "./useRaf";

/** Per-frame clock: writes textContent, never re-renders React. */
function TimeReadout({ controller, duration }: { controller: ConsoleController; duration: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  useRafLoop(() => {
    const el = ref.current;
    if (!el) return;
    const text = formatTime(controller.songTime());
    if (text !== last.current) {
      last.current = text;
      el.textContent = text;
    }
  });
  return (
    <div className="flex items-baseline gap-1.5" role="timer" aria-label="播放時間">
      <span ref={ref} className="font-numeric text-c-clock text-label">
        0:00.00
      </span>
      <span className="font-numeric text-c-footnote text-label-2">/ {formatTime(duration).slice(0, -3)}</span>
    </div>
  );
}

/** The thumbnail + title pair, also rendered by the loading skeleton (same view-transition names). */
export function TitleBlock({ id, title, subtitle, palette }: { id: string; title: string; subtitle?: ReactNode; palette: readonly string[] }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ViewTransition name={projectArtName(id)} share="morph" default="none">
        <span aria-hidden="true" className="size-7 shrink-0 rounded-[7px] shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.12)]" style={{ background: artBackground(palette) }} />
      </ViewTransition>
      <div className="flex min-w-0 flex-col justify-center">
        <ViewTransition name={projectTitleName(id)} share="morph" default="none">
          <h1 className="min-w-0 truncate text-c-headline text-label">{title}</h1>
        </ViewTransition>
        {subtitle != null && <div className="flex min-w-0 items-center text-c-footnote text-label-2">{subtitle}</div>}
      </div>
    </div>
  );
}

/** A red text button in the subtitle slot (the only alerts: another console, save failed). */
function AlertLink({ children, onClick, tip }: { children: ReactNode; onClick: () => void; tip: string }) {
  return (
    <Tooltip content={tip} placement="bottom-start">
      <button type="button" onClick={onClick} className="press-fade -mx-1 -my-1.5 inline-flex h-7 min-w-0 items-center rounded-xs px-1 font-semibold text-red-text hover:bg-red-soft">
        <span className="truncate">{children}</span>
      </button>
    </Tooltip>
  );
}

const SAVED_SHOWN_MS = 2500;

/** One informational line under the title: the artist and at most one status (one 「・」). */
function Subtitle({ controller, snap }: { controller: ConsoleController; snap: ConsoleSnapshot }) {
  const project = snap.project;
  const save = snap.save;
  // 「已儲存」 is a moment, not a state: show it briefly after each save
  const [savedFresh, setSavedFresh] = useState(false);
  const [prevStatus, setPrevStatus] = useState(save.status);
  if (save.status !== prevStatus) {
    setPrevStatus(save.status);
    setSavedFresh(save.status === "saved");
  }
  useEffect(() => {
    if (!savedFresh) return;
    const t = setTimeout(() => setSavedFresh(false), SAVED_SHOWN_MS);
    return () => clearTimeout(t);
  }, [savedFresh]);

  if (snap.otherConsole) {
    return (
      <AlertLink tip="另一個分頁的控制台也在送出畫面，投影可能會閃爍。請關掉多餘的控制台。" onClick={() => controller.notify("另一個分頁的控制台也在送出畫面，投影可能會閃爍。請關掉多餘的控制台。", "warn")}>
        另一個控制台也在控制
      </AlertLink>
    );
  }
  if (save.status === "error") {
    return (
      <AlertLink tip={save.error ? `儲存失敗：${save.error}` : "修改沒有存進這台電腦，按一下再試一次"} onClick={() => void controller.flushSave()}>
        儲存失敗・重試
      </AlertLink>
    );
  }

  const lyrics = project?.lyrics;
  const untimed = lyrics ? untimedCount(lyrics) : 0;
  let status: ReactNode = null;
  let tone: "label-2" | "orange" | "red" = "label-2";
  if (save.status === "saving" || save.status === "pending") status = "儲存中…";
  else if (savedFresh) status = "已儲存";
  else if (project?.status === "error") {
    status = "上次處理失敗";
    tone = "red";
  } else if (project?.status === "processing") status = "處理中…";
  else if (lyrics && lyrics.lines.length === 0) {
    status = "無歌詞";
    tone = "orange";
  } else if (untimed > 0) {
    status = `${untimed} 行未對時`;
    tone = "orange";
  } else if (project?.research) status = project.research.engine === "claude" ? "Claude 設計" : "離線設計";

  const artist = project?.meta?.artist || "未知藝人";
  return (
    <span className="min-w-0 truncate" title={project?.status === "error" ? project.error : undefined}>
      {artist}
      {status != null && (
        <>
          ・<span className={cx(tone === "orange" && "text-orange-text", tone === "red" && "text-red-text")}>{status}</span>
        </>
      )}
    </span>
  );
}

/** The projection as one split control: status segment (dot, 「投影已連線」, size) + 「開啟」. */
function OutputControl({ snap, onOpen }: { snap: ConsoleSnapshot; onOpen: () => void }) {
  const o = snap.output;
  const detail = o.connected ? `投影視窗已連線：${o.width}×${o.height}，${o.fullscreen ? "全螢幕" : "視窗模式"}${o.count > 1 ? `，共 ${o.count} 個視窗` : ""}` : "投影視窗未連線。開啟後拖到投影機或 LED 螢幕上。";
  return (
    <div className="flex h-8 shrink-0 items-stretch rounded-sm bg-fill-3">
      <Tooltip content={detail} placement="bottom-end">
        <div role="status" className="flex min-w-0 items-center gap-2 pr-2.5 pl-3">
          <span className="relative flex size-1.5 shrink-0" aria-hidden="true">
            <span className={cx("size-1.5 rounded-full", o.connected ? "bg-green" : "bg-label-3")} />
            {/* mounts when the output connects: one 600 ms ring per connection, never a loop */}
            {o.connected && <span className="absolute inset-0 animate-halo rounded-full" />}
          </span>
          <span className="text-c-footnote font-medium whitespace-nowrap text-label">{o.connected ? (o.count > 1 ? `投影已連線 ×${o.count}` : "投影已連線") : "投影未連線"}</span>
          {o.connected && (
            <span className="hidden font-numeric text-c-footnote whitespace-nowrap text-label-2 min-[1400px]:inline">
              {o.width}×{o.height}
            </span>
          )}
        </div>
      </Tooltip>
      <span aria-hidden="true" className="my-[7px] w-(--hairline) bg-separator" />
      <Tooltip content={o.connected ? "聚焦投影視窗" : "開啟投影視窗"} shortcut="O" placement="bottom-end">
        <button
          type="button"
          aria-label="開啟投影視窗"
          onClick={onOpen}
          className="press-fade flex items-center gap-1.5 rounded-r-sm pr-3 pl-2.5 text-c-footnote font-semibold whitespace-nowrap text-tint-text hover:bg-fill-4"
        >
          <ProjectorScreenIcon size={16} />
          開啟
        </button>
      </Tooltip>
    </div>
  );
}

export function TopBar({
  controller,
  snap,
  onRedesign,
  onHelp,
}: {
  controller: ConsoleController;
  snap: ConsoleSnapshot;
  onRedesign: () => void;
  onHelp: () => void;
}) {
  const project = snap.project;
  const live = snap.mode === "live";
  const held = live && snap.liveHeld;
  const ov = useStageValue(controller.store, selectOverrides);
  const capsules = capsuleItems(ov, snap);
  const palette = (project?.plan?.keyVisual.palette ?? []).map((p) => p.hex);

  const status = live
    ? held
      ? "LIVE・等待下一句"
      : snap.playing
        ? "LIVE・時脈運行中"
        : "LIVE・手動提詞"
    : snap.audio.status === "error"
      ? "音檔錯誤"
      : snap.audio.buffering
        ? "緩衝中…"
        : snap.audio.status === "loading"
          ? "載入音檔中…"
          : snap.playbackRate !== 1
            ? `TRACK・${snap.playbackRate}× 速度`
            : "TRACK・跟隨音檔";

  return (
    <header
      className="relative z-20 grid h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-center gap-4 bg-surface px-3 border-b-hairline"
      style={{ viewTransitionName: "app-header" }}
    >
      {/* left: back, title, capsules (pushed right, next to the transport) */}
      <div className="flex min-w-0 items-center gap-3">
        <BackLink
          onNavigate={(e) => {
            if (!controller.confirmLeave()) e.preventDefault();
          }}
        />
        <TitleBlock id={controller.id} title={project?.meta?.title || "未命名歌曲"} palette={palette} subtitle={<Subtitle controller={controller} snap={snap} />} />
        <StatusCapsules items={capsules} className="ml-auto shrink-0" aria-label="目前狀態" />
      </div>

      {/* centre: mode, transport, clock */}
      <div className="flex items-center gap-4">
        <Tooltip content={live ? "LIVE：由你逐句送出" : "TRACK：跟著音檔時間自動播放"} shortcut="M">
          <span className="inline-flex">
            <SegmentedControl
              label="播放模式"
              value={snap.mode}
              onChange={(m) => controller.setMode(m)}
              blurOnPointer
              fullWidth
              className="w-[136px]"
              options={[
                { value: "track", label: <span className="t-latin">TRACK</span>, ariaLabel: "TRACK" },
                {
                  value: "live",
                  ariaLabel: "LIVE",
                  label: (
                    <span className="inline-flex items-center gap-1.5 t-latin">
                      {live && <Dot className="bg-red" label="on-air" />}
                      LIVE
                    </span>
                  ),
                },
              ]}
            />
          </span>
        </Tooltip>

        <div className="flex items-center gap-1" role="group" aria-label="播放控制">
          <Tooltip content="上一句" shortcut="ArrowLeft">
            <Button variant="quiet" size="icon" aria-label="上一句" icon={SkipBackIcon} className="text-label!" onClick={() => controller.prev()} />
          </Tooltip>
          <Tooltip content={live ? (snap.playing ? "停止 LIVE 時脈" : "啟動 LIVE 時脈") : snap.playing ? "暫停" : "播放"} shortcut={live ? undefined : "Space"}>
            <Button
              size="circle"
              aria-label={snap.playing ? "暫停" : "播放"}
              icon={snap.playing ? PauseIcon : PlayIcon}
              onClick={() => controller.togglePlay()}
              disabled={!live && snap.audio.status === "error"}
            />
          </Tooltip>
          <Tooltip content={held ? "送出下一句" : "下一句"} shortcut={held ? "Space" : "ArrowRight"}>
            <Button
              variant="quiet"
              size="icon"
              aria-label="下一句"
              icon={SkipForwardIcon}
              className={cx("text-label!", held && "bg-orange-soft text-orange-text! ring-2 ring-orange ring-inset")}
              onClick={() => controller.next()}
            />
          </Tooltip>
        </div>

        <div className="flex w-[150px] flex-col justify-center">
          <TimeReadout controller={controller} duration={snap.duration} />
          <span className="truncate text-c-footnote text-label-2" aria-live="polite">
            {status}
          </span>
        </div>
      </div>

      {/* right: projection, re-design, help */}
      <div className="flex min-w-0 items-center justify-end gap-2">
        <OutputControl snap={snap} onOpen={() => controller.openOutput()} />
        <Tooltip content={snap.redesign.running ? "重新設計進行中，按一下查看進度" : "用一句話請 AI 設計師調整方案"} placement="bottom-end">
          <Button variant="gray" icon={SparkleIcon} loading={snap.redesign.running} onClick={onRedesign}>
            重新設計
          </Button>
        </Tooltip>
        <Tooltip content="快捷鍵說明" shortcut="?" placement="bottom-end">
          <Button variant="quiet" size="icon" aria-label="快捷鍵說明" icon={QuestionIcon} onClick={onHelp} />
        </Tooltip>
      </div>
    </header>
  );
}
