// Filesystem helpers of the local mode: the data folder, atomic JSON writes, file moves and the
// per-key write lock (kept on globalThis so Next dev HMR shares one instance).

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export function dataDir(): string {
  return path.resolve(process.env.LIVELYRICS_DATA_DIR || path.join(process.cwd(), "data"));
}

export function isNodeError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === code;
}

const g = globalThis as typeof globalThis & { __livelyricsLocks?: Map<string, Promise<void>> };
const locks = (g.__livelyricsLocks ??= new Map());

/** Serialize read-modify-write cycles on one key (a project id, "band:<id>", "show:<id>"). */
export async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const key = `${dataDir()}::${id}`;
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => current);
  locks.set(key, tail);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  const json = JSON.stringify(data);
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(json, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (!isNodeError(err, "EXDEV")) throw err;
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}
