// Shared helpers for the API route handlers: JSON errors, id validation, body limits,
// and HTTP Range parsing.

import { MultipartError } from "./multipart";
import { StorageError } from "./store/errors";
import { isValidDocId as isValidProjectId } from "./store/ids";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonError(status: number, message: string, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("Cache-Control", "no-store");
  return Response.json({ error: message }, { status, headers: h });
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** Map any thrown error to a JSON error response. */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return jsonError(err.status, err.message);
  if (err instanceof MultipartError) return jsonError(err.status, err.message);
  if (err instanceof StorageError) {
    if (err.code === "invalid_id") return jsonError(400, err.message);
    if (err.code === "not_found") return jsonError(404, err.message);
    if (err.code === "conflict") return jsonError(409, err.message);
    // on Vercel without Blob / Postgres: say what to create instead of failing obscurely
    if (err.code === "unconfigured") return jsonError(503, err.message);
    return jsonError(500, err.message);
  }
  if (isAbortError(err)) return jsonError(499, "請求已取消");
  console.error("[livelyrics] API error:", err);
  const detail = err instanceof Error && err.message ? `：${err.message}` : "";
  return jsonError(500, `伺服器發生錯誤${detail}`);
}

/** Wrap a route handler so every failure becomes `{ error }` JSON with a proper status. */
export function handle<C>(fn: (req: Request, ctx: C) => Promise<Response>): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function requireProjectId(id: string | undefined): string {
  if (!isValidProjectId(id)) throw new HttpError(400, "無效的專案 ID");
  return id;
}

/** A JSON request (cloud registrations, the login form's fetch) rather than multipart / a form post. */
export function isJsonRequest(req: Request): boolean {
  return /^application\/json\b/i.test(req.headers.get("content-type") ?? "");
}

/** Read and parse a JSON body with a size limit. Empty body -> `emptyValue` (or 400 when undefined). */
export async function readJson(req: Request, maxBytes: number, emptyValue?: unknown): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "請求內容太大");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "請求內容太大");
  if (!text.trim()) {
    if (emptyValue !== undefined) return emptyValue;
    throw new HttpError(400, "請求內容是空的");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "請求內容不是有效的 JSON");
  }
}

export type RangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Parse a Range header against a resource of `size` bytes (RFC 9110 §14).
 * - no header / another unit / several ranges -> full response (allowed by the RFC)
 * - `bytes=a-b`, `bytes=a-`, `bytes=-n` -> partial (end clamped to size - 1)
 * - malformed or out-of-bounds byte ranges -> 416
 */
export function parseRange(header: string | null, size: number): RangeResult {
  if (!header) return { kind: "full" };
  const m = header.trim().match(/^([A-Za-z]+)\s*=\s*(.*)$/);
  if (!m) return { kind: "unsatisfiable" };
  if (m[1].toLowerCase() !== "bytes") return { kind: "full" };
  const specs = m[2].split(",").map((s) => s.trim()).filter(Boolean);
  if (specs.length === 0) return { kind: "unsatisfiable" };
  if (specs.length > 1) return { kind: "full" };
  const spec = specs[0].match(/^(\d*)\s*-\s*(\d*)$/);
  if (!spec || (spec[1] === "" && spec[2] === "")) return { kind: "unsatisfiable" };
  if (size <= 0) return { kind: "unsatisfiable" };

  if (spec[1] === "") {
    const suffix = Number(spec[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(spec[1]);
  const end = spec[2] === "" ? size - 1 : Number(spec[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: "unsatisfiable" };
  if (start > end || start >= size) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}

/** Band and show ids share the project id shape (no "." or "/"). */
export function requireBandId(id: string | undefined): string {
  if (!isValidProjectId(id)) throw new HttpError(400, "無效的樂團 ID");
  return id;
}

export function requireShowId(id: string | undefined): string {
  if (!isValidProjectId(id)) throw new HttpError(400, "無效的演出 ID");
  return id;
}
