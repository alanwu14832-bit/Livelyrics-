// Server-Sent Events framing for pipeline runs: `data: <json>\n\n` per event, a comment
// heartbeat, and a clean close on the terminal event or client disconnect (the run
// itself is never cancelled by a disconnect).

import type { PipelineEvent } from "@/lib/types";
import type { RunHandle } from "./pipeline";

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform keeps compression middleware from buffering the stream
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

export function formatSseEvent(event: PipelineEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export interface SseOptions {
  /** aborts when the client goes away */
  signal?: AbortSignal;
  heartbeatMs?: number;
  /** events sent to this subscriber only, before the run's own events */
  prelude?: PipelineEvent[];
}

export function pipelineEventStream(handle: RunHandle, opts: SseOptions = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  let closed = false;
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let onAbort: (() => void) | undefined;

  const stop = () => {
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe();
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        stop();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop();
        }
      };

      if (opts.signal?.aborted) {
        close();
        return;
      }
      onAbort = close;
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      // an initial comment flushes the headers right away
      send(": livelyrics\n\n");
      for (const event of opts.prelude ?? []) send(formatSseEvent(event));

      const unsub = handle.subscribe((event) => {
        send(formatSseEvent(event));
        if (event.type === "done" || event.type === "error") close();
      });
      if (closed) unsub();
      else unsubscribe = unsub;

      if (!closed) {
        heartbeat = setInterval(() => send(": heartbeat\n\n"), heartbeatMs);
        heartbeat.unref?.();
      }
      // a run that already finished without a terminal event in history (should not happen) still closes
      if (!closed && handle.run.status !== "running") close();
    },
    cancel() {
      stop();
    },
  });
}

/** A stream that sends a fixed list of events and closes (e.g. nothing to attach to). */
export function eventListStream(events: readonly PipelineEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": livelyrics\n\n"));
      for (const event of events) controller.enqueue(encoder.encode(formatSseEvent(event)));
      controller.close();
    },
  });
}
