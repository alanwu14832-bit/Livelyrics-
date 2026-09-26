"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { parseFileName, type AudioFileMetadata } from "@/lib/audio/metadata";
import { formatTimeShort } from "@/lib/timeline";
import type { AudioAnalysis } from "@/lib/types";
import { AlertIcon, ArrowRightIcon, MusicIcon, SpinnerIcon, XIcon } from "@/components/home/icons";
import { formatBytes } from "./accept";
import { lrcHeaderTags } from "./lyrics-choice";
import { LyricsOptions, summarizeLyricsText, type LyricsMode } from "./LyricsOptions";
import type { LyricsPick } from "./LyricsSearchPicker";
import { Waveform } from "./Waveform";

export interface NewProjectInput {
  title: string;
  artist: string;
  album: string;
  lyricsMode: LyricsMode;
  pick: LyricsPick | null;
  pasteText: string;
}

function bpmConfidence(c: number): string {
  if (c >= 0.6) return "穩定";
  if (c >= 0.3) return "尚可";
  return "不確定";
}

export function NewProjectCard({
  file,
  meta,
  analysis,
  duration,
  analysisWarning,
  submitting,
  submitError,
  onCancel,
  onSubmit,
}: {
  file: File;
  meta: AudioFileMetadata;
  analysis: AudioAnalysis | null;
  duration: number;
  analysisWarning?: string | null;
  submitting: boolean;
  submitError?: string | null;
  onCancel: () => void;
  onSubmit: (input: NewProjectInput) => void;
}) {
  const [title, setTitle] = useState(meta.title);
  const [artist, setArtist] = useState(meta.artist);
  const [album, setAlbum] = useState(meta.album ?? "");
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>("auto");
  const [pick, setPick] = useState<LyricsPick | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [filledFromLrc, setFilledFromLrc] = useState<string[]>([]);
  const ids = { title: useId(), artist: useId(), album: useId() };

  // pasted LRC headers ([ti:] [ar:] [al:]) fill song info the user has not typed themselves,
  // when the field is empty or still just the file name (research and LRCLIB need real names)
  const fromFileName = useMemo(() => parseFileName(file.name), [file.name]);
  const edited = useRef({ title: false, artist: false, album: false });
  const changePasteText = (text: string) => {
    setPasteText(text);
    const tags = lrcHeaderTags(text);
    const filled: string[] = [];
    const replaceable = (field: "title" | "artist" | "album", value: string, fileValue: string | undefined) =>
      !edited.current[field] && (!value.trim() || value === (fileValue ?? ""));
    if (tags.title && tags.title !== title && replaceable("title", title, fromFileName.title)) {
      setTitle(tags.title);
      filled.push("歌名");
    }
    if (tags.artist && tags.artist !== artist && replaceable("artist", artist, fromFileName.artist)) {
      setArtist(tags.artist);
      filled.push("樂團");
    }
    if (tags.album && tags.album !== album && replaceable("album", album, fromFileName.album)) {
      setAlbum(tags.album);
      filled.push("專輯");
    }
    if (filled.length) setFilledFromLrc(filled);
  };

  const submit = () => {
    if (!title.trim()) {
      setValidation("請填寫歌名（研究與歌詞搜尋都需要它）。");
      return;
    }
    if (lyricsMode === "paste") {
      const s = summarizeLyricsText(pasteText);
      if (!s || s.lines === 0) {
        setValidation("請貼上歌詞，或改選「之後再處理」。");
        return;
      }
    }
    setValidation(null);
    onSubmit({ title: title.trim(), artist: artist.trim(), album: album.trim(), lyricsMode, pick, pasteText });
  };

  const bounds = analysis?.sections.map((s) => s.start) ?? [];
  const inputCls =
    "h-10 w-full rounded-md border border-line bg-panel-2 px-3 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-60";

  return (
    <section aria-label="新作品" className="overflow-hidden rounded-2xl border border-line bg-panel shadow-xl shadow-black/30">
      <header className="flex items-center gap-3 border-b border-line bg-panel-2/50 px-5 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <MusicIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fg">新作品</h2>
          <p className="truncate text-xs text-muted" title={file.name}>
            {file.name} · {formatBytes(file.size)}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
          <XIcon size={14} />
          換一首
        </Button>
      </header>

      {/* noValidate: the card shows its own inline error instead of the browser bubble
          (the title input keeps `required` for semantics and the e2e hook) */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <fieldset disabled={submitting} className="min-w-0 space-y-4">
            <legend className="mb-2 text-sm font-semibold text-fg">歌曲資訊</legend>
            <div className="space-y-1.5">
              <label htmlFor={ids.title} className="text-xs text-muted">
                歌名 <span className="text-accent">*</span>
              </label>
              <input
                id={ids.title}
                value={title}
                onChange={(e) => {
                  edited.current.title = true;
                  setTitle(e.target.value);
                }}
                className={inputCls}
                placeholder="歌曲名稱"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor={ids.artist} className="text-xs text-muted">
                  樂團／演出者
                </label>
                <input
                  id={ids.artist}
                  value={artist}
                  onChange={(e) => {
                    edited.current.artist = true;
                    setArtist(e.target.value);
                  }}
                  className={inputCls}
                  placeholder="例如：落日飛車"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={ids.album} className="text-xs text-muted">
                  專輯
                </label>
                <input
                  id={ids.album}
                  value={album}
                  onChange={(e) => {
                    edited.current.album = true;
                    setAlbum(e.target.value);
                  }}
                  className={inputCls}
                  placeholder="選填"
                />
              </div>
            </div>
            {filledFromLrc.length > 0 && (
              <p role="status" className="-mt-1 text-xs text-faint">
                已從歌詞的 LRC 標籤帶入{filledFromLrc.join("、")}，可以再修改。
              </p>
            )}

            <div className="rounded-xl border border-line bg-bg/40 p-3">
              <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <dt className="text-[11px] text-faint">長度</dt>
                  <dd className="font-mono text-lg font-semibold text-fg tabular">{duration > 0 ? formatTimeShort(duration) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-faint">速度</dt>
                  <dd className="font-mono text-lg font-semibold text-fg tabular">
                    {analysis && analysis.bpm > 0 ? (
                      <>
                        {Math.round(analysis.bpm)}
                        <span className="ml-1 text-xs font-normal text-muted">BPM</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-faint">段落</dt>
                  <dd className="font-mono text-lg font-semibold text-fg tabular">{analysis ? analysis.sections.length : "—"}</dd>
                </div>
              </dl>
              {analysis ? (
                <>
                  <Waveform peaks={analysis.peaks} duration={analysis.duration} boundaries={bounds} className="h-16" label="音訊波形與偵測到的段落邊界" />
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                    {analysis.bpm > 0 && <Badge tone={analysis.bpmConfidence >= 0.3 ? "neutral" : "warn"}>節奏{bpmConfidence(analysis.bpmConfidence)}</Badge>}
                    <span>藍線是偵測到的段落邊界，設計師會據此安排每段畫面。</span>
                  </p>
                </>
              ) : (
                <p className="flex items-start gap-2 text-xs text-warn">
                  <AlertIcon size={14} className="mt-px shrink-0" />
                  {analysisWarning || "沒有音訊分析：畫面不會跟著能量與拍點變化，段落也只能粗略估計。"}
                </p>
              )}
            </div>
          </fieldset>

          <LyricsOptions
            mode={lyricsMode}
            onModeChange={setLyricsMode}
            title={title}
            artist={artist}
            duration={duration}
            pick={pick}
            onPickChange={setPick}
            pasteText={pasteText}
            onPasteTextChange={changePasteText}
            disabled={submitting}
          />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel-2/40 px-5 py-4">
          <p className={cx("text-xs", validation || submitError ? "text-danger" : "text-muted")} role={validation || submitError ? "alert" : undefined}>
            {validation || submitError || "接下來：取得歌詞 → 研究樂團與歌曲 → 設計主視覺與段落，約需 1–3 分鐘。"}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={submitting}>
              {submitting ? (
                <>
                  <SpinnerIcon size={16} />
                  上傳中…
                </>
              ) : (
                <>
                  開始製作
                  <ArrowRightIcon size={16} />
                </>
              )}
            </Button>
          </div>
        </footer>
      </form>
    </section>
  );
}
