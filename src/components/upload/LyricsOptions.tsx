"use client";

// The lyrics column of the new-project card (UI-AUDIT §3.5, UI-09, UI-28): a segmented control
// (自動搜尋 / 貼上歌詞 / 之後再處理) with its hint as a caption underneath, then the LRCLIB results,
// the paste field or a short note. The e2e clicks the <label> 「貼上歌詞」, so the segments are
// native radios inside labels (SourceSegmented); the look and the spring thumb match the kit's
// SegmentedControl.

import { useId, useMemo, useRef } from "react";
import { Button, Tag, TextArea, cx } from "@/components/ui";
import { FileTextIcon } from "@/components/ui/Icon";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import { LyricsSearchPicker, type LyricsPick } from "./LyricsSearchPicker";

export type LyricsMode = "auto" | "paste" | "later";

const MODES: Array<{ id: LyricsMode; label: string; caption: string }> = [
  { id: "auto", label: "自動搜尋", caption: "到 LRCLIB 找同步歌詞，選一筆最接近的版本。" },
  { id: "paste", label: "貼上歌詞", caption: "貼上 LRC（含時間碼）或一行一句的純文字。" },
  { id: "later", label: "之後再處理", caption: "先做視覺設計，歌詞之後在歌詞編輯器加入。" },
];

const PASTE_PLACEHOLDER = `貼上 LRC（含時間碼）或一行一句的純文字歌詞，例如：
[00:12.30]夜色慢慢落在城市的邊緣
[00:16.05]我們把名字寫進風裡面

沒有時間碼也沒關係，系統會先依音訊粗略分配，之後可在歌詞編輯器對拍。`;

export function summarizeLyricsText(text: string) {
  if (!text.trim()) return null;
  const parsed = parseLyricsText(text);
  const timed = parsed.lines.filter((l) => l.start != null).length;
  return { lines: parsed.lines.length, timed, synced: parsed.synced, translations: parsed.lines.filter((l) => l.translation).length, preview: parsed.lines.slice(0, 3).map((l) => l.text) };
}

/**
 * The kit's SegmentedControl look (28 px, fill-3, one thumb on the CSS spring, hairlines between
 * unselected neighbours) built from native radios in <label>s: arrow keys, form semantics and
 * label clicks come from the platform.
 */
