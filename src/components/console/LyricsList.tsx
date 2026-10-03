"use client";

// Lyrics pane: lines grouped by section (sticky material headers that hand over like iOS table
// sections), the one "current line" look shared with the timeline and the editor (a tint-soft
// highlight with a 3 px tint bar that slides from line to line), the standby line, and the
// keyboard selection ring. Playback follow scrolls on a spring (instant under reduced motion);
// keyboard selection scrolls instantly; manual scrolling pauses the follow for 4 s.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button, EmptyState, Kbd, Tag, Tooltip, cx } from "@/components/ui";
import { CrosshairIcon, MusicNotesIcon, PencilSimpleIcon } from "@/components/ui/Icon";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import type { ConsoleController } from "@/lib/console/controller";
import { selectLineIndex, useStageValue } from "@/lib/console/hooks";
import { LYRIC_STYLE_LABELS, SCENE_LABELS } from "@/lib/console/labels";
import { sectionOfLine, untimedCount } from "@/lib/console/navigation";
import type { PlaybackMode } from "@/lib/stage/protocol";
import { lineProgress } from "@/lib/timeline";
import { shownEmphasis } from "@/lib/type/resolve";
import type { LineDesign, Project, SectionDesign } from "@/lib/types";
import { sectionName } from "./Preview";
import { Pane, PaneHeader, useScrollEdge, useSpringScroll } from "./ui";
import { useRafLoop } from "./useRaf";

const FOLLOW_PAUSE_MS = 4000;
/** layout height of the highlight layer; it is scaled to the current row's height */
const HILITE_BASE = 32;

