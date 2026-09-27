// Band media assets: limits and pure validation shared by the upload UI, the API routes and the
// designer (no Node or DOM APIs here).

import type { Asset, AssetKind } from "./types";

export const MAX_ASSET_BYTES = 500 * 1024 * 1024;
export const MAX_ASSETS_PER_PROJECT = 200;
/** Asset ids: 12 lowercase hex characters (never "." or "/"). */
export const ASSET_ID_RE = /^[a-f0-9]{12}$/;
/** Stored file names: "<id>.<ext>". */
export const ASSET_FILE_RE = /^[a-f0-9]{12}\.[a-z0-9]{2,5}$/;

export const ASSET_KINDS: readonly AssetKind[] = ["image", "video", "logo"];
export const MAX_ASSET_PX = 16384;
export const MAX_VIDEO_SECONDS = 4 * 3600;
export const MAX_NOTE = 500;
export const MAX_NAME = 120;
export const MAX_TAGS = 12;
export const MAX_TAG = 24;

/** File picker `accept` for the upload UI (SVG deliberately excluded: it can carry scripts). */
export const ASSET_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,.gif,.mp4,.m4v,.webm,.mov";
export const ASSET_FORMATS_LABEL = "PNG、JPG、WebP、GIF、MP4、WebM、MOV";

export function isAssetId(v: unknown): v is string {
  return typeof v === "string" && ASSET_ID_RE.test(v);
}

export function isAssetKind(v: unknown): v is AssetKind {
  return typeof v === "string" && (ASSET_KINDS as readonly string[]).includes(v);
}

export function isVideoAsset(a: Pick<Asset, "kind" | "mimeType">): boolean {
  return a.kind === "video" || a.mimeType.startsWith("video/");
}

function cleanLine(s: string, max: number): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function sanitizeAssetName(v: unknown, fallback = "素材"): string {
  const s = typeof v === "string" ? cleanLine(v, MAX_NAME) : "";
  return s || fallback;
}

export function sanitizeNote(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  // keep line breaks inside a note, drop other control characters
  const s = v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, MAX_NOTE);
  return s || undefined;
}

/** Tags: trimmed, de-duplicated (case-insensitive), at most MAX_TAGS of MAX_TAG chars. Accepts "a, b、c" too. */
export function sanitizeTags(v: unknown): string[] | undefined {
  const raw: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,，、;；\n]/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = cleanLine(item.replace(/^#/, ""), MAX_TAG);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out.length ? out : undefined;
}

export type DimensionResult = { ok: true; width: number; height: number; duration?: number } | { ok: false; error: string };

/**
 * The browser-measured size sent with an upload. Width/height must be whole pixels in
 * 1..MAX_ASSET_PX; videos need a duration in (0, MAX_VIDEO_SECONDS].
 */
export function validateDimensions(raw: { width?: unknown; height?: unknown; duration?: unknown }, video: boolean): DimensionResult {
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
  const w = num(raw.width);
  const h = num(raw.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > MAX_ASSET_PX || h > MAX_ASSET_PX) {
    return { ok: false, error: `素材尺寸無效（寬高需在 1 到 ${MAX_ASSET_PX} 像素之間）` };
  }
  const out: { ok: true; width: number; height: number; duration?: number } = { ok: true, width: Math.round(w), height: Math.round(h) };
  if (video) {
    const d = num(raw.duration);
    if (!Number.isFinite(d) || d <= 0 || d > MAX_VIDEO_SECONDS) return { ok: false, error: "影片長度無效" };
    out.duration = Math.round(d * 1000) / 1000;
  }
  return out;
}

/** Stored-asset list from project.json, dropping anything malformed (old / hand-edited files). */
export function coerceAssets(raw: unknown): Asset[] {
  if (!Array.isArray(raw)) return [];
  const out: Asset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const a = item as Record<string, unknown>;
    if (!isAssetId(a.id) || seen.has(a.id)) continue;
    if (typeof a.file !== "string" || !ASSET_FILE_RE.test(a.file) || !a.file.startsWith(`${a.id}.`)) continue;
    const kind = isAssetKind(a.kind) ? a.kind : typeof a.mimeType === "string" && a.mimeType.startsWith("video/") ? "video" : "image";
    const mimeType = typeof a.mimeType === "string" ? a.mimeType : "application/octet-stream";
    const dims = validateDimensions({ width: a.width, height: a.height, duration: a.duration }, kind === "video");
    const asset: Asset = {
      id: a.id,
      kind,
      name: sanitizeAssetName(a.name),
      mimeType,
      file: a.file,
      width: dims.ok ? dims.width : 1,
      height: dims.ok ? dims.height : 1,
      bytes: typeof a.bytes === "number" && Number.isFinite(a.bytes) && a.bytes >= 0 ? Math.round(a.bytes) : 0,
      createdAt: typeof a.createdAt === "string" ? a.createdAt : new Date(0).toISOString(),
    };
    if (dims.ok && dims.duration) asset.duration = dims.duration;
    const note = sanitizeNote(a.note);
    if (note) asset.note = note;
    const tags = sanitizeTags(a.tags);
    if (tags) asset.tags = tags;
    seen.add(a.id);
    out.push(asset);
  }
  return out;
}

/** "3840 × 2160" / "1:23" / "12.4 MB" helpers for labels. */
export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export const ASSET_KIND_LABELS: Record<AssetKind, string> = { image: "圖片", video: "影片", logo: "標誌" };
