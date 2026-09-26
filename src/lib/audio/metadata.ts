// Song metadata for an uploaded file: container tags via music-metadata (ID3 / Vorbis / MP4 /
// RIFF …), with a careful fallback to parsing the file name ("01 - Artist - Title [Official MV].mp3").

import type { IAudioMetadata } from "music-metadata";

export interface AudioFileMetadata {
  title: string;
  artist: string;
  album?: string;
  year?: number;
  /** seconds, when the container reports it */
  duration?: number;
  /** sample rate of the encoded stream, when the container reports it */
  sampleRate?: number;
}

const TAG_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Tag parsing (browser; also works in Node ≥ 20 where Blob streams exist)
// ---------------------------------------------------------------------------

const tagCache = new WeakMap<Blob, Promise<IAudioMetadata | null>>();

/** Parse container tags once per File (shared by readAudioMetadata and the analyser). Never rejects. */
export function parseTags(file: Blob): Promise<IAudioMetadata | null> {
  const cached = tagCache.get(file);
  if (cached) return cached;
  const job = (async () => {
    try {
      const { parseBlob } = await import("music-metadata");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TAG_TIMEOUT_MS);
      });
      try {
        return await Promise.race([parseBlob(file, { skipCovers: true, duration: false }), timeout]);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  })();
  tagCache.set(file, job);
  return job;
}

/** Browser: read ID3/Vorbis/MP4 tags; falls back to parsing "Artist - Title.ext" from the file name. */
export async function readAudioMetadata(file: File): Promise<AudioFileMetadata> {
  const fromName = parseFileName(file.name);
  const tags = await parseTags(file);
  if (!tags) return fromName;
  const common = tags.common;
  let title = cleanTagText(common.title);
  let artist = cleanTagText(common.artist) || cleanTagText(common.albumartist) || cleanTagText(common.artists?.join(", "));
  if (isPlaceholder(title)) title = "";
  if (isPlaceholder(artist, true)) artist = "";
  // some rips put "Artist - Title" into the title tag and leave the artist empty
  if (title && !artist && !fromName.artist) {
    const split = parseFileName(title, { hasExtension: false });
    if (split.artist) {
      artist = split.artist;
      title = split.title;
    }
  }
  if (title) title = stripNoise(title);
  const album = cleanTagText(common.album);
  const year = validYear(common.year) ?? yearFromDate(common.date) ?? yearFromDate(common.originaldate);
  const duration = tags.format.duration;
  const sampleRate = tags.format.sampleRate;
  const out: AudioFileMetadata = {
    title: title || fromName.title,
    artist: artist || fromName.artist,
  };
  if (album && !isPlaceholder(album)) out.album = album;
  if (year != null) out.year = year;
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) out.duration = Math.round(duration * 1000) / 1000;
  if (typeof sampleRate === "number" && Number.isFinite(sampleRate) && sampleRate > 0) out.sampleRate = Math.round(sampleRate);
  return out;
}

function validYear(y: unknown): number | undefined {
  if (typeof y !== "number" || !Number.isInteger(y)) return undefined;
  const max = new Date().getFullYear() + 1;
  return y >= 1900 && y <= max ? y : undefined;
}

function yearFromDate(d: unknown): number | undefined {
  if (typeof d !== "string") return undefined;
  const m = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(d);
  return m ? validYear(Number(m[1])) : undefined;
}

const PLACEHOLDER = /^(?:unknown(?:\s+(?:artist|album|title))?|<unknown>|untitled|no\s+title|track\s*\d*|audio\s*track\s*\d*|未知(?:歌手|演出者|藝人|艺人|專輯|专辑|標題|标题)?|無標題|无标题|曲目\s*\d*|音軌\s*\d*|音轨\s*\d*)$/i;

function isPlaceholder(s: string, artist = false): boolean {
  if (!s) return false;
  if (PLACEHOLDER.test(s.trim())) return true;
  return artist && /^(?:various(?:\s+artists?)?|va|群星|多位藝人|多位艺人)$/i.test(s.trim());
}