function SourceSegmented<T extends string>({
  name,
  value,
  options,
  onChange,
  label,
}: {
  name: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; caption?: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  const n = options.length;
  const selected = Math.max(0, options.findIndex((o) => o.id === value));
  const captionId = useId();
  const caption = options[selected]?.caption;
  return (
    <div className="flex w-full min-w-0 flex-col">
      <div role="radiogroup" aria-label={label} aria-describedby={caption ? captionId : undefined} className="relative grid h-7 w-full min-w-0 rounded-sm bg-fill-3 p-0.5 select-none" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-xs bg-segment-thumb shadow-thumb transition-transform duration-(--dur-spring) ease-spring motion-reduce:transition-none forced-colors:border forced-colors:border-[Highlight]"
          style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${selected * 100}%)` }}
        />
        {options.slice(1).map((o, k) => {
          const i = k + 1;
          const hidden = i === selected || i - 1 === selected;
          return (
            <span
              key={`sep-${o.id}`}
              aria-hidden="true"
              className={cx("pointer-events-none absolute top-[7px] bottom-[7px] w-(--hairline) bg-separator transition-opacity duration-(--dur-fast) ease-[ease]", hidden && "opacity-0")}
              style={{ left: `calc(2px + (100% - 4px) * ${i} / ${n})` }}
            />
          );
        })}
        {options.map((o, i) => {
          const on = i === selected;
          return (
            <label
              key={o.id}
              className={cx(
                "relative z-[1] flex h-6 min-w-0 cursor-default items-center justify-center rounded-xs px-3 text-[13px] leading-none whitespace-nowrap text-label",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-(--focus-ring)",
                "before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-['']",
                "transition-opacity duration-(--dur-release) ease-out",
                on ? "font-semibold" : "font-medium active:opacity-60 active:duration-(--dur-press)",
              )}
            >
              <input type="radio" name={name} value={o.id} checked={on} onChange={() => onChange(o.id)} className="sr-only" />
              <span className="truncate">{o.label}</span>
            </label>
          );
        })}
      </div>
      {caption && (
        <p id={captionId} className="mt-1.5 px-0.5 text-[12px] leading-4 text-label-2">
          {caption}
        </p>
      )}
    </div>
  );
}

export function LyricsOptions({
  mode,
  onModeChange,
  title,
  artist,
  duration,
  pick,
  onPickChange,
  pasteText,
  onPasteTextChange,
  pasteError,
  disabled,
}: {
  mode: LyricsMode;
  onModeChange: (m: LyricsMode) => void;
  title: string;
  artist: string;
  duration: number;
  pick: LyricsPick | null;
  onPickChange: (p: LyricsPick | null) => void;
  pasteText: string;
  onPasteTextChange: (t: string) => void;
  /** inline validation message under the paste field */
  pasteError?: string | null;
  disabled?: boolean;
}) {
  const group = useId();
  const pasteErrorId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const summary = useMemo(() => summarizeLyricsText(pasteText), [pasteText]);

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="float-left mb-1.5 w-full px-(--row-pad-x) text-[13px] leading-5 text-label-2">歌詞</legend>
      <div className="clear-both">
        <SourceSegmented name={group} label="歌詞來源" value={mode} options={MODES} onChange={onModeChange} />
      </div>

      <div key={mode} className="mt-4 min-w-0 transition-opacity duration-(--dur-base) ease-out starting:opacity-0">
        {mode === "auto" && <LyricsSearchPicker title={title} artist={artist} duration={duration} value={pick} onChange={onPickChange} />}

        {mode === "paste" && (
          <div className="min-w-0">
            <TextArea
              value={pasteText}
              onChange={(e) => onPasteTextChange(e.target.value)}
              placeholder={PASTE_PLACEHOLDER}
              aria-label="貼上歌詞"
              aria-describedby={pasteError ? pasteErrorId : undefined}
              invalid={!!pasteError}
              spellCheck={false}
              rows={9}
              className="block"
            />
            {pasteError && (
              <p id={pasteErrorId} className="mt-1.5 px-0.5 text-[12px] leading-4 text-red-text">
                {pasteError}
              </p>
            )}
            <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="min-w-0 flex-1 basis-56 text-[13px] leading-5 text-label-2" aria-live="polite">
                {!summary && "尚未貼上歌詞"}
                {summary && summary.lines === 0 && <span className="text-orange-text">沒有可用的歌詞行（標題、作詞作曲資訊會自動略過）</span>}
                {summary && summary.lines > 0 && (
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    {summary.synced ? <Tag>LRC 同步歌詞</Tag> : summary.timed > 0 ? <Tag tone="orange">部分有時間碼</Tag> : <Tag>純文字</Tag>}
                    <span>
                      {summary.lines} 行{summary.translations > 0 && `（含 ${summary.translations} 行翻譯）`}
                      {!summary.synced && "，會依音訊粗略分配時間，之後可對拍校正"}
                    </span>
                  </span>
                )}
              </p>
              <Button size="sm" variant="plain" icon={FileTextIcon} onClick={() => fileRef.current?.click()}>
                從檔案載入（.lrc、.txt）
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".lrc,.txt,text/plain"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try {
                    onPasteTextChange(await f.text());
                  } catch {
                    onPasteTextChange("");
                  }
                }}
              />
            </div>
          </div>
        )}

        {mode === "later" && (
          <p className="rounded-lg bg-fill-4 px-4 py-3.5 text-[15px] leading-[22px] text-label-2">
            先完成樂團研究與主視覺設計。之後到歌詞編輯器貼上、搜尋或對拍歌詞，再用新歌詞重新設計段落呈現。
          </p>
        )}
      </div>

      <p className="mt-5 px-0.5 text-[12px] leading-[18px] text-label-2">
        提醒：在演出螢幕上顯示歌詞，除了公開演出授權，通常還需要詞作者或版權方同意；翻譯也應經作詞人確認。
      </p>
    </fieldset>
  );
}
