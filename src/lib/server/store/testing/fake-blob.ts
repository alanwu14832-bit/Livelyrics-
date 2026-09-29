// Tests only: an in-memory stand-in for the part of Vercel Blob the cloud file store uses
// (head / del by URL, public GET with Range, the CORS header the CDN sends) plus `put`, which in
// production is the browser's direct upload.

import type { BlobApi } from "../blob-files";

export const FAKE_STORE_HOST = "teststore.public.blob.vercel-storage.com";

interface Entry {
  pathname: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface FakeBlob extends BlobApi {
  /** what the browser's upload() does: store bytes, with a random suffix like Blob */
  put(pathname: string, bytes: Uint8Array | string, contentType: string): { url: string; pathname: string };
  has(url: string): boolean;
  urls(): string[];
  deleted: string[];
}

export function createFakeBlob(host = FAKE_STORE_HOST): FakeBlob {
  const store = new Map<string, Entry>();
  const deleted: string[] = [];
  let seq = 0;
  return {
    deleted,
    put(pathname, bytes, contentType) {
      const dot = pathname.lastIndexOf(".");
      const suffix = `-r${(++seq).toString(36).padStart(8, "0")}`;
      const finalPath = dot > 0 ? `${pathname.slice(0, dot)}${suffix}${pathname.slice(dot)}` : `${pathname}${suffix}`;
      const url = `https://${host}/${finalPath}`;
      store.set(url, { pathname: finalPath, bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, contentType });
      return { url, pathname: finalPath };
    },
    has: (url) => store.has(url),
    urls: () => [...store.keys()],
    async head(url) {
      const e = store.get(url);
      return e ? { url, pathname: e.pathname, size: e.bytes.length, contentType: e.contentType } : null;
    },
    async del(urls) {
      for (const u of urls) {
        store.delete(u);
        deleted.push(u);
      }
    },
    async fetch(url, init = {}) {
      const e = store.get(url);
      const cors = { "access-control-allow-origin": "*" };
      if (!e) return new Response("not found", { status: 404, headers: cors });
      const range = init.headers?.range ?? init.headers?.Range;
      const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
      const body = init.method === "HEAD" ? null : undefined;
      if (m) {
        const start = Number(m[1]);
        const end = Math.min(m[2] ? Number(m[2]) : e.bytes.length - 1, e.bytes.length - 1);
        if (start >= e.bytes.length) return new Response(null, { status: 416, headers: { ...cors, "content-range": `bytes */${e.bytes.length}` } });
        const slice = e.bytes.slice(start, end + 1);
        return new Response(body === null ? null : new Blob([slice]), {
          status: 206,
          headers: { ...cors, "content-type": e.contentType, "content-range": `bytes ${start}-${end}/${e.bytes.length}`, "content-length": String(slice.length), "accept-ranges": "bytes" },
        });
      }
      return new Response(body === null ? null : new Blob([e.bytes.slice()]), {
        status: 200,
        headers: { ...cors, "content-type": e.contentType, "content-length": String(e.bytes.length), "accept-ranges": "bytes" },
      });
    },
  };
}
