"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { api, type LyricsSearchResult } from "@/lib/api-client";
import { formatTimeShort } from "@/lib/timeline";
import { AlertIcon, ChevronDownIcon, RefreshIcon, SearchIcon, SpinnerIcon } from "@/components/home/icons";
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
 */
export function LyricsSearchPicker({
  title,
  artist,
  duration,
  value,
  onChange,
  noneLabel = "都不是 — 之後再處理歌詞",
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

  return (
    <div className={cx("min-w-0 space-y-3", className)}>
      {editableQuery && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNonce((n) => n + 1);
          }}
        >
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
            歌名
            <input
              value={queryTitle}
              onChange={(e) => setQueryTitle(e.target.value)}
              className="h-9 rounded-md border border-line bg-panel-2 px-3 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
            演出者
            <input
              value={queryArtist}
              onChange={(e) => setQueryArtist(e.target.value)}
              className="h-9 rounded-md border border-line bg-panel-2 px-3 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <Button type="submit" disabled={!queryTitle.trim()}>
            <SearchIcon size={14} />
            搜尋
          </Button>
        </form>
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span aria-live="polite">
          {!t && "輸入歌名後會自動到 LRCLIB 搜尋歌詞。"}
          {t && state.kind === "loading" && (
            <span className="inline-flex items-center gap-1.5">
              <SpinnerIcon size={12} /> 正在 LRCLIB 搜尋「{t}」{a && ` — ${a}`}…
            </span>
          )}
          {t && state.kind === "done" && (results.length ? `找到 ${results.length} 筆結果（依同步歌詞與長度排序）` : `LRCLIB 找不到「${t}」的歌詞。`)}
          {t && state.kind === "idle" && "準備搜尋…"}
        </span>
        {t && (state.kind === "done" || state.kind === "error") && (
          <button type="button" onClick={() => setNonce((n) => n + 1)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-panel-3 hover:text-fg">
            <RefreshIcon size={12} /> 重新搜尋
          </button>
        )}
      </div>

      {state.kind === "error" && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/[0.07] px-3 py-2 text-xs text-danger">
          <AlertIcon size={14} className="mt-px shrink-0" />
          <span>
            搜尋失敗：{state.message}。可以重試，或改用「貼上歌詞」。
          </span>
        </div>
      )}

      {results.length > 0 && (
        <ul role="radiogroup" aria-label="LRCLIB 搜尋結果" className="space-y-1.5">
          {results.map((r) => {
            const selected = value?.result.id === r.id;
            const delta = durationDelta(r, duration);
            const far = delta != null && Math.abs(delta) > 3;
            const open = expanded === r.id;
            return (
              <li key={r.id} className={cx("rounded-lg border transition-colors", selected ? "border-accent/60 bg-accent/[0.06]" : "border-line bg-panel-2/50 hover:border-faint")}>
                <label className="flex min-w-0 cursor-pointer items-start gap-3 px-3 py-2.5">
                  <input
                    type="radio"
                    name={group}
                    checked={selected}
                    onChange={() => choose({ result: r, useTiming: timingTrusted(r, duration) })}
                    className="mt-1 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-sm font-medium text-fg">{r.trackName || "（無標題）"}</span>
                      {r.synced ? <Badge tone="ok">同步歌詞</Badge> : <Badge>純文字</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {r.artistName || "未知演出者"}
                      {r.albumName && ` · ${r.albumName}`}
                      {` · ${r.lyrics.lines.length} 行`}
                      {r.duration > 0 && ` · ${formatTimeShort(r.duration)}`}
                      {delta != null && (
                        <span className={cx("ml-1", far ? "text-warn" : "text-faint")}>
                          （{Math.abs(delta) < 0.5 ? "長度相符" : `長度${delta > 0 ? "多" : "少"} ${Math.abs(delta).toFixed(1)} 秒`}）
                        </span>
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setExpanded(open ? null : r.id);
                    }}
                    aria-expanded={open}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-panel-3 hover:text-fg"
                  >
                    預覽
                    <ChevronDownIcon size={12} className={cx("ml-0.5 inline transition-transform", open && "rotate-180")} />
                  </button>
                </label>
                {selected && r.synced && (
                  <label className="mx-3 mb-2 flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={value.useTiming}
                      onChange={(e) => choose({ result: r, useTiming: e.target.checked })}
                      className="accent-[var(--color-accent)]"
                    />
                    使用 LRCLIB 的時間碼
                    {far && value.useTiming && <span className="text-warn">— 版本長度不同，時間可能對不上，建議取消並之後對拍</span>}
                  </label>
                )}
                {open && (
                  <div className="mx-3 mb-3 max-h-48 overflow-y-auto rounded-md border border-line bg-bg/60 px-3 py-2 text-xs leading-6">
                    {r.lyrics.lines.slice(0, PREVIEW_LINES).map((l) => (
                      <div key={l.id} className="flex gap-3">
                        {r.synced && <span className="w-12 shrink-0 font-mono text-faint tabular">{l.start != null ? formatTimeShort(l.start) : ""}</span>}
                        <span className="text-fg/90">{l.text}</span>
                      </div>
                    ))}
                    {r.lyrics.lines.length > PREVIEW_LINES && <div className="text-faint">…還有 {r.lyrics.lines.length - PREVIEW_LINES} 行</div>}
                  </div>
                )}
              </li>
            );
          })}
          {allowNone && (
            <li className={cx("rounded-lg border transition-colors", value === null ? "border-accent/60 bg-accent/[0.06]" : "border-line bg-panel-2/50 hover:border-faint")}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm text-muted">
                <input type="radio" name={group} checked={value === null} onChange={() => choose(null)} className="accent-[var(--color-accent)]" />
                {noneLabel}
              </label>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
