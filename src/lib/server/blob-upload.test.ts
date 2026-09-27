// The cloud upload token route: what it accepts, and the client token it signs.

import { getPayloadFromClientToken } from "@vercel/blob/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as tokenRoute } from "@/app/api/blob/upload/route";
import { MAX_ASSETS_PER_PROJECT } from "@/lib/assets";
import type { Asset } from "@/lib/types";
import { uploadPathname, type UploadPayload } from "@/lib/upload-policy";
import { createBand } from "./band-storage";
import { authorizeUpload, parseUploadPayload } from "./blob-upload";
import { createProject, updateProject } from "./storage";
import { setStoresForTesting } from "./store";
import { createBlobFileStore } from "./store/blob-files";
import { createSqlDocumentStore, DOCS_TABLE } from "./store/sql-docs";
import { createFakeBlob } from "./store/testing/fake-blob";
import { createTestDatabase, type TestDatabase } from "./store/testing/pglite";

let tdb: TestDatabase;
const env = { ...process.env };
const TOKEN = "vercel_blob_rw_teststore_0123456789abcdefghij";

beforeAll(async () => {
  tdb = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await tdb?.close();
});

beforeEach(async () => {
  await tdb.db.exec(`DROP TABLE IF EXISTS ${DOCS_TABLE}`);
  setStoresForTesting({ mode: "cloud", docs: createSqlDocumentStore(tdb.client, { retryDelayMs: 0 }), files: createBlobFileStore(createFakeBlob()) });
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
});

