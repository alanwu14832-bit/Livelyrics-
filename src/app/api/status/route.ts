import type { ServerStatus } from "@/lib/api-client";
import { isClaudeConfigured, modelName } from "@/lib/server/designer";
import { handle, json } from "@/lib/server/http";
import { dataDir } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const status: ServerStatus = { claude: isClaudeConfigured(), model: modelName(), dataDir: dataDir() };
  return json(status);
});
