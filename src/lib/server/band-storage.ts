// Band and show storage on top of the document and file stores (same patterns as projects):
//   local  <dataDir>/bands/<id>/band.json, bands/<id>/assets/<assetId>.<ext>, shows/<id>/show.json
//   cloud  a Postgres row per band / show; band assets in Vercel Blob (Asset.blob)
// Writes are atomic per band and per show (local: the shared lock "band:<id>" / "show:<id>").

import { promises as fs } from "node:fs";
import path from "node:path";
import { asBandAssets } from "@/lib/asset-scope";
import { bibleHasContent, coerceBand, defaultBible, isValidBandId, sanitizeBandName } from "@/lib/band";
import { normalizeOutput } from "@/lib/output";
import { coerceShow, isValidShowId } from "@/lib/show";
import type { Asset, Band, BandSummary, MoodImage, Project, ProjectOutput, Show, ShowSummary } from "@/lib/types";
import { docs, files, type StoredDoc, type StoredFile } from "./store";
import { StorageError, assetFileIn, dataDir, getProject, listProjects, updateProject } from "./storage";

// ---------------------------------------------------------------------------
// paths (local mode)
// ---------------------------------------------------------------------------

export function bandsDir(): string {
  return path.join(dataDir(), "bands");
}

export function showsDir(): string {
  return path.join(dataDir(), "shows");
}

function assertBandId(id: string): void {
  if (!isValidBandId(id)) throw new StorageError("invalid_id", "無效的樂團 ID");
}

function assertShowId(id: string): void {
  if (!isValidShowId(id)) throw new StorageError("invalid_id", "無效的演出 ID");
}

export function bandDir(id: string): string {
  assertBandId(id);
  return path.join(bandsDir(), id);
}

export function bandAssetsDir(id: string): string {
  return path.join(bandDir(id), "assets");
}

export function bandAssetPath(bandId: string, asset: Pick<Asset, "id" | "file">): string {
  return assetFileIn(bandAssetsDir(bandId), asset);
}

/** Where a band library asset is (disk or Blob). */
export function bandAssetFileOf(bandId: string, asset: Asset): StoredFile {
  return asset.blob ? { kind: "blob", blob: asset.blob } : { kind: "disk", path: bandAssetPath(bandId, asset) };
}

// ---------------------------------------------------------------------------
// bands
// ---------------------------------------------------------------------------

function bandFromDoc(doc: StoredDoc): Band {
  try {
    return coerceBand(doc.data, doc.id, doc.updatedAt);
  } catch (err) {
    throw new StorageError("corrupt", err instanceof Error ? err.message : "band.json 無法讀取");
  }
}

async function readBand(id: string): Promise<Band | null> {
  const doc = await docs().get("band", id);
  return doc ? bandFromDoc(doc) : null;
}

/** The stored form: updatedAt bumped; `scope` is implied by where the asset lives (added again on read). */
function bandForWrite(band: Band): Band {
  return {
    ...band,
    updatedAt: new Date().toISOString(),
    assets: band.assets.map((a) => {
      const copy = { ...a };
      delete copy.scope;
      return copy;
    }),
    ...(band.moodboard?.length
      ? {
          moodboard: band.moodboard.map((m) => {
            const copy = { ...m };
            delete copy.scope;
            return copy;
          }),
        }
      : { moodboard: undefined }),
  };
}

function withScope(saved: Band): Band {
  const out: Band = { ...saved, assets: asBandAssets(saved.assets) };
  if (saved.moodboard?.length) out.moodboard = saved.moodboard.map((m) => ({ ...m, scope: "band" as const }));
  else delete out.moodboard;
  return out;
}

