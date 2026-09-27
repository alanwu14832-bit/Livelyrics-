"use client";

// 作品庫 (UI-AUDIT §3.5 首頁, UI-15, UI-26, UI-27): a clean grid of Apple Music style cards.
// The artwork is the project's own palette (ProjectArt), nothing is stamped on it; one primary
// action (clicking the card: ready -> console, otherwise -> the design overview) and everything
// else in the ⋯ menu; deleting asks with an Alert, and the other cards close the gap on a spring.

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ViewTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Banner, Button, EmptyState, Menu, MenuItem, MenuSeparator, Skeleton, SkeletonGroup, SkeletonText, Spinner, TextField } from "@/components/ui";
import { ArrowClockwiseIcon, DotsThreeIcon, MagnifyingGlassIcon, MonitorPlayIcon, MusicNotesIcon, PencilSimpleIcon, SparkleIcon, TrashIcon, UsersThreeIcon } from "@/components/ui/Icon";
import { processHref } from "@/components/process/steps";
import { api } from "@/lib/api-client";
import { easeOut, spring } from "@/lib/motion";
import { formatTimeShort } from "@/lib/timeline";
import type { ProjectSummary } from "@/lib/types";
import { AssignBandSheet } from "./AssignBandSheet";
import { useStorageMode } from "./use-storage-mode";
import { ProjectArt, validPalette } from "./ProjectArt";
import { formatAbsoluteTime, formatRelativeTime } from "./relative-time";
import { PUSH, artTransitionName, titleTransitionName } from "./transitions";

const POLL_MS = 4000;
const SEARCH_THRESHOLD = 6;
/** per-viewer convenience: the skeleton shows as many cards as last time (no layout jump) */
const COUNT_KEY = "livelyrics:library-count";

type LoadState = { kind: "loading" } | { kind: "ok"; projects: ProjectSummary[] } | { kind: "error"; message: string };

const noSubscribe = () => () => {};

function readCount(): number {
  try {
    const n = Number(window.localStorage.getItem(COUNT_KEY));
    return Number.isFinite(n) ? Math.min(8, Math.max(0, Math.round(n))) : 3;
  } catch {
    return 3;
  }
}
function writeCount(n: number) {
  try {
    window.localStorage.setItem(COUNT_KEY, String(n));
  } catch {
    /* private window: the skeleton falls back to three cards */
  }
}

const consoleHref = (id: string) => `/p/${encodeURIComponent(id)}`;
const lyricsHref = (id: string) => `/p/${encodeURIComponent(id)}/lyrics`;

