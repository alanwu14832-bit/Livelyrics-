// Cloud file store: Vercel Blob (a Public store). The browser uploads straight to Blob
// (@vercel/blob/client upload() with the token route /api/blob/upload, since a function request
// body is limited to about 4.5 MB); the server only checks what arrived, serves it and deletes it.
//
// Serving: 307 to the public blob URL. Blob's CDN answers Range requests (206) and sends
// `Access-Control-Allow-Origin: *` on GET / 206 / 404 responses (checked against a public blob;
// OPTIONS answers 405, so only requests without a preflight work cross-origin, which is what
// media elements and plain fetch() send). The stage therefore loads media with
// crossOrigin="anonymous" and stays readable for WebGL textures, Web Audio and the export.
// LIVELYRICS_BLOB_DELIVERY=proxy streams the blob through the function instead (Range, If-Range and
// If-None-Match are forwarded), for a browser or network where the redirect does not work.

import { BlobNotFoundError, del, head } from "@vercel/blob";
import { HttpError } from "../http";
import { StorageError } from "./errors";
import type { BlobInfo, FileStore, ServeOptions } from "./types";

/** The part of the @vercel/blob API the store uses (an in-memory fake implements it in tests). */
export interface BlobApi {
  /** metadata, or null when the blob does not exist in this store */
  head(url: string): Promise<{ url: string; pathname: string; size: number; contentType: string } | null>;
  del(urls: string[]): Promise<void>;
  /** plain GET / HEAD of a public blob URL (magic bytes, the proxy delivery) */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response>;
}

export function vercelBlobApi(token: string): BlobApi {
  return {
    async head(url) {
      try {
        const h = await head(url, { token });
        return { url: h.url, pathname: h.pathname, size: h.size, contentType: h.contentType };
      } catch (err) {
        if (err instanceof BlobNotFoundError) return null;
        throw err;
      }
    },
    async del(urls) {
      if (urls.length) await del(urls, { token });
    },
    fetch: (url, init = {}) => fetch(url, { ...init, cache: "no-store" }),
  };
}

export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export interface BlobStoreOptions {
  /** "redirect" (default) or "proxy" (see above) */
  delivery?: "redirect" | "proxy";
  /** accept blob URLs on any host (a local Blob API emulator); head() stays the authority */
  anyHost?: boolean;
}

/** how long reading the first bytes of an uploaded blob may take */
const INSPECT_TIMEOUT_MS = 20_000;

/** Stop a response body without waiting: under Next's fetch a cancel can stay pending until the transfer ends. */
function discard(body: ReadableStream<Uint8Array> | null | undefined): void {
  void body?.cancel().catch(() => {});
}

async function readFirst(body: ReadableStream<Uint8Array>, n: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const out = new Uint8Array(n);
  let len = 0;
  let ended = false;
  try {
    while (len < n) {
      const { value, done } = await reader.read();
      if (done || !value) {
        ended = true;
        break;
      }
      const take = Math.min(value.length, n - len);
      out.set(value.subarray(0, take), len);
      len += take;
    }
  } finally {
    // the rest (if the server ignored the Range) is not needed; do not wait for the cancel
    if (!ended) void reader.cancel().catch(() => {});
  }
  return out.subarray(0, len);
}

const FORWARD_REQUEST = ["range", "if-range", "if-none-match", "if-modified-since"];
const FORWARD_RESPONSE = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"];

