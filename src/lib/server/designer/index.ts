// DESIGNER module: the AI stage-visual designer.
//
// researchSong — Claude (web search) researches the band and song as the band's
//                dedicated stage-visual director and writes a 繁中 Markdown brief.
// designSong   — a second Claude call with structured outputs produces the DesignPlan
//                (key visual, per-section scene + lyric presentation, cue notes).
//
// Both never throw for Claude problems: without a credential, or on any Claude error,
// refusal or unusable output, they fall back — research to 免費研究 (public facts from MusicBrainz
// and Wikipedia plus the local lyric and audio analysis, free-research.ts), design to the
// deterministic offline designer driven by those findings — and explain why through cb.onLog.
// Only cancellation (cb.signal) propagates.

import Anthropic from "@anthropic-ai/sdk";
import { formatTimeShort } from "@/lib/timeline";
import { coerceBible, sanitizeFonts } from "@/lib/band";
import type { BandBible, DesignPlan, DirectionSet, Research, SceneProgram, ShowArc } from "@/lib/types";
import { applyArc, ARC_SYSTEM, ArcDraftSchema, buildArcPrompt, normalizeArc, offlineArc, type ArcInput } from "./arc";
import { BIBLE_SYSTEM, BibleDraftSchema, buildBiblePrompt, offlineBible, type BibleInput } from "./bible";
import { bibleBlock } from "./prompts";
import { buildDirections, buildDirectionsPrompt, DirectionDraftSchema, DIRECTIONS_SYSTEM, directionsSummary, normalizeDirectionDrafts, offlineDirectionSpecs } from "./directions";
import { visionContent } from "./moodboard";
import { collectedVisionContent } from "./collected";
import { claudeStructured } from "./structured";
import { LYRIC_STYLES, SCENES } from "./catalog";
import { claudeDesign, claudeResearch, clientOptions, sdkTransport, type ClaudeTransport } from "./claude";
import { applyInstruction } from "./instruction";
import { describeError } from "./messages";
import { backupModelName, withRetries, type RetryOptions } from "./retry";
import { hasApiKey, storedApiKey } from "@/lib/server/api-key";
import { normalizePlan } from "./normalize";
import { offlineDesign } from "./offline";
import { freeResearch, type FreeResearchOptions } from "./free-research";
import type { FetchLike } from "@/lib/server/research/http";
import { safeCallbacks, type DesignerCallbacks, type DesignerInput, type DesignRequest } from "./types";
import { buildScenePrompt, ensureSceneProgram, offlineSceneProgram, programFromDraft, SCENE_SYSTEM, SceneProgramDraftSchema } from "./scene-program";

export type { DesignerCallbacks, DesignerInput, DesignRequest } from "./types";
export { normalizePlan } from "./normalize";
export { offlineDesign, offlineResearch } from "./offline";
export { offlineSceneProgram, composerSalt, ensureSceneProgram, buildScenePrompt, SCENE_SYSTEM, SceneProgramDraftSchema } from "./scene-program";
export { freeResearch, freeBrief, freeSources } from "./free-research";
export { analyzeFindings, type Findings } from "./findings";
export { sanitizeSvg, generateMotifSvg } from "./svg";
export { offlineBible, type BibleInput, type BibleSong } from "./bible";
export { offlineArc, applyArc, type ArcInput, type ArcSong } from "./arc";
export { offlineDirectionSpecs, expandDirection, buildDirections, normalizeDirectionDrafts, type DirectionSpec } from "./directions";
export type { VisionImage } from "./moodboard";

/** true when an Anthropic credential is configured (otherwise the offline designer is used) */
export function isClaudeConfigured(): boolean {
  // the server's environment, or the key saved through 「設定」 (local mode; the environment wins)
  return hasApiKey();
}

