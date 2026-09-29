// The token side of cloud uploads (POST /api/blob/upload, @vercel/blob/client handleUpload): the
// browser asks to upload one file to one pathname; this checks what the file is for, its declared
// type and size, and that its project / band exists and has room, and only then signs a client
// token limited to exactly that pathname, that type and that size (with a random suffix). What
// arrives is checked again when the file is registered (magic bytes, see asset-routes.ts).

import { MAX_BAND_ASSETS } from "@/lib/band";
import { MAX_ASSETS_PER_PROJECT } from "@/lib/assets";
import { isUploadTarget, uploadLimit, uploadPathname, uploadTypes, type UploadPayload } from "@/lib/upload-policy";
import { getBand } from "./band-storage";
import { HttpError } from "./http";
import { getProject } from "./storage";
import { StorageError } from "./store/errors";
import { resolveStorageConfig, unconfiguredMessage } from "./store/mode";
import { storageMode } from "./store";

/** The token options handleUpload() signs (a subset of its onBeforeGenerateToken result). */
export interface UploadTokenOptions {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  addRandomSuffix: true;
  allowOverwrite: false;
  tokenPayload: string;
}

export function parseUploadPayload(raw: string | null): UploadPayload {
  let v: unknown;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    throw new HttpError(400, "上傳資料格式錯誤");
  }
  const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (!isUploadTarget(p.target)) throw new HttpError(400, "上傳資料缺少檔案用途");
  const size = typeof p.size === "number" && Number.isFinite(p.size) ? Math.round(p.size) : NaN;
  if (!(size > 0)) throw new HttpError(400, "檔案是空的");
  if (typeof p.contentType !== "string" || !p.contentType) throw new HttpError(400, "上傳資料缺少檔案類型");
  return { target: p.target, size, contentType: p.contentType };
}

/** onBeforeGenerateToken: validate the request and return the token's limits (HttpError otherwise). */
export async function authorizeUpload(pathname: string, clientPayload: string | null): Promise<UploadTokenOptions> {
  const payload = parseUploadPayload(clientPayload);
  const { target, size, contentType } = payload;
  const types = uploadTypes(target);
  const ext = /\.([a-z0-9]{2,5})$/.exec(pathname)?.[1] ?? "";
  if (!types[ext] || types[ext] !== contentType) {
    throw new HttpError(415, target.kind === "audio" ? "不支援這種音檔格式" : "不支援這種素材格式");
  }
  if (pathname !== uploadPathname(target, ext)) throw new HttpError(400, "上傳位置不正確");
  const limit = uploadLimit(target);
  if (size > limit) throw new HttpError(413, `檔案太大（上限 ${limit / 1024 / 1024} MB）`);

  if (target.kind === "project-asset") {
    const project = await getProject(target.projectId);
    if (!project) throw new HttpError(404, "找不到專案");
    if (project.assets.length >= MAX_ASSETS_PER_PROJECT) throw new HttpError(409, `素材數量已達上限（${MAX_ASSETS_PER_PROJECT} 個）`);
  } else if (target.kind === "band-asset") {
    const band = await getBand(target.bandId);
    if (!band) throw new HttpError(404, "找不到樂團");
    if (band.assets.length >= MAX_BAND_ASSETS) throw new HttpError(409, `樂團素材數量已達上限（${MAX_BAND_ASSETS} 個）`);
  }

  return {
    allowedContentTypes: [contentType],
    // exactly the declared file: a different one cannot ride on this token
    maximumSizeInBytes: size,
    addRandomSuffix: true,
    allowOverwrite: false,
    tokenPayload: JSON.stringify(target),
  };
}

/** The read-write token for signing uploads; 503 when cloud storage is missing, 400 in local mode. */
export function requireUploadToken(): string {
  const config = resolveStorageConfig();
  if (storageMode() === "unconfigured") throw new StorageError("unconfigured", unconfiguredMessage(config));
  if (storageMode() !== "cloud") throw new HttpError(400, "本機模式不使用雲端上傳，請直接上傳檔案。");
  if (!config.blobToken) throw new StorageError("unconfigured", unconfiguredMessage({ missing: ["BLOB_READ_WRITE_TOKEN"], blobStoreWithoutToken: config.blobStoreWithoutToken }));
  return config.blobToken;
}
