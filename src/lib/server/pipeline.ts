// Processing pipeline: lyrics -> research -> design, with a per-project in-memory run
// registry. A request while a run is active attaches to it (past events are replayed,
// then live ones stream); runs keep going when every subscriber disconnects.

import { randomUUID } from "node:crypto";
import type { ProcessRequest } from "@/lib/api-client";
import { distributeLines, emptyLyrics, parseLyricsText } from "@/lib/lyrics/lrc";
import { remapPlanLines } from "@/lib/lyrics/remap";
import { DesignPlanSchema } from "@/lib/schema";
import * as designer from "@/lib/server/designer";
import type { DesignerCallbacks } from "@/lib/server/designer";
import type { Lyrics, PipelineEvent, PipelineStepId, Project } from "@/lib/types";
import { findBestLyrics } from "./lrclib";
import { getProject, updateProject } from "./storage";

export type PipelineStep = "lyrics" | "research" | "design";
export const ALL_STEPS: readonly PipelineStep[] = ["lyrics", "research", "design"];

const STEP_LABEL: Record<PipelineStep, string> = { lyrics: "歌詞", research: "研究", design: "設計" };

/** how long a finished run stays attachable / in memory */
const RETAIN_MS = 60_000;
/**
 * An identical request this soon after a run succeeded replays it instead of starting over
 * (React StrictMode double effects, a quick refresh). Failed runs are never replayed, so
 * "retry" always retries.
 */
const REPLAY_WINDOW_MS = 5_000;
/** safety net for a designer call that never settles */
const STEP_TIMEOUT_MS = 20 * 60_000;
const MAX_HISTORY = 4000;

export type RunStatus = "running" | "done" | "error";

export interface PipelineRun {
  readonly runId: string;
  readonly projectId: string;
  readonly request: ProcessRequest;
  readonly startedAt: number;
  finishedAt: number | null;
  status: RunStatus;
  /** resolves when the run has finished (never rejects) */
  readonly finished: Promise<void>;
}

interface RunInternal extends PipelineRun {
  key: string;
  history: PipelineEvent[];
  listeners: Set<(event: PipelineEvent) => void>;
  controller: AbortController;
  /** the project folder was deleted: do not write anything back */
  discarded: boolean;
  currentStep: PipelineStep | null;
  cleanup?: ReturnType<typeof setTimeout>;
  finished: Promise<void>;
}

export interface RunHandle {
  run: PipelineRun;
  /** true when this call attached to an existing run instead of starting one */
  attached: boolean;
  /**
   * Replays every past event synchronously, then delivers live events until the run ends.
   * Returns an unsubscribe function (the run keeps going).
   */
  subscribe(listener: (event: PipelineEvent) => void): () => void;
}

interface Registry {
  runs: Map<string, RunInternal>;
}

const g = globalThis as typeof globalThis & { __livelyricsPipeline?: Registry };
const registry: Registry = (g.__livelyricsPipeline ??= { runs: new Map() });

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

function requestKey(r: ProcessRequest): string {
  return JSON.stringify([normalizeSteps(r.steps), r.lyricsText ?? "", r.instruction ?? ""]);
}

export function normalizeSteps(steps: ProcessRequest["steps"]): PipelineStep[] {
  if (!steps || steps.length === 0) return [...ALL_STEPS];
  return ALL_STEPS.filter((s) => steps.includes(s));
}

function makeHandle(run: RunInternal, attached: boolean): RunHandle {
  return {
    run,
    attached,
    subscribe(listener) {
      for (const event of run.history) {
        try {
          listener(event);
        } catch {
          return () => {};
        }
      }
      if (run.status !== "running") return () => {};
      run.listeners.add(listener);
      return () => {
        run.listeners.delete(listener);
      };
    },
  };
}

/** The active (or recently finished) run for a project, if any. */
export function getRun(projectId: string): PipelineRun | undefined {
  return registry.runs.get(projectId);
}

