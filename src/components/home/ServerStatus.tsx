"use client";

// Server status on the home page (UI-AUDIT §3.5 首頁, UI-14). Offline is a normal, supported mode,
// so it is a quiet status and never a warning box:
//   - header (right slot): a quiet text button, 「離線設計模式」 + Info, or 「Claude 已連線」 with the
//     6 px green dot (the only green dot on the site); it opens the connect sheet / a model popover
//   - under the hero subtitle: one 13 px label-2 line with a plain 「連接 Claude」 link
//   - the connect sheet: the .env.local steps (code block) and 「重新檢查」
// A server that cannot be reached is a real error: a Banner with 「重試」.

import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Kbd, Popover, Sheet, Spinner, cx } from "@/components/ui";
import { CheckCircleIcon, CopyIcon, InfoIcon } from "@/components/ui/Icon";
import { api, type ServerStatus } from "@/lib/api-client";

export type ServerStatusState =
  | { kind: "loading" }
  | { kind: "ok"; status: ServerStatus }
  | { kind: "error"; message: string };

export function useServerStatus() {
  const [state, setState] = useState<ServerStatusState>({ kind: "loading" });
  const load = useCallback(() => {
    api
      .status()
      .then((status) => setState({ kind: "ok", status }))
      .catch((err: unknown) => setState({ kind: "error", message: err instanceof Error ? err.message : String(err) }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const reload = useCallback(() => {
    setState({ kind: "loading" });
    load();
  }, [load]);
  return { state, reload };
}

export const ENV_LINE = "ANTHROPIC_API_KEY=sk-ant-…";

/** Header right slot: one quiet status button. */
export function ServerStatusButton({ state, onRetry, onConnect }: { state: ServerStatusState; onRetry: () => void; onConnect: () => void }) {
  if (state.kind === "loading") {
    // holds the slot so the header does not shift when the status arrives
    return (
      <span aria-hidden="true" className="invisible inline-flex h-8 items-center px-3 text-[13px]">
        離線設計模式
      </span>
    );
  }
  const appear = "transition-opacity duration-(--dur-fast) ease-[ease] starting:opacity-0";
  if (state.kind === "error") {
    return (
      <Button variant="quiet" onClick={onRetry} className={cx("text-red-text! hover:text-red-text!", appear)} title={state.message}>
        無法連線到本機伺服器，重試
      </Button>
    );
  }
  if (!state.status.claude) {
    return (
      <Button variant="quiet" onClick={onConnect} trailingIcon={InfoIcon} className={appear} aria-haspopup="dialog">
        離線設計模式
      </Button>
    );
  }
  const { model } = state.status;
  return (
    <Popover
      label="Claude 已連線"
      placement="bottom-end"
      width={300}
      trigger={(p) => (
        <Button {...p} variant="quiet" className={appear}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-green" />
          Claude 已連線
        </Button>
      )}
    >
      <p className="text-[13px] leading-5 font-semibold text-label">研究與設計由 Claude 執行</p>
      <p className="mt-1 text-[13px] leading-5 text-label-2-on-material">
        Claude 會以樂團專職舞台視覺設計師的身分上網研究樂團與歌曲，再設計主視覺與每一段的畫面。
      </p>
      <p className="mt-3 text-[12px] leading-4 text-label-2-on-material">
        模型 <span className="font-mono text-label">{model}</span>
      </p>
    </Popover>
  );
}

/** The one quiet line under the hero subtitle (offline), or the error banner (server unreachable). */
export function ServerStatusLine({ state, onRetry, onConnect, className }: { state: ServerStatusState; onRetry: () => void; onConnect: () => void; className?: string }) {
  if (state.kind === "error") {
    return (
      <Banner
        tone="error"
        title="連不上 Livelyrics 本機伺服器"
        description={
          <>
            請確認終端機裡的 <code className="font-mono">npm run dev</code> 仍在執行。（{state.message}）
          </>
        }
        actions={<Button onClick={onRetry}>重試</Button>}
        className={cx("mx-auto max-w-[640px] text-left", className)}
      />
    );
  }
  const offline = state.kind === "ok" && !state.status.claude;
  // loading and connected keep the line's height, so the dropzone does not move
  return (
    <p className={cx("min-h-5 text-[13px] leading-5 text-label-2", className)} aria-live="polite">
      {offline && (
        <span className="transition-opacity duration-(--dur-fast) ease-[ease] starting:opacity-0">
          目前使用離線設計模式，不會上網研究樂團。
          <button type="button" onClick={onConnect} aria-haspopup="dialog" className="press-fade rounded-xs text-tint-text hover:underline hover:underline-offset-2">
            連接 Claude
          </button>
        </span>
      )}
    </p>
  );
}

function CodeLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.replace("…", ""));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2 rounded-sm bg-fill-3 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px] leading-5 text-label select-all">{text}</code>
      <Button size="sm" variant="gray" icon={copied ? CheckCircleIcon : CopyIcon} onClick={copy} aria-live="polite">
        {copied ? "已複製" : "複製"}
      </Button>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full bg-fill-3 text-[13px] leading-none font-semibold text-label tabular">
      {n}
    </span>
  );
}

