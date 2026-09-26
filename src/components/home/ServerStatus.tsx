"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, cx } from "@/components/ui";
import { api, type ServerStatus } from "@/lib/api-client";
import { AlertIcon, InfoIcon, RefreshIcon } from "./icons";

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

export function ServerStatusPill({ state, onRetry }: { state: ServerStatusState; onRetry: () => void }) {
  if (state.kind === "loading") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted" role="status">
        <span className="size-2 animate-pulse rounded-full bg-faint" />
        檢查伺服器…
      </span>
    );
  }
  if (state.kind === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-full border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger hover:bg-danger/20 focus-visible:outline-2 focus-visible:outline-accent"
        title={state.message}
      >
        <span className="size-2 rounded-full bg-danger" />
        無法連線到本機伺服器 · 重試
      </button>
    );
  }
  const { claude, model } = state.status;
  return (
    <span
      role="status"
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
        claude ? "border-ok/30 bg-ok/10 text-ok" : "border-warn/35 bg-warn/10 text-warn",
      )}
      title={claude ? `研究與設計由 ${model} 執行` : "未設定 ANTHROPIC_API_KEY，使用內建離線設計師"}
    >
      <span className={cx("size-2 rounded-full", claude ? "bg-ok shadow-[0_0_8px] shadow-ok/70" : "bg-warn")} />
      {claude ? (
        <>
          Claude 已連線
          <span className="font-mono text-[11px] text-ok/80">{model}</span>
        </>
      ) : (
        "離線設計模式"
      )}
    </span>
  );
}

/** Explains the offline designer and how to connect Claude; shown only when Claude is not configured. */
export function OfflineNotice({ state, onRetry }: { state: ServerStatusState; onRetry: () => void }) {
  if (state.kind === "error") {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/35 bg-danger/[0.07] px-4 py-3 text-sm">
        <AlertIcon className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-fg">連不上 Livelyrics 本機伺服器</p>
          <p className="mt-0.5 text-muted">
            請確認終端機裡的 <code className="rounded bg-panel-3 px-1 font-mono text-xs">npm run dev</code> 仍在執行。（{state.message}）
          </p>
        </div>
        <Button size="sm" onClick={onRetry}>
          <RefreshIcon size={14} />
          重試
        </Button>
      </div>
    );
  }
  if (state.kind !== "ok" || state.status.claude) return null;
  const code = "rounded bg-panel-3 px-1 py-px font-mono text-[12px] text-fg";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warn/30 bg-warn/[0.06] px-4 py-3 text-sm">
      <InfoIcon className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1 leading-6">
        <p className="text-fg">
          <span className="font-medium">目前是離線設計模式</span>
          <span className="text-muted">：內建設計師會依音訊能量與歌詞重複段落產生方案，但不會上網研究樂團與歌曲。</span>
        </p>
        <p className="text-muted">
          要讓 Claude 以樂團專職舞台視覺設計師的身分研究與設計：在專案根目錄的 <code className={code}>.env.local</code> 加入{" "}
          <code className={code}>ANTHROPIC_API_KEY=sk-ant-…</code>，再到終端機按 <code className={code}>Ctrl+C</code> 並重新執行{" "}
          <code className={code}>npm run dev</code>。
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={onRetry} title="重新檢查伺服器狀態">
        <RefreshIcon size={14} />
        重新檢查
      </Button>
    </div>
  );
}
