// Accepted band-media formats: magic-byte sniffing decides the stored extension and
// Content-Type (never the declared name or MIME alone). SVG is rejected on purpose: it is
// a document that can carry scripts and external references.

import { ASSET_FORMATS_LABEL } from "@/lib/assets";
import { extensionOf } from "./audio-files";

export type MediaFamily = "png" | "jpeg" | "webp" | "gif" | "mp4" | "mov" | "webm";

export const ASSET_TYPES: Readonly<Record<MediaFamily, { ext: string; mimeType: string; video: boolean }>> = {
  png: { ext: "png", mimeType: "image/png", video: false },
  jpeg: { ext: "jpg", mimeType: "image/jpeg", video: false },
  webp: { ext: "webp", mimeType: "image/webp", video: false },
  gif: { ext: "gif", mimeType: "image/gif", video: false },
  mp4: { ext: "mp4", mimeType: "video/mp4", video: true },
  mov: { ext: "mov", mimeType: "video/quicktime", video: true },
  webm: { ext: "webm", mimeType: "video/webm", video: true },
};

/** extension -> Content-Type for serving a stored "<id>.<ext>" file */
const EXT_MIME: Readonly<Record<string, string>> = Object.fromEntries(Object.values(ASSET_TYPES).map((t) => [t.ext, t.mimeType]));

export type MediaSniff = { kind: "media"; family: MediaFamily } | { kind: "rejected"; label: string } | { kind: "unknown" };

function ascii(head: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < head.length; i++) out += String.fromCharCode(head[i]);
  return out;
}

/** Identify an image / video container from its first bytes. */
export function sniffMedia(head: Uint8Array): MediaSniff {
  if (head.length < 4) return { kind: "unknown" };
  if (head[0] === 0x89 && ascii(head, 1, 3) === "PNG") return { kind: "media", family: "png" };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: "media", family: "jpeg" };
  if (ascii(head, 0, 4) === "GIF8") return { kind: "media", family: "gif" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return { kind: "media", family: "webp" };
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { kind: "media", family: "webm" };
  if (ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    if (brand === "qt  ") return { kind: "media", family: "mov" };
    // audio-only MP4 brands are not video material
    if (brand === "M4A " || brand === "M4B " || brand === "M4P ") return { kind: "rejected", label: "音檔（M4A）" };
    if (/^(heic|heix|mif1|msf1|avif)$/.test(brand)) return { kind: "rejected", label: "HEIC／AVIF 圖片（請先轉成 JPG 或 PNG）" };
    return { kind: "media", family: "mp4" };
  }
  // QuickTime files without an ftyp box start with another atom
  if (/^(moov|mdat|wide|free|skip|pnot)$/.test(ascii(head, 4, 4))) return { kind: "media", family: "mov" };
  if (ascii(head, 0, 3) === "ID3" || ascii(head, 0, 4) === "fLaC" || ascii(head, 0, 4) === "OggS" || (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE")) {
    return { kind: "rejected", label: "音檔" };
  }
  if (ascii(head, 0, 4) === "%PDF") return { kind: "rejected", label: "PDF 文件" };
  if (ascii(head, 0, 2) === "PK") return { kind: "rejected", label: "壓縮檔" };
  const text = ascii(head, 0, Math.min(head.length, 64)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (text.startsWith("<?xml") || text.startsWith("<svg") || text.startsWith("<!doctype") || text.startsWith("<html")) {
    return { kind: "rejected", label: "SVG 或 HTML 文件（基於安全考量不支援 SVG，請轉成 PNG）" };
  }
  if (text.startsWith("<") || text.startsWith("{") || text.startsWith("[")) return { kind: "rejected", label: "文字檔" };
  return { kind: "unknown" };
}

export type AssetTypeResult = { ok: true; family: MediaFamily; ext: string; mimeType: string; video: boolean } | { ok: false; error: string };

/** Decide the stored type from the content. Unknown content is rejected (no fallback to the file name). */
export function resolveAssetType(fileName: string, head: Uint8Array): AssetTypeResult {
  const sniff = sniffMedia(head);
  if (sniff.kind === "rejected") return { ok: false, error: `不支援這個檔案（看起來是${sniff.label}）。支援格式：${ASSET_FORMATS_LABEL}` };
  if (sniff.kind === "unknown") {
    const ext = extensionOf(fileName);
    return { ok: false, error: `無法辨識的檔案格式${ext ? `（.${ext}）` : ""}。支援格式：${ASSET_FORMATS_LABEL}` };
  }
  const t = ASSET_TYPES[sniff.family];
  return { ok: true, family: sniff.family, ext: t.ext, mimeType: t.mimeType, video: t.video };
}

export function mimeForAssetFile(file: string): string {
  return EXT_MIME[extensionOf(file)] ?? "application/octet-stream";
}