/** 「連接 Claude」: the three steps to switch from the offline designer to Claude. */
export function ConnectClaudeSheet({ open, onClose, state, onRecheck }: { open: boolean; onClose: () => void; state: ServerStatusState; onRecheck: () => void }) {
  const [checked, setChecked] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setChecked(false);
  }
  const checking = state.kind === "loading";
  const connected = state.kind === "ok" && state.status.claude;
  const recheck = () => {
    setChecked(true);
    onRecheck();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="連接 Claude"
      cancelLabel="關閉"
      action={
        connected ? (
          <Button variant="filled" onClick={onClose}>
            完成
          </Button>
        ) : (
          <Button variant="filled" onClick={recheck} loading={checking}>
            重新檢查
          </Button>
        )
      }
    >
      <p className="text-[15px] leading-[22px] text-label">
        目前由內建的離線設計師依音訊能量與歌詞重複段落產生方案，不會上網研究。連接 Claude 後，會以樂團專職舞台視覺設計師的身分研究樂團與歌曲，再設計主視覺。
      </p>
      <ol className="mt-5 divide-y-hairline overflow-hidden rounded-lg bg-fill-4">
        <li className="flex gap-3 px-4 py-3">
          <StepNumber n={1} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-[22px] text-label">
              在專案根目錄的 <code className="font-mono text-[13px]">.env.local</code> 加入這一行
            </p>
            <CodeLine text={ENV_LINE} />
          </div>
        </li>
        <li className="flex gap-3 px-4 py-3">
          <StepNumber n={2} />
          <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">
            在執行伺服器的終端機按 <Kbd keys="Ctrl+C" className="align-[1px]" />，再執行 <code className="font-mono text-[13px]">npm run dev</code>
          </p>
        </li>
        <li className="flex gap-3 px-4 py-3">
          <StepNumber n={3} />
          <p className="min-w-0 flex-1 text-[15px] leading-[22px] text-label">回到這裡按「重新檢查」。</p>
        </li>
      </ol>
      <p className="mt-3 min-h-5 text-[13px] leading-5" aria-live="polite">
        {checked && checking && <Spinner label="檢查中…" />}
        {checked && connected && (
          <span className="inline-flex items-center gap-1.5 text-label">
            <CheckCircleIcon size={16} weight="fill" className="text-green" />
            Claude 已連線，接下來的作品會由 Claude 研究與設計。
          </span>
        )}
        {checked && state.kind === "ok" && !connected && <span className="text-label-2">仍是離線設計模式。確認金鑰已存檔，並重新啟動伺服器。</span>}
        {checked && state.kind === "error" && <span className="text-red-text">連不上本機伺服器：{state.message}</span>}
      </p>
    </Sheet>
  );
}
