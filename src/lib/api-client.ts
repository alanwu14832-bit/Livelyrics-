// Typed browser-side wrappers for the local API routes (src/app/api/**).
// The route handlers must implement exactly these shapes.
//
// Cloud mode (a Vercel deployment, see /api/status `storage.mode`): uploads go from the browser
// straight to Vercel Blob and are then registered with the same routes (JSON instead of
// multipart), and `process` drives the pipeline one step per request (src/lib/process-runner.ts).

import { bandAssetUrl, projectAssetUrl } from "./asset-scope";
import type { BiblePatch } from "./band";
import type { OutputPatch } from "./output";
import { abortableSleep, ProcessBusyError, runStepwise } from "./process-runner";
import type {
  Asset,
  AssetKind,
  AudioAnalysis,
  Band,
  BandSummary,
  CollectedVisual,
  MaterialAuthorization,
  DesignPlan,
  DirectionEngine,
  Lyrics,
  MoodImage,
  MoodStats,
  PipelineEvent,
  Project,
  ProjectSummary,
  SetItem,
  Show,
  ShowArc,
  ShowSummary,
  SongArcDirective,
  SongMeta,
  SongTimecode,
  ProjectThumb,
} from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export type StorageModeName = "local" | "cloud" | "unconfigured";

export interface ServerStatus {
  /** true when ANTHROPIC_API_KEY (or another Anthropic credential) is configured */
  claude: boolean;
  model: string;
  /** local mode only ("" otherwise) */
  dataDir: string;
  storage: {
    /** local disk, cloud (Postgres + Vercel Blob), or on Vercel without them */
    mode: StorageModeName;
    /** both cloud credentials are present */
    cloudConfigured: boolean;
    /** unconfigured: the variables still missing */
    missing: string[];
    /** running on Vercel */
    onVercel: boolean;
    /** unconfigured: a Blob store is connected (BLOB_STORE_ID, OIDC) but BLOB_READ_WRITE_TOKEN is not set */
    blobStoreWithoutToken?: boolean;
  };
  /** LIVELYRICS_PASSWORD is set: pages and APIs need a login */
  auth: boolean;
}

let storageModePromise: Promise<StorageModeName> | null = null;

/** The server's storage mode, asked once per page load (local when the status cannot be read). */
export function storageMode(): Promise<StorageModeName> {
  storageModePromise ??= fetch("/api/status")
    .then((r) => (r.ok ? (r.json() as Promise<Partial<ServerStatus>>) : null))
    .then((s) => s?.storage?.mode ?? "local")
    .catch(() => {
      storageModePromise = null;
      return "local" as const;
    });
  return storageModePromise;
}

