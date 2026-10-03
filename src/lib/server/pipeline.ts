// Processing pipeline: lyrics -> research -> design -> scene, saving the project after each step.
// The scene step (phase 7) writes the song's own scene program (專屬畫面) with its own budget, so the
// design step stays inside its 300 s in cloud mode.
//
// Local mode: a per-project in-memory run registry. A request while a run is active attaches to
// it (past events are replayed, then live ones stream); runs keep going when every subscriber
// disconnects.
//
// Cloud mode (serverless: no memory shared between requests, each request ends after at most
// 300 s): the page drives the run one step per request (ProcessRequest.run, see
// src/lib/process-runner.ts). A request first claims the project (a version-checked write of
// Project.pipeline that also refuses a second run while one is fresh), then runs its step inline
// while streaming the same events, and records the result and the step status on the project, so
// a refreshed page can show the running step and continue from the next one. Claude gets a budget
// inside the limit (then 免費研究 / the offline designer take over) and a step has a hard stop before it.
//
// Without an API key (or with ProcessRequest.free) the research step is 免費研究: public facts from
// MusicBrainz and Wikipedia (cached on Project.research.publicInfo and reused by later runs) plus
// the local lyric and audio analysis; the design step's offline designer follows those findings.

import { randomUUID } from "node:crypto";
import type { ProcessRequest } from "@/lib/api-client";
import { distributeLines, emptyLyrics, parseLyricsText } from "@/lib/lyrics/lrc";
import { remapPlanLines } from "@/lib/lyrics/remap";
import { DesignPlanSchema } from "@/lib/schema";
import * as designer from "@/lib/server/designer";
import type { DesignerCallbacks, DesignerDeps } from "@/lib/server/designer";
import { stageAssets } from "@/lib/asset-scope";
import type { Asset, BandBible, Lyrics, MoodImage, PipelineEvent, PipelineRecord, PipelineStepId, Project, Research } from "@/lib/types";
import { mergedMoodboard } from "@/lib/moodboard";
import { researchEngineLabel } from "@/lib/research-labels";
import { loadVisionImages } from "./directions";
import { getBand, withBandAssets } from "./band-storage";
import { HttpError } from "./http";
import { findBestLyrics } from "./lrclib";
import { getProject, listKeyVisualTitles, updateProject } from "./storage";
import { collectForProject } from "./collect-visuals";
import { findReleaseGroup, VISUALS_BUDGET_MS, visualsConfig } from "./research/visuals";
import { collectedSummary } from "@/lib/visuals";
import { isCloudStorage } from "./store";

export type PipelineStep = "lyrics" | "research" | "design" | "scene";
export const ALL_STEPS: readonly PipelineStep[] = ["lyrics", "research", "design", "scene"];

const STEP_LABEL: Record<PipelineStep, string> = { lyrics: "歌詞", research: "研究", design: "設計", scene: "畫面" };

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

/** Cloud: the hard stop of one step, before the platform ends the function at 300 s. */
export const CLOUD_STEP_TIMEOUT_MS = 285_000;
/** Cloud: Claude's budget per step; after it the offline designer takes over and the step still saves. */
export const CLOUD_DESIGNER_BUDGET_MS = 250_000;
/** Cloud: a "processing" project not written for this long lost its request (300 s limit + margin). */
export const CLOUD_STALE_MS = 330_000;

export const CLOUD_STALE_ERROR = "上次的處理沒有完成（雲端每個步驟最多 300 秒，可能逾時或中斷了），請重試。";

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

