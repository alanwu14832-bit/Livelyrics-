"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatTimeShort } from "@/lib/timeline";
import type { ProjectStatus, ProjectSummary } from "@/lib/types";
import { processHref } from "@/components/process/steps";
import { Dialog } from "./Dialog";
import { AlertIcon, ArrowRightIcon, MonitorIcon, PenIcon, RefreshIcon, SearchIcon, SparklesIcon, TrashIcon, UploadIcon } from "./icons";
import { formatAbsoluteTime, formatRelativeTime } from "./relative-time";

const STATUS: Record<ProjectStatus, { label: string; tone: "neutral" | "accent" | "ok" | "danger" }> = {
  new: { label: "尚未處理", tone: "neutral" },
  processing: { label: "處理中", tone: "accent" },
  ready: { label: "可上台", tone: "ok" },
  error: { label: "處理失敗", tone: "danger" },
};

const FALLBACK_ACCENTS = ["#ff5a36", "#8b6cff", "#2fb6c9", "#e0457b", "#f5c542", "#34d17c"];
const POLL_MS = 4000;

function accentFor(p: ProjectSummary): string {
  if (p.accent && /^#[0-9a-f]{6}$/i.test(p.accent)) return p.accent;
  let h = 0;
  for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
  return FALLBACK_ACCENTS[h % FALLBACK_ACCENTS.length];
}

type LoadState = { kind: "loading" } | { kind: "ok"; projects: ProjectSummary[] } | { kind: "error"; message: string };

export function ProjectLibrary() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [pendingReprocess, setPendingReprocess] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listProjects()
      .then((projects) => {
        setState({ kind: "ok", projects: [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) });
        setNow(Date.now());
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
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProject(pendingDelete.id);
      setState((s) => (s.kind === "ok" ? { ...s, projects: s.projects.filter((p) => p.id !== pendingDelete.id) } : s));
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

  return (
    <section aria-labelledby="library-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="library-title" className="text-lg font-semibold text-fg">
            作品庫
          </h2>
          <p className="text-sm text-muted">{state.kind === "ok" && projects.length > 0 ? `${projects.length} 首歌` : "每首歌都是一個作品：歌詞、研究、主視覺與段落設計"}</p>
        </div>
        {projects.length > 6 && (
          <label className="relative">
            <span className="sr-only">搜尋作品</span>
            <SearchIcon size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜尋歌名或樂團"
              className="h-9 w-56 rounded-md border border-line bg-panel pl-8 pr-3 text-sm text-fg outline-none placeholder:text-faint focus:border-accent"
            />
          </label>
        )}
      </div>

      {state.kind === "loading" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="載入作品庫">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-xl border border-line bg-panel" />
          ))}
        </div>
      )}

      {state.kind === "error" && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-4 text-sm">
          <AlertIcon className="shrink-0 text-danger" />
          <span className="flex-1 text-fg">
            無法載入作品庫：<span className="text-muted">{state.message}</span>
          </span>
          <Button size="sm" onClick={load}>
            <RefreshIcon size={14} />
            重試
          </Button>
        </div>
      )}

      {state.kind === "ok" && projects.length === 0 && <EmptyLibrary />}

      {state.kind === "ok" && projects.length > 0 && visible.length === 0 && <p className="py-8 text-center text-sm text-muted">沒有符合「{filter}」的作品。</p>}

      {visible.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <li key={p.id}>
              <ProjectCard project={p} now={now} onDelete={() => setPendingDelete(p)} onReprocess={() => reprocess(p)} />
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={pendingDelete != null}
        onClose={() => {
          if (!deleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
        dismissible={!deleting}
        title={`刪除「${pendingDelete?.title ?? ""}」？`}
        description="音檔、歌詞、研究與設計方案都會從這台電腦移除，無法復原。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting} autoFocus>
              <TrashIcon size={14} />
              {deleting ? "刪除中…" : "刪除"}
            </Button>
          </>
        }
      >
        {deleteError && (
          <p role="alert" className="text-sm text-danger">
            刪除失敗：{deleteError}
          </p>
        )}
      </Dialog>

      <Dialog
        open={pendingReprocess != null}
        onClose={() => setPendingReprocess(null)}
        title={`重新處理「${pendingReprocess?.title ?? ""}」？`}
        description="會重新研究樂團與歌曲、重新設計主視覺與段落，完成後取代目前的設計方案（歌詞若已同步會保留）。只想調整設計，可以到設計總覽用「重新設計」給設計師指示。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingReprocess(null)}>
              取消
            </Button>
            {pendingReprocess && (
              <Link href={processHref(pendingReprocess.id)} className="inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium text-muted hover:bg-panel-3 hover:text-fg">
                前往設計總覽
              </Link>
            )}
            <Button variant="primary" onClick={() => pendingReprocess && router.push(processHref(pendingReprocess.id, { run: true }))}>
              <RefreshIcon size={14} />
              重新處理
            </Button>
          </>
        }
      />
    </section>
  );
}

