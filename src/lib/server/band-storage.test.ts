import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Asset, SongMeta } from "@/lib/types";
import {
  addBandAsset,
  bandAssetPath,
  createBand,
  createShow,
  deleteBand,
  getBand,
  getShow,
  listBands,
  listShows,
  removeBandAsset,
  takenAssetIds,
  updateBand,
  updateShow,
  withBandAssets,
} from "./band-storage";
import { coerceProject, createProject, createUploadTempPath, getProject, listProjects, projectDir, updateProject } from "./storage";

let root: string;
const previousEnv = process.env.LIVELYRICS_DATA_DIR;

beforeEach(async () => {
  await fs.mkdir("/tmp/claude-0", { recursive: true });
  root = await fs.mkdtemp("/tmp/claude-0/ll-bands-");
  process.env.LIVELYRICS_DATA_DIR = root;
});

afterEach(async () => {
  if (previousEnv === undefined) delete process.env.LIVELYRICS_DATA_DIR;
  else process.env.LIVELYRICS_DATA_DIR = previousEnv;
  await fs.rm(root, { recursive: true, force: true });
});

const meta: SongMeta = { title: "示範之歌", artist: "港口", duration: 73, fileName: "demo.wav", mimeType: "audio/wav" };

async function temp(content = "x") {
  const p = await createUploadTempPath();
  await fs.writeFile(p, content);
  return p;
}

const logo = (id: string): Asset => ({ id, kind: "logo", name: "logo", mimeType: "image/png", file: `${id}.png`, width: 10, height: 10, bytes: 1, createdAt: "" });

describe("old project files", () => {
  it("load without a bandId and never keep bandAssets", () => {
    const p = coerceProject({ meta: { title: "舊歌" }, status: "ready", bandAssets: [logo("aaaaaaaaaaaa")] }, "p1", "2026-01-01T00:00:00.000Z");
    expect(p.bandId).toBeUndefined();
    expect(p.bandAssets).toBeUndefined();
    expect(p.assets).toEqual([]);
    expect(coerceProject({ bandId: "../x" }, "p1", "").bandId).toBeUndefined();
    expect(coerceProject({ bandId: "b1" }, "p1", "").bandId).toBe("b1");
  });
});

describe("bands", () => {
  it("creates, lists with counts, attaches the library to songs, and deletes", async () => {
    const band = await createBand("  港口  ");
    expect(band.name).toBe("港口");
    expect(band.bible.palette).toEqual([]);
    expect((await getBand(band.id))!.name).toBe("港口");

    const song = await createProject({ meta, analysis: null, bandId: band.id, audio: { tempPath: await temp(), ext: "wav" } });
    expect(song.bandId).toBe(band.id);
    const lone = await createProject({ meta, analysis: null, audio: { tempPath: await temp(), ext: "wav" } });

    const withAsset = await addBandAsset(band.id, logo("bbbbbbbbbbbb"), await temp("PNG"), 10);
    expect(withAsset.assets[0].scope).toBe("band");
    expect(await fs.readFile(bandAssetPath(band.id, withAsset.assets[0]), "utf8")).toBe("PNG");
    const stored = JSON.parse(await fs.readFile(path.join(root, "bands", band.id, "band.json"), "utf8"));
    expect(stored.assets[0].scope).toBeUndefined();

    const read = await withBandAssets((await getProject(song.id))!);
    expect(read.bandAssets?.map((a) => [a.id, a.scope])).toEqual([["bbbbbbbbbbbb", "band"]]);
    expect((await withBandAssets((await getProject(lone.id))!)).bandAssets).toBeUndefined();
    // bandAssets is never written back with the project
    await updateProject(song.id, (p) => {
      p.bandAssets = read.bandAssets;
    });
    expect(JSON.parse(await fs.readFile(path.join(projectDir(song.id), "project.json"), "utf8")).bandAssets).toBeUndefined();

    expect([...(await takenAssetIds(band.id))]).toEqual(["bbbbbbbbbbbb"]);
    const summaries = (await listProjects()).filter((p) => p.bandId === band.id);
    expect(summaries.map((s) => s.id)).toEqual([song.id]);
    expect(summaries[0].hasPlan).toBe(false);

    const show = await createShow({ bandId: band.id, name: "巡演" });
    const list = await listBands();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: band.id, songCount: 1, showCount: 1, assetCount: 1, hasBible: false });

    await updateBand(band.id, (b) => {
      b.name = "港口樂團";
    });
    expect((await getBand(band.id))!.name).toBe("港口樂團");

    expect(await deleteBand(band.id)).toBe(true);
    expect(await getBand(band.id)).toBeNull();
    expect(await getShow(show.id)).toBeNull();
    // the song stays, unassigned
    expect((await getProject(song.id))!.bandId).toBeUndefined();
    expect(await deleteBand(band.id)).toBe(false);
  });

  it("removing a band asset clears the songs and show looks that used it", async () => {
    const band = await createBand("港口");
    await addBandAsset(band.id, logo("cccccccccccc"), await temp(), 10);
    const song = await createProject({ meta, analysis: null, bandId: band.id, audio: { tempPath: await temp(), ext: "wav" } });
    await updateProject(song.id, (p) => {
      p.plan = {
        version: 1,
        keyVisual: { title: "t", concept: "c", moodKeywords: [], palette: [{ hex: "#000000", role: "r", name: "n" }], motifs: [], motifSvg: "", typography: { cjkFont: "noto-sans-tc", latinFont: "anton", weight: 700, letterSpacing: 0, rationale: "" } },
        sections: [
          { id: "s0", kind: "intro", label: "前奏", start: 0, end: 73, energy: 0.3, scene: "motif", sceneParams: { speed: 0.3, density: 0.3, intensity: 0.5, audioReactivity: 0.3 }, colorway: ["#000000", "#111111", "#222222"], lyricStyle: "hidden", lyricPlacement: "center", lyricScale: 1, lyricColor: "#ffffff", transitionIn: "fade", media: { assetId: "cccccccccccc", treatment: "full", fit: "contain", opacity: 1, blend: "screen" }, rationale: "" },
        ],
        lines: [],
        cues: [],
        designerNotes: "",
      };
    });
    const show = await createShow({ bandId: band.id, name: "巡演" });
    await updateShow(show.id, (s) => {
      s.items = [{ id: "w1", kind: "walk-in", title: "進場", look: { scene: "motif", colorway: ["#000000", "#111111", "#222222"], media: { assetId: "cccccccccccc", treatment: "full", fit: "contain", opacity: 1, blend: "screen" } } }];
    });
    const after = await removeBandAsset(band.id, "cccccccccccc");
    expect(after!.assets).toEqual([]);
    expect((await getProject(song.id))!.plan!.sections[0].media).toBeNull();
    const s = await getShow(show.id);
    expect(s!.items[0].kind !== "song" && s!.items[0].look.media).toBeNull();
    expect(await removeBandAsset(band.id, "cccccccccccc")).toBeNull();
    expect((await listShows(band.id)).map((x) => x.id)).toEqual([show.id]);
    expect(await listShows("other")).toEqual([]);
  });
});
