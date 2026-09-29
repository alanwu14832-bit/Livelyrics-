"use client";

// 同步: playback mode, lyric offset (a Stepper: ±0.05 s, Shift 0.01 s, auto-repeat), tempo (the
// analysis and a big tap-tempo tile), live audio input (a Switch row, device, 3 px meters with no
// track), monitoring (mute, volume, rate) and the projection window.

import { memo, useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { Button, Kbd, SegmentedControl, Slider, Spinner, Stepper, Switch, Tag, Tooltip, cx } from "@/components/ui";
import { CornersOutIcon, MicrophoneIcon, ProjectorScreenIcon, SpeakerHighIcon, SpeakerSlashIcon, XIcon } from "@/components/ui/Icon";
import type { ConsoleController, ConsoleSnapshot } from "@/lib/console/controller";
import { formatBpm, formatOffsetSeconds } from "@/lib/console/format";
import { OFFSET_FINE_STEP, OFFSET_STEP } from "@/lib/console/hotkeys";
import { OFFSET_LIMIT, PLAYBACK_RATES } from "@/lib/console/settings";
import type { Project } from "@/lib/types";
import { Footnote, Group, GroupTitle, PopupSelect } from "./ui";
import { useRafLoop } from "./useRaf";

/** A 3 px level bar with no track (UI-AUDIT §3.5 同步), written per frame through a ref. */
function Meter({ label, barRef }: { label: string; barRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="flex h-5 items-center gap-2">
      <span className="w-8 shrink-0 text-c-footnote text-label-2">{label}</span>
      <div className="relative h-[3px] flex-1" role="presentation">
        <div ref={barRef} className="absolute inset-0 origin-left rounded-full bg-tint" style={{ transform: "scaleX(0)" }} />
      </div>
    </div>
  );
}

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
    <div className="flex flex-col">
      <Meter label="音量" barRef={level} />
      <Meter label="低頻" barRef={bass} />
      <Meter label="起音" barRef={onset} />
      <div className="flex h-5 items-center gap-2">
        <span className="w-8 shrink-0 text-c-footnote text-label-2">拍點</span>
        <span ref={beat} className="size-2.5 rounded-full bg-tint" style={{ opacity: 0.15 }} aria-hidden="true" />
      </div>
    </div>
  );
}

