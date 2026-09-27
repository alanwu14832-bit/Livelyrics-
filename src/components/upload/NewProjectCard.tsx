"use client";

// The new-project card (UI-AUDIT §3.5 首頁, UI-01, UI-28): the dropzone tile expands into it.
// iOS-style form: an inset group of 44 px song-info rows (13 px label-2 label, borderless input,
// the whole row rings in tint while focused, a red ring and a 12 px message on error), a stats row
// (20 / 600 tabular values over 12 px labels) that rolls up once, the waveform revealed left to
// right, and the lyrics column on the right. One filled capsule: 「開始製作」.
// Kept for the e2e: section[aria-label="新作品"], the title input[required] (the form is
// noValidate so the card shows its own inline error), the 「開始製作」 button name.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api-client";
import { Button, FormRow, InsetGroup, cx, rowInputClass } from "@/components/ui";
import { MusicNotesIcon, WarningIcon } from "@/components/ui/Icon";
import { parseFileName, type AudioFileMetadata } from "@/lib/audio/metadata";
import { prefersReducedMotion } from "@/lib/motion";
import { formatTimeShort } from "@/lib/timeline";
import type { AudioAnalysis, BandSummary } from "@/lib/types";

/** the pop-up chevron of a borderless row select (label-2 on both appearances) */
const SELECT_CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%238e8e93' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 6l3-3 3 3M5 10l3 3 3-3'/%3E%3C/svg%3E")`;
import { formatBytes } from "./accept";
import { phaseEnterClass } from "./Dropzone";
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
  /** the band the song belongs to (null = none) */
  bandId: string | null;
}

function bpmConfidence(c: number): { label: string; weak: boolean } {
  if (c >= 0.6) return { label: "穩定", weak: false };
  if (c >= 0.3) return { label: "尚可", weak: false };
  return { label: "不確定", weak: true };
}

/**
 * A number that rolls up from 0 once (about 600 ms, strong ease-out), written straight to the DOM.
 * Screen readers (and innerText) get the final value from the sr-only copy.
 */
function RollingNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const formatRef = useRef(format);
  useLayoutEffect(() => {
    formatRef.current = format;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    const fmt = formatRef.current;
    if (!el || !(value > 0) || prefersReducedMotion()) return;
    const DURATION = 600;
    const start = performance.now();
    let raf = 0;
    el.textContent = fmt(0);
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / DURATION);
      const eased = 1 - Math.pow(1 - k, 5); // close to --ease-out
      el.textContent = fmt(value * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.textContent = fmt(value);
    };
  }, [value]);
  return (
    <>
      <span className="sr-only">{format(value)}</span>
      <span ref={ref} aria-hidden="true">
        {format(value)}
      </span>
    </>
  );
}

function Stat({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="truncate text-[12px] leading-4 text-label-2">{label}</dt>
      <dd className="truncate text-[20px] leading-7 font-semibold text-label tabular">{children}</dd>
    </div>
  );
}

