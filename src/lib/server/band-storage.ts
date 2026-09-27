// Band and show storage on the local disk (same atomic / tolerant patterns as projects):
//   <dataDir>/bands/<id>/band.json          (atomic writes: temp file + rename)
//   <dataDir>/bands/<id>/assets/<assetId>.<ext>
//   <dataDir>/shows/<id>/show.json
// Writes are serialized per band ("band:<id>") and per show ("show:<id>") with the shared lock.

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { asBandAssets } from "@/lib/asset-scope";
import { bibleHasContent, coerceBand, defaultBible, isValidBandId, sanitizeBandName } from "@/lib/band";
import { normalizeOutput } from "@/lib/output";
import { coerceShow, isValidShowId } from "@/lib/show";
import type { Asset, Band, BandSummary, Project, ProjectOutput, Show, ShowSummary } from "@/lib/types";
import {
  StorageError,
  assetFileIn,
  dataDir,
  getProject,
  isNodeError,
  listProjects,
  moveFile,
  newProjectId,
  updateProject,
  withLock,
  writeJsonAtomic,
} from "./storage";

const BAND_FILE = "band.json";
const SHOW_FILE = "show.json";

// ---------------------------------------------------------------------------
// paths
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

function showDir(id: string): string {
  assertShowId(id);
  return path.join(showsDir(), id);
}

async function readJson(file: string, label: string): Promise<{ raw: unknown; mtime: string } | null> {
  let text: string;
  let mtime: Date;
  try {
    const [content, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    text = content;
    mtime = stat.mtime;
  } catch (err) {
    if (isNodeError(err, "ENOENT") || isNodeError(err, "ENOTDIR")) return null;
    throw err;
  }
  try {
    return { raw: JSON.parse(text), mtime: mtime.toISOString() };
  } catch {
    throw new StorageError("corrupt", `${label} 已損毀，無法讀取`);
  }
}

async function makeFolder(parent: string): Promise<string> {
  await fs.mkdir(parent, { recursive: true });
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = newProjectId();
    try {
      await fs.mkdir(path.join(parent, candidate));
      return candidate;
    } catch (err) {
      if (!isNodeError(err, "EEXIST")) throw err;
    }
  }
  throw new Error("無法建立資料夾");
}

async function listFolderIds(dir: string, valid: (id: string) => boolean): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isNodeError(err, "ENOENT")) return [];
    throw err;
  }
  return entries.filter((e) => e.isDirectory() && valid(e.name)).map((e) => e.name);
}

// ---------------------------------------------------------------------------
// bands
// ---------------------------------------------------------------------------

async function readBandFile(id: string): Promise<Band | null> {
  const r = await readJson(path.join(bandDir(id), BAND_FILE), `樂團 ${id} 的 band.json`);
  if (!r) return null;
  try {
    return coerceBand(r.raw, id, r.mtime);
  } catch (err) {
    throw new StorageError("corrupt", err instanceof Error ? err.message : "band.json 無法讀取");
  }
}

async function writeBand(band: Band): Promise<Band> {
  const saved: Band = { ...band, updatedAt: new Date().toISOString(), assets: band.assets.map(({ scope: _scope, ...a }) => a) };
  try {
    await writeJsonAtomic(path.join(bandDir(band.id), BAND_FILE), saved);
  } catch (err) {
    if (isNodeError(err, "ENOENT")) throw new StorageError("not_found", "找不到樂團（可能已被刪除）");
    throw err;
  }
  return { ...saved, assets: asBandAssets(saved.assets) };
}

export async function createBand(name: string): Promise<Band> {
  const id = await makeFolder(bandsDir());
  const now = new Date().toISOString();
  const band: Band = { id, name: sanitizeBandName(name), createdAt: now, updatedAt: now, bible: defaultBible(), assets: [] };
  try {
    return await writeBand(band);
  } catch (err) {
    await fs.rm(bandDir(id), { recursive: true, force: true });
    throw err;
  }
}

/** null when the band does not exist. */
export async function getBand(id: string): Promise<Band | null> {
  assertBandId(id);
  return readBandFile(id);
}

export async function updateBand(id: string, mutate: (draft: Band) => Band | void): Promise<Band> {
  assertBandId(id);
  return withLock(`band:${id}`, async () => {
    const current = await readBandFile(id);
    if (!current) throw new StorageError("not_found", "找不到樂團（可能已被刪除）");
    const draft = structuredClone(current);
    const next = mutate(draft) ?? draft;
    return writeBand({ ...next, id });
  });
}