function newRunId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** One streamed POST /process: resolves with the `done` project (409 -> ProcessBusyError). */
async function processStream(id: string, body: ProcessRequest, onEvent: (e: PipelineEvent) => void, signal?: AbortSignal): Promise<Project> {
  const res = await fetch(`/api/projects/${id}/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 409) {
    let message = "這首歌已經有一個處理正在進行";
    try {
      const b = (await res.json()) as { error?: string };
      if (b?.error) message = b.error;
    } catch {
      /* ignore */
    }
    throw new ProcessBusyError(message);
  }
  if (!res.ok || !res.body) await json(res);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: Project | null = null;
  let failure: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const event = JSON.parse(data) as PipelineEvent;
      if (event.type === "done") final = event.project;
      if (event.type === "error") failure = event.message;
      onEvent(event);
    }
  }
  if (failure && !final) throw new Error(failure);
  if (!final) throw new Error("處理中斷：伺服器沒有回傳結果");
  return final;
}

export const api = {
  status: () => fetch("/api/status").then((r) => json<ServerStatus>(r)),

  listProjects: () => fetch("/api/projects").then((r) => json<ProjectSummary[]>(r)),

  getProject: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<Project>(r)),

  /**
   * Local: multipart upload of the audio file + meta + analysis computed in the browser.
   * Cloud: the audio goes straight to Vercel Blob (with progress), then the project is created from it.
   */
  async createProject(
    input: {
      audio: File;
      meta: Pick<SongMeta, "title" | "artist" | "album" | "year" | "duration">;
      analysis: AudioAnalysis | null;
      /** assign the new song to a band */
      bandId?: string | null;
    },
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<Project> {
    if ((await storageMode()) === "cloud") {
      // the Blob SDK is only loaded in cloud mode
      const { audioUploadType, uploadToBlob } = await import("./cloud-upload");
      const type = await audioUploadType(input.audio);
      const blob = await uploadToBlob(input.audio, { kind: "audio" }, type, opts);
      return fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blob, fileName: input.audio.name, meta: input.meta, analysis: input.analysis, ...(input.bandId ? { bandId: input.bandId } : {}) }),
        signal: opts.signal,
      }).then((r) => json<Project>(r));
    }
    const form = new FormData();
    form.set("audio", input.audio);
    form.set("meta", JSON.stringify(input.meta));
    form.set("analysis", JSON.stringify(input.analysis));
    if (input.bandId) form.set("bandId", input.bandId);
    return fetch("/api/projects", { method: "POST", body: form }).then((r) => json<Project>(r));
  },

  updateProject: (
    id: string,
    patch: Partial<{
      meta: Partial<SongMeta>;
      lyrics: Lyrics;
      plan: DesignPlan;
      output: OutputPatch;
      /** assign to a band (null = no band) */
      bandId: string | null;
      /** phase 5a: the song's start timecode (null = the default 01:00:00:00) */
      timecode: SongTimecode | null;
      /** the library card's picture: a small key still of the current plan */
      thumb: ProjectThumb | null;
    }>,
  ) =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<Project>(r)),

  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),

  audioUrl: (id: string) => `/api/projects/${id}/audio`,

  // ---- band media assets ---------------------------------------------------

  listAssets: (id: string) => fetch(`/api/projects/${id}/assets`).then((r) => json<{ assets: Asset[] }>(r)),

  /** GET (with HTTP Range) of the stored file; usable as <img>/<video> src and WebGL texture source */
  assetUrl: (id: string, assetId: string) => projectAssetUrl(id, assetId),

  /**
   * multipart upload: `file` + `meta` (size measured in the browser). Reports upload progress
   * (0..1) through XMLHttpRequest, which fetch cannot do. Rejects with the server's message.
   */
  uploadAsset(
    id: string,
    input: AssetUploadInput,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<{ asset: Asset; assets: Asset[] }> {
    return api.uploadOwnedAsset({ kind: "project", id }, input, opts);
  },

  /**
   * Upload into a project's library or a band's shared library (same contract). Cloud: the file
   * goes straight to Vercel Blob (progress from the SDK), then it is registered with the library.
   */
  async uploadOwnedAsset(
    owner: AssetOwner,
    input: AssetUploadInput,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<{ asset: Asset; assets: Asset[] }> {
    return uploadToLibrary<{ asset: Asset; assets: Asset[] }>(assetsBase(owner), owner, input, opts, (b) => !!(b as { asset?: unknown })?.asset);
  },

  updateAsset: (id: string, assetId: string, patch: Partial<{ name: string; note: string | null; tags: string[] | null; kind: AssetKind }>) =>
    fetch(`/api/projects/${id}/assets/${assetId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<{ asset: Asset; assets: Asset[] }>(r)),

  /** also clears the asset from every plan section: the response carries the updated plan */
  deleteAsset: (id: string, assetId: string) =>
    fetch(`/api/projects/${id}/assets/${assetId}`, { method: "DELETE" }).then((r) => json<{ ok: true; assets: Asset[]; plan: DesignPlan | null }>(r)),

  /** file URL of an asset in a project or band library */
  ownedAssetUrl: (owner: AssetOwner, assetId: string) => (owner.kind === "band" ? bandAssetUrl(owner.id, assetId) : projectAssetUrl(owner.id, assetId)),

  updateOwnedAsset: (owner: AssetOwner, assetId: string, patch: Partial<{ name: string; note: string | null; tags: string[] | null; kind: AssetKind }>) =>
    fetch(`${assetsBase(owner)}/${assetId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<{ asset: Asset; assets: Asset[] }>(r)),

  /** project: `plan` is the updated plan; band: every song and show look that showed it is cleared on the server */
  deleteOwnedAsset: (owner: AssetOwner, assetId: string) =>
    fetch(`${assetsBase(owner)}/${assetId}`, { method: "DELETE" }).then((r) => json<{ ok: true; assets: Asset[]; plan?: DesignPlan | null }>(r)),

  // ---- mood board (參考圖, phase 4) -------------------------------------------

  /** a song's or a band's mood board */
  // 研究找到的素材 (phase 8)
  listCollected: (id: string) =>
    fetch(`/api/projects/${id}/collected`).then((r) => json<{ items: CollectedVisual[]; authorization: MaterialAuthorization | null }>(r)),
  /** the band's one-time acknowledgement that its material may be used on stage */
  authorizeMaterial: (id: string, note?: string) =>
    fetch(`/api/projects/${id}/collected`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "authorize", ...(note ? { note } : {}) }) }).then((r) =>
      json<{ items: CollectedVisual[]; authorization: MaterialAuthorization; project: Project }>(r),
    ),
  /** 可以上台 / 只當參考, or the colours the browser measured */
  updateCollected: (id: string, itemId: string, patch: { use?: "stage" | "reference"; stats?: MoodStats }) =>
    fetch(`/api/projects/${id}/collected/${itemId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) =>
      json<{ item: CollectedVisual; items: CollectedVisual[]; plan: DesignPlan | null }>(r),
    ),
  /** 移除: the file and both uses */
  deleteCollected: (id: string, itemId: string) =>
    fetch(`/api/projects/${id}/collected/${itemId}`, { method: "DELETE" }).then((r) => json<{ ok: true; items: CollectedVisual[]; plan: DesignPlan | null }>(r)),
  collectedUrl: (id: string, itemId: string) => `/api/projects/${id}/collected/${itemId}`,
  listMoodboard: (owner: AssetOwner) => fetch(moodBase(owner)).then((r) => json<{ images: MoodImage[] }>(r)),

  moodImageUrl: (owner: AssetOwner, imageId: string) => `${moodBase(owner)}/${imageId}`,

  /** `file` is the browser-downscaled image (src/lib/moodboard-client.ts), `stats` its measured colours */
  uploadMoodImage(
    owner: AssetOwner,
    input: MoodUploadInput,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<{ image: MoodImage; images: MoodImage[] }> {
    return uploadToLibrary<{ image: MoodImage; images: MoodImage[] }>(moodBase(owner), owner, input, opts, (b) => !!(b as { image?: unknown })?.image);
  },

  updateMoodImage: (owner: AssetOwner, imageId: string, patch: { note?: string | null; name?: string }) =>
    fetch(`${moodBase(owner)}/${imageId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) =>
      json<{ image: MoodImage; images: MoodImage[] }>(r),
    ),

  deleteMoodImage: (owner: AssetOwner, imageId: string) =>
    fetch(`${moodBase(owner)}/${imageId}`, { method: "DELETE" }).then((r) => json<{ ok: true; images: MoodImage[] }>(r)),

  // ---- design directions (設計方向, phase 4) ----------------------------------

  /** 提出設計方向 / 修改 / 採用 / 復原 / 退回 / 意見 (see /api/projects/[id]/directions) */
  directions: (id: string, body: DirectionsAction, signal?: AbortSignal) =>
    fetch(`/api/projects/${id}/directions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }).then((r) =>
      json<{ project: Project; engine?: DirectionEngine; logs?: string[] }>(r),
    ),

  // ---- 用 claude.ai 研究 (manual Claude mode) --------------------------------

  /** The complete prompt to paste into claude.ai (plan or directions; 精簡版 with `compact`). */
  manualPrompt: (id: string, body: { target: ManualTarget; compact?: boolean; instruction?: string }) =>
    fetch(`/api/projects/${id}/manual`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prompt", ...body }) }).then((r) =>
      json<ManualPromptResult>(r),
    ),

  /**
   * Apply a pasted claude.ai reply. Resolves with `{ ok: false, issues, fixPrompt }` when the reply
   * cannot be used (HTTP 422); other failures reject like every other call.
   */
  async manualApply(id: string, body: { target: ManualTarget; reply: string; brief?: string }): Promise<ManualApplyResult> {
    const res = await fetch(`/api/projects/${id}/manual`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply", ...body }) });
    if (res.status === 422) return (await res.json()) as ManualApplyResult;
    return json<ManualApplyResult>(res);
  },

  // ---- bands ----------------------------------------------------------------

  listBands: () => fetch("/api/bands").then((r) => json<BandSummary[]>(r)),

  getBand: (id: string) => fetch(`/api/bands/${id}`).then((r) => json<Band>(r)),

  createBand: (name: string) =>
    fetch("/api/bands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => json<Band>(r)),

  /** `bible` is partial: only the fields given change */
  updateBand: (id: string, patch: { name?: string; bible?: BiblePatch }) =>
    fetch(`/api/bands/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => json<Band>(r)),

  /** deletes the band, its library and its shows; its songs stay, unassigned */
  deleteBand: (id: string) => fetch(`/api/bands/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),

  /** 從作品產生視覺聖經 (Claude or the offline designer); replaces the bible */
  generateBible: (id: string, signal?: AbortSignal) =>
    fetch(`/api/bands/${id}/bible`, { method: "POST", signal }).then((r) => json<{ band: Band; engine: "claude" | "offline"; logs: string[] }>(r)),

  // ---- shows ----------------------------------------------------------------

  listShows: (bandId?: string) => fetch(`/api/shows${bandId ? `?bandId=${encodeURIComponent(bandId)}` : ""}`).then((r) => json<ShowSummary[]>(r)),

  getShow: (id: string) => fetch(`/api/shows/${id}`).then((r) => json<Show>(r)),

  createShow: (input: { bandId: string; name: string; date?: string; venue?: string }) =>
    fetch("/api/shows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).then((r) => json<Show>(r)),

  updateShow: (
    id: string,
    patch: Partial<{
      name: string;
      date: string | null;
      venue: string | null;
      notes: string;
      items: SetItem[];
      output: OutputPatch;
      arc: ShowArc | null;
    }>,
  ) => fetch(`/api/shows/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => json<Show>(r)),

  deleteShow: (id: string) => fetch(`/api/shows/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),

  /** 整場弧線 (Claude or the offline designer); saved on the show */
  planArc: (id: string, signal?: AbortSignal) =>
    fetch(`/api/shows/${id}/arc`, { method: "POST", signal }).then((r) => json<{ show: Show; engine: "claude" | "offline"; logs: string[] }>(r)),

  /** copy the show's canvas onto every song of its setlist */
  applyShowOutput: (id: string) => fetch(`/api/shows/${id}/apply-output`, { method: "POST" }).then((r) => json<{ updated: number; show: Show }>(r)),

  searchLyrics: (q: { artist: string; title: string; duration?: number }) => {
    const p = new URLSearchParams({ artist: q.artist, title: q.title });
    if (q.duration) p.set("duration", String(Math.round(q.duration)));
    return fetch(`/api/lyrics/search?${p}`).then((r) => json<{ results: LyricsSearchResult[] }>(r));
  },

  /**
   * Run (part of) the processing pipeline. Streams PipelineEvents (SSE) and
   * resolves with the final project. Pass an AbortSignal to cancel. Cloud mode: one request per
   * step, and an attach-only call watches a run recorded on the project and continues it.
   */
  async process(id: string, body: ProcessRequest, onEvent: (e: PipelineEvent) => void, signal?: AbortSignal): Promise<Project> {
    if ((await storageMode()) !== "cloud") return processStream(id, body, onEvent, signal);
    return runStepwise(id, body, onEvent, signal, { stream: processStream, getProject: (pid) => api.getProject(pid), sleep: abortableSleep, newRunId });
  },
};

/** Whose media library: a song's own or the band's shared one. */
export type AssetOwner = { kind: "project"; id: string } | { kind: "band"; id: string };

function assetsBase(owner: AssetOwner): string {
  return owner.kind === "band" ? `/api/bands/${owner.id}/assets` : `/api/projects/${owner.id}/assets`;
}

function moodBase(owner: AssetOwner): string {
  return owner.kind === "band" ? `/api/bands/${owner.id}/moodboard` : `/api/projects/${owner.id}/moodboard`;
}

/**
 * Upload into a library route (media or mood board, same contract). Local: multipart with progress
 * through XMLHttpRequest. Cloud: the file goes straight to Vercel Blob (progress from the SDK),
 * then it is registered with the route as JSON.
 */
async function uploadToLibrary<T>(
  base: string,
  owner: AssetOwner,
  input: { file: File } & Record<string, unknown>,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ok: (body: unknown) => boolean,
): Promise<T> {
  if ((await storageMode()) === "cloud") {
    const { assetUploadType, uploadToBlob } = await import("./cloud-upload");
    const { file, ...meta } = input;
    const type = await assetUploadType(file);
    const target = owner.kind === "band" ? ({ kind: "band-asset", bandId: owner.id } as const) : ({ kind: "project-asset", projectId: owner.id } as const);
    // the last bit of the bar is the registration
    const blob = await uploadToBlob(file, target, type, { signal: opts.signal, onProgress: (p) => opts.onProgress?.(p * 0.97) });
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...meta, blob, fileName: file.name }),
      signal: opts.signal,
    });
    const body = await json<T>(res);
    opts.onProgress?.(1);
    return body;
  }
  const form = new FormData();
  const { file, ...meta } = input;
  form.set("meta", JSON.stringify(meta));
  form.set("file", file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", base);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      const body = xhr.response as ({ error?: string } & Record<string, unknown>) | null;
      if (xhr.status >= 200 && xhr.status < 300 && ok(body)) resolve(body as T);
      else reject(new Error(body?.error || `${xhr.status} ${xhr.statusText || "上傳失敗"}`));
    };
    xhr.onerror = () => reject(new Error("上傳失敗：無法連線到本機伺服器"));
    xhr.onabort = () => reject(new DOMException("已取消上傳", "AbortError"));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export interface MoodUploadInput {
  /** the downscaled image */
  file: File;
  width: number;
  height: number;
  name?: string;
  note?: string;
  stats?: MoodStats;
  [key: string]: unknown;
}

export type DirectionsAction =
  | { action: "generate"; instruction?: string }
  | { action: "revise"; directionId: string; text: string }
  | { action: "select"; directionId: string }
  | { action: "undo" }
  | { action: "status"; directionId: string; status: "rejected" | "proposed" }
  | { action: "comment"; directionId: string; text: string }
  | { action: "uncomment"; directionId: string; commentId: string }
  | { action: "clear" };

/** 用 claude.ai 研究: what the pasted reply becomes (the design plan, or 2–3 design directions). */
export type ManualTarget = "plan" | "directions";

/** Largest pasted reply the app accepts (UTF-8 bytes); the server checks again. */
export const MANUAL_REPLY_MAX_BYTES = 200 * 1024;

export interface ManualPromptResult {
  prompt: string;
  /** characters in the prompt */
  chars: number;
  compact: boolean;
  /** long enough that the free claude.ai tier may cut it: offer 精簡版 */
  long: boolean;
  /** mood board images to attach in claude.ai, numbered like the prompt (圖 1…) */
  images: Array<{ n: number; name: string; note?: string }>;
  /** 研究找到的素材 to attach after them, numbered like the prompt (素材 1…) */
  collected: Array<{ n: number; id: string; name: string; kind: string }>;
  /** the prompt asks Claude for the band's visual material (collected when the reply is applied) */
  visuals: boolean;
  /** the free research findings were included as a head start */
  findings: boolean;
}

export interface ManualIssue {
  /** JSON path, e.g. "sections[2].scene" (absent for whole-reply problems) */
  path?: string;
  message: string;
  severity: "error" | "warning";
}

export type ManualApplyResult =
  | {
      ok: true;
      project: Project;
      target: ManualTarget;
      /** what was repaired automatically (clamping, contrast, timing, unknown ids…) */
      notes: string[];
      /** what LED 安全模式 will change on stage */
      safety: string[];
      /** the reply's research brief was saved (研究簡報) */
      research: boolean;
      /** 研究找到的素材 downloaded from the reply's list: 「找到 2 張 MV 畫面」, the notes, or nothing */
      collected: string[];
    }
  | {
      ok: false;
      /** one-line summary (繁中) */
      error: string;
      issues: ManualIssue[];
      /** paste this into the same claude.ai chat to get a corrected JSON */
      fixPrompt: string;
      /** the research brief found in this reply: send it back with the corrected JSON so it is kept */
      brief?: string;
    };

export interface AssetUploadInput {
  [key: string]: unknown;
  file: File;
  /** pixel size measured in the browser (src/lib/media-probe.ts) */
  width: number;
  height: number;
  /** seconds, videos only */
  duration?: number;
  name?: string;
  /** "logo" marks an image as the band logo */
  kind?: AssetKind;
  note?: string;
  tags?: string[];
}

export interface LyricsSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  /** seconds */
  duration: number;
  synced: boolean;
  lyrics: Lyrics;
}

export interface ProcessRequest {
  /** which steps to run; default all: ["lyrics", "research", "design", "scene"] */
  steps?: Array<"lyrics" | "research" | "design" | "scene">;
  /** if provided, use these lyrics (plain text or LRC) instead of searching */
  lyricsText?: string;
  /** free-form art-direction instruction for a re-design, e.g. "副歌更熱血一點" */
  instruction?: string;
  /**
   * Only watch the run in progress (or one that finished in the last minute); never start
   * a new one. With nothing to attach to, the stream ends right away with `done` (project
   * ready) or `error` (never processed / last run failed). Other fields are ignored.
   */
  attachOnly?: boolean;
  /** the song's place in a show arc: the designer follows it (整場弧線) */
  arc?: SongArcDirective;
  /** do not call the Claude API in this run, even with a key: 免費研究 and the offline designer */
  free?: boolean;
  /**
   * Cloud mode: this request is one step of a run the page drives (`steps` holds that step). The
   * server records the run on the project so a refreshed page can continue it.
   */
  run?: { id: string; steps: Array<"lyrics" | "research" | "design" | "scene"> };
}
