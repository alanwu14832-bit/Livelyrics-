import type { ServerStatus } from "@/lib/api-client";
import { keyStatus } from "@/lib/server/api-key";
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
  // configured or not and where from; never the key (not even masked: that is the settings route)
  const key = keyStatus();
  const status: ServerStatus = {
    claude: isClaudeConfigured(),
    model: modelName(),
    dataDir: mode === "local" ? dataDir() : "",
    storage: {
      mode,
      cloudConfigured: config.cloudConfigured,
      missing: mode === "unconfigured" ? config.missing : [],
      onVercel: config.onVercel,
      blobStoreWithoutToken: mode === "unconfigured" && config.blobStoreWithoutToken,
    },
    auth: authEnabled(),
    keySource: key.source,
    keyEditable: key.editable,
  };
  return json(status);
});
