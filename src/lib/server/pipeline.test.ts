import { promises as fs } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignPlan, PipelineEvent, Research } from "@/lib/types";

const designerMock = vi.hoisted(() => ({
  researchSong: vi.fn(),
  designSong: vi.fn(),
}));
const lrclibMock = vi.hoisted(() => ({ findBestLyrics: vi.fn() }));

vi.mock("@/lib/server/designer", () => ({
  isClaudeConfigured: () => false,
  modelName: () => "test-model",
  researchSong: designerMock.researchSong,
  designSong: designerMock.designSong,
}));
vi.mock("./lrclib", () => ({ findBestLyrics: lrclibMock.findBestLyrics }));

import { attachToRun, cancelRun, isRunActive, runPipeline, withLiveStatus, type RunHandle } from "./pipeline";
import { eventListStream, pipelineEventStream } from "./sse";
import { createProject, createUploadTempPath, getProject, updateProject } from "./storage";

let root: string;
const previousEnv = process.env.LIVELYRICS_DATA_DIR;

beforeAll(async () => {
  await fs.mkdir("/tmp/claude-0", { recursive: true });
  root = await fs.mkdtemp("/tmp/claude-0/ll-pipeline-");
  process.env.LIVELYRICS_DATA_DIR = root;
});

afterAll(async () => {
  if (previousEnv === undefined) delete process.env.LIVELYRICS_DATA_DIR;
  else process.env.LIVELYRICS_DATA_DIR = previousEnv;
  await fs.rm(root, { recursive: true, force: true });
});

const research: Research = { brief: "# 研究", sources: [{ title: "s", url: "https://example.com" }], engine: "offline", createdAt: "2026-01-01T00:00:00Z" };

function plan(title = "夜色之城"): DesignPlan {
  return {
    version: 1,
    keyVisual: {
      title,
      concept: "c",
      moodKeywords: ["夜"],
      palette: [
        { hex: "#05070d", role: "背景", name: "夜" },
        { hex: "#ff3366", role: "主色", name: "燈" },
      ],
      motifs: ["燈"],
      motifSvg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="currentColor"/></svg>',
      typography: { cjkFont: "noto-sans-tc", latinFont: "bebas-neue", weight: 700, letterSpacing: 0.02, rationale: "r" },
    },
    sections: [
      {
        id: "s0",
        kind: "verse",
        label: "主歌",
        start: 0,
        end: 73,
        energy: 0.5,
        scene: "nebula",
        sceneParams: { speed: 0.5, density: 0.5, intensity: 0.5, audioReactivity: 0.5 },
        colorway: ["#05070d", "#ff3366", "#ffffff"],
        lyricStyle: "line-fade",
        lyricPlacement: "center",
        lyricScale: 1,
        lyricColor: "#ffffff",
        transitionIn: "fade",
        media: null,
        rationale: "r",
      },
    ],
    lines: [],
    cues: [],
    designerNotes: "n",
  };
}

async function newProject(title = "示範之歌") {
  const tempPath = await createUploadTempPath();
  await fs.writeFile(tempPath, "RIFFxxxxWAVE");
  return createProject({
    meta: { title, artist: "Livelyrics Band", duration: 73, fileName: "demo.wav", mimeType: "audio/wav" },
    analysis: null,
    audio: { tempPath, ext: "wav" },
  });
}

function collect(handle: RunHandle): Promise<PipelineEvent[]> {
  return new Promise((resolve) => {
    const events: PipelineEvent[] = [];
    handle.subscribe((e) => {
      events.push(e);
      if (e.type === "done" || e.type === "error") resolve(events);
    });
  });
}

const LRC = "[00:08.00]夜色慢慢落在城市的邊緣\n[00:12.00]我們把名字寫進風裡面\n[00:16.00]每一盞燈都像一個誓言";

beforeEach(() => {
  designerMock.researchSong.mockReset();
  designerMock.designSong.mockReset();
  lrclibMock.findBestLyrics.mockReset();
});

