// Pure reducer: PipelineEvents (SSE) -> what the process page shows.

import type { PipelineEvent, PipelineStepId, Project } from "@/lib/types";
import { researchEngineLabel } from "@/lib/research-labels";
import { estimatedCount } from "@/lib/lyrics/lrc";
import { LYRICS_SOURCE_LABEL } from "./labels";
import { PROCESS_STEPS, type ProcessStep } from "./steps";

export type StepStatus =
  | "pending" // part of this run, not started yet
  | "running"
  | "done"
  | "skipped" // the server decided it was not needed (e.g. existing synced lyrics)
  | "error"
  | "kept"; // not part of this run: the previous result is kept

export interface StepState {
  status: StepStatus;
  message?: string;
  startedAt?: number;
  endedAt?: number;
  /** streamed text ("delta" events) */
  text: string;
}

export interface LogEntry {
  id: number;
  at: number;
  step: PipelineStepId | null;
  message: string;
  tone: "info" | "error" | "success";
}

export type RunPhase = "idle" | "running" | "done" | "error";

export interface RunState {
  phase: RunPhase;
  steps: Record<ProcessStep, StepState>;
  /** steps requested for this run (pipeline order) */
  requested: ProcessStep[];
  searches: string[];
  logs: LogEntry[];
  error: string | null;
  /** final project from the "done" event */
  project: Project | null;
  startedAt: number | null;
  endedAt: number | null;
  /** true when the server said we attached to a run already in progress */
  attached: boolean;
}

const MAX_LOGS = 400;
const MAX_SEARCHES = 40;

function emptyStep(status: StepStatus): StepState {
  return { status, text: "" };
}

export function isProcessStep(step: unknown): step is ProcessStep {
  return typeof step === "string" && (PROCESS_STEPS as readonly string[]).includes(step);
}

export function initialRunState(): RunState {
  return {
    phase: "idle",
    steps: { lyrics: emptyStep("kept"), research: emptyStep("kept"), design: emptyStep("kept"), scene: emptyStep("kept") },
    requested: [],
    searches: [],
    logs: [],
    error: null,
    project: null,
    startedAt: null,
    endedAt: null,
    attached: false,
  };
}

/** A fresh run of `steps` (undefined = all). */
export function startRun(steps: readonly ProcessStep[] | undefined, now: number): RunState {
  const requested = steps && steps.length ? PROCESS_STEPS.filter((s) => steps.includes(s)) : [...PROCESS_STEPS];
  const base = initialRunState();
  for (const s of PROCESS_STEPS) base.steps[s] = emptyStep(requested.includes(s) ? "pending" : "kept");
  return { ...base, phase: "running", requested, startedAt: now };
}

function pushLog(state: RunState, entry: Omit<LogEntry, "id">): LogEntry[] {
  const last = state.logs[state.logs.length - 1];
  const logs = [...state.logs, { ...entry, id: (last?.id ?? 0) + 1 }];
  return logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs;
}

function withStep(state: RunState, step: ProcessStep, patch: Partial<StepState>): RunState {
  return { ...state, steps: { ...state.steps, [step]: { ...state.steps[step], ...patch } } };
}

