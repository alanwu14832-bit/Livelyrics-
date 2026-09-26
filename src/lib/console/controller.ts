// The operator console's engine. Owns the clock (the <audio> element in TRACK mode, a
// virtual cue clock in LIVE mode), every operator decision (overrides, cues, offset) and
// the link to the projection window: it writes StageState into a StageStore for the
// console's own preview and mirrors it onto BroadcastChannel(channelName(id)).
//
// Framework-agnostic: React binds to it through subscribe()/getSnapshot() (low-frequency
// UI state) and `store` (per-frame stage state). attach()/detach() are symmetric and
// repeatable, so React StrictMode's mount → unmount → mount is safe.

import { api } from "@/lib/api-client";
import { createMediaElementAnalyser, createMicAnalyser, listAudioInputs, resumeAudioContext, type AudioInputDevice, type LiveAnalyser } from "@/lib/audio/live";
import {
  DEFAULT_OVERRIDES,
  channelName,
  createStageStore,
  initialStageState,
  type LiveAudioFeatures,
  type PlaybackMode,
  type StageMessage,
  type StageOverrides,
  type StageState,
  type WritableStageStore,
} from "@/lib/stage/protocol";
import { beatPhaseAt, lineIndexAt, sectionIndexAt } from "@/lib/timeline";
import type { DesignPlan, LyricLine, PipelineEvent, PipelineStepId, Project, SceneId } from "@/lib/types";
import { LiveClock } from "./live-clock";
import {
  effectiveDuration,
  lastStartedLine,
  liveHoldTime,
  liveNextLine,
  livePrevLine,
  nextTimedLineAfter,
  timedRatio,
  trackNextLine,
  trackPrevLine,
} from "./navigation";
import { computeWaveformPeaks } from "./peaks";
import { patchSection, sceneBank, type SectionPatch } from "./plan-edit";
import { clampOffset, defaultSettings, hasStoredSettings, loadSettings, PLAYBACK_RATES, saveSettings, type ConsoleSettings } from "./settings";
import { TapClock } from "./tap";

// ---------------------------------------------------------------------------
// Snapshot (what the React UI renders)
// ---------------------------------------------------------------------------

export type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "not-found" }
  | { status: "error"; message: string };

export interface AudioStatus {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  buffering: boolean;
}

export interface OutputStatus {
  connected: boolean;
  /** number of projection windows answering pings */
  count: number;
  /** device pixels of the most recently heard output */
  width: number;
  height: number;
  fullscreen: boolean;
}

export interface MicStatus {
  status: "off" | "starting" | "on" | "error";
  error: string | null;
  deviceId: string;
  devices: AudioInputDevice[];
}

export interface SaveStatus {
  status: "idle" | "pending" | "saving" | "saved" | "error";
  error: string | null;
}

export interface RedesignLogEntry {
  id: number;
  kind: "step" | "log" | "search" | "error" | "done";
  step?: PipelineStepId;
  status?: "start" | "done" | "skipped" | "error";
  message: string;
}

export interface RedesignState {
  running: boolean;
  instruction: string;
  log: RedesignLogEntry[];
  /** streamed designer text (tail) */
  text: string;
  error: string | null;
  /** epoch ms of the last successful re-design */
  finishedAt: number | null;
}

export type NoticeTone = "info" | "ok" | "warn" | "error";

export interface Notice {
  id: number;
  tone: NoticeTone;
  message: string;
}

export interface ConsoleSnapshot {
  load: LoadState;
  project: Project | null;
  mode: PlaybackMode;
  /** TRACK: audio playing; LIVE: virtual clock running */
  playing: boolean;
  /** LIVE: the clock reached the next line's start and waits for a cue */
  liveHeld: boolean;
  offset: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  /** effective song duration, seconds */
  duration: number;
  audio: AudioStatus;
  output: OutputStatus;
  /** another console tab is driving the same projection channel */
  otherConsole: boolean;
  mic: MicStatus;
  tap: { bpm: number | null; count: number };
  /** keyboard "standby" line (Enter sends it) */
  selectedIndex: number | null;
  save: SaveStatus;
  redesign: RedesignState;
  notices: Notice[];
  /** waveform computed in the browser when the project has no stored analysis peaks */
  fallbackPeaks: number[] | null;
}

const TICK_MS = 33;
const HEARTBEAT_MS = 1000;
const OUTPUT_TIMEOUT_MS = 3000;
const SAVE_DEBOUNCE_MS = 700;
const PROJECT_BROADCAST_MS = 100;
const NOTICE_MS = 4500;
const POLL_PROCESSING_MS = 3000;
const REDESIGN_TEXT_TAIL = 6000;
const REDESIGN_LOG_MAX = 200;
const DELTA_FLUSH_MS = 150;

const NO_AUDIO: LiveAudioFeatures = { level: 0, bass: 0, onset: 0, beatPhase: 1 };

const STEP_LABELS: Record<PipelineStepId, string> = {
  analyze: "音訊分析",
  lyrics: "歌詞",
  research: "研究",
  design: "設計",
  done: "完成",
};

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

function mediaErrorMessage(el: HTMLMediaElement): string {
  switch (el.error?.code) {
    case 1:
      return "音檔載入被中斷。";
    case 2:
      return "網路錯誤，音檔無法載入。";
    case 3:
      return "音檔解碼失敗，檔案可能已損毀。";
    case 4:
      return "找不到音檔，或瀏覽器不支援這個格式。";
    default:
      return "音檔無法載入。";
  }
}

function linesOf(project: Project | null): LyricLine[] {
  return project?.lyrics?.lines ?? [];
}

export class ConsoleController {
  readonly id: string;
  readonly store: WritableStageStore;

