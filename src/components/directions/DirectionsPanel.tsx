"use client";

// 設計方向 (phase 4) on the design overview: the mood board, 「提出設計方向」 and the 方向比較 —
// 2–3 cards side by side, each with a style-frame carousel (the real renderer, LED 安全模式
// applied), palette chips, a typography specimen, the pitch and the rationale (research and
// 參考圖 citations), scene and lyric tendencies, the band's comments, and the actions:
// 「採用這個方向」 (becomes the plan; 復原 brings the old one back), 「修改」 (a note → the redesign
// path), 「退回」. Everything is opt-in: the single-plan flow on this page is unchanged.

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Banner, Button, Sheet, Spinner, Tag, TextArea, TextField, cx } from "@/components/ui";
import { ArrowCounterClockwiseIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, CornersOutIcon, FileTextIcon, PencilSimpleIcon, SparkleIcon, XIcon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { MoodBoard } from "@/components/moodboard/MoodBoard";
import { PUSH } from "@/components/home/transitions";
import { api } from "@/lib/api-client";
import { DIRECTION_STATUS_LABEL, specimenLine } from "@/lib/directions";
import { FONTS, fontStack } from "@/lib/fonts";
import { mergedMoodboard } from "@/lib/moodboard";
import type { DesignDirection, MoodImage, Project } from "@/lib/types";
import { useStyleFrames, type FramesState, type StyleFrame } from "./style-frames";
import { LYRIC_STYLE_LABEL, SCENE_LABEL } from "@/components/process/labels";

const REVISE_SUGGESTIONS = ["顏色再暖一點", "副歌更有爆發力", "歌詞少一點", "更貼近參考圖", "字體更粗"];

function aspectOf(project: Project): string {
  const w = project.output?.width || 1920;
  const h = project.output?.height || 1080;
  return `${w} / ${h}`;
}

// ---------------------------------------------------------------------------
// style frames
// ---------------------------------------------------------------------------

export function FrameCarousel({
  state,
  aspect,
  label,
  onExpand,
  compact = false,
}: {
  state: FramesState & { retry: () => void };
  aspect: string;
  label: string;
  onExpand?: (index: number) => void;
  compact?: boolean;
}) {
  const frames = state.frames ?? [];
  // the first chorus (lyrics on screen) is the most telling still; the carousel opens there
  const featured = Math.max(0, frames.findIndex((f) => f.label === "第一次副歌"));
  const [picked, setIndex] = useState<number | null>(null);
  const index = picked ?? featured;
  const current = frames[Math.min(index, frames.length - 1)];
  const go = (d: number) => frames.length && setIndex((i) => ((i ?? featured) + d + frames.length) % frames.length);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    }
  };
  return (
    <div className="min-w-0" role="group" aria-roledescription="輪播" aria-label={`${label}的畫面`} onKeyDown={onKey}>
      <div className="group relative overflow-hidden rounded-lg bg-black shadow-[0_0_0_var(--hairline)_var(--separator)]" style={{ aspectRatio: aspect }}>
        {state.status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <Spinner size={20} />
            <span className="text-[12px] leading-4">正在算出畫面…</span>
          </div>
        )}
        {state.status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-white/80">
            <span className="text-[12px] leading-4">{state.error}</span>
            <Button size="sm" variant="gray" onClick={state.retry}>
              重新算出
            </Button>
          </div>
        )}
        {frames.map((f, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- a rendered still (object URL)
          <img
            key={f.url}
            src={f.url}
            alt={`${label}：${f.label}`}
            data-testid="style-frame"
            className={cx(
              "absolute inset-0 size-full object-cover transition-opacity duration-(--dur-base) ease-(--ease-out) motion-reduce:transition-none",
              i === index ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={i === index ? undefined : true}
          />
        ))}
        {current && (
          <>
            <span className="absolute bottom-2 left-2 rounded-xs bg-black/65 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white">{current.label}</span>
            {frames.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="上一張"
                  onClick={() => go(-1)}
                  className="press absolute top-1/2 left-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-(--dur-fast) ease-[ease] group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <CaretLeftIcon size={16} />
                </button>
                <button
                  type="button"
                  aria-label="下一張"
                  onClick={() => go(1)}
                  className="press absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-(--dur-fast) ease-[ease] group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <CaretRightIcon size={16} />
                </button>
              </>
            )}
            {onExpand && (
              <button
                type="button"
                aria-label="放大檢視"
                onClick={() => onExpand(index)}
                className="press absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-(--dur-fast) ease-[ease] group-hover:opacity-100 focus-visible:opacity-100"
              >
                <CornersOutIcon size={16} />
              </button>
            )}
          </>
        )}
      </div>
      {frames.length > 1 && !compact && (
        <ul className="mt-2 grid grid-cols-4 gap-1.5" aria-label="選擇畫面">
          {frames.map((f, i) => (
            <li key={f.url} className="min-w-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={f.label}
                aria-current={i === index ? "true" : undefined}
                className={cx(
                  "press-tile block w-full overflow-hidden rounded-xs bg-black transition-[box-shadow,opacity] duration-(--dur-fast) ease-[ease]",
                  i === index ? "shadow-[0_0_0_2px_var(--tint)]" : "opacity-70 hover:opacity-100",
                )}
                style={{ aspectRatio: aspect }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a rendered still */}
                <img src={f.url} alt="" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FrameSheet({ open, onClose, frames, start, title, aspect }: { open: boolean; onClose: () => void; frames: StyleFrame[]; start: number; title: string; aspect: string }) {
  const [index, setIndex] = useState(start);
  const [shownStart, setShownStart] = useState(start);
  if (open && start !== shownStart) {
    setShownStart(start);
    setIndex(start);
  }
  const f = frames[Math.min(index, frames.length - 1)];
  const go = (d: number) => setIndex((i) => (i + d + frames.length) % frames.length);
  return (
    <Sheet open={open} onClose={onClose} title={title} width={1040} cancelLabel="關閉">
      {f && (
        <div
          className="flex flex-col gap-3 px-5 pt-1 pb-5"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
          }}
        >
          <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: aspect }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a rendered still */}
            <img src={f.url} alt={f.label} className="size-full object-contain" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] leading-5 text-label-2">
              {f.label}（{index + 1}／{frames.length}）
            </span>
            <span className="flex gap-2">
              <Button variant="gray" icon={CaretLeftIcon} onClick={() => go(-1)} aria-label="上一張" size="icon" />
              <Button variant="gray" icon={CaretRightIcon} onClick={() => go(1)} aria-label="下一張" size="icon" />
            </span>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// one direction
// ---------------------------------------------------------------------------

function Palette({ direction }: { direction: DesignDirection }) {
  const colors = direction.plan.keyVisual.palette.slice(0, 6);
  return (
    <ul className="flex flex-wrap gap-2" aria-label="配色">
      {colors.map((c) => (
        <li key={c.hex} className="flex min-w-0 flex-col items-center gap-1" title={`${c.name}（${c.role}）${c.hex}`}>
          <span className="size-7 rounded-full shadow-[0_0_0_var(--hairline)_var(--separator)]" style={{ background: c.hex }} data-testid="direction-swatch" data-hex={c.hex} />
          <span className="max-w-12 truncate text-[11px] leading-3 text-label-2">{c.role}</span>
        </li>
      ))}
    </ul>
  );
}

function Specimen({ project, direction }: { project: Project; direction: DesignDirection }) {
  const t = direction.plan.keyVisual.typography;
  const bg = direction.plan.keyVisual.palette[0]?.hex ?? "#000";
  const fg = direction.plan.sections.find((s) => s.kind === "chorus")?.lyricColor ?? direction.plan.sections[0]?.lyricColor ?? "#fff";
  return (
    <div className="overflow-hidden rounded-md px-3 py-2.5 shadow-[0_0_0_var(--hairline)_var(--separator)]" style={{ background: bg, color: fg }}>
      <p className="truncate text-[22px] leading-[30px]" style={{ fontFamily: fontStack(t.cjkFont, t.latinFont), fontWeight: t.weight, letterSpacing: `${t.letterSpacing}em` }}>
        {specimenLine(project)}
      </p>
      <p className="mt-0.5 truncate text-[11px] leading-4 opacity-75">
        {FONTS[t.cjkFont]?.label ?? t.cjkFont}＋{FONTS[t.latinFont]?.label ?? t.latinFont}，字重 {t.weight}
      </p>
    </div>
  );
}

function statusTone(d: DesignDirection): "tint" | "red" | "neutral" {
  return d.status === "selected" ? "tint" : d.status === "rejected" ? "red" : "neutral";
}

function DirectionCard({
  project,
  direction,
  moodboard,
  busy,
  onAction,
  onRevise,
}: {
  project: Project;
  direction: DesignDirection;
  moodboard: MoodImage[];
  busy: string | null;
  onAction: (body: Parameters<typeof api.directions>[1], label: string) => Promise<void>;
  onRevise: (d: DesignDirection) => void;
}) {
  const frames = useStyleFrames(project, direction);
  const [expand, setExpand] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const commentId = useId();
  const aspect = aspectOf(project);
  const plan = direction.plan;
  const scenes = [...new Set(plan.sections.map((s) => s.scene))].slice(0, 5);
  const styles = [...new Set(plan.sections.filter((s) => s.lyricStyle !== "hidden").map((s) => s.lyricStyle))].slice(0, 4);
  const imageIndex = new Map(moodboard.map((m, i) => [m.id, i + 1]));
  const selected = direction.status === "selected";
  const rejected = direction.status === "rejected";
  const working = busy === direction.id;

  return (
    <li
      className={cx("flex min-w-0 flex-col gap-4 rounded-2xl bg-surface p-4 transition-[box-shadow,opacity] duration-(--dur-base) ease-(--ease-out)", selected && "shadow-[0_0_0_2px_var(--tint)]", rejected && "opacity-70")}
      data-testid="direction-card"
      data-direction={direction.letter}
      aria-labelledby={`dir-${direction.id}`}
    >
      <header className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-label text-[17px] leading-none font-bold text-bg" aria-hidden="true">
          {direction.letter}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`dir-${direction.id}`} className="truncate text-[20px] leading-7 font-semibold text-label">
            <span className="sr-only">方向 {direction.letter}：</span>
            {direction.name}
          </h3>
          <p className="text-[15px] leading-[22px] text-label-2">{direction.pitch}</p>
        </div>
        <Tag tone={statusTone(direction)} icon={selected ? CheckIcon : undefined} data-testid="direction-status">
          {DIRECTION_STATUS_LABEL[direction.status]}
        </Tag>
      </header>

      <div className="relative">
        <FrameCarousel state={frames} aspect={aspect} label={`方向 ${direction.letter}`} onExpand={(i) => setExpand(i)} />
        {working && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55 text-[13px] leading-5 text-white">
            <Spinner size={18} className="mr-2" />
            設計師正在修改這個方向…
          </div>
        )}
      </div>

      <Palette direction={direction} />
      <Specimen project={project} direction={direction} />

      <div className="min-w-0 text-[13px] leading-5 text-label">
        <Markdown>{direction.rationale}</Markdown>
      </div>

      {direction.references.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="引用的參考圖">
          {direction.references.map((r) => {
            const img = moodboard.find((m) => m.id === r.imageId);
            if (!img) return null;
            const url = img.scope === "band" && project.bandId ? api.moodImageUrl({ kind: "band", id: project.bandId }, img.id) : api.moodImageUrl({ kind: "project", id: project.id }, img.id);
            return (
              <li key={r.imageId} className="flex min-w-0 max-w-full items-center gap-2 rounded-md bg-fill-4 py-1 pr-2 pl-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- stored reference image */}
                <img src={url} crossOrigin="anonymous" alt="" className="size-8 shrink-0 rounded-xs object-cover" />
                <span className="min-w-0 text-[12px] leading-4 text-label-2">
                  <span className="font-semibold text-label">圖 {imageIndex.get(r.imageId)}</span> {r.cue}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px] leading-5">
        <dt className="text-label-2">場景</dt>
        <dd className="min-w-0 text-label">
          {direction.sceneTendency}
          <span className="mt-1 flex flex-wrap gap-1">
            {scenes.map((s) => (
              <Tag key={s}>{SCENE_LABEL[s] ?? s}</Tag>
            ))}
          </span>
        </dd>
        <dt className="text-label-2">歌詞</dt>
        <dd className="min-w-0 text-label">
          {direction.lyricTreatment}
          <span className="mt-1 flex flex-wrap gap-1">
            {styles.map((s) => (
              <Tag key={s}>{LYRIC_STYLE_LABEL[s] ?? s}</Tag>
            ))}
          </span>
        </dd>
      </dl>

      {direction.comments.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="意見">
          {direction.comments.map((c) => (
            <li key={c.id} className="group flex min-w-0 items-start gap-2 rounded-md bg-fill-4 px-2.5 py-1.5 text-[12px] leading-[18px]">
              <span className="shrink-0 font-semibold text-label-2">{c.kind === "revision" ? "已修改" : "意見"}</span>
              <span className="min-w-0 flex-1 break-words text-label">{c.text}</span>
              {c.kind === "comment" && (
                <button
                  type="button"
                  aria-label="刪除這則意見"
                  onClick={() => void onAction({ action: "uncomment", directionId: direction.id, commentId: c.id }, "刪除意見")}
                  className="press-fade shrink-0 text-label-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <XIcon size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex min-w-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = comment.trim();
          if (!text) return;
          void onAction({ action: "comment", directionId: direction.id, text }, "加入意見").then(() => setComment(""));
        }}
      >
        <label htmlFor={commentId} className="sr-only">
          方向 {direction.letter} 的意見
        </label>
        <TextField id={commentId} value={comment} maxLength={600} placeholder="樂團的意見…" onChange={(e) => setComment(e.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" variant="gray" disabled={!comment.trim() || busy != null}>
          記下
        </Button>
      </form>

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button
          variant={selected ? "gray" : "tinted"}
          icon={CheckIcon}
          disabled={busy != null || selected}
          onClick={() => void onAction({ action: "select", directionId: direction.id }, `採用方向 ${direction.letter}`)}
        >
          {selected ? "已採用" : "採用這個方向"}
        </Button>
        <Button variant="gray" icon={PencilSimpleIcon} disabled={busy != null} onClick={() => onRevise(direction)}>
          修改
        </Button>
        {!selected && (
          <Button
            variant="plain"
            disabled={busy != null}
            onClick={() => void onAction({ action: "status", directionId: direction.id, status: rejected ? "proposed" : "rejected" }, rejected ? "重新提案" : "退回")}
          >
            {rejected ? "重新提案" : "退回"}
          </Button>
        )}
      </div>

      <FrameSheet open={expand != null} onClose={() => setExpand(null)} frames={frames.frames ?? []} start={expand ?? 0} title={`方向 ${direction.letter}「${direction.name}」`} aspect={aspect} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// the section
// ---------------------------------------------------------------------------

export function DirectionsSection({
  project,
  onProject,
  disabled,
  offline,
  wide,
}: {
  project: Project;
  onProject: (p: Project) => void;
  /** the pipeline is running */
  disabled?: boolean;
  offline: boolean;
  /** laid out across the whole page (the comparison); otherwise the compact call to action */
  wide?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState<DesignDirection | null>(null);
  const [note, setNote] = useState("");
  const noteId = useId();
  const moodId = useId();
  const set = project.directions;
  const moodboard = mergedMoodboard(project);
  const jobRunning = project.directionsJob?.status === "running";
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // cloud: a job recorded by another request (a refreshed page) — poll until it is done
  useEffect(() => {
    if (!jobRunning || busy) return;
    const t = setInterval(() => {
      api
        .getProject(project.id)
        .then((p) => {
          if (p.directionsJob?.status !== "running") onProject(p);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [jobRunning, busy, project.id, onProject]);

  const run = useCallback(
    async (body: Parameters<typeof api.directions>[1], label: string, key: string) => {
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        const res = await api.directions(project.id, body);
        onProject(res.project);
        if (body.action === "select") {
          const d = res.project.directions?.directions.find((x) => x.id === body.directionId);
          setNotice(d ? `已採用方向 ${d.letter}「${d.name}」：控制台的設計方案已更新。` : "已採用這個方向。");
        } else if (body.action === "undo") setNotice("已復原成採用前的設計方案。");
        else if (body.action === "generate" && res.engine === "offline" && !offline) setNotice("Claude 這次沒有完成，方向由離線設計師提出。");
      } catch (err) {
        setError(`${label}失敗：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(null);
      }
    },
    [project.id, onProject, offline],
  );

  const generate = () => void run({ action: "generate", instruction: instruction.trim() || undefined }, "提出設計方向", "generate");
  const generating = busy === "generate" || (jobRunning && !set);
  const owner = { kind: "project" as const, id: project.id };
  const moodBoard = (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2 px-4">
        <h3 id={moodId} className="text-[13px] leading-5 text-label-2">
          參考圖{moodboard.length > 0 ? `（${moodboard.length}）` : ""}
        </h3>
      </div>
      <MoodBoard
        owner={owner}
        images={project.moodboard ?? []}
        bandImages={project.bandMoodboard ?? []}
        bandId={project.bandId}
        headingId={moodId}
        onChange={(images) => onProject({ ...projectRef.current, moodboard: images })}
      />
    </div>
  );

  const generateRow = (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
      <TextField value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={600} placeholder="（選填）對提案的要求，例如：其中一個要很暗、很安靜" aria-label="對提案的要求" className="min-w-0 flex-1" disabled={disabled || busy != null} />
      <Button variant={set ? "gray" : "tinted"} icon={SparkleIcon} onClick={generate} loading={generating} disabled={disabled || (busy != null && busy !== "generate") || jobRunning}>
        {set ? "重新提案" : "提出設計方向"}
      </Button>
    </div>
  );

  return (
    <section id="directions" aria-labelledby="directions-title" className={cx("min-w-0 scroll-mt-20", wide ? "space-y-6" : "space-y-4")} data-testid="directions">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="directions-title" className={wide ? "text-title-1 text-label" : "text-title-3 text-label"}>
            {set ? "方向比較" : "設計方向"}
          </h2>
          <p className="mt-1 max-w-[46em] text-[15px] leading-[22px] text-label-2">
            {set
              ? `${set.directions.length} 個方向${set.engine === "claude" ? `由 Claude${set.model ? `（${set.model}）` : ""}提出` : "由離線設計師提出"}。和樂團一起看，採用一個成為設計方案，或寫下意見請設計師修改。`
              : "先給樂團 2 到 3 個明顯不同的方向（例如冷調膠片、飽和拼貼、黑白極簡），選定後才進入製作。設計師會參考研究與參考圖。"}
          </p>
        </div>
        {set && (
          <div className="flex flex-wrap gap-2">
            {project.previousPlan && (
              <Button variant="gray" icon={ArrowCounterClockwiseIcon} onClick={() => void run({ action: "undo" }, "復原", "undo")} disabled={busy != null} loading={busy === "undo"}>
                復原
              </Button>
            )}
            <Button variant="gray" icon={FileTextIcon} href={`/p/${encodeURIComponent(project.id)}/proposal`} transitionTypes={PUSH}>
              一頁提案
            </Button>
          </div>
        )}
      </div>

      {error && <Banner tone="error" title="沒有完成" description={error} animateIn />}
      {notice && (
        <Banner
          tone="success"
          title={notice}
          animateIn
          actions={
            project.previousPlan ? (
              <Button variant="gray" icon={ArrowCounterClockwiseIcon} onClick={() => void run({ action: "undo" }, "復原", "undo")} disabled={busy != null}>
                復原
              </Button>
            ) : undefined
          }
        />
      )}
      {project.directionsJob?.status === "error" && !busy && <Banner tone="error" title="上次的提案沒有完成" description={project.directionsJob.message ?? "請再試一次。"} />}

      {wide ? (
        <div className="grid min-w-0 gap-4">
          {moodBoard}
          <div className="min-w-0 rounded-lg bg-surface p-4">
            {generateRow}
            {generating && <p className="mt-3 text-[13px] leading-5 text-label-2">設計師正在構思 3 個方向{offline ? "" : "，Claude 大約需要一到三分鐘"}…</p>}
          </div>
        </div>
      ) : (
        <>
          {moodBoard}
          <div className="rounded-lg bg-surface p-4">
            {generateRow}
            {generating && <p className="mt-3 text-[13px] leading-5 text-label-2">設計師正在構思 3 個方向{offline ? "" : "，Claude 大約需要一到三分鐘"}…</p>}
            {offline && !generating && <p className="mt-3 text-[12px] leading-4 text-label-2">離線設計師會提出冷暖、飽和、黑白三個軸線的方向，並依參考圖量到的顏色調整配色。</p>}
          </div>
        </>
      )}

      {set && (
        <ul className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="設計方向">
          {set.directions.map((d) => (
            <DirectionCard
              key={d.id}
              project={project}
              direction={d}
              moodboard={moodboard}
              busy={busy}
              onAction={(body, label) => run(body, label, body.action === "select" || body.action === "status" ? "action" : d.id)}
              onRevise={(dir) => {
                setRevising(dir);
                setNote("");
              }}
            />
          ))}
        </ul>
      )}

      <Sheet
        open={revising != null}
        onClose={() => setRevising(null)}
        title={revising ? `修改方向 ${revising.letter}「${revising.name}」` : "修改方向"}
        width={560}
        action={
          <Button
            variant="filled"
            disabled={!note.trim()}
            onClick={() => {
              const d = revising;
              if (!d) return;
              setRevising(null);
              void run({ action: "revise", directionId: d.id, text: note.trim() }, `修改方向 ${d.letter}`, d.id);
            }}
          >
            請設計師修改
          </Button>
        }
      >
        <div className="flex flex-col gap-3 px-5 pt-2 pb-5">
          <label htmlFor={noteId} className="text-[13px] leading-5 text-label-2">
            樂團的意見（設計師會以這個方向為基礎，只改意見提到的部分）
          </label>
          <TextArea id={noteId} rows={4} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：顏色再暖一點，副歌的字要更大。" />
          <ul className="flex flex-wrap gap-1.5" aria-label="常用意見">
            {REVISE_SUGGESTIONS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setNote((t) => (t.trim() ? `${t.trim()}；${s}` : s))}
                  className="press-fade inline-flex h-7 items-center rounded-pill bg-fill-3 px-3 text-[12px] leading-none font-medium text-label-2-on-material hover:bg-fill-2"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
          {offline && <p className="text-[12px] leading-4 text-label-2">離線設計師只看得懂簡單的意見，例如「更熱血」「更安靜」「藍一點」「直排」。</p>}
        </div>
      </Sheet>
    </section>
  );
}
