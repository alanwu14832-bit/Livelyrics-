// Pure helpers over Claude (beta) message content: text, sources, web-search queries,
// server-side fallback markers, pause_turn continuation content, and 繁中 descriptions
// of stop reasons and SDK errors.

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaRefusalStopDetails,
  BetaStopReason,
  BetaTextCitation,
  BetaTextCitationParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ResearchSource } from "@/lib/types";

export const MAX_SOURCES = 24;

/** All text blocks joined in order (citation-split blocks are contiguous prose). */
export function textOf(content: readonly BetaContentBlock[]): string {
  let out = "";
  for (const b of content) if (b.type === "text") out += b.text;
  return out;
}

/** Text produced after the last server-side fallback switch (the whole text when there is none). */
export function textAfterLastFallback(content: readonly BetaContentBlock[]): string {
  let last = -1;
  content.forEach((b, i) => {
    if (b.type === "fallback") last = i;
  });
  return textOf(content.slice(last + 1));
}

export function fallbackSwitches(content: readonly BetaContentBlock[]): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const b of content) if (b.type === "fallback") out.push({ from: String(b.from.model), to: String(b.to.model) });
  return out;
}

/** The query of a web_search server_tool_use block, or null. */
export function searchQueryOf(block: BetaContentBlock): string | null {
  if (block.type !== "server_tool_use" || block.name !== "web_search") return null;
  const q = block.input?.query;
  return typeof q === "string" && q.trim() ? q.trim() : null;
}

export function extractSearchQueries(content: readonly BetaContentBlock[]): string[] {
  const out: string[] = [];
  for (const b of content) {
    const q = searchQueryOf(b);
    if (q && !out.includes(q)) out.push(q);
  }
  return out;
}

/** Error codes of failed web searches. */
export function searchErrors(content: readonly BetaContentBlock[]): string[] {
  const out: string[] = [];
  for (const b of content) {
    if (b.type === "web_search_tool_result" && !Array.isArray(b.content)) out.push(b.content.error_code);
  }
  return out;
}

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|igshid$|si$)/i;

/** Canonical form of a URL for de-duplication; null for non-http(s) URLs. */
export function canonicalUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

function cleanTitle(title: string | null | undefined, url: string): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 160 ? `${t.slice(0, 159)}…` : t;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Sources from text citations (cited first — they back actual claims) and from web
 * search results, de-duplicated by canonical URL, at most MAX_SOURCES.
 */
export function extractSources(content: readonly BetaContentBlock[]): ResearchSource[] {
  const cited: ResearchSource[] = [];
  const found: ResearchSource[] = [];
  for (const b of content) {
    if (b.type === "text") {
      for (const c of b.citations ?? []) {
        if (c.type === "web_search_result_location") cited.push({ url: c.url, title: cleanTitle(c.title, c.url) });
      }
    } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) found.push({ url: r.url, title: cleanTitle(r.title, r.url) });
    }
  }
  const seen = new Set<string>();
  const out: ResearchSource[] = [];
  for (const s of [...cited, ...found]) {
    const key = canonicalUrl(s.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: s.title, url: s.url.trim() });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

function citationParam(c: BetaTextCitation): BetaTextCitationParam | null {
  switch (c.type) {
    case "web_search_result_location":
      return { type: c.type, cited_text: c.cited_text, encrypted_index: c.encrypted_index, title: c.title, url: c.url };
    default:
      return null;
  }
}

/** A response block as a request block (for echoing an assistant turn back), or null to omit it. */
export function toBlockParam(b: BetaContentBlock): BetaContentBlockParam | null {
  switch (b.type) {
    case "text": {
      if (!b.text) return null;
      const citations = (b.citations ?? []).map(citationParam).filter((c): c is BetaTextCitationParam => c != null);
      return citations.length ? { type: "text", text: b.text, citations } : { type: "text", text: b.text };
    }
    case "thinking":
      return { type: "thinking", thinking: b.thinking, signature: b.signature };
    case "redacted_thinking":
      return { type: "redacted_thinking", data: b.data };
    case "server_tool_use":
      return { type: "server_tool_use", id: b.id, name: b.name, input: b.input, ...(b.caller ? { caller: b.caller } : {}) };
    case "web_search_tool_result":
      return {
        type: "web_search_tool_result",
        tool_use_id: b.tool_use_id,
        content: Array.isArray(b.content)
          ? b.content.map((r) => ({ type: r.type, url: r.url, title: r.title, encrypted_content: r.encrypted_content, page_age: r.page_age }))
          : { type: "web_search_tool_result_error", error_code: b.content.error_code },
        ...(b.caller ? { caller: b.caller } : {}),
      };
    case "fallback":
      return { type: "fallback", from: { model: b.from.model }, to: { model: b.to.model } };
    default:
      // other block types never occur in these requests (no client tools, MCP, code execution)
      return null;
  }
}