  private snapshot: ConsoleSnapshot;
  private readonly listeners = new Set<() => void>();
  private settings: ConsoleSettings;
  private settingsFromStorage = false;

  private attached = false;
  private channel: BroadcastChannel | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioCleanup: (() => void) | null = null;
  private elementAnalyser: LiveAnalyser | null = null;
  private micAnalyser: LiveAnalyser | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private loadAbort: AbortController | null = null;
  private peaksAbort: AbortController | null = null;
  private windowCleanup: (() => void) | null = null;

  // stage state owned by the console
  private overrides: StageOverrides = { ...DEFAULT_OVERRIDES };
  private lineIndex: number | null = null;
  private lineStartedAt = Date.now();
  private sectionIndex: number | null = null;
  private readonly clock = new LiveClock();
  private liveLine: number | null = null;
  private lastCued: number | null = null;
  private readonly tapClock = new TapClock();

  // projection link
  private readonly outputs = new Map<string, { at: number; width: number; height: number; fullscreen: boolean }>();
  private lastOtherConsoleAt = 0;
  private outputWindow: Window | null = null;
  private projectBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private lastProjectBroadcast = 0;

  // persistence
  private pendingPlan: DesignPlan | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveChain: Promise<boolean> = Promise.resolve(true);

  private redesignAbort: AbortController | null = null;
  private deltaBuffer = "";
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private logSeq = 0;
  private noticeSeq = 0;
  private readonly noticeTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(id: string) {
    this.id = id;
    this.store = createStageStore(initialStageState(id));
    this.settings = defaultSettings();
    this.snapshot = {
      load: { status: "loading" },
      project: null,
      mode: this.settings.mode,
      playing: false,
      liveHeld: false,
      offset: 0,
      playbackRate: 1,
      volume: 1,
      muted: false,
      duration: 0,
      audio: { status: "idle", error: null, buffering: false },
      output: { connected: false, count: 0, width: 0, height: 0, fullscreen: false },
      otherConsole: false,
      mic: { status: "off", error: null, deviceId: "", devices: [] },
      tap: { bpm: null, count: 0 },
      selectedIndex: null,
      save: { status: "idle", error: null },
      redesign: { running: false, instruction: "", log: [], text: "", error: null, finishedAt: null },
      notices: [],
      fallbackPeaks: null,
    };
  }

  // -------------------------------------------------------------------------
  // React binding
  // -------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ConsoleSnapshot => this.snapshot;