const sortProjects = (list: ProjectSummary[]) => [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

const GRID = "relative grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-5 gap-y-6";

export function ProjectLibrary({
  className,
  initialProjects = null,
  serverNow,
}: {
  className?: string;
  /** read on the server for the first paint; the client refreshes it on mount */
  initialProjects?: ProjectSummary[] | null;
  /** the server's clock for that render, so the relative times hydrate identically */
  serverNow?: number;
}) {
  const router = useRouter();
  const cloud = useStorageMode() === "cloud";
  const [state, setState] = useState<LoadState>(() => (initialProjects ? { kind: "ok", projects: sortProjects(initialProjects) } : { kind: "loading" }));
  const [now, setNow] = useState(() => serverNow ?? Date.now());
  const [filter, setFilter] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [pendingReprocess, setPendingReprocess] = useState<ProjectSummary | null>(null);
  const [assigning, setAssigning] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const skeletonCount = useSyncExternalStore(noSubscribe, () => readCount() || 3, () => 3);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterExit = useRef(false);

  const load = useCallback(() => {
    api
      .listProjects()
      .then((projects) => {
        setState({ kind: "ok", projects: sortProjects(projects) });
        setNow(Date.now());
        writeCount(projects.length);
      })
      .catch((err: unknown) => setState((s) => (s.kind === "ok" ? s : { kind: "error", message: err instanceof Error ? err.message : String(err) })));
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      clearInterval(tick);
    };
  }, [load]);

  const anyProcessing = state.kind === "ok" && state.projects.some((p) => p.status === "processing");
  useEffect(() => {
    if (!anyProcessing) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [anyProcessing, load]);

  const projects = useMemo(() => (state.kind === "ok" ? state.projects : []), [state]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => `${p.title} ${p.artist}`.toLowerCase().includes(q));
  }, [projects, filter]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProject(id);
      focusAfterExit.current = true;
      setState((s) => {
        if (s.kind !== "ok") return s;
        const rest = s.projects.filter((p) => p.id !== id);
        writeCount(rest.length);
        return { ...s, projects: rest };
      });
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const reprocess = (p: ProjectSummary) => {
    if (p.status === "ready") setPendingReprocess(p);
    else router.push(processHref(p.id, { run: true }));
  };

  const count = state.kind === "ok" ? projects.length : null;

  return (
    <section aria-labelledby="library-title" className={className}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h2 id="library-title" ref={headingRef} tabIndex={-1} className="text-title-1 text-label outline-none">
          作品庫
          {count != null && count > 0 && (
            <span className="ml-2.5 font-normal text-label-2 tabular">
              {count}
              <span className="sr-only"> 首歌</span>
            </span>
          )}
        </h2>
        {projects.length > SEARCH_THRESHOLD && (
          <label className="relative w-64 max-w-full">
            <span className="sr-only">搜尋作品</span>
            <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-2.5 z-[1] -translate-y-1/2 text-label-2" />
            <TextField type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜尋歌名或樂團" className="pl-8!" />
          </label>
        )}
      </div>

      {state.kind === "loading" && (
        <SkeletonGroup label="載入作品庫" className={GRID}>
          {Array.from({ length: skeletonCount }, (_, i) => (
            <div key={i} className="min-w-0">
              <Skeleton className="aspect-[16/10] rounded-xl!" />
              <SkeletonText lines={2} className="mt-3.5 w-3/4" />
            </div>
          ))}
        </SkeletonGroup>
      )}

      {state.kind === "error" && (
        <Banner tone="error" title="無法載入作品庫" description={state.message} actions={<Button onClick={load}>重試</Button>} />
      )}

      {state.kind === "ok" && projects.length === 0 && (
        <EmptyState icon={MusicNotesIcon} title="還沒有作品" description="把一首歌拖到上方，AI 會研究並設計它的舞台視覺。" />
      )}

      {state.kind === "ok" && projects.length > 0 && visible.length === 0 && (
        <p className="py-12 text-center text-[15px] leading-[22px] text-label-2">沒有符合「{filter}」的作品。</p>
      )}

      {visible.length > 0 && (
        <MotionConfig reducedMotion="user">
          <ul className={GRID}>
            <AnimatePresence
              initial={false}
              mode="popLayout"
              onExitComplete={() => {
                if (!focusAfterExit.current) return;
                focusAfterExit.current = false;
                // the deleted card took the focused menu button with it
                if (document.activeElement === document.body || !document.activeElement?.isConnected) headingRef.current?.focus({ preventScroll: true });
              }}
            >
              {visible.map((p) => (
                <motion.li
                  key={p.id}
                  layout="position"
                  className="min-w-0"
                  initial={{ opacity: 0, y: -8, scale: 0.98, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.96, filter: "blur(4px)", transition: { duration: 0.15, ease: easeOut } }}
                  transition={spring}
                >
                  <ProjectCard project={p} now={now} onDelete={() => setPendingDelete(p)} onReprocess={() => reprocess(p)} onAssign={() => setAssigning(p)} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </MotionConfig>
      )}

      <AssignBandSheet
        open={assigning != null}
        projectId={assigning?.id ?? null}
        songTitle={assigning?.title ?? ""}
        currentBandId={assigning?.bandId}
        onClose={() => setAssigning(null)}
        onAssigned={(bandId) => {
          const id = assigning?.id;
          setState((s) => (s.kind === "ok" ? { ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, bandId: bandId ?? undefined } : p)) } : s));
        }}
      />

      <Alert
        open={pendingDelete != null}
        title={`刪除「${pendingDelete?.title ?? ""}」？`}
        message={cloud ? "音檔、歌詞、研究與設計方案都會從雲端儲存空間刪除，無法復原。" : "音檔、歌詞、研究與設計方案都會從這台電腦移除，無法復原。"}
        confirmLabel="刪除"
        destructive
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (deleting) return;
          setPendingDelete(null);
          setDeleteError(null);
        }}
      >
        {deleteError && (
          <p role="alert" className="mt-3 text-[13px] leading-5 text-red-text">
            刪除失敗：{deleteError}
          </p>
        )}
      </Alert>

      <Alert
        open={pendingReprocess != null}
        title={`重新處理「${pendingReprocess?.title ?? ""}」？`}
        message="會重新研究樂團與歌曲、重新設計主視覺與段落，完成後取代目前的設計方案。已同步的歌詞會保留。"
        confirmLabel="重新處理"
        onConfirm={() => {
          const p = pendingReprocess;
          setPendingReprocess(null);
          if (p) router.push(processHref(p.id, { run: true }));
        }}
        onCancel={() => setPendingReprocess(null)}
      >
        {pendingReprocess && (
          <p className="mt-3 text-[13px] leading-5 text-label-2">
            只想調整設計？到
            <Link href={processHref(pendingReprocess.id)} transitionTypes={PUSH} className="mx-0.5 text-tint-text hover:underline hover:underline-offset-2">
              設計總覽
            </Link>
            用「重新設計」給設計師指示。
          </p>
        )}
      </Alert>
    </section>
  );
}

