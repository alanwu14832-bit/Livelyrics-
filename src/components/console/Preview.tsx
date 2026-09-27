"use client";

// Centre column: the live preview (the projection's look, at the output window's aspect) with the
// keyboard HUD over its lower third, and the readout of what is on stage now and next.

import { memo, useCallback, useMemo, useState, type ReactNode, type RefObject } from "react";
import { StageView, type StageStats } from "@/components/stage/StageView";
import { HUD, StatusCapsule, Tag, cx, type HudHandle } from "@/components/ui";
import type { ConsoleController, OutputStatus } from "@/lib/console/controller";
import { formatCountdown } from "@/lib/console/format";
import { selectLineIndex, selectOverrides, selectSectionIndex, selectTimeDecis, useStageValue } from "@/lib/console/hooks";
import { CUE_KIND_LABELS, LYRIC_STYLE_LABELS, PLACEMENT_LABELS, SCENE_LABELS, SECTION_KIND_LABELS, TRANSITION_LABELS, cueColor } from "@/lib/console/labels";
import { sortedCues, upcomingCue } from "@/lib/console/navigation";
import { DEFAULT_OUTPUT, aspectLabel, outputAspect } from "@/lib/output";
import type { PlaybackMode, StageStore } from "@/lib/stage/protocol";
import type { LyricStyleId, Project, SectionDesign } from "@/lib/types";
import { StageSlot, useSharedStats, type SharedStage } from "./SharedStage";
import { Dot, KeyValues, Pane } from "./ui";

const BACKEND_LABELS: Record<StageStats["backend"], string> = {
  webgl2: "WebGL2",
  webgl1: "WebGL1",
  fallback: "備援畫面",
  lost: "GPU 中斷",
};

/** The connected projection window is a different shape than the canvas: it shows black bars. */
function windowMismatch(o: OutputStatus, canvasAspect: number): boolean {
  if (!o.connected || o.width <= 0 || o.height <= 0) return false;
  return Math.abs(o.width / o.height - canvasAspect) / canvasAspect > 0.02;
}

/** Section name, plus its kind only when the name does not already say it (「前奏 前奏」 never). */
export function sectionName(s: Pick<SectionDesign, "label" | "kind">): { label: string; kind: string | null } {
  const kind = SECTION_KIND_LABELS[s.kind] ?? s.kind;
  const label = s.label || kind;
  return { label, kind: kind && kind !== label ? kind : null };
}

/** Small label over the stage preview: solid (no backdrop-filter over the WebGL canvas). */
function FrameLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex h-6 items-center rounded-pill bg-black/60 px-2.5 text-c-footnote font-medium whitespace-nowrap text-label-2-on-material", className)}>{children}</span>;
}

/** Anything that drives a stage: a song's ConsoleController or a show look's LookController. */
export interface StageSource {
  readonly store: StageStore;
}

function BlackoutFrame({ controller }: { controller: StageSource }) {
  const ov = useStageValue(controller.store, selectOverrides);
  if (!ov.blackout) return null;
  return (
    <>
      <div className="pointer-events-none absolute inset-0 rounded-md shadow-[inset_0_0_0_3px_var(--red)]" aria-hidden="true" />
      <StatusCapsule tone="blackout" className="pointer-events-none absolute top-2 right-2">
        黑場中
      </StatusCapsule>
    </>
  );
}

