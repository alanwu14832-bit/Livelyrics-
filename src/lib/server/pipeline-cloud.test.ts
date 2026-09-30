// Cloud mode pipeline: one step per request, recorded on the project so a refreshed page can
// continue; concurrent requests are refused (409) while a fresh step or another run is recorded.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignPlan, PipelineEvent, Research } from "@/lib/types";

const designerMock = vi.hoisted(() => ({ researchSong: vi.fn(), designSong: vi.fn() }));
const lrclibMock = vi.hoisted(() => ({ findBestLyrics: vi.fn() }));

vi.mock("@/lib/server/designer", () => ({
  isClaudeConfigured: () => false,
  modelName: () => "test-model",
  researchSong: designerMock.researchSong,
  designSong: designerMock.designSong,
  composerSalt: () => 0,
  designSceneProgram: async () => ({
    engine: "offline",
    program: { version: 1, engine: "offline", title: "測試畫面", concept: "", source: "vec3 scene(vec2 fc) { return uBg; }", sections: [], keyMoment: null, enabled: true },
  }),
}));
vi.mock("./lrclib", () => ({ findBestLyrics: lrclibMock.findBestLyrics }));

import { CLOUD_DESIGNER_BUDGET_MS, CLOUD_STALE_ERROR, CLOUD_STALE_MS, claimCloudRun, PipelineBusyError, runCloudSteps, withLiveStatus, type RunHandle } from "./pipeline";
import { createProject, getProject, updateProject } from "./storage";
import { setStoresForTesting } from "./store";
import { createBlobFileStore } from "./store/blob-files";
import { createSqlDocumentStore, DOCS_TABLE } from "./store/sql-docs";
import { createFakeBlob } from "./store/testing/fake-blob";
import { createTestDatabase, type TestDatabase } from "./store/testing/pglite";

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await tdb?.close();
});

beforeEach(async () => {
  await tdb.db.exec(`DROP TABLE IF EXISTS ${DOCS_TABLE}`);
  setStoresForTesting({ mode: "cloud", docs: createSqlDocumentStore(tdb.client, { retryDelayMs: 0 }), files: createBlobFileStore(createFakeBlob()) });
  designerMock.researchSong.mockReset();
  designerMock.designSong.mockReset();
  lrclibMock.findBestLyrics.mockReset();
});

afterEach(() => setStoresForTesting(null));

const research: Research = { brief: "# 研究", sources: [], engine: "offline", createdAt: "2026-01-01T00:00:00Z" };
const plan = (): DesignPlan =>
  ({
    version: 1,
    keyVisual: {
      title: "夜色之城",
      concept: "c",
      moodKeywords: [],
      palette: [
        { hex: "#05070d", role: "背景", name: "夜" },
        { hex: "#ff3366", role: "主色", name: "燈" },
      ],
      motifs: [],
      motifSvg: "",
      typography: { cjkFont: "noto-sans-tc", latinFont: "bebas-neue", weight: 700, letterSpacing: 0, rationale: "" },
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
        rationale: "",
      },
    ],
    lines: [],
    cues: [],
    designerNotes: "",
  }) as DesignPlan;

const LRC = "[00:08.00]夜色慢慢落在城市的邊緣\n[00:12.00]我們把名字寫進風裡面";
const ALL = ["lyrics", "research", "design"] as Array<"lyrics" | "research" | "design">;

