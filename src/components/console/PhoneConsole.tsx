"use client";

// The console on a phone (narrower than 900 px): the desktop grid needs 1280 px, so a phone gets
// the part of a show that fits in one hand — the preview, the line on stage and the next one, big
// 上一句 / 下一句 (or play / pause while following the track), 黑場 and 歌詞, the mode switch and the
// lyric list to jump anywhere. Everything else (design panel, timeline, sync, cues) stays on the
// computer. BroadcastChannel only reaches windows of the same browser, so a phone drives a
// projection window opened on the phone itself (e.g. over an HDMI adapter).

import type { RefObject } from "react";
import { BackLink, Button, SegmentedControl, cx } from "@/components/ui";
import { MoonIcon, PauseIcon, PlayIcon, ProjectorScreenIcon, SkipBackIcon, SkipForwardIcon, SpeakerHighIcon, SpeakerSlashIcon, SubtitlesIcon, SubtitlesSlashIcon } from "@/components/ui/Icon";
import type { HudHandle } from "@/components/ui/HUD";
import type { ConsoleController, ConsoleSnapshot } from "@/lib/console/controller";
import { selectLineIndex, selectOverrides, useStageValue } from "@/lib/console/hooks";
import type { Project } from "@/lib/types";
import { LyricsList } from "./LyricsList";
import { PreviewPanel } from "./Preview";

export function PhoneConsole({
  controller,
  snap,
  project,
  hudRef,
}: {
  controller: ConsoleController;
  snap: ConsoleSnapshot;
  project: Project;
  hudRef: RefObject<HudHandle | null>;
}) {
  const live = snap.mode === "live";
  const ov = useStageValue(controller.store, selectOverrides);
  const lineIndex = useStageValue(controller.store, selectLineIndex);
  const lines = project.lyrics.lines;
  const current = lineIndex != null ? lines[lineIndex] : null;
  const next = lines[(lineIndex ?? -1) + 1] ?? null;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-label" data-testid="phone-console">
      <header className="sticky top-0 z-20 flex flex-col gap-2 bg-surface px-4 pt-2 pb-3 border-b-hairline">
        <div className="flex h-10 min-w-0 items-center gap-3">
          <BackLink />
          <h1 className="min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold">{project.meta.title || "未命名歌曲"}</h1>
          <Button variant="gray" size="sm" icon={ProjectorScreenIcon} onClick={() => controller.openOutput()}>
            {snap.output.connected ? "投影已連線" : "開啟投影"}
          </Button>
        </div>
        <SegmentedControl
          label="播放模式"
          value={snap.mode}
          onChange={(m) => controller.chooseMode(m)}
          fullWidth
          options={[
            { value: "track", label: "跟音檔", ariaLabel: "跟音檔" },
            { value: "live", label: "手動切換", ariaLabel: "手動切換" },
          ]}
        />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex h-[30vh] min-h-[180px] flex-col">
          <PreviewPanel controller={controller} project={project} output={snap.output} hudRef={hudRef} />
        </div>

        <section aria-label="目前歌詞" aria-live="polite" className="rounded-lg bg-surface px-4 py-3">
          <p className="text-[13px] leading-5 text-label-2">現在</p>
          <p className="mt-0.5 min-h-7 text-[22px] leading-7 font-semibold">{current?.text || (live ? "按「下一句」送出第一句" : "—")}</p>
          <p className="mt-2 truncate text-[15px] leading-5 text-label-2">
            下一句　{next?.text ?? "（最後一句）"}
          </p>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="gray" size="lg" icon={SkipBackIcon} onClick={() => controller.prev()} className="h-14!">
            上一句
          </Button>
          {live ? (
            <Button variant="filled" size="lg" icon={SkipForwardIcon} onClick={() => controller.next()} className="h-14!">
              下一句
            </Button>
          ) : (
            <Button variant="filled" size="lg" icon={snap.playing ? PauseIcon : PlayIcon} onClick={() => controller.togglePlay()} disabled={snap.audio.status === "error"} className="h-14!">
              {snap.playing ? "暫停" : "播放"}
            </Button>
          )}
          <Button
            variant={ov.blackout ? "destructive-filled" : "gray"}
            size="lg"
            icon={MoonIcon}
            aria-pressed={ov.blackout}
            onClick={() => controller.toggleBlackout()}
            className="h-12!"
          >
            {ov.blackout ? "黑場中" : "黑場"}
          </Button>
          <Button variant="gray" size="lg" icon={ov.lyricsVisible ? SubtitlesIcon : SubtitlesSlashIcon} aria-pressed={!ov.lyricsVisible} onClick={() => controller.toggleLyrics()} className="h-12!">
            {ov.lyricsVisible ? "隱藏歌詞" : "顯示歌詞"}
          </Button>
        </div>

        {live && (
          <Button
            variant={snap.liveAudio ? "tinted" : "gray"}
            icon={snap.liveAudio ? SpeakerHighIcon : SpeakerSlashIcon}
            aria-pressed={snap.liveAudio}
            onClick={() => {
              controller.setLiveAudio(!snap.liveAudio);
              if (!snap.liveAudio) void controller.play();
            }}
          >
            {snap.liveAudio ? "音檔播放中（歌詞仍由你切）" : "同時播放音檔"}
          </Button>
        )}

        <div className={cx("flex min-h-[360px] flex-col")}>
          <LyricsList controller={controller} project={project} mode={snap.mode} selectedIndex={snap.selectedIndex} duration={snap.duration} />
        </div>

        <p className="px-1 pb-4 text-[12px] leading-4 text-label-2">
          手機上是精簡版控制台。投影視窗要開在同一台裝置上（例如手機接 HDMI）；段落、時間軸、同步與設計面板請用電腦。
        </p>
      </main>
    </div>
  );
}
