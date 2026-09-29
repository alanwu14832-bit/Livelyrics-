// Cloud-mode uploads (browser -> Vercel Blob): where each kind of file goes, which types and sizes
// are accepted. Pure; shared by the browser (src/lib/cloud-upload.ts) and the token route
// (src/lib/server/blob-upload.ts), which re-checks everything before it signs an upload.

import { MAX_ASSET_BYTES } from "./assets";

export const UPLOAD_TOKEN_ROUTE = "/api/blob/upload";
export const MAX_AUDIO_UPLOAD_BYTES = 200 * 1024 * 1024;
/** above this the browser uploads in parts (retried separately) */
export const MULTIPART_THRESHOLD_BYTES = 16 * 1024 * 1024;

/** What an upload is for. Audio comes before its project exists; assets need their owner. */
export type UploadTarget = { kind: "audio" } | { kind: "project-asset"; projectId: string } | { kind: "band-asset"; bandId: string };

/** Stored extension -> Content-Type, the same pairs the server sniffs (audio-files.ts / asset-files.ts). */
export const AUDIO_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
};

export const ASSET_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isUploadTarget(v: unknown): v is UploadTarget {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  if (t.kind === "audio") return true;
  if (t.kind === "project-asset") return typeof t.projectId === "string" && ID_RE.test(t.projectId);
  if (t.kind === "band-asset") return typeof t.bandId === "string" && ID_RE.test(t.bandId);
  return false;
}

/** Blob pathname prefix of a target: "audio/", "projects/<id>/", "bands/<id>/". */
export function uploadPrefix(target: UploadTarget): string {
  if (target.kind === "audio") return "audio/";
  if (target.kind === "project-asset") return `projects/${target.projectId}/`;
  return `bands/${target.bandId}/`;
}

/** The pathname the browser asks for (Blob adds a random suffix before the extension). */
export function uploadPathname(target: UploadTarget, ext: string): string {
  return `${uploadPrefix(target)}${target.kind === "audio" ? "song" : "asset"}.${ext}`;
}

export function uploadTypes(target: UploadTarget): Readonly<Record<string, string>> {
  return target.kind === "audio" ? AUDIO_UPLOAD_TYPES : ASSET_UPLOAD_TYPES;
}

export function uploadLimit(target: UploadTarget): number {
  return target.kind === "audio" ? MAX_AUDIO_UPLOAD_BYTES : MAX_ASSET_BYTES;
}

/** The `clientPayload` of an upload: what it is for, its size and its (sniffed) type. */
export interface UploadPayload {
  target: UploadTarget;
  size: number;
  contentType: string;
}
