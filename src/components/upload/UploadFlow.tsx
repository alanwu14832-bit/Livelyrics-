"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ProgressBar, cx } from "@/components/ui";
import { MusicNotesIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { api } from "@/lib/api-client";
import { analyzeFile, AudioAnalysisError, isAbortError } from "@/lib/audio/analyze";
import { readAudioMetadata, type AudioFileMetadata } from "@/lib/audio/metadata";
import { distributeLines, parseLyricsText } from "@/lib/lyrics/lrc";
import type { AudioAnalysis } from "@/lib/types";
import { processHref, type ProcessStep } from "@/components/process/steps";
import { checkAudioFile, formatBytes, pickAudioFile } from "./accept";
import { Dropzone, heroTileClass, phaseEnterClass } from "./Dropzone";
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
    const title = phase.meta?.title || phase.file.name.replace(/\.[^.]+$/, "");
    return (
      <section aria-label="分析音訊" className={heroTileClass}>
        <div key={phase.kind} data-motion="move" className={cx("flex w-full max-w-[520px] min-w-0 flex-col items-center", phaseEnterClass)}>
          <span aria-hidden="true" className={cx("grid size-[88px] place-items-center rounded-full", failed ? "bg-red-soft text-red" : "bg-tint-soft text-tint")}>
            {failed ? <WarningCircleIcon size={44} /> : <MusicNotesIcon size={44} />}
          </span>
          <h2 className="mt-6 max-w-full truncate text-title-2 text-label" title={title}>
            {title}
          </h2>
          {phase.meta?.artist && <p className="max-w-full truncate text-[17px] leading-6 text-label-2">{phase.meta.artist}</p>}
          <p className="mt-1 max-w-full truncate text-[12px] leading-[18px] text-label-2" title={phase.file.name}>
            {phase.file.name}，{formatBytes(phase.file.size)}
          </p>

          {failed ? (
            <div role="alert" className="mt-6 flex w-full flex-col items-center">
              <p className="text-[15px] leading-[22px] text-label">
                <span className="font-semibold text-red-text">無法分析這個音檔。</span>
                {phase.message}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button variant="filled" size="lg" onClick={reset}>
                  重新選擇檔案
                </Button>
                {phase.canSkip && (
                  <Button variant="gray" size="lg" onClick={skipAnalysis}>
                    略過分析，直接建立
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="mt-8 w-full" aria-live="polite">
                <ProgressBar value={phase.progress} label={`${phase.label}…`} showValue aria-label="音訊分析進度" />
              </div>
              <p className="mt-3 text-[12px] leading-[18px] text-label-2">在瀏覽器裡分析節奏、能量、段落與波形，檔案不會上傳到網路。</p>
              <Button variant="plain" onClick={reset} className="mt-4">
                取消
              </Button>
            </>
          )}
        </div>
      </section>
    );
  }

  return <Dropzone onFiles={start} active error={phase.error} />;
}
