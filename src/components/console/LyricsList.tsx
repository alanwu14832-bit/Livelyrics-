"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Badge, cx } from "@/components/ui";
import type { ConsoleController } from "@/lib/console/controller";
import { withAlpha } from "@/lib/console/format";
import { selectLineIndex, useStageValue } from "@/lib/console/hooks";
import { LYRIC_STYLE_LABELS, SCENE_LABELS, SECTION_KIND_LABELS } from "@/lib/console/labels";
import { sectionOfLine, untimedCount } from "@/lib/console/navigation";
import { stageTime, type PlaybackMode } from "@/lib/stage/protocol";
import { lineProgress } from "@/lib/timeline";
import type { LineDesign, Project, SectionDesign } from "@/lib/types";
import { IconEdit, IconTarget } from "./icons";
import { useRafLoop } from "./useRaf";

const FOLLOW_PAUSE_MS = 4000;

function formatLineTime(t: number | null): string {
  if (t == null || !Number.isFinite(t)) return "--:--";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

type Row =
  | { kind: "section"; key: string; sectionIndex: number; section: SectionDesign }
  | { kind: "line"; key: string; index: number };

function buildRows(project: Project): Row[] {
  const lines = project.lyrics?.lines ?? [];
  const plan = project.plan;
  const rows: Row[] = [];
  let current: number | null = null;
  lines.forEach((line, index) => {
    const sec = sectionOfLine(plan, line) ?? current;
    if (sec != null && sec !== current && plan) {
      // headers for every section up to this one, so instrumental sections show too
      const from = current == null ? 0 : current + 1;
      for (let s = from; s <= sec; s++) {
        const section = plan.sections[s];
        if (section) rows.push({ kind: "section", key: `s-${s}`, sectionIndex: s, section });
      }
      current = sec;
    }
    rows.push({ kind: "line", key: line.id || `l-${index}`, index });
  });
  if (plan) for (let s = (current ?? -1) + 1; s < plan.sections.length; s++) rows.push({ kind: "section", key: `s-${s}`, sectionIndex: s, section: plan.sections[s] });
  return rows;
}

function CurrentProgress({ controller, project, index, duration }: { controller: ConsoleController; project: Project; index: number; duration: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = project.lyrics?.lines ?? [];
  useRafLoop(() => {
    const el = ref.current;
    if (!el) return;
    const p = lineProgress(lines, index, stageTime(controller.store.get()), duration);
    el.style.transform = `scaleX(${p.toFixed(4)})`;
  });
  if (lines[index]?.start == null) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-accent/15" aria-hidden="true">
      <div ref={ref} className="h-full origin-left bg-accent" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}

function LyricsListImpl({
  controller,
  project,
  mode,
  selectedIndex,
  duration,
}: {
  controller: ConsoleController;
  project: Project;
  mode: PlaybackMode;
  selectedIndex: number | null;
  duration: number;
}) {
  const lines = useMemo(() => project.lyrics?.lines ?? [], [project.lyrics]);
  const plan = project.plan;
  const rows = useMemo(() => buildRows(project), [project]);
  const lineDesigns = useMemo(() => {
    const map = new Map<string, LineDesign>();
    for (const ld of plan?.lines ?? []) map.set(ld.lineId, ld);
    return map;
  }, [plan]);
  const current = useStageValue(controller.store, selectLineIndex);
  const selectUpcoming = useCallback(() => controller.upcomingLine(), [controller]);
  const upcoming = useStageValue(controller.store, selectUpcoming);
  const untimed = project.lyrics ? untimedCount(project.lyrics) : 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [followPausedAt, setFollowPausedAt] = useState(0);
  const following = followPausedAt === 0;

  const pauseFollow = useCallback(() => setFollowPausedAt(Date.now()), []);

  // resume auto-follow a few seconds after the operator stopped scrolling
  useEffect(() => {
    if (!followPausedAt) return;
    const t = setTimeout(() => setFollowPausedAt(0), FOLLOW_PAUSE_MS);
    return () => clearTimeout(t);
  }, [followPausedAt]);

  const scrollToIndex = useCallback((index: number, block: ScrollLogicalPosition, smooth = true) => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
    if (!root || !el) return;
    const top = el.offsetTop - (block === "center" ? root.clientHeight / 2 - el.offsetHeight / 2 : 40);
    if (block === "nearest") {
      const viewTop = root.scrollTop;
      const viewBottom = viewTop + root.clientHeight;
      if (el.offsetTop >= viewTop + 36 && el.offsetTop + el.offsetHeight <= viewBottom) return;
    }
    root.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    if (current == null || !following) return;
    scrollToIndex(current, "center");
  }, [current, following, scrollToIndex]);

  useEffect(() => {
    if (selectedIndex != null) scrollToIndex(selectedIndex, "nearest");
  }, [selectedIndex, scrollToIndex]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case "ArrowDown":
        controller.moveSelection(1);
        break;
      case "ArrowUp":
        controller.moveSelection(-1);
        break;
      case "Home":
        controller.select(0);
        break;
      case "End":
        controller.select(lines.length - 1);
        break;
      case "Enter":
        controller.cueSelected();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const live = mode === "live";

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-panel" style={{ gridArea: "lyrics" }} aria-label="歌詞列表">
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted">歌詞</h2>
          <span className="font-mono text-[11px] text-faint tabular">{lines.length} 行</span>
          {untimed > 0 && (
            <Badge tone="warn" title="這些行沒有時間碼：TRACK 模式不會自動顯示，LIVE 模式可手動送出">
              {untimed} 未對時
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!following && current != null && (
            <button
              type="button"
              onClick={() => {
                setFollowPausedAt(0);
                scrollToIndex(current, "center");
              }}
              className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-accent hover:bg-accent/10"
            >
              <IconTarget size={12} />
              回到目前
            </button>
          )}
          <Link
            href={`/p/${encodeURIComponent(project.id)}/lyrics`}
            className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted hover:bg-panel-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <IconEdit size={12} />
            編輯歌詞
          </Link>
        </div>
      </header>

      {lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted">這首歌還沒有歌詞</p>
          <p className="text-xs leading-relaxed text-faint">畫面仍會照設計播放；需要歌詞時可以貼上、匯入 LRC 或從 LRCLIB 搜尋。</p>
          <Link href={`/p/${encodeURIComponent(project.id)}/lyrics`} className="rounded-md border border-line bg-panel-3 px-3 py-1.5 text-xs text-fg hover:bg-line">
            前往歌詞編輯器
          </Link>
        </div>
      ) : (
        <div
          ref={scrollRef}
          role="listbox"
          tabIndex={0}
          aria-label="歌詞（↑↓ 選擇待命行，Enter 送出）"
          aria-activedescendant={selectedIndex != null ? `lyric-row-${selectedIndex}` : undefined}
          onKeyDown={onKeyDown}
          onWheel={pauseFollow}
          onTouchMove={pauseFollow}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 focus-visible:outline-none"
        >
          {rows.map((row) => {
            if (row.kind === "section") {
              const s = row.section;
              const [bg, primary, accent] = s.colorway;
              return (
                <button
                  key={row.key}
                  type="button"
                  tabIndex={-1}
                  onClick={() => controller.jumpToSection(row.sectionIndex)}
                  className="sticky top-0 z-10 flex w-full items-center gap-2 border-y border-line/60 bg-panel/95 px-3 py-1.5 text-left backdrop-blur hover:bg-panel-2"
                  title={`跳到「${s.label}」`}
                >
                  <span
                    className="h-4 w-1.5 shrink-0 rounded-full"
                    style={{ background: `linear-gradient(${primary ?? "#888"}, ${accent ?? primary ?? "#888"})`, boxShadow: `0 0 0 1px ${withAlpha(bg ?? "#000", 0.6)}` }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-[11px] font-semibold text-fg">{s.label}</span>
                  <span className="shrink-0 text-[10px] text-faint">{SECTION_KIND_LABELS[s.kind] ?? s.kind}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-faint">
                    <span className="hidden min-[1500px]:inline">{SCENE_LABELS[s.scene] ?? s.scene}</span>
                    <span className={cx(s.lyricStyle === "hidden" && "text-warn")}>{LYRIC_STYLE_LABELS[s.lyricStyle] ?? s.lyricStyle}</span>
                    <span className="font-mono tabular">{formatLineTime(s.start)}</span>
                  </span>
                </button>
              );
            }
            const i = row.index;
            const line = lines[i];
            const isCurrent = i === current;
            const isNext = !isCurrent && i === upcoming;
            const isSelected = i === selectedIndex;
            const past = current != null ? i < current : false;
            const ld = lineDesigns.get(line.id);
            const untimedLine = line.start == null;
            return (
              <div
                key={row.key}
                id={`lyric-row-${i}`}
                role="option"
                aria-selected={isSelected}
                aria-current={isCurrent ? "true" : undefined}
                data-line-index={i}
                onClick={() => {
                  controller.select(i);
                  controller.jumpToLine(i);
                }}
                className={cx(
                  "group relative flex cursor-pointer items-start gap-2 border-l-2 py-1.5 pr-2.5 pl-2.5 transition-colors",
                  isCurrent ? "border-accent bg-accent/12" : isNext ? "border-accent/40 bg-panel-2/60" : "border-transparent hover:bg-panel-2",
                  isSelected && "outline-1 -outline-offset-1 outline-accent-2",
                )}
              >
                <span
                  className={cx(
                    "w-11 shrink-0 pt-0.5 font-mono text-[10.5px] tabular",
                    untimedLine ? "text-warn" : isCurrent ? "text-accent" : "text-faint",
                  )}
                  title={untimedLine ? "尚未對時" : undefined}
                >
                  {untimedLine ? "未對時" : formatLineTime(line.start)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cx(
                      "block text-[13px] leading-snug break-words",
                      isCurrent ? "font-semibold text-fg" : isNext ? "text-fg/90" : past ? "text-muted" : "text-fg/80",
                      !line.text.trim() && "text-faint italic",
                    )}
                  >
                    {line.text.trim() || "（空白行）"}
                  </span>
                  {line.translation && <span className="block text-[11px] leading-snug text-faint">{line.translation}</span>}
                  {(ld?.styleOverride || (ld?.emphasis?.length ?? 0) > 0 || ld?.note) && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      {ld?.styleOverride && <Badge tone="accent">{LYRIC_STYLE_LABELS[ld.styleOverride] ?? ld.styleOverride}</Badge>}
                      {(ld?.emphasis?.length ?? 0) > 0 && <Badge title="強調字詞">✦ {ld!.emphasis.join("、")}</Badge>}
                      {ld?.note && <span className="truncate text-[10px] text-faint">{ld.note}</span>}
                    </span>
                  )}
                </span>
                {isCurrent && <span className="shrink-0 pt-0.5 text-[10px] font-semibold text-accent">{live ? "送出中" : "現在"}</span>}
                {isNext && <span className="shrink-0 pt-0.5 text-[10px] text-muted">下一句</span>}
                {isCurrent && !live && <CurrentProgress controller={controller} project={project} index={i} duration={duration} />}
              </div>
            );
          })}
        </div>
      )}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line px-3 text-[10px] text-faint">
        <span>{live ? "點擊或 Enter 送出歌詞" : "點擊跳到該句"}</span>
        <span>Shift+↑↓ 選擇待命行</span>
      </footer>
    </section>
  );
}

export const LyricsList = memo(LyricsListImpl);