function formatLineTime(t: number | null): string {
  if (t == null || !Number.isFinite(t)) return "--:--";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

interface Group {
  key: string;
  sectionIndex: number | null;
  section: SectionDesign | null;
  lines: number[];
}

/** Lines grouped under their section; every section gets a header, instrumental ones too. */
function buildGroups(project: Project): Group[] {
  const lines = project.lyrics?.lines ?? [];
  const plan = project.plan;
  const duration = project.meta.duration || project.analysis?.duration || 0;
  const groups: Group[] = [];
  let group: Group | null = null;
  let current: number | null = null;
  const open = (s: number) => {
    const section = plan?.sections[s];
    if (!section) return;
    group = { key: `s-${s}`, sectionIndex: s, section, lines: [] };
    groups.push(group);
  };
  lines.forEach((line, index) => {
    const sec = sectionOfLine(plan, lines, index, duration) ?? current;
    if (sec != null && sec !== current && plan) {
      for (let s = current == null ? 0 : current + 1; s <= sec; s++) open(s);
      current = sec;
    }
    if (!group) {
      group = { key: "lead", sectionIndex: null, section: null, lines: [] };
      groups.push(group);
    }
    (group as Group).lines.push(index);
  });
  if (plan) for (let s = (current ?? -1) + 1; s < plan.sections.length; s++) open(s);
  return groups;
}

/** 2 px progress of the current line (TRACK), written per frame without React. */
function CurrentProgress({ controller, project, index, duration }: { controller: ConsoleController; project: Project; index: number; duration: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = project.lyrics?.lines ?? [];
  useRafLoop(() => {
    const el = ref.current;
    if (!el) return;
    const p = lineProgress(lines, index, controller.songTime(), duration);
    el.style.transform = `scaleX(${p.toFixed(4)})`;
  });
  if (lines[index]?.start == null) return null;
  return (
    <div className="pointer-events-none absolute right-3 bottom-0.5 left-3 h-0.5 overflow-hidden rounded-full" aria-hidden="true">
      <div ref={ref} className="h-full origin-left rounded-full bg-tint" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}

function SectionHeader({ section, onJump }: { section: SectionDesign; onJump: () => void }) {
  const [, primary, accent] = section.colorway;
  const name = sectionName(section);
  const hidden = section.lyricStyle === "hidden";
  return (
    // a header inside the listbox is not an option: a mouse shortcut only (sections are also
    // reachable from the timeline and the 設計 tab)
    <Tooltip content="跳到這一段" placement="bottom-start">
      <div role="presentation" onClick={onJump} className="sticky top-0 z-10 flex h-8 cursor-default items-center gap-2 px-3 material-thin">
        <span aria-hidden="true" className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ background: `linear-gradient(${primary ?? "var(--label-3)"}, ${accent ?? primary ?? "var(--label-3)"})` }} />
        <span className="min-w-0 truncate text-c-body font-semibold text-label">{name.label}</span>
        {name.kind && <span className="shrink-0 text-c-footnote text-label-2-on-material">{name.kind}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-c-footnote text-label-2-on-material">
          <span>
            <span className="hidden min-[1500px]:inline">{SCENE_LABELS[section.scene] ?? section.scene}・</span>
            <span className={cx(hidden && "text-orange-text")}>{LYRIC_STYLE_LABELS[section.lyricStyle] ?? section.lyricStyle}</span>
          </span>
          <span className="tabular">{formatLineTime(section.start)}</span>
        </span>
      </div>
    </Tooltip>
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
  const groups = useMemo(() => buildGroups(project), [project]);
  const lineDesigns = useMemo(() => {
    const map = new Map<string, LineDesign>();
    for (const ld of plan?.lines ?? []) map.set(ld.lineId, ld);
    return map;
  }, [plan]);
  // 強調 chips say what the composition shows (the type system's resolved hint), not the designer's guess
  const emphasisShown = useMemo(() => lines.map((_, i) => shownEmphasis(plan, lines, i, duration, project.meta.title)), [plan, lines, duration, project.meta.title]);
  const current = useStageValue(controller.store, selectLineIndex);
  const selectUpcoming = useCallback(() => controller.upcomingLine(), [controller]);
  const upcoming = useStageValue(controller.store, selectUpcoming);
  const untimed = project.lyrics ? untimedCount(project.lyrics) : 0;
  const reduce = useReducedMotion();

  const scrollRef = useRef<HTMLDivElement>(null);
  const hiliteRef = useRef<HTMLDivElement>(null);
  const scroller = useSpringScroll(scrollRef);
  const scrolled = useScrollEdge(scrollRef, [lines.length === 0]);
  const [followPausedAt, setFollowPausedAt] = useState(0);
  const following = followPausedAt === 0;

  // (re)start the pause at most every half second while the operator scrolls
  const pauseFollow = useCallback(() => {
    scroller.stop();
    const now = Date.now();
    setFollowPausedAt((prev) => (now - prev < 500 ? prev : now));
  }, [scroller]);

  // resume auto-follow a few seconds after the operator stopped scrolling
  useEffect(() => {
    if (!followPausedAt) return;
    const t = setTimeout(() => setFollowPausedAt(0), FOLLOW_PAUSE_MS);
    return () => clearTimeout(t);
  }, [followPausedAt]);

  /** Scroll a line into view: centred (follow, spring) or just visible (keyboard, instant). */
  const scrollToIndex = useCallback(
    (index: number, how: "follow" | "keyboard") => {
      const root = scrollRef.current;
      const el = root?.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
      if (!root || !el) return;
      if (how === "keyboard") {
        const header = 32; // sticky section header
        const viewTop = root.scrollTop + header;
        const viewBottom = root.scrollTop + root.clientHeight;
        if (el.offsetTop < viewTop) scroller.jump(el.offsetTop - header - 4);
        else if (el.offsetTop + el.offsetHeight > viewBottom) scroller.jump(el.offsetTop + el.offsetHeight - root.clientHeight + 4);
        return;
      }
      scroller.to(el.offsetTop - (root.clientHeight / 2 - el.offsetHeight / 2));
    },
    [scroller],
  );

  useEffect(() => {
    if (current == null || !following) return;
    scrollToIndex(current, "follow");
  }, [current, following, scrollToIndex]);

  useEffect(() => {
    if (selectedIndex != null) scrollToIndex(selectedIndex, "keyboard");
  }, [selectedIndex, scrollToIndex]);

  // the shared "current line" highlight slides to the current row (transform only: translateY +
  // scaleY of a fixed-height layer; snappy spring; no transition on the first placement or
  // under reduced motion)
  const placeHilite = useCallback(() => {
    const layer = hiliteRef.current;
    const root = scrollRef.current;
    if (!layer || !root) return;
    const el = current != null ? root.querySelector<HTMLElement>(`[data-line-index="${current}"]`) : null;
    if (!el) {
      layer.style.opacity = "0";
      return;
    }
    const first = layer.dataset.placed !== "1";
    if (first || reduce) layer.style.transition = "none";
    layer.style.transform = `translateY(${el.offsetTop}px) scaleY(${(el.offsetHeight / HILITE_BASE).toFixed(4)})`;
    layer.style.opacity = "1";
    if (first || reduce) {
      layer.dataset.placed = "1";
      void layer.offsetHeight; // commit the jump before transitions come back
      layer.style.transition = "";
    }
  }, [current, reduce]);
  useLayoutEffect(placeHilite);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => placeHilite());
    ro.observe(root);
    return () => ro.disconnect();
  }, [placeHilite]);

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

  // a press on the scrollbar is manual scrolling too
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    if (e.clientX > r.left + el.clientWidth) pauseFollow();
    else scroller.stop();
  };

  const live = mode === "live";
  const editHref = `/p/${encodeURIComponent(project.id)}/lyrics`;
  const leave = (e: { preventDefault: () => void }) => {
    if (!controller.confirmLeave()) e.preventDefault();
  };

  return (
    <Pane area="lyrics" label="歌詞列表" order={0}>
      <PaneHeader
        title="歌詞"
        scrolled={scrolled}
        meta={
          <>
            <span className="tabular">{lines.length} 行</span>
            {untimed > 0 && (
              <Tooltip content="這些行沒有時間碼：跟音檔模式不會自動顯示，手動模式可以送出">
                <Tag tone="orange" tabIndex={0} className="relative before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']">
                  {untimed} 行未對時
                </Tag>
              </Tooltip>
            )}
          </>
        }
        actions={
          <Button size="sm" variant="gray" icon={PencilSimpleIcon} href={editHref} transitionTypes={["push"]} onClick={leave}>
            編輯歌詞
          </Button>
        }
      />

      {lines.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            compact
            icon={MusicNotesIcon}
            title="這首歌還沒有歌詞"
            description="畫面仍會照設計播放；需要歌詞時可以貼上、匯入 LRC 或從 LRCLIB 搜尋。"
            action={
              <Button size="sm" variant="tinted" href={editHref} transitionTypes={["push"]} onClick={leave}>
                前往歌詞編輯器
              </Button>
            }
          />
        </div>
      ) : (
        <div
          ref={scrollRef}
          role="listbox"
          tabIndex={0}
          aria-label={live ? "歌詞（↑↓ 選擇待命行，Enter 送出）" : "歌詞（點擊跳到該句，↑↓ 選擇待命行）"}
          aria-activedescendant={selectedIndex != null ? `lyric-row-${selectedIndex}` : undefined}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            // keyboard entry with nothing selected: start from the current line
            if (e.target === e.currentTarget && selectedIndex == null && current != null && e.currentTarget.matches(":focus-visible")) controller.select(current);
          }}
          onWheel={pauseFollow}
          onTouchMove={pauseFollow}
          onPointerDown={onPointerDown}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
        >
          <div
            ref={hiliteRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 origin-top bg-tint-soft opacity-0 shadow-[inset_3px_0_0_var(--tint)] transition-[transform,opacity] duration-(--dur-spring-snappy) ease-spring-snappy motion-reduce:transition-none"
            style={{ height: HILITE_BASE }}
          />
          {groups.map((g) => (
            <div key={g.key} role={g.section ? "group" : undefined} aria-label={g.section ? sectionName(g.section).label : undefined}>
              {g.section && g.sectionIndex != null && <SectionHeader section={g.section} onJump={() => controller.jumpToSection(g.sectionIndex!)} />}
              {g.lines.map((i) => {
                const line = lines[i];
                const isCurrent = i === current;
                const isNext = !isCurrent && i === upcoming;
                const isSelected = i === selectedIndex;
                const past = current != null ? i < current : false;
                const ld = lineDesigns.get(line.id);
                const untimedLine = line.start == null;
                const blank = !line.text.trim();
                const emphasis = emphasisShown[i] ?? [];
                const hasMeta = !!ld?.styleOverride || emphasis.length > 0 || !!ld?.note;
                return (
                  <div
                    key={line.id || `l-${i}`}
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
                      "relative flex cursor-default items-baseline gap-2.5 py-[7px] pr-3 pl-3 transition-none",
                      !isCurrent && "hover:bg-fill-4 active:bg-fill-3",
                      isNext && "row-standby",
                      isSelected && "row-selected",
                    )}
                  >
                    <span className={cx("w-10 shrink-0 text-c-footnote tabular", untimedLine ? "text-orange-text" : isCurrent ? "text-label" : "text-label-2")}>
                      {untimedLine ? "未對時" : formatLineTime(line.start)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cx(
                          "block break-words",
                          isCurrent ? "text-[15px] leading-5 font-semibold text-label" : cx("text-c-body", past ? "text-label-2" : "text-label"),
                          blank && "text-label-2 italic",
                        )}
                      >
                        {line.text.trim() || "（空白行）"}
                      </span>
                      {line.translation && <span className="block text-c-footnote text-label-2">{line.translation}</span>}
                      {hasMeta && (
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {ld?.styleOverride && <Tag tone="tint">{LYRIC_STYLE_LABELS[ld.styleOverride] ?? ld.styleOverride}</Tag>}
                          {emphasis.length > 0 && <span className="text-c-footnote text-label-2">強調：{emphasis.join("、")}</span>}
                          {ld?.note && <span className="min-w-0 truncate text-c-footnote text-label-2">{ld.note}</span>}
                        </span>
                      )}
                    </span>
                    {isNext && <span className="shrink-0 text-c-footnote text-label-2">下一句</span>}
                    {isCurrent && !live && <CurrentProgress controller={controller} project={project} index={i} duration={duration} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {lines.length > 0 && !following && current != null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex justify-center">
          <span className="pointer-events-auto rounded-sm bg-elevated shadow-overlay">
            <Button
              size="sm"
              variant="tinted"
              icon={CrosshairIcon}
              onClick={() => {
                setFollowPausedAt(0);
                scrollToIndex(current, "follow");
              }}
            >
              回到目前
            </Button>
          </span>
        </div>
      )}

      {lines.length > 0 && (
        <footer className="flex h-8 shrink-0 items-center justify-between gap-2 px-3 text-c-footnote text-label-2">
          <span className="truncate">{live ? "點擊或按 Enter 送出歌詞" : "點擊跳到該句"}</span>
          <span className="flex shrink-0 items-center gap-1">
            <Kbd keys="Shift+ArrowUp" />
            <Kbd keys="Shift+ArrowDown" />
            待命
          </span>
        </footer>
      )}
    </Pane>
  );
}

export const LyricsList = memo(LyricsListImpl);
