"use client";

import Link from "next/link";
import { useRef } from "react";
import { Badge, Button, cx } from "@/components/ui";
import type { ConsoleController, ConsoleSnapshot } from "@/lib/console/controller";
import { formatOffset } from "@/lib/console/format";
import { untimedCount } from "@/lib/console/navigation";
import { formatTime } from "@/lib/timeline";
import { IconBack, IconHelp, IconMonitor, IconNextLine, IconPause, IconPlay, IconPrevLine, IconSparkles, IconWarning } from "./icons";
import { Segmented } from "./controls";
import { useRafLoop } from "./useRaf";

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
    <div className="flex items-baseline gap-1.5 font-mono tabular" aria-label="播放時間">
      <span ref={ref} className="text-[22px] leading-none font-semibold tracking-tight text-fg">
        0:00.00
      </span>
      <span className="text-xs text-faint">/ {formatTime(duration).slice(0, -3)}</span>
    </div>
  );
}

function OutputPill({ snap, onOpen }: { snap: ConsoleSnapshot; onOpen: () => void }) {
  const o = snap.output;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={o.connected ? "投影視窗已連線（點擊聚焦）" : "投影視窗未連線（點擊開啟）"}
      className={cx(
        "flex h-9 items-center gap-2 rounded-md border px-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent",
        o.connected ? "border-ok/40 bg-ok/10 hover:bg-ok/15" : "border-line bg-panel-2 hover:border-faint",
      )}
    >
      <span className="relative flex size-2.5 items-center justify-center" aria-hidden="true">
        {o.connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-50" />}
        <span className={cx("relative inline-flex size-2 rounded-full", o.connected ? "bg-ok" : "bg-faint")} />
      </span>
      <span className="flex flex-col leading-tight">
        <span className={cx("text-xs font-semibold", o.connected ? "text-ok" : "text-muted")}>
          {o.connected ? (o.count > 1 ? `投影已連線 ×${o.count}` : "投影已連線") : "投影未連線"}
        </span>
        <span className="font-mono text-[10px] text-faint tabular">
          {o.connected ? `${o.width}×${o.height}${o.fullscreen ? " · 全螢幕" : " · 視窗"}` : "按 O 開啟"}
        </span>
      </span>
    </button>
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
  const meta = project?.meta;
  const lyrics = project?.lyrics;
  const untimed = lyrics ? untimedCount(lyrics) : 0;
  const live = snap.mode === "live";
  const save = snap.save;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <Link
        href="/"
        onClick={(e) => {
          if (!controller.confirmLeave()) e.preventDefault();
        }}
        className="flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-panel-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        <IconBack />
        專案庫
      </Link>
      <div className="h-6 w-px shrink-0 bg-line" aria-hidden="true" />

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm leading-tight font-semibold text-fg" title={meta?.title}>
            {meta?.title || "未命名歌曲"}
          </h1>
          <p className="truncate text-[11px] leading-tight text-muted" title={meta?.artist}>
            {meta?.artist || "未知藝人"}
            {meta?.album ? ` · ${meta.album}` : ""}
          </p>
        </div>
        <div className="hidden min-w-0 items-center gap-1 min-[1440px]:flex">
          {project?.research && (
            <Badge tone={project.research.engine === "claude" ? "accent" : "neutral"} title={project.research.model ?? undefined}>
              {project.research.engine === "claude" ? "Claude 設計" : "離線設計"}
            </Badge>
          )}
          {lyrics && lyrics.lines.length === 0 && <Badge tone="warn">無歌詞</Badge>}
          {lyrics && lyrics.lines.length > 0 && untimed === 0 && <Badge tone="ok">歌詞已對時</Badge>}
          {lyrics && untimed > 0 && <Badge tone="warn">{untimed} 行未對時</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {project?.status === "processing" && <Badge tone="accent">處理中…</Badge>}
          {project?.status === "error" && (
            <Badge tone="danger" title={project.error}>
              上次處理失敗
            </Badge>
          )}
          {snap.redesign.running && (
            <button type="button" onClick={onRedesign} className="focus-visible:outline-2 focus-visible:outline-accent">
              <Badge tone="accent" className="animate-pulse">
                重新設計中…
              </Badge>
            </button>
          )}
          {save.status === "saving" || save.status === "pending" ? (
            <Badge>儲存中…</Badge>
          ) : save.status === "error" ? (
            <button type="button" onClick={() => void controller.flushSave()} title={save.error ?? undefined}>
              <Badge tone="danger">儲存失敗・重試</Badge>
            </button>
          ) : save.status === "saved" ? (
            <Badge tone="ok">已儲存</Badge>
          ) : null}
          {snap.otherConsole && (
            <Badge tone="danger" title="另一個分頁的控制台也在送出畫面，投影可能會閃爍。請關掉多餘的控制台。">
              <IconWarning size={12} />
              另一個控制台也在控制
            </Badge>
          )}
        </div>
      </div>

      <Segmented
        label="播放模式"
        value={snap.mode}
        onChange={(m) => controller.setMode(m)}
        options={[
          { value: "track", label: "TRACK", title: "跟著音檔時間自動播放（M 切換）" },
          { value: "live", label: "LIVE", title: "樂團現場：手動逐句送出（M 切換）" },
        ]}
      />

      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="播放控制">
        <Button variant="ghost" size="md" className="w-9 px-0 text-fg/80" onClick={() => controller.prev()} aria-label="上一句" title="上一句（← / ↑）">
          <IconPrevLine size={18} />
        </Button>
        <Button
          variant="primary"
          size="md"
          className={cx("w-12 px-0", live && snap.liveHeld && "animate-pulse")}
          onClick={() => controller.togglePlay()}
          aria-label={snap.playing ? "暫停" : "播放"}
          title={live ? (snap.playing ? "停止 LIVE 時脈" : "啟動 LIVE 時脈") : "播放／暫停（Space）"}
          disabled={!live && snap.audio.status === "error"}
        >
          {snap.playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        </Button>
        <Button variant="ghost" size="md" className="w-9 px-0 text-fg/80" onClick={() => controller.next()} aria-label="下一句" title="下一句（→ / ↓）">
          <IconNextLine size={18} />
        </Button>
      </div>

      <div className="flex w-[168px] shrink-0 flex-col items-start justify-center">
        <TimeReadout controller={controller} duration={snap.duration} />
        <span className="text-[10px] leading-tight text-faint">
          {live
            ? snap.liveHeld
              ? "LIVE · 等待下一句"
              : snap.playing
                ? "LIVE · 時脈運行中"
                : "LIVE · 手動提詞"
            : snap.audio.status === "error"
              ? "音檔錯誤"
              : snap.audio.buffering
                ? "緩衝中…"
                : snap.audio.status === "loading"
                  ? "載入音檔中…"
                  : [
                      "TRACK",
                      snap.playbackRate !== 1 ? `${snap.playbackRate}× 速度` : "跟隨音檔",
                      snap.offset !== 0 ? `偏移 ${formatOffset(snap.offset)}` : null,
                      snap.muted ? "靜音" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
        </span>
      </div>

      <div className="h-6 w-px shrink-0 bg-line" aria-hidden="true" />
      <OutputPill snap={snap} onOpen={() => controller.openOutput()} />
      <Button variant="secondary" onClick={() => controller.openOutput()} title="開啟投影視窗（O）" className="shrink-0">
        <IconMonitor />
        開啟投影視窗
      </Button>
      <Button variant="secondary" onClick={onRedesign} className="shrink-0" title="用一句話請 AI 設計師調整方案">
        <IconSparkles />
        重新設計
      </Button>
      <Button variant="ghost" className="w-9 shrink-0 px-0 text-fg/80" onClick={onHelp} aria-label="快捷鍵說明" title="快捷鍵說明（?）">
        <IconHelp size={18} />
      </Button>
    </header>
  );
}