function CardMeta({ project: p, now }: { project: ProjectSummary; now: number }) {
  const cls = "mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-[18px] text-label-2";
  if (p.status === "processing") {
    return (
      <p className={cls}>
        <Spinner size={14} />
        處理中…
      </p>
    );
  }
  if (p.status === "error") {
    return (
      <p className={cls} title={p.error}>
        <span className="text-red-text">處理失敗</span>
        <span className="text-tint-text">查看</span>
      </p>
    );
  }
  const when = formatRelativeTime(p.updatedAt, now);
  const lead = p.status === "new" ? "尚未處理" : p.duration > 0 ? formatTimeShort(p.duration) : null;
  return (
    <p className={cls} title={formatAbsoluteTime(p.updatedAt)} suppressHydrationWarning>
      <span className="truncate tabular" suppressHydrationWarning>{[lead, when].filter(Boolean).join("・")}</span>
    </p>
  );
}

function ProjectCard({ project: p, now, onDelete, onReprocess, onAssign }: { project: ProjectSummary; now: number; onDelete: () => void; onReprocess: () => void; onAssign: () => void }) {
  const ready = p.status === "ready";
  const hasDesign = validPalette(p.palette).length > 0;
  const href = ready ? consoleHref(p.id) : p.status === "new" ? processHref(p.id, { run: true }) : processHref(p.id);
  const name = p.title || "未命名歌曲";
  return (
    <article className="group/card reveal-on-scroll relative min-w-0">
      <Link
        href={href}
        transitionTypes={PUSH}
        className="group/link block rounded-xl outline-offset-4"
      >
        <ViewTransition name={artTransitionName(p.id)} share="morph" default="none">
          <div
            className={
              "rounded-xl transition-[transform,box-shadow] duration-200 ease-out group-hover/card:scale-[1.02] group-hover/card:shadow-lift " +
              "group-active/link:scale-[.98] group-active/link:duration-(--dur-press) motion-reduce:transition-[box-shadow] motion-reduce:group-hover/card:scale-100"
            }
          >
            <ProjectArt id={p.id} palette={p.palette} className="aspect-[16/10] rounded-xl" />
          </div>
        </ViewTransition>
        <div className="mt-3 min-w-0 pr-9">
          <h3 className="flex min-w-0 text-[17px] leading-6 font-semibold text-label" title={name}>
            <ViewTransition name={titleTransitionName(p.id)} share="morph" default="none">
              <span className="min-w-0 truncate">{name}</span>
            </ViewTransition>
          </h3>
          <p className="truncate text-[15px] leading-[22px] text-label-2">{p.artist || "未填樂團"}</p>
          <CardMeta project={p} now={now} />
          <span className="sr-only">，{ready ? "開啟控制台" : "開啟設計總覽"}</span>
        </div>
      </Link>
      <div className="absolute right-[-6px] bottom-[-3px]">
        <Menu
          label={`「${name}」的更多動作`}
          placement="bottom-end"
          trigger={(t) => <Button {...t} variant="quiet" size="icon-sm" icon={<DotsThreeIcon size={20} weight="bold" />} aria-label={`「${name}」的更多動作`} />}
        >
          {!ready && hasDesign && (
            <MenuItem icon={MonitorPlayIcon} href={consoleHref(p.id)} transitionTypes={PUSH}>
              開啟控制台
            </MenuItem>
          )}
          <MenuItem icon={PencilSimpleIcon} href={lyricsHref(p.id)} transitionTypes={PUSH}>
            編輯歌詞
          </MenuItem>
          <MenuItem icon={SparkleIcon} href={processHref(p.id)} transitionTypes={PUSH}>
            設計總覽
          </MenuItem>
          <MenuItem icon={ArrowClockwiseIcon} onSelect={onReprocess} disabled={p.status === "processing"}>
            重新處理…
          </MenuItem>
          <MenuItem icon={UsersThreeIcon} onSelect={onAssign}>
            {p.bandId ? "更換樂團…" : "指定樂團…"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={TrashIcon} destructive onSelect={onDelete}>
            刪除
          </MenuItem>
        </Menu>
      </div>
    </article>
  );
}
