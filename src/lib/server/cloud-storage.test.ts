// Cloud mode end to end on the server side: the storage modules and API routes running on the
// SQL document store (PGlite) and the Blob file store (an in-memory fake of the Blob API).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Asset, DesignPlan, SongMeta } from "@/lib/types";
import { GET as getAudio, HEAD as headAudio } from "@/app/api/projects/[id]/audio/route";
import { POST as postAsset } from "@/app/api/projects/[id]/assets/route";
import { GET as getAsset } from "@/app/api/projects/[id]/assets/[assetId]/route";
import { POST as postBandAsset } from "@/app/api/bands/[id]/assets/route";
import { GET as listProjectsRoute, POST as postProject } from "@/app/api/projects/route";
import { GET as statusRoute } from "@/app/api/status/route";
import { addBandAsset, createBand, createShow, deleteBand, getBand, getShow, listBands, removeBandAsset, withBandAssets } from "./band-storage";
import { addAsset, createProject, deleteProject, getProject, listProjects, removeAsset, updateProject } from "./storage";
import { setStoresForTesting } from "./store";
import { createBlobFileStore, type BlobApi } from "./store/blob-files";
import { createSqlDocumentStore, DOCS_TABLE } from "./store/sql-docs";
import { createFakeBlob, type FakeBlob } from "./store/testing/fake-blob";
import { createTestDatabase, type TestDatabase } from "./store/testing/pglite";

let tdb: TestDatabase;
let blob: FakeBlob;

const WAV = "RIFF\x24\x00\x00\x00WAVEfmt fake audio";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const meta: SongMeta = { title: "示範之歌", artist: "港口", duration: 73, fileName: "demo.wav", mimeType: "audio/wav" };

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

afterEach(() => {
  setStoresForTesting(null);
});

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const jsonReq = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function newSong(bandId?: string) {
  const audio = blob.put("audio/song.wav", WAV, "audio/wav");
  return createProject({ meta, analysis: null, bandId, audio: { blob: audio, ext: "wav" } });
}

function pngAsset(id: string, where: string): Asset {
  const b = blob.put(`${where}/asset.png`, PNG, "image/png");
  return { id, kind: "image", name: "封面", mimeType: "image/png", file: `${id}.png`, width: 10, height: 10, bytes: PNG.length, createdAt: "2026-01-01T00:00:00Z", blob: b };
}

describe("projects in cloud mode", () => {
  it("create, read, list, update and delete; deleting removes the blobs", async () => {
    const p = await newSong();
    expect(p.audioBlob?.url).toMatch(/^https:\/\/teststore\.public\.blob\.vercel-storage\.com\/audio\/song-/);
    const read = (await getProject(p.id))!;
    expect(read).toEqual(p);

    const list = await listProjects();
    expect(list).toEqual([expect.objectContaining({ id: p.id, title: "示範之歌", status: "new", hasPlan: false })]);

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
    const after = (await getProject(p.id))!;
    expect([after.meta.title, after.meta.artist, after.status]).toEqual(["A", "B", "ready"]);
    // the stored listing summary follows every write
    expect((await listProjects())[0]).toMatchObject({ title: "A", status: "ready" });

    const asset = pngAsset("a1b2c3d4e5f6", `projects/${p.id}`);
    await addAsset(p.id, asset, null, 10);
    expect(await deleteProject(p.id)).toBe(true);
    expect(await getProject(p.id)).toBeNull();
    expect(blob.has(p.audioBlob!.url)).toBe(false);
    expect(blob.has(asset.blob!.url)).toBe(false);
    expect(await deleteProject(p.id)).toBe(false);
    await expect(updateProject(p.id, () => {})).rejects.toMatchObject({ code: "not_found" });
  });

  it("adds and removes assets: the blob goes, plan sections that showed it fall back", async () => {
    const p = await newSong();
    const asset = pngAsset("a1b2c3d4e5f6", `projects/${p.id}`);
    const withAsset = await addAsset(p.id, asset, null, 10);
    expect(withAsset.assets.map((a) => a.blob?.url)).toEqual([asset.blob!.url]);
    // the same blob twice is refused (and must not delete it)
    await expect(addAsset(p.id, { ...asset, id: "b1b2c3d4e5f6", file: "b1b2c3d4e5f6.png" }, null, 10)).rejects.toMatchObject({ code: "conflict" });
    await updateProject(p.id, (d) => {
      d.plan = { sections: [{ id: "s0", media: { assetId: asset.id, treatment: "full", fit: "cover", opacity: 1, blend: "normal" } }] } as unknown as DesignPlan;
    });
    const after = (await removeAsset(p.id, asset.id))!;
    expect(after.assets).toEqual([]);
    expect(after.plan!.sections[0].media).toBeNull();
    expect(blob.has(asset.blob!.url)).toBe(false);
    expect(await removeAsset(p.id, asset.id)).toBeNull();
  });
});

