// Mood board uploads in the browser (phase 4): every reference image is decoded, downscaled to at
// most MOOD_MAX_EDGE px on the long edge and re-encoded as WebP (JPEG where the browser cannot
// encode WebP), and its colours are measured on a 96 px copy (extractMoodStats, a k-means over
// the pixels). The server stores the small file and the stats; Claude later sees the same small
// image, the offline designer reads the stats.

import { MOOD_MAX_EDGE, extractMoodStats, fitWithin } from "./moodboard";
import type { MoodStats } from "./types";

const STATS_EDGE = 96;

export interface PreparedMoodImage {
  file: File;
  width: number;
  height: number;
  stats: MoodStats;
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("這張圖片無法讀取（檔案可能損壞，或瀏覽器不支援這種格式）");
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Downscale, re-encode and measure one reference image. */
export async function prepareMoodImage(file: File): Promise<PreparedMoodImage> {
  const img = await decode(file);
  try {
    if (!img.width || !img.height) throw new Error("圖片沒有尺寸");
    const size = fitWithin(img.width, img.height, MOOD_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("瀏覽器無法處理圖片");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, 0, 0, size.width, size.height);
    let blob = await toBlob(canvas, "image/webp", 0.86);
    let ext = "webp";
    if (!blob || blob.type !== "image/webp") {
      // no WebP encoder (older Safari): JPEG on white, so transparency does not turn black
      const flat = document.createElement("canvas");
      flat.width = size.width;
      flat.height = size.height;
      const f = flat.getContext("2d")!;
      f.fillStyle = "#ffffff";
      f.fillRect(0, 0, size.width, size.height);
      f.drawImage(canvas, 0, 0);
      blob = await toBlob(flat, "image/jpeg", 0.86);
      ext = "jpg";
    }
    if (!blob) throw new Error("瀏覽器無法壓縮這張圖片");

    const small = fitWithin(size.width, size.height, STATS_EDGE);
    const probe = document.createElement("canvas");
    probe.width = small.width;
    probe.height = small.height;
    const p = probe.getContext("2d", { willReadFrequently: true })!;
    p.drawImage(canvas, 0, 0, small.width, small.height);
    const stats = extractMoodStats(p.getImageData(0, 0, small.width, small.height).data);

    const base = file.name.replace(/\.[^.]+$/, "") || "參考圖";
    return { file: new File([blob], `${base}.${ext}`, { type: blob.type }), width: size.width, height: size.height, stats };
  } finally {
    img.close();
  }
}
