// Mood board storage (phase 4) and the 設計方向 route, local mode on a temp data dir, plus the
// cloud registration and the server-side image read for Claude's vision input on the fake Blob.

import { promises as fs } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getProjectRoute } from "@/app/api/projects/[id]/route";
import { POST as postAsset } from "@/app/api/projects/[id]/assets/route";
import { GET as listMood, POST as postMood } from "@/app/api/projects/[id]/moodboard/route";
import { DELETE as deleteMood, GET as getMood, PATCH as patchMood } from "@/app/api/projects/[id]/moodboard/[imageId]/route";
import { POST as postBandMood } from "@/app/api/bands/[id]/moodboard/route";
import { POST as directionsRoute } from "@/app/api/projects/[id]/directions/route";
import type { MoodImage, Project, SongMeta } from "@/lib/types";
import { addBandAsset, createBand, deleteBand, getBand, takenAssetIds, withBandAssets } from "./band-storage";
import { designRequestFor, loadVisionImages } from "./directions";
import { assetPath, coerceProject, createProject, createUploadTempPath, deleteProject, getProject, updateProject } from "./storage";
import { setStoresForTesting } from "./store";
import { createBlobFileStore } from "./store/blob-files";
import { createSqlDocumentStore, DOCS_TABLE } from "./store/sql-docs";
import { createFakeBlob, type FakeBlob } from "./store/testing/fake-blob";
import { createTestDatabase, type TestDatabase } from "./store/testing/pglite";
import { demoAnalysis, demoLyrics } from "./designer/testing/fixtures";
import { offlineDesign } from "./designer/offline";

const meta: SongMeta = { title: "示範之歌", artist: "港口", duration: 73, fileName: "demo.wav", mimeType: "audio/wav" };
// a real 1 × 1 PNG (magic bytes are sniffed)
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360f8cf00000301010018dd8db40000000049454e44ae426082", "hex");
const STATS = { palette: ["#e8452c", "#101018"], weights: [0.7, 0.3], luma: 0.3, saturation: 0.7, warmth: 0.5 };

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

function upload(url: string, meta: Record<string, unknown>, bytes: Uint8Array = PNG, name = "海報.png") {
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  form.set("file", new File([new Uint8Array(bytes)], name, { type: "image/png" }));
  return new Request(url, { method: "POST", body: form });
}

async function temp(content = "RIFF....WAVEfmt ") {
  const p = await createUploadTempPath();
  await fs.writeFile(p, content);
  return p;
}

const previousEnv = { dir: process.env.LIVELYRICS_DATA_DIR, key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };

