// Typed browser-side wrappers for the local API routes (src/app/api/**).
// The route handlers must implement exactly these shapes.

import type { AudioAnalysis, DesignPlan, Lyrics, PipelineEvent, Project, ProjectSummary, SongMeta } from "./types";

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
  }) {
    const form = new FormData();
    form.set("audio", input.audio);
    form.set("meta", JSON.stringify(input.meta));
    form.set("analysis", JSON.stringify(input.analysis));
    return fetch("/api/projects", { method: "POST", body: form }).then((r) => json<Project>(r));
  },

  updateProject: (id: string, patch: Partial<{ meta: Partial<SongMeta>; lyrics: Lyrics; plan: DesignPlan }>) =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<Project>(r)),

  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),

  audioUrl: (id: string) => `/api/projects/${id}/audio`,

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
}