  private set(patch: Partial<ConsoleSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        console.error("[Livelyrics] 控制台更新失敗：", err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  attach(): void {
    if (this.attached || typeof window === "undefined") return;
    this.attached = true;
    this.settingsFromStorage = hasStoredSettings(this.id);
    this.settings = loadSettings(this.id, defaultSettings(this.settings.mode));
    this.set({
      mode: this.settings.mode,
      offset: this.settings.offset,
      playbackRate: this.settings.playbackRate,
      volume: this.settings.volume,
      muted: this.settings.muted,
      mic: { ...this.snapshot.mic, deviceId: this.settings.micDeviceId },
    });
    this.openChannel();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.listenWindow();
    if (this.snapshot.project) this.onProjectReady(this.snapshot.project);
    else void this.load();
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.flushSaveOnExit();
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.peaksAbort?.abort();
    this.peaksAbort = null;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.stopTicking();
    if (this.projectBroadcastTimer) clearTimeout(this.projectBroadcastTimer);
    this.projectBroadcastTimer = null;
    this.windowCleanup?.();
    this.windowCleanup = null;
    this.releaseMic();
    this.releaseAudio();
    this.channel?.close();
    this.channel = null;
    for (const t of this.noticeTimers.values()) clearTimeout(t);
    this.noticeTimers.clear();
    // a running re-design keeps going on the server; the next load shows its result
    this.redesignAbort?.abort();
    this.redesignAbort = null;
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
    this.deltaBuffer = "";
    this.outputs.clear();
  }

  /** Re-fetch the project from the server (e.g. after the lyrics editor saved). */
  async reload(): Promise<void> {
    await this.load(true);
  }

  private async load(quiet = false): Promise<void> {
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;
    if (!quiet && !this.snapshot.project) this.set({ load: { status: "loading" } });
    try {
      const project = await api.getProject(this.id);
      if (abort.signal.aborted || !this.attached) return;
      this.applyProject(project, { keepPlan: this.pendingPlan != null });
      this.set({ load: { status: "ready" } });
    } catch (err) {
      if (abort.signal.aborted || !this.attached) return;
      const message = errorMessage(err, "無法載入專案");
      if (/^404\b|找不到/.test(message)) this.set({ load: { status: "not-found" } });
      else if (this.snapshot.project) this.notify(`重新載入失敗：${message}`, "error");
      else this.set({ load: { status: "error", message } });
    } finally {
      if (this.loadAbort === abort) this.loadAbort = null;
    }
  }

  /** Replace the project (load, reload, re-design) and resync everything. */
  private applyProject(project: Project, opts: { keepPlan?: boolean } = {}): void {
    const current = this.snapshot.project;
    const next = opts.keepPlan && current?.plan ? { ...project, plan: current.plan } : project;
    const first = !current;
    this.set({ project: next });
    this.clock.setLimit(this.duration());
    this.set({ duration: this.duration() });
    if (first) this.onProjectReady(next);
    else {
      this.clampIndices();
      this.broadcastProject(true);
      this.publish();
    }
    this.schedulePoll(next);
  }

  private onProjectReady(project: Project): void {
    if (!this.attached) return;
    if (!this.settingsFromStorage) {
      // lyrics without timing are cued by hand: start in LIVE mode
      const mode: PlaybackMode = project.lyrics && timedRatio(project.lyrics) < 0.5 && project.lyrics.lines.length > 0 ? "live" : "track";
      this.settings = { ...this.settings, mode };
      this.set({ mode });
    }
    this.setupAudio();
    this.seedTempo();
    this.clock.setLimit(this.duration());
    this.set({ duration: this.duration() });
    this.broadcastProject(true);
    this.publish();
    this.ensureTicking();
    this.loadFallbackPeaks(project);
    this.schedulePoll(project);
  }

  private schedulePoll(project: Project): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (!this.attached || project.status !== "processing" || this.snapshot.redesign.running) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.load(true);
    }, POLL_PROCESSING_MS);
  }

  private loadFallbackPeaks(project: Project): void {
    if ((project.analysis?.peaks?.length ?? 0) > 0 || this.snapshot.fallbackPeaks) return;
    this.peaksAbort?.abort();
    const abort = new AbortController();
    this.peaksAbort = abort;
    void computeWaveformPeaks(api.audioUrl(this.id), abort.signal).then((peaks) => {
      if (abort.signal.aborted || !this.attached || !peaks) return;
      this.set({ fallbackPeaks: peaks });
    });
  }

  private listenWindow(): void {
    const onPageHide = () => this.flushSaveOnExit();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = this.snapshot.save.status;
      if (s === "pending" || s === "saving" || s === "error" || this.snapshot.redesign.running) {
        e.preventDefault();
        // legacy browsers need returnValue set to show the prompt
        e.returnValue = "";
      }
    };
    const onDeviceChange = () => void this.refreshDevices();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    media?.addEventListener?.("devicechange", onDeviceChange);
    this.windowCleanup = () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      media?.removeEventListener?.("devicechange", onDeviceChange);
    };
  }

  // -------------------------------------------------------------------------
  // Audio element (TRACK mode)
  // -------------------------------------------------------------------------

  private setupAudio(): void {
    if (this.audio || typeof Audio === "undefined") return;
    const el = new Audio();
    el.preload = "auto";
    el.playbackRate = this.settings.playbackRate;
    el.defaultPlaybackRate = this.settings.playbackRate;
    el.volume = this.settings.volume;
    el.muted = this.settings.muted;
    this.audio = el;
    this.set({ audio: { status: "loading", error: null, buffering: false } });

    const sync = () => {
      this.set({ playing: this.isPlaying(), duration: this.duration() });
      this.clock.setLimit(this.duration());
      this.publish();
      this.ensureTicking();
    };
    const handlers: Array<[keyof HTMLMediaElementEventMap, () => void]> = [
      ["play", sync],
      ["pause", sync],
      ["ended", sync],
      ["seeked", () => this.publish()],
      ["seeking", () => this.publish()],
      ["durationchange", sync],
      [
        "loadedmetadata",
        () => {
          this.set({ audio: { ...this.snapshot.audio, status: "ready", error: null } });
          sync();
        },
      ],
      [
        "canplay",
        () => {
          if (this.snapshot.audio.status !== "ready" || this.snapshot.audio.buffering) {
            this.set({ audio: { status: "ready", error: null, buffering: false } });
          }
        },
      ],
      [
        "waiting",
        () => {
          this.set({ audio: { ...this.snapshot.audio, buffering: true } });
          this.publish();
        },
      ],
      [
        "playing",
        () => {
          this.set({ audio: { ...this.snapshot.audio, buffering: false } });
          sync();
        },
      ],
      [
        "error",
        () => {
          this.set({ audio: { status: "error", error: mediaErrorMessage(el), buffering: false }, playing: false });
          this.publish();
          this.ensureTicking();
        },
      ],
      ["ratechange", () => this.set({ playbackRate: el.playbackRate })],
      ["volumechange", () => this.set({ volume: el.volume, muted: el.muted })],
    ];
    for (const [type, fn] of handlers) el.addEventListener(type, fn);
    this.audioCleanup = () => {
      for (const [type, fn] of handlers) el.removeEventListener(type, fn);
    };
    el.src = api.audioUrl(this.id);
    el.load();
  }

  private releaseAudio(): void {
    const el = this.audio;
    if (!el) return;
    this.audioCleanup?.();
    this.audioCleanup = null;
    try {
      el.pause();
      el.removeAttribute("src");
      el.load();
    } catch {
      /* already gone */
    }
    this.elementAnalyser?.dispose();
    this.elementAnalyser = null;
    this.audio = null;
    this.set({ playing: false, audio: { status: "idle", error: null, buffering: false } });
  }

  /** Retry loading the audio after an error. */
  retryAudio(): void {
    this.releaseAudio();
    this.setupAudio();
  }

  private ensureElementAnalyser(): void {
    if (this.elementAnalyser || !this.audio) return;
    try {
      this.elementAnalyser = createMediaElementAnalyser(this.audio);
      const bpm = this.snapshot.project?.analysis?.bpm ?? 0;
      if (bpm > 0) this.elementAnalyser.setBpm(bpm);
    } catch (err) {
      console.warn("[Livelyrics] 無法分析播放音訊：", err);
    }
  }

  private isPlaying(): boolean {
    if (this.settings.mode === "live") return this.clock.isRunning;
    const el = this.audio;
    return !!el && !el.paused && !el.ended;
  }

  private duration(): number {
    const p = this.snapshot.project;
    const d = this.audio?.duration;
    return effectiveDuration(Number.isFinite(d) ? d : null, p?.meta?.duration, p?.analysis?.duration, p?.lyrics);
  }

  // -------------------------------------------------------------------------
  // Clock + stage state
  // -------------------------------------------------------------------------

  /** Current song time (offset applied in TRACK mode). */
  songTime(now = Date.now()): number {
    if (this.settings.mode === "live") return this.clock.time(now);
    const el = this.audio;
    const t = (el && Number.isFinite(el.currentTime) ? el.currentTime : 0) + this.settings.offset;
    return Math.max(0, t);
  }

  private computeIndices(t: number, now: number): void {
    const project = this.snapshot.project;
    if (!project) return;
    let line: number | null;
    if (this.settings.mode === "live") line = this.liveLine;
    else line = project.lyrics ? lineIndexAt(project.lyrics, t, this.duration()) : null;
    if (line !== this.lineIndex) {
      this.lineIndex = line;
      this.lineStartedAt = now;
    }
    this.sectionIndex = sectionIndexAt(project.plan, t);
  }

  private clampIndices(): void {
    const n = linesOf(this.snapshot.project).length;
    const fix = (i: number | null) => (i == null || i < n ? i : n > 0 ? n - 1 : null);
    this.liveLine = fix(this.liveLine);
    this.lastCued = fix(this.lastCued);
    const sel = fix(this.snapshot.selectedIndex);
    if (sel !== this.snapshot.selectedIndex) this.set({ selectedIndex: sel });
  }

  private sampleAudio(t: number, playing: boolean): LiveAudioFeatures {
    const analysis = this.snapshot.project?.analysis ?? null;
    const nowSec = performance.now() / 1000;
    if (this.settings.mode === "live") {
      // the mic analyser follows taps itself (and phase-locks them to detected onsets)
      if (this.micAnalyser) return this.micAnalyser.getFeatures();
      const tapped = this.tapClock.phase(nowSec);
      if (tapped != null) return { ...NO_AUDIO, beatPhase: tapped };
      return { ...NO_AUDIO, beatPhase: playing && analysis ? beatPhaseAt(analysis, t) : 1 };
    }
    if (!playing) return NO_AUDIO;
    const hasGrid = !!analysis && ((analysis.beats?.length ?? 0) > 1 || analysis.bpm > 0);
    const f = this.elementAnalyser?.getFeatures() ?? NO_AUDIO;
    return { ...f, beatPhase: hasGrid ? beatPhaseAt(analysis, t) : f.beatPhase };
  }

  /** Recompute and publish the stage state (store + channel). */
  private publish(now = Date.now()): void {
    const project = this.snapshot.project;
    if (!project) return;
    const t = this.songTime(now);
    this.computeIndices(t, now);
    const el = this.audio;
    const buffering = this.settings.mode === "track" && !!el && !el.paused && el.readyState < 3;
    const playing = this.isPlaying() && !buffering;
    const state: StageState = {
      projectId: this.id,
      mode: this.settings.mode,
      t,
      playing,
      sentAt: now,
      lineIndex: this.lineIndex,
      lineStartedAt: this.lineStartedAt,
      sectionIndex: this.sectionIndex,
      overrides: this.overrides,
      audio: this.sampleAudio(t, playing),
    };
    this.store.set(state);
    this.post({ type: "state", state });
    if (this.settings.mode === "live") {
      const held = this.clock.isHeld(now);
      if (held !== this.snapshot.liveHeld) this.set({ liveHeld: held });
    } else if (this.snapshot.liveHeld) this.set({ liveHeld: false });
  }

  private needsTicking(): boolean {
    if (!this.attached || !this.snapshot.project) return false;
    if (this.settings.mode === "live") return this.clock.isRunning || this.micAnalyser != null || this.tapClock.bpm != null;
    return this.isPlaying();
  }

  private ensureTicking(): void {
    if (this.needsTicking()) {
      if (!this.tickTimer) this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    } else this.stopTicking();
  }

  private stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private tick(): void {
    try {
      this.publish();
      const playing = this.isPlaying();
      if (playing !== this.snapshot.playing) this.set({ playing });
    } catch (err) {
      // never let one bad frame stop the show clock
      console.error("[Livelyrics] 控制台時脈錯誤：", err);
    }
  }

  // -------------------------------------------------------------------------
  // Projection link
  // -------------------------------------------------------------------------

  private openChannel(): void {
    if (typeof BroadcastChannel === "undefined") {
      this.notify("此瀏覽器不支援 BroadcastChannel，投影視窗無法同步。", "error");
      return;
    }
    const channel = new BroadcastChannel(channelName(this.id));
    channel.onmessage = (ev: MessageEvent<StageMessage>) => this.onMessage(ev.data);
    this.channel = channel;
  }

  private post(msg: StageMessage): void {
    try {
      this.channel?.postMessage(msg);
    } catch (err) {
      console.warn("[Livelyrics] 無法傳送到投影視窗：", err);
    }
  }

  private onMessage(msg: StageMessage | null | undefined): void {
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "hello":
        this.broadcastProject(true);
        this.publish();
        break;
      case "pong": {
        if (typeof msg.outputId !== "string") return;
        const known = this.outputs.has(msg.outputId);
        this.outputs.set(msg.outputId, {
          at: Date.now(),
          width: Number.isFinite(msg.width) ? msg.width : 0,
          height: Number.isFinite(msg.height) ? msg.height : 0,
          fullscreen: !!msg.fullscreen,
        });
        const o = this.snapshot.output;
        if (!known || !o.connected || o.width !== msg.width || o.height !== msg.height || o.fullscreen !== !!msg.fullscreen) this.updateOutputStatus();
        break;
      }
      case "state":
      case "ping":
        // only consoles send these: someone else is driving this projection too
        this.lastOtherConsoleAt = Date.now();
        if (!this.snapshot.otherConsole) this.set({ otherConsole: true });
        break;
      default:
        break;
    }
  }

  private updateOutputStatus(): void {
    const now = Date.now();
    let latest: { at: number; width: number; height: number; fullscreen: boolean } | null = null;
    for (const [id, o] of this.outputs) {
      if (now - o.at > OUTPUT_TIMEOUT_MS) this.outputs.delete(id);
      else if (!latest || o.at > latest.at) latest = o;
    }
    const next: OutputStatus = latest
      ? { connected: true, count: this.outputs.size, width: latest.width, height: latest.height, fullscreen: latest.fullscreen }
      : { connected: false, count: 0, width: 0, height: 0, fullscreen: false };
    const o = this.snapshot.output;
    if (o.connected !== next.connected || o.count !== next.count || o.width !== next.width || o.height !== next.height || o.fullscreen !== next.fullscreen) {
      this.set({ output: next });
    }
  }

  private heartbeat(): void {
    this.post({ type: "ping", at: Date.now() });
    // idle consoles resend the state once a second so a missed message heals itself
    if (!this.tickTimer) this.publish();
    this.updateOutputStatus();
    const other = Date.now() - this.lastOtherConsoleAt < OUTPUT_TIMEOUT_MS;
    if (other !== this.snapshot.otherConsole) this.set({ otherConsole: other });
  }

  private broadcastProject(immediate = false): void {
    const send = () => {
      this.projectBroadcastTimer = null;
      this.lastProjectBroadcast = Date.now();
      const project = this.snapshot.project;
      if (project) this.post({ type: "project", project });
    };
    if (immediate) {
      if (this.projectBroadcastTimer) clearTimeout(this.projectBroadcastTimer);
      send();
      return;
    }
    if (this.projectBroadcastTimer) return;
    const wait = Math.max(0, PROJECT_BROADCAST_MS - (Date.now() - this.lastProjectBroadcast));
    this.projectBroadcastTimer = setTimeout(send, wait);
  }

  /** Open (or focus) the projection window. Must run inside a user gesture. */
  openOutput(): void {
    if (typeof window === "undefined") return;
    const url = `/p/${encodeURIComponent(this.id)}/output`;
    const name = `livelyrics-output-${this.id}`;
    const features = "popup,width=1280,height=720";
    const existing = this.outputWindow;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    // "" keeps an already-open output (e.g. after a console reload) instead of reloading it
    let win: Window | null = null;
    try {
      win = window.open("", name, features);
    } catch {
      win = null;
    }
    if (!win) {
      this.notify("瀏覽器封鎖了彈出視窗。請允許此網站開啟彈出視窗後再試一次。", "error");
      return;
    }
    try {
      const path = win.location.pathname;
      if (win.location.href === "about:blank" || !path.endsWith("/output")) win.location.replace(url);
    } catch {
      win.location.href = url;
    }
    this.outputWindow = win;
    try {
      win.focus();
    } catch {
      /* focus is best effort */
    }
  }

  requestOutputFullscreen(): void {
    this.post({ type: "fullscreen" });
    this.notify("已要求投影視窗全螢幕；若沒有反應，請在投影視窗按 F 或雙擊畫面。", "info");
  }

  closeOutput(): void {
    this.post({ type: "close" });
    try {
      this.outputWindow?.close();
    } catch {
      /* not ours */
    }
    this.outputWindow = null;
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  async play(): Promise<void> {
    if (!this.snapshot.project) return;
    if (this.settings.mode === "live") {
      this.clock.start(Date.now());
      this.afterClockChange();
      return;
    }
    const el = this.audio;
    if (!el) return;
    if (this.snapshot.audio.status === "error") {
      this.notify(this.snapshot.audio.error ?? "音檔無法載入。", "error");
      return;
    }
    this.ensureElementAnalyser();
    void resumeAudioContext();
    const d = this.duration();
    if (el.ended || (d > 0 && el.currentTime >= d - 0.05)) el.currentTime = 0;
    try {
      await el.play();
    } catch (err) {
      if (isAbort(err)) return;
      const name = (err as { name?: string } | null)?.name;
      this.notify(name === "NotAllowedError" ? "瀏覽器暫時不允許播放，請再按一次播放。" : `無法播放：${errorMessage(err, "未知錯誤")}`, "error");
    }
  }

  pause(): void {
    if (this.settings.mode === "live") {
      this.clock.stop(Date.now());
      this.afterClockChange();
      return;
    }
    this.audio?.pause();
  }

  togglePlay(): void {
    if (this.isPlaying()) this.pause();
    else void this.play();
  }

  /** Space: play/pause in TRACK mode, next line in LIVE mode. */
  spaceAction(): void {
    if (this.settings.mode === "live") this.next();
    else this.togglePlay();
  }

  private afterClockChange(): void {
    this.set({ playing: this.isPlaying() });
    this.publish();
    this.ensureTicking();
  }

  /** Seek to song time `t` (seconds). LIVE: moves the virtual clock. */
  seek(t: number): void {
    const project = this.snapshot.project;
    if (!project || !Number.isFinite(t)) return;
    const d = this.duration();
    const target = Math.max(0, d > 0 ? Math.min(t, d) : t);
    const now = Date.now();
    if (this.settings.mode === "live") {
      const lines = linesOf(project);
      const next = nextTimedLineAfter(lines, target - 0.05);
      const nextStart = next != null ? lines[next].start : null;
      this.clock.jump(target, nextStart != null && nextStart > target ? nextStart : null, now);
      this.liveLine = project.lyrics ? lineIndexAt(project.lyrics, target, d) : null;
      this.lastCued = this.liveLine ?? lastStartedLine(lines, target);
      this.afterClockChange();
      return;
    }
    const el = this.audio;
    if (!el) return;
    const audioT = Math.max(0, target - this.settings.offset);
    try {
      el.currentTime = d > 0 ? Math.min(audioT, d) : audioT;
    } catch {
      /* not seekable yet */
    }
    this.publish(now);
  }

  seekBy(delta: number): void {
    this.seek(this.songTime() + delta);
  }

  /** TRACK: seek to the line's start. LIVE: cue it. */
  jumpToLine(index: number): void {
    const project = this.snapshot.project;
    const line = linesOf(project)[index];
    if (!project || !line) return;
    if (this.settings.mode === "live") {
      this.cueLine(index);
      return;
    }
    if (line.start == null) {
      this.notify("這一行還沒有時間碼：請切到 LIVE 模式手動送出，或到歌詞編輯器對時。", "warn");
      return;
    }
    this.seek(line.start + 0.001);
  }

  /** LIVE: show line `index` now; the virtual clock jumps to its start and runs until the next line. */
  cueLine(index: number): void {
    const project = this.snapshot.project;
    const lines = linesOf(project);
    const line = lines[index];
    if (!project || !line) return;
    const now = Date.now();
    const t = line.start ?? this.clock.time(now);
    this.clock.jump(t, liveHoldTime(lines, index, t), now);
    this.clock.start(now);
    this.liveLine = index;
    this.lastCued = index;
    this.lineStartedAt = now;
    this.lineIndex = index;
    this.afterClockChange();
  }

  /** LIVE: take the lyric off the screen (the next cue continues after it). */
  clearLine(): void {
    if (this.settings.mode !== "live" || this.liveLine == null) return;
    this.lastCued = this.liveLine;
    this.liveLine = null;
    this.publish();
  }

  next(): void {
    const project = this.snapshot.project;
    if (!project?.lyrics) return;
    const t = this.songTime();
    if (this.settings.mode === "live") {
      const i = liveNextLine(project.lyrics.lines, this.liveLine, this.lastCued, t);
      if (i != null) this.cueLine(i);
      return;
    }
    const i = trackNextLine(project.lyrics, t);
    if (i != null) this.jumpToLine(i);
  }

  prev(): void {
    const project = this.snapshot.project;
    if (!project?.lyrics) return;
    const t = this.songTime();
    if (this.settings.mode === "live") {
      const i = livePrevLine(project.lyrics.lines, this.liveLine, this.lastCued);
      if (i != null) this.cueLine(i);
      return;
    }
    const i = trackPrevLine(project.lyrics, t, this.duration());
    if (i != null) this.jumpToLine(i);
    else this.seek(0);
  }

  /** The line "next" would show (the UI's 下一句 marker). */
  upcomingLine(): number | null {
    const lyrics = this.snapshot.project?.lyrics;
    if (!lyrics) return null;
    const t = this.songTime();
    if (this.settings.mode === "live") return liveNextLine(lyrics.lines, this.liveLine, this.lastCued, t);
    return trackNextLine(lyrics, t);
  }

  /** Enter: send the standby line and advance the standby to the following line. */
  cueSelected(): void {
    const sel = this.snapshot.selectedIndex;
    const n = linesOf(this.snapshot.project).length;
    if (sel == null || sel >= n) {
      this.next();
      return;
    }
    this.jumpToLine(sel);
    this.set({ selectedIndex: sel + 1 < n ? sel + 1 : sel });
  }

  select(index: number | null): void {
    const n = linesOf(this.snapshot.project).length;
    const sel = index == null || n === 0 ? null : Math.min(n - 1, Math.max(0, Math.round(index)));
    if (sel !== this.snapshot.selectedIndex) this.set({ selectedIndex: sel });
  }

  moveSelection(delta: number): void {
    const n = linesOf(this.snapshot.project).length;
    if (n === 0) return;
    const base = this.snapshot.selectedIndex ?? this.lineIndex ?? (delta > 0 ? -1 : n);
    this.select(base + delta);
  }

  jumpToSection(index: number): void {
    const section = this.snapshot.project?.plan?.sections[index];
    if (section) this.seek(section.start + 0.001);
  }

  setMode(mode: PlaybackMode): void {
    if (mode === this.settings.mode) return;
    const project = this.snapshot.project;
    if (!project) {
      this.updateSettings({ mode });
      this.set({ mode });
      return;
    }
    const lines = linesOf(project);
    const now = Date.now();
    const t = this.songTime(now);
    if (mode === "live") {
      this.audio?.pause();
      const current = this.lineIndex;
      const next = nextTimedLineAfter(lines, t);
      const hold = current != null ? liveHoldTime(lines, current, t) : next != null ? lines[next].start : null;
      this.clock.stop(now);
      this.clock.jump(t, hold, now);
      this.liveLine = current;
      this.lastCued = current ?? lastStartedLine(lines, t);
    } else {
      this.clock.stop(now);
      this.liveLine = null;
      const el = this.audio;
      if (el) {
        try {
          el.currentTime = Math.max(0, t - this.settings.offset);
        } catch {
          /* not seekable yet */
        }
      }
    }
    this.updateSettings({ mode });
    this.set({ mode, liveHeld: false });
    this.afterClockChange();
    this.notify(mode === "live" ? "LIVE 模式：由你逐句送出歌詞（Space／→ 下一句）" : "TRACK 模式：跟著音檔時間自動播放歌詞", "info");
  }

  toggleMode(): void {
    this.setMode(this.settings.mode === "live" ? "track" : "live");
  }

  // -------------------------------------------------------------------------
  // Sync settings
  // -------------------------------------------------------------------------

  private updateSettings(patch: Partial<ConsoleSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.id, this.settings);
    this.settingsFromStorage = true;
  }

  setOffset(offset: number): void {
    const v = clampOffset(offset);
    if (v === this.settings.offset) return;
    this.updateSettings({ offset: v });
    this.set({ offset: v });
    this.publish();
  }

  nudgeOffset(delta: number): void {
    this.setOffset(this.settings.offset + delta);
  }

  setPlaybackRate(rate: number): void {
    if (!(PLAYBACK_RATES as readonly number[]).includes(rate)) return;
    this.updateSettings({ playbackRate: rate });
    if (this.audio) {
      this.audio.playbackRate = rate;
      this.audio.defaultPlaybackRate = rate;
    }
    this.set({ playbackRate: rate });
    this.publish();
  }

  setVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    this.updateSettings({ volume: v, muted: v === 0 ? this.settings.muted : false });
    if (this.audio) {
      this.audio.volume = v;
      if (v > 0) this.audio.muted = false;
    }
    this.set({ volume: v, muted: this.settings.muted });
  }

  toggleMute(): void {
    const muted = !this.settings.muted;
    this.updateSettings({ muted });
    if (this.audio) this.audio.muted = muted;
    this.set({ muted });
  }

  tap(): void {
    const nowSec = performance.now() / 1000;
    const bpm = this.tapClock.tap(nowSec);
    try {
      this.micAnalyser?.tap();
      this.elementAnalyser?.tap();
    } catch {
      /* analyser gone */
    }
    this.set({ tap: { bpm, count: this.tapClock.count } });
    this.publish();
    this.ensureTicking();
  }

  resetTap(): void {
    this.tapClock.reset();
    this.set({ tap: { bpm: null, count: 0 } });
    this.seedTempo();
    this.ensureTicking();
  }

  private seedTempo(): void {
    const bpm = this.snapshot.project?.analysis?.bpm ?? 0;
    if (bpm > 0) {
      this.elementAnalyser?.setBpm(bpm);
      this.micAnalyser?.setBpm(bpm);
    }
  }

  // -------------------------------------------------------------------------
  // Microphone (LIVE mode reactivity)
  // -------------------------------------------------------------------------

  async enableMic(deviceId?: string): Promise<void> {
    if (this.snapshot.mic.status === "starting") return;
    const id = deviceId ?? this.settings.micDeviceId;
    this.releaseMic();
    this.set({ mic: { ...this.snapshot.mic, status: "starting", error: null, deviceId: id } });
    try {
      const handle = await createMicAnalyser(id || undefined);
      if (!this.attached) {
        handle.dispose();
        return;
      }
      this.micAnalyser = handle;
      const bpm = this.tapClock.bpm ?? this.snapshot.project?.analysis?.bpm ?? 0;
      if (bpm > 0) handle.setBpm(bpm);
      this.updateSettings({ micDeviceId: id });
      this.set({ mic: { ...this.snapshot.mic, status: "on", error: null, deviceId: id } });
      void this.refreshDevices();
    } catch (err) {
      if (!this.attached) return;
      this.set({ mic: { ...this.snapshot.mic, status: "error", error: errorMessage(err, "無法開啟音訊輸入。") } });
    }
    this.ensureTicking();
  }

  /** Choose the input device; re-opens the input when it is already running. */
  setMicDevice(deviceId: string): void {
    this.updateSettings({ micDeviceId: deviceId });
    this.set({ mic: { ...this.snapshot.mic, deviceId } });
    if (this.snapshot.mic.status === "on") void this.enableMic(deviceId);
  }

  disableMic(): void {
    this.releaseMic();
    this.set({ mic: { ...this.snapshot.mic, status: "off", error: null } });
    this.publish();
    this.ensureTicking();
  }

  private releaseMic(): void {
    try {
      this.micAnalyser?.dispose();
    } catch {
      /* already closed */
    }
    this.micAnalyser = null;
  }

  async refreshDevices(): Promise<void> {
    const devices = await listAudioInputs();
    if (!this.attached) return;
    this.set({ mic: { ...this.snapshot.mic, devices } });
  }

  // -------------------------------------------------------------------------
  // Overrides
  // -------------------------------------------------------------------------

  setOverrides(patch: Partial<StageOverrides>): void {
    const next: StageOverrides = { ...this.overrides, ...patch };
    next.intensity = Math.min(1.5, Math.max(0, Number.isFinite(next.intensity) ? next.intensity : 1));
    next.lyricScale = Math.min(2, Math.max(0.5, Number.isFinite(next.lyricScale) ? next.lyricScale : 1));
    this.overrides = next;
    this.publish();
  }

  getOverrides(): StageOverrides {
    return this.overrides;
  }

  toggleBlackout(): void {
    this.setOverrides({ blackout: !this.overrides.blackout });
  }

  toggleLyrics(): void {
    this.setOverrides({ lyricsVisible: !this.overrides.lyricsVisible });
  }

  toggleFreeze(): void {
    this.setOverrides({ freeze: !this.overrides.freeze });
  }

  toggleTestPattern(): void {
    this.setOverrides({ testPattern: !this.overrides.testPattern });
  }

  setSceneOverride(scene: SceneId | null): void {
    this.setOverrides({ scene });
  }

  /** Keys 1–9: scene bank slot (1-based). */
  sceneSlot(slot: number): void {
    const scene = sceneBank(this.snapshot.project?.plan ?? null)[slot - 1];
    if (scene) this.setSceneOverride(scene);
  }

  resetOverrides(): void {
    this.overrides = { ...DEFAULT_OVERRIDES };
    this.publish();
  }

  // -------------------------------------------------------------------------
  // Plan edits (debounced PATCH, immediate re-broadcast)
  // -------------------------------------------------------------------------

  updateSection(index: number, patch: SectionPatch): void {
    this.updatePlan((plan) => patchSection(plan, index, patch));
  }

  updatePlan(mutate: (plan: DesignPlan) => DesignPlan): void {
    const project = this.snapshot.project;
    if (!project?.plan || this.snapshot.redesign.running) return;
    const plan = mutate(project.plan);
    if (plan === project.plan) return;
    this.set({ project: { ...project, plan } });
    this.broadcastProject();
    this.publish();
    this.pendingPlan = plan;
    this.set({ save: { status: "pending", error: null } });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  /** Save any pending plan edit now. Resolves true when everything is saved. */
  flushSave(): Promise<boolean> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saveChain = this.saveChain.then(async () => {
      const plan = this.pendingPlan;
      if (!plan) return this.snapshot.save.status !== "error";
      this.pendingPlan = null;
      this.set({ save: { status: "saving", error: null } });
      try {
        const saved = await api.updateProject(this.id, { plan });
        const current = this.snapshot.project;
        if (current && saved?.updatedAt) this.set({ project: { ...current, updatedAt: saved.updatedAt } });
        if (!this.pendingPlan) this.set({ save: { status: "saved", error: null } });
        return true;
      } catch (err) {
        if (!this.pendingPlan) this.pendingPlan = plan;
        this.set({ save: { status: "error", error: errorMessage(err, "儲存失敗") } });
        return false;
      }
    });
    return this.saveChain;
  }

  private flushSaveOnExit(): void {
    const plan = this.pendingPlan;
    if (!plan) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.pendingPlan = null;
    try {
      void fetch(`/api/projects/${encodeURIComponent(this.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* unloading */
    }
  }

  // -------------------------------------------------------------------------
  // Re-design (streamed pipeline run: steps ["design"])
  // -------------------------------------------------------------------------

  async redesign(instruction: string): Promise<boolean> {
    if (this.snapshot.redesign.running || !this.snapshot.project) return false;
    const text = instruction.trim();
    this.set({ redesign: { running: true, instruction: text, log: [], text: "", error: null, finishedAt: this.snapshot.redesign.finishedAt } });
    const saved = await this.flushSave();
    if (!saved) this.pushLog({ kind: "log", message: "尚未儲存的手動修改沒有存成功，新的設計會以伺服器上的版本為基礎。" });
    const abort = new AbortController();
    this.redesignAbort = abort;
    try {
      const project = await api.process(this.id, { steps: ["design"], ...(text ? { instruction: text } : {}) }, (e) => this.onPipelineEvent(e), abort.signal);
      if (!this.attached) return false;
      this.flushDelta();
      this.pendingPlan = null;
      this.set({ save: { status: "idle", error: null } });
      this.applyProject(project);
      this.set({ redesign: { ...this.snapshot.redesign, running: false, error: null, finishedAt: Date.now() } });
      this.notify(project.plan ? `已套用新設計：「${project.plan.keyVisual.title}」` : "重新設計完成", "ok");
      return true;
    } catch (err) {
      if (!this.attached) return false;
      const message = isAbort(err) ? "已停止等待；伺服器可能仍在處理，稍後重新整理即可看到結果。" : errorMessage(err, "重新設計失敗");
      this.set({ redesign: { ...this.snapshot.redesign, running: false, error: message } });
      if (!isAbort(err)) this.notify(`重新設計失敗：${message}`, "error");
      return false;
    } finally {
      if (this.redesignAbort === abort) this.redesignAbort = null;
    }
  }

  cancelRedesign(): void {
    this.redesignAbort?.abort();
  }

  private flushDelta(): void {
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
    if (!this.deltaBuffer) return;
    const r = this.snapshot.redesign;
    const text = (r.text + this.deltaBuffer).slice(-REDESIGN_TEXT_TAIL);
    this.deltaBuffer = "";
    this.set({ redesign: { ...r, text } });
  }

  private pushLog(entry: Omit<RedesignLogEntry, "id">): void {
    this.flushDelta();
    const r = this.snapshot.redesign;
    const log = [...r.log, { ...entry, id: ++this.logSeq }].slice(-REDESIGN_LOG_MAX);
    this.set({ redesign: { ...r, log } });
  }

  private onPipelineEvent(e: PipelineEvent): void {
    if (!this.attached) return;
    switch (e.type) {
      case "step": {
        const status = { start: "開始", done: "完成", skipped: "略過", error: "失敗" }[e.status];
        this.pushLog({ kind: "step", step: e.step, status: e.status, message: `${STEP_LABELS[e.step] ?? e.step}${status}${e.message ? `：${e.message}` : ""}` });
        break;
      }
      case "log":
        this.pushLog({ kind: "log", step: e.step, message: e.message });
        break;
      case "search":
        this.pushLog({ kind: "search", message: e.query });
        break;
      case "delta":
        // streamed text arrives in many tiny chunks: coalesce UI updates
        this.deltaBuffer += e.text;
        if (!this.deltaTimer) this.deltaTimer = setTimeout(() => this.flushDelta(), DELTA_FLUSH_MS);
        break;
      case "error":
        this.pushLog({ kind: "error", message: e.message });
        break;
      case "done":
        this.pushLog({ kind: "done", message: "設計完成" });
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Notices
  // -------------------------------------------------------------------------

  notify(message: string, tone: NoticeTone = "info"): void {
    const id = ++this.noticeSeq;
    const notices = [...this.snapshot.notices.filter((n) => n.message !== message), { id, tone, message }].slice(-4);
    this.set({ notices });
    if (typeof window === "undefined") return;
    const timer = setTimeout(() => this.dismissNotice(id), tone === "error" ? NOTICE_MS * 2 : NOTICE_MS);
    this.noticeTimers.set(id, timer);
  }

  dismissNotice(id: number): void {
    const timer = this.noticeTimers.get(id);
    if (timer) clearTimeout(timer);
    this.noticeTimers.delete(id);
    if (this.snapshot.notices.some((n) => n.id === id)) this.set({ notices: this.snapshot.notices.filter((n) => n.id !== id) });
  }
}
