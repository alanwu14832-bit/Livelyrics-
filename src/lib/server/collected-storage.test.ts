// 研究找到的素材 (phase 8): storage round trip and removal, local and cloud, and the routes.

import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { stageAssets } from "@/lib/asset-scope";
import type { CollectedVisual, DesignPlan, SongMeta } from "@/lib/types";
import { GET as listRoute, POST as postRoute } from "@/app/api/projects/[id]/collected/route";
import { DELETE as deleteRoute, GET as getItemRoute, PATCH as patchRoute } from "@/app/api/projects/[id]/collected/[itemId]/route";
import { GET as getAssetRoute } from "@/app/api/projects/[id]/assets/[assetId]/route";
import { createBand, getBand } from "./band-storage";
import { acknowledgeAuthorization, authorizationFor, removeCollected, setCollectedUse, storeCollected, type IncomingVisual } from "./collected-storage";
import { assetPath, createProject, createUploadTempPath, getProject, updateProject } from "./storage";
import { setStoresForTesting } from "./store";
import { createBlobFileStore } from "./store/blob-files";
import { createSqlDocumentStore, DOCS_TABLE } from "./store/sql-docs";
import { createFakeBlob, type FakeBlob } from "./store/testing/fake-blob";
import { createTestDatabase, type TestDatabase } from "./store/testing/pglite";

const FIX = path.resolve(__dirname, "../../../fixtures/visuals");
const COVER = new Uint8Array(readFileSync(path.join(FIX, "cover.jpg")));
const STILL = new Uint8Array(readFileSync(path.join(FIX, "still.jpg")));
const meta: SongMeta = { title: "大風吹", artist: "草東沒有派對", duration: 73, fileName: "demo.wav", mimeType: "audio/wav" };
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

function incoming(kind: "cover" | "mv", bytes: Uint8Array, hash: string, imageUrl: string, use: "stage" | "reference" = "reference"): IncomingVisual {
  return {
    ext: "jpg",
    bytes,
    item: {
      kind: "image",
      name: kind === "cover" ? "專輯封面《醜奴兒》" : "MV 畫面",
      mimeType: "image/jpeg",
      width: 600,
      height: 600,
      bytes: bytes.length,
      createdAt: "2026-09-30T00:00:00Z",
      provenance: { kind, imageUrl, foundBy: kind === "cover" ? "cover-art-archive" : "youtube", fetchedAt: "2026-09-30T00:00:00Z", authorization: "尚未確認樂團授權：只當設計參考，不上台" },
      use,
      useSetBy: "auto",
      hash,
      stats: { palette: ["#0d3a3f", "#fa7a1d"], weights: [0.7, 0.3], luma: 0.3, saturation: 0.7, warmth: 0.1 },
    },
  };
}

function planShowing(assetId: string): DesignPlan {
  return {
    version: 1,
    keyVisual: { title: "t", concept: "c", moodKeywords: [], palette: [], motifs: [], motifSvg: "", typography: { cjkFont: "noto-sans-tc", latinFont: "bebas-neue", weight: 700, letterSpacing: 0, rationale: "" } },
    sections: [
      { id: "s0", label: "前奏", kind: "intro", start: 0, end: 10, energy: 0.2, scene: "gradient", sceneParams: { speed: 0.5, density: 0.5, intensity: 0.5, reactivity: 0.5 }, colorway: ["#000000", "#ffffff", "#ff0000"], lyricStyle: "hidden", lyricPlacement: "center", transitionIn: "fade", rationale: "", media: { assetId, treatment: "duotone", fit: "cover", opacity: 0.7, blend: "normal" } },
    ],
    lines: [],
    cues: [],
    designerNotes: "",
  } as unknown as DesignPlan;
}

