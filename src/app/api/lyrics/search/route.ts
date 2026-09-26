import { handle, HttpError, json } from "@/lib/server/http";
import { LrclibError, searchLyrics } from "@/lib/server/lrclib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/lyrics/search?artist=&title=&duration= -> { results: LyricsSearchResult[] } */
export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const title = (params.get("title") ?? "").trim().slice(0, 300);
  const artist = (params.get("artist") ?? "").trim().slice(0, 300);
  const durationParam = Number(params.get("duration"));
  const duration = Number.isFinite(durationParam) && durationParam > 0 ? durationParam : undefined;
  if (!title) throw new HttpError(400, "請提供歌名（title）");

  try {
    const results = await searchLyrics({ title, artist, duration }, { signal: req.signal });
    return json({ results });
  } catch (err) {
    if (err instanceof LrclibError) throw new HttpError(502, err.message);
    throw err;
  }
});
