// Serve a file from disk with HTTP Range support (seeking in <audio> / <video>), ETag /
// If-None-Match / If-Range, and HEAD. Shared by the audio and asset routes.

import { promises as fs } from "node:fs";
import { HttpError, parseRange } from "./http";

const CHUNK_BYTES = 256 * 1024;

/** Stream bytes [start, end] of a file; the handle is closed on completion, error or cancel. */
export function fileStream(file: string, start: number, end: number): ReadableStream<Uint8Array> {
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

export interface ServeFileOptions {
  file: string;
  contentType: string;
  /** original file name for Content-Disposition */
  fileName: string;
  withBody: boolean;
  /** 404 message when the file is missing */
  missing: string;
  /** 416 message */
  badRange: string;
}

export async function serveFile(req: Request, o: ServeFileOptions): Promise<Response> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(o.file);
  } catch {
    throw new HttpError(404, o.missing);
  }
  if (!stat.isFile()) throw new HttpError(404, o.missing);

  const size = stat.size;
  const etag = `W/"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const lastModified = stat.mtime.toUTCString();
  const headers = new Headers({
    "Content-Type": o.contentType,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Last-Modified": lastModified,
    "Cache-Control": "private, no-cache, no-transform",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(o.fileName)}`,
  });

  let rangeHeader = req.headers.get("range");
  const ifRange = req.headers.get("if-range");
  if (rangeHeader && ifRange && ifRange !== etag && ifRange !== lastModified) rangeHeader = null; // resource changed: send it whole

  const range = parseRange(rangeHeader, size);
  if (range.kind === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    headers.set("Content-Type", "application/json");
    return new Response(o.withBody ? JSON.stringify({ error: o.badRange }) : null, { status: 416, headers });
  }

  if (range.kind === "full") {
    const inm = req.headers.get("if-none-match");
    if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === "*")) {
      return new Response(null, { status: 304, headers });
    }
    headers.set("Content-Length", String(size));
    return new Response(o.withBody && size > 0 ? fileStream(o.file, 0, size - 1) : null, { status: 200, headers });
  }

  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  headers.set("Content-Length", String(range.end - range.start + 1));
  return new Response(o.withBody ? fileStream(o.file, range.start, range.end) : null, { status: 206, headers });
}