describe("bands and shows in cloud mode", () => {
  it("band library, cascades and deletion of its blobs", async () => {
    const band = await createBand("港口");
    const song = await newSong(band.id);
    const logo = pngAsset("cccccccccccc", `bands/${band.id}`);
    const withLogo = await addBandAsset(band.id, logo, null, 10);
    expect(withLogo.assets[0]).toMatchObject({ id: logo.id, scope: "band", blob: logo.blob });
    expect((await withBandAssets((await getProject(song.id))!)).bandAssets?.map((a) => a.id)).toEqual([logo.id]);

    const show = await createShow({ bandId: band.id, name: "巡演" });
    expect((await listBands())[0]).toMatchObject({ id: band.id, songCount: 1, showCount: 1, assetCount: 1 });

    const other = pngAsset("dddddddddddd", `bands/${band.id}`);
    await addBandAsset(band.id, other, null, 10);
    await removeBandAsset(band.id, other.id);
    expect(blob.has(other.blob!.url)).toBe(false);

    expect(await deleteBand(band.id)).toBe(true);
    expect(await getBand(band.id)).toBeNull();
    expect(await getShow(show.id)).toBeNull();
    expect((await getProject(song.id))!.bandId).toBeUndefined();
    expect(blob.has(logo.blob!.url)).toBe(false);
  });
});