/** Atomic read-modify-write of a band; `mutate` returns the next band or null (no change). */
async function modifyBand(id: string, mutate: (current: Band) => Band | null | Promise<Band | null>): Promise<Band> {
  let result: Band | null = null;
  await docs().update("band", id, async (stored) => {
    const current = bandFromDoc(stored);
    const next = await mutate(current);
    if (!next) {
      result = current;
      return null;
    }
    const saved = bandForWrite({ ...next, id });
    result = withScope(saved);
    return { data: saved };
  });
  return result!;
}

export async function createBand(name: string): Promise<Band> {
  const doc = await docs().create("band", async (id) => {
    const now = new Date().toISOString();
    const band: Band = { id, name: sanitizeBandName(name), createdAt: now, updatedAt: now, bible: defaultBible(), assets: [] };
    return { data: bandForWrite(band) };
  });
  return withScope(doc.data as Band);
}

/** null when the band does not exist. */
export async function getBand(id: string): Promise<Band | null> {
  assertBandId(id);
  return readBand(id);
}

export async function updateBand(id: string, mutate: (draft: Band) => Band | void): Promise<Band> {
  assertBandId(id);
  return modifyBand(id, (current) => {
    const draft = structuredClone(current);
    return mutate(draft) ?? draft;
  });
}

