import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { authorizeUpload, requireUploadToken } from "@/lib/server/blob-upload";
import { handle, HttpError, json, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cloud mode: signs one browser upload to Vercel Blob (@vercel/blob/client `upload()` calls this
 * with `{ type: "blob.generate-client-token", payload: { pathname, clientPayload, multipart } }`).
 * The browser registers the finished file itself (POST .../assets or /api/projects), so no
 * upload-completed callback is used.
 */
export const POST = handle(async (req: Request) => {
  const token = requireUploadToken();
  const body = (await readJson(req, 64 * 1024)) as HandleUploadBody | null;
  if (!body || typeof body !== "object" || body.type !== "blob.generate-client-token") throw new HttpError(400, "不支援的上傳請求");
  const result = await handleUpload({
    body,
    request: req,
    token,
    onBeforeGenerateToken: (pathname, clientPayload) => authorizeUpload(pathname, clientPayload),
  });
  return json(result);
});
