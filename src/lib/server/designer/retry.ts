// Claude being briefly unavailable (5xx, 529 overloaded, an overloaded error mid-stream) should not
// send a song straight to the free research. On top of the SDK's own quick retries, a step waits and
// tries the same model again, then (first turn only) a backup model, and only then gives up.

import Anthropic from "@anthropic-ai/sdk";
import type { ClaudeTransport } from "./claude";

/** Waits between tries of the configured model (ms); the backup model gets one try after these. */
export const RETRY_DELAYS_MS = [3_000, 8_000] as const;

/** `LIVELYRICS_BACKUP_MODEL` ("off" disables it); defaults to Opus 5.5, which supports every feature used here. */
export function backupModelName(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.LIVELYRICS_BACKUP_MODEL?.trim();
  if (raw && /^(off|none|false|0)$/i.test(raw)) return null;
  return raw || "claude-opus-5-5";
}

/** true for a failure that says "try again later" rather than "this request is wrong". */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError) || err instanceof Anthropic.APIUserAbortError) return false;
  if (err instanceof Anthropic.APIConnectionError) return false; // the SDK already retried; a network problem is not Claude's
  if (typeof err.status === "number") return err.status >= 500;
  // an error event inside an already-open stream carries no HTTP status
  return err.type === "overloaded_error" || err.type === "api_error";
}

export interface RetryOptions {
  backupModel?: string | null;
  onLog?: (message: string) => void;
  delays?: readonly number[];
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function statusLabel(err: unknown): string {
  const e = err as InstanceType<typeof Anthropic.APIError>;
  return typeof e.status === "number" ? String(e.status) : e.type === "overloaded_error" ? "過載" : "錯誤";
}

/**
 * Retry transient Claude failures. Nothing is retried once the response has started streaming (the
 * progress panel already shows it). The backup model is only used on the first request of a step
 * (not a `pause_turn` continuation) and, once used, sticks for the rest of that step.
 */
export function withRetries(transport: ClaudeTransport, opts: RetryOptions = {}): ClaudeTransport {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? abortableSleep;
  const log = opts.onLog ?? (() => {});
  let switchedTo: string | null = null;

  return {
    async stream(params, handlers, signal) {
      if (switchedTo) params = { ...params, model: switchedTo };
      let started = false;
      const tracked = {
        onText: (d: string) => ((started = true), handlers.onText?.(d)),
        onThinking: (d: string) => ((started = true), handlers.onThinking?.(d)),
        onBlock: (b: Parameters<NonNullable<typeof handlers.onBlock>>[0]) => ((started = true), handlers.onBlock?.(b)),
      };
      const attempt = () => transport.stream(params, tracked, signal);

      let lastErr: unknown;
      for (let i = 0; i <= delays.length; i++) {
        try {
          return await attempt();
        } catch (err) {
          if (started || !isTransient(err) || signal?.aborted) throw err;
          lastErr = err;
          if (i < delays.length) {
            log(`Claude 暫時無法使用（${statusLabel(err)}），${Math.round(delays[i] / 1000)} 秒後重試（第 ${i + 1} 次）…`);
            await sleep(delays[i], signal);
          }
        }
      }

      const backup = opts.backupModel;
      const firstTurn = params.messages.at(-1)?.role === "user";
      if (!backup || backup === params.model || !firstTurn) throw lastErr;
      log(`${params.model} 仍然無法使用，改用備用模型 ${backup}…`);
      switchedTo = backup;
      params = { ...params, model: backup };
      return await attempt();
    },
  };
}
