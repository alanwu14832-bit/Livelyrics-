// Safe downloads of images the research found on the open web (研究找到的素材, phase 8).
//
// The URLs come from Claude's answer, a web page or the Cover Art Archive, so they are untrusted:
//   - https only (port 443), no user:password@, at most 3 redirects, each hop checked again
//   - the host is resolved first and every address must be public: loopback, private (RFC 1918),
//     CGNAT, link-local (incl. the 169.254.169.254 metadata service), multicast, reserved,
//     documentation, IPv6 ULA / link-local / site-local, IPv4-mapped / NAT64 / 6to4 addresses of any
//     of those — all refused; names such as localhost, *.local, *.internal, metadata.google.internal
//     and single-label hosts are refused before any lookup
//   - the connection uses the checked addresses (a custom `lookup` pins them), so a DNS answer that
//     changes between the check and the connect (rebinding) cannot reach an internal address
//   - a per-request timeout, a size cap (Content-Length and while streaming), a required content type
//   - never throws: failures come back as `{ ok: false, error }` in 繁中
//
// Origins the operator configured explicitly (the e2e stub: LIVELYRICS_COVERART_URL) are trusted:
// http and loopback are allowed there and only there.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { RESEARCH_USER_AGENT } from "./http";

export const MAX_REDIRECTS = 3;
export const DOWNLOAD_TIMEOUT_MS = 8000;

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface RawResponse {
  status: number;
  header(name: string): string | null;
  body: AsyncIterable<Uint8Array>;
  /** stop the transfer (the rest is not needed) */
  destroy(): void;
}

export interface RawRequestInit {
  headers: Record<string, string>;
  signal: AbortSignal;
  /** the checked addresses the connection must use (empty for a trusted origin) */
  addresses: ResolvedAddress[];
}

export interface SafeNet {
  /** DNS: every address of a host */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** one HTTP exchange (no redirects followed) */
  request?: (url: URL, init: RawRequestInit) => Promise<RawResponse>;
  /** origins (scheme://host:port) that may be http / loopback: the configured test endpoints */
  trustedOrigins?: readonly string[];
}

export type SafeResult =
  | { ok: true; url: string; contentType: string; bytes: Uint8Array; redirects: number }
  | { ok: false; error: string; status?: number };

// ---------------------------------------------------------------------------
// addresses
// ---------------------------------------------------------------------------

function v4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n >= 0 && n <= 255) ? p : null;
}

/** true when an IPv4 address is not on the public internet. */
export function isPrivateV4(ip: string): boolean {
  const p = v4Parts(ip);
  if (!p) return true;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return true; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** The eight 16-bit groups of an IPv6 address (zone id dropped), or null. */
export function v6Groups(ip: string): number[] | null {
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!net.isIPv6(s)) return null;
  const lastColon = s.lastIndexOf(":");
  const tailStr = s.slice(lastColon + 1);
  if (tailStr.includes(".")) {
    const v4 = v4Parts(tailStr);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const double = s.indexOf("::");
  const part = (x: string) => (x ? x.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  let groups: number[];
  if (double < 0) groups = part(s);
  else {
    const h = part(s.slice(0, double));
    const r = part(s.slice(double + 2));
    groups = [...h, ...new Array(Math.max(0, 8 - h.length - r.length)).fill(0), ...r];
  }
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

/** true when an IPv6 address is not a public unicast address (mapped / embedded IPv4 checked too). */
export function isPrivateV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8)) return true; // ::
  if (zeros(7) && g[7] === 1) return true; // ::1
  if (zeros(5) && g[5] === 0xffff) return isPrivateV4(embedded(g[6], g[7])); // ::ffff:a.b.c.d
  if (zeros(6)) return true; // ::a.b.c.d (deprecated IPv4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(embedded(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateV4(embedded(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard
  if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7 (incl. fd00:ec2::254)
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if ((g[0] & 0xe000) !== 0x2000) return true; // outside global unicast 2000::/3
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const s = ip.replace(/^\[|\]$/g, "");
  if (net.isIPv4(s)) return isPrivateV4(s);
  if (net.isIPv6(s.replace(/%.*$/, ""))) return isPrivateV6(s);
  return true;
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|arpa|test|invalid|example)$/i;

/** A host name that must never be looked up (it names this machine or a private network). */
export function isBlockedHostname(host: string): boolean {
  const h = host.replace(/\.$/, "").toLowerCase();
  if (!h) return true;
  if (BLOCKED_NAMES.test(h)) return true;
  if (h === "metadata" || h === "metadata.google.internal" || h === "instance-data") return true;
  // a single label (e.g. "router") resolves through the local search domain
  if (!h.includes(".") && !net.isIP(h)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export type UrlCheck = { ok: true; url: URL; trusted: boolean } | { ok: false; error: string };

/** The rules a URL must pass before anything is resolved (every redirect hop too). */
export function checkUrl(raw: string | URL, trustedOrigins: readonly string[] = []): UrlCheck {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : new URL(raw.href);
  } catch {
    return { ok: false, error: "網址格式不正確" };
  }
  const trusted = trustedOrigins.includes(url.origin);
  if (trusted) return { ok: true, url, trusted };
  if (url.protocol !== "https:") return { ok: false, error: "只接受 https 網址" };
  if (url.username || url.password) return { ok: false, error: "網址不能帶帳號密碼" };
  if (url.port && url.port !== "443") return { ok: false, error: "只接受 443 埠" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) return { ok: false, error: "拒絕連到內部或保留的位址" };
  } else if (isBlockedHostname(host)) return { ok: false, error: "拒絕連到內部主機名稱" };
  return { ok: true, url, trusted };
}

// ---------------------------------------------------------------------------
// the default transport: node:http(s) with the checked addresses pinned
// ---------------------------------------------------------------------------