function cleanTagText(v: unknown): string {
  if (typeof v !== "string") return "";
  return repairMojibake(v.replace(/\u0000/g, "")).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Mojibake: legacy Big5 / GBK / Shift_JIS bytes stored in a Latin-1 tag frame
// ---------------------------------------------------------------------------

const CJK_CLASS = "[\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff\\uac00-\\ud7af]";
const CJK = new RegExp(CJK_CLASS);
const CJK_HYPHEN_BEFORE = new RegExp(`(${CJK_CLASS})\\s*-(?!\\s)`, "g");
const CJK_HYPHEN_AFTER = new RegExp(`(?<!\\s)-\\s*(${CJK_CLASS})`, "g");

/**
 * Many taggers store UTF-8 — and old Taiwanese / Chinese / Japanese rips Big5, GBK or Shift_JIS —
 * bytes in frames declared as Latin-1, which then read as "å\u0080\u0094å¼·" or "§Ú·R§A".
 * Re-decode such strings: UTF-8 first (its multi-byte structure practically never matches real
 * Latin-1 text by accident), then the legacy CJK encodings, but only when the string consists
 * mostly of high Latin-1 characters, so legit accented names ("Sigur Rós", "Motörhead") survive.
 */
export function repairMojibake(s: string): string {
  if (!s) return s;
  let high = 0;
  let visible = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return s; // real Unicode text: nothing to repair
    if (c > 0x20) visible++;
    if (c >= 0x80) high++;
  }
  if (high < 2) return s;
  const bytes = Uint8Array.from(s, (ch) => ch.charCodeAt(0));
  const tryDecode = (encoding: string): string | null => {
    try {
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      return decoded.includes("\ufffd") ? null : decoded;
    } catch {
      return null; // not valid in this encoding (or encoding unsupported)
    }
  };
  const utf8 = tryDecode("utf-8");
  if (utf8 != null && utf8 !== s) return utf8;
  if (high < 0.4 * visible) return s;
  for (const encoding of ["big5", "gbk", "shift_jis"]) {
    const decoded = tryDecode(encoding);
    if (decoded != null && CJK.test(decoded)) return decoded;
  }
  return s;
}

// ---------------------------------------------------------------------------
// File-name parsing
// ---------------------------------------------------------------------------

const AUDIO_EXT = /\.(?:mp3|wav|wave|m4a|mp4|aac|flac|ogg|oga|opus|webm|aif|aiff|aifc|wma|alac|caf|m4b|mka|ape|wv|amr|3gp)$/i;
const GENERIC_EXT = /\.[a-z][a-z0-9]{1,4}$/i;

/** Words that mark a bracketed / trailing group as upload noise rather than part of the title. */
const NOISE_WORDS =
  /(?:official|music\s*video|\bm\/?v\b|lyric|lyrics|\baudio\b|\bvideo\b|\bhd\b|\bhq\b|\b4k\b|\b(?:1080|720|480)p\b|visuali[sz]er|remaster|\bexplicit\b|\bclean\b|官方|高音質|高音质|高畫質|高画质|完整版|歌詞|歌词|字幕|中字|動態|动态|純享|纯享|首播|試聽|试听|\bpremiere\b)/i;

function normalizePunctuation(s: string): string {
  return s
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[［]/g, "[")
    .replace(/[］]/g, "]")
    .replace(/[－﹣‐‑]/g, "-")
    .replace(/[｜]/g, "|")
    .replace(/[\u3000\u00a0]/g, " ");
}

/** Remove bracketed noise groups ("(Official MV)", "[HD]", "【官方完整版】") and trailing noise words. */
export function stripNoise(s: string): string {
  let out = normalizePunctuation(s);
  let prev: string;
  do {
    prev = out;
    out = out.replace(/\s*[([【]([^()[\]【】]*)[)\]】]\s*/g, (whole, inner: string) => (NOISE_WORDS.test(inner) ? " " : whole));
  } while (out !== prev);
  // unbracketed trailing noise: "Title - Official Music Video", "Title MV", "【Title】Official MV"
  out = out.replace(
    /(^|[\s\-|~】》」』)\]])\s*(?:official\s+(?:music\s+)?(?:video|mv|audio|lyric\s+video)|official|music\s+video|lyric\s+video|m\/?v|官方(?:完整版|高畫質版?)?\s*(?:mv|m\/v)?|完整版)\s*$/i,
    "$1",
  );
  return tidy(out);
}