export function isRunActive(projectId: string): boolean {
  return registry.runs.get(projectId)?.status === "running";
}

/**
 * Observe the project's run without ever starting one: the active run, or the last one
 * while it is still retained (about a minute after it finished). Null when there is none.
 */
export function attachToRun(projectId: string): RunHandle | null {
  const existing = registry.runs.get(projectId);
  return existing ? makeHandle(existing, true) : null;
}

/**
 * Start the pipeline for a project, or attach to the run already in progress.
 * Never throws: failures are reported as events.
 */
export function runPipeline(projectId: string, request: ProcessRequest): RunHandle {
  const key = requestKey(request);
  const existing = registry.runs.get(projectId);
  if (existing) {
    if (existing.status === "running") return makeHandle(existing, true);
    if (
      existing.status === "done" &&
      existing.key === key &&
      existing.finishedAt != null &&
      Date.now() - existing.finishedAt < REPLAY_WINDOW_MS
    ) {
      return makeHandle(existing, true);
    }
    if (existing.cleanup) clearTimeout(existing.cleanup);
    registry.runs.delete(projectId);
  }

  let resolveFinished!: () => void;
  const run: RunInternal = {
    runId: randomUUID(),
    projectId,
    request,
    startedAt: Date.now(),
    finishedAt: null,
    status: "running",
    key,
    history: [],
    listeners: new Set(),
    controller: new AbortController(),
    discarded: false,
    currentStep: null,
    finished: new Promise<void>((resolve) => (resolveFinished = resolve)),
  };
  registry.runs.set(projectId, run);

  // start on the next tick so the caller can subscribe first (history covers it anyway)
  setTimeout(() => {
    execute(run)
      .catch((err) => {
        console.error("[livelyrics] pipeline crashed:", err);
        finish(run, "error", { type: "error", message: `處理失敗：${describeError(err)}` });
      })
      .finally(() => resolveFinished());
  }, 0);

  return makeHandle(run, false);
}

/** Abort a run (e.g. the project is being deleted). */
export function cancelRun(projectId: string, opts: { discard?: boolean } = {}): void {
  const run = registry.runs.get(projectId);
  if (!run || run.status !== "running") return;
  if (opts.discard) run.discarded = true;
  run.controller.abort(new Error("處理已取消"));
}

/**
 * A project marked "processing" without a live run was interrupted (server restart / crash).
 * Report it as an error so the UI offers to retry instead of waiting forever.
 */