afterEach(() => {
  setStoresForTesting(null);
  for (const k of ["BLOB_READ_WRITE_TOKEN", "DATABASE_URL", "VERCEL"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

const payload = (p: Partial<UploadPayload> & Pick<UploadPayload, "target">): string => JSON.stringify({ size: 1234, contentType: "audio/mpeg", ...p });

async function newProject() {
  return createProject({
    meta: { title: "t", artist: "a", duration: 1, fileName: "a.mp3", mimeType: "audio/mpeg" },
    analysis: null,
    audio: { blob: { url: "https://teststore.public.blob.vercel-storage.com/audio/song-x.mp3", pathname: "audio/song-x.mp3" }, ext: "mp3" },
  });
}

describe("authorizeUpload", () => {
  it("signs exactly the declared file: one type, its size, a random suffix", async () => {
    const opts = await authorizeUpload("audio/song.mp3", payload({ target: { kind: "audio" }, size: 5_000_000 }));
    expect(opts).toEqual({
      allowedContentTypes: ["audio/mpeg"],
      maximumSizeInBytes: 5_000_000,
      addRandomSuffix: true,
      allowOverwrite: false,
      tokenPayload: JSON.stringify({ kind: "audio" }),
    });
  });

  it("refuses wrong types, pathnames, sizes and payloads", async () => {
    const audio = { kind: "audio" } as const;
    await expect(authorizeUpload("audio/song.mp3", payload({ target: audio, contentType: "image/png" }))).rejects.toMatchObject({ status: 415 });
    await expect(authorizeUpload("audio/song.exe", payload({ target: audio, contentType: "application/x-msdownload" }))).rejects.toMatchObject({ status: 415 });
    await expect(authorizeUpload("elsewhere/song.mp3", payload({ target: audio }))).rejects.toMatchObject({ status: 400 });
    await expect(authorizeUpload("audio/../song.mp3", payload({ target: audio }))).rejects.toMatchObject({ status: 400 });
    await expect(authorizeUpload("audio/song.mp3", payload({ target: audio, size: 201 * 1024 * 1024 }))).rejects.toMatchObject({ status: 413 });
    await expect(authorizeUpload("audio/song.mp3", payload({ target: audio, size: 0 }))).rejects.toMatchObject({ status: 400 });
    await expect(authorizeUpload("audio/song.mp3", "{not json")).rejects.toMatchObject({ status: 400 });
    await expect(authorizeUpload("audio/song.mp3", null)).rejects.toMatchObject({ status: 400 });
    await expect(authorizeUpload("audio/song.mp3", JSON.stringify({ target: { kind: "other" }, size: 1, contentType: "audio/mpeg" }))).rejects.toMatchObject({ status: 400 });
    // assets: 500 MB, image / video types only
    const target = { kind: "project-asset", projectId: "x" } as const;
    expect(() => parseUploadPayload(JSON.stringify({ target: { kind: "project-asset", projectId: "../x" }, size: 1, contentType: "image/png" }))).toThrow();
    await expect(authorizeUpload(uploadPathname(target, "svg"), payload({ target, contentType: "image/svg+xml" }))).rejects.toMatchObject({ status: 415 });
  });

  it("checks that the project or band exists and has room", async () => {
    const p = await newProject();
    const target = { kind: "project-asset", projectId: p.id } as const;
    const ok = await authorizeUpload(uploadPathname(target, "mp4"), payload({ target, contentType: "video/mp4", size: 400 * 1024 * 1024 }));
    expect(ok.maximumSizeInBytes).toBe(400 * 1024 * 1024);
    await expect(authorizeUpload(uploadPathname(target, "mp4"), payload({ target, contentType: "video/mp4", size: 501 * 1024 * 1024 }))).rejects.toMatchObject({ status: 413 });

    const missing = { kind: "project-asset", projectId: "nosuchproject" } as const;
    await expect(authorizeUpload(uploadPathname(missing, "png"), payload({ target: missing, contentType: "image/png" }))).rejects.toMatchObject({ status: 404 });

    await updateProject(p.id, (d) => {
      d.assets = Array.from({ length: MAX_ASSETS_PER_PROJECT }, (_, i): Asset => {
        const id = i.toString(16).padStart(12, "0");
        return { id, kind: "image", name: "x", mimeType: "image/png", file: `${id}.png`, width: 1, height: 1, bytes: 1, createdAt: "" };
      });
    });
    await expect(authorizeUpload(uploadPathname(target, "png"), payload({ target, contentType: "image/png" }))).rejects.toMatchObject({ status: 409 });

    const band = await createBand("港口");
    const bandTarget = { kind: "band-asset", bandId: band.id } as const;
    await expect(authorizeUpload(uploadPathname(bandTarget, "png"), payload({ target: bandTarget, contentType: "image/png" }))).resolves.toMatchObject({ allowedContentTypes: ["image/png"] });
    const noBand = { kind: "band-asset", bandId: "nosuchband" } as const;
    await expect(authorizeUpload(uploadPathname(noBand, "png"), payload({ target: noBand, contentType: "image/png" }))).rejects.toMatchObject({ status: 404 });
  });
});

describe("POST /api/blob/upload", () => {
  const event = (pathname: string, clientPayload: string) => ({ type: "blob.generate-client-token", payload: { pathname, clientPayload, multipart: false } });
  const post = (body: unknown) => tokenRoute(new Request("http://x/api/blob/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), undefined as never);

  it("returns a client token bound to the pathname and limits", async () => {
    const res = await post(event("audio/song.wav", payload({ target: { kind: "audio" }, size: 777, contentType: "audio/wav" })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("blob.generate-client-token");
    expect(body.clientToken).toMatch(/^vercel_blob_client_teststore_/);
    const signed = getPayloadFromClientToken(body.clientToken);
    expect(signed).toMatchObject({ pathname: "audio/song.wav", maximumSizeInBytes: 777, allowedContentTypes: ["audio/wav"], addRandomSuffix: true, allowOverwrite: false });
    expect(signed.validUntil).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(signed.validUntil).toBeLessThanOrEqual(Date.now() + 61 * 60_000);
    // no completion callback: the browser registers the file itself
    expect((signed as { onUploadCompleted?: unknown }).onUploadCompleted).toBeUndefined();
  });

  it("answers a refused upload with its reason, and nothing else than token requests", async () => {
    const res = await post(event("audio/song.wav", payload({ target: { kind: "audio" }, size: 777, contentType: "image/png" })));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBeTruthy();
    expect((await post({ type: "blob.upload-completed", payload: {} })).status).toBe(400);
  });

  it("is unavailable in local mode and explains itself on an unconfigured deployment", async () => {
    setStoresForTesting(null);
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.DATABASE_URL;
    expect((await post(event("audio/song.wav", payload({ target: { kind: "audio" } })))).status).toBe(400);
    process.env.VERCEL = "1";
    const res = await post(event("audio/song.wav", payload({ target: { kind: "audio" } })));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Blob/);
  });
});
