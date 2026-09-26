"use client";

import { useId, useMemo, useRef } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import { FileIcon } from "@/components/home/icons";
import { LyricsSearchPicker, type LyricsPick } from "./LyricsSearchPicker";

export type LyricsMode = "auto" | "paste" | "later";

const MODES: Array<{ id: LyricsMode; label: string; hint: string }> = [
  { id: "auto", label: "自動搜尋", hint: "到 LRCLIB 找同步歌詞" },
  { id: "paste", label: "貼上歌詞", hint: "LRC 或純文字" },
  { id: "later", label: "之後再處理", hint: "先做視覺設計" },
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
  disabled?: boolean;
}) {
  const group = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const summary = useMemo(() => summarizeLyricsText(pasteText), [pasteText]);

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-semibold text-fg">歌詞</legend>
      <div role="radiogroup" aria-label="歌詞來源" className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-panel-2 p-1">
        {MODES.map((m) => (
          <label
            key={m.id}
            className={cx(
              "flex cursor-pointer flex-col items-center rounded-md px-2 py-1.5 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
              mode === m.id ? "bg-panel-3 text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
            )}
          >
            <input type="radio" name={group} value={m.id} checked={mode === m.id} onChange={() => onModeChange(m.id)} className="sr-only" />
            <span className="text-sm font-medium">{m.label}</span>
            <span className="text-[11px] text-faint">{m.hint}</span>
          </label>
        ))}
      </div>

      {mode === "auto" && (
        <LyricsSearchPicker title={title} artist={artist} duration={duration} value={pick} onChange={onPickChange} />
      )}

      {mode === "paste" && (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={(e) => onPasteTextChange(e.target.value)}
            placeholder={PASTE_PLACEHOLDER}
            aria-label="貼上歌詞"
            spellCheck={false}
            rows={9}
            className="block w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm leading-6 text-fg outline-none placeholder:text-faint focus:border-accent"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted" aria-live="polite">
              {!summary && "尚未貼上歌詞"}
              {summary && summary.lines === 0 && <span className="text-warn">沒有可用的歌詞行（標題、作詞作曲資訊會自動略過）</span>}
              {summary && summary.lines > 0 && (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {summary.synced ? <Badge tone="ok">LRC 同步歌詞</Badge> : summary.timed > 0 ? <Badge tone="warn">部分有時間碼</Badge> : <Badge>純文字</Badge>}
                  {summary.lines} 行
                  {summary.translations > 0 && `（含 ${summary.translations} 行翻譯）`}
                  {!summary.synced && " · 會依音訊粗略分配時間，之後可對拍校正"}
                </span>
              )}
            </span>
            <Button size="sm" variant="ghost" type="button" onClick={() => fileRef.current?.click()}>
              <FileIcon size={14} />
              從檔案載入（.lrc / .txt）
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
        <p className="rounded-lg border border-line bg-panel-2/60 px-3 py-3 text-sm leading-6 text-muted">
          先完成樂團研究與主視覺設計。之後到「歌詞編輯器」貼上、搜尋或對拍歌詞，再用新歌詞重新設計段落呈現。
        </p>
      )}

      <p className="text-[11px] leading-5 text-faint">
        提醒：在演出螢幕上顯示歌詞，除了公開演出授權，通常還需要詞作者或版權方同意；翻譯也應經作詞人確認。
      </p>
    </fieldset>
  );
}
