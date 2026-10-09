// The operator console's engine. Owns the clock (the <audio> element in TRACK mode, a
// virtual cue clock in LIVE mode), every operator decision (overrides, cues, offset, section
// hold / loop) and the link to the projection window: it writes StageState into a StageStore for
// the console's own preview and mirrors it onto a BroadcastChannel — channelName(id) for the
// per-song console, the show's channel for a show item on air, none for an armed show item that
// is only preloaded (see `ConsoleControllerOptions`).
//
// Framework-agnostic: React binds to it through subscribe()/getSnapshot() (low-frequency
// UI state) and `store` (per-frame stage state). attach()/detach() are symmetric and
// repeatable, so React StrictMode's mount → unmount → mount is safe.
//
// Sync (phase 5a): `sync` (a SyncEngine: MIDI, MTC, MIDI clock, LTC) can drive the same clock. With
// MTC or LTC locked the timecode is the song clock (`following`): TRACK keeps its audio element on
// it (a seek beyond 80 ms of drift, play while it runs, pause when it stops), LIVE takes the lyric
// and section time straight from it. Manual navigation then waits for 回到手動 (X). A dropout
// freewheels (the chase keeps time), then falls back to manual on the line that was showing. A
// locked MIDI clock (節拍模式) gives the beat phase before the microphone and tap tempo.

import { stageAssets } from "@/lib/asset-scope";
import { api } from "@/lib/api-client";
import { LedCapFader } from "@/lib/midi/controls";
import { songTimeAt } from "@/lib/sync/chase";
import { SyncEngine } from "@/lib/sync/engine";
import { DEFAULT_START_TC, normalizeTcInput } from "@/lib/sync/timecode";
import { createMediaElementAnalyser, createMicAnalyser, listAudioInputs, resumeAudioContext, type AudioInputDevice, type LiveAnalyser } from "@/lib/audio/live";
import {
  DEFAULT_OVERRIDES,
  channelName,
  createStageStore,
  initialStageState,
  stageTime,
  type LiveAudioFeatures,
  type PlaybackMode,
  type RemoteKey,
  type StageMessage,
  type StageOverrides,
  type StageState,
  type StageTransition,
  type WritableStageStore,
} from "@/lib/stage/protocol";
import { beatPhaseAt, lineIndexAt, sectionIndexAt } from "@/lib/timeline";
import { timingEstimated } from "@/lib/lyrics/lrc";
import { patchOutput, type OutputPatch } from "@/lib/output";
import { MANUAL_KEY } from "./hotkeys";
import type { SafetyPatch } from "@/lib/stage/safety";
import type { CollectedVisual, Asset, DesignPlan, LyricLine, PipelineEvent, PipelineStepId, Project, ProjectOutput, SceneId } from "@/lib/types";
import { DISCONNECTED, HEARTBEAT_MS, openProjectionWindow, ProjectionLink, randomId, type OutputStatus, type OutputTarget } from "./link";
import { LiveClock } from "./live-clock";
import {
  effectiveDuration,
  lastStartedLine,
  lineSections,
  liveHoldTime,
  liveNextLine,
  livePrevLine,
  loopNextLine,
  loopSeekTarget,
  nextTimedLineAfter,
  timedRatio,
  trackNextLine,
  trackPrevLine,
} from "./navigation";
import { computeWaveformPeaks } from "./peaks";
import { patchSection, sceneBank, type SectionPatch } from "./plan-edit";
import { loadSession, saveSession } from "./session";
import { clampOffset, defaultSettings, hasStoredSettings, loadPreferredMode, loadSettings, PLAYBACK_RATES, savePreferredMode, saveSettings, type ConsoleSettings } from "./settings";
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

export type { OutputStatus } from "./link";

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
  /** LIVE (手動切換): the track plays too while the lyrics wait for cues */
  liveAudio: boolean;
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
  /** 保持段落: the section whose look stays on stage while time and cues move on (null = follow) */
  sectionHold: number | null;
  /** 循環段落: TRACK jumps back to this section's start at its end; LIVE wraps its last line to its first */
  sectionLoop: number | null;
  save: SaveStatus;
  redesign: RedesignState;
  notices: Notice[];
  /** waveform computed in the browser when the project has no stored analysis peaks (null = loading, [] = unavailable) */
  fallbackPeaks: number[] | null;
  /** 時間碼 (phase 5a): where this song starts on the timecode, and whether the timecode drives it now */
  timecode: TimecodeInfo;
}

export interface TimecodeInfo {
  /** HH:MM:SS:FF */
  start: string;
  /** setlist: the show's item (read-only here); project: the song's own; default: 01:00:00:00 */
  from: "setlist" | "project" | "default";
  /** MTC / LTC is locked (or freewheeling): the song clock follows it */
  following: boolean;
}

/** How a console drives the projection. The per-song console (/p/[id]) uses the defaults. */
export interface ConsoleControllerOptions {
  /**
   * The BroadcastChannel to drive; default channelName(id). null = silent: no channel, no pings,
   * nothing persisted (the show console's armed, preloaded song) until setChannel() puts it on air.
   */
  channel?: string | null;
  /** shared by every controller of one console window: their messages never count as another console */
  consoleId?: string;
  /** where 「開啟投影視窗」 goes; default this song's own output (/p/[id]/output) */
  output?: OutputTarget;
  /**
   * Restore this tab's saved overrides, playback position and section hold / loop (a console
   * reload). Default true; a fresh show take (false) starts the song at its start, as designed —
   * the show console carries a blackout across takes itself.
   */
  resume?: boolean;
  /**
   * The show console's sync engine (shared by every song it takes; the show owns its lifecycle).
   * Without it the controller makes its own and keeps its settings with this song's.
   */
  sync?: SyncEngine;
  /** The start timecode the show's setlist gives this song (else the song's own, else 01:00:00:00). */
  timecodeStart?: string | null;
}