async function systemLookup(hostname: string): Promise<ResolvedAddress[]> {
  const list = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return list.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function pinnedLookup(addresses: ResolvedAddress[]) {
  return (_host: string, options: dns.LookupOptions | number | undefined, cb: LookupCb) => {
    const all = typeof options === "object" && options?.all;
    const usable = addresses.filter((a) => !isPrivateAddress(a.address));
    if (!usable.length) return cb(Object.assign(new Error("no public address"), { code: "ENOTFOUND" }), "");
    if (all) return cb(null, usable.map((a) => ({ address: a.address, family: a.family })));
    return cb(null, usable[0].address, usable[0].family);
  };
}

function nodeRequest(url: URL, init: RawRequestInit): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "http:" ? http : https;
    const req = mod.request(
      url,
      {
        method: "GET",
        headers: init.headers,
        signal: init.signal,
        ...(init.addresses.length ? { lookup: pinnedLookup(init.addresses) as unknown as typeof dns.lookup } : {}),
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          header: (name) => {
            const v = res.headers[name.toLowerCase()];
            return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
          },
          body: res as AsyncIterable<Uint8Array>,
          destroy: () => res.destroy(),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// the download
// ---------------------------------------------------------------------------

export type Accept = "image" | "html" | "json";

const ACCEPT_HEADER: Record<Accept, string> = {
  image: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
  html: "text/html,application/xhtml+xml;q=0.9",
  json: "application/json",
};

function typeOk(accept: Accept, contentType: string): boolean {
  const t = contentType.split(";")[0].trim().toLowerCase();
  if (accept === "image") return t.startsWith("image/") && !t.includes("svg");
  if (accept === "html") return t === "text/html" || t === "application/xhtml+xml";
  return t === "application/json" || t.endsWith("+json");
}

function causeOf(err: unknown): string {
  if (err instanceof Error) {
    const c = err.cause instanceof Error ? err.cause.message : "";
    return (c || err.message || err.name).slice(0, 120);
  }
  return String(err).slice(0, 120);
}

export interface SafeGetOptions {
  accept: Accept;
  maxBytes: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  net?: SafeNet;
  headers?: Record<string, string>;
}

/** GET with every rule above. Never throws. */
export async function safeGet(rawUrl: string, opts: SafeGetOptions): Promise<SafeResult> {
  const netDeps = opts.net ?? {};
  const lookup = netDeps.lookup ?? systemLookup;
  const request = netDeps.request ?? nodeRequest;
  const trustedOrigins = netDeps.trustedOrigins ?? [];
  const timeoutMs = opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  if (opts.signal?.aborted) return { ok: false, error: "已停止（時間用完）" };
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    const checked = checkUrl(current, trustedOrigins);
    if (!checked.ok) return { ok: false, error: checked.error };
    const url = checked.url;
    let addresses: ResolvedAddress[] = [];
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!checked.trusted && !net.isIP(host)) {
      try {
        addresses = await lookup(host);
      } catch (err) {
        return { ok: false, error: `找不到主機（${causeOf(err)}）` };
      }
      if (!addresses.length) return { ok: false, error: "找不到主機" };
      // every answer must be public: a name that also points inside is refused as a whole
      if (addresses.some((a) => isPrivateAddress(a.address))) return { ok: false, error: "主機指向內部或保留的位址，已拒絕" };
    } else if (!checked.trusted) {
      addresses = [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
    }
    if (signal.aborted) return { ok: false, error: timeout.aborted ? `逾時（${Math.round(timeoutMs / 1000)} 秒）` : "已停止（時間用完）" };
    let res: RawResponse;
    try {
      res = await request(url, {
        headers: { "User-Agent": RESEARCH_USER_AGENT, Accept: ACCEPT_HEADER[opts.accept], ...(opts.headers ?? {}) },
        signal,
        addresses,
      });
    } catch (err) {
      if (timeout.aborted) return { ok: false, error: `逾時（${Math.round(timeoutMs / 1000)} 秒）` };
      if (opts.signal?.aborted) return { ok: false, error: "已停止（時間用完）" };
      return { ok: false, error: `無法連線（${causeOf(err)}）` };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.header("location");
      res.destroy();
      if (!location) return { ok: false, error: `HTTP ${res.status} 沒有轉址目標`, status: res.status };
      if (hop >= MAX_REDIRECTS) return { ok: false, error: `轉址超過 ${MAX_REDIRECTS} 次`, status: res.status };
      try {
        current = new URL(location, url).href;
      } catch {
        return { ok: false, error: "轉址目標格式不正確" };
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      res.destroy();
      return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    }
    const contentType = res.header("content-type") ?? "";
    if (!typeOk(opts.accept, contentType)) {
      res.destroy();
      return { ok: false, error: `內容類型不符（${contentType.split(";")[0] || "未知"}）`, status: res.status };
    }
    const declared = Number(res.header("content-length"));
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      res.destroy();
      return { ok: false, error: `檔案太大（超過 ${Math.round(opts.maxBytes / 1024 / 1024)} MB）`, status: res.status };
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > opts.maxBytes) {
          res.destroy();
          return { ok: false, error: `檔案太大（超過 ${Math.round(opts.maxBytes / 1024 / 1024)} MB）`, status: res.status };
        }
        chunks.push(chunk);
      }
    } catch (err) {
      res.destroy();
      if (timeout.aborted) return { ok: false, error: `逾時（${Math.round(timeoutMs / 1000)} 秒）` };
      return { ok: false, error: `下載中斷（${causeOf(err)}）` };
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return { ok: true, url: url.href, contentType: contentType.split(";")[0].trim().toLowerCase(), bytes, redirects: hop };
  }
}
