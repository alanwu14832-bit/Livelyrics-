// Which storage the server uses, decided from the environment on every call (never at import
// time, so `next build` works without any variable set):
//
//   local         documents and files under LIVELYRICS_DATA_DIR (./data), the default
//   cloud         documents in Postgres (Neon), files in Vercel Blob: when BLOB_READ_WRITE_TOKEN
//                 and a database URL are both set, or LIVELYRICS_STORAGE=cloud
//   unconfigured  running on Vercel (VERCEL=1) without them: the filesystem there is read-only and
//                 ephemeral, so storage requests fail with a 503 explaining what to create
//
// LIVELYRICS_STORAGE=local forces the local mode (for example a throwaway demo in /tmp).
//
// Newer Vercel Blob connections inject only BLOB_STORE_ID (OIDC) and BLOB_WEBHOOK_PUBLIC_KEY. The
// client-upload token route still needs BLOB_READ_WRITE_TOKEN (@vercel/blob signs client tokens
// with it), so that case stays unconfigured with a specific hint (`blobStoreWithoutToken`).

export type StorageMode = "local" | "cloud" | "unconfigured";

/** Database URL variables, in order of preference (Vercel's Neon integration sets several). */
export const DATABASE_URL_VARS = ["DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"] as const;

export interface StorageConfig {
  mode: StorageMode;
  onVercel: boolean;
  /** both cloud credentials are present */
  cloudConfigured: boolean;
  /** variables cloud storage still needs ("BLOB_READ_WRITE_TOKEN", "DATABASE_URL") */
  missing: string[];
  /** a Blob store is connected through OIDC (BLOB_STORE_ID) but its read-write token is not set */
  blobStoreWithoutToken: boolean;
  blobToken?: string;
  databaseUrl?: string;
}

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const v = env[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function resolveStorageConfig(env: Env = process.env): StorageConfig {
  const blobToken = read(env, "BLOB_READ_WRITE_TOKEN");
  const databaseUrl = DATABASE_URL_VARS.map((name) => read(env, name)).find(Boolean);
  const missing: string[] = [];
  if (!blobToken) missing.push("BLOB_READ_WRITE_TOKEN");
  if (!databaseUrl) missing.push("DATABASE_URL");
  const cloudConfigured = missing.length === 0;
  const onVercel = Boolean(read(env, "VERCEL")) && read(env, "VERCEL") !== "0";
  const requested = read(env, "LIVELYRICS_STORAGE")?.toLowerCase();
  const blobStoreWithoutToken = Boolean(read(env, "BLOB_STORE_ID")) && !blobToken;

  let mode: StorageMode;
  if (requested === "local") mode = "local";
  else if (requested === "cloud") mode = cloudConfigured ? "cloud" : "unconfigured";
  else if (cloudConfigured) mode = "cloud";
  else mode = onVercel ? "unconfigured" : "local";

  return { mode, onVercel, cloudConfigured, missing, blobStoreWithoutToken, ...(blobToken ? { blobToken } : {}), ...(databaseUrl ? { databaseUrl } : {}) };
}

const MISSING_LABEL: Record<string, string> = {
  BLOB_READ_WRITE_TOKEN: "BLOB_READ_WRITE_TOKEN（Vercel Blob）",
  DATABASE_URL: "DATABASE_URL（Neon Postgres）",
};

/** A Blob store connected through OIDC only (BLOB_STORE_ID without BLOB_READ_WRITE_TOKEN): where to copy the token from. */
export const BLOB_TOKEN_HINT =
  "Blob 已連接，但缺少讀寫金鑰：到 Vercel › Storage › 這個 Blob store 的 .env.local 分頁（或 Settings）複製 BLOB_READ_WRITE_TOKEN，" +
  "加到專案的 Environment Variables（Production、Preview），再 Redeploy。";

/** The 503 message: what is missing and what to create in the Vercel dashboard. */
export function unconfiguredMessage(config: Pick<StorageConfig, "missing"> & Partial<Pick<StorageConfig, "blobStoreWithoutToken">>): string {
  if (config.blobStoreWithoutToken && config.missing.includes("BLOB_READ_WRITE_TOKEN")) {
    const db = config.missing.includes("DATABASE_URL") ? `另外還缺少 ${MISSING_LABEL.DATABASE_URL}：請從 Marketplace 加入 Neon Postgres，連接到這個專案後重新部署。` : "";
    return `雲端儲存空間還沒設定完成：${BLOB_TOKEN_HINT}${db}`;
  }
  const missing = config.missing.map((m) => MISSING_LABEL[m] ?? m).join("、") || "雲端儲存空間的環境變數";
  return (
    `雲端儲存空間還沒設定：缺少 ${missing}。` +
    "請到 Vercel 專案的 Storage 分頁建立一個存取權限為 Public 的 Blob 儲存空間，再從 Marketplace 加入 Neon Postgres，" +
    "兩者都連接到這個專案後重新部署。"
  );
}