/**
 * Content to re-send as the assistant turn when resuming a `pause_turn`.
 * Follows the server-side fallback echo rules: before the last `fallback` block only
 * text and paired server-tool blocks are kept (thinking, tool_use and unpaired
 * server_tool_use are omitted); everything after it is echoed as is. Empty text blocks
 * are dropped and trailing whitespace is trimmed from a final text block.
 */
export function continuationContent(content: readonly BetaContentBlock[]): BetaContentBlockParam[] {
  let last = -1;
  content.forEach((b, i) => {
    if (b.type === "fallback") last = i;
  });
  const resultIds = new Set<string>();
  for (const b of content) if (b.type === "web_search_tool_result" || b.type === "web_fetch_tool_result") resultIds.add(b.tool_use_id);
  const out: BetaContentBlockParam[] = [];
  content.forEach((b, i) => {
    if (i < last) {
      const keep =
        b.type === "text" ||
        (b.type === "server_tool_use" && resultIds.has(b.id)) ||
        b.type === "web_search_tool_result" ||
        b.type === "web_fetch_tool_result";
      if (!keep) return;
    }
    if (i === last) return; // the fallback marker itself is only an audit record
    const p = toBlockParam(b);
    if (p) out.push(p);
  });
  const tail = out[out.length - 1];
  if (tail && tail.type === "text") {
    const trimmed = tail.text.trimEnd();
    if (trimmed) out[out.length - 1] = { ...tail, text: trimmed };
    else out.pop();
  }
  return out;
}

const REFUSAL_CATEGORY: Record<NonNullable<BetaRefusalStopDetails["category"]>, string> = {
  cyber: "資安",
  bio: "生物",
  frontier_llm: "前沿模型",
  reasoning_extraction: "推理內容",
  general_harms: "一般安全",
};

export function describeRefusal(details: BetaRefusalStopDetails | null | undefined): string {
  const cat = details?.category ? REFUSAL_CATEGORY[details.category] ?? details.category : null;
  return cat ? `Claude 婉拒了這個請求（類別：${cat}）` : "Claude 婉拒了這個請求";
}

export function describeStop(reason: BetaStopReason | null): string {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "完成";
    case "max_tokens":
      return "輸出達到長度上限";
    case "model_context_window_exceeded":
      return "內容超過模型的上下文長度";
    case "pause_turn":
      return "搜尋接續次數用完";
    case "refusal":
      return "Claude 婉拒";
    case "tool_use":
      return "模型要求了未提供的工具";
    case "compaction":
      return "對話被壓縮";
    default:
      return "未知的結束原因";
  }
}

/** An identity-linked key that isn't bound to one workspace must name it on every request (see `clientOptions`). */
function workspaceProblem(err: unknown): string | null {
  if (err instanceof Anthropic.NotFoundError && /workspace\b.*\bnot found/i.test(err.message)) {
    return "找不到 ANTHROPIC_WORKSPACE_ID 指定的 workspace，或這把金鑰沒有它的權限（404）";
  }
  if (!(err instanceof Anthropic.BadRequestError)) return null;
  if (/valid workspace id/i.test(err.message)) return "ANTHROPIC_WORKSPACE_ID 格式不對，應該是 wrkspc_ 開頭的 workspace ID（400）";
  if (/not scoped to a workspace|anthropic-workspace-id/i.test(err.message)) {
    return "這把 API 金鑰沒有綁定 workspace（400）：到 Claude Console 建立綁定單一 workspace 的金鑰，或設定 ANTHROPIC_WORKSPACE_ID";
  }
  return null;
}

/** A short 繁中 explanation of an SDK / network error (never includes credentials). */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIUserAbortError) return "已取消";
  const workspace = workspaceProblem(err);
  if (workspace) return workspace;
  if (err instanceof Anthropic.AuthenticationError) return "API 金鑰無效或已過期（401）";
  if (err instanceof Anthropic.PermissionDeniedError) return "這把金鑰沒有使用此模型的權限（403）";
  if (err instanceof Anthropic.NotFoundError) return "找不到指定的模型，請檢查 LIVELYRICS_MODEL（404）";
  if (err instanceof Anthropic.RateLimitError) return "請求太頻繁或額度不足（429），請稍後再試";
  if (err instanceof Anthropic.BadRequestError) return `請求被拒絕（400）：${truncate(err.message, 160)}`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "連線逾時";
  if (err instanceof Anthropic.APIConnectionError) return "無法連線到 Claude（請檢查網路或代理設定）";
  if (err instanceof Anthropic.InternalServerError) return `Claude 服務暫時無法使用（${err.status}）`;
  if (err instanceof Anthropic.APIError) return `Claude API 錯誤${err.status ? `（${err.status}）` : ""}`;
  if (err instanceof Error) return truncate(err.message, 200);
  return "未知錯誤";
}

function truncate(s: string, n: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
