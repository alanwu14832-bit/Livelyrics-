"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { api, type ProcessRequest } from "@/lib/api-client";
import type { PipelineEvent, Project } from "@/lib/types";
import { AlertIcon, ArrowRightIcon, CheckIcon, ClockIcon, MonitorIcon, PenIcon, RefreshIcon, SparklesIcon } from "@/components/home/icons";
import { ServerStatusPill, useServerStatus } from "@/components/home/ServerStatus";
import { TopBar } from "@/components/home/TopBar";
import { clearLyricsHandoff, readLyricsHandoff } from "@/components/upload/handoff";
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

type LoadState = { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string; notFound: boolean };

const STATUS_BADGE: Record<Project["status"], { label: string; tone: "neutral" | "accent" | "ok" | "danger" }> = {
  new: { label: "尚未處理", tone: "neutral" },
  processing: { label: "處理中", tone: "accent" },
  ready: { label: "可上台", tone: "ok" },
  error: { label: "處理失敗", tone: "danger" },
};

const STEP_NAME: Record<string, string> = { lyrics: "歌詞", research: "研究", design: "設計", analyze: "分析", done: "完成" };

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Drop `steps` when it is the full pipeline (the server default). */
function cleanRequest(req: ProcessRequest): ProcessRequest {
  const out: ProcessRequest = {};
  const steps = req.steps ? PROCESS_STEPS.filter((s) => req.steps!.includes(s)) : [];
  if (steps.length && steps.length < PROCESS_STEPS.length) out.steps = steps;
  if (req.lyricsText?.trim() && (!out.steps || out.steps.includes("lyrics"))) out.lyricsText = req.lyricsText;
  if (req.instruction?.trim()) out.instruction = req.instruction.trim();
  return out;
}

