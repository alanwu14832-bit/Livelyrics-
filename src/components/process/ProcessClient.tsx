"use client";

// The design overview (UI-AUDIT §3.5 處理頁): an iOS step list with a calm streaming panel while
// the pipeline runs, then the key visual as a showcase. One filled button per screen: 「進入控制台」
// in the header once there is a plan, moving into the 「設計完成」 banner right after a run (the
// header copy turns plain). Kept for the e2e: role="status" containing 「設計完成」, ?run=1 stripped.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppHeader, Banner, Button, Disclosure, EmptyState, Skeleton, SkeletonGroup, SkeletonText, cx, pageContainerClass } from "@/components/ui";
import { ExportIcon, FileTextIcon, MonitorPlayIcon, PencilSimpleIcon, SparkleIcon, SwatchesIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { api, type ProcessRequest } from "@/lib/api-client";
import { retryFrom } from "@/lib/process-runner";
import type { PipelineEvent, Project } from "@/lib/types";
import { validPalette } from "@/components/home/ProjectArt";
import { ProjectHeading } from "@/components/home/ProjectHeading";
import { NOT_FOUND_HEADER_TITLE, ProjectNotFound } from "@/components/home/ProjectNotFound";
import { useServerStatus } from "@/components/home/ServerStatus";
import { PUSH } from "@/components/home/transitions";
import { clearLyricsHandoff, readLyricsHandoff } from "@/components/upload/handoff";
import { AssetLibrary } from "@/components/assets/AssetLibrary";
import { DirectionsSection } from "@/components/directions/DirectionsPanel";
import { ManualClaudeSheet } from "@/components/manual/ManualClaudeSheet";
import { KeyVisualSummary } from "./KeyVisualSummary";
import {
  applyEvents,
  failedStep,
  failRun,
  initialRunState,
  runningStep,
  startRun,
  stepsFromProject,
  type LogEntry,
  type RunState,
} from "./pipeline-state";
import { RedesignBox } from "./RedesignBox";
import { ResearchPanel } from "./ResearchPanel";
import { StepTimeline } from "./StepTimeline";
import { PROCESS_STEPS, processHref, stepsFrom, type ProcessStep } from "./steps";
import { StreamPanel } from "./StreamPanel";

/** What the server page already knows, so the header (and its shared-element morph) renders at once. */
export interface ProcessHeaderInfo {
  title: string;
  artist: string;
  palette: string[];
}

type LoadState = { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string; notFound: boolean };

const STEP_NAME: Record<string, string> = { lyrics: "歌詞", research: "研究", design: "設計", analyze: "分析", done: "完成" };

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Drop `steps` when it is the full pipeline (the server default). */
function cleanRequest(req: ProcessRequest): ProcessRequest {
  if (req.attachOnly) return { attachOnly: true };
  const out: ProcessRequest = {};
  const steps = req.steps ? PROCESS_STEPS.filter((s) => req.steps!.includes(s)) : [];
  if (steps.length && steps.length < PROCESS_STEPS.length) out.steps = steps;
  if (req.lyricsText?.trim() && (!out.steps || out.steps.includes("lyrics"))) out.lyricsText = req.lyricsText;
  if (req.instruction?.trim()) out.instruction = req.instruction.trim();
  if (req.free) out.free = true;
  return out;
}

export function ProcessClient({
  id,
  run,
  steps,
  instruction,
  initial,
}: {
  id: string;
  run: boolean;
  steps?: ProcessStep[];
  instruction?: string;
  initial?: ProcessHeaderInfo | null;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [runState, setRunState] = useState<RunState>(initialRunState);
  const [lastRequest, setLastRequest] = useState<ProcessRequest | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  // 用 claude.ai 研究 (manual Claude mode): the sheet is open
  const [manualOpen, setManualOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const server = useServerStatus();
  // read inside the run callbacks: copy that names the server differs in cloud mode
  const cloudRef = useRef(false);
  const cloud = server.state.kind === "ok" && server.state.status.storage?.mode === "cloud";
  useEffect(() => {
    cloudRef.current = cloud;
  }, [cloud]);

  const started = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const pendingAbort = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<PipelineEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshProject = useCallback(() => {
    api
      .getProject(id)
      .then((p) => setProject(p))
      .catch(() => {
        /* keep what we have */
      });
  }, [id]);

  const execute = useCallback(
    (raw: ProcessRequest) => {
      const request = cleanRequest(raw);
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      queue.current = [];
      setLastRequest(request);
      setJustFinished(false);
      setRunState(startRun(request.steps, Date.now()));
      setNow(Date.now());

      // SSE deltas can arrive hundreds of times per second: batch them into one render
      const flush = () => {
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = null;
        const events = queue.current;
        queue.current = [];
        if (events.length && !controller.signal.aborted) setRunState((s) => applyEvents(s, events, Date.now()));
      };

      let sawAttached = false;
      api
        .process(
          id,
          request,
          (event) => {
            if (controller.signal.aborted) return;
            if (event.type === "attached") {
              sawAttached = true;
              // retry / re-run should repeat what the attached run does, not what this page asked for
              setLastRequest((r) => ({ steps: event.steps, lyricsText: r?.attachOnly ? undefined : r?.lyricsText, instruction: r?.instruction, free: r?.free }));
            }
            if (event.type === "step" && event.step === "lyrics" && (event.status === "done" || event.status === "skipped")) {
              // the lyrics now live on the project: never re-send the pasted text (it could overwrite later edits)
              clearLyricsHandoff(id);
              setLastRequest((r) => (r?.lyricsText ? { ...r, lyricsText: undefined } : r));
            }
            queue.current.push(event);
            if (event.type === "delta" || event.type === "log" || event.type === "search") {
              flushTimer.current ??= setTimeout(flush, 120);
            } else {
              flush();
            }
          },
          controller.signal,
        )
        .then((final) => {
          if (controller.signal.aborted) return;
          flush();
          setProject(final);
          clearLyricsHandoff(id);
          if (request.attachOnly && !sawAttached) {
            // the run had already finished: show the stored result, not an empty "run"
            setRunState(initialRunState());
            return;
          }
          setJustFinished(true);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          flush();
          // fetch() network failures are TypeErrors ("Failed to fetch", "Load failed", "NetworkError…")
          const message =
            err instanceof TypeError
              ? `與${cloudRef.current ? "" : "本機"}伺服器的連線中斷（處理可能仍在背景進行，重新整理頁面即可接上）`
              : err instanceof Error
                ? err.message || "處理失敗"
                : String(err);
          setRunState((s) => failRun(s, message, Date.now()));
          refreshProject();
        });
    },
    [id, refreshProject],
  );

  // load once, then run/attach as the URL and project status ask (guarded against StrictMode double effects)
  useEffect(() => {
    if (pendingAbort.current) {
      clearTimeout(pendingAbort.current);
      pendingAbort.current = null;
    }
    if (!started.current) {
      started.current = true;
      api
        .getProject(id)
        .then((p) => {
          setProject(p);
          setLoad({ kind: "ok" });
          // a refresh after completion must not start the pipeline again
          // null state (not history.state): Next only syncs its router URL for non-internal
          // calls, otherwise its next commit would put `?run=1` back and a refresh would re-run
          if (run) window.history.replaceState(null, "", processHref(id));
          if (run || p.status === "new") {
            const handoff = readLyricsHandoff(id);
            execute({ steps, lyricsText: handoff ?? undefined, instruction });
          } else if (p.status === "processing") {
            // another tab (or an earlier visit) started it: only watch, never start a second run
            execute({ attachOnly: true });
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setLoad({ kind: "error", message, notFound: /找不到|404/.test(message) });
        });
    }
    return () => {
      // deferred so a StrictMode re-mount keeps the stream; a real unmount closes it (the run continues on the server)
      pendingAbort.current = setTimeout(() => controllerRef.current?.abort(), 0);
    };
  }, [id, run, steps, instruction, execute]);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    [],
  );

  const running = runState.phase === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const retry = () => {
    // cloud mode records the run on the project, with what it was asked to do
    const recorded = project?.pipeline && project.pipeline.status !== "done" ? project.pipeline : null;
    if (runState.phase === "error" && lastRequest && !lastRequest.attachOnly) {
      const requested = lastRequest.steps ?? [...PROCESS_STEPS];
      const from = failedStep(runState) ?? runningStep(runState) ?? requested[0] ?? "lyrics";
      execute({ steps: stepsFrom(requested, from), lyricsText: lastRequest.lyricsText, instruction: lastRequest.instruction ?? recorded?.instruction, free: lastRequest.free ?? recorded?.free });
      return;
    }
    if (!project) return;
    if (recorded) {
      // a run that stopped (its request ran out of time, the page was closed): pick up where it stopped
      execute({ steps: retryFrom(recorded), lyricsText: readLyricsHandoff(id) ?? undefined, instruction: recorded.instruction, free: recorded.free });
      return;
    }
    if (project.research && !project.plan) execute({ steps: ["design"] });
    else execute({ lyricsText: readLyricsHandoff(id) ?? undefined });
  };
  const rerunAll = () => execute({ lyricsText: lastRequest?.lyricsText ?? readLyricsHandoff(id) ?? undefined, free: lastRequest?.free });
  const redesign = (text: string, withResearch: boolean, free = false) => execute({ steps: withResearch ? ["research", "design"] : ["design"], instruction: text || undefined, free });

  // ---------------------------------------------------------------------------

  const consoleHref = `/p/${encodeURIComponent(id)}`;
  const lyricsHref = `/p/${encodeURIComponent(id)}/lyrics`;
  const exportHref = `/p/${encodeURIComponent(id)}/export`;
  const headerTitle = project?.meta.title || initial?.title || "";
  const headerArtist = project?.meta.artist ?? initial?.artist ?? "";
  const headerPalette = project ? validPalette(project.plan?.keyVisual.palette.map((c) => c.hex)) : (initial?.palette ?? []);

  const header = (actions?: ReactNode, titleOverride?: string) => (
    <AppHeader
      back
      width="full"
      title={titleOverride}
      heading={
        titleOverride == null && (project || initial) ? (
          <ProjectHeading id={id} title={headerTitle || "載入中…"} subtitle={headerArtist || undefined} palette={headerPalette} />
        ) : undefined
      }
      actions={actions}
    />
  );

  if (load.kind === "loading") {
    return (
      <div className="min-h-dvh">
        {header()}
        <SkeletonGroup label="載入設計總覽" className={cx(pageContainerClass, "grid items-start gap-x-10 gap-y-8 pt-6 pb-24 lg:grid-cols-[360px_minmax(0,1fr)]")}>
          <div className="min-w-0">
            <Skeleton className="mb-2 ml-4 h-3 w-16" />
            <div className="space-y-4 rounded-lg bg-surface p-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-5 rounded-full!" />
                  <SkeletonText lines={2} size="caption" className="flex-1" />
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-6">
            <Skeleton className="h-10 w-2/5" />
            <SkeletonText lines={2} />
            <Skeleton className="aspect-video rounded-2xl!" />
          </div>
        </SkeletonGroup>
      </div>
    );
  }

  if (load.kind === "error" || !project) {
    const notFound = load.kind === "error" && load.notFound;
    return (
      <div className="flex min-h-dvh flex-col">
        {header(undefined, notFound ? NOT_FOUND_HEADER_TITLE : "無法載入")}
        {notFound ? (
          <ProjectNotFound />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center pb-[52px]">
            <EmptyState
              icon={WarningCircleIcon}
              title="無法載入這個作品"
              description={load.kind === "error" ? load.message : ""}
              action={
                <Button variant="tinted" onClick={() => window.location.reload()}>
                  重新載入
                </Button>
              }
            />
          </div>
        )}
      </div>
    );
  }

  const phase = runState.phase;
  const observed = phase !== "idle";
  const stepStates = observed ? runState.steps : stepsFromProject(project);
  const runError = phase === "error" ? runState.error : null;
  const storedError = !observed && project.status === "error" ? project.error || "上次的處理沒有完成。" : null;
  const error = runError ?? storedError;
  const plan = project.plan;
  const showSummary = !running && plan != null;
  const elapsed = runState.startedAt != null ? (runState.endedAt ?? now) - runState.startedAt : 0;
  const offline = server.state.kind === "ok" && !server.state.status.claude;
  // this run skips the Claude API: 免費研究 and the offline designer
  const freeRun = offline || !!lastRequest?.free;
  const research = runState.steps.research;
  const design = runState.steps.design;
  const showResearchStream = running || (phase === "error" && (research.text || research.status === "error"));
  const showDone = justFinished && plan != null && phase === "done";
  const needsLyrics = showSummary && (project.lyrics.lines.length === 0 || /粗略/.test(runState.steps.lyrics.message ?? ""));
  // 設計方向 (phase 4): the comparison spans the page once directions exist; before that a compact block in the main column
  const hasDirections = !!project.directions?.directions.length;
  const directions = !running ? (
    <DirectionsSection project={project} onProject={setProject} disabled={running} offline={offline} wide={hasDirections} />
  ) : null;

  return (
    <div className="min-h-dvh">
      {header(
        <>
          {observed && runState.startedAt != null && (
            <span className="mr-1 text-[13px] leading-5 text-label-2 tabular" title="這次處理的經過時間">
              {formatElapsed(elapsed)}
            </span>
          )}
          <Button href={lyricsHref} transitionTypes={PUSH} variant="gray" icon={PencilSimpleIcon}>
            編輯歌詞
          </Button>
          {!running && (
            <Button href={hasDirections ? `/p/${encodeURIComponent(id)}/proposal` : "#directions"} transitionTypes={hasDirections ? PUSH : undefined} variant="gray" icon={hasDirections ? FileTextIcon : SwatchesIcon}>
              {hasDirections ? "一頁提案" : "設計方向"}
            </Button>
          )}
          {plan && !running && (
            <Button href={exportHref} transitionTypes={PUSH} variant="gray" icon={ExportIcon}>
              匯出影片
            </Button>
          )}
          <Button href={consoleHref} transitionTypes={PUSH} variant={showDone ? "plain" : plan && !running && !error ? "filled" : "gray"} icon={MonitorPlayIcon} disabled={!plan}>
            進入控制台
          </Button>
        </>,
      )}

      <div className={cx(pageContainerClass, "grid items-start gap-x-10 gap-y-8 pt-6 pb-24 lg:grid-cols-[360px_minmax(0,1fr)]")}>
        {hasDirections && directions && <div className="min-w-0 lg:col-span-2">{directions}</div>}
        <aside className="min-w-0 space-y-8 lg:sticky lg:top-[68px]">
          <StepTimeline
            analysis={project.analysis}
            steps={stepStates}
            lyricsEmpty={project.lyrics.lines.length === 0}
            footer={running ? "可以離開這個頁面：處理會在背景繼續，回來時會自動接上進度。" : undefined}
          />

          {(plan || project.research) && <RedesignBox disabled={running} hasResearch={project.research != null} offline={offline} onRedesign={redesign} />}

          {!running && <ManualClaudeCard onOpen={() => setManualOpen(true)} connected={!offline && server.state.kind === "ok"} />}

          {runState.logs.length > 0 && <LogPanel logs={runState.logs} startedAt={runState.startedAt ?? 0} />}
        </aside>

        <main className="min-w-0 space-y-8">
          {error && (
            <Banner
              tone="error"
              title="處理失敗"
              animateIn
              description={
                <>
                  {error}
                  {plan && <span className="mt-1 block">目前的設計方案沒有變更，仍可進入控制台使用。</span>}
                </>
              }
              actions={
                <>
                  <Button variant="gray" onClick={rerunAll}>
                    全部重新執行
                  </Button>
                  <Button variant="filled" onClick={retry}>
                    重試
                  </Button>
                </>
              }
            />
          )}

          {showDone && (
            <Banner
              tone="success"
              title="設計完成"
              animateIn
              description={
                <>
                  {lastRequest?.instruction ? `已依指示「${lastRequest.instruction}」重新設計` : "主視覺與每一段的畫面都準備好了"}
                  {elapsed >= 1000 && `，用時 ${formatElapsed(elapsed)}`}。檢查段落安排，沒問題就進入控制台準備上台。
                </>
              }
              actions={
                <Button href={consoleHref} transitionTypes={PUSH} variant="filled" icon={MonitorPlayIcon}>
                  進入控制台
                </Button>
              }
            />
          )}

          {needsLyrics && (
            <Banner
              tone="info"
              icon={<PencilSimpleIcon size={20} className="text-label-2" />}
              title={project.lyrics.lines.length === 0 ? "這首歌還沒有歌詞" : "歌詞的時間是粗略分配的"}
              description={
                project.lyrics.lines.length === 0
                  ? "畫面會全程不顯示歌詞。到歌詞編輯器加入歌詞後，可以用新歌詞重新設計段落呈現。"
                  : "時間是依音訊能量估的。上台前建議到歌詞編輯器用對拍校正，歌詞才會準時出場。"
              }
              actions={
                <Button href={lyricsHref} transitionTypes={PUSH} variant="gray">
                  前往歌詞編輯器
                </Button>
              }
            />
          )}

          {showResearchStream && (
            <StreamPanel
              title="研究簡報"
              text={research.text}
              live={research.status === "running"}
              searches={runState.searches}
              badge={runState.searches.length > 0 ? `${runState.searches.length} 次搜尋` : undefined}
              placeholder={
                research.status === "pending"
                  ? "等歌詞處理完成後開始研究樂團與歌曲…"
                  : research.status === "running"
                    ? freeRun
                      ? "免費研究：查詢 MusicBrainz 與維基百科的公開資料，再分析歌詞的意象與情緒、音訊的速度與能量…"
                      : "設計師正在搜尋與閱讀資料：樂團的專輯視覺、MV、過去的舞台，以及這首歌的意象…"
                    : research.status === "kept"
                      ? "這次沿用先前的研究。"
                      : "沒有研究內容。"
              }
            />
          )}

          {runState.requested.includes("design") && (running || (phase === "error" && (design.text || design.status === "error"))) && (
            <StreamPanel
              title="設計進度"
              text={design.text}
              live={design.status === "running"}
              maxHeight="20rem"
              placeholder={
                design.status === "running"
                  ? freeRun
                    ? "離線設計師正在依免費研究的發現安排配色、場景與每一段的歌詞…"
                    : "設計師正在構思世界觀、色票與每一段的畫面…"
                  : "研究完成後開始設計主視覺與段落。"
              }
            />
          )}

          {!hasDirections && directions}

          {showSummary && <KeyVisualSummary key={`${project.updatedAt}-${plan.keyVisual.title}`} project={project} reveal={showDone} />}

          {!running && (
            <AssetLibrary
              projectId={project.id}
              assets={project.assets ?? []}
              onChange={(assets, nextPlan) => setProject((p) => (p ? { ...p, assets, ...(nextPlan !== undefined ? { plan: nextPlan } : {}) } : p))}
              onRedesign={plan ? () => redesign("", false) : undefined}
              redesignDisabled={running}
              alwaysOfferRedesign={!!plan && !plan.sections.some((s) => s.media)}
            />
          )}

          {!running && project.bandId && (
            <p className="-mt-3 flex flex-wrap items-center gap-x-1 px-4 text-[12px] leading-4 text-label-2">
              這首歌屬於樂團：設計會遵守樂團的視覺聖經
              {(project.bandAssets?.length ?? 0) > 0 ? `，也能使用樂團素材庫的 ${project.bandAssets!.length} 個素材` : ""}。
              <Button href={`/b/${encodeURIComponent(project.bandId)}`} transitionTypes={PUSH} variant="plain" size="sm" className="-ml-1.5">
                前往樂團
              </Button>
            </p>
          )}

          {!running && !plan && !error && (
            <EmptyState
              icon={SparkleIcon}
              title="還沒有設計方案"
              description="開始處理：取得歌詞、研究樂團與歌曲、設計主視覺與段落。"
              action={
                <Button variant="filled" size="lg" onClick={() => execute({ lyricsText: readLyricsHandoff(id) ?? undefined })}>
                  開始製作
                </Button>
              }
              className="rounded-lg bg-surface"
            />
          )}

          {project.research && !showResearchStream && <ResearchPanel research={project.research} defaultOpen={!plan} />}
        </main>
      </div>
      <ManualClaudeSheet
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        project={project}
        target="plan"
        onApplied={(p) => {
          setProject(p);
          setRunState(initialRunState());
          setJustFinished(false);
        }}
      />
    </div>
  );
}

/** 用 claude.ai 研究: the no-cost Claude path, next to 重新設計. */
function ManualClaudeCard({ onOpen, connected }: { onOpen: () => void; connected: boolean }) {
  return (
    <section aria-labelledby="manual-claude-title" className="min-w-0">
      <h2 id="manual-claude-title" className="mb-1.5 px-4 text-[13px] leading-5 text-label-2">
        用 claude.ai 研究
      </h2>
      <div className="rounded-lg bg-surface p-4">
        <p className="text-[13px] leading-5 text-label">
          {connected ? "想省下 API 費用時：" : "不需要 API 金鑰："}把 Livelyrics 整理好的提示詞貼到你自己的 claude.ai 對話，讓 Claude 上網研究樂團並設計，再把回覆貼回來套用。
        </p>
        <Button variant="gray" icon={SparkleIcon} onClick={onOpen} className="mt-3" data-testid="manual-open">
          用 claude.ai 研究
        </Button>
      </div>
    </section>
  );
}

function LogPanel({ logs, startedAt }: { logs: LogEntry[]; startedAt: number }) {
  const errors = logs.filter((l) => l.tone === "error").length;
  return (
    <section aria-label="處理紀錄" className="min-w-0 rounded-lg bg-surface">
      <Disclosure
        summaryClassName="min-h-11! rounded-lg px-4 font-normal! text-label-2! hover:bg-fill-4"
        summary={
          <span className="flex min-w-0 flex-1 items-center gap-2">
            處理紀錄（{logs.length}）{errors > 0 && <span className="text-red-text">{errors} 個錯誤</span>}
          </span>
        }
      >
        <ol className="max-h-72 space-y-1 overflow-y-auto px-4 pt-1 pb-3 text-[12px] leading-[18px]">
          {logs.map((l) => (
            <li key={l.id} className="flex min-w-0 gap-2">
              <span className="w-9 shrink-0 text-label-2 tabular">{formatElapsed(l.at - startedAt)}</span>
              {l.step && <span className="w-7 shrink-0 text-label-2">{STEP_NAME[l.step] ?? l.step}</span>}
              <span className={cx("min-w-0 flex-1 break-words", l.tone === "error" ? "text-red-text" : "text-label")}>{l.message}</span>
            </li>
          ))}
        </ol>
      </Disclosure>
    </section>
  );
}
