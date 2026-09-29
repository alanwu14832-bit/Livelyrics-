// Local document store (the original layout of docs/ARCHITECTURE.md):
//   <dataDir>/projects/<id>/project.json
//   <dataDir>/bands/<id>/band.json
//   <dataDir>/shows/<id>/show.json
// Atomic writes (temp file + rename), tolerant readers, writes serialized per document with the
// shared lock ("<id>", "band:<id>", "show:<id>"). A document's folder also holds its files, so
// deleting the document removes them.

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { StorageError } from "./errors";
import { DOC_ID_RE, newDocId } from "./ids";
import { dataDir, isNodeError, withLock, writeJsonAtomic } from "./local-fs";
import type { DocKind, DocumentStore, DocWrite, ListEntry, ListOptions, StoredDoc } from "./types";

interface Layout {
  folder: string;
  file: string;
  /** "專案 <id> 的 project.json" */
  label: (id: string) => string;
  notFound: string;
  lockKey: (id: string) => string;
  createError: string;
  invalidId: string;
}

export const LOCAL_LAYOUT: Readonly<Record<DocKind, Layout>> = {
  project: {
    folder: "projects",
    file: "project.json",
    label: (id) => `專案 ${id} 的 project.json`,
    notFound: "找不到專案（可能已被刪除）",
    lockKey: (id) => id,
    createError: "無法建立專案資料夾",
    invalidId: "無效的專案 ID",
  },
  band: {
    folder: "bands",
    file: "band.json",
    label: (id) => `樂團 ${id} 的 band.json`,
    notFound: "找不到樂團（可能已被刪除）",
    lockKey: (id) => `band:${id}`,
    createError: "無法建立資料夾",
    invalidId: "無效的樂團 ID",
  },
  show: {
    folder: "shows",
    file: "show.json",
    label: (id) => `演出 ${id} 的 show.json`,
    notFound: "找不到演出（可能已被刪除）",
    lockKey: (id) => `show:${id}`,
    createError: "無法建立資料夾",
    invalidId: "無效的演出 ID",
  },
};

interface CacheEntry {
  mtimeMs: number;
  size: number;
  value: unknown;
}

const g = globalThis as typeof globalThis & { __livelyricsListCache?: Map<string, CacheEntry> };
const listCache = (g.__livelyricsListCache ??= new Map());

function folderOf(kind: DocKind): string {
  return path.join(dataDir(), LOCAL_LAYOUT[kind].folder);
}

function dirOf(kind: DocKind, id: string): string {
  if (!DOC_ID_RE.test(id)) throw new StorageError("invalid_id", LOCAL_LAYOUT[kind].invalidId);
  return path.join(folderOf(kind), id);
}

function fileOf(kind: DocKind, id: string): string {
  return path.join(dirOf(kind, id), LOCAL_LAYOUT[kind].file);
}

function cachePrefix(kind: DocKind, id: string): string {
  return `${dataDir()}::${kind}::${id}::`;
}

