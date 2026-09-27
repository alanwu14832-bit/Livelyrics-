// Typed browser-side wrappers for the local API routes (src/app/api/**).
// The route handlers must implement exactly these shapes.

import { bandAssetUrl, projectAssetUrl } from "./asset-scope";
import type { BiblePatch } from "./band";
import type {
  Asset,
  AssetKind,
  AudioAnalysis,
  Band,
  BandSummary,
  DesignPlan,
  Lyrics,
  PipelineEvent,
  Project,
  ProjectOutput,
  ProjectSummary,
  SetItem,
  Show,
  ShowArc,
  ShowSummary,
  SongArcDirective,
  SongMeta,
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

export interface ServerStatus {
  /** true when ANTHROPIC_API_KEY (or another Anthropic credential) is configured */
  claude: boolean;
  model: string;
  dataDir: string;
}

export const api = {
  status: () => fetch("/api/status").then((r) => json<ServerStatus>(r)),

  listProjects: () => fetch("/api/projects").then((r) => json<ProjectSummary[]>(r)),

  getProject: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<Project>(r)),

  /** multipart upload: audio file + meta + analysis computed in the browser */
  createProject(input: {
    audio: File;
    meta: Pick<SongMeta, "title" | "artist" | "album" | "year" | "duration">;
    analysis: AudioAnalysis | null;
    /** assign the new song to a band */
    bandId?: string | null;
  }) {
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
      output: Partial<Omit<ProjectOutput, "lyricSafe">> & { lyricSafe?: Partial<ProjectOutput["lyricSafe"]> };
      /** assign to a band (null = no band) */
      bandId: string | null;
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

  /** Upload into a project's library or a band's shared library (same contract). */
  uploadOwnedAsset(
    owner: AssetOwner,
    input: AssetUploadInput,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<{ asset: Asset; assets: Asset[] }> {
    const form = new FormData();
    const { file, ...meta } = input;
    form.set("meta", JSON.stringify(meta));
    form.set("file", file);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", assetsBase(owner));
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total));
      };
      xhr.onload = () => {
        const body = xhr.response as { asset?: Asset; assets?: Asset[]; error?: string } | null;
        if (xhr.status >= 200 && xhr.status < 300 && body?.asset && body.assets) resolve({ asset: body.asset, assets: body.assets });
        else reject(new Error(body?.error || `${xhr.status} ${xhr.statusText || "上傳失敗"}`));
      };
      xhr.onerror = () => reject(new Error("上傳失敗：無法連線到本機伺服器"));
      xhr.onabort = () => reject(new DOMException("已取消上傳", "AbortError"));
      opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(form);
    });
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
      output: Partial<Omit<ProjectOutput, "lyricSafe">> & { lyricSafe?: Partial<ProjectOutput["lyricSafe"]> };
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
   * resolves with the final project. Pass an AbortSignal to cancel.
   */
  async process(
    id: string,
    body: ProcessRequest,
    onEvent: (e: PipelineEvent) => void,
    signal?: AbortSignal,
  ): Promise<Project> {
    const res = await fetch(`/api/projects/${id}/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
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
  },
};

/** Whose media library: a song's own or the band's shared one. */
export type AssetOwner = { kind: "project"; id: string } | { kind: "band"; id: string };

function assetsBase(owner: AssetOwner): string {
  return owner.kind === "band" ? `/api/bands/${owner.id}/assets` : `/api/projects/${owner.id}/assets`;
}

export interface AssetUploadInput {
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
  /** which steps to run; default all: ["lyrics", "research", "design"] */
  steps?: Array<"lyrics" | "research" | "design">;
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
}
