import { MAX_BAND_ASSETS } from "@/lib/band";
import { receiveAssetUpload } from "@/lib/server/asset-routes";
import { addBandAsset, getBand, takenAssetIds } from "@/lib/server/band-storage";
import { handle, HttpError, json, requireBandId } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireBandId((await ctx.params).id);
  const band = await getBand(id);
  if (!band) throw new HttpError(404, "找不到樂團");
  return json({ assets: band.assets });
});

/** Same multipart contract as the project library: `file` + `meta` JSON -> 201 { asset, assets } */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireBandId((await ctx.params).id);
  const band = await getBand(id);
  if (!band) throw new HttpError(404, "找不到樂團");
  return receiveAssetUpload(req, {
    count: band.assets.length,
    max: MAX_BAND_ASSETS,
    taken: await takenAssetIds(id),
    label: "樂團素材",
    store: async (asset, tempPath) => (await addBandAsset(id, asset, tempPath, MAX_BAND_ASSETS)).assets,
  });
});
