"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, Spinner, Switch, Tag, TextField, cx } from "@/components/ui";
import { ArrowClockwiseIcon, CaretRightIcon, CheckIcon, MagnifyingGlassIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { api, type LyricsSearchResult } from "@/lib/api-client";
import { formatTimeShort } from "@/lib/timeline";
import { durationDelta, timingTrusted } from "./lyrics-choice";

export interface LyricsPick {
  result: LyricsSearchResult;
  /** use LRCLIB's timings (false = text only, times get distributed / tap-synced) */
  useTiming: boolean;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; results: LyricsSearchResult[] }
  | { kind: "error"; message: string };

const MAX_RESULTS = 6;
const PREVIEW_LINES = 10;

/**
 * Searches LRCLIB for the song and lets the user pick one result (or none).
 * `value === null` means "none of these".
 *
 * Results are an inset grouped list (UI-AUDIT UI-28): title 15 / 500 with a 「同步歌詞」 tag, the
 * artist, album and length on a 13 px label-2 line, an orange third line when the recording length
 * differs by more than 3 s, and a tint Check on the chosen row. Each row is a visually hidden
 * native radio whose <label> covers the row (so 「預覽」 can sit beside it without nesting
 * controls). The chosen synced result gets a Switch row 「使用 LRCLIB 的時間碼」 right under it.
 */
export function LyricsSearchPicker({
  title,
  artist,
  duration,
  value,
  onChange,
  noneLabel = "都不是，之後再處理歌詞",
  allowNone = true,
  autoSelect = true,
  editableQuery = false,
  debounceMs = 500,
  className,
}: {
  title: string;
  artist: string;
  duration?: number;
  value: LyricsPick | null;
  onChange: (pick: LyricsPick | null) => void;
  noneLabel?: string;
  /** offer the "none of these" option */
  allowNone?: boolean;
  /** pick the best-ranked result when a search completes and nothing was chosen yet */
  autoSelect?: boolean;
  /** show title/artist inputs to refine the search */
  editableQuery?: boolean;
  debounceMs?: number;
  className?: string;
}) {
  const [queryTitle, setQueryTitle] = useState(title);
  const [queryArtist, setQueryArtist] = useState(artist);
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const group = useId();
  const seq = useRef(0);
  const touched = useRef(false);
  const lastQuery = useRef("");
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  });

  const t = (editableQuery ? queryTitle : title).trim();
  const a = (editableQuery ? queryArtist : artist).trim();

  useEffect(() => {
    if (!t) return;
    const my = ++seq.current;
    const key = `${t}\u0000${a}`;
    const timer = setTimeout(
      () => {
        // a new query lets auto-select pick again; a manual re-search keeps the user's choice
        if (key !== lastQuery.current) touched.current = false;
        lastQuery.current = key;
        setState({ kind: "loading" });
        api
          .searchLyrics({ title: t, artist: a, duration })
          .then(({ results }) => {
            if (my !== seq.current) return;
            const list = results.slice(0, MAX_RESULTS);
            setState({ kind: "done", results: list });
            const current = valueRef.current;
            if (!autoSelect || touched.current) return;
            if (list.length === 0) {
              if (current) onChangeRef.current(null);
            } else if (!current || !list.some((r) => r.id === current.result.id)) {
              onChangeRef.current({ result: list[0], useTiming: timingTrusted(list[0], duration) });
            }
          })
          .catch((err: unknown) => {
            if (my !== seq.current) return;
            setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
          });
      },
      nonce === 0 ? debounceMs : 0,
    );
    return () => clearTimeout(timer);
  }, [t, a, duration, nonce, autoSelect, debounceMs]);

  const choose = (pick: LyricsPick | null) => {
    touched.current = true;
    onChange(pick);
  };

  const results = state.kind === "done" ? state.results : [];
  const busy = t && state.kind === "loading";

  return (
    <div className={cx("min-w-0 space-y-3", className)}>
      {editableQuery && (
        <form
          className="flex min-w-0 flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNonce((n) => n + 1);
          }}
        >
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-[12px] leading-4 text-label-2">
            歌名
            <TextField value={queryTitle} onChange={(e) => setQueryTitle(e.target.value)} />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-[12px] leading-4 text-label-2">
            演出者
            <TextField value={queryArtist} onChange={(e) => setQueryArtist(e.target.value)} />
          </label>
          <Button type="submit" icon={MagnifyingGlassIcon} disabled={!queryTitle.trim()}>
            搜尋
          </Button>
        </form>
      )}

      <div className="flex min-h-7 min-w-0 items-center justify-between gap-2 px-0.5 text-[13px] leading-5 text-label-2">
        <span aria-live="polite" className="min-w-0">
          {!t && "輸入歌名後會自動到 LRCLIB 搜尋歌詞。"}
          {busy && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Spinner size={14} />
              <span className="min-w-0 truncate">
                正在 LRCLIB 搜尋「{t}」{a && `（${a}）`}…
              </span>
            </span>
          )}
          {t && state.kind === "done" && (results.length ? `找到 ${results.length} 筆結果，依同步歌詞與長度排序。` : `LRCLIB 找不到「${t}」的歌詞。`)}
          {t && state.kind === "idle" && "準備搜尋…"}
        </span>
        {t && (state.kind === "done" || state.kind === "error") && (
          <Button size="sm" variant="plain" icon={ArrowClockwiseIcon} onClick={() => setNonce((n) => n + 1)}>
            重新搜尋
          </Button>
        )}
      </div>

      {state.kind === "error" && (
        <p role="alert" className="flex items-start gap-2 px-0.5 text-[13px] leading-5 text-red-text">
          <WarningCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-red" />
          <span className="min-w-0">搜尋失敗：{state.message}。可以重試，或改用「貼上歌詞」。</span>
        </p>
      )}

      {results.length > 0 && (
        <div role="radiogroup" aria-label="LRCLIB 搜尋結果" className="min-w-0 overflow-hidden rounded-lg bg-fill-4">
          {results.map((r) => {
            const selected = value?.result.id === r.id;
            const delta = durationDelta(r, duration);
            const far = delta != null && Math.abs(delta) > 3;
            const open = expanded === r.id;
            const detail = [r.artistName || "未知演出者", r.albumName, r.duration > 0 ? formatTimeShort(r.duration) : null].filter(Boolean).join("，");
            const lengthNote = delta == null ? null : far ? "版本長度不同，時間可能對不上，建議之後再對拍。" : Math.abs(delta) < 0.5 ? "長度相符" : `長度${delta > 0 ? "多" : "少"} ${Math.abs(delta).toFixed(1)} 秒`;
            return (
              <div key={r.id} className={ROW}>
                <div className="relative flex min-w-0 items-start gap-3 px-4 py-2.5">
                  <label className={HIT}>
                    <input type="radio" name={group} checked={selected} onChange={() => choose({ result: r, useTiming: timingTrusted(r, duration) })} className="sr-only" />
                    <span className="sr-only">
                      {r.trackName || "（無標題）"}，{r.synced ? "同步歌詞" : "純文字"}，{detail}，{r.lyrics.lines.length} 行{lengthNote ? `，${lengthNote}` : ""}
                    </span>
                  </label>
                  <span aria-hidden="true" className="pointer-events-none relative min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-[15px] leading-[22px] font-medium text-label">{r.trackName || "（無標題）"}</span>
                      {r.synced ? <Tag>同步歌詞</Tag> : <Tag>純文字</Tag>}
                    </span>
                    <span className="block truncate text-[13px] leading-[18px] text-label-2">
                      {detail}，{r.lyrics.lines.length} 行
                    </span>
                    {far ? (
                      <span className="block text-[13px] leading-[18px] text-orange-text">{lengthNote}</span>
                    ) : (
                      lengthNote && <span className="block text-[13px] leading-[18px] text-label-2">{lengthNote}</span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="plain"
                    className="relative -my-0.5"
                    aria-expanded={open}
                    aria-label={`預覽「${r.trackName || "（無標題）"}」的歌詞`}
                    onClick={() => setExpanded(open ? null : r.id)}
                    trailingIcon={<CaretRightIcon size={12} className={cx("transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-90")} />}
                  >
                    預覽
                  </Button>
                  <span aria-hidden="true" className="pointer-events-none relative flex h-[22px] w-4 shrink-0 items-center">
                    {selected && <CheckIcon size={16} className="text-tint" />}
                  </span>
                </div>
                {open && (
                  <div className="mx-4 mb-3 max-h-48 min-w-0 overflow-y-auto rounded-sm bg-fill-4 px-3 py-2 text-[13px] leading-5 transition-[opacity,translate] duration-200 ease-out starting:-translate-y-1 starting:opacity-0">
                    {r.lyrics.lines.slice(0, PREVIEW_LINES).map((l) => (
                      <div key={l.id} className="flex min-w-0 gap-3">
                        {r.synced && <span className="w-10 shrink-0 text-label-2 tabular">{l.start != null ? formatTimeShort(l.start) : ""}</span>}
                        <span className="min-w-0 text-label">{l.text}</span>
                      </div>
                    ))}
                    {r.lyrics.lines.length > PREVIEW_LINES && <div className="text-label-2">還有 {r.lyrics.lines.length - PREVIEW_LINES} 行</div>}
                  </div>
                )}
                {selected && r.synced && (
                  <div className="ml-4 flex min-h-11 min-w-0 items-center gap-3 border-t-hairline py-1.5 pr-4">
                    <label htmlFor={`${group}-timing`} className="min-w-0 flex-1 text-[15px] leading-5 text-label">
                      使用 LRCLIB 的時間碼
                      {far && value.useTiming && <span className="block text-[12px] leading-4 text-orange-text">長度不同時，時間碼可能對不上。</span>}
                    </label>
                    <Switch id={`${group}-timing`} checked={value.useTiming} onChange={(on) => choose({ result: r, useTiming: on })} />
                  </div>
                )}
              </div>
            );
          })}
          {allowNone && (
            <div className={ROW}>
              <div className="relative flex min-h-11 min-w-0 items-center gap-3 px-4 py-2.5">
                <label className={HIT}>
                  <input type="radio" name={group} checked={value === null} onChange={() => choose(null)} className="sr-only" />
                  <span className="sr-only">{noneLabel}</span>
                </label>
                <span aria-hidden="true" className="pointer-events-none relative min-w-0 flex-1 truncate text-[15px] leading-[22px] text-label">
                  {noneLabel}
                </span>
                <span aria-hidden="true" className="pointer-events-none relative flex w-4 shrink-0 items-center">
                  {value === null && <CheckIcon size={16} className="text-tint" />}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** a row of the grouped list: the separator starts where the text starts (16 px), none after the last */
const ROW =
  "relative min-w-0 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-4 after:h-(--hairline) after:bg-separator last:after:hidden";
/** the radio's label covers the whole row: hover fill-4, pressed fill-3 at once, inset focus ring */
const HIT =
  "absolute inset-0 cursor-default hover:bg-fill-4 active:bg-fill-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-(--focus-ring)";