async function readDoc(kind: DocKind, id: string): Promise<StoredDoc | null> {
  const file = fileOf(kind, id);
  let text: string;
  let mtime: Date;
  try {
    const [content, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    text = content;
    mtime = stat.mtime;
  } catch (err) {
    if (isNodeError(err, "ENOENT") || isNodeError(err, "ENOTDIR")) return null;
    throw err;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new StorageError("corrupt", `${LOCAL_LAYOUT[kind].label(id)} 已損毀，無法讀取`);
  }
  return { id, data, updatedAt: mtime.toISOString() };
}

/** Write over an existing document; never recreates a deleted folder. */
async function writeExisting(kind: DocKind, id: string, data: object): Promise<StoredDoc> {
  try {
    await writeJsonAtomic(fileOf(kind, id), data);
  } catch (err) {
    if (isNodeError(err, "ENOENT")) throw new StorageError("not_found", LOCAL_LAYOUT[kind].notFound);
    throw err;
  }
  return { id, data, updatedAt: new Date().toISOString() };
}

function dropCache(kind: DocKind, id: string): void {
  const prefix = cachePrefix(kind, id);
  for (const key of listCache.keys()) if (key.startsWith(prefix)) listCache.delete(key);
}

export function createLocalDocumentStore(): DocumentStore {
  return {
    mode: "local",

    get: (kind, id) => readDoc(kind, id),

    async create(kind, init) {
      const layout = LOCAL_LAYOUT[kind];
      const parent = folderOf(kind);
      await fs.mkdir(parent, { recursive: true });
      let id = "";
      for (let attempt = 0; attempt < 8 && !id; attempt++) {
        const candidate = newDocId();
        try {
          await fs.mkdir(path.join(parent, candidate));
          id = candidate;
        } catch (err) {
          if (!isNodeError(err, "EEXIST")) throw err;
        }
      }
      if (!id) throw new Error(layout.createError);
      const dir = path.join(parent, id);
      try {
        const write = await init(id);
        await writeJsonAtomic(path.join(dir, layout.file), write.data);
        return { id, data: write.data, updatedAt: new Date().toISOString() };
      } catch (err) {
        await fs.rm(dir, { recursive: true, force: true });
        throw err;
      }
    },

    update(kind, id, mutate) {
      dirOf(kind, id);
      return withLock(LOCAL_LAYOUT[kind].lockKey(id), async () => {
        const current = await readDoc(kind, id);
        if (!current) throw new StorageError("not_found", LOCAL_LAYOUT[kind].notFound);
        const write: DocWrite | null = await mutate(current);
        if (!write) return current;
        return writeExisting(kind, id, write.data);
      });
    },

    put(kind, id, write) {
      dirOf(kind, id);
      return withLock(LOCAL_LAYOUT[kind].lockKey(id), () => writeExisting(kind, id, write.data));
    },

    delete(kind, id) {
      const dir = dirOf(kind, id);
      return withLock(LOCAL_LAYOUT[kind].lockKey(id), async () => {
        try {
          await fs.stat(dir);
        } catch (err) {
          if (isNodeError(err, "ENOENT")) return false;
          throw err;
        }
        await fs.rm(dir, { recursive: true, force: true });
        dropCache(kind, id);
        return true;
      });
    },

    async list<T>(kind: DocKind, opts: ListOptions<T>): Promise<ListEntry<T>[]> {
      const parent = folderOf(kind);
      let entries: Dirent[];
      try {
        entries = await fs.readdir(parent, { withFileTypes: true });
      } catch (err) {
        if (isNodeError(err, "ENOENT")) return [];
        throw err;
      }
      const results = await Promise.all(
        entries
          .filter((e) => e.isDirectory() && DOC_ID_RE.test(e.name))
          .map(async (e): Promise<ListEntry<T> | null> => {
            const id = e.name;
            const file = path.join(parent, id, LOCAL_LAYOUT[kind].file);
            const cacheKey = opts.summary != null ? `${cachePrefix(kind, id)}${opts.summary}` : null;
            try {
              const stat = await fs.stat(file);
              if (cacheKey) {
                const cached = listCache.get(cacheKey);
                if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return { id, value: cached.value as T };
              }
              const doc = await readDoc(kind, id);
              if (!doc) return null;
              const value = opts.map(doc);
              if (cacheKey) listCache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size, value });
              return { id, value };
            } catch (err) {
              // a folder without its document is skipped; an unreadable one is reported
              if (isNodeError(err, "ENOENT")) return null;
              const stat = await fs.stat(path.join(parent, id)).catch(() => null);
              return { id, error: err, updatedAt: (stat?.mtime ?? new Date(0)).toISOString() };
            }
          }),
      );
      return results.filter((r): r is ListEntry<T> => r !== null);
    },
  };
}
