// DESIGNER module: the AI stage-visual designer.
//
// researchSong — Claude (web search) researches the band and song as the band's
//                dedicated stage-visual director and writes a 繁中 Markdown brief.
// designSong   — a second Claude call with structured outputs produces the DesignPlan
//                (key visual, per-section scene + lyric presentation, cue notes).
//
// Both never throw for Claude problems: without a credential, or on any Claude error,
// refusal or unusable output, they fall back to the deterministic offline designer and
// explain why through cb.onLog. Only cancellation (cb.signal) propagates.

import Anthropic from "@anthropic-ai/sdk";
import { formatTimeShort } from "@/lib/timeline";
import { coerceBible, sanitizeFonts } from "@/lib/band";
import type { BandBible, DesignPlan, Research, ShowArc } from "@/lib/types";
import { applyArc, ARC_SYSTEM, ArcDraftSchema, buildArcPrompt, normalizeArc, offlineArc, type ArcInput } from "./arc";
import { BIBLE_SYSTEM, BibleDraftSchema, buildBiblePrompt, offlineBible, type BibleInput } from "./bible";
import { bibleBlock } from "./prompts";
import { claudeStructured } from "./structured";
import { LYRIC_STYLES, SCENES } from "./catalog";
import { claudeDesign, claudeResearch, sdkTransport, type ClaudeTransport } from "./claude";
import { applyInstruction } from "./instruction";
import { describeError } from "./messages";
import { normalizePlan } from "./normalize";
import { offlineDesign, offlineResearch } from "./offline";
import { safeCallbacks, type DesignerCallbacks, type DesignerInput, type DesignRequest } from "./types";

export type { DesignerCallbacks, DesignerInput, DesignRequest } from "./types";
export { normalizePlan } from "./normalize";
export { offlineDesign, offlineResearch } from "./offline";
export { sanitizeSvg, generateMotifSvg } from "./svg";
export { offlineBible, type BibleInput, type BibleSong } from "./bible";
export { offlineArc, applyArc, type ArcInput, type ArcSong } from "./arc";

/** true when an Anthropic credential is configured (otherwise the offline designer is used) */
export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export function modelName(): string {
  return process.env.LIVELYRICS_MODEL?.trim() || "claude-opus-5";
}

/** Injection points for tests, and the time budget of a serverless request. */
export interface DesignerDeps {
  transport?: ClaudeTransport;
  /** override credential detection */
  configured?: boolean;
  model?: string;
  now?: () => Date;
  /**
   * Give Claude at most this long for the whole call (continuations included); when it runs out
   * the offline designer takes over, like any other Claude failure. Cloud mode sets it so a step
   * always finishes (and saves) inside the platform's 300 s limit.
   */
  timeoutMs?: number;
}

/** Claude did not finish inside DesignerDeps.timeoutMs (not a cancellation: the offline designer takes over). */
export class ClaudeTimeoutError extends Error {
  constructor(seconds: number) {
    super(`Claude 超過 ${seconds} 秒還沒完成（雲端每個步驟最多 300 秒）`);
    this.name = "ClaudeTimeoutError";
  }
}

/** A transport that gives up at `deadline` (epoch ms) with ClaudeTimeoutError. */
export function withDeadline(transport: ClaudeTransport, deadline: number, seconds: number): ClaudeTransport {
  return {
    async stream(params, handlers, signal) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ClaudeTimeoutError(seconds);
      const timer = AbortSignal.timeout(remaining);
      try {
        return await transport.stream(params, handlers, signal ? AbortSignal.any([signal, timer]) : timer);
      } catch (err) {
        if (timer.aborted && !signal?.aborted) throw new ClaudeTimeoutError(seconds);
        throw err;
      }
    },
  };
}

type SafeCallbacks = ReturnType<typeof safeCallbacks>;

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("處理已取消");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

function isCancellation(err: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || err instanceof Anthropic.APIUserAbortError;
}

let sharedTransport: ClaudeTransport | null = null;
function defaultTransport(): ClaudeTransport {
  // created lazily: the SDK reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from the environment
  sharedTransport ??= sdkTransport(new Anthropic());
  return sharedTransport;
}

function resolveDeps(deps: DesignerDeps) {
  const budget = deps.timeoutMs != null && deps.timeoutMs > 0 ? deps.timeoutMs : null;
  // the deadline starts with the designer call, so continuations share one budget
  const deadline = budget != null ? Date.now() + budget : null;
  return {
    configured: deps.configured ?? isClaudeConfigured(),
    model: deps.model ?? modelName(),
    transport: () => {
      const t = deps.transport ?? defaultTransport();
      return deadline != null && budget != null ? withDeadline(t, deadline, Math.max(1, Math.round(budget / 1000))) : t;
    },
    now: deps.now,
  };
}

