// Browser-only: measure an image / video file before upload (the server stores the size the
// browser reports and validates its range; it never decodes media itself).

export interface MediaProbe {
  video: boolean;
  width: number;
  height: number;
  /** seconds, videos only */
  duration?: number;
}

const VIDEO_EXT = /\.(mp4|m4v|webm|mov)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

export function looksLikeVideo(file: File): boolean {
  return file.type.startsWith("video/") || (!file.type && VIDEO_EXT.test(file.name));
}

export function looksLikeMedia(file: File): boolean {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return false;
  return file.type.startsWith("image/") || file.type.startsWith("video/") || VIDEO_EXT.test(file.name) || IMAGE_EXT.test(file.name);
}

function probeImage(url: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) resolve({ video: false, width: img.naturalWidth, height: img.naturalHeight });
      else reject(new Error("無法讀取圖片尺寸"));
    };
    img.onerror = () => reject(new Error("瀏覽器無法開啟這張圖片"));
    img.src = url;
  });
}

function probeVideo(url: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.muted = true;
    el.preload = "metadata";
    const timer = window.setTimeout(() => reject(new Error("讀取影片資訊逾時")), 15000);
    const done = () => {
      window.clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
    };
    el.onloadedmetadata = () => {
      const finish = (duration: number) => {
        const w = el.videoWidth;
        const h = el.videoHeight;
        done();
        if (w > 0 && h > 0 && duration > 0 && Number.isFinite(duration)) resolve({ video: true, width: w, height: h, duration });
        else reject(new Error(w > 0 ? "無法讀取影片長度" : "這個影片沒有畫面，或瀏覽器不支援它的編碼"));
      };
      if (Number.isFinite(el.duration) && el.duration > 0) finish(el.duration);
      else {
        // MediaRecorder WebM files report Infinity until the end has been seen
        el.ondurationchange = () => {
          if (Number.isFinite(el.duration) && el.duration > 0) finish(el.duration);
        };
        try {
          el.currentTime = 1e7;
        } catch {
          finish(NaN);
        }
      }
    };
    el.onerror = () => {
      done();
      reject(new Error("瀏覽器無法播放這個影片（請用 H.264 MP4 或 WebM）"));
    };
    el.src = url;
  });
}

export async function probeMedia(file: File): Promise<MediaProbe> {
  const url = URL.createObjectURL(file);
  try {
    return looksLikeVideo(file) ? await probeVideo(url) : await probeImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
