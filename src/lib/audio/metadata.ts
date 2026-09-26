// STUB — owned by the AUDIO module. Replace the implementation, keep the exports.

export interface AudioFileMetadata {
  title: string;
  artist: string;
  album?: string;
  year?: number;
  /** seconds, when the container reports it */
  duration?: number;
}

/** Browser: read ID3/Vorbis/MP4 tags; falls back to parsing "Artist - Title.ext" from the file name. */
export async function readAudioMetadata(file: File): Promise<AudioFileMetadata> {
  return parseFileName(file.name);
}

export function parseFileName(fileName: string): AudioFileMetadata {
  const base = fileName.replace(/\.[^.]+$/, "");
  const m = base.split(/\s+[-–—]\s+/);
  if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(" - ").trim() };
  return { artist: "", title: base.trim() };
}
