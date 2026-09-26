import { describe, expect, it } from "vitest";
import { extensionOf, mimeForAudioFile, resolveAudioType, sanitizeFileName, sniffAudio } from "./audio-files";

const bytes = (...parts: Array<string | number[]>) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

describe("sniffAudio", () => {
  it("identifies containers", () => {
    expect(sniffAudio(bytes("ID3", [4, 0]))).toEqual({ kind: "audio", family: "mp3" });
    expect(sniffAudio(bytes([0xff, 0xfb, 0x90, 0x64]))).toEqual({ kind: "audio", family: "mp3" });
    expect(sniffAudio(bytes([0xff, 0xf1, 0x50, 0x80]))).toEqual({ kind: "audio", family: "aac" });
    expect(sniffAudio(bytes("RIFF", [1, 2, 3, 4], "WAVE"))).toEqual({ kind: "audio", family: "wav" });
    expect(sniffAudio(bytes("fLaC"))).toEqual({ kind: "audio", family: "flac" });
    expect(sniffAudio(bytes("OggS"))).toEqual({ kind: "audio", family: "ogg" });
    expect(sniffAudio(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toEqual({ kind: "audio", family: "webm" });
    expect(sniffAudio(bytes([0, 0, 0, 0x20], "ftypM4A "))).toEqual({ kind: "audio", family: "mp4" });
    expect(sniffAudio(bytes([0x89], "PNG")).kind).toBe("other");
    expect(sniffAudio(bytes([0xff, 0xd8, 0xff, 0xe0])).kind).toBe("other");
    expect(sniffAudio(bytes("<!DOCTYPE html>")).kind).toBe("other");
    expect(sniffAudio(bytes([1, 2, 3, 4])).kind).toBe("unknown");
  });
});

describe("resolveAudioType", () => {
  it("accepts supported extensions and MIME types", () => {
    const unknown = bytes([1, 2, 3, 4]);
    expect(resolveAudioType("a.MP3", "", unknown)).toEqual({ ok: true, ext: "mp3", mimeType: "audio/mpeg" });
    expect(resolveAudioType("a.opus", "audio/opus", unknown)).toEqual({ ok: true, ext: "opus", mimeType: "audio/ogg" });
    expect(resolveAudioType("noext", "audio/x-m4a", unknown)).toEqual({ ok: true, ext: "m4a", mimeType: "audio/mp4" });
    expect(resolveAudioType("a.webm", "application/octet-stream", unknown)).toEqual({ ok: true, ext: "webm", mimeType: "audio/webm" });
  });

  it("trusts magic bytes over a wrong extension", () => {
    const m4a = bytes([0, 0, 0, 0x20], "ftypM4A ");
    expect(resolveAudioType("song.mp3", "audio/mpeg", m4a)).toEqual({ ok: true, ext: "m4a", mimeType: "audio/mp4" });
    expect(resolveAudioType("video.mp4", "video/mp4", m4a)).toEqual({ ok: true, ext: "mp4", mimeType: "audio/mp4" });
    expect(resolveAudioType("x.oga", "", bytes("OggS"))).toEqual({ ok: true, ext: "oga", mimeType: "audio/ogg" });
  });

  it("rejects non-audio content and unsupported types", () => {
    expect(resolveAudioType("song.mp3", "audio/mpeg", bytes([0x89], "PNG")).ok).toBe(false);
    expect(resolveAudioType("notes.txt", "text/plain", bytes([1, 2, 3, 4])).ok).toBe(false);
    expect(resolveAudioType("a.aiff", "", bytes([1, 2, 3, 4])).ok).toBe(false);
    expect(resolveAudioType("a.mp3", "image/png", bytes([1, 2, 3, 4])).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("extensionOf / mimeForAudioFile / sanitizeFileName", () => {
    expect(extensionOf("C:\\x\\Song.FLAC")).toBe("flac");
    expect(extensionOf(".hidden")).toBe("");
    expect(mimeForAudioFile("audio.wav")).toBe("audio/wav");
    expect(mimeForAudioFile("audio.xyz")).toBe("application/octet-stream");
    expect(sanitizeFileName("../../etc/pa\u0000ss.mp3")).toBe("pass.mp3");
    expect(sanitizeFileName("")).toBe("audio");
  });
});