async function proxyBlob(api: BlobApi, req: Request, url: string, o: ServeOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  for (const name of FORWARD_REQUEST) {
    const v = req.headers.get(name);
    if (v) headers[name] = v;
  }
  const upstream = await api.fetch(url, { method: o.withBody ? "GET" : "HEAD", headers, signal: req.signal });
  if (upstream.status === 404) throw new HttpError(404, o.missing);
  const out = new Headers({
    "Content-Type": o.contentType,
    "Cache-Control": "private, no-cache, no-transform",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(o.fileName)}`,
  });
  for (const name of FORWARD_RESPONSE) {
    const v = upstream.headers.get(name);
    if (v) out.set(name, v);
  }
  if (!out.has("accept-ranges")) out.set("Accept-Ranges", "bytes");
  if (upstream.status === 416) {
    discard(upstream.body);
    out.set("Content-Type", "application/json");
    return new Response(o.withBody ? JSON.stringify({ error: o.badRange }) : null, { status: 416, headers: out });
  }
  if (upstream.status >= 400) {
    discard(upstream.body);
    throw new HttpError(502, "讀取雲端檔案失敗");
  }
  return new Response(o.withBody ? upstream.body : null, { status: upstream.status, headers: out });
}

export function createBlobFileStore(api: BlobApi, opts: BlobStoreOptions = {}): FileStore {
  const delivery = opts.delivery ?? "redirect";
  return {
    mode: "cloud",

    async place() {
      throw new Error("雲端模式的檔案由瀏覽器直接上傳到 Vercel Blob");
    },

    async remove(files) {
      const urls = [...new Set(files.flatMap((f) => (f.kind === "blob" ? [f.blob.url] : [])))];
      if (!urls.length) return;
      try {
        await api.del(urls);
      } catch (err) {
        // an orphaned blob only costs storage; the document change must not fail because of it
        console.error("[livelyrics] blob delete failed:", err instanceof Error ? err.message : err);
      }
    },

    async serve(req, file, o) {
      if (file.kind !== "blob") throw new HttpError(404, o.missing);
      if (delivery === "proxy") return proxyBlob(api, req, file.blob.url, o);
      // the blob URL never changes (random suffix), so the browser may reuse the redirect
      return new Response(null, { status: 307, headers: { Location: file.blob.url, "Cache-Control": "private, max-age=3600" } });
    },

    async inspect(blob, { prefix, headBytes = 64 }): Promise<BlobInfo> {
      const pathname = typeof blob?.pathname === "string" ? blob.pathname : "";
      let url: URL;
      try {
        url = new URL(String(blob?.url));
      } catch {
        throw new HttpError(400, "上傳的檔案網址無效");
      }
      if (!opts.anyHost && (url.protocol !== "https:" || !url.hostname.endsWith(BLOB_HOST_SUFFIX))) {
        throw new HttpError(400, "這不是 Vercel Blob 的檔案網址");
      }
      let urlPath = "";
      try {
        urlPath = decodeURIComponent(url.pathname.slice(1));
      } catch {
        /* rejected below */
      }
      if (!pathname.startsWith(prefix) || pathname.includes("..") || /[\u0000-\u001f]/.test(pathname) || urlPath !== pathname || url.search) {
        throw new HttpError(400, "上傳的檔案位置不正確");
      }
      const meta = await api.head(url.href);
      if (!meta || meta.pathname !== pathname) throw new HttpError(400, "找不到上傳的檔案，請重新上傳");
      let first: Uint8Array;
      try {
        const res = await api.fetch(meta.url, { headers: { range: `bytes=0-${Math.max(1, headBytes) - 1}` }, signal: AbortSignal.timeout(INSPECT_TIMEOUT_MS) });
        if (!res.ok || !res.body) {
          discard(res.body);
          throw new HttpError(502, "無法讀取上傳的檔案");
        }
        first = await readFirst(res.body, headBytes);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(502, "無法讀取上傳的檔案，請稍後再試");
      }
      return { blob: { url: meta.url, pathname }, size: meta.size, contentType: meta.contentType, head: first };
    },

    async read(file, { maxBytes, signal }) {
      if (file.kind !== "blob") throw new StorageError("not_found", "找不到檔案");
      const res = await api.fetch(file.blob.url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(INSPECT_TIMEOUT_MS)]) : AbortSignal.timeout(INSPECT_TIMEOUT_MS) });
      if (res.status === 404) {
        discard(res.body);
        throw new StorageError("not_found", "找不到檔案");
      }
      if (!res.ok || !res.body) {
        discard(res.body);
        throw new HttpError(502, "讀取雲端檔案失敗");
      }
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        discard(res.body);
        throw new HttpError(413, "檔案太大");
      }
      const out = await readFirst(res.body, maxBytes + 1);
      if (out.length > maxBytes) throw new HttpError(413, "檔案太大");
      return out;
    },
  };
}
