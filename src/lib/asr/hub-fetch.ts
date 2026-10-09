// 「AI 自動對時」 (round 15): the fetch the worker hands transformers.js (env.fetch).
//
// transformers.js 4.3.1 loads the model files at the revision it is given, but a few helper requests
// ignore it and ask for `resolve/main/…`: the pipeline's file list and progress totals
// (`get_pipeline_files`, `get_file_metadata` — one-byte Range probes) and the tokenizer's
// `tokenizer_config.json` probe. Unpinned, they would follow the repo's `main` branch; and since they are
// never cached they hit huggingface.co on every run — a run with the model already downloaded would fail
// offline. So: every huggingface.co request for one of our models is pinned to its revision, and a request
// whose file is already in transformers.js' browser cache (keyed by the pinned URL) is answered from there.
// With the model cached, a run makes no network request at all.

/** model id → pinned revision */
export type HubPins = Record<string, string>;

const HUB = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/;

/** The pinned URL of a huggingface.co file of one of our models (`main` → the pinned revision), else null. */
export function pinnedUrl(url: string, pins: HubPins): string | null {
  const m = HUB.exec(url);
  if (!m) return null;
  const [, id, revision, file] = m;
  const pin = pins[id];
  if (!pin) return null;
  if (revision !== "main" && revision !== pin) return null;
  return `https://huggingface.co/${id}/resolve/${pin}/${file}`;
}

interface CacheLike {
  match(request: string): Promise<Response | undefined>;
}

/** env.fetch for transformers.js: pins our models' requests and answers cached files from the cache. */
export function pinnedFetch(pins: HubPins, base: typeof fetch, openCache: () => Promise<CacheLike | null>): typeof fetch {
  let cache: Promise<CacheLike | null> | null = null;
  const cached = async (url: string): Promise<Response | undefined> => {
    try {
      cache ??= openCache().catch(() => null);
      const c = await cache;
      return (await c?.match(url)) ?? undefined;
    } catch {
      return undefined;
    }
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const pinned = method === "GET" ? pinnedUrl(raw, pins) : null;
    if (!pinned) return base(input, init);
    // a whole cached file answers a one-byte probe too (the caller reads its content-length)
    const hit = await cached(pinned);
    if (hit) return hit;
    return base(pinned, init);
  }) as typeof fetch;
}