describe("runPipeline", () => {
  it("runs lyrics -> research -> design, saving after each step", async () => {
    const p = await newProject();
    designerMock.researchSong.mockImplementation(async (_input, cb) => {
      cb.onSearch?.("Livelyrics Band 示範之歌");
      cb.onDelta?.("第一段");
      cb.onDelta?.("第二段");
      cb.onLog?.("正在研究");
      // research is saved before design starts
      return research;
    });
    designerMock.designSong.mockImplementation(async (input) => {
      expect(input.research).toEqual(research);
      expect(input.lyrics.lines).toHaveLength(3);
      expect(input.instruction).toBe("副歌更熱血");
      expect((await getProject(p.id))!.research).toEqual(research);
      return plan();
    });

    const handle = runPipeline(p.id, { lyricsText: LRC, instruction: "副歌更熱血" });
    expect(handle.attached).toBe(false);
    expect(isRunActive(p.id)).toBe(true);
    const events = await collect(handle);

    const steps = events.filter((e) => e.type === "step").map((e) => e.type === "step" && `${e.step}:${e.status}`);
    expect(steps).toEqual(["lyrics:start", "lyrics:done", "research:start", "research:done", "design:start", "design:done"]);
    expect(events).toContainEqual({ type: "search", query: "Livelyrics Band 示範之歌" });
    expect(events).toContainEqual({ type: "log", step: "research", message: "正在研究" });
    const done = events[events.length - 1];
    expect(done.type).toBe("done");
    if (done.type === "done") {
      expect(done.project.status).toBe("ready");
      expect(done.project.lyrics.synced).toBe(true);
      expect(done.project.lyrics.source).toBe("user");
      expect(done.project.plan?.keyVisual.title).toBe("夜色之城");
    }
    const saved = (await getProject(p.id))!;
    expect(saved.status).toBe("ready");
    expect(saved.plan?.keyVisual.title).toBe("夜色之城");
    expect(lrclibMock.findBestLyrics).not.toHaveBeenCalled();

    // late subscribers get the whole history, with streamed deltas coalesced
    const replay = await collect(runPipeline(p.id, { lyricsText: LRC, instruction: "副歌更熱血" }));
    expect(replay.filter((e) => e.type === "delta")).toEqual([{ type: "delta", step: "research", text: "第一段第二段" }]);
    expect(replay[replay.length - 1].type).toBe("done");
  });

  it("a throwing designer yields a clean error event and keeps earlier results", async () => {
    const p = await newProject();
    designerMock.researchSong.mockRejectedValue(new Error("researchSong: not implemented"));
    const events = await collect(runPipeline(p.id, { lyricsText: LRC }));
    const last = events[events.length - 1];
    expect(last).toEqual({ type: "error", message: "研究步驟失敗：researchSong: not implemented" });
    expect(events).toContainEqual({ type: "step", step: "research", status: "error", message: "researchSong: not implemented" });
    expect(events.some((e) => e.type === "step" && e.step === "design")).toBe(false);
    const saved = (await getProject(p.id))!;
    expect(saved.status).toBe("error");
    expect(saved.error).toMatch(/研究步驟失敗/);
    expect(saved.lyrics.lines).toHaveLength(3);
    expect(designerMock.designSong).not.toHaveBeenCalled();
    expect(isRunActive(p.id)).toBe(false);

    // retrying right away starts a new run instead of replaying the failure
    designerMock.researchSong.mockResolvedValue(research);
    designerMock.designSong.mockResolvedValue(plan());
    const retry = runPipeline(p.id, { lyricsText: LRC });
    expect(retry.attached).toBe(false);
    const retried = await collect(retry);
    expect(retried[retried.length - 1].type).toBe("done");
    expect((await getProject(p.id))!.status).toBe("ready");
  });

  it("rejects an invalid plan from the designer", async () => {
    const p = await newProject();
    designerMock.designSong.mockResolvedValue({ version: 1, nonsense: true });
    const events = await collect(runPipeline(p.id, { steps: ["design"] }));
    expect(events[events.length - 1]).toMatchObject({ type: "error" });
    expect((await getProject(p.id))!.plan).toBeNull();
  });

  it("attaches a second request to the active run and replays past events", async () => {
    const p = await newProject();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    designerMock.researchSong.mockImplementation(async (_i, cb) => {
      cb.onDelta?.("思考中");
      await gate;
      return research;
    });
    designerMock.designSong.mockResolvedValue(plan());

    const first = runPipeline(p.id, { lyricsText: LRC });
    const firstEvents = collect(first);
    await vi.waitFor(() => expect(designerMock.researchSong).toHaveBeenCalled());
    await vi.waitFor(async () => expect((await getProject(p.id))!.status).toBe("processing"));

    const second = runPipeline(p.id, { steps: ["design"], instruction: "不同的要求" });
    expect(second.attached).toBe(true);
    expect(second.run.runId).toBe(first.run.runId);
    const replayed: PipelineEvent[] = [];
    const secondDone = new Promise<void>((resolve) =>
      second.subscribe((e) => {
        replayed.push(e);
        if (e.type === "done") resolve();
      }),
    );
    expect(replayed.map((e) => e.type)).toContain("delta");
    expect(withLiveStatus((await getProject(p.id))!).status).toBe("processing");

    release();
    await secondDone;
    const all = await firstEvents;
    expect(replayed.length).toBe(all.length);
    expect(designerMock.researchSong).toHaveBeenCalledTimes(1);
  });

  it("keeps running when subscribers disconnect", async () => {
    const p = await newProject();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    designerMock.researchSong.mockImplementation(async () => {
      await gate;
      return research;
    });
    designerMock.designSong.mockResolvedValue(plan("斷線後仍完成"));
    const handle = runPipeline(p.id, {});
    lrclibMock.findBestLyrics.mockResolvedValue(null);
    const unsubscribe = handle.subscribe(() => {});
    unsubscribe();
    release();
    await handle.run.finished;
    expect(handle.run.status).toBe("done");
    expect((await getProject(p.id))!.plan?.keyVisual.title).toBe("斷線後仍完成");
  });

  it("uses LRCLIB, distributes plain lyrics and handles failures", async () => {
    const p = await newProject();
    designerMock.researchSong.mockResolvedValue(research);
    designerMock.designSong.mockResolvedValue(plan());

    lrclibMock.findBestLyrics.mockResolvedValueOnce({
      kind: "plain",
      result: { id: 1, trackName: "示範之歌", artistName: "Livelyrics Band", albumName: "", duration: 73, synced: false, lyrics: { source: "lrclib-plain", synced: false, lines: [] } },
      lyrics: {
        source: "lrclib-plain",
        synced: false,
        lines: [
          { id: "l0", text: "第一句", start: null, end: null },
          { id: "l1", text: "第二句", start: null, end: null },
        ],
      },
    });
    const events = await collect(runPipeline(p.id, { steps: ["lyrics"] }));
    expect(lrclibMock.findBestLyrics).toHaveBeenCalledWith(
      expect.objectContaining({ title: "示範之歌", artist: "Livelyrics Band", duration: 73 }),
      expect.anything(),
    );
    const saved = (await getProject(p.id))!;
    expect(saved.lyrics.source).toBe("lrclib-plain");
    expect(saved.lyrics.synced).toBe(true);
    expect(saved.lyrics.lines[0].start).toBeGreaterThan(0);
    expect(events.find((e) => e.type === "step" && e.status === "done")).toMatchObject({ message: expect.stringContaining("粗略分配") });

    // now synced lyrics exist: the lyrics step is skipped
    const again = await collect(runPipeline(p.id, { steps: ["lyrics", "research"] }));
    expect(again).toContainEqual(expect.objectContaining({ type: "step", step: "lyrics", status: "skipped" }));

    // network failure with no lyrics -> empty lyrics, not an error
    const q = await newProject("沒有歌詞");
    lrclibMock.findBestLyrics.mockRejectedValueOnce(new Error("無法連線到 LRCLIB"));
    const failed = await collect(runPipeline(q.id, { steps: ["lyrics"] }));
    expect(failed[failed.length - 1].type).toBe("done");
    expect(failed).toContainEqual(expect.objectContaining({ type: "log", message: expect.stringContaining("LRCLIB 搜尋失敗") }));
    expect((await getProject(q.id))!.lyrics).toEqual({ source: "none", synced: false, lines: [] });
  });

  it("reports a missing project and cancellation", async () => {
    const missing = await collect(runPipeline("nosuchproject", {}));
    expect(missing[missing.length - 1]).toMatchObject({ type: "error", message: expect.stringContaining("找不到專案") });

    const p = await newProject();
    designerMock.researchSong.mockImplementation(() => new Promise(() => {}));
    const handle = runPipeline(p.id, { lyricsText: LRC });
    const events = collect(handle);
    await vi.waitFor(() => expect(designerMock.researchSong).toHaveBeenCalled());
    cancelRun(p.id);
    const all = await events;
    expect(all[all.length - 1]).toMatchObject({ type: "error", message: expect.stringContaining("取消") });
    expect((await getProject(p.id))!.status).toBe("error");
  });

  it("marks an orphaned processing status as interrupted", async () => {
    const p = await newProject();
    const saved = await updateProject(p.id, (d) => {
      d.status = "processing";
    });
    expect(withLiveStatus(saved)).toMatchObject({ status: "error", error: expect.stringContaining("沒有完成") });
  });
});

