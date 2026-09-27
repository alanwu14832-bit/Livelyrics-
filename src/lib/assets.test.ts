import { describe, expect, it } from "vitest";
import { coerceAssets, sanitizeNote, sanitizeTags, validateDimensions } from "./assets";
import { resolveAssetType, sniffMedia } from "./server/asset-files";

const bytes = (...parts: Array<string | number[]>) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};

describe("sniffMedia / resolveAssetType", () => {
  it("recognizes images and videos by their magic bytes", () => {
    expect(sniffMedia(bytes([0x89], "PNG\r\n\x1a\n"))).toEqual({ kind: "media", family: "png" });
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ kind: "media", family: "jpeg" });
    expect(sniffMedia(bytes("GIF89a"))).toEqual({ kind: "media", family: "gif" });
    expect(sniffMedia(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toEqual({ kind: "media", family: "webp" });
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toEqual({ kind: "media", family: "webm" });
    expect(sniffMedia(bytes([0, 0, 0, 0x20], "ftypisom"))).toEqual({ kind: "media", family: "mp4" });
    expect(sniffMedia(bytes([0, 0, 0, 0x14], "ftypqt  "))).toEqual({ kind: "media", family: "mov" });
  });

  it("rejects SVG, HTML, audio and unknown content, whatever the file is called", () => {
    const svg = resolveAssetType("logo.png", bytes('<?xml version="1.0"?><svg'));
    expect(svg.ok).toBe(false);
    if (!svg.ok) expect(svg.error).toContain("SVG");
    expect(resolveAssetType("x.jpg", bytes("<svg xmlns")).ok).toBe(false);
    expect(resolveAssetType("song.mp4", bytes([0, 0, 0, 0x20], "ftypM4A ")).ok).toBe(false);
    expect(resolveAssetType("a.mp4", bytes("ID3", [3, 0, 0, 0])).ok).toBe(false);
    expect(resolveAssetType("a.png", bytes([1, 2, 3, 4, 5, 6])).ok).toBe(false);
  });

  it("stores the sniffed type, not the declared one", () => {
    const r = resolveAssetType("photo.png", bytes([0xff, 0xd8, 0xff, 0xdb]));
    expect(r).toMatchObject({ ok: true, ext: "jpg", mimeType: "image/jpeg", video: false });
    expect(resolveAssetType("clip.bin", bytes([0x1a, 0x45, 0xdf, 0xa3]))).toMatchObject({ ok: true, ext: "webm", video: true });
  });
});

describe("validateDimensions", () => {
  it("accepts whole-pixel sizes in range and requires a video length", () => {
    expect(validateDimensions({ width: 3000, height: 3000 }, false)).toEqual({ ok: true, width: 3000, height: 3000 });
    expect(validateDimensions({ width: "1920", height: "1080", duration: "12.3456" }, true)).toEqual({ ok: true, width: 1920, height: 1080, duration: 12.346 });
    expect(validateDimensions({ width: 1920, height: 1080 }, true).ok).toBe(false);
    expect(validateDimensions({ width: 0, height: 10 }, false).ok).toBe(false);
    expect(validateDimensions({ width: 20000, height: 10 }, false).ok).toBe(false);
    expect(validateDimensions({ width: Number.NaN, height: 10 }, false).ok).toBe(false);
    expect(validateDimensions({ width: 10, height: 10, duration: -1 }, true).ok).toBe(false);
  });
});

describe("notes, tags and stored assets", () => {
  it("cleans tags (split, de-duplicated, bounded) and notes", () => {
    expect(sanitizeTags("專輯封面, 夜景、#Live，專輯封面")).toEqual(["專輯封面", "夜景", "Live"]);
    expect(sanitizeTags(["a", "A", "", 3])).toEqual(["a"]);
    expect(sanitizeTags([])).toBeUndefined();
    expect(sanitizeTags(Array.from({ length: 40 }, (_, i) => `t${i}`))?.length).toBe(12);
    expect(sanitizeNote("  第一行\n第二行\u0000 ")).toBe("第一行\n第二行");
    expect(sanitizeNote("   ")).toBeUndefined();
  });

  it("keeps well-formed stored assets and drops the rest", () => {
    const good = { id: "a1b2c3d4e5f6", kind: "image", name: "封面", mimeType: "image/png", file: "a1b2c3d4e5f6.png", width: 100, height: 50, bytes: 10, createdAt: "2026-01-01T00:00:00Z" };
    const list = coerceAssets([
      good,
      { ...good }, // duplicate id
      { ...good, id: "../../etc", file: "../../etc.png" },
      { ...good, id: "bbbbbbbbbbbb", file: "cccccccccccc.png" }, // file does not match id
      { ...good, id: "dddddddddddd", file: "dddddddddddd.mp4", kind: "video", mimeType: "video/mp4", duration: 8 },
      null,
      "x",
    ]);
    expect(list.map((a) => a.id)).toEqual(["a1b2c3d4e5f6", "dddddddddddd"]);
    expect(list[1].duration).toBe(8);
    expect(coerceAssets(undefined)).toEqual([]);
  });
});
