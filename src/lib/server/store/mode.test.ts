import { describe, expect, it } from "vitest";
import { BLOB_TOKEN_HINT, resolveStorageConfig, unconfiguredMessage } from "./mode";

const TOKEN = "vercel_blob_rw_abc123_secret";
const DB = "postgresql://u:p@ep-x.neon.tech/neondb?sslmode=require";

describe("resolveStorageConfig", () => {
  it("is local without any cloud variable, even with one of them, off Vercel", () => {
    expect(resolveStorageConfig({})).toMatchObject({ mode: "local", onVercel: false, cloudConfigured: false, missing: ["BLOB_READ_WRITE_TOKEN", "DATABASE_URL"] });
    expect(resolveStorageConfig({ BLOB_READ_WRITE_TOKEN: TOKEN }).mode).toBe("local");
    expect(resolveStorageConfig({ DATABASE_URL: DB }).mode).toBe("local");
  });

  it("is cloud with a blob token and any of the database URL variables", () => {
    for (const name of ["DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"]) {
      const c = resolveStorageConfig({ BLOB_READ_WRITE_TOKEN: TOKEN, [name]: DB });
      expect(c).toMatchObject({ mode: "cloud", cloudConfigured: true, missing: [], blobToken: TOKEN, databaseUrl: DB });
    }
    // the pooled URL wins over the others
    expect(resolveStorageConfig({ BLOB_READ_WRITE_TOKEN: TOKEN, POSTGRES_URL: "postgres://b", DATABASE_URL: "postgres://a" }).databaseUrl).toBe("postgres://a");
    // blank values do not count
    expect(resolveStorageConfig({ BLOB_READ_WRITE_TOKEN: "  ", DATABASE_URL: DB }).mode).toBe("local");
  });

  it("is unconfigured on Vercel without both, naming what is missing", () => {
    expect(resolveStorageConfig({ VERCEL: "1" })).toMatchObject({ mode: "unconfigured", onVercel: true, missing: ["BLOB_READ_WRITE_TOKEN", "DATABASE_URL"] });
    expect(resolveStorageConfig({ VERCEL: "1", DATABASE_URL: DB })).toMatchObject({ mode: "unconfigured", missing: ["BLOB_READ_WRITE_TOKEN"] });
    expect(resolveStorageConfig({ VERCEL: "1", BLOB_READ_WRITE_TOKEN: TOKEN, DATABASE_URL: DB }).mode).toBe("cloud");
  });

  it("follows LIVELYRICS_STORAGE", () => {
    expect(resolveStorageConfig({ LIVELYRICS_STORAGE: "cloud" }).mode).toBe("unconfigured");
    expect(resolveStorageConfig({ LIVELYRICS_STORAGE: "cloud", BLOB_READ_WRITE_TOKEN: TOKEN, DATABASE_URL: DB }).mode).toBe("cloud");
    expect(resolveStorageConfig({ LIVELYRICS_STORAGE: "local", VERCEL: "1" }).mode).toBe("local");
    expect(resolveStorageConfig({ LIVELYRICS_STORAGE: "LOCAL", BLOB_READ_WRITE_TOKEN: TOKEN, DATABASE_URL: DB }).mode).toBe("local");
  });

  it("explains what to create in Traditional Chinese", () => {
    const msg = unconfiguredMessage(resolveStorageConfig({ VERCEL: "1" }));
    expect(msg).toContain("BLOB_READ_WRITE_TOKEN");
    expect(msg).toContain("DATABASE_URL");
    expect(msg).toContain("Public");
    expect(msg).toContain("Neon");
    expect(msg).toContain("重新部署");
    expect(msg).not.toMatch(/[–—]/);
    expect(unconfiguredMessage({ missing: ["DATABASE_URL"] })).not.toContain("BLOB_READ_WRITE_TOKEN");
  });

  it("gives the read-write token hint when the Blob store is connected through OIDC only", () => {
    // newer Blob connections inject BLOB_STORE_ID (+ BLOB_WEBHOOK_PUBLIC_KEY), not the token
    const oidc = { VERCEL: "1", BLOB_STORE_ID: "store_abc123", BLOB_WEBHOOK_PUBLIC_KEY: "pk", DATABASE_URL: DB };
    const config = resolveStorageConfig(oidc);
    expect(config).toMatchObject({ mode: "unconfigured", missing: ["BLOB_READ_WRITE_TOKEN"], blobStoreWithoutToken: true });
    const msg = unconfiguredMessage(config);
    expect(msg).toContain(BLOB_TOKEN_HINT);
    expect(BLOB_TOKEN_HINT).toContain("Blob 已連接，但缺少讀寫金鑰");
    expect(BLOB_TOKEN_HINT).toContain(".env.local");
    expect(BLOB_TOKEN_HINT).toContain("BLOB_READ_WRITE_TOKEN");
    expect(BLOB_TOKEN_HINT).toContain("Production、Preview");
    expect(BLOB_TOKEN_HINT).toContain("Redeploy");
    // not the generic "create a Blob store" advice: the store already exists
    expect(msg).not.toContain("建立一個存取權限為 Public 的 Blob");
    expect(msg).not.toMatch(/[–—]/);
    // the database is named too when it is also missing
    const both = unconfiguredMessage(resolveStorageConfig({ VERCEL: "1", BLOB_STORE_ID: "store_abc123" }));
    expect(both).toContain(BLOB_TOKEN_HINT);
    expect(both).toContain("DATABASE_URL");
    // with the token the store id changes nothing
    expect(resolveStorageConfig({ ...oidc, BLOB_READ_WRITE_TOKEN: TOKEN })).toMatchObject({ mode: "cloud", blobStoreWithoutToken: false });
    expect(resolveStorageConfig({ VERCEL: "1" }).blobStoreWithoutToken).toBe(false);
  });
});