export function withLiveStatus<T extends { id: string; status: Project["status"]; error?: string }>(p: T): T {
  if (p.status !== "processing" || isRunActive(p.id)) return p;
  return { ...p, status: "error", error: p.error || "上次的處理沒有完成（伺服器可能重新啟動過），請重新處理。" };
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

function emit(run: RunInternal, event: PipelineEvent): void {
  if (run.status !== "running") return;
  const last = run.history[run.history.length - 1];
  if (event.type === "delta" && last?.type === "delta" && last.step === event.step) {
    // coalesce streamed text in the replay history
    run.history[run.history.length - 1] = { type: "delta", step: event.step, text: last.text + event.text };
  } else if (run.history.length < MAX_HISTORY || event.type === "step" || event.type === "done" || event.type === "error") {
    run.history.push(event);
  }
  for (const listener of [...run.listeners]) {
    try {
      listener(event);
    } catch {
      run.listeners.delete(listener);
    }
  }
}

function finish(run: RunInternal, status: "done" | "error", final: PipelineEvent): void {
  if (run.status !== "running") return;
  emit(run, final);
  run.status = status;
  run.finishedAt = Date.now();
  run.currentStep = null;
  run.listeners.clear();
  run.cleanup = setTimeout(() => {
    if (registry.runs.get(run.projectId) === run) registry.runs.delete(run.projectId);
  }, RETAIN_MS);
  run.cleanup.unref?.();
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

class StepFailure extends Error {
  constructor(
    readonly step: PipelineStep,
    message: string,
  ) {
    super(message);
  }
}

/** Resolve/reject with the promise, or reject as soon as the signal aborts. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("處理已取消"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const reason = signal.reason;
      reject(
        reason instanceof Error && reason.name === "TimeoutError"
          ? new Error("步驟逾時")
          : reason instanceof Error
            ? reason
            : new Error("處理已取消"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

async function execute(run: RunInternal): Promise<void> {
  const { projectId, request } = run;
  const steps = normalizeSteps(request.steps);
  const signal = run.controller.signal;

  try {
    const initial = await getProject(projectId);
    if (!initial) throw new Error("找不到專案（可能已被刪除）");
    let project = await updateProject(projectId, (p) => {
      p.status = "processing";
      delete p.error;
    });

    for (const step of steps) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("處理已取消");
      run.currentStep = step;
      emit(run, { type: "step", step, status: "start" });
      const stepSignal = AbortSignal.any([signal, AbortSignal.timeout(STEP_TIMEOUT_MS)]);
      try {
        const next = await runStep(run, step, project, stepSignal);
        project = next.project;
        emit(run, { type: "step", step, status: next.skipped ? "skipped" : "done", ...(next.message ? { message: next.message } : {}) });
      } catch (err) {
        const message = describeError(err);
        emit(run, { type: "step", step, status: "error", message });
        throw new StepFailure(step, message);
      }
    }

    project = await updateProject(projectId, (p) => {
      p.status = "ready";
      delete p.error;
    });
    finish(run, "done", { type: "done", project });
  } catch (err) {
    const message = err instanceof StepFailure ? `${STEP_LABEL[err.step]}步驟失敗：${err.message}` : describeError(err);
    if (!run.discarded) {
      try {
        await updateProject(projectId, (p) => {
          p.status = "error";
          p.error = message;
        });
      } catch {
        /* project gone or unwritable: the event below still reports the failure */
      }
    }
    finish(run, "error", { type: "error", message });
  }
}

interface StepResult {
  project: Project;
  skipped?: boolean;
  message?: string;
}

function designerCallbacks(run: RunInternal, step: PipelineStepId, signal: AbortSignal): DesignerCallbacks {
  // ignore late callbacks once the step is over
  const live = () => run.status === "running" && run.currentStep === step && !signal.aborted;
  return {
    signal,
    onLog: (message) => {
      if (live() && typeof message === "string") emit(run, { type: "log", step, message });
    },
    onDelta: (text) => {
      if (live() && typeof text === "string" && text) emit(run, { type: "delta", step, text });
    },
    onSearch: (query) => {
      if (live() && typeof query === "string" && query.trim()) emit(run, { type: "search", query: query.trim() });
    },
  };
}

async function runStep(run: RunInternal, step: PipelineStep, project: Project, signal: AbortSignal): Promise<StepResult> {
  switch (step) {
    case "lyrics":
      return lyricsStep(run, project, signal);
    case "research": {
      const research = await raceAbort(
        designer.researchSong({ meta: project.meta, lyrics: project.lyrics, analysis: project.analysis }, designerCallbacks(run, "research", signal)),
        signal,
      );
      if (!research || typeof research.brief !== "string") throw new Error("研究結果格式不正確");
      const saved = await updateProject(project.id, (p) => {
        p.research = research;
      });
      const via = research.engine === "claude" ? `Claude${research.model ? `（${research.model}）` : ""}` : "離線模式";
      const sources = Array.isArray(research.sources) ? research.sources.length : 0;
      return { project: saved, message: `研究完成：${via}${sources ? `，${sources} 個來源` : ""}` };
    }
    case "design": {
      const plan = await raceAbort(
        designer.designSong(
          {
            meta: project.meta,
            lyrics: project.lyrics,
            analysis: project.analysis,
            research: project.research,
            instruction: run.request.instruction,
            previous: project.plan,
          },
          designerCallbacks(run, "design", signal),
        ),
        signal,
      );
      const checked = DesignPlanSchema.safeParse(plan);
      if (!checked.success) throw new Error("設計方案格式不正確");
      const saved = await updateProject(project.id, (p) => {
        p.plan = checked.data;
      });
      return {
        project: saved,
        message: `主視覺「${checked.data.keyVisual.title}」，${checked.data.sections.length} 個段落、${checked.data.cues.length} 個操作提示`,
      };
    }
  }
}