/** A 32 px console row: label on the left, control on the right, hairline below (not after the last). */
function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "relative flex min-h-(--row-min-h) items-center gap-3 px-3 py-1.5",
        "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-3 after:h-(--hairline) after:bg-separator last:after:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SyncTabImpl({ controller, snap, project }: { controller: ConsoleController; snap: ConsoleSnapshot; project: Project }) {
  const live = snap.mode === "live";
  const analysis = project.analysis;
  const mic = snap.mic;
  const micId = useId();

  useEffect(() => {
    void controller.refreshDevices();
  }, [controller]);

  const analysisBpm = formatBpm(analysis?.bpm);
  const tapBpm = formatBpm(snap.tap.bpm);
  const o = snap.output;

  return (
    <div className="flex flex-col gap-5 px-3 pt-1 pb-4">
      <section aria-labelledby="sync-mode">
        <GroupTitle id="sync-mode" actions={<Kbd>M</Kbd>}>
          模式
        </GroupTitle>
        <SegmentedControl
          label="播放模式"
          fullWidth
          blurOnPointer
          value={snap.mode}
          onChange={(m) => controller.setMode(m)}
          className="mt-1"
          options={[
            { value: "track", label: <span className="t-latin">TRACK</span>, ariaLabel: "TRACK", caption: "跟著控制台播放的音檔時間自動換句，適合跟 click 或伴奏軌的演出與彩排。隨時可切到 LIVE 手動接手。" },
            { value: "live", label: <span className="t-latin">LIVE</span>, ariaLabel: "LIVE", caption: "樂團現場演出時用：按 Space 或 → 逐句送出，時間跳到該句並停在下一句開始前；可接麥克風讓畫面跟著現場律動。" },
          ]}
        />
      </section>

      <section aria-labelledby="sync-offset">
        <GroupTitle id="sync-offset" actions={live ? <Tag>LIVE 模式不使用</Tag> : undefined}>
          歌詞偏移
        </GroupTitle>
        <Group className={cx("mt-1", live && "opacity-60")}>
          <Row>
            <div className="min-w-0 flex-1">
              <p className="text-[17px] leading-[22px] font-semibold text-label tabular">{formatOffsetSeconds(snap.offset)}</p>
              <p className="text-c-footnote text-label-2">{snap.offset > 0 ? "歌詞提早出現" : snap.offset < 0 ? "歌詞延後出現" : "與音檔同步"}</p>
            </div>
            <Button size="sm" variant="plain" onClick={() => controller.setOffset(0)} disabled={snap.offset === 0}>
              歸零
            </Button>
            <Stepper
              label="歌詞偏移"
              value={snap.offset}
              step={OFFSET_STEP}
              fineStep={OFFSET_FINE_STEP}
              min={-OFFSET_LIMIT}
              max={OFFSET_LIMIT}
              onChange={(v) => controller.setOffset(v)}
              decrementLabel="偏移減 0.05 秒"
              incrementLabel="偏移加 0.05 秒"
            />
          </Row>
        </Group>
        <Footnote className="leading-5">
          快捷鍵 <Kbd className="align-middle">[</Kbd> <Kbd className="align-middle">]</Kbd> ±0.05 秒，加 Shift 為 ±0.01 秒。偏移會記在這台電腦上。
        </Footnote>
      </section>

      <section aria-labelledby="sync-tempo">
        <GroupTitle id="sync-tempo" actions={snap.tap.bpm != null ? <Button size="sm" variant="plain" onClick={() => controller.resetTap()}>清除</Button> : undefined}>
          拍速
        </GroupTitle>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Group className="px-3 py-2.5">
            <p className="text-c-footnote text-label-2">音檔分析</p>
            {analysisBpm ? (
              <p className="mt-0.5 text-[22px] leading-[26px] font-semibold text-label tabular">
                {analysisBpm}
                <span className="ml-1 text-c-footnote font-normal text-label-2">BPM</span>
              </p>
            ) : (
              <p className="mt-0.5 text-c-headline leading-[26px] text-label-2">無資料</p>
            )}
            <p className="text-c-footnote text-label-2">{analysis ? `可信度 ${Math.round((analysis.bpmConfidence ?? 0) * 100)}%` : "沒有分析資料"}</p>
          </Group>
          <Tooltip content="跟著拍子連續點擊" shortcut="T">
            <button type="button" onClick={() => controller.tap()} className="press-tile flex flex-col rounded-md bg-fill-3 px-3 py-2.5 text-left hover:bg-fill-2 active:bg-tint-soft">
              <span className="flex w-full items-center justify-between text-c-footnote text-label-2">
                <span className="t-latin">Tap tempo</span>
                <Kbd>T</Kbd>
              </span>
              {tapBpm ? (
                <span className="mt-0.5 text-[22px] leading-[26px] font-semibold text-label tabular">
                  {tapBpm}
                  <span className="ml-1 text-c-footnote font-normal text-label-2">BPM</span>
                </span>
              ) : (
                <span className="mt-0.5 text-c-headline leading-[26px] text-label">跟著拍子點</span>
              )}
              <span className="text-c-footnote text-label-2">{snap.tap.count > 0 ? `已點 ${snap.tap.count} 下` : "點擊或按 T"}</span>
            </button>
          </Tooltip>
        </div>
      </section>

      <section aria-labelledby="sync-mic">
        <GroupTitle id="sync-mic" actions={!live ? <Tag>LIVE 模式使用</Tag> : undefined}>
          現場音訊輸入
        </GroupTitle>
        <Group className="mt-1">
          <Row>
            <label htmlFor={micId} className="flex min-w-0 flex-1 items-center gap-2 text-c-body text-label">
              <MicrophoneIcon size={16} className={mic.status === "on" ? "text-green" : "text-label-2"} />
              麥克風
              {mic.status === "starting" && <Spinner size={14} label="開啟中…" className="text-c-footnote" />}
            </label>
            <Switch
              id={micId}
              checked={mic.status === "on"}
              disabled={mic.status === "starting"}
              onChange={(on) => (on ? void controller.enableMic() : controller.disableMic())}
            />
          </Row>
          <Row>
            <PopupSelect
              label="輸入裝置"
              hideLabel
              className="flex-1"
              value={mic.deviceId}
              onChange={(v) => controller.setMicDevice(v)}
              options={[
                { value: "", label: "預設輸入裝置" },
                ...mic.devices.filter((d) => d.deviceId && d.deviceId !== "default").map((d) => ({ value: d.deviceId, label: d.label })),
              ]}
            />
          </Row>
          <div className="px-3 py-2">
            <Meters controller={controller} />
          </div>
        </Group>
        {mic.status === "error" && mic.error && <Footnote className="text-red-text">{mic.error}</Footnote>}
        <Footnote>
          {live
            ? mic.status === "on"
              ? "畫面正在跟著現場音量、低頻與起音律動（不會播出聲音）。"
              : "接上混音台的 line out 或麥克風，讓畫面在 LIVE 模式跟著現場律動。"
            : "TRACK 模式直接分析控制台播放的音檔。"}
        </Footnote>
      </section>

      <section aria-labelledby="sync-monitor">
        <GroupTitle id="sync-monitor">監聽播放</GroupTitle>
        <Group className={cx("mt-1", live && "opacity-60")}>
          <div className="flex items-end gap-2 px-3 pt-1 pb-2">
            <Tooltip content={snap.muted ? "取消靜音" : "靜音"}>
              <Button
                variant="quiet"
                size="icon"
                aria-pressed={snap.muted}
                aria-label={snap.muted ? "取消靜音" : "靜音"}
                icon={snap.muted ? SpeakerSlashIcon : SpeakerHighIcon}
                className={cx("mb-0 shrink-0", snap.muted && "text-orange-text!")}
                onClick={() => controller.toggleMute()}
              />
            </Tooltip>
            <Slider className="flex-1" label="音量" value={snap.muted ? 0 : snap.volume} min={0} max={1} step={0.01} onChange={(v) => controller.setVolume(v)} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
          <Row className="justify-between">
            <span className="text-c-body text-label">播放速度</span>
            <SegmentedControl
              label="播放速度"
              blurOnPointer
              value={String(snap.playbackRate)}
              onChange={(v) => controller.setPlaybackRate(Number(v))}
              options={PLAYBACK_RATES.map((r) => ({ value: String(r), label: <span className="t-latin">{r}×</span>, ariaLabel: `${r} 倍速` }))}
            />
          </Row>
        </Group>
        <Footnote>速度只給彩排用。靜音後時間碼照走：可以讓控制台安靜地跟著樂團的伴奏軌同步。</Footnote>
      </section>

      <section aria-labelledby="sync-output">
        <GroupTitle id="sync-output">投影視窗</GroupTitle>
        <Group className="mt-1">
          <Row>
            <span className={cx("size-1.5 shrink-0 rounded-full", o.connected ? "bg-green" : "bg-label-3")} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-c-body text-label">
              {o.connected ? (
                <>
                  已連線・<span className="tabular">{o.width}×{o.height}</span> {o.fullscreen ? "全螢幕" : "視窗模式"}
                  {o.count > 1 ? `，${o.count} 個視窗` : ""}
                </>
              ) : (
                <span className="text-label-2">未連線</span>
              )}
            </span>
          </Row>
          <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
            <Button size="sm" variant="gray" icon={ProjectorScreenIcon} onClick={() => controller.openOutput()}>
              開啟或聚焦
            </Button>
            <Button size="sm" variant="gray" icon={CornersOutIcon} onClick={() => controller.requestOutputFullscreen()} disabled={!o.connected}>
              全螢幕
            </Button>
            <Button size="sm" variant="plain" icon={XIcon} onClick={() => controller.closeOutput()} disabled={!o.connected}>
              關閉投影
            </Button>
          </div>
        </Group>
        <Footnote>把投影視窗拖到投影機或 LED 螢幕上，在那個視窗按 F 或雙擊進入全螢幕。</Footnote>
      </section>
    </div>
  );
}

export const SyncTab = memo(SyncTabImpl);
