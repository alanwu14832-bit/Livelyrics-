// The password gate: which requests the proxy sees (matcher) and what it answers.

import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AUTH_COOKIE, signSession } from "@/lib/server/auth";

// Next's request context expects the runtime's AsyncLocalStorage global (set by its server)
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;

type ProxyModule = typeof import("./proxy");
let proxy: ProxyModule["proxy"];
let config: ProxyModule["config"];
let NextRequest: typeof import("next/server").NextRequest;
let doesMatch: typeof import("next/experimental/testing/server").unstable_doesMiddlewareMatch;

beforeAll(async () => {
  ({ proxy, config } = await import("./proxy"));
  ({ NextRequest } = await import("next/server"));
  ({ unstable_doesMiddlewareMatch: doesMatch } = await import("next/experimental/testing/server"));
});

const saved = process.env.LIVELYRICS_PASSWORD;
afterEach(() => {
  if (saved === undefined) delete process.env.LIVELYRICS_PASSWORD;
  else process.env.LIVELYRICS_PASSWORD = saved;
});

const req = (path: string, cookie?: string) => new NextRequest(`https://livelyrics.example${path}`, cookie ? { headers: { cookie: `${AUTH_COOKIE}=${cookie}` } } : undefined);

describe("matcher", () => {
  it("runs on pages and APIs, not on the login page, the auth API, static files or the favicon", () => {
    for (const url of ["/", "/p/abc", "/p/abc/output", "/api/projects", "/api/projects/abc/audio", "/api/blob/upload", "/loginx", "/api/authx", "/b/x/bible", "/stage-lab"]) {
      expect(doesMatch({ config, url }), url).toBe(true);
    }
    for (const url of ["/login", "/login?next=/p/x", "/api/auth/login", "/api/auth/logout", "/_next/static/chunks/main.js", "/_next/image?url=%2Fa.png&w=64&q=75", "/favicon.ico"]) {
      expect(doesMatch({ config, url }), url).toBe(false);
    }
  });
});

describe("proxy", () => {
  it("passes everything through without LIVELYRICS_PASSWORD", async () => {
    delete process.env.LIVELYRICS_PASSWORD;
    for (const path of ["/", "/api/projects"]) {
      const res = await proxy(req(path));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("answers 401 JSON to APIs and redirects pages to /login?next=", async () => {
    process.env.LIVELYRICS_PASSWORD = "test";
    const api = await proxy(req("/api/projects"));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "需要登入才能使用 Livelyrics。" });

    const page = await proxy(req("/p/abc/output?x=1"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("https://livelyrics.example/login?next=%2Fp%2Fabc%2Foutput%3Fx%3D1");
    expect((await proxy(req("/"))).headers.get("location")).toBe("https://livelyrics.example/login");

    // a wrong or foreign cookie is no better than none
    expect((await proxy(req("/api/projects", await signSession("other")))).status).toBe(401);
    expect((await proxy(req("/api/projects", "v1.abc.forged"))).status).toBe(401);
  });

  it("lets a signed-in request through, and never blocks the public paths", async () => {
    process.env.LIVELYRICS_PASSWORD = "test";
    const cookie = await signSession("test");
    for (const path of ["/", "/api/projects", "/p/abc/output"]) {
      expect((await proxy(req(path, cookie))).headers.get("x-middleware-next")).toBe("1");
    }
    for (const path of ["/login", "/api/auth/login", "/_next/static/x.js", "/favicon.ico"]) {
      expect((await proxy(req(path))).headers.get("x-middleware-next")).toBe("1");
    }
  });
});
