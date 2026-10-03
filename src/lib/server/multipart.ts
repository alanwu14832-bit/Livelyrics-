// Streaming multipart/form-data parser for uploads: the file part is written straight to
// disk (never buffered in memory), small text fields are collected. No dependencies.

import { createWriteStream, promises as fs, type WriteStream } from "node:fs";
import { once } from "node:events";

export class MultipartError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MultipartError";
    this.status = status;
  }
}

export interface UploadedFile {
  field: string;
  fileName: string;
  contentType: string;
  size: number;
  /** temp file on disk; the caller owns it (move or delete it) */
  path: string;
  /** first bytes of the file, for magic-byte sniffing */
  head: Uint8Array;
}

export interface MultipartResult {
  fields: Record<string, string>;
  file: UploadedFile | null;
}

export interface MultipartOptions {
  /** name of the one file field to keep; other file parts are discarded */
  fileField: string;
  maxFileBytes: number;
  /** per text field, default 16 MB (analysis JSON can be large) */
  maxFieldBytes?: number;
  maxFields?: number;
  /** creates the temp file path for the file part */
  tempPath: () => Promise<string>;
  /** what the file is called in error messages (default 音檔) */
  fileLabel?: string;
  /** the request's Content-Length, when known: an incomplete upload then says how much arrived */
  declaredBytes?: number | null;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} MB`;

/** The message of an upload whose body ended before the closing boundary. */
export function incompleteMessage(received: number, declared: number | null): string {
  if (declared != null && declared > 0 && received < declared) {
    return `上傳內容不完整：伺服器只收到 ${mb(received)}，應有 ${mb(declared)}。連線可能中斷；如果每次都停在同一個大小，是伺服器的請求大小上限太低。`;
  }
  return `上傳內容不完整（收到 ${mb(received)}，連線可能中斷）`;
}

const HEAD_BYTES = 64;
const MAX_HEADER_BYTES = 16 * 1024;
const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

export function getBoundary(contentType: string | null): string {
  if (!contentType || !/^multipart\/form-data\b/i.test(contentType.trim())) {
    throw new MultipartError(415, "請以 multipart/form-data 上傳");
  }
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = m?.[1] ?? m?.[2];
  if (!boundary || boundary.length > 200) throw new MultipartError(400, "multipart 缺少 boundary");
  return boundary;
}

interface PartHeaders {
  name: string;
  fileName: string | null;
  contentType: string;
}

function parseParams(value: string): Map<string, string> {
  const params = new Map<string, string>();
  const re = /;\s*([^=;\s]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const key = m[1].toLowerCase();
    const raw = m[2] != null ? m[2].replace(/\\(.)/g, "$1") : m[3].trim();
    params.set(key, raw);
  }
  return params;
}

function decodeExtValue(value: string): string | null {
  // RFC 5987: charset'lang'percent-encoded
  const m = value.match(/^([^']*)'[^']*'(.*)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[2]);
  } catch {
    return null;
  }
}

function parsePartHeaders(block: string): PartHeaders {
  let disposition = "";
  let contentType = "";
  for (const line of block.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "content-disposition") disposition = value;
    else if (key === "content-type") contentType = value;
  }
  if (!/^form-data\b/i.test(disposition)) throw new MultipartError(400, "multipart 片段缺少 Content-Disposition");
  const params = parseParams(disposition.slice(disposition.indexOf(";") >= 0 ? disposition.indexOf(";") : disposition.length));
  const name = params.get("name");
  if (name == null) throw new MultipartError(400, "multipart 片段缺少欄位名稱");
  let fileName: string | null = null;
  const star = params.get("filename*");
  if (star != null) fileName = decodeExtValue(star);
  if (fileName == null && params.has("filename")) fileName = params.get("filename") ?? "";
  return { name, fileName, contentType };
}

interface Sink {
  write(chunk: Buffer): Promise<void>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}

function fieldSink(name: string, limit: number, onDone: (value: string) => void): Sink {
  const chunks: Buffer[] = [];
  let size = 0;
  return {
    async write(chunk) {
      size += chunk.length;
      if (size > limit) throw new MultipartError(413, `欄位「${name}」太大`);
      chunks.push(chunk);
    },
    async finish() {
      onDone(Buffer.concat(chunks).toString("utf8"));
    },
    async abort() {},
  };
}

const discardSink: Sink = { async write() {}, async finish() {}, async abort() {} };

function fileSink(path: string, limit: number, label: string, onDone: (size: number, head: Uint8Array) => void): Sink {
  const stream: WriteStream = createWriteStream(path, { flags: "wx" });
  let streamError: Error | null = null;
  stream.on("error", (err) => (streamError = err));
  const failed = () => streamError ?? (stream.destroyed ? new Error(`寫入暫存${label}失敗`) : null);
  let size = 0;
  const head = Buffer.alloc(HEAD_BYTES);
  let headLen = 0;
  let settled = false;
  return {
    async write(chunk) {
      const err = failed();
      if (err) throw err;
      size += chunk.length;
      if (size > limit) throw new MultipartError(413, `${label}太大（上限 ${Math.round(limit / 1024 / 1024)} MB）`);
      if (headLen < HEAD_BYTES) headLen += chunk.copy(head, headLen, 0, Math.min(chunk.length, HEAD_BYTES - headLen));
      // events.once rejects if "error" fires while waiting and removes its listeners either way
      if (!stream.write(chunk)) await once(stream, "drain");
    },
    async finish() {
      const err = failed();
      if (err) throw err;
      const finished = once(stream, "finish");
      stream.end();
      await finished;
      settled = true;
      onDone(size, new Uint8Array(head.subarray(0, headLen)));
    },
    async abort() {
      if (!settled && !stream.closed) {
        const closed = once(stream, "close").catch(() => {});
        stream.destroy();
        await closed;
      }
      await fs.rm(path, { force: true });
    },
  };
}

/**
 * Parse a multipart body. On any error the temp file is removed and the error is
 * rethrown (MultipartError carries the HTTP status to answer with).
 */
export async function parseMultipart(
  body: ReadableStream<Uint8Array> | null,
  contentType: string | null,
  options: MultipartOptions,
): Promise<MultipartResult> {
  const boundary = getBoundary(contentType);
  if (!body) throw new MultipartError(400, "沒有收到上傳內容");
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const maxFieldBytes = options.maxFieldBytes ?? 16 * 1024 * 1024;
  const maxFields = options.maxFields ?? 32;

  const fields: Record<string, string> = Object.create(null);
  let fieldCount = 0;
  let file: UploadedFile | null = null;
  let filePath: string | null = null;

  type State = "preamble" | "afterDelimiter" | "headers" | "body" | "done";
  let state: State = "preamble";
  // a leading CRLF lets the very first boundary (at offset 0) match the delimiter
  let buf: Buffer = Buffer.from(CRLF);
  let sink: Sink = discardSink;

  const reader = body.getReader();
  let received = 0;

  const startPart = async (headers: PartHeaders): Promise<Sink> => {
    if (headers.fileName != null) {
      if (headers.name !== options.fileField || file || filePath) return discardSink;
      const path = await options.tempPath();
      filePath = path;
      const fileName = headers.fileName;
      return fileSink(path, options.maxFileBytes, options.fileLabel ?? "音檔", (size, head) => {
        file = { field: headers.name, fileName, contentType: headers.contentType, size, path, head };
      });
    }
    if (++fieldCount > maxFields) throw new MultipartError(400, "表單欄位太多");
    return fieldSink(headers.name, maxFieldBytes, (value) => {
      fields[headers.name] = value;
    });
  };

  const process = async (): Promise<boolean> => {
    for (;;) {
      switch (state) {
        case "preamble": {
          const idx = buf.indexOf(delimiter);
          if (idx < 0) {
            if (buf.length > delimiter.length) buf = buf.subarray(buf.length - delimiter.length);
            return false;
          }
          buf = buf.subarray(idx + delimiter.length);
          state = "afterDelimiter";
          break;
        }
        case "afterDelimiter": {
          if (buf.length < 2) return false;
          if (buf[0] === 0x2d && buf[1] === 0x2d) {
            state = "done";
            return true;
          }
          const eol = buf.indexOf(CRLF);
          if (eol < 0) {
            if (buf.length > 256) throw new MultipartError(400, "multipart 格式錯誤");
            return false;
          }
          // transport padding (spaces/tabs) may precede the CRLF
          if (!/^[ \t]*$/.test(buf.subarray(0, eol).toString("latin1"))) throw new MultipartError(400, "multipart 格式錯誤");
          buf = buf.subarray(eol + 2);
          state = "headers";
          break;
        }
        case "headers": {
          const idx = buf.indexOf(HEADER_END);
          if (idx < 0) {
            if (buf.length > MAX_HEADER_BYTES) throw new MultipartError(400, "multipart 標頭太大");
            return false;
          }
          const headers = parsePartHeaders(buf.subarray(0, idx).toString("utf8"));
          buf = buf.subarray(idx + HEADER_END.length);
          sink = await startPart(headers);
          state = "body";
          break;
        }
        case "body": {
          const idx = buf.indexOf(delimiter);
          if (idx >= 0) {
            if (idx > 0) await sink.write(buf.subarray(0, idx));
            await sink.finish();
            sink = discardSink;
            buf = buf.subarray(idx + delimiter.length);
            state = "afterDelimiter";
            break;
          }
          // keep a tail that could be the start of a delimiter split across chunks
          const safe = buf.length - (delimiter.length - 1);
          if (safe > 0) {
            await sink.write(buf.subarray(0, safe));
            buf = buf.subarray(safe);
          }
          return false;
        }
        case "done":
          return true;
      }
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      received += value.length;
      buf = buf.length ? Buffer.concat([buf, value]) : Buffer.from(value);
      if (await process()) break;
    }
    // `state` is updated inside process(); widen it back from the narrowed initial value
    if ((state as State) !== "done") throw new MultipartError(400, incompleteMessage(received, options.declaredBytes ?? null));
    return { fields: { ...fields }, file };
  } catch (err) {
    await sink.abort().catch(() => {});
    const path = filePath as string | null;
    if (path) await fs.rm(path, { force: true }).catch(() => {});
    throw err;
  } finally {
    reader.cancel().catch(() => {});
  }
}
