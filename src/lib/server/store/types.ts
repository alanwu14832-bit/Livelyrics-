// The two storage interfaces behind src/lib/server/storage.ts and band-storage.ts:
//
//   DocumentStore  JSON documents (projects, bands, shows) by kind and id, with atomic
//                  read-modify-write. Local: one file per document (store/local-docs.ts).
//                  Cloud: one Postgres row per document (store/sql-docs.ts).
//   FileStore      binary files (project audio, project assets, band assets). Local: files next
//                  to the documents (store/local-files.ts). Cloud: Vercel Blob, uploaded by the
//                  browser directly (store/blob-files.ts).
//
// The domain logic (defaults for old documents, summaries, cascades) stays in the storage
// modules and is the same for both modes.

import type { BlobRef } from "@/lib/types";

export type DocKind = "project" | "band" | "show";

export interface StoredDoc {
  id: string;
  /** the parsed JSON, as written (the domain coerces it) */
  data: unknown;
  /** storage timestamp (file mtime / row updated_at): the fallback for missing document times */
  updatedAt: string;
}

export interface DocWrite {
  data: object;
  /**
   * A small listing record kept next to the document (cloud: its own column, so the library does
   * not download every analysis). Recomputed from `data` when missing or of another version.
   */
  summary?: { version: number; value: object };
}

export type ListEntry<T> = { id: string; value: T } | { id: string; error: unknown; updatedAt: string };

export interface ListOptions<T> {
  /** the listed value of a document; a throw becomes an error entry */
  map: (doc: StoredDoc) => T;
  /**
   * The listed value is the document's summary of this version: the cloud store reads the stored
   * summary instead of the document, the local store caches `map` per file (mtime + size).
   */
  summary?: number;
}

export interface DocumentStore {
  readonly mode: "local" | "cloud";
  /** null when the document does not exist; StorageError("corrupt") when it cannot be read */
  get(kind: DocKind, id: string): Promise<StoredDoc | null>;
  /**
   * Create a document with a fresh id. `init` builds it (and may put its files in place, local
   * mode); when anything fails nothing is left behind. In the cloud store `init` can run more than
   * once (id collision), so it must not have side effects there.
   */
  create(kind: DocKind, init: (id: string) => Promise<DocWrite>): Promise<StoredDoc>;
  /**
   * Atomic read-modify-write; `mutate` returns the next document, or null to leave it unchanged.
   * Local: under the document's lock. Cloud: optimistic (version check), so `mutate` may run again
   * on a concurrent change and must be a pure function of the document it gets.
   * Throws StorageError("not_found") when the document is gone (it is never recreated).
   */
  update(kind: DocKind, id: string, mutate: (doc: StoredDoc) => DocWrite | null | Promise<DocWrite | null>): Promise<StoredDoc>;
  /** Replace a document that must exist, without reading it. */
  put(kind: DocKind, id: string, write: DocWrite): Promise<StoredDoc>;
  /** false when it did not exist. Local: removes the document's folder (and the files in it). */
  delete(kind: DocKind, id: string): Promise<boolean>;
  list<T>(kind: DocKind, opts: ListOptions<T>): Promise<ListEntry<T>[]>;
}

/** Where a stored file is: on the local disk or in Vercel Blob. */
export type StoredFile = { kind: "disk"; path: string } | { kind: "blob"; blob: BlobRef };

export interface ServeOptions {
  contentType: string;
  /** original file name for Content-Disposition */
  fileName: string;
  withBody: boolean;
  /** 404 message when the file is missing */
  missing: string;
  /** 416 message */
  badRange: string;
}

/** What the cloud store knows about an uploaded blob after checking it. */
export interface BlobInfo {
  blob: BlobRef;
  size: number;
  contentType: string;
  /** the first bytes (magic-byte sniffing) */
  head: Uint8Array;
}

export interface FileStore {
  readonly mode: "local" | "cloud";
  /** Local: move an uploaded temp file into place. The cloud store never receives files. */
  place(tempPath: string, destination: string): Promise<void>;
  /** Remove stored files (missing ones are fine; failures are logged, never thrown). */
  remove(files: readonly StoredFile[]): Promise<void>;
  /** GET / HEAD response: local Range serving from disk; cloud 307 to the blob (or a proxy). */
  serve(req: Request, file: StoredFile, opts: ServeOptions): Promise<Response>;
  /**
   * Cloud: check that a blob the browser uploaded is in this store under `prefix`, and read its
   * size, type and first bytes. HttpError 400 when it is not a blob of ours or is missing.
   */
  inspect(blob: BlobRef, opts: { prefix: string; headBytes?: number }): Promise<BlobInfo>;
  /**
   * The whole file (small files only: mood board images the designer sends to Claude). Rejects
   * with StorageError("not_found") when it is missing and HttpError 413 when it is larger than
   * `maxBytes`.
   */
  read(file: StoredFile, opts: { maxBytes: number; signal?: AbortSignal }): Promise<Uint8Array>;
  /**
   * Store bytes the server itself produced (phase 8: images the research downloaded). Local: an
   * atomic write to `diskPath`. Cloud: a public blob at `blobPathname` (plus Blob's random suffix).
   */
  write(target: { diskPath: string; blobPathname: string }, bytes: Uint8Array, contentType: string): Promise<StoredFile>;
}