function ProjectCard({ project: p, now, onDelete, onReprocess }: { project: ProjectSummary; now: number; onDelete: () => void; onReprocess: () => void }) {
  const accent = accentFor(p);
  const status = STATUS[p.status] ?? STATUS.new;
  const statusHref = p.status === "new" ? processHref(p.id, { run: true }) : processHref(p.id);
  const iconBtn =
    "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted transition-colors hover:bg-panel-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-faint">
      <Link
        href={statusHref}
        className="relative block h-20 overflow-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        aria-label={`${p.title} 設計總覽`}
        style={{
          background: `radial-gradient(120% 140% at 0% 0%, ${accent}cc 0%, ${accent}55 38%, transparent 72%), linear-gradient(135deg, #191c24, #0b0c10)`,
        }}
      >
        <span aria-hidden="true" className="absolute inset-0 bg-[repeating-linear-gradient(115deg,rgba(255,255,255,0.05)_0_1px,transparent_1px_14px)] opacity-60" />
        <span className="absolute right-3 top-3">
          <Badge tone={status.tone} className={cx("backdrop-blur-sm", p.status === "processing" && "animate-pulse")}>
            {status.label}
          </Badge>
        </span>
        <span className="absolute bottom-2.5 left-3 font-mono text-xs text-white/80 tabular drop-shadow">{p.duration > 0 ? formatTimeShort(p.duration) : "—:—"}</span>
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-fg" title={p.title}>
            {p.title || "未命名歌曲"}
          </h3>
          <p className="truncate text-sm text-muted">{p.artist || "未填樂團"}</p>
          <p className="mt-1 text-xs text-faint" title={formatAbsoluteTime(p.updatedAt)}>
            更新於 {formatRelativeTime(p.updatedAt, now)}
          </p>
        </div>
        {p.status !== "ready" && (
          <Link href={statusHref} className="inline-flex w-fit items-center gap-1 text-xs text-accent hover:underline">
            {p.status === "new" ? "開始處理" : p.status === "processing" ? "查看處理進度" : "查看錯誤並重試"}
            <ArrowRightIcon size={12} />
          </Link>
        )}
        <div className="mt-auto flex items-center gap-1 border-t border-line pt-3">
          <Link
            href={`/p/${encodeURIComponent(p.id)}`}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              p.status === "ready" ? "bg-accent text-white hover:brightness-110" : "border border-line bg-panel-3 text-fg hover:bg-line",
            )}
          >
            <MonitorIcon size={14} />
            開啟控制台
          </Link>
          <button type="button" onClick={onReprocess} className={iconBtn} disabled={p.status === "processing"} title="重新研究與設計">
            <RefreshIcon size={14} />
            重新處理
          </button>
          <Link href={`/p/${encodeURIComponent(p.id)}/lyrics`} className={iconBtn}>
            <PenIcon size={14} />
            編輯歌詞
          </Link>
          <button type="button" onClick={onDelete} className={cx(iconBtn, "ml-auto hover:bg-danger/15 hover:text-danger")} aria-label={`刪除 ${p.title}`} title="刪除">
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

function EmptyLibrary() {
  const steps = [
    { icon: <UploadIcon size={18} />, title: "上傳一首歌", body: "拖放音檔到上方。瀏覽器會分析速度、能量、段落與波形，再選擇歌詞來源（自動搜尋或貼上）。" },
    {
      icon: <SparklesIcon size={18} />,
      title: "AI 舞台視覺設計師",
      body: "以樂團專職舞台視覺設計師的角度研究樂團與歌曲，設計主視覺、色票與符號，並決定每一段的畫面與歌詞呈現方式。",
    },
    { icon: <MonitorIcon size={18} />, title: "上台操作", body: "控制台有完整資訊：歌詞、段落、設計理由與操作提示；另開的投影視窗只顯示動畫與歌詞。" },
  ];
  return (
    <div className="rounded-2xl border border-dashed border-line bg-panel/40 p-6">
      <p className="mb-5 text-sm text-muted">還沒有作品。三個步驟就能讓歌詞與動畫上大螢幕：</p>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="relative rounded-xl border border-line bg-panel p-4">
            <span className="mb-3 flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent/15 text-accent">{s.icon}</span>
              <span className="font-mono text-xs text-faint">0{i + 1}</span>
            </span>
            <h3 className="text-sm font-semibold text-fg">{s.title}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