export function applyEvent(state: RunState, event: PipelineEvent, now: number): RunState {
  switch (event.type) {
    case "step": {
      if (!isProcessStep(event.step)) return state;
      const step = event.step;
      if (event.status === "start") {
        // a new start of the same step (attached replay) resets its streamed text
        const next = withStep(state, step, { status: "running", startedAt: now, endedAt: undefined, message: undefined, text: "" });
        return next.requested.includes(step) ? next : { ...next, requested: PROCESS_STEPS.filter((s) => s === step || next.requested.includes(s)) };
      }
      const status: StepStatus = event.status === "done" ? "done" : event.status === "skipped" ? "skipped" : "error";
      const next = withStep(state, step, { status, endedAt: now, message: event.message });
      if (status === "error" && event.message) {
        return { ...next, logs: pushLog(next, { at: now, step, message: event.message, tone: "error" }) };
      }
      if (event.message) return { ...next, logs: pushLog(next, { at: now, step, message: event.message, tone: "success" }) };
      return next;
    }
    case "attached": {
      // the server joined a run already in progress: show the steps that run covers
      const requested = PROCESS_STEPS.filter((s) => event.steps.includes(s));
      if (requested.length === 0) return { ...state, attached: true };
      const steps = { ...state.steps };
      for (const s of PROCESS_STEPS) {
        const st = steps[s];
        if (st.status === "pending" || st.status === "kept") steps[s] = emptyStep(requested.includes(s) ? "pending" : "kept");
      }
      return { ...state, attached: true, requested, steps };
    }
    case "log":
      return { ...state, logs: pushLog(state, { at: now, step: event.step ?? null, message: event.message, tone: "info" as const }) };
    case "delta": {
      if (!isProcessStep(event.step) || !event.text) return state;
      return withStep(state, event.step, { text: state.steps[event.step].text + event.text });
    }
    case "search": {
      const q = event.query.trim();
      if (!q || state.searches.includes(q) || state.searches.length >= MAX_SEARCHES) return state;
      return { ...state, searches: [...state.searches, q] };
    }
    case "done": {
      const steps = { ...state.steps };
      for (const s of PROCESS_STEPS) {
        const st = steps[s];
        if (st.status === "running") steps[s] = { ...st, status: "done", endedAt: now };
        else if (st.status === "pending") steps[s] = { ...st, status: "kept" };
      }
      return { ...state, steps, phase: "done", project: event.project, error: null, endedAt: now };
    }
    case "error":
      return failRun(state, event.message, now);
  }
  return state;
}

/** The run failed (error event, network failure, parse error...). */
export function failRun(state: RunState, message: string, now: number): RunState {
  if (state.phase === "done") return state;
  const steps = { ...state.steps };
  for (const s of PROCESS_STEPS) {
    if (steps[s].status === "running") steps[s] = { ...steps[s], status: "error", endedAt: now, message: steps[s].message ?? message };
  }
  const already = state.logs.some((l) => l.tone === "error" && l.message === message);
  return {
    ...state,
    steps,
    phase: "error",
    error: message,
    endedAt: now,
    logs: already ? state.logs : pushLog(state, { at: now, step: null, message, tone: "error" }),
  };
}

export function applyEvents(state: RunState, events: readonly PipelineEvent[], now: number): RunState {
  let s = state;
  for (const e of events) s = applyEvent(s, e, now);
  return s;
}

/** The first step that failed in this run, if any. */
export function failedStep(state: RunState): ProcessStep | null {
  for (const s of PROCESS_STEPS) if (state.steps[s].status === "error") return s;
  return null;
}

/** The step currently running, if any. */
export function runningStep(state: RunState): ProcessStep | null {
  for (const s of PROCESS_STEPS) if (state.steps[s].status === "running") return s;
  return null;
}

/** Step states implied by a stored project (no run observed in this page view). */
export function stepsFromProject(project: Project): Record<ProcessStep, StepState> {
  const lines = project.lyrics?.lines ?? [];
  const timed = lines.filter((l) => l.start != null).length;
  const estimated = estimatedCount(project.lyrics);
  const lyrics: StepState =
    lines.length > 0
      ? {
          status: "done",
          text: "",
          message: `${LYRICS_SOURCE_LABEL[project.lyrics.source] ?? "歌詞"}，${lines.length} 行${project.lyrics.synced ? "，已同步" : estimated > 0 ? `，還有 ${estimated} 句時間是估的（請到歌詞編輯器對拍）` : timed > 0 ? `，${timed} 行有時間` : "，未定時"}`,
        }
      : { status: "kept", text: "", message: "尚無歌詞，可到歌詞編輯器加入" };
  const r = project.research;
  const research: StepState = r
    ? {
        status: "done",
        text: "",
        message: `${researchEngineLabel(r)}${r.sources.length ? `，${r.sources.length} 個來源` : ""}`,
      }
    : { status: "pending", text: "", message: "尚未研究" };
  const plan = project.plan;
  const design: StepState = plan
    ? { status: "done", text: "", message: `主視覺「${plan.keyVisual.title}」，${plan.sections.length} 個段落` }
    : { status: "pending", text: "", message: "尚未設計" };
  const program = plan?.sceneProgram;
  const scene: StepState = program
    ? { status: "done", text: "", message: `專屬畫面「${program.title}」${program.enabled === false ? "（目前改用內建場景）" : ""}` }
    : { status: "pending", text: "", message: plan ? "這個方案用內建場景" : "尚未設計" };
  return { lyrics, research, design, scene };
}
