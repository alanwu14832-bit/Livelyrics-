// Which files the upload dropzone accepts, and friendly byte/format helpers.

/** Same limit as the upload route and the analyser. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Extensions the server can store and serve (see src/lib/server/audio-files.ts). */
export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".flac", ".ogg", ".opus", ".aac", ".oga", ".webm", ".mp4"] as const;

/** Value for <input type="file" accept>. */
export const AUDIO_ACCEPT = ["audio/*", ...AUDIO_EXTENSIONS].join(",");

/** Shown to users: the common formats. */
export const AUDIO_FORMATS_LABEL = "MP3、WAV、M4A、FLAC、OGG、OPUS";

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? `.${m[1].toLowerCase()}` : "";
}

export type FileCheck = { ok: true } | { ok: false; reason: string };

/** Validate a picked/dropped file before decoding it. */
export function checkAudioFile(file: { name: string; type: string; size: number }): FileCheck {
  const ext = fileExtension(file.name);
  const type = (file.type || "").toLowerCase();
  const knownExt = (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
  // video/mp4 and video/webm containers often carry audio only; trust a known extension
  const audioType = type.startsWith("audio/") || type === "application/ogg";
  if (!knownExt && !audioType) {
    return { ok: false, reason: `「${file.name}」看起來不是音檔。請選擇 ${AUDIO_FORMATS_LABEL} 等格式的檔案。` };
  }
  if (file.size === 0) return { ok: false, reason: "檔案是空的（0 位元組），請重新選擇音檔。" };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `檔案有 ${formatBytes(file.size)}，超過 ${formatBytes(MAX_UPLOAD_BYTES)} 上限。請先轉成較小的 MP3 或 AAC。` };
  }
  return { ok: true };
}

/** Pick the first acceptable audio file out of a drop (a folder drop may contain cover art, etc.). */
export function pickAudioFile<T extends { name: string; type: string; size: number }>(files: readonly T[]): { file: T | null; ignored: number } {
  let file: T | null = null;
  for (const f of files) {
    const ext = fileExtension(f.name);
    if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext) || (f.type || "").startsWith("audio/")) {
      file = f;
      break;
    }
  }
  const chosen = file ?? files[0] ?? null;
  return { file: chosen, ignored: Math.max(0, files.length - (chosen ? 1 : 0)) };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  const mb = bytes / 1024 / 1024;
  return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}
