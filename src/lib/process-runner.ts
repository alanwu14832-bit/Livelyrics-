// Cloud mode: the browser drives the pipeline one step per request (each serverless request ends
// after at most 300 s and nothing is shared between requests). `runStepwise` sends lyrics,
// research and design as separate POST /process requests and forwards their events as one run, so
// the page reducers see the same stream as in local mode. The server records every step on the
// project (Project.pipeline): a page that opens while a step runs elsewhere (a refresh, another
// tab) watches it by polling the project, then continues with the remaining steps; a step that ran
// out of time comes back as an error with 重試. Pure apart from the injected I/O.

import type { ProcessRequest } from "./api-client";
import type { PipelineEvent, PipelineRecord, ProcessStepId, Project } from "./types";

/** The server answered 409: another request of this project is running a step. */
export class ProcessBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessBusyError";
  }
}

export interface RunnerDeps {
  /** one streamed POST /api/projects/<id>/process; resolves with the `done` project, rejects on `error` */
  stream(id: string, body: ProcessRequest, onEvent: (e: PipelineEvent) => void, signal?: AbortSignal): Promise<Project>;
  getProject(id: string): Promise<Project>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  newRunId(): string;
  /** how often a watched step is checked (default 3 s) */
  pollMs?: number;
}

const ALL: readonly ProcessStepId[] = ["lyrics", "research", "design", "scene"];

export function normalizeRunSteps(steps: readonly ProcessStepId[] | undefined): ProcessStepId[] {
  return steps && steps.length ? ALL.filter((s) => steps.includes(s)) : [...ALL];
}

/** Steps of a recorded run that have not finished yet (pipeline order). */
export function remainingSteps(record: Pick<PipelineRecord, "steps" | "results">): ProcessStepId[] {
  return record.steps.filter((s) => !record.results[s]);
}

/** Where a failed or interrupted recorded run should start again. */
export function retryFrom(record: Pick<PipelineRecord, "steps" | "results" | "failed" | "current">): ProcessStepId[] {
  const from = record.failed ?? record.current ?? remainingSteps(record)[0] ?? record.steps[0];
  const i = record.steps.indexOf(from);
  return i >= 0 ? record.steps.slice(i) : [...record.steps];
}

type Body = Pick<ProcessRequest, "lyricsText" | "instruction" | "arc" | "free">;

function stepEvent(step: ProcessStepId, result: PipelineRecord["results"][ProcessStepId]): PipelineEvent | null {
  if (!result) return null;
  return { type: "step", step, status: result.status, ...(result.message ? { message: result.message } : {}) };
}

function fail(onEvent: (e: PipelineEvent) => void, message: string): never {
  onEvent({ type: "error", message });
  throw new Error(message);
}

/** Run (or, with attachOnly, watch and continue) the pipeline one step per request. */
export async function runStepwise(
  id: string,
  body: ProcessRequest,
  onEvent: (e: PipelineEvent) => void,
  signal: AbortSignal | undefined,
  deps: RunnerDeps,
): Promise<Project> {
  if (body.attachOnly) return watchRun(id, onEvent, signal, deps, true);
  const steps = normalizeRunSteps(body.steps);
  return driveSteps(id, { id: deps.newRunId(), steps }, steps, body, onEvent, signal, deps);
}

async function driveSteps(
  id: string,
  run: { id: string; steps: ProcessStepId[] },
  todo: readonly ProcessStepId[],
  body: Body,
  onEvent: (e: PipelineEvent) => void,
  signal: AbortSignal | undefined,
  deps: RunnerDeps,
): Promise<Project> {
  let project: Project | null = null;
  for (const [i, step] of todo.entries()) {
    const last = i === todo.length - 1;
    const request: ProcessRequest = {
      steps: [step],
      run,
      ...(step === "lyrics" && body.lyricsText ? { lyricsText: body.lyricsText } : {}),
      ...(body.instruction ? { instruction: body.instruction } : {}),
      ...(body.arc ? { arc: body.arc } : {}),
      ...(body.free ? { free: true } : {}),
    };
    try {
      // every request ends with `done`; only the last one ends the run for the page
      project = await deps.stream(id, request, (e) => (e.type === "done" && !last ? undefined : onEvent(e)), signal);
    } catch (err) {
      if (!(err instanceof ProcessBusyError)) throw err;
      onEvent({ type: "log", step, message: err.message });
      return watchRun(id, onEvent, signal, deps, false);
    }
  }
  if (!project) throw new Error("處理中斷：伺服器沒有回傳結果");
  return project;
}

/**
 * Follow a run recorded on the project: report its finished steps, poll while a step runs in
 * another request, then drive the steps still to do. Nothing running: the stored outcome.
 */
async function watchRun(
  id: string,
  onEvent: (e: PipelineEvent) => void,
  signal: AbortSignal | undefined,
  deps: RunnerDeps,
  sameRequest: boolean,
): Promise<Project> {
  const pollMs = deps.pollMs ?? 3000;
  let project = await deps.getProject(id);
  let record = project.pipeline;
  if (project.status !== "processing" || !record || record.status !== "running") {
    if (project.status === "ready" && project.plan) {
      onEvent({ type: "done", project });
      return project;
    }
    return fail(onEvent, project.status === "error" ? project.error || "上次的處理沒有完成，請重新處理。" : "目前沒有進行中的處理。");
  }

  const runId = record.runId;
  onEvent({ type: "attached", steps: record.steps, sameRequest });
  for (const s of record.steps) {
    const e = stepEvent(s, record.results[s]);
    if (e) onEvent(e);
  }

  while (record.current) {
    const step: ProcessStepId = record.current;
    onEvent({ type: "step", step, status: "start" });
    onEvent({ type: "log", step, message: "已接上進行中的步驟，完成後會自動繼續。" });
    for (;;) {
      await deps.sleep(pollMs, signal);
      project = await deps.getProject(id);
      // failed, or its request ran out of time (the server reports a stale step as an error)
      if (project.status === "error") return fail(onEvent, project.error || "處理失敗");
      const now: PipelineRecord | undefined = project.pipeline;
      if (!now || now.runId !== runId) {
        if (project.status === "ready" && project.plan) {
          onEvent({ type: "done", project });
          return project;
        }
        // another run took over: follow that one instead
        return watchRun(id, onEvent, signal, deps, false);
      }
      record = now;
      if (record.current !== step) {
        const e = stepEvent(step, record.results[step]);
        if (e) onEvent(e);
        break;
      }
    }
  }

  if (project.status === "ready") {
    onEvent({ type: "done", project });
    return project;
  }
  const todo = remainingSteps(record);
  if (!todo.length) return fail(onEvent, "處理沒有正常結束，請重試。");
  // between steps: this page continues the run
  return driveSteps(id, { id: runId, steps: record.steps }, todo, { instruction: record.instruction, arc: record.arc, free: record.free }, onEvent, signal, deps);
}

/** Sleep that rejects with an AbortError when the signal fires. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("已取消", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("已取消", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
