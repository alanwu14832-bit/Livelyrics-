// Loads a project's band media (images, logos, video clips) for one StageView and keeps videos
// in step with the stage clock. Images are decoded once and downscaled to at most
// MAX_TEXTURE_EDGE (album art can be 6000 px); videos are muted, inline, never attached to the
// page, and seeked to the position the media model asks for whenever they drift by more than
// ~80 ms. Nothing here throws: a missing or broken asset simply has no source (no layer).

import { api } from "@/lib/api-client";
import { needsSeek } from "@/lib/stage/media/model";
import type { Asset } from "@/lib/types";

const MAX_TEXTURE_EDGE = 2048;

interface ImageEntry {
  kind: "image";
  asset: Asset;
  source: HTMLCanvasElement | HTMLImageElement | null;
  width: number;
  height: number;
  failed: boolean;
}

interface VideoEntry {
  kind: "video";
  asset: Asset;
  el: HTMLVideoElement;
  width: number;
  height: number;
  failed: boolean;
  /** frame counter: bumps when the element may show a new frame */
  version: number;
  lastTime: number;
  usedAt: number;
  seekPending: boolean;
  hadData: boolean;
}

type Entry = ImageEntry | VideoEntry;

export interface MediaSourceFrame {
  source: TexImageSource | null;
  width: number;
  height: number;
  version: number;
  /** keep showing the texture already uploaded (the video is seeking / buffering) */
  hold?: boolean;
}

function downscale(img: HTMLImageElement): { source: HTMLCanvasElement | HTMLImageElement; width: number; height: number } {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const k = Math.min(1, MAX_TEXTURE_EDGE / Math.max(w, h));
  if (k >= 1) return { source: img, width: w, height: h };
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { source: img, width: w, height: h };
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, cw, ch);
  return { source: canvas, width: cw, height: ch };
}

export class MediaSources {
  private entries = new Map<string, Entry>();
  private projectId = "";
  private destroyed = false;

  /** Load what the project needs; drop entries for assets that are gone. */
  setAssets(projectId: string, assets: readonly Asset[], used: ReadonlySet<string>) {
    if (projectId !== this.projectId) {
      this.clear();
      this.projectId = projectId;
    }
    const keep = new Set(assets.map((a) => a.id));
    for (const [id, e] of this.entries) {
      const a = assets.find((x) => x.id === id);
      if (!keep.has(id) || (a && a.file !== e.asset.file)) this.drop(id);
    }
    for (const a of assets) {
      if (!used.has(a.id) || this.entries.has(a.id)) continue;
      if (a.kind === "video" || a.mimeType.startsWith("video/")) this.loadVideo(a);
      else this.loadImage(a);
    }
  }

  private url(asset: Asset): string {
    return api.assetUrl(this.projectId, asset.id);
  }

  private loadImage(asset: Asset) {
    const entry: ImageEntry = { kind: "image", asset, source: null, width: 0, height: 0, failed: false };
    this.entries.set(asset.id, entry);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (this.destroyed || this.entries.get(asset.id) !== entry) return;
      try {
        const d = downscale(img);
        entry.source = d.source;
        entry.width = d.width;
        entry.height = d.height;
      } catch {
        entry.failed = true;
      }
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = this.url(asset);
  }

  private loadVideo(asset: Asset) {
    const el = document.createElement("video");
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    el.loop = true;
    el.preload = "auto";
    el.disablePictureInPicture = true;
    el.setAttribute("muted", "");
    el.setAttribute("playsinline", "");
    const entry: VideoEntry = { kind: "video", asset, el, width: 0, height: 0, failed: false, version: 0, lastTime: -1, usedAt: 0, seekPending: false, hadData: false };
    el.addEventListener("loadedmetadata", () => {
      entry.width = el.videoWidth;
      entry.height = el.videoHeight;
    });
    el.addEventListener("seeked", () => {
      entry.seekPending = false;
      entry.version++;
    });
    el.addEventListener("error", () => {
      entry.failed = true;
    });
    this.entries.set(asset.id, entry);
    el.src = this.url(asset);
    try {
      el.load();
    } catch {
      entry.failed = true;
    }
  }

  private drop(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    if (e.kind === "video") {
      try {
        e.el.pause();
        e.el.removeAttribute("src");
        e.el.load();
      } catch {
        /* already gone */
      }
    }
  }

  /**
   * A texture source for the asset this frame. For videos, `wanted` is where the clip should be
   * (seconds); `playing` runs it at normal speed, otherwise it is held (paused, seeked).
   */
  frame(asset: Asset, now: number, video?: { wanted: number; playing: boolean }): MediaSourceFrame {
    const e = this.entries.get(asset.id);
    if (!e || e.failed) return { source: null, width: 0, height: 0, version: 0 };
    if (e.kind === "image") return { source: e.source, width: e.width, height: e.height, version: 0 };
    e.usedAt = now;
    const el = e.el;
    const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : asset.duration ?? 0;
    if (video && el.readyState >= 1 && !e.seekPending) {
      const wanted = d > 0 ? Math.min(Math.max(0, video.wanted), Math.max(0, d - 0.05)) : 0;
      if (needsSeek(el.currentTime, wanted, d)) {
        e.seekPending = true;
        try {
          el.currentTime = wanted;
        } catch {
          e.seekPending = false;
        }
      }
      if (video.playing) {
        if (el.paused) void el.play().catch(() => {});
      } else if (!el.paused) el.pause();
    }
    if (el.currentTime !== e.lastTime) {
      e.lastTime = el.currentTime;
      e.version++;
    }
    // HAVE_CURRENT_DATA: there is a frame to upload
    const ready = el.readyState >= 2 && e.width > 0 && e.height > 0;
    if (ready) e.hadData = true;
    // mid-seek (every beat for beat-cut) the last uploaded frame stays on screen
    if (!ready && e.hadData) return { source: el, width: e.width, height: e.height, version: e.version, hold: true };
    return { source: ready ? el : null, width: e.width, height: e.height, version: e.version };
  }

  /** Pause videos that no layer used for a while (they keep their buffered data). */
  idle(now: number) {
    for (const e of this.entries.values()) {
      if (e.kind === "video" && !e.el.paused && now - e.usedAt > 500) e.el.pause();
    }
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.drop(id);
  }

  destroy() {
    this.destroyed = true;
    this.clear();
  }
}
