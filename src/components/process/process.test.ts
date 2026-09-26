import { describe, expect, it } from "vitest";
import type { PipelineEvent, Project } from "@/lib/types";
import { applyEvent, applyEvents, failedStep, failRun, initialRunState, runningStep, startRun, stepsFromProject } from "./pipeline-state";
import { parseRunParam, parseStepsParam, processHref, stepsFrom } from "./steps";

describe("steps params", () => {
  it("parses comma-separated and repeated steps in pipeline order", () => {
    expect(parseStepsParam("design")).toEqual(["design"]);
    expect(parseStepsParam("design,research")).toEqual(["research", "design"]);
    expect(parseStepsParam(["design", "lyrics"])).toEqual(["lyrics", "design"]);
    expect(parseStepsParam("bogus")).toBeUndefined();
    expect(parseStepsParam(undefined)).toBeUndefined();
    expect(parseStepsParam("")).toBeUndefined();
  });

  it("parses run", () => {
    expect(parseRunParam("1")).toBe(true);
    expect(parseRunParam("true")).toBe(true);
    expect(parseRunParam(["0", "1"])).toBe(true);
    expect(parseRunParam("0")).toBe(false);
    expect(parseRunParam(undefined)).toBe(false);
  });

  it("builds hrefs", () => {
    expect(processHref("abc")).toBe("/p/abc/process");
    expect(processHref("abc", { run: true })).toBe("/p/abc/process?run=1");
    expect(processHref("abc", { run: true, steps: ["design"] })).toBe("/p/abc/process?run=1&steps=design");
    expect(processHref("abc", { run: true, steps: ["design", "research"] })).toBe("/p/abc/process?run=1&steps=research%2Cdesign");
    // the full pipeline needs no steps param
    expect(processHref("abc", { run: true, steps: ["lyrics", "research", "design"] })).toBe("/p/abc/process?run=1");
  });

  it("computes retry steps", () => {
    expect(stepsFrom(undefined, "research")).toEqual(["research", "design"]);
    expect(stepsFrom(["design"], "design")).toEqual(["design"]);
    expect(stepsFrom(["lyrics", "design"], "research")).toEqual(["lyrics", "design"]);
  });
});

const project = { id: "p1", status: "ready" } as unknown as Project;

describe("pipeline reducer", () => {
  it("tracks a full run", () => {
    let s = startRun(undefined, 0);
    expect(s.phase).toBe("running");
    expect(s.steps.lyrics.status).toBe("pending");
    const events: PipelineEvent[] = [
      { type: "step", step: "lyrics", status: "start" },
      { type: "log", step: "lyrics", message: "在 LRCLIB 搜尋歌詞" },
      { type: "step", step: "lyrics", status: "done", message: "使用貼上的同步歌詞（14 行）" },
      { type: "step", step: "research", status: "start" },
      { type: "search", query: "Livelyrics Band 樂團" },
      { type: "search", query: "Livelyrics Band 樂團" },
      { type: "delta", step: "research", text: "## 樂團" },
      { type: "delta", step: "research", text: "定位\n" },
    ];
    s = applyEvents(s, events, 10);
    expect(s.steps.lyrics.status).toBe("done");
    expect(s.steps.lyrics.message).toContain("14 行");
    expect(runningStep(s)).toBe("research");
    expect(s.searches).toEqual(["Livelyrics Band 樂團"]);
    expect(s.steps.research.text).toBe("## 樂團定位\n");
    expect(s.logs.map((l) => l.tone)).toEqual(["info", "success"]);
    s = applyEvent(s, { type: "done", project }, 20);
    expect(s.phase).toBe("done");
    expect(s.project).toBe(project);
    expect(s.steps.research.status).toBe("done");
    // never started -> kept
    expect(s.steps.design.status).toBe("kept");
  });

  it("marks steps outside the request as kept, and adopts steps an attached run actually runs", () => {
    let s = startRun(["design"], 0);
    expect(s.steps.lyrics.status).toBe("kept");
    expect(s.steps.design.status).toBe("pending");
    s = applyEvent(s, { type: "log", step: "research", message: "已接上進行中的處理。" }, 1);
    expect(s.attached).toBe(true);
    s = applyEvent(s, { type: "step", step: "research", status: "start" }, 2);
    expect(s.requested).toEqual(["research", "design"]);
    expect(s.steps.research.status).toBe("running");
  });

  it("reports step errors and the failed step", () => {
    let s = startRun(undefined, 0);
    s = applyEvents(
      s,
      [
        { type: "step", step: "lyrics", status: "start" },
        { type: "step", step: "lyrics", status: "skipped", message: "沿用現有的同步歌詞" },
        { type: "step", step: "research", status: "start" },
        { type: "step", step: "research", status: "error", message: "逾時" },
        { type: "error", message: "研究步驟失敗：逾時" },
      ],
      5,
    );
    expect(s.phase).toBe("error");
    expect(s.error).toBe("研究步驟失敗：逾時");
    expect(s.steps.lyrics.status).toBe("skipped");
    expect(failedStep(s)).toBe("research");
    expect(s.logs.filter((l) => l.tone === "error")).toHaveLength(2);
  });

  it("fails a running step on a network error and never un-finishes a done run", () => {
    let s = applyEvent(startRun(undefined, 0), { type: "step", step: "lyrics", status: "start" }, 1);
    s = failRun(s, "網路中斷", 2);
    expect(s.steps.lyrics.status).toBe("error");
    expect(s.error).toBe("網路中斷");
    const done = applyEvent(startRun(undefined, 0), { type: "done", project }, 1);
    expect(failRun(done, "late", 2)).toBe(done);
  });

  it("ignores unknown steps and empty deltas", () => {
    const s = startRun(undefined, 0);
    expect(applyEvent(s, { type: "delta", step: "analyze", text: "x" }, 1)).toBe(s);
    expect(applyEvent(s, { type: "delta", step: "research", text: "" }, 1)).toBe(s);
    expect(applyEvent(s, { type: "step", step: "done", status: "start" }, 1)).toBe(s);
    expect(initialRunState().phase).toBe("idle");
  });
});

describe("stepsFromProject", () => {
  it("summarizes a stored project", () => {
    const p = {
      lyrics: { source: "lrclib-synced", synced: true, lines: [{ id: "l0", text: "a", start: 1, end: 2 }] },
      research: { brief: "x", sources: [{ title: "s", url: "u" }], engine: "claude", model: "m", createdAt: "" },
      plan: null,
    } as unknown as Project;
    const s = stepsFromProject(p);
    expect(s.lyrics.status).toBe("done");
    expect(s.lyrics.message).toContain("1 行");
    expect(s.research.message).toBe("Claude（m），1 個來源");
    expect(s.design.status).toBe("pending");
    const empty = stepsFromProject({ ...p, lyrics: { source: "none", synced: false, lines: [] }, research: null } as unknown as Project);
    expect(empty.lyrics.status).toBe("kept");
    expect(empty.research.status).toBe("pending");
  });
});
