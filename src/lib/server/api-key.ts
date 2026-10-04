// The Anthropic API key the operator pastes into 「設定」 (local mode only).
//
// Stored in `<data dir>/settings/anthropic-key.json` (mode 0600, outside every folder an API route
// serves). The key itself never leaves the server: no route returns it, only `keyStatus()` — whether
// one is configured, where it comes from and a masked form (`sk-ant-…` + the last 4 characters).
// Nothing here logs it. `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in the environment always win
// (a deployment's variables, or `.env.local` for a developer); on Vercel / in cloud mode the stored
// key is neither read nor written (the project's Environment Variables are the place there).

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./store/local-fs";
import { resolveStorageConfig, storageMode } from "./store";

export type KeySource = "env" | "settings";

export interface KeyStatus {
  configured: boolean;
  /** env = ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN of the server; settings = saved through 「設定」 */
  source: KeySource | null;
  /** `sk-ant-…abcd` (settings only; an environment key is never described) */
  masked: string | null;
  /** the 「設定」 dialog can save / remove a key here (local mode, not on Vercel) */
  editable: boolean;
}

/** A key the dialog accepts: Anthropic's prefix, printable, a sane length. */
export const KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{8,256}$/;

const FILE_NAME = "anthropic-key.json";

function keyFile(): string {
  return path.join(dataDir(), "settings", FILE_NAME);
}

function envKey(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim());
}

/** Local mode only: the cloud deployments keep their key in the platform's variables. */
export function keyEditable(): boolean {
  return storageMode() === "local" && !resolveStorageConfig().onVercel;
}

// one read per change (writes and removals go through this module); keyed by the file path so a
// test (or LIVELYRICS_DATA_DIR) pointing somewhere else reads that folder
let cache: { file: string; key: string | null } | null = null;

function readStored(): string | null {
  if (!keyEditable()) return null;
  const file = keyFile();
  if (cache && cache.file === file) return cache.key;
  let key: string | null = null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { key?: unknown };
    if (typeof raw.key === "string" && KEY_PATTERN.test(raw.key)) key = raw.key;
  } catch {
    key = null; // missing or unreadable: no stored key
  }
  cache = { file, key };
  return key;
}

/** The stored key for the SDK client, or null (an environment key wins: the SDK reads it itself). */
export function storedApiKey(): string | null {
  if (envKey()) return null;
  return readStored();
}

/** true when Claude can be called: an environment credential or a stored key. */
export function hasApiKey(): boolean {
  return envKey() || readStored() != null;
}

export function maskKey(key: string): string {
  return `sk-ant-…${key.slice(-4)}`;
}

export function keyStatus(): KeyStatus {
  const editable = keyEditable();
  if (envKey()) return { configured: true, source: "env", masked: null, editable };
  const stored = readStored();
  if (stored) return { configured: true, source: "settings", masked: maskKey(stored), editable };
  return { configured: false, source: null, masked: null, editable };
}

export class KeyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "KeyError";
  }
}

/** Save a key pasted into 「設定」 (validated, written atomically with owner-only permissions). */
export function saveApiKey(input: unknown): KeyStatus {
  if (!keyEditable()) throw new KeyError(409, "這個部署的金鑰要設定在平台的環境變數（Vercel › Settings › Environment Variables）。");
  const key = typeof input === "string" ? input.trim() : "";
  if (!KEY_PATTERN.test(key)) throw new KeyError(400, "這看起來不是 Anthropic 的 API 金鑰：金鑰以 sk-ant- 開頭，中間沒有空格。");
  const file = keyFile();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ key, savedAt: new Date().toISOString() }), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
  cache = { file, key };
  return keyStatus();
}

/** 「移除金鑰」: delete the stored key (an environment key is not touched). */
export function removeApiKey(): KeyStatus {
  if (!keyEditable()) throw new KeyError(409, "這個部署的金鑰設定在平台的環境變數，請到那裡移除。");
  const file = keyFile();
  rmSync(file, { force: true });
  cache = { file, key: null };
  return keyStatus();
}

/** Tests: forget the cached read. */
export function resetKeyCache(): void {
  cache = null;
}