export function NewProjectCard({
  file,
  meta,
  analysis,
  duration,
  analysisWarning,
  submitting,
  submitError,
  defaultBandId,
  onCancel,
  onSubmit,
}: {
  defaultBandId?: string;
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
  const [titleError, setTitleError] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [filledFromLrc, setFilledFromLrc] = useState<string[]>([]);
  const ids = { title: useId(), artist: useId(), album: useId(), band: useId() };

  const titleRef = useRef<HTMLInputElement>(null);

  // pasted LRC headers ([ti:] [ar:] [al:]) fill song info the user has not typed themselves,
  // when the field is empty or still just the file name (research and LRCLIB need real names)
  const fromFileName = useMemo(() => parseFileName(file.name), [file.name]);
  const edited = useRef({ title: false, artist: false, album: false });
  const [bands, setBands] = useState<BandSummary[]>([]);
  const [bandId, setBandId] = useState<string>(defaultBandId ?? "");
  useEffect(() => {
    let alive = true;
    api
      .listBands()
      .then((list) => {
        if (!alive) return;
        setBands(list);
        // a preselected band that does not exist is dropped; its name fills an empty artist
        const chosen = list.find((b) => b.id === defaultBandId);
        if (!chosen) setBandId("");
        else if (!edited.current.artist) setArtist((a) => a.trim() || chosen.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [defaultBandId]);
  const changePasteText = (text: string) => {
    setPasteText(text);
    if (pasteError && text.trim()) setPasteError(null);
    const tags = lrcHeaderTags(text);
    const filled: string[] = [];
    const replaceable = (field: "title" | "artist" | "album", value: string, fileValue: string | undefined) =>
      !edited.current[field] && (!value.trim() || value === (fileValue ?? ""));
    if (tags.title && tags.title !== title && replaceable("title", title, fromFileName.title)) {
      setTitle(tags.title);
      setTitleError(null);
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
      setTitleError("請填寫歌名（研究與歌詞搜尋都需要它）。");
      titleRef.current?.focus();
      return;
    }
    if (lyricsMode === "paste") {
      const s = summarizeLyricsText(pasteText);
      if (!s || s.lines === 0) {
        setPasteError("請貼上歌詞，或改選「之後再處理」。");
        return;
      }
    }
    setTitleError(null);
    setPasteError(null);
    onSubmit({ title: title.trim(), artist: artist.trim(), album: album.trim(), lyricsMode, pick, pasteText, bandId: bandId || null });
  };

  const bounds = analysis?.sections.map((s) => s.start) ?? [];
  const confidence = analysis && analysis.bpm > 0 ? bpmConfidence(analysis.bpmConfidence) : null;

  return (
    <section aria-label="新作品" data-motion="move" className={cx("min-w-0 overflow-hidden rounded-2xl bg-surface", phaseEnterClass)}>
      <header className="flex min-w-0 items-center gap-3 px-6 pt-5">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-tint-soft text-tint">
          <MusicNotesIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] leading-[22px] font-semibold text-label">新作品</h2>
          <p className="truncate text-[13px] leading-[18px] text-label-2" title={file.name}>
            {file.name}，{formatBytes(file.size)}
          </p>
        </div>
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
        <div className="grid min-w-0 gap-x-8 gap-y-7 px-6 pt-6 pb-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <fieldset disabled={submitting} aria-label="歌曲資訊" className="min-w-0">
            <InsetGroup
              header="歌曲資訊"
              bodyClassName="bg-fill-4!"
              footer={
                filledFromLrc.length > 0 ? (
                  <span role="status">已從歌詞的 LRC 標籤帶入{filledFromLrc.join("、")}，可以再修改。</span>
                ) : undefined
              }
            >
              {/* the kit's focus ring would hide the red error ring while the field is focused */}
              <FormRow label="歌名" htmlFor={ids.title} error={titleError}>
                <input
                  ref={titleRef}
                  id={ids.title}
                  value={title}
                  onChange={(e) => {
                    edited.current.title = true;
                    setTitle(e.target.value);
                    if (e.target.value.trim()) setTitleError(null);
                  }}
                  className={rowInputClass}
                  placeholder="歌曲名稱"
                  required
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby={titleError ? `${ids.title}-error` : undefined}
                  autoComplete="off"
                />
              </FormRow>
              <FormRow label="樂團／演出者" htmlFor={ids.artist}>
                <input
                  id={ids.artist}
                  value={artist}
                  onChange={(e) => {
                    edited.current.artist = true;
                    setArtist(e.target.value);
                  }}
                  className={rowInputClass}
                  placeholder="例如：落日飛車"
                  autoComplete="off"
                />
              </FormRow>
              <FormRow label="專輯" htmlFor={ids.album}>
                <input
                  id={ids.album}
                  value={album}
                  onChange={(e) => {
                    edited.current.album = true;
                    setAlbum(e.target.value);
                  }}
                  className={rowInputClass}
                  placeholder="選填"
                  autoComplete="off"
                />
              </FormRow>
              {bands.length > 0 && (
                <FormRow label="樂團" htmlFor={ids.band}>
                  <select
                    id={ids.band}
                    value={bandId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setBandId(next);
                      const b = bands.find((x) => x.id === next);
                      if (b && !artist.trim()) setArtist(b.name);
                    }}
                    className={cx(rowInputClass, "cursor-default appearance-none bg-[length:12px] bg-[right_2px_center] bg-no-repeat pr-5")}
                    style={{ backgroundImage: SELECT_CHEVRON }}
                  >
                    <option value="">不指定</option>
                    {bands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </FormRow>
              )}
            </InsetGroup>

            <div className="mt-7 px-(--row-pad-x)">
              <dl className="grid grid-cols-3 gap-4">
                <Stat label="長度">{duration > 0 ? <RollingNumber value={duration} format={(n) => formatTimeShort(n)} /> : "未知"}</Stat>
                <Stat
                  label={
                    confidence ? (
                      <>
                        速度<span className={confidence.weak ? "text-orange-text" : undefined}>（{confidence.label}）</span>
                      </>
                    ) : (
                      "速度"
                    )
                  }
                >
                  {analysis && analysis.bpm > 0 ? (
                    <>
                      <RollingNumber value={Math.round(analysis.bpm)} format={(n) => String(Math.round(n))} />
                      <span className="ml-1 text-[13px] font-normal text-label-2">BPM</span>
                    </>
                  ) : (
                    "未知"
                  )}
                </Stat>
                <Stat label="段落">{analysis ? <RollingNumber value={analysis.sections.length} format={(n) => String(Math.round(n))} /> : "未知"}</Stat>
              </dl>
              {analysis ? (
                <>
                  <div className="mt-4 [clip-path:inset(0_0_0_0)] transition-[clip-path] duration-[600ms] ease-out starting:[clip-path:inset(0_100%_0_0)] motion-reduce:transition-none">
                    <Waveform peaks={analysis.peaks} duration={analysis.duration} boundaries={bounds} className="h-16" label="音訊波形與偵測到的段落邊界" />
                  </div>
                  <p className="mt-2 text-[12px] leading-4 text-label-2">藍線是偵測到的段落邊界，設計師會據此安排每段畫面。</p>
                </>
              ) : (
                <p className="mt-4 flex items-start gap-2 text-[13px] leading-5 text-orange-text">
                  <WarningIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-orange" />
                  <span className="min-w-0">{analysisWarning || "沒有音訊分析：畫面不會跟著能量與拍點變化，段落也只能粗略估計。"}</span>
                </p>
              )}
            </div>
          </fieldset>

          <LyricsOptions
            mode={lyricsMode}
            onModeChange={(m) => {
              setLyricsMode(m);
              setPasteError(null);
            }}
            title={title}
            artist={artist}
            duration={duration}
            pick={pick}
            onPickChange={setPick}
            pasteText={pasteText}
            onPasteTextChange={changePasteText}
            pasteError={pasteError}
            disabled={submitting}
          />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4 border-t-hairline">
          <p className={cx("min-w-0 flex-1 basis-72 text-[13px] leading-5", submitError ? "text-red-text" : "text-label-2")} role={submitError ? "alert" : undefined}>
            {submitError || "接下來會取得歌詞、研究樂團與歌曲、設計主視覺與段落，約需 1 到 3 分鐘。"}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="plain" onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" variant="filled" size="lg" loading={submitting}>
              {submitting ? "上傳中…" : "開始製作"}
            </Button>
          </div>
        </footer>
      </form>
    </section>
  );
}