/** Research the band and song as a dedicated stage-visual designer would. Never throws for Claude failures: falls back to offline. */
export async function researchSong(input: DesignerInput, cb: DesignerCallbacks = {}, deps: DesignerDeps = {}): Promise<Research> {
  const cbs = safeCallbacks(cb);
  throwIfAborted(cb.signal);
  const d = resolveDeps(deps);
  let streamed = false;
  const tracked: SafeCallbacks = {
    ...cbs,
    onDelta: (t) => {
      streamed = true;
      cbs.onDelta(t);
    },
  };

  if (!d.configured) {
    cbs.onLog("未設定 Claude（ANTHROPIC_API_KEY），改用離線研究：依音訊分析與歌詞推論，不做網路搜尋。");
    return emitOffline(offlineResearch(input), tracked, false);
  }
  try {
    cbs.onLog(`Claude（${d.model}）開始研究「${input.meta?.artist || "樂團"}」與〈${input.meta?.title || "這首歌"}〉…`);
    return await claudeResearch(input, tracked, { transport: d.transport(), model: d.model, now: d.now });
  } catch (err) {
    if (isCancellation(err, cb.signal)) throw cb.signal?.aborted ? abortReason(cb.signal) : err;
    const why = describeError(err);
    cbs.onLog(`Claude 研究失敗：${why}。改用離線研究。`);
    return emitOffline(offlineResearch(input, `Claude 研究失敗（${why}）`), tracked, streamed);
  }
}

function emitOffline(research: Research, cb: SafeCallbacks, afterPartial: boolean): Research {
  cb.onDelta(afterPartial ? `\n\n---\n\n${research.brief}` : research.brief);
  return research;
}

/** Markdown progress summary of a plan (what the Claude path streams while designing). */
function planSummary(plan: DesignPlan): string {
  const rows = plan.sections.map((s) => `- ${formatTimeShort(s.start)} ${s.label}：${SCENES[s.scene].label}／${LYRIC_STYLES[s.lyricStyle].label}`);
  return `### 主視覺「${plan.keyVisual.title}」\n\n**段落設計**\n\n${rows.join("\n")}\n`;
}

/**
 * The offline path. With a previous plan and an instruction, the heuristics are applied
 * on top of the previous plan (a Claude-made plan is kept, not replaced). With a previous
 * plan after a Claude failure, the previous plan is kept.
 */
function offlinePath(req: DesignRequest, cb: SafeCallbacks, claudeFailed: boolean): DesignPlan {
  const plan = offlinePlan(req, cb, claudeFailed);
  if (!req.arc) return plan;
  const shifted = applyArc(plan, req.arc, req);
  cb.onLog(`依整場弧線調整：第 ${req.arc.position + 1} 首，目標能量 ${req.arc.energy.toFixed(2)}`);
  return shifted;
}

function offlinePlan(req: DesignRequest, cb: SafeCallbacks, claudeFailed: boolean): DesignPlan {
  const instruction = req.instruction?.trim();
  const previous = req.previous ? normalizePlan(req.previous, req) : null;

  if (previous && (instruction || (claudeFailed && !req.arc))) {
    if (instruction) {
      const { plan, changes } = applyInstruction(previous, instruction, req);
      if (changes.length) {
        cb.onLog(`離線設計師依指示調整目前的方案：${changes.join("；")}`);
        cb.onDelta(planSummary(plan));
        return plan;
      }
      cb.onLog("離線設計師看不懂這個指示，保留目前的設計。設定 ANTHROPIC_API_KEY 後即可用自然語言重新設計。");
    } else {
      cb.onLog("保留目前的設計方案（已重新對齊歌曲長度與歌詞）。");
    }
    cb.onDelta(planSummary(previous));
    return previous;
  }

  let plan = offlineDesign(req);
  if (instruction) {
    const applied = applyInstruction(plan, instruction, req);
    if (applied.changes.length) {
      plan = applied.plan;
      cb.onLog(`已套用指示：${applied.changes.join("；")}`);
    } else {
      cb.onLog("離線設計師看不懂這個指示，已產生預設方案。");
    }
  }
  const chorus = plan.sections.filter((s) => s.kind === "chorus").length;
  cb.onLog(`離線設計完成：主視覺「${plan.keyVisual.title}」，${plan.sections.length} 個段落${chorus ? `（${chorus} 段副歌）` : ""}、${plan.cues.length} 個操作提示`);
  cb.onDelta(planSummary(plan));
  return plan;
}