/** Every band, newest first, with song / show / asset counts. Unreadable ones are skipped. */
export async function listBands(): Promise<BandSummary[]> {
  const [entries, projects, shows] = await Promise.all([docs().list("band", { map: bandFromDoc }), listProjects(), listShows()]);
  const out: BandSummary[] = [];
  for (const e of entries) {
    if (!("value" in e)) continue;
    const b = e.value;
    const palette = b.bible.palette.map((c) => c.hex).slice(0, 5);
    out.push({
      id: b.id,
      name: b.name,
      updatedAt: b.updatedAt,
      ...(palette.length ? { palette } : {}),
      songCount: projects.filter((p) => p.bandId === b.id).length,
      showCount: shows.filter((s) => s.bandId === b.id).length,
      assetCount: b.assets.length,
      hasBible: bibleHasContent(b.bible),
    });
  }
  return out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** The projects that belong to a band (full records, newest first). */
export async function bandProjects(bandId: string): Promise<Project[]> {
  const summaries = (await listProjects()).filter((p) => p.bandId === bandId);
  const out: Project[] = [];
  for (const s of summaries) {
    const p = await getProject(s.id).catch(() => null);
    if (p && p.bandId === bandId) out.push(p);
  }
  return out;
}

function clearMediaRefs(project: Project, ids: ReadonlySet<string>): boolean {
  if (!project.plan?.sections.some((s) => s.media && ids.has(s.media.assetId))) return false;
  project.plan = { ...project.plan, sections: project.plan.sections.map((s) => (s.media && ids.has(s.media.assetId) ? { ...s, media: null } : s)) };
  return true;
}

/**
 * Delete a band (local: its folder with the library; cloud: its row and library blobs) and its
 * shows. Its songs stay (they become unassigned) and lose the sections that showed band material.
 * False when the band did not exist.
 */
export async function deleteBand(id: string): Promise<boolean> {
  assertBandId(id);
  const band = await readBand(id).catch(() => null);
  const existed = await docs().delete("band", id);
  if (!existed) return false;
  if (band) await files().remove([...band.assets, ...(band.moodboard ?? [])].map((a) => bandAssetFileOf(id, a)));
  const bandAssetIds = new Set((band?.assets ?? []).map((a) => a.id));
  for (const s of (await listProjects()).filter((p) => p.bandId === id)) {
    await updateProject(s.id, (p) => {
      delete p.bandId;
      clearMediaRefs(p, bandAssetIds);
    }).catch(() => {});
  }
  for (const show of (await listShows()).filter((s) => s.bandId === id)) await deleteShow(show.id).catch(() => {});
  return true;
}

/**
 * Record a new band library asset: local mode moves the uploaded temp file into the band's assets
 * folder (under the band lock); cloud mode records `asset.blob` (pass `tempPath: null`).
 */
export async function addBandAsset(id: string, asset: Asset, tempPath: string | null, maxAssets: number): Promise<Band> {
  assertBandId(id);
  let placed: string | null = null;
  try {
    return await modifyBand(id, async (current) => {
      if (current.assets.length >= maxAssets) throw new Error(`樂團素材數量已達上限（${maxAssets} 個）`);
      if (asset.blob && current.assets.some((a) => a.blob?.url === asset.blob!.url)) throw new StorageError("conflict", "這個檔案已經加入過了");
      if (tempPath) {
        const file = bandAssetPath(id, asset);
        await files().place(tempPath, file);
        placed = file;
      }
      return { ...current, assets: [...current.assets, { ...asset, scope: "band" }] };
    });
  } catch (err) {
    if (placed) await fs.rm(placed, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Remove a band asset: its file, its entry, every song section of the band that showed it and
 * every show look that used it. Null when unknown.
 */
export async function removeBandAsset(id: string, assetId: string): Promise<Band | null> {
  assertBandId(id);
  let removed: Asset | null = null;
  const saved = await modifyBand(id, (current) => {
    const asset = current.assets.find((a) => a.id === assetId);
    removed = asset ?? null;
    if (!asset) return null;
    return { ...current, assets: current.assets.filter((a) => a.id !== assetId) };
  });
  const asset = removed as Asset | null;
  if (!asset) return null;
  await files().remove([bandAssetFileOf(id, asset)]).catch(() => {});
  const ids = new Set([assetId]);
  for (const s of (await listProjects()).filter((p) => p.bandId === id)) {
    await updateProject(s.id, (p) => {
      clearMediaRefs(p, ids);
    }).catch(() => {});
  }
  for (const show of (await listShows()).filter((s) => s.bandId === id)) {
    await updateShow(show.id, (sh) => {
      for (const it of sh.items) if (it.kind !== "song" && it.look.media?.assetId === assetId) it.look.media = null;
    }).catch(() => {});
  }
  return saved;
}

/** Ids already used by the band library and its songs' own assets (new ids must avoid them). */
export async function takenAssetIds(bandId: string | undefined): Promise<Set<string>> {
  const out = new Set<string>();
  if (!bandId || !isValidBandId(bandId)) return out;
  const band = await readBand(bandId).catch(() => null);
  for (const a of band?.assets ?? []) out.add(a.id);
  for (const m of band?.moodboard ?? []) out.add(m.id);
  for (const p of await bandProjects(bandId).catch(() => [] as Project[])) {
    for (const a of p.assets) out.add(a.id);
    for (const m of p.moodboard ?? []) out.add(m.id);
  }
  return out;
}

/**
 * Record a band mood board image (same placement rules as addBandAsset; the file sits in the band's
 * assets folder, ids unique across both lists).
 */
export async function addBandMoodImage(id: string, image: MoodImage, tempPath: string | null, max: number): Promise<Band> {
  assertBandId(id);
  let placed: string | null = null;
  try {
    return await modifyBand(id, async (current) => {
      const list = current.moodboard ?? [];
      if (list.length >= max) throw new StorageError("conflict", `參考圖數量已達上限（${max} 張）`);
      if (current.assets.some((a) => a.id === image.id) || list.some((m) => m.id === image.id)) throw new StorageError("conflict", "參考圖 ID 重複，請重新上傳");
      if (image.blob && list.some((m) => m.blob?.url === image.blob!.url)) throw new StorageError("conflict", "這個檔案已經加入過了");
      if (tempPath) {
        const file = bandAssetPath(id, image);
        await files().place(tempPath, file);
        placed = file;
      }
      return { ...current, moodboard: [...list, { ...image, kind: "image", scope: "band" }] };
    });
  } catch (err) {
    if (placed) await fs.rm(placed, { force: true }).catch(() => {});
    throw err;
  }
}

/** Remove a band mood board image and its file. Null when unknown. */
export async function removeBandMoodImage(id: string, imageId: string): Promise<Band | null> {
  assertBandId(id);
  let removed: MoodImage | null = null;
  const saved = await modifyBand(id, (current) => {
    const image = (current.moodboard ?? []).find((m) => m.id === imageId);
    removed = image ?? null;
    if (!image) return null;
    return { ...current, moodboard: (current.moodboard ?? []).filter((m) => m.id !== imageId) };
  });
  const image = removed as MoodImage | null;
  if (!image) return null;
  await files().remove([bandAssetFileOf(id, image)]).catch(() => {});
  return saved;
}

/**
 * The project as the API returns it: with the band's library attached as `bandAssets` (scope
 * "band"). A project whose band is gone reads as unassigned.
 */
export async function withBandAssets(project: Project): Promise<Project> {
  const rest: Project = { ...project };
  delete rest.bandAssets;
  delete rest.bandMoodboard;
  if (!rest.bandId || !isValidBandId(rest.bandId)) return rest;
  const band = await readBand(rest.bandId).catch(() => null);
  if (!band) {
    delete rest.bandId;
    return rest;
  }
  const out: Project = { ...rest, bandAssets: asBandAssets(band.assets) };
  if (band.moodboard?.length) out.bandMoodboard = band.moodboard.map((m) => ({ ...m, scope: "band" as const }));
  return out;
}

// ---------------------------------------------------------------------------
// shows
// ---------------------------------------------------------------------------

function showFromDoc(doc: StoredDoc): Show {
  try {
    return coerceShow(doc.data, doc.id, doc.updatedAt);
  } catch (err) {
    throw new StorageError("corrupt", err instanceof Error ? err.message : "show.json 無法讀取");
  }
}

function showForWrite(show: Show): Show {
  return { ...show, updatedAt: new Date().toISOString() };
}

export async function createShow(input: { bandId: string; name: string; date?: string; venue?: string; output?: ProjectOutput }): Promise<Show> {
  const doc = await docs().create("show", async (id) => {
    const now = new Date().toISOString();
    const show = coerceShow(
      { bandId: input.bandId, name: input.name, date: input.date, venue: input.venue, output: input.output ?? normalizeOutput(null), items: [], notes: "", arc: null, createdAt: now, updatedAt: now },
      id,
      now,
    );
    return { data: showForWrite(show) };
  });
  return doc.data as Show;
}

export async function getShow(id: string): Promise<Show | null> {
  assertShowId(id);
  const doc = await docs().get("show", id);
  return doc ? showFromDoc(doc) : null;
}

export async function updateShow(id: string, mutate: (draft: Show) => Show | void): Promise<Show> {
  assertShowId(id);
  let result: Show | null = null;
  await docs().update("show", id, (stored) => {
    const draft = structuredClone(showFromDoc(stored));
    const saved = showForWrite({ ...(mutate(draft) ?? draft), id });
    result = saved;
    return { data: saved };
  });
  return result!;
}

function summarizeShow(s: Show): ShowSummary {
  return {
    id: s.id,
    bandId: s.bandId,
    name: s.name,
    ...(s.date ? { date: s.date } : {}),
    ...(s.venue ? { venue: s.venue } : {}),
    songCount: s.items.filter((i) => i.kind === "song").length,
    itemCount: s.items.length,
    updatedAt: s.updatedAt,
  };
}

/** Shows (optionally of one band): upcoming dates first, then newest. */
export async function listShows(bandId?: string): Promise<ShowSummary[]> {
  const entries = await docs().list("show", { map: showFromDoc });
  return entries
    .flatMap((e) => ("value" in e ? [e.value] : []))
    .filter((s) => !bandId || s.bandId === bandId)
    .map(summarizeShow)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function deleteShow(id: string): Promise<boolean> {
  assertShowId(id);
  return docs().delete("show", id);
}
