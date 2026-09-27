// Password gate (Next 16 "proxy", formerly middleware). With LIVELYRICS_PASSWORD set, every page
// and API route needs the session cookie from /login: API requests get 401 JSON, pages redirect to
// /login?next=<path>. The login page, /api/auth/*, Next's static files and the favicon stay open.
// The projection window is same-origin, so the cookie covers it too. Without the variable every
// request passes through untouched (local mode as before).

import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authPassword, isPublicPath, verifySession } from "@/lib/server/auth";

export async function proxy(request: NextRequest) {
  const password = authPassword();
  if (!password) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (await verifySession(password, request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "需要登入才能使用 Livelyrics。" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/" || search) url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  // everything except Next's static files, the favicon, the login page and the auth API
  // (isPublicPath() checks the same list again inside the proxy)
  matcher: ["/((?!_next/static/|_next/image|favicon\\.ico$|login$|login/|api/auth$|api/auth/).*)"],
};
