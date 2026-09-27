import { isValidBandId } from "@/lib/band";
import { MAX_SHOW_NAME } from "@/lib/show";
import { createShow, getBand, listShows } from "@/lib/server/band-storage";
import { handle, HttpError, json, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?bandId= narrows the list to one band */
export const GET = handle(async (req: Request) => {
  const bandId = new URL(req.url).searchParams.get("bandId") ?? undefined;
  if (bandId && !isValidBandId(bandId)) throw new HttpError(400, "無效的樂團 ID");
  return json(await listShows(bandId));
});

/** { bandId, name, date?, venue? } -> 201 Show (the canvas starts as the band's most recent song's) */
export const POST = handle(async (req: Request) => {
  const body = await readJson(req, 16 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "請求內容必須是物件 { bandId, name }");
  const b = body as { bandId?: unknown; name?: unknown; date?: unknown; venue?: unknown };
  if (!isValidBandId(b.bandId)) throw new HttpError(400, "請指定樂團");
  const band = await getBand(b.bandId);
  if (!band) throw new HttpError(404, "找不到樂團");
  const name = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim().slice(0, MAX_SHOW_NAME) : "";
  if (!name) throw new HttpError(400, "請填寫演出名稱");
  const show = await createShow({
    bandId: band.id,
    name,
    date: typeof b.date === "string" ? b.date : undefined,
    venue: typeof b.venue === "string" ? b.venue : undefined,
  });
  return json(show, { status: 201 });
});
