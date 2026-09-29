// Claude calls for the designer. The SDK is wrapped in a tiny ClaudeTransport so the
// request loop (pause_turn continuation, stop-reason handling, source collection,
// progress streaming) can be unit-tested with an injected fake.

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaStopReason,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { DesignPlanSchema } from "@/lib/schema";
import type { DesignPlan, Research } from "@/lib/types";
import { formatTimeShort } from "@/lib/timeline";
import { LYRIC_STYLES, SCENES } from "./catalog";
import {
  continuationContent,
  describeRefusal,
  describeStop,
  extractSources,
  searchErrors,
  searchQueryOf,
  textAfterLastFallback,
  textOf,
} from "./messages";
import { normalizePlanWithReport } from "./normalize";
import { designPlanOutputFormat } from "./output-schema";
import { visionContent } from "./moodboard";
import { buildDesignPrompt, buildResearchPrompt, DESIGN_SYSTEM, RESEARCH_HEADINGS, RESEARCH_SYSTEM } from "./prompts";
import { analyzeStructure } from "./structure";
import type { DesignerCallbacks, DesignerInput, DesignRequest } from "./types";

/** Beta header for the scalar `fallbacks: "default"` form. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const MAX_CONTINUATIONS = 5;
export const RESEARCH_MAX_TOKENS = 24_000;
export const DESIGN_MAX_TOKENS = 48_000;
export const WEB_SEARCH_MAX_USES = 8;

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

export interface StreamHandlers {
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  /** a finished content block (server_tool_use with its full input, search results, fallback markers...) */
  onBlock?: (block: BetaContentBlock) => void;
}

export interface ClaudeTransport {
  /** Run one streamed request and resolve with the final message. */
  stream(params: BetaMessageStreamParams, handlers: StreamHandlers, signal?: AbortSignal): Promise<BetaMessage>;
}

/** Transport backed by the official SDK (`client.beta.messages.stream` + `finalMessage`). */
export function sdkTransport(client: Anthropic = new Anthropic()): ClaudeTransport {
  return {
    async stream(params, handlers, signal) {
      const stream = client.beta.messages.stream(params, signal ? { signal } : undefined);
      if (handlers.onText) stream.on("text", (delta) => handlers.onText?.(delta));
      if (handlers.onThinking) stream.on("thinking", (delta) => handlers.onThinking?.(delta));
      if (handlers.onBlock) stream.on("contentBlock", (block) => handlers.onBlock?.(block));
      return await stream.finalMessage();
    },
  };
}

/** A Claude outcome the designer cannot use (refusal, truncated or invalid output...). */
export class ClaudeFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeFailure";
  }
}

export interface TurnResult {
  /** the last response */
  message: BetaMessage;
  /** content of every response in order (continuations append) */
  content: BetaContentBlock[];
  continuations: number;
  stopReason: BetaStopReason | null;
}

/**
 * Stream a request and resume `pause_turn` stops by re-sending the original messages
 * plus the assistant content so far (no extra "continue" message), at most
 * `maxContinuations` times.
 */
export async function runWithContinuations(
  transport: ClaudeTransport,
  params: BetaMessageStreamParams,
  handlers: StreamHandlers,
  opts: { maxContinuations?: number; signal?: AbortSignal; onContinue?: (n: number) => void } = {},
): Promise<TurnResult> {
  const max = opts.maxContinuations ?? MAX_CONTINUATIONS;
  const base: BetaMessageParam[] = params.messages;
  let content: BetaContentBlock[] = [];
  let continuations = 0;
  for (;;) {
    let messages = base;
    if (continuations > 0) {
      const assistant = continuationContent(content);
      if (!assistant.length) throw new ClaudeFailure("無法接續暫停的回應");
      messages = [...base, { role: "assistant", content: assistant }];
    }
    const message = await transport.stream({ ...params, messages }, handlers, opts.signal);
    content = [...content, ...message.content];
    if (message.stop_reason === "pause_turn" && continuations < max) {
      continuations++;
      opts.onContinue?.(continuations);
      continue;
    }
    return { message, content, continuations, stopReason: message.stop_reason };
  }
}

type Callbacks = Required<Omit<DesignerCallbacks, "signal">> & { signal?: AbortSignal };

export interface ClaudeOptions {
  transport: ClaudeTransport;
  model: string;
  now?: () => Date;
}

function logFallback(block: BetaContentBlock, cb: Callbacks) {
  if (block.type === "fallback") cb.onLog(`${block.from.model} 婉拒了這個請求，已由 ${block.to.model} 接手`);
}

// ---------------------------------------------------------------------------
// research
// ---------------------------------------------------------------------------

/**
 * Drop narration written before the brief itself ("我先搜尋…" between searches, a chatty
 * preamble): everything before the first fixed heading, or before a first heading that
 * follows a short preamble.
 */
