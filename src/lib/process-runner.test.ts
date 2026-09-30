import { describe, expect, it } from "vitest";
import type { ProcessRequest } from "./api-client";
import { ProcessBusyError, remainingSteps, retryFrom, runStepwise, type RunnerDeps } from "./process-runner";
import type { PipelineEvent, PipelineRecord, Project } from "./types";

const base = { id: "p1", status: "processing", plan: null } as unknown as Project;
const record = (r: Partial<PipelineRecord>): PipelineRecord => ({
  runId: "run-a",
  steps: ["lyrics", "research", "design"],
  status: "running",
  current: null,
  startedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  results: {},
  ...r,
});

/** A fake server: `stream` answers each step request from a script; `getProject` returns queued snapshots. */
function fakeDeps(opts: {
  stream?: (body: ProcessRequest, emit: (e: PipelineEvent) => void) => Promise<Project>;
  projects?: Project[];
}): RunnerDeps & { requests: ProcessRequest[]; sleeps: number } {
  const requests: ProcessRequest[] = [];
  const snapshots = [...(opts.projects ?? [])];
  const deps = {
    requests,
    sleeps: 0,
    newRunId: () => "run-new",
    pollMs: 1,
    async sleep() {
      deps.sleeps++;
    },
    async getProject() {
      const p = snapshots.length > 1 ? snapshots.shift()! : snapshots[0];
      if (!p) throw new Error("no snapshot");
      return p;
    },
    async stream(_id: string, body: ProcessRequest, onEvent: (e: PipelineEvent) => void) {
      requests.push(body);
      if (opts.stream) return opts.stream(body, onEvent);
      const step = body.steps![0];
      onEvent({ type: "step", step, status: "start" });
      onEvent({ type: "step", step, status: "done", message: `${step} ok` });
      const last = step === body.run!.steps[body.run!.steps.length - 1];
      const project = { ...base, status: last ? "ready" : "processing", plan: last ? {} : null } as Project;
      onEvent({ type: "done", project });
      return project;
    },
  };
  return deps;
}

describe("runStepwise", () => {
  it("sends one request per step with the run, and ends the run once", async () => {
    const deps = fakeDeps({});
    const events: PipelineEvent[] = [];
    const project = await runStepwise("p1", { lyricsText: "[00:01.00]a", instruction: "更熱血" }, (e) => events.push(e), undefined, deps);
    expect(project.status).toBe("ready");
    expect(deps.requests).toEqual([
      { steps: ["lyrics"], run: { id: "run-new", steps: ["lyrics", "research", "design", "scene"] }, lyricsText: "[00:01.00]a", instruction: "更熱血" },
      { steps: ["research"], run: { id: "run-new", steps: ["lyrics", "research", "design", "scene"] }, instruction: "更熱血" },
      { steps: ["design"], run: { id: "run-new", steps: ["lyrics", "research", "design", "scene"] }, instruction: "更熱血" },
      { steps: ["scene"], run: { id: "run-new", steps: ["lyrics", "research", "design", "scene"] }, instruction: "更熱血" },
    ]);
    // the intermediate `done` events stay inside the runner
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(events.filter((e) => e.type === "step").map((e) => e.type === "step" && `${e.step}:${e.status}`)).toEqual([
      "lyrics:start",
      "lyrics:done",
      "research:start",
      "research:done",
      "design:start",
      "design:done",
      "scene:start",
      "scene:done",
    ]);
  });

  it("keeps the requested steps and the arc", async () => {
    const deps = fakeDeps({});
    const arc = { showName: "巡演", position: 0, total: 3, role: "opener" as const, energy: 0.6, emphasis: "primary" as const, note: "開場" };
    await runStepwise("p1", { steps: ["design"], arc }, () => {}, undefined, deps);
    expect(deps.requests).toEqual([{ steps: ["design"], run: { id: "run-new", steps: ["design"] }, arc }]);
  });

  it("carries the free option (no Claude API) on every step", async () => {
    const deps = fakeDeps({});
    await runStepwise("p1", { steps: ["research", "design"], free: true }, () => {}, undefined, deps);
    expect(deps.requests).toEqual([
      { steps: ["research"], run: { id: "run-new", steps: ["research", "design"] }, free: true },
      { steps: ["design"], run: { id: "run-new", steps: ["research", "design"] }, free: true },
    ]);
  });

  it("stops at a failed step", async () => {
    const deps = fakeDeps({
      async stream(body, emit) {
        if (body.steps![0] === "research") {
          emit({ type: "error", message: "研究步驟失敗：x" });
          throw new Error("研究步驟失敗：x");
        }
        emit({ type: "done", project: base });
        return base;
      },
    });
    const events: PipelineEvent[] = [];
    await expect(runStepwise("p1", {}, (e) => events.push(e), undefined, deps)).rejects.toThrow("研究步驟失敗");
    expect(deps.requests.map((r) => r.steps![0])).toEqual(["lyrics", "research"]);
    expect(events.at(-1)).toEqual({ type: "error", message: "研究步驟失敗：x" });
  });

  it("watches a run in progress elsewhere (409), then continues it", async () => {
    let calls = 0;
    const deps = fakeDeps({
      async stream(body, emit) {
        calls++;
        if (calls === 1) throw new ProcessBusyError("這首歌已經有一個處理正在進行（研究）");
        emit({ type: "step", step: body.steps![0], status: "start" });
        emit({ type: "step", step: body.steps![0], status: "done" });
        const done = { ...base, status: "ready", plan: {} } as Project;
        emit({ type: "done", project: done });
        return done;
      },
      projects: [
        { ...base, pipeline: record({ current: "research", results: { lyrics: { status: "done", at: "", message: "歌詞 ok" } } }) } as Project,
        { ...base, pipeline: record({ current: "research", results: { lyrics: { status: "done", at: "" } } }) } as Project,
        { ...base, pipeline: record({ current: null, instruction: "記錄的指示", results: { lyrics: { status: "done", at: "" }, research: { status: "done", at: "", message: "研究 ok" } } }) } as Project,
      ],
    });
    const events: PipelineEvent[] = [];
    const project = await runStepwise("p1", { steps: ["design"] }, (e) => events.push(e), undefined, deps);
    expect(project.status).toBe("ready");
    expect(events[0]).toMatchObject({ type: "log", message: expect.stringContaining("已經有一個處理") });
    expect(events).toContainEqual({ type: "attached", steps: ["lyrics", "research", "design"], sameRequest: false });
    expect(events).toContainEqual({ type: "step", step: "research", status: "done", message: "研究 ok" });
    // the watched run's own remaining step, with its recorded instruction
    expect(deps.requests.at(-1)).toEqual({ steps: ["design"], run: { id: "run-a", steps: ["lyrics", "research", "design"] }, instruction: "記錄的指示" });
    expect(deps.sleeps).toBe(2);
  });
});

