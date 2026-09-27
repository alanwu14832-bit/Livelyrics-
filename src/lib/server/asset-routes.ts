// The media-library HTTP handlers shared by a project's assets (/api/projects/[id]/assets) and a
// band's shared library (/api/bands/[id]/assets): multipart upload with magic-byte sniffing and
// browser-measured dimensions, Range serving, and name / note / tags / kind edits. Each route
// only says where the list lives and how to store a file.

import { promises as fs } from "node:fs";
import { MAX_ASSET_BYTES, isAssetKind, sanitizeAssetName, sanitizeNote, sanitizeTags, validateDimensions } from "@/lib/assets";
import type { Asset, AssetKind } from "@/lib/types";
import { mimeForAssetFile, resolveAssetType } from "./asset-files";
import { sanitizeFileName } from "./audio-files";
import { serveFile } from "./file-response";
import { HttpError, json, readJson } from "./http";
import { parseMultipart } from "./multipart";
import { createUploadTempPath, newAssetId } from "./storage";
import { applyAssetPatch } from "./validate";

const FORM_OVERHEAD_BYTES = 1024 * 1024;

export interface UploadTarget {
  /** assets already in the library (for the limit) */
  count: number;
  max: number;
  /** ids a new asset must not reuse (the other scope's library) */
  taken?: ReadonlySet<string>;
  /** move the temp file into place and record the asset; resolves with the new list */
  store: (asset: Asset, tempPath: string) => Promise<Asset[]>;
  /** "素材" / "樂團素材" */
  label?: string;
}

/** multipart: `file` (image / video) + `meta` JSON { width, height, duration?, name?, kind?, note?, tags? } -> 201 { asset, assets } */
export async function receiveAssetUpload(req: Request, target: UploadTarget): Promise<Response> {
  const label = target.label ?? "素材";
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES + FORM_OVERHEAD_BYTES) {
    throw new HttpError(413, `${label}太大（上限 ${MAX_ASSET_BYTES / 1024 / 1024} MB）`);
  }
  if (target.count >= target.max) throw new HttpError(409, `${label}數量已達上限（${target.max} 個）`);

  const { fields, file } = await parseMultipart(req.body, req.headers.get("content-type"), {
    fileField: "file",
    maxFileBytes: MAX_ASSET_BYTES,
    maxFieldBytes: 64 * 1024,
    tempPath: createUploadTempPath,
    fileLabel: label,
  });
  if (!file) throw new HttpError(400, `缺少${label}檔案（欄位 file）`);

  try {
    if (file.size === 0) throw new HttpError(400, `${label}檔案是空的`);
    const fileName = sanitizeFileName(file.fileName);
    const type = resolveAssetType(fileName, file.head);
    if (!type.ok) throw new HttpError(415, type.error);

    let meta: Record<string, unknown> = {};
    if (fields.meta?.trim()) {
      try {
        const v = JSON.parse(fields.meta);
        if (v && typeof v === "object" && !Array.isArray(v)) meta = v as Record<string, unknown>;
        else throw new Error();
      } catch {
        throw new HttpError(400, "meta 不是有效的 JSON 物件");
      }
    }
    const dims = validateDimensions(meta, type.video);
    if (!dims.ok) throw new HttpError(400, dims.error);

    let kind: AssetKind = type.video ? "video" : "image";
    if (!type.video && isAssetKind(meta.kind) && meta.kind === "logo") kind = "logo";

    let assetId = newAssetId();
    for (let i = 0; i < 8 && target.taken?.has(assetId); i++) assetId = newAssetId();
    const asset: Asset = {
      id: assetId,
      kind,
      name: sanitizeAssetName(meta.name, sanitizeAssetName(fileName.replace(/\.[^.]+$/, ""))),
      mimeType: type.mimeType,
      file: `${assetId}.${type.ext}`,
      width: dims.width,
      height: dims.height,
      bytes: file.size,
      createdAt: new Date().toISOString(),
    };
    if (dims.duration) asset.duration = dims.duration;
    const note = sanitizeNote(meta.note);
    if (note) asset.note = note;
    const tags = sanitizeTags(meta.tags);
    if (tags) asset.tags = tags;

    const assets = await target.store(asset, file.path);
    return json({ asset: assets.find((a) => a.id === asset.id) ?? asset, assets }, { status: 201 });
  } finally {
    // moved into place on success; otherwise drop the upload
    await fs.rm(file.path, { force: true }).catch(() => {});
  }
}

/** GET / HEAD of a stored asset file with HTTP Range support. */
export function serveAsset(req: Request, file: string, asset: Asset, withBody: boolean): Promise<Response> {
  return serveFile(req, {
    file,
    contentType: asset.mimeType || mimeForAssetFile(asset.file),
    fileName: asset.name ? `${asset.name}.${asset.file.split(".").pop()}` : asset.file,
    withBody,
    missing: "找不到素材檔案",
    badRange: "要求的素材範圍無效",
  });
}

/** Read and validate a PATCH body for an asset; returns the parsed body to apply under the lock. */
export async function readAssetPatch(req: Request, current: Asset): Promise<unknown> {
  const body = await readJson(req, 64 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "請求內容必須是物件 { name?, note?, tags? }");
  applyAssetPatch(current, body); // validate before taking the lock
  return body;
}

/** Apply a validated patch to the asset with `assetId` in `list` (in place); returns the updated asset. */
export function patchAssetInList(list: Asset[], assetId: string, body: unknown): Asset {
  const i = list.findIndex((a) => a.id === assetId);
  if (i < 0) throw new HttpError(404, "找不到素材");
  const updated = applyAssetPatch(list[i], body);
  list[i] = updated;
  return updated;
}
