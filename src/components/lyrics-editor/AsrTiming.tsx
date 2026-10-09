"use client";

// 「AI 自動對時」 (round 15) in the lyric editor: the first-use sheet (what it does, that it runs on
// this computer and the song is not uploaded, the one-time download per model), the progress card
// (下載模型 → 聽歌中 → 對齊歌詞, cancellable; the editor stays usable), the error banner and the
// 確認全部時間 question. The work itself: useAsrTiming (below) → src/lib/asr/engine.ts (the Whisper
// worker) → alignTranscript → applyAsrTiming, one undo step.

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Banner, Button, ProgressBar, Sheet } from "@/components/ui";
import { AsrError, asrBusy, detectAsrDevice, deviceMemoryGB, transcribeSong, type AsrProgress, type AsrRun } from "@/lib/asr/engine";
import { ASR_CHOICE_LABEL, ASR_CHOICES, ASR_MODEL_NAME, downloadLabel, type AsrChoice, type AsrDevice } from "@/lib/asr/models";
import { alignTranscript, asrLanguage, hasHan, loadHanTables } from "@/lib/lyrics/asr-align";
import type { AudioAnalysis } from "@/lib/types";
import { applyAsrTiming, type EditorLine } from "./editor-model";
import { AiTimingIcon } from "./icons";

const CHOICE_KEY = "livelyrics:asr:choice";
const INTRO_KEY = "livelyrics:asr:intro-done";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* per-viewer convenience only */
  }
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** low memory (navigator.deviceMemory < 4 GB, Chromium only): 快速 is preselected */
export function lowMemory(): number | null {
  const m = deviceMemoryGB();
  return m != null && m < 4 ? m : null;
}

export type AsrUiState =
  | { kind: "idle" }
  | { kind: "running"; choice: AsrChoice; progress: AsrProgress | { stage: "align" } }
  | { kind: "error"; choice: AsrChoice; code: AsrError["code"]; message: string };

export interface AsrToast {
  tone: "info" | "ok" | "warn" | "error";
  message: string;
  duration?: number;
}

export interface AsrTimingDeps {
  audioUrl: string;
  /** the editor's current rows (read when the words come back: edits made meanwhile count) */
  getLines: () => EditorLine[];
  /** the analysis to estimate with (computes a missing 人聲 curve first, like 自動分配) */
  getAnalysis: () => Promise<AudioAnalysis | null>;
  getDuration: () => number;
  /** apply the timed rows as one undoable edit */
  apply: (next: EditorLine[]) => void;
  toast: (t: AsrToast) => void;
}

/** How the lines the AI did not hear were placed, for the toast. */
function filledHow(a: AudioAnalysis | null): string {
  return a?.vocal?.length ? "依人聲估算" : a ? "依音訊能量估算" : "平均分配";
}

