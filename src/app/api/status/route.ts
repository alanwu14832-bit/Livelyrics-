import type { ServerStatus } from "@/lib/api-client";
import { authEnabled } from "@/lib/server/auth";
import { isClaudeConfigured, modelName } from "@/lib/server/designer";
import { handle, json } from "@/lib/server/http";
import { dataDir } from "@/lib/server/storage";
import { resolveStorageConfig, storageMode } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Never touches storage, so the home page can explain an unconfigured deployment. */
export const GET = handle(async () => {
  const config = resolveStorageConfig();
  const mode = storageMode();
  const status: ServerStatus = {
    claude: isClaudeConfigured(),
    model: modelName(),
    dataDir: mode === "local" ? dataDir() : "",
    storage: { mode, cloudConfigured: config.cloudConfigured, missing: mode === "unconfigured" ? config.missing : [], onVercel: config.onVercel },
    auth: authEnabled(),
  };
  return json(status);
});