describe("mood board, local mode", () => {
  let root: string;
  beforeEach(async () => {
    await fs.mkdir("/tmp/claude-0", { recursive: true });
    root = await fs.mkdtemp("/tmp/claude-0/ll-mood-");
    process.env.LIVELYRICS_DATA_DIR = root;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });
  afterEach(async () => {
    for (const [k, v] of [
      ["LIVELYRICS_DATA_DIR", previousEnv.dir],
      ["ANTHROPIC_API_KEY", previousEnv.key],
      ["ANTHROPIC_AUTH_TOKEN", previousEnv.token],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  it("uploads, lists, serves, edits and deletes reference images; never as stage media", async () => {
    const p = await createProject({ meta, analysis: null, audio: { tempPath: await temp(), ext: "wav" } });
    const res = await postMood(upload(`http://x/api/projects/${p.id}/moodboard`, { width: 1, height: 1, note: "喜歡這個顏色", stats: { ...STATS, luma: 7 }, kind: "logo", tags: ["x"] }), ctx({ id: p.id }));
    expect(res.status).toBe(201);
    const { image, images } = (await res.json()) as { image: MoodImage; images: MoodImage[] };
    expect(image).toMatchObject({ kind: "image", note: "喜歡這個顏色", stats: { palette: STATS.palette, luma: 1 }, mimeType: "image/png" });
    expect(image.tags).toBeUndefined();
    expect(images).toHaveLength(1);
    // stored next to the assets, but not in the media library or the stage's list
    await fs.access(assetPath(p.id, image));
    const stored = (await getProject(p.id))!;
    expect(stored.assets).toEqual([]);
    expect(stored.moodboard?.map((m) => m.id)).toEqual([image.id]);

    expect((await (await listMood(new Request("http://x"), ctx({ id: p.id }))).json()).images).toHaveLength(1);
    const file = await getMood(new Request("http://x"), ctx({ id: p.id, imageId: image.id }));
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);

    const patched = await patchMood(new Request("http://x", { method: "PATCH", body: JSON.stringify({ note: "這種顆粒感" }) }), ctx({ id: p.id, imageId: image.id }));
    expect((await patched.json()).image.note).toBe("這種顆粒感");
    const cleared = await patchMood(new Request("http://x", { method: "PATCH", body: JSON.stringify({ note: null }) }), ctx({ id: p.id, imageId: image.id }));
    expect((await cleared.json()).image.note).toBeUndefined();

    const del = await deleteMood(new Request("http://x", { method: "DELETE" }), ctx({ id: p.id, imageId: image.id }));
    expect(await del.json()).toEqual({ ok: true, images: [] });
    await expect(fs.access(assetPath(p.id, image))).rejects.toThrow();
    expect((await getProject(p.id))!.moodboard).toBeUndefined();
    expect((await deleteMood(new Request("http://x", { method: "DELETE" }), ctx({ id: p.id, imageId: image.id }))).status).toBe(404);
  });

  it("refuses videos and anything past 12 images; ids never collide with assets", async () => {
    const p = await createProject({ meta, analysis: null, audio: { tempPath: await temp(), ext: "wav" } });
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(16)]);
    const video = await postMood(upload(`http://x/api/projects/${p.id}/moodboard`, { width: 1, height: 1, duration: 2 }, mp4, "clip.mp4"), ctx({ id: p.id }));
    expect(video.status).toBe(415);
    for (let i = 0; i < 12; i++) expect((await postMood(upload(`http://x/api/projects/${p.id}/moodboard`, { width: 1, height: 1 }), ctx({ id: p.id }))).status).toBe(201);
    const over = await postMood(upload(`http://x/api/projects/${p.id}/moodboard`, { width: 1, height: 1 }), ctx({ id: p.id }));
    expect(over.status).toBe(409);
    expect((await over.json()).error).toMatch(/上限/);
    // a media asset afterwards gets an id of its own
    const asset = await postAsset(upload(`http://x/api/projects/${p.id}/assets`, { width: 1, height: 1 }), ctx({ id: p.id }));
    expect(asset.status).toBe(201);
    const stored = (await getProject(p.id))!;
    const ids = new Set([...stored.assets, ...(stored.moodboard ?? [])].map((a) => a.id));
    expect(ids.size).toBe(13);
  });

  it("a band's mood board applies to all its songs (attached on read, band first), and goes with the band", async () => {
    const band = await createBand("港口");
    const song = await createProject({ meta, analysis: null, bandId: band.id, audio: { tempPath: await temp(), ext: "wav" } });
    const res = await postBandMood(upload(`http://x/api/bands/${band.id}/moodboard`, { width: 1, height: 1, note: "樂團的顏色", stats: STATS }), ctx({ id: band.id }));
    expect(res.status).toBe(201);
    const bandImage = (await res.json()).image as MoodImage;
    expect(bandImage.scope).toBe("band");
    await postMood(upload(`http://x/api/projects/${song.id}/moodboard`, { width: 1, height: 1 }), ctx({ id: song.id }));
    expect((await takenAssetIds(band.id)).has(bandImage.id)).toBe(true);
    const read = (await (await getProjectRoute(new Request("http://x"), ctx({ id: song.id }))).json()) as Project;
    expect(read.bandMoodboard?.map((m) => [m.id, m.scope])).toEqual([[bandImage.id, "band"]]);
    expect(read.moodboard).toHaveLength(1);
    // never stored on the project
    await updateProject(song.id, (p) => {
      p.bandMoodboard = read.bandMoodboard;
    });
    const raw = JSON.parse(await fs.readFile(`${root}/projects/${song.id}/project.json`, "utf8"));
    expect(raw.bandMoodboard).toBeUndefined();
    // the designer sees the band's image first, then the song's; the files are read for Claude
    const req = await designRequestFor((await getProject(song.id))!, { vision: true });
    expect(req.moodboard?.map((m) => m.scope ?? "project")).toEqual(["band", "project"]);
    expect(req.moodboardImages?.map((v) => [v.mediaType, Buffer.from(v.data, "base64").equals(PNG)])).toEqual([
      ["image/png", true],
      ["image/png", true],
    ]);
    // a band asset id avoids the mood board ids too
    await addBandAsset(band.id, { id: "bbbbbbbbbbbb", kind: "image", name: "x", mimeType: "image/png", file: "bbbbbbbbbbbb.png", width: 1, height: 1, bytes: 1, createdAt: "" }, await temp("x"), 10);
    expect((await withBandAssets((await getProject(song.id))!)).bandAssets?.map((a) => a.id)).toEqual(["bbbbbbbbbbbb"]);
    expect(await deleteBand(band.id)).toBe(true);
    expect(await getBand(band.id)).toBeNull();
  });

  it("old project files load without a mood board or directions", () => {
    const p = coerceProject({ meta: { title: "舊歌" }, status: "ready", moodboard: "x", directions: { directions: [{ plan: {} }] }, previousPlan: 3 }, "p1", "2026-01-01T00:00:00.000Z");
    expect(p.moodboard).toBeUndefined();
    expect(p.directions).toBeUndefined();
    expect(p.previousPlan).toBeUndefined();
  });

  it("POST /directions: propose offline, comment, revise, select, undo, reject, clear", async () => {
    const p = await createProject({ meta, analysis: demoAnalysis(), audio: { tempPath: await temp(), ext: "wav" } });
    await updateProject(p.id, (d) => {
      d.lyrics = demoLyrics();
      d.status = "ready";
      d.plan = offlineDesign({ meta, lyrics: d.lyrics, analysis: d.analysis });
    });
    await postMood(upload(`http://x/api/projects/${p.id}/moodboard`, { width: 1, height: 1, note: "喜歡這個顏色", stats: STATS }), ctx({ id: p.id }));
    const call = async (body: unknown) => {
      const res = await directionsRoute(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx({ id: p.id }));
      return { status: res.status, body: await res.json() };
    };
    const gen = await call({ action: "generate" });
    expect(gen.status).toBe(200);
    expect(gen.body.engine).toBe("offline");
    const set = (gen.body.project as Project).directions!;
    expect(set.directions.map((d) => d.letter)).toEqual(["A", "B", "C"]);
    // the mood board's red-orange made it into the palettes
    expect(set.directions[0].plan.keyVisual.palette.map((c) => c.hex)).toContain("#e8452c");
    const [a, b] = set.directions;
    expect((await call({ action: "comment", directionId: a.id, text: "顏色很好" })).body.project.directions.directions[0].comments[0].text).toBe("顏色很好");

    const revised = await call({ action: "revise", directionId: a.id, text: "整體藍一點" });
    expect(revised.status).toBe(200);
    const ra = (revised.body.project as Project).directions!.directions[0];
    expect(ra.comments.map((c) => c.kind)).toEqual(["comment", "revision"]);
    expect(ra.plan.keyVisual.palette).not.toEqual(a.plan.keyVisual.palette);

    const before = (await getProject(p.id))!.plan;
    const sel = await call({ action: "select", directionId: b.id });
    const selected = sel.body.project as Project;
    expect(selected.plan!.keyVisual.title).toBe(b.name);
    expect(before).not.toBeNull();
    expect(selected.previousPlan?.plan).toEqual(before);
    expect(selected.directions!.directions[1].status).toBe("selected");
    expect((await call({ action: "status", directionId: b.id, status: "rejected" })).status).toBe(409);
    const undone = (await call({ action: "undo" })).body.project as Project;
    expect(undone.plan).toEqual(before);
    expect(undone.directions!.directions.every((d) => d.status !== "selected")).toBe(true);
    expect((await call({ action: "undo" })).status).toBe(409);
    expect(((await call({ action: "status", directionId: b.id, status: "rejected" })).body.project as Project).directions!.directions[1].status).toBe("rejected");
    expect((await call({ action: "select", directionId: "d00000000" })).status).toBe(404);
    expect((await call({ action: "select" })).status).toBe(400);
    expect((await call({ action: "nope" })).status).toBe(400);
    expect(((await call({ action: "clear" })).body.project as Project).directions).toBeUndefined();
    expect(await deleteProject(p.id)).toBe(true);
  });
});

describe("mood board, cloud mode", () => {
  let tdb: TestDatabase;
  let blob: FakeBlob;
  beforeAll(async () => {
    tdb = await createTestDatabase();
  }, 60_000);
  afterAll(async () => {
    await tdb?.close();
  });
  beforeEach(async () => {
    await tdb.db.exec(`DROP TABLE IF EXISTS ${DOCS_TABLE}`);
    blob = createFakeBlob();
    setStoresForTesting({ mode: "cloud", docs: createSqlDocumentStore(tdb.client, { retryDelayMs: 0 }), files: createBlobFileStore(blob) });
  });
  afterEach(() => setStoresForTesting(null));

  it("registers a Blob upload, reads it back for Claude, and deletes the blob with the project", async () => {
    const audio = blob.put("audio/song.wav", "RIFF\x24\x00\x00\x00WAVEfmt fake audio", "audio/wav");
    const p = await createProject({ meta, analysis: null, audio: { blob: audio, ext: "wav" } });
    const up = blob.put(`projects/${p.id}/asset.png`, new Uint8Array(PNG), "image/png");
    const res = await postMood(
      new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blob: up, fileName: "ref.png", width: 1, height: 1, note: "顆粒", stats: STATS }) }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(201);
    const image = (await res.json()).image as MoodImage;
    expect(image.blob?.url).toBe(up.url);
    expect(image.stats?.palette).toEqual(STATS.palette);
    // the route redirects to the blob
    expect((await getMood(new Request("http://x"), ctx({ id: p.id, imageId: image.id }))).status).toBe(307);
    const stored = (await getProject(p.id))!;
    const { images, skipped } = await loadVisionImages(stored, stored.moodboard!);
    expect(skipped).toEqual([]);
    expect(Buffer.from(images[0].data, "base64").equals(PNG)).toBe(true);
    // a blob under another project's prefix is refused
    const foreign = blob.put("projects/other/asset.png", new Uint8Array(PNG), "image/png");
    const bad = await postMood(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blob: foreign, fileName: "x.png", width: 1, height: 1 }) }), ctx({ id: p.id }));
    expect(bad.status).toBe(400);
    expect(await deleteProject(p.id)).toBe(true);
    expect(blob.has(up.url)).toBe(false);
  });
});
