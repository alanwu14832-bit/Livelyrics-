"use client";

import { memo, useEffect, useRef } from "react";
import { Badge, Button, Kbd, cx } from "@/components/ui";
import type { ConsoleController, ConsoleSnapshot } from "@/lib/console/controller";
import { formatBpm, formatOffset } from "@/lib/console/format";
import { OFFSET_FINE_STEP, OFFSET_STEP } from "@/lib/console/hotkeys";
import { PLAYBACK_RATES } from "@/lib/console/settings";
import type { Project } from "@/lib/types";
import { MeterBar, Segmented, SectionTitle, Slider } from "./controls";
import { IconExpand, IconMic, IconMonitor, IconMute, IconVolume } from "./icons";
import { useRafLoop } from "./useRaf";

function Meters({ controller }: { controller: ConsoleController }) {
  const level = useRef<HTMLDivElement>(null);
  const bass = useRef<HTMLDivElement>(null);
  const onset = useRef<HTMLDivElement>(null);
  const beat = useRef<HTMLSpanElement>(null);
  useRafLoop(() => {
    const a = controller.store.get().audio;
    const set = (el: HTMLDivElement | null, v: number) => {
      if (el) el.style.transform = `scaleX(${Math.min(1, Math.max(0, v || 0)).toFixed(3)})`;
    };
    set(level.current, a.level);
    set(bass.current, a.bass);
    set(onset.current, a.onset);
    if (beat.current) {
      const flash = Math.pow(1 - Math.min(1, Math.max(0, a.beatPhase)), 3);
      beat.current.style.opacity = (0.15 + 0.85 * flash).toFixed(3);
    }
  });
  return (
    <div className="flex flex-col gap-1.5">
      <MeterBar label="音量" barRef={level} color="var(--color-ok)" />
      <MeterBar label="低頻" barRef={bass} color="var(--color-accent-2)" />
      <MeterBar label="起音" barRef={onset} color="var(--color-warn)" />
      <div className="flex items-center gap-2 text-[11px]">
        <span className="w-10 shrink-0 text-faint">拍點</span>
        <span ref={beat} className="size-3 rounded-full bg-accent" style={{ opacity: 0.15 }} aria-hidden="true" />
      </div>
    </div>
  );
}

