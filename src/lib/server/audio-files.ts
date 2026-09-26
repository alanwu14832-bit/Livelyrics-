// Accepted audio formats for uploads: extension / declared MIME / magic-byte sniffing.

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/** extension -> Content-Type we store and serve */
export const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
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

/** declared MIME (as browsers send it) -> canonical extension */
const MIME_TO_EXT: Readonly<Record<string, string>> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mpeg3": "mp3",
  "audio/x-mpeg-3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "video/mp4": "mp4",
  "audio/aac": "aac",
  "audio/x-aac": "aac",
  "audio/aacp": "aac",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "video/webm": "webm",
};

type Family = "mp3" | "wav" | "mp4" | "aac" | "flac" | "ogg" | "webm";

const EXT_FAMILY: Readonly<Record<string, Family>> = {
  mp3: "mp3",
  wav: "wav",
  m4a: "mp4",
  mp4: "mp4",
  aac: "aac",
  flac: "flac",
  ogg: "ogg",
  oga: "ogg",
  opus: "ogg",
  webm: "webm",
};

const FAMILY_DEFAULT_EXT: Readonly<Record<Family, string>> = {
  mp3: "mp3",
  wav: "wav",
  mp4: "m4a",
  aac: "aac",
  flac: "flac",
  ogg: "ogg",
  webm: "webm",
};

export type SniffResult = { kind: "audio"; family: Family } | { kind: "other"; label: string } | { kind: "unknown" };

function ascii(head: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < head.length; i++) out += String.fromCharCode(head[i]);
  return out;
}

/** Identify the container from the first bytes of the file. */
export function sniffAudio(head: Uint8Array): SniffResult {
  if (head.length < 4) return { kind: "unknown" };
  if (ascii(head, 0, 3) === "ID3") return { kind: "audio", family: "mp3" };
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE") return { kind: "audio", family: "wav" };
  if (ascii(head, 0, 4) === "fLaC") return { kind: "audio", family: "flac" };
  if (ascii(head, 0, 4) === "OggS") return { kind: "audio", family: "ogg" };
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { kind: "audio", family: "webm" };
  if (ascii(head, 4, 4) === "ftyp") return { kind: "audio", family: "mp4" };
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    // frame sync: layer bits 00 = ADTS AAC, otherwise MPEG audio
    return { kind: "audio", family: (head[1] & 0x06) === 0 ? "aac" : "mp3" };
  }
  if (head[0] === 0x89 && ascii(head, 1, 3) === "PNG") return { kind: "other", label: "PNG 圖片" };
  if (head[0] === 0xff && head[1] === 0xd8) return { kind: "other", label: "JPEG 圖片" };
  if (ascii(head, 0, 4) === "GIF8") return { kind: "other", label: "GIF 圖片" };
  if (ascii(head, 0, 4) === "%PDF") return { kind: "other", label: "PDF 文件" };
  if (ascii(head, 0, 2) === "PK") return { kind: "other", label: "壓縮檔" };
  const text = ascii(head, 0, Math.min(head.length, 16)).trimStart().toLowerCase();
  if (text.startsWith("<") || text.startsWith("{") || text.startsWith("[")) return { kind: "other", label: "文字檔" };
  return { kind: "unknown" };
}

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export type AudioTypeResult = { ok: true; ext: string; mimeType: string } | { ok: false; error: string };

const SUPPORTED_LABEL = "MP3、WAV、M4A/AAC/MP4、FLAC、OGG/Opus、WebM";

/**
 * Decide the stored extension and Content-Type. Magic bytes win over the file name
 * (a mislabeled file still gets the right Content-Type); unknown content falls back
 * to the declared extension / MIME.
 */
export function resolveAudioType(fileName: string, declaredMime: string, head: Uint8Array): AudioTypeResult {
  const ext = extensionOf(fileName);
  const mime = declaredMime.split(";")[0].trim().toLowerCase();
  const declaredExt = AUDIO_EXTENSIONS[ext] ? ext : MIME_TO_EXT[mime];
  const sniff = sniffAudio(head);

  if (sniff.kind === "other") return { ok: false, error: `這不是音檔（看起來是${sniff.label}）。支援格式：${SUPPORTED_LABEL}` };
  if (sniff.kind === "audio") {
    const finalExt = declaredExt && EXT_FAMILY[declaredExt] === sniff.family ? declaredExt : FAMILY_DEFAULT_EXT[sniff.family];
    return { ok: true, ext: finalExt, mimeType: AUDIO_EXTENSIONS[finalExt] };
  }
  if (mime && !MIME_TO_EXT[mime] && mime !== "application/octet-stream" && !mime.startsWith("audio/")) {
    return { ok: false, error: `不支援的檔案類型（${mime}）。支援格式：${SUPPORTED_LABEL}` };
  }
  if (!declaredExt) return { ok: false, error: `不支援的音檔格式${ext ? `（.${ext}）` : ""}。支援格式：${SUPPORTED_LABEL}` };
  return { ok: true, ext: declaredExt, mimeType: AUDIO_EXTENSIONS[declaredExt] };
}

/** Content-Type for a stored "audio.<ext>" file. */
export function mimeForAudioFile(audioFile: string): string {
  return AUDIO_EXTENSIONS[extensionOf(audioFile)] ?? "application/octet-stream";
}

/** Keep a readable original file name (no path, no control characters, bounded length). */
export function sanitizeFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base || "audio").slice(0, 255);
}
