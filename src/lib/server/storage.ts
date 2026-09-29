// Project storage on top of the document and file stores (src/lib/server/store):
//   local  <dataDir>/projects/<id>/project.json   (atomic writes: temp file + rename)
//          <dataDir>/projects/<id>/audio.<ext>, assets/<assetId>.<ext>
//          <dataDir>/tmp/                          (in-flight uploads)
//   cloud  a Postgres row per project; audio and assets in Vercel Blob (Project.audioBlob,
//          Asset.blob), uploaded by the browser straight to Blob
// Writes to one project are atomic (local: a per-project lock; cloud: optimistic versions) so the
// pipeline and PATCH requests never clobber each other's fields.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ASSET_FILE_RE, coerceAssets, coerceBlobRef, isAssetId } from "@/lib/assets";
import { coerceDirectionSet, coercePlanSnapshot, coercePlanSource } from "@/lib/directions";
import { coerceMoodboard } from "@/lib/moodboard";
import { normalizeOutput } from "@/lib/output";
import { coerceJob } from "@/lib/band";
import type {
  Asset,
  AudioAnalysis,
  BlobRef,
  DesignPlan,
  Lyrics,
  MoodImage,
  PipelineRecord,
  ProcessStepId,
  Project,
  ProjectStatus,
  ProjectSummary,
  SongMeta,
} from "@/lib/types";
import { docs, files, type DocWrite, type StoredDoc, type StoredFile } from "./store";
import { StorageError } from "./store/errors";
import { DOC_ID_RE, isValidDocId, newDocId } from "./store/ids";
import { dataDir } from "./store/local-fs";

export { StorageError, type StorageErrorCode } from "./store/errors";
export { dataDir, isNodeError, moveFile, withLock, writeJsonAtomic } from "./store/local-fs";

/** Lowercase letters, digits and inner dashes only: never "." or "/" (no path traversal). */
export const PROJECT_ID_RE = DOC_ID_RE;
const AUDIO_FILE_RE = /^audio\.[a-z0-9]{1,5}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const STATUSES: readonly ProjectStatus[] = ["new", "processing", "ready", "error"];
const STALE_TEMP_MS = 12 * 60 * 60 * 1000;
/** bump when summarize() changes: stored cloud summaries of another version are recomputed */
const SUMMARY_VERSION = 1;

// ---------------------------------------------------------------------------
// paths (local mode)
// ---------------------------------------------------------------------------

export function projectsDir(): string {
  return path.join(dataDir(), "projects");
}

function tmpDir(): string {
  return path.join(dataDir(), "tmp");
}

export function isValidProjectId(id: unknown): id is string {
  return isValidDocId(id);
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
  return newDocId();
}

export function audioPath(project: Pick<Project, "id" | "audioFile">): string {
  if (!AUDIO_FILE_RE.test(project.audioFile)) throw new StorageError("corrupt", "專案的音檔名稱無效");
  return path.join(projectDir(project.id), project.audioFile);
}

export function assetsDir(id: string): string {
  return path.join(projectDir(id), "assets");
}

/** The stored file of an asset inside an assets/ folder (project or band); validates the name. */
export function assetFileIn(dir: string, asset: Pick<Asset, "id" | "file">): string {
  if (!isAssetId(asset.id) || !ASSET_FILE_RE.test(asset.file) || !asset.file.startsWith(`${asset.id}.`)) {
    throw new StorageError("corrupt", "素材的檔名無效");
  }
  return path.join(dir, asset.file);
}

export function assetPath(projectId: string, asset: Pick<Asset, "id" | "file">): string {
  return assetFileIn(assetsDir(projectId), asset);
}

/** Where the project's audio is (disk or Blob). */
export function audioFileOf(project: Pick<Project, "id" | "audioFile" | "audioBlob">): StoredFile {
  return project.audioBlob ? { kind: "blob", blob: project.audioBlob } : { kind: "disk", path: audioPath(project) };
}

/** Where one of the project's own assets is (disk or Blob). */
export function assetFileOf(projectId: string, asset: Asset): StoredFile {
  return asset.blob ? { kind: "blob", blob: asset.blob } : { kind: "disk", path: assetPath(projectId, asset) };
}

// ---------------------------------------------------------------------------
// coercion (old / hand-edited documents still load)
// ---------------------------------------------------------------------------

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

const STEP_IDS: readonly ProcessStepId[] = ["lyrics", "research", "design"];
const isStep = (v: unknown): v is ProcessStepId => typeof v === "string" && (STEP_IDS as readonly string[]).includes(v);

