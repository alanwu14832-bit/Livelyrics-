import { afterEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as logoutGet, POST as logout } from "@/app/api/auth/logout/route";
import {
  AUTH_COOKIE,
  SESSION_MAX_AGE_S,
  cookieSecure,
  isPublicPath,
  passwordMatches,
  safeNextPath,
  sessionCookie,
  signSession,
  timingSafeEqualBytes,
  verifySession,
} from "./auth";

const saved = process.env.LIVELYRICS_PASSWORD;
afterEach(() => {
  if (saved === undefined) delete process.env.LIVELYRICS_PASSWORD;
  else process.env.LIVELYRICS_PASSWORD = saved;
});

describe("session cookie", () => {
  it("signs and verifies without ever containing the password", async () => {
    const value = await signSession("台北 hunter2");
    expect(value).toMatch(/^v1\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
    expect(value).not.toContain("hunter2");
    expect(await verifySession("台北 hunter2", value)).toBe(true);
  });

  it("rejects another password, tampering, expiry and garbage", async () => {
    const now = Date.now();
    const value = await signSession("pw", now);
    expect(await verifySession("pw2", value, now)).toBe(false);
    const [v, issued, sig] = value.split(".");
    // a later issue time with the old signature
    expect(await verifySession("pw", `${v}.${(parseInt(issued, 36) + 1).toString(36)}.${sig}`, now)).toBe(false);
    // one flipped signature character
    const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(await verifySession("pw", `${v}.${issued}.${flipped}`, now)).toBe(false);
    // expired, and issued in the future
    expect(await verifySession("pw", value, now + (SESSION_MAX_AGE_S + 1) * 1000)).toBe(false);
    expect(await verifySession("pw", await signSession("pw", now + 3600_000), now)).toBe(false);
    for (const bad of [undefined, null, "", "v1", "v1.x.y", "v2.abc.def", "a.b.c.d", `v1.${issued}.${"A".repeat(300)}`, "v1.ZZ.abc"]) {
      expect(await verifySession("pw", bad, now)).toBe(false);
    }
  });

  it("checks the password in constant time over fixed-length MACs", async () => {
    expect(await passwordMatches("s3cret", "s3cret")).toBe(true);
    for (const wrong of ["s3cre", "s3cret ", "S3cret", "", "x".repeat(2000), 42, null]) expect(await passwordMatches("s3cret", wrong)).toBe(false);
    expect(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqualBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it("builds an httpOnly, SameSite=Lax cookie, Secure on https and localhost", () => {
    expect(sessionCookie("abc", true)).toBe(`${AUTH_COOKIE}=abc; Path=/; Max-Age=${SESSION_MAX_AGE_S}; HttpOnly; SameSite=Lax; Secure`);
    expect(sessionCookie("abc", false)).not.toContain("Secure");
    const h = new Headers();
    expect(cookieSecure(new URL("https://x.vercel.app/"), h)).toBe(true);
    expect(cookieSecure(new URL("http://localhost:3000/"), h)).toBe(true);
    expect(cookieSecure(new URL("http://192.168.1.20:3000/"), h)).toBe(false);
    expect(cookieSecure(new URL("http://internal/"), new Headers({ "x-forwarded-proto": "https" }))).toBe(true);
  });
});

describe("paths", () => {
  it("keeps the login page, the auth API and Next's files open", () => {
    for (const p of ["/login", "/api/auth/login", "/api/auth/logout", "/_next/static/chunks/a.js", "/_next/image", "/_next/webpack-hmr", "/favicon.ico"]) expect(isPublicPath(p)).toBe(true);
    for (const p of ["/", "/loginx", "/api/authx", "/api/projects", "/p/abc/output", "/stage-lab", "/favicon.ico/x"]) expect(isPublicPath(p)).toBe(false);
  });

  it("only returns to a path on this site after logging in", () => {
    expect(safeNextPath("/p/abc?x=1#y")).toBe("/p/abc?x=1#y");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/\\/evil.com", "javascript:alert(1)", "p/abc", "/login", "/login?next=/", "/api/projects", "/a\nb", 42, undefined]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});

describe("login / logout routes", () => {
  const jsonLogin = (body: unknown, url = "https://livelyrics.example/api/auth/login") =>
    login(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), undefined as never);

  it("sets the session cookie for the right password and refuses the wrong one", async () => {
    process.env.LIVELYRICS_PASSWORD = "test";
    const ok = await jsonLogin({ password: "test", next: "/p/abc" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, next: "/p/abc" });
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toMatch(new RegExp(`^${AUTH_COOKIE}=v1\\.`));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("test;");
    expect(await verifySession("test", cookie.split(";")[0].split("=")[1])).toBe(true);

    const bad = await jsonLogin({ password: "nope", next: "/p/abc" });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error).toMatch(/密碼不正確/);
    expect(bad.headers.get("set-cookie")).toBeNull();
    // an open redirect is not possible
    expect(await (await jsonLogin({ password: "test", next: "//evil.com" })).json()).toEqual({ ok: true, next: "/" });
  });

  it("works as a plain form post too", async () => {
    process.env.LIVELYRICS_PASSWORD = "test";
    const form = (password: string) =>
      login(
        new Request("https://livelyrics.example/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ password, next: "/s/show1" }).toString(),
        }),
        undefined as never,
      );
    const ok = await form("test");
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("https://livelyrics.example/s/show1");
    expect(ok.headers.get("set-cookie")).toContain(`${AUTH_COOKIE}=v1.`);
    const bad = await form("x");
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toBe("https://livelyrics.example/login?error=1&next=%2Fs%2Fshow1");
  });

  it("logout clears the cookie", async () => {
    const res = await logout(new Request("https://livelyrics.example/api/auth/logout", { method: "POST" }), undefined as never);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://livelyrics.example/login");
    expect(res.headers.get("set-cookie")).toBe(`${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
    const viaJson = await logout(new Request("https://livelyrics.example/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), undefined as never);
    expect(await viaJson.json()).toEqual({ ok: true });
    expect((await logoutGet(new Request("http://localhost:3000/api/auth/logout"), undefined as never)).status).toBe(303);
  });
});