/** A cloud step request after its claim (see claimCloudRun). */
export interface CloudClaim {
  runId: string;
  /** every step of the client-driven run */
  steps: PipelineStep[];
  /** this request ends the run (its last step is the run's last) */
  last: boolean;
  /** the project after the claim */
  project: Project;
  /** what the run was asked to do (this request's, else the recorded run's) */
  instruction?: string;
  arc?: ProcessRequest["arc"];
  /** the run does not call the Claude API (免費研究 + the offline designer) */
  free?: boolean;
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
  /** in the registry (local mode); cloud runs live only for their request */
  registered: boolean;
  cloud: CloudClaim | null;
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
  return JSON.stringify([normalizeSteps(r.steps), r.lyricsText ?? "", r.instruction ?? "", r.arc ?? null, Boolean(r.free)]);
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

function newRun(projectId: string, request: ProcessRequest, opts: { registered: boolean; cloud: CloudClaim | null }): { run: RunInternal; resolve: () => void } {
  let resolveFinished!: () => void;
  const run: RunInternal = {
    runId: opts.cloud?.runId ?? randomUUID(),
    projectId,
    request,
    startedAt: Date.now(),
    finishedAt: null,
    status: "running",
    key: requestKey(request),
    history: [],
    listeners: new Set(),
    controller: new AbortController(),
    discarded: false,
    currentStep: null,
    finished: new Promise<void>((resolve) => (resolveFinished = resolve)),
    registered: opts.registered,
    cloud: opts.cloud,
  };
  return { run, resolve: resolveFinished };
}

function start(run: RunInternal, resolveFinished: () => void): void {
  // start on the next tick so the caller can subscribe first (history covers it anyway)
  setTimeout(() => {
    execute(run)
      .catch((err) => {
        console.error("[livelyrics] pipeline crashed:", err);
        finish(run, "error", { type: "error", message: `處理失敗：${describeError(err)}` });
      })
      .finally(() => resolveFinished());
  }, 0);
}

/**
 * Start the pipeline for a project, or attach to the run already in progress (local mode).
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

  const { run, resolve } = newRun(projectId, request, { registered: true, cloud: null });
  registry.runs.set(projectId, run);
  start(run, resolve);
  return makeHandle(run, false);
}

/** Abort a run (e.g. the project is being deleted). */
export function cancelRun(projectId: string, opts: { discard?: boolean } = {}): void {
  const run = registry.runs.get(projectId);
  if (!run || run.status !== "running") return;
  if (opts.discard) run.discarded = true;
  run.controller.abort(new Error("處理已取消"));
}

/** Cloud: a "processing" project whose last write is older than CLOUD_STALE_MS lost its request. */
export function isStaleProcessing(updatedAt: string | undefined, now = Date.now()): boolean {
  const t = Date.parse(updatedAt ?? "");
  return !Number.isFinite(t) || now - t >= CLOUD_STALE_MS;
}

/**
 * A project marked "processing" without a live run was interrupted (local: server restart /
 * crash; cloud: its request ran out of time or died). Report it as an error so the UI offers to
 * retry instead of waiting forever.
 */
export function withLiveStatus<T extends { id: string; status: Project["status"]; error?: string; updatedAt?: string }>(p: T): T {
  if (p.status !== "processing") return p;
  if (isCloudStorage()) {
    if (!isStaleProcessing(p.updatedAt)) return p;
    return { ...p, status: "error", error: p.error || CLOUD_STALE_ERROR };
  }
  if (isRunActive(p.id)) return p;
  return { ...p, status: "error", error: p.error || "上次的處理沒有完成（伺服器可能重新啟動過），請重新處理。" };
}

// ---------------------------------------------------------------------------
// cloud: one step per request
// ---------------------------------------------------------------------------

/** 409: another run of this project is in progress (the client then watches it). */
export class PipelineBusyError extends HttpError {
  constructor(message: string) {
    super(409, message);
    this.name = "PipelineBusyError";
  }
}

function busyMessage(record: PipelineRecord): string {
  const step = record.current ? `（${STEP_LABEL[record.current]}）` : "";
  return `這首歌已經有一個處理正在進行${step}，已接上它的進度；這次的設定不會套用，完成後可以再執行一次。`;
}

/**
 * Cloud: claim the project for this request's steps. Marks it processing with the run record (the
 * first step running), or throws PipelineBusyError while a fresh step of this run, or any fresh
 * other run, is recorded. The check and the write are one atomic update.
 */
export async function claimCloudRun(projectId: string, request: ProcessRequest, now = Date.now()): Promise<CloudClaim> {
  const steps = normalizeSteps(request.steps);
  const all = request.run ? normalizeSteps(request.run.steps) : steps;
  if (steps.some((s) => !all.includes(s))) throw new HttpError(400, "處理參數錯誤：步驟不屬於這次處理");
  const runId = request.run?.id ?? randomUUID();
  const at = new Date(now).toISOString();
  let instruction: string | undefined;
  let arc: ProcessRequest["arc"];
  let free = false;
  const project = await updateProject(projectId, (p) => {
    const record = p.pipeline;
    const fresh = p.status === "processing" && record?.status === "running" && !isStaleProcessing(p.updatedAt, now);
    if (fresh && record && (record.current !== null || record.runId !== runId)) throw new PipelineBusyError(busyMessage(record));
    const same = record?.runId === runId ? record : undefined;
    instruction = request.instruction ?? same?.instruction;
    arc = request.arc ?? same?.arc;
    free = Boolean(request.free || same?.free);
    p.status = "processing";
    delete p.error;
    p.pipeline = {
      runId,
      steps: all,
      status: "running",
      current: steps[0],
      startedAt: same?.startedAt || at,
      updatedAt: at,
      results: same?.results ?? {},
      ...(instruction ? { instruction } : {}),
      ...(arc ? { arc } : {}),
      ...(free ? { free: true } : {}),
    };
  });
  return {
    runId,
    steps: all,
    last: steps[steps.length - 1] === all[all.length - 1],
    project,
    ...(instruction ? { instruction } : {}),
    ...(arc ? { arc } : {}),
    ...(free ? { free: true } : {}),
  };
}

/**
 * Cloud: run the claimed steps inline for this request (not in the registry: no other request
 * can attach to it). Never throws: failures are reported as events and recorded on the project.
 */
export function runCloudSteps(projectId: string, request: ProcessRequest, claim: CloudClaim): RunHandle {
  const { run, resolve } = newRun(projectId, request, { registered: false, cloud: claim });
  start(run, resolve);
  return makeHandle(run, false);
}

function recordStepStart(p: Project, runId: string, step: PipelineStep): void {
  if (p.pipeline?.runId !== runId) return;
  p.pipeline = { ...p.pipeline, current: step, updatedAt: new Date().toISOString() };
}

function recordStepResult(p: Project, runId: string, step: PipelineStep, status: "done" | "skipped", message?: string): void {
  if (p.pipeline?.runId !== runId) return;
  const at = new Date().toISOString();
  p.pipeline = {
    ...p.pipeline,
    current: null,
    updatedAt: at,
    results: { ...p.pipeline.results, [step]: { status, at, ...(message ? { message } : {}) } },
  };
}

function recordRunEnd(p: Project, runId: string, failure?: { step: PipelineStep | null; message: string }): void {
  if (p.pipeline?.runId !== runId) return;
  const record: PipelineRecord = { ...p.pipeline, current: null, updatedAt: new Date().toISOString(), status: failure ? "error" : "done" };
  delete record.failed;
  delete record.error;
  if (failure) {
    if (failure.step) record.failed = failure.step;
    record.error = failure.message;
  }
  p.pipeline = record;
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
  if (!run.registered) return;
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
  const { projectId, request, cloud } = run;
  const steps = normalizeSteps(request.steps);
  const signal = run.controller.signal;
  let failedAt: PipelineStep | null = null;

  try {
    let project: Project;
    if (cloud) {
      // the claim already marked the project processing with this run's record
      project = cloud.project;
    } else {
      const initial = await getProject(projectId);
      if (!initial) throw new Error("找不到專案（可能已被刪除）");
      project = await updateProject(projectId, (p) => {
        p.status = "processing";
        delete p.error;
      });
    }

    for (const [i, step] of steps.entries()) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("處理已取消");
      run.currentStep = step;
      failedAt = step;
      if (cloud && i > 0) project = await updateProject(projectId, (p) => recordStepStart(p, cloud.runId, step));
      emit(run, { type: "step", step, status: "start" });
      const stepSignal = AbortSignal.any([signal, AbortSignal.timeout(cloud ? CLOUD_STEP_TIMEOUT_MS : STEP_TIMEOUT_MS)]);
      try {
        const result = await runStep(run, step, project, stepSignal);
        const status = result.skipped ? "skipped" : "done";
        if (result.apply || cloud) {
          project = await updateProject(projectId, (p) => {
            result.apply?.(p);
            if (cloud) recordStepResult(p, cloud.runId, step, status, result.message);
          });
        }
        emit(run, { type: "step", step, status, ...(result.message ? { message: result.message } : {}) });
      } catch (err) {
        const message = describeError(err);
        emit(run, { type: "step", step, status: "error", message });
        throw new StepFailure(step, message);
      }
    }
    failedAt = null;

    // a cloud request that is not the run's last leaves the project processing for the next one
    if (!cloud || cloud.last) {
      project = await updateProject(projectId, (p) => {
        p.status = "ready";
        delete p.error;
        if (cloud) recordRunEnd(p, cloud.runId);
      });
    }
    finish(run, "done", { type: "done", project: await withBandAssets(project).catch(() => project) });
  } catch (err) {
    const message = err instanceof StepFailure ? `${STEP_LABEL[err.step]}步驟失敗：${err.message}` : describeError(err);
    if (!run.discarded) {
      try {
        await updateProject(projectId, (p) => {
          p.status = "error";
          p.error = message;
          if (cloud) recordRunEnd(p, cloud.runId, { step: err instanceof StepFailure ? err.step : failedAt, message });
        });
      } catch {
        /* project gone or unwritable: the event below still reports the failure */
      }
    }
    finish(run, "error", { type: "error", message });
  }
}