describe("cloud upload registration routes", () => {
  it("POST /api/projects registers an uploaded audio blob after checking its bytes", async () => {
    const audio = blob.put("audio/song.mp3", WAV, "audio/mpeg"); // named mp3, really a WAV
    const analysis = { duration: 73, sampleRate: 44100, bpm: 120, bpmConfidence: 0.9, beats: [0.5, 1], envelopeRate: 20, energy: [0.2, 0.4], onset: [], brightness: [], bass: [], peaks: [0.1], sections: [] };
    const res = await postProject(jsonReq("http://x/api/projects", { blob: audio, fileName: "我的歌.mp3", meta: { title: "我的歌", artist: "樂團" }, analysis }), undefined as never);
    expect(res.status).toBe(201);
    const project = await res.json();
    // the sniffed type wins over the name
    expect(project).toMatchObject({ audioFile: "audio.wav", meta: { title: "我的歌", artist: "樂團", mimeType: "audio/wav", duration: 73 }, audioBlob: { url: audio.url } });
    expect(project.analysis.bpm).toBe(120);

    const list = await (await listProjectsRoute(new Request("http://x/api/projects"), undefined as never)).json();
    expect(list.map((p: { id: string }) => p.id)).toEqual([project.id]);
  });

  it("reads only the first bytes and does not wait for the rest of the transfer to be cancelled", async () => {
    // a server that ignores the Range and keeps the body open, and a cancel that never settles
    // (seen under Next's fetch in the dev server, where an awaited cancel hung the registration)
    const audio = blob.put("audio/song.wav", WAV, "audio/wav");
    const stalled: BlobApi = {
      ...blob,
      async fetch() {
        const first = new Uint8Array(200);
        first.set(new TextEncoder().encode(WAV));
        const body = new ReadableStream<Uint8Array>({
          start: (c) => c.enqueue(first),
          cancel: () => new Promise<void>(() => {}),
        });
        return new Response(body, { status: 200, headers: { "content-type": "audio/wav" } });
      },
    };
    setStoresForTesting({ mode: "cloud", docs: createSqlDocumentStore(tdb.client, { retryDelayMs: 0 }), files: createBlobFileStore(stalled) });
    const res = await postProject(jsonReq("http://x/api/projects", { blob: audio, fileName: "x.wav", meta: {} }), undefined as never);
    expect(res.status).toBe(201);
    expect((await res.json()).audioBlob).toEqual({ url: audio.url, pathname: audio.pathname });
  });

  it("rejects and deletes a blob that is not audio; leaves foreign or missing ones alone", async () => {
    const png = blob.put("audio/song.wav", PNG, "audio/wav");
    const bad = await postProject(jsonReq("http://x/api/projects", { blob: png, fileName: "x.wav", meta: {} }), undefined as never);
    expect(bad.status).toBe(415);
    expect((await bad.json()).error).toMatch(/不是音檔/);
    expect(blob.has(png.url)).toBe(false);

    // outside the audio/ prefix: not ours to judge or delete
    const elsewhere = blob.put("projects/zzz/asset.wav", WAV, "audio/wav");
    expect((await postProject(jsonReq("http://x/api/projects", { blob: elsewhere, fileName: "x.wav", meta: {} }), undefined as never)).status).toBe(400);
    expect(blob.has(elsewhere.url)).toBe(true);
    // another host
    const foreign = { url: "https://evil.example.com/audio/song-1.wav", pathname: "audio/song-1.wav" };
    expect((await postProject(jsonReq("http://x/api/projects", { blob: foreign, fileName: "x.wav", meta: {} }), undefined as never)).status).toBe(400);
    // a blob that does not exist
    const gone = { url: "https://teststore.public.blob.vercel-storage.com/audio/song-nope.wav", pathname: "audio/song-nope.wav" };
    const missing = await postProject(jsonReq("http://x/api/projects", { blob: gone, fileName: "x.wav", meta: {} }), undefined as never);
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/找不到上傳的檔案/);
    // a multipart upload cannot work on Vercel (4.5 MB body limit): refused with an explanation
    const form = new FormData();
    form.set("audio", new File([WAV], "x.wav", { type: "audio/wav" }));
    expect((await postProject(new Request("http://x/api/projects", { method: "POST", body: form }), undefined as never)).status).toBe(400);
  });

  it("an unknown band deletes the uploaded audio again", async () => {
    const audio = blob.put("audio/song.wav", WAV, "audio/wav");
    const res = await postProject(jsonReq("http://x/api/projects", { blob: audio, fileName: "x.wav", meta: {}, bandId: "nosuchband" }), undefined as never);
    expect(res.status).toBe(400);
    expect(blob.has(audio.url)).toBe(false);
  });

  it("asset registration sniffs the blob and records it; bad files are deleted", async () => {
    const p = await newSong();
    const good = blob.put(`projects/${p.id}/asset.png`, PNG, "image/png");
    const res = await postAsset(jsonReq("http://x", { blob: good, fileName: "封面.png", width: 1200, height: 800, note: "專輯封面" }), ctx({ id: p.id }));
    expect(res.status).toBe(201);
    const { asset, assets } = await res.json();
    expect(asset).toMatchObject({ kind: "image", mimeType: "image/png", width: 1200, height: 800, bytes: PNG.length, name: "封面", note: "專輯封面", blob: { url: good.url } });
    expect(asset.file).toBe(`${asset.id}.png`);
    expect(assets).toHaveLength(1);

    // served as a redirect to the blob
    const served = await getAsset(new Request("http://x"), ctx({ id: p.id, assetId: asset.id }));
    expect(served.status).toBe(307);
    expect(served.headers.get("location")).toBe(good.url);

    const text = blob.put(`projects/${p.id}/asset.png`, "<svg onload=alert(1)>", "image/png");
    const rejected = await postAsset(jsonReq("http://x", { blob: text, fileName: "a.png", width: 10, height: 10 }), ctx({ id: p.id }));
    expect(rejected.status).toBe(415);
    expect(blob.has(text.url)).toBe(false);

    // another project's prefix
    const q = await newSong();
    const theirs = blob.put(`projects/${q.id}/asset.png`, PNG, "image/png");
    expect((await postAsset(jsonReq("http://x", { blob: theirs, fileName: "a.png", width: 10, height: 10 }), ctx({ id: p.id }))).status).toBe(400);
    expect(blob.has(theirs.url)).toBe(true);

    // bad dimensions: 400 and the blob goes
    const nodims = blob.put(`projects/${p.id}/asset.png`, PNG, "image/png");
    expect((await postAsset(jsonReq("http://x", { blob: nodims, fileName: "a.png" }), ctx({ id: p.id }))).status).toBe(400);
    expect(blob.has(nodims.url)).toBe(false);
  });

  it("band library registration uses the band prefix", async () => {
    const band = await createBand("港口");
    const logo = blob.put(`bands/${band.id}/asset.png`, PNG, "image/png");
    const res = await postBandAsset(jsonReq("http://x", { blob: logo, fileName: "logo.png", width: 512, height: 512, kind: "logo" }), ctx({ id: band.id }));
    expect(res.status).toBe(201);
    expect((await res.json()).asset).toMatchObject({ kind: "logo", scope: "band", blob: { url: logo.url } });
  });
});

