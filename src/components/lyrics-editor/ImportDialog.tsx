"use client";

import { useMemo, useRef, useState } from "react";
import { Button, SegmentedControl, Sheet, Tag, TextArea } from "@/components/ui";
import { FileTextIcon } from "@/components/ui/Icon";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import type { Lyrics } from "@/lib/types";
import { withoutTimings } from "@/components/upload/lyrics-choice";
import { LyricsSearchPicker, type LyricsPick } from "@/components/upload/LyricsSearchPicker";

type Tab = "paste" | "lrclib";

/** Replace the lyrics from pasted text / a file (LRC or plain) or an LRCLIB result. An iOS sheet. */
export function ImportDialog({
  open,
  onClose,
  onImport,
  title,
  artist,
  duration,
  hasLines,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (lyrics: Lyrics) => void;
  title: string;
  artist: string;
  duration: number;
  hasLines: boolean;
}) {
  const [tab, setTab] = useState<Tab>("paste");
  const [text, setText] = useState("");
  const [pick, setPick] = useState<LyricsPick | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseLyricsText(text, "user") : null), [text]);
  const timed = parsed ? parsed.lines.filter((l) => l.start != null).length : 0;

  const confirm = () => {
    if (tab === "paste") {
      if (!parsed || parsed.lines.length === 0) return;
      onImport(parsed);
    } else {
      if (!pick) return;
      const r = pick.result;
      onImport(r.synced && pick.useTiming ? { ...r.lyrics, source: "lrclib-synced" } : { ...withoutTimings(r.lyrics), source: "lrclib-plain" });
    }
    onClose();
  };

  const canImport = tab === "paste" ? !!parsed && parsed.lines.length > 0 : !!pick;
  const replaceNote = hasLines ? "匯入會取代目前所有的歌詞行，可以用 Ctrl+Z 復原。" : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="匯入歌詞"
      width={600}
      initialFocus={tab === "paste" ? textRef : undefined}
      action={
        <Button variant="filled" onClick={confirm} disabled={!canImport}>
          {hasLines ? "取代並匯入" : "匯入"}
        </Button>
      }
    >
      <SegmentedControl
        label="匯入方式"
        kind="tabs"
        fullWidth
        value={tab}
        onChange={setTab}
        getTabId={(v) => `import-tab-${v}`}
        getPanelId={(v) => `import-panel-${v}`}
        options={[
          { value: "paste", label: "貼上或開啟檔案", caption: replaceNote ?? "LRC（含逐字時間碼、雙語同時間碼）或一行一句的純文字。" },
          { value: "lrclib", label: "LRCLIB 搜尋", caption: replaceNote ?? "用歌名與樂團到 LRCLIB 找現成的歌詞。" },
        ]}
      />

      {tab === "paste" && (
        <div role="tabpanel" id="import-panel-paste" aria-labelledby="import-tab-paste" className="mt-4 space-y-2.5">
          <TextArea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            aria-label="歌詞文字"
            placeholder={"[00:12.30]第一句歌詞\n[00:16.05]第二句歌詞\n\n或一行一句的純文字歌詞"}
            className="block font-mono text-[13px]! leading-6!"
          />
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-[13px] leading-5 text-label-2" aria-live="polite">
              {!parsed && "作詞、作曲等資訊行會自動略過。"}
              {parsed && parsed.lines.length === 0 && <span className="text-orange-text">沒有可用的歌詞行。</span>}
              {parsed && parsed.lines.length > 0 && (
                <>
                  {parsed.synced ? <Tag tone="tint">同步歌詞</Tag> : timed > 0 ? <Tag tone="orange">部分有時間碼</Tag> : <Tag>純文字</Tag>}
                  <span className="text-label">
                    <span className="t-latin tabular">{parsed.lines.length}</span> 行{timed > 0 && !parsed.synced && `（${timed} 行有時間）`}
                  </span>
                </>
              )}
              {fileError && <span className="text-red-text">{fileError}</span>}
            </span>
            <Button variant="plain" icon={FileTextIcon} onClick={() => fileRef.current?.click()}>
              開啟 .lrc 或 .txt
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
                if (f.size > 2 * 1024 * 1024) {
                  setFileError("檔案太大（上限 2 MB）");
                  return;
                }
                try {
                  setText(await f.text());
                  setFileError(null);
                } catch {
                  setFileError("無法讀取檔案");
                }
              }}
            />
          </div>
        </div>
      )}

      {tab === "lrclib" && (
        <div role="tabpanel" id="import-panel-lrclib" aria-labelledby="import-tab-lrclib" className="mt-4">
          <LyricsSearchPicker title={title} artist={artist} duration={duration} value={pick} onChange={setPick} editableQuery allowNone={false} />
        </div>
      )}
    </Sheet>
  );
}