interface StepResult {
  /** the step's result, applied to the stored project in one write */
  apply?: (p: Project) => void;
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

/** This run skips the Claude API (ProcessRequest.free; a cloud step keeps its recorded run's choice). */
function isFreeRun(run: RunInternal): boolean {
  return Boolean(run.cloud ? run.cloud.free : run.request.free);
}

/** Cloud: Claude has a budget inside the request's time limit. A free run never calls Claude. */
function designerDeps(run: RunInternal): DesignerDeps | undefined {
  const free = isFreeRun(run);
  if (!run.cloud && !free) return undefined;
  return { ...(run.cloud ? { timeoutMs: CLOUD_DESIGNER_BUDGET_MS } : {}), ...(free ? { configured: false } : {}) };
}

async function runStep(run: RunInternal, step: PipelineStep, project: Project, signal: AbortSignal): Promise<StepResult> {
  switch (step) {
    case "lyrics":
      return lyricsStep(run, project, signal);
    case "research": {
      const band = await bandContext(project);
      // the public facts a previous 免費研究 found are reused while they are fresh (no new lookups)
      const input = { meta: project.meta, lyrics: project.lyrics, analysis: project.analysis, ...band, publicInfo: project.research?.publicInfo ?? null };
      const cb = designerCallbacks(run, "research", signal);
      const deps = designerDeps(run);
      const startedAt = Date.now();
      // phase 8: Claude's research has no MusicBrainz lookup of its own; find the album for its cover meanwhile
      const claudeRun = designer.isClaudeConfigured() && !isFreeRun(run) && visualsConfig().enabled;
      const releaseGroup = claudeRun ? findReleaseGroup(project.meta, project.research?.publicInfo?.musicbrainz?.recording, { signal }).catch(() => null) : null;
      const research = await raceAbort(deps ? designer.researchSong(input, cb, deps) : designer.researchSong(input, cb), signal);
      if (!research || typeof research.brief !== "string") throw new Error("研究結果格式不正確");
      const via = researchEngineLabel(research);
      const sources = Array.isArray(research.sources) ? research.sources.length : 0;
      const found = await collectStep(run, project, research, releaseGroup, signal, startedAt);
      return {
        apply: (p) => {
          p.research = research;
        },
        message: `研究完成：${via}${sources ? `，${sources} 個來源` : ""}${found ? `；${found}` : ""}`,
      };
    }
    case "design": {
      const band = await bandContext(project);
      // the mood board (phase 4): the band's, then the song's; Claude also gets the images themselves
      const moodboard = mergedMoodboard({ moodboard: project.moodboard, bandMoodboard: band.bandMoodboard });
      let moodboardImages: designer.VisionImage[] | undefined;
      // phase 8: the research's collected material (the band's real cover, MV stills, key visual)
      const collected = project.collected ?? [];
      let collectedImages: designer.VisionImage[] | undefined;
      if (designer.isClaudeConfigured() && !isFreeRun(run)) {
        if (moodboard.length) {
          const loaded = await loadVisionImages(project, moodboard, { signal });
          moodboardImages = loaded.images;
          if (loaded.skipped.length) emit(run, { type: "log", step: "design", message: `有 ${loaded.skipped.length} 張參考圖無法附給 Claude，只提供說明與色票。` });
        }
        if (collected.length) collectedImages = (await loadVisionImages(project, collected, { signal, budgetUsed: moodboardImages })).images;
      }
      if (collected.length) emit(run, { type: "log", step: "design", message: `設計參考研究找到的素材：${collectedSummary(collected)?.replace(/^找到/, "") ?? ""}${collected.some((c) => c.use === "stage") ? `（${collected.filter((c) => c.use === "stage").length} 張可以上台）` : "（都只當參考）"}` });
      const input = {
        moodboard,
        moodboardImages,
        collected,
        collectedImages,
        meta: project.meta,
        lyrics: project.lyrics,
        analysis: project.analysis,
        // the song's own material and the band's shared library
        assets: stageAssets({ assets: project.assets ?? [], bandAssets: band.bandAssets, collected: project.collected }),
        bible: band.bible,
        bandName: band.bandName,
        research: project.research,
        // 免費研究's public facts drive the offline designer (genre grammar, the findings notes)
        publicInfo: project.research?.publicInfo ?? null,
        // a cloud step of a recorded run keeps the run's instruction and arc
        instruction: run.cloud ? run.cloud.instruction : run.request.instruction,
        previous: project.plan,
        arc: (run.cloud ? run.cloud.arc : run.request.arc) ?? null,
        // the library's other key-visual titles: a new design gets a title of its own
        takenTitles: await listKeyVisualTitles(project.id).catch(() => []),
      };
      const live = designerCallbacks(run, "design", signal);
      // designSong's success log names Claude's model; every other path is the offline designer
      let claudeModel: string | null = null;
      const cb: DesignerCallbacks = {
        ...live,
        onLog: (message) => {
          const hit = typeof message === "string" ? /^設計完成（([^）]+)）/.exec(message) : null;
          if (hit) claudeModel = hit[1];
          live.onLog?.(message);
        },
      };
      const deps = designerDeps(run);
      const plan = await raceAbort(deps ? designer.designSong(input, cb, deps) : designer.designSong(input, cb), signal);
      const checked = DesignPlanSchema.safeParse(plan);
      if (!checked.success) throw new Error("設計方案格式不正確");
      const madeBy: string | null = claudeModel;
      return {
        apply: (p) => {
          p.plan = checked.data;
          // who made it: Claude, or the offline designer (following 免費研究's findings when there are some)
          const at = new Date().toISOString();
          p.planSource = madeBy ? { engine: "claude", model: madeBy, at } : { engine: p.research?.engine === "free" ? "free" : "offline", at };
        },
        message: `主視覺「${checked.data.keyVisual.title}」，${checked.data.sections.length} 個段落、${checked.data.cues.length} 個操作提示`,
      };
    }
    case "scene":
      return sceneStep(run, project, signal);
  }
}

/**
 * 專屬畫面: the song's own scene program for the current plan. Claude writes it when configured (its
 * own step and budget); without Claude the design step already composed one offline, so a run that
 * designed skips this step, and a run of only this step (「重新產生畫面」) draws another composition.
 */
async function sceneStep(run: RunInternal, project: Project, signal: AbortSignal): Promise<StepResult> {
  const plan = project.plan;
  if (!plan) return { skipped: true, message: "還沒有設計方案，略過專屬畫面" };
  const free = isFreeRun(run);
  const claude = designer.isClaudeConfigured() && !free;
  const steps = run.cloud ? run.cloud.steps : normalizeSteps(run.request.steps);
  const instruction = (run.cloud ? run.cloud.instruction : run.request.instruction)?.trim() || undefined;
  const designed = steps.includes("design");
  if (!claude && designed && plan.sceneProgram) {
    return { skipped: true, message: `沿用設計步驟的專屬畫面「${plan.sceneProgram.title}」（離線作曲器）` };
  }
  const band = await bandContext(project);
  const moodboard = mergedMoodboard({ moodboard: project.moodboard, bandMoodboard: band.bandMoodboard });
  // phase 8: Claude sees the band's real material (and the mood board) while it writes the program
  const collected = project.collected ?? [];
  let moodboardImages: designer.VisionImage[] | undefined;
  let collectedImages: designer.VisionImage[] | undefined;
  if (claude) {
    if (moodboard.length) moodboardImages = (await loadVisionImages(project, moodboard, { signal })).images;
    if (collected.length) collectedImages = (await loadVisionImages(project, collected, { signal, budgetUsed: moodboardImages })).images;
  }
  const req = {
    meta: project.meta,
    lyrics: project.lyrics,
    analysis: project.analysis,
    bible: band.bible,
    bandName: band.bandName,
    moodboard,
    moodboardImages,
    collected,
    collectedImages,
    research: project.research,
    publicInfo: project.research?.publicInfo ?? null,
    instruction,
    previous: plan,
    arc: (run.cloud ? run.cloud.arc : run.request.arc) ?? null,
  };
  const cb = designerCallbacks(run, "scene", signal);
  const deps = designerDeps(run) ?? {};
  // without Claude: another draw of the composer (a regenerate), or the first one for an older plan
  const salt = plan.sceneProgram ? designer.composerSalt(plan.sceneProgram) + 1 : 0;
  const result = await raceAbort(designer.designSceneProgram(req, plan, cb, deps, { salt }), signal);
  const program = result.program;
  return {
    apply: (p) => {
      if (p.plan) p.plan = { ...p.plan, sceneProgram: program };
    },
    message: `專屬畫面「${program.title}」（${result.engine === "claude" ? `Claude${result.model ? `，${result.model}` : ""}` : "離線作曲器"}）`,
  };
}

/**
 * 研究找到的素材 (phase 8): download the band's real material the research pointed at (the Cover Art
 * Archive front of the song's album, Claude's list) and merge it into the project's collection.
 * Bounded by the research step's time (cloud: well inside the request's 300 s); a failure is logged,
 * never a failed research. Returns the step message's addition (「找到專輯封面、2 張 MV 畫面」) or "".
 */
async function collectStep(
  run: RunInternal,
  project: Project,
  research: Research,
  releaseGroup: Promise<{ id: string; title: string } | null> | null,
  signal: AbortSignal,
  startedAt: number,
): Promise<string> {
  const log = (message: string) => emit(run, { type: "log", step: "research", message });
  if (!visualsConfig().enabled) return "";
  try {
    const known = research.publicInfo?.musicbrainz?.recording?.releaseGroup;
    const rg = known?.id ? { id: known.id, title: known.title } : releaseGroup ? await raceAbort(releaseGroup, signal) : null;
    const candidates = Array.isArray(research.visualCandidates) ? research.visualCandidates : [];
    // cloud: the step has a hard stop; leave room to save
    const budgetMs = run.cloud ? CLOUD_STEP_TIMEOUT_MS - 15_000 - (Date.now() - startedAt) : VISUALS_BUDGET_MS;
    if (budgetMs < 3000 && (rg || candidates.length)) {
      log("研究用完了這個步驟的時間，這次不收集視覺素材（重新研究時會再試）。");
      return "";
    }
    return (await collectForProject(project, { candidates, releaseGroup: rg, signal, budgetMs, log })).line;
  } catch (err) {
    if (signal.aborted) throw err;
    log(`收集視覺素材失敗：${describeError(err)}（研究結果不受影響）`);
    return "";
  }
}

/** The band's bible and library for a project's research / design (empty without a band). */
async function bandContext(project: Project): Promise<{ bible: BandBible | null; bandName?: string; bandAssets: Asset[]; bandMoodboard?: MoodImage[] }> {
  if (!project.bandId) return { bible: null, bandAssets: [] };
  const band = await getBand(project.bandId).catch(() => null);
  if (!band) return { bible: null, bandAssets: [] };
  return { bible: band.bible, bandName: band.name, bandAssets: band.assets, bandMoodboard: band.moodboard };
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
    return { skipped: true, message: `沿用現有的同步歌詞（${project.lyrics.lines.length} 行）` };
  }

  if (!lyrics) {
    const { title, artist, album } = project.meta;
    if (!title.trim()) {
      log("沒有歌名，略過 LRCLIB 歌詞搜尋。");
    } else {
      log(`在 LRCLIB 搜尋歌詞：「${title}」${artist ? `，${artist}` : ""}`);
      try {
        const best = await raceAbort(findBestLyrics({ title, artist, album, duration }, { signal, onLog: log }), signal);
        if (best?.kind === "synced") {
          lyrics = best.lyrics;
          message = `LRCLIB 同步歌詞：${best.result.trackName}，${best.result.artistName}（${best.lyrics.lines.length} 行）`;
        } else if (best?.kind === "plain") {
          lyrics = roughTiming(best.lyrics);
          message = `LRCLIB 歌詞：${best.result.trackName}，${best.result.artistName}（${best.lyrics.lines.length} 行，沒有可用的時間碼，已粗略分配，建議到歌詞編輯器校正）`;
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
  return {
    apply: (p) => {
      if (p.plan) p.plan = remapPlanLines(p.plan, p.lyrics, finalLyrics);
      p.lyrics = finalLyrics;
    },
    message,
  };
}