describe("local mode", () => {
  let root: string;
  const previous = process.env.LIVELYRICS_DATA_DIR;
  beforeEach(async () => {
    await fs.mkdir("/tmp/claude-0", { recursive: true });
    root = await fs.mkdtemp("/tmp/claude-0/ll-collected-");
    process.env.LIVELYRICS_DATA_DIR = root;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.LIVELYRICS_DATA_DIR;
    else process.env.LIVELYRICS_DATA_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  });

  async function song(bandId?: string) {
    const temp = await createUploadTempPath();
    await fs.writeFile(temp, "RIFF....WAVEfake");
    return createProject({ meta, analysis: null, bandId, audio: { tempPath: temp, ext: "wav" } });
  }

  it("stores, dedupes on a refresh, toggles, and removes both uses (file, entry, sections)", async () => {
    const p = await song();
    const first = await storeCollected(p.id, [incoming("cover", COVER, "aaaaaaaaaaaaaaaa", "https://coverartarchive.org/1.jpg"), incoming("mv", STILL, "bbbbbbbbbbbbbbbb", "https://i.ytimg.com/vi/x/hqdefault.jpg")]);
    expect(first.added).toHaveLength(2);
    const [cover, still] = first.project.collected!;
    expect(cover.id).toMatch(/^[0-9a-f]{12}$/);
    expect(cover.file).toBe(`${cover.id}.jpg`);
    expect(new Uint8Array(await fs.readFile(assetPath(p.id, cover)))).toEqual(COVER);
    // a reload keeps everything (coercion round trip)
    const loaded = await getProject(p.id);
    expect(loaded!.collected!.map((c) => [c.id, c.provenance.kind, c.use, c.hash])).toEqual([
      [cover.id, "cover", "reference", "aaaaaaaaaaaaaaaa"],
      [still.id, "mv", "reference", "bbbbbbbbbbbbbbbb"],
    ]);
    expect(loaded!.collected![0].stats?.palette).toEqual(["#0d3a3f", "#fa7a1d"]);

    // re-running research: the same images (by hash or URL) are not stored again
    const again = await storeCollected(p.id, [incoming("cover", COVER, "aaaaaaaaaaaaaaaa", "https://coverartarchive.org/other.jpg"), incoming("mv", STILL, "cccccccccccccccc", "https://i.ytimg.com/vi/x/hqdefault.jpg")]);
    expect(again.added).toHaveLength(0);
    expect(again.project.collected).toHaveLength(2);
    expect((await fs.readdir(path.join(root, "projects", p.id, "assets"))).sort()).toEqual([cover.file, still.file].sort());

    // 可以上台: in the stage assets; the plan may show it
    const staged = await setCollectedUse(p.id, cover.id, "stage");
    expect(stageAssets(staged!).map((a) => a.id)).toContain(cover.id);
    await updateProject(p.id, (d) => {
      d.plan = planShowing(cover.id);
    });
    // 只當參考: off the stage, and the section that showed it goes back to the scene
    const ref = await setCollectedUse(p.id, cover.id, "reference");
    expect(stageAssets(ref!).map((a) => a.id)).not.toContain(cover.id);
    expect(ref!.plan!.sections[0].media).toBeNull();
    expect(ref!.collected![0].useSetBy).toBe("user");

    // 移除: the file, the entry, the section; a refresh does not bring it back
    await setCollectedUse(p.id, still.id, "stage");
    await updateProject(p.id, (d) => {
      d.plan = planShowing(still.id);
    });
    const removed = await removeCollected(p.id, still.id);
    expect(removed!.collected!.map((c) => c.id)).toEqual([cover.id]);
    expect(removed!.plan!.sections[0].media).toBeNull();
    expect(removed!.collectedDismissed).toEqual(expect.arrayContaining(["bbbbbbbbbbbbbbbb", "https://i.ytimg.com/vi/x/hqdefault.jpg"]));
    await expect(fs.stat(assetPath(p.id, still))).rejects.toThrow();
    const refresh = await storeCollected(p.id, [incoming("mv", STILL, "bbbbbbbbbbbbbbbb", "https://i.ytimg.com/vi/x/hqdefault.jpg")]);
    expect(refresh.added).toHaveLength(0);
    expect(await removeCollected(p.id, "ffffffffffff")).toBeNull();
  });

  it("the authorization lives on the band (every song) and turns automatic defaults into 可以上台", async () => {
    const band = await createBand("草東沒有派對");
    const p = await song(band.id);
    await storeCollected(p.id, [incoming("cover", COVER, "aaaaaaaaaaaaaaaa", "https://coverartarchive.org/1.jpg"), incoming("mv", STILL, "bbbbbbbbbbbbbbbb", "https://i.ytimg.com/vi/x/hqdefault.jpg")]);
    const chosen = (await getProject(p.id))!.collected![1];
    await setCollectedUse(p.id, chosen.id, "reference"); // the operator's own choice stays
    expect(await authorizationFor(p)).toBeNull();
    const { project, authorization } = await acknowledgeAuthorization(p.id);
    expect(authorization.note).toMatch(/授權/);
    expect((await getBand(band.id))!.materialAuthorization?.at).toBe(authorization.at);
    expect(project.materialAuthorization).toBeUndefined();
    expect(project.collected!.map((c) => c.use)).toEqual(["stage", "reference"]);
    const other = await song(band.id);
    expect((await authorizationFor(other))?.at).toBe(authorization.at);
    // a band-less song keeps its own
    const alone = await song();
    await acknowledgeAuthorization(alone.id, "本人創作，可以使用");
    expect((await getProject(alone.id))!.materialAuthorization?.note).toBe("本人創作，可以使用");
  });

  it("routes: list, authorize, serve (and the asset route for items on stage), patch, delete", async () => {
    const p = await song();
    const { project } = await storeCollected(p.id, [incoming("cover", COVER, "aaaaaaaaaaaaaaaa", "https://coverartarchive.org/1.jpg")]);
    const id = project.collected![0].id;
    const list = await (await listRoute(new Request("http://x/"), ctx({ id: p.id }))).json();
    expect(list.items).toHaveLength(1);
    expect(list.authorization).toBeNull();
    const file = await getItemRoute(new Request("http://x/"), ctx({ id: p.id, itemId: id }));
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(COVER);
    // not on stage yet: the asset route does not serve it
    expect((await getAssetRoute(new Request("http://x/"), ctx({ id: p.id, assetId: id }))).status).toBe(404);
    const bad = await patchRoute(new Request("http://x/", { method: "PATCH", body: JSON.stringify({ use: "everywhere" }) }), ctx({ id: p.id, itemId: id }));
    expect(bad.status).toBe(400);
    const auth = await postRoute(new Request("http://x/", { method: "POST", body: JSON.stringify({ action: "authorize" }) }), ctx({ id: p.id }));
    expect((await auth.json()).items[0].use).toBe("stage");
    expect((await getAssetRoute(new Request("http://x/"), ctx({ id: p.id, assetId: id }))).status).toBe(200);
    const patched = await (await patchRoute(new Request("http://x/", { method: "PATCH", body: JSON.stringify({ use: "reference" }) }), ctx({ id: p.id, itemId: id }))).json();
    expect(patched.item.use).toBe("reference");
    const del = await (await deleteRoute(new Request("http://x/", { method: "DELETE" }), ctx({ id: p.id, itemId: id }))).json();
    expect(del.items).toEqual([]);
    expect((await getItemRoute(new Request("http://x/"), ctx({ id: p.id, itemId: id }))).status).toBe(404);
  });
});

describe("cloud mode", () => {
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

  it("writes the images to Blob under the project's prefix and deletes them on removal", async () => {
    const audio = blob.put("audio/song.wav", "RIFF....WAVE", "audio/wav");
    const p = await createProject({ meta, analysis: null, audio: { blob: audio, ext: "wav" } });
    const { project } = await storeCollected(p.id, [incoming("cover", COVER, "aaaaaaaaaaaaaaaa", "https://coverartarchive.org/1.jpg")]);
    const item = project.collected![0] as CollectedVisual;
    expect(item.blob?.pathname).toMatch(new RegExp(`^projects/${p.id}/collected-r[0-9a-z]+\\.jpg$`));
    expect(blob.has(item.blob!.url)).toBe(true);
    const served = await getItemRoute(new Request("http://x/"), ctx({ id: p.id, itemId: item.id }));
    expect(served.status).toBe(307);
    expect(served.headers.get("location")).toBe(item.blob!.url);
    await removeCollected(p.id, item.id);
    expect(blob.has(item.blob!.url)).toBe(false);
  });
});
