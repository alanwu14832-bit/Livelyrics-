import { promises as fs } from "node:fs";
import { MAX_ASSET_BYTES, MAX_ASSETS_PER_PROJECT, isAssetKind, sanitizeAssetName, sanitizeNote, sanitizeTags, validateDimensions } from "@/lib/assets";
import { resolveAssetType } from "@/lib/server/asset-files";
import { sanitizeFileName } from "@/lib/server/audio-files";
import { handle, HttpError, json, requireProjectId } from "@/lib/server/http";
import { parseMultipart } from "@/lib/server/multipart";
import { addAsset, createUploadTempPath, getProject, newAssetId } from "@/lib/server/storage";
import type { Asset, AssetKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const FORM_OVERHEAD_BYTES = 1024 * 1024;

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");
  return json({ assets: project.assets });
});

/** multipart: `file` (image / video) + `meta` JSON { width, height, duration?, name?, kind?, note?, tags? } measured in the browser */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES + FORM_OVERHEAD_BYTES) {
    throw new HttpError(413, `素材太大（上限 ${MAX_ASSET_BYTES / 1024 / 1024} MB）`);
  }
  const existing = await getProject(id);
  if (!existing) throw new HttpError(404, "找不到專案");
  if (existing.assets.length >= MAX_ASSETS_PER_PROJECT) throw new HttpError(409, `素材數量已達上限（${MAX_ASSETS_PER_PROJECT} 個）`);

  const { fields, file } = await parseMultipart(req.body, req.headers.get("content-type"), {
    fileField: "file",
    maxFileBytes: MAX_ASSET_BYTES,
    maxFieldBytes: 64 * 1024,
    tempPath: createUploadTempPath,
    fileLabel: "素材",
  });
  if (!file) throw new HttpError(400, "缺少素材檔案（欄位 file）");

  try {
    if (file.size === 0) throw new HttpError(400, "素材檔案是空的");
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

    const assetId = newAssetId();
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

    const saved = await addAsset(id, asset, file.path, MAX_ASSETS_PER_PROJECT);
    return json({ asset, assets: saved.assets }, { status: 201 });
  } finally {
    // moved into the project on success; otherwise drop the upload
    await fs.rm(file.path, { force: true }).catch(() => {});
  }
});