export function tidyBrief(text: string): string {
  let t = text.replace(/\r\n/g, "\n").trim();
  const fixed = t.search(new RegExp(`^#{1,3}\\s*${RESEARCH_HEADINGS[0]}`, "m"));
  const first = fixed >= 0 ? fixed : t.search(/^#{1,3}\s/m);
  if (first > 0 && (fixed >= 0 || first < 600)) t = t.slice(first);
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function appendSources(brief: string, sources: Research["sources"]): string {
  if (!sources.length || brief.includes(`## ${RESEARCH_HEADINGS[4]}`)) return brief;
  const list = sources.slice(0, 12).map((s) => `- [${s.title.replace(/[[\]]/g, "")}](${s.url})`);
  return `${brief}\n\n## ${RESEARCH_HEADINGS[4]}\n${list.join("\n")}`;
}

export function researchParams(input: DesignerInput, model: string): BetaMessageStreamParams {
  const st = analyzeStructure(input);
  return {
    model,
    max_tokens: RESEARCH_MAX_TOKENS,
    system: RESEARCH_SYSTEM,
    messages: [{ role: "user", content: buildResearchPrompt(input, st) }],
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
    thinking: { type: "adaptive", display: "summarized" },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  };
}

/** Research brief with Claude + web search. Throws ClaudeFailure / SDK errors; the caller falls back. */
export async function claudeResearch(input: DesignerInput, cb: Callbacks, opts: ClaudeOptions): Promise<Research> {
  let thinking = false;
  let writing = false;
  let searches = 0;
  const handlers: StreamHandlers = {
    onThinking: () => {
      if (!thinking) {
        thinking = true;
        cb.onLog("Claude 正在規劃研究方向…");
      }
    },
    onText: (delta) => {
      if (!writing) {
        writing = true;
        cb.onLog("開始撰寫研究簡報…");
      }
      cb.onDelta(delta);
    },
    onBlock: (block) => {
      const q = searchQueryOf(block);
      if (q) {
        searches++;
        cb.onSearch(q);
      }
      if (block.type === "web_search_tool_result" && !Array.isArray(block.content)) {
        cb.onLog(`一次網路搜尋失敗（${block.content.error_code}）`);
      }
      logFallback(block, cb);
    },
  };
  const result = await runWithContinuations(opts.transport, researchParams(input, opts.model), handlers, {
    signal: cb.signal,
    onContinue: (n) => cb.onLog(`研究還在進行，接續第 ${n} 次…`),
  });

  if (result.stopReason === "refusal") throw new ClaudeFailure(describeRefusal(result.message.stop_details));
  const sources = extractSources(result.content);
  let brief = tidyBrief(textOf(result.content));
  const truncated = result.stopReason === "max_tokens" || result.stopReason === "model_context_window_exceeded" || result.stopReason === "pause_turn";
  if (brief.length < 80) throw new ClaudeFailure(`研究沒有產生內容（${describeStop(result.stopReason)}）`);
  if (truncated) {
    cb.onLog(`研究簡報不完整：${describeStop(result.stopReason)}，保留已完成的部分`);
    brief += `\n\n> （簡報未完成：${describeStop(result.stopReason)}）`;
  }
  brief = appendSources(brief, sources);
  const failed = searchErrors(result.content).length;
  cb.onLog(`研究完成：${searches} 次搜尋${failed ? `（${failed} 次失敗）` : ""}、${sources.length} 個來源`);
  return {
    brief,
    sources,
    engine: "claude",
    model: String(result.message.model || opts.model),
    createdAt: (opts.now?.() ?? new Date()).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// design
// ---------------------------------------------------------------------------

function unescapeJson(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/**
 * Turns the streaming DesignPlan JSON into readable progress notes (Markdown): the key
 * visual title once, then one bullet per section as soon as its label, start, scene and
 * lyric style have streamed. Tolerant of any partial JSON.
 */
export function createPlanProgress(emit: (markdown: string) => void) {
  const STR = '"((?:[^"\\\\]|\\\\.)*)"';
  const NUM = "(-?\\d+(?:\\.\\d+)?)\\s*[,}]";
  // incremental scanners: each resumes after its last complete match
  const scanners = {
    label: { re: new RegExp(`"label"\\s*:\\s*${STR}`, "g"), from: 0, values: [] as string[] },
    start: { re: new RegExp(`"start"\\s*:\\s*${NUM}`, "g"), from: 0, values: [] as string[] },
    scene: { re: new RegExp(`"scene"\\s*:\\s*${STR}`, "g"), from: 0, values: [] as string[] },
    lyricStyle: { re: new RegExp(`"lyricStyle"\\s*:\\s*${STR}`, "g"), from: 0, values: [] as string[] },
  };
  const titleRe = new RegExp(`"title"\\s*:\\s*${STR}\\s*[,}]`);
  let buf = "";
  let titled = false;
  let sectionsAt = -1;
  let emitted = 0;
  return {
    push(delta: string) {
      buf += delta;
      if (!titled) {
        const m = titleRe.exec(buf);
        if (m) {
          titled = true;
          emit(`### 主視覺「${unescapeJson(m[1])}」\n\n`);
        }
      }
      if (sectionsAt < 0) {
        sectionsAt = buf.indexOf('"sections"');
        if (sectionsAt < 0) return;
        for (const sc of Object.values(scanners)) sc.from = sectionsAt;
        emit("**段落設計**\n\n");
      }
      for (const sc of Object.values(scanners)) {
        sc.re.lastIndex = sc.from;
        let m: RegExpExecArray | null;
        while ((m = sc.re.exec(buf))) {
          sc.values.push(m[1]);
          sc.from = sc.re.lastIndex;
        }
      }
      const { label, start, scene, lyricStyle } = scanners;
      const ready = Math.min(label.values.length, start.values.length, scene.values.length, lyricStyle.values.length);
      while (emitted < ready) {
        const i = emitted++;
        const sceneName = SCENES[scene.values[i] as keyof typeof SCENES]?.label ?? scene.values[i];
        const styleName = LYRIC_STYLES[lyricStyle.values[i] as keyof typeof LYRIC_STYLES]?.label ?? lyricStyle.values[i];
        emit(`- ${formatTimeShort(Number(start.values[i]))} ${unescapeJson(label.values[i])}：${sceneName}／${styleName}\n`);
      }
    },
  };
}

/** Parse the plan JSON, tolerating code fences or stray prose around it. */
export function parsePlanJson(text: string): unknown | null {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Enough structure to be worth repairing (a key visual object and at least one timed section). */
export function isUsablePlan(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  const kv = o.keyVisual;
  if (!kv || typeof kv !== "object" || Array.isArray(kv)) return false;
  if (!Array.isArray(o.sections)) return false;
  return o.sections.some((s) => {
    if (!s || typeof s !== "object") return false;
    const r = s as Record<string, unknown>;
    return typeof r.start === "number" && typeof r.end === "number";
  });
}

/**
 * The user turn: the prompt text, preceded by the mood board images (vision blocks, each with its
 * 圖 n label) when the server could load any. Without images it stays a plain string.
 */
export function userContent(input: DesignerInput, prompt: string): string | BetaContentBlockParam[] {
  const images = visionContent(input.moodboard, input.moodboardImages);
  return images.length ? [...images, { type: "text", text: prompt }] : prompt;
}

export function designParams(req: DesignRequest, model: string): BetaMessageStreamParams {
  const st = analyzeStructure(req);
  return {
    model,
    max_tokens: DESIGN_MAX_TOKENS,
    system: [{ type: "text", text: DESIGN_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent(req, buildDesignPrompt(req, st)) }],
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "high", format: designPlanOutputFormat() },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  };
}

export interface ClaudeDesignResult {
  plan: DesignPlan;
  repairs: string[];
  model: string;
}

/** DesignPlan with Claude structured outputs. Throws ClaudeFailure / SDK errors; the caller falls back. */
export async function claudeDesign(req: DesignRequest, cb: Callbacks, opts: ClaudeOptions): Promise<ClaudeDesignResult> {
  let thinking = false;
  let writing = false;
  const progress = createPlanProgress((md) => cb.onDelta(md));
  const handlers: StreamHandlers = {
    onThinking: () => {
      if (!thinking) {
        thinking = true;
        cb.onLog("設計師正在構思世界觀與段落…");
      }
    },
    onText: (delta) => {
      if (!writing) {
        writing = true;
        cb.onLog("開始輸出設計方案…");
      }
      progress.push(delta);
    },
    onBlock: (block) => logFallback(block, cb),
  };
  const result = await runWithContinuations(opts.transport, designParams(req, opts.model), handlers, { signal: cb.signal });

  if (result.stopReason === "refusal") throw new ClaudeFailure(describeRefusal(result.message.stop_details));
  if (result.stopReason === "max_tokens" || result.stopReason === "model_context_window_exceeded") {
    throw new ClaudeFailure(`設計方案不完整：${describeStop(result.stopReason)}`);
  }
  const raw = parsePlanJson(textOf(result.content)) ?? parsePlanJson(textAfterLastFallback(result.content));
  if (raw == null) throw new ClaudeFailure("Claude 回傳的設計方案不是有效的 JSON");
  const checked = DesignPlanSchema.safeParse(raw);
  if (!checked.success && !isUsablePlan(raw)) throw new ClaudeFailure("設計方案缺少主視覺或段落");
  const { plan, repairs } = normalizePlanWithReport(checked.success ? checked.data : raw, req);
  if (!checked.success) repairs.unshift(`有 ${checked.error.issues.length} 處欄位不符合規格`);
  return { plan, repairs, model: String(result.message.model || opts.model) };
}
