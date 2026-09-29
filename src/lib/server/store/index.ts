// The stores of the current storage mode (store/mode.ts), resolved on every call from the
// environment. The cloud clients are created on first use and reused by the instance; nothing
// touches the environment or the network at import time.

import { createBlobFileStore, vercelBlobApi } from "./blob-files";
import { StorageError } from "./errors";
import { createLocalDocumentStore } from "./local-docs";
import { createLocalFileStore } from "./local-files";
import { resolveStorageConfig, unconfiguredMessage, type StorageConfig, type StorageMode } from "./mode";
import { neonSqlClient } from "./neon";
import { createSqlDocumentStore } from "./sql-docs";
import type { DocumentStore, FileStore } from "./types";

export type { DocKind, DocumentStore, DocWrite, FileStore, ListEntry, StoredDoc, StoredFile, BlobInfo } from "./types";
export { StorageError, type StorageErrorCode } from "./errors";
export { resolveStorageConfig, unconfiguredMessage, type StorageConfig, type StorageMode } from "./mode";

interface Stores {
  mode: "local" | "cloud";
  docs: DocumentStore;
  files: FileStore;
}

const local: Stores = { mode: "local", docs: createLocalDocumentStore(), files: createLocalFileStore() };

const g = globalThis as typeof globalThis & {
  __livelyricsCloudStores?: { key: string; stores: Stores };
  __livelyricsStoreOverride?: Stores | null;
};

function cloudStores(config: StorageConfig): Stores {
  const delivery = process.env.LIVELYRICS_BLOB_DELIVERY?.trim() === "proxy" ? "proxy" : "redirect";
  // a custom Blob API endpoint (a local emulator) serves its own URLs
  const anyHost = Boolean(process.env.VERCEL_BLOB_API_URL?.trim());
  const key = `${config.databaseUrl}\n${config.blobToken}\n${delivery}\n${anyHost}`;
  const cached = g.__livelyricsCloudStores;
  if (cached?.key === key) return cached.stores;
  const stores: Stores = {
    mode: "cloud",
    docs: createSqlDocumentStore(neonSqlClient(config.databaseUrl!)),
    files: createBlobFileStore(vercelBlobApi(config.blobToken!), { delivery, anyHost }),
  };
  g.__livelyricsCloudStores = { key, stores };
  return stores;
}

function current(): Stores {
  const override = g.__livelyricsStoreOverride;
  if (override) return override;
  const config = resolveStorageConfig();
  if (config.mode === "local") return local;
  if (config.mode === "unconfigured") throw new StorageError("unconfigured", unconfiguredMessage(config));
  return cloudStores(config);
}

/** "local" | "cloud" | "unconfigured" (never throws). */
export function storageMode(): StorageMode {
  return g.__livelyricsStoreOverride?.mode ?? resolveStorageConfig().mode;
}

export function isCloudStorage(): boolean {
  return storageMode() === "cloud";
}

/** The document store; throws StorageError("unconfigured") on Vercel without cloud storage. */
export function docs(): DocumentStore {
  return current().docs;
}

/** The file store; throws StorageError("unconfigured") on Vercel without cloud storage. */
export function files(): FileStore {
  return current().files;
}

/** Tests: run the storage modules against other stores (null restores the environment's). */
export function setStoresForTesting(stores: Stores | null): void {
  g.__livelyricsStoreOverride = stores;
}
