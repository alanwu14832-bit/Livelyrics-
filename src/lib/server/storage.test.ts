import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DesignPlan, SongMeta } from "@/lib/types";
import {
  addAsset,
  assetPath,
  audioPath,
  createProject,
  createUploadTempPath,
  dataDir,
  deleteProject,
  getProject,
  isValidProjectId,
  listProjects,
  newProjectId,
  projectDir,
  removeAsset,
  saveProject,
  StorageError,
  updateProject,
} from "./storage";

let root: string;
const previousEnv = process.env.LIVELYRICS_DATA_DIR;

beforeEach(async () => {
  await fs.mkdir("/tmp/claude-0", { recursive: true });
  root = await fs.mkdtemp("/tmp/claude-0/ll-storage-");
  process.env.LIVELYRICS_DATA_DIR = root;
});

afterEach(async () => {
  if (previousEnv === undefined) delete process.env.LIVELYRICS_DATA_DIR;
  else process.env.LIVELYRICS_DATA_DIR = previousEnv;
  await fs.rm(root, { recursive: true, force: true });
});

const meta: SongMeta = { title: "示範之歌", artist: "Livelyrics Band", duration: 73, fileName: "demo.wav", mimeType: "audio/wav" };

async function upload(content = "RIFF....WAVEfake") {
  const tempPath = await createUploadTempPath();
  await fs.writeFile(tempPath, content);
  return tempPath;
}

function planWithPalette(hexes: string[]): DesignPlan {
  return {
    version: 1,
    keyVisual: {
      title: "t",
      concept: "c",
      moodKeywords: [],
      palette: hexes.map((hex) => ({ hex, role: "r", name: "n" })),
      motifs: [],
      motifSvg: "",
      typography: { cjkFont: "noto-sans-tc", latinFont: "bebas-neue", weight: 700, letterSpacing: 0, rationale: "" },
    },
    sections: [],
    lines: [],
    cues: [],
    designerNotes: "",
  };
}

describe("ids", () => {
  it("generates valid short ids and rejects traversal", () => {
    const id = newProjectId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(isValidProjectId(id)).toBe(true);
    for (const bad of ["", "..", "../etc", "a/b", "a\\b", "A", "a.b", "-a", "a-", "x".repeat(65), "%2e%2e"]) {
      expect(isValidProjectId(bad)).toBe(false);
    }
    expect(() => projectDir("../x")).toThrow(StorageError);
  });

  it("resolves the data dir from the environment", () => {
    expect(dataDir()).toBe(path.resolve(root));
  });
});

