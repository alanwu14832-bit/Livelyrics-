"use client";

import { SpinnerIcon } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import type { Project } from "@/lib/types";
import { IconBack } from "./icons";

function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-panel-2 ${className}`} />;
}

/** Layout-shaped placeholder while the project loads. */
export function ConsoleSkeleton() {
  return (
    <div className="flex h-screen min-w-[1280px] flex-col overflow-hidden bg-bg" aria-busy="true" aria-label="載入控制台中">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <Block className="h-6 w-20" />
        <Block className="h-8 w-56" />
        <div className="flex-1" />
        <Block className="h-8 w-32" />
        <Block className="h-8 w-28" />
        <Block className="h-8 w-40" />
        <Block className="h-8 w-32" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)_176px] gap-2 p-2">
        <Block className="h-full" />
        <div className="flex min-h-0 flex-col gap-2">
          <Block className="flex-1" />
          <Block className="h-28" />
        </div>
        <Block className="h-full" />
        <Block className="col-span-2 h-full" />
        <Block className="h-full" />
      </div>
      <p className="sr-only">載入中…</p>
    </div>
  );
}

function Centered({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-6 text-center shadow-2xl">
        <h1 className="text-lg font-semibold text-fg">{title}</h1>
        {children && <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>}
        {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const linkCls =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function NotFoundState({ id }: { id: string }) {
  return (
    <Centered
      title="找不到這個專案"
      actions={
        <Link href="/" className={`${linkCls} bg-accent text-white hover:brightness-110`}>
          <IconBack />
          回到專案庫
        </Link>
      }
    >
      <p>
        專案「<span className="font-mono text-fg">{id}</span>」不存在，可能已被刪除。
      </p>
    </Centered>
  );
}

export function LoadErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Centered
      title="無法載入專案"
      actions={
        <>
          <Button variant="primary" onClick={onRetry}>
            重試
          </Button>
          <Link href="/" className={`${linkCls} border border-line bg-panel-3 text-fg hover:bg-line`}>
            回到專案庫
          </Link>
        </>
      }
    >
      <p>{message}</p>
      <p className="mt-1 text-xs text-faint">請確認本機的 Livelyrics 伺服器仍在執行。</p>
    </Centered>
  );
}

export function NotReadyState({ project, onOpenAnyway }: { project: Project; onOpenAnyway: () => void }) {
  const processing = project.status === "processing";
  return (
    <Centered
      title={processing ? "這首歌還在處理中" : "這首歌還沒處理"}
      actions={
        <>
          <Link href={`/p/${encodeURIComponent(project.id)}/process`} className={`${linkCls} bg-accent text-white hover:brightness-110`}>
            {processing ? "查看處理進度" : "前往處理頁面"}
          </Link>
          <Button variant="secondary" onClick={onOpenAnyway}>
            仍要開啟控制台
          </Button>
        </>
      }
    >
      <p>
        「<span className="text-fg">{project.meta?.title || "未命名歌曲"}</span>」
        {processing ? "的研究與設計正在進行，完成後這裡會自動進入控制台。" : "需要先抓歌詞、研究與設計，才能得到完整的舞台視覺。"}
      </p>
      {processing && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
          <SpinnerIcon size={14} weight="bold" className="animate-spinner" aria-hidden="true" />
          處理中…
        </p>
      )}
    </Centered>
  );
}
