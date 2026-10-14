// Round 19 (M6): the lyrics PATCH records how far the timing moved since the design; storage keeps it.

import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchRoute } from "@/app/api/projects/[id]/route";
import type { Lyrics, SongMeta } from "@/lib/types";
import { offlineDesign } from "./designer/offline";
import { demoInput, demoLyrics } from "./designer/testing/fixtures";
import { createProject, createUploadTempPath, getProject, updateProject } from "./storage";

const meta: SongMeta = { title: "Keep On", artist: "Quentin", duration: 73, fileName: "demo.wav", mimeType: "audio/wav" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = async (id: string, body: unknown) => (await patchRoute(new Request("http://x/", { method: "PATCH", body: JSON.stringify(body) }), ctx(id))).json();
const shifted = (l: Lyrics, by: number): Lyrics => ({ ...l, lines: l.lines.map((x) => ({ ...x, start: x.start == null ? null : x.start + by, end: x.end == null ? null : x.end + by })) });

describe("round 19 (M6) · lyric timing changed since the design", () => {
  let root: string;
  const previous = process.env.LIVELYRICS_DATA_DIR;
  beforeEach(async () => {
    await fs.mkdir("/tmp/claude-0", { recursive: true });
    root = await fs.mkdtemp("/tmp/claude-0/ll-timing-");
    process.env.LIVELYRICS_DATA_DIR = root;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.LIVELYRICS_DATA_DIR;
    else process.env.LIVELYRICS_DATA_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("a lyrics save that moves lines by more than 2 s marks the plan; moving them back clears it", async () => {
    const temp = await createUploadTempPath();
    await fs.writeFile(temp, "RIFF....WAVEfake");
    const p = await createProject({ meta, analysis: null, audio: { tempPath: temp, ext: "wav" } });
    const lyrics = demoLyrics();
    await updateProject(p.id, (d) => {
      d.lyrics = lyrics;
      d.plan = offlineDesign(demoInput());
    });
    // a small nudge: nothing to suggest
    const nudged = await patch(p.id, { lyrics: shifted(lyrics, 1) });
    expect(nudged.timingChange.lines).toBe(0);
    // 「AI 自動對時」 moved everything 5 s later
    const moved = await patch(p.id, { lyrics: shifted(lyrics, 5) });
    expect(moved.timingChange.lines).toBeGreaterThan(0);
    // measured against the design's timing, not the nudged save before it
    expect(moved.timingChange.shift).toBeCloseTo(5, 1);
    expect((await getProject(p.id))?.timingChange?.lines).toBe(moved.timingChange.lines);
    // back to the timing the plan was designed with
    const back = await patch(p.id, { lyrics });
    expect(back.timingChange.lines).toBe(0);
  });

  it("a song without a plan has nothing to re-design", async () => {
    const temp = await createUploadTempPath();
    await fs.writeFile(temp, "RIFF....WAVEfake");
    const p = await createProject({ meta, analysis: null, audio: { tempPath: temp, ext: "wav" } });
    await updateProject(p.id, (d) => {
      d.lyrics = demoLyrics();
    });
    expect((await patch(p.id, { lyrics: shifted(demoLyrics(), 9) })).timingChange).toBeUndefined();
  });
});
