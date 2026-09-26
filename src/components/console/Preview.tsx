"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { StageView, type StageStats } from "@/components/stage/StageView";
import { Badge, cx } from "@/components/ui";
import type { ConsoleController, OutputStatus } from "@/lib/console/controller";
import { formatCountdown, withAlpha } from "@/lib/console/format";
import { selectLineIndex, selectOverrides, selectSectionIndex, selectTimeDecis, useStageValue } from "@/lib/console/hooks";
import { CUE_KIND_COLORS, CUE_KIND_LABELS, LYRIC_STYLE_LABELS, PLACEMENT_LABELS, SCENE_LABELS, SECTION_KIND_LABELS, TRANSITION_LABELS } from "@/lib/console/labels";
import { sortedCues, upcomingCue } from "@/lib/console/navigation";
import type { PlaybackMode } from "@/lib/stage/protocol";
import type { LyricStyleId, Project } from "@/lib/types";

const BACKEND_LABELS: Record<StageStats["backend"], string> = {
  webgl2: "WebGL2",
  webgl1: "WebGL1",
  fallback: "備援畫面",
  lost: "GPU 中斷",
};

function outputAspect(o: OutputStatus): number {
  if (!o.connected || o.width <= 0 || o.height <= 0) return 16 / 9;
  return Math.min(5, Math.max(0.3, o.width / o.height));
}

function aspectLabel(a: number): string {
  const known: Array<[number, string]> = [
    [16 / 9, "16:9"],
    [16 / 10, "16:10"],
    [4 / 3, "4:3"],
    [21 / 9, "21:9"],
    [32 / 9, "32:9"],
    [1, "1:1"],
    [9 / 16, "9:16"],
  ];
  for (const [v, label] of known) if (Math.abs(v - a) < 0.02) return label;
  return `${a.toFixed(2)}:1`;
}

