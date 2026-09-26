import { promises as fs } from "node:fs";
import { mimeForAudioFile } from "@/lib/server/audio-files";
import { handle, HttpError, parseRange, requireProjectId } from "@/lib/server/http";
import { audioPath, getProject } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const CHUNK_BYTES = 256 * 1024;

/** Stream bytes [start, end] of a file; the handle is closed on completion, error or cancel. */
function fileStream(file: string, start: number, end: number): ReadableStream<Uint8Array> {
  let handle: fs.FileHandle | null = null;
  let position = start;
  const close = async () => {
    const h = handle;
    handle = null;
    await h?.close().catch(() => {});
  };
  return new ReadableStream<Uint8Array>({
    async start() {
      handle = await fs.open(file, "r");
    },
    async pull(controller) {
      try {
        if (!handle) return;
        const remaining = end - position + 1;
        if (remaining <= 0) {
          await close();
          controller.close();
          return;
        }
        const buffer = new Uint8Array(Math.min(CHUNK_BYTES, remaining));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) {
          // file shrank underneath us
          await close();
          controller.close();
          return;
        }
        position += bytesRead;
        controller.enqueue(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
      } catch (err) {
        await close();
        controller.error(err);
      }
    },
    async cancel() {
      await close();
    },
  });
}

async function serve(req: Request, ctx: Ctx, withBody: boolean): Promise<Response> {
  const id = requireProjectId((await ctx.params).id);
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");
  if (!project.audioFile) throw new HttpError(404, "這個專案沒有音檔");

  const file = audioPath(project);
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(file);
  } catch {
    throw new HttpError(404, "找不到音檔");
  }
  if (!stat.isFile()) throw new HttpError(404, "找不到音檔");

  const size = stat.size;
  const etag = `W/"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const lastModified = stat.mtime.toUTCString();
  const headers = new Headers({
    "Content-Type": project.meta.mimeType || mimeForAudioFile(project.audioFile),
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Last-Modified": lastModified,
    "Cache-Control": "private, no-cache, no-transform",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(project.meta.fileName || project.audioFile)}`,
  });

  let rangeHeader = req.headers.get("range");
  const ifRange = req.headers.get("if-range");
  if (rangeHeader && ifRange && ifRange !== etag && ifRange !== lastModified) rangeHeader = null; // resource changed: send it whole

  const range = parseRange(rangeHeader, size);
  if (range.kind === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    headers.set("Content-Type", "application/json");
    return new Response(withBody ? JSON.stringify({ error: "要求的音檔範圍無效" }) : null, { status: 416, headers });
  }

  if (range.kind === "full") {
    const inm = req.headers.get("if-none-match");
    if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === "*")) {
      return new Response(null, { status: 304, headers });
    }
    headers.set("Content-Length", String(size));
    return new Response(withBody && size > 0 ? fileStream(file, 0, size - 1) : null, { status: 200, headers });
  }

  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  headers.set("Content-Length", String(range.end - range.start + 1));
  return new Response(withBody ? fileStream(file, range.start, range.end) : null, { status: 206, headers });
}

export const GET = handle((req: Request, ctx: Ctx) => serve(req, ctx, true));
export const HEAD = handle((req: Request, ctx: Ctx) => serve(req, ctx, false));