export function ProcessClient({ id, run, steps, instruction }: { id: string; run: boolean; steps?: ProcessStep[]; instruction?: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [runState, setRunState] = useState<RunState>(initialRunState);
  const [lastRequest, setLastRequest] = useState<ProcessRequest | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const server = useServerStatus();

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

      api
        .process(
          id,
          request,
          (event) => {
            if (controller.signal.aborted) return;
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
          setJustFinished(true);
          clearLyricsHandoff(id);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          flush();
          const message = err instanceof Error ? err.message || "處理失敗" : String(err);
          setRunState((s) => failRun(s, message === "Failed to fetch" ? "連不上本機伺服器（處理可能仍在背景進行，重新整理頁面即可接上）" : message, Date.now()));
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
          if (run) window.history.replaceState(window.history.state, "", processHref(id));
          if (run || p.status === "new" || p.status === "processing") {
            const handoff = readLyricsHandoff(id);
            execute({ steps, lyricsText: handoff ?? undefined, instruction });
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
    if (runState.phase === "error" && lastRequest) {
      const requested = lastRequest.steps ?? [...PROCESS_STEPS];
      const from = failedStep(runState) ?? runningStep(runState) ?? requested[0] ?? "lyrics";
      execute({ steps: stepsFrom(requested, from), lyricsText: lastRequest.lyricsText, instruction: lastRequest.instruction });
      return;
    }
    if (!project) return;
    if (project.research && !project.plan) execute({ steps: ["design"] });
    else execute({ lyricsText: readLyricsHandoff(id) ?? undefined });
  };
  const rerunAll = () => execute({ lyricsText: lastRequest?.lyricsText ?? readLyricsHandoff(id) ?? undefined });
  const redesign = (text: string, withResearch: boolean) => execute({ steps: withResearch ? ["research", "design"] : ["design"], instruction: text || undefined });

  // ---------------------------------------------------------------------------

  if (load.kind === "loading") {
    return (
      <div className="min-h-screen">
        <TopBar crumbs={[{ label: "作品庫", href: "/" }]} title="載入中…" />
        <div className="mx-auto grid max-w-[1400px] gap-6 p-6 lg:grid-cols-[340px_minmax(0,1fr)]" aria-busy="true">
          <div className="h-80 animate-pulse rounded-xl border border-line bg-panel" />
          <div className="h-[32rem] animate-pulse rounded-xl border border-line bg-panel" />
        </div>
      </div>
    );
  }

  if (load.kind === "error" || !project) {
    const notFound = load.kind === "error" && load.notFound;
    return (
      <div className="min-h-screen">
        <TopBar crumbs={[{ label: "作品庫", href: "/" }]} title={notFound ? "找不到作品" : "無法載入"} />
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-panel p-6 text-center">
          <AlertIcon size={28} className="mx-auto text-danger" />
          <p className="mt-3 text-base font-semibold text-fg">{notFound ? "找不到這個作品" : "無法載入這個作品"}</p>
          <p className="mt-1 text-sm text-muted">{notFound ? "它可能已經被刪除了。" : load.kind === "error" ? load.message : ""}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/" className="inline-flex h-9 items-center rounded-md border border-line bg-panel-3 px-3.5 text-sm text-fg hover:bg-line">
              回作品庫
            </Link>
            {!notFound && (
              <Button variant="primary" onClick={() => window.location.reload()}>
                重新載入
              </Button>
            )}
          </div>
        </div>
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
  const status = running ? STATUS_BADGE.processing : STATUS_BADGE[project.status] ?? STATUS_BADGE.new;
  const offline = server.state.kind === "ok" && !server.state.status.claude;
  const research = runState.steps.research;
  const design = runState.steps.design;
  const showResearchStream = running || (phase === "error" && (research.text || research.status === "error"));
  const consoleHref = `/p/${encodeURIComponent(id)}`;
  const lyricsHref = `/p/${encodeURIComponent(id)}/lyrics`;

  return (
    <div className="min-h-screen">
      <TopBar
        crumbs={[{ label: "作品庫", href: "/" }, { label: "設計總覽" }]}
        title={project.meta.title}
        subtitle={project.meta.artist}
        status={
          <Badge tone={status.tone} className={cx("ml-1", running && "animate-pulse")}>
            {status.label}
          </Badge>
        }
        actions={
          <>
            {observed && runState.startedAt != null && (
              <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-xs text-muted tabular" title="這次處理的經過時間">
                <ClockIcon size={13} />
                {formatElapsed(elapsed)}
              </span>
            )}
            <ServerStatusPill state={server.state} onRetry={server.reload} />
            <Link href={lyricsHref} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-panel-3 px-3 text-sm text-fg hover:bg-line">
              <PenIcon size={14} />
              編輯歌詞
            </Link>
            <Link
              href={consoleHref}
              aria-disabled={!plan}
              className={cx(
                "inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-sm font-semibold transition",
                plan ? "bg-accent text-white hover:brightness-110" : "border border-line bg-panel-3 text-muted hover:text-fg",
              )}
            >
              <MonitorIcon size={15} />
              進入控制台
            </Link>
          </>
        }
      />

      <div className="mx-auto grid max-w-[1400px] items-start gap-6 p-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-20">
          <section aria-label="處理進度" className="rounded-xl border border-line bg-panel p-4">
            <StepTimeline analysis={project.analysis} steps={stepStates} searches={runState.searches} lyricsEmpty={project.lyrics.lines.length === 0} />
            {running && <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-faint">可以離開這個頁面：處理會在背景繼續，回來時會自動接上進度。</p>}
          </section>

          {error && (
            <section role="alert" className="space-y-3 rounded-xl border border-danger/35 bg-danger/[0.06] p-4">
              <p className="flex items-start gap-2 text-sm text-fg">
                <AlertIcon size={16} className="mt-0.5 shrink-0 text-danger" />
                <span>
                  <span className="font-medium text-danger">處理失敗</span>
                  <span className="mt-0.5 block text-muted">{error}</span>
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" onClick={retry}>
                  <RefreshIcon size={14} />
                  重試
                </Button>
                <Button size="sm" onClick={rerunAll}>
                  全部重新執行
                </Button>
              </div>
            </section>
          )}

          {!running && (plan || project.research) && (
            <RedesignBox hasResearch={project.research != null} offline={offline} onRedesign={redesign} />
          )}

          {runState.logs.length > 0 && <LogPanel logs={runState.logs} startedAt={runState.startedAt ?? 0} />}
        </aside>

        <main className="min-w-0 space-y-6">
          {justFinished && plan && phase === "done" && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ok/30 bg-ok/[0.07] px-4 py-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-ok/20 text-ok">
                <CheckIcon size={16} />
              </span>
              <p className="flex-1 text-sm text-fg">
                設計完成{elapsed > 0 && <span className="text-muted">（用時 {formatElapsed(elapsed)}）</span>}。檢查主視覺與段落安排，沒問題就進入控制台準備上台。
              </p>
              <Link href={consoleHref} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-semibold text-white hover:brightness-110">
                進入控制台
                <ArrowRightIcon size={14} />
              </Link>
            </div>
          )}

          {showResearchStream && (
            <StreamPanel
              title="研究簡報"
              text={research.text}
              live={research.status === "running"}
              badge={runState.searches.length > 0 ? <span className="text-xs text-faint">{runState.searches.length} 次搜尋</span> : undefined}
              placeholder={
                research.status === "pending"
                  ? "等歌詞處理完成後開始研究樂團與歌曲…"
                  : research.status === "running"
                    ? "設計師正在搜尋與閱讀資料：樂團的專輯視覺、MV、過去的舞台，以及這首歌的意象…"
                    : research.status === "kept"
                      ? "這次沿用先前的研究。"
                      : "沒有研究內容。"
              }
            />
          )}

          {(running || phase === "error") && runState.requested.includes("design") && (
            <StreamPanel
              title="設計進度"
              text={design.text}
              live={design.status === "running"}
              maxHeight="20rem"
              placeholder={design.status === "running" ? "設計師正在構思世界觀、色票與每一段的畫面…" : "研究完成後開始設計主視覺與段落。"}
            />
          )}

          {showSummary && <KeyVisualSummary key={`${project.updatedAt}-${plan.keyVisual.title}`} project={project} />}

          {!running && !plan && !error && (
            <div className="rounded-xl border border-dashed border-line bg-panel/50 p-8 text-center">
              <SparklesIcon size={28} className="mx-auto text-accent" />
              <p className="mt-3 text-base font-semibold text-fg">還沒有設計方案</p>
              <p className="mt-1 text-sm text-muted">開始處理：取得歌詞、研究樂團與歌曲、設計主視覺與段落。</p>
              <Button variant="primary" className="mt-4" onClick={() => execute({ lyricsText: readLyricsHandoff(id) ?? undefined })}>
                開始製作
              </Button>
            </div>
          )}

          {project.research && !showResearchStream && <ResearchPanel research={project.research} defaultOpen={!plan} />}
        </main>
      </div>
    </div>
  );
}

function LogPanel({ logs, startedAt }: { logs: LogEntry[]; startedAt: number }) {
  const errors = logs.filter((l) => l.tone === "error").length;
  return (
    <details className="group rounded-xl border border-line bg-panel">
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-2.5 text-xs font-medium text-muted hover:text-fg">
        <span>
          處理紀錄（{logs.length}）{errors > 0 && <span className="ml-1 text-danger">{errors} 個錯誤</span>}
        </span>
        <span aria-hidden="true" className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ol className="max-h-72 space-y-1 overflow-y-auto border-t border-line px-4 py-2 text-[11px] leading-5">
        {logs.map((l) => (
          <li key={l.id} className="flex gap-2">
            <span className="w-9 shrink-0 font-mono text-faint tabular">{formatElapsed(l.at - startedAt)}</span>
            {l.step && <span className="w-7 shrink-0 text-faint">{STEP_NAME[l.step] ?? l.step}</span>}
            <span className={cx("min-w-0 flex-1 break-words", l.tone === "error" ? "text-danger" : l.tone === "success" ? "text-ok/90" : "text-muted")}>{l.message}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