describe("projects", () => {
  it("creates, reads, updates and deletes a project", async () => {
    const tempPath = await upload();
    const created = await createProject({ meta, analysis: null, audio: { tempPath, ext: "wav" } });
    expect(created.status).toBe("new");
    expect(created.audioFile).toBe("audio.wav");
    expect(created.lyrics).toEqual({ source: "none", synced: false, lines: [] });
    await expect(fs.stat(tempPath)).rejects.toThrow();
    expect(await fs.readFile(audioPath(created), "utf8")).toBe("RIFF....WAVEfake");

    const read = await getProject(created.id);
    expect(read).toEqual(created);

    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateProject(created.id, (p) => {
      p.status = "error";
      p.error = "boom";
    });
    expect(updated.status).toBe("error");
    expect(updated.error).toBe("boom");
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));

    const saved = await saveProject({ ...updated, status: "ready" });
    expect(saved.error).toBeUndefined();
    expect((await getProject(created.id))!.status).toBe("ready");

    // no temp files left behind by the atomic writes
    const files = await fs.readdir(projectDir(created.id));
    expect(files.sort()).toEqual(["audio.wav", "project.json"]);

    expect(await deleteProject(created.id)).toBe(true);
    expect(await getProject(created.id)).toBeNull();
    expect(await deleteProject(created.id)).toBe(false);
  });

  it("does not recreate a deleted project on save / update", async () => {
    const p = await createProject({ meta, analysis: null, audio: { tempPath: await upload(), ext: "wav" } });
    await deleteProject(p.id);
    await expect(saveProject(p)).rejects.toMatchObject({ code: "not_found" });
    await expect(updateProject(p.id, () => {})).rejects.toMatchObject({ code: "not_found" });
    await expect(fs.stat(projectDir(p.id))).rejects.toThrow();
  });

  it("serializes concurrent updates without losing fields", async () => {
    const p = await createProject({ meta, analysis: null, audio: { tempPath: await upload(), ext: "wav" } });
    await Promise.all([
      updateProject(p.id, (d) => {
        d.meta.title = "A";
      }),
      updateProject(p.id, (d) => {
        d.meta.artist = "B";
      }),
      updateProject(p.id, (d) => {
        d.status = "ready";
      }),
    ]);
    const read = (await getProject(p.id))!;
    expect(read.meta.title).toBe("A");
    expect(read.meta.artist).toBe("B");
    expect(read.status).toBe("ready");
  });

  it("lists summaries newest first with accent and tolerates broken folders", async () => {
    expect(await listProjects()).toEqual([]);
    const a = await createProject({ meta: { ...meta, title: "A" }, analysis: null, audio: { tempPath: await upload(), ext: "wav" } });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createProject({ meta: { ...meta, title: "B" }, analysis: null, audio: { tempPath: await upload(), ext: "mp3" } });
    await new Promise((r) => setTimeout(r, 5));
    await updateProject(a.id, (d) => {
      d.plan = planWithPalette(["#000000", "#ff3366", "#ffffff"]);
    });

    // noise: missing project.json, corrupt json, invalid folder name, stray file
    await fs.mkdir(path.join(root, "projects", "emptyfolder"));
    await fs.mkdir(path.join(root, "projects", "corrupt1"));
    await fs.writeFile(path.join(root, "projects", "corrupt1", "project.json"), "{not json");
    await fs.mkdir(path.join(root, "projects", "Bad.Name"));
    await fs.writeFile(path.join(root, "projects", "stray.txt"), "x");

    const list = await listProjects();
    const ids = list.map((s) => s.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    expect(ids).not.toContain("emptyfolder");
    expect(ids).not.toContain("Bad.Name");
    const summaryA = list.find((s) => s.id === a.id)!;
    expect(summaryA).toMatchObject({ title: "A", artist: "Livelyrics Band", duration: 73, status: "new", accent: "#ff3366" });
    expect(list.find((s) => s.id === b.id)!.accent).toBeUndefined();
    const broken = list.find((s) => s.id === "corrupt1")!;
    expect(broken.status).toBe("error");

    // single-color palette falls back to [0]; cache refreshes after a change
    await updateProject(b.id, (d) => {
      d.plan = planWithPalette(["#123456"]);
    });
    expect((await listProjects()).find((s) => s.id === b.id)!.accent).toBe("#123456");

    await expect(getProject("corrupt1")).rejects.toMatchObject({ code: "corrupt" });
  });

  it("fills defaults for partial project files", async () => {
    await fs.mkdir(path.join(root, "projects", "partial"), { recursive: true });
    await fs.writeFile(path.join(root, "projects", "partial", "project.json"), JSON.stringify({ meta: { title: "x" }, status: "weird" }));
    const p = (await getProject("partial"))!;
    expect(p.id).toBe("partial");
    expect(p.status).toBe("new");
    expect(p.lyrics.lines).toEqual([]);
    expect(p.plan).toBeNull();
    expect(p.meta.title).toBe("x");
    // projects from before band media and custom canvases
    expect(p.assets).toEqual([]);
    expect(p.output).toEqual({
      width: 1920,
      height: 1080,
      preset: "1080p",
      lyricSafe: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
      // and from before LED 安全模式: safe mode on, LED 牆 preset
      safety: { enabled: true, preset: "led", brightness: 0.7, flashLimit: true, redProtect: true, soften: 0.25 },
    });
  });

  it("gives old plan sections media: null", async () => {
    await fs.mkdir(path.join(root, "projects", "oldplan"), { recursive: true });
    const plan = planWithPalette(["#000000", "#ffffff"]);
    const section = { id: "s0", kind: "verse", label: "a", start: 0, end: 10, energy: 0.5, scene: "nebula", sceneParams: { speed: 0.5, density: 0.5, intensity: 0.5, audioReactivity: 0.5 }, colorway: ["#000000", "#ffffff", "#ff0000"], lyricStyle: "line-fade", lyricPlacement: "center", lyricScale: 1, lyricColor: "#ffffff", transitionIn: "fade", rationale: "" };
    await fs.writeFile(path.join(root, "projects", "oldplan", "project.json"), JSON.stringify({ meta, plan: { ...plan, sections: [section] } }));
    const p = (await getProject("oldplan"))!;
    expect(p.plan!.sections[0].media).toBeNull();
  });

  it("adds and removes assets, clearing the plan sections that showed them", async () => {
    const created = await createProject({ meta, analysis: null, audio: { tempPath: await upload(), ext: "wav" } });
    const temp = await upload("\x89PNG fake");
    const asset = { id: "a1b2c3d4e5f6", kind: "image" as const, name: "封面", mimeType: "image/png", file: "a1b2c3d4e5f6.png", width: 10, height: 10, bytes: 9, createdAt: "2026-01-01T00:00:00Z" };
    const withAsset = await addAsset(created.id, asset, temp, 10);
    expect(withAsset.assets).toHaveLength(1);
    await expect(fs.stat(assetPath(created.id, asset))).resolves.toBeTruthy();
    await updateProject(created.id, (p) => {
      p.plan = planWithPalette(["#000000"]);
      p.plan.sections = [{ ...(({}) as DesignPlan["sections"][number]), id: "s0", media: { assetId: asset.id, treatment: "duotone", fit: "cover", opacity: 1, blend: "normal" } }];
    });
    const after = await removeAsset(created.id, asset.id);
    expect(after!.assets).toEqual([]);
    expect(after!.plan!.sections[0].media).toBeNull();
    await expect(fs.stat(assetPath(created.id, asset))).rejects.toThrow();
    expect(await removeAsset(created.id, asset.id)).toBeNull();
    expect(() => assetPath(created.id, { id: "../x", file: "../x.png" })).toThrow();
  });

  it("cleans up when the audio move fails", async () => {
    await expect(
      createProject({ meta, analysis: null, audio: { tempPath: path.join(root, "tmp", "missing.part"), ext: "wav" } }),
    ).rejects.toThrow();
    const dirs = await fs.readdir(path.join(root, "projects"));
    expect(dirs).toEqual([]);
  });
});