async function newProject() {
  return createProject({
    meta: { title: "示範之歌", artist: "港口", duration: 73, fileName: "demo.wav", mimeType: "audio/wav" },
    analysis: null,
    audio: { blob: { url: "https://teststore.public.blob.vercel-storage.com/audio/song-1.wav", pathname: "audio/song-1.wav" }, ext: "wav" },
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

async function step(id: string, s: "lyrics" | "research" | "design", run = { id: "run-1", steps: ALL }, extra: Record<string, unknown> = {}) {
  const request = { steps: [s], run, ...extra };
  const claim = await claimCloudRun(id, request);
  return collect(runCloudSteps(id, request, claim));
}

describe("cloud pipeline (one step per request)", () => {
  it("records every step; the run is ready after its last step", async () => {
    designerMock.researchSong.mockResolvedValue(research);
    designerMock.designSong.mockResolvedValue(plan());
    const p = await newProject();

    const e1 = await step(p.id, "lyrics", undefined, { lyricsText: LRC, instruction: "副歌更熱血" });
    expect(e1.filter((e) => e.type === "step").map((e) => e.type === "step" && `${e.step}:${e.status}`)).toEqual(["lyrics:start", "lyrics:done"]);
    expect(e1.at(-1)).toMatchObject({ type: "done", project: { status: "processing" } });
    let saved = (await getProject(p.id))!;
    expect(saved.status).toBe("processing");
    expect(saved.lyrics.lines).toHaveLength(2);
    expect(saved.pipeline).toMatchObject({ runId: "run-1", steps: ALL, status: "running", current: null, instruction: "副歌更熱血", results: { lyrics: { status: "done" } } });

    await step(p.id, "research");
    saved = (await getProject(p.id))!;
    expect(saved.research).toEqual(research);
    expect(saved.pipeline!.results.research).toMatchObject({ status: "done", message: expect.stringContaining("研究完成") });

    const e3 = await step(p.id, "design");
    expect(e3.at(-1)).toMatchObject({ type: "done", project: { status: "ready", plan: { keyVisual: { title: "夜色之城" } } } });
    saved = (await getProject(p.id))!;
    expect(saved.status).toBe("ready");
    expect(saved.pipeline).toMatchObject({ status: "done", current: null });
    expect(Object.keys(saved.pipeline!.results).sort()).toEqual(["design", "lyrics", "research"]);
    // the instruction recorded with the run reached the designer, and Claude got a budget inside the limit
    expect(designerMock.designSong.mock.calls[0][0].instruction).toBe("副歌更熱血");
    expect(designerMock.designSong.mock.calls[0][2]).toEqual({ timeoutMs: CLOUD_DESIGNER_BUDGET_MS });
    expect(designerMock.researchSong.mock.calls[0][2]).toEqual({ timeoutMs: CLOUD_DESIGNER_BUDGET_MS });
  });

  it("a free run is recorded, so its later steps skip the Claude API too", async () => {
    designerMock.researchSong.mockResolvedValue(research);
    designerMock.designSong.mockResolvedValue(plan());
    const p = await newProject();
    const run = { id: "run-free", steps: ["research", "design"] as Array<"lyrics" | "research" | "design"> };
    await step(p.id, "research", run, { free: true });
    expect((await getProject(p.id))!.pipeline).toMatchObject({ runId: "run-free", free: true });
    // the next step's request does not repeat the option: the recorded run keeps it
    await step(p.id, "design", run);
    expect(designerMock.researchSong.mock.calls[0][2]).toEqual({ timeoutMs: CLOUD_DESIGNER_BUDGET_MS, configured: false });
    expect(designerMock.designSong.mock.calls[0][2]).toEqual({ timeoutMs: CLOUD_DESIGNER_BUDGET_MS, configured: false });
    expect((await getProject(p.id))!.status).toBe("ready");
  });

  it("refuses a second request while a step runs, or while another run is in progress", async () => {
    let release!: () => void;
    designerMock.researchSong.mockImplementation(() => new Promise<Research>((resolve) => (release = () => resolve(research))));
    const p = await newProject();
    await step(p.id, "lyrics", undefined, { lyricsText: LRC });

    const request = { steps: ["research"] as const, run: { id: "run-1", steps: ALL } };
    const claim = await claimCloudRun(p.id, { ...request, steps: ["research"] });
    const running = collect(runCloudSteps(p.id, { ...request, steps: ["research"] }, claim));
    expect((await getProject(p.id))!.pipeline).toMatchObject({ current: "research" });

    // the same step again (a double click, a second tab) and a new run are both refused
    await expect(claimCloudRun(p.id, { steps: ["research"], run: { id: "run-1", steps: ALL } })).rejects.toBeInstanceOf(PipelineBusyError);
    await expect(claimCloudRun(p.id, { steps: ["design"], run: { id: "run-2", steps: ["design"] } })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("研究") });

    await vi.waitFor(() => expect(designerMock.researchSong).toHaveBeenCalled());
    release();
    await running;
    // between steps: the same run continues, another run is still refused
    await expect(claimCloudRun(p.id, { steps: ["design"], run: { id: "run-2", steps: ["design"] } })).rejects.toBeInstanceOf(PipelineBusyError);
    designerMock.designSong.mockResolvedValue(plan());
    const done = await step(p.id, "design");
    expect(done.at(-1)).toMatchObject({ type: "done", project: { status: "ready" } });
  });

  it("takes over a stale run (its request ran out of time) and reports it stale meanwhile", async () => {
    const p = await newProject();
    await claimCloudRun(p.id, { steps: ["research"], run: { id: "dead", steps: ["research", "design"] } });
    const stuck = (await getProject(p.id))!;
    expect(stuck.pipeline).toMatchObject({ runId: "dead", current: "research" });
    expect(withLiveStatus(stuck).status).toBe("processing");
    const later = { ...stuck, updatedAt: new Date(Date.now() - CLOUD_STALE_MS - 1000).toISOString() };
    expect(withLiveStatus(later)).toMatchObject({ status: "error", error: CLOUD_STALE_ERROR });

    const claim = await claimCloudRun(p.id, { steps: ["research"], run: { id: "fresh", steps: ["research"] } }, Date.now() + CLOUD_STALE_MS + 1000);
    expect(claim.project.pipeline).toMatchObject({ runId: "fresh", current: "research", results: {} });
  });

  it("records a failed step so the page can retry from it", async () => {
    designerMock.researchSong.mockRejectedValue(new Error("Claude 不在"));
    const p = await newProject();
    const events = await step(p.id, "research", { id: "run-9", steps: ["research", "design"] });
    expect(events.at(-1)).toEqual({ type: "error", message: "研究步驟失敗：Claude 不在" });
    const saved = (await getProject(p.id))!;
    expect(saved.status).toBe("error");
    expect(saved.pipeline).toMatchObject({ runId: "run-9", status: "error", failed: "research", current: null, error: "研究步驟失敗：Claude 不在" });
    // a retry is a new request of the same (or a new) run: not busy
    designerMock.researchSong.mockResolvedValue(research);
    const retried = await step(p.id, "research", { id: "run-9", steps: ["research", "design"] });
    expect(retried.at(-1)).toMatchObject({ type: "done", project: { status: "processing" } });
  });

  it("still runs several steps in one request (bounded by the same limit)", async () => {
    designerMock.researchSong.mockResolvedValue(research);
    designerMock.designSong.mockResolvedValue(plan());
    const p = await newProject();
    const request = { steps: ["research", "design"] as Array<"research" | "design"> };
    const events = await collect(runCloudSteps(p.id, request, await claimCloudRun(p.id, request)));
    expect(events.at(-1)).toMatchObject({ type: "done", project: { status: "ready" } });
    const saved = (await getProject(p.id))!;
    expect(saved.pipeline).toMatchObject({ status: "done", steps: ["research", "design"] });
  });

  it("does not resurrect a project deleted during a step", async () => {
    let release!: () => void;
    designerMock.researchSong.mockImplementation(() => new Promise<Research>((resolve) => (release = () => resolve(research))));
    const p = await newProject();
    const request = { steps: ["research"] as Array<"research"> };
    const events = collect(runCloudSteps(p.id, request, await claimCloudRun(p.id, request)));
    await vi.waitFor(() => expect(designerMock.researchSong).toHaveBeenCalled());
    const { deleteProject } = await import("./storage");
    await deleteProject(p.id);
    release();
    expect((await events).at(-1)).toMatchObject({ type: "error" });
    expect(await getProject(p.id)).toBeNull();
    await expect(updateProject(p.id, () => {})).rejects.toMatchObject({ code: "not_found" });
  });
});
