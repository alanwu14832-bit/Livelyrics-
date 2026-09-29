// Cloud mode (browser only): upload a file straight to Vercel Blob with @vercel/blob/client
// `upload()`. The type is sniffed from the first bytes here first (the same rules the server
// applies afterwards), so a wrong file is refused before any transfer and the token route can sign
// exactly this pathname, type and size. Progress comes from the SDK (0..1).

import { upload } from "@vercel/blob/client";
import { resolveAssetType } from "@/lib/server/asset-files";
import { resolveAudioType } from "@/lib/server/audio-files";
import { MULTIPART_THRESHOLD_BYTES, UPLOAD_TOKEN_ROUTE, uploadLimit, uploadPathname, type UploadPayload, type UploadTarget } from "./upload-policy";
import type { BlobRef } from "./types";

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

async function headOf(file: Blob, n = 64): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, n).arrayBuffer());
}

/** The stored type of an audio file, or an error to show (same rules as the server). */
export async function audioUploadType(file: File): Promise<{ ext: string; mimeType: string }> {
  const type = resolveAudioType(file.name, file.type, await headOf(file));
  if (!type.ok) throw new Error(type.error);
  return type;
}

/** The stored type of an image / video file, or an error to show (same rules as the server). */
export async function assetUploadType(file: File): Promise<{ ext: string; mimeType: string }> {
  const type = resolveAssetType(file.name, await headOf(file));
  if (!type.ok) throw new Error(type.error);
  return type;
}

function describeUploadError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if ((err instanceof Error && err.name === "AbortError") || /request was aborted/i.test(message)) return new DOMException("已取消上傳", "AbortError");
  if (/retrieve the client token/i.test(message)) return new Error("無法取得上傳授權：伺服器拒絕了這個檔案（格式、大小，或作品已不存在），也可能登入已過期");
  if (/file is too large/i.test(message)) return new Error("檔案太大，Vercel Blob 拒絕了這次上傳");
  if (/content ?type/i.test(message)) return new Error("Vercel Blob 不接受這種檔案類型");
  if (/private|public|access/i.test(message)) return new Error(`上傳到 Vercel Blob 失敗（${message}）。請確認 Blob 儲存空間的存取權限是 Public`);
  return new Error(`上傳到 Vercel Blob 失敗：${message.replace(/^Vercel Blob:\s*/, "")}`);
}

/** Upload `file` to Vercel Blob for `target`; resolves with the stored blob (url + pathname). */
export async function uploadToBlob(file: File, target: UploadTarget, type: { ext: string; mimeType: string }, opts: UploadOptions = {}): Promise<BlobRef> {
  const limit = uploadLimit(target);
  if (file.size === 0) throw new Error("檔案是空的");
  if (file.size > limit) throw new Error(`檔案太大（上限 ${limit / 1024 / 1024} MB）`);
  const payload: UploadPayload = { target, size: file.size, contentType: type.mimeType };
  try {
    const blob = await upload(uploadPathname(target, type.ext), file, {
      access: "public",
      handleUploadUrl: UPLOAD_TOKEN_ROUTE,
      clientPayload: JSON.stringify(payload),
      contentType: type.mimeType,
      multipart: file.size > MULTIPART_THRESHOLD_BYTES,
      abortSignal: opts.signal,
      onUploadProgress: (e) => opts.onProgress?.(Math.max(0, Math.min(1, e.percentage / 100))),
    });
    return { url: blob.url, pathname: blob.pathname };
  } catch (err) {
    throw describeUploadError(err);
  }
}