describe("pipelineEventStream", () => {
  async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return out;
      out += decoder.decode(value, { stream: true });
    }
  }

  it("frames events as SSE data lines and closes after the terminal event", async () => {
    const p = await newProject();
    designerMock.researchSong.mockRejectedValue(new Error("boom"));
    const handle = runPipeline(p.id, { lyricsText: LRC });
    const text = await readAll(
      pipelineEventStream(handle, { prelude: [{ type: "log", step: "lyrics", message: "hi" }], heartbeatMs: 5 }),
    );
    const frames = text.split("\n\n").filter(Boolean);
    expect(frames[0]).toBe(": livelyrics");
    const data = frames.filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)) as PipelineEvent);
    expect(data[0]).toEqual({ type: "log", step: "lyrics", message: "hi" });
    expect(data[data.length - 1]).toMatchObject({ type: "error" });
  });

  it("stops writing on client abort without cancelling the run", async () => {
    const p = await newProject();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    designerMock.researchSong.mockImplementation(async () => {
      await gate;
      return research;
    });
    designerMock.designSong.mockResolvedValue(plan());
    const handle = runPipeline(p.id, { lyricsText: LRC });
    const ac = new AbortController();
    const stream = pipelineEventStream(handle, { signal: ac.signal, heartbeatMs: 5 });
    const reader = stream.getReader();
    await reader.read();
    ac.abort();
    const rest = await (async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) return "closed";
      }
    })();
    expect(rest).toBe("closed");
    expect(handle.run.status).toBe("running");
    release();
    await handle.run.finished;
    expect(handle.run.status).toBe("done");
  });

  it("sends comment heartbeats while a run is quiet", async () => {
    const p = await newProject();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    designerMock.researchSong.mockImplementation(async () => {
      await gate;
      throw new Error("stop");
    });
    const handle = runPipeline(p.id, { lyricsText: LRC });
    const reader = pipelineEventStream(handle, { heartbeatMs: 10 }).getReader();
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 2000;
    while (!text.includes(": heartbeat\n\n") && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain(": heartbeat\n\n");
    release();
    await handle.run.finished;
    await reader.cancel();
  });

  it("replays a finished run and closes immediately", async () => {
    const p = await newProject();
    designerMock.researchSong.mockResolvedValue(research);
    designerMock.designSong.mockResolvedValue(plan());
    const first = runPipeline(p.id, { steps: ["research"] });
    await first.run.finished;
    const second = runPipeline(p.id, { steps: ["research"] });
    expect(second.attached).toBe(true);
    const text = await readAll(pipelineEventStream(second));
    expect(text).toContain('"type":"done"');
  });
});