/** Every band, newest first, with song / show / asset counts. Unreadable ones are skipped. */
export async function listBands(): Promise<BandSummary[]> {
  const ids = await listFolderIds(bandsDir(), isValidBandId);
  const [projects, shows] = await Promise.all([listProjects(), listShows()]);
  const bands = await Promise.all(ids.map((id) => readBandFile(id).catch(() => null)));
  const out: BandSummary[] = [];
  for (const b of bands) {
    if (!b) continue;
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
 * Delete a band folder and its shows. Its songs stay (they become unassigned) and lose the
 * sections that showed band material. False when the band did not exist.
 */
export async function deleteBand(id: string): Promise<boolean> {
  assertBandId(id);
  const band = await readBandFile(id).catch(() => null);
  const existed = await withLock(`band:${id}`, async () => {
    const dir = bandDir(id);
    try {
      await fs.stat(dir);
    } catch (err) {
      if (isNodeError(err, "ENOENT")) return false;
      throw err;
    }
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  });
  if (!existed) return false;
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

/** Move an uploaded temp file into the band library (under the band lock). */
export async function addBandAsset(id: string, asset: Asset, tempPath: string, maxAssets: number): Promise<Band> {
  assertBandId(id);
  return withLock(`band:${id}`, async () => {
    const current = await readBandFile(id);
    if (!current) throw new StorageError("not_found", "找不到樂團（可能已被刪除）");
    if (current.assets.length >= maxAssets) throw new Error(`樂團素材數量已達上限（${maxAssets} 個）`);
    await fs.mkdir(bandAssetsDir(id), { recursive: true });
    const file = bandAssetPath(id, asset);
    await moveFile(tempPath, file);
    try {
      return await writeBand({ ...current, assets: [...current.assets, { ...asset, scope: "band" }] });
    } catch (err) {
      await fs.rm(file, { force: true }).catch(() => {});
      throw err;
    }
  });
}

/**
 * Remove a band asset: its file, its entry, every song section of the band that showed it and
 * every show look that used it. Null when unknown.
 */
export async function removeBandAsset(id: string, assetId: string): Promise<Band | null> {
  assertBandId(id);
  const saved = await withLock(`band:${id}`, async () => {
    const current = await readBandFile(id);
    if (!current) throw new StorageError("not_found", "找不到樂團（可能已被刪除）");
    const asset = current.assets.find((a) => a.id === assetId);
    if (!asset) return null;
    const next = await writeBand({ ...current, assets: current.assets.filter((a) => a.id !== assetId) });
    await fs.rm(bandAssetPath(id, asset), { force: true }).catch(() => {});
    return next;
  });
  if (!saved) return null;
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
  const band = await readBandFile(bandId).catch(() => null);
  for (const a of band?.assets ?? []) out.add(a.id);
  for (const p of await bandProjects(bandId).catch(() => [] as Project[])) for (const a of p.assets) out.add(a.id);
  return out;
}

/**
 * The project as the API returns it: with the band's library attached as `bandAssets` (scope
 * "band"). A project whose band is gone reads as unassigned.
 */
export async function withBandAssets(project: Project): Promise<Project> {
  const { bandAssets: _drop, ...rest } = project;
  if (!rest.bandId || !isValidBandId(rest.bandId)) return rest;
  const band = await readBandFile(rest.bandId).catch(() => null);
  if (!band) {
    const { bandId: _gone, ...unassigned } = rest;
    return unassigned;
  }
  return { ...rest, bandAssets: asBandAssets(band.assets) };
}

// ---------------------------------------------------------------------------
// shows
// ---------------------------------------------------------------------------

async function readShowFile(id: string): Promise<Show | null> {
  const r = await readJson(path.join(showDir(id), SHOW_FILE), `演出 ${id} 的 show.json`);
  if (!r) return null;
  try {
    return coerceShow(r.raw, id, r.mtime);
  } catch (err) {
    throw new StorageError("corrupt", err instanceof Error ? err.message : "show.json 無法讀取");
  }
}

async function writeShow(show: Show): Promise<Show> {
  const saved: Show = { ...show, updatedAt: new Date().toISOString() };
  try {
    await writeJsonAtomic(path.join(showDir(show.id), SHOW_FILE), saved);
  } catch (err) {
    if (isNodeError(err, "ENOENT")) throw new StorageError("not_found", "找不到演出（可能已被刪除）");
    throw err;
  }
  return saved;
}

export async function createShow(input: { bandId: string; name: string; date?: string; venue?: string; output?: ProjectOutput }): Promise<Show> {
  const id = await makeFolder(showsDir());
  const now = new Date().toISOString();
  const show = coerceShow(
    { bandId: input.bandId, name: input.name, date: input.date, venue: input.venue, output: input.output ?? normalizeOutput(null), items: [], notes: "", arc: null, createdAt: now, updatedAt: now },
    id,
    now,
  );
  try {
    return await writeShow(show);
  } catch (err) {
    await fs.rm(showDir(id), { recursive: true, force: true });
    throw err;
  }
}

export async function getShow(id: string): Promise<Show | null> {
  assertShowId(id);
  return readShowFile(id);
}

export async function updateShow(id: string, mutate: (draft: Show) => Show | void): Promise<Show> {
  assertShowId(id);
  return withLock(`show:${id}`, async () => {
    const current = await readShowFile(id);
    if (!current) throw new StorageError("not_found", "找不到演出（可能已被刪除）");
    const draft = structuredClone(current);
    const next = mutate(draft) ?? draft;
    return writeShow({ ...next, id });
  });
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
  const ids = await listFolderIds(showsDir(), isValidShowId);
  const shows = await Promise.all(ids.map((id) => readShowFile(id).catch(() => null)));
  return shows
    .filter((s): s is Show => !!s && (!bandId || s.bandId === bandId))
    .map(summarizeShow)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function deleteShow(id: string): Promise<boolean> {
  assertShowId(id);
  return withLock(`show:${id}`, async () => {
    const dir = showDir(id);
    try {
      await fs.stat(dir);
    } catch (err) {
      if (isNodeError(err, "ENOENT")) return false;
      throw err;
    }
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  });
}
