import { describe, expect, it } from "vitest";
import { resolveStorageConfig, unconfiguredMessage } from "./mode";

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
});