export function modelName(): string {
  return process.env.LIVELYRICS_MODEL?.trim() || "claude-sonnet-5-5";
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
  /** the free research's HTTP (tests pass a fake: tests never reach MusicBrainz or Wikipedia) */
  fetch?: FetchLike;
  /** free-research lookup overrides (environment, budget, MusicBrainz spacing) */
  lookup?: FreeResearchOptions["lookup"];
  /**
   * Retries of transient Claude failures (5xx / overloaded). On by default for the real SDK transport;
   * an injected transport gets none unless this is set.
   */
  retry?: Omit<RetryOptions, "onLog"> | false;
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

let sharedTransport: { key: string | null; transport: ClaudeTransport } | null = null;
function defaultTransport(): ClaudeTransport {
  // created lazily: the SDK reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from the environment;
  // without them the key saved through 「設定」 is passed in (a new client when it changes)
  const stored = storedApiKey();
  if (!sharedTransport || sharedTransport.key !== stored) {
    sharedTransport = { key: stored, transport: sdkTransport(new Anthropic({ ...clientOptions(), ...(stored ? { apiKey: stored } : {}) })) };
  }
  return sharedTransport.transport;
}

function resolveDeps(deps: DesignerDeps) {
  const budget = deps.timeoutMs != null && deps.timeoutMs > 0 ? deps.timeoutMs : null;
  // the deadline starts with the designer call, so continuations share one budget
  const deadline = budget != null ? Date.now() + budget : null;
  const configured = deps.configured ?? isClaudeConfigured();
  return {
    configured,
    /** a key is set but this call was asked not to use it (免費研究 chosen for this run) */
    optedOut: !configured && deps.configured === false && isClaudeConfigured(),
    model: deps.model ?? modelName(),
    /** a fresh transport per step: the deadline, then retries (a backup model sticks for that step only) */
    transport: (onLog?: (message: string) => void) => {
      const t = deps.transport ?? defaultTransport();
      const timed = deadline != null && budget != null ? withDeadline(t, deadline, Math.max(1, Math.round(budget / 1000))) : t;
      const retry = deps.retry ?? (deps.transport ? false : { backupModel: backupModelName() });
      return retry ? withRetries(timed, { ...retry, onLog }) : timed;
    },
    now: deps.now,
    free: { fetch: deps.fetch, now: deps.now, lookup: deps.lookup } satisfies FreeResearchOptions,
  };
}

/**
 * Research the band and song as a dedicated stage-visual designer would: Claude with web search when
 * configured, else 免費研究. Never throws for Claude failures: falls back to 免費研究.
 */
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
    cbs.onLog(
      `${d.optedOut ? "這次不呼叫 Claude API" : "沒有 Anthropic API 金鑰"}，改用免費研究：查詢 MusicBrainz 與維基百科的公開資料，再分析歌詞意象與音訊，不使用 API。`,
    );
    return freeResearch(input, tracked, d.free);
  }
  try {
    cbs.onLog(`Claude（${d.model}）開始研究「${input.meta?.artist || "樂團"}」與〈${input.meta?.title || "這首歌"}〉…`);
    return await claudeResearch(input, tracked, { transport: d.transport(cbs.onLog), model: d.model, now: d.now });
  } catch (err) {
    if (isCancellation(err, cb.signal)) throw cb.signal?.aborted ? abortReason(cb.signal) : err;
    const why = describeError(err);
    cbs.onLog(`Claude 研究失敗：${why}。改用免費研究。`);
    return freeResearch(input, tracked, { ...d.free, reason: `Claude 研究失敗（${why}）`, afterPartial: streamed });
  }
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
  const previous = req.previous ? normalizePlan(req.previous, req, { typeSystem: "keep" }) : null;

  if (previous && (instruction || (claudeFailed && !req.arc))) {
    if (instruction) {
      const { plan, changes } = applyInstruction(previous, instruction, req);
      if (changes.length) {
        cb.onLog(`離線設計師依指示調整目前的方案：${changes.join("；")}`);
        cb.onDelta(planSummary(plan));
        return plan;
      }
      cb.onLog("離線設計師看不懂這個指示，保留目前的設計。在首頁的「設定」加入 Anthropic API 金鑰後，就能用一句話重新設計。");
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
    cbs.onLog(
      `${d.optedOut ? "這次不呼叫 Claude API" : "沒有 Anthropic API 金鑰"}，使用離線設計師：依免費研究的發現（曲風的視覺語法、歌詞意象與情緒、音訊情緒）、段落結構與能量產生方案。`,
    );
    return ensureSceneProgram(req, offlinePath(req, cbs, false));
  }
  try {
    cbs.onLog(`Claude（${d.model}）開始${req.instruction?.trim() ? "依指示重新" : ""}設計主視覺與段落…`);
    const { plan, repairs, model } = await claudeDesign(req, cbs, { transport: d.transport(cbs.onLog), model: d.model, now: d.now });
    if (repairs.length) cbs.onLog(`已自動修正方案：${repairs.slice(0, 5).join("；")}${repairs.length > 5 ? "…" : ""}`);
    cbs.onLog(`設計完成（${model}）：主視覺「${plan.keyVisual.title}」，${plan.sections.length} 個段落、${plan.cues.length} 個操作提示`);
    return ensureSceneProgram(req, plan);
  } catch (err) {
    if (isCancellation(err, cb.signal)) throw cb.signal?.aborted ? abortReason(cb.signal) : err;
    const why = describeError(err);
    cbs.onLog(`Claude 設計失敗：${why}。改用離線設計師。`);
    return ensureSceneProgram(req, offlinePath(req, cbs, true));
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
      transport: d.transport(cbs.onLog),
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
      { transport: d.transport(cbs.onLog), model: d.model, now: d.now },
    );
    return normalizeArc(raw, input, fallback, model, now);
  } catch (err) {
    if (isCancellation(err, cb.signal)) throw cb.signal?.aborted ? abortReason(cb.signal) : err;
    cbs.onLog(`Claude 無法規劃整場弧線：${describeError(err)}。改用離線設計師。`);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// 提出設計方向 (phase 4)
// ---------------------------------------------------------------------------

/**
 * 2–3 distinct design directions for the song, each expanded to a full plan. One Claude
 * structured-output call (mood board images as vision input) when configured, the offline
 * directions otherwise or on any failure / timeout. Never throws for Claude problems.
 */
export async function proposeDirections(req: DesignRequest, cb: DesignerCallbacks = {}, deps: DesignerDeps = {}): Promise<DirectionSet> {
  const cbs = safeCallbacks(cb);
  throwIfAborted(cb.signal);
  const d = resolveDeps(deps);
  const now = (d.now?.() ?? new Date()).toISOString();
  const offline = offlineDirectionSpecs(req);
  const offlineSet = (): DirectionSet => {
    const directions = buildDirections(offline, req, { engine: "offline", now });
    cbs.onDelta(directionsSummary(directions));
    return { engine: "offline", createdAt: now, directions };
  };
  if (!d.configured) {
    cbs.onLog(`${d.optedOut ? "這次不呼叫 Claude API" : "未設定 Claude"}，使用離線設計師提出三個方向：冷暖、飽和與黑白三個軸線各一個，並依這首歌的曲風、意象與情緒調整。`);
    return offlineSet();
  }
  try {
    const mood = visionContent(req.moodboard, req.moodboardImages);
    const found = collectedVisionContent(req.collected, req.collectedImages);
    const images = [...mood, ...found];
    const seen = [mood.length ? `${mood.length / 2} 張參考圖` : "", found.length ? `${found.length / 2} 張研究找到的素材` : ""].filter(Boolean).join("與");
    cbs.onLog(`Claude（${d.model}）開始提出設計方向${seen ? `，參考 ${seen}` : ""}…`);
    const { raw, model } = await claudeStructured(
      { system: DIRECTIONS_SYSTEM, prompt: buildDirectionsPrompt(req), schema: DirectionDraftSchema, label: "設計方向", before: images, effort: "medium", maxTokens: 16_000 },
      cbs,
      { transport: d.transport(cbs.onLog), model: d.model, now: d.now },
    );
    const specs = normalizeDirectionDrafts(raw, req, offline);
    const directions = buildDirections(specs, req, { engine: "claude", model, now });
    cbs.onDelta(directionsSummary(directions));
    cbs.onLog(`提出 ${directions.length} 個方向（${model}）：${directions.map((x) => `${x.letter}「${x.name}」`).join("、")}`);
    return { engine: "claude", model, createdAt: now, directions };
  } catch (err) {
    if (isCancellation(err, cb.signal)) throw cb.signal?.aborted ? abortReason(cb.signal) : err;
    cbs.onLog(`Claude 無法提出設計方向：${describeError(err)}。改用離線設計師。`);
    return offlineSet();
  }
}

// ---------------------------------------------------------------------------
// 專屬畫面 (phase 7)
// ---------------------------------------------------------------------------

export interface SceneProgramResult {
  program: SceneProgram;
  engine: "claude" | "offline";
  model?: string;
}

/**
 * The song's own scene program for `plan`: Claude (one structured-output call under the same budget
 * rules as the designer; a program the validator refuses gets one repair turn) when configured,
 * else — or on any failure — the offline composer (`salt` draws another composition). Never throws
 * for Claude problems; only cancellation propagates.
 */
export async function designSceneProgram(req: DesignRequest, plan: DesignPlan, cb: DesignerCallbacks = {}, deps: DesignerDeps = {}, opts: { salt?: number } = {}): Promise<SceneProgramResult> {
  const cbs = safeCallbacks(cb);
  throwIfAborted(cb.signal);
  const d = resolveDeps(deps);
  const previous = plan.sceneProgram ?? null;
  const offline = (why: string): SceneProgramResult => {
    const program = offlineSceneProgram(req, plan, opts.salt ?? 0);
    cbs.onLog(`${why}離線作曲器產生專屬畫面「${program.title}」：${program.concept.slice(0, 60)}…`);
    cbs.onDelta(`### 專屬畫面「${program.title}」\n\n${program.concept}\n`);
    return { program: previous?.enabled === false ? { ...program, enabled: false } : program, engine: "offline" };
  };
  if (!d.configured) return offline(`${d.optedOut ? "這次不呼叫 Claude API" : "未設定 Claude"}，`);
  const now = d.now?.() ?? new Date();
  const instruction = req.instruction?.trim() || undefined;
  try {
    cbs.onLog(`Claude（${d.model}）開始寫這首歌的專屬畫面${instruction ? "（依指示）" : ""}…`);
    const editing = previous && (previous.engine === "claude" || previous.engine === "manual") && instruction ? previous : null;
    // phase 8: the band's real material (cover, MV stills, key visual) as vision input
    const images = [...visionContent(req.moodboard, req.moodboardImages), ...collectedVisionContent(req.collected, req.collectedImages)];
    const run = async (errors?: string[]) =>
      claudeStructured(
        { system: SCENE_SYSTEM, prompt: buildScenePrompt(req, plan, { errors, previous: editing }), schema: SceneProgramDraftSchema, label: "專屬畫面", effort: "high", maxTokens: 32_000, ...(images.length ? { before: images } : {}) },
        cbs,
        { transport: d.transport(), model: d.model, now: d.now },
      );
    let { raw, model } = await run();
    let made = programFromDraft(raw, plan, { model, instruction, now });
    if (!made.program) {
      cbs.onLog(`Claude 的程式沒有通過檢查（${made.errors.slice(0, 3).join("；")}），請它修正一次…`);
      ({ raw, model } = await run(made.errors));
      made = programFromDraft(raw, plan, { model, instruction, now });
    }
    if (!made.program) return offline(`Claude 的程式仍然沒有通過檢查（${made.errors.slice(0, 2).join("；")}），改用`);
    const program = previous?.enabled === false ? { ...made.program, enabled: false } : made.program;
    cbs.onDelta(`### 專屬畫面「${program.title}」\n\n${program.concept}\n`);
    cbs.onLog(`專屬畫面完成（${model}）：「${program.title}」，${program.sections.length} 個段落的狀態`);
    return { program, engine: "claude", model };
  } catch (err) {
    if (isCancellation(err, cb.signal)) throw cb.signal?.aborted ? abortReason(cb.signal) : err;
    return offline(`Claude 無法寫專屬畫面：${describeError(err)}。改用`);
  }
}