async function lyricsStep(run: RunInternal, project: Project, signal: AbortSignal): Promise<StepResult> {
  const log = (message: string) => emit(run, { type: "log", step: "lyrics", message });
  const duration = project.meta.duration || project.analysis?.duration || 0;
  const roughTiming = (l: Lyrics) => distributeLines(l, project.analysis, duration);
  let lyrics: Lyrics | null = null;
  let message = "";

  const text = run.request.lyricsText?.trim();
  if (text) {
    const parsed = parseLyricsText(text, "user");
    if (parsed.lines.length === 0) {
      log("貼上的內容裡沒有可用的歌詞行，改為自動尋找歌詞。");
    } else if (parsed.synced) {
      lyrics = parsed;
      message = `使用貼上的同步歌詞（${parsed.lines.length} 行）`;
    } else {
      lyrics = roughTiming(parsed);
      message = `使用貼上的歌詞（${parsed.lines.length} 行）；沒有時間碼，已依音訊能量粗略分配，建議到歌詞編輯器校正`;
    }
  }

  if (!lyrics && project.lyrics.synced && project.lyrics.lines.length > 0) {
    return { project, skipped: true, message: `沿用現有的同步歌詞（${project.lyrics.lines.length} 行）` };
  }

  if (!lyrics) {
    const { title, artist, album } = project.meta;
    if (!title.trim()) {
      log("沒有歌名，略過 LRCLIB 歌詞搜尋。");
    } else {
      log(`在 LRCLIB 搜尋歌詞：「${title}」${artist ? ` — ${artist}` : ""}`);
      try {
        const best = await raceAbort(findBestLyrics({ title, artist, album, duration }, { signal, onLog: log }), signal);
        if (best?.kind === "synced") {
          lyrics = best.lyrics;
          message = `LRCLIB 同步歌詞：${best.result.trackName} — ${best.result.artistName}（${best.lyrics.lines.length} 行）`;
        } else if (best?.kind === "plain") {
          lyrics = roughTiming(best.lyrics);
          message = `LRCLIB 歌詞：${best.result.trackName} — ${best.result.artistName}（${best.lyrics.lines.length} 行，沒有可用的時間碼，已粗略分配，建議到歌詞編輯器校正）`;
        } else if (best?.kind === "instrumental") {
          lyrics = emptyLyrics("none");
          message = `LRCLIB 標示「${best.trackName}」為純音樂，這首歌以純視覺設計`;
        } else {
          log("LRCLIB 沒有找到這首歌的歌詞。");
        }
      } catch (err) {
        if (signal.aborted) throw err;
        log(`LRCLIB 搜尋失敗：${describeError(err)}`);
      }
    }
  }

  if (!lyrics && project.lyrics.lines.length > 0) {
    lyrics = roughTiming(project.lyrics);
    message = `沿用現有歌詞（${lyrics.lines.length} 行），已粗略分配時間`;
  }

  if (!lyrics) {
    lyrics = emptyLyrics("none");
    message = "沒有歌詞：這首歌會以純視覺設計，之後可以在歌詞編輯器貼上歌詞再重新設計";
  }

  const finalLyrics = lyrics;
  const saved = await updateProject(project.id, (p) => {
    if (p.plan) p.plan = remapPlanLines(p.plan, p.lyrics, finalLyrics);
    p.lyrics = finalLyrics;
  });
  return { project: saved, message };
}
