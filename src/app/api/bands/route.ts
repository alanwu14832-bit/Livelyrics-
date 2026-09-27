import { sanitizeBandName } from "@/lib/band";
import { createBand, listBands } from "@/lib/server/band-storage";
import { handle, HttpError, json, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => json(await listBands()));

/** { name } -> 201 Band */
export const POST = handle(async (req: Request) => {
  const body = await readJson(req, 16 * 1024, {});
  const name = body && typeof body === "object" && !Array.isArray(body) ? (body as { name?: unknown }).name : undefined;
  const clean = sanitizeBandName(name, "");
  if (!clean) throw new HttpError(400, "請填寫樂團名稱");
  return json(await createBand(clean), { status: 201 });
});
