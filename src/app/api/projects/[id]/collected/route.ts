import { listCollected, postCollected } from "@/lib/server/collected-routes";
import { handle, requireProjectId } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 研究找到的素材 -> { items, authorization } */
export const GET = handle(async (_req: Request, ctx: Ctx) => listCollected(requireProjectId((await ctx.params).id)));

/** { action: "authorize", note? }: the band's one-time acknowledgement -> { items, authorization, project } */
export const POST = handle(async (req: Request, ctx: Ctx) => postCollected(req, requireProjectId((await ctx.params).id)));
