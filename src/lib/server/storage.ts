// Project storage on the local disk:
//   <dataDir>/projects/<id>/project.json   (atomic writes: temp file + rename)
//   <dataDir>/projects/<id>/audio.<ext>
//   <dataDir>/tmp/                          (in-flight uploads)
// Writes to one project are serialized through a per-project lock so the pipeline
// and PATCH requests never clobber each other's fields.

import { randomUUID } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { ASSET_FILE_RE, coerceAssets, isAssetId } from "@/lib/assets";
import { normalizeOutput } from "@/lib/output";
import type { Asset, AudioAnalysis, DesignPlan, Lyrics, Project, ProjectStatus, ProjectSummary, SongMeta } from "@/lib/types";

/** Lowercase letters, digits and inner dashes only: never "." or "/" (no path traversal). */
export const PROJECT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const AUDIO_FILE_RE = /^audio\.[a-z0-9]{1,5}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PROJECT_FILE = "project.json";
const STATUSES: readonly ProjectStatus[] = ["new", "processing", "ready", "error"];
const STALE_TEMP_MS = 12 * 60 * 60 * 1000;

export type StorageErrorCode = "invalid_id" | "not_found" | "corrupt";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

export function dataDir(): string {
  return path.resolve(process.env.LIVELYRICS_DATA_DIR || path.join(process.cwd(), "data"));
}

export function projectsDir(): string {
  return path.join(dataDir(), "projects");
}

function tmpDir(): string {
  return path.join(dataDir(), "tmp");
}

export function isValidProjectId(id: unknown): id is string {
  return typeof id === "string" && PROJECT_ID_RE.test(id);
}

function assertId(id: string): void {
  if (!isValidProjectId(id)) throw new StorageError("invalid_id", "無效的專案 ID");
}

export function projectDir(id: string): string {
  assertId(id);
  return path.join(projectsDir(), id);
}

/** 12 hex chars from a random UUID (48 bits; collisions are checked on create). */
export function newProjectId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function audioPath(project: Pick<Project, "id" | "audioFile">): string {
  if (!AUDIO_FILE_RE.test(project.audioFile)) throw new StorageError("corrupt", "專案的音檔名稱無效");
  return path.join(projectDir(project.id), project.audioFile);
}

export function assetsDir(id: string): string {
  return path.join(projectDir(id), "assets");
}

export function assetPath(projectId: string, asset: Pick<Asset, "id" | "file">): string {
  if (!isAssetId(asset.id) || !ASSET_FILE_RE.test(asset.file) || !asset.file.startsWith(`${asset.id}.`)) {
    throw new StorageError("corrupt", "素材的檔名無效");
  }
  return path.join(assetsDir(projectId), asset.file);
}

function isNodeError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === code;
}

// ---------------------------------------------------------------------------
// per-project write lock (kept on globalThis so Next dev HMR shares one instance)
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & {
  __livelyricsLocks?: Map<string, Promise<void>>;
  __livelyricsSummaryCache?: Map<string, { mtimeMs: number; size: number; summary: ProjectSummary }>;
  __livelyricsTempSwept?: boolean;
};
const locks = (g.__livelyricsLocks ??= new Map());
const summaryCache = (g.__livelyricsSummaryCache ??= new Map());

async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const key = `${dataDir()}::${id}`;
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => current);
  locks.set(key, tail);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

