"use client";

// 用 claude.ai 研究 / 用 claude.ai 提案 (manual Claude mode, no API cost): a Sheet with the four steps.
//   1. 複製提示詞: the server builds one complete prompt (完整版／精簡版, SegmentedControl); a read-only
//      text area shows it and 「複製提示詞」 copies it (clipboard, else the selected text).
//   2. 打開 claude.ai (https://claude.ai/new) and paste it; attach the mood board images (圖 n, each
//      opens in a new tab so it can be saved or dragged in) and turn on web search.
//   3. Paste Claude's whole reply back (a byte counter, 200 KB at most).
//   4. 「套用」 (the sheet's primary action): the server re-validates it. Problems come back as a
//      red Banner with every issue and 「複製修正提示詞」 for the same chat; success shows what was
//      repaired, what LED 安全模式 changes, 「進入控制台」 (a plan) and 「復原」.
// The pasted text is only ever sent to our own API as a string: nothing here evaluates it.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Banner, Button, SegmentedControl, Spinner, TextArea, buttonClasses, cx, Sheet } from "@/components/ui";
import { ArrowCounterClockwiseIcon, ArrowSquareOutIcon, CheckCircleIcon, CopyIcon, MonitorPlayIcon } from "@/components/ui/Icon";
import { PUSH } from "@/components/home/transitions";
import { api, MANUAL_REPLY_MAX_BYTES, type ManualApplyResult, type ManualPromptResult, type ManualTarget } from "@/lib/api-client";
import type { Project } from "@/lib/types";

export const CLAUDE_NEW_CHAT_URL = "https://claude.ai/new";

type Variant = "full" | "compact";

