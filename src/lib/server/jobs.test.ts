// Cloud mode band-level jobs (視覺聖經, 整場弧線): recorded on the document, one at a time, not tied
// to the request's connection, reported stale after the time limit.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));

import { POST as bibleRoute } from "@/app/api/bands/[id]/bible/route";
import { GET as getBandRoute } from "@/app/api/bands/[id]/route";
import { POST as arcRoute } from "@/app/api/shows/[id]/arc/route";
import { GET as getShowRoute } from "@/app/api/shows/[id]/route";
import { createBand, createShow, getBand, getShow, updateBand, updateShow } from "./band-storage";
import { JOB_STALE_MESSAGE, JOB_STALE_MS, isJobRunning, liveJob } from "./jobs";
import { createProject } from "./storage";
import { setStoresForTesting } from "./store";
import { createBlobFileStore } from "./store/blob-files";
import { createSqlDocumentStore, DOCS_TABLE } from "./store/sql-docs";
import { createFakeBlob } from "./store/testing/fake-blob";
import { createTestDatabase, type TestDatabase } from "./store/testing/pglite";

let tdb: TestDatabase;
const savedKey = process.env.ANTHROPIC_API_KEY;

beforeAll(async () => {
  tdb = await createTestDatabase();
  delete process.env.ANTHROPIC_API_KEY;
}, 60_000);

afterAll(async () => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  await tdb?.close();
});

beforeEach(async () => {
  await tdb.db.exec(`DROP TABLE IF EXISTS ${DOCS_TABLE}`);
  setStoresForTesting({ mode: "cloud", docs: createSqlDocumentStore(tdb.client, { retryDelayMs: 0 }), files: createBlobFileStore(createFakeBlob()) });
});

afterEach(() => setStoresForTesting(null));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = () => new Request("http://x", { method: "POST" });

describe("liveJob", () => {
  it("reports a running job that outlived the time limit as failed", () => {
    const now = Date.parse("2026-01-01T00:10:00Z");
    const fresh = { status: "running" as const, startedAt: new Date(now - 10_000).toISOString() };
    const stale = { status: "running" as const, startedAt: new Date(now - JOB_STALE_MS - 1).toISOString() };
    expect(isJobRunning(fresh, now)).toBe(true);
    expect(isJobRunning(stale, now)).toBe(false);
    expect(liveJob(fresh, now)).toBe(fresh);
    expect(liveJob(stale, now)).toEqual({ status: "error", startedAt: stale.startedAt, message: JOB_STALE_MESSAGE });
    expect(liveJob(undefined, now)).toBeUndefined();
  });
});

describe("從作品產生視覺聖經 in cloud mode", () => {
  it("records the job, saves the bible and clears it; refuses a second one while it runs", async () => {
    const band = await createBand("港口");
    const res = await bibleRoute(post(), ctx(band.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.engine).toBe("offline");
    const saved = (await getBand(band.id))!;
    expect(saved.bible.source?.engine).toBe("offline");
    expect(saved.bibleJob).toBeUndefined();

    await updateBand(band.id, (b) => {
      b.bibleJob = { status: "running", startedAt: new Date().toISOString() };
    });
    const busy = await bibleRoute(post(), ctx(band.id));
    expect(busy.status).toBe(409);
    expect((await getBandRoute(new Request("http://x"), ctx(band.id)).then((r) => r.json())).bibleJob.status).toBe("running");

    // a stale one is reported failed and does not block a new run
    await updateBand(band.id, (b) => {
      b.bibleJob = { status: "running", startedAt: new Date(Date.now() - JOB_STALE_MS - 1000).toISOString() };
    });
    expect((await getBandRoute(new Request("http://x"), ctx(band.id)).then((r) => r.json())).bibleJob).toMatchObject({ status: "error", message: JOB_STALE_MESSAGE });
    expect((await bibleRoute(post(), ctx(band.id))).status).toBe(200);
  });
});

describe("整場弧線 in cloud mode", () => {
  it("records the job on the show and saves the arc", async () => {
    const band = await createBand("港口");
    const song = await createProject({
      meta: { title: "第一首", artist: "港口", duration: 200, fileName: "a.wav", mimeType: "audio/wav" },
      analysis: null,
      bandId: band.id,
      audio: { blob: { url: "https://teststore.public.blob.vercel-storage.com/audio/song-a.wav", pathname: "audio/song-a.wav" }, ext: "wav" },
    });
    const show = await createShow({ bandId: band.id, name: "巡演" });
    await updateShow(show.id, (s) => {
      s.items = [{ id: "i1", kind: "song", projectId: song.id }];
    });
    const res = await arcRoute(post(), ctx(show.id));
    expect(res.status).toBe(200);
    const saved = (await getShow(show.id))!;
    expect(saved.arc?.songs).toHaveLength(1);
    expect(saved.arcJob).toBeUndefined();

    await updateShow(show.id, (s) => {
      s.arcJob = { status: "running", startedAt: new Date().toISOString() };
    });
    expect((await arcRoute(post(), ctx(show.id))).status).toBe(409);
    expect((await getShowRoute(new Request("http://x"), ctx(show.id)).then((r) => r.json())).arcJob.status).toBe("running");
  });
});
