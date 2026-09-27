// Password gate (LIVELYRICS_PASSWORD; off when unset). The session cookie holds
// `v1.<issued>.<mac>` where mac = HMAC-SHA256 over "session:v1.<issued>" with a key derived from
// the password (HKDF-SHA256): the password never leaves the server, changing it signs everyone
// out, sessions expire after SESSION_MAX_AGE_S, and nothing is stored server-side (serverless
// instances share no memory). MACs are compared in constant time. Web Crypto only, so the same
// code runs in the proxy (src/proxy.ts) and in the route handlers.

export const AUTH_COOKIE = "livelyrics_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;
const VERSION = "v1";
const encoder = new TextEncoder();

export function authPassword(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.LIVELYRICS_PASSWORD;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function authEnabled(): boolean {
  return authPassword() != null;
}

let cachedKey: { password: string; key: Promise<CryptoKey> } | null = null;

function sessionKey(password: string): Promise<CryptoKey> {
  if (cachedKey?.password !== password) {
    const key = (async () => {
      const ikm = await crypto.subtle.importKey("raw", encoder.encode(password), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: encoder.encode("livelyrics-auth"), info: encoder.encode("session-cookie-v1") },
        ikm,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign"],
      );
    })();
    cachedKey = { password, key };
  }
  return cachedKey.key;
}

async function mac(password: string, message: string): Promise<Uint8Array> {
  const key = await sessionKey(password);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Constant-time comparison (for equal lengths; different lengths are simply unequal). */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** A session cookie value issued now (or at `issuedAt`, epoch ms). */
export async function signSession(password: string, issuedAt = Date.now()): Promise<string> {
  const payload = `${VERSION}.${Math.floor(issuedAt / 1000).toString(36)}`;
  return `${payload}.${toBase64Url(await mac(password, `session:${payload}`))}`;
}

/** True for a cookie signed with this password that has not expired. */
export async function verifySession(password: string, value: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!value || value.length > 256) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || !/^[0-9a-z]{1,12}$/.test(parts[1])) return false;
  const issued = parseInt(parts[1], 36);
  const age = now / 1000 - issued;
  // expired, or issued in the future (beyond a little clock skew)
  if (!Number.isFinite(issued) || age > SESSION_MAX_AGE_S || age < -300) return false;
  const given = fromBase64Url(parts[2]);
  if (!given) return false;
  return timingSafeEqualBytes(given, await mac(password, `session:${parts[0]}.${parts[1]}`));
}

/** Constant-time password check: compares fixed-length MACs of both, never the strings. */
export async function passwordMatches(password: string, candidate: unknown): Promise<boolean> {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 1024) return false;
  const [a, b] = await Promise.all([mac(password, `password:${candidate}`), mac(password, `password:${password}`)]);
  return timingSafeEqualBytes(a, b);
}

/** Paths the gate never blocks: the login page, the auth API, Next's own files and the favicon. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/__nextjs") ||
    pathname === "/favicon.ico"
  );
}

/** Where to go after logging in: a same-site path only (no open redirects), never back to /login or an API. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || next.length > 2000) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/") || next.startsWith("/api/")) return "/";
  return next;
}

/**
 * Secure on https (always on Vercel) and on http://localhost, where browsers keep Secure cookies;
 * a plain-http address on the LAN gets a non-Secure cookie, otherwise logging in could never work.
 */
export function cookieSecure(url: URL, headers: Headers): boolean {
  if (url.protocol === "https:") return true;
  if (headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https") return true;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

export function sessionCookie(value: string, secure: boolean, maxAge = SESSION_MAX_AGE_S): string {
  return `${AUTH_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return sessionCookie("", secure, 0);
}
