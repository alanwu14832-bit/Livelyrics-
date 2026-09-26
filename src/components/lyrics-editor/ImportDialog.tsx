"use client";

import { useMemo, useRef, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import type { Lyrics } from "@/lib/types";
import { Dialog } from "@/components/home/Dialog";
import { FileIcon } from "@/components/home/icons";
import { withoutTimings } from "@/components/upload/lyrics-choice";
import { LyricsSearchPicker, type LyricsPick } from "@/components/upload/LyricsSearchPicker";

type Tab = "paste" | "lrclib";

/** Replace the lyrics from pasted text / a file (LRC or plain) or an LRCLIB result. */
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
  const tabCls = (t: Tab) =>
    cx("h-8 rounded-md px-3 text-sm transition-colors", tab === t ? "bg-panel-3 text-fg ring-1 ring-line" : "text-muted hover:text-fg");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="w-[min(94vw,44rem)]"
      title="匯入歌詞"
      description={hasLines ? "匯入會取代目前所有的歌詞行（可以用 Ctrl+Z 復原）。" : "貼上 LRC／純文字，或到 LRCLIB 搜尋。"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={confirm} disabled={!canImport}>
            {hasLines ? "取代並匯入" : "匯入"}
          </Button>
        </>
      }
    >
      <div role="tablist" aria-label="匯入方式" className="mb-4 inline-flex gap-1 rounded-lg border border-line bg-panel-2 p-1">
        <button type="button" role="tab" aria-selected={tab === "paste"} className={tabCls("paste")} onClick={() => setTab("paste")}>
          貼上或開啟檔案
        </button>
        <button type="button" role="tab" aria-selected={tab === "lrclib"} className={tabCls("lrclib")} onClick={() => setTab("lrclib")}>
          LRCLIB 搜尋
        </button>
      </div>

      {tab === "paste" && (
        <div role="tabpanel" className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            aria-label="歌詞文字"
            placeholder={"[00:12.30]第一句歌詞\n[00:16.05]第二句歌詞\n\n或一行一句的純文字歌詞"}
            className="block w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2.5 font-mono text-[13px] leading-6 text-fg outline-none placeholder:text-faint focus:border-accent"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted" aria-live="polite">
              {!parsed && "支援 LRC（含逐字時間碼、雙語同時間碼）與純文字；作詞作曲等資訊行會自動略過。"}
              {parsed && parsed.lines.length === 0 && <span className="text-warn">沒有可用的歌詞行。</span>}
              {parsed && parsed.lines.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  {parsed.synced ? <Badge tone="ok">同步歌詞</Badge> : timed > 0 ? <Badge tone="warn">部分有時間碼</Badge> : <Badge>純文字</Badge>}
                  {parsed.lines.length} 行{timed > 0 && !parsed.synced && `（${timed} 行有時間）`}
                </span>
              )}
              {fileError && <span className="ml-2 text-danger">{fileError}</span>}
            </span>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
              <FileIcon size={14} />
              開啟 .lrc / .txt
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
        <div role="tabpanel">
          <LyricsSearchPicker title={title} artist={artist} duration={duration} value={pick} onChange={setPick} editableQuery allowNone={false} />
        </div>
      )}
    </Dialog>
  );
}
