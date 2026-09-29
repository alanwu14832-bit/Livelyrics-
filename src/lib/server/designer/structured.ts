// A single Claude call with structured outputs (no tools) for the band-level jobs: deriving the
// visual bible and planning a show arc. Same transport, fallbacks and refusal handling as the
// song designer; the caller validates / normalizes the JSON and falls back to its heuristic.

import type { z } from "zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ClaudeFailure, FALLBACK_BETA, parsePlanJson, runWithContinuations, type ClaudeOptions } from "./claude";
import { describeRefusal, describeStop, textAfterLastFallback, textOf } from "./messages";
import { jsonOutputFormat } from "./output-schema";
import type { DesignerCallbacks } from "./types";

type Callbacks = Required<Omit<DesignerCallbacks, "signal">> & { signal?: AbortSignal };

export async function claudeStructured(
  job: {
    system: string;
    prompt: string;
    schema: z.ZodType;
    maxTokens?: number;
    label: string;
    /** content blocks before the prompt text (mood board images) */
    before?: BetaContentBlockParam[];
    effort?: "low" | "medium" | "high";
  },
  cb: Callbacks,
  opts: ClaudeOptions,
): Promise<{ raw: unknown; model: string }> {
  let thinking = false;
  const result = await runWithContinuations(
    opts.transport,
    {
      model: opts.model,
      max_tokens: job.maxTokens ?? 16_000,
      system: job.system,
      messages: [{ role: "user", content: job.before?.length ? [...job.before, { type: "text", text: job.prompt }] : job.prompt }],
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: job.effort ?? "high", format: jsonOutputFormat(job.schema) },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    },
    {
      onThinking: () => {
        if (!thinking) {
          thinking = true;
          cb.onLog(`Claude 正在思考${job.label}…`);
        }
      },
      onBlock: (block) => {
        if (block.type === "fallback") cb.onLog(`${block.from.model} 婉拒了這個請求，已由 ${block.to.model} 接手`);
      },
    },
    { signal: cb.signal },
  );
  if (result.stopReason === "refusal") throw new ClaudeFailure(describeRefusal(result.message.stop_details));
  if (result.stopReason === "max_tokens" || result.stopReason === "model_context_window_exceeded") throw new ClaudeFailure(`${job.label}不完整：${describeStop(result.stopReason)}`);
  const raw = parsePlanJson(textOf(result.content)) ?? parsePlanJson(textAfterLastFallback(result.content));
  if (raw == null) throw new ClaudeFailure(`Claude 回傳的${job.label}不是有效的 JSON`);
  return { raw, model: String(result.message.model || opts.model) };
}