// ---------------------------------------------------------------------------
// JSON files
// ---------------------------------------------------------------------------

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  const json = JSON.stringify(data);
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(json, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Plans saved before `media` existed: every section gets `media: null`. */
function coercePlan(raw: Record<string, unknown>): DesignPlan {
  const plan = raw as unknown as DesignPlan;
  if (!Array.isArray(plan.sections)) return plan;
  let changed = false;
  const sections = plan.sections.map((s) => {
    if (s && typeof s === "object" && (s as { media?: unknown }).media === undefined) {
      changed = true;
      return { ...s, media: null };
    }
    return s;
  });
  return changed ? { ...plan, sections } : plan;
}

/** Fill in defaults for anything missing so older / hand-edited files still load. */
function coerceProject(raw: unknown, id: string, fallbackTime: string): Project {
  if (!isRecord(raw)) throw new StorageError("corrupt", "project.json 不是有效的專案資料");
  const metaRaw = isRecord(raw.meta) ? raw.meta : {};
  const meta: SongMeta = {
    title: str(metaRaw.title),
    artist: str(metaRaw.artist),
    duration: Math.max(0, num(metaRaw.duration)),
    fileName: str(metaRaw.fileName),
    mimeType: str(metaRaw.mimeType, "application/octet-stream"),
  };
  if (typeof metaRaw.album === "string" && metaRaw.album) meta.album = metaRaw.album;
  if (typeof metaRaw.year === "number" && Number.isInteger(metaRaw.year)) meta.year = metaRaw.year;

  const lyricsRaw = isRecord(raw.lyrics) ? raw.lyrics : null;
  const lyrics: Lyrics =
    lyricsRaw && Array.isArray(lyricsRaw.lines)
      ? (lyricsRaw as unknown as Lyrics)
      : { source: "none", synced: false, lines: [] };

  const status = STATUSES.includes(raw.status as ProjectStatus) ? (raw.status as ProjectStatus) : "new";
  const project: Project = {
    id,
    createdAt: str(raw.createdAt, fallbackTime),
    updatedAt: str(raw.updatedAt, fallbackTime),
    status,
    meta,
    audioFile: str(raw.audioFile),
    analysis: isRecord(raw.analysis) ? (raw.analysis as unknown as AudioAnalysis) : null,
    lyrics,
    research: isRecord(raw.research) ? (raw.research as unknown as Project["research"]) : null,
    plan: isRecord(raw.plan) ? coercePlan(raw.plan) : null,
    assets: coerceAssets(raw.assets),
    output: normalizeOutput(raw.output),
  };
  if (typeof raw.error === "string" && raw.error) project.error = raw.error;
  return project;
}

async function readProjectFile(id: string): Promise<Project | null> {
  const file = path.join(projectDir(id), PROJECT_FILE);
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
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StorageError("corrupt", `專案 ${id} 的 project.json 已損毀，無法讀取`);
  }
  return coerceProject(raw, id, mtime.toISOString());
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** A fresh path inside <dataDir>/tmp for streaming an upload (same filesystem as the projects, so rename works). */
export async function createUploadTempPath(): Promise<string> {
  const dir = tmpDir();
  await fs.mkdir(dir, { recursive: true });
  if (!g.__livelyricsTempSwept) {
    g.__livelyricsTempSwept = true;
    void sweepStaleTemp(dir);
  }
  return path.join(dir, `upload-${randomUUID()}.part`);
}

async function sweepStaleTemp(dir: string): Promise<void> {
  try {
    const now = Date.now();
    for (const name of await fs.readdir(dir)) {
      const file = path.join(dir, name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat?.isFile() && now - stat.mtimeMs > STALE_TEMP_MS) await fs.rm(file, { force: true });
    }
  } catch {
    /* best effort */
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (!isNodeError(err, "EXDEV")) throw err;
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}

export interface CreateProjectInput {
  meta: SongMeta;
  analysis: AudioAnalysis | null;
  /** an uploaded file on disk; it is moved into the project folder */
  audio: { tempPath: string; ext: string };
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const ext = input.audio.ext.toLowerCase();
  const audioFile = `audio.${ext}`;
  if (!AUDIO_FILE_RE.test(audioFile)) throw new Error(`不支援的音檔副檔名：${ext}`);
  await fs.mkdir(projectsDir(), { recursive: true });

  let id = "";
  for (let attempt = 0; attempt < 8 && !id; attempt++) {
    const candidate = newProjectId();
    try {
      await fs.mkdir(projectDir(candidate));
      id = candidate;
    } catch (err) {
      if (!isNodeError(err, "EEXIST")) throw err;
    }
  }
  if (!id) throw new Error("無法建立專案資料夾");

  const now = new Date().toISOString();
  const project: Project = {
    id,
    createdAt: now,
    updatedAt: now,
    status: "new",
    meta: input.meta,
    audioFile,
    analysis: input.analysis,
    lyrics: { source: "none", synced: false, lines: [] },
    research: null,
    plan: null,
    assets: [],
    output: normalizeOutput(null),
  };
  const dir = projectDir(id);
  try {
    await moveFile(input.audio.tempPath, path.join(dir, audioFile));
    await writeJsonAtomic(path.join(dir, PROJECT_FILE), project);
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  return project;
}

/** null when the project does not exist; throws StorageError("corrupt") for unreadable files. */
export async function getProject(id: string): Promise<Project | null> {
  assertId(id);
  return readProjectFile(id);
}

async function writeProject(project: Project): Promise<Project> {
  const dir = projectDir(project.id);
  const saved: Project = { ...project, updatedAt: new Date().toISOString() };
  if (saved.status !== "error") delete saved.error;
  try {
    // never recreate a deleted project folder
    await writeJsonAtomic(path.join(dir, PROJECT_FILE), saved);
  } catch (err) {
    if (isNodeError(err, "ENOENT")) throw new StorageError("not_found", "找不到專案（可能已被刪除）");
    throw err;
  }
  return saved;
}

/** Write the whole project (bumps updatedAt). Prefer updateProject for partial changes. */
export async function saveProject(project: Project): Promise<Project> {
  assertId(project.id);
  return withLock(project.id, () => writeProject(project));
}

/**
 * Read-modify-write under the project's lock. The mutator may modify the draft in place
 * or return a replacement. Throws StorageError("not_found") when the project is gone.
 */
export async function updateProject(id: string, mutate: (draft: Project) => Project | void): Promise<Project> {
  assertId(id);
  return withLock(id, async () => {
    const current = await readProjectFile(id);
    if (!current) throw new StorageError("not_found", "找不到專案（可能已被刪除）");
    const draft = structuredClone(current);
    const next = mutate(draft) ?? draft;
    return writeProject({ ...next, id });
  });
}

function summarize(project: Project): ProjectSummary {
  const palette = project.plan?.keyVisual?.palette;
  const accent = [palette?.[1]?.hex, palette?.[0]?.hex].find((c): c is string => typeof c === "string" && HEX_COLOR_RE.test(c));
  const summary: ProjectSummary = {
    id: project.id,
    title: project.meta.title || project.meta.fileName || "未命名歌曲",
    artist: project.meta.artist,
    duration: project.meta.duration || project.analysis?.duration || 0,
    status: project.status,
    updatedAt: project.updatedAt,
  };
  if (accent) summary.accent = accent;
  const colors = (palette ?? [])
    .map((c) => c?.hex)
    .filter((c): c is string => typeof c === "string" && HEX_COLOR_RE.test(c))
    .slice(0, 4);
  if (colors.length) summary.palette = colors;
  if (project.status === "error" && project.error) summary.error = project.error;
  return summary;
}

/** All projects, newest first. Folders without project.json are skipped; corrupt ones are listed as errors so they can be deleted. */
export async function listProjects(): Promise<ProjectSummary[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir(), { withFileTypes: true });
  } catch (err) {
    if (isNodeError(err, "ENOENT")) return [];
    throw err;
  }
  const root = dataDir();
  const results = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && isValidProjectId(e.name))
      .map(async (e): Promise<ProjectSummary | null> => {
        const id = e.name;
        const file = path.join(projectDir(id), PROJECT_FILE);
        const cacheKey = `${root}::${id}`;
        try {
          const stat = await fs.stat(file);
          const cached = summaryCache.get(cacheKey);
          if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.summary;
          const project = await readProjectFile(id);
          if (!project) return null;
          const summary = summarize(project);
          summaryCache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size, summary });
          return summary;
        } catch (err) {
          if (isNodeError(err, "ENOENT")) return null;
          const stat = await fs.stat(path.join(projectsDir(), id)).catch(() => null);
          return {
            id,
            title: "無法讀取的專案",
            artist: err instanceof Error ? err.message : "",
            duration: 0,
            status: "error",
            error: "project.json 無法讀取或已損毀，可以刪除這個專案。",
            updatedAt: (stat?.mtime ?? new Date(0)).toISOString(),
          };
        }
      }),
  );
  const time = (s: ProjectSummary) => {
    const t = Date.parse(s.updatedAt);
    return Number.isFinite(t) ? t : 0;
  };
  return results.filter((s): s is ProjectSummary => s !== null).sort((a, b) => time(b) - time(a));
}