/** Produce a validated, normalized DesignPlan. Never throws for Claude failures: falls back to offline. */
export async function designSong(
  input: DesignRequest,
  cb: DesignerCallbacks = {},
  deps: DesignerDeps = {},
): Promise<DesignPlan> {
  const cbs = safeCallbacks(cb);
  throwIfAborted(cb.signal);
  const d = resolveDeps(deps);
  const req: DesignRequest = input;

  if (!d.configured) {
    cbs.onLog("未設定 Claude（ANTHROPIC_API_KEY），使用離線設計師：依音訊能量、歌詞重複段落與意象關鍵字產生方案。");
    return offlinePath(req, cbs, false);
  }
  try {
    cbs.onLog(`Claude（${d.model}）開始${req.instruction?.trim() ? "依指示重新" : ""}設計主視覺與段落…`);
    const { plan, repairs, model } = await claudeDesign(req, cbs, { transport: d.transport(), model: d.model, now: d.now });
    if (repairs.length) cbs.onLog(`已自動修正方案：${repairs.slice(0, 5).join("；")}${repairs.length > 5 ? "…" : ""}`);
    cbs.onLog(`設計完成（${model}）：主視覺「${plan.keyVisual.title}」，${plan.sections.length} 個段落、${plan.cues.length} 個操作提示`);
    return plan;
  } catch (err) {
    if (isCancellation(err, cb.signal)) throw cb.signal?.aborted ? abortReason(cb.signal) : err;
    const why = describeError(err);
    cbs.onLog(`Claude 設計失敗：${why}。改用離線設計師。`);
    return offlinePath(req, cbs, true);
  }
}

// ---------------------------------------------------------------------------
// band-level jobs: the visual bible and the show arc
// ---------------------------------------------------------------------------

/** 從作品產生視覺聖經. Claude when configured, the offline heuristic otherwise (or on failure). */
export async function generateBible(input: BibleInput, cb: DesignerCallbacks = {}, deps: DesignerDeps = {}): Promise<BandBible> {
  const cbs = safeCallbacks(cb);
  throwIfAborted(cb.signal);
  const d = resolveDeps(deps);
  const now = d.now?.() ?? new Date();
  const fallback = () => offlineBible(input, now);
  if (!d.configured) {
    cbs.onLog("未設定 Claude，使用離線設計師整理作品的共同配色、字體與場景。");
    return fallback();
  }
  try {
    cbs.onLog(`Claude（${d.model}）開始整理「${input.bandName}」的視覺聖經…`);
    const { raw, model } = await claudeStructured({ system: BIBLE_SYSTEM, prompt: buildBiblePrompt(input), schema: BibleDraftSchema, label: "視覺聖經" }, cbs, {
      transport: d.transport(),
      model: d.model,
      now: d.now,
    });
    const draft = coerceBible(raw);
    const base = fallback();
    const bible: BandBible = {
      ...draft,
      // anything Claude left empty keeps the heuristic's reading of the songs
      palette: draft.palette.length >= 3 ? draft.palette : base.palette,
      fonts: sanitizeFonts((raw as { fonts?: unknown })?.fonts, base.fonts),
      summary: draft.summary || base.summary,
      source: { engine: "claude", model, updatedAt: now.toISOString() },
    };
    cbs.onLog("視覺聖經完成");
    return bible;
  } catch (err) {
    if (isCancellation(err, cb.signal)) throw cb.signal?.aborted ? abortReason(cb.signal) : err;
    cbs.onLog(`Claude 無法產生視覺聖經：${describeError(err)}。改用離線設計師。`);
    return fallback();
  }
}

/** 整場弧線: per-song energy, palette emphasis and notes for the ordered setlist. */
export async function planShowArc(input: ArcInput, cb: DesignerCallbacks = {}, deps: DesignerDeps = {}): Promise<ShowArc> {
  const cbs = safeCallbacks(cb);
  throwIfAborted(cb.signal);
  const d = resolveDeps(deps);
  const now = d.now?.() ?? new Date();
  const fallback = offlineArc(input, now);
  if (!d.configured || input.songs.length === 0) {
    if (!d.configured) cbs.onLog("未設定 Claude，使用離線設計師依能量與順序排出整場弧線。");
    return fallback;
  }
  try {
    cbs.onLog(`Claude（${d.model}）開始規劃「${input.showName}」的整場弧線…`);
    const { raw, model } = await claudeStructured(
      { system: ARC_SYSTEM, prompt: buildArcPrompt(input, bibleBlock(input.bible, input.bandName)), schema: ArcDraftSchema, label: "整場弧線" },
      cbs,
      { transport: d.transport(), model: d.model, now: d.now },
    );
    return normalizeArc(raw, input, fallback, model, now);
  } catch (err) {
    if (isCancellation(err, cb.signal)) throw cb.signal?.aborted ? abortReason(cb.signal) : err;
    cbs.onLog(`Claude 無法規劃整場弧線：${describeError(err)}。改用離線設計師。`);
    return fallback;
  }
}