/** The cloud pipeline record, or undefined when missing / malformed. */
function coercePipeline(raw: unknown): PipelineRecord | undefined {
  if (!isRecord(raw) || typeof raw.runId !== "string" || !Array.isArray(raw.steps)) return undefined;
  const steps = STEP_IDS.filter((s) => (raw.steps as unknown[]).includes(s));
  if (!steps.length) return undefined;
  const status = raw.status === "done" || raw.status === "error" ? raw.status : "running";
  const results: PipelineRecord["results"] = {};
  if (isRecord(raw.results)) {
    for (const s of STEP_IDS) {
      const r = raw.results[s];
      if (!isRecord(r) || (r.status !== "done" && r.status !== "skipped")) continue;
      results[s] = { status: r.status, at: str(r.at), ...(typeof r.message === "string" ? { message: r.message } : {}) };
    }
  }
  const record: PipelineRecord = {
    runId: raw.runId.slice(0, 64),
    steps,
    status,
    current: isStep(raw.current) ? raw.current : null,
    startedAt: str(raw.startedAt),
    updatedAt: str(raw.updatedAt),
    results,
  };
  if (isStep(raw.failed)) record.failed = raw.failed;
  if (typeof raw.error === "string" && raw.error) record.error = raw.error;
  if (typeof raw.instruction === "string" && raw.instruction) record.instruction = raw.instruction;
  if (isRecord(raw.arc)) record.arc = raw.arc as unknown as PipelineRecord["arc"];
  if (raw.free === true) record.free = true;
  return record;
}


/** Fill in defaults for anything missing so older / hand-edited files still load. */
export function coerceProject(raw: unknown, id: string, fallbackTime: string): Project {
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
  // projects created before bands existed have no bandId; bandAssets is never stored
  if (typeof raw.bandId === "string" && PROJECT_ID_RE.test(raw.bandId)) project.bandId = raw.bandId;
  const audioBlob = coerceBlobRef(raw.audioBlob);
  if (audioBlob) project.audioBlob = audioBlob;
  const pipeline = coercePipeline(raw.pipeline);
  if (pipeline) project.pipeline = pipeline;
  // phase 4: mood board, design directions, the plan a direction replaced (old files have none)
  const moodboard = coerceMoodboard(raw.moodboard);
  if (moodboard.length) project.moodboard = moodboard;
  const directions = coerceDirectionSet(raw.directions);
  if (directions) project.directions = directions;
  const previousPlan = coercePlanSnapshot(raw.previousPlan);
  if (previousPlan) project.previousPlan = previousPlan;
  const job = coerceJob(raw.directionsJob);
  if (job) project.directionsJob = job;
  const planSource = project.plan ? coercePlanSource(raw.planSource) : undefined;
  if (planSource) project.planSource = planSource;
  return project;
}

function fromDoc(doc: StoredDoc): Project {
  return coerceProject(doc.data, doc.id, doc.updatedAt);
}

// ---------------------------------------------------------------------------
// summaries
// ---------------------------------------------------------------------------

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
  if (project.bandId) summary.bandId = project.bandId;
  summary.lyricLines = project.lyrics.lines.length;
  summary.lyricsSynced = project.lyrics.synced;
  summary.hasPlan = !!project.plan;
  const colors = (palette ?? [])
    .map((c) => c?.hex)
    .filter((c): c is string => typeof c === "string" && HEX_COLOR_RE.test(c))
    .slice(0, 4);
  if (colors.length) summary.palette = colors;
  if (project.status === "error" && project.error) summary.error = project.error;
  return summary;
}