/** Remove the project folder. Returns false when it did not exist. */
export async function deleteProject(id: string): Promise<boolean> {
  assertId(id);
  return withLock(id, async () => {
    const dir = projectDir(id);
    try {
      await fs.stat(dir);
    } catch (err) {
      if (isNodeError(err, "ENOENT")) return false;
      throw err;
    }
    await fs.rm(dir, { recursive: true, force: true });
    summaryCache.delete(`${dataDir()}::${id}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// band media assets (<project>/assets/<id>.<ext>)
// ---------------------------------------------------------------------------

export function newAssetId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * Move an uploaded temp file into the project's assets folder and record it, under the project
 * lock. Throws StorageError("not_found") when the project is gone (the temp file is left for
 * the caller to remove).
 */
export async function addAsset(id: string, asset: Asset, tempPath: string, maxAssets: number): Promise<Project> {
  assertId(id);
  return withLock(id, async () => {
    const current = await readProjectFile(id);
    if (!current) throw new StorageError("not_found", "找不到專案（可能已被刪除）");
    if (current.assets.length >= maxAssets) throw new Error(`素材數量已達上限（${maxAssets} 個）`);
    const dir = assetsDir(id);
    await fs.mkdir(dir, { recursive: true });
    const file = assetPath(id, asset);
    await moveFile(tempPath, file);
    try {
      return await writeProject({ ...current, assets: [...current.assets, asset] });
    } catch (err) {
      await fs.rm(file, { force: true }).catch(() => {});
      throw err;
    }
  });
}

/** Remove an asset: its file, its entry, and every plan section that showed it. False when unknown. */
export async function removeAsset(id: string, assetId: string): Promise<Project | null> {
  assertId(id);
  return withLock(id, async () => {
    const current = await readProjectFile(id);
    if (!current) throw new StorageError("not_found", "找不到專案（可能已被刪除）");
    const asset = current.assets.find((a) => a.id === assetId);
    if (!asset) return null;
    const next: Project = { ...current, assets: current.assets.filter((a) => a.id !== assetId) };
    if (current.plan) {
      next.plan = {
        ...current.plan,
        sections: current.plan.sections.map((s) => (s.media?.assetId === assetId ? { ...s, media: null } : s)),
      };
    }
    const saved = await writeProject(next);
    await fs.rm(assetPath(id, asset), { force: true }).catch(() => {});
    return saved;
  });
}
