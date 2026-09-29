import { handle, requireBandId } from "@/lib/server/http";
import { listMoodboard, uploadMoodImage } from "@/lib/server/moodboard-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The mood board (參考圖) -> { images } */
export const GET = handle(async (_req: Request, ctx: Ctx) => listMoodboard({ kind: "band", id: requireBandId((await ctx.params).id) }));

/**
 * Local: multipart `file` (an image, downscaled in the browser) + `meta` JSON { width, height, name?, note?, stats? }.
 * Cloud: JSON { blob, fileName, width, height, ... } after the browser uploaded the file to Vercel Blob.
 * -> 201 { image, images }
 */
export const POST = handle(async (req: Request, ctx: Ctx) => uploadMoodImage(req, { kind: "band", id: requireBandId((await ctx.params).id) }));