describe("attach-only (a refreshed page)", () => {
  it("reports a finished project, and the stored error of a failed or stale one", async () => {
    const ready = { ...base, status: "ready", plan: {} } as Project;
    const events: PipelineEvent[] = [];
    expect(await runStepwise("p1", { attachOnly: true }, (e) => events.push(e), undefined, fakeDeps({ projects: [ready] }))).toBe(ready);
    expect(events).toEqual([{ type: "done", project: ready }]);

    const stale = { ...base, status: "error", error: "上次的處理沒有完成（雲端每個步驟最多 300 秒，可能逾時或中斷了），請重試。", pipeline: record({ current: "research" }) } as Project;
    await expect(runStepwise("p1", { attachOnly: true }, () => {}, undefined, fakeDeps({ projects: [stale] }))).rejects.toThrow("300 秒");
  });

  it("continues between steps, and fails when the running step's request died", async () => {
    const between = { ...base, pipeline: record({ results: { lyrics: { status: "done", at: "" } } }) } as Project;
    const deps = fakeDeps({ projects: [between] });
    const project = await runStepwise("p1", { attachOnly: true }, () => {}, undefined, deps);
    expect(project.status).toBe("ready");
    expect(deps.requests.map((r) => r.steps![0])).toEqual(["research", "design"]);
    expect(deps.requests[0].run).toEqual({ id: "run-a", steps: ["lyrics", "research", "design"] });

    const running = { ...base, pipeline: record({ current: "research" }) } as Project;
    const dead = { ...base, status: "error", error: "上次的處理沒有完成", pipeline: record({ current: "research" }) } as Project;
    const events: PipelineEvent[] = [];
    await expect(runStepwise("p1", { attachOnly: true }, (e) => events.push(e), undefined, fakeDeps({ projects: [running, dead] }))).rejects.toThrow("沒有完成");
    expect(events).toContainEqual({ type: "step", step: "research", status: "start" });
    expect(events.at(-1)).toEqual({ type: "error", message: "上次的處理沒有完成" });
  });
});

describe("recorded run helpers", () => {
  it("finds what is left and where to retry", () => {
    const r = record({ results: { lyrics: { status: "done", at: "" }, research: { status: "skipped", at: "" } } });
    expect(remainingSteps(r)).toEqual(["design"]);
    expect(retryFrom(record({ failed: "research" }))).toEqual(["research", "design"]);
    expect(retryFrom(record({ current: "design" }))).toEqual(["design"]);
    expect(retryFrom(r)).toEqual(["design"]);
    expect(retryFrom(record({ steps: ["design"], results: { design: { status: "done", at: "" } } }))).toEqual(["design"]);
  });
});
