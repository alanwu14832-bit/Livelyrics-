"use client";

// 匯出影片 (/p/[id]/export): pre-rendered clips of the song for a festival's media server
// (Resolume, disguise ...). Settings on the left (versions, frame rate, codec, quality, range,
// audio, where to save), the 單格預覽 on the right, and a progress sheet while the export runs.
// Rendering is offline and deterministic (src/components/stage/export/OfflineStage.ts); encoding
// is WebCodecs + mediabunny (src/lib/export/encode.ts).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AppHeader, Banner, Button, EmptyState, InsetGroup, ListRow, ProgressBar, SegmentedControl, Select, Sheet, Skeleton, SkeletonGroup, Spinner, Switch, TextField, cx } from "@/components/ui";
import { DownloadSimpleIcon, ExportIcon, FilmStripIcon, ImageIcon, MonitorPlayIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { ProjectHeading } from "@/components/home/ProjectHeading";
import { NOT_FOUND_HEADER_TITLE, ProjectNotFound } from "@/components/home/ProjectNotFound";
import { PUSH } from "@/components/home/transitions";
import { api } from "@/lib/api-client";
import { alphaSupported, planAudioCodec, planVideoCodec, webCodecsAvailable, type AudioCodecChoice, type VideoPlan } from "@/lib/export/encode";
import { FRAME_RATES, FRAME_RATE_IDS, durationLabel, fpsOf, frameCount, parseTimeInput, type FrameRateId } from "@/lib/export/frames";
import {
  EXPORT_VARIANTS,
  QUALITY_INFO,
  VARIANT_INFO,
  clampRange,
  estimateBytes,
  exportNeedsSizeConfirm,
  formatBytes,
  rangeFor,
  sectionLabel,
  songDuration,
  targetBitrate,
  type ExportSettings,
  type ExportVariant,
  type LyricLayerFormat,
  type QualityPreset,
  type VideoCodecChoice,
} from "@/lib/export/settings";
import { aspectLabel } from "@/lib/output";
import { SafetyCheck, SafetyOffAlert, safetyOf } from "@/components/console/SafetyControls";
import { safetySummary } from "@/lib/stage/safety";
import { formatTime, formatTimeShort } from "@/lib/timeline";
import type { Project } from "@/lib/types";
import { ExportCanceled, debugExportToOpfs, debugStage, renderPreview, runExport, type DebugExportOptions, type ExportProgress, type ExportResult } from "./runExport";
import { PreviewRunner } from "./preview-runner";

export interface ExportHeaderInfo {
  title: string;
  artist: string;
  palette: string[];
}

type Load = { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string; notFound: boolean };

interface Capability {
  checking: boolean;
  webcodecs: boolean;
  plans: Partial<Record<ExportVariant, VideoPlan>>;
  missing: ExportVariant[];
  alpha: boolean;
  audio: Partial<Record<"mp4" | "webm", AudioCodecChoice | null>>;
}

type JobState =
  | { kind: "idle" }
  | { kind: "running"; progress: ExportProgress; hidden: boolean; folder: string | null }
  | { kind: "done"; result: ExportResult; folder: string | null }
  | { kind: "error"; message: string };

interface PreviewState {
  busy: boolean;
  t: number | null;
  images: { full: string; background: string; matte: string } | null;
  error: string | null;
  warnings: string[];
}

type PreviewView = "full" | "background" | "matte";

type DirectoryPicker = (opts?: { mode?: "read" | "readwrite"; id?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle>;

function directoryPicker(): DirectoryPicker | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof fn === "function" ? fn.bind(window) : null;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function defaultPreviewTime(project: Project, initial: number | null): number {
  const d = songDuration(project);
  if (initial != null) return Math.min(initial, Math.max(0, d - 0.05));
  // a moment where a line is already on screen: 1.5 s into the first timed line
  const first = project.lyrics.lines.find((l) => l.start != null && l.text.trim());
  return first?.start != null ? Math.min(first.start + 1.5, Math.max(0, d - 0.05)) : Math.min(10, d / 2);
}

export function ExportClient({ id, initial, initialTime }: { id: string; initial: ExportHeaderInfo | null; initialTime: number | null }) {
  const [project, setProject] = useState<Project | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const [variants, setVariants] = useState<ExportVariant[]>(["full", "background", "lyrics"]);
  const [lyricFormat, setLyricFormat] = useState<LyricLayerFormat>("matte");
  const [codec, setCodec] = useState<VideoCodecChoice>("avc");
  const [rateId, setRateId] = useState<FrameRateId>("30");
  const [quality, setQuality] = useState<QualityPreset>("high");
  const [rangeMode, setRangeMode] = useState<"song" | "sections" | "custom">("song");
  const [customStart, setCustomStart] = useState("0:00.00");
  const [customEnd, setCustomEnd] = useState("0:10.00");
  const [fromSection, setFromSection] = useState(0);
  const [toSection, setToSection] = useState(0);
  const [withAudio, setWithAudio] = useState(false);
  const [toFolder, setToFolder] = useState(true);
  const [canPickFolder, setCanPickFolder] = useState(false);

  const [cap, setCap] = useState<Capability>({ checking: true, webcodecs: true, plans: {}, missing: [], alpha: false, audio: {} });
  const [job, setJob] = useState<JobState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  /** LED 安全模式 for this export: null = the project's own setting (default); off only after a confirm */
  const [safeOverride, setSafeOverride] = useState<boolean | null>(null);
  const [askUnsafe, setAskUnsafe] = useState<null | "toggle" | "start">(null);
  // > 2 GB estimated: asked before the export starts (whether LED safety was already confirmed off)
  const [askSize, setAskSize] = useState<null | { unsafe: boolean }>(null);
  const [previewRunner] = useState(() => new PreviewRunner());
  const [preview, setPreview] = useState<PreviewState>({ busy: false, t: null, images: null, error: null, warnings: [] });
  const [previewView, setPreviewView] = useState<PreviewView>("full");
  const [timeText, setTimeText] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .getProject(id)
      .then((p) => {
        if (!alive) return;
        setProject(p);
        setLoad({ kind: "ok" });
        const n = p.plan?.sections.length ?? 0;
        setToSection(Math.max(0, n - 1));
        setTimeText(formatTime(defaultPreviewTime(p, initialTime)));
        setCustomEnd(formatTime(Math.min(10, songDuration(p))));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoad({ kind: "error", message, notFound: /找不到|404/.test(message) });
      });
    // the File System Access API is only known on the client
    setCanPickFolder(directoryPicker() != null);
    return () => {
      alive = false;
    };
  }, [id, initialTime]);

  // development diagnostics for the render checks (scripts drive these from the browser)
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !project) return;
    const w = window as unknown as { __livelyricsExport?: unknown };
    w.__livelyricsExport = { debugStage: (t: number, fps = 30) => debugStage(project, t, fps), exportToOpfs: (o: DebugExportOptions) => debugExportToOpfs(project, o) };
    return () => {
      delete w.__livelyricsExport;
    };
  }, [project]);

  const rate = FRAME_RATES[rateId];
  const fps = fpsOf(rate);
  const width = project?.output?.width ?? 1920;
  const height = project?.output?.height ?? 1080;
  const duration = project ? songDuration(project) : 0;
  const range = useMemo(
    () => {
      if (!project) return { start: 0, end: 0 };
      if (rangeMode === "custom") return clampRange({ start: parseTimeInput(customStart) ?? 0, end: parseTimeInput(customEnd) ?? duration }, duration);
      return clampRange(rangeMode === "song" ? { start: 0, end: duration } : rangeFor(project, fromSection, toSection), duration);
    },
    [project, rangeMode, fromSection, toSection, duration, customStart, customEnd],
  );
  const frames = frameCount(range.end - range.start, rate);

  // what this browser can encode for the chosen settings
  useEffect(() => {
    if (!project) return;
    let alive = true;
    const run = async () => {
      if (!webCodecsAvailable()) {
        setCap({ checking: false, webcodecs: false, plans: {}, missing: [...variants], alpha: false, audio: {} });
        return;
      }
      setCap((c) => ({ ...c, checking: true }));
      const bitrateFor = (c: VideoCodecChoice) => targetBitrate(width, height, fps, quality, c);
      const opaque = await planVideoCodec(codec, width, height, fps, bitrateFor, false);
      const alpha = await alphaSupported(width, height, fps, bitrateFor("vp9"));
      const plans: Partial<Record<ExportVariant, VideoPlan>> = {};
      const missing: ExportVariant[] = [];
      for (const v of variants) {
        if (v === "lyrics" && lyricFormat === "alpha") {
          const p = alpha ? await planVideoCodec("vp9", width, height, fps, bitrateFor, true) : null;
          if (p) plans[v] = p;
          else missing.push(v);
        } else if (opaque) plans[v] = opaque;
        else missing.push(v);
      }
      const audio: Capability["audio"] = {};
      for (const c of new Set(Object.values(plans).map((p) => p!.container))) audio[c] = await planAudioCodec(c);
      if (alive) setCap({ checking: false, webcodecs: true, plans, missing, alpha, audio });
    };
    const timer = setTimeout(() => void run(), 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project, variants, lyricFormat, codec, width, height, fps, quality]);

  // keep the screen on while exporting and notice when the tab goes to the background
  const running = job.kind === "running";
  useEffect(() => {
    if (!running) return;
    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          lock = await navigator.wakeLock.request("screen");
          if (disposed) void lock.release().catch(() => {});
        }
      } catch {
        /* not allowed here: the warning in the sheet still applies */
      }
    };
    const onVisibility = () => {
      setJob((j) => (j.kind === "running" ? { ...j, hidden: j.hidden || document.visibilityState === "hidden" } : j));
      if (document.visibilityState === "visible") void acquire();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void lock?.release().catch(() => {});
    };
  }, [running]);

  const baseSafety = safetyOf(project);
  const exportSafe = safeOverride ?? baseSafety.enabled;
  // the project the offline renderer gets: the output's LED safety settings, on or off for this export
  const exportProject = useMemo(
    () => (project ? { ...project, output: { ...project.output, safety: { ...safetyOf(project), enabled: exportSafe } } } : null),
    [project, exportSafe],
  );
  const settings: ExportSettings = { variants, lyricFormat, codec, quality, rate, range, audio: withAudio };
  const plannedBytes = Object.values(cap.plans).reduce((a, p) => a + estimateBytes(p!.bitrate, range.end - range.start, withAudio), 0);
  const canStart = !!project && !cap.checking && variants.length > 0 && Object.keys(cap.plans).length > 0 && frames > 0 && !running;

  const start = useCallback(async (confirmed: { unsafe?: boolean; size?: boolean } = {}) => {
    if (!exportProject) return;
    // an export without LED safety always asks first
    if (!exportProject.output.safety.enabled && !confirmed.unsafe) {
      setAskUnsafe("start");
      return;
    }
    // a very large export (a long set, the highest quality) asks too: disk space, hours of rendering
    if (exportNeedsSizeConfirm(plannedBytes) && !confirmed.size) {
      setAskSize({ unsafe: !!confirmed.unsafe });
      return;
    }
    const project = exportProject;
    let dir: FileSystemDirectoryHandle | null = null;
    let folder: string | null = null;
    const picker = directoryPicker();
    if (toFolder && picker) {
      try {
        dir = await picker({ mode: "readwrite", id: "livelyrics-export" });
        folder = dir.name;
      } catch {
        return; // the operator closed the picker
      }
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setJob({ kind: "running", progress: { phase: "prepare", frame: 0, total: frames, fps: 0, eta: null, t: range.start }, hidden: document.visibilityState === "hidden", folder });
    try {
      const result = await runExport({
        project,
        settings,
        plans: cap.plans,
        audioCodec: cap.audio,
        dir,
        signal: controller.signal,
        onProgress: (progress) => setJob((j) => (j.kind === "running" ? { ...j, progress } : j)),
      });
      setJob({ kind: "done", result, folder });
    } catch (e) {
      if (e instanceof ExportCanceled) setJob({ kind: "idle" });
      else setJob({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      abortRef.current = null;
    }
    // settings is rebuilt every render; the values it holds are the deps below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportProject, toFolder, frames, range, cap, variants, lyricFormat, codec, quality, rate, withAudio, plannedBytes]);

  const previewTime = parseTimeInput(timeText);
  const runPreview = useCallback(async () => {
    if (!exportProject) return;
    const t = parseTimeInput(timeText);
    if (t == null) return;
    const at = Math.min(Math.max(0, t), Math.max(0, duration - 0.001));
    // one render at a time: a second press while one runs is ignored (never two stages at once)
    if (previewRunner.busy) return;
    setPreview((p) => ({ ...p, busy: true, error: null }));
    try {
      const r = await previewRunner.run((signal) => renderPreview(exportProject, at, fps, signal));
      if (!r) setPreview((p) => ({ ...p, busy: false })); // cancelled: keep the last frame
      else setPreview({ busy: false, t: at, images: { full: r.value.full, background: r.value.background, matte: r.value.matte }, error: null, warnings: r.value.warnings });
    } catch (e) {
      setPreview((p) => ({ ...p, busy: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [exportProject, timeText, duration, fps, previewRunner]);
  // leaving the page stops a running preview
  useEffect(() => () => previewRunner.cancel(), [previewRunner]);

  // ---------------------------------------------------------------------------

  const header = (actions?: ReactNode, titleOverride?: string) => (
    <AppHeader
      back
      width="full"
      title={titleOverride}
      heading={
        titleOverride == null && (project || initial) ? (
          <ProjectHeading id={id} title={project?.meta.title || initial?.title || "載入中…"} subtitle={(project?.meta.artist ?? initial?.artist) || undefined} palette={project ? (project.plan?.keyVisual.palette ?? []).map((c) => c.hex) : (initial?.palette ?? [])} />
        ) : undefined
      }
      actions={actions}
    />
  );

  if (load.kind === "loading") {
    return (
      <div className="min-h-dvh">
        {header()}
        <SkeletonGroup label="載入匯出設定" className="grid gap-8 px-(--page-gutter) pt-6 lg:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-6">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-56 rounded-lg" />
          </div>
          <Skeleton className="aspect-video rounded-2xl" />
        </SkeletonGroup>
      </div>
    );
  }

  if (load.kind === "error" || !project) {
    const notFound = load.kind === "error" && load.notFound;
    return (
      <div className="flex min-h-dvh flex-col">
        {header(undefined, notFound ? NOT_FOUND_HEADER_TITLE : "無法載入")}
        {notFound ? (
          <ProjectNotFound />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center pb-[52px]">
            <EmptyState icon={WarningCircleIcon} title="無法載入這個作品" description={load.kind === "error" ? load.message : ""} action={<Button variant="tinted" onClick={() => window.location.reload()}>重新載入</Button>} />
          </div>
        )}
      </div>
    );
  }

  const sections = project.plan?.sections ?? [];
  const noPlan = !project.plan;
  const toggleVariant = (v: ExportVariant, on: boolean) => setVariants((vs) => (on ? EXPORT_VARIANTS.filter((x) => x === v || vs.includes(x)) : vs.filter((x) => x !== v)));
  const opaquePlan = Object.entries(cap.plans).find(([v, p]) => p && !(v === "lyrics" && p.alpha))?.[1];
  const fallbackNote = opaquePlan?.fallback ?? null;
  const previewImage = preview.images ? preview.images[previewView] : null;

  return (
    <div className="min-h-dvh">
      {header(
        <Button href={`/p/${encodeURIComponent(id)}`} transitionTypes={PUSH} variant="gray" icon={MonitorPlayIcon}>
          控制台
        </Button>,
      )}

      <div className="grid items-start gap-x-10 gap-y-8 px-(--page-gutter) pt-6 pb-24 lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-7">
          <div>
            <h1 className="text-[28px] leading-[34px] font-bold text-label">匯出影片</h1>
            <p className="mt-1 text-[15px] leading-[22px] text-label-2">預先算好的影片，給音樂祭的媒體伺服器（Resolume、disguise）直接播放。每一格都照歌曲時間算出，和投影畫面一致。</p>
          </div>

          {noPlan && <Banner tone="warning" title="還沒有設計方案" description="先完成設計，匯出的影片才會有場景與歌詞樣式。" />}
          {!cap.webcodecs && <Banner tone="error" title="這個瀏覽器無法編碼影片" description="請改用最新版的 Chrome 或 Edge（需要 WebCodecs）。" />}

          <InsetGroup header="版本" footer="三個版本逐格對齊，現場可以同時從第一格開始播放。">
            {EXPORT_VARIANTS.map((v) => (
              <ListRow key={v} title={VARIANT_INFO[v].label} subtitle={VARIANT_INFO[v].detail} htmlFor={`variant-${v}`} accessory={<Switch id={`variant-${v}`} checked={variants.includes(v)} onChange={(on) => toggleVariant(v, on)} disabled={running} />} />
            ))}
          </InsetGroup>

          {variants.includes("lyrics") && (
            <InsetGroup
              header="歌詞層格式"
              footer={
                lyricFormat === "alpha"
                  ? cap.alpha
                    ? "背景是透明的影片（WebM），媒體伺服器可以直接疊在其他畫面上。"
                    : "這個瀏覽器做不出透明背景的影片，請改用黑底白字。"
                  : "黑底白字：白色的地方就是歌詞。交給現場的 VJ，用「疊加／濾色」或當作遮罩（luma matte）疊在畫面上。"
              }
            >
              <div className="px-(--row-pad-x) py-2.5">
                <SegmentedControl
                  label="歌詞層格式"
                  fullWidth
                  value={lyricFormat}
                  onChange={setLyricFormat}
                  options={[
                    { value: "matte", label: "黑底白字" },
                    { value: "alpha", label: "透明 WebM", disabled: !cap.alpha && !cap.checking },
                  ]}
                />
              </div>
            </InsetGroup>
          )}

          <InsetGroup
            header="規格"
            footer={fallbackNote ?? (opaquePlan ? `${opaquePlan.container === "mp4" ? "MP4 影片，相容性最好" : "WebM 影片"}（${opaquePlan.label}，約 ${(opaquePlan.bitrate / 1e6).toFixed(1)} Mbps）；每一秒都可以直接跳播。` : cap.checking ? "檢查這台電腦能輸出哪些影片格式…" : "")}
          >
            <ListRow title="畫面尺寸" value={`${width} × ${height}`} subtitle={`${aspectLabel(width, height)}，在控制台的「控制」分頁「輸出畫面」修改`} />
            <SegmentRow label="影格率">
              <SegmentedControl label="影格率" value={rateId} onChange={setRateId} fullWidth options={FRAME_RATE_IDS.map((r) => ({ value: r, label: <span className="t-latin tabular">{FRAME_RATES[r].label}</span> }))} />
            </SegmentRow>
            <SegmentRow label="檔案格式">
              <SegmentedControl
                label="檔案格式"
                value={codec}
                onChange={setCodec}
                fullWidth
                options={[
                  { value: "avc", label: "MP4（通用）", ariaLabel: "MP4（H.264）" },
                  { value: "vp9", label: "WebM", ariaLabel: "WebM（VP9）" },
                ]}
              />
            </SegmentRow>
            <SegmentRow label="畫質">
              <SegmentedControl label="畫質" value={quality} onChange={setQuality} fullWidth options={(Object.keys(QUALITY_INFO) as QualityPreset[]).map((q) => ({ value: q, label: QUALITY_INFO[q].label }))} />
            </SegmentRow>
          </InsetGroup>

          <InsetGroup header="範圍" footer={`${formatTime(range.start)} 到 ${formatTime(range.end)}，${durationLabel(range.end - range.start)}，共 ${frames.toLocaleString("zh-TW")} 格。`}>
            <div className="px-(--row-pad-x) py-2.5">
              <SegmentedControl
                label="範圍"
                fullWidth
                value={rangeMode}
                onChange={setRangeMode}
                options={[
                  { value: "song", label: "整首" },
                  { value: "sections", label: "段落範圍", disabled: sections.length === 0 },
                  { value: "custom", label: "自訂" },
                ]}
              />
            </div>
            {rangeMode === "custom" && (
              <div className="flex items-center gap-2 px-(--row-pad-x) pb-3">
                <TextField aria-label="起點" value={customStart} onChange={(e) => setCustomStart(e.target.value)} invalid={parseTimeInput(customStart) == null} className="flex-1 font-numeric tabular" />
                <span className="text-[13px] text-label-2">到</span>
                <TextField aria-label="終點" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} invalid={parseTimeInput(customEnd) == null} className="flex-1 font-numeric tabular" />
              </div>
            )}
            {rangeMode === "sections" && sections.length > 0 && (
              <div className="flex items-center gap-2 px-(--row-pad-x) pb-3">
                <Select aria-label="從段落" value={String(fromSection)} onChange={(e) => setFromSection(Number(e.target.value))} className="flex-1">
                  {sections.map((s, i) => (
                    <option key={s.id ?? i} value={i}>
                      {sectionLabel(project.plan, i)}（{formatTimeShort(s.start)}）
                    </option>
                  ))}
                </Select>
                <span className="text-[13px] text-label-2">到</span>
                <Select aria-label="到段落" value={String(toSection)} onChange={(e) => setToSection(Number(e.target.value))} className="flex-1">
                  {sections.map((s, i) => (
                    <option key={s.id ?? i} value={i}>
                      {sectionLabel(project.plan, i)}（{formatTimeShort(s.end)}）
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </InsetGroup>

          <InsetGroup
            header="LED 安全模式"
            footer={
              exportSafe
                ? `${safetySummary({ ...baseSafety, enabled: true })}。完整與背景版本照這個設定算出，說明文字檔會寫明；黑底白字的歌詞層是給 VJ 疊字用的遮罩，不降亮度。`
                : "這次匯出不套用亮度上限與閃爍限制。交給音樂祭前請再確認。"
            }
          >
            <ListRow
              title="套用 LED 安全模式"
              subtitle={exportSafe ? `最高亮度 ${Math.round(baseSafety.brightness * 100)}%，閃爍每秒最多 3 次` : "已關閉：全亮度、不限制閃爍"}
              htmlFor="export-safe"
              accessory={
                <Switch
                  id="export-safe"
                  checked={exportSafe}
                  disabled={running}
                  onChange={(on) => {
                    if (on) setSafeOverride(true);
                    else setAskUnsafe("toggle");
                  }}
                />
              }
            />
          </InsetGroup>
          {!exportSafe && <Banner tone="warning" title="沒有 LED 安全保護" description="閃白、光暈與快速閃爍會照原設計輸出，LED 牆播放時可能讓前排觀眾不適。" />}
          {exportProject && <SafetyCheck project={exportProject} title="安全模式調整的段落" variant="page" footer="影片照這些調整算出，並套用亮度上限與閃爍限制；說明文字檔會寫明使用的設定。" />}

          <InsetGroup header="其他" footer={withAudio ? `附上歌曲音訊（${cap.audio.mp4 === "aac" ? "AAC" : "Opus"}），只建議用在排練預覽；交給音樂祭的版本請關閉。` : "交給音樂祭的影片通常不含聲音，現場用時間碼（timecode）或節拍器對齊第一格。"}>
            <ListRow title="附上音訊" subtitle="排練預覽用" htmlFor="with-audio" accessory={<Switch id="with-audio" checked={withAudio} onChange={setWithAudio} disabled={running} />} />
            {canPickFolder && (
              <ListRow
                title="直接存到資料夾"
                subtitle={toFolder ? "開始時選一個資料夾，邊算邊寫入，長片也不佔記憶體" : "完成後逐一下載（檔案先放在記憶體）"}
                htmlFor="to-folder"
                accessory={<Switch id="to-folder" checked={toFolder} onChange={setToFolder} disabled={running} />}
              />
            )}
          </InsetGroup>

          {!toFolder && plannedBytes > 1.5e9 && <Banner tone="warning" title="檔案很大" description={`預估約 ${formatBytes(plannedBytes)}，放在記憶體可能讓分頁當掉。建議開啟「直接存到資料夾」或縮短範圍。`} />}
          {cap.missing.length > 0 && !cap.checking && (
            <Banner tone="error" title="有版本無法編碼" description={`${cap.missing.map((v) => VARIANT_INFO[v].label).join("、")}：這個瀏覽器做不出 ${width} × ${height}、每秒 ${rate.label} 格的影片。請改用 Chrome 或 Edge，或換一個影格率。`} />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="filled" size="lg" icon={ExportIcon} onClick={() => void start()} disabled={!canStart} loading={cap.checking && variants.length > 0}>
              開始匯出
            </Button>
            <span className="text-[13px] leading-5 text-label-2 tabular">{Object.keys(cap.plans).length > 0 ? `${Object.keys(cap.plans).length} 個檔案，預估 ${formatBytes(plannedBytes)}` : variants.length === 0 ? "至少選一個版本" : ""}</span>
          </div>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-[68px]">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[150px] min-w-0">
              <label htmlFor="preview-time" className="mb-1.5 block text-[13px] leading-5 text-label-2">
                單格預覽的時間
              </label>
              <TextField id="preview-time" size="lg" value={timeText} onChange={(e) => setTimeText(e.target.value)} invalid={previewTime == null} className="font-numeric tabular" onKeyDown={(e) => { if (e.key === "Enter") void runPreview(); }} />
            </div>
            <Button variant="gray" icon={ImageIcon} onClick={() => void runPreview()} loading={preview.busy} disabled={preview.busy || previewTime == null || running} data-testid="preview-frame">
              單格預覽
            </Button>
            {preview.images && (
              <SegmentedControl
                label="預覽的版本"
                value={previewView}
                onChange={setPreviewView}
                className="ml-auto"
                options={[
                  { value: "full", label: "完整" },
                  { value: "background", label: "背景" },
                  { value: "matte", label: "歌詞層" },
                ]}
              />
            )}
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-black ring-hairline" style={{ aspectRatio: `${width} / ${height}` }}>
            {previewImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewImage} alt={`單格預覽：${preview.t != null ? formatTime(preview.t) : ""}`} className="absolute inset-0 size-full object-contain" data-export-preview={previewView} />
            ) : (
              !preview.busy && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-[13px] leading-5 text-white/70">
                  <FilmStripIcon size={44} />
                  <span>按「單格預覽」，算出這個時間點的一格，確認字型、素材和歌詞位置再開始長時間的匯出。</span>
                </div>
              )
            )}
            {preview.busy && (
              // the frame is computed on this page (the stage needs its fonts and media): say so,
              // and let the operator stop it
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center text-white" role="status" data-preview-busy="">
                <Spinner size={28} />
                <span className="text-[15px] leading-[22px] font-semibold">正在算這一格…</span>
                <span className="max-w-[28em] text-[13px] leading-5 text-white/70">要重播前面幾秒才能算準，可能要十幾秒；這段時間頁面會比較慢。</span>
                <Button size="sm" variant="gray" onClick={() => previewRunner.cancel()} data-testid="preview-cancel">
                  取消
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-5 text-label-2">
            {preview.t != null && <span className="tabular">歌曲時間 {formatTime(preview.t)}，{width} × {height}</span>}
            {preview.images && previewImage && (
              <Button variant="plain" size="sm" icon={DownloadSimpleIcon} onClick={() => void fetch(previewImage).then((r) => r.blob()).then((b) => download(b, `preview_${previewView}_${Math.round((preview.t ?? 0) * 1000)}ms.png`))}>
                下載 PNG
              </Button>
            )}
          </div>
          {preview.error && <Banner tone="error" title="預覽失敗" description={preview.error} />}
          {preview.warnings.map((w) => (
            <Banner key={w} tone="warning" title="注意" description={w} />
          ))}
        </div>
      </div>

      <SafetyOffAlert
        open={askUnsafe != null}
        context="export"
        onCancel={() => setAskUnsafe(null)}
        onConfirm={() => {
          const why = askUnsafe;
          setAskUnsafe(null);
          setSafeOverride(false);
          if (why === "start") void start({ unsafe: true });
        }}
      />
      <Alert
        open={askSize != null}
        title={`這次匯出預估 ${formatBytes(plannedBytes)}`}
        message={`${Object.keys(cap.plans).length} 個檔案，共 ${durationLabel(range.end - range.start)}。請確認存放的磁碟有足夠空間；算完可能要很久，電腦請接上電源。想要小一點，可以縮短範圍、少選幾個版本或把畫質調成「標準」。`}
        confirmLabel="仍要匯出"
        onCancel={() => setAskSize(null)}
        onConfirm={() => {
          const ask = askSize;
          setAskSize(null);
          void start({ unsafe: ask?.unsafe, size: true });
        }}
      />
      <ProgressSheet
        job={job}
        onCancel={() => abortRef.current?.abort()}
        onClose={() => setJob({ kind: "idle" })}
      />
    </div>
  );
}

function ProgressSheet({ job, onCancel, onClose }: { job: JobState; onCancel: () => void; onClose: () => void }) {
  const open = job.kind !== "idle";
  const run = job.kind === "running" ? job : null;
  const done = job.kind === "done" ? job : null;
  const error = job.kind === "error" ? job : null;
  const p = run?.progress;
  const title = run ? (p?.phase === "prepare" ? "準備中…" : p?.phase === "finalize" ? "寫入檔案…" : "匯出中") : done ? "匯出完成" : "匯出失敗";
  return (
    <Sheet
      open={open}
      onClose={run ? onCancel : onClose}
      title={title}
      dismissible={!run}
      cancelLabel={run ? null : "關閉"}
      dragToDismiss={!run}
      action={run ? <Button variant="destructive" onClick={onCancel}>取消匯出</Button> : <Button variant="filled" onClick={onClose}>完成</Button>}
    >
      <div className="space-y-5 px-5 pt-2 pb-6">
        {run && p && (
          <>
            <ProgressBar value={p.total ? p.frame / p.total : 0} label={p.phase === "prepare" ? "載入字型、素材與著色器" : `第 ${p.frame.toLocaleString("zh-TW")} / ${p.total.toLocaleString("zh-TW")} 格`} showValue />
            <dl className="grid grid-cols-3 gap-3 text-center">
              <Stat label="每秒算出" value={p.fps > 0 ? `${p.fps.toFixed(1)} 格` : "…"} />
              <Stat label="剩餘時間" value={p.eta != null ? formatTimeShort(p.eta) : "…"} />
              <Stat label="歌曲時間" value={formatTimeShort(p.t)} />
            </dl>
            <p className={cx("text-[13px] leading-5", run.hidden ? "text-orange-text" : "text-label-2")}>
              {run.hidden ? "剛才分頁被切到背景，瀏覽器會放慢速度。請讓這個分頁留在前景直到完成。" : "請讓這個分頁留在前景，不要最小化或切到其他分頁；螢幕會保持開啟。"}
              {run.folder ? `檔案直接寫入「${run.folder}」。` : ""}
            </p>
          </>
        )}
        {done && (
          <>
            <p className="text-[15px] leading-[22px] text-label">
              {done.result.frames.toLocaleString("zh-TW")} 格（{durationLabel(done.result.seconds)}），用時 {formatTimeShort(done.result.elapsed)}。{done.folder ? `已存到「${done.folder}」。` : "按下載儲存每個檔案。"}
            </p>
            <InsetGroup>
              {done.result.files.map((f) => (
                <ListRow
                  key={f.name}
                  title={<span className="text-[15px] break-all">{f.name}</span>}
                  subtitle={`${f.label}${f.bytes ? `，${formatBytes(f.bytes)}` : ""}`}
                  accessory={
                    f.blob ? (
                      <Button variant="gray" size="sm" icon={DownloadSimpleIcon} onClick={() => download(f.blob!, f.name)} data-export-file={f.name}>
                        下載
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </InsetGroup>
            {done.result.warnings.map((w) => (
              <Banner key={w} tone="warning" title="注意" description={w} />
            ))}
          </>
        )}
        {error && <Banner tone="error" title="匯出沒有完成" description={error.message} />}
      </div>
    </Sheet>
  );
}

/** A list row with a label and a segmented control on the right (separator like ListRow). */
function SegmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-(--row-min-h) items-center gap-3 px-(--row-pad-x) py-2 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-(--row-pad-x) after:h-(--hairline) after:bg-separator last:after:hidden">
      <span className="shrink-0 text-[17px] leading-[22px] whitespace-nowrap text-label">{label}</span>
      <div className="ml-auto w-[248px] min-w-0">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-fill-4 px-2 py-2.5">
      <dt className="text-[12px] leading-4 text-label-2">{label}</dt>
      <dd className="mt-0.5 font-numeric text-[17px] leading-[22px] font-semibold text-label tabular">{value}</dd>
    </div>
  );
}
