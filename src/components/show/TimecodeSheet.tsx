"use client";

// 設定時間碼 (phase 5a): where a setlist song starts on the playback rig's timecode (MTC or LTC).
// By default one song per hour in setlist order (song 3 → 03:00:00:00); a custom start pins the song
// wherever the rig's session has it. The show console chases this (the song on air follows it, and
// 「跟隨時間碼換歌」 takes the song whose range the timecode enters).

import { useId, useState } from "react";
import { Button, FormRow, InsetGroup, SegmentedControl, Sheet, rowInputClass } from "@/components/ui";
import { MAX_TC_HOUR, hourTc, normalizeTcInput } from "@/lib/sync/timecode";

export interface TimecodeSheetSong {
  itemId: string;
  title: string;
  /** 1-based among the songs */
  songNumber: number;
  /** its own start timecode, or null for the setlist position */
  timecode: string | null;
}

export function TimecodeSheet({
  song,
  others,
  onClose,
  onSave,
}: {
  song: TimecodeSheetSong | null;
  /** every other song's start (for the duplicate warning) */
  others: ReadonlyArray<{ start: string; label: string }>;
  onClose: () => void;
  onSave: (timecode: string | null) => void;
}) {
  const fid = useId();
  const [mode, setMode] = useState<"auto" | "custom">("auto");
  const [text, setText] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const key = song ? `${song.itemId}|${song.timecode ?? ""}` : null;
  if (key !== shown) {
    setShown(key);
    setMode(song?.timecode ? "custom" : "auto");
    setText(song?.timecode ?? "");
  }
  const auto = song ? hourTc(song.songNumber) : null;
  const normalized = mode === "custom" ? normalizeTcInput(text) : null;
  const invalid = mode === "custom" && text.trim() !== "" && !normalized;
  const start = mode === "auto" ? auto : normalized;
  const clash = start ? others.find((o) => o.start === start) : undefined;
  const canSave = !!song && (mode === "auto" ? true : !!normalized);

  const save = () => {
    if (!canSave) return;
    onSave(mode === "auto" ? null : normalized);
  };

  return (
    <Sheet
      open={!!song}
      onClose={onClose}
      title={song ? `「${song.title}」的時間碼` : "時間碼"}
      width={520}
      action={
        <Button variant="filled" disabled={!canSave} onClick={save}>
          儲存
        </Button>
      }
    >
      {song && (
        <div className="flex flex-col gap-4 pb-1">
          <p className="text-[13px] leading-5 text-label-2">播放端（Ableton Live、QLab、錄音座…）送出的 MTC 或 LTC 走到這個時間碼，就是這首歌的開頭。控制台在「同步」選 MTC 或 LTC 後就會跟著走。</p>
          <SegmentedControl
            label="起點時間碼"
            fullWidth
            value={mode}
            onChange={setMode}
            options={[
              { value: "auto", label: "依歌單順序", caption: auto ? `第 ${song.songNumber} 首從 ${auto} 開始（一首歌一小時）。` : `第 ${song.songNumber} 首超過 ${MAX_TC_HOUR} 小時：請自訂起點。` },
              { value: "custom", label: "自訂起點", caption: "可以只填小時（例如 2），或完整的 HH:MM:SS:FF。" },
            ]}
          />
          {mode === "custom" && (
            <InsetGroup>
              <FormRow label="起點" htmlFor={fid} error={invalid ? "格式是 HH:MM:SS:FF（例如 02:00:00:00），小時 0 到 23。" : undefined}>
                <input
                  id={fid}
                  className={rowInputClass}
                  value={text}
                  placeholder={auto ?? "02:00:00:00"}
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      save();
                    }
                  }}
                  data-timecode-input=""
                />
              </FormRow>
            </InsetGroup>
          )}
          {start && (
            <p className="text-[13px] leading-5 text-label" data-timecode-preview="">
              這首歌從 <span className="font-numeric tabular">{start}</span> 開始
              {clash ? <span className="text-orange-text">：和{clash.label}相同，時間碼只會帶到其中一首。</span> : "。"}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
