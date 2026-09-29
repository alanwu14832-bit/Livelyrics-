import { clearedSessionCookie, cookieSecure } from "@/lib/server/auth";
import { handle, isJsonRequest, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function logout(req: Request): Response {
  const url = new URL(req.url);
  const cookie = clearedSessionCookie(cookieSecure(url, req.headers));
  if (req.method === "POST" && isJsonRequest(req)) {
    const res = json({ ok: true });
    res.headers.append("Set-Cookie", cookie);
    return res;
  }
  const headers = new Headers({ Location: new URL("/login", url).toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** Clears the session cookie: JSON -> { ok }, a form post or a plain visit -> 303 to /login. */
export const POST = handle(async (req: Request) => logout(req));
export const GET = handle(async (req: Request) => logout(req));