/** The document write of a project: the project itself plus its listing summary. */
function projectWrite(project: Project): DocWrite {
  return { data: project, summary: { version: SUMMARY_VERSION, value: summarize(project) } };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** A fresh path inside <dataDir>/tmp for streaming an upload (same filesystem as the projects, so rename works). */
export async function createUploadTempPath(): Promise<string> {
  const dir = tmpDir();
  await fs.mkdir(dir, { recursive: true });
  const g = globalThis as typeof globalThis & { __livelyricsTempSwept?: boolean };
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

export interface CreateProjectInput {
  meta: SongMeta;
  /** the band the song belongs to (validated by the caller) */
  bandId?: string;
  analysis: AudioAnalysis | null;
  /**
   * The audio: an uploaded file on disk that is moved into the project folder (local), or a blob
   * the browser uploaded and the route checked (cloud). `ext` is the sniffed type.
   */
  audio: { tempPath: string; ext: string } | { blob: BlobRef; ext: string };
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const ext = input.audio.ext.toLowerCase();
  const audioFile = `audio.${ext}`;
  if (!AUDIO_FILE_RE.test(audioFile)) throw new Error(`不支援的音檔副檔名：${ext}`);
  const audio = input.audio;
  const doc = await docs().create("project", async (id) => {
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
      ...(input.bandId ? { bandId: input.bandId } : {}),
    };
    if ("blob" in audio) project.audioBlob = audio.blob;
    else await files().place(audio.tempPath, path.join(projectDir(id), audioFile));
    return projectWrite(project);
  });
  return doc.data as Project;
}

/** null when the project does not exist; throws StorageError("corrupt") for unreadable files. */
export async function getProject(id: string): Promise<Project | null> {
  assertId(id);
  const doc = await docs().get("project", id);
  return doc ? fromDoc(doc) : null;
}

/** The stored form: updatedAt bumped, error only with status error, no attached band library. */
function forWrite(project: Project): Project {
  const saved: Project = { ...project, updatedAt: new Date().toISOString() };
  if (saved.status !== "error") delete saved.error;
  // the band library and mood board are attached on read, never stored with the project
  delete saved.bandAssets;
  delete saved.bandMoodboard;
  if (saved.moodboard && !saved.moodboard.length) delete saved.moodboard;
  if (!saved.bandId) delete saved.bandId;
  return saved;
}

/** Write the whole project (bumps updatedAt). Prefer updateProject for partial changes. */
export async function saveProject(project: Project): Promise<Project> {
  assertId(project.id);
  const saved = forWrite(project);
  await docs().put("project", project.id, projectWrite(saved));
  return saved;
}

/**
 * Atomic read-modify-write of the stored project. `mutate` gets the coerced current project and
 * returns the next one (not yet prepared for writing), or null to leave it unchanged. In cloud
 * mode it can run again after a concurrent change.
 */
async function modifyProject(id: string, mutate: (current: Project) => Project | null | Promise<Project | null>): Promise<Project> {
  // the last run of `mutate` decides (the cloud store may run it again after a concurrent change)
  let result: Project | null = null;
  await docs().update("project", id, async (stored) => {
    const current = fromDoc(stored);
    const next = await mutate(current);
    if (!next) {
      result = current;
      return null;
    }
    const saved = forWrite({ ...next, id });
    result = saved;
    return projectWrite(saved);
  });
  return result!;
}

/**
 * Read-modify-write under the project's lock (local) or version check (cloud). The mutator may
 * modify the draft in place or return a replacement. Throws StorageError("not_found") when the
 * project is gone.
 */
export async function updateProject(id: string, mutate: (draft: Project) => Project | void): Promise<Project> {
  assertId(id);
  return modifyProject(id, (current) => {
    const draft = structuredClone(current);
    return mutate(draft) ?? draft;
  });
}

/** All projects, newest first. Folders without project.json are skipped; corrupt ones are listed as errors so they can be deleted. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const entries = await docs().list("project", { map: (doc) => summarize(fromDoc(doc)), summary: SUMMARY_VERSION });
  const results = entries.map((e): ProjectSummary =>
    "value" in e
      ? e.value
      : {
          id: e.id,
          title: "無法讀取的專案",
          artist: e.error instanceof Error ? e.error.message : "",
          duration: 0,
          status: "error",
          error: "project.json 無法讀取或已損毀，可以刪除這個專案。",
          updatedAt: e.updatedAt,
        },
  );
  const time = (s: ProjectSummary) => {
    const t = Date.parse(s.updatedAt);
    return Number.isFinite(t) ? t : 0;
  };
  return results.sort((a, b) => time(b) - time(a));
}

/** Every file a project owns (its audio and its own assets). */
function projectFiles(project: Project): StoredFile[] {
  const out: StoredFile[] = [];
  if (project.audioBlob) out.push({ kind: "blob", blob: project.audioBlob });
  for (const a of project.assets) if (a.blob) out.push({ kind: "blob", blob: a.blob });
  for (const m of project.moodboard ?? []) if (m.blob) out.push({ kind: "blob", blob: m.blob });
  return out;
}

/** Remove the project (local: its folder; cloud: its row and blobs). Returns false when it did not exist. */
export async function deleteProject(id: string): Promise<boolean> {
  assertId(id);
  const store = docs();
  // cloud: the files are not inside the document, collect them first
  const existing = store.mode === "cloud" ? await getProject(id).catch(() => null) : null;
  const existed = await store.delete("project", id);
  if (existed && existing) await files().remove(projectFiles(existing));
  return existed;
}

// ---------------------------------------------------------------------------
// band media assets (<project>/assets/<id>.<ext>, or Blob)
// ---------------------------------------------------------------------------

export function newAssetId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * Record a new asset: local mode moves the uploaded temp file into the project's assets folder
 * (inside the project's lock); cloud mode records `asset.blob`, uploaded by the browser (pass
 * `tempPath: null`). Throws StorageError("not_found") when the project is gone (the upload is left
 * for the caller to remove).
 */
export async function addAsset(id: string, asset: Asset, tempPath: string | null, maxAssets: number): Promise<Project> {
  assertId(id);
  let placed: string | null = null;
  try {
    return await modifyProject(id, async (current) => {
      if (current.assets.length >= maxAssets) throw new Error(`素材數量已達上限（${maxAssets} 個）`);
      if (asset.blob && current.assets.some((a) => a.blob?.url === asset.blob!.url)) throw new StorageError("conflict", "這個檔案已經加入過了");
      if (tempPath) {
        const file = assetPath(id, asset);
        await files().place(tempPath, file);
        placed = file;
      }
      return { ...current, assets: [...current.assets, asset] };
    });
  } catch (err) {
    if (placed) await fs.rm(placed, { force: true }).catch(() => {});
    throw err;
  }
}

/** Remove an asset: its file, its entry, and every plan section that showed it. Null when unknown. */
export async function removeAsset(id: string, assetId: string): Promise<Project | null> {
  assertId(id);
  let removed: Asset | null = null;
  const saved = await modifyProject(id, (current) => {
    const asset = current.assets.find((a) => a.id === assetId);
    removed = asset ?? null;
    if (!asset) return null;
    const next: Project = { ...current, assets: current.assets.filter((a) => a.id !== assetId) };
    if (current.plan) {
      next.plan = {
        ...current.plan,
        sections: current.plan.sections.map((s) => (s.media?.assetId === assetId ? { ...s, media: null } : s)),
      };
    }
    return next;
  });
  const asset = removed as Asset | null;
  if (!asset) return null;
  await files().remove([assetFileOf(id, asset)]).catch(() => {});
  return saved;
}

// ---------------------------------------------------------------------------
// mood board (參考圖, phase 4): files next to the assets (<project>/assets/<id>.<ext>, or Blob)
// ---------------------------------------------------------------------------

/** Where one of the project's mood board images is (disk or Blob). */
export function moodFileOf(projectId: string, image: MoodImage): StoredFile {
  return assetFileOf(projectId, image);
}

/**
 * Record a mood board image (same placement rules as addAsset). The id must not collide with an
 * asset: both lists share the assets folder.
 */
export async function addMoodImage(id: string, image: MoodImage, tempPath: string | null, max: number): Promise<Project> {
  assertId(id);
  let placed: string | null = null;
  try {
    return await modifyProject(id, async (current) => {
      const list = current.moodboard ?? [];
      if (list.length >= max) throw new StorageError("conflict", `參考圖數量已達上限（${max} 張）`);
      if (current.assets.some((a) => a.id === image.id) || list.some((m) => m.id === image.id)) throw new StorageError("conflict", "參考圖 ID 重複，請重新上傳");
      if (image.blob && list.some((m) => m.blob?.url === image.blob!.url)) throw new StorageError("conflict", "這個檔案已經加入過了");
      if (tempPath) {
        const file = assetPath(id, image);
        await files().place(tempPath, file);
        placed = file;
      }
      const copy: MoodImage = { ...image, kind: "image" };
      delete copy.scope;
      return { ...current, moodboard: [...list, copy] };
    });
  } catch (err) {
    if (placed) await fs.rm(placed, { force: true }).catch(() => {});
    throw err;
  }
}

/** Remove a mood board image and its file; directions that cited it drop the reference. Null when unknown. */
export async function removeMoodImage(id: string, imageId: string): Promise<Project | null> {
  assertId(id);
  let removed: MoodImage | null = null;
  const saved = await modifyProject(id, (current) => {
    const image = (current.moodboard ?? []).find((m) => m.id === imageId);
    removed = image ?? null;
    if (!image) return null;
    const next: Project = { ...current, moodboard: (current.moodboard ?? []).filter((m) => m.id !== imageId) };
    if (current.directions) {
      next.directions = {
        ...current.directions,
        directions: current.directions.directions.map((d) => ({ ...d, references: d.references.filter((r) => r.imageId !== imageId) })),
      };
    }
    return next;
  });
  const image = removed as MoodImage | null;
  if (!image) return null;
  await files().remove([moodFileOf(id, image)]).catch(() => {});
  return saved;
}
