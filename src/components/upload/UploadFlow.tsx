"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api-client";
import { analyzeFile, AudioAnalysisError, isAbortError } from "@/lib/audio/analyze";
import { readAudioMetadata, type AudioFileMetadata } from "@/lib/audio/metadata";
import { distributeLines, parseLyricsText } from "@/lib/lyrics/lrc";
import type { AudioAnalysis } from "@/lib/types";
import { AlertIcon, MusicIcon, XIcon } from "@/components/home/icons";
import { processHref, type ProcessStep } from "@/components/process/steps";
import { checkAudioFile, formatBytes, pickAudioFile } from "./accept";
import { Dropzone } from "./Dropzone";
import { storeLyricsHandoff } from "./handoff";
import { resultToLyricsText } from "./lyrics-choice";
import { NewProjectCard, type NewProjectInput } from "./NewProjectCard";

type Phase =
  | { kind: "idle"; error: string | null }
  | { kind: "analyzing"; file: File; progress: number; label: string; meta: AudioFileMetadata | null }
  | { kind: "failed"; file: File; message: string; canSkip: boolean; meta: AudioFileMetadata | null }
  | { kind: "review"; file: File; meta: AudioFileMetadata; analysis: AudioAnalysis | null; duration: number; warning: string | null };

/** Duration from the browser's media element (used when analysis is skipped). */
function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    let url = "";
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(0);
      return;
    }
    const el = new Audio();
    const done = (d: number) => {
      clearTimeout(timer);
      el.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const timer = setTimeout(() => done(0), 6000);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    el.src = url;
  });
}

function fallbackMeta(file: File): AudioFileMetadata {
  return { title: file.name.replace(/\.[^.]+$/, ""), artist: "" };
}

