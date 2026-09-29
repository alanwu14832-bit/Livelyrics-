// Test doubles for the Claude transport: message/block builders, a scripted fake
// transport, and an SSE encoder so the real SDK stream parser can be exercised
// through an injected fetch.

import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaRefusalStopDetails,
  BetaServerToolUseBlock,
  BetaStopReason,
  BetaTextBlock,
  BetaTextCitation,
  BetaUsage,
  BetaWebSearchToolResultBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ClaudeTransport, StreamHandlers } from "../claude";

export function usage(): BetaUsage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    fallback_credit: null,
    inference_geo: null,
    input_tokens: 10,
    iterations: null,
    output_tokens: 20,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
  };
}

let seq = 0;

export function message(
  content: BetaContentBlock[],
  stop_reason: BetaStopReason | null,
  opts: { model?: string; stop_details?: BetaRefusalStopDetails | null } = {},
): BetaMessage {
  return {
    id: `msg_${++seq}`,
    container: null,
    content,
    context_management: null,
    diagnostics: null,
    model: opts.model ?? "claude-opus-5",
    role: "assistant",
    stop_details: opts.stop_details ?? null,
    stop_reason,
    stop_sequence: null,
    type: "message",
    usage: usage(),
  };
}

export function text(t: string, citations: BetaTextCitation[] | null = null): BetaTextBlock {
  return { type: "text", text: t, citations };
}

export function cite(url: string, title: string | null): BetaTextCitation {
  return { type: "web_search_result_location", url, title, cited_text: "…", encrypted_index: "idx" };
}

export function search(id: string, query: string): BetaServerToolUseBlock {
  return { type: "server_tool_use", id, name: "web_search", input: { query } };
}

export function searchResult(toolUseId: string, results: Array<[string, string]>): BetaWebSearchToolResultBlock {
  return {
    type: "web_search_tool_result",
    tool_use_id: toolUseId,
    content: results.map(([url, title]) => ({ type: "web_search_result", url, title, encrypted_content: "enc", page_age: null })),
  };
}

export function refusalDetails(category: BetaRefusalStopDetails["category"]): BetaRefusalStopDetails {
  return { type: "refusal", category, explanation: null, fallback_credit_token: null, fallback_has_prefill_claim: null, recommended_model: null };
}

export function fallbackBlock(from: string, to: string): BetaContentBlock {
  return { type: "fallback", from: { model: from }, to: { model: to }, trigger: { type: "refusal", category: "cyber" } };
}

export function thinking(t: string): BetaContentBlock {
  return { type: "thinking", thinking: t, signature: "sig" };
}

export interface FakeTransport extends ClaudeTransport {
  calls: BetaMessageStreamParams[];
}

/**
 * Replays scripted responses in order: text is streamed in two chunks, thinking as one
 * delta, and every block is reported as finished. A script entry may be an Error to throw.
 */
export function fakeTransport(script: Array<BetaMessage | Error>): FakeTransport {
  const calls: BetaMessageStreamParams[] = [];
  return {
    calls,
    async stream(params: BetaMessageStreamParams, handlers: StreamHandlers, signal?: AbortSignal) {
      calls.push(structuredClone(params));
      if (signal?.aborted) throw signal.reason;
      const next = script[calls.length - 1];
      if (!next) throw new Error("fake transport: no scripted response left");
      if (next instanceof Error) throw next;
      for (const b of next.content) {
        if (b.type === "text") {
          const mid = Math.floor(b.text.length / 2);
          handlers.onText?.(b.text.slice(0, mid));
          handlers.onText?.(b.text.slice(mid));
        } else if (b.type === "thinking") handlers.onThinking?.(b.thinking);
        handlers.onBlock?.(b);
      }
      return next;
    },
  };
}

/** Server-sent events a real /v1/messages stream would send for `msg`. */
export function sseEvents(msg: BetaMessage): BetaRawMessageStreamEvent[] {
  const events: BetaRawMessageStreamEvent[] = [{ type: "message_start", message: { ...msg, content: [], stop_reason: null, stop_details: null } }];
  msg.content.forEach((b, index) => {
    switch (b.type) {
      case "text":
        events.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } });
        for (const c of b.citations ?? []) events.push({ type: "content_block_delta", index, delta: { type: "citations_delta", citation: c } });
        events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } });
        break;
      case "server_tool_use":
        events.push({ type: "content_block_start", index, content_block: { ...b, input: {} } });
        events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
        break;
      case "thinking":
        events.push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
        events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: b.thinking, estimated_tokens: null } });
        events.push({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: b.signature } });
        break;
      default:
        events.push({ type: "content_block_start", index, content_block: b });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    delta: { stop_reason: msg.stop_reason, stop_sequence: null, stop_details: msg.stop_details, container: null },
    usage: { output_tokens: 20, input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null, iterations: null, fallback_credit: null, output_tokens_details: null },
    context_management: null,
  });
  events.push({ type: "message_stop" });
  return events;
}

export function sseBody(msg: BetaMessage): string {
  return sseEvents(msg)
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
}