const TICK_MS = 33;
/** TRACK chase: the audio element is sought when it drifts further than this from the timecode */
const CHASE_DRIFT = 0.08;
/** after a seek or a play() the element gets this long before its drift counts again (ms) */
const CHASE_GRACE_MS = 300;
/** LIVE loop: the clock parks this far before the looped section's end (it never shows the next section) */
const LOOP_HOLD_MARGIN = 0.05;
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
  scene: "畫面",
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
  /** this console window (see ConsoleControllerOptions.consoleId) */
  readonly consoleId: string;

  private snapshot: ConsoleSnapshot;
  private readonly listeners = new Set<() => void>();
  /** keys pressed in the projection window (a presentation clicker), for the console view to run */
  private readonly remoteKeyListeners = new Set<(key: RemoteKey) => void>();
  private settings: ConsoleSettings;
  private settingsFromStorage = false;

  private attached = false;
  private sessionRestored = false;
  private readonly resume: boolean;
  /** the channel to drive (null = silent) */
  private channelTarget: string | null;
  private readonly link: ProjectionLink;
  private readonly outputTarget: OutputTarget;
  /** show take: announce the next project broadcast with this transition */
  private pendingTransition: StageTransition | null = null;
  /** show mode: the armed item, announced to the output so it warms fonts and media */
  private preloadProject: Project | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioCleanup: (() => void) | null = null;
  private resumeAt = 0;
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
  /** 保持段落 / 循環段落 (section indices; null = off) */
  private hold: number | null = null;
  private loop: number | null = null;
  /**
   * LIVE section jump: show this section until the clock reaches its start (its first line may be
   * a pickup sung just before the boundary). Cleared by any other seek, cue or mode change.
   */
  private sectionPin: { index: number; until: number } | null = null;
  private lineSectionCache: { project: Project; duration: number; sections: Array<number | null> } | null = null;

  // projection link
  private outputWindow: Window | null = null;
  private projectBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private lastProjectBroadcast = 0;

  // persistence
  private pendingPlan: DesignPlan | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOutput: ProjectOutput | null = null;
  private outputTimer: ReturnType<typeof setTimeout> | null = null;
  private saveChain: Promise<boolean> = Promise.resolve(true);

  private redesignAbort: AbortController | null = null;
  private deltaBuffer = "";
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private logSeq = 0;
  private noticeSeq = 0;
  private readonly noticeTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** false while the UI's toast stack owns notice lifetimes (it pauses on hover, focus and a hidden tab) */
  private noticeAutoDismiss = true;

  // sync (phase 5a)
  /** MIDI, MTC, MIDI clock and LTC for this console (owned, or the show's) */
  readonly sync: SyncEngine;
  private readonly ownsSync: boolean;
  private readonly showStart: string | null;
  private syncUnsub: (() => void) | null = null;
  /** the timecode drives the song clock */
  private following = false;
  /** song time of the timecode at the last look (where manual takes over) */
  private followT = 0;
  private audioGraceUntil = 0;
  /** a dropout fell back to manual: the next lock says the timecode is back */
  private relockNotice = false;
  /** the sync source the relock notice belongs to (another source is not a 「恢復」) */
  private relockSource: string | null = null;
  private playBlocked = false;
  private readonly ledFader = new LedCapFader();

  constructor(id: string, opts: ConsoleControllerOptions = {}) {
    this.id = id;
    this.store = createStageStore(initialStageState(id));
    this.settings = defaultSettings();
    this.consoleId = opts.consoleId || randomId();
    this.channelTarget = opts.channel === undefined ? channelName(id) : opts.channel;
    this.resume = opts.resume ?? true;
    this.outputTarget = opts.output ?? { url: `/p/${encodeURIComponent(id)}/output`, name: `livelyrics-output-${id}` };
    this.ownsSync = !opts.sync;
    this.sync = opts.sync ?? new SyncEngine();
    const showStart = opts.timecodeStart ? normalizeTcInput(opts.timecodeStart) : null;
    this.showStart = showStart;
    this.link = new ProjectionLink(this.consoleId, {
      onHello: () => {
        this.broadcastProject(true);
        this.publish();
        if (this.preloadProject) this.link.post({ type: "preload", project: this.preloadProject });
      },
      onStatus: (output, otherConsole) => this.set({ output, otherConsole }),
      onPlan: (projectId, plan) => this.adoptTypeSystem(projectId, plan),
      onRemoteKey: (key) => {
        for (const l of this.remoteKeyListeners) l(key);
      },
    });
    this.snapshot = {
      load: { status: "loading" },
      project: null,
      mode: this.settings.mode,
      playing: false,
      liveHeld: false,
      liveAudio: false,
      offset: 0,
      playbackRate: 1,
      volume: 1,
      muted: false,
      duration: 0,
      audio: { status: "idle", error: null, buffering: false },
      output: DISCONNECTED,
      otherConsole: false,
      mic: { status: "off", error: null, deviceId: "", devices: [] },
      tap: { bpm: null, count: 0 },
      selectedIndex: null,
      sectionHold: null,
      sectionLoop: null,
      save: { status: "idle", error: null },
      redesign: { running: false, instruction: "", log: [], text: "", error: null, finishedAt: null },
      notices: [],
      fallbackPeaks: null,
      timecode: { start: showStart ?? DEFAULT_START_TC, from: showStart ? "setlist" : "default", following: false },
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
      liveAudio: this.settings.liveAudio,
      mic: { ...this.snapshot.mic, deviceId: this.settings.micDeviceId },
    });
    this.restoreSession();
    if (this.ownsSync) {
      // this song's own sync settings (the show console hands in its engine, set up by the show)
      this.sync.configure(this.settings.sync, (sync) => this.updateSettings({ sync }));
      this.sync.attach();
    }
    this.syncUnsub = this.sync.subscribe(() => this.onSyncChange());
    if (this.channelTarget) this.openLink(this.channelTarget);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.listenWindow();
    if (this.snapshot.project) this.onProjectReady(this.snapshot.project);
    else void this.load();
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.flushSaveOnExit();
    this.flushOutputOnExit();
    if (this.snapshot.project && !this.silent) this.persistSession();
    this.holdOutput();
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
    this.syncUnsub?.();
    this.syncUnsub = null;
    this.following = false;
    if (this.ownsSync) this.sync.detach();
    this.releaseMic();
    this.releaseAudio();
    this.link.close();
    for (const t of this.noticeTimers.values()) clearTimeout(t);
    this.noticeTimers.clear();
    // a running re-design keeps going on the server; the next load shows its result
    this.redesignAbort?.abort();
    this.redesignAbort = null;
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
    this.deltaBuffer = "";
  }

  /** Not on any channel (a preloaded show item): nothing is sent or persisted. */
  private get silent(): boolean {
    return this.channelTarget == null;
  }

  private openLink(name: string): void {
    if (!this.link.open(name)) this.notify("此瀏覽器不支援 BroadcastChannel，投影視窗無法同步。", "error");
  }

  /**
   * Show mode: put this controller on air on `channel` — its project goes out at once (with
   * `transition`, performed by the output) and so does its state — or take it off air (null:
   * silent, the output keeps its last frame). A controller that is not attached yet goes on air
   * when it attaches.
   */
  setChannel(channel: string | null, opts: { transition?: StageTransition | null } = {}): void {
    if (channel === this.channelTarget && (channel == null || this.link.isOpen)) return;
    if (channel == null) {
      this.holdOutput();
      this.link.close();
      this.channelTarget = null;
      this.pendingTransition = null;
      // a song off air never follows the timecode (its audio would play unseen)
      if (this.following) this.stopFollowing("manual", Date.now());
      return;
    }
    this.channelTarget = channel;
    this.pendingTransition = opts.transition ?? null;
    if (!this.attached) return;
    this.openLink(channel);
    this.updateFollow();
    this.broadcastProject(true);
    this.publish();
    if (this.preloadProject) this.link.post({ type: "preload", project: this.preloadProject });
    this.ensureTicking();
  }

  /** Show mode: announce the armed item so the output warms its fonts and media (null: none). */
  setPreload(project: Project | null): void {
    this.preloadProject = project;
    if (project) this.link.post({ type: "preload", project });
  }

  /**
   * After a reload of this tab: keep the operator's overrides (a blackout stays black), position
   * and section hold / loop. A fresh show take (resume: false) starts the song as designed instead.
   */
  private restoreSession(): void {
    if (this.sessionRestored) return;
    this.sessionRestored = true;
    if (!this.resume) return;
    const session = loadSession(this.id);
    if (!session) return;
    this.overrides = session.overrides;
    if (session.audioTime > 0 && this.resumeAt === 0) this.resumeAt = session.audioTime;
    this.hold = session.hold ?? null;
    this.loop = session.loop ?? null;
    if (this.hold != null || this.loop != null) this.set({ sectionHold: this.hold, sectionLoop: this.loop });
    if (session.overrides.blackout) this.notify("已還原重新整理前的黑場狀態（按 B 解除）", "warn");
  }

  /** The console is going away: let the projection hold its last frame instead of running on. */
  private holdOutput(): void {
    const last = this.store.get();
    if (!this.snapshot.project || !last.playing) return;
    const held: StageState = { ...last, t: stageTime(last), sentAt: Date.now(), playing: false };
    this.store.set(held);
    this.post({ type: "state", state: held });
  }

  private persistSession(): void {
    // a preloaded show item is not on stage: its (start) position must not overwrite what the
    // same song saved while it was on air
    if (this.silent) return;
    const el = this.audio;
    const audioTime = el && el.readyState > 0 && Number.isFinite(el.currentTime) ? el.currentTime : this.resumeAt;
    saveSession(this.id, {
      overrides: this.overrides,
      audioTime,
      ...(this.hold != null ? { hold: this.hold } : {}),
      ...(this.loop != null ? { loop: this.loop } : {}),
    });
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
      // never tear down a running console: once loaded, failures are only reported
      if (this.snapshot.project) this.notify(`重新載入專案失敗：${message}`, "error");
      else if (/^404\b|找不到/.test(message)) this.set({ load: { status: "not-found" } });
      else this.set({ load: { status: "error", message } });
    } finally {
      if (this.loadAbort === abort) this.loadAbort = null;
    }
  }

  /** Replace the project (load, reload, re-design) and resync everything. */
  private applyProject(project: Project, opts: { keepPlan?: boolean } = {}): void {
    const current = this.snapshot.project;
    let next = opts.keepPlan && current?.plan ? { ...project, plan: current.plan } : project;
    // an output edit still waiting to be saved wins over the server's copy
    if (this.pendingOutput && current) next = { ...next, output: current.output };
    const first = !current;
    this.set({ project: next, timecode: this.timecodeInfo(next) });
    this.clock.setLimit(this.duration());
    this.set({ duration: this.duration() });
    if (first) {
      this.clampSections();
      this.onProjectReady(next);
    } else {
      this.clampIndices();
      this.clampSections();
      this.broadcastProject(true);
      this.publish();
    }
    this.schedulePoll(next);
  }

  /** A hold / loop restored from the session, or kept across a re-design, must name a section that exists. */
  private clampSections(): void {
    const n = this.snapshot.project?.plan?.sections.length ?? 0;
    const fix = (i: number | null) => (i != null && i < n ? i : null);
    const hold = fix(this.hold);
    const loop = fix(this.loop);
    if (hold === this.hold && loop === this.loop) return;
    this.hold = hold;
    this.loop = loop;
    this.set({ sectionHold: hold, sectionLoop: loop });
  }

  private onProjectReady(project: Project): void {
    if (!this.attached) return;
    if (!this.settingsFromStorage) {
      // lyrics without timing are cued by hand: start in LIVE mode; else the mode the operator last
      // chose by hand on any song (手動切換 once → every new song starts that way)
      // estimated times (spread over the song, not tapped) are a guess too: cue them by hand until 對拍
      const untimed = !!project.lyrics && project.lyrics.lines.length > 0 && (timedRatio(project.lyrics) < 0.5 || timingEstimated(project.lyrics));
      const mode: PlaybackMode = untimed ? "live" : (loadPreferredMode() ?? "track");
      this.settings = { ...this.settings, mode };
      this.set({ mode });
    }
    this.setupAudio();
    this.seedTempo();
    this.clock.setLimit(this.duration());
    this.set({ duration: this.duration() });
    this.updateFollow();
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
      if (abort.signal.aborted || !this.attached) return;
      // [] = decoding failed: the timeline shows "no waveform" instead of a loading hint
      this.set({ fallbackPeaks: peaks ?? [] });
    });
  }

  private listenWindow(): void {
    const onPageHide = () => {
      this.flushSaveOnExit();
      this.flushOutputOnExit();
      this.persistSession();
      this.holdOutput();
    };
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
    // CORS: the Web Audio analyser reads this element, and cloud mode redirects it to Vercel Blob
    el.crossOrigin = "anonymous";
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
      [
        "ended",
        () => {
          // a loop on the song's last section: back to its start and keep playing
          const s = this.settings.mode === "track" && this.loop != null ? this.snapshot.project?.plan?.sections[this.loop] : undefined;
          if (s) {
            this.seekTo(s.start + 0.001);
            void el.play().catch(() => {});
          }
          sync();
        },
      ],
      ["seeked", () => this.publish()],
      ["seeking", () => this.publish()],
      ["durationchange", sync],
      [
        "loadedmetadata",
        () => {
          if (this.resumeAt > 0) {
            try {
              el.currentTime = Math.min(this.resumeAt, Number.isFinite(el.duration) ? el.duration : this.resumeAt);
            } catch {
              /* not seekable */
            }
            this.resumeAt = 0;
          }
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
    // a re-attach (dev Fast Refresh, retry) continues from the same place
    if (Number.isFinite(el.currentTime) && el.currentTime > 0) this.resumeAt = el.currentTime;
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
    const project = this.snapshot.project;
    if (project && this.snapshot.fallbackPeaks?.length === 0) {
      this.set({ fallbackPeaks: null });
      this.loadFallbackPeaks(project);
    }
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
    if (this.following) {
      const r = this.sync.timecode();
      return !!r && r.running && r.direction > 0;
    }
    if (this.settings.mode === "live") return this.clock.isRunning || this.liveAudioPlaying();
    const el = this.audio;
    return !!el && !el.paused && !el.ended;
  }

  /** 手動切換 with the track on: the audio element is playing (it never drives the lyrics then). */
  private liveAudioPlaying(): boolean {
    const el = this.audio;
    return this.settings.mode === "live" && this.settings.liveAudio && !!el && !el.paused && !el.ended;
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
    if (this.following) {
      const tc = this.tcSongTime(now);
      if (tc != null) {
        const d = this.duration();
        const t = this.settings.mode === "live" ? tc : tc + this.settings.offset;
        return Math.max(0, d > 0 ? Math.min(t, d) : t);
      }
    }
    if (this.settings.mode === "live") return this.clock.time(now);
    const el = this.audio;
    const audioT = el && el.readyState > 0 && Number.isFinite(el.currentTime) ? el.currentTime : this.resumeAt;
    return Math.max(0, audioT + this.settings.offset);
  }

  private computeIndices(t: number, now: number): void {
    const project = this.snapshot.project;
    if (!project) return;
    let line: number | null;
    if (this.settings.mode === "live" && !this.tcDrivesLines()) line = this.liveLine;
    else line = project.lyrics ? lineIndexAt(project.lyrics, t, this.duration()) : null;
    if (this.settings.mode === "live" && this.tcDrivesLines()) {
      // the timecode cues the lines: manual takes over from the one on screen
      this.liveLine = line;
      if (line != null) this.lastCued = line;
    }
    if (line !== this.lineIndex) {
      this.lineIndex = line;
      this.lineStartedAt = now;
    }
    const sections = project.plan?.sections.length ?? 0;
    if (this.hold != null && this.hold < sections) this.sectionIndex = this.hold;
    else this.sectionIndex = this.timeSection(t);
  }

  /** The section playback is in (ignores a hold): a LIVE section jump's pin, else the section at t. */
  private timeSection(t: number): number | null {
    const plan = this.snapshot.project?.plan ?? null;
    const pin = this.sectionPin;
    if (pin && plan && pin.index < plan.sections.length && t < pin.until - 1e-6) return pin.index;
    this.sectionPin = null;
    return sectionIndexAt(plan, t);
  }

  private clampIndices(): void {
    const n = linesOf(this.snapshot.project).length;
    const fix = (i: number | null) => (i == null || i < n ? i : n > 0 ? n - 1 : null);
    this.liveLine = fix(this.liveLine);
    this.lastCued = fix(this.lastCued);
    const sel = fix(this.snapshot.selectedIndex);
    if (sel !== this.snapshot.selectedIndex) this.set({ selectedIndex: sel });
  }

  /** 節拍模式: the MIDI clock's beat phase when it is the source, locked and running. */
  private clockPhase(): number | null {
    if (this.sync.source !== "clock") return null;
    const b = this.sync.beat();
    return b.locked && b.running && b.phase != null ? b.phase : null;
  }

  private sampleAudio(t: number, playing: boolean): LiveAudioFeatures {
    const analysis = this.snapshot.project?.analysis ?? null;
    const nowSec = performance.now() / 1000;
    // a locked MIDI clock (the band's tempo) wins over the microphone and tap tempo
    const clock = this.clockPhase();
    if (this.settings.mode === "live") {
      // 手動切換 over the track: the stage pulses with the track (its own clock, not the cued line's)
      if (this.liveAudioPlaying() && this.audio) {
        const at = this.audio.currentTime;
        const hasGrid = !!analysis && ((analysis.beats?.length ?? 0) > 1 || analysis.bpm > 0);
        const f = this.elementAnalyser?.getFeatures() ?? NO_AUDIO;
        if (clock != null) return { ...f, beatPhase: clock, clock: true };
        return { ...f, beatPhase: hasGrid ? beatPhaseAt(analysis, at) : f.beatPhase };
      }
      // the mic analyser follows taps itself (and phase-locks them to detected onsets)
      if (this.micAnalyser) {
        const f = this.micAnalyser.getFeatures();
        return clock != null ? { ...f, beatPhase: clock, clock: true } : f;
      }
      if (clock != null) return { ...NO_AUDIO, beatPhase: clock, clock: true };
      const tapped = this.tapClock.phase(nowSec);
      if (tapped != null) return { ...NO_AUDIO, beatPhase: tapped };
      return { ...NO_AUDIO, beatPhase: playing && analysis ? beatPhaseAt(analysis, t) : 1 };
    }
    // TRACK paused: a running MIDI clock still beats (the rig plays, the song is not started yet)
    if (!playing) return clock != null ? { ...NO_AUDIO, beatPhase: clock, clock: true } : NO_AUDIO;
    const hasGrid = !!analysis && ((analysis.beats?.length ?? 0) > 1 || analysis.bpm > 0);
    const f = this.elementAnalyser?.getFeatures() ?? NO_AUDIO;
    if (clock != null) return { ...f, beatPhase: clock, clock: true };
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
    // the timecode keeps time while the monitor audio buffers
    const playing = this.following ? this.isPlaying() : this.isPlaying() && !buffering;
    const state: StageState = {
      projectId: this.id,
      mode: this.settings.mode,
      t,
      playing,
      sentAt: now,
      lineIndex: this.lineIndex,
      lineStartedAt: this.lineStartedAt,
      sectionIndex: this.sectionIndex,
      ...(this.hold != null && this.sectionIndex === this.hold ? { sectionHeld: true } : {}),
      overrides: this.overrides,
      audio: this.sampleAudio(t, playing),
    };
    this.store.set(state);
    this.post({ type: "state", state });
    if (this.settings.mode === "live" && !this.following) {
      const held = this.clock.isHeld(now);
      if (held !== this.snapshot.liveHeld) this.set({ liveHeld: held });
    } else if (this.snapshot.liveHeld) this.set({ liveHeld: false });
  }

  private needsTicking(): boolean {
    if (!this.attached || !this.snapshot.project) return false;
    if (this.following) return true;
    if (this.settings.mode === "live") return this.clock.isRunning || this.micAnalyser != null || this.tapClock.bpm != null || this.clockPhase() != null;
    return this.isPlaying() || this.clockPhase() != null;
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
      const now = Date.now();
      this.updateFollow(now);
      if (this.following && this.settings.mode === "track") this.followAudio(now);
      this.loopTrack();
      this.publish(now);
      const playing = this.isPlaying();
      if (playing !== this.snapshot.playing) this.set({ playing });
    } catch (err) {
      // never let one bad frame stop the show clock
      console.error("[Livelyrics] 控制台時脈錯誤：", err);
    }
  }

  /** TRACK 循環段落: playback that reaches the end of the looped section goes back to its start. */
  private loopTrack(): void {
    if (this.loop == null || this.following || this.settings.mode !== "track" || !this.isPlaying()) return;
    const section = this.snapshot.project?.plan?.sections[this.loop];
    const target = loopSeekTarget(section, this.songTime());
    if (target != null) this.seekTo(target + 0.001);
  }

  // -------------------------------------------------------------------------
  // Projection link
  // -------------------------------------------------------------------------

  private post(msg: StageMessage): void {
    this.link.post(msg);
  }

  private heartbeat(): void {
    // ping the outputs, drop the ones that went quiet, expire the other-console flag
    this.link.heartbeat();
    if (this.snapshot.project) this.persistSession();
    // idle consoles resend the state once a second so a missed message heals itself
    if (!this.tickTimer) this.publish();
  }

  private broadcastProject(immediate = false): void {
    const send = () => {
      this.projectBroadcastTimer = null;
      this.lastProjectBroadcast = Date.now();
      const project = this.snapshot.project;
      if (!project || !this.link.isOpen) return;
      // a show take announces its transition with the first project that goes out
      const transition = this.pendingTransition;
      this.pendingTransition = null;
      this.post(transition ? { type: "project", project, transition } : { type: "project", project });
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

  /**
   * Leaving the console stops its clock (the projection holds its last frame). While the
   * show is live — playing or a projection window connected — ask first. True = go ahead.
   */
  confirmLeave(): boolean {
    if (!this.isPlaying() && !this.snapshot.output.connected) return true;
    try {
      return window.confirm("演出進行中：離開控制台會停止播放，投影畫面會停在最後一格。確定要離開嗎？");
    } catch {
      return true;
    }
  }

  /** The export page in its own tab, with the 單格預覽 at the playhead (the console keeps running). */
  exportUrl(): string {
    const t = Math.max(0, Math.round(this.songTime() * 100) / 100);
    return `/p/${encodeURIComponent(this.id)}/export?t=${t}`;
  }

  /** 字體藝術: the 排版 editor in a new tab (its edits show on this console's projection at once). */
  openTypeEditor(): void {
    if (typeof window === "undefined") return;
    let win: Window | null = null;
    try {
      win = window.open(`/p/${encodeURIComponent(this.id)}/type`, `livelyrics-type-${this.id}`);
    } catch {
      win = null;
    }
    if (!win) this.notify("瀏覽器封鎖了新分頁。請允許此網站開啟彈出視窗後再試一次。", "error");
  }

  openExport(): void {
    if (typeof window === "undefined") return;
    let win: Window | null = null;
    try {
      win = window.open(this.exportUrl(), `livelyrics-export-${this.id}`);
    } catch {
      win = null;
    }
    if (!win) this.notify("瀏覽器封鎖了新分頁。請允許此網站開啟彈出視窗後再試一次。", "error");
  }

  /** Open (or focus) the projection window: this song's, or the show's in show mode. Must run inside a user gesture. */
  openOutput(): void {
    if (typeof window === "undefined") return;
    const win = openProjectionWindow(this.outputTarget, this.outputWindow);
    if (!win) {
      this.notify("瀏覽器封鎖了彈出視窗。請允許此網站開啟彈出視窗後再試一次。", "error");
      return;
    }
    this.outputWindow = win;
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
    if (!this.snapshot.project || this.heldByTimecode()) return;
    if (this.settings.mode === "live") {
      // play means the music: 手動切換 turns the track on (the speaker button turns it off again)
      if (!this.settings.liveAudio && !this.following && this.audio) {
        this.updateSettings({ liveAudio: true });
        this.set({ liveAudio: true });
      }
      this.clock.start(Date.now());
      this.afterClockChange();
      if (this.settings.liveAudio && !this.following) await this.playElement();
      return;
    }
    await this.playElement();
  }

  /** Start the audio element (TRACK, or 手動切換 with the track on). */
  private async playElement(): Promise<void> {
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
    if (this.heldByTimecode()) return;
    if (this.settings.mode === "live") {
      this.clock.stop(Date.now());
      this.audio?.pause();
      this.afterClockChange();
      return;
    }
    this.audio?.pause();
  }

  /**
   * 手動切換 with the track (a backing track, rehearsal): the audio plays from where it is and the
   * lyrics still wait for cues. Off (the default, a live band): the track stays silent in LIVE.
   */
  setLiveAudio(on: boolean): void {
    if (on === this.settings.liveAudio) return;
    this.updateSettings({ liveAudio: on });
    this.set({ liveAudio: on });
    if (this.settings.mode === "live") {
      if (!on) this.audio?.pause();
      else if (this.clock.isRunning && !this.following) void this.playElement();
    }
    this.afterClockChange();
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

  /**
   * Seek to song time `t` (seconds). LIVE: moves the virtual clock. Seeking out of a looped
   * section ends the loop (the operator is navigating elsewhere); a hold stays.
   */
  seek(t: number): void {
    if (!Number.isFinite(t) || this.heldByTimecode()) return;
    if (this.loop != null) {
      const s = this.snapshot.project?.plan?.sections[this.loop];
      if ((!s || t < s.start - 1e-3 || t >= s.end) && this.applyLoop(null)) this.persistSession();
    }
    this.seekTo(t);
  }

  private seekTo(t: number): void {
    const project = this.snapshot.project;
    if (!project || !Number.isFinite(t)) return;
    this.sectionPin = null;
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
      this.notify("這一行還沒有時間碼：請切到手動模式送出，或到歌詞編輯器對時。", "warn");
      return;
    }
    this.seek(line.start + 0.001);
  }

  /**
   * LIVE: show line `index` now; the virtual clock jumps to its start and runs until the next line.
   * Inside a looped section the clock never runs past the section's end (the next cue wraps back
   * to its first line); a line outside it ends the loop.
   */
  cueLine(index: number): void {
    this.cue(index, null);
  }

  private cue(index: number, pin: { index: number; until: number } | null): void {
    const project = this.snapshot.project;
    const lines = linesOf(project);
    const line = lines[index];
    if (!project || !line) return;
    if (this.following) {
      if (this.heldByTimecode(true)) return;
      // untimed lyrics under the timecode: the line is cued by hand, the time stays the timecode's
      this.liveLine = index;
      this.lastCued = index;
      this.lineStartedAt = Date.now();
      this.lineIndex = index;
      this.publish();
      return;
    }
    if (this.loop != null && !this.loopLines().includes(index) && this.applyLoop(null)) this.persistSession();
    const now = Date.now();
    const t = line.start ?? this.clock.time(now);
    let hold = liveHoldTime(lines, index, t);
    const section = this.loop != null ? project.plan?.sections[this.loop] : undefined;
    if (section) hold = Math.max(t, Math.min(hold ?? Number.POSITIVE_INFINITY, section.end - LOOP_HOLD_MARGIN));
    this.sectionPin = pin;
    this.clock.jump(t, hold, now);
    this.clock.start(now);
    this.liveLine = index;
    this.lastCued = index;
    this.lineStartedAt = now;
    this.lineIndex = index;
    this.afterClockChange();
  }

  /** Lines of the looped section, in order ([] without a loop). */
  private loopLines(): number[] {
    return this.loop == null ? [] : this.sectionLines(this.loop);
  }

  /** Lines that belong to section `index` (the lyrics list's grouping), cached per project. */
  private sectionLines(index: number): number[] {
    const project = this.snapshot.project;
    if (!project?.plan) return [];
    const duration = this.duration();
    let cache = this.lineSectionCache;
    if (!cache || cache.project !== project || cache.duration !== duration) {
      cache = { project, duration, sections: lineSections(project.plan, linesOf(project), duration) };
      this.lineSectionCache = cache;
    }
    const out: number[] = [];
    cache.sections.forEach((s, i) => {
      if (s === index) out.push(i);
    });
    return out;
  }

  /** LIVE: take the lyric off the screen (the next cue continues after it). */
  clearLine(): void {
    if (this.settings.mode !== "live" || this.liveLine == null || this.heldByTimecode(true)) return;
    this.lastCued = this.liveLine;
    this.liveLine = null;
    this.publish();
  }

  next(): void {
    const project = this.snapshot.project;
    if (!project?.lyrics) return;
    const t = this.songTime();
    if (this.settings.mode === "live") {
      // 循環段落: after the looped section's last line the next cue is its first line again
      const wrap = this.loop != null ? loopNextLine(this.loopLines(), this.liveLine ?? this.lastCued) : null;
      const i = wrap ?? liveNextLine(project.lyrics.lines, this.liveLine, this.lastCued, t);
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

  /** The line "next" would show (the UI's 下一句 marker); a loop brings its section's first line back. */
  upcomingLine(): number | null {
    const lyrics = this.snapshot.project?.lyrics;
    if (!lyrics) return null;
    const t = this.songTime();
    const loopLines = this.loop != null ? this.loopLines() : [];
    if (this.settings.mode === "live") {
      const wrap = loopLines.length ? loopNextLine(loopLines, this.liveLine ?? this.lastCued) : null;
      return wrap ?? liveNextLine(lyrics.lines, this.liveLine, this.lastCued, t);
    }
    const next = trackNextLine(lyrics, t);
    // TRACK: the loop jumps back before the next section's first line is reached
    if (loopLines.length && (next == null || !loopLines.includes(next))) return loopLines.find((i) => lyrics.lines[i]?.start != null) ?? next;
    return next;
  }

  /** Enter: send the standby line and advance the standby to the following line. */
  cueSelected(): void {
    if (this.heldByTimecode(true)) return;
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

  /**
   * Jump to a plan section (段落列, the timeline, PageUp / PageDown). TRACK: seek to its start.
   * LIVE: cue its first line and show the section at once (an instrumental section runs the clock
   * from its start). Jumping to another section ends a hold and a loop.
   */
  jumpToSection(index: number): void {
    const project = this.snapshot.project;
    const section = project?.plan?.sections[index];
    if (!project || !section || this.heldByTimecode()) return;
    // (published once, with the jump)
    let changed = false;
    if (this.hold != null && this.hold !== index) changed = this.applyHold(null) || changed;
    if (this.loop != null && this.loop !== index) changed = this.applyLoop(null) || changed;
    if (changed) this.persistSession();
    if (this.settings.mode !== "live") {
      this.seekTo(section.start + 0.001);
      return;
    }
    // a first line sung just before the boundary: the section still shows from the jump on
    const pin = { index, until: section.start };
    const first = this.sectionLines(index)[0];
    if (first != null && linesOf(project)[first]) {
      this.cue(first, pin);
      return;
    }
    const lines = linesOf(project);
    const now = Date.now();
    const start = section.start + 0.001;
    const next = nextTimedLineAfter(lines, start - 0.05);
    const nextStart = next != null ? lines[next].start : null;
    let hold = nextStart != null && nextStart > start ? nextStart : null;
    if (this.loop === index) hold = Math.max(start, Math.min(hold ?? Number.POSITIVE_INFINITY, section.end - LOOP_HOLD_MARGIN));
    this.sectionPin = pin;
    this.clock.jump(start, hold, now);
    this.clock.start(now);
    this.liveLine = null;
    this.lastCued = lastStartedLine(lines, start);
    this.afterClockChange();
  }

  /** PageDown / PageUp (and . / ,): the section after / before the one on stage. */
  stepSection(delta: 1 | -1): void {
    const plan = this.snapshot.project?.plan;
    if (!plan || plan.sections.length === 0 || this.heldByTimecode()) return;
    const current = this.sectionIndex ?? sectionIndexAt(plan, this.songTime()) ?? 0;
    const target = Math.min(plan.sections.length - 1, Math.max(0, current + delta));
    if (target === current) return;
    this.jumpToSection(target);
  }

  /** 保持段落 (H): keep the section on stage now (scene, colours, lyric style, media) while time and cues move on. */
  toggleHold(): void {
    if (this.hold != null) {
      this.setHold(null);
      return;
    }
    const plan = this.snapshot.project?.plan;
    if (!plan || plan.sections.length === 0) return;
    this.setHold(this.sectionIndex ?? sectionIndexAt(plan, this.songTime()));
  }

  /** Hold section `index`, or release (null): the stage then goes to the section at the current time or cue. */
  setHold(index: number | null): void {
    if (!this.applyHold(index)) return;
    this.persistSession();
    this.publish();
  }

  /** Set the hold without publishing; true when it changed. */
  private applyHold(index: number | null): boolean {
    const n = this.snapshot.project?.plan?.sections.length ?? 0;
    const next = index != null && Number.isInteger(index) && index >= 0 && index < n ? index : null;
    if (next === this.hold) return false;
    this.hold = next;
    this.set({ sectionHold: next });
    return true;
  }

  /**
   * 循環段落 (R): loop the section being played — TRACK: the one at the playhead, LIVE: the
   * section of the line on screen (the clock may already run towards the next one).
   */
  toggleLoop(): void {
    if (this.loop != null) {
      this.setLoop(null);
      return;
    }
    if (this.heldByTimecode()) return;
    const project = this.snapshot.project;
    const plan = project?.plan;
    if (!project || !plan || plan.sections.length === 0) return;
    let index: number | null = null;
    if (this.settings.mode === "live") {
      const ref = this.liveLine ?? this.lastCued;
      if (ref != null) index = lineSections(plan, linesOf(project), this.duration())[ref] ?? null;
    }
    this.setLoop(index ?? this.timeSection(this.songTime()));
  }

  /** Loop section `index` (null = off). LIVE: the clock stops at the section's end instead of running into the next. */
  setLoop(index: number | null): void {
    if (!this.applyLoop(index)) return;
    this.persistSession();
    this.publish();
  }

  /** Set the loop without publishing; true when it changed. */
  private applyLoop(index: number | null): boolean {
    const project = this.snapshot.project;
    const n = project?.plan?.sections.length ?? 0;
    const next = index != null && Number.isInteger(index) && index >= 0 && index < n ? index : null;
    if (next === this.loop) return false;
    this.loop = next;
    this.set({ sectionLoop: next });
    const section = next != null ? project?.plan?.sections[next] : undefined;
    if (section && this.settings.mode === "live") this.clock.capHold(section.end - LOOP_HOLD_MARGIN);
    return true;
  }

  /**
   * Switch TRACK / LIVE. `announce: false` skips the explanatory notice (the M hotkey answers
   * with the console HUD instead, so a toast would repeat it).
   */
  setMode(mode: PlaybackMode, { announce = true }: { announce?: boolean } = {}): void {
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
    this.sectionPin = null;
    // a track already playing keeps playing into 手動切換 (the operator pressed play: they want the
    // music, only the lyrics change hands); a silent LIVE needs a paused track or the speaker off
    if (mode === "live" && !this.settings.liveAudio && this.audio && !this.audio.paused && !this.audio.ended) {
      this.updateSettings({ liveAudio: true });
      this.set({ liveAudio: true });
    }
    const keepTrack = mode === "live" ? this.settings.liveAudio : this.liveAudioPlaying();
    if (mode === "live") {
      if (!this.settings.liveAudio) this.audio?.pause();
      const current = this.lineIndex;
      const next = nextTimedLineAfter(lines, t);
      const hold = current != null ? liveHoldTime(lines, current, t) : next != null ? lines[next].start : null;
      this.clock.stop(now);
      this.clock.jump(t, hold, now);
      const looped = this.loop != null ? project.plan?.sections[this.loop] : undefined;
      if (looped) this.clock.capHold(looped.end - LOOP_HOLD_MARGIN);
      this.liveLine = current;
      this.lastCued = current ?? lastStartedLine(lines, t);
    } else {
      this.clock.stop(now);
      this.liveLine = null;
      const el = this.audio;
      // back to 跟音檔 with the track already running: the lyrics follow it from where it is
      if (el && !keepTrack) {
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
    if (announce) this.notify(mode === "live" ? "手動切換：按 Space、→ 或簡報遙控器送出下一句，點清單可跳到任一句" : "跟著音檔：歌詞依音檔時間自動換句", "info");
  }

  toggleMode(opts?: { announce?: boolean }): void {
    this.setMode(this.settings.mode === "live" ? "track" : "live", opts);
  }

  /** The operator's own choice (the mode switch, M): also the starting mode of songs opened later. */
  chooseMode(mode: PlaybackMode, opts?: { announce?: boolean }): void {
    savePreferredMode(mode);
    this.setMode(mode, opts);
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
  // Timecode chase (phase 5a)
  // -------------------------------------------------------------------------

  /** The start timecode this song chases: the show's setlist, the song's own, or 01:00:00:00. */
  private timecodeInfo(project: Project | null = this.snapshot.project): TimecodeInfo {
    const own = project?.timecode?.start ? normalizeTcInput(project.timecode.start) : null;
    const start = this.showStart ?? own ?? DEFAULT_START_TC;
    return { start, from: this.showStart ? "setlist" : own ? "project" : "default", following: this.following };
  }

  /** Song time the timecode says now (before the song: negative), null without a reading. */
  private tcSongTime(now: number): number | null {
    const r = this.sync.timecode(now);
    return r ? songTimeAt(r.position, this.snapshot.timecode.start, r.rate) : null;
  }

  /** The timecode drives the song clock (MTC / LTC locked, stopped at a locate, or freewheeling). */
  isFollowingTimecode(): boolean {
    return this.following;
  }

  /**
   * Whether the timecode holds a kind of manual action now: "line" (next / previous / cue a line:
   * TRACK, or LIVE with timed lyrics) or "time" (seek, sections, loop, play / pause). The console
   * answers a held key with the HUD instead of running it.
   */
  timecodeHolds(kind: "line" | "time"): boolean {
    return kind === "line" ? this.tcDrivesLines() : this.following;
  }

  /** The timecode cues the lines too (TRACK, or LIVE with timed lyrics). */
  private tcDrivesLines(): boolean {
    if (!this.following) return false;
    if (this.settings.mode === "track") return true;
    const lyrics = this.snapshot.project?.lyrics;
    return !!lyrics && lyrics.lines.length > 0 && timedRatio(lyrics) >= 0.5;
  }

  /**
   * Manual navigation while the timecode drives the song waits for 回到手動: true (and a notice)
   * when it is held. `lines`: only held when the timecode also cues the lines.
   */
  private heldByTimecode(lines = false): boolean {
    if (!this.following || (lines && !this.tcDrivesLines())) return false;
    this.notify(`正在跟隨時間碼：要手動操作，請先按 ${MANUAL_KEY} 回到手動`, "info");
    return true;
  }

  private onSyncChange(): void {
    if (!this.attached) return;
    if (this.relockNotice && this.sync.source !== this.relockSource) this.relockNotice = false;
    this.updateFollow();
    this.ensureTicking();
    // an idle console publishes the change itself (e.g. the MIDI clock's beat went away)
    if (!this.tickTimer) this.publish();
  }

  /** Start or stop following as the chase locks, freewheels and fails. */
  private updateFollow(now: number = Date.now()): void {
    if (!this.attached || !this.snapshot.project) return;
    const src = this.sync.source;
    const r = !this.silent && (src === "mtc" || src === "ltc") ? this.sync.timecode(now) : null;
    const active = !!r && (r.status === "locked" || r.status === "freewheel" || r.status === "stopped");
    if (active && !this.following) this.startFollowing(now);
    else if (!active && this.following) this.stopFollowing(r?.status === "lost" ? "lost" : "manual", now);
    if (this.following) {
      const t = this.tcSongTime(now);
      if (t != null) this.followT = t;
    }
  }

  private startFollowing(now: number): void {
    this.following = true;
    this.sectionPin = null;
    this.audioGraceUntil = 0;
    const t = this.tcSongTime(now);
    if (t != null) this.followT = t;
    if (this.loop != null && this.applyLoop(null)) {
      this.persistSession();
      this.notify("循環段落已關閉：播放位置由時間碼決定", "info");
    }
    if (this.settings.mode === "live") this.clock.stop(now);
    if (this.relockNotice) {
      this.relockNotice = false;
      this.notify("時間碼恢復，已重新鎖定", "ok");
    }
    this.set({ timecode: { ...this.snapshot.timecode, following: true }, liveHeld: false, playing: this.isPlaying() });
    this.publish(now);
  }

  /**
   * Manual takes over where the timecode left the song: LIVE keeps the line on screen (the clock
   * runs to the next line's start and waits for a cue), TRACK keeps the audio where it is — a
   * dropout also pauses it (no auto-advance without the timecode).
   */
  private stopFollowing(reason: "lost" | "manual", now: number): void {
    const project = this.snapshot.project;
    const t = Math.max(0, this.followT);
    const drovelines = this.tcDrivesLines();
    this.following = false;
    if (project && this.settings.mode === "live") {
      const lines = linesOf(project);
      const d = this.duration();
      const current = drovelines ? (project.lyrics ? lineIndexAt(project.lyrics, t, d) : null) : this.liveLine;
      this.liveLine = current;
      this.lastCued = current ?? this.lastCued ?? lastStartedLine(lines, t);
      const next = nextTimedLineAfter(lines, t);
      const hold = current != null ? liveHoldTime(lines, current, t) : next != null ? lines[next].start : null;
      this.clock.jump(t, hold, now);
      this.clock.start(now);
      this.lineIndex = current;
    } else {
      const el = this.audio;
      if (el) {
        if (reason === "lost") el.pause();
        try {
          if (Math.abs(el.currentTime - t) > CHASE_DRIFT) el.currentTime = t;
        } catch {
          /* not seekable */
        }
      }
    }
    if (reason === "lost") {
      this.relockNotice = true;
      this.relockSource = this.sync.source;
      this.notify("時間碼中斷，已切回手動", "warn");
    }
    this.set({ timecode: { ...this.snapshot.timecode, following: false }, playing: this.isPlaying() });
    this.publish(now);
    this.ensureTicking();
  }

  /** TRACK: keep the monitor audio on the timecode (seek past 80 ms of drift, play / pause with it). */
  private followAudio(now: number): void {
    const el = this.audio;
    const r = this.sync.timecode(now);
    if (!el || !r || this.snapshot.audio.status === "error") return;
    const t = songTimeAt(r.position, this.snapshot.timecode.start, r.rate);
    const d = this.duration();
    const forward = r.running && r.direction > 0 && t >= 0 && (d <= 0 || t < d);
    if (t < 0) {
      // pre-roll: the first frame waits
      if (!el.paused) el.pause();
      if (el.currentTime > 0.05 && now >= this.audioGraceUntil) {
        el.currentTime = 0;
        this.audioGraceUntil = now + CHASE_GRACE_MS;
      }
      return;
    }
    if (now >= this.audioGraceUntil && Math.abs(el.currentTime - t) > CHASE_DRIFT) {
      try {
        el.currentTime = d > 0 ? Math.min(t, d) : t;
      } catch {
        /* not seekable yet */
      }
      this.audioGraceUntil = now + CHASE_GRACE_MS;
    }
    if (forward && el.paused) {
      this.ensureElementAnalyser();
      this.audioGraceUntil = now + CHASE_GRACE_MS;
      el.play().then(
        () => {
          this.playBlocked = false;
        },
        (err: unknown) => {
          if (isAbort(err) || this.playBlocked) return;
          this.playBlocked = true;
          this.notify("瀏覽器暫時不允許播放監聽音訊：在控制台按一下任一處即可（時間碼照常驅動畫面）。", "warn");
        },
      );
    } else if (!forward && !el.paused) el.pause();
  }

  /** 回到手動 (X): stop following the timecode / MIDI clock; the line on screen stays. True when it changed. */
  backToManual(): boolean {
    if (this.sync.source === "manual") return false;
    // where the timecode is now, before it goes
    this.updateFollow();
    this.sync.setSource("manual");
    return true;
  }

  /** This song's own start timecode (the per-song console; a show song takes the setlist's). */
  setTimecodeStart(value: string | null): boolean {
    const project = this.snapshot.project;
    if (!project || this.showStart) return false;
    const start = value == null || !value.trim() ? null : normalizeTcInput(value);
    if (value != null && value.trim() && !start) return false;
    const stored = start && start !== DEFAULT_START_TC ? start : null;
    const next: Project = { ...project };
    if (stored) next.timecode = { start: stored };
    else delete next.timecode;
    this.set({ project: next, timecode: this.timecodeInfo(next) });
    this.publish();
    api.updateProject(this.id, { timecode: stored ? { start: stored } : null }).catch((err: unknown) => {
      this.notify(`起點時間碼沒有存成功：${errorMessage(err, "儲存失敗")}`, "error");
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Overrides
  // -------------------------------------------------------------------------

  setOverrides(patch: Partial<StageOverrides>): void {
    const next: StageOverrides = { ...this.overrides, ...patch };
    next.intensity = Math.min(1.5, Math.max(0, Number.isFinite(next.intensity) ? next.intensity : 1));
    next.lyricScale = Math.min(2, Math.max(0.5, Number.isFinite(next.lyricScale) ? next.lyricScale : 1));
    this.overrides = next;
    this.persistSession();
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
    this.persistSession();
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

  /**
   * 字體藝術: the 排版 editor (another window) changed this song's type system and saved it. The
   * console takes the type system (keeping its own section edits, saved or not) and shows it on the
   * projection at once; it does not save it again (the editor did).
   */
  /**
   * Keys pressed in this console's projection window (a presentation clicker aimed at the projector,
   * or the projecting computer's keyboard while the output is fullscreen). The console view maps them
   * with the same hotkey table as its own keyboard. Returns the unsubscribe function.
   */
  onRemoteKey(listener: (key: RemoteKey) => void): () => void {
    this.remoteKeyListeners.add(listener);
    return () => this.remoteKeyListeners.delete(listener);
  }

  adoptTypeSystem(projectId: string, plan: DesignPlan): void {
    const project = this.snapshot.project;
    if (!project?.plan || project.id !== projectId || this.snapshot.redesign.running) return;
    const typeSystem = plan.typeSystem ?? null;
    if (JSON.stringify(project.plan.typeSystem ?? null) === JSON.stringify(typeSystem)) return;
    const withType = (p: DesignPlan): DesignPlan => {
      const next: DesignPlan = { ...p };
      if (typeSystem) next.typeSystem = typeSystem;
      else delete next.typeSystem;
      return next;
    };
    this.set({ project: { ...project, plan: withType(project.plan) } });
    if (this.pendingPlan) this.pendingPlan = withType(this.pendingPlan);
    this.broadcastProject(true);
    this.publish();
  }

  /**
   * The project's band media changed (upload, edit, delete). `plan` is the server's plan after a
   * delete (sections that showed the asset are cleared); without it, sections pointing at
   * assets that are gone are cleared locally. The projection gets the new project at once.
   */
  /**
   * 研究找到的素材 changed (phase 8: 可以上台 / 只當參考 / 移除). `plan` is the server's plan (sections
   * that showed an item no longer on stage are cleared); the projection gets the new project at once.
   */
  applyCollected(collected: CollectedVisual[], plan?: DesignPlan | null): void {
    const project = this.snapshot.project;
    if (!project) return;
    const ids = new Set(stageAssets({ assets: project.assets, bandAssets: project.bandAssets, collected }).map((a) => a.id));
    const strip = (p: DesignPlan): DesignPlan =>
      p.sections.some((s) => s.media && !ids.has(s.media.assetId))
        ? { ...p, sections: p.sections.map((s) => (s.media && !ids.has(s.media.assetId) ? { ...s, media: null } : s)) }
        : p;
    let nextPlan = project.plan;
    if (plan !== undefined && !this.pendingPlan) nextPlan = plan;
    else if (nextPlan) nextPlan = strip(nextPlan);
    if (this.pendingPlan) this.pendingPlan = strip(this.pendingPlan);
    this.set({ project: { ...project, collected, plan: nextPlan } });
    this.broadcastProject(true);
  }

  applyAssets(assets: Asset[], plan?: DesignPlan | null): void {
    const project = this.snapshot.project;
    if (!project) return;
    const ids = new Set(stageAssets({ assets, bandAssets: project.bandAssets, collected: project.collected }).map((a) => a.id));
    const strip = (p: DesignPlan): DesignPlan =>
      p.sections.some((s) => s.media && !ids.has(s.media.assetId))
        ? { ...p, sections: p.sections.map((s) => (s.media && !ids.has(s.media.assetId) ? { ...s, media: null } : s)) }
        : p;
    let nextPlan = project.plan;
    if (plan !== undefined && !this.pendingPlan) nextPlan = plan;
    else if (nextPlan) nextPlan = strip(nextPlan);
    if (this.pendingPlan) this.pendingPlan = strip(this.pendingPlan);
    this.set({ project: { ...project, assets, plan: nextPlan } });
    this.broadcastProject(true);
    this.publish();
  }

  /** Change the output canvas (size preset, custom size, lyric safe area); saved after a short pause. */
  updateOutput(patch: OutputPatch): void {
    const project = this.snapshot.project;
    if (!project) return;
    const current = project.output;
    const next = patchOutput(current, patch);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    this.set({ project: { ...project, output: next } });
    this.broadcastProject(true);
    this.publish();
    this.pendingOutput = next;
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = setTimeout(() => void this.flushOutput(), 400);
  }

  /** LED 安全模式 (phase 3): part of the output settings; the projection gets it at once. */
  updateSafety(patch: SafetyPatch): void {
    this.ledFader.reset();
    this.updateOutput({ safety: patch });
  }

  /**
   * A MIDI fader on 最高亮度 (0..1): the cap between 20 % and the ceiling it had when the fader
   * took over, never above the venue's preset. Returns the new cap, null when safe mode is off.
   */
  setLedCapFromController(value: number): number | null {
    const brightness = this.ledFader.brightnessFor(this.snapshot.project?.output?.safety, value);
    if (brightness == null) return null;
    if (Math.abs(brightness - (this.snapshot.project?.output?.safety?.brightness ?? -1)) > 0.001) this.updateOutput({ safety: { brightness } });
    return brightness;
  }

  private async flushOutput(): Promise<void> {
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = null;
    const output = this.pendingOutput;
    if (!output) return;
    this.pendingOutput = null;
    try {
      await api.updateProject(this.id, { output });
    } catch (err) {
      if (!this.pendingOutput) this.pendingOutput = output;
      this.notify(`輸出設定沒有存成功：${errorMessage(err, "儲存失敗")}`, "error");
    }
  }

  private flushOutputOnExit(): void {
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = null;
    const output = this.pendingOutput;
    if (!output) return;
    this.pendingOutput = null;
    try {
      void fetch(`/api/projects/${encodeURIComponent(this.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ output }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* unloading */
    }
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
      // a re-design keeps the research; a project that never had one researches first
      const steps: Array<"research" | "design"> = this.snapshot.project?.research ? ["design"] : ["research", "design"];
      const project = await api.process(this.id, { steps, ...(text ? { instruction: text } : {}) }, (e) => this.onPipelineEvent(e), abort.signal);
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
      case "attached":
        // the server joined a run that was already going; the log line that follows explains it
        if (!e.sameRequest) this.notify("已有處理正在進行，這次的重新設計指示不會套用；完成後請再執行一次。", "warn");
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
    // a UI-owned stack shows three at most: older notices leave instead of resurfacing later
    const keep = this.noticeAutoDismiss ? 4 : 3;
    const notices = [...this.snapshot.notices.filter((n) => n.message !== message), { id, tone, message }].slice(-keep);
    this.set({ notices });
    if (typeof window === "undefined" || !this.noticeAutoDismiss) return;
    const timer = setTimeout(() => this.dismissNotice(id), tone === "error" ? NOTICE_MS * 2 : NOTICE_MS);
    this.noticeTimers.set(id, timer);
  }

  /**
   * Let the UI own notice lifetimes (false): notices then stay until dismissNotice(), so a toast
   * stack can pause its timers while hovered, focused or hidden. true restores the built-in
   * 4.5 s (errors 9 s) timers for notices raised from then on.
   */
  setNoticeAutoDismiss(enabled: boolean): void {
    if (enabled === this.noticeAutoDismiss) return;
    this.noticeAutoDismiss = enabled;
    if (!enabled) {
      for (const t of this.noticeTimers.values()) clearTimeout(t);
      this.noticeTimers.clear();
    }
  }

  dismissNotice(id: number): void {
    const timer = this.noticeTimers.get(id);
    if (timer) clearTimeout(timer);
    this.noticeTimers.delete(id);
    if (this.snapshot.notices.some((n) => n.id === id)) this.set({ notices: this.snapshot.notices.filter((n) => n.id !== id) });
  }
}
