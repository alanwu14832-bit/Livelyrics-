"use client";

import { cx } from "@/components/ui";
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "@/components/home/icons";
import { formatTimeInput } from "./editor-model";
import { usePlayheadDuration, usePlayheadPlaying, usePlayheadRate, usePlayheadTime, type Playhead } from "./playhead";

const RATES = [0.5, 0.75, 1];

function TimeReadout({ playhead, duration }: { playhead: Playhead; duration: number }) {
  const t = usePlayheadTime(playhead);
  const d = usePlayheadDuration(playhead) || duration;
  return (
    <span className="font-mono text-sm tabular text-fg" aria-live="off">
      {formatTimeInput(t)}
      <span className="text-faint"> / {formatTimeInput(d)}</span>
    </span>
  );
}

export function Transport({ playhead, duration, disabled }: { playhead: Playhead; duration: number; disabled?: boolean }) {
  const playing = usePlayheadPlaying(playhead);
  const rate = usePlayheadRate(playhead);
  const btn =
    "inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-panel-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={btn} onClick={() => playhead.seek(playhead.getTime() - 5)} disabled={disabled} aria-label="倒退 5 秒" title="倒退 5 秒（Shift+←）">
        <SkipBackIcon size={15} />
      </button>
      <button
        type="button"
        onClick={() => playhead.toggle()}
        disabled={disabled}
        aria-label={playing ? "暫停" : "播放"}
        title={playing ? "暫停（Space）" : "播放（Space）"}
        className="inline-flex size-9 items-center justify-center rounded-full bg-fg text-bg transition hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
      >
        {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} className="translate-x-px" />}
      </button>
      <button type="button" className={btn} onClick={() => playhead.seek(playhead.getTime() + 5)} disabled={disabled} aria-label="快轉 5 秒" title="快轉 5 秒（Shift+→）">
        <SkipForwardIcon size={15} />
      </button>
      <span className="ml-2 min-w-[9.5rem]">
        <TimeReadout playhead={playhead} duration={duration} />
      </span>
      <div role="radiogroup" aria-label="播放速度" className="ml-1 flex items-center rounded-md border border-line p-0.5">
        {RATES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={Math.abs(rate - r) < 0.01}
            onClick={() => playhead.setRate(r)}
            disabled={disabled}
            title={r < 1 ? "放慢播放，對拍比較準" : "正常速度"}
            className={cx(
              "h-6 rounded px-1.5 font-mono text-[11px] transition-colors",
              Math.abs(rate - r) < 0.01 ? "bg-panel-3 text-fg" : "text-muted hover:text-fg",
            )}
          >
            {r}×
          </button>
        ))}
      </div>
    </div>
  );
}
