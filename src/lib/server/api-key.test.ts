// Round 13 (M8): the API key saved through 「設定」. Stored in the data dir (owner-only), never
// returned by any API route (masked only), the environment wins, not editable on Vercel.

import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DELETE as deleteKey, GET as getKey, PUT as putKey } from "@/app/api/settings/api-key/route";
import { GET as getStatus } from "@/app/api/status/route";
import { hasApiKey, keyStatus, maskKey, resetKeyCache, storedApiKey } from "./api-key";
import { isClaudeConfigured } from "./designer";

const FAKE = "sk-ant-test-0123456789abcdefWXYZ";
const ENV_KEYS = ["LIVELYRICS_DATA_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "VERCEL", "LIVELYRICS_STORAGE", "BLOB_READ_WRITE_TOKEN", "DATABASE_URL"] as const;
const previous = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let root: string;

const put = (body: unknown, headers: Record<string, string> = {}) =>
  putKey(new Request("http://localhost:3000/api/settings/api-key", { method: "PUT", headers: { "content-type": "application/json", host: "localhost:3000", ...headers }, body: JSON.stringify(body) }), undefined);
const del = (headers: Record<string, string> = {}) => deleteKey(new Request("http://localhost:3000/api/settings/api-key", { method: "DELETE", headers: { host: "localhost:3000", ...headers } }), undefined);
const get = () => getKey(new Request("http://localhost:3000/api/settings/api-key"), undefined);
const status = () => getStatus(new Request("http://localhost:3000/api/status"), undefined);

beforeAll(async () => {
  await fs.mkdir("/tmp/claude-0", { recursive: true });
  root = await fs.mkdtemp("/tmp/claude-0/ll-key-");
  process.env.LIVELYRICS_DATA_DIR = root;
  for (const k of ENV_KEYS.slice(1)) delete process.env[k];
  resetKeyCache();
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.VERCEL;
  resetKeyCache();
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    const v = previous[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetKeyCache();
  await fs.rm(root, { recursive: true, force: true });
});

describe("the 設定 API key store", () => {
  it("starts without a key: basic mode", async () => {
    expect(hasApiKey()).toBe(false);
    expect(isClaudeConfigured()).toBe(false);
    expect(await (await get()).json()).toEqual({ configured: false, source: null, masked: null, editable: true });
    const s = await (await status()).json();
    expect(s.claude).toBe(false);
    expect(s.keySource).toBeNull();
  });

  it("saves a key: configured, masked, never echoed by any route, owner-only file", async () => {
    const res = await put({ key: FAKE });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FAKE);
    expect(JSON.parse(text)).toEqual({ configured: true, source: "settings", masked: maskKey(FAKE), editable: true });
    expect(maskKey(FAKE)).toBe("sk-ant-…WXYZ");

    for (const r of [await get(), await status()]) {
      const body = await r.text();
      expect(body).not.toContain(FAKE);
      expect(body).not.toContain("0123456789");
    }
    const s = await (await status()).json();
    expect(s).toMatchObject({ claude: true, keySource: "settings", keyEditable: true });
    expect(JSON.stringify(s)).not.toContain("WXYZ"); // the status route only says "configured"

    expect(isClaudeConfigured()).toBe(true);
    expect(storedApiKey()).toBe(FAKE);
    const file = path.join(root, "settings", "anthropic-key.json");
    const stat = await fs.stat(file);
    expect(stat.mode & 0o077).toBe(0);
    // a fresh process (no cache) reads it back
    resetKeyCache();
    expect(storedApiKey()).toBe(FAKE);
  });

  it("the environment wins over the stored key and is never described", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key-zzzzzzzzzzzz";
    expect(keyStatus()).toEqual({ configured: true, source: "env", masked: null, editable: true });
    expect(storedApiKey()).toBeNull(); // the SDK reads the environment itself
    const body = await (await get()).text();
    expect(body).not.toContain("zzzz");
    expect(body).not.toContain(FAKE);
  });

  it("rejects what is not a key, and writes from another site", async () => {
    expect((await put({ key: "hello" })).status).toBe(400);
    expect((await put({ key: "sk-ant- with spaces" })).status).toBe(400);
    expect((await put({ key: FAKE }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await del({ origin: "https://evil.example" })).status).toBe(403);
    expect(storedApiKey()).toBe(FAKE);
  });

  it("移除金鑰 deletes it", async () => {
    const res = await del({ origin: "http://localhost:3000" });
    expect(await res.json()).toEqual({ configured: false, source: null, masked: null, editable: true });
    await expect(fs.stat(path.join(root, "settings", "anthropic-key.json"))).rejects.toThrow();
    expect(isClaudeConfigured()).toBe(false);
  });

  it("is not editable on Vercel (the project's Environment Variables are the place)", async () => {
    process.env.VERCEL = "1";
    process.env.LIVELYRICS_STORAGE = "local"; // even a forced local store on Vercel
    try {
      expect(keyStatus().editable).toBe(false);
      expect((await put({ key: FAKE })).status).toBe(409);
      expect(hasApiKey()).toBe(false);
    } finally {
      delete process.env.LIVELYRICS_STORAGE;
    }
  });

  it("only the designer's SDK client reads the stored key", async () => {
    const hits: string[] = [];
    async function walk(dir: string) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) && (await fs.readFile(p, "utf8")).includes("storedApiKey")) hits.push(path.relative(process.cwd(), p));
      }
    }
    await walk(path.join(process.cwd(), "src"));
    expect(hits.sort()).toEqual(["src/lib/server/api-key.ts", "src/lib/server/designer/index.ts"]);
  });
});