/** The 「AI 自動對時」 state machine of one editor. */
export function useAsrTiming(deps: AsrTimingDeps) {
  const [state, setState] = useState<AsrUiState>({ kind: "idle" });
  const [introOpen, setIntroOpen] = useState(false);
  const [choice, setChoiceState] = useState<AsrChoice>("accurate");
  const [device, setDevice] = useState<AsrDevice>("wasm");
  const runRef = useRef<AsrRun | null>(null);
  /** bumped by every start and cancel: a run that finishes after it was cancelled changes nothing */
  const generation = useRef(0);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });
  /** leaving the editor stops a run (its result would have nowhere to go) */
  const stopAll = useCallback(() => {
    generation.current++;
    runRef.current?.cancel();
    runRef.current = null;
  }, []);

  // the remembered choice (else 快速 on a low-memory computer)
  useEffect(() => {
    const stored = readStored(CHOICE_KEY);
    const initial: AsrChoice = stored === "fast" || stored === "accurate" ? stored : lowMemory() != null ? "fast" : "accurate";
    let alive = true;
    // deferred: the stored value is only readable in the browser, after hydration
    queueMicrotask(() => {
      if (alive) setChoiceState(initial);
    });
    return () => {
      alive = false;
      stopAll();
    };
  }, [stopAll]);

  /** Which device would run it (for the sheet's sizes) — asked only when the sheet opens: opening the
   *  editor never wakes the GPU (and a browser without WebGPU logs a warning for every probe). A run
   *  probes again by itself. */
  const probed = useRef(false);
  const openSheet = useCallback(() => {
    setIntroOpen(true);
    if (probed.current) return;
    probed.current = true;
    void detectAsrDevice().then(setDevice);
  }, []);

  const setChoice = useCallback((c: AsrChoice) => {
    setChoiceState(c);
    store(CHOICE_KEY, c);
  }, []);

  const start = useCallback(async (picked: AsrChoice) => {
    if (asrBusy() || runRef.current) return;
    const gen = ++generation.current;
    const live = () => generation.current === gen;
    setIntroOpen(false);
    store(INTRO_KEY, "1");
    store(CHOICE_KEY, picked);
    setChoiceState(picked);
    const d = depsRef.current;
    const language = asrLanguage(d.getLines().map((l) => l.text));
    setState({ kind: "running", choice: picked, progress: { stage: "fetch" } });
    const run = transcribeSong({
      audioUrl: d.audioUrl,
      choice: picked,
      language,
      onProgress: (progress) => setState((s) => (s.kind === "running" ? { ...s, progress } : s)),
    });
    runRef.current = run;
    try {
      const result = await run.promise;
      if (!live()) return;
      setState({ kind: "running", choice: picked, progress: { stage: "align" } });
      const analysis = await depsRef.current.getAnalysis();
      const han = hasHan(depsRef.current.getLines().map((l) => l.text)) ? await loadHanTables() : null;
      if (!live()) return;
      const lines = depsRef.current.getLines();
      const texts = lines.map((l) => l.text);
      const fixed = lines.map((l) => (l.start != null && !l.estimated ? l.start : null));
      const vocal = analysis?.vocal?.length ? { curve: analysis.vocal, rate: analysis.envelopeRate } : null;
      const aligned = alignTranscript({ lines: texts, words: result.words, han, vocal, fixed });
      const isReal = (l: EditorLine) => l.start != null && !l.estimated;
      const toPlace = lines.filter((l) => l.text.trim() && !isReal(l)).length;
      const real = lines.filter(isReal).length;
      if (aligned.anchors.length === 0) {
        depsRef.current.toast({ tone: "warn", message: "AI 沒有對上任何一句（歌詞和唱的可能不同，或人聲太小），時間沒有改變。", duration: 7000 });
        setState({ kind: "idle" });
        return;
      }
      depsRef.current.apply(applyAsrTiming(lines, aligned.anchors, analysis, depsRef.current.getDuration()));
      const rest = Math.max(0, toPlace - aligned.anchors.length);
      depsRef.current.toast({
        tone: "ok",
        message:
          `AI 對上 ${aligned.anchors.length} 句（共 ${toPlace} 句）` +
          (rest > 0 ? `，其餘 ${rest} 句${filledHow(analysis)}` : "") +
          (real > 0 ? `；已對好的 ${real} 句沒動` : "") +
          "；都還是『估』，播放檢查後可按『確認全部時間』",
        duration: 9000,
      });
      setState({ kind: "idle" });
    } catch (err) {
      if (!live()) return;
      if (err instanceof AsrError && err.code === "cancelled") {
        setState({ kind: "idle" });
        return;
      }
      if (err instanceof AsrError && err.code === "busy") return;
      setState({ kind: "error", choice: picked, code: err instanceof AsrError ? err.code : "unknown", message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (runRef.current === run) runRef.current = null;
    }
  }, []);

  /** The toolbar button: the sheet the first time, afterwards straight to work with the remembered model. */
  const requestStart = useCallback(() => {
    if (state.kind === "running") return;
    if (readStored(INTRO_KEY) !== "1") openSheet();
    else void start(choice);
  }, [state.kind, start, choice, openSheet]);

  const cancel = useCallback(() => {
    stopAll();
    setState({ kind: "idle" });
  }, [stopAll]);

  return {
    state,
    running: state.kind === "running",
    introOpen,
    openIntro: openSheet,
    closeIntro: () => setIntroOpen(false),
    choice,
    setChoice,
    device,
    start: (c: AsrChoice) => void start(c),
    requestStart,
    cancel,
    dismissError: () => setState({ kind: "idle" }),
  };
}

// ---------------------------------------------------------------------------
// the first-use sheet
// ---------------------------------------------------------------------------

export function AsrIntroSheet({
  open,
  onClose,
  onStart,
  choice,
  onChoice,
  device,
  realLines,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (choice: AsrChoice) => void;
  choice: AsrChoice;
  onChoice: (c: AsrChoice) => void;
  device: AsrDevice;
  /** lines the operator already timed (they never move) */
  realLines: number;
}) {
  const memory = lowMemory();
  const detail: Record<AsrChoice, string> = {
    accurate: `${ASR_MODEL_NAME.accurate}：對得最準，建議用這個。`,
    fast: `${ASR_MODEL_NAME.fast}：下載小、聽得比較快，準度低一些。`,
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="AI 自動對時"
      width={560}
      action={
        <Button variant="filled" onClick={() => onStart(choice)}>
          開始
        </Button>
      }
    >
      <div className="space-y-4 text-[15px] leading-[22px] text-label" data-testid="asr-intro">
        <p>讓 AI 聽這首歌，把每一句歌詞對到唱出來的位置。聽不清楚的句子會依人聲估算，排在對上的句子之間。</p>
        <ul className="space-y-1.5 text-[13px] leading-5 text-label-2">
          <li>
            <span className="font-semibold text-label">在這台電腦上執行</span>：歌曲不會上傳。第一次要下載語音辨識模型（Whisper，來自 Hugging Face），之後留在瀏覽器裡，不用再下載。
          </li>
          <li>
            結果是<span className="font-semibold text-label">建議</span>：每一句都還是「估」，播放檢查、修正幾句之後，再按「確認全部時間」。
          </li>
          {realLines > 0 && <li>已經對好的 {realLines} 句不會被移動。</li>}
        </ul>
        <div role="radiogroup" aria-label="模型" className="overflow-hidden rounded-md bg-fill-4">
          {ASR_CHOICES.map((c) => (
            <label key={c} className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 text-[13px] leading-5 text-label has-[:focus-visible]:bg-fill-3">
              <input type="radio" name="asr-choice" value={c} checked={choice === c} onChange={() => onChoice(c)} className="mt-1 accent-(--tint)" />
              <span className="min-w-0">
                <span className="block font-medium">
                  {ASR_CHOICE_LABEL[c]}（{downloadLabel(c, device)}
                  {c === "accurate" ? "，建議" : ""}）
                </span>
                <span className="block text-label-2">{detail[c]}</span>
              </span>
            </label>
          ))}
        </div>
        {memory != null && (
          <p className="text-[13px] leading-5 text-orange-text" data-testid="asr-low-memory">
            這台電腦的記憶體約 {memory} GB，「準確」可能跑不動，已先選「快速」。
          </p>
        )}
        <p className="text-[12px] leading-4 text-label-2">
          {device === "webgpu" ? "會用顯示卡（WebGPU）加速。" : "用 CPU 執行；一首歌大約要聽幾分鐘，期間可以繼續編輯。"}模型下載自 huggingface.co；語音辨識由 Whisper（MIT）、transformers.js（Apache-2.0）與 ONNX Runtime（MIT）執行。
        </p>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// progress and errors
// ---------------------------------------------------------------------------

function stageText(p: AsrProgress | { stage: "align" }): { label: string; value: number | null } {
  switch (p.stage) {
    case "fetch":
      return { label: "讀取音檔…", value: null };
    case "decode":
      return { label: "解碼音檔…", value: null };
    case "download": {
      const value = p.total > 0 ? p.loaded / p.total : 0;
      return { label: `下載模型 ${Math.floor(value * 100)} %（${Math.round(p.loaded / 1e6)} / ${Math.round(p.total / 1e6)} MB）`, value };
    }
    case "load":
      return { label: "載入模型…", value: null };
    case "listen":
      return { label: `聽歌中 ${mmss(p.heard)} / ${mmss(p.seconds)}`, value: p.seconds > 0 ? p.heard / p.seconds : 0 };
    case "align":
      return { label: "對齊歌詞…", value: null };
  }
}

const ERROR_TEXT: Record<string, string> = {
  download: "模型下載失敗，請檢查網路後重試。",
  offline: "沒有網路：第一次使用要先下載模型，連上網路後再試一次。",
  memory: "這台電腦的記憶體不夠跑「準確」模型，請改用「快速」。",
  decode: "讀不到這首歌的音檔。",
  unknown: "AI 自動對時沒有完成。",
  webgpu: "顯示卡加速失敗。",
};

export function AsrStatus({
  state,
  onCancel,
  onRetry,
  onDismiss,
}: {
  state: AsrUiState;
  onCancel: () => void;
  onRetry: (choice: AsrChoice) => void;
  onDismiss: () => void;
}) {
  if (state.kind === "running") {
    const { label, value } = stageText(state.progress);
    return (
      <Banner
        tone="info"
        role="status"
        icon={<AiTimingIcon size={20} className="text-tint" />}
        title={`AI 自動對時（${ASR_CHOICE_LABEL[state.choice]}）`}
        description="歌曲只在這台電腦上處理，不會上傳；可以繼續編輯歌詞。"
        actions={
          <Button variant="gray" onClick={onCancel}>
            取消
          </Button>
        }
      >
        <div className="mt-2.5" data-testid="asr-progress" data-stage={state.progress.stage}>
          {value == null ? (
            <p className="text-[13px] leading-5 text-label-2">{label}</p>
          ) : (
            <ProgressBar value={value} label={label} aria-label="AI 自動對時進度" />
          )}
        </div>
      </Banner>
    );
  }
  if (state.kind === "error") {
    const lowOnMemory = state.code === "memory" && state.choice === "accurate";
    return (
      <Banner
        tone="error"
        title="AI 自動對時失敗"
        description={
          <>
            {ERROR_TEXT[state.code] ?? ERROR_TEXT.unknown}
            {state.code === "decode" || state.code === "unknown" ? <span className="block break-all">{state.message}</span> : null}
          </>
        }
        actions={
          <>
            <Button variant="plain" onClick={onDismiss}>
              關閉
            </Button>
            {lowOnMemory ? (
              <Button variant="gray" onClick={() => onRetry("fast")}>
                改用快速
              </Button>
            ) : (
              <Button variant="gray" onClick={() => onRetry(state.choice)}>
                重試
              </Button>
            )}
          </>
        }
      />
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 確認全部時間
// ---------------------------------------------------------------------------

export function ConfirmAllAlert({ open, count, onCancel, onConfirm }: { open: boolean; count: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Alert
      open={open}
      title={`確認全部 ${count} 句的時間？`}
      message="「估」的標記會拿掉，這首歌就能在控制台用「跟音檔」自動播放。建議先播放檢查一遍；之後還是可以對拍或拖曳修正，也可以復原。"
      confirmLabel="確認全部時間"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
