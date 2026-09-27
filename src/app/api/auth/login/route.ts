import { authPassword, cookieSecure, passwordMatches, safeNextPath, sessionCookie, signSession } from "@/lib/server/auth";
import { handle, HttpError, isJsonRequest, json, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

function seeOther(location: URL, cookie?: string): Response {
  const headers = new Headers({ Location: location.toString(), "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/**
 * Log in with LIVELYRICS_PASSWORD. JSON `{ password, next }` -> `{ ok, next }` (the login page), or
 * a form post (password, next) -> 303 to `next` (or back to /login?error=1). Sets the httpOnly,
 * SameSite=Lax session cookie (Secure on https).
 */
export const POST = handle(async (req: Request) => {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, "請求內容太大");
  const url = new URL(req.url);
  const form = !isJsonRequest(req);
  let candidate: unknown;
  let next: unknown;
  if (form) {
    const data = await req.formData().catch(() => null);
    candidate = data?.get("password");
    next = data?.get("next");
  } else {
    const body = (await readJson(req, MAX_BODY_BYTES, {})) as { password?: unknown; next?: unknown } | null;
    candidate = body?.password;
    next = body?.next;
  }
  const target = safeNextPath(next);
  const password = authPassword();
  if (!password) return form ? seeOther(new URL(target, url)) : json({ ok: true, next: target });

  if (!(await passwordMatches(password, candidate))) {
    // no lockout state to keep between serverless instances: slow every wrong guess down instead
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (form) {
      const back = new URL("/login", url);
      back.searchParams.set("error", "1");
      if (target !== "/") back.searchParams.set("next", target);
      return seeOther(back);
    }
    throw new HttpError(401, "密碼不正確，請再試一次。");
  }

  const cookie = sessionCookie(await signSession(password), cookieSecure(url, req.headers));
  if (form) return seeOther(new URL(target, url), cookie);
  const res = json({ ok: true, next: target });
  res.headers.append("Set-Cookie", cookie);
  return res;
});
