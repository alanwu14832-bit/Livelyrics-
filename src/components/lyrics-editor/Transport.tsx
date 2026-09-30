"use client";

import { Button, SegmentedControl, Tooltip } from "@/components/ui";
import { FastForwardIcon, PauseIcon, PlayIcon, RewindIcon } from "@/components/ui/Icon";
import { formatTimeInput } from "./editor-model";
import { usePlayheadDuration, usePlayheadPlaying, usePlayheadRate, usePlayheadTime, type Playhead } from "./playhead";

const RATES = ["0.5", "0.75", "1"] as const;
type Rate = (typeof RATES)[number];

function TimeReadout({ playhead, duration }: { playhead: Playhead; duration: number }) {
  const t = usePlayheadTime(playhead);
  const d = usePlayheadDuration(playhead) || duration;
  return (
    <span className="t-latin font-numeric text-[17px] leading-6 font-semibold tabular text-label" aria-live="off">
      {formatTimeInput(t)}
      <span className="font-normal text-label-2"> / {formatTimeInput(d)}</span>
    </span>
  );
}

function nearestRate(rate: number): Rate {
  return RATES.reduce((best, r) => (Math.abs(Number(r) - rate) < Math.abs(Number(best) - rate) ? r : best), "1" as Rate);
}

/** Play / pause (the white circle), ±5 s, the time and the playback speed. */
export function Transport({ playhead, duration, disabled }: { playhead: Playhead; duration: number; disabled?: boolean }) {
  const playing = usePlayheadPlaying(playhead);
  const rate = usePlayheadRate(playhead);
  // after a mouse click the keyboard belongs to the page again (Space = play / pause, ← → = seek)
  const blur = (e: { currentTarget: HTMLElement; detail: number }) => {
    if (e.detail > 0) e.currentTarget.blur();
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 gap-y-2">
      <Tooltip content="倒退 5 秒" shortcut="Shift+ArrowLeft">
        <Button variant="quiet" size="icon" aria-label="倒退 5 秒" icon={RewindIcon} disabled={disabled} onClick={(e) => (playhead.seek(playhead.getTime() - 5), blur(e))} />
      </Tooltip>
      <Tooltip content={playing ? "暫停" : "播放"} shortcut="Space">
        <Button
          size="circle"
          aria-label={playing ? "暫停" : "播放"}
          icon={playing ? <PauseIcon size={20} /> : <PlayIcon size={20} className="translate-x-px" />}
          disabled={disabled}
          onClick={(e) => {
            playhead.toggle();
            blur(e);
          }}
        />
      </Tooltip>
      <Tooltip content="快轉 5 秒" shortcut="Shift+ArrowRight">
        <Button variant="quiet" size="icon" aria-label="快轉 5 秒" icon={FastForwardIcon} disabled={disabled} onClick={(e) => (playhead.seek(playhead.getTime() + 5), blur(e))} />
      </Tooltip>
      <span className="ml-3 whitespace-nowrap md:min-w-[10.5rem]">
        <TimeReadout playhead={playhead} duration={duration} />
      </span>
      <SegmentedControl
        label="播放速度"
        className="shrink-0"
        value={nearestRate(rate)}
        onChange={(r) => playhead.setRate(Number(r))}
        blurOnPointer
        disabled={disabled}
        options={RATES.map((r) => ({ value: r, label: <span className="t-latin tabular">{r}×</span>, ariaLabel: `${r} 倍速` }))}
      />
    </div>
  );
}