function PreviewOverlay({ controller }: { controller: ConsoleController }) {
  const ov = useStageValue(controller.store, selectOverrides);
  const chips: Array<{ label: string; tone: "danger" | "warn" | "accent" | "neutral" }> = [];
  if (ov.blackout) chips.push({ label: "黑場中", tone: "danger" });
  if (ov.freeze) chips.push({ label: "畫面凍結", tone: "warn" });
  if (!ov.lyricsVisible) chips.push({ label: "歌詞已隱藏", tone: "warn" });
  if (ov.scene) chips.push({ label: `場景：${SCENE_LABELS[ov.scene]}`, tone: "accent" });
  if (ov.lyricStyle) chips.push({ label: `歌詞：${LYRIC_STYLE_LABELS[ov.lyricStyle]}`, tone: "accent" });
  if (ov.testPattern) chips.push({ label: "測試圖", tone: "neutral" });
  if (Math.abs(ov.intensity - 1) > 0.01) chips.push({ label: `強度 ${Math.round(ov.intensity * 100)}%`, tone: "neutral" });
  if (Math.abs(ov.lyricScale - 1) > 0.01) chips.push({ label: `字級 ×${ov.lyricScale.toFixed(2)}`, tone: "neutral" });
  return (
    <>
      {ov.blackout && <div className="pointer-events-none absolute inset-0 rounded-[3px] ring-2 ring-danger ring-inset" aria-hidden="true" />}
      {chips.length > 0 && (
        <div className="pointer-events-none absolute top-2 right-2 flex max-w-[70%] flex-wrap justify-end gap-1">
          {chips.map((c) => (
            <Badge key={c.label} tone={c.tone} className="bg-bg/85 backdrop-blur">
              {c.label}
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

function PreviewPanelImpl({ controller, project, output }: { controller: ConsoleController; project: Project; output: OutputStatus }) {
  const aspect = outputAspect(output);
  const [stats, setStats] = useState<StageStats | null>(null);
  const onStats = useCallback((s: StageStats) => {
    setStats((prev) => (prev && prev.backend === s.backend && Math.round(prev.fps) === Math.round(s.fps) ? prev : s));
  }, []);

  return (
    <div className="relative min-h-0 flex-1" style={{ containerType: "size" }}>
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative overflow-hidden rounded-[4px] bg-black shadow-[0_0_0_1px_var(--color-line),0_20px_60px_-20px_rgba(0,0,0,0.8)]"
          style={{ width: `min(100cqw, calc(100cqh * ${aspect}))`, aspectRatio: String(aspect) }}
        >
          <StageView
            project={project}
            store={controller.store}
            showGuides
            renderScale={0.5}
            onStats={onStats}
            className="h-full w-full"
            style={{ aspectRatio: "auto", width: "100%", height: "100%" }}
          />
          <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-1">
            <Badge className="bg-bg/85 backdrop-blur">預覽 · {aspectLabel(aspect)}</Badge>
            {stats && (
              <Badge tone={stats.backend === "lost" || stats.backend === "fallback" ? "warn" : "neutral"} className="bg-bg/85 font-mono backdrop-blur">
                {BACKEND_LABELS[stats.backend]} · {Math.round(stats.fps)} fps
              </Badge>
            )}
          </div>
          <PreviewOverlay controller={controller} />
        </div>
      </div>
    </div>
  );
}

export const PreviewPanel = memo(PreviewPanelImpl);

function Chip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-panel-2 px-2 text-[11px]">
      <span className="text-faint">{label}</span>
      <span className={cx("font-medium", warn ? "text-warn" : "text-fg")}>{value}</span>
    </span>
  );
}

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

  return (
    <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 rounded-lg border border-line bg-panel px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-semibold tracking-[0.14em] text-accent">現在</span>
          {section && (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-full" style={{ background: section.colorway[1] ?? "#888" }} aria-hidden="true" />
              {section.label}
              <span className="text-faint">{SECTION_KIND_LABELS[section.kind] ?? section.kind}</span>
            </span>
          )}
          {lyricHidden && line && <Badge tone="warn">投影上未顯示歌詞</Badge>}
        </div>
        <p
          className={cx(
            "mt-1 truncate text-[26px] leading-tight font-bold tracking-tight",
            line ? (lyricHidden ? "text-muted line-through decoration-faint/60" : "text-fg") : "text-faint",
          )}
          title={line?.text}
          aria-live="polite"
        >
          {line ? line.text || "（空白行）" : live ? "— 等待送出 —" : `— ${section?.label ?? "間奏"}・無歌詞 —`}
        </p>
        {line?.translation && <p className="truncate text-xs text-muted">{line.translation}</p>}
        <div className="mt-2 flex min-w-0 items-baseline gap-2 text-sm">
          <span className="shrink-0 text-[11px] font-semibold tracking-[0.14em] text-faint">下一句</span>
          <span className="truncate text-muted" title={next?.text}>
            {next ? next.text || "（空白行）" : "—"}
          </span>
        </div>
      </div>

      <div className="flex w-[280px] flex-col items-stretch gap-2">
        {cue ? (
          <div
            className={cx("rounded-md border px-2.5 py-1.5", cue.inSeconds <= 5 ? "border-warn/60 bg-warn/10" : "border-line bg-panel-2")}
            style={{ borderLeft: `3px solid ${CUE_KIND_COLORS[cue.cue.kind] ?? "#888"}` }}
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-faint">下一個提示 · {CUE_KIND_LABELS[cue.cue.kind] ?? cue.cue.kind}</span>
              <span className={cx("font-mono font-semibold tabular", cue.inSeconds <= 5 ? "text-warn" : "text-fg")}>{formatCountdown(cue.inSeconds)}</span>
            </div>
            <p className="truncate text-xs font-semibold text-fg" title={cue.cue.detail}>
              {cue.cue.title}
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-[11px] text-faint">沒有後續的現場提示</div>
        )}
        <div className="flex flex-wrap justify-end gap-1">
          {scene && <Chip label="場景" value={SCENE_LABELS[scene] ?? scene} />}
          {style && <Chip label="歌詞" value={LYRIC_STYLE_LABELS[style] ?? style} warn={style === "hidden"} />}
          {section && <Chip label="位置" value={PLACEMENT_LABELS[section.lyricPlacement] ?? section.lyricPlacement} />}
          {section && <Chip label="字級" value={`×${(section.lyricScale * ov.lyricScale).toFixed(2)}`} />}
          {section && <Chip label="轉場" value={TRANSITION_LABELS[section.transitionIn] ?? section.transitionIn} />}
          {section && (
            <span
              className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-panel-2 px-2 text-[11px]"
              title={`段落能量 ${Math.round(section.energy * 100)}%`}
            >
              <span className="text-faint">能量</span>
              <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-panel-3">
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.round(section.energy * 100)}%`, background: withAlpha(section.colorway[2] ?? "#ff5a36", 0.9) }} />
              </span>
            </span>
          )}
          {!plan && <Chip label="設計" value="尚無設計方案" warn />}
        </div>
      </div>
    </div>
  );
}

export const StageReadout = memo(StageReadoutImpl);
