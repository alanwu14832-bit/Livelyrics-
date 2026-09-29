// Polite HTTP for the free public sources (免費研究): MusicBrainz and Wikipedia.
//
//   - a User-Agent naming the app and a contact (the repository), as both services ask
//   - about 6 s per request, inside an overall budget the caller passes as a signal
//   - MusicBrainz: at most one request a second from this process (a shared gate)
//   - never throws: every failure comes back as `{ ok: false }` with a 繁中 reason, so a source
//     that is down, slow, rate-limited or blocked is simply skipped
//   - the proxy environment of the host is respected (Node's fetch; NODE_USE_ENV_PROXY=1)
//
// Endpoints can be pointed elsewhere (a mirror, the e2e stub) with LIVELYRICS_MUSICBRAINZ_URL and
// LIVELYRICS_WIKIPEDIA_URL; LIVELYRICS_FREE_SOURCES=off skips the network lookups altogether.

export const RESEARCH_USER_AGENT = "Livelyrics/0.1 (contact: https://github.com/alanwu14832-bit/Livelyrics-)";
export const REQUEST_TIMEOUT_MS = 6000;
/** MusicBrainz allows one request per second per client; a little margin. */
export const MUSICBRAINZ_GAP_MS = 1100;

export const DEFAULT_MUSICBRAINZ_URL = "https://musicbrainz.org/ws/2";
/** `{lang}` is replaced by zh / en */
export const DEFAULT_WIKIPEDIA_URL = "https://{lang}.wikipedia.org";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SourceConfig {
  /** false: LIVELYRICS_FREE_SOURCES=off (no network lookups; lyrics and audio only) */
  enabled: boolean;
  musicbrainzUrl: string;
  wikipediaUrl: string;
}

type Env = Record<string, string | undefined>;

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/** Where the free sources live (read on every call, never at import). */
export function sourceConfig(env: Env = process.env): SourceConfig {
  const off = /^(off|0|false|no|none)$/i.test(env.LIVELYRICS_FREE_SOURCES?.trim() ?? "");
  const mb = env.LIVELYRICS_MUSICBRAINZ_URL?.trim();
  const wp = env.LIVELYRICS_WIKIPEDIA_URL?.trim();
  return {
    enabled: !off,
    musicbrainzUrl: trimSlash(mb && /^https?:\/\//.test(mb) ? mb : DEFAULT_MUSICBRAINZ_URL),
    wikipediaUrl: trimSlash(wp && /^https?:\/\//.test(wp) ? wp : DEFAULT_WIKIPEDIA_URL),
  };
}

export interface RequestContext {
  fetch: FetchLike;
  /** the overall budget and the caller's cancellation */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type JsonResult =
  | { ok: true; status: number; data: unknown }
  | {
      ok: false;
      /** null when no response arrived */
      status: number | null;
      /** 繁中 reason, e.g. 「逾時（6 秒）」「HTTP 429（請求太頻繁）」 */
      error: string;
    };

function causeOf(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? err.cause.message : typeof err.cause === "string" ? err.cause : "";
    return cause || err.message || err.name;
  }
  return String(err);
}

function statusText(status: number): string {
  if (status === 429) return "HTTP 429（請求太頻繁）";
  if (status === 403) return "HTTP 403（被拒絕）";
  if (status === 503) return "HTTP 503（服務暫時無法使用）";
  return `HTTP ${status}`;
}

/** One GET of a JSON document. Never throws; a 404 is `{ ok: false, status: 404 }`. */
export async function getJson(url: string, ctx: RequestContext, headers: Record<string, string> = {}): Promise<JsonResult> {
  const timeoutMs = ctx.timeoutMs ?? REQUEST_TIMEOUT_MS;
  if (ctx.signal?.aborted) return { ok: false, status: null, error: "已停止（查詢時間用完）" };
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await ctx.fetch(url, {
      headers: { "User-Agent": RESEARCH_USER_AGENT, Accept: "application/json", ...headers },
      signal,
      cache: "no-store",
      redirect: "follow",
    });
  } catch (err) {
    if (ctx.signal?.aborted) return { ok: false, status: null, error: "已停止（查詢時間用完）" };
    if (timeout.aborted) return { ok: false, status: null, error: `逾時（${Math.round(timeoutMs / 1000)} 秒）` };
    return { ok: false, status: null, error: `無法連線（${causeOf(err)}）` };
  }
  if (!res.ok) {
    // never awaited: under Next's fetch an awaited cancel() can stay pending
    res.body?.cancel().catch(() => {});
    return { ok: false, status: res.status, error: statusText(res.status) };
  }
  try {
    return { ok: true, status: res.status, data: await res.json() };
  } catch (err) {
    if (ctx.signal?.aborted) return { ok: false, status: null, error: "已停止（查詢時間用完）" };
    if (timeout.aborted) return { ok: false, status: null, error: `逾時（${Math.round(timeoutMs / 1000)} 秒）` };
    return { ok: false, status: res.status, error: `回傳了無法解析的資料（${causeOf(err)}）` };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * A process-wide queue that spaces requests `gapMs` apart (MusicBrainz: one a second). Every
 * research run in this server shares it, so two songs processed at once still stay polite.
 */
export class RateGate {
  private last = -Infinity;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly gapMs: number) {}

  /** Resolves when the caller may send its request (immediately when the signal has fired). */
  wait(signal?: AbortSignal, gapMs = this.gapMs): Promise<void> {
    const turn = this.queue.then(async () => {
      await sleep(this.last + gapMs - Date.now(), signal);
      this.last = Date.now();
    });
    this.queue = turn.catch(() => {});
    return turn;
  }
}

/** The shared MusicBrainz gate of this server process. */
export const musicBrainzGate = new RateGate(MUSICBRAINZ_GAP_MS);
