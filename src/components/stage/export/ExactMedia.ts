// Band media for the offline export: every frame gets exactly the pixels the media model asks
// for. Images are decoded up front (downscaled to at most 4096 px, or the GPU limit); videos are
// seeked to the wanted time and the frame is only used after 'seeked' fired, so an export never
// shows a stale or half-decoded clip frame, however slowly the machine seeks.

import { assetFileUrl } from "@/lib/asset-scope";
import type { MediaPixels } from "@/lib/stage/media/draw";
import type { Asset, Project } from "@/lib/types";

interface ImageEntry {
  kind: "image";
  source: HTMLCanvasElement | HTMLImageElement | null;
  width: number;
  height: number;
}

interface VideoEntry {
  kind: "video";
  el: HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
  version: number;
  failed: boolean;
}

type Entry = ImageEntry | VideoEntry;

const SEEK_TIMEOUT_MS = 8000;
/** Seek only when the element is further than this from the wanted time (well under a frame). */
const EXACT_SECONDS = 0.0005;

function once(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      resolve(ok);
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    el.addEventListener(event, onOk);
    el.addEventListener("error", onErr);
  });
}

export class ExactMedia {
  private entries = new Map<string, Entry>();
  private maxEdge: number;

  constructor(maxTextureSize = 4096) {
    this.maxEdge = Math.max(512, Math.min(4096, maxTextureSize));
  }

  /** Load every asset the plan uses. Resolves when all are decoded (failures simply have no source). */
  async load(owner: Pick<Project, "id" | "bandId">, assets: readonly Asset[], used: ReadonlySet<string>): Promise<string[]> {
    const failed: string[] = [];
    await Promise.all(
      assets
        .filter((a) => used.has(a.id))
        .map(async (a) => {
          const url = assetFileUrl(owner, a);
          const ok = a.kind === "video" || a.mimeType.startsWith("video/") ? await this.loadVideo(a, url) : await this.loadImage(a, url);
          if (!ok) failed.push(a.name || a.id);
        }),
    );
    return failed;
  }

  private async loadImage(asset: Asset, url: string): Promise<boolean> {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
    try {
      await img.decode();
    } catch {
      return false;
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const k = Math.min(1, this.maxEdge / Math.max(w, h, 1));
    if (k >= 1) {
      this.entries.set(asset.id, { kind: "image", source: img, width: w, height: h });
      return true;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    this.entries.set(asset.id, { kind: "image", source: canvas, width: canvas.width, height: canvas.height });
    return true;
  }

  private async loadVideo(asset: Asset, url: string): Promise<boolean> {
    const el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.src = url;
    const entry: VideoEntry = { kind: "video", el, width: 0, height: 0, duration: asset.duration ?? 0, version: 0, failed: false };
    this.entries.set(asset.id, entry);
    const ok = el.readyState >= 2 || (await once(el, "loadeddata", 20000));
    if (!ok || !el.videoWidth) {
      entry.failed = true;
      return false;
    }
    entry.width = el.videoWidth;
    entry.height = el.videoHeight;
    if (Number.isFinite(el.duration) && el.duration > 0) entry.duration = el.duration;
    return true;
  }

  /** The asset's pixels at `wanted` seconds into the clip (stills ignore it). */
  async frame(asset: Asset, wanted: number): Promise<MediaPixels> {
    const e = this.entries.get(asset.id);
    if (!e) return { source: null, width: 0, height: 0, version: 0 };
    if (e.kind === "image") return { source: e.source, width: e.width, height: e.height, version: 0 };
    if (e.failed) return { source: null, width: 0, height: 0, version: 0 };
    const el = e.el;
    const d = e.duration;
    const target = d > 0 ? Math.min(Math.max(0, wanted), Math.max(0, d - 0.001)) : 0;
    if (Math.abs(el.currentTime - target) > EXACT_SECONDS || el.readyState < 2) {
      const seeked = once(el, "seeked", SEEK_TIMEOUT_MS);
      try {
        el.currentTime = target;
      } catch {
        /* keep the last frame */
      }
      await seeked;
      e.version++;
    }
    if (el.readyState < 2) return { source: null, width: 0, height: 0, version: e.version };
    return { source: el, width: e.width, height: e.height, version: e.version };
  }

  destroy() {
    for (const e of this.entries.values()) {
      if (e.kind === "video") {
        try {
          e.el.removeAttribute("src");
          e.el.load();
        } catch {
          /* gone */
        }
      }
    }
    this.entries.clear();
  }
}