function PreviewPanelImpl({
  controller,
  project,
  output,
  hudRef,
  label = "預覽",
  shared,
}: {
  controller: StageSource;
  project: Project;
  output: OutputStatus;
  hudRef: RefObject<HudHandle | null>;
  /** the frame label's first word (the show console's look preview says 播出中) */
  label?: string;
  /** the show console's one preview stage: shown here instead of a StageView of this panel's own */
  shared?: SharedStage | null;
}) {
  const canvas = project.output ?? DEFAULT_OUTPUT;
  const aspect = Math.min(8, Math.max(0.2, outputAspect(canvas)));
  const mismatch = windowMismatch(output, aspect);
  const [ownStats, setStats] = useState<StageStats | null>(null);
  const onStats = useCallback((s: StageStats) => {
    setStats((prev) => (prev && prev.backend === s.backend && Math.round(prev.fps) === Math.round(s.fps) ? prev : s));
  }, []);
  const sharedStats = useSharedStats(shared);
  const stats = shared ? sharedStats : ownStats;

  return (
    <Pane label="投影預覽" order={1} className="flex-1 p-3">
      <div className="relative min-h-0 flex-1" style={{ containerType: "size" }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative overflow-hidden rounded-md bg-black"
            style={{
              width: `min(100cqw, calc(100cqh * ${aspect}))`,
              aspectRatio: String(aspect),
              boxShadow: "0 0 0 0.5px rgba(255,255,255,0.08), 0 20px 50px -20px rgba(0,0,0,0.6)",
            }}
          >
            {shared ? (
              <StageSlot stage={shared} />
            ) : (
              <StageView
                project={project}
                store={controller.store}
                showGuides
                renderScale={0.5}
                onStats={onStats}
                className="h-full w-full"
                style={{ aspectRatio: "auto", width: "100%", height: "100%" }}
              />
            )}
            <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1">
              <FrameLabel className="t-latin tabular">
                {label}・{canvas.width} × {canvas.height}（{aspectLabel(canvas.width, canvas.height)}）
              </FrameLabel>
              {mismatch && (
                <FrameLabel className="text-orange-text">
                  投影視窗 {output.width} × {output.height}，會加黑邊
                </FrameLabel>
              )}
              {stats && (
                <FrameLabel className={cx("t-latin", (stats.backend === "lost" || stats.backend === "fallback") && "text-orange-text")}>
                  {BACKEND_LABELS[stats.backend]} {Math.round(stats.fps)} fps
                </FrameLabel>
              )}
            </div>
            <BlackoutFrame controller={controller} />
            {/* console chrome only: the HUD never reaches the projection window */}
            <HUD ref={hudRef} />
          </div>
        </div>
      </div>
    </Pane>
  );
}

export const PreviewPanel = memo(PreviewPanelImpl);

function StageReadoutImpl({ controller, project, mode }: { controller: ConsoleController; project: Project; mode: PlaybackMode }) {
  const lines = project.lyrics?.lines ?? [];
  const plan = project.plan;
  const lineIndex = useStageValue(controller.store, selectLineIndex);
  const sectionIndex = useStageValue(controller.store, selectSectionIndex);
  const ov = useStageValue(controller.store, selectOverrides);
  const selectUpcoming = useCallback(() => controller.upcomingLine(), [controller]);
  const upcoming = useStageValue(controller.store, selectUpcoming);
  const t = useStageValue(controller.store, selectTimeDecis);
  const cues = useMemo(() => sortedCues(plan), [plan]);
  const cue = upcomingCue(cues, t);

  const line = lineIndex != null ? lines[lineIndex] : undefined;
  const next = upcoming != null ? lines[upcoming] : undefined;
  const section = sectionIndex != null ? plan?.sections[sectionIndex] : undefined;
  const lineDesign = line ? plan?.lines?.find((l) => l.lineId === line.id) : undefined;
  const style: LyricStyleId | undefined = ov.lyricStyle ?? lineDesign?.styleOverride ?? section?.lyricStyle;
  const scene = ov.scene ?? section?.scene;
  const lyricHidden = !ov.lyricsVisible || style === "hidden" || ov.blackout;
  const live = mode === "live";
  const name = section ? sectionName(section) : null;
  const soon = cue != null && cue.inSeconds <= 5;

  return (
    <Pane label="現在與下一句" order={2} className="shrink-0">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(220px,272px)] gap-x-4 px-4 py-3">
        <div className="min-w-0">
          <div className="flex h-5 min-w-0 items-center gap-2 text-c-footnote text-label-2">
            <span className="shrink-0 font-semibold">現在</span>
            {section && name && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Dot style={{ background: section.colorway[1] ?? "var(--label-3)" }} />
                <span className="truncate">{name.label}</span>
                {name.kind && <span className="shrink-0">{name.kind}</span>}
              </span>
            )}
            {lyricHidden && line && (
              <Tag tone="orange" className="shrink-0">
                投影上未顯示歌詞
              </Tag>
            )}
          </div>
          <p
            className={cx(
              "mt-0.5 truncate text-c-now",
              line ? (lyricHidden ? "text-label-2 line-through decoration-label-3" : "text-label") : "font-normal text-label-2",
            )}
            title={line?.text}
            aria-live="polite"
          >
            {line ? line.text || "（空白行）" : live ? "等待送出" : `${name?.label ?? "間奏"}（無歌詞）`}
          </p>
          {line?.translation && <p className="truncate text-c-body text-label-2">{line.translation}</p>}
          <div className="mt-1 flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-c-footnote font-semibold text-label-2">下一句</span>
            <span className="truncate text-c-title font-normal text-label-2" title={next?.text}>
              {next ? next.text || "（空白行）" : "無"}
            </span>
          </div>
          <KeyValues
            className="mt-2"
            items={[
              scene && { key: "場景", value: SCENE_LABELS[scene] ?? scene },
              style && { key: "歌詞", value: LYRIC_STYLE_LABELS[style] ?? style, tone: style === "hidden" ? "orange" : "default" },
              section && { key: "位置", value: PLACEMENT_LABELS[section.lyricPlacement] ?? section.lyricPlacement },
              section && { key: "字級", value: `×${(section.lyricScale * ov.lyricScale).toFixed(2)}` },
              section && { key: "轉場", value: TRANSITION_LABELS[section.transitionIn] ?? section.transitionIn },
              section && { key: "能量", value: `${Math.round(section.energy * 100)}%` },
              !plan && { key: "設計", value: "尚無設計方案", tone: "orange" },
            ]}
          />
        </div>

        {cue ? (
          <div className="flex min-w-0 flex-col self-start rounded-md bg-surface-2 px-3 py-2.5">
            <p className="flex min-w-0 items-center gap-1.5 text-c-footnote text-label-2">
              <span aria-hidden="true" className="size-2 shrink-0 rotate-45 rounded-[1px]" style={{ background: cueColor(cue.cue.kind) }} />
              <span className="truncate">下一個提示・{CUE_KIND_LABELS[cue.cue.kind] ?? cue.cue.kind}</span>
            </p>
            <p className={cx("mt-0.5 text-[22px] leading-[26px] font-semibold tabular", soon ? "text-orange-text" : "text-label")}>{formatCountdown(cue.inSeconds)}</p>
            <p className="mt-0.5 truncate text-c-headline text-label" title={cue.cue.title}>
              {cue.cue.title}
            </p>
            {cue.cue.detail && <p className="mt-0.5 line-clamp-2 text-c-footnote text-label-2">{cue.cue.detail}</p>}
          </div>
        ) : (
          <div className="flex min-w-0 items-center self-start rounded-md bg-surface-2 px-3 py-2.5 text-c-footnote text-label-2">沒有後續的現場提示</div>
        )}
      </div>
    </Pane>
  );
}

export const StageReadout = memo(StageReadoutImpl);