function StepNumber({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full bg-fill-3 text-[13px] leading-none font-semibold text-label tabular">
      {n}
    </span>
  );
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Copy text: the async clipboard, else the old selection copy (http:// LAN pages, some browsers). */
async function copyText(text: string, fallback?: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = fallback ?? document.createElement("textarea");
    const temporary = !fallback;
    if (temporary) {
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
    }
    try {
      el.focus();
      el.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      if (temporary) el.remove();
    }
  }
}

function useCopied(): [string | null, (key: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const mark = useCallback((key: string) => {
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1800);
  }, []);
  return [copied, mark];
}

export function ManualClaudeSheet({
  open,
  onClose,
  project,
  target,
  instruction,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  target: ManualTarget;
  /** 提出設計方向's typed request, carried into the prompt */
  instruction?: string;
  onApplied: (project: Project) => void;
}) {
  const [variant, setVariant] = useState<Variant>("full");
  const [prompts, setPrompts] = useState<Partial<Record<Variant, ManualPromptResult>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ManualApplyResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [keptBrief, setKeptBrief] = useState<string | undefined>(undefined);
  const [undone, setUndone] = useState(false);
  const [copied, markCopied] = useCopied();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const replyId = useId();
  const promptId = useId();
  const plan = target === "plan";
  const projectId = project.id;

  // a new opening starts over (the prompt is rebuilt: lyrics, research or the mood board may have changed)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPrompts({});
      setLoadError(null);
      setResult(null);
      setRequestError(null);
      setUndone(false);
    }
  }

  const current = prompts[variant];
  useEffect(() => {
    if (!open || current) return;
    let cancelled = false;
    api
      .manualPrompt(projectId, { target, compact: variant === "compact", instruction: instruction?.trim() || undefined })
      .then((p) => {
        if (!cancelled) setPrompts((all) => ({ ...all, [variant]: p }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, current, projectId, target, variant, instruction]);

  // the outcome sits under the paste area: bring it into view
  useEffect(() => {
    if (result || requestError) resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [result, requestError]);

  const bytes = utf8Length(reply);
  const tooBig = bytes > MANUAL_REPLY_MAX_BYTES;

  const apply = async () => {
    if (!reply.trim() || tooBig) return;
    setApplying(true);
    setRequestError(null);
    setUndone(false);
    try {
      const res = await api.manualApply(projectId, { target, reply, brief: keptBrief });
      setResult(res);
      if (res.ok) {
        setKeptBrief(undefined);
        onApplied(res.project);
      } else if (res.brief) setKeptBrief(res.brief);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const undo = async () => {
    try {
      const res = await api.directions(projectId, { action: "undo" });
      onApplied(res.project);
      setUndone(true);
    } catch (err) {
      setRequestError(`復原失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const copyPrompt = async () => {
    if (current && (await copyText(current.prompt, promptRef.current))) markCopied("prompt");
  };
  const copyFix = async (text: string) => {
    if (await copyText(text)) markCopied("fix");
  };

  const images = current?.images ?? prompts.full?.images ?? prompts.compact?.images ?? [];
  const imageUrl = (n: number) => {
    const board = [...(project.bandMoodboard ?? []).map((m) => ({ ...m, band: true })), ...(project.moodboard ?? []).filter((m) => !(project.bandMoodboard ?? []).some((b) => b.id === m.id)).map((m) => ({ ...m, band: false }))];
    const m = board[n - 1];
    if (!m) return null;
    return m.band && project.bandId ? api.moodImageUrl({ kind: "band", id: project.bandId }, m.id) : api.moodImageUrl({ kind: "project", id: projectId }, m.id);
  };
  const success = result?.ok ? result : null;
  const failure = result && !result.ok ? result : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={plan ? "用 claude.ai 研究" : "用 claude.ai 提案"}
      width={640}
      cancelLabel={success ? null : "取消"}
      dismissible={!applying}
      action={
        success ? (
          <Button variant="filled" onClick={onClose}>
            完成
          </Button>
        ) : (
          <Button variant="filled" onClick={() => void apply()} loading={applying} disabled={!reply.trim() || tooBig} data-testid="manual-apply">
            套用
          </Button>
        )
      }
    >
      <div data-testid="manual-sheet" className="flex flex-col gap-4">
        <p className="text-[15px] leading-[22px] text-label">
          不用 API 金鑰：用你自己的 claude.ai 帳號，讓 Claude 上網研究{artistOrBand(project)}，{plan ? "設計主視覺與每一段的畫面" : "提出 2 到 3 個設計方向"}。Livelyrics 已把這首歌的歌詞、音訊分析、免費研究的發現與
          {project.bandId ? "樂團視覺聖經" : "舞台限制"}整理成一份提示詞，Claude 回覆後貼回來就會套用。
        </p>

        <ol className="divide-y-hairline overflow-hidden rounded-lg bg-fill-4" aria-label="步驟">
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={1} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] leading-[22px] font-semibold text-label">複製提示詞</p>
                <SegmentedControl
                  label="提示詞版本"
                  value={variant}
                  onChange={setVariant}
                  options={[
                    { value: "full", label: "完整版" },
                    { value: "compact", label: "精簡版" },
                  ]}
                />
              </div>
              <p className="mt-0.5 text-[13px] leading-5 text-label-2">
                {variant === "compact" ? "精簡版只列每段歌詞的開頭，也請 Claude 寫短一點；免費版額度不夠或回覆被截斷時使用。" : "完整的歌詞、能量曲線、免費研究與設計規範。"}
              </p>
              {loadError ? (
                <Banner tone="error" title="無法產生提示詞" description={loadError} className="mt-2 bg-fill-3!" actions={<Button onClick={() => { setLoadError(null); setPrompts({}); }}>重試</Button>} />
              ) : current ? (
                <>
                  <TextArea
                    ref={promptRef}
                    id={promptId}
                    readOnly
                    rows={5}
                    value={current.prompt}
                    aria-label="提示詞"
                    data-testid="manual-prompt"
                    onFocus={(e) => e.currentTarget.select()}
                    className="mt-2 block text-[12px]! leading-[18px]!"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Button variant="tinted" icon={copied === "prompt" ? CheckCircleIcon : CopyIcon} onClick={() => void copyPrompt()} data-testid="manual-copy" aria-live="polite">
                      {copied === "prompt" ? "已複製" : "複製提示詞"}
                    </Button>
                    <span className="text-[12px] leading-4 text-label-2 tabular">約 {current.chars.toLocaleString("zh-TW")} 字</span>
                    {current.long && variant === "full" && <span className="text-[12px] leading-4 text-orange-text">提示詞很長：如果免費版的回覆被截斷，改用精簡版。</span>}
                  </div>
                </>
              ) : (
                <p className="mt-2 min-h-8 text-[13px] leading-5">
                  <Spinner label="正在整理提示詞…" />
                </p>
              )}
            </div>
          </li>
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={2} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-[22px] font-semibold text-label">打開 claude.ai，貼上提示詞送出</p>
              <p className="mt-0.5 text-[13px] leading-5 text-label-2">開一個新的對話貼上。看得到「網頁搜尋」（Search）的話請打開，Claude 才能上網研究樂團。</p>
              {images.length > 0 && (
                <div className="mt-2 text-[13px] leading-5 text-label">
                  <p>
                    記得附上 {images.length} 張參考圖（依圖號順序；點圖名可以開啟、另存或拖進 claude.ai）：
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="要附上的參考圖">
                    {images.map((img) => {
                      const url = imageUrl(img.n);
                      return (
                        <li key={img.n}>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer noopener" className="press-fade inline-flex h-7 items-center gap-1 rounded-pill bg-fill-3 px-3 text-[12px] leading-none font-medium text-label hover:bg-fill-2" title={img.note}>
                              圖 {img.n}：{img.name}
                              <ArrowSquareOutIcon size={12} className="text-label-2" />
                            </a>
                          ) : (
                            <span className="inline-flex h-7 items-center rounded-pill bg-fill-3 px-3 text-[12px] leading-none font-medium text-label">
                              圖 {img.n}：{img.name}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <a
                href={CLAUDE_NEW_CHAT_URL}
                target="_blank"
                rel="noreferrer noopener"
                className={cx(buttonClasses({ variant: "gray" }).className, "mt-2")}
                data-testid="manual-open-claude"
              >
                打開 claude.ai
                <ArrowSquareOutIcon size={16} />
              </a>
            </div>
          </li>
          <li className="flex gap-3 px-4 py-3">
            <StepNumber n={3} />
            <div className="min-w-0 flex-1">
              <label htmlFor={replyId} className="block text-[15px] leading-[22px] font-semibold text-label">
                把 Claude 的整段回覆貼回來
              </label>
              <p className="mt-0.5 text-[13px] leading-5 text-label-2">用回覆下方的「複製」按鈕複製整則回覆（研究簡報和 JSON 都要），貼到這裡，再按右上角的「套用」。</p>
              <TextArea
                id={replyId}
                rows={7}
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                  if (result && !result.ok) setResult(null);
                }}
                placeholder={"## 樂團視覺識別\n…\n```json\n{ … }\n```"}
                invalid={tooBig}
                spellCheck={false}
                data-testid="manual-reply"
                className="mt-2 block text-[12px]! leading-[18px]!"
              />
              <p className={cx("mt-1 text-right text-[12px] leading-4 tabular", tooBig ? "text-red-text" : "text-label-2")} aria-live="polite">
                {tooBig ? `超過 ${kb(MANUAL_REPLY_MAX_BYTES)}：請只貼 Claude 的這一則回覆` : `${kb(bytes)}／${kb(MANUAL_REPLY_MAX_BYTES)}`}
              </p>
            </div>
          </li>
        </ol>

        <div ref={resultRef} className="flex scroll-mb-4 flex-col gap-4 empty:hidden">
        {requestError && <Banner tone="error" title="沒有完成" description={requestError} animateIn className="bg-fill-4!" />}

        {failure && (
          <section data-testid="manual-error" aria-live="polite" className="rounded-lg bg-fill-4 px-4 py-3.5">
            <Banner tone="error" title={`${failure.error}：還不能套用`} className="bg-transparent! p-0!" description="這些問題請 Claude 修正：" />
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-5 text-label marker:text-label-2">
              {failure.issues.slice(0, 12).map((issue, i) => (
                <li key={i} className={cx("break-words", issue.severity === "warning" && "text-label-2")}>
                  {issue.message}
                </li>
              ))}
              {failure.issues.length > 12 && <li className="text-label-2">另外還有 {failure.issues.length - 12} 個問題（都在修正提示詞裡）</li>}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button variant="tinted" icon={copied === "fix" ? CheckCircleIcon : CopyIcon} onClick={() => void copyFix(failure.fixPrompt)} data-testid="manual-fix-copy" aria-live="polite">
                {copied === "fix" ? "已複製" : "複製修正提示詞"}
              </Button>
              <span className="min-w-0 flex-1 basis-60 text-[12px] leading-4 text-label-2">
                貼到同一個 claude.ai 對話，再把新的回覆貼到上面、按「套用」。{failure.brief ? "研究簡報已經收到，這次只要 JSON 就可以。" : ""}
                {failure.error === "回覆被截斷了" && variant === "full" ? "也可以改用精簡版重新開始。" : ""}
              </span>
            </div>
          </section>
        )}

        {success && (
          <section data-testid="manual-success" aria-live="polite" className="rounded-lg bg-fill-4 px-4 py-3.5">
            <Banner
              tone="success"
              className="bg-transparent! p-0!"
              title={undone ? "已復原成套用前的設計方案" : plan ? "已套用 claude.ai 的設計方案" : `已加入 ${success.project.directions?.directions.length ?? 0} 個設計方向`}
              description={
                undone
                  ? "claude.ai 的回覆還在上面，需要時可以再按一次「套用」。"
                  : plan
                    ? `主視覺「${success.project.plan?.keyVisual.title ?? ""}」${success.research ? "，研究簡報也已更新" : ""}。控制台已經可以使用。`
                    : `${success.research ? "研究簡報也已更新。" : ""}和樂團一起看，採用一個成為設計方案。`
              }
            />
            {success.notes.length > 0 && !undone && (
              <details className="mt-2 text-[13px] leading-5">
                <summary className="cursor-default text-label-2 select-none hover:text-label">自動修正了 {success.notes.length} 處</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-label-2">
                  {success.notes.slice(0, 20).map((n, i) => (
                    <li key={i} className="break-words">
                      {n}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {success.safety.length > 0 && !undone && (
              <details className="mt-1 text-[13px] leading-5">
                <summary className="cursor-default text-label-2 select-none hover:text-label">LED 安全模式在現場會調整 {success.safety.length} 處</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-label-2">
                  {success.safety.slice(0, 20).map((n, i) => (
                    <li key={i} className="break-words">
                      {n}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {plan && (
              <div className="mt-3 flex flex-wrap gap-2">
                {!undone && (
                  <Button href={`/p/${encodeURIComponent(projectId)}`} transitionTypes={PUSH} variant="filled" icon={MonitorPlayIcon} data-testid="manual-console">
                    進入控制台
                  </Button>
                )}
                {!undone && success.project.previousPlan && (
                  <Button variant="gray" icon={ArrowCounterClockwiseIcon} onClick={() => void undo()}>
                    復原
                  </Button>
                )}
              </div>
            )}
          </section>
        )}
        </div>
      </div>
    </Sheet>
  );
}

function artistOrBand(project: Project): string {
  const artist = project.meta.artist?.trim();
  const title = project.meta.title?.trim();
  if (artist && title) return `「${artist}」與〈${title}〉`;
  if (title) return `〈${title}〉`;
  return "這首歌";
}