function SyncTabImpl({ controller, snap, project }: { controller: ConsoleController; snap: ConsoleSnapshot; project: Project }) {
  const live = snap.mode === "live";
  const analysis = project.analysis;
  const mic = snap.mic;

  useEffect(() => {
    void controller.refreshDevices();
  }, [controller]);

  const offsetBtn = (delta: number, label: string, title?: string) => (
    <button
      type="button"
      onClick={() => controller.nudgeOffset(delta)}
      title={title}
      className="h-7 rounded-md border border-line bg-panel-2 font-mono text-[11px] text-muted hover:border-faint hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <SectionTitle>模式</SectionTitle>
        <div className="mt-1.5 flex items-center gap-2">
          <Segmented
            label="播放模式"
            value={snap.mode}
            onChange={(m) => controller.setMode(m)}
            options={[
              { value: "track", label: "TRACK" },
              { value: "live", label: "LIVE" },
            ]}
          />
          <Kbd>M</Kbd>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
          {live
            ? "LIVE：樂團現場演出時用。按 Space／→ 逐句送出，時間會跳到該句並走到下一句開始前停住；可接麥克風讓畫面跟著現場音量律動。"
            : "TRACK：跟著控制台播放的音檔時間自動換句（適合跟 click／伴奏軌的演出與彩排）。隨時可切到 LIVE 手動接手。"}
        </p>
      </div>

      <div className={cx(live && "opacity-60")}>
        <SectionTitle actions={live ? <Badge>LIVE 模式不使用</Badge> : undefined}>歌詞偏移</SectionTitle>
        <div className="mt-1.5 flex items-center justify-between rounded-lg border border-line bg-panel-2 px-3 py-2">
          <div>
            <p className={cx("font-mono text-2xl font-semibold tabular", snap.offset !== 0 ? "text-accent" : "text-fg")}>{formatOffset(snap.offset)}</p>
            <p className="text-[10px] text-faint">{snap.offset > 0 ? "歌詞提早出現" : snap.offset < 0 ? "歌詞延後出現" : "與音檔同步"}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => controller.setOffset(0)} disabled={snap.offset === 0}>
            歸零
          </Button>
        </div>
        <div className="mt-1.5 grid grid-cols-6 gap-1">
          {offsetBtn(-0.1, "−0.1")}
          {offsetBtn(-OFFSET_STEP, "−.05", "[")}
          {offsetBtn(-OFFSET_FINE_STEP, "−.01", "Shift+[")}
          {offsetBtn(OFFSET_FINE_STEP, "+.01", "Shift+]")}
          {offsetBtn(OFFSET_STEP, "+.05", "]")}
          {offsetBtn(0.1, "+0.1")}
        </div>
        <p className="mt-1 text-[10px] text-faint">
          快捷鍵 <Kbd>[</Kbd> <Kbd>]</Kbd> ±0.05 秒，加 Shift 為 ±0.01 秒。偏移會記在這台電腦上。
        </p>
      </div>

      <div>
        <SectionTitle>拍速</SectionTitle>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line bg-panel-2 px-3 py-2">
            <p className="text-[10px] text-faint">音檔分析</p>
            <p className="font-mono text-xl font-semibold text-fg tabular">
              {formatBpm(analysis?.bpm)}
              <span className="ml-1 text-[11px] font-normal text-faint">BPM</span>
            </p>
            <p className="text-[10px] text-faint">{analysis ? `可信度 ${Math.round((analysis.bpmConfidence ?? 0) * 100)}%` : "沒有分析資料"}</p>
          </div>
          <button
            type="button"
            onClick={() => controller.tap()}
            className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-left transition-colors hover:border-faint active:border-accent active:bg-accent/15 focus-visible:outline-2 focus-visible:outline-accent"
            title="跟著拍子連續點擊（T）"
          >
            <p className="flex items-center justify-between text-[10px] text-faint">
              Tap tempo <Kbd>T</Kbd>
            </p>
            <p className="font-mono text-xl font-semibold text-fg tabular">
              {formatBpm(snap.tap.bpm)}
              <span className="ml-1 text-[11px] font-normal text-faint">BPM</span>
            </p>
            <p className="text-[10px] text-faint">{snap.tap.count > 0 ? `已點 ${snap.tap.count} 下` : "點擊或按 T"}</p>
          </button>
        </div>
        {snap.tap.bpm != null && (
          <button type="button" onClick={() => controller.resetTap()} className="mt-1 text-[10px] text-faint hover:text-fg">
            清除 tap tempo
          </button>
        )}
      </div>

      <div>
        <SectionTitle actions={!live ? <Badge>LIVE 模式使用</Badge> : undefined}>現場音訊輸入</SectionTitle>
        <div className="mt-1.5 flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-2.5">
          <div className="flex items-center gap-2">
            <IconMic className={cx(mic.status === "on" ? "text-ok" : "text-faint")} />
            <select
              aria-label="音訊輸入裝置"
              value={mic.deviceId}
              onChange={(e) => controller.setMicDevice(e.target.value)}
              className="h-7 min-w-0 flex-1 truncate rounded-md border border-line bg-panel px-2 text-xs text-fg"
            >
              <option value="">預設輸入裝置</option>
              {mic.devices
                .filter((d) => d.deviceId && d.deviceId !== "default")
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
            </select>
            {mic.status === "on" ? (
              <Button size="sm" variant="secondary" onClick={() => controller.disableMic()}>
                關閉
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => void controller.enableMic()} disabled={mic.status === "starting"}>
                {mic.status === "starting" ? "開啟中…" : "啟用"}
              </Button>
            )}
          </div>
          {mic.status === "error" && mic.error && <p className="text-[11px] leading-relaxed text-danger">{mic.error}</p>}
          <p className="text-[10px] leading-relaxed text-faint">
            {live
              ? mic.status === "on"
                ? "畫面正在跟著現場音量、低頻與起音律動（不會播出聲音）。"
                : "接上混音台的 line out 或麥克風，讓畫面在 LIVE 模式跟著現場律動。"
              : "TRACK 模式直接分析控制台播放的音檔。"}
          </p>
          <Meters controller={controller} />
        </div>
      </div>

      <div className={cx(live && "opacity-60")}>
        <SectionTitle>監聽播放</SectionTitle>
        <div className="mt-1.5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => controller.toggleMute()}
              aria-pressed={snap.muted}
              aria-label={snap.muted ? "取消靜音" : "靜音"}
              className={cx("flex size-7 items-center justify-center rounded-md border", snap.muted ? "border-warn/60 bg-warn/10 text-warn" : "border-line text-muted hover:text-fg")}
            >
              {snap.muted ? <IconMute /> : <IconVolume />}
            </button>
            <div className="flex-1">
              <Slider label="音量" value={snap.muted ? 0 : snap.volume} min={0} max={1} step={0.01} onChange={(v) => controller.setVolume(v)} format={(v) => `${Math.round(v * 100)}%`} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">播放速度（彩排用）</span>
            <Segmented
              size="sm"
              label="播放速度"
              value={String(snap.playbackRate)}
              onChange={(v) => controller.setPlaybackRate(Number(v))}
              options={PLAYBACK_RATES.map((r) => ({ value: String(r), label: `${r}×` }))}
            />
          </div>
          <p className="text-[10px] leading-relaxed text-faint">靜音後時間碼照走：可以讓控制台安靜地跟著樂團的伴奏軌同步。</p>
        </div>
      </div>

      <div>
        <SectionTitle>投影視窗</SectionTitle>
        <div className="mt-1.5 rounded-lg border border-line bg-panel-2 p-2.5">
          <p className="flex items-center gap-2 text-xs">
            <span className={cx("size-2 rounded-full", snap.output.connected ? "bg-ok" : "bg-faint")} />
            {snap.output.connected ? (
              <span className="text-fg">
                已連線 · <span className="font-mono tabular">{snap.output.width}×{snap.output.height}</span> · {snap.output.fullscreen ? "全螢幕" : "視窗模式"}
                {snap.output.count > 1 ? ` · ${snap.output.count} 個視窗` : ""}
              </span>
            ) : (
              <span className="text-muted">未連線</span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => controller.openOutput()}>
              <IconMonitor size={14} />
              開啟／聚焦
            </Button>
            <Button size="sm" onClick={() => controller.requestOutputFullscreen()} disabled={!snap.output.connected}>
              <IconExpand size={14} />
              全螢幕
            </Button>
            <Button size="sm" variant="ghost" onClick={() => controller.closeOutput()} disabled={!snap.output.connected}>
              關閉投影
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-faint">把投影視窗拖到投影機／LED 螢幕上，在那個視窗按 F 或雙擊進入全螢幕。</p>
        </div>
      </div>
    </div>
  );
}

export const SyncTab = memo(SyncTabImpl);