describe("attachToRun (attach-only watchers)", () => {
  it("never starts a run, and follows one that is in progress or just finished", async () => {
    const p = await newProject();
    expect(attachToRun(p.id)).toBeNull();
    expect(isRunActive(p.id)).toBe(false);

    let release!: () => void;
    designerMock.researchSong.mockImplementation(() => new Promise<Research>((resolve) => (release = () => resolve(research))));
    designerMock.designSong.mockResolvedValue(plan());
    const run = runPipeline(p.id, { steps: ["research", "design"] });

    const watcher = attachToRun(p.id);
    expect(watcher).not.toBeNull();
    expect(watcher!.attached).toBe(true);
    expect(watcher!.run.runId).toBe(run.run.runId);
    const watched = collect(watcher!);
    await vi.waitFor(() => expect(designerMock.researchSong).toHaveBeenCalled());
    release();
    const events = await watched;
    expect(events.at(-1)?.type).toBe("done");

    // a finished run stays attachable (replayed) for a while
    const late = attachToRun(p.id);
    expect(late).not.toBeNull();
    const replay = await collect(late!);
    expect(replay.map((e) => e.type)).toEqual(events.map((e) => e.type));
  });
});

describe("eventListStream", () => {
  it("sends the given events and closes", async () => {
    const text = await new Response(eventListStream([{ type: "error", message: "目前沒有進行中的處理。" }])).text();
    expect(text).toContain('data: {"type":"error","message":"目前沒有進行中的處理。"}\n\n');
  });
});
