import { handle, requireProjectId } from "@/lib/server/http";
import { deleteMoodImage, patchMoodImage, serveMoodImage, type MoodOwner } from "@/lib/server/moodboard-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; imageId: string }> };

async function owner(ctx: Ctx): Promise<{ owner: MoodOwner; imageId: string }> {
  const p = await ctx.params;
  return { owner: { kind: "project", id: requireProjectId(p.id) }, imageId: p.imageId };
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { owner: o, imageId } = await owner(ctx);
  return serveMoodImage(req, o, imageId, true);
});

export const HEAD = handle(async (req: Request, ctx: Ctx) => {
  const { owner: o, imageId } = await owner(ctx);
  return serveMoodImage(req, o, imageId, false);
});

/** { note?: string | null, name?: string } -> { image, images } */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { owner: o, imageId } = await owner(ctx);
  return patchMoodImage(req, o, imageId);
});

/** Deletes the file -> { ok, images } */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { owner: o, imageId } = await owner(ctx);
  return deleteMoodImage(o, imageId);
});