describe("serving media in cloud mode", () => {
  it("audio GET / HEAD redirect (307) to the blob with a cacheable redirect", async () => {
    const p = await newSong();
    for (const handler of [getAudio, headAudio]) {
      const res = await handler(new Request("http://x", { headers: { range: "bytes=0-9" } }), ctx({ id: p.id }));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(p.audioBlob!.url);
      expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    }
  });

  it("the proxy delivery forwards Range and streams the bytes", async () => {
    const p = await newSong();
    const store = createBlobFileStore(blob, { delivery: "proxy" });
    const res = await store.serve(new Request("http://x", { headers: { range: "bytes=4-7" } }), { kind: "blob", blob: p.audioBlob! }, {
      contentType: "audio/wav",
      fileName: "demo.wav",
      withBody: true,
      missing: "找不到音檔",
      badRange: "要求的音檔範圍無效",
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 4-7/${WAV.length}`);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(await res.text()).toBe(WAV.slice(4, 8));
  });
});

describe("status", () => {
  it("reports the storage mode without touching storage", async () => {
    const res = await statusRoute(new Request("http://x/api/status"), undefined as never);
    const status = await res.json();
    expect(status.storage).toMatchObject({ mode: "cloud" });
    expect(status.dataDir).toBe("");
    expect(typeof status.auth).toBe("boolean");
  });
});

describe("on Vercel without storage", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["VERCEL", "BLOB_READ_WRITE_TOKEN", "DATABASE_URL", "LIVELYRICS_STORAGE"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("answers 503 with what to create, and the status says so", async () => {
    setStoresForTesting(null);
    process.env.VERCEL = "1";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.LIVELYRICS_STORAGE;
    const res = await listProjectsRoute(new Request("http://x/api/projects"), undefined as never);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/BLOB_READ_WRITE_TOKEN.*DATABASE_URL/);
    const status = await (await statusRoute(new Request("http://x/api/status"), undefined as never)).json();
    expect(status.storage).toEqual({ mode: "unconfigured", cloudConfigured: false, missing: ["BLOB_READ_WRITE_TOKEN", "DATABASE_URL"], onVercel: true });
  });
});