/** Trim decoration left over after splitting: separators, stray brackets, wrapping quotes. */
function tidy(s: string): string {
  let out = s.replace(/\s+/g, " ").trim();
  out = out.replace(/^[\s\-_·|~:：,，]+|[\s\-_|~:：,，]+$/g, "");
  const wrapped = /^(?:「(.*)」|『(.*)』|《(.*)》|"(.*)"|“(.*)”|'(.*)')$/.exec(out);
  if (wrapped) out = (wrapped.slice(1).find((g) => g != null) ?? out).trim();
  return out;
}

const TRACK_PREFIX = [
  /^\d{1,2}-\d{1,3}\s+(?=\S)/, // disc-track: "1-05 Title"
  /^\d{1,3}\s*[-.)_]\s*(?=\S)/, // "01 - Title", "1. Title", "03) Title"
  /^0\d{1,2}\s+(?=\S)/, // zero-padded "01 Title"
];

function stripTrackNumber(s: string): string {
  for (const re of TRACK_PREFIX) {
    const m = re.exec(s);
    if (m && s.length > m[0].length) {
      const rest = s.slice(m[0].length);
      // "1979 - Artist" style: a 4-digit or longer year is never stripped (regexes allow ≤ 3 digits)
      if (/\S/.test(rest)) return rest;
    }
  }
  return s;
}

export interface ParseFileNameOptions {
  /** default true: strip a trailing file extension first */
  hasExtension?: boolean;
}

/**
 * "Artist - Title.ext" and the many real-world variants: leading track numbers
 * ("01 - Artist - Title"), underscores ("Artist_-_Title"), upload noise
 * ("[Official MV]", "(Lyric Video)", "【官方完整版】"), CJK title brackets
 * ("五月天 Mayday【倔強】MV", "告五人《愛人錯過》"), and "Artist - Album - 03 - Title".
 */
export function parseFileName(fileName: string, options: ParseFileNameOptions = {}): AudioFileMetadata {
  const { hasExtension = true } = options;
  let base = fileName.split(/[\\/]/).pop() ?? fileName;
  if (hasExtension) base = base.replace(AUDIO_EXT, "").replace(GENERIC_EXT, "");
  const original = tidy(base.replace(/_/g, " ")) || base.trim();
  // a full-width dash / em dash, or a hyphen touching CJK text ("五月天-倔強"), separates fields;
  // hyphens between Latin letters ("Anne-Marie", "Anti-Hero") do not
  let s = normalizePunctuation(base.replace(/[－—]/g, " - "));
  s = s.replace(/\s_+\s|_+-_+|_-|-_/g, " - ").replace(/_/g, " ");
  s = s.replace(CJK_HYPHEN_BEFORE, "$1 - ").replace(CJK_HYPHEN_AFTER, " - $1");
  s = stripNoise(s);
  s = stripTrackNumber(s);

  // CJK title brackets: "Artist【Title】…", "Artist《Title》", "《Title》Artist"
  const bracket = /^(.*?)\s*[【《「『]\s*([^】》」』]+?)\s*[】》」』]\s*(.*)$/.exec(s);
  if (bracket && !NOISE_WORDS.test(bracket[2])) {
    const before = tidy(bracket[1]);
    const after = tidy(stripNoise(bracket[3]));
    const title = tidy(bracket[2]);
    const artist = before || after;
    if (title) return { artist: tidy(stripTrackNumber(artist)), title };
  }

  let parts = s.split(/\s+[-–—−~]+\s+|\s*\|\s*/).map(tidy).filter(Boolean);
  if (parts.length >= 2) {
    const numeric = parts.filter((p) => /^\d{1,3}$/.test(p));
    parts = parts.filter((p) => !/^\d{1,3}$/.test(p));
    if (parts.length >= 3 && numeric.length > 0) return { artist: parts[0], title: parts[parts.length - 1] };
    if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(" - ") };
    if (parts.length === 1) return { artist: "", title: parts[0] };
  }
  const title = tidy(s) || original;
  return { artist: "", title };
}
