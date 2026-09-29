// Storage errors shared by the local and cloud stores. The API maps the codes to status codes
// (src/lib/server/http.ts): invalid_id 400, not_found 404, conflict 409, unconfigured 503,
// corrupt 500.

export type StorageErrorCode = "invalid_id" | "not_found" | "corrupt" | "conflict" | "unconfigured";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}
