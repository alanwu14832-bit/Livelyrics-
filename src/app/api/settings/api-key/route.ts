// 「設定」 › Anthropic API 金鑰 (local mode). GET / PUT `{ key }` / DELETE → KeyStatus: whether a key
// is configured, its source and a masked form. The key itself is never sent back, never logged.

import { keyStatus, KeyError, removeApiKey, saveApiKey } from "@/lib/server/api-key";
import { handle, HttpError, json, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A write must come from this app's own pages (a cross-site form or fetch cannot set or remove the key). */
function sameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin requests of older browsers, scripts on this machine
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, "不允許從其他網站修改金鑰");
  }
  const own = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!own || host !== own) throw new HttpError(403, "不允許從其他網站修改金鑰");
}

function keyErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    // the message never contains the key
    if (err instanceof KeyError) throw new HttpError(err.status, err.message);
    throw err;
  }
}

export const GET = handle(async () => json(keyStatus()));

export const PUT = handle(async (req: Request) => {
  sameOrigin(req);
  const body = (await readJson(req, 4096)) as { key?: unknown } | null;
  return json(keyErrors(() => saveApiKey(body && typeof body === "object" ? body.key : undefined)));
});

export const DELETE = handle(async (req: Request) => {
  sameOrigin(req);
  return json(keyErrors(() => removeApiKey()));
});
