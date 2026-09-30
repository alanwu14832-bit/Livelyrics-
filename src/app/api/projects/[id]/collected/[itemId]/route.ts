import { deleteCollected, patchCollected, serveCollected } from "@/lib/server/collected-routes";
import { handle, requireProjectId } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

async function ids(ctx: Ctx): Promise<{ id: string; itemId: string }> {
  const p = await ctx.params;
  return { id: requireProjectId(p.id), itemId: p.itemId };
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { id, itemId } = await ids(ctx);
  return serveCollected(req, id, itemId, true);
});

export const HEAD = handle(async (req: Request, ctx: Ctx) => {
  const { id, itemId } = await ids(ctx);
  return serveCollected(req, id, itemId, false);
});

/** { use?: "stage" | "reference", stats? } -> { item, items, plan } */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id, itemId } = await ids(ctx);
  return patchCollected(req, id, itemId);
});

/** 移除 (the file, the stage use and the reference use) -> { ok, items, plan } */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { id, itemId } = await ids(ctx);
  return deleteCollected(id, itemId);
});
