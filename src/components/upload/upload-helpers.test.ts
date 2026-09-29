import { describe, expect, it } from "vitest";
import { AUDIO_ACCEPT, checkAudioFile, fileExtension, formatBytes, MAX_UPLOAD_BYTES, pickAudioFile } from "./accept";
import { clearLyricsHandoff, lyricsHandoffKey, readLyricsHandoff, storeLyricsHandoff } from "./handoff";
import { lrcHeaderTags } from "./lyrics-choice";
import { resamplePeaks } from "./waveform";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("accept", () => {
  it("lists audio/* and the spec'd extensions", () => {
    for (const ext of ["audio/*", ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".opus"]) expect(AUDIO_ACCEPT.split(",")).toContain(ext);
  });

  it("reads extensions case-insensitively", () => {
    expect(fileExtension("Song.MP3")).toBe(".mp3");
    expect(fileExtension("no-ext")).toBe("");
    expect(fileExtension("archive.tar.flac ")).toBe(".flac");
  });

  it("accepts audio by extension or mime and rejects others", () => {
    expect(checkAudioFile({ name: "a.flac", type: "", size: 10 }).ok).toBe(true);
    expect(checkAudioFile({ name: "a", type: "audio/mpeg", size: 10 }).ok).toBe(true);
    const bad = checkAudioFile({ name: "cover.jpg", type: "image/jpeg", size: 10 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain("cover.jpg");
    expect(checkAudioFile({ name: "a.mp3", type: "audio/mpeg", size: 0 }).ok).toBe(false);
    expect(checkAudioFile({ name: "a.mp3", type: "audio/mpeg", size: MAX_UPLOAD_BYTES + 1 }).ok).toBe(false);
  });

  it("picks the first audio file out of a mixed drop", () => {
    const files = [
      { name: "cover.jpg", type: "image/jpeg", size: 1 },
      { name: "song.wav", type: "audio/wav", size: 1 },
      { name: "b.mp3", type: "audio/mpeg", size: 1 },
    ];
    const r = pickAudioFile(files);
    expect(r.file?.name).toBe("song.wav");
    expect(r.ignored).toBe(2);
    expect(pickAudioFile([]).file).toBeNull();
    // nothing audio-like: return the first so the caller can explain why it is rejected
    expect(pickAudioFile([files[0]]).file?.name).toBe("cover.jpg");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MB");
    expect(formatBytes(200 * 1024 * 1024)).toBe("200 MB");
  });
});

describe("lyrics handoff", () => {
  it("round-trips through storage under the documented key", () => {
    const s = memoryStorage();
    expect(storeLyricsHandoff("abc", "[00:01.00]hi", s)).toBe(true);
    expect(s.map.has("livelyrics:lyrics:abc")).toBe(true);
    expect(lyricsHandoffKey("abc")).toBe("livelyrics:lyrics:abc");
    expect(readLyricsHandoff("abc", s)).toBe("[00:01.00]hi");
    clearLyricsHandoff("abc", s);
    expect(readLyricsHandoff("abc", s)).toBeNull();
  });

  it("ignores blank text and survives throwing storage", () => {
    const s = memoryStorage();
    expect(storeLyricsHandoff("x", "   ", s)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(storeLyricsHandoff("x", "text", throwing)).toBe(false);
    expect(readLyricsHandoff("x", throwing)).toBeNull();
    expect(() => clearLyricsHandoff("x", throwing)).not.toThrow();
    expect(readLyricsHandoff("x", null)).toBeNull();
  });
});

describe("resamplePeaks", () => {
  it("takes the max per bar", () => {
    expect(resamplePeaks([0.1, 0.5, 0.2, 0.9], 2)).toEqual([0.5, 0.9]);
  });

  it("expands when there are more bars than buckets", () => {
    expect(resamplePeaks([0.2, 0.8], 4)).toEqual([0.2, 0.2, 0.8, 0.8]);
  });

  it("supports sub-ranges and bad input", () => {
    expect(resamplePeaks([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], 2, 0.5, 1)).toEqual([0.7, 0.9]);
    expect(resamplePeaks([], 3)).toEqual([0, 0, 0]);
    expect(resamplePeaks([NaN, 2], 1)).toEqual([1]);
    expect(resamplePeaks([0.5], 0)).toEqual([]);
  });
});

describe("lrcHeaderTags", () => {
  it("reads title, artist and album from the LRC header", () => {
    expect(lrcHeaderTags("[ti:示範之歌]\n[ar:Livelyrics Band]\n[al: 夜色 ]\n[00:08.00]夜色慢慢落在城市的邊緣")).toEqual({
      title: "示範之歌",
      artist: "Livelyrics Band",
      album: "夜色",
    });
  });

  it("ignores empty tags, other tags, plain text and anything after the first timed line", () => {
    expect(lrcHeaderTags("[ti:]\n[by:someone]\n[offset:+100]\n[ar:A]")).toEqual({ artist: "A" });
    expect(lrcHeaderTags("第一行歌詞\n[ti:不是標籤]")).toEqual({});
    expect(lrcHeaderTags("[00:01.00]一\n[ti:太晚了]")).toEqual({});
  });
});
