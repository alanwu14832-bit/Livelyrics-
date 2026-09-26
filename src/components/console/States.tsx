"use client";

// Console loading, not-ready, not-found and error states. All render inside the page's
// data-theme="console" wrapper, so they are dark from the first paint. The skeleton has the
// console's shape (static blocks that only appear after 300 ms) and already shows the song's
// thumbnail and title when the server knows them, under the same view-transition names as the
// library card, so the card morphs into the top bar across the navigation.

import type { ReactNode } from "react";
import { AppHeader, BackLink, Button, EmptyState, Skeleton, SkeletonGroup, Spinner, cx } from "@/components/ui";
import { NOT_FOUND_HEADER_TITLE, ProjectNotFound } from "@/components/home/ProjectNotFound";
import { MusicNotesIcon, WarningCircleIcon } from "@/components/ui/Icon";
import type { Project } from "@/lib/types";
import type { ConsoleIntro } from "./ConsoleApp";
import { TitleBlock } from "./TopBar";

function PaneSkeleton({ area, className, lines = 0, children }: { area: string; className?: string; lines?: number; children?: ReactNode }) {
  return (
    <div className={cx("flex min-h-0 flex-col gap-3 overflow-hidden rounded-lg bg-surface p-3", className)} style={{ gridArea: area }}>
      {children}
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3 rounded-xs" style={{ width: `${[72, 88, 64, 80, 56, 76][i % 6]}%` }} />
      ))}
    </div>
  );
}

/** Layout-shaped placeholder while the project loads. */
export function ConsoleSkeleton({ id, intro }: { id: string; intro: ConsoleIntro | null }) {
  return (
    <SkeletonGroup label="載入控制台中" className="flex h-screen min-w-[1280px] flex-col overflow-hidden bg-bg">
      <header className="relative z-20 grid h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 bg-surface px-(--header-gutter) border-b-hairline" style={{ viewTransitionName: "app-header" }}>
        <div className="flex min-w-0 items-center gap-3">
          <BackLink />
          {intro ? <TitleBlock id={id} title={intro.title} palette={intro.palette} subtitle={intro.artist || undefined} /> : <Skeleton className="h-7 w-44 rounded-sm" />}
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-7 w-[136px] rounded-sm" />
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-6 w-[150px] rounded-sm" />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Skeleton className="h-8 w-40 rounded-sm" />
          <Skeleton className="h-8 w-24 rounded-sm" />
        </div>
      </header>
      <div
        className="grid min-h-0 flex-1 gap-1.5 p-1.5"
        style={{
          gridTemplateAreas: '"lyrics center panel" "timeline timeline cues"',
          gridTemplateColumns: "clamp(280px, 20vw, 340px) minmax(0, 1fr) clamp(340px, 24vw, 400px)",
          gridTemplateRows: "minmax(0, 1fr) clamp(150px, 21vh, 210px)",
        }}
      >
        <PaneSkeleton area="lyrics" lines={12}>
          <Skeleton className="h-4 w-16 rounded-xs" />
        </PaneSkeleton>
        <div className="flex min-h-0 flex-col gap-1.5" style={{ gridArea: "center" }}>
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-surface p-3">
            <Skeleton className="aspect-video max-h-full w-full rounded-md" />
          </div>
          <PaneSkeleton area="center" className="h-[150px] shrink-0" lines={3} />
        </div>
        <PaneSkeleton area="panel" lines={8}>
          <Skeleton className="h-7 w-full rounded-sm" />
          <Skeleton className="h-32 w-full rounded-md" />
        </PaneSkeleton>
        <PaneSkeleton area="timeline">
          <Skeleton className="h-4 w-20 rounded-xs" />
          <Skeleton className="w-full flex-1 rounded-sm" />
        </PaneSkeleton>
        <PaneSkeleton area="cues" lines={3}>
          <Skeleton className="h-4 w-20 rounded-xs" />
        </PaneSkeleton>
      </div>
    </SkeletonGroup>
  );
}

/** Non-console states keep the console's 52 px header (「‹ 作品庫」 at the same x) above a centred
 *  empty state, the same composition as the design overview and the lyrics editor. */
function StateFrame({ heading, title, children }: { heading?: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div className="flex h-screen min-w-0 flex-col bg-bg text-label">
      <AppHeader variant="console" back heading={heading} title={title} />
      <div className="flex min-h-0 flex-1 items-center justify-center pb-[52px]">{children}</div>
    </div>
  );
}

export function NotFoundState() {
  return (
    <div className="flex h-screen min-w-0 flex-col bg-bg text-label">
      <AppHeader variant="console" back title={NOT_FOUND_HEADER_TITLE} />
      <ProjectNotFound />
    </div>
  );
}

export function LoadErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StateFrame title="無法載入">
      <EmptyState
        icon={<WarningCircleIcon size={44} className="text-red" />}
        title="無法載入作品"
        description={
          <>
            <p>{message}</p>
            <p className="mt-1">請確認本機的 Livelyrics 伺服器仍在執行。</p>
          </>
        }
        action={
          <span className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="filled" onClick={onRetry}>
              重試
            </Button>
            <Button variant="gray" href="/" transitionTypes={["pop"]}>
              回到作品庫
            </Button>
          </span>
        }
      />
    </StateFrame>
  );
}

export function NotReadyState({ project, onOpenAnyway }: { project: Project; onOpenAnyway: () => void }) {
  const processing = project.status === "processing";
  const palette = (project.plan?.keyVisual.palette ?? []).map((p) => p.hex);
  return (
    <StateFrame heading={<TitleBlock id={project.id} title={project.meta?.title || "未命名歌曲"} palette={palette} subtitle={project.meta?.artist || undefined} />}>
      <EmptyState
        icon={processing ? <Spinner size={20} /> : MusicNotesIcon}
        title={processing ? "這首歌還在處理中" : "這首歌還沒處理"}
        description={
          <>
            「<span className="text-label">{project.meta?.title || "未命名歌曲"}</span>」
            {processing ? "的研究與設計正在進行，完成後這裡會自動進入控制台。" : "需要先抓歌詞、研究與設計，才能得到完整的舞台視覺。"}
          </>
        }
        action={
          <span className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="filled" href={`/p/${encodeURIComponent(project.id)}/process`} transitionTypes={["push"]}>
              {processing ? "查看處理進度" : "前往設計總覽"}
            </Button>
            <Button variant="gray" onClick={onOpenAnyway}>
              仍要開啟控制台
            </Button>
          </span>
        }
      />
    </StateFrame>
  );
}