export function UploadFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle", error: null });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // outside the idle dropzone, a stray drop must not navigate the tab away to the file
  const busy = phase.kind !== "idle";
  useEffect(() => {
    if (!busy) return;
    const block = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, [busy]);

  const start = useCallback((files: File[]) => {
    const { file, ignored } = pickAudioFile(files);
    if (!file) return;
    const check = checkAudioFile(file);
    if (!check.ok) {
      setPhase({ kind: "idle", error: check.reason });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitError(null);
    setPhase({ kind: "analyzing", file, progress: 0, label: ignored > 0 ? `一次處理一首歌，已略過其他 ${ignored} 個檔案` : "讀取檔案", meta: null });

    const metaJob = readAudioMetadata(file).catch(() => fallbackMeta(file));
    metaJob.then((meta) => {
      if (controller.signal.aborted) return;
      setPhase((p) => (p.kind === "analyzing" && p.file === file ? { ...p, meta } : p));
    });

    analyzeFile(
      file,
      (progress, label) => {
        if (controller.signal.aborted) return;
        setPhase((p) => (p.kind === "analyzing" && p.file === file ? { ...p, progress, label } : p));
      },
      { signal: controller.signal },
    )
      .then(async (analysis) => {
        const meta = await metaJob;
        if (controller.signal.aborted) return;
        setPhase({ kind: "review", file, meta, analysis, duration: analysis.duration || meta.duration || 0, warning: null });
      })
      .catch(async (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        const meta = await metaJob;
        const message = err instanceof Error ? err.message : String(err);
        const canSkip = !(err instanceof AudioAnalysisError && (err.code === "empty" || err.code === "too-large" || err.code === "read"));
        setPhase({ kind: "failed", file, message: message || "音訊分析失敗", canSkip, meta });
      });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSubmitting(false);
    setSubmitError(null);
    setPhase({ kind: "idle", error: null });
  }, []);

  const skipAnalysis = useCallback(async () => {
    if (phase.kind !== "failed") return;
    const { file, message } = phase;
    const meta = phase.meta ?? fallbackMeta(file);
    const duration = meta.duration || (await probeDuration(file));
    setPhase({
      kind: "review",
      file,
      meta,
      analysis: null,
      duration,
      warning: `音訊分析失敗（${message}）。仍可建立作品，但畫面不會跟著音樂能量變化；若瀏覽器無法解碼，控制台也可能無法播放這個檔案。`,
    });
  }, [phase]);

  const submit = useCallback(
    async (input: NewProjectInput) => {
      if (phase.kind !== "review" || submitting) return;
      const { file, meta, analysis, duration } = phase;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const project = await api.createProject({
          audio: file,
          meta: {
            title: input.title,
            artist: input.artist,
            album: input.album || undefined,
            year: meta.year,
            // 0 = unknown: the server falls back to the analysis duration
            duration: duration > 0 ? duration : 0,
          },
          analysis,
        });

        let steps: ProcessStep[] | undefined;
        let lyricsText: string | null = null;
        if (input.lyricsMode === "paste") lyricsText = input.pasteText;
        else if (input.lyricsMode === "auto" && input.pick) lyricsText = resultToLyricsText(input.pick.result, input.pick.useTiming);
        else steps = ["research", "design"]; // "later", or none of the search results fit

        if (lyricsText && !storeLyricsHandoff(project.id, lyricsText)) {
          // sessionStorage unavailable: save the lyrics on the project instead (roughly timed when
          // untimed, so the pipeline keeps them rather than searching LRCLIB again)
          const parsed = parseLyricsText(lyricsText);
          const lyrics = parsed.synced ? parsed : distributeLines(parsed, analysis, project.meta.duration);
          await api.updateProject(project.id, { lyrics });
        }
        router.push(processHref(project.id, { run: true, steps }));
      } catch (err) {
        setSubmitting(false);
        setSubmitError(`建立作品失敗：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [phase, submitting, router],
  );

  if (phase.kind === "review") {
    return (
      <NewProjectCard
        key={phase.file.name + phase.file.size + phase.file.lastModified}
        file={phase.file}
        meta={phase.meta}
        analysis={phase.analysis}
        duration={phase.duration}
        analysisWarning={phase.warning}
        submitting={submitting}
        submitError={submitError}
        onCancel={reset}
        onSubmit={submit}
      />
    );
  }

  if (phase.kind === "analyzing" || phase.kind === "failed") {
    const failed = phase.kind === "failed";
    const pct = phase.kind === "analyzing" ? Math.round(phase.progress * 100) : 0;
    return (
      <section aria-label="分析音訊" className="rounded-2xl border border-line bg-panel px-6 py-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <div className="flex items-center gap-4">
            <span className={failed ? "flex size-12 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger" : "flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"}>
              {failed ? <AlertIcon size={22} /> : <MusicIcon size={22} className="animate-pulse" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-fg">
                {phase.meta?.title || phase.file.name}
                {phase.meta?.artist && <span className="font-normal text-muted"> — {phase.meta.artist}</span>}
              </p>
              <p className="truncate text-xs text-muted">
                {phase.file.name} · {formatBytes(phase.file.size)}
              </p>
            </div>
            {!failed && (
              <Button variant="ghost" size="sm" onClick={reset}>
                <XIcon size={14} />
                取消
              </Button>
            )}
          </div>

          {failed ? (
            <div role="alert" className="space-y-4">
              <p className="rounded-lg border border-danger/30 bg-danger/[0.07] px-4 py-3 text-sm text-fg">
                <span className="font-medium text-danger">無法分析這個音檔。</span> {phase.message}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={reset}>
                  重新選擇檔案
                </Button>
                {phase.canSkip && <Button onClick={skipAnalysis}>略過分析，直接建立</Button>}
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="text-fg" aria-live="polite">
                  {phase.label}…
                </span>
                <span className="font-mono text-muted tabular">{pct}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="音訊分析進度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="h-2 overflow-hidden rounded-full bg-panel-3"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-faint">在瀏覽器裡分析節奏、能量、段落與波形（檔案不會上傳到網路）。</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  return <Dropzone onFiles={start} active error={phase.error} />;
}
